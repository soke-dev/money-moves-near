/**
 * Flutterwave v4, the same account and credentials as the Money Moves app:
 * whose bank account it is (the bank list and the name the bank holds), and,
 * for the live rail (rails/flutterwave.ts), one-time accounts, what arrived in
 * them, and payouts from the payout balance. The calls are ported from the
 * app's own (backend/src/lib/flutterwave.ts), which runs them in production.
 *
 * v4 signs in with OAuth client credentials for a ten-minute token, kept in
 * memory and renewed a minute early. The app's own tokens aren't affected:
 * each service holds its own, and issuing one doesn't revoke another.
 *
 * Bank codes are Flutterwave's, so an account saved here is one the payout
 * rail pays as it is.
 *
 * Request bodies are never logged: an account request carries a BVN or NIN.
 */
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { prisma } from "./prisma";
import type { Bank, Resolved } from "../rails/types";

const DAY = 24 * 60 * 60_000;
let banksCache: { banks: Bank[]; at: number } | null = null;
let token: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

export const flutterwaveReady = () => !!(env.FLUTTERWAVE_CLIENT_ID && env.FLUTTERWAVE_CLIENT_SECRET);

async function fetchToken(): Promise<string> {
  const res = await fetch(env.FLUTTERWAVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.FLUTTERWAVE_CLIENT_ID!, client_secret: env.FLUTTERWAVE_CLIENT_SECRET!, grant_type: "client_credentials" }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  // Never the body: a failed sign-in can echo what was sent.
  if (!res.ok || !json?.access_token) throw new Error(`Flutterwave sign-in failed (${res.status})`);
  token = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 600) * 1000 };
  return token.value;
}

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  // Many calls at once share one sign-in.
  inflight ??= fetchToken().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Signs in again before the token runs low, so a customer opening a bank account never waits for a sign-in.
 * Run by the worker every couple of minutes; does nothing while the token has more than three minutes left.
 */
export async function keepFlutterwaveSignedIn(): Promise<void> {
  if (!flutterwaveReady()) return;
  if (token && Date.now() < token.expiresAt - 3 * 60_000) return;
  token = null;
  await accessToken();
}

export interface FlwAnswer<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** What went wrong, in Flutterwave's words - the field and the reason when it gives them. */
  message: string;
  /** For Flutterwave support: the trace id we sent, and their own request id when they give one. */
  traceId?: string;
  requestId?: string | null;
}

/**
 * Flutterwave's errors come as { error: { type, code, message, validation_errors } }:
 * the message and type say what went wrong, and validation_errors - often an
 * empty list - name the fields. All of them are kept, so a refusal is never
 * just "refused". Field names and reasons only: nothing we sent is repeated here.
 */
function describe(json: any): string {
  if (!json || typeof json !== "object") return "";
  const parts: string[] = [];
  const message = json.error?.message ?? json.message;
  if (message) parts.push(String(message));
  const errs = json.error?.validation_errors ?? json.errors;
  if (Array.isArray(errs)) for (const e of errs) parts.push([e?.field ?? e?.parameter, e?.message ?? e?.description].filter(Boolean).join(": "));
  const kind = [json.error?.type, json.error?.code].filter(Boolean).join(" ");
  if (kind) parts.push(`(${kind})`);
  return parts.filter(Boolean).join(" | ").slice(0, 300);
}

const timedOut = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

