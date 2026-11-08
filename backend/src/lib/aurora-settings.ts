import { prisma } from "./prisma";

/**
 * The console's levers for swaps and for BTC / Tron deposits.
 *
 * Stored as service_status rows, the same as the routed-deposit switches:
 * the table already exists in production, so this ships without a
 * migration, and an `au:` key is invisible to everything else that reads it.
 *
 * Every value has a default here, and a row only ever overrides it - so an
 * untouched setting behaves as shipped and the console starts out agreeing
 * with the code.
 */

/** Shown and usable · shown, named and inert · not shown at all. */
export type DepositState = "visible" | "unavailable" | "hidden";
const DEPOSIT_STATES: DepositState[] = ["visible", "unavailable", "hidden"];

export type AuroraDepositKind = "btc" | "tron" | "eth" | "bsc" | "sol" | "arb" | "pol";
/** Every network, in the order the console lists them. Bitcoin and Tron are Aurora only. */
export const AURORA_DEPOSIT_KINDS: AuroraDepositKind[] = ["btc", "tron", "eth", "bsc", "sol", "arb", "pol"];
/**
 * Which converter a network's deposits go through. Aurora: a permanent address of ours, landing as USDC in the
 * person's Solana wallet. Stableyard: the older addresses, landing as USDCx on Movement. Bitcoin and Tron are
 * always Aurora.
 */
export type DepositRail = "aurora" | "stableyard";
const DEPOSIT_RAILS: DepositRail[] = ["aurora", "stableyard"];

export type AuroraSettings = {
  deposits: Record<AuroraDepositKind, { state: DepositState; minUsd: number; rail: DepositRail }>;
  swap: {
    enabled: boolean;
    /** Our platform fee, in basis points of what is sent. 100 = 1%. */
    feeBps: number;
    /**
     * An extra flat fee, in dollars, on swaps paid from Solana. Each one sends
     * to a brand-new deposit address that needs a USDC account opened, about
     * 0.002 SOL at our expense, and this covers it.
     */
    solanaFlatUsd: number;
    /** The smallest swap, in US dollars of what is sent. */
    minUsd: number;
    /** How far the price may move before the swap refunds instead. */
    slippageBps: number;
    /** Swaps one account may start in a rolling day. Each one costs us gas. */
    perDay: number;
    /**
     * The largest single balance Sweep takes, in dollars. Its own figure, not
     * the swap minimum: lowering the minimum let Swap take smaller balances,
     * and it also quietly stopped Sweep taking anything between the two.
     */
    sweepMaxUsd: number;
    /** The largest single swap, in dollars of what is sent. Every chain and coin. */
    maxUsd: number;
    /** Who quotes and settles swaps. BTC and Tron deposits stay on Aurora either way. */
    provider: SwapProvider;
    /**
     * Swaps out of Movement USDCx, which go through our own two wallets (in on Movement, out from Base) because
     * Movement has no liquidity on NEAR Intents. Off: Movement isn't offered as a coin to swap from, and only
     * swaps NEAR Intents quotes and settles run.
     */
    movementRoute: boolean;
  };
};

export type SwapProvider = "oneclick" | "aurora";
const SWAP_PROVIDERS: SwapProvider[] = ["oneclick", "aurora"];

export const AURORA_DEFAULTS: AuroraSettings = {
  deposits: {
    // Their FAQ recommends at least $1, or $2 on Tron: below that the
    // processing costs can exceed the deposit and it sits there. Bitcoin is
    // $3, the business's call (2026-10-24): about 3,700 sats at $80k, under the
    // 5,000 their FAQ calls dust, so a payment near the floor may be slow to convert.
    btc: { state: "visible", minUsd: 3, rail: "aurora" },
    tron: { state: "visible", minUsd: 2, rail: "aurora" },
    // Moved off Stableyard (2026-11-08). Ethereum's own gas makes small deposits poor value, so it starts higher.
    eth: { state: "visible", minUsd: 5, rail: "aurora" },
    bsc: { state: "visible", minUsd: 1, rail: "aurora" },
    sol: { state: "visible", minUsd: 1, rail: "aurora" },
    arb: { state: "visible", minUsd: 1, rail: "aurora" },
    pol: { state: "visible", minUsd: 1, rail: "aurora" },
  },
  swap: {
    enabled: true,
    feeBps: 100,
    solanaFlatUsd: 0.25,
    minUsd: 5,
    slippageBps: 100,
    perDay: 20,
    sweepMaxUsd: 5,
    maxUsd: 50,
    provider: "oneclick",
    movementRoute: true,
  },
};

