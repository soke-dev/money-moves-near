/**
 * A business's refunds, one mode at a time: ask for one, fund it, follow it.
 * Test refunds are simulated end to end; live ones are sent by our team once
 * the money is in, and the business sees them move.
 */
import { Router } from "express";
import { z } from "zod";
import type { Payment, PaymentLink, Refund, Settlement } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { limited } from "../lib/limits";
import { koboToCents } from "../lib/money";
import { requireMember } from "../middleware/auth";
import { audit } from "../lib/audit";
import { paymentShape } from "./money";
import { REFUND_WITHIN_MS, fundingsFor, askRefund, canSimulateFunding, cancelRefund, checkRefundFunding, refundCurrency, simulateFunding } from "../services/refunds";

const router = Router({ mergeParams: true });

/** Who can send money back: the people who look after the business's money. */
const MONEY = ["OWNER", "ADMIN", "FINANCE"] as const;
const asking = limited(30);

type WithPayment = Refund & {
  payment: Payment & {
    link: Pick<PaymentLink, "id" | "name" | "slug"> | null;
    invoice: { id: string; number: string } | null;
    outlet: { id: string; name: string } | null;
    settlement: Settlement | null;
  };
};

const withPayment = { payment: { include: { link: { select: { id: true, name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true } }, settlement: true } } } as const;

/** In the refund's own money: naira for a transfer, coins - a dollar each - for the app and crypto. */
export function refundShape(r: WithPayment) {
  const usd = refundCurrency(r.payment) === "USD";
  const shown = (kobo: number, cents?: number) => (usd ? (cents ?? koboToCents(kobo, r.payment.ngnPerUsd)) / 100 : kobo / 100);
  return {
    id: r.id,
    ref: r.ref,
    mode: r.mode,
    status: r.status,
    funding: r.funding,
    currency: usd ? "USD" : "NGN",
    amount: shown(r.amountKobo, r.amountCents),
    feeBack: shown(r.feeBackKobo),
    /** What the business sends: naira by bank transfer, dollars from the app or its wallet. */
    fund: {
      amountNgn: r.fundKobo / 100,
      amountUsd: r.fundCents / 100,
      account: r.fundAccount ? { bank: r.fundBank, number: r.fundAccount, name: r.fundName, expiresAt: r.fundExpiresAt } : null,
      /** From the app: the request the owner opens by QR, or by the link on the phone the app is on. */
      app: r.fundCode ? { link: `money-moves://business-pay?code=${encodeURIComponent(r.fundCode)}`, expiresAt: r.fundExpiresAt } : null,
      tx: r.fundTx,
    },
    to: { kind: r.toKind, name: r.toName, bank: r.toBank, account: r.toAccount, coin: r.toCoin, network: r.toNetwork },
    reason: r.reason,
    requestedAt: r.createdAt,
    fundedAt: r.fundedAt,
    doneAt: r.doneAt,
    /** When the customer should have it: 48 hours after we have the money. */
    dueBy: r.fundedAt ? new Date(r.fundedAt.getTime() + REFUND_WITHIN_MS) : null,
    /** The test "pretend the money arrived" works for this one. */
    simulator: canSimulateFunding(r),
    payment: paymentShape(r.payment),
  };
}

const mode = (q: unknown) => (String(q).toLowerCase() === "live" ? "LIVE" : "TEST");

async function mine(businessId: string, id: string) {
  const r = await prisma.refund.findFirst({ where: { id, businessId } });
  if (!r) throw new HttpError(404, "That refund isn't here.", "not_found");
  return r;
}
const reread = (id: string) => prisma.refund.findUniqueOrThrow({ where: { id }, include: withPayment });

router.get("/", requireMember(), async (req, res) => {
  const list = await prisma.refund.findMany({
    where: { businessId: req.member!.businessId, mode: mode(req.query.mode), status: { not: "CANCELLED" } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: withPayment,
  });
  const ways = await fundingsFor(req.member!.businessId, mode(req.query.mode), req.member!.role === "OWNER");
  res.json({ refunds: list.map(refundShape), fundings: ways.open, closedFundings: ways.closed });
});

router.get("/:refundId", requireMember(), async (req, res) => {
  const r = await mine(req.member!.businessId, String(req.params.refundId));
  // Asked about: look at the funding account now rather than at the worker's next round.
  const fresh = r.status === "AWAITING_FUNDS" ? await checkRefundFunding(r) : r;
  res.json({ refund: refundShape(await reread(fresh.id)) });
});

router.post("/", requireMember(...MONEY), asking, async (req, res) => {
  const b = body(
    z.object({
      paymentId: z.string().min(1),
      /** In the refund's currency. Absent: everything that's left. */
      amount: z.number().positive("Enter how much to refund.").optional(),
      funding: z.enum(["WALLET", "APP", "BANK"]).optional(),
      reason: z.string().trim().max(280, "Keep the reason under 280 characters.").optional(),
    }),
    req,
  );
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.member!.businessId } });
  const r = await askRefund({ business, paymentId: b.paymentId, amount: b.amount, funding: b.funding, reason: b.reason, by: req.auth!.userId, owner: req.member!.role === "OWNER" });
  const paid = await prisma.payment.findUnique({ where: { id: r.paymentId }, select: { ref: true } });
  await audit(req, "refund_requested", { businessId: business.id, detail: { ref: r.ref, payment: paid?.ref ?? null, funding: r.funding, mode: r.mode } });
  res.status(201).json({ refund: refundShape(await reread(r.id)) });
});

/** Test mode: pretend the business's money arrived - the wallet confirmed, the app approved, the transfer landed. */
router.post("/:refundId/simulate", requireMember(...MONEY), async (req, res) => {
  const r = await mine(req.member!.businessId, String(req.params.refundId));
  const done = await simulateFunding(r, req.auth!.userId);
  res.json({ refund: refundShape(await reread(done.id)) });
});

router.post("/:refundId/cancel", requireMember(...MONEY), async (req, res) => {
  const r = await mine(req.member!.businessId, String(req.params.refundId));
  const done = await cancelRefund(r, req.auth!.userId);
  await audit(req, "refund_cancelled", { businessId: r.businessId, detail: { ref: r.ref } });
  res.json({ refund: refundShape(await reread(done.id)) });
});

export default router;