async function flw<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; retried?: boolean; timeoutMs?: number; retryOnTimeout?: boolean; timedOutOnce?: boolean } = {},
): Promise<FlwAnswer<T>> {
  let res: Response;
  const traceId = randomUUID();
  try {
    res = await fetch(`${env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      "X-Trace-Id": traceId,
      // Our reference doubles as the key, so a repeat after a timeout reads the first answer instead of acting twice.
      ...(opts.idempotencyKey ? { "X-Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  } catch (e) {
    // Slow, not refused: opening an account (never a payout) is asked once more under the same idempotency key.
    // Flutterwave answers a repeat with the first call's result, so no second account is made.
    if (timedOut(e) && opts.retryOnTimeout && opts.idempotencyKey && !opts.timedOutOnce) return flw<T>(method, path, body, { ...opts, timedOutOnce: true, timeoutMs: 15_000 });
    throw e;
  }
  // A token we thought was live was turned down: once more with a fresh one, never in a loop.
  if (res.status === 401 && !opts.retried) {
    token = null;
    return flw<T>(method, path, body, { ...opts, retried: true });
  }
  // Read as text first: a failure can come back as an HTML or empty page, and that is worth seeing too.
  const text = await res.text().catch(() => "");
  let json: { data?: T } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-trace-id") ?? res.headers.get("cf-ray");
  const message = res.ok ? "" : describe(json) || (text ? `non JSON reply: ${text.replace(/\s+/g, " ").slice(0, 160)}` : "empty reply");
  return { ok: res.ok, status: res.status, data: json?.data ?? null, message, traceId, requestId };
}

// ─── Banks and account names ──────────────────────────────────────────────

/** The banks the Money Moves app offers, by the names people know them by (constants/transfer.ts in the app). */
const APP_BANKS = [
  "9 Payment Solutions Bank", "Access Bank", "Carbon", "Citibank", "Coronation Bank", "Ecobank", "Fairmoney Microfinance Bank",
  "Fidelity Bank", "First Bank of Nigeria", "First City Monument Bank", "Flutterwave MFB", "Globus Bank", "Guaranty Trust Bank",
  "Jaiz Bank", "Keystone Bank", "Kuda Bank", "Lotus Bank", "Moniepoint", "Momo PSB", "Nomba", "Opay", "Palmpay", "Paystack-Titan",
  "Polaris Bank", "Premium Trust Bank", "Providus Bank", "Rubies Microfinance Bank", "Smartcash Payment Service Bank", "Sparkle",
  "Stanbic IBTC Bank", "Standard Chartered", "Sterling Bank", "SunTrust Bank", "TAJBank", "Titan Trust Bank", "Union Bank",
  "United Bank for Africa", "Unity Bank", "VFD Microfinance Bank", "Wema Bank", "Zenith Bank",
];

/**
 * Names Flutterwave spells differently, pinned to its code - the app's own
 * list (backend/src/lib/flutterwave.ts). Written down rather than guessed: a
 * near-miss here would pay the wrong institution. Each is checked against the
 * live list before it's used.
 */
const ALIASES: Record<string, string> = {
  "first bank of nigeria": "011",
  citibank: "023",
  "9 payment solutions bank": "120001",
  "providus bank": "101",
  "standard chartered": "068",
  "coronation bank": "060001",
  "premium trust bank": "000031",
  tajbank: "000026",
  "vfd microfinance bank": "090110",
  nomba: "090645",
  "paystack-titan": "100039",
  "flutterwave mfb": "090567",
};

/** A bank's Flutterwave code by its name - the same rule the app uses. */
function codeFor(name: string, list: { code: string; name: string }[]): string | null {
  const wanted = name.trim().toLowerCase();
  const alias = ALIASES[wanted];
  if (alias && list.some((b) => b.code === alias)) return alias;
  const hit =
    list.find((b) => b.name.toLowerCase() === wanted) ||
    list.find((b) => b.name.toLowerCase().includes(wanted)) ||
    list.find((b) => wanted.includes(b.name.toLowerCase()));
  return hit?.code ?? null;
}

/**
 * The app's banks, each with its Flutterwave code - kept for a day, and an
 * empty answer is never kept. A bank Flutterwave doesn't list is left out
 * rather than offered and failed.
 */
export async function flutterwaveBanks(): Promise<Bank[]> {
  if (banksCache && Date.now() - banksCache.at < DAY) return banksCache.banks;
  const r = await flw<{ code: string; name: string }[]>("GET", "/banks?country=NG");
  const list = (Array.isArray(r.data) ? r.data : []).map((b) => ({ code: String(b.code), name: b.name }));
  if (!list.length) throw new Error(`Flutterwave bank list came back empty (${r.status})`);
  const banks = APP_BANKS.flatMap((name) => {
    const code = codeFor(name, list);
    return code ? [{ code, name }] : [];
  });
  banksCache = { banks, at: Date.now() };
  return banks;
}

/** The name the bank holds for this account. */
export async function flutterwaveResolve(bankCode: string, accountNumber: string): Promise<Resolved> {
  const r = await flw<{ account_name?: string }>("POST", "/banks/account-resolve", { currency: "NGN", account: { code: bankCode, number: accountNumber } });
  if (r.ok && r.data?.account_name) return { ok: true, accountName: r.data.account_name };
  return { ok: false, reason: "We couldn't find that account at that bank. Check the number and the bank." };
}

// ─── Ids issued once ──────────────────────────────────────────────────────

const PROVIDER = "flutterwave";
const remembered = async (key: string) => (await prisma.railRecord.findUnique({ where: { provider_key: { provider: PROVIDER, key } } }))?.value ?? null;
/** Two callers can race to remember the same id; whoever loses reads the same row, so either way is fine. */
const remember = (key: string, value: string) =>
  prisma.railRecord.upsert({ where: { provider_key: { provider: PROVIDER, key } }, create: { provider: PROVIDER, key, value }, update: { value } }).catch(() => undefined);

/**
 * The customer a business's accounts are opened under, created the first time.
 * Creating one isn't repeatable - a second try for the same email is refused -
 * so a lost id is found again by searching for the email.
 */
export async function flutterwaveCustomer(businessId: string, email: string, name?: { first?: string | null; last?: string | null }): Promise<string> {
  const key = `customer:${businessId}`;
  const known = await remembered(key);
  if (known) return known;
  const made = await flw<{ id?: string }>("POST", "/customers", {
    email,
    ...(name?.first || name?.last ? { name: { first: name.first || undefined, last: name.last || undefined } } : {}),
  });
  let id = made.data?.id ?? null;
  if (!id) {
    const found = await flw<{ id?: string; email?: string }[]>("POST", "/customers/search", { email });
    id = (Array.isArray(found.data) ? found.data : []).find((c) => String(c?.email ?? "").toLowerCase() === email.toLowerCase())?.id ?? null;
  }
  if (!id) throw new Error(`Flutterwave customer not created (${made.status}): ${made.message}`);
  await remember(key, id);
  return id;
}

// ─── Money in ─────────────────────────────────────────────────────────────

export interface FlwAccount {
  id?: string;
  account_number: string;
  account_bank_name?: string;
  /** Not guaranteed by the docs, so every read of it needs a fallback. */
  account_name?: string;
  reference?: string;
}

/**
 * A one-time account for one payment: the exact amount, and an expiry, so an
 * old number screenshotted from another payment can't quietly pay this one.
 * Flutterwave needs a BVN or a NIN to issue it. `expiry` is in seconds,
 * minimum 60. The narration is what the payer sees when the account resolves
 * in their banking app.
 */
export async function flutterwaveOneTimeAccount(p: {
  customerId: string;
  reference: string;
  amountNaira: number;
  expirySeconds: number;
  narration: string;
  identity: { bvn: string } | { nin: string };
}): Promise<FlwAnswer<FlwAccount>> {
  return flw<FlwAccount>(
    "POST",
    "/virtual-accounts",
    {
      reference: p.reference,
      customer_id: p.customerId,
      amount: p.amountNaira,
      currency: "NGN",
      account_type: "dynamic",
      expiry: Math.max(60, Math.round(p.expirySeconds)),
      narration: p.narration,
      ...p.identity,
    },
    // The customer is waiting on this one: a shorter first try, then one repeat under the same key.
    { idempotencyKey: p.reference, timeoutMs: 12_000, retryOnTimeout: true },
  );
}

export interface FlwCharge {
  id?: string;
  reference?: string;
  status?: string;
  amount?: number;
  payment_method_details?: { bank_transfer?: { originator_name?: string; originator_bank_name?: string; originator_account_number?: string } };
}

/** What arrived under our reference, if anything - found by asking, so it works without the webhook (which goes to the app). */
export async function flutterwaveCharge(reference: string): Promise<FlwCharge | null> {
  const r = await flw<FlwCharge[]>("GET", `/charges?reference=${encodeURIComponent(reference)}&size=10`);
  if (!r.ok) throw new Error(`Flutterwave charge lookup failed (${r.status}): ${r.message}`);
  const rows = Array.isArray(r.data) ? r.data : [];
  // Filtered again rather than trusting the first row of a list.
  const ours = rows.filter((c) => c?.reference === reference);
  return ours.find((c) => String(c?.status).toLowerCase() === "succeeded") ?? ours[0] ?? null;
}

// ─── Money out ────────────────────────────────────────────────────────────

export type FlwTransferStatus = "NEW" | "INITIATED" | "PENDING" | "SUCCESSFUL" | "FAILED" | "CANCELLED";

export interface FlwTransfer {
  id?: string;
  reference?: string;
  status?: FlwTransferStatus;
  /** Why it failed, when it did. Field names vary, so each is read defensively. */
  complete_message?: string;
  meta?: Record<string, unknown>;
}

/**
 * A resolved account name in the shape the payout rail accepts: bracketed
 * product tags out ("(OKash) ADA EZE"), then anything outside letters, spaces,
 * commas, periods, apostrophes and hyphens - the app learned this one the hard
 * way. No parts at all means no name is sent, which the rail accepts.
 */
export function payoutNameParts(accountName?: string | null): string[] {
  return (accountName || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^A-Za-z ,.'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.slice(0, 50));
}

/** Pages the recipient list for one account - only when Flutterwave says it exists but we've lost its id. Bounded. */
async function findRecipient(bankCode: string, accountNumber: string): Promise<string | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ size: "50", ...(cursor ? { next: cursor } : {}) });
    const r = await flw<{ recipients?: any[]; cursor?: { has_more_items?: boolean; next?: string } }>("GET", `/transfers/recipients?${qs}`);
    const hit = (r.data?.recipients ?? []).find((x) => String(x?.bank?.account_number ?? "") === accountNumber && String(x?.bank?.code ?? "") === bankCode);
    if (hit?.id) return hit.id;
    if (!r.data?.cursor?.has_more_items || !r.data.cursor.next) return null;
    cursor = r.data.cursor.next;
  }
  return null;
}

/**
 * The payout destination's id. Recipients are their own resource in v4 - a
 * transfer won't take bank details inline - and creating one twice is a 409,
 * so the id is kept the first time. The app may already have registered the
 * same account on this shared Flutterwave account; then it's found by paging.
 */
async function recipientFor(bankCode: string, accountNumber: string, accountName?: string | null): Promise<{ id: string } | { error: string }> {
  const key = `recipient:${bankCode}:${accountNumber}`;
  const known = await remembered(key);
  if (known) return { id: known };
  const parts = payoutNameParts(accountName);
  const made = await flw<{ id?: string }>("POST", "/transfers/recipients", {
    type: "bank_ngn",
    bank: { code: bankCode, account_number: accountNumber },
    ...(parts.length ? { name: { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : parts[0] } } : {}),
  });
  let id = made.data?.id ?? null;
  if (!id && made.status === 409) id = await findRecipient(bankCode, accountNumber);
  if (!id) return { error: made.message || `Couldn't register the payout account (${made.status})` };
  await remember(key, id);
  return { id };
}

/** The sender named on payouts - the same company name the app pays out under. Best effort: a payout never fails over it. */
async function senderId(): Promise<string | null> {
  const name = env.FLUTTERWAVE_SENDER_NAME.trim();
  if (!name) return null;
  const key = `sender:${name}`;
  const known = await remembered(key);
  if (known) return known;
  const words = name.split(/\s+/).filter(Boolean);
  const r = await flw<{ id?: string }>("POST", "/transfers/senders", { type: "generic_sender", name: { first: words[0], last: words.slice(1).join(" ") || words[0] } });
  if (!r.data?.id) return null;
  await remember(key, r.data.id);
  return r.data.id;
}

/**
 * A payout from the payout balance, for exactly `amountNaira` received:
 * Flutterwave's own fee comes on top, from the balance. The reference is ours
 * (letters and digits, 6-42) and is also the idempotency key.
 */
export async function flutterwavePayout(p: { reference: string; amountNaira: number; bankCode: string; accountNumber: string; accountName?: string | null; narration: string }): Promise<FlwAnswer<FlwTransfer>> {
  const recipient = await recipientFor(p.bankCode, p.accountNumber, p.accountName);
  if ("error" in recipient) return { ok: false, status: 400, data: null, message: recipient.error };
  const sender = await senderId().catch(() => null);
  return flw<FlwTransfer>(
    "POST",
    "/transfers",
    {
      action: "instant",
      // Both required in practice, though the schema lists neither.
      type: "bank",
      reference: p.reference,
      narration: p.narration.slice(0, 180),
      payment_instruction: {
        source_currency: "NGN",
        destination_currency: "NGN",
        amount: { value: p.amountNaira, applies_to: "destination_currency" },
        recipient_id: recipient.id,
        ...(sender ? { sender_id: sender } : {}),
      },
    },
    { idempotencyKey: p.reference },
  );
}

/** How far back a payout is looked for by our reference: the newest transfers, a page at a time. */
const LOOKUP_PAGES = 4;
const LOOKUP_PAGE_SIZE = 50;

/**
 * A payout by our reference. `null` when Flutterwave has never heard of it.
 *
 * GET /transfers/:id takes Flutterwave's own transfer id (trf_…), not our
 * reference - asked with ours it says 404 even for a payout that arrived, and
 * the settlement sat at "on its way" for good. So a 404 is followed by a look
 * through the newest transfers for our reference (its filter is ignored, so
 * the match is made here). A payout still being followed up is recent.
 */
export async function flutterwaveTransfer(reference: string, transferId?: string | null): Promise<FlwTransfer | null> {
  // Its own id, kept from when it was sent: found however far back it is, not only among the newest.
  if (transferId) {
    const byId = await flw<FlwTransfer>("GET", `/transfers/${encodeURIComponent(transferId)}`);
    if (byId.ok && byId.data && (!byId.data.reference || byId.data.reference === reference)) return byId.data;
    if (!byId.ok && byId.status !== 404) throw new Error(`Flutterwave transfer lookup failed (${byId.status}): ${byId.message}`);
  }
  const r = await flw<FlwTransfer>("GET", `/transfers/${encodeURIComponent(reference)}`);
  if (r.ok && r.data) return r.data;
  if (r.status !== 404) throw new Error(`Flutterwave transfer lookup failed (${r.status}): ${r.message}`);
  // The list comes as { transfers, cursor } and pages by cursor, like the recipients list.
  let cursor: string | undefined;
  for (let page = 0; page < LOOKUP_PAGES; page++) {
    const qs = new URLSearchParams({ size: String(LOOKUP_PAGE_SIZE), ...(cursor ? { next: cursor } : {}) });
    const list = await flw<{ transfers?: FlwTransfer[]; cursor?: { has_more_items?: boolean; next?: string } }>("GET", `/transfers?${qs}`);
    if (!list.ok) throw new Error(`Flutterwave transfer list failed (${list.status}): ${list.message}`);
    const hit = (list.data?.transfers ?? []).find((t) => t.reference === reference);
    if (hit) return hit;
    if (!list.data?.cursor?.has_more_items || !list.data.cursor.next) break;
    cursor = list.data.cursor.next;
  }
  return null;
}
