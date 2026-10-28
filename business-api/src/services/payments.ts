/**
 * A payment, from the customer opening a checkout to the money landing.
 *
 *  1. open - the rail opens an account for exactly this amount, for 30 minutes;
 *  2. check - the rail is asked whether a transfer arrived. The worker asks
 *     every few seconds; the checkout asks when the customer says they've paid;
 *  3. confirm - what arrived is recorded once, our fee comes off, and the
 *     settlement is created in the same transaction: one per payment;
 *  4. settle - the settlement goes to the rail at once, then is followed until
 *     the bank confirms. A failure stops there for ops. Nothing is resent by
 *     itself, and the business sees it as on its way, never as failed. A live
 *     payout bigger than the review limit waits for a person first.
 */
import { createHash } from "crypto";
import { Prisma, type Business, type Currency, type FeePayer, type Invoice, type Mode, type Outlet, type PayMethod, type Payment, type PaymentLink, type SettleChain, type Settlement } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { paymentReceivedEmail, receiptEmail, sendEmail } from "../lib/email";
import { ownersOf } from "./application";
import { tellSettlement } from "../lib/app-links";
import { checkoutLink } from "../lib/pay-links";
import { ngnPerUsd } from "../lib/rates";
import {
  LATE_GRACE_MS,
  PAY_WINDOW_MS,
  centsToKobo,
  formatMinor,
  koboToCents,
  cryptoFeeFor,
  nairaFeeFor,
  newCheckoutToken,
  newPaymentRef,
  newSettlementRef,
  railRef,
  toMinor,
} from "../lib/money";
import { canSimulate, railsFor } from "../rails";
import { chainPaused, cryptoDefaults, effectiveChain, forMode, limitsFor, nairaDefaults, needsReview, payoutsOn, platform, reviewLimits, type Platform } from "../lib/platform";
import { floatSend, floatTxStatus, NotSent, type FloatChain, type Sent } from "../lib/float";
import { stellarFromSolana } from "../lib/stellar";
import { linkAddress } from "../lib/app-links";
import { appPayReady, readAppPayments } from "../lib/app-pay";
import { verifyAppTransfer } from "../lib/app-pay-verify";
import type { Arrival, PayoutState } from "../rails/types";
import { COIN_NETWORKS, offeredAccept, type Coin, type Network } from "../lib/accept";
import { env } from "../config/env";
import { paymentEvent, settlementEvent } from "./events";
import { askRefund } from "./refunds";
import { overDailyLimit } from "../lib/risk";
import { methodsOpen } from "../lib/methods";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A line in a settlement's timeline - what the system did, or what an admin did. */
export function logSettlement(settlementId: string, kind: string, detail?: Prisma.InputJsonValue, by = "system") {
  return prisma.settlementEvent
    .create({ data: { settlementId, kind, detail, by } })
    .catch((e) => log.error("[settle] couldn't write a timeline event", { settlementId, kind, reason: reason(e) }));
}

// ─── 1. Open ──────────────────────────────────────────────────────────────

export interface OpenInput {
  email?: string;
  name?: string;
  phone?: string;
  /** For a link without a set price: what the customer typed, in naira or dollars. */
  amount?: number;
  currency?: Currency;
}

/**
 * What a customer pays through: a payment link, an invoice or an outlet's
 * counter QR. Each has its own price (set, or typed by the customer), its own
 * ways to pay, and its own place for the money to settle.
 */
export type Checkout = {
  kind: "link" | "invoice" | "outlet";
  id: string;
  business: Business;
  mode: Mode;
  currency: Currency;
  /** A set price in the currency's minor units; null when the customer types it. */
  amountMinor: number | null;
  minMinor: number | null;
  methods: PayMethod[];
  /** Coins and networks for crypto, as kept; null is every one switched on. */
  accept: Prisma.JsonValue | null;
  active: boolean;
  /**
   * Who pays our fee here, per way to pay: this checkout's own choice when it
   * has one (which covers every way), else the business's default for that
   * way. The Money Moves app is free, so nobody pays for it.
   */
  feePayer: Record<PayMethod, "BUSINESS" | "CUSTOMER">;
};

/** A checkout's own choice covers every way to pay; without one, each way follows the business. */
const payers = (own: FeePayer | null, b: Business): Record<PayMethod, FeePayer> =>
  own ? { NAIRA: own, CRYPTO: own, APP: own } : { NAIRA: b.feePayer, CRYPTO: b.feePayerCrypto, APP: "BUSINESS" };

export const fromLink = (l: PaymentLink & { business: Business }): Checkout => ({
  kind: "link", id: l.id, business: l.business, mode: l.mode, currency: l.currency, amountMinor: l.amountMinor, minMinor: l.minMinor, methods: l.methods, accept: l.accept, active: l.active && !l.deletedAt && !(l.expiresAt && l.expiresAt.getTime() <= Date.now()), feePayer: payers(l.feePayer, l.business),
});
/** An invoice takes one payment, for its total, while it's waiting to be paid. */
export const fromInvoice = (i: Invoice & { business: Business }): Checkout => ({
  kind: "invoice", id: i.id, business: i.business, mode: i.mode, currency: i.currency, amountMinor: i.amountMinor, minMinor: null, methods: i.methods, accept: i.accept, active: i.status === "OPEN", feePayer: payers(i.feePayer, i.business),
});
/** An outlet: the customer types the amount. */
export const fromOutlet = (o: Outlet & { business: Business }): Checkout => ({
  kind: "outlet", id: o.id, business: o.business, mode: o.mode, currency: o.currency, amountMinor: null, minMinor: null, methods: o.methods, accept: o.accept, active: o.active && !o.deletedAt, feePayer: payers(o.feePayer, o.business),
});

