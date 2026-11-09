/**
 * The live naira rail: Flutterwave, on the same account as the Money Moves app.
 *
 * Money in: every payment gets its own one-time account for the exact amount,
 * open until the payment lapses. That's what makes a transfer safe to match:
 * one account, one payment, one amount. The account is issued under the
 * business's own BVN when it has given one we've accepted, and under the
 * company's otherwise - Flutterwave won't issue one without either.
 *
 * What arrived is found by asking Flutterwave for the charge under our
 * reference. The webhook for this Flutterwave account goes to the app, which
 * acknowledges references it doesn't know and credits nothing, so nothing here
 * depends on it.
 *
 * Money out: a payout from the payout balance, like the app's sells. The
 * settlement's reference is the idempotency key, so a retry can't pay twice,
 * and a call whose outcome we couldn't see throws - the caller then asks by
 * reference and never sends again on its own.
 */
import { env } from "../config/env";
import { flutterwaveBanks, flutterwaveCharge, flutterwaveCustomer, flutterwaveOneTimeAccount, flutterwavePayout, flutterwaveResolve, flutterwaveTransfer, type FlwTransfer } from "../lib/flutterwave";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { prisma } from "../lib/prisma";
import { open } from "../lib/vault";
import type { NairaRails, PayoutState } from "./types";

const naira = (kobo: number) => Math.round(kobo) / 100;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The BVN this business gave us, once our team accepted it - opened from its seal only here, never stored open. */
async function businessBvn(businessId: string): Promise<string | null> {
  const answer = await prisma.infoRequest.findFirst({
    where: { businessId, kind: "BVN", status: "ACCEPTED", answerSealed: { not: null } },
    orderBy: { reviewedAt: "desc" },
    select: { answerSealed: true },
  });
  if (!answer?.answerSealed) return null;
  try {
    const bvn = open(Buffer.from(answer.answerSealed)).toString().replace(/\D/g, "");
    return bvn.length === 11 ? bvn : null;
  } catch {
    log.warn("[rails] a business's BVN couldn't be opened", { businessId });
    return null;
  }
}

async function identityFor(businessId: string): Promise<{ bvn: string } | { nin: string }> {
  const own = await businessBvn(businessId);
  if (own) return { bvn: own };
  if (env.FLUTTERWAVE_COLLECTIONS_BVN) return { bvn: env.FLUTTERWAVE_COLLECTIONS_BVN };
  if (env.FLUTTERWAVE_COLLECTIONS_NIN) return { nin: env.FLUTTERWAVE_COLLECTIONS_NIN };
  throw new HttpError(503, "Bank transfer isn't available for this business yet. Try another way to pay.", "rails_identity");
}

/** Who the account's customer is, at Flutterwave: the business, by its owner's email. */
async function customerFor(businessId: string): Promise<string> {
  const owner = await prisma.member.findFirst({
    where: { businessId, role: "OWNER" },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { email: true, firstName: true, lastName: true } } },
  });
  if (!owner?.user.email) throw new Error("This business has no owner to open accounts under");
  return flutterwaveCustomer(businessId, owner.user.email, { first: owner.user.firstName, last: owner.user.lastName });
}

/** What the payer sees when the account resolves in their banking app: whose it is. */
const narrationFor = (merchantName: string) => {
  const clean = merchantName.replace(/[^A-Za-z0-9 &.,'-]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "Money Moves").slice(0, 60);
};

function payoutState(t: FlwTransfer | null): PayoutState {
  if (!t) return { state: "unknown" };
  const id = str(t.id) ?? undefined;
  switch (t.status) {
    case "SUCCESSFUL":
      return { state: "settled", transferId: id };
    case "FAILED":
    case "CANCELLED":
      return { state: "failed", reason: str(t.complete_message) ?? str(t.meta?.complete_message) ?? str(t.meta?.reason) ?? `The bank rail said ${t.status.toLowerCase()}`, transferId: id };
    default:
      return { state: "pending", transferId: id };
  }
}

export const flutterwave: NairaRails = {
  name: "flutterwave",

  banks: flutterwaveBanks,

  resolve: (bankCode, accountNumber) => flutterwaveResolve(bankCode, accountNumber),

  async openAccount({ reference, amountKobo, expiresAt, merchantName, businessId }) {
    const started = Date.now();
    const [identity, customerId] = await Promise.all([identityFor(businessId), customerFor(businessId)]);
    const ready = Date.now();
    const r = await flutterwaveOneTimeAccount({
      customerId,
      reference,
      amountNaira: naira(amountKobo),
      expirySeconds: (expiresAt.getTime() - Date.now()) / 1000,
      narration: narrationFor(merchantName),
      identity,
    });
    // How long the customer waited, and how much of it was Flutterwave making the account.
    log.info("[flutterwave] account asked for", {
      reference,
      ok: r.ok,
      status: r.status,
      setupMs: ready - started,
      accountMs: Date.now() - ready,
      // Which identity opened it (never the number itself): the business's own BVN, or our collections one.
      identity: "bvn" in identity ? (identity.bvn === env.FLUTTERWAVE_COLLECTIONS_BVN ? "collections_bvn" : "business_bvn") : "collections_nin",
      ...(r.ok ? {} : { reason: r.message, traceId: r.traceId, requestId: r.requestId }),
    });
    if (!r.ok || !r.data?.account_number) throw new Error(`Flutterwave account not opened (${r.status}): ${r.message}`);
    return {
      bank: r.data.account_bank_name || "Bank",
      number: r.data.account_number,
      name: r.data.account_name || narrationFor(merchantName),
      providerRef: r.data.id || reference,
    };
  },

  async findArrival(reference) {
    const charge = await flutterwaveCharge(reference);
    if (!charge || String(charge.status).toLowerCase() !== "succeeded" || typeof charge.amount !== "number") return null;
    const bt = charge.payment_method_details?.bank_transfer ?? {};
    return {
      amountKobo: Math.round(charge.amount * 100),
      payerName: str(bt.originator_name),
      payerBank: str(bt.originator_bank_name),
      // Masked by the bank ("816*******75") - kept for the record only.
      payerAccount: str(bt.originator_account_number),
      session: str(charge.id),
    };
  },

  async sendPayout({ reference, amountKobo, bankCode, accountNumber, accountName, narration }) {
    const r = await flutterwavePayout({ reference, amountNaira: naira(amountKobo), bankCode, accountNumber, accountName, narration });
    if (r.ok && r.data) return payoutState(r.data);
    // Already sent under this reference: ask for it rather than guessing.
    if (r.status === 409) return payoutState(await flutterwaveTransfer(reference));
    // Refused outright - the money didn't move, and a person decides what's next.
    if (r.status === 400 || r.status === 422) {
      log.warn("[flutterwave] payout refused", { reference, status: r.status, reason: r.message });
      return { state: "failed", reason: r.message || `The bank rail refused this payout (${r.status}) without saying why.` };
    }
    // Anything else - a server error, a timeout we can't see past - could have gone through. The caller asks by reference.
    throw new Error(`Payout outcome unclear (${r.status}): ${r.message}`);
  },

  async checkPayout(reference, transferId) {
    return payoutState(await flutterwaveTransfer(reference, transferId));
  },
};
