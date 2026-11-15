/**
 * POST /api/webhooks/nuvion
 *
 * Nuvion's events for cards: payments, declines, refunds, and card status.
 * Signed with HMAC-SHA256 over "{timestamp}.{raw body}" using the webhook's
 * secret (NUVION_WEBHOOK_SECRET, the nv_wsk_ value shown once when the webhook
 * is made). Anything unsigned, wrongly signed or stale is refused.
 *
 * Answers 200 at once and does the work after: Nuvion retries twice over
 * four minutes on anything else, and a retry is recognised by its event id
 * and dropped. Money never moves here; this only tells people and keeps our
 * copy of each card's status in step.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { sendNotification } from "../lib/push";
import { sendCardPaymentEmail, sendCardFrozenEmail } from "../lib/email";
import { afterDecline } from "../lib/card-guard";
import { cardBalanceCents } from "../lib/card-accounts";
import { recordCardEvent, settleCardEvent } from "../lib/card-ledger";
import { withdrawalTransferDone } from "../lib/card-withdrawals";

const router = Router();

/** How old a delivery's timestamp may be. Retries are re-signed, so this is generous. */
const MAX_AGE_MS = 15 * 60 * 1000;

function verified(req: Request): boolean {
  const secret = env.NUVION_WEBHOOK_SECRET;
  const raw: Buffer | undefined = (req as any).rawBody;
  const timestamp = String(req.headers["x-nuvion-event-timestamp"] || "");
  const received = String(req.headers["x-nuvion-event-signature"] || "");
  if (!secret || !raw || !timestamp || !received) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && Math.abs(Date.now() - at) < MAX_AGE_MS;
}

const usd = (cents: number) => `$${(Math.abs(Number(cents) || 0) / 100).toFixed(2)}`;

/** "Payment to Acme Corp for 7.28 USD" -> "Acme Corp". */
function merchantOf(d: any): string {
  const n = String(d?.recipient?.name || d?.narration || "").replace(/^REVERSAL \| /i, "");
  const m = n.match(/^Payment to (.+?) for [\d.,]+ \w+$/i);
  return (m ? m[1] : n).trim().slice(0, 60) || "a merchant";
}

async function cardFor(d: any) {
  const nuvionCardId = d?.card_id || d?.account?.card_id || d?.initiator?.card_id;
  if (!nuvionCardId) return null;
  return prisma.card.findUnique({ where: { nuvionCardId: String(nuvionCardId) } });
}

