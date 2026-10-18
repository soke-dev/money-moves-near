/**
 * flutterwave.ts — the live payment rail, both directions.
 *
 *   On-ramp  (user buys crypto): create a customer, then a virtual account.
 *            The user transfers naira to that account from their own bank and
 *            Flutterwave tells us via a `charge.completed` webhook.
 *   Off-ramp (user sells crypto): create a transfer to their bank account.
 *
 * Replaces Paystack (on-ramp) and Bachs (off-ramp). Those modules still exist
 * so historical transactions stay readable, but nothing routes to them.
 *
 * ── v4, not v3 ────────────────────────────────────────────────────────────
 * v4 is a different API from the familiar FLWSECK- one: it authenticates with
 * OAuth client credentials, and every call carries a bearer token that lives
 * for ten minutes. Endpoint paths and payload shapes differ from v3 entirely,
 * so v3 snippets found online will not work here.
 *
 * Docs: https://developer.flutterwave.com/docs/authentication
 */
import crypto from "crypto";
import { env } from "../config/env";
import { prisma } from "./prisma";

const base = () => env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "");

export function isFlutterwaveConfigured(): boolean {
  return !!(env.FLUTTERWAVE_CLIENT_ID && env.FLUTTERWAVE_CLIENT_SECRET);
}

// ─── Access token ───────────────────────────────────────────────────────────
// Tokens last 600s. Cached in memory and refreshed early, because a token that
// expires mid-payout would fail a transfer that has already moved the user's
// crypto. `inflight` collapses concurrent refreshes into one request so a burst
// of traffic cannot stampede the IdP.

let cachedToken: { value: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

const REFRESH_MARGIN_MS = 60_000; // refresh a minute before expiry

async function fetchToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.FLUTTERWAVE_CLIENT_ID!,
    client_secret: env.FLUTTERWAVE_CLIENT_SECRET!,
    grant_type: "client_credentials",
  });

  const res = await fetch(env.FLUTTERWAVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text for the error below */
  }

  if (!res.ok || !json?.access_token) {
    throw new Error(
      `Flutterwave auth failed (${res.status}): ${String(text).slice(0, 200)}`
    );
  }

  const ttlMs = Number(json.expires_in ?? 600) * 1000;
  cachedToken = { value: json.access_token, expiresAt: Date.now() + ttlMs };
  return cachedToken.value;
}

export async function getFlutterwaveToken(): Promise<string> {
  if (!isFlutterwaveConfigured()) {
    throw new Error("Flutterwave is not configured (FLUTTERWAVE_CLIENT_ID / _SECRET missing)");
  }
  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_MARGIN_MS) {
    return cachedToken.value;
  }
  if (!inflight) {
    inflight = fetchToken().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Drop the cached token. Used when a call comes back 401. */
function invalidateToken() {
  cachedToken = null;
}

// ─── Request helper ─────────────────────────────────────────────────────────

export interface FlwResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
  raw: any;
}

/** X-Trace-Id must be 12-255 chars; a uuid comfortably satisfies that. */
function traceId(): string {
  return crypto.randomUUID();
}

