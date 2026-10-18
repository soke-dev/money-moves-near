/**
 * What the API and its webhooks say things are: one shape per object, used by
 * every endpoint and every event, so a payment read from GET /v1/payments/:id
 * is exactly the payment a webhook sent.
 *
 * Amounts are numbers in the currency's own units (naira, dollars), never kobo
 * or cents. Times are ISO 8601. Anything not set is null, never left out.
 */
import type { Dispute, DisputeMessage, Mode, PayMethod, Payment, PaymentLink, Refund, Settlement, WalletSend } from "@prisma/client";
import { checkoutLink } from "./pay-links";

const mode = (m: Mode) => (m === "TEST" ? "test" : "live");
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const naira = (kobo: number | null | undefined) => (kobo == null ? null : kobo / 100);

export const METHOD_OUT: Record<PayMethod, "bank_transfer" | "app" | "crypto"> = { NAIRA: "bank_transfer", APP: "app", CRYPTO: "crypto" };
export const METHOD_IN = { bank_transfer: "NAIRA", app: "APP", crypto: "CRYPTO" } as const;

const PAYMENT_STATUS = { OPEN: "open", PAID: "successful", UNDERPAID: "underpaid", EXPIRED: "expired" } as const;

/** A payment: one attempt by a customer to pay, by one method. */
export function paymentObject(p: Payment, link?: Pick<PaymentLink, "id" | "metadata" | "reference" | "apiKeyId"> | null) {
  const tx = (p.method === "CRYPTO" || p.method === "APP") && p.payerSession ? p.payerSession.split(":")[0]! : null;
  return {
    id: p.id,
    object: "payment",
    mode: mode(p.mode),
    status: PAYMENT_STATUS[p.status],
    reference: p.ref,
    /** The checkout it was made through - a payment link or an API checkout - or null for an invoice or a store QR. */
    checkout: p.linkId,
    invoice: p.invoiceId,
    outlet: p.outletId,
    /** Your own reference and data, from the checkout. */
    checkout_reference: link?.reference ?? null,
    metadata: (link?.metadata as Record<string, string> | null) ?? null,
    currency: p.currency,
    amount_ngn: p.amountKobo / 100,
    amount_usd: p.amountCents / 100,
    /** The processing fee added on top for the customer, when they pay it. */
    customer_fee_ngn: naira(p.customerFeeKobo),
    /** Our fee on it, in naira. Null until it's paid. */
    fee_ngn: naira(p.feeKobo),
    received_ngn: naira(p.receivedKobo),
    rate_ngn_per_usd: p.ngnPerUsd,
    method: METHOD_OUT[p.method],
    crypto: p.method === "CRYPTO" ? { coin: p.coin, network: p.network, address: p.depositAddress, memo: p.depositMemo, transaction: tx } : null,
    customer: { email: p.customerEmail, name: p.customerName, phone: p.customerPhone },
    payer: p.status === "OPEN" || p.status === "EXPIRED" ? null : { name: p.payerName, bank: p.payerBank, account: p.payerAccount },
    /** A link the customer can open to see or download their receipt, once it's paid. */
    receipt_url: p.status === "PAID" || p.status === "UNDERPAID" ? checkoutLink(`r/${p.token}`) : null,
    created_at: iso(p.createdAt),
    paid_at: iso(p.paidAt),
    expires_at: iso(p.expiresAt),
  };
}

/** A checkout: one amount, and one page to send a customer to. Paid once. */
export function checkoutObject(l: PaymentLink, paid: Payment | null) {
  const expired = !!l.expiresAt && l.expiresAt.getTime() < Date.now();
  return {
    id: l.id,
    object: "checkout",
    mode: mode(l.mode),
    status: paid ? "paid" : !l.active || l.deletedAt ? "cancelled" : expired ? "expired" : "open",
    url: checkoutLink(l.slug),
    amount: l.amountMinor != null ? l.amountMinor / 100 : null,
    currency: l.currency,
    description: l.description,
    reference: l.reference,
    metadata: (l.metadata as Record<string, string> | null) ?? null,
    methods: l.methods.map((m) => METHOD_OUT[m]),
    customer: { email: l.customerEmail, name: l.customerName },
    fee_payer: l.feePayer ? (l.feePayer === "CUSTOMER" ? "customer" : "business") : null,
    redirect_url: l.redirectUrl,
    payment: paid ? paymentObject(paid, l) : null,
    expires_at: iso(l.expiresAt),
    created_at: iso(l.createdAt),
  };
}

/** A settlement: a payment's money, on its way to (or at) where the business chose. Never "failed" - a late one is ours to sort out. */
export function settlementObject(s: Settlement, paymentRef?: string | null) {
  return {
    id: s.id,
    object: "settlement",
    mode: mode(s.mode),
    status: s.status === "SETTLED" ? "completed" : "pending",
    reference: s.ref,
    payment: s.paymentId,
    payment_reference: paymentRef ?? null,
    destination: s.destination === "BANK" ? "bank" : s.destination === "MONEY_MOVES" ? "money_moves" : "wallet",
    amount_ngn: s.amountKobo / 100,
    fee_ngn: s.feeKobo / 100,
    bank: s.destination === "BANK" ? { name: s.bankName, account_number: s.accountNumber, account_name: s.accountName } : null,
    crypto: s.chain ? { network: s.chain.charAt(0) + s.chain.slice(1).toLowerCase(), address: s.toAddress, amount_usdc: s.amountMicros != null ? Number(s.amountMicros) / 1e6 : null, transaction: s.txHash } : null,
    created_at: iso(s.createdAt),
    completed_at: iso(s.settledAt),
  };
}

