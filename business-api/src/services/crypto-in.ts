/**
 * Live stablecoin payments, on every network we take them.
 *
 * A transfer is told apart from every other in one of three ways, by network
 * (lib/chains):
 *  - OWN: the payment has an address of its own, worked out from DEPOSIT_SEED
 *    and its id. Whatever reaches that address is this payment's; part
 *    payments add up; once paid, it's swept into the treasury (crypto-out).
 *  - MEMO (Stellar, TON): our treasury, with a memo or comment naming it.
 *  - AMOUNT (Ethereum, and anywhere while there's no seed): our treasury, with
 *    an exact amount no other open payment is using ("send 5.0003 USDC").
 *
 * Every transfer that reaches us is recorded once, as a CryptoArrival, and a
 * payment is decided by what its arrivals add up to: paid in full (anything
 * over goes back), part paid (still open, a little longer, for the rest), or
 * - once it's closed - given back. A transfer that matches nothing waits for
 * our team in the admin console. Nothing is lost either way.
 *
 * How each network is read:
 *  - EVM: the coins' Transfer logs to the treasury and to open payments'
 *    addresses. Arc's USDC is its own coin, so plain value sends count too.
 *  - Solana: each address's USDC and USDT token account, by signature.
 *  - Movement: the indexer's deposits into the treasury and payment addresses.
 *  - Stellar: Horizon's payments to our account, with each one's memo.
 *  - TON: TonAPI's events for our wallet, with each transfer's comment.
 * Each network waits for its own number of confirmations before it counts.
 * After a payment closes, its own address is still looked at now and then for
 * a few days, for anything sent late.
 */
import crypto from "crypto";
import { Prisma, type CryptoArrival, type Payment } from "@prisma/client";
import { ethers } from "ethers";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { LATE_GRACE_MS } from "../lib/money";
import { COIN_NETWORKS, coinLiveReady, liveReady, offeredAccept, type Coin, type Network } from "../lib/accept";
import { depositAddressFor } from "../lib/deposit-keys";
import { EVM_CHAINS, MEMO_NETWORKS, MOVE_ASSETS, MOVE_INDEXER, SOL_MINTS, addressKey, contractsOf, evmChain, hexNum, kindFor, rpc, sameHex, toHex, toMicros, treasuryFor, type EvmChain } from "../lib/chains";
import { refreshStellar, stellarArrivals, stellarReceiveAddress } from "../lib/stellar";
import { refreshTon, tonArrivals, tonReceiveAddress } from "../lib/ton";
import { admit, confirmArrival, newPayment, type Checkout, type OpenInput } from "./payments";
import { closeEmptySolana, decideReturns, openSolanaAccount } from "./crypto-out";

export { EVM_CHAINS };

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/**
 * AMOUNT payments: the most offsets one base amount can have open at once. Each is a ten-thousandth
 * of a dollar (OFFSET_STEP micros), so the amount to send never needs more than four decimals: 5.0003 USDC.
 */
const MAX_OFFSET = 9_999;
const OFFSET_STEP = 100n;
/** A cent short still counts as paid: exchanges and wallets round. */
const TOLERANCE = 10_000n;
/** A part payment keeps the checkout open this much longer, for the rest. */
const TOP_UP_MS = 15 * 60_000;
/** How long after it closed a payment's own address is still looked at for something sent late. */
const LOOK_FOR_MS = 72 * 3_600_000;
/** How long after it lapsed a payment can still be paid in full, and count. */
const REVIVE_MS = 24 * 3_600_000;

const LIVE_CRYPTO = { method: "CRYPTO" as const, mode: "LIVE" as const };
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ─── Opening ──────────────────────────────────────────────────────────────

/** AMOUNT: an amount no other open payment on this network is waiting for. */
async function uniqueMicros(coin: Coin, network: Network, base: bigint): Promise<bigint> {
  const taken = await prisma.payment.findMany({
    where: { status: "OPEN", ...LIVE_CRYPTO, coin, network, cryptoMicros: { gte: base + 1n, lte: base + BigInt(MAX_OFFSET) * OFFSET_STEP } },
    select: { cryptoMicros: true },
  });
  const used = new Set(taken.map((t) => String(t.cryptoMicros)));
  for (let i = 1; i <= MAX_OFFSET; i++) {
    const candidate = base + BigInt(i) * OFFSET_STEP;
    // Never a whole-cent amount: app payments and wallet sends move whole cents into the same treasury.
    if (candidate % 10_000n === 0n) continue;
    if (!used.has(String(candidate))) return candidate;
  }
  throw new HttpError(503, "Too many people are paying this amount right now. Try again in a minute.", "crypto_busy");
}

/** MEMO: eight digits no payment on this network has ever had, so even a late transfer finds its payment. */
async function uniqueMemo(network: Network): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    const memo = String(crypto.randomInt(10_000_000, 100_000_000));
    if (!(await prisma.payment.count({ where: { network, depositMemo: memo } }))) return memo;
  }
  return null;
}

