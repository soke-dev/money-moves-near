/**
 * Crypto leaving what came in: a paid payment's coins swept from its own
 * address into the treasury, and whatever wasn't needed - paid over, paid
 * short and left to lapse, paid late, another coin - given back.
 *
 * Sized by the chain, never by what we stored: every send reads the address's
 * live balance first and sends no more than is there.
 *
 * Fees: on the EVM chains the gas sponsor tops a payment's address up with
 * just enough gas first (Arc pays its fee out of the USDC itself); on Solana a
 * fee payer covers it, and closing an emptied token account gives its rent
 * back to that fee payer; on Movement the float sponsors the transaction.
 *
 * Where a return goes: back to the wallet it came from when that looks like a
 * person's own wallet. An exchange's wallet (it sends thousands of
 * transactions), a contract, or anything we can't tell, waits for the
 * customer to say where - the link in their email - or for our team. Stellar
 * and TON always ask, because payments there so often come from an exchange.
 *
 * Nothing here is sent twice: each send is claimed first, its transaction hash
 * is written the moment it's out, and from then on only the chain is asked.
 */
import crypto from "crypto";
import type { CryptoArrival, Payment } from "@prisma/client";
import { ethers } from "ethers";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Account, Aptos, AptosConfig, Ed25519PrivateKey, Network as AptosNetwork } from "@aptos-labs/ts-sdk";
import bs58 from "bs58";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { EVM_CHAINS, MEMO_NETWORKS, MOVE_ASSETS, SOL_MINTS, addressKey, contractsOf, evmChain, fromMicros, hexNum, rpc, toMicros, treasuryFor, type EvmChain } from "../lib/chains";
import { evmDepositWallet, movementDepositAccount, solanaDepositKeypair } from "../lib/deposit-keys";
import { floatSend, floatTxStatus, NotSent, type FloatChain, type Sent } from "../lib/float";
import { StellarNotSent, isStellarAddress, stellarSend, stellarTxStatus, type StellarCoin } from "../lib/stellar";
import { isTonAddress } from "../lib/ton";
import { checkoutLink } from "../lib/pay-links";
import { button, esc, fine, hero, para, rows, sendEmail, shell, supportLine } from "../lib/email";
import type { Coin, Network } from "../lib/accept";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Less than this isn't worth a network fee to give back: a cent. */
const DUST = 10_000n;
/** A wallet that has sent this many transactions is an exchange's, or a business's - not one person's. */
const BUSY_WALLET = 1_000;
const ERC20 = new ethers.Interface(["function transfer(address to, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const amountText = (micros: bigint, coin: string) => `${(Number(micros) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${coin}`;

// ─── Where a return can be sent from ──────────────────────────────────────

const FLOAT_CHAIN: Record<string, FloatChain> = { Movement: "MOVEMENT", Solana: "SOLANA", Arc: "ARC", Monad: "MONAD", Stellar: "STELLAR" };

/** "own": the payment's own address still holds it. "float": it reached our treasury, and the float can pay it back. Null: our team sends it. */
export function sendsFrom(x: Pick<CryptoArrival, "network" | "coin" | "toAddress">, p: Pick<Payment, "depositKind" | "depositAddress"> | null): "own" | "float" | null {
  if (p?.depositKind === "OWN" && p.depositAddress && addressKey(x.network, p.depositAddress) === addressKey(x.network, x.toAddress)) return "own";
  if (x.network === "Stellar") return "float";
  if (x.coin === "USDC" && FLOAT_CHAIN[x.network] && x.network !== "Stellar") return "float";
  return null;
}

/** Whether an address is a person's own wallet, as far as the chain can tell. */
async function looksPersonal(network: string, address: string): Promise<boolean> {
  try {
    const c = evmChain(network);
    const url = c?.url();
    if (c && url) {
      // A contract (a smart wallet, an exchange's forwarder) can't be told apart: ask.
      if ((await rpc<string>(url, "eth_getCode", [address, "latest"])) !== "0x") return false;
      return hexNum(await rpc<string>(url, "eth_getTransactionCount", [address, "latest"])) < BUSY_WALLET;
    }
    if (network === "Solana" && env.SOLANA_RPC_URL) {
      const sigs = await rpc<{ blockTime: number | null }[]>(env.SOLANA_RPC_URL, "getSignaturesForAddress", [address, { limit: BUSY_WALLET }]);
      if (sigs.length < BUSY_WALLET) return true;
      const oldest = sigs[sigs.length - 1]?.blockTime;
      return !!oldest && oldest * 1000 < Date.now() - 7 * 86_400_000;
    }
    if (network === "Movement" && env.MOVEMENT_RPC_URL) {
      const r = await fetch(`${env.MOVEMENT_RPC_URL.replace(/\/$/, "")}/accounts/${address}`, { signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) return true;
      const a = (await r.json()) as { sequence_number?: string };
      return Number(a.sequence_number ?? 0) < BUSY_WALLET;
    }
  } catch (e) {
    log.warn("[crypto-out] couldn't tell whose wallet it is, asking instead", { network, reason: reason(e) });
  }
  return false;
}

/** Whether an address is one this network can send to. */
export function validReturnAddress(network: string, address: string): boolean {
  const a = address.trim();
  if (evmChain(network)) return ethers.isAddress(a);
  if (network === "Solana") {
    try {
      return new PublicKey(a).toBase58() === a;
    } catch {
      return false;
    }
  }
  if (network === "Movement") return /^0x[0-9a-fA-F]{1,64}$/.test(a);
  if (network === "Stellar") return isStellarAddress(a);
  if (network === "TON") return isTonAddress(a);
  return false;
}

// ─── Deciding where it goes ───────────────────────────────────────────────

const WHY_WORDS: Record<string, string> = {
  overpaid: "more than the payment needed",
  short: "less than the payment needed, and the payment closed before the rest arrived",
  late: "after the payment had closed",
  extra: "after the payment was already paid in full",
  wrong_coin: "in a coin or on a network the payment wasn't asking for",
  unmatched: "without anything to tell us which payment it was for",
  invoice_paid: "after the invoice had already been paid another way",
};
export const whyWords = (why: string | null) => WHY_WORDS[why ?? ""] ?? "when it wasn't needed";

/** Every arrival with something to give back and nothing decided yet - or just this payment's. */
export async function decideReturns(paymentId?: string): Promise<void> {
  const due = await prisma.cryptoArrival.findMany({ where: { returnMicros: { not: null }, returnStatus: null, ...(paymentId ? { paymentId } : {}) }, include: { payment: true }, take: 20 });
  for (const x of due) await decide(x).catch((e) => log.warn("[crypto-out] couldn't decide a return", { id: x.id, reason: reason(e) }));
}

async function decide(x: CryptoArrival & { payment: Payment | null }): Promise<void> {
  const micros = x.returnMicros!;
  const from = sendsFrom(x, x.payment);
  let next: { returnStatus: string; returnTo?: string | null; returnBy?: string; returnToken?: string; returnAskedAt?: Date; returnError?: string };
  if (micros < DUST) next = { returnStatus: "KEPT", returnBy: "system", returnError: "Too small to be worth a network fee." };
  else if (from && x.fromAddress && !MEMO_NETWORKS.includes(x.network as Network) && (await looksPersonal(x.network, x.fromAddress))) next = { returnStatus: "QUEUED", returnTo: x.fromAddress, returnBy: "system" };
  else if (x.payment?.customerEmail) next = { returnStatus: "ASK", returnToken: crypto.randomBytes(18).toString("base64url"), returnAskedAt: new Date() };
  else next = { returnStatus: "MANUAL" };
  const claimed = await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: null }, data: next });
  if (!claimed.count) return;
  log.info("[crypto-out] return decided", { id: x.id, network: x.network, coin: x.coin, amount: Number(micros) / 1e6, why: x.returnWhy, status: next.returnStatus });
  if (next.returnStatus === "ASK" && x.payment?.customerEmail) await askCustomer({ ...x, ...next } as CryptoArrival, x.payment).catch((e) => log.warn("[crypto-out] couldn't email the customer", { id: x.id, reason: reason(e) }));
}

