/**
 * A checkout paid with another coin, through NEAR Intents (lib/intents).
 *
 * The payment is opened exactly as a live USDC payment with an address of its
 * own, on the network the swap lands on. Then 1Click is asked for an exact
 * output quote to that address, and the customer is shown 1Click's address on
 * their own chain instead. From the moment the USDC lands, nothing here is
 * special: the usual scan sees it, weighs it, confirms the payment, sweeps it
 * and settles it to the business the way it chose.
 *
 * What this adds is the swap's own progress for the checkout page (deposit
 * seen, swapping, done, refunded), and more time while a swap is under way, so
 * a customer who paid on time never watches their payment close mid-swap.
 */
import { Prisma, type Payment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { SOL_MINTS, addressKey, contractsOf, evmChain, hexNum, rpc, toHex } from "../lib/chains";
import { ethers } from "ethers";
import { env } from "../config/env";
import { depositAddressFor } from "../lib/deposit-keys";
import { effectiveChain } from "../lib/platform";
import { IntentQuoteError, intentCoin, stableIntentCoin, intentPrice, intentStatus, intentsOffered, landingFor, quoteIntent, submitIntentDeposit, testLandingFor, type IntentStatus } from "../lib/intents";
import type { Coin, Network } from "../lib/accept";
import { admit, newPayment, testAddress, type Checkout, type OpenInput } from "./payments";
import { openSolanaAccount } from "./crypto-out";

/** How long the address is held: half an hour, an hour for coins that confirm slowly. */
const WINDOW_MS = 30 * 60_000;
const SLOW_WINDOW_MS = 60 * 60_000;
/** Once the customer's deposit is seen, the payment stays open at least this much longer, for the swap. */
const SWAP_MS = 30 * 60_000;

export type Intent = {
  coin: string;
  symbol: string;
  name: string;
  chain: string;
  /** Where the customer sends, on their own chain, and the memo when the chain needs one (XRP). */
  address: string;
  memo: string | null;
  /** What to send, in the coin's own units, and the least that still completes. */
  amount: string;
  minAmount: string | null;
  amountUsd: string | null;
  deadline: string;
  timeEstimate: number | null;
  correlationId: string | null;
  status: IntentStatus;
  originTx: string | null;
  destinationTx: string | null;
  /** The customer's transaction, found on their chain and handed to 1Click so it starts at once. */
  submittedTx?: string | null;
  /** What arrived at the 1Click address, in the coin's own units, as we or 1Click read it. */
  depositedAmount?: string | null;
  /**
   * When the customer's part was done: enough arrived at the 1Click address. From then the checkout shows them
   * paid; the payment itself, the business's notice and its payout still wait for the money to reach us.
   */
  paidSeenAt?: string | null;
  /** A USDC or USDT payment routed through NEAR Intents by the Services switch, not a coin the customer picked. */
  stable?: boolean;
  /** Test mode: made up, nothing to send. */
  test?: boolean;
};

export const intentOf = (p: Pick<Payment, "intent">): Intent | null => (p.intent && typeof p.intent === "object" ? (p.intent as unknown as Intent) : null);

const formatUnits = (raw: string, decimals: number) => {
  const s = raw.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
};

/** A payment in another coin: a USDC payment on our side, and the swap that pays it. */
export async function openIntentPayment(c: Checkout, input: OpenInput, key: string): Promise<Payment> {
  const price = await admit(c, "CRYPTO", input);
  const coin = intentCoin(key);
  const chain = effectiveChain(c.business.settleChain, price.p);
  if (!coin || !intentsOffered(price.p, c.mode, chain).some((o) => o.key === key)) {
    throw new HttpError(400, "That coin isn't taken here. Pick another, or pay with a stablecoin.", "bad_coin");
  }
  const landing = c.mode === "LIVE" ? landingFor(chain) : testLandingFor(chain);
  if (!landing) throw new HttpError(503, "Paying with other coins isn't available right now. Pay with a stablecoin instead.", "intents_off");

  const window = coin.slow ? SLOW_WINDOW_MS : WINDOW_MS;
  const deadline = new Date(Date.now() + window);
  const micros = BigInt(price.amountCents) * 10_000n;
  const payment = await newPayment(c, input, "CRYPTO", price, { coin: "USDC", network: landing, depositKind: c.mode === "LIVE" ? "OWN" : null, expiresAt: deadline });

  // Test mode: nothing is quoted or sent. The amount is worked out from the coin's price, and the address is made up.
  if (c.mode === "TEST") {
    const usd = await intentPrice(coin.assetId);
    const amount = usd ? (price.amountCents / 100 / usd).toPrecision(6).replace(/\.?0+$/, "") : "0";
    const intent: Intent = { coin: coin.key, symbol: coin.symbol, name: coin.name, chain: coin.chain, address: testAddress(coin.chain, `intent:${payment.token}`), memo: null, amount, minAmount: null, amountUsd: (price.amountCents / 100).toFixed(2), deadline: deadline.toISOString(), timeEstimate: null, correlationId: null, status: "PENDING_DEPOSIT", originTx: null, destinationTx: null, test: true };
    return prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: testAddress(landing, payment.token), cryptoMicros: micros, intent: intent as unknown as Prisma.InputJsonValue } });
  }

  const own = addressKey(landing, depositAddressFor(landing, payment.id));
  try {
    const q = await quoteIntent({ coin, landing, recipient: own, micros, deadline, feeBps: price.p.intents.feeBps });
    const intent: Intent = {
      coin: coin.key,
      symbol: coin.symbol,
      name: coin.name,
      chain: coin.chain,
      address: q.depositAddress,
      memo: q.depositMemo,
      amount: q.amountInFormatted || formatUnits(q.amountIn, coin.decimals),
      minAmount: q.minAmountIn ? formatUnits(q.minAmountIn, coin.decimals) : null,
      amountUsd: q.amountInUsd,
      deadline: q.deadline,
      timeEstimate: q.timeEstimate,
      correlationId: q.correlationId,
      status: "PENDING_DEPOSIT",
      originTx: null,
      destinationTx: null,
    };
    const opened = await prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: own, cryptoMicros: micros, receivedMicros: 0n, intent: intent as unknown as Prisma.InputJsonValue } });
    // Solana: the USDC account opened by us, so the swap's delivery doesn't wait on opening it.
    if (landing === "Solana") void openSolanaAccount(own, "USDC").catch((e) => log.warn("[intents] couldn't open the Solana account ahead", { ref: opened.ref, reason: e instanceof Error ? e.message : String(e) }));
    log.info("[intents] payment opened", { ref: opened.ref, coin: coin.key, landing, amount: intent.amount, usd: price.amountCents / 100 });
    return opened;
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    if (e instanceof IntentQuoteError && e.leastUsd) throw new HttpError(400, `Paying with ${coin.symbol} starts from $${e.leastUsd.toFixed(2)}. Pick another coin, or pay with a stablecoin.`, "intent_too_small");
    log.warn("[intents] couldn't open a payment", { ref: payment.ref, coin: coin.key, reason: e instanceof Error ? e.message : String(e) });
    throw new HttpError(502, `We couldn't get a price in ${coin.symbol} just now. Try again, or pay with a stablecoin.`, "intent_quote_failed");
  }
}