const CHANNEL = { link: "links", invoice: "invoices", outlet: "outlets" } as const;
const INACTIVE = { link: "This link isn't taking payments right now.", invoice: "This invoice isn't waiting for a payment.", outlet: "This store isn't taking payments right now." };
const PAUSED = { link: "Payment links are paused right now. Try again a little later.", invoice: "Invoices are paused right now. Try again a little later.", outlet: "Store payments are paused right now. Try again a little later." };

/** What the customer has to send, and its dollar side - inside the limits for this business and the way it's paid. */
function priceFor(c: Checkout, input: OpenInput, rate: number, limits: { minKobo: number; maxKobo: number; how?: string }): { amountKobo: number; amountCents: number } {
  const { minKobo: MIN_KOBO, maxKobo: MAX_KOBO } = limits;
  // Each way to pay has its own limits: say which, so the customer can pick another.
  const tooBig = (fallback: string) => (limits.how ? `${limits.how} goes up to ${formatMinor(MAX_KOBO, "NGN")} here. Choose another way to pay.` : fallback);
  const tooSmall = () => (limits.how ? `${limits.how} starts at ${formatMinor(MIN_KOBO, "NGN")} here. Choose another way to pay.` : `The least one payment can be is ${formatMinor(MIN_KOBO, "NGN")}.`);
  if (c.amountMinor != null) {
    const p = c.currency === "NGN" ? { amountKobo: c.amountMinor, amountCents: koboToCents(c.amountMinor, rate) } : { amountKobo: centsToKobo(c.amountMinor, rate), amountCents: c.amountMinor };
    if (p.amountKobo > MAX_KOBO) throw new HttpError(400, tooBig(`This ${c.kind === "invoice" ? "invoice" : "price"} is more than one payment can be.`), "above_maximum");
    if (p.amountKobo < MIN_KOBO) throw new HttpError(400, tooSmall(), "below_minimum");
    return p;
  }
  if (!input.amount || !(input.amount > 0)) throw new HttpError(400, "Enter the amount you're paying.", "amount_required");
  const typedIn = input.currency ?? c.currency;
  const minor = toMinor(input.amount);
  const amountKobo = typedIn === "NGN" ? minor : centsToKobo(minor, rate);
  const amountCents = typedIn === "NGN" ? koboToCents(minor, rate) : minor;
  if (c.minMinor != null && (c.currency === "NGN" ? amountKobo : amountCents) < c.minMinor) {
    throw new HttpError(400, `The least you can pay here is ${formatMinor(c.minMinor, c.currency)}.`, "below_minimum");
  }
  if (amountKobo > MAX_KOBO) throw new HttpError(400, tooBig(`The most one payment can be is ${formatMinor(MAX_KOBO, "NGN")}.`), "above_maximum");
  if (amountKobo < MIN_KOBO) throw new HttpError(400, tooSmall(), "below_minimum");
  return { amountKobo, amountCents };
}

const METHOD_OFF: Record<PayMethod, string> = {
  NAIRA: "This checkout doesn't take bank transfers.",
  APP: "This checkout doesn't take the Money Moves app.",
  CRYPTO: "This checkout doesn't take crypto.",
};
const METHOD_PAUSED: Record<PayMethod, string> = {
  NAIRA: "Bank transfers are paused right now. Try again a little later.",
  APP: "Money Moves app payments are paused right now. Try again a little later.",
  CRYPTO: "Crypto payments are paused right now. Try again a little later.",
};

/** Whether this checkout can start a payment this way, now - and at what price. */
export async function admit(c: Checkout, method: PayMethod, input: OpenInput) {
  if (!c.active) throw new HttpError(410, INACTIVE[c.kind], c.kind === "link" ? "link_inactive" : "checkout_inactive");
  if (c.business.status === "SUSPENDED") throw new HttpError(403, "This business isn't taking payments right now.", "business_suspended");
  if (!c.methods.includes(method)) throw new HttpError(400, METHOD_OFF[method], "method_off");
  if (!(await methodsOpen(c.business, c.mode)).has(method)) throw new HttpError(400, METHOD_OFF[method], "method_off");
  // Live app payments need the app's side switched on; in test mode the simulator stands in.
  if (method === "APP" && c.mode === "LIVE" && !appPayReady()) throw new HttpError(503, "Paying with the Money Moves app isn't switched on yet. Use a bank transfer or stablecoins.", "method_unavailable");
  if (c.mode === "LIVE" && c.business.status !== "VERIFIED") throw new HttpError(403, "This business can't take payments yet.", "business_unverified");
  const p = forMode(await platform(), c.mode);
  if (!p.channels[CHANNEL[c.kind]]) throw new HttpError(503, PAUSED[c.kind], "channel_paused");
  if (!p.methods[method === "NAIRA" ? "naira" : method === "APP" ? "app" : "crypto"]) throw new HttpError(503, METHOD_PAUSED[method], "method_paused");
  const rate = await ngnPerUsd();
  const price = priceFor(c, input, rate, limitsFor(p, c.business, c.mode, method));
  // The customer pays the fee: added on top, so the business receives its full price.
  if (c.feePayer[method] === "CUSTOMER") {
    const fee = feeOn(method, price.amountKobo, rate, await platform(), c.business);
    if (fee > 0) return { p, rate, amountKobo: price.amountKobo + fee, amountCents: price.amountCents + koboToCents(fee, rate), customerFeeKobo: fee };
  }
  return { p, rate, ...price, customerFeeKobo: null as number | null };
}