async function handle(event: string, d: any): Promise<void> {
  // Card payments, declines and refunds.
  if (event.startsWith("outflows.")) {
    const kind = String(d?.payment_type || "");
    // A card balance sent to someone's wallet (our on-ramp send) has finished.
    if (kind === "stablecoin-transfer" && d?.id) {
      if (event === "outflows.completed") await withdrawalTransferDone(String(d.id), true);
      else if (event === "outflows.failed" || event === "outflows.cancelled") await withdrawalTransferDone(String(d.id), false, d?.status_reason);
      return;
    }
    if (!kind.startsWith("card-")) return; // our own book transfers and payouts
    const card = await cardFor(d);
    if (!card) return;
    const label = `${card.name}${card.last4 ? ` ·· ${card.last4}` : ""}`;
    const amount = Math.abs(Number(d.amount) || 0) / 100;
    const kindOf =
      event === "outflows.created" && kind === "card-debit" ? "paid"
      : event === "outflows.failed" && kind === "card-debit" ? "declined"
      : event === "outflows.refunded" ? "refund"
      : null;
    if (kindOf) {
      const paymentId = String(d?.id || d?._id || "");
      // In the app's transaction list, once per payment (the reference holds it to one).
      const where = d?.recipient?.address;
      await recordCardEvent({
        userId: card.userId,
        event: kindOf,
        amountUsd: amount,
        cardId: card.id,
        cardName: card.name,
        reference: `${kindOf}-${paymentId}`,
        merchant: merchantOf(d),
        place: where ? [where.city, where.country].filter(Boolean).join(", ") : null,
        note: kindOf === "declined" ? d?.status_reason || null : null,
      });

      // A payment first reported as made and then declined: the earlier row goes too.
      if (kindOf === "declined") await settleCardEvent(`paid-${paymentId}`, "FAILED");

      // A decline: its fee, and a freeze when there have been too many.
      const guard = kindOf === "declined" ? await afterDecline(card, paymentId) : null;

      if (guard?.frozen) {
        await sendNotification({
          userId: card.userId,
          type: "transaction",
          title: "We froze your card",
          body: `${guard.declines.length} payments on ${label} were declined, so we froze it to keep your money safe. Unfreeze it in Cards if they were you.`,
        });
      } else {
        await sendNotification({
          userId: card.userId,
          type: "transaction",
          title:
            kindOf === "paid" ? `${usd(d.amount)} at ${merchantOf(d)}`
            : kindOf === "declined" ? "Card payment declined"
            : "Refund on your card",
          body:
            kindOf === "paid" ? `Paid with ${label}.`
            : kindOf === "declined" ? `${usd(d.amount)} at ${merchantOf(d)} on ${label} didn't go through.${card.status === "blocked" ? " The card is frozen." : " Check your card balance."}`
            : `${usd(d.amount)} from ${merchantOf(d)} is back on ${label}.`,
        });
      }

      // And the same as an email, from us.
      const who = await prisma.user.findUnique({ where: { id: card.userId }, select: { email: true, firstName: true, lastName: true } });
      if (who?.email) {
        const ref = { name: card.name, last4: card.last4, oneTime: card.kind === "DISPOSABLE" };
        const date = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
        const balance = await cardBalanceCents(card).then((c) => c / 100).catch(() => null);
        const sent = guard?.frozen
          ? sendCardFrozenEmail(who.email, {
              card: ref,
              holder: [who.firstName, who.lastName].filter(Boolean).join(" "),
              hours: guard.hours,
              declines: guard.declines.map((x) => ({
                merchant: x.merchant,
                amount: x.amount,
                at: x.at.toLocaleTimeString("en-NG", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }),
              })),
              date,
            })
          : sendCardPaymentEmail(who.email, {
              kind: kindOf,
              amount,
              merchant: merchantOf(d),
              card: ref,
              balance,
              reason: kindOf === "declined" ? d?.status_reason || null : null,
              date,
            });
        sent.catch((e) => console.warn(`[NUVION] card email failed: ${e?.message}`));
      }
    }
    // A used one-time card closes after its first payment.
    if (card.kind === "DISPOSABLE" && event === "outflows.completed" && card.status === "active") {
      await prisma.card.update({ where: { id: card.id }, data: { status: "deactivated" } });
    }
    return;
  }

  // Card status, kept in step with what Nuvion says.
  if (event.startsWith("cards.")) {
    const card = d?.id ? await prisma.card.findUnique({ where: { nuvionCardId: String(d.id) } }) : null;
    if (!card || card.deletedAt) return;
    if (event === "cards.deleted") {
      await prisma.card.update({ where: { id: card.id }, data: { status: "deleted", deletedAt: new Date() } });
      return;
    }
    const status = String(d?.status || "");
    if (!status || status === card.status) return;
    await prisma.card.update({ where: { id: card.id }, data: { status } });
    if (status === "fraud") {
      console.error(`[NUVION] card ${card.id} (${card.userId}) flagged as fraud by the issuer`);
      await sendNotification({
        userId: card.userId,
        type: "transaction",
        title: "We've paused a card",
        body: `${card.name} is paused while we look at some activity. Your balance is safe. Contact support if you have questions.`,
      });
    }
  }
}

router.post("/", async (req: Request, res: Response) => {
  if (!verified(req)) {
    if (!env.NUVION_WEBHOOK_SECRET) console.error("[NUVION] webhook received but NUVION_WEBHOOK_SECRET isn't set");
    res.status(401).json({ error: "Unverified" });
    return;
  }
  const event = String(req.body?.event || "");
  const eventId = String(req.headers["x-nuvion-event-id"] || "");
  res.status(200).json({ ok: true });

  if (!event || event === "webhook.health") return;
  try {
    // Once per event: a retry of one already handled is dropped here.
    if (eventId) {
      const fresh = await prisma.nuvionEvent
        .create({ data: { id: eventId, event } })
        .then(() => true)
        .catch(() => false);
      if (!fresh) return;
    }
    await handle(event, req.body?.data);
  } catch (err: any) {
    console.error(`[NUVION] ${event} ${eventId} failed: ${err?.message}`);
  }
});

export default router;