/** A live stablecoin payment: an address of its own, a memo on our treasury, or an exact amount there. */
export async function openLiveCryptoPayment(c: Checkout, input: OpenInput, coin: string, network: string): Promise<Payment> {
  const price = await admit(c, "CRYPTO", input);
  const offered = offeredAccept(c.accept, price.p, "LIVE");
  const k = coin as Coin;
  const n = network as Network;
  if (!COIN_NETWORKS[k]?.includes(n) || !offered[k]?.includes(n) || !coinLiveReady(k, n)) {
    throw new HttpError(400, "Pick a coin and a network this checkout takes.", "bad_coin");
  }
  const kind = kindFor(n);
  const treasury = treasuryFor(n);
  if (!treasury) throw new HttpError(503, "Stablecoin payments on that network aren't switched on yet. Try another network.", "crypto_off");
  const base = BigInt(price.amountCents) * 10_000n;
  const payment = await newPayment(c, input, "CRYPTO", price, { coin: k, network: n, depositKind: kind });

  if (kind === "OWN") {
    const opened = await prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: addressKey(n, depositAddressFor(n, payment.id)), cryptoMicros: base, receivedMicros: 0n } });
    // Solana: its token account opened by us, so the customer's wallet doesn't pay to open it.
    if (n === "Solana") void openSolanaAccount(opened.depositAddress!, k).catch((e) => log.warn("[crypto-in] couldn't open the Solana account ahead, the sender's wallet will", { ref: opened.ref, reason: reason(e) }));
    return opened;
  }
  if (kind === "MEMO") {
    const memo = await uniqueMemo(n);
    if (memo) return prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: treasury, depositMemo: memo, cryptoMicros: base, receivedMicros: 0n } });
  } else {
    // The exact amount is chosen after the row exists, and retried if two payments race for the same one.
    for (let attempt = 0; attempt < 3; attempt++) {
      const micros = await uniqueMicros(k, n, base);
      const clash = await prisma.payment.count({ where: { status: "OPEN", ...LIVE_CRYPTO, coin: k, network: n, cryptoMicros: micros } });
      if (clash) continue;
      return prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: treasury, cryptoMicros: micros } });
    }
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
  throw new HttpError(503, "Too many people are paying right now. Try again in a minute.", "crypto_busy");
}

// ─── What arrived ─────────────────────────────────────────────────────────

export interface Incoming {
  network: Network;
  coin: Coin;
  /** The contract, mint, asset or issuer - "native" for a chain's own coin. */
  token: string | null;
  micros: bigint;
  from: string | null;
  to: string;
  memo?: string | null;
  tx: string;
  /** One per transfer: "<tx>:<index>". */
  session: string;
}

const EVM_NETWORKS = EVM_CHAINS.map((c) => c.network);

/** The payment an address of its own belongs to. On the EVM chains one address serves a payment on all of them. */
function ownPaymentAt(network: Network, address: string) {
  const key = addressKey(network, address);
  return prisma.payment.findFirst({ where: { depositKind: "OWN", depositAddress: key, ...LIVE_CRYPTO, network: evmChain(network) ? { in: EVM_NETWORKS } : network } });
}

/**
 * Our own money reaching the treasury: a business sending from its wallet (to
 * its bank, or to fund a refund), or a Money Moves app payment. Each already
 * has its own record, kept under the transaction's plain hash, and is handled
 * there. It is no customer's stray money, so it is never matched to a checkout
 * or sent back. Returns what it was, or null.
 */
async function ownTransfer(tx: string): Promise<string | null> {
  const same = { equals: tx, mode: "insensitive" as const };
  if (await prisma.walletSend.count({ where: { txHash: same } })) return "A business sending from its wallet to its bank or to fund a refund. That send is handled on its own.";
  if (await prisma.payment.count({ where: { method: "APP", payerSession: same } })) return "A Money Moves app payment, already paid to the business.";
  if (await prisma.refund.count({ where: { fundTx: same } })) return "Money that funded a refund.";
  return null;
}

/**
 * Transfers recorded as unmatched before their own record carried the hash
 * (the chain can be quicker than the app telling us): put to rest as ours,
 * never sent back. Runs with the scan, and catches anything recorded earlier.
 */
export async function settleOwnTransfers(): Promise<void> {
  const waiting = await prisma.cryptoArrival.findMany({ where: { kind: "UNMATCHED", returnStatus: "MANUAL" }, select: { id: true, txHash: true }, take: 200 });
  for (const x of waiting) {
    const what = await ownTransfer(x.txHash);
    if (!what) continue;
    const done = await prisma.cryptoArrival.updateMany({ where: { id: x.id, returnStatus: "MANUAL" }, data: { returnStatus: "KEPT", returnWhy: "own", returnBy: "system", returnError: what } });
    if (done.count) log.info("[crypto-in] an unmatched transfer was our own, put to rest", { id: x.id, tx: x.txHash });
  }
}

/** A transfer to the treasury: by memo on Stellar and TON, by exact amount elsewhere. */
async function treasuryPayment(a: Incoming): Promise<Payment | null> {
  if (MEMO_NETWORKS.includes(a.network)) {
    // By memo only. Our account there also takes the float's top-ups, so an amount alone could pay the wrong payment:
    // a transfer without a memo waits for our team, who match it by hand.
    if (!a.memo) return null;
    return prisma.payment.findFirst({ where: { network: a.network, depositKind: "MEMO", depositMemo: a.memo.trim(), ...LIVE_CRYPTO } });
  }
  return prisma.payment.findFirst({ where: { status: "OPEN", ...LIVE_CRYPTO, network: a.network, coin: a.coin, cryptoMicros: a.micros, OR: [{ depositKind: "AMOUNT" }, { depositKind: null }] } });
}

/**
 * A transfer that reached us, recorded once and put towards its payment.
 * Returns whether it was new.
 */