async function askCustomer(x: CryptoArrival, p: Payment): Promise<void> {
  const business = await prisma.business.findUnique({ where: { id: p.businessId }, select: { name: true } });
  const amount = amountText(x.returnMicros!, x.coin);
  const link = checkoutLink(`x/${x.returnToken}`);
  const what = whyWords(x.returnWhy);
  await sendEmail(p.customerEmail!, `${amount} to send back to you`, `We received ${amount} on ${x.network} for your payment to ${business?.name ?? "a business"} (${p.ref}), ${what}.\n\nTell us where to send it back: ${link}\n\nIf you sent it from your own wallet, one tap sends it back there. If you sent it from an exchange, give us your own deposit address instead.`, {
    html: shell({
      label: "Money to send back",
      preheader: `Tell us where to send back ${amount}.`,
      body: `${hero({ eyebrow: "We have money to send back to you", figure: esc(amount), sub: `On ${esc(x.network)}` })}
        ${para(`It arrived for your payment to ${esc(business?.name ?? "a business")}, ${esc(what)}. Tell us where it should go and it goes straight back.`)}
        ${rows([
          { k: "Payment", v: p.ref, mono: true },
          { k: "Amount", v: amount, strong: true },
        ])}
        ${button("Tell us where to send it", link)}
        ${fine(`Sent it from an exchange? Give us your own deposit address for ${esc(x.coin)} on ${esc(x.network)}: sending to the address it came from may not reach you. ${supportLine()}`)}`,
    }),
  });
}