async function flw<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotencyKey?: string; retryOn401?: boolean } = {}
): Promise<FlwResponse<T>> {
  const token = await getFlutterwaveToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-Trace-Id": traceId(),
  };
  if (opts.idempotencyKey) headers["X-Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${base()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // A 401 on a token we believed was live means it was revoked or rotated.
  // Retry exactly once with a fresh token; never loop, or a genuinely bad
  // credential would hammer the IdP.
  if (res.status === 401 && opts.retryOn401 !== false) {
    invalidateToken();
    return flw<T>(method, path, body, { ...opts, retryOn401: false });
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  // Log the whole body on failure. describeError() summarises for the caller,
  // but Flutterwave sometimes returns a message as unhelpful as "must not be
  // null" with no field attached - and then the only way forward is the raw
  // response.
  if (!res.ok) {
    console.error(
      `[FLW] ${method} ${path} -> ${res.status}`,
      typeof json === "string" ? json.slice(0, 1500) : JSON.stringify(json)?.slice(0, 1500)
    );
    // The request too: a complaint about a null field is only actionable next
    // to what was actually sent.
    if (body !== undefined) {
      console.error("[FLW] request body:", JSON.stringify(body)?.slice(0, 1500));
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    data: (json?.data ?? null) as T | null,
    message: res.ok ? json?.message || "" : describeError(json),
    raw: json,
  };
}

/**
 * Turn an error body into something a log line can actually act on.
 *
 * Flutterwave puts the useful part in `error.validation_errors[]` - which field
 * was wrong and why - while the top-level `message` is a generic "Invalid
 * request". Logging only the latter, as this did at first, tells you a call
 * failed but never why.
 */
function describeError(json: any): string {
  if (!json) return "";
  if (typeof json === "string") return json.slice(0, 400);

  const parts: string[] = [];
  if (json.message) parts.push(String(json.message));

  const errs = json.error?.validation_errors ?? json.errors ?? json.error?.details;
  if (Array.isArray(errs)) {
    for (const e of errs) {
      const field = e?.field ?? e?.parameter ?? e?.path ?? "";
      const msg = e?.message ?? e?.description ?? JSON.stringify(e);
      parts.push(field ? `${field}: ${msg}` : String(msg));
    }
  } else if (json.error?.message) {
    parts.push(String(json.error.message));
  }

  // Nothing recognisable - dump the body rather than losing it entirely.
  if (parts.length === 0) return JSON.stringify(json).slice(0, 400);
  return parts.join(" | ").slice(0, 400);
}

// ─── Banks & account resolution ─────────────────────────────────────────────

export interface FlwBank {
  id: string;
  code: string;
  name: string;
}

// Bank lists change rarely and the payout screen asks for them constantly.
let bankCache: { banks: FlwBank[]; at: number } | null = null;
const BANK_CACHE_TTL = 24 * 60 * 60 * 1000;

export async function flwListBanks(country = "NG"): Promise<FlwBank[]> {
  if (bankCache && Date.now() - bankCache.at < BANK_CACHE_TTL) return bankCache.banks;

  const r = await flw<FlwBank[]>("GET", `/banks?country=${encodeURIComponent(country)}`);
  const banks = Array.isArray(r.data) ? r.data : [];
  // Only cache a real answer - caching an empty list after a blip would keep
  // the payout screen broken for a day.
  if (banks.length > 0) bankCache = { banks, at: Date.now() };
  return banks;
}

/**
 * Banks the two lists spell differently, named outright.
 *
 * Our list says "First Bank of Nigeria"; Flutterwave's says "First Bank PLC".
 * Neither string contains the other, so the matching below returns nothing,
 * the resolve route answers "could not determine bank code", and the app tells
 * somebody their account was not found - about an account that resolves
 * perfectly well under code 011.
 *
 * Ten of the thirty-eight banks offered failed this way: a quarter of the list
 * unusable, for a spelling. Fuzzy matching would close some of them and is the
 * wrong tool - "first bank" is a prefix of "First City Monument Bank" too, and
 * a near-miss here pays the wrong institution. These are written down instead,
 * and each is checked against the live list before it is used, so a code
 * Flutterwave drops falls through to the matching rather than being sent.
 */
const FLW_NAME_ALIASES: Record<string, string> = {
  "first bank of nigeria": "011", // First Bank PLC
  citibank: "023", // Citi Bank
  "9 payment solutions bank": "120001", // 9 Payment Service Bank
  "providus bank": "101", // ProvidusBank PLC
  "standard chartered": "068", // Standard Chaterted bank PLC
  "coronation bank": "060001", // Coronation Merchant Bank
  "premium trust bank": "000031", // PremiumTrust Bank
  tajbank: "000026", // Taj Bank Limited
  "vfd microfinance bank": "090110", // VFD Micro Finance Bank
  /**
   * Nombank MFB, offered as "Nomba". Pinned rather than matched: Flutterwave
   * also lists Nomba Financial Services Limited (110028), and "nomba" is
   * inside both names, so matching would take whichever came first.
   */
  nomba: "090645", // Nombank MFB
  "paystack-titan": "100039", // PAYSTACK-TITAN
  "flutterwave mfb": "090567", // Flutterwave MFB (Formerly OK MFB)
  /**
   * Spellings the app does not currently send, pinned anyway.
   *
   * These were added on a false alarm: an audit run against a hand-copied
   * version of the app's bank list, which said "Moniepoint MFB" and "Rubies
   * Bank" where the app in fact says "Moniepoint" and "Rubies Microfinance
   * Bank". Neither was ever broken - the first matches by inclusion, the
   * second exactly.
   *
   * Kept because both mappings are correct and the app's wording has changed
   * before, so the short forms are worth pinning against the day it changes
   * again. The audit now reads constants/transfer.ts at run time rather than
   * trusting a copy of it.
   */
  "moniepoint mfb": "090405", // Moniepoint Microfinance Bank
  "rubies bank": "090175", // Rubies Microfinance Bank
};

/** Best-effort bank name → code, for beneficiaries saved before we stored codes. */
export async function flwBankCodeByName(name: string): Promise<string | null> {
  const banks = await flwListBanks();
  const wanted = name.trim().toLowerCase();

  const alias = FLW_NAME_ALIASES[wanted];
  if (alias && banks.some((b) => String(b.code) === alias)) return alias;

  const hit =
    banks.find((b) => b.name.toLowerCase() === wanted) ||
    banks.find((b) => b.name.toLowerCase().includes(wanted)) ||
    banks.find((b) => wanted.includes(b.name.toLowerCase()));
  return hit?.code ?? null;
}

export async function flwResolveAccount(
  bankCode: string,
  accountNumber: string
): Promise<{ ok: boolean; accountName: string | null; error?: string }> {
  const r = await flw<{ account_name?: string }>("POST", "/banks/account-resolve", {
    currency: "NGN",
    account: { code: bankCode, number: accountNumber },
  });
  const name = r.data?.account_name ?? null;
  return {
    ok: r.ok && !!name,
    accountName: name,
    error: r.ok ? undefined : r.message || `Lookup failed (${r.status})`,
  };
}

// ─── On-ramp: customers + virtual accounts ──────────────────────────────────

export interface FlwCustomer {
  id: string;
}

export async function flwCreateCustomer(args: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const r = await flw<FlwCustomer>("POST", "/customers", {
    email: args.email,
    ...(args.firstName || args.lastName
      ? {
          name: {
            first: args.firstName || undefined,
            last: args.lastName || undefined,
          },
        }
      : {}),
  });
  return {
    ok: r.ok && !!r.data?.id,
    id: r.data?.id ?? null,
    error: r.ok ? undefined : r.message || `Customer creation failed (${r.status})`,
  };
}


/**
 * The customer id for an email, creating one only if none exists.
 *
 * Creating is not idempotent - a repeat is 409 CUSTOMER_ALREADY_EXISTS - and
 * the id was previously only persisted once a FundingIntent was written. So a
 * deposit that failed after the customer was created left an orphan: the
 * customer existed at Flutterwave, we had no record of it, and every later
 * attempt hit the same 409.
 *
 * Cached under a "customer:" key so the id survives a failure anywhere later in
 * the flow, and recovered by search when Flutterwave says it already exists.
 */
export async function flwGetOrCreateCustomer(args: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const accountKey = `customer:${args.email.toLowerCase()}`;

  const known = await prisma.payoutRecipient.findUnique({
    where: { provider_accountKey: { provider: "flutterwave", accountKey } },
  });
  if (known) return { ok: true, id: known.recipientId };

  const created = await flwCreateCustomer(args);

  let id = created.id;
  if (!id) {
    // Recover an existing one rather than failing the deposit.
    const found = await flw<any[]>("POST", "/customers/search", { email: args.email });
    const rows = Array.isArray(found.data) ? found.data : [];
    const hit = rows.find(
      (c) => String(c?.email || "").toLowerCase() === args.email.toLowerCase()
    );
    id = hit?.id ?? null;
  }

  if (!id) return { ok: false, id: null, error: created.error };

  await prisma.payoutRecipient
    .upsert({
      where: { provider_accountKey: { provider: "flutterwave", accountKey } },
      create: { accountKey, recipientId: id, provider: "flutterwave" },
      update: { recipientId: id },
    })
    .catch(() => {});

  return { ok: true, id };
}

export interface FlwVirtualAccount {
  id?: string;
  account_number: string;
  account_bank_name?: string;
  /** Not documented as guaranteed, so every read of it needs a fallback. */
  account_name?: string;
  account_expiration_datetime?: string;
  reference?: string;
  amount?: number;
}

/**
 * A one-shot account for a single deposit.
 *
 * "dynamic" rather than "static": the account carries the exact amount and an
 * expiry, so a stale account number screenshotted from an old session cannot
 * quietly credit a new purchase at the wrong rate.
 *
 * Flutterwave requires a BVN or NIN to issue one. We hold a NIN for verified
 * users (extracted by Didit), which is why buying is gated on verification.
 *
 * `expiry` is in SECONDS, minimum 60 - passing minutes straight through is a
 * 400 with a validation error that is easy to misread as a payload problem.
 */
export async function flwCreateVirtualAccount(args: {
  customerId: string;
  amount: number;
  reference: string;
  nin?: string | null;
  bvn?: string | null;
  expiresInMinutes?: number;
}): Promise<{ ok: boolean; account: FlwVirtualAccount | null; error?: string }> {
  const r = await flw<FlwVirtualAccount>(
    "POST",
    "/virtual-accounts",
    {
      reference: args.reference,
      customer_id: args.customerId,
      amount: args.amount,
      currency: "NGN",
      account_type: "dynamic",
      expiry: Math.max(60, Math.round((args.expiresInMinutes ?? 30) * 60)),
      // Shown to the payer when the account resolves in their banking app, so
      // they can see who they are paying rather than an opaque MFB name.
      narration: "Money Moves",
      ...(args.nin ? { nin: args.nin } : {}),
      ...(args.bvn ? { bvn: args.bvn } : {}),
    },
    { idempotencyKey: args.reference }
  );

  return {
    ok: r.ok && !!r.data?.account_number,
    account: r.data ?? null,
    error: r.ok ? undefined : r.message || `Could not create account (${r.status})`,
  };
}

/** Confirm a collection independently of the webhook. */
export async function flwGetCharge(chargeId: string): Promise<FlwResponse> {
  return flw("GET", `/charges/${encodeURIComponent(chargeId)}`);
}

/**
 * Who the bank says sent a collection.
 *
 * Lives on payment_method_details.bank_transfer, which only exists for a bank
 * transfer - a card or USSD collection has no originator at all, and returns
 * nulls here rather than pretending otherwise.
 *
 * The account number arrives masked ("816*******75"), so it identifies nobody
 * and is kept only for the record. The name is the part worth anything.
 */
export interface FlwSender {
  name: string | null;
  bank: string | null;
  accountMasked: string | null;
}

export function flwExtractSender(charge: any): FlwSender {
  const bt = charge?.payment_method_details?.bank_transfer ?? {};
  const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    name: str(bt.originator_name),
    bank: str(bt.originator_bank_name),
    accountMasked: str(bt.originator_account_number),
  };
}

/**
 * Find a collection by OUR reference.
 *
 * The webhook is what normally tells us a charge id, so without it we would
 * have nothing to look up - which would leave the verify poll unable to confirm
 * a payment on its own. Searching by reference removes that dependency
 * entirely: the poll works when a webhook is late, dropped, or (running
 * locally) cannot reach us at all.
 */
export async function flwFindChargeByReference(
  reference: string
): Promise<{ id: string | null; status: string | null; amount: number | null; sender: FlwSender }> {
  const r = await flw<any[]>(
    "GET",
    `/charges?reference=${encodeURIComponent(reference)}&size=10`
  );
  const rows = Array.isArray(r.data) ? r.data : [];
  // Reference is unique across our transactions, but filter defensively rather
  // than trusting the first row of a list endpoint.
  const hit =
    rows.find((c) => c?.reference === reference && String(c?.status).toLowerCase() === "succeeded") ??
    rows.find((c) => c?.reference === reference) ??
    null;

  return {
    id: hit?.id ?? null,
    status: hit?.status ?? null,
    amount: typeof hit?.amount === "number" ? hit.amount : null,
    sender: flwExtractSender(hit),
  };
}

// ─── Off-ramp: transfers ────────────────────────────────────────────────────

export type FlwTransferStatus =
  | "NEW"
  | "INITIATED"
  | "PENDING"
  | "SUCCESSFUL"
  | "FAILED"
  | "CANCELLED";

export interface FlwTransfer {
  id: string;
  reference: string;
  status: FlwTransferStatus;
  fee?: { currency: string; value: number };
  recipient?: any;
  /**
   * The NIBSS session id, which is what a Nigerian bank asks for when tracing
   * a transfer.
   *
   * Field name unconfirmed: it is not in the v4 docs we worked from, and these
   * are the shapes Flutterwave has used for it. Read defensively and treat its
   * absence as normal rather than as an error.
   */
  session_id?: string;
  nibss_session_id?: string;
  meta?: Record<string, any>;
}

/**
 * Register a payout destination and get its id.
 *
 * v4 will not take bank details inline on /transfers, despite the guides
 * showing a `recipient` object there - the API rejects it with
 * "payment_instruction.recipient_id must not be null". Recipients are their own
 * resource and must exist first.
 *
 * `type: "bank_ngn"` selects the Nigerian schema, which (unlike USD or GBP)
 * needs no account_type and no recipient name.
 */
/**
 * A resolved account name, in the shape the payout rail will accept.
 *
 * Banks return more than a person: Opay answers for its OKash product as
 * "(OKash) IWINOSA SAMIRA AYOBAHAN", and the first word of that went across as
 * the beneficiary's first name. The rail refuses anything outside letters,
 * spaces, commas, periods, apostrophes and hyphens, so the payout failed after
 * the crypto had already been taken - the worst moment for a validation error
 * to arrive.
 *
 * Bracketed segments go first and whole: "(OKash)" is a product tag, not part
 * of anybody's name, and stripping only its brackets would leave the tag
 * standing in for a first name. Then anything still outside the allowed set is
 * dropped rather than substituted, because a name is not something to invent
 * characters for.
 *
 * An empty result returns no parts at all, which the caller already handles by
 * sending no name - better than sending something the rail will reject.
 */
export function payoutNameParts(accountName?: string | null): string[] {
  return (accountName || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^A-Za-z ,.'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    // The rail caps a name at 50 characters.
    .map((w) => w.slice(0, 50));
}

export async function flwCreateRecipient(args: {
  bankCode: string;
  accountNumber: string;
  accountName?: string | null;
}): Promise<{ ok: boolean; id: string | null; status: number; error?: string }> {
  // Split a resolved account name into parts only if we actually have one;
  // sending empty strings is worse than sending nothing.
  const parts = payoutNameParts(args.accountName);
  const name =
    parts.length > 0
      ? { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : parts[0] }
      : undefined;

  const r = await flw<{ id: string }>("POST", "/transfers/recipients", {
    type: "bank_ngn",
    bank: { code: args.bankCode, account_number: args.accountNumber },
    ...(name ? { name } : {}),
  });

  return {
    ok: r.ok && !!r.data?.id,
    id: r.data?.id ?? null,
    status: r.status,
    error: r.ok ? undefined : r.message || `Could not register payout account (${r.status})`,
  };
}

/**
 * Page the recipient list looking for one bank account.
 *
 * A last resort. The endpoint cannot be filtered - it offers cursor paging and
 * nothing else - so this is only worth doing when we know the recipient exists
 * (Flutterwave said 409) but have lost its id. Bounded, because an unbounded
 * walk over a growing list would eventually become the slowest part of a payout.
 */
async function findRecipientByAccount(
  bankCode: string,
  accountNumber: string
): Promise<string | null> {
  let cursor: string | undefined;

  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ size: "50", ...(cursor ? { next: cursor } : {}) });
    const r = await flw<any>("GET", `/transfers/recipients?${qs.toString()}`);
    const recipients: any[] = r.data?.recipients ?? [];

    const hit = recipients.find(
      (x) =>
        String(x?.bank?.account_number ?? "") === accountNumber &&
        String(x?.bank?.code ?? "") === bankCode
    );
    if (hit?.id) return hit.id;

    if (!r.data?.cursor?.has_more_items) return null;
    cursor = r.data.cursor.next;
    if (!cursor) return null;
  }

  return null;
}