export async function takeArrival(a: Incoming): Promise<boolean> {
  if (a.micros <= 0n) return false;
  if (await prisma.cryptoArrival.count({ where: { session: a.session } })) return false;
  // Counted by the exact-amount matcher before arrivals were recorded.
  if (await prisma.payment.count({ where: { payerSession: a.session } })) return false;
  // Arc moves USDC as its own coin and through its token contract: one transfer, seen twice, counts once.
  if (a.network === "Arc" && (await prisma.cryptoArrival.count({ where: { network: "Arc", txHash: a.tx, toAddress: addressKey(a.network, a.to), micros: a.micros } }))) return false;
  const treasury = treasuryFor(a.network);
  const toTreasury = !!treasury && addressKey(a.network, treasury) === addressKey(a.network, a.to);
  // Our own sweep landing in the treasury, not a customer.
  if (toTreasury && a.from && (await ownPaymentAt(a.network, a.from))) return false;
  // A business wallet send or an app payment: handled by its own record, so never a checkout's money.
  if (toTreasury && (await ownTransfer(a.tx))) return false;
  const p = toTreasury ? await treasuryPayment(a) : await ownPaymentAt(a.network, a.to);
  try {
    await prisma.cryptoArrival.create({
      data: {
        session: a.session,
        paymentId: p?.id ?? null,
        network: a.network,
        coin: a.coin,
        token: a.token,
        micros: a.micros,
        fromAddress: a.from,
        toAddress: addressKey(a.network, a.to),
        memo: a.memo ?? null,
        txHash: a.tx,
        kind: p ? "PAYMENT" : "UNMATCHED",
        ...(p ? {} : { returnMicros: a.micros, returnWhy: "unmatched", returnStatus: "MANUAL" }),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
  if (!p) {
    log.warn("[crypto-in] a transfer matched no payment, for ops to match by hand", { network: a.network, coin: a.coin, amount: Number(a.micros) / 1e6, from: a.from, memo: a.memo ?? null, tx: a.tx });
    return true;
  }
  log.info("[crypto-in] transfer in", { ref: p.ref, network: a.network, coin: a.coin, amount: Number(a.micros) / 1e6, tx: a.tx });
  await weigh(p.id);
  return true;
}

/** A lapsed payment that can still be paid: not long ago, and its checkout still takes payments. */
async function canRevive(tx: Prisma.TransactionClient, p: Payment): Promise<boolean> {
  if (p.expiresAt.getTime() < Date.now() - REVIVE_MS) return false;
  const business = await tx.business.findUnique({ where: { id: p.businessId }, select: { status: true } });
  if (business?.status !== "VERIFIED") return false;
  if (p.invoiceId) return (await tx.invoice.findUnique({ where: { id: p.invoiceId }, select: { status: true } }))?.status === "OPEN";
  if (p.linkId) {
    const l = await tx.paymentLink.findUnique({ where: { id: p.linkId }, select: { active: true, deletedAt: true } });
    return !!l?.active && !l.deletedAt;
  }
  if (p.outletId) {
    const o = await tx.outlet.findUnique({ where: { id: p.outletId }, select: { active: true, deletedAt: true } });
    return !!o?.active && !o.deletedAt;
  }
  return false;
}

/**
 * What a payment's arrivals add up to, and what follows - one at a time per
 * payment (its row is locked while it's worked out).
 *
 *  - Open, and enough has arrived: paid. Each arrival is used up to the
 *    price, oldest first; anything over goes back.
 *  - Open, not enough yet: part paid. It stays open a little longer.
 *  - Lapsed with nothing used, and now paid in full within a day, while its
 *    checkout still takes payments: opened again, and paid.
 *  - Otherwise closed: what arrived goes back - "short" if it came while the
 *    payment was open, "late" if after.
 * Another coin, or another network, than the payment asked for always goes back.
 */
export async function weigh(paymentId: string): Promise<void> {
  const decision = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const all = await tx.cryptoArrival.findMany({ where: { paymentId, kind: "PAYMENT" }, orderBy: { createdAt: "asc" } });
    const giveBack = (x: CryptoArrival, micros: bigint, why: string) => tx.cryptoArrival.update({ where: { id: x.id }, data: { kind: "EXTRA", returnMicros: micros, returnWhy: why } });
    const fits = (x: CryptoArrival) => x.coin === p.coin && x.network === p.network;
    for (const x of all.filter((x) => !fits(x))) await giveBack(x, x.micros, "wrong_coin");
    const mine = all.filter(fits);
    const used = mine.filter((x) => x.usedMicros > 0n);
    const waiting = mine.filter((x) => x.usedMicros === 0n);
    const price = p.cryptoMicros ?? 0n;

    // Already used up to the price, but the payment never got recorded as paid (it stopped halfway): finish it.
    if (p.status === "OPEN" && used.length && used.reduce((s, x) => s + x.usedMicros, 0n) + TOLERANCE >= price && !waiting.length) return { confirm: used[used.length - 1]! };
    if (!waiting.length) return null;

    let status = p.status;
    const sum = waiting.reduce((s, x) => s + x.micros, 0n);
    if (status === "EXPIRED" && !used.length && sum + TOLERANCE >= price && (await canRevive(tx, p))) {
      await tx.payment.update({ where: { id: p.id }, data: { status: "OPEN", expiresAt: new Date(Date.now() + 10 * 60_000) } });
      status = "OPEN";
      log.info("[crypto-in] a lapsed payment was paid in full after all, opened again", { ref: p.ref });
    }
    // An invoice already paid another way: this payment is closed, and what came goes back.
    let invoicePaid = false;
    if (status === "OPEN" && p.invoiceId && (await tx.invoice.findUnique({ where: { id: p.invoiceId }, select: { status: true } }))?.status !== "OPEN") {
      await tx.payment.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
      status = "EXPIRED";
      invoicePaid = true;
    }
    if (status !== "OPEN") {
      const why = (x: CryptoArrival) => (invoicePaid ? "invoice_paid" : status === "PAID" ? "extra" : status === "EXPIRED" && x.createdAt.getTime() <= p.expiresAt.getTime() + LATE_GRACE_MS ? "short" : "late");
      for (const x of waiting) await giveBack(x, x.micros, why(x));
      return null;
    }
    await tx.payment.update({ where: { id: p.id }, data: { receivedMicros: sum } });
    if (sum + TOLERANCE < price) {
      const later = new Date(Date.now() + TOP_UP_MS);
      if (p.expiresAt < later) await tx.payment.update({ where: { id: p.id }, data: { expiresAt: later } });
      return null;
    }
    let left = price;
    let last = waiting[0]!;
    for (const x of waiting) {
      const use = left <= 0n ? 0n : x.micros < left ? x.micros : left;
      left -= use;
      if (use > 0n) {
        last = x;
        await tx.cryptoArrival.update({ where: { id: x.id }, data: { usedMicros: use, ...(x.micros > use ? { returnMicros: x.micros - use, returnWhy: "overpaid" } : {}) } });
      } else await giveBack(x, x.micros, "overpaid");
    }
    return { confirm: last };
  });

  if (decision?.confirm) {
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === "OPEN") {
      // Paid in full: what it was priced at, in kobo, as the rest of the checkout counts it.
      await confirmArrival(p, { amountKobo: p.amountKobo, payerName: null, payerBank: p.network, payerAccount: decision.confirm.fromAddress, session: decision.confirm.session });
      log.info("[crypto-in] payment confirmed", { ref: p.ref, network: p.network, coin: p.coin, tx: decision.confirm.txHash });
    }
  }
  await decideReturns(paymentId);
}

/** Payments that lapsed part paid: what came goes back. */
async function settleLapsed(): Promise<void> {
  const rows = await prisma.cryptoArrival.findMany({ where: { kind: "PAYMENT", usedMicros: 0n, returnMicros: null, payment: { status: { not: "OPEN" } } }, select: { paymentId: true }, distinct: ["paymentId"], take: 20 });
  for (const r of rows) if (r.paymentId) await weigh(r.paymentId).catch((e) => log.warn("[crypto-in] couldn't settle a lapsed payment", { paymentId: r.paymentId, reason: reason(e) }));
}

// ─── Where to look ────────────────────────────────────────────────────────

const openOn = (network: Network) => prisma.payment.count({ where: { status: "OPEN", ...LIVE_CRYPTO, network } });
/** The oldest open payment on a network: anything that landed before it can't be for it. */
const oldestOpen = async (network: Network) =>
  (await prisma.payment.findFirst({ where: { status: "OPEN", ...LIVE_CRYPTO, network }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }))?.createdAt ?? null;
/** Own addresses worth watching on a network: open payments', and those closed in the last `withinMs`. */
async function ownWatched(network: Network, withinMs: number): Promise<Payment[]> {
  return prisma.payment.findMany({
    where: { ...LIVE_CRYPTO, network, depositKind: "OWN", depositAddress: { not: null }, OR: [{ status: "OPEN" }, { expiresAt: { gt: new Date(Date.now() - withinMs) } }] },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}
/** When the oldest MEMO payment on a network still watched began: open, or closed recently enough to still be paid late. */
async function memoWatchedSince(network: Network): Promise<Date | null> {
  const p = await prisma.payment.findFirst({ where: { ...LIVE_CRYPTO, network, depositKind: "MEMO", OR: [{ status: "OPEN" }, { expiresAt: { gt: new Date(Date.now() - LOOK_FOR_MS) } }] }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  return p?.createdAt ?? null;
}

async function cursor(key: string): Promise<string | number | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const v = (row?.value as { block?: number; at?: string | number } | null) ?? null;
  return v?.block ?? v?.at ?? null;
}
const saveCursor = (key: string, at: string | number) =>
  prisma.setting.upsert({ where: { key }, create: { key, value: typeof at === "number" ? { block: at } : { at } }, update: { value: typeof at === "number" ? { block: at } : { at } } });

// ─── EVM ──────────────────────────────────────────────────────────────────

const cursorKey = (network: Network) => (network === "Monad" ? "scan:monad" : `scan:${network.toLowerCase().replace(/[^a-z]+/g, "-")}`);
/** The widest log query each network's provider has taken (free plans cap it at 10 blocks). */
const steps = new Map<Network, number>();
/** At most this many blocks are caught up in one round, however long the worker was away. */
const MAX_CATCH_UP = 10_000;
const topicOf = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
type Log = { address: string; topics: string[]; data: string; transactionHash: string; logIndex: string; blockNumber: string };

/** Logs, a window at a time - narrower when the provider refuses a wide one. */
async function logsBetween(c: EvmChain, url: string, filter: { address: string[]; topics: (string | string[] | null)[] }, from: number, to: number, each: (logs: Log[], start: number, end: number) => Promise<void>, maxWindows = Infinity) {
  let start = from;
  let step = steps.get(c.network) ?? 500;
  let windows = 0;
  while (start <= to && windows < maxWindows) {
    const end = Math.min(start + step - 1, to);
    let logs: Log[];
    try {
      logs = await rpc(url, "eth_getLogs", [{ ...filter, fromBlock: toHex(start), toBlock: toHex(end) }]);
    } catch (e) {
      if (step > 5) {
        step = Math.max(5, Math.floor(step / 4));
        steps.set(c.network, step);
        continue;
      }
      throw e;
    }
    windows++;
    await each(logs, start, end);
    start = end + 1;
  }
}

async function scanEvm(c: EvmChain): Promise<void> {
  const url = c.url();
  const treasury = env.TREASURY_EVM_ADDRESS;
  if (!url || !treasury) return;
  // Nothing open, nothing to look for - and nothing asked of the network, which costs a call each time.
  const oldest = await oldestOpen(c.network);
  if (!oldest) return;
  const key = cursorKey(c.network);
  const tip = hexNum(await rpc<string>(url, "eth_blockNumber", [])) - (c.confirmations - 1);
  const last = (await cursor(key)) as number | null;
  // From about when the oldest open payment began (with a margin), or where the last round stopped if that's later.
  const sinceOldest = tip - Math.ceil((Date.now() - oldest.getTime() + 30_000) / 1000 / c.blockSeconds);
  const start = Math.max(last != null ? last + 1 : sinceOldest, sinceOldest, tip - MAX_CATCH_UP);
  // The treasury, and the addresses of payments open here or closed in the last two hours.
  const own = await ownWatched(c.network, 2 * 3_600_000);
  const watched = [treasury, ...own.map((p) => p.depositAddress!)];
  const contracts = contractsOf(c);
  await logsBetween(c, url, { address: contracts.map((t) => t.address), topics: [TRANSFER, null, watched.map(topicOf)] }, start, tip, async (logs, from, end) => {
    for (const l of logs) {
      const token = contracts.find((t) => sameHex(t.address, l.address));
      if (!token || !l.topics[2]) continue;
      await takeArrival({
        network: c.network,
        coin: token.coin,
        token: token.address,
        micros: toMicros(BigInt(l.data), token.decimals),
        from: l.topics[1] ? `0x${l.topics[1].slice(-40)}` : null,
        to: `0x${l.topics[2].slice(-40)}`,
        tx: l.transactionHash,
        session: `${l.transactionHash}:${hexNum(l.logIndex)}`,
      });
    }
    if (c.native) await walkNative(c, url, watched, from, end);
    await saveCursor(key, end);
  });
}

/** Arc: USDC sent as the chain's own coin - plain value sends to an address we watch, found by walking the blocks. */
async function walkNative(c: EvmChain, url: string, watched: string[], from: number, to: number): Promise<void> {
  const native = c.native!;
  const set = new Set(watched.map((w) => w.toLowerCase()));
  // A round walks at most a few hundred blocks; anything older is found by the late look, or waits for ops.
  for (let b = Math.max(from, to - 300); b <= to; b++) {
    const block = await rpc<{ transactions?: { hash: string; from: string; to: string | null; value: string }[] } | null>(url, "eth_getBlockByNumber", [toHex(b), true]);
    for (const tx of block?.transactions ?? []) {
      if (!tx.to || !set.has(tx.to.toLowerCase()) || BigInt(tx.value) === 0n) continue;
      const receipt = await rpc<{ status?: string } | null>(url, "eth_getTransactionReceipt", [tx.hash]);
      if (receipt?.status !== "0x1") continue;
      await takeArrival({ network: c.network, coin: native.coin, token: "native", micros: toMicros(BigInt(tx.value), native.decimals), from: tx.from, to: tx.to, tx: tx.hash, session: `${tx.hash}:native` });
    }
  }
}

// ─── Solana ───────────────────────────────────────────────────────────────

const solAccounts = new Map<string, string>();
/** Transactions already read and found to bring nothing in (an account opening, a sweep out): never fetched again. */
const solNothing = new Set<string>();
/** After the RPC says too many requests, Solana rests until then. */
let solRestUntil = 0;
const tooBusy = (e: unknown) => /429|exceeded|too many/i.test(reason(e));

/** A Solana token account's new transfers in: each signature's balance change for its owner. Returns the newest signature. */
async function solanaInto(owner: string, account: string, coin: Coin, mint: string, opts: { until?: string | null; since: number; limit: number }): Promise<string | null> {
  const url = env.SOLANA_RPC_URL!;
  const sigs = await rpc<{ signature: string; err: unknown; blockTime: number | null }[]>(url, "getSignaturesForAddress", [account, { limit: opts.limit, commitment: "finalized", ...(opts.until ? { until: opts.until } : {}) }]);
  if (!sigs?.length) return null;
  for (const s of [...sigs].reverse()) {
    if (s.err || (s.blockTime != null && s.blockTime * 1000 < opts.since)) continue;
    if (solNothing.has(`${s.signature}:${owner}:${coin}`)) continue;
    if (await prisma.cryptoArrival.count({ where: { session: `${s.signature}:${coin}` } })) continue;
    const tx = await rpc<any>(url, "getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "finalized" }]);
    if (!tx) continue;
    if (tx.meta?.err) {
      solNothing.add(`${s.signature}:${owner}:${coin}`);
      continue;
    }
    const balance = (list: any[] | undefined, who: string) => BigInt(list?.find((b) => b.mint === mint && b.owner === who)?.uiTokenAmount?.amount ?? "0");
    const got = balance(tx.meta?.postTokenBalances, owner) - balance(tx.meta?.preTokenBalances, owner);
    if (got <= 0n) {
      if (solNothing.size > 20_000) solNothing.clear();
      solNothing.add(`${s.signature}:${owner}:${coin}`);
      continue;
    }
    const sender = (tx.meta?.preTokenBalances ?? []).find((b: any) => b.mint === mint && b.owner !== owner && balance(tx.meta?.postTokenBalances, b.owner) < BigInt(b.uiTokenAmount?.amount ?? "0"))?.owner ?? null;
    await takeArrival({ network: "Solana", coin, token: mint, micros: got, from: sender, to: owner, tx: s.signature, session: `${s.signature}:${coin}` });
  }
  return sigs[0]!.signature;
}

async function scanSolana(): Promise<void> {
  if (Date.now() < solRestUntil) return;
  try {
    await scanSolanaOnce();
  } catch (e) {
    // Over the RPC's limit: rest a little rather than ask again every few seconds and stay over it.
    if (tooBusy(e)) solRestUntil = Date.now() + 20_000;
    throw e;
  }
}

async function scanSolanaOnce(): Promise<void> {
  const url = env.SOLANA_RPC_URL;
  const treasury = env.TREASURY_SOLANA_ADDRESS;
  if (!url || !treasury || !(await openOn("Solana"))) return;
  // Open payments' own addresses first: they're what customers are waiting on.
  const open = await prisma.payment.findMany({ where: { status: "OPEN", ...LIVE_CRYPTO, network: "Solana", depositKind: "OWN", depositAddress: { not: null } }, orderBy: { createdAt: "desc" }, take: 100 });
  for (const p of open) {
    const mint = SOL_MINTS[p.coin as Coin];
    if (!mint) continue;
    const account = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(p.depositAddress!)).toBase58();
    await solanaInto(p.depositAddress!, account, p.coin as Coin, mint, { since: p.createdAt.getTime() - 60_000, limit: 20 });
  }
  const since = ((await oldestOpen("Solana"))?.getTime() ?? Date.now()) - 120_000;
  // The treasury: exact-amount payments, and anything sent there instead.
  for (const [coin, mint] of Object.entries(SOL_MINTS) as [Coin, string][]) {
    let account = solAccounts.get(mint);
    if (!account) {
      const r = await rpc<{ value?: { pubkey: string }[] }>(url, "getTokenAccountsByOwner", [treasury, { mint }, { encoding: "jsonParsed" }]);
      account = r?.value?.[0]?.pubkey;
      if (!account) continue;
      solAccounts.set(mint, account);
    }
    const key = `scan:solana:${coin.toLowerCase()}`;
    const top = await solanaInto(treasury, account, coin, mint, { until: (await cursor(key)) as string | null, since, limit: 100 });
    if (top) await saveCursor(key, top);
  }
}

// ─── Movement ─────────────────────────────────────────────────────────────

async function scanMovement(): Promise<void> {
  const treasury = env.TREASURY_MOVEMENT_ADDRESS;
  const node = env.MOVEMENT_RPC_URL;
  if (!treasury || !node) return;
  // The treasury while anything is open; own addresses for a few days after, for anything late.
  const own = await ownWatched("Movement", LOOK_FOR_MS);
  const anyOpen = await openOn("Movement");
  if (!anyOpen && !own.length) return;
  const pad = (a: string) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const owners = [...(anyOpen ? [pad(treasury)] : []), ...own.map((p) => pad(p.depositAddress!))];
  const key = "scan:movement";
  const last = (await cursor(key)) as number | null;
  const assets = Object.entries(MOVE_ASSETS) as [Coin, string][];
  const query = `query Deposits($owners: [String!], $assets: [String!], $after: bigint!) {
    fungible_asset_activities(
      where: { owner_address: { _in: $owners }, asset_type: { _in: $assets }, type: { _eq: "0x1::fungible_asset::Deposit" }, transaction_version: { _gt: $after } }
      order_by: { transaction_version: asc }
      limit: 100
    ) { transaction_version owner_address amount asset_type event_index is_transaction_success }
  }`;
  // The first look starts from a little before now: nothing before a payment opened can be for it.
  let after = last;
  if (after == null) {
    const r = await fetch(`${node.replace(/\/$/, "")}/`, { signal: AbortSignal.timeout(10_000) }).then((x) => x.json() as Promise<{ ledger_version?: string }>);
    after = Math.max(0, Number(r.ledger_version ?? 0) - 50_000);
  }
  const r = await fetch(MOVE_INDEXER(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { owners, assets: assets.map(([, a]) => a), after } }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => null)) as { data?: { fungible_asset_activities?: any[] }; errors?: unknown } | null;
  if (!r.ok || body?.errors) throw new Error(`Movement indexer ${r.status}`);
  let top = after;
  for (const row of body?.data?.fungible_asset_activities ?? []) {
    top = Math.max(top, Number(row.transaction_version));
    if (row.is_transaction_success === false) continue;
    const coin = assets.find(([, a]) => sameHex(a, row.asset_type))?.[0];
    if (!coin) continue;
    const session = `v${row.transaction_version}:${row.event_index ?? 0}`;
    if (await prisma.cryptoArrival.count({ where: { session } })) continue;
    // The transaction itself, for its hash and who sent it - our own sweeps into the treasury are told apart by that.
    const tx = (await (await fetch(`${node.replace(/\/$/, "")}/transactions/by_version/${row.transaction_version}`, { signal: AbortSignal.timeout(10_000) })).json().catch(() => null)) as { hash?: string; sender?: string; success?: boolean } | null;
    if (!tx?.hash || tx.success === false) continue;
    await takeArrival({ network: "Movement", coin, token: MOVE_ASSETS[coin]!, micros: BigInt(String(row.amount)), from: tx.sender ?? null, to: row.owner_address, tx: tx.hash, session });
  }
  if (top > (last ?? -1)) await saveCursor(key, top);
}

// ─── Stellar and TON ──────────────────────────────────────────────────────

async function scanStellar(): Promise<void> {
  const address = stellarReceiveAddress();
  const since = await memoWatchedSince("Stellar");
  if (!address || !liveReady("Stellar") || !since) return;
  const key = "scan:stellar";
  let at = (await cursor(key)) as string | null;
  for (let page = 0; page < 5; page++) {
    const { list, cursor: next } = await stellarArrivals(at, new Date(since.getTime() - 120_000));
    for (const p of list) await takeArrival({ network: "Stellar", coin: p.coin, token: p.coin, micros: p.micros, from: p.from, to: address, memo: p.memo, tx: p.tx, session: `stellar:${p.id}` });
    if (next && next !== at) await saveCursor(key, next);
    if (!list.length || !next || next === at) break;
    at = next;
  }
}

async function scanTon(): Promise<void> {
  const address = tonReceiveAddress();
  const since = await memoWatchedSince("TON");
  if (!address || !liveReady("TON") || !since) return;
  const list = await tonArrivals();
  for (const t of [...list].reverse()) {
    if (t.at.getTime() < since.getTime() - 120_000) continue;
    await takeArrival({ network: "TON", coin: "USDT", token: "USDT", micros: t.micros, from: t.from, to: address, memo: t.memo, tx: t.tx, session: `ton:${t.session}` });
  }
}

// ─── Late looks at closed payments' own addresses ─────────────────────────

const ERC20_BALANCE = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);
/** How often a closed payment's own address is looked at: often at first, then less. */
const lookEvery = (closedAgo: number) => (closedAgo < 3_600_000 ? 2 * 60_000 : closedAgo < 6 * 3_600_000 ? 15 * 60_000 : 2 * 3_600_000);

/**
 * Closed payments' own addresses on the EVM chains and Solana, for anything
 * that arrived after the scan stopped watching them. On an EVM chain a balance
 * bigger than everything recorded there accounts for means a transfer we
 * haven't seen: the recent blocks are searched for it, and if it isn't found
 * it's recorded without a sender - the customer is asked where it goes.
 * Movement's own addresses are watched by the scan itself for these days.
 */
async function lookLate(): Promise<void> {
  const closed = await prisma.payment.findMany({
    where: { ...LIVE_CRYPTO, depositKind: "OWN", status: { not: "OPEN" }, network: { not: "Movement" }, expiresAt: { gt: new Date(Date.now() - LOOK_FOR_MS) }, depositAddress: { not: null } },
    orderBy: [{ lookedAt: { sort: "asc", nulls: "first" } }],
    take: 40,
  });
  let looked = 0;
  for (const p of closed) {
    const closedAt = (p.paidAt ?? p.expiresAt).getTime();
    if (p.lookedAt && Date.now() - p.lookedAt.getTime() < lookEvery(Date.now() - closedAt)) continue;
    if (looked++ >= 10) break;
    try {
      if (p.network === "Solana") await lookSolana(p);
      else {
        const c = evmChain(p.network!);
        if (c && c.url()) await lookEvm(c, p);
      }
      await prisma.payment.update({ where: { id: p.id }, data: { lookedAt: new Date() } });
    } catch (e) {
      log.warn("[crypto-in] couldn't look at a closed payment's address", { ref: p.ref, reason: reason(e) });
    }
  }
}

async function lookSolana(p: Payment): Promise<void> {
  if (!env.SOLANA_RPC_URL) return;
  // Lapsed with nothing sent: the token account we opened for it is closed, and its SOL comes back.
  if (p.status === "EXPIRED" && !(await prisma.cryptoArrival.count({ where: { paymentId: p.id } })) && p.expiresAt.getTime() + LATE_GRACE_MS + 10 * 60_000 < Date.now()) {
    await closeEmptySolana(p).catch((e) => log.warn("[crypto-in] couldn't close an empty Solana account", { ref: p.ref, reason: reason(e) }));
  }
  for (const [coin, mint] of Object.entries(SOL_MINTS) as [Coin, string][]) {
    const account = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(p.depositAddress!)).toBase58();
    await solanaInto(p.depositAddress!, account, coin, mint, { since: p.createdAt.getTime() - 60_000, limit: 10 });
  }
}

async function lookEvm(c: EvmChain, p: Payment): Promise<void> {
  const url = c.url()!;
  const address = p.depositAddress!;
  // Something still being moved out of it: its balance can't be read cleanly yet.
  const busy = await prisma.cryptoArrival.count({ where: { toAddress: address, network: c.network, OR: [{ sweepingAt: { not: null }, sweptAt: null }, { returnStatus: { in: ["QUEUED", "SENDING", "CONFIRMING"] } }] } });
  if (busy) return;
  const tokens = c.native ? [{ coin: c.native.coin, address: "native", decimals: c.native.decimals }] : contractsOf(c);
  for (const t of tokens) {
    const raw =
      t.address === "native"
        ? BigInt(await rpc<string>(url, "eth_getBalance", [address, "latest"]))
        : BigInt(await rpc<string>(url, "eth_call", [{ to: t.address, data: ERC20_BALANCE.encodeFunctionData("balanceOf", [address]) }, "latest"]));
    const held = toMicros(raw, t.decimals);
    const here = await prisma.cryptoArrival.findMany({ where: { toAddress: address, network: c.network, ...(c.native ? {} : { token: t.address }) } });
    // What should be there: everything that came, less what was swept and what went back.
    const expected = here.reduce((s, x) => s + x.micros - (x.sweptAt ? x.usedMicros : 0n) - (x.returnStatus === "RETURNED" ? (x.returnMicros ?? 0n) : 0n), 0n);
    const unexplained = held - expected;
    if (unexplained <= TOLERANCE) continue;
    // Search the recent blocks for it, a bounded number of windows back from the tip.
    const tip = hexNum(await rpc<string>(url, "eth_blockNumber", [])) - (c.confirmations - 1);
    const back = Math.ceil((Date.now() - (p.lookedAt ?? p.paidAt ?? p.expiresAt).getTime() + 120_000) / 1000 / c.blockSeconds);
    let found = false;
    if (t.address !== "native") {
      await logsBetween(
        c,
        url,
        { address: [t.address], topics: [TRANSFER, null, [topicOf(address)]] },
        Math.max(0, tip - back),
        tip,
        async (logs) => {
          for (const l of logs) {
            const isNew = await takeArrival({ network: c.network, coin: t.coin, token: t.address, micros: toMicros(BigInt(l.data), t.decimals), from: l.topics[1] ? `0x${l.topics[1].slice(-40)}` : null, to: address, tx: l.transactionHash, session: `${l.transactionHash}:${hexNum(l.logIndex)}` });
            found ||= isNew;
          }
        },
        40,
      ).catch(() => {});
    }
    // Not found in time: recorded as it stands, with no sender - the customer is asked where it goes.
    if (!found) await takeArrival({ network: c.network, coin: t.coin, token: t.address, micros: unexplained, from: null, to: address, tx: "unknown", session: `late:${p.id}:${t.address}:${held}` });
  }
}

// ─── The worker's rounds ──────────────────────────────────────────────────

let round = 0;
/** Every network with a payment open (or still watched), each on its own - one that fails doesn't hold up the rest. */
export async function scanCrypto(): Promise<void> {
  const jobs: [string, () => Promise<void>][] = [
    ...EVM_CHAINS.filter((c) => liveReady(c.network)).map((c) => [c.network, () => scanEvm(c)] as [string, () => Promise<void>]),
    ["Solana", scanSolana],
    ["Movement", scanMovement],
    ["Stellar", scanStellar],
    ["TON", scanTon],
  ];
  await Promise.all(jobs.map(([name, run]) => run().catch((e) => log.warn("[crypto-in] couldn't read the network just now", { network: name, reason: reason(e) }))));
  await settleLapsed().catch((e) => log.warn("[crypto-in] couldn't settle lapsed payments", { reason: reason(e) }));
  // Every twelfth round, about a minute: closed payments' addresses.
  if (round++ % 12 === 0) await lookLate().catch((e) => log.warn("[crypto-in] late look failed", { reason: reason(e) }));
}
/** The worker's old name for it. */
export const scanMonad = scanCrypto;

/** Stellar's account and trustlines, and whether TON's indexer answers - what decides whether they're offered. */
export async function refreshNetworks(): Promise<void> {
  await Promise.all([refreshStellar().catch(() => {}), refreshTon().catch(() => {})]);
}

// ─── The checkout's own look ──────────────────────────────────────────────

export type Seen = { tx: string; confirmations: number; needed: number };
const watched = new Map<string, { at: number; seen: Seen | null }>();

/**
 * A live EVM payment, looked for on the chain itself while its checkout is
 * open - so the customer sees their transfer the moment it lands and the
 * confirmations count up, instead of waiting for the worker's next round.
 * Once it has enough, it's recorded exactly as the worker would. At most one
 * look every few seconds per payment, however often the page asks. The other
 * networks are read by the worker alone.
 */
export async function watchLiveCrypto(p: Payment): Promise<Seen | null> {
  if (p.status !== "OPEN" || p.method !== "CRYPTO" || p.mode !== "LIVE" || p.cryptoMicros == null || !p.coin || !p.network) return null;
  const c = evmChain(p.network);
  const url = c?.url();
  const tokens = c ? contractsOf(c).filter((t) => t.coin === p.coin) : [];
  const own = p.depositKind === "OWN" && !!p.depositAddress;
  const to = own ? p.depositAddress! : env.TREASURY_EVM_ADDRESS;
  if (!c || !url || !tokens.length || !to) return null;
  const last = watched.get(p.id);
  if (last && Date.now() - last.at < 2_500) return last.seen;
  if (watched.size > 2_000) for (const [id, w] of watched) if (Date.now() - w.at > 30 * 60_000) watched.delete(id);
  watched.set(p.id, { at: Date.now(), seen: last?.seen ?? null });
  try {
    const tip = hexNum(await rpc<string>(url, "eth_blockNumber", []));
    const logs = await rpc<Log[]>(url, "eth_getLogs", [{ address: tokens.map((t) => t.address), topics: [TRANSFER, null, topicOf(to)], fromBlock: toHex(tip - c.watch + 1), toBlock: toHex(tip) }]);
    const decimalsOf = (addr: string) => tokens.find((t) => sameHex(t.address, addr))?.decimals ?? 6;
    // Its own address: any transfer in is this payment's. The treasury: only its exact amount.
    const hits = logs.filter((l) => own || toMicros(BigInt(l.data), decimalsOf(l.address)) === p.cryptoMicros);
    const hit = hits[hits.length - 1];
    if (!hit) return last?.seen ?? null;
    const confirmations = tip - hexNum(hit.blockNumber) + 1;
    const seen: Seen = { tx: hit.transactionHash, confirmations: Math.min(confirmations, c.confirmations), needed: c.confirmations };
    watched.set(p.id, { at: Date.now(), seen });
    for (const l of hits) {
      if (tip - hexNum(l.blockNumber) + 1 < c.confirmations) continue;
      await takeArrival({ network: c.network, coin: p.coin as Coin, token: l.address, micros: toMicros(BigInt(l.data), decimalsOf(l.address)), from: l.topics[1] ? `0x${l.topics[1].slice(-40)}` : null, to, tx: l.transactionHash, session: `${l.transactionHash}:${hexNum(l.logIndex)}` });
    }
    return seen;
  } catch (e) {
    log.warn("[crypto-in] couldn't look for a payment on chain just now", { ref: p.ref, network: p.network, reason: reason(e) });
    return last?.seen ?? null;
  }
}
