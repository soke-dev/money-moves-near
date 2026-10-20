/**
 * Reports: everything a business's accountant asks for. Exports of payments,
 * settlements, refunds and disputes for any dates, and a statement for each
 * month: money in, our fees, refunds, and what settled where. The dashboard
 * turns these into CSV files and PDF statements.
 *
 * Settlements read the way the business always sees them: settled, or on
 * their way. Never failed.
 */
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { limited } from "../lib/limits";
import { requireMember } from "../middleware/auth";

const router = Router({ mergeParams: true });

const MAX_ROWS = 50_000;
const DAY = 86_400_000;
/** Lagos is UTC+1 all year: a month starts at 23:00 UTC the day before. */
const LAGOS_MS = 3_600_000;
const naira = (kobo: number | null | undefined) => (kobo == null ? null : kobo / 100);
const mode = (q: unknown) => (String(q).toLowerCase() === "live" ? "LIVE" : "TEST");
const channel = (p: { linkId: string | null; invoiceId: string | null; outletId: string | null }) => (p.invoiceId ? "Invoice" : p.outletId ? "Store QR" : p.linkId ? "Payment link" : "API");
const METHOD: Record<string, string> = { NAIRA: "Bank transfer", APP: "Money Moves app", CRYPTO: "Crypto" };
const DEST: Record<string, string> = { BANK: "Bank account", WALLET: "Business wallet", MONEY_MOVES: "Money Moves account" };

const range = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((r) => r.to > r.from, "The end has to be after the start.")
  .refine((r) => r.to.getTime() - r.from.getTime() <= 400 * DAY, "Pick at most a year at a time.");

const exporting = limited(60);

/** One kind of record, for any dates: the rows for a CSV. */
router.get("/exports/:kind", requireMember(), exporting, async (req, res) => {
  const kind = String(req.params.kind);
  const r = range.safeParse(req.query);
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? "Pick the dates.", "bad_range");
  const { from, to } = r.data;
  const businessId = req.member!.businessId;
  const m = mode(req.query.mode);

  if (kind === "payments") {
    const list = await prisma.payment.findMany({
      where: { businessId, mode: m, status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: from, lt: to } },
      orderBy: { paidAt: "asc" },
      take: MAX_ROWS,
      include: { settlement: { select: { status: true, destination: true, ref: true } } },
    });
    res.json({
      rows: list.map((p) => ({
        paid_at: p.paidAt,
        reference: p.ref,
        status: p.status === "PAID" ? "Paid" : "Part paid",
        method: METHOD[p.method] ?? p.method,
        channel: channel(p),
        customer_name: p.customerName,
        customer_email: p.customerEmail,
        currency: p.currency,
        price_ngn: naira(p.amountKobo),
        price_usd: p.amountCents / 100,
        received_ngn: naira(p.receivedKobo),
        fee_ngn: naira(p.feeKobo),
        net_ngn: p.receivedKobo != null ? (p.receivedKobo - (p.feeKobo ?? 0)) / 100 : null,
        settled_to: p.settlement ? (DEST[p.settlement.destination] ?? p.settlement.destination) : null,
        settlement: p.settlement ? (p.settlement.status === "SETTLED" ? "Settled" : "On its way") : null,
        settlement_reference: p.settlement?.ref ?? null,
      })),
    });
    return;
  }
  if (kind === "settlements") {
    const list = await prisma.settlement.findMany({
      where: { businessId, mode: m, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: "asc" },
      take: MAX_ROWS,
      include: { payment: { select: { ref: true } } },
    });
    res.json({
      rows: list.map((s) => ({
        created_at: s.createdAt,
        reference: s.ref,
        payment: s.payment.ref,
        to: DEST[s.destination] ?? s.destination,
        bank: s.bankName,
        account_ending: s.accountNumber ? s.accountNumber.slice(-4) : null,
        amount_ngn: naira(s.amountKobo),
        amount_usdc: s.amountMicros != null ? Number(s.amountMicros) / 1e6 : null,
        network: s.chain,
        status: s.status === "SETTLED" ? "Settled" : "On its way",
        settled_at: s.settledAt,
        transaction: s.txHash,
      })),
    });
    return;
  }
  if (kind === "refunds") {
    const list = await prisma.refund.findMany({ where: { businessId, mode: m, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { payment: { select: { ref: true } } } });
    const STATUS = { AWAITING_FUNDS: "Waiting for your money", SENDING: "On its way", REFUNDED: "Refunded", CANCELLED: "Cancelled" } as const;
    res.json({
      rows: list.map((x) => ({
        created_at: x.createdAt,
        reference: x.ref,
        payment: x.payment.ref,
        status: STATUS[x.status],
        amount: x.toKind === "BANK" ? naira(x.amountKobo) : x.amountCents / 100,
        currency: x.toKind === "BANK" ? "NGN" : "USD",
        amount_ngn: naira(x.amountKobo),
        fee_returned_ngn: naira(x.feeBackKobo),
        you_sent_ngn: naira(x.fundKobo),
        funded_by: x.funding === "BANK" ? "Bank transfer" : x.funding === "WALLET" ? "Business wallet" : x.funding === "APP" ? "Money Moves app" : "Money we held",
        reason: x.reason,
        funded_at: x.fundedAt,
        refunded_at: x.doneAt,
      })),
    });
    return;
  }
  if (kind === "disputes") {
    const list = await prisma.dispute.findMany({ where: { businessId, mode: m, createdAt: { gte: from, lt: to } }, orderBy: { createdAt: "asc" }, take: MAX_ROWS, include: { payment: { select: { ref: true } } } });
    const STATUS = { NEEDS_REPLY: "Needs your reply", UNDER_REVIEW: "Under review", WON: "Won", REFUNDED: "Refunded", LOST: "Lost" } as const;
    res.json({
      rows: list.map((d) => ({
        opened_at: d.createdAt,
        reference: d.ref,
        payment: d.payment.ref,
        from: d.kind === "BANK" ? "Bank claim" : "Customer",
        reason: d.reason.toLowerCase().replace(/_/g, " "),
        status: STATUS[d.status],
        amount_ngn: naira(d.amountKobo),
        closed_at: d.closedAt,
        outcome: d.outcome,
      })),
    });
    return;
  }
  throw new HttpError(404, "Exports are payments, settlements, refunds or disputes.", "not_found");
});

