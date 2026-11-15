import { api } from "./api";

export type CardKind = "everyday" | "one-time";

export interface CardSummary {
  id: string;
  kind: CardKind;
  name: string;
  last4: string | null;
  /** active, blocked (frozen), deactivated (a used one-time card), fraud. */
  status: string;
  createdAt: string;
}

export interface CardTopupRow {
  id: string;
  asset: string;
  amount: number;
  credit: number;
  status: "pending" | "done" | "held";
  createdAt: string;
}

export interface CardsOverview {
  enabled: boolean;
  message?: string;
  /** Why this person can't use cards yet. */
  blocked?: { code: "KYC" | "UPGRADE" | "NAME" | "PHONE" | string; error: string } | null;
  /** Live from the card issuer; null when it didn't answer. */
  balance?: number | null;
  cardFee?: number | null;
  minTopup?: number;
  topupFeeBps?: number;
  cards?: CardSummary[];
  topups?: CardTopupRow[];
}

export interface CardDetails {
  number: string;
  cvv: string;
  expiry: string;
  name: string;
  status: string;
  billing: {
    address_line_1?: string;
    address_line_2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
}

export interface CardActivityItem {
  id: string;
  merchant: string;
  place: string | null;
  amount: number;
  fee: number;
  direction: "in" | "out";
  kind: "payment" | "reversal";
  status: "done" | "declined" | "pending";
  at: number;
}

export async function getCards(): Promise<CardsOverview> {
  try {
    return (await api.get("/cards")).data;
  } catch (e: any) {
    // A server without cards yet reads as "opening soon", not as an error.
    if (e?.response?.status === 404) return { enabled: false };
    throw e;
  }
}

export async function startCardTopup(amount: number, asset: "USDC" | "USDT") {
  return (await api.post("/cards/topup", { amount, asset })).data as {
    address: string;
    chain: "SOL";
    asset: string;
    amount: number;
    credit: number;
  };
}

export async function syncCardTopups() {
  await api.post("/cards/topup/sync");
}

export async function createCard(kind: CardKind, name: string) {
  return (await api.post("/cards", { kind, name })).data as { id: string };
}

export async function getCardDetails(id: string): Promise<CardDetails> {
  return (await api.get(`/cards/${id}/details`)).data;
}

export async function setCardFrozen(id: string, frozen: boolean) {
  return (await api.post(`/cards/${id}/${frozen ? "freeze" : "unfreeze"}`)).data as { status: string };
}

export async function deleteCard(id: string) {
  await api.delete(`/cards/${id}`);
}

export async function getCardActivity(id: string): Promise<CardActivityItem[]> {
  return (await api.get(`/cards/${id}/activity`)).data.items;
}