/** Hard limits, so a typo in the console cannot set a 90% fee or a free-for-all. */
export const LIMITS = {
  feeBps: { min: 0, max: 500 },
  solanaFlatUsd: { min: 0, max: 5 },
  minUsd: { min: 1, max: 10_000 },
  slippageBps: { min: 10, max: 500 },
  perDay: { min: 1, max: 200 },
  sweepMaxUsd: { min: 0.5, max: 50 },
  maxUsd: { min: 5, max: 10_000 },
  depositMinUsd: { min: 1, max: 1_000 },
} as const;

const KEYS = {
  depositState: (k: AuroraDepositKind) => `au:dep:${k}:state`,
  depositMin: (k: AuroraDepositKind) => `au:dep:${k}:minUsd`,
  depositRail: (k: AuroraDepositKind) => `au:dep:${k}:rail`,
  swapEnabled: "au:swap:enabled",
  swapFee: "au:swap:feeBps",
  swapSolFlat: "au:swap:solanaFlatUsd",
  swapMin: "au:swap:minUsd",
  swapSlippage: "au:swap:slippageBps",
  swapPerDay: "au:swap:perDay",
  sweepMax: "au:swap:sweepMaxUsd",
  swapMax: "au:swap:maxUsd",
  swapProvider: "au:swap:provider",
  swapMovementRoute: "au:swap:movementRoute",
};

function num(v: string | null | undefined, fallback: number, range: { min: number; max: number }): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= range.min && n <= range.max ? n : fallback;
}

let cache: { at: number; value: AuroraSettings } | null = null;

/**
 * Everything, in one query. Read on every swap quote and deposit screen, so
 * held for a few seconds - long enough to spare the database, short enough
 * that flipping a switch in the console takes effect at once.
 */
export async function auroraSettings(): Promise<AuroraSettings> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  const rows = await prisma.serviceStatus.findMany({
    where: { key: { startsWith: "au:" } },
    select: { key: true, value: true },
  });
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const d = AURORA_DEFAULTS;

  const depositOf = (k: AuroraDepositKind) => {
    const stored = v.get(KEYS.depositState(k));
    return {
      state: (DEPOSIT_STATES.includes(stored as DepositState) ? stored : d.deposits[k].state) as DepositState,
      minUsd: num(v.get(KEYS.depositMin(k)), d.deposits[k].minUsd, LIMITS.depositMinUsd),
      // Bitcoin and Tron never go back to Stableyard.
      rail: (k === "btc" || k === "tron" ? "aurora" : DEPOSIT_RAILS.includes(v.get(KEYS.depositRail(k)) as DepositRail) ? v.get(KEYS.depositRail(k)) : d.deposits[k].rail) as DepositRail,
    };
  };

  const enabledRaw = v.get(KEYS.swapEnabled);
  const value: AuroraSettings = {
    deposits: Object.fromEntries(AURORA_DEPOSIT_KINDS.map((k) => [k, depositOf(k)])) as AuroraSettings["deposits"],
    swap: {
      enabled: enabledRaw === "true" ? true : enabledRaw === "false" ? false : d.swap.enabled,
      feeBps: num(v.get(KEYS.swapFee), d.swap.feeBps, LIMITS.feeBps),
      solanaFlatUsd: num(v.get(KEYS.swapSolFlat), d.swap.solanaFlatUsd, LIMITS.solanaFlatUsd),
      minUsd: num(v.get(KEYS.swapMin), d.swap.minUsd, LIMITS.minUsd),
      slippageBps: num(v.get(KEYS.swapSlippage), d.swap.slippageBps, LIMITS.slippageBps),
      perDay: num(v.get(KEYS.swapPerDay), d.swap.perDay, LIMITS.perDay),
      sweepMaxUsd: num(v.get(KEYS.sweepMax), d.swap.sweepMaxUsd, LIMITS.sweepMaxUsd),
      maxUsd: num(v.get(KEYS.swapMax), d.swap.maxUsd, LIMITS.maxUsd),
      provider: SWAP_PROVIDERS.includes(v.get(KEYS.swapProvider) as SwapProvider)
        ? (v.get(KEYS.swapProvider) as SwapProvider)
        : d.swap.provider,
      movementRoute: v.get(KEYS.swapMovementRoute) === "false" ? false : v.get(KEYS.swapMovementRoute) === "true" ? true : d.swap.movementRoute,
    },
  };
  cache = { at: Date.now(), value };
  return value;
}