/** The payment's row - made before anything is opened for it, so nothing exists that isn't ours. */
export async function newPayment(c: Checkout, input: OpenInput, method: PayMethod, price: { rate: number; amountKobo: number; amountCents: number; customerFeeKobo?: number | null }, extra: Partial<Prisma.PaymentUncheckedCreateInput> = {}) {
  const { rate, amountKobo, amountCents } = price;
  extra = { customerFeeKobo: price.customerFeeKobo ?? null, ...extra };
  let payment: Payment | null = null;
  for (let attempt = 0; attempt < 4 && !payment; attempt++) {
    try {
      payment = await prisma.payment.create({
        data: {
          ref: newPaymentRef(),
          token: newCheckoutToken(),
          businessId: c.business.id,
          linkId: c.kind === "link" ? c.id : null,
          invoiceId: c.kind === "invoice" ? c.id : null,
          outletId: c.kind === "outlet" ? c.id : null,
          mode: c.mode,
          method,
          currency: c.currency,
          amountKobo,
          amountCents,
          ngnPerUsd: rate,
          customerEmail: input.email ?? null,
          customerName: input.name ?? null,
          customerPhone: input.phone ?? null,
          expiresAt: new Date(Date.now() + PAY_WINDOW_MS),
          ...extra,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  if (!payment) throw new HttpError(500, "We couldn't start this payment. Try again.", "create_failed");
  return payment;
}

export async function openNairaPayment(c: Checkout, input: OpenInput): Promise<Payment> {
  const price = await admit(c, "NAIRA", input);
  const { amountKobo } = price;
  const rails = railsFor(c.mode);
  // The row first, so every account we ever open belongs to a payment we know about.
  const payment = await newPayment(c, input, "NAIRA", price);

  try {
    const acct = await rails.openAccount({ reference: railRef(payment.ref), amountKobo, expiresAt: payment.expiresAt, merchantName: c.business.name, businessId: c.business.id, email: input.email });
    return await prisma.payment.update({ where: { id: payment.id }, data: { accountBank: acct.bank, accountNumber: acct.number, accountName: acct.name, providerRef: acct.providerRef } });
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "EXPIRED" } });
    log.error("[payments] couldn't open an account", { ref: payment.ref, reason: reason(e) });
    // Something the payer can act on (try another way to pay) is passed on as it is.
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, "We couldn't open an account for this payment. Try again in a moment.", "account_failed");
  }
}

/** Networks whose addresses are hex - EVM chains, and Movement's longer form. */
const HEX_NETWORKS = new Set<string>(["Movement", "Base", "BNB Chain", "Arc", "Monad", "Arbitrum", "Ethereum", "Optimism"]);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * A test deposit address, shaped like the network's - and deliberately one no
 * wallet will send to: "TEST" isn't hex, and 0 isn't in base58. A real coin
 * can't be lost to a test checkout.
 */
export function testAddress(network: string, seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  if (HEX_NETWORKS.has(network)) return `0xTEST${h.toString("hex").slice(0, network === "Movement" ? 60 : 36)}`;
  const body = [...h, ...createHash("sha256").update(h).digest()].map((b) => B58[b % B58.length]).join("");
  if (network === "Stellar") return `GTEST0${body.slice(0, 50).toUpperCase()}`;
  return `TEST0${body.slice(0, network === "TON" ? 43 : 39)}`;
}

/**
 * The Money Moves app, or crypto - in test mode, where the simulator stands in
 * for the app's approval and for the network. Nothing is opened anywhere: the
 * payment waits for the test checkout to say it was approved, or that a
 * deposit arrived, and lapses like any other if it doesn't.
 */
export async function openSimulatedPayment(c: Checkout, input: OpenInput, method: "APP" | "CRYPTO", crypto?: { coin: string; network: string }): Promise<Payment> {
  const price = await admit(c, method, input);
  if (method === "APP") return newPayment(c, input, "APP", price);
  const coin = crypto?.coin as Coin | undefined;
  const network = crypto?.network as Network | undefined;
  const offered = offeredAccept(c.accept, price.p);
  if (!coin || !network || !COIN_NETWORKS[coin]?.includes(network) || !offered[coin]?.includes(network)) {
    throw new HttpError(400, "Pick a coin and a network this checkout takes.", "bad_coin");
  }
  const payment = await newPayment(c, input, "CRYPTO", price, { coin, network });
  return prisma.payment.update({ where: { id: payment.id }, data: { depositAddress: testAddress(network, payment.token) } });
}

// ─── 2. Check ─────────────────────────────────────────────────────────────

/** Asks the rail about one open payment, and records what it says. */
/** The app's names for the chains it sends on. */
const APP_CHAIN_NAME: Record<string, string> = { MOVE: "Movement", SOL: "Solana", BASE: "Base", BEP20: "BNB Chain", ARC: "Arc", MONAD: "Monad" };

export async function checkPayment(p: Payment): Promise<Payment> {
  if (p.status !== "OPEN") return p;
  if (p.method === "NAIRA") {
    if (!p.accountNumber) return p;
    const arrival = await railsFor(p.mode).findArrival(railRef(p.ref));
    if (arrival) return confirmArrival(p, arrival);
  }
  // A live app payment: the app says once the customer's send is on chain.
  if (p.method === "APP" && p.mode === "LIVE" && p.providerRef) {
    const [app] = await readAppPayments([p.providerRef]);
    if (app?.status === "PAID" && app.txHash) {
      /**
       * Not on the app's word. The transaction it names is read from the chain:
       * it must have succeeded and moved this payment's amount of the right
       * coin to our treasury, and must not already have paid another checkout.
       * Unreadable right now: look again next round.
       */
      const verified = await verifyAppTransfer({ chain: app.chain ?? "", asset: app.asset ?? "", txHash: app.txHash, micros: BigInt(p.amountCents) * 10_000n });
      if (verified === null) return p;
      const reused =
        (await prisma.payment.count({ where: { payerSession: app.txHash, id: { not: p.id } } })) +
        (await prisma.refund.count({ where: { fundTx: app.txHash } })) +
        // A business's own wallet send into the treasury is never a customer's app payment.
        (await prisma.walletSend.count({ where: { txHash: { equals: app.txHash, mode: "insensitive" } } }));
      if (!verified || reused) {
        log.warn("[app-pay] the app reported a payment the chain doesn't back, not settled, for ops to look at", { ref: p.ref, chain: app.chain, asset: app.asset, tx: app.txHash, reused: reused > 0 });
        return p;
      }
      const who = app.username ? `@${app.username}` : null;
      return confirmArrival(p, {
        amountKobo: p.amountKobo,
        payerName: who,
        payerBank: `Money Moves · ${app.asset === "USDCx" ? "USDC" : app.asset} on ${APP_CHAIN_NAME[app.chain ?? ""] ?? app.chain}`,
        payerAccount: who,
        session: app.txHash,
      });
    }
  }
  // Test app and crypto payments have no rail to ask - the test checkout says when they're paid.
  // Closed with nothing - after a few minutes' grace for a transfer already on its way.
  const late = Date.now() > p.expiresAt.getTime() + LATE_GRACE_MS;
  const lapsed = await prisma.payment.updateMany({ where: { id: p.id, status: "OPEN" }, data: late ? { status: "EXPIRED", lastCheckedAt: new Date() } : { lastCheckedAt: new Date() } });
  const now = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (late && lapsed.count) void paymentEvent(now);
  return now;
}

// ─── 3. Confirm ───────────────────────────────────────────────────────────

/**
 * Our fee on what arrived, by how it was paid: bank transfer at the business's
 * own rate or the default, capped in naira; crypto at the crypto rate, capped
 * in dollars at the payment's rate; the Money Moves app at the app rate (free
 * for now).
 */
/** What a business's own rates look like, where our team has set any of them. */
export type OwnFees = { feeRateBps: number | null; feeCapKobo: number | null; cryptoRateBps: number | null; cryptoCapCents: number | null };
export const OWN_FEES = { feeRateBps: true, feeCapKobo: true, cryptoRateBps: true, cryptoCapCents: true } as const;

/** Our fee on an amount, by how it's paid: the app's rate, crypto capped in dollars, naira capped in naira - each at the business's own rate when it has one. */
function feeOn(method: PayMethod, kobo: number, ngnPerUsd: number, plat: Awaited<ReturnType<typeof platform>>, pricing: OwnFees): number {
  if (method === "APP") return Math.round((kobo * plat.fees.appRateBps) / 10_000);
  if (method === "CRYPTO") return cryptoFeeFor(kobo, ngnPerUsd, pricing, cryptoDefaults(plat));
  return nairaFeeFor(kobo, pricing, nairaDefaults(plat));
}

async function feeFor(p: Payment, receivedKobo: number): Promise<number> {
  // The customer paid it on top: that's the fee, and the business keeps its full price.
  if (p.customerFeeKobo != null) return p.customerFeeKobo;
  const pricing = await prisma.business.findUniqueOrThrow({ where: { id: p.businessId }, select: OWN_FEES });
  return feeOn(p.method, receivedKobo, p.ngnPerUsd, await platform(), pricing);
}

/**
 * Test mode: what the test checkout says arrived - an approval in the app, or a
 * deposit - recorded as if it had. On staging a live app payment runs on the
 * simulator too, the way a live bank transfer there does.
 */
export function confirmSimulated(p: Payment, a: Arrival): Promise<Payment> {
  if (p.mode !== "TEST" && !(p.method === "APP" && canSimulate(p.mode))) throw new HttpError(404, "Nothing here.", "not_found");
  return confirmArrival(p, a);
}

export async function confirmArrival(p: Payment, a: Arrival): Promise<Payment> {
  // No tolerance yet: anything short is held, not settled.
  const full = a.amountKobo >= p.amountKobo;
  const feeKobo = await feeFor(p, a.amountKobo);
  let created: Settlement | null = null;
  let recorded = false;
  // An invoice another payment already paid: this money isn't the business's to keep, so it goes straight back.
  let duplicate = false;

  const after = await prisma.$transaction(async (tx) => {
    // Whoever gets here first records it; anyone after finds it no longer open.
    const moved = await tx.payment.updateMany({
      where: { id: p.id, status: "OPEN" },
      data: {
        status: full ? "PAID" : "UNDERPAID",
        receivedKobo: a.amountKobo,
        payerName: a.payerName,
        payerBank: a.payerBank,
        payerAccount: a.payerAccount,
        payerSession: a.session,
        paidAt: new Date(),
        feeKobo: full ? feeKobo : null,
        lastCheckedAt: new Date(),
      },
    });
    recorded = moved.count === 1;
    if (moved.count === 1 && full && p.invoiceId) {
      const closed = await tx.invoice.updateMany({ where: { id: p.invoiceId, status: "OPEN" }, data: { status: "PAID", paidAt: new Date() } });
      if (!closed.count) {
        duplicate = true;
        await tx.payment.update({ where: { id: p.id }, data: { feeKobo: 0 } });
      }
    }
    if (moved.count === 1 && full && !duplicate) {
      const { data, why: ruled } = await settlementFor(tx, p, a.amountKobo - feeKobo, feeKobo);
      // Sent well over what was asked (more than ₦100 or 1%): a person checks it, so a small checkout
      // can't carry a transfer past its limits or the business's payout review.
      const over = p.mode === "LIVE" && a.amountKobo > p.amountKobo + Math.max(10_000, Math.round(p.amountKobo / 100));
      const why = ruled ?? (over && data.status === "QUEUED" ? { reason: "overpaid", askedNgn: p.amountKobo / 100, receivedNgn: a.amountKobo / 100 } : null);
      if (why && !ruled) data.status = "REVIEW";
      const s = await tx.settlement.create({ data });
      await tx.settlementEvent.create({ data: { settlementId: s.id, kind: "created", detail: { status: s.status, destination: s.destination, amountKobo: s.amountKobo, feeKobo } } });
      if (why) await tx.settlementEvent.create({ data: { settlementId: s.id, kind: "review", detail: why } });
      created = s;
    }
    return tx.payment.findUniqueOrThrow({ where: { id: p.id } });
  });

  // Straight to the rail - a settlement never waits for a batch.
  if (created) void sendSettlement(created);
  // Paid twice: nothing settles, and the second payment goes back to the customer like an underpayment does.
  if (duplicate) void refundDuplicate(after).catch((e) => log.error("[paid] a second payment on a paid invoice wasn't sent back, for ops", { ref: after.ref, reason: reason(e) }));
  // The business's server hears it: paid, or part paid - and a settlement that's done the moment it's made (test mode's wallet).
  if (recorded) void paymentEvent(after);
  const made = created as Settlement | null;
  if (made && made.status === "SETTLED") void settlementEvent(made.id);
  // Paid in full, recorded by this call: the customer's receipt.
  if (created) void tellOwnersPaid(after).catch((e) => log.warn("[paid] owners not told", { ref: after.ref, reason: e instanceof Error ? e.message : String(e) }));
  if (created) void sendReceipt(after).catch((e) => log.warn("[receipt] not sent", { ref: after.ref, reason: e instanceof Error ? e.message : String(e) }));
  return after;
}

async function refundDuplicate(p: Payment): Promise<void> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: p.businessId } });
  await askRefund({ business, paymentId: p.id, held: true, reason: "This invoice was already paid, so the second payment goes back.", by: "system" });
  log.warn("[paid] a paid invoice was paid again, sent back", { ref: p.ref });
}

