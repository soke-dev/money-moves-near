/**
 * The platform's switches - what the admin console's Services page sets.
 *
 * Which ways to pay are on, which checkouts, where money can settle and on
 * which chains, which coins and networks customers can pay with, the default
 * fees, how big one checkout can be (for registered businesses and for
 * freelancers apart), how big a payout can be before a person checks it, and
 * two kill switches: payouts (settlements stay queued, nothing leaves) and new
 * businesses. They're enforced here, by the API; the dashboard and the checkout
 * only reflect them.
 *
 * Stored as one value and read through a ten-second cache, so a change reaches
 * every instance within seconds. Anything never set takes its default, so a
 * new switch never needs a migration.
 */
import { z } from "zod";
import type { BusinessKind, Mode, Prisma, SettleChain } from "@prisma/client";
import { prisma } from "./prisma";
import { log } from "./log";

/** The networks customers can send crypto on - the app's own catalogue. */
export const NETWORKS = ["Movement", "Monad", "Arc", "Solana", "Stellar", "Base", "BNB Chain", "TON", "Arbitrum", "Optimism", "Ethereum"] as const;

const on = z.boolean();
export const platformSchema = z.object({
  /** Off: settlements stay queued - nothing is sent until it's back on. In-flight payouts are still followed. */
  payouts: on,
  /** Off: nobody can open a new business. */
  newBusinesses: on,
  /** On: every checkout says payments are paused, and none can start. Payments already on their way still land. */
  maintenance: on,
  methods: z.object({ naira: on, app: on, crypto: on }),
  channels: z.object({ links: on, invoices: on, outlets: on, api: on }),
  destinations: z.object({ bank: on, moneyMoves: on, wallet: on }),
  /**
   * Movement is the default: a business on another chain switched off is moved to it. Movement itself
   * can be switched off too - its settlements then wait in the queue until it's back on, or the team sends them.
   */
  settleChains: z.object({ MOVEMENT: on, ARC: on, MONAD: on, SOLANA: on, STELLAR: on }),
  coins: z.object({ USDC: on, USDT: on }),
  networks: z.object(Object.fromEntries(NETWORKS.map((n) => [n, on])) as Record<(typeof NETWORKS)[number], typeof on>),
  fees: z.object({
    nairaRateBps: z.number().int().min(0).max(1000),
    nairaCapNgn: z.number().min(0).max(100_000),
    cryptoRateBps: z.number().int().min(0).max(1000),
    cryptoCapUsd: z.number().min(0).max(1000),
    appRateBps: z.number().int().min(0).max(1000),
    payoutNgn: z.number().min(0).max(10_000),
  }),
  /** The least and the most one checkout can be: for a registered business, and for someone working for themselves. */
  limits: z
    .object({
      businessMinNgn: z.number().min(1).max(1_000_000),
      businessMaxNgn: z.number().min(1_000).max(100_000_000),
      freelancerMinNgn: z.number().min(1).max(1_000_000),
      freelancerMaxNgn: z.number().min(1_000).max(100_000_000),
    })
    .refine((l) => l.businessMinNgn < l.businessMaxNgn && l.freelancerMinNgn < l.freelancerMaxNgn, "The least a checkout can be has to be under the most."),
  /**
   * Live payouts bigger than these wait for a person. Naira: settlements to a
   * bank, and - once the business wallet exists - naira sent out of it. Crypto:
   * settlements to a business wallet or a Money Moves account. Never shown to
   * a business; it sees the payout as on its way.
   */
  review: z.object({
    nairaAboveNgn: z.number().min(0).max(100_000_000),
    cryptoAboveUsd: z.number().min(0).max(1_000_000),
  }),
  /**
   * Daily limits: past what a business takes in live in a day, its
   * settlements wait for a person. New businesses (younger than newDays)
   * start lower. A spike is a day spikeTimes its usual, and at least
   * spikeMinNgn, shown on the admin console.
   */
  risk: z.object({
    newDays: z.number().int().min(0).max(365),
    newDailyNgn: z.number().min(0).max(1_000_000_000),
    dailyNgn: z.number().min(0).max(10_000_000_000),
    spikeTimes: z.number().min(1).max(100),
    spikeMinNgn: z.number().min(0).max(1_000_000_000),
  }),
});

export type Platform = z.infer<typeof platformSchema>;

export const PLATFORM_DEFAULTS: Platform = {
  payouts: true,
  newBusinesses: true,
  maintenance: false,
  methods: { naira: true, app: true, crypto: true },
  channels: { links: true, invoices: true, outlets: true, api: true },
  destinations: { bank: true, moneyMoves: true, wallet: true },
  settleChains: { MOVEMENT: true, ARC: true, MONAD: true, SOLANA: true, STELLAR: true },
  coins: { USDC: true, USDT: true },
  networks: Object.fromEntries(NETWORKS.map((n) => [n, true])) as Platform["networks"],
  fees: { nairaRateBps: 50, nairaCapNgn: 1_000, cryptoRateBps: 50, cryptoCapUsd: 1, appRateBps: 0, payoutNgn: 100 },
  limits: { businessMinNgn: 100, businessMaxNgn: 1_000_000, freelancerMinNgn: 100, freelancerMaxNgn: 500_000 },
  review: { nairaAboveNgn: 50_000, cryptoAboveUsd: 50 },
  risk: { newDays: 30, newDailyNgn: 2_000_000, dailyNgn: 20_000_000, spikeTimes: 3, spikeMinNgn: 500_000 },
};

