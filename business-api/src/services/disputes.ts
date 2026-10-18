/**
 * Disputes: someone questioning a payment. Two kinds, and they're not alike.
 *
 * A customer raises one from their receipt: didn't get it, charged twice, not
 * as described. App and stablecoin payments can't be pulled back, so it's a
 * conversation. The business has 3 days to reply or refund. Once it replies,
 * the customer has 3 days to accept or answer back; accepting, or saying
 * nothing, closes it in the business's favour. No reply from the business in
 * time closes it in the customer's favour, and we ask the business to refund.
 *
 * A bank claim only happens on a naira transfer: the sender's bank says it
 * wasn't authorised and asks for the money back. Our team records it, the
 * business sends proof of the sale within 5 days, we pass it on, and our team
 * records what the bank decided. If the bank keeps its claim, the business
 * funds it the way it funds a refund.
 *
 * A refund on the payment, while a dispute is open, closes it with that
 * refund. Nothing here moves money.
 */
import type { Dispute, DisputeKind, DisputeMessage, DisputeReason, DisputeStatus, Payment, Prisma, Refund, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { dashboardUrl, sendEmail } from "../lib/email";
import { checkoutLink } from "../lib/pay-links";
import { formatMinor, newDisputeRef } from "../lib/money";
import { disputeEvent } from "./events";

export const REPLY_DAYS: Record<DisputeKind, number> = { CUSTOMER: 3, BANK: 5 };
/** After the business replies, how long the customer has to accept or answer. */
export const WAIT_DAYS = 3;
/** How long after paying a customer can still raise one. */
export const RAISE_WITHIN_DAYS = 60;
const DAY = 86_400_000;

export const CUSTOMER_REASONS = ["NOT_RECEIVED", "DUPLICATE", "NOT_AS_DESCRIBED"] as const;
export const REASON_WORDS: Record<DisputeReason, string> = {
  NOT_RECEIVED: "Didn't receive it",
  DUPLICATE: "Charged twice",
  NOT_AS_DESCRIBED: "Not as described",
  UNRECOGNISED: "Doesn't recognise it",
  UNAUTHORISED: "Not authorised",
};
const OPEN: DisputeStatus[] = ["NEEDS_REPLY", "UNDER_REVIEW"];
export const isOpen = (d: Pick<Dispute, "status">) => OPEN.includes(d.status);

/** Who on the team is emailed about disputes: the owner, and admins when there are any. Everyone who can answer sees them in the dashboard. */
const EMAILED: Role[] = ["OWNER", "ADMIN"];

const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
const firstName = (name: string | null | undefined) => (name?.trim().split(/\s+/)[0] ?? "") || "The customer";
const amountOf = (d: Pick<Dispute, "amountKobo">, p: Pick<Payment, "currency" | "amountCents" | "amountKobo">) =>
  p.currency === "USD" ? formatMinor(Math.round((p.amountCents * d.amountKobo) / Math.max(1, p.amountKobo)), "USD") : formatMinor(d.amountKobo, "NGN");

type WithPayment = Dispute & { payment: Payment; business: { name: string } };
const full = (id: string) => prisma.dispute.findUniqueOrThrow({ where: { id }, include: { payment: true, business: { select: { name: true } } } });

export function say(disputeId: string, from: "CUSTOMER" | "BUSINESS" | "BANK" | "US", body: string, by?: string | null, documentIds: string[] = [], tx: Prisma.TransactionClient = prisma) {
  return tx.disputeMessage.create({ data: { disputeId, from, body, by: by ?? null, documentIds } });
}

async function teamEmails(businessId: string) {
  const ms = await prisma.member.findMany({ where: { businessId, role: { in: EMAILED } }, include: { user: { select: { email: true } } } });
  return [...new Set(ms.map((m) => m.user.email))];
}

/** Tells the owner and admins. Never throws: an email that doesn't go never stops a dispute. */
async function tellBusiness(d: WithPayment, subject: string, text: string) {
  const url = dashboardUrl(`/transactions/disputes?d=${d.id}`);
  for (const to of await teamEmails(d.businessId)) {
    await sendEmail(to, subject, `${text}\n\n${url}`, { label: "Disputes", cta: { label: "Open the dispute", url } }).catch(() => false);
  }
}

/** Tells the customer, with the link to their receipt, where they follow it and answer. */
async function tellCustomer(d: WithPayment, subject: string, text: string) {
  const to = d.customerEmail ?? d.payment.customerEmail;
  if (!to || d.kind !== "CUSTOMER") return;
  const url = checkoutLink(`r/${d.payment.token}`);
  await sendEmail(to, subject, `${text}\n\n${url}\n\nReference: ${d.ref}`, { label: "Your payment", cta: { label: "See your dispute", url } }).catch(() => false);
}

// ─── The customer, from their receipt ─────────────────────────────────────

export async function raiseCustomerDispute(p: Payment, input: { reason: (typeof CUSTOMER_REASONS)[number]; message: string; name?: string; email?: string }) {
  if (p.status !== "PAID" && p.status !== "UNDERPAID") throw new HttpError(400, "Only a payment that went through can be disputed.", "not_disputable");
  if (p.paidAt && Date.now() - p.paidAt.getTime() > RAISE_WITHIN_DAYS * DAY) {
    throw new HttpError(400, `Disputes can be raised up to ${RAISE_WITHIN_DAYS} days after paying. Contact the business directly about this one.`, "too_late");
  }
  // One per payment, and only one raised at a time: the payment's row is locked while we check.
  const d = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${p.id} FOR UPDATE`;
    if (await tx.dispute.findFirst({ where: { paymentId: p.id, kind: "CUSTOMER" } })) throw new HttpError(409, "There's already a dispute on this payment. Follow it below.", "already_disputed");
    const business = await tx.business.findUniqueOrThrow({ where: { id: p.businessId }, select: { name: true } });
    const replyBy = new Date(Date.now() + REPLY_DAYS.CUSTOMER * DAY);
    const created = await tx.dispute.create({
      data: {
        ref: newDisputeRef(),
        businessId: p.businessId,
        paymentId: p.id,
        mode: p.mode,
        kind: "CUSTOMER",
        reason: input.reason,
        amountKobo: p.receivedKobo ?? p.amountKobo,
        replyBy,
        customerName: input.name?.trim() || p.customerName,
        customerEmail: input.email?.trim().toLowerCase() || p.customerEmail,
        openedBy: "customer",
      },
    });
    await say(created.id, "CUSTOMER", input.message.trim(), null, [], tx);
    await say(created.id, "US", `We've told ${business.name}. They have until ${when(replyBy)} to reply or refund.`, null, [], tx);
    return created;
  });
  const fresh = await full(d.id);
  void disputeEvent(d.id, "dispute.created");
  void tellBusiness(
    fresh,
    `A customer disputed ${p.ref}`,
    `${fresh.customerName ?? "A customer"} disputed payment ${p.ref} (${amountOf(fresh, p)}): ${REASON_WORDS[fresh.reason].toLowerCase()}.\n\n"${input.message.trim().slice(0, 600)}"\n\nReply or refund by ${when(fresh.replyBy)}. With no reply by then, it closes in the customer's favour.`,
  );
  void tellCustomer(fresh, `We've opened your dispute with ${fresh.business.name}`, `We've passed your dispute on payment ${p.ref} to ${fresh.business.name}. They have until ${when(fresh.replyBy)} to reply or refund, and we'll email you when they do.`);
  return fresh;
}

