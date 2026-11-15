/**
 * Card limits and fees, set from the admin console.
 *
 * Stored as one JSON row in service_status (key "cards"); `paused` there is the
 * console's off switch, on top of CARDS_ENABLED. Anything never set falls back
 * to the env defaults. A person can carry their own overrides on their card
 * account (higher limits for someone trusted, or blocked from cards).
 */
import { prisma } from "./prisma";
import { env } from "../config/env";

const KEY = "cards";

export interface CardSettings {
  /** Smallest top up, dollars. */
  minTopup: number;
  /** Largest single top up, dollars. */
  maxTopup: number;
  /** Most one person can top up in 24 hours, dollars. */
  dailyTopup: number;
  /** Live cards one person can hold. */
  maxCards: number;
  /** Our cut of each top up, basis points. */
  topupFeeBps: number;
  /** Our fee for each new card, dollars, on top of the issuer's. */
  cardFee: number;
  /** The most one card can hold, dollars. A top up that would take a card past it is refused. */
  maxCardBalance: number;
  /** Ours, per everyday card, every 30 days from the day it was made, dollars. 0 is off. */
  monthlyFee: number;
  /** Ours, per declined card payment, dollars. 0 is off. */
  declineFee: number;
  /** Declines on one card that freeze it. 0 is off. */
  autoFreezeDeclines: number;
  /** The window those declines are counted in, hours. */
  autoFreezeHours: number;
}

export interface CardSettingsRow extends CardSettings {
  paused: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
}

/** What the console may set each to. */
export const RANGES: Record<keyof CardSettings, { min: number; max: number }> = {
  minTopup: { min: 0.1, max: 1_000 },
  maxTopup: { min: 1, max: 50_000 },
  dailyTopup: { min: 1, max: 100_000 },
  maxCards: { min: 1, max: 20 },
  topupFeeBps: { min: 0, max: 1_000 },
  cardFee: { min: 0, max: 50 },
  maxCardBalance: { min: 1, max: 100_000 },
  monthlyFee: { min: 0, max: 20 },
  declineFee: { min: 0, max: 5 },
  autoFreezeDeclines: { min: 0, max: 20 },
  autoFreezeHours: { min: 1, max: 168 },
};

export function defaults(): CardSettings {
  return {
    minTopup: env.CARD_MIN_TOPUP,
    maxTopup: 2_000,
    dailyTopup: 5_000,
    maxCards: 5,
    topupFeeBps: env.CARD_TOPUP_FEE_BPS,
    // Ours, per new card, not refundable once the card is made. Raised from the console.
    cardFee: 2,
    maxCardBalance: 500,
    // Both free for now; the console turns them on.
    monthlyFee: 0,
    declineFee: 0,
    autoFreezeDeclines: 3,
    autoFreezeHours: 24,
  };
}

let cached: { at: number; row: CardSettingsRow } | null = null;

export async function cardSettings(fresh = false): Promise<CardSettingsRow> {
  if (!fresh && cached && Date.now() - cached.at < 15_000) return cached.row;
  const r = await prisma.serviceStatus.findUnique({ where: { key: KEY } });
  let saved: Partial<CardSettings> = {};
  try {
    saved = r?.value ? JSON.parse(r.value) : {};
  } catch {
    /* a bad row reads as defaults */
  }
  const row: CardSettingsRow = {
    ...defaults(),
    ...saved,
    paused: !!r?.paused,
    updatedBy: r?.updatedBy ?? null,
    updatedAt: r?.updatedAt ?? null,
  };
  cached = { at: Date.now(), row };
  return row;
}

export function validate(input: Partial<CardSettings>): string | null {
  for (const [k, v] of Object.entries(input) as [keyof CardSettings, number][]) {
    const range = RANGES[k];
    if (!range) return `Unknown setting ${k}`;
    if (typeof v !== "number" || !Number.isFinite(v) || v < range.min || v > range.max) {
      return `${k} must be from ${range.min} to ${range.max}.`;
    }
    if ((k === "maxCards" || k === "topupFeeBps" || k === "autoFreezeDeclines" || k === "autoFreezeHours") && !Number.isInteger(v)) return `${k} must be a whole number.`;
  }
  return null;
}

export async function saveCardSettings(input: Partial<CardSettings> & { paused?: boolean }, by: string): Promise<CardSettingsRow> {
  const now = await cardSettings(true);
  const { paused, ...numbers } = input;
  const next: CardSettings = {
    minTopup: numbers.minTopup ?? now.minTopup,
    maxTopup: numbers.maxTopup ?? now.maxTopup,
    dailyTopup: numbers.dailyTopup ?? now.dailyTopup,
    maxCards: numbers.maxCards ?? now.maxCards,
    topupFeeBps: numbers.topupFeeBps ?? now.topupFeeBps,
    cardFee: numbers.cardFee ?? now.cardFee,
    maxCardBalance: numbers.maxCardBalance ?? now.maxCardBalance,
    monthlyFee: numbers.monthlyFee ?? now.monthlyFee,
    declineFee: numbers.declineFee ?? now.declineFee,
    autoFreezeDeclines: numbers.autoFreezeDeclines ?? now.autoFreezeDeclines,
    autoFreezeHours: numbers.autoFreezeHours ?? now.autoFreezeHours,
  };
  const value = JSON.stringify(next);
  await prisma.serviceStatus.upsert({
    where: { key: KEY },
    create: { key: KEY, value, paused: !!paused, updatedBy: by },
    update: { value, ...(paused === undefined ? {} : { paused }), updatedBy: by },
  });
  cached = null;
  return cardSettings(true);
}

/** One person's own limits, where the console has set any. */
export interface PersonLimits {
  maxTopup?: number;
  dailyTopup?: number;
  maxCards?: number;
}

export async function limitsFor(userId: string): Promise<CardSettingsRow & { blocked: boolean; own: PersonLimits }> {
  const [s, acct] = await Promise.all([
    cardSettings(),
    prisma.cardAccount.findUnique({ where: { userId }, select: { limits: true, blockedAt: true } }),
  ]);
  const own = ((acct?.limits as PersonLimits | null) || {}) as PersonLimits;
  return {
    ...s,
    maxTopup: own.maxTopup ?? s.maxTopup,
    dailyTopup: own.dailyTopup ?? s.dailyTopup,
    maxCards: own.maxCards ?? s.maxCards,
    blocked: !!acct?.blockedAt,
    own,
  };
}