const EXPLORER: Record<string, string> = {
  Monad: "https://monadscan.com/tx/",
  Movement: "https://explorer.movementnetwork.xyz/txn/",
  Base: "https://basescan.org/tx/",
  "BNB Chain": "https://bscscan.com/tx/",
  Solana: "https://solscan.io/tx/",
  Arc: "https://explorer.arc.io/tx/",
};

/**
 * The customer's receipt, to the email they gave at the checkout - live
 * payments only (a test checkout's email is often made up). Replies go to the
 * business's support email when it has one.
 */
async function sendReceipt(p: Payment): Promise<void> {
  if (p.mode !== "LIVE" || !p.customerEmail || p.status !== "PAID") return;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: p.businessId }, include: { application: true } });
  const what = p.linkId
    ? (await prisma.paymentLink.findUnique({ where: { id: p.linkId }, select: { name: true } }))?.name
    : p.invoiceId
      ? `Invoice ${(await prisma.invoice.findUnique({ where: { id: p.invoiceId }, select: { number: true } }))?.number ?? ""}`.trim()
      : p.outletId
        ? (await prisma.outlet.findUnique({ where: { id: p.outletId }, select: { name: true } }))?.name
        : null;
  const naira = `₦${(p.amountKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dollars = `${(p.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // The chain a crypto or app payment came in on, by name: "USDC on Monad", "Money Moves · USDC on Movement".
  const network = p.method === "CRYPTO" ? p.network : p.payerBank?.match(/ on (.+)$/)?.[1] ?? null;
  const hash = (p.method === "CRYPTO" || p.method === "APP") && p.payerSession ? p.payerSession.split(":")[0]! : null;
  const method =
    p.method === "NAIRA" ? "Bank transfer" : p.method === "APP" ? (p.payerBank?.replace(/^Money Moves · /, "Money Moves app · ") ?? "Money Moves app") : `${p.coin ?? "Stablecoin"} on ${p.network ?? "chain"}`;
  const answers = (business.application?.answers ?? {}) as { supportEmail?: string };
  const brand = (business.brand ?? {}) as { success?: string };
  const m = receiptEmail({
    business: business.name,
    amount: p.currency === "NGN" ? naira : dollars,
    approx: p.currency === "NGN" ? `About ${dollars}` : `About ${naira}`,
    what: what || null,
    method,
    reference: p.ref,
    paidAt: p.paidAt ?? new Date(),
    tx: hash ? { short: `${hash.slice(0, 10)}…${hash.slice(-6)}`, url: network && EXPLORER[network] ? EXPLORER[network] + hash : null } : null,
    note: brand.success?.trim() || null,
    link: checkoutLink(`r/${p.token}`),
  });
  const replyTo = answers.supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.supportEmail) ? answers.supportEmail : undefined;
  await sendEmail(p.customerEmail, m.subject, m.text, { html: m.html, ...(replyTo ? { replyTo } : {}) });
}

