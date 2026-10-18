/**
 * Which coins, on which networks, a checkout takes from a crypto wallet.
 *
 * Each link, invoice and outlet keeps its own pick (`accept`); none kept means
 * every pair that's switched on. Whatever is kept, the checkout only ever
 * offers pairs the platform has on (Services: coins and networks) and that the
 * coin actually exists on - USDT has no Arc, USDC no TON.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { NETWORKS, type Platform } from "./platform";
import { HttpError } from "./http";
import { env } from "../config/env";
import { stellarWhy } from "./stellar";
import { tonWhy } from "./ton";

export const COINS = ["USDC", "USDT"] as const;
export type Coin = (typeof COINS)[number];
export type Network = (typeof NETWORKS)[number];
export type Accept = Partial<Record<Coin, Network[]>>;

/** Where each coin lives - the app's own catalogue. */
export const COIN_NETWORKS: Record<Coin, readonly Network[]> = {
  USDC: ["Movement", "Monad", "Arc", "Solana", "Stellar", "Base", "BNB Chain", "Arbitrum", "Optimism", "Ethereum"],
  USDT: ["Movement", "Monad", "Solana", "Stellar", "Base", "BNB Chain", "TON", "Arbitrum", "Optimism", "Ethereum"],
};

export const acceptSchema = z
  .record(z.enum(COINS), z.array(z.enum(NETWORKS)).max(NETWORKS.length))
  .nullable()
  .optional();

/** A pick worth keeping: only real pairs, nothing empty. Null when it leaves nothing. */
export function cleanAccept(a: Accept | null | undefined): Accept | null {
  if (!a) return null;
  const out: Accept = {};
  for (const coin of COINS) {
    const nets = [...new Set(a[coin] ?? [])].filter((n) => COIN_NETWORKS[coin].includes(n));
    if (nets.length) out[coin] = nets;
  }
  return Object.keys(out).length ? out : null;
}

/** The networks live payments can be paid on - where we have a treasury and can read what arrives. */
export const LIVE_NETWORKS: readonly Network[] = ["Movement", "Monad", "Arc", "Solana", "Stellar", "Base", "BNB Chain", "TON", "Arbitrum", "Optimism", "Ethereum"];

/** What each live network needs set before it opens - a way to read it, and our treasury on it - by variable name. */
const NEEDS: Partial<Record<Network, () => [string, string | undefined][]>> = {
  Movement: () => [["MOVEMENT_RPC_URL", env.MOVEMENT_RPC_URL], ["TREASURY_MOVEMENT_ADDRESS", env.TREASURY_MOVEMENT_ADDRESS]],
  Solana: () => [["SOLANA_RPC_URL", env.SOLANA_RPC_URL], ["TREASURY_SOLANA_ADDRESS", env.TREASURY_SOLANA_ADDRESS]],
  Monad: () => [["MONAD_RPC_URL", env.MONAD_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  Arc: () => [["ARC_RPC_URL", env.ARC_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  Base: () => [["BASE_RPC_URL", env.BASE_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  "BNB Chain": () => [["BSC_RPC_URL", env.BSC_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  Arbitrum: () => [["ARB_RPC_URL", env.ARB_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  Optimism: () => [["OPTIMISM_RPC_URL", env.OPTIMISM_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
  Ethereum: () => [["ETHEREUM_RPC_URL", env.ETHEREUM_RPC_URL], ["TREASURY_EVM_ADDRESS", env.TREASURY_EVM_ADDRESS]],
};

/** Why a network can't take live payments yet, in the admin console's words - or null when it can. */
export function notLiveWhy(n: Network): string | null {
  // Stellar and TON are read from the network itself: the account open, its trustlines, the indexer answering.
  if (n === "Stellar") return stellarWhy();
  if (n === "TON") return tonWhy();
  const needs = NEEDS[n];
  if (!LIVE_NETWORKS.includes(n) || !needs) return "Live payments on this network aren't built yet.";
  const missing = needs().filter(([, v]) => !v).map(([k]) => k);
  return missing.length ? `Needs ${missing.join(" and ")} set.` : null;
}
/** A network live payments can use right now. */
export const liveReady = (n: Network) => notLiveWhy(n) === null;
/** A coin on a network live payments can use right now - Stellar needs our account to trust that coin. */
export const coinLiveReady = (coin: Coin, n: Network) => liveReady(n) && (n !== "Stellar" || stellarWhy(coin) === null);

export function offeredAccept(stored: Prisma.JsonValue | null | undefined, p: Platform, mode: "TEST" | "LIVE" = "TEST"): Accept {
  const out = offeredAcceptAll(stored, p);
  if (mode === "TEST") return out;
  const live: Accept = {};
  for (const coin of COINS) {
    const nets = (out[coin] ?? []).filter((n) => coinLiveReady(coin, n));
    if (nets.length) live[coin] = nets;
  }
  return live;
}

function offeredAcceptAll(stored: Prisma.JsonValue | null | undefined, p: Platform): Accept {
  const pick = cleanAccept((stored as Accept | null) ?? null);
  const out: Accept = {};
  for (const coin of COINS) {
    if (!p.coins[coin]) continue;
    const nets = (pick ? (pick[coin] ?? []) : COIN_NETWORKS[coin]).filter((n) => p.networks[n]);
    if (nets.length) out[coin] = [...nets];
  }
  return out;
}

export const offersCrypto = (a: Accept) => Object.values(a).some((n) => (n?.length ?? 0) > 0);

/** The pick to save with a checkout - only when it takes crypto, and never one that leaves nothing to pay with. */
export function acceptToSave(methods: string[], a: Accept | null | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!methods.includes("CRYPTO") || a == null) return Prisma.DbNull;
  const clean = cleanAccept(a);
  if (!clean) throw new HttpError(400, "Pick at least one coin and network for crypto, or turn crypto off.", "no_coins");
  return clean as Prisma.InputJsonValue;
}
