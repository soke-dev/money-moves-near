/**
 * A refund, from the business asking to our team sending it.
 *
 *  1. ask - how much, why, and how the business will send us the money. Our
 *     fee on that share comes back, so it never sends more than it received.
 *     Money we never settled (an underpayment) needs nothing from it.
 *  2. fund - a transfer into a one-time account (worked out like a payment's),
 *     USDC from the business wallet to our treasury, or a request the owner
 *     approves in their linked Money Moves app. The wallet's send and the
 *     app's transaction are both read from the chain before the refund moves.
 *     In test mode all three are simulated. A one-time account or an app
 *     request that closes with nothing lets the refund lapse.
 *  3. send - we pay the customer the way they paid. Live, our team does it by
 *     hand and marks it done; the business sees it on its way, then refunded.
 *     In test mode it completes by itself a few seconds later.
 *
 * Nothing here moves real money on its own: it opens and watches the funding
 * account or the app request, and the wallet's send is the owner's own.
 */
import type { Business, Mode, Payment, Prisma, Refund, RefundFunding } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { sendEmail } from "../lib/email";
import { refundEvent } from "./events";
import { onRefund } from "./disputes";
import { canSimulate, railsFor } from "../rails";
import { simulateArrival } from "../rails/simulator";
import { appPayReady, openAppPayment, readAppPayments, treasuryAddresses } from "../lib/app-pay";
import { verifyAppTransfer } from "../lib/app-pay-verify";
import { publicImageUrl } from "../lib/images";
import { LATE_GRACE_MS, PAY_WINDOW_MS, formatMinor, koboToCents, newRefundRef, railRef, toMinor } from "../lib/money";

/** What we tell a business a live refund takes to reach the customer, once we have the money. */
export const REFUND_WITHIN_MS = 48 * 3_600_000;
/** Test mode: long enough to see a refund move, short enough not to wait for it. */
const TEST_SEND_MS = 4_000;

/** The app's side lapses a little before ours, so nothing can be paid there after we've closed. */
const APP_EARLY_MS = 2 * 60_000;

/**
 * How a business can fund a refund, and why a way is closed. Test: all three.
 * Live: a bank transfer always; its business wallet once it has one; the app
 * once a Money Moves account is linked.
 */