/**
 * The recipient id for a bank account, creating one only if we have none.
 *
 * Creating is not idempotent: a repeat for the same account fails with 409
 * RECIPIENT_ALREADY_EXISTS. Since the list cannot be searched by account
 * number, the id is stored on our side - otherwise every payout after the first
 * to a given account would fail.
 */
export async function flwGetOrCreateRecipient(args: {
  bankCode: string;
  accountNumber: string;
  accountName?: string | null;
}): Promise<{ ok: boolean; id: string | null; error?: string }> {
  const accountKey = `${args.bankCode}:${args.accountNumber}`;

  const known = await prisma.payoutRecipient.findUnique({
    where: { provider_accountKey: { provider: "flutterwave", accountKey } },
  });
  if (known) return { ok: true, id: known.recipientId };

  const created = await flwCreateRecipient(args);

  let id = created.id;
  if (!id && created.status === 409) {
    // It exists at Flutterwave but not in our table - first payout to this
    // account since the table was introduced, or a row we lost.
    id = await findRecipientByAccount(args.bankCode, args.accountNumber);
    if (!id) {
      return {
        ok: false,
        id: null,
        error: "This account is already registered but could not be located. Contact support.",
      };
    }
  }

  if (!id) return { ok: false, id: null, error: created.error };

  // Two payouts to the same account can race here; whoever loses just reads the
  // row the winner wrote, so the outcome is identical either way.
  await prisma.payoutRecipient
    .upsert({
      where: { provider_accountKey: { provider: "flutterwave", accountKey } },
      create: { accountKey, recipientId: id, provider: "flutterwave" },
      update: { recipientId: id },
    })
    .catch(() => {});

  return { ok: true, id };
}