/** The customer answers back: it's the business's turn again, with a fresh deadline. */
export async function customerReply(d: Dispute, message: string) {
  if (d.kind !== "CUSTOMER" || !isOpen(d)) throw new HttpError(409, "This dispute is closed.", "closed");
  const replyBy = new Date(Date.now() + REPLY_DAYS.CUSTOMER * DAY);
  const moved = await prisma.dispute.updateMany({ where: { id: d.id, status: { in: OPEN } }, data: { status: "NEEDS_REPLY", replyBy: d.status === "UNDER_REVIEW" ? replyBy : d.replyBy, waitUntil: null } });
  if (!moved.count) throw new HttpError(409, "This dispute is closed.", "closed");
  await say(d.id, "CUSTOMER", message.trim());
  const fresh = await full(d.id);
  if (d.status === "UNDER_REVIEW") await say(d.id, "US", `${firstName(fresh.customerName)} answered. Reply or refund by ${when(fresh.replyBy)}.`);
  void tellBusiness(fresh, `${firstName(fresh.customerName)} replied on ${fresh.payment.ref}`, `${fresh.customerName ?? "The customer"} replied on dispute ${fresh.ref}:\n\n"${message.trim().slice(0, 600)}"\n\nReply or refund by ${when(fresh.replyBy)}.`);
  return full(d.id);
}