/** The customer has said where: it goes back by itself where we can send it, or to our team with the address. */
export async function chooseReturn(token: string, address: string, memo: string | null, by: string): Promise<CryptoArrival> {
  const x = await prisma.cryptoArrival.findUnique({ where: { returnToken: token }, include: { payment: true } });
  if (!x || x.returnStatus !== "ASK") throw new Error("not_waiting");
  const next = sendsFrom(x, x.payment) ? "QUEUED" : "MANUAL";
  await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: "ASK" }, data: { returnStatus: next, returnTo: address.trim(), returnMemo: memo?.trim() || null, returnBy: by } });
  return prisma.cryptoArrival.findUniqueOrThrow({ where: { id: x.id } });
}

// ─── Sending ──────────────────────────────────────────────────────────────

const evmProvider = (c: EvmChain) => new ethers.JsonRpcProvider(c.url()!, c.chainId, { staticNetwork: true });
const sponsorKey = () => env.EVM_GAS_SPONSOR_PRIVATE_KEY ?? env.FLOAT_EVM_PRIVATE_KEY;
const solFeePayer = () => {
  const k = env.SOLANA_GASLESS_PRIVATE_KEY ?? env.FLOAT_SOLANA_PRIVATE_KEY;
  if (!k) throw new NotSent("No Solana fee payer is set.");
  return Keypair.fromSecretKey(bs58.decode(k));
};
const moveFloat = () => {
  if (!env.FLOAT_MOVEMENT_PRIVATE_KEY) throw new NotSent("FLOAT_MOVEMENT_PRIVATE_KEY isn't set.");
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(env.FLOAT_MOVEMENT_PRIVATE_KEY) });
};
const aptos = () => new Aptos(new AptosConfig({ network: AptosNetwork.CUSTOM, fullnode: env.MOVEMENT_RPC_URL! }));

/** The token an arrival came as: its contract, mint or asset - or the coin's usual one. */
function tokenFor(network: string, coin: Coin, token: string | null): string | null {
  if (token && token !== "native") return token;
  const c = evmChain(network);
  if (c) return c.native && token === "native" ? "native" : (c.tokens[coin]?.address ?? null);
  if (network === "Solana") return SOL_MINTS[coin] ?? null;
  if (network === "Movement") return MOVE_ASSETS[coin] ?? null;
  return null;
}

/**
 * Sends `micros` of a coin from a payment's own address to `to` - no more than
 * the address holds right now. Returns once it's broadcast; `confirmed`
 * settles when the chain has it.
 */
async function sendFromOwn(p: Payment, network: string, coin: Coin, token: string | null, to: string, micros: bigint): Promise<Sent & { sentMicros: bigint }> {
  const c = evmChain(network);
  if (c) return sendEvmOwn(c, p, coin, token, to, micros);
  if (network === "Solana") return sendSolanaOwn(p, coin, token, to, micros);
  if (network === "Movement") return sendMovementOwn(p, coin, token, to, micros);
  throw new NotSent(`Sending from ${network} isn't built.`);
}

