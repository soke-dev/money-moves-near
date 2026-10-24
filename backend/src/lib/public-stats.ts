import { prisma } from "./prisma";
import { fetchRates } from "../routes/rates";

/**
 * The figures behind the public analytics page.
 *
 * The page shipped with a snapshot taken by hand and a footer admitting it did
 * not update. This is that snapshot's shape, computed live from completed
 * transactions, field for field what the page already draws.
 *
 * Aggregates only: no names, addresses or single transactions leave here, so
 * it is safe unauthenticated. Cached for ten minutes, because the page is
 * public and every visit would otherwise read the whole ledger.
 *
 * Definitions, matching the page's own copy:
 *  - total processed: every completed movement - naira in and out, on-chain
 *    transfers, bills - with money that arrives and later leaves counted on
 *    both legs, the way a processor counts it;
 *  - on/off-ramp: naira converted to crypto (BUY) and back (SELL);
 *  - transactions: completed only;
 *  - people: every account ever made, closed ones included (shown as downloads);
 *  - active: people with at least one completed transaction, as the console counts them.
 * Dollar values use the dollar for the stablecoins and today's feed price for
 * the rest; an asset the feed has no price for adds nothing rather than a
 * guess. usdNgn is the dollar's naira price as the app quotes it today (the
 * USDC selling rate), for the page's naira view; 0 if it cannot be read, and
 * the page then offers dollars only.
 */

export interface PublicStats {
  updatedAt: string;
  usdNgn: number;
  totalProcessedUsd: number;
  rampVolumeUsd: number;
  transactions: number;
  people: number;
  active: number;
  months: { month: string; processed: number; ramp: number; tx: number }[];
  assets: { symbol: string; usd: number; tx: number }[];
}

const TTL_MS = 10 * 60_000;
let cached: { at: number; stats: PublicStats } | null = null;
let inflight: Promise<PublicStats> | null = null;

/** The display symbol: native Movement USDC and bridged USDC.e are the same dollar. */
const SYMBOL: Record<string, string> = { USDCx: "USDC", USDCe: "USDC" };

async function compute(): Promise<PublicStats> {
  const usd: Record<string, number> = { USDC: 1, USDT: 1, USDCx: 1, USDCe: 1 };
  const rates: any = await fetchRates().catch(() => null);
  const ngn = Number(rates?.USDC?.ngn) > 0 ? Number(rates.USDC.ngn) : 0;
  for (const sym of ["MOVE", "SOL", "ETH", "cNGN"]) {
    const v = Number(rates?.[sym]?.usd);
    if (v > 0) usd[sym] = v;
  }

  const [txns, people, active] = await Promise.all([
    prisma.transaction.findMany({
      where: { status: "COMPLETED" },
      select: { type: true, asset: true, amount: true, createdAt: true },
    }),
    prisma.user.count(),
    prisma.transaction.groupBy({ by: ["userId"], where: { status: "COMPLETED" } }).then((rows) => rows.length),
  ]);

  let total = 0;
  let ramp = 0;
  const months = new Map<string, { processed: number; ramp: number; tx: number }>();
  const assets = new Map<string, { usd: number; tx: number }>();

  for (const t of txns) {
    const value = Number(t.amount) * (usd[t.asset] ?? 0);
    const isRamp = t.type === "BUY" || t.type === "SELL";
    total += value;
    if (isRamp) ramp += value;

    const m = t.createdAt.toISOString().slice(0, 7);
    const mo = months.get(m) ?? { processed: 0, ramp: 0, tx: 0 };
    mo.processed += value;
    if (isRamp) mo.ramp += value;
    mo.tx += 1;
    months.set(m, mo);

    const sym = SYMBOL[t.asset] ?? t.asset;
    const a = assets.get(sym) ?? { usd: 0, tx: 0 };
    a.usd += value;
    a.tx += 1;
    assets.set(sym, a);
  }

  return {
    updatedAt: new Date().toISOString(),
    usdNgn: Math.round(ngn * 100) / 100,
    totalProcessedUsd: Math.round(total),
    rampVolumeUsd: Math.round(ramp),
    transactions: txns.length,
    people,
    active,
    months: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, processed: Math.round(v.processed), ramp: Math.round(v.ramp), tx: v.tx })),
    assets: [...assets.entries()]
      .map(([symbol, v]) => ({ symbol, usd: Math.round(v.usd), tx: v.tx }))
      .sort((a, b) => b.usd - a.usd),
  };
}

/** The figures, at most ten minutes old. Concurrent first visits share one read. */
export async function publicStats(): Promise<PublicStats> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.stats;
  if (!inflight) {
    inflight = compute()
      .then((stats) => {
        cached = { at: Date.now(), stats };
        return stats;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    // A failed refresh serves the last good figures rather than an error.
    if (cached) return cached.stats;
    throw err;
  }
}