/** The customer accepts the business's reply: closed in its favour. */
export async function customerAccept(d: Dispute) {
  if (d.kind !== "CUSTOMER" || d.status !== "UNDER_REVIEW") throw new HttpError(409, "There's no reply to accept yet.", "nothing_to_accept");
  const fresh = await close(d, "WON", `${firstName(d.customerName)} accepted your reply, so it closed in your favour.`, "customer");
  void tellBusiness(fresh, `Dispute ${fresh.ref} closed in your favour`, `${fresh.customerName ?? "The customer"} accepted your reply on payment ${fresh.payment.ref}. The dispute is closed.`);
  return fresh;
}

// ─── The business ─────────────────────────────────────────────────────────

/** The business replies, with any files it attached. A customer then has 3 days; a bank claim goes to the bank. */
export async function businessReply(d: Dispute, body: string, documentIds: string[], by: string) {
  if (!isOpen(d)) throw new HttpError(409, "This dispute is closed.", "closed");
  if (d.refundId) throw new HttpError(409, "This dispute closed with a refund.", "closed");
  if (documentIds.length) {
    const ok = await prisma.document.count({ where: { id: { in: documentIds }, businessId: d.businessId, kind: `dispute:${d.id}` } });
    if (ok !== documentIds.length) throw new HttpError(400, "One of those files isn't attached to this dispute. Add it again.", "bad_file");
  }
  const waitUntil = d.kind === "CUSTOMER" ? new Date(Date.now() + WAIT_DAYS * DAY) : null;
  const moved = await prisma.dispute.updateMany({ where: { id: d.id, status: { in: OPEN } }, data: { status: "UNDER_REVIEW", waitUntil } });
  if (!moved.count) throw new HttpError(409, "This dispute is closed.", "closed");
  await say(d.id, "BUSINESS", body.trim(), by, documentIds);
  const fresh = await full(d.id);
  if (d.kind === "CUSTOMER") {
    await say(d.id, "US", `We passed your reply on. ${firstName(fresh.customerName)} has until ${when(waitUntil!)} to accept it or reply. If they say nothing, it closes in your favour.`);
    void tellCustomer(
      fresh,
      `${fresh.business.name} replied to your dispute`,
      `${fresh.business.name} replied on payment ${fresh.payment.ref}:\n\n"${body.trim().slice(0, 1200)}"\n\nAccept it or reply by ${when(waitUntil!)}. If you don't answer by then, the dispute closes.`,
    );
  } else {
    await say(d.id, "US", "We're sending your reply and files to the sender's bank. Banks usually decide within 10 working days. We'll tell you the moment they do.");
  }
  void disputeEvent(d.id, "dispute.updated");
  return full(d.id);
}

/** A refund on a disputed payment: an open dispute closes with it; a lost bank claim is now funded. */
export async function onRefund(r: Refund) {
  const ds = await prisma.dispute.findMany({ where: { paymentId: r.paymentId, refundId: null, OR: [{ status: { in: OPEN } }, { status: "LOST" }] }, include: { payment: true } });
  for (const d of ds) {
    const amount = r.amountCents && d.payment.currency === "USD" ? formatMinor(r.amountCents, "USD") : formatMinor(r.amountKobo, "NGN");
    if (isOpen(d)) {
      const fresh = await close(d, "REFUNDED", `Closed with a refund of ${amount}.`, r.requestedBy, r.id);
      void tellCustomer(fresh, `${fresh.business.name} is refunding you`, `${fresh.business.name} is refunding ${amount} on payment ${fresh.payment.ref}, and your dispute is closed. Refunds usually arrive within 24 to 48 hours, the way you paid.`);
    } else {
      await prisma.dispute.update({ where: { id: d.id }, data: { refundId: r.id } });
      await say(d.id, "US", `You've started sending ${amount} back for this claim (refund ${r.ref}). We pass it to the sender once it's funded.`);
    }
  }
}