/**
 * The sender id representing us, creating one if we have none.
 *
 * Why this exists: dashboard transfers show the company name to the recipient's
 * bank, while API transfers showed a generic "TRF". Narration is not the lever -
 * ours never appeared - and a sender is the only documented way to name the
 * originating party.
 *
 * There is exactly one sender for the whole business, so it is cached in the
 * same table as recipients under a "sender:" key. Creating is assumed to be as
 * non-idempotent as recipient creation, and losing the id would mean never
 * being able to make another.
 */
export async function flwGetOrCreateSender(): Promise<string | null> {
  const name = (env.FLUTTERWAVE_SENDER_NAME || "").trim();
  if (!name) return null;

  const accountKey = `sender:${name}`;

  const known = await prisma.payoutRecipient.findUnique({
    where: { provider_accountKey: { provider: "flutterwave", accountKey } },
  });
  if (known) return known.recipientId;

  // The schema is person-shaped, so a company name is split rather than
  // dropped: first word into `first`, the rest into `last`, which recombines to
  // the original.
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts.slice(1).join(" ") || parts[0];

  const r = await flw<{ id: string }>("POST", "/transfers/senders", {
    type: "generic_sender",
    name: { first, last },
  });

  const id = r.data?.id ?? null;
  if (!id) {
    console.warn("[FLW] Could not create sender:", r.message);
    return null;
  }

  await prisma.payoutRecipient
    .upsert({
      where: { provider_accountKey: { provider: "flutterwave", accountKey } },
      create: { accountKey, recipientId: id, provider: "flutterwave" },
      update: { recipientId: id },
    })
    .catch(() => {});

  return id;
}

