/**
 * Direct account checkouts: granting them, reading what comes in, matching it
 * to payments, and our team's manual settlement.
 *
 * Granting opens the business's Flutterwave subaccount the first time.
 * Revoking only switches it off: the subaccount, the payments and the keys
 * stay, so switching it back on brings everything back as it was.
 *
 * Every half minute the deposit scan reads each direct account's credits,
 * records each transfer once, and matches it to the one open direct payment
 * with exactly that amount. A match confirms the payment the same way every
 * payment is confirmed (receipt, webhooks), except that nothing is settled:
 * our team pays the business by hand and marks the payments settled.
 */
import type { Business, DirectDeposit, Payment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { HttpError } from "../lib/http";
import { LATE_GRACE_MS } from "../lib/money";
import { openPsa, psaBalanceNgn, psaCredits, psaReady } from "../lib/flutterwave-psa";
import { directTakenTodayKobo } from "../lib/direct";
import { confirmArrival } from "./payments";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const naira = (kobo: number | null | undefined) => (kobo ?? 0) / 100;

// ─── Our team: switching it on and off ────────────────────────────────────

export async function setDirectAllowed(businessId: string, allowed: boolean, by: string): Promise<Business> {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b) throw new HttpError(404, "No business with that id.", "not_found");
  if (!allowed) return prisma.business.update({ where: { id: businessId }, data: { directAllowed: false } });
  if (b.status !== "VERIFIED") throw new HttpError(400, "Only a verified business can have a direct account.", "business_unverified");
  if (!psaReady()) throw new HttpError(503, "Direct accounts need FLW_V3_SECRET_KEY set on the Business API.", "direct_unavailable");
  if (!b.psaReference) {
    // An address only we use, so two businesses of one owner never collide at Flutterwave.
    const psa = await openPsa({ name: b.name, email: `business-${b.id}@usemoneymoves.xyz` }).catch((e) => {
      log.error("[direct] subaccount not opened", { business: b.id, reason: reason(e) });
      throw new HttpError(502, `Flutterwave didn't open the account: ${reason(e)}`, "direct_failed");
    });
    await prisma.business.update({
      where: { id: businessId },
      data: { psaReference: psa.reference, psaBarterId: psa.barterId, psaAccountNumber: psa.accountNumber, psaAccountBank: psa.bank, psaAccountName: psa.name, psaCheckedAt: new Date() },
    });
  }
  return prisma.business.update({ where: { id: businessId }, data: { directAllowed: true, directAllowedAt: new Date(), directAllowedBy: by } });
}

export async function setDirectLimits(businessId: string, l: { minNgn?: number | null; maxNgn?: number | null; dailyNgn?: number | null }): Promise<Business> {
  const b = await prisma.business.findUnique({ where: { id: businessId } });
  if (!b) throw new HttpError(404, "No business with that id.", "not_found");
  const min = l.minNgn !== undefined ? l.minNgn : b.directMinNgn;
  const max = l.maxNgn !== undefined ? l.maxNgn : b.directMaxNgn;
  if (min != null && max != null && min >= max) throw new HttpError(400, "The least a checkout can be has to be under the most.", "bad_limits");
  return prisma.business.update({
    where: { id: businessId },
    data: { ...(l.minNgn !== undefined ? { directMinNgn: l.minNgn } : {}), ...(l.maxNgn !== undefined ? { directMaxNgn: l.maxNgn } : {}), ...(l.dailyNgn !== undefined ? { directDailyNgn: l.dailyNgn } : {}) },
  });
}

// ─── What it adds up to ───────────────────────────────────────────────────

