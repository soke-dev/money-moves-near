/**
 * Flutterwave payout subaccounts (v3): a business's direct account.
 *
 * Each business with a direct account gets a wallet at Flutterwave with its
 * own static account number. A transfer into it credits that wallet in real
 * time. We read the wallet's transactions to see what arrived (no webhook:
 * that would need the whole Flutterwave account moved to v3 webhooks, which
 * the app relies on). Nothing is ever paid out of it by code: our team settles
 * the business by hand.
 *
 * v3 signs with the secret key, not v4's OAuth token. Same Flutterwave account.
 */
import { env } from "../config/env";
import { log } from "./log";

export const psaReady = () => !!env.FLW_V3_SECRET_KEY;

type V3<T> = { ok: boolean; status: number; data: T | null; message: string };

async function v3<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<V3<T>> {
  if (!env.FLW_V3_SECRET_KEY) return { ok: false, status: 0, data: null, message: "Flutterwave v3 isn't set up." };
  const res = await fetch(`${env.FLW_V3_BASE_URL.replace(/\/$/, "")}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.FLW_V3_SECRET_KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => null)) as { status?: string; message?: string; data?: T } | null;
  const ok = res.ok && json?.status === "success";
  return { ok, status: res.status, data: json?.data ?? null, message: ok ? "" : String(json?.message ?? `HTTP ${res.status}`) };
}

/** "200,000.00" or 200000 to kobo; anything unreadable is null, never a guess. */
function kobo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export type Psa = { reference: string; barterId: string | null; accountNumber: string; bank: string; name: string };

/** Opens the wallet and its static account. The wallet carries the business's name, which a customer's bank shows when they type the number. */
export async function openPsa(p: { name: string; email: string; phone?: string | null }): Promise<Psa> {
  const made = await v3<{ account_reference?: string; barter_id?: string; account_name?: string; nuban?: string; bank_name?: string }>("POST", "/payout-subaccounts", {
    account_name: p.name,
    email: p.email,
    country: "NG",
    ...(p.phone ? { mobilenumber: p.phone } : {}),
  });
  const ref = made.data?.account_reference;
  if (!made.ok || !ref) throw new Error(`Flutterwave subaccount not opened (${made.status}): ${made.message}`);
  const acct = await staticAccount(ref).catch(() => null);
  // The static account is the one any bank can pay; the wallet's own number is the fallback.
  const number = acct?.accountNumber ?? made.data?.nuban;
  if (!number) throw new Error("Flutterwave opened the subaccount but gave it no account number.");
  return { reference: ref, barterId: made.data?.barter_id ?? null, accountNumber: number, bank: acct?.bank ?? made.data?.bank_name ?? "Bank", name: made.data?.account_name ?? p.name };
}

export async function staticAccount(reference: string): Promise<{ accountNumber: string; bank: string } | null> {
  const r = await v3<{ static_account?: string; bank_name?: string }>("GET", `/payout-subaccounts/${encodeURIComponent(reference)}/static-account?currency=NGN`);
  if (!r.ok || !r.data?.static_account) return null;
  return { accountNumber: r.data.static_account, bank: r.data.bank_name ?? "Bank" };
}

export type PsaCredit = { reference: string; amountKobo: number; feeKobo: number | null; senderName: string | null; senderAccount: string | null; senderBank: string | null; at: Date };

let shapeLogged = false;

/**
 * Money that came into the wallet between two moments. Only credits, and only
 * ones whose amount and reference can be read: a row we can't read is left
 * out and logged rather than guessed at, so nothing is matched on bad data.
 */
export async function psaCredits(reference: string, from: Date, to: Date): Promise<PsaCredit[]> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const r = await v3<unknown>("GET", `/payout-subaccounts/${encodeURIComponent(reference)}/transactions?from=${day(from)}&to=${day(new Date(to.getTime() + 86_400_000))}&currency=NGN&fetch_limit=100`);
  if (!r.ok) throw new Error(`Flutterwave subaccount transactions unreadable (${r.status}): ${r.message}`);
  const d = r.data as Record<string, unknown> | unknown[] | null;
  const rows = (Array.isArray(d) ? d : Array.isArray((d as Record<string, unknown>)?.transactions) ? (d as Record<string, unknown>).transactions : []) as Record<string, unknown>[];
  if (!shapeLogged && rows[0]) {
    shapeLogged = true;
    log.info("[psa] transaction fields", { fields: Object.keys(rows[0]) });
  }
  const out: PsaCredit[] = [];
  for (const t of rows) {
    const type = String(t.type ?? t.transaction_type ?? "").toLowerCase();
    const words = String(t.remarks ?? t.narration ?? t.description ?? "").toLowerCase();
    const credit = type === "c" || type === "credit" || (!type && words.includes("fund"));
    if (!credit) continue;
    const status = String(t.status ?? "successful").toLowerCase();
    if (!["successful", "success", "completed"].includes(status)) continue;
    const ref = str(t.reference) ?? str(t.flw_ref) ?? (t.id != null ? String(t.id) : null);
    const amount = kobo(t.amount);
    const at = new Date(String(t.date ?? t.created_at ?? ""));
    if (!ref || amount == null || Number.isNaN(at.getTime())) {
      log.warn("[psa] a credit we couldn't read, left for ops", { wallet: reference, fields: Object.keys(t) });
      continue;
    }
    if (at < from) continue;
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    out.push({
      reference: ref,
      amountKobo: amount,
      feeKobo: kobo(t.fee),
      senderName: str(t.sender) ?? str(t.fullname) ?? str(t.account_name),
      senderAccount: str(meta.sender_account_number) ?? str(t.sender_account_number),
      senderBank: str(meta.sender_bank_name) ?? str(t.sender_bank),
      at,
    });
  }
  return out;
}

/** What the wallet holds now, read from Flutterwave; null when it can't be read. */
export async function psaBalanceNgn(reference: string): Promise<number | null> {
  const r = await v3<{ available_balance?: number | string }>("GET", `/payout-subaccounts/${encodeURIComponent(reference)}/balances?currency=NGN`);
  if (!r.ok) return null;
  const n = Number(String(r.data?.available_balance ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
