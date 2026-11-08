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
import { addressKey } from "../lib/chains";
import { depositAddressFor } from "../lib/deposit-keys";
import { effectiveChain } from "../lib/platform";
import { IntentQuoteError, intentCoin, intentPrice, intentStatus, intentsOffered, landingFor, quoteIntent, submitIntentDeposit, testLandingFor, type IntentStatus } from "../lib/intents";
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

const looked = new Map<string, number>();

/**
 * The swap's progress, read from 1Click while the checkout watches - at most
 * every five seconds per payment. Stored on the payment so the page, the
 * dashboard and support all see the same thing. A deposit that's been seen
 * keeps the payment open for the swap to finish.
 */
export async function watchIntent(p: Payment): Promise<Payment> {
  const intent = intentOf(p);
  if (!intent || intent.test || p.mode !== "LIVE") return p;
  if (intent.status === "SUCCESS" || intent.status === "REFUNDED" || intent.status === "FAILED") return p;
  const last = looked.get(p.id) ?? 0;
  if (Date.now() - last < 5_000) return p;
  if (looked.size > 2_000) for (const [id, at] of looked) if (Date.now() - at > 30 * 60_000) looked.delete(id);
  looked.set(p.id, Date.now());
  try {
    const s = await intentStatus(intent.address, intent.memo);
    if (!s || !s.status) return p;
    const changed = s.status !== intent.status || s.originTx !== intent.originTx || s.destinationTx !== intent.destinationTx;
    const underWay = s.status === "KNOWN_DEPOSIT_TX" || s.status === "PROCESSING" || s.status === "SUCCESS";
    const later = new Date(Date.now() + SWAP_MS);
    const extend = p.status === "OPEN" && underWay && p.expiresAt < later;
    if (!changed && !extend) return p;
    if (changed) log.info("[intents] swap moved on", { ref: p.ref, from: intent.status, to: s.status, originTx: s.originTx });
    return await prisma.payment.update({
      where: { id: p.id },
      data: {
        intent: { ...intent, status: s.status, originTx: s.originTx, destinationTx: s.destinationTx } as unknown as Prisma.InputJsonValue,
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
