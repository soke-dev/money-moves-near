/**
 * What a business sees of its money: payments and settlements, one mode at
 * a time.
 *
 * A settlement that failed or is waiting for ops shows as pending - on its
 * way - never as failed. Why it's late is for ops to sort out, not for the
 * business to chase.
 */
import { Router } from "express";
import type { Payment, PaymentLink, Settlement } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { koboToCents } from "../lib/money";
import { intentOf } from "../services/intent-in";

const paidWith = (p: Payment) => {
  const i = intentOf(p);
  return i ? { coin: i.symbol, network: i.chain, tx: i.originTx ?? i.submittedTx ?? null } : null;
};
import { requireMember } from "../middleware/auth";
import { HttpError } from "../lib/http";

const router = Router({ mergeParams: true });

const mode = (q: unknown) => (String(q).toLowerCase() === "live" ? "LIVE" : "TEST");
const naira = (kobo: number | null | undefined) => (kobo == null ? null : kobo / 100);

/** What the business is told about a settlement: settled, or on its way. */
const settlementStatus = (s: Settlement) => (s.status === "SETTLED" ? "settled" : "pending");

const settlementBrief = (s: Settlement) => ({
  id: s.id,
  status: settlementStatus(s),
  destination: s.destination,
  bankName: s.bankName,
  accountNumber: s.accountNumber,
  amountNgn: naira(s.amountKobo),
  settledAt: s.settledAt,
  // On-chain: the chain, where it went, the USDC sent and the transaction.
  chain: s.chain,
  toAddress: s.toAddress,
  amountUsdc: s.amountMicros != null ? Number(s.amountMicros) / 1e6 : null,
  txHash: s.txHash,
});

export const paymentShape = (
  p: Payment & {
    link: Pick<PaymentLink, "id" | "name" | "slug"> | null;
    invoice: { id: string; number: string } | null;
    outlet: { id: string; name: string } | null;
    settlement: Settlement | null;
  },
) => ({
  id: p.id,
  ref: p.ref,
  mode: p.mode,
  // Open, but the customer's part is done (enough reached the swap's address): the money is on its way to us, usually within a minute.
  status: p.status === "PAID" ? "successful" : p.status === "UNDERPAID" ? "underpaid" : p.status === "OPEN" ? (intentOf(p)?.paidSeenAt ? "confirming" : "pending") : "expired",
  method: p.method,
  link: p.link,
  /** Or the invoice, or the outlet, it was paid through. */
  invoice: p.invoice,
  outlet: p.outlet,
  currency: p.currency,
  amountNgn: naira(p.amountKobo),
  amountUsd: p.amountCents / 100,
  ngnPerUsd: p.ngnPerUsd,
  receivedNgn: naira(p.receivedKobo),
  feeNgn: naira(p.feeKobo),
  customer: { email: p.customerEmail, name: p.customerName, phone: p.customerPhone },
  // A crypto payer has no name - only the wallet it came from.
  payer: p.payerName || p.payerBank || p.payerAccount ? { name: p.payerName, bank: p.payerBank, account: p.payerAccount, session: p.payerSession } : null,
  /** Crypto: the coin and the network it came on. */
  coin: p.coin,
  network: p.network,
  /**
   * Paid through NEAR Intents: what the customer actually sent, on their own chain, and their transaction there.
   * coin and network above are where the USDC it became landed, ours.
   */
  paidWith: paidWith(p),
  createdAt: p.createdAt,
  paidAt: p.paidAt,
  settlement: p.settlement ? settlementBrief(p.settlement) : null,
});

/** Payments that came to something: waiting, paid, or short. Checkouts that closed with nothing are left out. */
router.get("/payments", requireMember(), async (req, res) => {
  const list = await prisma.payment.findMany({
    where: { businessId: req.member!.businessId, mode: mode(req.query.mode), status: { not: "EXPIRED" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { link: { select: { id: true, name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true } }, settlement: true },
  });
  res.json({ payments: list.map(paymentShape) });
});

/**
 * Every paid payment through one link or one outlet, for the business to keep:
 * who paid (the name when they gave one), their email, how much and how. The
 * dashboard turns it into a CSV or a PDF.
 */
router.get("/payments/export", requireMember(), async (req, res) => {
  const linkId = typeof req.query.linkId === "string" ? req.query.linkId : null;
  const outletId = typeof req.query.outletId === "string" ? req.query.outletId : null;
  const invoiceId = typeof req.query.invoiceId === "string" ? req.query.invoiceId : null;
  if ([linkId, outletId, invoiceId].filter(Boolean).length !== 1) throw new HttpError(400, "Pick one payment link, outlet or invoice to export.", "bad_export");
  const list = await prisma.payment.findMany({
    where: { businessId: req.member!.businessId, mode: mode(req.query.mode), status: { in: ["PAID", "UNDERPAID"] }, ...(linkId ? { linkId } : outletId ? { outletId } : { invoiceId: invoiceId! }) },
    orderBy: { paidAt: "desc" },
    take: 10_000,
  });
  res.json({
    rows: list.map((p) => ({
      paidAt: p.paidAt ?? p.createdAt,
      ref: p.ref,
      name: p.customerName,
      email: p.customerEmail,
      phone: p.customerPhone,
      method: p.method,
      currency: p.currency,
      amountNgn: p.amountKobo / 100,
      amountUsd: p.amountCents / 100,
      receivedNgn: p.receivedKobo != null ? p.receivedKobo / 100 : null,
      status: p.status,
    })),
  });
});

router.get("/settlements", requireMember(), async (req, res) => {
  const list = await prisma.settlement.findMany({
    where: { businessId: req.member!.businessId, mode: mode(req.query.mode) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { payment: { select: { ref: true, ngnPerUsd: true } } },
  });
  res.json({
    settlements: list.map((s) => ({
      ...settlementBrief(s),
      ref: s.ref,
      paymentId: s.paymentId,
      paymentRef: s.payment.ref,
      mode: s.mode,
      accountName: s.accountName,
      feeNgn: naira(s.feeKobo),
      amountUsd: koboToCents(s.amountKobo, s.payment.ngnPerUsd) / 100,
      createdAt: s.createdAt,
    })),
  });
});

export default router;