export async function fundingsFor(businessId: string, mode: Mode, owner = true): Promise<{ open: RefundFunding[]; closed: Partial<Record<RefundFunding, string>> }> {
  if (mode === "TEST") return { open: ["WALLET", "APP", "BANK"], closed: {} };
  const open: RefundFunding[] = [];
  const closed: Partial<Record<RefundFunding, string>> = {};
  const [wallet, linked] = await Promise.all([prisma.businessWallet.findUnique({ where: { businessId }, select: { id: true } }), prisma.moneyMovesLink.count({ where: { businessId, status: "LINKED" } })]);
  // The wallet is the owner's alone, so only they can fund a refund from it.
  if (!owner) closed.WALLET = "Only the owner can send from the business wallet";
  else if (wallet) open.push("WALLET");
  else closed.WALLET = "Create your business wallet first, in Wallet";
  const appOn = canSimulate("LIVE") || (appPayReady() && Object.keys(treasuryAddresses()).length > 0);
  if (!appOn) closed.APP = "Paying from the app isn't switched on right now";
  else if (!linked) closed.APP = "Link your Money Moves account in Payout places first";
  else open.push("APP");
  open.push("BANK");
  return { open, closed };
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function logRefund(refundId: string, kind: string, detail?: Prisma.InputJsonValue, by = "system") {
  return prisma.refundEvent.create({ data: { refundId, kind, detail, by } }).catch((e) => log.error("[refund] couldn't write a timeline event", { refundId, kind, reason: reason(e) }));
}

/** Naira for a transfer; coins - a dollar each - for the app and crypto. What the customer gets back, and in. */
export const refundCurrency = (p: Pick<Payment, "method">) => (p.method === "NAIRA" ? "NGN" : "USD");

/** What's left to refund on a payment: what arrived, less every refund not called off. */
export async function refundableKobo(p: Payment): Promise<number> {
  const taken = await prisma.refund.aggregate({ where: { paymentId: p.id, status: { not: "CANCELLED" } }, _sum: { amountKobo: true } });
  return Math.max(0, (p.receivedKobo ?? 0) - (taken._sum.amountKobo ?? 0));
}

/** Where a refund goes back: the way the customer paid, as they paid it. */
function destinationOf(p: Payment) {
  if (p.method === "APP") return { toKind: "APP", toName: p.payerName, toBank: null, toAccount: p.payerAccount, toCoin: null, toNetwork: null };
  if (p.method === "CRYPTO") return { toKind: "WALLET", toName: null, toBank: null, toAccount: p.payerAccount, toCoin: p.coin, toNetwork: p.network };
  return { toKind: "BANK", toName: p.payerName, toBank: p.payerBank, toAccount: p.payerAccount, toCoin: null, toNetwork: null };
}

export interface AskRefund {
  business: Business;
  paymentId: string;
  /** In the refund's currency (naira, or coins); absent for everything that's left. */
  amount?: number;
  funding?: RefundFunding;
  reason?: string;
  by: string;
  /** Money we never settled, though the payment came in full - a second payment on an already paid invoice. */
  held?: boolean;
  /** Asked by the owner (or by API key): only they can fund one from the business wallet. */
  owner?: boolean;
}

export async function askRefund(a: AskRefund): Promise<Refund> {
  const refund = await openRefund(a);
  // An open dispute on this payment closes with it; a lost bank claim is now being funded.
  await onRefund(refund).catch((e) => log.error("[refund] couldn't close the dispute on its payment", { ref: refund.ref, reason: reason(e) }));
  return refund;
}

async function openRefund(a: AskRefund): Promise<Refund> {
  // One refund decided at a time per payment: the payment's row is locked while what's left is worked out and the refund made,
  // so two asked at the same moment can't both take the same money.
  let refund = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${a.paymentId} AND business_id = ${a.business.id} FOR UPDATE`;
    const p = await tx.payment.findFirst({ where: { id: a.paymentId, businessId: a.business.id } });
    if (!p) throw new HttpError(404, "That payment isn't here.", "not_found");
    if (p.status !== "PAID" && p.status !== "UNDERPAID") throw new HttpError(400, "Only a payment that came in can be refunded.", "not_refundable");
    if (await tx.refund.findFirst({ where: { paymentId: p.id, status: "AWAITING_FUNDS" } })) {
      throw new HttpError(409, "A refund on this payment is waiting for your money. Finish it or cancel it first.", "refund_waiting");
    }
    const taken = await tx.refund.aggregate({ where: { paymentId: p.id, status: { not: "CANCELLED" } }, _sum: { amountKobo: true } });
    const left = Math.max(0, (p.receivedKobo ?? 0) - (taken._sum.amountKobo ?? 0));
    if (left <= 0) throw new HttpError(400, "This payment has been refunded in full.", "fully_refunded");

    // The amount, in what the customer paid with. Everything left is exact; part of it is worked out at the payment's own rate.
    const usd = refundCurrency(p) === "USD";
    const leftShown = usd ? koboToCents(left, p.ngnPerUsd) : left;
    const asked = a.amount == null ? leftShown : toMinor(a.amount);
    if (!(asked > 0)) throw new HttpError(400, "Enter how much to refund.", "bad_amount");
    if (asked > leftShown) throw new HttpError(400, `The most that can go back is ${formatMinor(leftShown, usd ? "USD" : "NGN")}.`, "too_much");
    const whole = asked === leftShown;
    const amountKobo = whole ? left : usd ? Math.min(Math.round(asked * p.ngnPerUsd), left) : asked;
    const amountCents = usd ? asked : koboToCents(amountKobo, p.ngnPerUsd);

    // Money we never settled goes straight back; otherwise the business sends its share, our fee on it given back.
    const held = p.status === "UNDERPAID" || a.held === true;
    const funding: RefundFunding = held ? "HELD" : (a.funding ?? (p.mode === "TEST" ? "WALLET" : "BANK"));
    if (!held) {
      const ways = await fundingsFor(a.business.id, p.mode, a.owner !== false);
      if (!ways.open.includes(funding)) throw new HttpError(400, `${ways.closed[funding] ?? "That way to fund a refund isn't open"}. Pick another way.`, "funding_unavailable");
    }
    const feeBackKobo = held || !p.feeKobo || !p.receivedKobo ? 0 : Math.round((p.feeKobo * amountKobo) / p.receivedKobo);
    const fundKobo = held ? 0 : amountKobo - feeBackKobo;

    return tx.refund.create({
      data: {
        ref: newRefundRef(),
        businessId: a.business.id,
        paymentId: p.id,
        mode: p.mode,
        funding,
        amountKobo,
        amountCents,
        feeBackKobo,
        fundKobo,
        fundCents: koboToCents(fundKobo, p.ngnPerUsd),
        ...destinationOf(p),
        reason: a.reason?.trim() || null,
        requestedBy: a.by,
      },
    });
  });
  const { amountKobo, feeBackKobo, fundKobo, funding } = refund;
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
  await logRefund(refund.id, "requested", { amountKobo, feeBackKobo, fundKobo, funding }, a.by);
  void refundEvent(refund.id, "refund.created");

  if (funding === "HELD") return markFunded(refund, { held: true });
  if (funding === "BANK") {
    try {
      const expiresAt = new Date(Date.now() + PAY_WINDOW_MS);
      const acct = await railsFor(p.mode).openAccount({ reference: railRef(refund.ref), amountKobo: fundKobo, expiresAt, merchantName: `${a.business.name} refund`, businessId: a.business.id });
      refund = await prisma.refund.update({
        where: { id: refund.id },
        data: { fundBank: acct.bank, fundAccount: acct.number, fundName: acct.name, fundProviderRef: acct.providerRef, fundExpiresAt: expiresAt },
      });
      await logRefund(refund.id, "account_opened", { bank: acct.bank, expiresAt: expiresAt.toISOString() });
    } catch (e) {
      await prisma.refund.update({ where: { id: refund.id }, data: { status: "CANCELLED" } });
      await logRefund(refund.id, "account_failed", { reason: reason(e) });
      log.error("[refund] couldn't open a funding account", { ref: refund.ref, reason: reason(e) });
      throw new HttpError(502, "We couldn't open an account for this refund. Try again in a moment.", "account_failed");
    }
  }
  // Live, from the app: a request for exactly what the business sends, to our treasury, that the owner opens by QR or link and approves.
  if (funding === "APP" && !canSimulateFunding(refund)) {
    try {
      const addresses = treasuryAddresses();
      if (!Object.keys(addresses).length) throw new Error("no treasury addresses");
      const expiresAt = new Date(Date.now() + PAY_WINDOW_MS);
      const app = await openAppPayment({
        businessId: a.business.id,
        businessName: a.business.name,
        businessLogo: publicImageUrl(a.business.logoId),
        paymentRef: refund.ref,
        title: `Refund ${refund.ref}, sent back to your customer`,
        amount: (refund.fundCents / 100).toFixed(2),
        addresses,
        expiresAt: new Date(expiresAt.getTime() - APP_EARLY_MS).toISOString(),
      });
      refund = await prisma.refund.update({ where: { id: refund.id }, data: { fundProviderRef: app.id, fundCode: app.code, fundExpiresAt: expiresAt } });
      await logRefund(refund.id, "app_request_opened", { expiresAt: expiresAt.toISOString() });
    } catch (e) {
      await prisma.refund.update({ where: { id: refund.id }, data: { status: "CANCELLED" } });
      await logRefund(refund.id, "app_request_failed", { reason: reason(e) });
      log.error("[refund] couldn't open the app request", { ref: refund.ref, reason: reason(e) });
      throw new HttpError(502, "We couldn't open this refund in the Money Moves app. Try again in a moment, or pick another way.", "app_failed");
    }
  }
  return refund;
}

/** We have the business's money (or never needed it): on its way to the customer. Once, whoever gets here first. */
export async function markFunded(r: Refund, detail: Record<string, unknown> = {}, by = "system", fundTx?: string | null): Promise<Refund> {
  // The funding transaction is unique: one that already funded another refund can't fund this one too.
  const moved = await prisma.refund.updateMany({ where: { id: r.id, status: "AWAITING_FUNDS" }, data: { status: "SENDING", fundedAt: new Date(), ...(fundTx ? { fundTx } : {}) } });
  if (moved.count) await logRefund(r.id, "funded", { funding: r.funding, ...detail } as Prisma.InputJsonValue, by);
  return prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
}

const touched = (r: Refund) => prisma.refund.update({ where: { id: r.id }, data: { lastCheckedAt: new Date() } });

/** Lets a refund nobody funded go, once. */
async function lapse(r: Refund, detail?: Prisma.InputJsonValue): Promise<Refund> {
  const lapsed = await prisma.refund.updateMany({ where: { id: r.id, status: "AWAITING_FUNDS" }, data: { status: "CANCELLED", lastCheckedAt: new Date() } });
  if (lapsed.count) await logRefund(r.id, "lapsed", detail);
  return prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
}

/** Asks whether the business's money arrived: the rail for a transfer, the app and then the chain for the app. The wallet's send moves the refund itself, once the chain has it. */
export async function checkRefundFunding(r: Refund): Promise<Refund> {
  if (r.status !== "AWAITING_FUNDS") return r;
  if (r.funding === "APP" && r.fundProviderRef) return checkAppFunding(r);
  if (r.funding !== "BANK" || !r.fundAccount) return r;
  const arrival = await railsFor(r.mode).findArrival(railRef(r.ref));
  if (arrival && arrival.amountKobo >= r.fundKobo) return markFunded(r, { amountKobo: arrival.amountKobo, payerName: arrival.payerName, payerBank: arrival.payerBank });
  const late = r.fundExpiresAt && Date.now() > r.fundExpiresAt.getTime() + LATE_GRACE_MS;
  if (late) return lapse(r, arrival ? { arrivedKobo: arrival.amountKobo, neededKobo: r.fundKobo } : undefined);
  return touched(r);
}

/**
 * The app request: once the app says it's paid, the transaction it names is
 * read from the chain. It must have succeeded and moved exactly what the
 * business sends, in the right coin, to our treasury, and must not have paid a
 * checkout or another refund already. Declined, cancelled or lapsed in the app:
 * the refund lapses. Never while a send is on its way.
 */
async function checkAppFunding(r: Refund): Promise<Refund> {
  const [app] = await readAppPayments([r.fundProviderRef!]);
  if (app?.status === "PAID" && app.txHash) {
    const verified = await verifyAppTransfer({ chain: app.chain ?? "", asset: app.asset ?? "", txHash: app.txHash, micros: BigInt(r.fundCents) * 10_000n });
    if (verified === null) return touched(r);
    const reused =
      (await prisma.payment.count({ where: { payerSession: app.txHash } })) +
      (await prisma.refund.count({ where: { fundTx: app.txHash, id: { not: r.id } } })) +
      (await prisma.walletSend.count({ where: { txHash: { equals: app.txHash, mode: "insensitive" } } }));
    if (!verified || reused) {
      log.warn("[refund] the app reported funding the chain doesn't back, not moved, for ops to look at", { ref: r.ref, chain: app.chain, asset: app.asset, tx: app.txHash, reused: reused > 0 });
      return touched(r);
    }
    return markFunded(r, { by: app.username ? `@${app.username}` : null, chain: app.chain, asset: app.asset, tx: app.txHash }, "system", app.txHash);
  }
  if (app && (app.status === "DECLINED" || app.status === "CANCELLED" || app.status === "EXPIRED")) return lapse(r, { app: app.status });
  const late = r.fundExpiresAt && Date.now() > r.fundExpiresAt.getTime() + LATE_GRACE_MS;
  if (late && app?.status === "PENDING") return lapse(r);
  return touched(r);
}

/** Whether the test checkout's "pretend it arrived" works for this refund. */
export const canSimulateFunding = (r: Pick<Refund, "mode" | "funding">) => (r.funding === "WALLET" ? r.mode === "TEST" : canSimulate(r.mode));

/** Test mode (or the simulated live rail on staging): the business's money arrives. */
export async function simulateFunding(r: Refund, by: string): Promise<Refund> {
  if (!canSimulateFunding(r)) throw new HttpError(404, "Nothing here.", "not_found");
  if (r.status !== "AWAITING_FUNDS") throw new HttpError(409, "This refund isn't waiting for money.", "not_waiting");
  if (r.funding === "BANK") {
    if (!r.fundAccount) throw new HttpError(409, "This refund has no account to pay into.", "no_account");
    await simulateArrival(railRef(r.ref), r.fundKobo);
    return checkRefundFunding(r);
  }
  return markFunded(r, { simulated: true }, by);
}

export async function cancelRefund(r: Refund, by: string): Promise<Refund> {
  // Money already on its way from the wallet or the app can't be called off: the refund waits for it.
  if (r.status === "AWAITING_FUNDS" && r.funding === "WALLET") {
    const going = await prisma.walletSend.count({ where: { refundId: r.id, OR: [{ status: { in: ["SENT", "CONFIRMED"] } }, { status: "PREPARED", expiresAt: { gt: new Date() } }] } });
    if (going) throw new HttpError(409, "Your wallet's send for this refund is on its way, so it can't be cancelled now.", "funding_on_its_way");
  }
  if (r.status === "AWAITING_FUNDS" && r.funding === "APP" && r.fundProviderRef) {
    const [app] = await readAppPayments([r.fundProviderRef]);
    if (app?.status === "PAYING" || app?.status === "PAID") throw new HttpError(409, "This refund is being paid in the Money Moves app, so it can't be cancelled now.", "funding_on_its_way");
  }
  const done = await prisma.refund.updateMany({ where: { id: r.id, status: "AWAITING_FUNDS" }, data: { status: "CANCELLED" } });
  if (!done.count) throw new HttpError(409, "Only a refund still waiting for your money can be cancelled.", "not_cancellable");
  await logRefund(r.id, "cancelled", undefined, by);
  return prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
}

/** Test mode: refunds we have the money for reach the customer by themselves, a few seconds on. */
export async function completeTestRefunds() {
  const due = await prisma.refund.findMany({ where: { mode: "TEST", status: "SENDING", fundedAt: { lt: new Date(Date.now() - TEST_SEND_MS) } }, take: 50 });
  for (const r of due) {
    const done = await prisma.refund.updateMany({ where: { id: r.id, status: "SENDING" }, data: { status: "REFUNDED", doneAt: new Date(), sentBy: "simulator" } });
    if (done.count) await logRefund(r.id, "refunded", { simulated: true });
    if (done.count) void refundEvent(r.id, "refund.completed");
  }
}

/** Live: our team has sent it, by hand. The business sees it refunded; the customer is told, when we have their email. */
export async function markRefundSent(r: Refund, admin: string, note?: string): Promise<Refund> {
  if (r.mode !== "LIVE") throw new HttpError(400, "Test refunds complete by themselves.", "test_refund");
  const done = await prisma.refund.updateMany({ where: { id: r.id, status: "SENDING" }, data: { status: "REFUNDED", doneAt: new Date(), sentBy: admin, sendNote: note?.trim() || null } });
  if (!done.count) throw new HttpError(409, "Only a refund we have the money for can be marked sent.", "not_sending");
  await logRefund(r.id, "refunded", note ? { note } : undefined, admin);
  void refundEvent(r.id, "refund.completed");
  const full = await prisma.refund.findUniqueOrThrow({ where: { id: r.id }, include: { payment: true, business: true } });
  if (full.payment.customerEmail) {
    const amount = refundCurrency(full.payment) === "USD" ? `${(full.amountCents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${full.toCoin ?? "USDC"}` : formatMinor(full.amountKobo, "NGN");
    void sendEmail(
      full.payment.customerEmail,
      `Your refund from ${full.business.name}`,
      `${full.business.name} has refunded ${amount} on payment ${full.payment.ref}.\n\nIt's been sent back the way you paid.${full.reason ? `\n\nTheir note: ${full.reason}` : ""}\n\nReference: ${full.ref}\n\n- Money Moves`,
    ).catch(() => {});
  }
  return full;
}