async function sendEvmOwn(c: EvmChain, p: Payment, coin: Coin, token: string | null, to: string, micros: bigint): Promise<Sent & { sentMicros: bigint }> {
  if (!c.url()) throw new NotSent(`${c.network} can't be reached: no RPC set.`);
  if (!ethers.isAddress(to)) throw new NotSent(`That isn't an address on ${c.network}.`);
  const provider = evmProvider(c);
  const wallet = evmDepositWallet(p.id).connect(provider);
  const fees = await provider.getFeeData();
  const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
  if (!maxFeePerGas) throw new NotSent(`${c.network} didn't say what gas costs.`, true);
  const priority = fees.maxPriorityFeePerGas ?? 0n;
  const gasFields = fees.maxFeePerGas ? { maxFeePerGas, maxPriorityFeePerGas: priority < maxFeePerGas ? priority : maxFeePerGas } : { gasPrice: maxFeePerGas };

  // Arc: USDC is the chain's own coin - a value send that pays its own fee out of what it moves.
  if (c.native) {
    const balance = await provider.getBalance(wallet.address);
    const gasLimit = ((await provider.estimateGas({ from: wallet.address, to, value: 1n }).catch(() => 21_000n)) * 13n) / 10n;
    const fee = gasLimit * maxFeePerGas;
    const want = fromMicros(micros, c.native.decimals);
    const value = (want < balance ? want : balance) - fee;
    if (value <= 0n) throw new NotSent("Nothing left to send once the network fee is paid.");
    const tx = await wallet.sendTransaction({ to, value, gasLimit, ...gasFields });
    return { txHash: tx.hash, sentMicros: toMicros(value, c.native.decimals), confirmed: landed(tx) };
  }

  const contract = contractsOf(c).find((t) => t.address.toLowerCase() === (tokenFor(c.network, coin, token) ?? "").toLowerCase()) ?? contractsOf(c).find((t) => t.coin === coin);
  if (!contract) throw new NotSent(`${coin} isn't on ${c.network}.`);
  const held = BigInt(await provider.call({ to: contract.address, data: ERC20.encodeFunctionData("balanceOf", [wallet.address]) }));
  const want = fromMicros(micros, contract.decimals);
  const amount = want < held ? want : held;
  if (amount <= 0n) throw new NotSent("The address holds nothing to send.");
  const data = ERC20.encodeFunctionData("transfer", [ethers.getAddress(to), amount]);
  const gasLimit = ((await provider.estimateGas({ from: wallet.address, to: contract.address, data }).catch(() => 90_000n)) * 13n) / 10n;
  const cost = gasLimit * maxFeePerGas;
  const have = await provider.getBalance(wallet.address);
  if (have < cost) {
    // Just enough gas from the sponsor, landed before the send.
    const key = sponsorKey();
    if (!key) throw new NotSent("No gas sponsor is set for the EVM chains.");
    const sponsor = new ethers.Wallet(key, provider);
    const top = cost - have + cost / 5n;
    if ((await provider.getBalance(sponsor.address)) < top) throw new NotSent(`The gas sponsor is low on ${c.gas} on ${c.network}.`, true);
    const gasTx = await sponsor.sendTransaction({ to: wallet.address, value: top });
    const landed = await gasTx.wait(1, 90_000).catch(() => null);
    if (!landed || landed.status !== 1) throw new NotSent(`The gas for ${c.network} didn't land in time.`, true);
  }
  const tx = await wallet.sendTransaction({ to: contract.address, data, gasLimit, ...gasFields });
  return { txHash: tx.hash, sentMicros: toMicros(amount, contract.decimals), confirmed: landed(tx) };
}

/** Resolves once a transaction is mined and succeeded; rejects if it failed or didn't come in time. */
const landed = (tx: ethers.TransactionResponse) =>
  tx.wait(1, 120_000).then((r) => {
    if (!r || r.status !== 1) throw new Error("failed on chain");
  });

async function solStatus(conn: Connection, sig: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true });
  const s = value?.[0];
  if (!s) return "unknown";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "settled" : "pending";
}

