/**
 * paystack.ts — Paystack payouts, the second rail.
 *
 * Flutterwave went down and took every sell payout with it, so there is a
 * second provider and an admin switch between them. This module mirrors the
 * payout surface of flutterwave.ts and nothing else: Paystack does not touch
 * funding here, which stays on Flutterwave's virtual accounts.
 *
 * Three things differ from Flutterwave and each one has bitten somebody
 * somewhere:
 *
 *  1. Amounts are in KOBO. A naira figure sent unconverted pays a hundred
 *     times too much. Conversion happens once, at the boundary, in
 *     psCreateTransfer, and nowhere else.
 *  2. Bank codes are Paystack's own. Only the twenty traditional banks share
 *     the NIBSS code with Flutterwave; every fintech differs (Opay is 100004
 *     there and 999992 here). A code from one provider is never valid at the
 *     other, so it is always resolved from the name against this list.
 *  3. Transfers need OTP disabled on the Paystack dashboard. With it on,
 *     every transfer parks in status "otp" and waits for a code nobody is
 *     going to type.
 */
import crypto from "crypto";
import { env } from "../config/env";
import { prisma } from "./prisma";

const BASE = "https://api.paystack.co";
const BANK_CACHE_TTL = 24 * 60 * 60 * 1000;

let bankCache: { banks: PsBank[]; at: number } | null = null;

export interface PsBank {
  name: string;
  code: string;
  slug?: string;
}

export interface PsTransfer {
  id?: number | string;
  status?: string;
  reference?: string;
  transfer_code?: string;
  amount?: number;
  reason?: string;
  [k: string]: any;
}

export function isPaystackConfigured(): boolean {
  return !!env.PAYSTACK_SECRET_KEY;
}

interface PsResponse<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string;
}

async function ps<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<PsResponse<T>> {
  if (!isPaystackConfigured()) {
    return { ok: false, status: 0, data: null, message: "Paystack is not configured" };
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // A body we cannot parse is still a status we can report.
  }

  return {
    // Paystack answers 200 with status:false for business failures, so the
    // HTTP code alone is not the answer.
    ok: res.ok && json?.status === true,
    status: res.status,
    data: (json?.data ?? null) as T | null,
    message: json?.message || `Paystack ${res.status}`,
  };
}

// ─── Banks ────────────────────────────────────────────────────

export async function psListBanks(): Promise<PsBank[]> {
  if (bankCache && Date.now() - bankCache.at < BANK_CACHE_TTL) return bankCache.banks;

  const r = await ps<PsBank[]>("GET", "/bank?country=nigeria&perPage=200");
  const banks = Array.isArray(r.data) ? r.data : [];
  // Never cache an empty answer; a blip would keep payouts broken for a day.
  if (banks.length > 0) bankCache = { banks, at: Date.now() };
  return banks;
}

/**
 * The six Paystack spells differently from us, named outright.
 *
 * Same problem as FLW_NAME_ALIASES and the same answer: written down rather
 * than fuzzy-matched, and each checked against the live list before use. Found
 * by diffing both providers against the forty banks the app offers - see
 * scripts/bank-codes.ts, which re-runs the check when the lists drift.
 *
 * Titan is the one to be careful with. Paystack lists "Titan Bank" (102) and
 * "Paystack-Titan" (100039); the second is Paystack's own virtual-account rail
 * and not a bank at all, so the real one is pinned here rather than left to a
 * match that could pick either.
 */
const PS_NAME_ALIASES: Record<string, string> = {
  "9 payment solutions bank": "120001", // 9mobile 9Payment Service Bank
  "coronation bank": "559", // Coronation Merchant Bank
  "premium trust bank": "105", // PremiumTrust Bank
  "rubies microfinance bank": "125", // Rubies MFB
  "smartcash payment service bank": "120004", // Airtel Smartcash PSB
  tajbank: "302", // TAJ Bank
  "titan trust bank": "102", // Titan Bank — NOT 100039 Paystack-Titan
  "paystack-titan": "100039", // Paystack-Titan, offered as its own bank
  nomba: "50072", // Nombank MFB
  "flutterwave mfb": "090567", // Flutterwave MFB
};

