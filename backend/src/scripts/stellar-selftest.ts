/**
 * Stellar self-test, on TESTNET, with throwaway accounts.
 *
 * Proves the pieces lib/stellar.ts relies on before any real money moves:
 * opening an account for one coin, adding the second coin later, a payment the
 * user signs and the treasury fee-bumps, the deposit watcher finding it, and
 * the refusals for destinations that cannot receive. The user is a fresh
 * Ed25519 key standing in for a Solana key, signed the way the app signs: the
 * raw 32-byte transaction hash.
 *
 * Touches no database and nothing on mainnet. Run: npx tsx src/scripts/stellar-selftest.ts
 */
import { Asset, Keypair, Operation, TransactionBuilder, Networks, Horizon, BASE_FEE } from "@stellar/stellar-sdk";
import bs58 from "bs58";

const HORIZON = "https://horizon-testnet.stellar.org";

async function friendbot(address: string) {
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
      if (res.ok) return;
    } catch {
      /* flaky network: try again */
    }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  throw new Error("friendbot unreachable");
}

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  const treasury = Keypair.random();
  const issuer = Keypair.random();
  const user = Keypair.random(); // stands in for the user's Solana key
  const friend = Keypair.random();

  // Configure lib/stellar for testnet BEFORE it is loaded.
  process.env.STELLAR_NETWORK = "TESTNET";
  process.env.STELLAR_TREASURY_SECRET = treasury.secret();
  process.env.STELLAR_USDC_ISSUER = issuer.publicKey();
  process.env.STELLAR_USDT_ISSUER = issuer.publicKey();
  process.env.STELLAR_HORIZON_URL = HORIZON;
  const s = await import("../lib/stellar");

  console.log("funding treasury and issuer from friendbot...");
  await Promise.all([friendbot(treasury.publicKey()), friendbot(issuer.publicKey())]);

  // The user's Solana address, and the Stellar address derived from it.
  const solanaAddress = bs58.encode(user.rawPublicKey());
  const userAddr = s.stellarAddressFromSolana(solanaAddress);
  check("Stellar address derives from the Solana key", userAddr === user.publicKey(), userAddr);

  const signHash = (kp: Keypair, hex: string) => kp.sign(Buffer.from(hex, "hex")).toString("hex");

  // 1. Open the account for USDC only.
  const a1 = await s.prepareActivation("act-1", userAddr, "USDC");
  check("prepareActivation returns a hash to sign", !!a1?.signingMessage);
  await s.submitActivation("act-1", signHash(user, a1!.signingMessage));
  let st = await s.getAccountState(userAddr);
  check("account exists after activation", st.exists);
  check("USDC trustline only", st.trust.USDC && !st.trust.USDT, JSON.stringify(st.trust));
  const userAcc: any = await new Horizon.Server(HORIZON).loadAccount(userAddr);
  const xlm = Number(userAcc.balances.find((b: any) => b.asset_type === "native")?.balance);
  check("user holds no XLM (reserve is sponsored)", xlm === 0, `${xlm} XLM`);

  // Activating the same coin again is a no-op.
  check("repeat activation does nothing", (await s.prepareActivation("act-x", userAddr, "USDC")) === null);

  // 2. Add USDT0 later.
  const a2 = await s.prepareActivation("act-2", userAddr, "USDT");
  await s.submitActivation("act-2", signHash(user, a2!.signingMessage));
  st = await s.getAccountState(userAddr);
  check("USDT0 trustline added to the open account", st.trust.USDC && st.trust.USDT);

  // A friend with USDC only, to pay.
  const fa = await s.prepareActivation("act-3", friend.publicKey(), "USDC");
  await s.submitActivation("act-3", signHash(friend, fa!.signingMessage));

  // Issuer sends the user 10 test USDC.
  const server = new Horizon.Server(HORIZON);
  const issuerAcc = await server.loadAccount(issuer.publicKey());
  const mint = new TransactionBuilder(issuerAcc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: userAddr, asset: new Asset("USDC", issuer.publicKey()), amount: "10" }))
    .setTimeout(60)
    .build();
  mint.sign(issuer);
  await server.submitTransaction(mint);
  check("user received 10 USDC", (await s.getStellarCoinBalance("USDC", userAddr)) === 10);

  // 3. User pays the friend 2.5 USDC with a memo; treasury pays the fee.
  const before = await s.treasuryStatus();
  const p1 = await s.preparePayment("pay-1", { from: userAddr, to: friend.publicKey(), coin: "USDC", amount: 2.5, memo: "12345" });
  const hash = await s.submitPayment("pay-1", signHash(user, p1.signingMessage));
  check("fee-bumped payment submitted", !!hash, hash);
  check("sender down to 7.5", (await s.getStellarCoinBalance("USDC", userAddr)) === 7.5);
  check("friend up to 2.5", (await s.getStellarCoinBalance("USDC", friend.publicKey())) === 2.5);
  const after = await s.treasuryStatus();
  check("treasury paid the fee", after.xlm < before.xlm, `${(before.xlm - after.xlm).toFixed(7)} XLM`);

  // 4. The deposit watcher sees it, under the same hash the sender recorded.
  const dep = await s.findStellarDeposit(friend.publicKey(), "USDC");
  check("deposit found for the friend", dep?.amount === 2.5, `${dep?.amount} from ${dep?.from?.slice(0, 6)}`);
  check("deposit hash matches the submitted hash", dep?.txHash === hash, `${dep?.txHash?.slice(0, 10)} vs ${hash.slice(0, 10)}`);

  // 5. Selling: pay the treasury, after it has trustlines.
  await s.ensureTreasuryTrustlines();
  const t = await s.treasuryStatus();
  check("treasury trusts both coins", t.trust.USDC && t.trust.USDT);
  const p2 = await s.preparePayment("pay-2", { from: userAddr, to: s.sellAddress()!, coin: "USDC", amount: 1 });
  await s.submitPayment("pay-2", signHash(user, p2.signingMessage));
  check("sell payment reached the treasury", (await s.getStellarCoinBalance("USDC", userAddr)) === 6.5);

  // 6. Refusals, in words.
  const stranger = Keypair.random().publicKey();
  try {
    await s.preparePayment("pay-3", { from: userAddr, to: stranger, coin: "USDC", amount: 1 });
    check("unopened destination refused", false);
  } catch (e: any) {
    check("unopened destination refused", e.name === "StellarError", e.message);
  }
  try {
    await s.preparePayment("pay-4", { from: userAddr, to: friend.publicKey(), coin: "USDT", amount: 1 });
    check("destination without the trustline refused", false);
  } catch (e: any) {
    check("destination without the trustline refused", e.name === "StellarError", e.message);
  }
  try {
    const p5 = await s.preparePayment("pay-5", { from: userAddr, to: friend.publicKey(), coin: "USDC", amount: 1 });
    await s.submitPayment("pay-5", signHash(friend, p5.signingMessage)); // wrong key
    check("wrong signature refused", false);
  } catch (e: any) {
    check("wrong signature refused", e.name === "StellarError", e.message);
  }

  console.log(`\ntreasury sponsoring ${t.sponsoring} entries, ${t.spendableXlm.toFixed(2)} XLM spendable`);
  console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED");
})().catch((e) => {
  console.error("SELFTEST CRASHED:", e?.response?.data?.extras?.result_codes ?? e?.message ?? e);
  process.exit(1);
});