// ─── Our team ─────────────────────────────────────────────────────────────

/** A bank claim on a naira transfer, recorded by our team from the rail's notice. */
export async function recordBankClaim(p: Payment, input: { reason: DisputeReason; amountKobo?: number; note: string; by: string }) {
  if (p.method !== "NAIRA") throw new HttpError(400, "Bank claims only happen on bank transfers.", "not_naira");
  if (p.status !== "PAID" && p.status !== "UNDERPAID") throw new HttpError(400, "That payment didn't go through.", "not_paid");
  const received = p.receivedKobo ?? p.amountKobo;
  const amountKobo = input.amountKobo ?? received;
  if (amountKobo <= 0 || amountKobo > received) throw new HttpError(400, `A claim can be up to ${formatMinor(received, "NGN")}.`, "bad_amount");
  if (await prisma.dispute.findFirst({ where: { paymentId: p.id, kind: "BANK", status: { in: OPEN } } })) throw new HttpError(409, "There's already an open bank claim on this payment.", "already_claimed");
  const replyBy = new Date(Date.now() + REPLY_DAYS.BANK * DAY);
  const d = await prisma.dispute.create({
    data: { ref: newDisputeRef(), businessId: p.businessId, paymentId: p.id, mode: p.mode, kind: "BANK", reason: input.reason, amountKobo, replyBy, customerName: p.payerName ?? p.customerName, customerEmail: null, openedBy: input.by },
  });
  await say(d.id, "BANK", input.note.trim(), input.by);
  await say(d.id, "US", `Send proof of a real sale by ${when(replyBy)}: an invoice, a delivery note, your messages with the customer. We pass it to the bank and it decides.`);
  const fresh = await full(d.id);
  void disputeEvent(d.id, "dispute.created");
  void tellBusiness(
    fresh,
    `A bank claim on ${p.ref}`,
    `The sender's bank says the transfer for payment ${p.ref} (${formatMinor(amountKobo, "NGN")}) wasn't authorised, and asks for it back.\n\nSend proof of a real sale by ${when(replyBy)}. If the bank keeps its claim, the money goes back to the sender and you fund it like a refund.`,
  );
  return fresh;
}

/** Our team writes in: as Money Moves, or passing on what the bank said. It can hand the turn back to the business. */
export async function teamMessage(d: Dispute, input: { from: "US" | "BANK"; body: string; needsReply?: boolean; by: string }) {
  if (!isOpen(d)) throw new HttpError(409, "This dispute is closed.", "closed");
  if (input.from === "BANK" && d.kind !== "BANK") throw new HttpError(400, "Only a bank claim has a bank to pass on.", "not_bank");
  await say(d.id, input.from, input.body.trim(), input.by);
  if (input.needsReply) await prisma.dispute.update({ where: { id: d.id }, data: { status: "NEEDS_REPLY", replyBy: new Date(Date.now() + REPLY_DAYS[d.kind] * DAY), waitUntil: null } });
  const fresh = await full(d.id);
  void tellBusiness(fresh, `An update on dispute ${fresh.ref}`, `${input.from === "BANK" ? "The sender's bank" : "Money Moves"} wrote on dispute ${fresh.ref}:\n\n"${input.body.trim().slice(0, 1200)}"${input.needsReply ? `\n\nReply by ${when(fresh.replyBy)}.` : ""}`);
  return fresh;
}