async function sendSolanaOwn(p: Payment, coin: Coin, token: string | null, to: string, micros: bigint): Promise<Sent & { sentMicros: bigint }> {
  if (!env.SOLANA_RPC_URL) throw new NotSent("Solana can't be reached: no RPC set.");
  const conn = new Connection(env.SOLANA_RPC_URL, { commitment: "confirmed" });
  const owner = solanaDepositKeypair(p.id);
  const payer = solFeePayer();
  const mintId = tokenFor("Solana", coin, token);
  if (!mintId) throw new NotSent(`${coin} isn't on Solana.`);
  let recipient: PublicKey;
  try {
    recipient = new PublicKey(to);
  } catch {
    throw new NotSent("That isn't a Solana address.");
  }
  const mint = new PublicKey(mintId);
  const fromAta = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, recipient, true);
  const bal = await conn.getTokenAccountBalance(fromAta).catch(() => null);
  const held = BigInt(bal?.value.amount ?? "0");
  const amount = micros < held ? micros : held;
  if (amount <= 0n) throw new NotSent("The address holds nothing to send.");
  const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, toAta, recipient, mint), createTransferInstruction(fromAta, toAta, owner.publicKey, amount));
  // Emptied: the token account closes, and its rent goes to the fee payer.
  if (amount === held) tx.add(createCloseAccountInstruction(fromAta, payer.publicKey, owner.publicKey));
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, owner);
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (e) {
    throw new NotSent(`Solana refused it: ${reason(e).slice(0, 160)}`, /insufficient|0x1\b/i.test(reason(e)));
  }
  return {
    txHash: sig,
    sentMicros: amount,
    confirmed: (async () => {
      for (let i = 0; i < 45; i++) {
        const s = await solStatus(conn, sig);
        if (s === "settled") return;
        if (s === "failed") throw new Error("failed on chain");
        await new Promise((r) => setTimeout(r, 2000));
      }
      throw new Error("not confirmed in time");
    })(),
  };
}

async function sendMovementOwn(p: Payment, coin: Coin, token: string | null, to: string, micros: bigint): Promise<Sent & { sentMicros: bigint }> {
  if (!env.MOVEMENT_RPC_URL) throw new NotSent("Movement can't be reached: no RPC set.");
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(to)) throw new NotSent("That isn't a Movement address.");
  const client = aptos();
  const sender = movementDepositAccount(p.id);
  const float = moveFloat();
  const asset = tokenFor("Movement", coin, token);
  if (!asset) throw new NotSent(`${coin} isn't on Movement.`);
  const [raw] = await client.view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [sender.accountAddress.toString(), asset] } });
  const held = BigInt(String(raw ?? "0"));
  const amount = micros < held ? micros : held;
  if (amount <= 0n) throw new NotSent("The address holds nothing to send.");
  let transaction;
  try {
    // The float pays the fee; an address that has never sent starts at sequence 0.
    transaction = await client.transaction.build.simple({
      sender: sender.accountAddress,
      withFeePayer: true,
      data: { function: "0x1::primary_fungible_store::transfer", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [asset, to, amount] },
    });
  } catch (e) {
    throw new NotSent(`Couldn't build the Movement transfer: ${reason(e).slice(0, 160)}`, true);
  }
  // Both sign the same thing: the fee payer named before the sender signs.
  transaction.feePayerAddress = float.accountAddress;
  const senderAuthenticator = client.transaction.sign({ signer: sender, transaction });
  const feePayerAuthenticator = client.transaction.signAsFeePayer({ signer: float, transaction });
  let hash: string;
  try {
    hash = (await client.transaction.submit.simple({ transaction, senderAuthenticator, feePayerAuthenticator })).hash;
  } catch (e) {
    throw new NotSent(`Movement refused it: ${reason(e).slice(0, 160)}`, true);
  }
  return {
    txHash: hash,
    sentMicros: amount,
    confirmed: client.waitForTransaction({ transactionHash: hash }).then((r) => {
      if (!(r as { success?: boolean }).success) throw new Error(`failed on chain: ${(r as { vm_status?: string }).vm_status ?? ""}`);
    }),
  };
}