export async function psBankCodeByName(name: string): Promise<string | null> {
  const banks = await psListBanks();
  const wanted = name.trim().toLowerCase();

  const alias = PS_NAME_ALIASES[wanted];
  if (alias && banks.some((b) => String(b.code) === alias)) return alias;

  const hit =
    banks.find((b) => b.name.toLowerCase() === wanted) ||
    banks.find((b) => b.name.toLowerCase().includes(wanted)) ||
    banks.find((b) => wanted.includes(b.name.toLowerCase()));
  return hit?.code ?? null;
}

// ─── Account resolution ───────────────────────────────────────

export async function psResolveAccount(
  bankCode: string,
  accountNumber: string,
): Promise<{ ok: boolean; accountName: string | null; error?: string }> {
  const r = await ps<{ account_name?: string }>(
    "GET",
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  return {
    ok: r.ok && !!r.data?.account_name,
    accountName: r.data?.account_name ?? null,
    error: r.ok ? undefined : r.message,
  };
}

/**
 * NGN available to pay out with.
 *
 * Doubles as the cheapest proof that the key works from wherever this is
 * running - which is not the same question as whether it works from a laptop.
 * Paystack can restrict a key to an IP allowlist, and a key that resolves
 * accounts locally and nothing in production is exactly what that looks like.
 */
export async function psBalance(): Promise<{ ok: boolean; ngn: number | null; error?: string }> {
  const r = await ps<{ currency: string; balance: number }[]>("GET", "/balance");
  const ngn = (r.data || []).find((b) => b.currency === "NGN");
  return {
    ok: r.ok && !!ngn,
    ngn: ngn ? ngn.balance / 100 : null,
    error: r.ok ? undefined : r.message,
  };
}

// ─── Recipients ───────────────────────────────────────────────

/**
 * The recipient code for a bank account, creating one only if we have none.
 *
 * Paystack will happily mint a second recipient for the same account rather
 * than refusing like Flutterwave does, which is worse rather than better: it
 * leaves a trail of duplicates nobody notices. The row is keyed on provider
 * and account together, because twenty of the forty banks share a code with
 * Flutterwave and a bare "044:012..." would name the same key at both.
 */
export async function psGetOrCreateRecipient(args: {
  bankCode: string;
  accountNumber: string;
  accountName?: string | null;
}): Promise<{ ok: boolean; code: string | null; error?: string }> {
  const accountKey = `${args.bankCode}:${args.accountNumber}`;

  const known = await prisma.payoutRecipient.findUnique({
    where: { provider_accountKey: { provider: "paystack", accountKey } },
  });
  if (known) return { ok: true, code: known.recipientId };

  const r = await ps<{ recipient_code?: string }>("POST", "/transferrecipient", {
    type: "nuban",
    name: (args.accountName || "Money Moves user").slice(0, 100),
    account_number: args.accountNumber,
    bank_code: args.bankCode,
    currency: "NGN",
  });

  const code = r.data?.recipient_code ?? null;
  if (!code) return { ok: false, code: null, error: r.message };

  // Two payouts to the same account can race; the loser reads what the winner
  // wrote and the outcome is the same either way.
  await prisma.payoutRecipient
    .upsert({
      where: { provider_accountKey: { provider: "paystack", accountKey } },
      create: { accountKey, recipientId: code, provider: "paystack" },
      update: { recipientId: code },
    })
    .catch(() => {});

  return { ok: true, code };
}

// ─── Transfers ────────────────────────────────────────────────

/**
 * What the recipient's bank shows this payment as.
 *
 * The registered company name, not the product name. A statement line saying
 * "Money Moves" is a brand somebody has to recognise; one saying the entity
 * that actually sent the money is what a bank, an employer or anybody asking
 * where a credit came from can be shown.
 *
 * Paystack's own, because each rail carries its own: Flutterwave's comes from
 * FLUTTERWAVE_NARRATION and the seam no longer hands one provider's setting
 * to the other.
 */
const PS_NARRATION = "Movers Digital Technologies LTD";

/**
 * Pay a user out to their Nigerian bank.
 *
 * `amount` arrives in NAIRA, as everywhere else in this codebase, and is
 * converted to kobo here - the single place it happens. Rounded because
 * Paystack rejects a fractional kobo, and our sell maths deals in whole naira
 * anyway.
 *
 * `reference` is ours and doubles as the idempotency key: a retry after a
 * timeout re-reads the original transfer rather than sending twice, which is
 * the failure that matters most on this path.
 *
 * A response of status "otp" means OTP is still enabled on the dashboard. That
 * is a configuration problem, not a transient one, so it is named as such
 * rather than left to look like a pending transfer that never settles.
 */
export async function psCreateTransfer(args: {
  amount: number;
  bankCode: string;
  accountNumber: string;
  accountName?: string | null;
  reference: string;
  narration?: string;
}): Promise<{ ok: boolean; transfer: PsTransfer | null; error?: string; status: number }> {
  const recipient = await psGetOrCreateRecipient({
    bankCode: args.bankCode,
    accountNumber: args.accountNumber,
    accountName: args.accountName,
  });
  if (!recipient.ok || !recipient.code) {
    return { ok: false, transfer: null, error: recipient.error, status: 400 };
  }

  const r = await ps<PsTransfer>("POST", "/transfer", {
    source: "balance",
    amount: Math.round(args.amount * 100),
    recipient: recipient.code,
    reason: (args.narration || PS_NARRATION).slice(0, 100),
    reference: args.reference,
    currency: "NGN",
  });

  if (r.ok && r.data) {
    console.log("[PS] transfer created:", JSON.stringify(r.data).slice(0, 800));
  }

  if (r.data?.status === "otp") {
    return {
      ok: false,
      transfer: r.data,
      error: "Paystack is asking for an OTP. Disable OTP for transfers on the dashboard.",
      status: r.status,
    };
  }

  return {
    ok: r.ok && !!r.data,
    transfer: r.data ?? null,
    error: r.ok ? undefined : r.message || `Payout failed (${r.status})`,
    status: r.status,
  };
}

/**
 * Read a transfer back, by whichever handle we stored.
 *
 * Paystack has two endpoints and they take different things: /transfer/:code
 * wants the transfer_code it minted (TRF_...), /transfer/verify/:reference
 * wants ours. We store the code where the create call returned one and the
 * reference where it did not, so the handle is inspected rather than assumed -
 * passing a code to the verify endpoint is a 404, which reads as a failed
 * payout and is not one.
 */
export async function psGetTransfer(
  handle: string,
): Promise<{ ok: boolean; transfer: PsTransfer | null }> {
  const path = handle.startsWith("TRF_")
    ? `/transfer/${encodeURIComponent(handle)}`
    : `/transfer/verify/${encodeURIComponent(handle)}`;

  const r = await ps<PsTransfer>("GET", path);
  return { ok: r.ok && !!r.data, transfer: r.data ?? null };
}

/** Paystack's transfer status onto our own PENDING/COMPLETED/FAILED. */
export function mapPaystackTransferStatus(
  status?: string,
): "PENDING" | "COMPLETED" | "FAILED" {
  switch ((status || "").toLowerCase()) {
    case "success":
      return "COMPLETED";
    case "failed":
    case "abandoned":
    case "reversed":
      return "FAILED";
    default:
      // "pending", "processing", "otp" and anything new. A transfer we do not
      // recognise is still in flight until it tells us otherwise.
      return "PENDING";
  }
}

/**
 * Is this webhook really from Paystack?
 *
 * HMAC SHA512 of the exact bytes received, keyed with the secret. Computed on
 * the raw buffer rather than a re-serialised body, because JSON.stringify does
 * not promise to reproduce byte for byte what was signed.
 */
export function verifyPaystackSignature(
  rawBody: Buffer | string,
  signature?: string,
): boolean {
  if (!signature || !env.PAYSTACK_SECRET_KEY) return false;

  const expected = crypto
    .createHmac("sha512", env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
