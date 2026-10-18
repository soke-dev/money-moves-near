import "dotenv/config";
import { Address, Cell, SendMode, beginCell, internal, storeMessageRelaxed, toNano } from "@ton/core";
import { WalletContractV5R1 } from "@ton/ton";
import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";
import nacl from "tweetnacl";
import * as ton from "../lib/ton";

/**
 * Does the TON send path actually produce a valid request?
 *
 * The prepare/submit pair does something that deserves proving rather than
 * assuming: it builds the W5 request twice. Once at prepare, with a throwaway
 * signature, purely to capture the cell the user must sign the hash of; and
 * once at submit, with the real signature, to produce the thing the relay
 * carries. Those two builds have to agree exactly, or the user signs one
 * request and we broadcast another - which the wallet contract would reject,
 * after the money had appeared to leave.
 *
 * So this checks the capture-and-rebuild against the library's own one-shot
 * signing, which is the ground truth. It also checks the address derivation
 * and the fee reserve.
 *
 * Read only and offline apart from the relay config: no funds, no broadcast,
 * a keypair invented here and thrown away.
 *
 *   npx tsx src/scripts/ton-selftest.ts
 */

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log("\n── TON send path ──\n");

  const key = await mnemonicToPrivateKey(await mnemonicNew());
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey });

  // 1. The address the app will show is the one the key can sign for.
  const solStyle = Buffer.from(key.publicKey).toString("base64");
  const derived = ton.tonAddressFromPublicKey(key.publicKey);
  check(
    "address derives from the public key",
    Address.parse(derived).equals(wallet.address),
    derived,
  );
  check(
    "address is non-bounceable (UQ), so a first deposit cannot bounce",
    derived.startsWith("UQ"),
    derived.slice(0, 2),
  );

  // 2. Round-tripping the written forms names the same account.
  const eq = wallet.address.toString({ bounceable: true, urlSafe: true });
  const raw = wallet.address.toRawString();
  check("EQ, UQ and raw are recognised as one account",
    ton.sameTonAddress(eq, derived) && ton.sameTonAddress(raw, derived));
  check("a corrupted address is refused",
    !ton.isValidTonAddress(derived.slice(0, -1) + (derived.endsWith("a") ? "b" : "a")));

  // 3. The reserve holds back exactly once.
  check("fee reserve leaves the rest spendable",
    ton.netOfTonFee(10) === 10 - ton.TON_FEE_RESERVE,
    String(ton.netOfTonFee(10)));
  check("a balance under the reserve is not spendable",
    ton.netOfTonFee(ton.TON_FEE_RESERVE / 2) === 0);

  // 4. The relay still takes USDT.
  const usdtOk = await ton.gaslessSupportsUsdt();
  check("the live relay still accepts USDT as its fee", usdtOk);

  // ── The one that matters ───────────────────────────────────
  //
  // Same inputs, three ways of signing: the library's own secretKey path
  // (ground truth), and our capture-then-rebuild. If the rebuild differs by a
  // single bit, the signature the user gave is for a request nobody sends.
  const cfg = await ton.gaslessConfig();
  const relay = Address.parse(cfg.relay_address);
  const seqno = 0;
  const timeout = Math.floor(Date.now() / 1000) + 300;
  const messages = [
    internal({
      to: relay,
      value: toNano("0.1"),
      bounce: true,
      body: ton.jettonTransferBody({
        amount: 1_000_000n,
        destination: relay,
        responseDestination: relay,
      }),
    }),
  ];
  const args = {
    seqno,
    timeout,
    authType: "internal" as const,
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages,
  };

  // (a) capture what prepare would ask the user to sign
  let captured: Cell | null = null;
  await wallet.createTransfer({
    ...args,
    signer: async (cell: Cell) => {
      captured = cell;
      return Buffer.alloc(64);
    },
  });
  check("prepare captures a cell to sign", !!captured);
  if (!captured) return;

  const toSign = captured as Cell;
  const hash = toSign.hash();
  check("what the user signs is a 32-byte hash", hash.length === 32, `${hash.length} bytes`);

  // (b) sign it the way the app's Ed25519 signer will
  const signature = Buffer.from(
    nacl.sign.detached(new Uint8Array(hash), new Uint8Array(key.secretKey)),
  );
  check("the signature is 64 bytes", signature.length === 64);
  check(
    "the signature verifies against the public key",
    nacl.sign.detached.verify(
      new Uint8Array(hash),
      new Uint8Array(signature),
      new Uint8Array(key.publicKey),
    ),
  );

  // (c) submit's rebuild, against the library's own signing
  const rebuilt = await wallet.createTransfer({ ...args, signer: async () => signature });
  const groundTruth = wallet.createTransfer({ ...args, secretKey: key.secretKey });
  check(
    "the rebuilt request is bit-identical to the library's own",
    rebuilt.equals(groundTruth as Cell),
    rebuilt.hash().toString("hex").slice(0, 16),
  );

  // (d) the envelope the relay receives
  const wrapped = ton.wrapForRelay(wallet.address, rebuilt, wallet.init);
  check("the relay envelope builds, with state init for a first send",
    wrapped.toBoc().length > 0, `${wrapped.toBoc().length} bytes`);
  const noInit = ton.wrapForRelay(wallet.address, rebuilt, null);
  check("and differs from one without state init",
    !wrapped.equals(noInit));

  console.log(
    failures
      ? `\n  ${failures} FAILED\n`
      : "\n  all passed — the request the user signs is the request that gets sent\n",
  );
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message);
  process.exitCode = 1;
});
