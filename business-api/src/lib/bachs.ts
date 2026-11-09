/**
 * Bachs (bachs.io): a second way to take naira bank transfers, and, for the
 * businesses our team picks, to pay them out.
 *
 * Taking a transfer: a checkout session restricted to NGN bank transfer, for
 * the exact amount. Bachs makes a one-time account for it, shown on its own
 * page (its API doesn't hand the account number back), and we follow the
 * session until it's paid. Paying out: a saved destination per bank account,
 * then a payout to it from our Bachs balance.
 *
 * Sandbox or live follows the key: sk_sandbox_ talks to the sandbox, sk_live_
 * to production, unless BACHS_BASE_URL says otherwise. Bodies are never
 * logged.
 */
import { env } from "../config/env";
import { prisma } from "./prisma";

export const bachsReady = () => !!env.BACHS_SECRET_KEY;

const baseUrl = () => (env.BACHS_BASE_URL ?? (env.BACHS_SECRET_KEY?.startsWith("sk_live_") ? "https://api.bachs.io" : "https://sandbox-api.bachs.io")).replace(/\/$/, "");

export interface BachsAnswer<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** What went wrong, in Bachs's words: its error code and detail. */
  message: string;
}

async function bachs<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, opts: { idempotencyKey?: string; timeoutMs?: number } = {}): Promise<BachsAnswer<T>> {
  if (!env.BACHS_SECRET_KEY) throw new Error("Bachs isn't set up: BACHS_SECRET_KEY is missing");
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.BACHS_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const message = res.ok
    ? ""
    : [json?.error_code, json?.detail, Array.isArray(json?.errors) ? json.errors.map((e: any) => [e?.field ?? e?.loc, e?.message ?? e?.msg].filter(Boolean).join(": ")).join("; ") : null]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 300) || (text ? `reply: ${text.replace(/\s+/g, " ").slice(0, 160)}` : "empty reply");
  return { ok: res.ok, status: res.status, data: res.ok ? (json as T) : null, message };
}

// ─── Taking a transfer ────────────────────────────────────────────────────

export interface BachsCheckout {
  checkout_id: string;
  checkout_url?: string | null;
  status: "open" | "completed" | "expired" | "cancelled";
  payment_status?: string | null;
  amount?: string | null;
  currency?: string | null;
  reference?: string | null;
  expires_at?: string | null;
  /** amount is the price; amount_paid is what actually arrived. */
  charge?: { payment_id?: string | null; status?: string | null; amount?: string | null; amount_paid?: string | null; currency?: string | null } | null;
}

/** A checkout for one payment: naira bank transfer only, the exact amount, open until the payment closes. */
export function bachsOpenCheckout(p: { reference: string; amountNaira: number; expiresAt: Date; email?: string | null; name?: string | null; returnTo?: string | null }) {
  const minutes = Math.min(1440, Math.max(1, Math.round((p.expiresAt.getTime() - Date.now()) / 60_000)));
  return bachs<BachsCheckout>(
    "POST",
    "/v1/checkout-sessions",
    {
      pricing: { amount: p.amountNaira.toFixed(2), currency: "NGN" },
      payment_method_types: ["NGN_BANK_TRANSFER"],
      reference: p.reference,
      expires_in_minutes: minutes,
      // Always our own inbox, never the customer's: Bachs's receipts come to us, and customers only hear from
      // Money Moves. Their name stays, so the payment is easy to find in Bachs. A name must not be blank.
      customer: { email: env.BACHS_RECEIPT_EMAIL, ...(p.name?.trim() ? { name: p.name.trim() } : {}) },
      ...(p.returnTo ? { success_url: p.returnTo, cancel_url: p.returnTo } : {}),
      metadata: { reference: p.reference },
    },
    // Our reference is the key: a repeat after a timeout reads the first session instead of making another.
    { idempotencyKey: `checkout-${p.reference}`, timeoutMs: 15_000 },
  );
}

export const bachsCheckout = (checkoutId: string) => bachs<BachsCheckout>("GET", `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`);

export interface BachsPayment {
  id?: string;
  status?: string;
  amount?: string;
  currency?: string;
  payment_method_details?: {
    bank_transfer?: { sender_name?: string | null; sender_bank?: string | null; sender_account_number?: string | null; session_id?: string | null } | null;
  } | null;
}

export const bachsPayment = (paymentId: string) => bachs<BachsPayment>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`);

// ─── Paying out ───────────────────────────────────────────────────────────

const PROVIDER = "bachs";
const remembered = async (key: string) => (await prisma.railRecord.findUnique({ where: { provider_key: { provider: PROVIDER, key } } }))?.value ?? null;
const remember = (key: string, value: string) =>
  prisma.railRecord.upsert({ where: { provider_key: { provider: PROVIDER, key } }, create: { provider: PROVIDER, key, value }, update: { value } }).catch(() => undefined);

export interface BachsDestination {
  id: string;
  status?: "pending_review" | "approved" | "rejected";
  is_usable?: boolean;
  account_name?: string | null;
  status_reason?: string | null;
}

/** The saved destination for one bank account, made the first time it's paid. Not usable yet: says why. */
export async function bachsDestination(bankCode: string, accountNumber: string, name: string): Promise<{ id: string; usable: boolean; why: string | null }> {
  const key = `destination:${bankCode}:${accountNumber}`;
  let id = await remembered(key);
  if (!id) {
    const made = await bachs<BachsDestination>(
      "POST",
      "/v1/payouts/destinations",
      { type: "bank_account", currency: "NGN", bank_code: bankCode, account_number: accountNumber, name: name.slice(0, 60) || accountNumber },
      { idempotencyKey: `destination-${bankCode}-${accountNumber}` },
    );
    if (!made.ok || !made.data?.id) throw new Error(`Bachs payout destination not saved (${made.status}): ${made.message}`);
    id = made.data.id;
    await remember(key, id);
    if (made.data.is_usable) return { id, usable: true, why: null };
  }
  const d = await bachs<BachsDestination>("GET", `/v1/payouts/destinations/${encodeURIComponent(id)}`);
  if (!d.ok || !d.data) throw new Error(`Bachs payout destination not read (${d.status}): ${d.message}`);
  return { id, usable: !!d.data.is_usable, why: d.data.is_usable ? null : d.data.status === "rejected" ? `Bachs refused this bank account${d.data.status_reason ? `: ${d.data.status_reason}` : ""}.` : "Bachs is still approving this bank account." };
}

export interface BachsPayout {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  reference?: string | null;
  failure_reason?: string | null;
  session_id?: string | null;
}

export function bachsSendPayout(p: { destination: string; amountNaira: number; reference: string; narration: string }) {
  return bachs<BachsPayout>(
    "POST",
    "/v1/payouts",
    { destination: p.destination, amount: p.amountNaira.toFixed(2), reference: p.reference, narration: p.narration.replace(/[\u0000-\u001f]/g, " ").slice(0, 100) },
    { idempotencyKey: `payout-${p.reference}` },
  );
}

export const bachsPayout = (payoutId: string) => bachs<BachsPayout>("GET", `/v1/payouts/${encodeURIComponent(payoutId)}`);

/** A payout found by our reference, when its id wasn't kept: the newest page of payouts, read through. */
export async function bachsPayoutByReference(reference: string): Promise<BachsPayout | null> {
  const r = await bachs<{ items?: BachsPayout[] }>("GET", `/v1/payouts?limit=100`);
  if (!r.ok) throw new Error(`Bachs payouts not read (${r.status}): ${r.message}`);
  return (r.data?.items ?? []).find((x) => x.reference === reference) ?? null;
}