const KEY = "platform";
const FRESH_MS = 10_000;

type Meta = { updatedBy: string | null; updatedAt: Date | null };
let cache: { value: Platform; meta: Meta; at: number } | null = null;

/** What's stored, laid over the defaults one level deep - so a group missing a new switch still gets it. */
function withDefaults(stored: unknown): Platform {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(PLATFORM_DEFAULTS)) {
    const v = s[k];
    merged[k] = d && typeof d === "object" ? { ...d, ...(v && typeof v === "object" ? v : {}) } : (v ?? d);
  }
  const ok = platformSchema.safeParse(merged);
  if (ok.success) return ok.data;
  log.error("[platform] stored settings don't fit, using the defaults", { problem: ok.error.issues[0]?.message });
  return PLATFORM_DEFAULTS;
}

async function load() {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  cache = { value: withDefaults(row?.value), meta: { updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null }, at: Date.now() };
  return cache;
}

export async function platform(): Promise<Platform> {
  return (await load()).value;
}

export async function platformWithMeta() {
  const c = await load();
  return { platform: c.value, ...c.meta };
}

/** Saves the whole set, already checked. Returns which switches changed, as "group.switch". */
export async function savePlatform(next: Platform, by: string): Promise<string[]> {
  const before = await platform();
  const changed: string[] = [];
  for (const [k, v] of Object.entries(next)) {
    const was = (before as Record<string, unknown>)[k];
    if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v)) if ((was as Record<string, unknown>)?.[kk] !== vv) changed.push(`${k}.${kk}`);
    } else if (was !== v) changed.push(k);
  }
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedBy: by },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedBy: by },
  });
  cache = null;
  return changed;
}

/**
 * The payout switch, read fresh every time - never from the cache. It's a kill
 * switch: every instance has to stop the moment it's flipped, not ten seconds later.
 */
export async function payoutsOn(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return withDefaults(row?.value).payouts;
}

/** Where crypto settles when a business's own chain is switched off - and every new business's to start. */
export const DEFAULT_CHAIN: SettleChain = "MOVEMENT";

/** The chain a business's crypto settles on today: its own, unless that's been switched off. */
export const effectiveChain = (chain: SettleChain, p: Platform): SettleChain => (p.settleChains[chain] ? chain : DEFAULT_CHAIN);

/** Whether payouts on a chain are paused - only Movement can be, since everything else moves to it. */
export const chainPaused = (chain: SettleChain, p: Platform) => !p.settleChains[chain];

/** The default naira fee as the fee helper takes it. */
export const nairaDefaults = (p: Platform) => ({ rateBps: p.fees.nairaRateBps, capKobo: Math.round(p.fees.nairaCapNgn * 100) });

/**
 * Test mode has no business limits - only the most one amount can hold
 * (₦20 million: an amount is a 32-bit count of kobo). Nothing real moves, so
 * there's nothing to protect.
 */
export const TEST_LIMITS = { minKobo: 100, maxKobo: 20_000_000 * 100 };

/** How big one checkout can be: the business's kind's limits when live, none to speak of in test. */
export function limitsFor(p: Platform, kind: BusinessKind, mode: Mode) {
  return mode === "TEST" ? TEST_LIMITS : checkoutLimits(p, kind);
}

/** How big one checkout can be for a business of this kind, in kobo. */
export function checkoutLimits(p: Platform, kind: BusinessKind) {
  const [min, max] = kind === "INDIVIDUAL" ? [p.limits.freelancerMinNgn, p.limits.freelancerMaxNgn] : [p.limits.businessMinNgn, p.limits.businessMaxNgn];
  return { minKobo: Math.round(min * 100), maxKobo: Math.round(max * 100) };
}

/** Whether a live payout this big waits for a person: naira in kobo, crypto in dollars. */
/**
 * The switches as a payment in this mode sees them. Test mode runs on the
 * simulator, so the kill switches and pauses - maintenance, payouts, ways to
 * pay, checkouts, settlement places, coins and networks - never stop it: they
 * exist to stop real money. Fees and limits still apply, so a test behaves
 * like the real thing.
 */
export function forMode(p: Platform, mode: Mode): Platform {
  if (mode !== "TEST") return p;
  const allOn = <T extends Record<string, boolean>>(o: T) => Object.fromEntries(Object.keys(o).map((k) => [k, true])) as T;
  return { ...p, maintenance: false, payouts: true, methods: allOn(p.methods), channels: allOn(p.channels), destinations: allOn(p.destinations), coins: allOn(p.coins), networks: allOn(p.networks) };
}

export const needsReview = (p: Platform, payout: { kobo: number } | { usd: number }) =>
  "kobo" in payout ? payout.kobo > Math.round(p.review.nairaAboveNgn * 100) : payout.usd > p.review.cryptoAboveUsd;
