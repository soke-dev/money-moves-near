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

export type AuroraDepositKind = "btc" | "tron";

export type AuroraSettings = {
  deposits: Record<AuroraDepositKind, { state: DepositState; minUsd: number }>;
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
  };
};

export const AURORA_DEFAULTS: AuroraSettings = {
  deposits: {
    // Their FAQ recommends at least $1, or $2 on Tron: below that the
    // processing costs can exceed the deposit and it sits there. A little
    // headroom on Bitcoin, whose price can move between sending and arriving.
    btc: { state: "visible", minUsd: 2 },
    tron: { state: "visible", minUsd: 2 },
  },
  swap: { enabled: true, feeBps: 100, solanaFlatUsd: 0.25, minUsd: 5, slippageBps: 100, perDay: 20 },
};

/** Hard limits, so a typo in the console cannot set a 90% fee or a free-for-all. */
export const LIMITS = {
  feeBps: { min: 0, max: 500 },
  solanaFlatUsd: { min: 0, max: 5 },
  minUsd: { min: 1, max: 10_000 },
  slippageBps: { min: 10, max: 500 },
  perDay: { min: 1, max: 200 },
  depositMinUsd: { min: 1, max: 1_000 },
} as const;

const KEYS = {
  depositState: (k: AuroraDepositKind) => `au:dep:${k}:state`,
  depositMin: (k: AuroraDepositKind) => `au:dep:${k}:minUsd`,
  swapEnabled: "au:swap:enabled",
  swapFee: "au:swap:feeBps",
  swapSolFlat: "au:swap:solanaFlatUsd",
  swapMin: "au:swap:minUsd",
  swapSlippage: "au:swap:slippageBps",
  swapPerDay: "au:swap:perDay",
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
    };
  };

  const enabledRaw = v.get(KEYS.swapEnabled);
  const value: AuroraSettings = {
    deposits: { btc: depositOf("btc"), tron: depositOf("tron") },
    swap: {
      enabled: enabledRaw === "true" ? true : enabledRaw === "false" ? false : d.swap.enabled,
      feeBps: num(v.get(KEYS.swapFee), d.swap.feeBps, LIMITS.feeBps),
      solanaFlatUsd: num(v.get(KEYS.swapSolFlat), d.swap.solanaFlatUsd, LIMITS.solanaFlatUsd),
      minUsd: num(v.get(KEYS.swapMin), d.swap.minUsd, LIMITS.minUsd),
      slippageBps: num(v.get(KEYS.swapSlippage), d.swap.slippageBps, LIMITS.slippageBps),
      perDay: num(v.get(KEYS.swapPerDay), d.swap.perDay, LIMITS.perDay),
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
    deposits?: Partial<Record<AuroraDepositKind, { state?: string; minUsd?: number }>>;
    swap?: Partial<AuroraSettings["swap"]>;
  },
  updatedBy?: string,
): Promise<AuroraSettings> {
  const writes: [string, string][] = [];

  for (const k of ["btc", "tron"] as AuroraDepositKind[]) {
    const p = patch.deposits?.[k];
    if (!p) continue;
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
    if (s.feeBps !== undefined) writes.push([KEYS.swapFee, String(Math.round(inRange("Fee", s.feeBps, LIMITS.feeBps)))]);
    if (s.solanaFlatUsd !== undefined) writes.push([KEYS.swapSolFlat, String(inRange("Solana fee", s.solanaFlatUsd, LIMITS.solanaFlatUsd))]);
    if (s.minUsd !== undefined) writes.push([KEYS.swapMin, String(inRange("Minimum swap", s.minUsd, LIMITS.minUsd))]);
    if (s.slippageBps !== undefined) writes.push([KEYS.swapSlippage, String(Math.round(inRange("Slippage", s.slippageBps, LIMITS.slippageBps)))]);
    if (s.perDay !== undefined) writes.push([KEYS.swapPerDay, String(Math.round(inRange("Swaps per day", s.perDay, LIMITS.perDay)))]);
  }

  for (const [key, value] of writes) await put(key, value, updatedBy);
  cache = null;
  return auroraSettings();
}