/**
 * One month's statement, in Lagos time: what came in and how, our fees, what
 * went back, and what settled where, with every payment and settlement listed.
 */
router.get("/statements/:month", requireMember(), exporting, async (req, res) => {
  const month = String(req.params.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "A month looks like 2026-10.", "bad_month");
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, mo - 1, 1) - LAGOS_MS);
  const to = new Date(Date.UTC(y, mo, 1) - LAGOS_MS);
  if (from.getTime() > Date.now()) throw new HttpError(400, "That month hasn't started yet.", "future_month");
  const businessId = req.member!.businessId;
  const m = mode(req.query.mode);
  const paidIn: Prisma.PaymentWhereInput = { businessId, mode: m, status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: from, lt: to } };

  const [business, payments, byMethod, settled, refunds, disputesOpened, disputesClosed] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, merchantId: true, logoId: true } }),
    prisma.payment.findMany({ where: paidIn, orderBy: { paidAt: "asc" }, take: 5_000, select: { ref: true, paidAt: true, method: true, customerName: true, customerEmail: true, receivedKobo: true, feeKobo: true, status: true, linkId: true, invoiceId: true, outletId: true } }),
    prisma.payment.groupBy({ by: ["method"], where: paidIn, _count: { _all: true }, _sum: { receivedKobo: true, feeKobo: true } }),
    prisma.settlement.findMany({ where: { businessId, mode: m, status: "SETTLED", settledAt: { gte: from, lt: to } }, orderBy: { settledAt: "asc" }, take: 5_000, include: { payment: { select: { ref: true } } } }),
    prisma.refund.findMany({ where: { businessId, mode: m, status: "REFUNDED", doneAt: { gte: from, lt: to } }, select: { ref: true, amountKobo: true, feeBackKobo: true, fundKobo: true, doneAt: true } }),
    prisma.dispute.count({ where: { businessId, mode: m, createdAt: { gte: from, lt: to } } }),
    prisma.dispute.groupBy({ by: ["status"], where: { businessId, mode: m, closedAt: { gte: from, lt: to } }, _count: { _all: true } }),
  ]);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
  const received = sum(byMethod.map((x) => x._sum.receivedKobo));
  const fees = sum(byMethod.map((x) => x._sum.feeKobo));
  const settledBy = new Map<string, { count: number; kobo: number }>();
  for (const s of settled) {
    const k = DEST[s.destination] ?? s.destination;
    const v = settledBy.get(k) ?? { count: 0, kobo: 0 };
    settledBy.set(k, { count: v.count + 1, kobo: v.kobo + (s.amountKobo ?? 0) });
  }
  res.json({
    business: { name: business.name, merchantId: business.merchantId },
    mode: m.toLowerCase(),
    month,
    from,
    to,
    generatedAt: new Date(),
    totals: {
      payments: payments.length,
      receivedNgn: received / 100,
      feesNgn: fees / 100,
      netNgn: (received - fees) / 100,
      refunds: refunds.length,
      refundedNgn: sum(refunds.map((r) => r.amountKobo)) / 100,
      feesReturnedNgn: sum(refunds.map((r) => r.feeBackKobo)) / 100,
      refundsYouSentNgn: sum(refunds.map((r) => r.fundKobo)) / 100,
      disputesOpened,
      disputesClosed: Object.fromEntries(disputesClosed.map((d) => [d.status.toLowerCase(), d._count._all])),
    },
    byMethod: byMethod.map((x) => ({ method: METHOD[x.method] ?? x.method, count: x._count._all, receivedNgn: (x._sum.receivedKobo ?? 0) / 100, feesNgn: (x._sum.feeKobo ?? 0) / 100 })),
    settledBy: [...settledBy.entries()].map(([to, v]) => ({ to, count: v.count, amountNgn: v.kobo / 100 })),
    payments: payments.map((p) => ({
      paidAt: p.paidAt,
      ref: p.ref,
      method: METHOD[p.method] ?? p.method,
      channel: channel(p),
      customer: p.customerName ?? p.customerEmail ?? null,
      receivedNgn: naira(p.receivedKobo),
      feeNgn: naira(p.feeKobo),
      partPaid: p.status === "UNDERPAID",
    })),
    settlements: settled.map((s) => ({
      settledAt: s.settledAt,
      ref: s.ref,
      payment: s.payment.ref,
      to: DEST[s.destination] ?? s.destination,
      detail: s.destination === "BANK" ? [s.bankName, s.accountNumber ? `••${s.accountNumber.slice(-4)}` : null].filter(Boolean).join(" ") : s.chain,
      amountNgn: naira(s.amountKobo),
      amountUsdc: s.amountMicros != null ? Number(s.amountMicros) / 1e6 : null,
    })),
    truncated: payments.length >= 5_000 || settled.length >= 5_000,
  });
});

export default router;