/** Our team closes it: the bank's decision, or a customer dispute decided by us. */
export async function teamDecide(d: Dispute, input: { status: "WON" | "LOST"; outcome?: string; by: string }) {
  if (!isOpen(d)) throw new HttpError(409, "This dispute is already closed.", "closed");
  const words =
    input.outcome?.trim() ||
    (d.kind === "BANK"
      ? input.status === "WON"
        ? "The bank dropped its claim. You keep the payment."
        : "The bank kept its claim. Fund it like a refund and we send it back to the sender."
      : input.status === "WON"
        ? "Closed in your favour."
        : "Closed in the customer's favour. Refund them from the payment.");
  const fresh = await close(d, input.status, words, input.by);
  void tellBusiness(fresh, `Dispute ${fresh.ref} is closed`, `Dispute ${fresh.ref} on payment ${fresh.payment.ref} is closed. ${words}`);
  if (d.kind === "CUSTOMER") void tellCustomer(fresh, `Your dispute with ${fresh.business.name} is closed`, `Your dispute on payment ${fresh.payment.ref} is closed. ${input.status === "LOST" ? `We've asked ${fresh.business.name} to refund you.` : "It closed in the business's favour."}`);
  return fresh;
}

async function close(d: Dispute, status: "WON" | "LOST" | "REFUNDED", outcome: string, by: string, refundId?: string) {
  const done = await prisma.dispute.updateMany({ where: { id: d.id, status: { in: OPEN } }, data: { status, outcome, closedAt: new Date(), closedBy: by, waitUntil: null, ...(refundId ? { refundId } : {}) } });
  if (done.count) {
    await say(d.id, "US", outcome);
    void disputeEvent(d.id, "dispute.closed");
  }
  return full(d.id);
}

/** The worker's round: deadlines that passed. A bank claim waits for the bank, whatever the date. */
export async function sweepDisputes() {
  const now = new Date();
  const unanswered = await prisma.dispute.findMany({ where: { kind: "CUSTOMER", status: "NEEDS_REPLY", replyBy: { lt: now } }, take: 50 });
  for (const d of unanswered) {
    try {
      const fresh = await close(d, "LOST", "No reply by the deadline, so it closed in the customer's favour. Refund them from the payment.", "system");
      void tellBusiness(fresh, `Dispute ${fresh.ref} closed in the customer's favour`, `You didn't reply to dispute ${fresh.ref} on payment ${fresh.payment.ref} in time, so it closed in the customer's favour. Refund them from the payment.`);
      void tellCustomer(fresh, `Your dispute with ${fresh.business.name} is closed`, `${fresh.business.name} didn't reply in time, so your dispute on payment ${fresh.payment.ref} closed in your favour. We've asked them to refund you.`);
    } catch (e) {
      log.warn("[disputes] couldn't close an unanswered dispute", { ref: d.ref, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const quiet = await prisma.dispute.findMany({ where: { kind: "CUSTOMER", status: "UNDER_REVIEW", waitUntil: { lt: now } }, take: 50 });
  for (const d of quiet) {
    try {
      const fresh = await close(d, "WON", `${firstName(d.customerName)} didn't answer within ${WAIT_DAYS} days, so it closed in your favour.`, "system");
      void tellBusiness(fresh, `Dispute ${fresh.ref} closed in your favour`, `The customer didn't answer your reply on payment ${fresh.payment.ref} within ${WAIT_DAYS} days, so the dispute closed in your favour.`);
    } catch (e) {
      log.warn("[disputes] couldn't close a quiet dispute", { ref: d.ref, reason: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ─── Shapes ───────────────────────────────────────────────────────────────

type WithMessages = Dispute & { messages: DisputeMessage[] };

/** The files on a dispute's messages, by id: their names. */
export async function filesOf(ds: WithMessages[]) {
  const ids = [...new Set(ds.flatMap((d) => d.messages.flatMap((m) => m.documentIds)))];
  const docs = ids.length ? await prisma.document.findMany({ where: { id: { in: ids } }, select: { id: true, filename: true } }) : [];
  return new Map(docs.map((x) => [x.id, x.filename]));
}

export const messageShape = (m: DisputeMessage, files: Map<string, string>) => ({
  from: m.from,
  body: m.body,
  at: m.createdAt,
  files: m.documentIds.map((id) => ({ id, name: files.get(id) ?? "File" })),
});

/** What the customer sees on their receipt: their dispute, never a bank claim. */
export function customerShape(d: WithMessages) {
  return {
    ref: d.ref,
    status: d.status,
    reason: d.reason,
    openedAt: d.createdAt,
    replyBy: d.replyBy,
    waitUntil: d.waitUntil,
    outcome: d.outcome,
    closedAt: d.closedAt,
    messages: d.messages.filter((m) => m.from !== "BANK").map((m) => ({ from: m.from, body: m.body, at: m.createdAt })),
  };
}