/** Received, settled and still owed, from direct payments that are paid. */
export async function directTotals(businessId: string) {
  const [paid, settled, waiting] = await Promise.all([
    prisma.payment.aggregate({ where: { businessId, direct: true, status: "PAID" }, _sum: { receivedKobo: true }, _count: true }),
    prisma.payment.aggregate({ where: { businessId, direct: true, status: "PAID", directSettledAt: { not: null } }, _sum: { receivedKobo: true } }),
    prisma.directDeposit.count({ where: { businessId, status: "UNMATCHED" } }),
  ]);
  const received = naira(paid._sum.receivedKobo);
  const done = naira(settled._sum.receivedKobo);
  return { receivedNgn: received, settledNgn: done, owedNgn: Math.round((received - done) * 100) / 100, paidCount: paid._count, unmatchedDeposits: waiting, todayNgn: naira(await directTakenTodayKobo(businessId)) };
}

export const directPaymentRow = (p: Payment) => ({
  id: p.id,
  ref: p.ref,
  status: p.status,
  amountNgn: naira(p.amountKobo),
  receivedNgn: p.receivedKobo != null ? naira(p.receivedKobo) : null,
  payer: p.payerName,
  payerBank: p.payerBank,
  email: p.customerEmail,
  createdAt: p.createdAt,
  paidAt: p.paidAt,
  settledAt: p.directSettledAt,
  settledBy: p.directSettledBy,
  settleNote: p.directSettleNote,
});

export const depositRow = (d: DirectDeposit) => ({
  id: d.id,
  reference: d.reference,
  amountNgn: naira(d.amountKobo),
  sender: d.senderName,
  senderBank: d.senderBank,
  senderAccount: d.senderAccount,
  receivedAt: d.receivedAt,
  status: d.status,
  note: d.note,
  resolvedBy: d.resolvedBy,
});

export async function directBalanceNgn(b: Pick<Business, "psaReference">) {
  return b.psaReference ? psaBalanceNgn(b.psaReference).catch(() => null) : null;
}

// ─── Reading deposits ─────────────────────────────────────────────────────

const LOOKBACK_MS = 15 * 60_000;
const MAX_WINDOW_MS = 3 * 86_400_000;

/** Every half minute: new deposits recorded and matched where they can be. */
export async function scanDirectAccounts(): Promise<void> {
  if (!psaReady()) return;
  // Still read after a switch-off while a payment is open, so a customer part way through isn't lost.
  const businesses = await prisma.business.findMany({
    where: { psaReference: { not: null }, OR: [{ directAllowed: true }, { payments: { some: { direct: true, status: "OPEN" } } }] },
  });
  for (const b of businesses) {
    try {
      await readDeposits(b);
      await matchWaiting(b.id);
    } catch (e) {
      log.warn("[direct] scan failed", { business: b.id, reason: reason(e) });
    }
  }
}

async function readDeposits(b: Business) {
  const now = new Date();
  // A little overlap with the last read, so a transfer dated just before it isn't missed. Recording is by reference, so overlap is harmless.
  const since = new Date(Math.max((b.psaCheckedAt ?? now).getTime() - LOOKBACK_MS, now.getTime() - MAX_WINDOW_MS));
  const credits = await psaCredits(b.psaReference!, since, now);
  for (const c of credits) {
    await prisma.directDeposit
      .create({ data: { businessId: b.id, reference: c.reference, amountKobo: c.amountKobo, feeKobo: c.feeKobo, senderName: c.senderName, senderAccount: c.senderAccount, senderBank: c.senderBank, receivedAt: c.at } })
      .catch((e) => {
        // Already recorded on an earlier read.
        if ((e as { code?: string })?.code !== "P2002") throw e;
      });
  }
  await prisma.business.update({ where: { id: b.id }, data: { psaCheckedAt: now } });
}

/** Whether a deposit pays exactly this payment: the amount, or the amount less a fee Flutterwave took from it. */
const pays = (d: DirectDeposit, p: Payment) => d.amountKobo === p.amountKobo || (d.feeKobo != null && d.amountKobo + d.feeKobo === p.amountKobo);