/** What the chain says about a send from a payment's own address, by its hash. */
async function ownTxStatus(network: string, hash: string): Promise<"settled" | "failed" | "pending" | "unknown"> {
  const c = evmChain(network);
  if (c) {
    const provider = evmProvider(c);
    const r = await provider.getTransactionReceipt(hash);
    if (!r) return (await provider.getTransaction(hash)) ? "pending" : "unknown";
    return r.status === 1 ? "settled" : "failed";
  }
  if (network === "Solana") return solStatus(new Connection(env.SOLANA_RPC_URL!, { commitment: "confirmed" }), hash);
  if (network === "Movement") {
    try {
      const t = (await aptos().getTransactionByHash({ transactionHash: hash })) as { type?: string; success?: boolean };
      return t.type === "pending_transaction" ? "pending" : t.success ? "settled" : "failed";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

// ─── Returns ──────────────────────────────────────────────────────────────

async function sendReturn(x: CryptoArrival & { payment: Payment | null }): Promise<void> {
  const from = sendsFrom(x, x.payment);
  if (!from || !x.returnTo) {
    await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: "QUEUED" }, data: { returnStatus: "MANUAL" } });
    return;
  }
  if (!validReturnAddress(x.network, x.returnTo)) {
    await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: "QUEUED" }, data: { returnStatus: "FAILED", returnError: `That isn't an address on ${x.network}.` } });
    return;
  }
  const claimed = await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: "QUEUED" }, data: { returnStatus: "SENDING", returnError: null } });
  if (!claimed.count) return;
  let sent: Sent;
  try {
    if (from === "own") sent = await sendFromOwn(x.payment!, x.network, x.coin as Coin, x.token, x.returnTo, x.returnMicros!);
    else if (x.network === "Stellar") {
      try {
        sent = { ...(await stellarSend(x.coin as StellarCoin, x.returnTo, x.returnMicros!, x.returnMemo)), confirmed: Promise.resolve() };
      } catch (e) {
        if (e instanceof StellarNotSent) throw new NotSent(e.message, e.retry);
        throw e;
      }
    } else sent = await floatSend(FLOAT_CHAIN[x.network]!, x.returnTo, x.returnMicros!);
  } catch (e) {
    if (e instanceof NotSent) {
      await prisma.cryptoArrival.update({ where: { id: x.id }, data: e.retry ? { returnStatus: "QUEUED", returnError: e.message } : { returnStatus: "FAILED", returnError: e.message } });
      log.warn("[crypto-out] return not sent", { id: x.id, network: x.network, reason: e.message, again: e.retry });
      return;
    }
    // It may have gone without our hearing back: nothing resends. Its hash, when we have it, lets the follow-up ask the chain.
    const hash = (e as { txHash?: string }).txHash;
    await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: "CONFIRMING", returnError: `Outcome unclear: ${reason(e).slice(0, 200)}`, ...(hash ? { returnTx: hash } : {}) } });
    log.warn("[crypto-out] return outcome unclear", { id: x.id, reason: reason(e) });
    return;
  }
  await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: "CONFIRMING", returnTx: sent.txHash } });
  try {
    await sent.confirmed;
    await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: "RETURNED", returnSentAt: new Date(), returnError: null } });
    log.info("[crypto-out] returned", { id: x.id, network: x.network, tx: sent.txHash });
    if (x.payment?.customerEmail) void tellReturned({ ...x, returnTx: sent.txHash }, x.payment).catch(() => {});
  } catch (e) {
    log.warn("[crypto-out] return confirmation unclear, the follow-up asks the chain", { id: x.id, reason: reason(e) });
  }
}

async function tellReturned(x: CryptoArrival, p: Payment): Promise<void> {
  const amount = amountText(x.returnMicros!, x.coin);
  await sendEmail(p.customerEmail!, `${amount} sent back to you`, `We've sent ${amount} back to ${x.returnTo} on ${x.network}.\n\nPayment: ${p.ref}\nTransaction: ${x.returnTx}`, {
    html: shell({
      label: "Sent back",
      preheader: `${amount} is on its way back to you.`,
      body: `${hero({ eyebrow: "Sent back to you", figure: esc(amount), sub: `On ${esc(x.network)}` })}
        ${rows([
          { k: "To", v: x.returnTo ?? "", mono: true },
          { k: "Payment", v: p.ref, mono: true },
          { k: "Transaction", v: `${(x.returnTx ?? "").slice(0, 10)}…${(x.returnTx ?? "").slice(-6)}`, mono: true },
        ])}
        ${fine(supportLine())}`,
    }),
  });
}

