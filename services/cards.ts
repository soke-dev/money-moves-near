import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

const ACCESS_KEY = "@cardsVisible";
let accessMemo: boolean | null = null;

/**
 * Whether this account sees Cards at all. The server decides (cards are tried
 * out with a few accounts first); the last answer is remembered so the tab
 * doesn't pop in after launch. Hidden until told otherwise.
 */
export function useCardsVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(accessMemo ?? false);
  useEffect(() => {
    let live = true;
    if (accessMemo === null) {
      AsyncStorage.getItem(ACCESS_KEY)
        .then((v) => live && v != null && accessMemo === null && setVisible(v === "1"))
        .catch(() => {});
    }
    api
      .get("/cards/access")
      .then((r) => {
        const v = !!r.data?.visible;
        accessMemo = v;
        AsyncStorage.setItem(ACCESS_KEY, v ? "1" : "0").catch(() => {});
        if (live) setVisible(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return visible;
}

export type CardKind = "everyday" | "one-time";

export interface CardSummary {
  id: string;
  kind: CardKind;
  name: string;
  last4: string | null;
  /** active, blocked (frozen), deactivated (a used one-time card), fraud. */
  status: string;
  /** This card's own balance, live from the issuer; null when it didn't answer. */
  balance: number | null;
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
  /** The most one card can hold. */
  maxCardBalance?: number;
  /** A card asked for with a top up, made once the money lands. */
  pendingCard?: { kind: CardKind; name: string; stuck: boolean } | null;
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
  /** payment and reversal come from the card; topup and created are ours. */
  kind: "payment" | "reversal" | "topup" | "created" | "withdraw";
  status: "done" | "declined" | "pending" | "held";
  /** Decline reason, or a top up's breakdown. */
  note?: string | null;
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

/**
 * Starts a top up: for an existing card (`cardId`), or with `card` for a new one,
 * made by itself once this lands, with its creation fee kept back from it.
 */
export async function startCardTopup(
  amount: number,
  asset: "USDC" | "USDT",
  to: { cardId: string } | { card: { kind: CardKind; name: string } },
) {
  return (await api.post("/cards/topup", { amount, asset, ...to })).data as {
    address: string;
    chain: "SOL";
    asset: string;
    amount: number;
    credit: number;
    cardFee: number;
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

/** Card balance back to the person's own wallet, as USDC on Solana. `max` sends everything. */
export async function withdrawCard(id: string, opts: { amount?: number; max?: boolean }) {
  return (await api.post(`/cards/${id}/withdraw`, opts, { timeout: 60_000 })).data as {
    status: "sent" | "pending";
    amount: number;
    fee: number;
    to: string;
  };
}

export async function renameCard(id: string, name: string) {
  return (await api.patch(`/cards/${id}`, { name })).data as { name: string };
}

export async function deleteCard(id: string) {
  await api.delete(`/cards/${id}`);
}

export async function getCardActivity(id: string): Promise<CardActivityItem[]> {
  return (await api.get(`/cards/${id}/activity`)).data.items;
}
