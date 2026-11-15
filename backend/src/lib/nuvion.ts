/**
 * Nuvion, for USD cards.
 *
 * A thin client over the parts we use: accounts, payment details, book
 * transfers and cards. Amounts on the wire are in cents. Card numbers and CVVs
 * pass through here on the way to the person's screen and are never logged or
 * stored: errors log the path and Nuvion's message only, never a body.
 */
import { env } from "../config/env";

export class NuvionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
  ) {
    super(message);
  }
}

export function cardsConfigured(): boolean {
  return !!(
    env.CARDS_ENABLED &&
    env.NUVION_API_KEY &&
    env.NUVION_FLOAT_ACCOUNT_ID &&
    env.NUVION_COUNTERPARTY_ID &&
    env.NUVION_DEPOSIT_SOL
  );
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (!env.NUVION_API_KEY) throw new NuvionError("Cards aren't set up", 503);
  const res = await fetch(`${env.NUVION_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NUVION_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: an outage page */
  }
  if (!res.ok || json?.status === "error") {
    const message = json?.message || `Nuvion answered ${res.status}`;
    console.warn(`[NUVION] ${method} ${path.split("?")[0]} -> ${res.status} ${json?.type || ""} ${message}`);
    throw new NuvionError(message, res.status, json?.type);
  }
  return (json?.data ?? json) as T;
}

// ─── Accounts ────────────────────────────────────────────────

export interface NuvionAccount {
  id: string;
  currency: string;
  display_name: string;
  nuvion_ban?: string;
  balance?: { available: number; current: number };
}

export async function createUsdAccount(displayName: string, meta: Record<string, string>): Promise<NuvionAccount> {
  const data = await call<{ account: NuvionAccount }>("POST", "/accounts", {
    type: "checking",
    currency: "USD",
    display_name: displayName,
    meta,
  });
  return data.account;
}

/** Finds an account by its exact display name, for a create that may already have gone through. */
export async function findAccountByName(displayName: string): Promise<NuvionAccount | null> {
  const data = await call<any>("GET", `/accounts?display_name=${encodeURIComponent(displayName)}&limit=10`);
  const list: NuvionAccount[] = Array.isArray(data) ? data : data?.data || data?.accounts || [];
  return list.find((a) => a.display_name === displayName) || null;
}

/** Available balance in cents, read live. */
export async function accountAvailableCents(accountId: string): Promise<number> {
  const data = await call<{ account: NuvionAccount }>("GET", `/accounts/${accountId}`);
  return Math.floor(Number(data.account?.balance?.available ?? 0));
}

export async function getAccount(accountId: string): Promise<NuvionAccount> {
  const data = await call<{ account: NuvionAccount }>("GET", `/accounts/${accountId}`);
  return data.account;
}

// ─── Book transfers ─────────────────────────────────────────

/** Makes an account a destination for book transfers from our float. */
export async function addBookDetail(accountNumber: string, holderName: string): Promise<string> {
  const data = await call<{ id: string }>("POST", "/payment-details", {
    payment_method: "book-transfer",
    currency: "USD",
    account_holder_name: holderName,
    counterparty_id: env.NUVION_COUNTERPARTY_ID,
    account_number: accountNumber,
  });
  return data.id;
}

export interface NuvionTransfer {
  id: string;
  status: "new" | "pending" | "successful" | "failed";
  status_reason?: string;
  amount: number;
  applicable_fee?: number;
}

/**
 * Moves dollars from the float into a card account. Settles at once.
 * `reference` is the idempotency key: the same top up can never be paid twice.
 */
export async function bookTransfer(args: {
  paymentDetailId: string;
  cents: number;
  reference: string;
  narration: string;
}): Promise<NuvionTransfer> {
  return call<NuvionTransfer>("POST", "/transfers", {
    account_id: env.NUVION_FLOAT_ACCOUNT_ID,
    counterparty_id: env.NUVION_COUNTERPARTY_ID,
    payment_detail_id: args.paymentDetailId,
    amount: args.cents,
    currency: "USD",
    narration: args.narration,
    payment_type: "book-transfer",
    unique_reference: args.reference,
  });
}

export async function getTransfer(id: string): Promise<NuvionTransfer> {
  return call<NuvionTransfer>("GET", `/transfers/${id}`);
}

/** The transfer already made under a reference, if any. A repeat reference returns 409 without it. */
export async function findTransferByReference(reference: string): Promise<NuvionTransfer | null> {
  const data = await call<any>(
    "GET",
    `/transfers?account_id=${env.NUVION_FLOAT_ACCOUNT_ID}&unique_reference=${encodeURIComponent(reference)}&limit=5`,
  );
  const list: any[] = Array.isArray(data) ? data : data?.data || data?.transfers || [];
  return list.find((t) => t.unique_reference === reference) || null;
}

// ─── Cards ──────────────────────────────────────────────────

export type NuvionCardKind = "virtual" | "disposable";

export async function cardCreationFeeCents(accountId: string): Promise<number> {
  const data = await call<{ fee: number }>("GET", `/card-creation-fee/${accountId}?currency=USD`);
  return Math.max(0, Math.ceil(Number(data.fee) || 0));
}

export async function createCard(args: {
  kind: NuvionCardKind;
  accountId: string;
  name: string;
  holder: { first_name: string; last_name: string; email: string; phone_number: string };
}): Promise<{ id: string; status: string }> {
  const now = new Date();
  // Two years out, the longest Nuvion allows.
  const expiry = new Date(now.getFullYear() + 2, now.getMonth(), 1);
  return call("POST", args.kind === "disposable" ? "/disposable-cards" : "/virtual-cards", {
    account_id: args.accountId,
    card_name: args.name,
    currency: "USD",
    cardholder: args.holder,
    expiration_month: String(expiry.getMonth() + 1).padStart(2, "0"),
    expiration_year: String(expiry.getFullYear() % 100).padStart(2, "0"),
  });
}

export interface NuvionCardDetails {
  id: string;
  status: string;
  name: string;
  type: NuvionCardKind;
  number: string;
  cvv: string;
  expiration_month: string;
  expiration_year: string;
  first_name?: string;
  last_name?: string;
  billing?: {
    address_line_1?: string;
    address_line_2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
}

export async function cardDetails(cardId: string): Promise<NuvionCardDetails> {
  return call<NuvionCardDetails>("GET", `/card-details/${cardId}`);
}

export async function freezeCard(cardId: string): Promise<void> {
  await call("PATCH", `/card-details/${cardId}/freeze`);
}

export async function unfreezeCard(cardId: string): Promise<void> {
  await call("PATCH", `/card-details/${cardId}/unfreeze`);
}

export async function deleteCard(cardId: string): Promise<void> {
  await call("DELETE", `/card-details/${cardId}`);
}

export interface NuvionCardPayment {
  _id: string;
  amount: number;
  currency: string;
  status: string;
  status_reason?: string;
  narration?: string;
  type: "outflow" | "inflow";
  payment_type: string;
  applicable_fee?: number;
  recipient?: { name?: string; address?: { city?: string; state?: string; country?: string } };
  created: number;
}

export async function cardPayments(cardId: string, limit = 30): Promise<NuvionCardPayment[]> {
  const data = await call<{ payments: NuvionCardPayment[] }>("GET", `/card-transactions/${cardId}?limit=${limit}`);
  return data?.payments || [];
}