/**
 * A USDC or USDT payment sent through NEAR Intents instead of straight to us,
 * while Services has that switched on. Already admitted and checked by the
 * stablecoin path that calls this. Null whenever Intents can't take it (that
 * network isn't listed, nowhere to land, a minimum, no liquidity, no answer):
 * the payment then opens the default way, and the customer never knows.
 */
export async function openStableViaIntents(c: Checkout, input: OpenInput, price: Awaited<ReturnType<typeof admit>>, coin: "USDC" | "USDT", network: Network): Promise<Payment | null> {
  if (c.mode !== "LIVE" || !price.p.intents.stablecoins) return null;
  const via = stableIntentCoin(coin, network);
  const landing = landingFor(effectiveChain(c.business.settleChain, price.p));
  if (!via || !landing) return null;
  const deadline = new Date(Date.now() + WINDOW_MS);
  const micros = BigInt(price.amountCents) * 10_000n;
  const payment = await newPayment(c, input, "CRYPTO", price, { coin: "USDC", network: landing, depositKind: "OWN", expiresAt: deadline });
  const own = addressKey(landing, depositAddressFor(landing, payment.id));
  try {
    const q = await quoteIntent({ coin: via, landing, recipient: own, micros, deadline, feeBps: 0 });
    const intent: Intent = {
      coin: via.key,
      symbol: via.symbol,
      name: via.name,
      chain: via.chain,
      address: q.depositAddress,
      memo: q.depositMemo,
      amount: q.amountInFormatted || formatUnits(q.amountIn, via.decimals),
      minAmount: q.minAmountIn ? formatUnits(q.minAmountIn, via.decimals) : null,
      amountUsd: q.amountInUsd,
      deadline: q.deadline,
      timeEstimate: q.timeEstimate,
      correlationId: q.correlationId,
      status: "PENDING_DEPOSIT",
      originTx: null,
      destinationTx: null,
      stable: true,
    };
    const opened = await prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: own, cryptoMicros: micros, receivedMicros: 0n, intent: intent as unknown as Prisma.InputJsonValue } });
    if (landing === "Solana") void openSolanaAccount(own, "USDC").catch((e) => log.warn("[intents] couldn't open the Solana account ahead", { ref: opened.ref, reason: e instanceof Error ? e.message : String(e) }));
    log.info("[intents] stablecoin payment opened through NEAR Intents", { ref: opened.ref, coin, network, landing, amount: intent.amount, usd: price.amountCents / 100 });
    return opened;
  } catch (e) {
    // Never shown to anyone: just made, nothing points at it, and the default way takes over.
    await prisma.payment.delete({ where: { id: payment.id } }).catch(() => prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } }).catch(() => {}));
    log.info("[intents] stablecoin payment goes the default way", { coin, network, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    return null;
  }
}

