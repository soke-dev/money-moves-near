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
import type { BusinessKind, Mode, PayMethod, Prisma, SettleChain } from "@prisma/client";
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
  /**
   * How the account representative proves who they are. Off: the identity
   * partner checks it on its own page. On: they send ID photos, a selfie and a
   * smile video, and our team approves them in the console. Only new checks
   * follow a change; ones under way finish the way they began. nin, passport
   * and licence: which IDs a manual check accepts - at least one.
   */
  identity: z.object({ manual: on, nin: on, passport: on, licence: on }).refine((i) => i.nin || i.passport || i.licence, "Accept at least one kind of ID."),
  destinations: z.object({ bank: on, moneyMoves: on, wallet: on }),
  /**
   * Movement is the default: a business on another chain switched off is moved to it. Movement itself
   * can be switched off too - its settlements then wait in the queue until it's back on, or the team sends them.
   */
  settleChains: z.object({ MOVEMENT: on, ARC: on, MONAD: on, SOLANA: on, STELLAR: on }),
  coins: z.object({ USDC: on, USDT: on }),
  /**
   * Paying with another coin (BTC, ETH, SOL and more), swapped to USDC by NEAR Intents. on: offered at
   * live checkouts. feeBps: our own fee, taken inside the swap, on top of the usual stablecoin fee
   * (0 by default). intentCoins: each coin by key; a missing key is on.
   * stablecoins: USDC and USDT payments go through NEAR Intents too, where it
   * takes that coin and network; anywhere it can't, the default way. Off, the
   * default: stablecoins come straight to our own addresses.
   */
  intents: z.object({ on, feeBps: z.number().int().min(0).max(300), stablecoins: on }),
  intentCoins: z.record(z.string().max(20), on),
  networks: z.object(Object.fromEntries(NETWORKS.map((n) => [n, on])) as Record<(typeof NETWORKS)[number], typeof on>),
  fees: z.object({
    nairaRateBps: z.number().int().min(0).max(1000),
    nairaCapNgn: z.number().min(0).max(100_000),
    cryptoRateBps: z.number().int().min(0).max(1000),
    cryptoCapUsd: z.number().min(0).max(1000),
    appRateBps: z.number().int().min(0).max(1000),
    payoutNgn: z.number().min(0).max(10_000),
  }),
  /**
   * The least and the most one checkout can be, per way to pay: for a
   * registered business, and for someone working for themselves. The plain
   * four are bank transfer; crypto* and app* are stablecoins and the Money
   * Moves app. At most ₦20 million: an amount is a 32-bit count of kobo.
   */
  limits: z
    .object({
      businessMinNgn: z.number().min(1).max(1_000_000),
      businessMaxNgn: z.number().min(1_000).max(20_000_000),
      freelancerMinNgn: z.number().min(1).max(1_000_000),
      freelancerMaxNgn: z.number().min(1_000).max(20_000_000),
      cryptoBusinessMinNgn: z.number().min(1).max(1_000_000),
      cryptoBusinessMaxNgn: z.number().min(1_000).max(20_000_000),
      cryptoFreelancerMinNgn: z.number().min(1).max(1_000_000),
      cryptoFreelancerMaxNgn: z.number().min(1_000).max(20_000_000),
      appBusinessMinNgn: z.number().min(1).max(1_000_000),
      appBusinessMaxNgn: z.number().min(1_000).max(20_000_000),
      appFreelancerMinNgn: z.number().min(1).max(1_000_000),
      appFreelancerMaxNgn: z.number().min(1_000).max(20_000_000),
    })
    .refine(
      (l) => (["", "crypto", "app"] as const).every((m) => (["business", "freelancer"] as const).every((k) => limitPair(l, m, k).minNgn < limitPair(l, m, k).maxNgn)),
      "The least a checkout can be has to be under the most.",
    ),
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
  identity: { manual: false, nin: true, passport: true, licence: true },
  destinations: { bank: true, moneyMoves: true, wallet: true },
  settleChains: { MOVEMENT: true, ARC: true, MONAD: true, SOLANA: true, STELLAR: true },
  coins: { USDC: true, USDT: true },
  intents: { on: false, feeBps: 0, stablecoins: false },
  intentCoins: {},
  networks: Object.fromEntries(NETWORKS.map((n) => [n, true])) as Platform["networks"],
  fees: { nairaRateBps: 200, nairaCapNgn: 4_000, cryptoRateBps: 30, cryptoCapUsd: 1, appRateBps: 0, payoutNgn: 100 },
  limits: {
    businessMinNgn: 100, businessMaxNgn: 1_000_000, freelancerMinNgn: 100, freelancerMaxNgn: 500_000,
    cryptoBusinessMinNgn: 100, cryptoBusinessMaxNgn: 1_000_000, cryptoFreelancerMinNgn: 100, cryptoFreelancerMaxNgn: 500_000,
    appBusinessMinNgn: 100, appBusinessMaxNgn: 1_000_000, appFreelancerMinNgn: 100, appFreelancerMaxNgn: 500_000,
  },
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
  // Limits saved before each way to pay had its own: crypto and the app start where bank transfer was.
  const sl = (s.limits && typeof s.limits === "object" ? s.limits : {}) as Record<string, unknown>;
  const ml = merged.limits as Record<string, unknown>;
  for (const m of ["crypto", "app"])
    for (const f of ["BusinessMinNgn", "BusinessMaxNgn", "FreelancerMinNgn", "FreelancerMaxNgn"]) {
      const plain = f[0].toLowerCase() + f.slice(1);
      if (sl[m + f] === undefined && sl[plain] !== undefined) ml[m + f] = sl[plain];
    }
  // A most saved before the ₦20 million ceiling comes down to it, rather than failing every setting.
  for (const [k, v] of Object.entries(ml)) if (k.endsWith("MaxNgn") && typeof v === "number" && v > 20_000_000) ml[k] = 20_000_000;
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
export const cryptoDefaults = (p: Platform) => ({ rateBps: p.fees.cryptoRateBps, capCents: Math.round(p.fees.cryptoCapUsd * 100) });

