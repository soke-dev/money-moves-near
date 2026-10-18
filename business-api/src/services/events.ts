/**
 * The events, from where things happen: each helper builds the object as the
 * API shows it and hands it to the webhooks. None of them throws, and none is
 * ever awaited by anything that moves money - they're called with void.
 */
import type { Payment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { emit } from "../lib/webhooks";
import { disputeObject, invoiceObject, paymentObject, payoutObject, refundObject, settlementObject } from "../lib/api-objects";

const quiet = (p: Promise<unknown>) => p.catch(() => undefined);

/** A payment that's just been decided: paid in full, part paid, or lapsed with nothing. */
export function paymentEvent(p: Payment) {
  const type = p.status === "PAID" ? "payment.successful" : p.status === "UNDERPAID" ? "payment.underpaid" : p.status === "EXPIRED" ? "payment.expired" : null;
  if (!type) return Promise.resolve();
  return quiet(
    (async () => {
      const link = p.linkId ? await prisma.paymentLink.findUnique({ where: { id: p.linkId } }) : null;
      await emit(p.businessId, p.mode, type, paymentObject(p, link));
      if (p.status === "PAID" && p.invoiceId) {
        const inv = await prisma.invoice.findUnique({ where: { id: p.invoiceId } });
        if (inv?.status === "PAID") await emit(p.businessId, p.mode, "invoice.paid", invoiceObject(inv));
      }
    })(),
  );
}

/** A settlement that's landed where the business chose. */
export function settlementEvent(settlementId: string) {
  return quiet(
    (async () => {
      const s = await prisma.settlement.findUnique({ where: { id: settlementId }, include: { payment: { select: { ref: true } } } });
      if (s?.status === "SETTLED") await emit(s.businessId, s.mode, "settlement.completed", settlementObject(s, s.payment.ref));
    })(),
  );
}

/** A refund asked for, or done. */
export function refundEvent(refundId: string, type: "refund.created" | "refund.completed") {
  return quiet(
    (async () => {
      const r = await prisma.refund.findUnique({ where: { id: refundId } });
      if (r) await emit(r.businessId, r.mode, type, refundObject(r));
    })(),
  );
}

/** Money the owner sent out of the business wallet: arrived, or failed. Payouts are always live. */
export function payoutEvent(sendId: string, type: "payout.completed" | "payout.failed") {
  return quiet(
    (async () => {
      const s = await prisma.walletSend.findUnique({ where: { id: sendId } });
      if (s) await emit(s.businessId, "LIVE", type, payoutObject(s));
    })(),
  );
}

/** A dispute opened, answered, or closed. */
export function disputeEvent(disputeId: string, type: "dispute.created" | "dispute.updated" | "dispute.closed") {
  return quiet(
    (async () => {
      const d = await prisma.dispute.findUnique({ where: { id: disputeId } });
      if (d) await emit(d.businessId, d.mode, type, disputeObject(d));
    })(),
  );
}