/** Returns sent but not yet heard back about: the chain is asked by hash. */
async function followReturns(): Promise<void> {
  const waiting = await prisma.cryptoArrival.findMany({ where: { returnStatus: "CONFIRMING", returnTx: { not: null }, updatedAt: { lt: new Date(Date.now() - 60_000) } }, include: { payment: true }, take: 10 });
  for (const x of waiting) {
    const from = sendsFrom(x, x.payment);
    const st = from === "own" ? await ownTxStatus(x.network, x.returnTx!) : x.network === "Stellar" ? await stellarTxStatus(x.returnTx!) : FLOAT_CHAIN[x.network] ? await floatTxStatus(FLOAT_CHAIN[x.network]!, x.returnTx!) : "unknown";
    if (st === "settled") await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: "RETURNED", returnSentAt: new Date(), returnError: null } });
    else if (st === "failed") await prisma.cryptoArrival.update({ where: { id: x.id }, data: { returnStatus: "FAILED", returnError: "The transaction failed on chain, so nothing was sent." } });
    else await prisma.cryptoArrival.update({ where: { id: x.id }, data: { updatedAt: new Date() } });
  }
}

// ─── Sweeps ───────────────────────────────────────────────────────────────

/** Paid payments' own addresses: what paid for them, into the treasury. One address at a time. */
async function sweep(): Promise<void> {
  const due = await prisma.cryptoArrival.findMany({
    where: { kind: "PAYMENT", usedMicros: { gt: 0n }, sweptAt: null, sweepTx: null, OR: [{ sweepingAt: null }, { sweepingAt: { lt: new Date(Date.now() - 15 * 60_000) } }], payment: { status: "PAID", depositKind: "OWN" } },
    include: { payment: true },
    orderBy: { createdAt: "asc" },
    take: 30,
  });
  const groups = new Map<string, typeof due>();
  for (const x of due) {
    const k = `${x.paymentId}|${x.network}|${x.token ?? x.coin}`;
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  for (const list of [...groups.values()].slice(0, 5)) {
    const first = list[0]!;
    const p = first.payment!;
    const to = treasuryFor(first.network);
    if (!to) continue;
    const ids = list.map((x) => x.id);
    const claimed = await prisma.cryptoArrival.updateMany({ where: { id: { in: ids }, sweptAt: null, sweepTx: null, OR: [{ sweepingAt: null }, { sweepingAt: { lt: new Date(Date.now() - 15 * 60_000) } }] }, data: { sweepingAt: new Date() } });
    if (claimed.count !== ids.length) continue;
    const micros = list.reduce((s, x) => s + x.usedMicros, 0n);
    let sent: Sent & { sentMicros: bigint };
    try {
      sent = await sendFromOwn(p, first.network, first.coin as Coin, first.token, to, micros);
    } catch (e) {
      await prisma.cryptoArrival.updateMany({ where: { id: { in: ids } }, data: { sweepingAt: e instanceof NotSent && e.retry ? new Date(Date.now() - 14 * 60_000) : null } });
      log.warn("[crypto-out] sweep not sent", { ref: p.ref, network: first.network, reason: reason(e) });
      continue;
    }
    await prisma.cryptoArrival.updateMany({ where: { id: { in: ids } }, data: { sweepTx: sent.txHash } });
    try {
      await sent.confirmed;
      await prisma.cryptoArrival.updateMany({ where: { id: { in: ids } }, data: { sweptAt: new Date() } });
      log.info("[crypto-out] swept", { ref: p.ref, network: first.network, amount: Number(sent.sentMicros) / 1e6, tx: sent.txHash });
    } catch (e) {
      log.warn("[crypto-out] sweep confirmation unclear, the follow-up asks the chain", { ref: p.ref, reason: reason(e) });
    }
  }
}

/** Sweeps sent but not yet heard back about. A failed one is let go, to be swept again. */
async function followSweeps(): Promise<void> {
  const waiting = await prisma.cryptoArrival.findMany({ where: { sweepTx: { not: null }, sweptAt: null, sweepingAt: { lt: new Date(Date.now() - 2 * 60_000) } }, take: 10 });
  const seen = new Set<string>();
  for (const x of waiting) {
    if (seen.has(x.sweepTx!)) continue;
    seen.add(x.sweepTx!);
    const st = await ownTxStatus(x.network, x.sweepTx!);
    if (st === "settled") await prisma.cryptoArrival.updateMany({ where: { sweepTx: x.sweepTx }, data: { sweptAt: new Date() } });
    else if (st === "failed" || (st === "unknown" && x.sweepingAt && x.sweepingAt < new Date(Date.now() - 30 * 60_000))) {
      await prisma.cryptoArrival.updateMany({ where: { sweepTx: x.sweepTx }, data: { sweepTx: null, sweepingAt: null } });
      log.warn("[crypto-out] a sweep didn't land, it goes again", { network: x.network, tx: x.sweepTx });
    } else await prisma.cryptoArrival.updateMany({ where: { sweepTx: x.sweepTx }, data: { sweepingAt: new Date() } });
  }
}

/** The worker's round: decide, give back, sweep - and follow what's already out. */
export async function moveCryptoOut(): Promise<void> {
  await decideReturns();
  const queued = await prisma.cryptoArrival.findMany({
    where: { returnStatus: "QUEUED", OR: [{ returnError: null }, { updatedAt: { lt: new Date(Date.now() - 60_000) } }] },
    include: { payment: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  for (const x of queued) await sendReturn(x).catch((e) => log.warn("[crypto-out] return failed", { id: x.id, reason: reason(e) }));
  await followReturns();
  await sweep();
  await followSweeps();
}

/** The gas sponsor's balance on each EVM chain, and what's waiting to be swept - for the admin console. */
export async function sweepState() {
  const key = sponsorKey();
  const sponsor = key ? new ethers.Wallet(key).address : null;
  const gas = await Promise.all(
    EVM_CHAINS.filter((c) => c.url() && !c.native && c.network !== "Ethereum").map(async (c) => {
      try {
        return { network: c.network, coin: c.gas, balance: sponsor ? Number(ethers.formatEther(await evmProvider(c).getBalance(sponsor))) : null };
      } catch {
        return { network: c.network, coin: c.gas, balance: null };
      }
    }),
  );
  const waiting = await prisma.cryptoArrival.groupBy({ by: ["network"], where: { kind: "PAYMENT", usedMicros: { gt: 0n }, sweptAt: null, payment: { status: "PAID", depositKind: "OWN" } }, _sum: { usedMicros: true }, _count: true });
  return { sponsor, gas, waiting: waiting.map((w) => ({ network: w.network, count: w._count, amount: Number(w._sum.usedMicros ?? 0n) / 1e6 })) };
}

// ─── Solana token accounts ────────────────────────────────────────────────

/**
 * A Solana payment's USDC or USDT account, opened by our fee payer when the
 * payment starts - so the customer's wallet doesn't pay the ~0.002 SOL to open
 * it (and doesn't fail for want of it). The SOL isn't spent: it comes back to
 * the fee payer when the account is emptied and closed, at the sweep, or
 * below when the payment lapses with nothing in it.
 */
export async function openSolanaAccount(owner: string, coin: Coin): Promise<void> {
  if (!env.SOLANA_RPC_URL || !SOL_MINTS[coin]) return;
  const conn = new Connection(env.SOLANA_RPC_URL, { commitment: "confirmed" });
  const payer = solFeePayer();
  const mint = new PublicKey(SOL_MINTS[coin]!);
  const ownerKey = new PublicKey(owner);
  const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, getAssociatedTokenAddressSync(mint, ownerKey), ownerKey, mint));
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
}

/** A lapsed Solana payment's empty token account, closed: its SOL back to the fee payer. */
export async function closeEmptySolana(p: Payment): Promise<void> {
  if (!env.SOLANA_RPC_URL || !p.coin || !SOL_MINTS[p.coin as Coin]) return;
  const conn = new Connection(env.SOLANA_RPC_URL, { commitment: "confirmed" });
  const owner = solanaDepositKeypair(p.id);
  const mint = new PublicKey(SOL_MINTS[p.coin as Coin]!);
  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  // Not there (never opened, or closed already), or not empty: nothing to do.
  if (!bal || bal.value.amount !== "0") return;
  const payer = solFeePayer();
  const tx = new Transaction().add(createCloseAccountInstruction(ata, payer.publicKey, owner.publicKey));
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, owner);
  await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  log.info("[crypto-out] closed a lapsed payment's empty Solana account", { ref: p.ref });
}