/**
 * Pay a user out to their Nigerian bank.
 *
 * `reference` is ours and must be unique (6-42 alphanumeric). It doubles as the
 * idempotency key, so a retry after a network timeout re-reads the original
 * transfer instead of sending the money twice - the failure mode that matters
 * most on this path.
 *
 * The amount `applies_to: "destination_currency"` means the figure is what the
 * user RECEIVES; Flutterwave's fee is charged on top and debited from our
 * balance, matching how Bachs behaved so the sell maths needs no rework.
 *
 * The bank account has to exist as a recipient first, and that registration is
 * NOT repeatable - a second attempt for the same account is a 409 - so the id
 * is looked up from our own table before we try to create anything.
 */
export async function flwCreateTransfer(args: {
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName?: string | null;
  reference: string;
  narration?: string;
  meta?: Record<string, unknown>;
}): Promise<{ ok: boolean; transfer: FlwTransfer | null; error?: string; status: number }> {
  const recipient = await flwGetOrCreateRecipient({
    bankCode: args.bankCode,
    accountNumber: args.accountNumber,
    accountName: args.accountName,
  });
  if (!recipient.ok || !recipient.id) {
    return { ok: false, transfer: null, error: recipient.error, status: 400 };
  }

  // Best effort, deliberately. Naming the sender is cosmetic; a payout that
  // works must not start failing because this call did.
  let senderId: string | null = null;
  try {
    senderId = await flwGetOrCreateSender();
  } catch (e: any) {
    console.warn("[FLW] Sender lookup failed, continuing without it:", e?.message);
  }

  const r = await flw<FlwTransfer>(
    "POST",
    "/transfers",
    {
      action: "instant",
      // `type` and `destination_currency` are both required in practice even
      // though the schema lists neither: omitting them fails the call with a
      // bare "must not be null" that names no field.
      type: "bank",
      reference: args.reference,
      // Flutterwave's own, so the seam does not have to know about it.
      narration: (args.narration || env.FLUTTERWAVE_NARRATION || "Money Moves").slice(0, 180),
      payment_instruction: {
        source_currency: "NGN",
        destination_currency: "NGN",
        amount: { value: args.amount, applies_to: "destination_currency" },
        recipient_id: recipient.id,
        ...(senderId ? { sender_id: senderId } : {}),
      },
      ...(args.meta ? { meta: args.meta } : {}),
    },
    { idempotencyKey: args.reference }
  );

  // Log what Flutterwave actually recorded. The recipient's bank shows a sender
  // label we do not control directly, so seeing which of narration / sender /
  // recipient it echoes back is the only way to tell which field drives it.
  if (r.ok) {
    console.log("[FLW] transfer created:", JSON.stringify(r.data)?.slice(0, 1200));
  }

  return {
    ok: r.ok && !!r.data?.id,
    transfer: r.data ?? null,
    error: r.ok ? undefined : r.message || `Payout failed (${r.status})`,
    status: r.status,
  };
}

