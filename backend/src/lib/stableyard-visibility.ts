import { prisma } from "./prisma";
import { SY_ROUTED_ASSETS, type RoutedAsset } from "./stableyard";

/**
 * What the app does with each routed asset, flipped from the console.
 *
 * Three states, not two. Hiding something and turning it off are different
 * answers to different questions: hidden is "this is not a thing we do", and
 * unavailable is "this is a thing we do and it is not working right now". A
 * token that simply vanishes from the list leaves somebody who used it last
 * week wondering whether they imagined it, or whether their money is stuck.
 *
 * Stored as rows in service_status rather than a table of their own. That is
 * not laziness: the table already exists in production, so this ships without
 * a migration, and an unknown key there is ignored by everything else that
 * reads it - pauseGuard looks its key up in a fixed registry and /api/status
 * filters to the services it knows. A `sy:` row is invisible to all of it.
 *
 * The catalogue in stableyard.ts remains the default. A row only ever
 * overrides it, so an asset nobody has touched behaves as shipped and the
 * console starts out agreeing with the code.
 */

/** Shown and usable · shown, named and inert · not shown at all. */
export type RoutedState = "visible" | "unavailable" | "hidden";

const KEY = (chainId: number, symbol: string) => `sy:${chainId}:${symbol}`;

const STATES: RoutedState[] = ["visible", "unavailable", "hidden"];
const isState = (v: unknown): v is RoutedState => STATES.includes(v as RoutedState);

export type RoutedAssetState = RoutedAsset & {
  state: RoutedState;
  /** True when an admin has set this, rather than it following the catalogue. */
  overridden: boolean;
};

/**
 * Every routed asset with its effective state.
 *
 * One query for all of them - this is read on every deposit screen, and a
 * round trip per asset would be fourteen.
 */
export async function routedAssetStates(): Promise<RoutedAssetState[]> {
  const rows = await prisma.serviceStatus.findMany({
    where: { key: { startsWith: "sy:" } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  return SY_ROUTED_ASSETS.map((a) => {
    const stored = byKey.get(KEY(a.chainId, a.symbol));
    /**
     * Rows written before there were three states say "visible" or "hidden",
     * which are still the words for two of them - so nothing needs migrating.
     * Anything unrecognised falls back to the catalogue rather than guessing.
     */
    const state: RoutedState = isState(stored) ? stored : a.visible ? "visible" : "hidden";
    return {
      ...a,
      state,
      visible: state === "visible",
      overridden: isState(stored),
    };
  });
}

/** Everything the app draws: the usable ones and the ones named as off. */
export async function offeredRoutedAssetStates(): Promise<RoutedAssetState[]> {
  return (await routedAssetStates()).filter((a) => a.state !== "hidden");
}

/**
 * Set one.
 *
 * Upserted rather than deleted when it matches the catalogue again, so the
 * console can always show whether a human decided this or it is simply the
 * default.
 */
export async function setRoutedAssetState(
  chainId: number,
  symbol: string,
  state: RoutedState,
  updatedBy?: string,
): Promise<void> {
  const known = SY_ROUTED_ASSETS.some((a) => a.chainId === chainId && a.symbol === symbol);
  if (!known) throw new Error(`${symbol} on ${chainId} is not a routed asset`);
  if (!isState(state)) throw new Error(`${state} is not a routed state`);

  const key = KEY(chainId, symbol);
  await prisma.serviceStatus.upsert({
    where: { key },
    create: { key, value: state, updatedBy },
    update: { value: state, updatedBy },
  });
}

/**
 * Everything at once.
 *
 * The lever to reach for when the provider is having a bad day: one write per
 * asset inside a single transaction, so the app never reads a half-applied
 * state where three chains are off and the rest are not.
 */
export async function setAllRoutedAssetStates(
  state: RoutedState,
  updatedBy?: string,
): Promise<number> {
  if (!isState(state)) throw new Error(`${state} is not a routed state`);
  await prisma.$transaction(
    SY_ROUTED_ASSETS.map((a) => {
      const key = KEY(a.chainId, a.symbol);
      return prisma.serviceStatus.upsert({
        where: { key },
        create: { key, value: state, updatedBy },
        update: { value: state, updatedBy },
      });
    }),
  );
  return SY_ROUTED_ASSETS.length;
}

/**
 * The chains we need an address on.
 *
 * Anything not hidden, including the unavailable ones. They are meant to come
 * back, and holding the address means flipping one on is instant rather than
 * five provider calls deep - which is the difference between fixing an outage
 * and waiting out another one.
 */
export async function chainsInUse(): Promise<number[]> {
  const states = await routedAssetStates();
  return [...new Set(states.filter((a) => a.state !== "hidden").map((a) => a.chainId))];
}