async function matchWaiting(businessId: string) {
  const waiting = await prisma.directDeposit.findMany({ where: { businessId, status: "UNMATCHED", receivedAt: { gte: new Date(Date.now() - MAX_WINDOW_MS) } }, orderBy: { receivedAt: "asc" } });
  for (const d of waiting) {
    // Payments open when it arrived: made before it, and not yet past their time (with the usual grace).
    const near = await prisma.payment.findMany({
      where: {
        businessId,
        direct: true,
        status: { in: ["OPEN", "EXPIRED"] },
        createdAt: { lte: new Date(d.receivedAt.getTime() + 60_000) },
        expiresAt: { gte: new Date(d.receivedAt.getTime() - LATE_GRACE_MS) },
        directDeposit: null,
      },
    });
    const fits = near.filter((p) => pays(d, p));
    if (fits.length !== 1) {
      if (fits.length > 1) log.warn("[direct] a deposit fits more than one payment, left for ops", { deposit: d.reference, payments: fits.map((p) => p.ref) });
      continue;
    }
    await payWith(d, fits[0]!, "matched").catch((e) => log.warn("[direct] matched but not confirmed", { deposit: d.reference, reason: reason(e) }));
  }
}

/**
 * Pays a payment with a deposit: claims the deposit first, so it can never pay
 * twice, reopens a payment that lapsed while the transfer was on its way, then
 * confirms it the way every payment is confirmed.
 */
async function payWith(d: DirectDeposit, p: Payment, how: "matched" | "assigned", by?: string): Promise<Payment> {
  const claimed = await prisma.directDeposit.updateMany({ where: { id: d.id, status: "UNMATCHED", paymentId: null }, data: { status: "MATCHED", paymentId: p.id, resolvedBy: by ?? null } });
  if (!claimed.count) throw new HttpError(409, "That deposit was already used.", "deposit_used");
  if (p.status === "EXPIRED") await prisma.payment.updateMany({ where: { id: p.id, status: "EXPIRED" }, data: { status: "OPEN" } });
  const open = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  log.info("[direct] deposit paid a payment", { deposit: d.reference, payment: p.ref, how });
  return confirmArrival(open, {
    amountKobo: d.amountKobo === p.amountKobo ? d.amountKobo : d.amountKobo + (d.feeKobo ?? 0),
    payerName: d.senderName,
    payerBank: d.senderBank,
    payerAccount: d.senderAccount,
    session: `psa:${d.reference}`,
  });
}

// ─── Our team, by hand ────────────────────────────────────────────────────

/** Marks paid direct payments as settled: our team has paid the business for them. Already-settled ones are left as they were. */
export async function markSettled(businessId: string, paymentIds: string[], note: string | null, by: string): Promise<number> {
  const r = await prisma.payment.updateMany({
    where: { id: { in: paymentIds }, businessId, direct: true, status: "PAID", directSettledAt: null },
    data: { directSettledAt: new Date(), directSettledBy: by, directSettleNote: note?.trim() || null },
  });
  return r.count;
}

/** Pays a payment with a deposit that didn't match on its own: the same confirmation, so short and over amounts are handled as usual. */
export async function assignDeposit(depositId: string, paymentRef: string, by: string): Promise<Payment> {
  const d = await prisma.directDeposit.findUnique({ where: { id: depositId } });
  if (!d) throw new HttpError(404, "No deposit with that id.", "not_found");
  if (d.status !== "UNMATCHED") throw new HttpError(409, "That deposit is already settled.", "deposit_used");
  const p = await prisma.payment.findFirst({ where: { ref: paymentRef.trim(), businessId: d.businessId, direct: true } });
  if (!p) throw new HttpError(404, "No direct payment with that reference for this business.", "not_found");
  if (p.status !== "OPEN" && p.status !== "EXPIRED") throw new HttpError(409, "That payment is already paid.", "payment_paid");
  return payWith(d, p, "assigned", by);
}

/** A deposit handled outside the app (returned to the sender, say): it stops waiting. */
export async function resolveDeposit(depositId: string, note: string, by: string): Promise<void> {
  const r = await prisma.directDeposit.updateMany({ where: { id: depositId, status: "UNMATCHED" }, data: { status: "RESOLVED", note: note.trim() || null, resolvedBy: by } });
  if (!r.count) throw new HttpError(409, "That deposit isn't waiting any more.", "deposit_used");
}