export async function flwGetTransfer(
  idOrReference: string
): Promise<{ ok: boolean; transfer: FlwTransfer | null }> {
  const r = await flw<FlwTransfer>("GET", `/transfers/${encodeURIComponent(idOrReference)}`);
  return { ok: r.ok && !!r.data, transfer: r.data ?? null };
}

/** Map Flutterwave's transfer status onto our own PENDING/COMPLETED/FAILED. */
export function mapTransferStatus(
  status?: string
): "PENDING" | "COMPLETED" | "FAILED" {
  switch (status) {
    case "SUCCESSFUL":
      return "COMPLETED";
    case "FAILED":
    case "CANCELLED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

// ─── Webhooks ───────────────────────────────────────────────────────────────

/**
 * Verify a webhook against the dashboard secret hash.
 *
 * HMAC-SHA256 over the RAW body, base64 encoded, compared to the
 * `flutterwave-signature` header. It must be the raw bytes: re-serialising
 * req.body changes key order and whitespace and the digest stops matching.
 *
 * Returns false when no secret is configured. That is deliberate - an
 * unverifiable webhook is refused rather than trusted, because this endpoint
 * is unauthenticated and credits real money.
 */
export function verifyFlutterwaveSignature(rawBody: Buffer | string, signature?: string): boolean {
  if (!env.FLUTTERWAVE_WEBHOOK_SECRET || !signature) return false;

  const expected = crypto
    .createHmac("sha256", env.FLUTTERWAVE_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