/** The business's owners hear a payment came in, with the way to it in their dashboard. Live payments only. */
async function tellOwnersPaid(p: Payment): Promise<void> {
  if (p.mode !== "LIVE" || p.status !== "PAID") return;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: p.businessId } });
  const what = p.linkId
    ? (await prisma.paymentLink.findUnique({ where: { id: p.linkId }, select: { name: true } }))?.name
    : p.invoiceId
      ? `Invoice ${(await prisma.invoice.findUnique({ where: { id: p.invoiceId }, select: { number: true } }))?.number ?? ""}`.trim()
      : p.outletId
        ? (await prisma.outlet.findUnique({ where: { id: p.outletId }, select: { name: true } }))?.name
        : null;
  const naira = `₦${(p.amountKobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dollars = `${(p.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const method = p.method === "NAIRA" ? "Bank transfer" : p.method === "APP" ? "Money Moves app" : `${p.coin ?? "Stablecoin"} on ${p.network ?? "chain"}`;
  const m = paymentReceivedEmail({
    business: business.name,
    amount: p.currency === "NGN" ? naira : dollars,
    approx: p.currency === "NGN" ? `About ${dollars}` : `About ${naira}`,
    what: what || null,
    method,
    reference: p.ref,
    payer: p.customerName || p.customerEmail || null,
    paidAt: p.paidAt ?? new Date(),
  });
  for (const to of await ownersOf(p.businessId)) await sendEmail(to, m.subject, m.text, { html: m.html }).catch(() => false);
}

/**
 * Where this payment's money goes, as things stand right now - and what to
 * call it, kept on the settlement even if the account is removed later.
 *
 * A "Just me" business always settles to its business wallet. A link, an
 * invoice or an outlet set to a bank goes to its own account if that's still
 * there and checked, else the
 * default, else - like a Money Moves account that isn't linked - the business
 * wallet. Money Moves and the business wallet aren't connected yet, so live
 * payments headed there wait for ops (HELD); in test mode they're credited on
 * the spot, because nothing real has to move.
 *
 * A live bank payout bigger than the review limit waits for a person (REVIEW)
 * instead of going straight out - and so does every live payout of a business
 * our team has deactivated. Crypto payouts all wait for a person today,
 * as HELD; when the wallet is connected, only those over the crypto limit will.
 */
async function settlementFor(
  tx: Prisma.TransactionClient,
  p: Payment,
  amountKobo: number,
  feeKobo: number,
): Promise<{ data: Prisma.SettlementUncheckedCreateInput; why: Prisma.InputJsonValue | null }> {
  const business = await tx.business.findUniqueOrThrow({ where: { id: p.businessId } });
  // Where it goes is the checkout's own choice: the link's, the invoice's or the outlet's.
  const source = p.linkId
    ? await tx.paymentLink.findUnique({ where: { id: p.linkId } })
    : p.invoiceId
      ? await tx.invoice.findUnique({ where: { id: p.invoiceId } })
      : p.outletId
        ? await tx.outlet.findUnique({ where: { id: p.outletId } })
        : null;
  const rules = await platform();
  const places = rules.destinations;
  const base = { ref: newSettlementRef(), paymentId: p.id, businessId: p.businessId, mode: p.mode, amountKobo, feeKobo };
  let dest = business.kind === "INDIVIDUAL" ? "WALLET" : (source?.destination ?? "WALLET");

  if (p.mode === "TEST") {
    if (dest === "BANK") return { why: null, data: { ...base, destination: "BANK", status: "QUEUED", bankCode: "TEST", bankName: "Test Bank", accountNumber: "0000000001", accountName: business.name.toUpperCase() } };
    return { why: null, data: { ...base, destination: dest, status: "SETTLED", settledAt: new Date() } };
  }
  // Held for a person, before the payout size is even looked at: a deactivated business, or one past its daily limit.
  const over = business.status === "SUSPENDED" ? null : await overDailyLimit(tx, business, rules);
  const held = business.status === "SUSPENDED" ? { reason: "deactivated" } : over ? { reason: "daily_limit", ...over } : null;

  // Settling to a bank switched off on Services: it waits, like a business with no checked account.
  if (dest === "BANK" && places.bank) {
    const banks = await tx.bankAccount.findMany({ where: { businessId: p.businessId, removedAt: null, nameMatches: true }, orderBy: { createdAt: "asc" } });
    const pick = banks.find((b) => b.id === source?.bankAccountId) ?? banks.find((b) => b.isDefault) ?? banks[0];
    if (pick) {
      const why = held ?? (needsReview(rules, business, { kobo: amountKobo }) ? { limitNgn: reviewLimits(rules, business).nairaAboveNgn } : null);
      return {
        why,
        data: { ...base, destination: "BANK", status: why ? "REVIEW" : "QUEUED", bankAccountId: pick.id, bankCode: pick.bankCode, bankName: pick.bankName, accountNumber: pick.accountNumber, accountName: pick.accountName },
      };
    }
    dest = "WALLET";
  }
  if (dest === "MONEY_MOVES") {
    // The business's default linked account - its address on the settle chain is asked for when it's sent.
    const links = await tx.moneyMovesLink.findMany({ where: { businessId: p.businessId, status: "LINKED" }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], take: 1 });
    if (!places.moneyMoves || !links[0]) {
      return { why: null, data: { ...base, destination: "MONEY_MOVES", status: "HELD", failureReason: links[0] ? "Settling to Money Moves is paused right now." : "No linked Money Moves account." } };
    }
    const amountMicros = BigInt(Math.floor((amountKobo / 100 / p.ngnPerUsd) * 1e6));
    const why = held ?? (needsReview(rules, business, { usd: Number(amountMicros) / 1e6 }) ? { limitUsd: reviewLimits(rules, business).cryptoAboveUsd } : null);
    const chain = effectiveChain(business.settleChain, rules);
    return { why, data: { ...base, destination: "MONEY_MOVES", status: why ? "REVIEW" : "QUEUED", chain, amountMicros, providerRef: links[0].appLinkId, failureReason: pausedNote(chain, rules) } };
  }
  // The business wallet: USDC from the float, on the business's settle chain, to the owner's own address.
  const wallet = await tx.businessWallet.findUnique({ where: { businessId: p.businessId } });
  const chain = effectiveChain(business.settleChain, rules);
  // Stellar: the owner's Solana key re-encoded, as the app does it - opened for USDC from the dashboard first.
  const toAddress = wallet
    ? chain === "MOVEMENT"
      ? wallet.movementAddress
      : chain === "SOLANA"
        ? wallet.solanaAddress
        : chain === "STELLAR"
          ? wallet.solanaAddress && stellarFromSolana(wallet.solanaAddress)
          : wallet.evmAddress
    : null;
  if (!places.wallet || !toAddress) {
    return { why: null, data: { ...base, destination: "WALLET", status: "HELD", failureReason: wallet ? "Settling to the business wallet is paused right now." : "The business wallet hasn't been created yet." } };
  }
  const amountMicros = BigInt(Math.floor((amountKobo / 100 / p.ngnPerUsd) * 1e6));
  const usd = Number(amountMicros) / 1e6;
  const why = held ?? (needsReview(rules, business, { usd }) ? { limitUsd: reviewLimits(rules, business).cryptoAboveUsd } : null);
  return { why, data: { ...base, destination: "WALLET", status: why ? "REVIEW" : "QUEUED", chain, toAddress, amountMicros, failureReason: pausedNote(chain, rules) } };
}