/**
 * Test mode has no business limits - only the most one amount can hold
 * (₦20 million: an amount is a 32-bit count of kobo). Nothing real moves, so
 * there's nothing to protect.
 */
export const TEST_LIMITS = { minKobo: 100, maxKobo: 20_000_000 * 100 };

/** The ways to pay, as the limits name them. */
export const WAYS = ["naira", "crypto", "app"] as const;
export type Way = (typeof WAYS)[number];
export const WAY_OF: Record<PayMethod, Way> = { NAIRA: "naira", CRYPTO: "crypto", APP: "app" };
const WAY_NAME: Record<Way, string> = { naira: "Paying by bank transfer", crypto: "Paying with stablecoins", app: "Paying with the Money Moves app" };

/** One way to pay's least and most for one kind, out of the flat platform limits. */
function limitPair(l: Record<string, number>, m: "" | "crypto" | "app", k: "business" | "freelancer") {
  const key = (s: string) => (m ? m + k[0].toUpperCase() + k.slice(1) + s : k + s);
  return { minNgn: l[key("MinNgn")], maxNgn: l[key("MaxNgn")] };
}

const ownPair = z.object({ minNgn: z.number().int().min(1).max(1_000_000).nullish(), maxNgn: z.number().int().min(1_000).max(20_000_000).nullish() });
/** A business's own least and most per way to pay, as the admin console sets them. Any of them may be missing. */
export const ownCheckoutSchema = z.object({ naira: ownPair, crypto: ownPair, app: ownPair }).partial();
export type OwnCheckout = z.infer<typeof ownCheckoutSchema>;
export const ownCheckoutOf = (v: unknown): OwnCheckout => {
  const r = ownCheckoutSchema.safeParse(v ?? {});
  return r.success ? r.data : {};
};

/** What a business can have set for itself on the admin console, over the platform's. */
export type OwnLimits = {
  kind: BusinessKind;
  ownCheckout?: Prisma.JsonValue | null;
  reviewNairaAboveNgn?: number | null;
  reviewCryptoAboveUsd?: number | null;
};

/** The platform's least and most for a business of this kind paying this way, in naira. */
export function kindLimitsNgn(p: Platform, kind: BusinessKind, way: Way) {
  return limitPair(p.limits as unknown as Record<string, number>, way === "naira" ? "" : way, kind === "INDIVIDUAL" ? "freelancer" : "business");
}

/**
 * How big one checkout paid this way can be for this business, in kobo: its
 * own least and most where our team set them, else its kind's. An own least
 * that ends up at or over the most (the platform's most lowered after it was
 * set) is ignored.
 */
export function wayLimits(p: Platform, b: OwnLimits, way: Way) {
  const d = kindLimitsNgn(p, b.kind, way);
  const own = ownCheckoutOf(b.ownCheckout)[way];
  const max = Math.min(own?.maxNgn ?? d.maxNgn, TEST_LIMITS.maxKobo / 100);
  let min = own?.minNgn ?? d.minNgn;
  if (min >= max) min = Math.min(d.minNgn, max - 1);
  return { minKobo: Math.round(min * 100), maxKobo: Math.round(max * 100), how: WAY_NAME[way] };
}

/**
 * How big one checkout can be. Paid a given way: that way's limits. Not yet
 * (making a link or an invoice, or the amount box before a way is picked):
 * the widest of them, and the way is checked when the payment starts. Test
 * mode has none to speak of.
 */
export function limitsFor(p: Platform, b: OwnLimits, mode: Mode, way?: Way | PayMethod): { minKobo: number; maxKobo: number; how?: string } {
  if (mode === "TEST") return TEST_LIMITS;
  if (way) return wayLimits(p, b, way in WAY_OF ? WAY_OF[way as PayMethod] : (way as Way));
  const all = WAYS.map((w) => wayLimits(p, b, w));
  return { minKobo: Math.min(...all.map((x) => x.minKobo)), maxKobo: Math.max(...all.map((x) => x.maxKobo)) };
}

/** Above these, a live payout waits for a person: the business's own, else the platform's. */
export function reviewLimits(p: Platform, b: OwnLimits) {
  return { nairaAboveNgn: b.reviewNairaAboveNgn ?? p.review.nairaAboveNgn, cryptoAboveUsd: b.reviewCryptoAboveUsd ?? p.review.cryptoAboveUsd };
}

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

/** Whether a live payout this big waits for a person: naira in kobo, crypto in dollars, against this business's limits. */
export const needsReview = (p: Platform, b: OwnLimits, payout: { kobo: number } | { usd: number }) => {
  const r = reviewLimits(p, b);
  return "kobo" in payout ? payout.kobo > Math.round(r.nairaAboveNgn * 100) : payout.usd > r.cryptoAboveUsd;
};