const REFUND_STATUS = { AWAITING_FUNDS: "awaiting_funds", SENDING: "processing", REFUNDED: "completed", CANCELLED: "cancelled" } as const;

/** A refund: money going back to a customer, funded by the business. */
export function refundObject(r: Refund) {
  return {
    id: r.id,
    object: "refund",
    mode: mode(r.mode),
    status: REFUND_STATUS[r.status],
    reference: r.ref,
    payment: r.paymentId,
    amount_ngn: r.amountKobo / 100,
    amount_usd: r.amountCents / 100,
    /** What the business sends to fund it: the amount less our fee on it, given back. */
    funding: {
      method: r.funding === "BANK" ? "bank_transfer" : r.funding === "HELD" ? "held" : r.funding.toLowerCase(),
      amount_ngn: r.fundKobo / 100,
      fee_returned_ngn: r.feeBackKobo / 100,
      bank: r.fundAccount ? { name: r.fundBank, account_number: r.fundAccount, account_name: r.fundName, expires_at: iso(r.fundExpiresAt) } : null,
      funded_at: iso(r.fundedAt),
    },
    to: { kind: r.toKind.toLowerCase(), name: r.toName, bank: r.toBank, account: r.toAccount, coin: r.toCoin, network: r.toNetwork },
    reason: r.reason,
    created_at: iso(r.createdAt),
    completed_at: iso(r.doneAt),
  };
}

const DISPUTE_STATUS = { NEEDS_REPLY: "needs_reply", UNDER_REVIEW: "under_review", WON: "won", REFUNDED: "refunded", LOST: "lost" } as const;

const SAID_BY = { CUSTOMER: "customer", BUSINESS: "business", BANK: "bank", US: "money_moves" } as const;

/** A dispute: a customer, or the sender's bank, questioning a payment. With its messages when they're read with it. */
export function disputeObject(d: Dispute & { messages?: DisputeMessage[] }, files?: Map<string, string>) {
  return {
    id: d.id,
    object: "dispute",
    mode: mode(d.mode),
    kind: d.kind === "BANK" ? "bank_claim" : "customer",
    status: DISPUTE_STATUS[d.status],
    reference: d.ref,
    payment: d.paymentId,
    reason: d.reason.toLowerCase(),
    amount_ngn: d.amountKobo / 100,
    reply_by: iso(d.replyBy),
    outcome: d.outcome,
    refund: d.refundId,
    /** After you reply to a customer: when they have to answer by, or it closes in your favour. */
    customer_answers_by: iso(d.waitUntil),
    created_at: iso(d.createdAt),
    closed_at: iso(d.closedAt),
    ...(d.messages
      ? {
          messages: d.messages.map((m) => ({
            from: SAID_BY[m.from as keyof typeof SAID_BY] ?? m.from.toLowerCase(),
            body: m.body,
            files: m.documentIds.map((id) => ({ id, name: files?.get(id) ?? "File" })),
            created_at: iso(m.createdAt),
          })),
        }
      : {}),
  };
}

const PAYOUT_STATUS: Record<string, string> = { PREPARED: "pending", SENT: "processing", CONFIRMED: "completed", PAYING: "processing", PAID: "completed", FAILED: "failed", EXPIRED: "cancelled" };

/** A payout: money the owner sent out of the business wallet - to a bank, or a crypto address. */
export function payoutObject(s: WalletSend) {
  const toBank = s.kind === "BANK";
  return {
    id: s.id,
    object: "payout",
    status: s.kind === "BANK" && s.status === "CONFIRMED" ? "processing" : (PAYOUT_STATUS[s.status] ?? "processing"),
    reference: s.ref,
    destination: toBank ? "bank" : "crypto",
    network: s.chain.charAt(0) + s.chain.slice(1).toLowerCase(),
    amount_usdc: Number(s.amountMicros) / 1e6,
    bank: toBank ? { name: s.bankName, account_number: s.accountNumber, account_name: s.accountName, amount_ngn: naira(s.payoutKobo), fee_ngn: naira(s.feeKobo) } : null,
    address: toBank ? null : s.toAddress,
    transaction: s.txHash,
    created_at: iso(s.createdAt),
  };
}

/** An invoice: a bill sent to one customer, paid once. */
export function invoiceObject(i: import("@prisma/client").Invoice) {
  return {
    id: i.id,
    object: "invoice",
    mode: mode(i.mode),
    number: i.number,
    status: i.status.toLowerCase(),
    amount: i.amountMinor / 100,
    currency: i.currency,
    customer: { email: i.customerEmail, name: i.customerName },
    url: checkoutLink(`i/${i.token}`),
    due_at: iso(i.dueAt),
    paid_at: iso(i.paidAt),
    created_at: iso(i.createdAt),
  };
}