const CHAIN_NAME: Record<string, string> = { MOVEMENT: "Movement", ARC: "Arc", MONAD: "Monad", SOLANA: "Solana", STELLAR: "Stellar" };
/** A chain switched off on Services: the settlement is made, and waits in the queue until it's back on. */
const pausedNote = (chain: SettleChain, rules: Platform) => (chainPaused(chain, rules) ? `Paying out on ${CHAIN_NAME[chain] ?? chain} is paused right now.` : null);

// ─── 4. Settle ────────────────────────────────────────────────────────────

/**
 * Hands a bank settlement to the rail - once, whoever calls it. Not at all
 * while payouts are switched off. A queued one whose business has been
 * deactivated goes to review instead; a person releases it from there (from:
 * "REVIEW"), straight to the rail, so nothing can hold it again on the way.
 */
export async function sendSettlement(s: Settlement, opts: { from?: "QUEUED" | "REVIEW" } = {}): Promise<void> {
  const from = opts.from ?? "QUEUED";
  if (s.status !== from) return;
  if (s.chain && s.amountMicros && (s.toAddress || (s.destination === "MONEY_MOVES" && s.providerRef))) return sendOnChain(s, from);
  if (s.destination !== "BANK") return;
  if (s.mode === "LIVE" && !(await payoutsOn())) return;
  if (from === "QUEUED" && s.mode === "LIVE") {
    const owner = await prisma.business.findUnique({ where: { id: s.businessId }, select: { status: true } });
    if (owner?.status === "SUSPENDED") {
      const held = await prisma.settlement.updateMany({ where: { id: s.id, status: "QUEUED" }, data: { status: "REVIEW" } });
      if (held.count) await logSettlement(s.id, "review", { reason: "deactivated" });
      return;
    }
  }
  const claimed = await prisma.settlement.updateMany({ where: { id: s.id, status: from }, data: { status: "SENDING", sentAt: new Date() } });
  if (claimed.count === 0) return;
  try {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId }, include: { business: true } });
    const state = await railsFor(s.mode).sendPayout({
      reference: s.ref,
      amountKobo: s.amountKobo,
      bankCode: s.bankCode!,
      accountNumber: s.accountNumber!,
      accountName: s.accountName ?? payment.business.name,
      // What the business sees in its bank app: who paid it out, not our internal reference.
      narration: `From ${env.FLUTTERWAVE_SENDER_NAME}`,
      // Only ever set through the simulator; the real rail ignores it.
      // Never for a test payment: test transactions always go through.
      simulateFailure: payment.mode === "LIVE" && payment.simFailSettlement,
    });
    await logSettlement(s.id, "sent", { ref: s.ref, to: `${s.bankName} ${s.accountNumber}`, answer: state.state });
    // The rail's own id for it, kept: the follow-up and any later check find it by that, however long ago it went.
    if (state.transferId) await prisma.settlement.update({ where: { id: s.id }, data: { providerRef: state.transferId } });
    await recordPayout(s.id, state);
  } catch (e) {
    // We can't tell whether the rail took it. It stays "sending", and the
    // follow-up asks the rail by our reference before anything else happens.
    log.warn("[settle] payout outcome unknown", { ref: s.ref, reason: reason(e) });
    await logSettlement(s.id, "send_unclear", { ref: s.ref, reason: reason(e) });
  }
}

