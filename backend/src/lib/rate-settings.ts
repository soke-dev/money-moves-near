import { prisma } from "./prisma";
import { env } from "../config/env";

/**
 * The naira markups and ceilings, settable from the admin Services page.
 *
 * They lived only in Railway's environment, so moving the funding rate by a
 * naira meant a redeploy. Now an admin value, stored in service_status, wins
 * over the environment's; clearing it falls back to the environment again, so
 * Railway still holds the defaults and nothing has to be set up front.
 *
 * Read synchronously (every naira price goes through ngn-rate's one line),
 * from a copy refreshed every half minute - and reloaded at once on save.
 */

export type RateKey = "fundMarkup" | "sellMarkup" | "fundMax" | "sellMax";
export const RATE_KEYS: RateKey[] = ["fundMarkup", "sellMarkup", "fundMax", "sellMax"];

const DB_KEY: Record<RateKey, string> = {
  fundMarkup: "rate_fund_markup",
  sellMarkup: "rate_sell_markup",
  fundMax: "rate_fund_max",
  sellMax: "rate_sell_max",
};

const REFRESH_MS = 30_000;

let overrides: Partial<Record<RateKey, number>> = {};
let meta: Partial<Record<RateKey, { by: string | null; at: Date | null }>> = {};
let loadedAt = 0;
let loading: Promise<void> | null = null;

/** What Railway's environment says, for the fallback and for display. */
export function railwayRateSettings(): Record<RateKey, number> {
  return {
    fundMarkup: env.NGN_FUND_MARKUP,
    sellMarkup: env.NGN_SELL_MARKUP,
    fundMax: env.NGN_FUND_MAX,
    sellMax: env.NGN_SELL_MAX,
  };
}

async function load(): Promise<void> {
  const rows = await prisma.serviceStatus.findMany({
    where: { key: { in: Object.values(DB_KEY) } },
    select: { key: true, value: true, updatedBy: true, updatedAt: true },
  });
  const next: Partial<Record<RateKey, number>> = {};
  const nextMeta: typeof meta = {};
  for (const k of RATE_KEYS) {
    const row = rows.find((r) => r.key === DB_KEY[k]);
    const n = row?.value != null ? Number(row.value) : NaN;
    if (Number.isFinite(n)) {
      next[k] = n;
      nextMeta[k] = { by: row?.updatedBy ?? null, at: row?.updatedAt ?? null };
    }
  }
  overrides = next;
  meta = nextMeta;
  loadedAt = Date.now();
}

function refreshInBackground(): void {
  if (loading) return;
  loading = load()
    .catch((err) => console.warn("[RATES] could not read admin rate settings:", err?.message ?? err))
    .finally(() => {
      loading = null;
    });
}

/**
 * Loaded before the first price is posted, then kept fresh behind the scenes.
 * The async rate paths await this, so the first quote after a boot cannot be
 * priced on the environment's figure when an admin one exists.
 */
export async function ensureRateSettings(): Promise<void> {
  if (loadedAt === 0) {
    refreshInBackground();
    await loading;
  } else if (Date.now() - loadedAt > REFRESH_MS) {
    refreshInBackground();
  }
}

/** The values in force: an admin value where one is set, else Railway's. */
export function rateSettings(): Record<RateKey, number> {
  if (loadedAt !== 0 && Date.now() - loadedAt > REFRESH_MS) refreshInBackground();
  return { ...railwayRateSettings(), ...overrides };
}

/** Where each value comes from, and who last set an admin one. */
export function rateSources(): Record<RateKey, { source: "admin" | "railway"; by: string | null; at: Date | null }> {
  const out = {} as Record<RateKey, { source: "admin" | "railway"; by: string | null; at: Date | null }>;
  for (const k of RATE_KEYS) {
    out[k] = k in overrides
      ? { source: "admin", by: meta[k]?.by ?? null, at: meta[k]?.at ?? null }
      : { source: "railway", by: null, at: null };
  }
  return out;
}

/** Set one value from the admin page, or null to go back to Railway's. */
export async function setRateSetting(key: RateKey, value: number | null, by: string): Promise<void> {
  if (value == null) {
    await prisma.serviceStatus.deleteMany({ where: { key: DB_KEY[key] } });
  } else {
    await prisma.serviceStatus.upsert({
      where: { key: DB_KEY[key] },
      create: { key: DB_KEY[key], value: String(value), updatedBy: by },
      update: { value: String(value), updatedBy: by },
    });
  }
  await load();
}