const looked = new Map<string, number>();

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** How far back an EVM look reaches: about five minutes of blocks, never more than 1,000 (what RPCs allow in one ask). */
const blocksBack = (blockSeconds: number) => Math.min(1_000, Math.ceil(300 / blockSeconds));

/**
 * The customer's transfer to the 1Click address, found on their own chain.
 * 1Click's own watcher can take a minute or more to notice a deposit; handed
 * the transaction, it starts at once. Solana (any coin, by the address's
 * signatures) and the EVM chains we read (USDC and USDT, by their Transfer
 * logs). Elsewhere, and for native ETH, 1Click finds it by itself.
 */
async function findOriginTx(i: Intent): Promise<{ tx: string; amount: string | null } | null> {
  if (i.chain === "Solana") {
    const url = env.SOLANA_RPC_URL;
    if (!url) return null;
    const sigs = await rpc<{ signature: string; err: unknown }[]>(url, "getSignaturesForAddress", [i.address, { limit: 10 }]);
    // Newest first: the oldest one that succeeded is the customer's deposit; anything after is 1Click moving it on.
    const ok = sigs.filter((s) => !s.err);
    const tx = ok.length ? ok[ok.length - 1]!.signature : null;
    if (!tx) return null;
    return { tx, amount: await solanaDeposited(url, tx, i).catch(() => null) };
  }
  const c = evmChain(i.chain);
  const url = c?.url();
  const tokens = c ? contractsOf(c).filter((t) => t.coin === i.symbol) : [];
  if (!c || !url || !tokens.length) return null;
  const tip = hexNum(await rpc<string>(url, "eth_blockNumber", []));
  const to = `0x${i.address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const logs = await rpc<{ transactionHash: string; address: string; data: string }[]>(url, "eth_getLogs", [{ address: tokens.map((t) => t.address), topics: [TRANSFER_TOPIC, null, to], fromBlock: toHex(Math.max(0, tip - blocksBack(c.blockSeconds))), toBlock: toHex(tip) }]);
  const l = logs[0];
  if (!l) return null;
  const decimals = tokens.find((t) => t.address.toLowerCase() === l.address.toLowerCase())?.decimals ?? 6;
  return { tx: l.transactionHash, amount: ethers.formatUnits(BigInt(l.data), decimals) };
}

/** How much the customer's Solana transaction put at the 1Click address: its USDC or USDT, or SOL itself. */
async function solanaDeposited(url: string, sig: string, i: Intent): Promise<string | null> {
  const t = await rpc<any>(url, "getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  const meta = t?.meta;
  if (!meta || meta.err) return null;
  const mint = SOL_MINTS[i.symbol as Coin];
  if (mint) {
    const mine = (b: any) => b.owner === i.address && b.mint === mint;
    const post = (meta.postTokenBalances ?? []).filter(mine).reduce((s: bigint, b: any) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const pre = (meta.preTokenBalances ?? []).filter(mine).reduce((s: bigint, b: any) => s + BigInt(b.uiTokenAmount.amount), 0n);
    return post > pre ? ethers.formatUnits(post - pre, 6) : null;
  }
  if (i.symbol === "SOL") {
    const keys: any[] = t.transaction?.message?.accountKeys ?? [];
    const at = keys.findIndex((k) => (typeof k === "string" ? k : k.pubkey) === i.address);
    if (at < 0) return null;
    const diff = BigInt(meta.postBalances[at]) - BigInt(meta.preBalances[at]);
    return diff > 0n ? ethers.formatUnits(diff, 9) : null;
  }
  return null;
}

/** Enough arrived for the swap to finish: at least the least the quote takes. */
function enough(i: Intent): boolean {
  const got = Number(i.depositedAmount ?? NaN);
  const need = Number(i.minAmount ?? i.amount);
  return Number.isFinite(got) && Number.isFinite(need) && need > 0 && got + need * 1e-9 >= need;
}

/** Marks the customer's part done, once enough has arrived. Kept once set. */
const withSeen = (i: Intent): Intent => (i.paidSeenAt || !enough(i) ? i : { ...i, paidSeenAt: new Date().toISOString() });

/**
 * While a swap waits for its deposit: look for the transfer ourselves and hand
 * it to 1Click. Once only, once it's taken. Never in the way: a miss, or an
 * error, just leaves it to 1Click's own watcher.
 */
async function nudge(p: Payment, intent: Intent): Promise<Intent> {
  if (intent.status !== "PENDING_DEPOSIT" || intent.submittedTx) return intent;
  try {
    const found = await findOriginTx(intent);
    if (!found || !(await submitIntentDeposit(intent.address, found.tx, intent.memo))) return intent;
    log.info("[intents] handed the deposit to 1Click", { ref: p.ref, tx: found.tx, amount: found.amount });
    return withSeen({ ...intent, submittedTx: found.tx, depositedAmount: found.amount ?? intent.depositedAmount ?? null });
  } catch (e) {
    log.warn("[intents] couldn't look for the deposit", { ref: p.ref, reason: e instanceof Error ? e.message : String(e) });
    return intent;
  }
}

/**
 * The swap's progress, read from 1Click while the checkout watches - at most
 * every five seconds per payment. Stored on the payment so the page, the
 * dashboard and support all see the same thing. A deposit that's been seen
 * keeps the payment open for the swap to finish.
 */
export async function watchIntent(p: Payment): Promise<Payment> {
  const was = intentOf(p);
  if (!was || was.test || p.mode !== "LIVE") return p;
  if (was.status === "SUCCESS" || was.status === "REFUNDED" || was.status === "FAILED") return p;
  const last = looked.get(p.id) ?? 0;
  if (Date.now() - last < 4_000) return p;
  if (looked.size > 2_000) for (const [id, at] of looked) if (Date.now() - at > 30 * 60_000) looked.delete(id);
  looked.set(p.id, Date.now());
  const intent = await nudge(p, was);
  try {
    const s = await intentStatus(intent.address, intent.memo);
    if (!s || !s.status) {
      if (intent !== was) return await prisma.payment.update({ where: { id: p.id }, data: { intent: intent as unknown as Prisma.InputJsonValue } });
      return p;
    }
    const underWay = !!intent.submittedTx || s.status === "KNOWN_DEPOSIT_TX" || s.status === "PROCESSING" || s.status === "SUCCESS";
    // 1Click's own reading of what arrived, for the coins we don't read ourselves (Bitcoin and the rest).
    const depositedAmount = (underWay && s.depositedAmount) || intent.depositedAmount || null;
    const next = withSeen({ ...intent, status: s.status, originTx: s.originTx, destinationTx: s.destinationTx, depositedAmount });
    const changed = intent !== was || s.status !== intent.status || s.originTx !== intent.originTx || s.destinationTx !== intent.destinationTx || next.depositedAmount !== intent.depositedAmount || next.paidSeenAt !== intent.paidSeenAt;
    const later = new Date(Date.now() + SWAP_MS);
    const extend = p.status === "OPEN" && underWay && p.expiresAt < later;
    if (!changed && !extend) return p;
    if (changed && s.status !== intent.status) log.info("[intents] swap moved on", { ref: p.ref, from: intent.status, to: s.status, originTx: s.originTx });
    if (next.paidSeenAt && !intent.paidSeenAt) log.info("[intents] the customer's part is done, shown as paid", { ref: p.ref, deposited: next.depositedAmount, needed: intent.minAmount ?? intent.amount });
    return await prisma.payment.update({
      where: { id: p.id },
      data: {
        intent: next as unknown as Prisma.InputJsonValue,
        ...(extend ? { expiresAt: later } : {}),
      },
    });
  } catch (e) {
    log.warn("[intents] couldn't read a swap's status", { ref: p.ref, reason: e instanceof Error ? e.message : String(e) });
    return p;
  }
}

/** The customer gave their transaction: passed to 1Click, so the swap starts at once. */
export async function giveIntentTx(p: Payment, txHash: string): Promise<boolean> {
  const intent = intentOf(p);
  if (!intent || intent.test || p.status !== "OPEN") return false;
  return submitIntentDeposit(intent.address, txHash, intent.memo);
}

/** Open live intent payments, so the worker can follow swaps nobody's checkout is watching. */
export async function followIntents(): Promise<void> {
  const open = await prisma.payment.findMany({ where: { status: "OPEN", mode: "LIVE", method: "CRYPTO", intent: { not: Prisma.DbNull } }, take: 50, orderBy: { createdAt: "asc" } });
  for (const p of open) await watchIntent(p);
}