/**
 * An on-chain settlement: USDC from the float. Claimed first, like a bank one,
 * so it's sent once. The transaction hash is written the moment it's out; from
 * then on only the chain is asked, and nothing is ever sent again for it.
 * A float that's too low puts it back in the queue to try again in a while.
 */
async function sendOnChain(s: Settlement, from: "QUEUED" | "REVIEW"): Promise<void> {
  if (s.mode === "LIVE" && !(await payoutsOn())) return;
  // Its chain switched off on Services: it waits, queued, and goes once the chain is back on.
  if (from === "QUEUED" && s.mode === "LIVE" && s.chain && chainPaused(s.chain, await platform())) return;
  if (from === "QUEUED" && s.mode === "LIVE") {
    const owner = await prisma.business.findUnique({ where: { id: s.businessId }, select: { status: true } });
    if (owner?.status === "SUSPENDED") {
      const held = await prisma.settlement.updateMany({ where: { id: s.id, status: "QUEUED" }, data: { status: "REVIEW" } });
      if (held.count) await logSettlement(s.id, "review", { reason: "deactivated" });
      return;
    }
  }
  // A Money Moves account: its address, from the app, before anything is claimed.
  if (!s.toAddress && s.destination === "MONEY_MOVES" && s.providerRef) {
    let address: string | null;
    try {
      address = await linkAddress(s.providerRef, s.chain as FloatChain);
    } catch (e) {
      await prisma.settlement.updateMany({ where: { id: s.id, status: from }, data: { failureReason: "Waiting for Money Moves to answer." } });
      log.warn("[settle] couldn't ask the app for the account's address, trying again soon", { ref: s.ref, reason: reason(e) });
      return;
    }
    if (!address) {
      const why = "The Money Moves account isn't linked any more, or has no address on this chain.";
      await prisma.settlement.updateMany({ where: { id: s.id, status: from }, data: { status: "HELD", failureReason: why } });
      await logSettlement(s.id, "held", { reason: why });
      return;
    }
    await prisma.settlement.update({ where: { id: s.id }, data: { toAddress: address } });
    s = { ...s, toAddress: address };
  }
  const claimed = await prisma.settlement.updateMany({ where: { id: s.id, status: from }, data: { status: "SENDING", sentAt: new Date() } });
  if (claimed.count === 0) return;
  let sent: Sent;
  try {
    sent = await floatSend(s.chain as FloatChain, s.toAddress!, s.amountMicros!);
  } catch (e) {
    if (e instanceof NotSent) {
      // Nothing left the float.
      if (e.retry) {
        await prisma.settlement.update({ where: { id: s.id }, data: { status: "QUEUED", failureReason: e.message } });
        await logSettlement(s.id, "waiting", { reason: e.message });
        log.warn("[settle] on-chain payout waiting", { ref: s.ref, reason: e.message });
      } else {
        await prisma.settlement.update({ where: { id: s.id }, data: { status: "FAILED", failureReason: e.message } });
        await logSettlement(s.id, "failed", { reason: e.message });
        log.warn("[settle] on-chain payout failed, waiting for ops", { ref: s.ref, reason: e.message });
      }
      return;
    }
    // It may have gone out without our hearing back. Its hash, when we have it, lets the follow-up ask the chain; nothing resends.
    const hash = (e as { txHash?: string }).txHash;
    if (hash) await prisma.settlement.update({ where: { id: s.id }, data: { txHash: hash } });
    log.warn("[settle] on-chain payout outcome unknown", { ref: s.ref, reason: reason(e), tx: hash ?? null });
    await logSettlement(s.id, "send_unclear", { reason: reason(e), ...(hash ? { tx: hash } : {}) });
    return;
  }
  await prisma.settlement.update({ where: { id: s.id }, data: { status: "SENT", txHash: sent.txHash, failureReason: null } });
  await logSettlement(s.id, "sent", { chain: s.chain, to: s.toAddress, tx: sent.txHash });
  sent.confirmed.then(
    () => recordPayout(s.id, { state: "settled" }),
    (e) => log.warn("[settle] on-chain confirmation unclear. The follow-up asks the chain", { ref: s.ref, reason: reason(e) }),
  );
}

