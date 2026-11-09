/**
 * Bachs as a naira rail: taking a bank transfer on its one-time account page,
 * and paying a business out, for the businesses our team puts on it.
 *
 * A transfer through Bachs has no account number of ours to show: the
 * customer opens Bachs's page, which shows the one-time account, and we follow
 * the checkout until Bachs says it's paid. The payment keeps "bachs:<checkout>"
 * as its provider reference, so it's always followed on Bachs, whatever the
 * switch says later.
 */
import { bachsCheckout, bachsDestination, bachsOpenCheckout, bachsPayment, bachsPayout, bachsPayoutByReference, bachsSendPayout, type BachsPayout } from "../lib/bachs";
import { log } from "../lib/log";
import type { Arrival, PayoutState } from "./types";

export const BACHS_REF = "bachs:";
export const isBachsRef = (providerRef: string | null | undefined) => !!providerRef?.startsWith(BACHS_REF);

const naira = (kobo: number) => Math.round(kobo) / 100;
const kobo = (amount: string | null | undefined) => (amount != null && Number.isFinite(Number(amount)) ? Math.round(Number(amount) * 100) : null);

/** Opens Bachs's checkout for one payment. Returns what to keep on the payment, and the page the customer opens. */
export async function bachsOpenTransfer(p: { reference: string; amountKobo: number; expiresAt: Date; email?: string | null; name?: string | null; returnTo?: string | null }) {
  const started = Date.now();
  const r = await bachsOpenCheckout({ reference: p.reference, amountNaira: naira(p.amountKobo), expiresAt: p.expiresAt, email: p.email, name: p.name, returnTo: p.returnTo });
  log.info("[bachs] checkout asked for", { reference: p.reference, ok: r.ok, status: r.status, ms: Date.now() - started, ...(r.ok ? {} : { reason: r.message }) });
  if (!r.ok || !r.data?.checkout_id || !r.data.checkout_url) throw new Error(`Bachs checkout not opened (${r.status}): ${r.message}`);
  return { providerRef: `${BACHS_REF}${r.data.checkout_id}`, page: r.data.checkout_url };
}

/** What reached a Bachs checkout, once Bachs says the transfer came in. Nothing yet: null. */
export async function bachsFindArrival(providerRef: string, expectedKobo?: number): Promise<Arrival | null> {
  const id = providerRef.slice(BACHS_REF.length);
  const c = await bachsCheckout(id);
  if (!c.ok || !c.data) throw new Error(`Bachs checkout not read (${c.status}): ${c.message}`);
  const charge = c.data.charge;
  // Paid, in full or not: Bachs's own words for money that arrived.
  if (!charge || !["succeeded", "overpaid", "underpaid"].includes(String(charge.status ?? "").toLowerCase())) return null;
  // What arrived, not the price: a short transfer shows here as less.
  const amountKobo = kobo(charge.amount_paid ?? charge.amount);
  if (amountKobo == null || String(charge.currency ?? "NGN").toUpperCase() !== "NGN") {
    log.warn("[bachs] a paid checkout we can't read the amount of, left for ops", { providerRef, currency: charge.currency });
    return null;
  }
  // Short, by Bachs's word, but reported at the full price or more: the amount isn't what arrived. Never taken as
  // paid in full on a guess: the team looks at it in Bachs.
  if (String(charge.status).toLowerCase() === "underpaid" && charge.amount_paid == null && expectedKobo != null && amountKobo >= expectedKobo) {
    log.error("[bachs] a transfer Bachs calls short, reported at the full amount: not settled, check it in Bachs", { providerRef, amountKobo, expectedKobo });
    return null;
  }
  // Who sent it, for the record: from the payment itself, when Bachs gives it.
  let bt: NonNullable<NonNullable<Awaited<ReturnType<typeof bachsPayment>>["data"]>["payment_method_details"]>["bank_transfer"] = null;
  if (charge.payment_id) {
    const pay = await bachsPayment(charge.payment_id).catch(() => null);
    bt = pay?.ok ? (pay.data?.payment_method_details?.bank_transfer ?? null) : null;
  }
  return {
    amountKobo,
    payerName: bt?.sender_name ?? null,
    payerBank: bt?.sender_bank ?? null,
    payerAccount: bt?.sender_account_number ?? null,
    session: bt?.session_id ?? charge.payment_id ?? id,
  };
}

function payoutState(p: BachsPayout | null): PayoutState {
  if (!p) return { state: "unknown" };
  const transferId = `${BACHS_REF}${p.id}`;
  switch (p.status) {
    case "completed":
      return { state: "settled", transferId };
    case "failed":
      return { state: "failed", reason: p.failure_reason || "Bachs couldn't deliver this payout.", transferId };
    default:
      return { state: "pending", transferId };
  }
}

/**
 * Pays a business out from our Bachs balance. A bank account Bachs hasn't
 * approved yet is "pending" with no payout made: it's asked again next round.
 */
export async function bachsSendPayoutFor(p: { reference: string; amountKobo: number; bankCode: string; accountNumber: string; accountName: string; narration: string }): Promise<PayoutState> {
  const dest = await bachsDestination(p.bankCode, p.accountNumber, p.accountName);
  if (!dest.usable) throw new Error(dest.why ?? "Bachs hasn't approved this bank account yet.");
  const r = await bachsSendPayout({ destination: dest.id, amountNaira: naira(p.amountKobo), reference: p.reference, narration: p.narration });
  if (r.ok && r.data) return payoutState(r.data);
  // Already made under this reference: ask for it rather than guessing.
  if (r.status === 400 && /reference already exists/i.test(r.message)) return payoutState(await bachsPayoutByReference(p.reference));
  if (r.status === 400 || r.status === 404 || r.status === 422) {
    log.warn("[bachs] payout refused", { reference: p.reference, status: r.status, reason: r.message });
    return { state: "failed", reason: r.message || `Bachs refused this payout (${r.status}).` };
  }
  // Anything else could have gone through: the caller asks by reference.
  throw new Error(`Bachs payout outcome unclear (${r.status}): ${r.message}`);
}

export async function bachsCheckPayout(reference: string, transferId?: string | null): Promise<PayoutState> {
  if (isBachsRef(transferId)) {
    const r = await bachsPayout(transferId!.slice(BACHS_REF.length));
    if (r.ok && r.data) return payoutState(r.data);
  }
  return payoutState(await bachsPayoutByReference(reference));
}