async function put(key: string, value: string, updatedBy?: string) {
  await prisma.serviceStatus.upsert({
    where: { key },
    create: { key, value, updatedBy },
    update: { value, updatedBy },
  });
}

function inRange(name: string, n: unknown, range: { min: number; max: number }): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < range.min || v > range.max) {
    throw new Error(`${name} must be between ${range.min} and ${range.max}`);
  }
  return v;
}

/**
 * Apply a partial change from the console. Validated as a whole before
 * anything is written, so a bad field refuses the request instead of
 * leaving half of it applied.
 */
export async function updateAuroraSettings(
  patch: {
    deposits?: Partial<Record<AuroraDepositKind, { state?: string; minUsd?: number; rail?: string }>>;
    swap?: Partial<AuroraSettings["swap"]>;
  },
  updatedBy?: string,
): Promise<AuroraSettings> {
  const writes: [string, string][] = [];

  for (const k of AURORA_DEPOSIT_KINDS) {
    const p = patch.deposits?.[k];
    if (!p) continue;
    if (p.rail !== undefined) {
      if (!DEPOSIT_RAILS.includes(p.rail as DepositRail)) throw new Error("rail must be aurora or stableyard");
      if ((k === "btc" || k === "tron") && p.rail !== "aurora") throw new Error("Bitcoin and Tron deposits are Aurora only");
      writes.push([KEYS.depositRail(k), p.rail]);
    }
    if (p.state !== undefined) {
      if (!DEPOSIT_STATES.includes(p.state as DepositState)) throw new Error("state must be visible, unavailable or hidden");
      writes.push([KEYS.depositState(k), p.state]);
    }
    if (p.minUsd !== undefined) writes.push([KEYS.depositMin(k), String(inRange("Deposit minimum", p.minUsd, LIMITS.depositMinUsd))]);
  }

  const s = patch.swap;
  if (s) {
    if (s.enabled !== undefined) {
      if (typeof s.enabled !== "boolean") throw new Error("enabled must be true or false");
      writes.push([KEYS.swapEnabled, String(s.enabled)]);
    }
    if (s.movementRoute !== undefined) {
      if (typeof s.movementRoute !== "boolean") throw new Error("movementRoute must be true or false");
      writes.push([KEYS.swapMovementRoute, String(s.movementRoute)]);
    }
    if (s.feeBps !== undefined) writes.push([KEYS.swapFee, String(Math.round(inRange("Fee", s.feeBps, LIMITS.feeBps)))]);
    if (s.solanaFlatUsd !== undefined) writes.push([KEYS.swapSolFlat, String(inRange("Solana fee", s.solanaFlatUsd, LIMITS.solanaFlatUsd))]);
    if (s.minUsd !== undefined) writes.push([KEYS.swapMin, String(inRange("Minimum swap", s.minUsd, LIMITS.minUsd))]);
    if (s.slippageBps !== undefined) writes.push([KEYS.swapSlippage, String(Math.round(inRange("Slippage", s.slippageBps, LIMITS.slippageBps)))]);
    if (s.perDay !== undefined) writes.push([KEYS.swapPerDay, String(Math.round(inRange("Swaps per day", s.perDay, LIMITS.perDay)))]);
    if (s.sweepMaxUsd !== undefined) writes.push([KEYS.sweepMax, String(inRange("Largest sweep balance", s.sweepMaxUsd, LIMITS.sweepMaxUsd))]);
    if (s.maxUsd !== undefined) writes.push([KEYS.swapMax, String(inRange("Largest swap", s.maxUsd, LIMITS.maxUsd))]);
    if (s.provider !== undefined) {
      if (!SWAP_PROVIDERS.includes(s.provider)) throw new Error("provider must be oneclick or aurora");
      writes.push([KEYS.swapProvider, s.provider]);
    }
  }

  for (const [key, value] of writes) await put(key, value, updatedBy);
  cache = null;
  return auroraSettings();
}