/** Asks the rail how a sent payout is doing. */
export async function followUpSettlement(s: Settlement): Promise<void> {
  if (s.status !== "SENDING" && s.status !== "SENT") return;
  if (s.chain && s.amountMicros) {
    if (!s.txHash) {
      // "Sending" with no transaction recorded: it may or may not have gone. Ops checks the float, then resends by hand.
      if (s.status === "SENDING" && Date.now() - s.updatedAt.getTime() > 2 * 60_000) {
        const why = "No transaction was recorded for this payout. Check the float on-chain before sending it again.";
        const done = await prisma.settlement.updateMany({ where: { id: s.id, status: "SENDING" }, data: { status: "FAILED", failureReason: why } });
        if (done.count) await logSettlement(s.id, "failed", { reason: why });
      }
      return;
    }
    const st = await floatTxStatus(s.chain as FloatChain, s.txHash);
    if (st === "settled") await recordPayout(s.id, { state: "settled" });
    else if (st === "failed") await recordPayout(s.id, { state: "failed", reason: "The transaction failed on-chain. Nothing was received." });
    else if (st === "unknown" && s.status === "SENDING" && Date.now() - s.updatedAt.getTime() > 30 * 60_000) {
      // Sent without a clear answer, and the chain still hasn't seen it half an hour on.
      const why = "The chain never showed this payout's transaction. Check the float on-chain before sending it again.";
      const done = await prisma.settlement.updateMany({ where: { id: s.id, status: "SENDING" }, data: { status: "FAILED", failureReason: why } });
      if (done.count) await logSettlement(s.id, "failed", { reason: why });
    }
    return;
  }
  const state = await railsFor(s.mode).checkPayout(s.ref, s.providerRef);
  if (state.state === "unknown") {
    // "Sending" a good while now, and the rail has never heard of it: it didn't get there. Ops checks, then resends.
    // Not sooner: a rail that's slow to list a payout must never look like one that didn't take it.
    if (s.status === "SENDING" && Date.now() - s.updatedAt.getTime() > 15 * 60_000) {
      const why = "The rail has no record of this payout. Check with the rail, then resend.";
      const done = await prisma.settlement.updateMany({ where: { id: s.id, status: "SENDING" }, data: { status: "FAILED", failureReason: why } });
      if (done.count) await logSettlement(s.id, "failed", { reason: why });
    }
    return;
  }
  await recordPayout(s.id, state);
}

/** The chain names the app uses, and the coin it calls USDC on each. */
const APP_CHAIN: Record<string, { chain: string; asset: string }> = {
  MOVEMENT: { chain: "MOVE", asset: "USDCx" },
  SOLANA: { chain: "SOL", asset: "USDC" },
  ARC: { chain: "ARC", asset: "USDC" },
  MONAD: { chain: "MONAD", asset: "USDC" },
};

/** A settlement into a linked Money Moves account, final: the app files it as a settlement from this business. */
async function tellAppSettled(id: string): Promise<void> {
  const s = await prisma.settlement.findUnique({ where: { id }, include: { business: { select: { name: true } } } });
  if (!s || s.mode !== "LIVE" || s.destination !== "MONEY_MOVES" || !s.providerRef || !s.txHash || !s.chain || s.amountMicros == null) return;
  const on = APP_CHAIN[s.chain];
  if (!on) return;
  await tellSettlement(s.providerRef, {
    txHash: s.txHash,
    chain: on.chain,
    asset: on.asset,
    amount: (Number(s.amountMicros) / 1e6).toFixed(6),
    businessName: s.business.name,
    reference: s.ref,
    nairaAmount: s.amountKobo / 100,
  });
}

/** What the rail said about a payout, recorded - once: a settlement already past this point is left alone. */
export async function recordPayout(id: string, st: PayoutState, by = "system") {
  const moving = { id, status: { in: ["SENDING" as const, "SENT" as const] } };
  if (st.state === "pending") await prisma.settlement.updateMany({ where: { id, status: "SENDING" }, data: { status: "SENT" } });
  else if (st.state === "settled") {
    const done = await prisma.settlement.updateMany({ where: moving, data: { status: "SETTLED", settledAt: new Date() } });
    if (done.count) await logSettlement(id, "settled", undefined, by);
    if (done.count) void settlementEvent(id);
    if (done.count) void tellAppSettled(id).catch((e) => log.warn("[settle] couldn't tell the app", { settlementId: id, reason: reason(e) }));
  } else if (st.state === "failed") {
    const done = await prisma.settlement.updateMany({ where: moving, data: { status: "FAILED", failureReason: st.reason } });
    if (done.count) {
      await logSettlement(id, "failed", { reason: st.reason }, by);
      log.warn("[settle] payout failed, waiting for ops", { settlementId: id });
    }
  }
}
