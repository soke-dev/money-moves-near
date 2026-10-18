/**
 * The networks customers pay on, as the payment side reads them and the
 * sending side (sweeps, money given back) writes to them: each chain's coins
 * and contracts, where our treasury is, and how a payment there is told apart.
 */
import type { DepositKind } from "@prisma/client";
import { env } from "../config/env";
import { depositKeysReady } from "./deposit-keys";
import { stellarReceiveAddress } from "./stellar";
import { tonReceiveAddress } from "./ton";
import type { Coin, Network } from "./accept";

export type Token = { address: string; decimals: number };
export type EvmChain = {
  network: Network;
  chainId: number;
  url: () => string | undefined;
  tokens: Partial<Record<Coin, Token>>;
  /** A second contract a coin also lives at - Optimism's USDT, bridged and USD₮0 both in use. Either counts. */
  extra?: { coin: Coin; token: Token }[];
  /** A coin that is the chain's own currency (Arc's USDC): plain value transfers count, and it pays its own fees. */
  native?: { coin: Coin; decimals: number };
  /** The coin fees are paid in, by name - for the admin console. */
  gas: string;
  /** Blocks behind the tip before a transfer counts. */
  confirmations: number;
  /** How far back the checkout's own look goes, in blocks. */
  watch: number;
  /** Seconds a block takes, roughly - to start reading from about when the oldest open payment began. */
  blockSeconds: number;
};

/** The EVM networks, their coins (the app's own catalogue, checked against the contracts) and how final is final. */
export const EVM_CHAINS: EvmChain[] = [
  { network: "Monad", chainId: 143, gas: "MON", blockSeconds: 0.4, url: () => env.MONAD_RPC_URL, confirmations: 4, watch: 10, tokens: { USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 }, USDT: { address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 } } },
  { network: "Base", chainId: 8453, gas: "ETH", blockSeconds: 2, url: () => env.BASE_RPC_URL, confirmations: 3, watch: 10, tokens: { USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }, USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 } } },
  { network: "BNB Chain", chainId: 56, gas: "BNB", blockSeconds: 0.75, url: () => env.BSC_RPC_URL, confirmations: 5, watch: 10, tokens: { USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 }, USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 } } },
  { network: "Arbitrum", chainId: 42161, gas: "ETH", blockSeconds: 0.25, url: () => env.ARB_RPC_URL, confirmations: 10, watch: 10, tokens: { USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 }, USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 } } },
  {
    network: "Optimism",
    chainId: 10,
    gas: "ETH",
    blockSeconds: 2,
    url: () => env.OPTIMISM_RPC_URL,
    confirmations: 3,
    watch: 10,
    tokens: { USDC: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 }, USDT: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 } },
    extra: [{ coin: "USDT", token: { address: "0x01bFF41798a0BcF287b996046Ca68b395DbC1071", decimals: 6 } }],
  },
  { network: "Ethereum", chainId: 1, gas: "ETH", blockSeconds: 12, url: () => env.ETHEREUM_RPC_URL, confirmations: 3, watch: 10, tokens: { USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 }, USDT: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 } } },
  { network: "Arc", chainId: 5042, gas: "USDC", blockSeconds: 0.5, url: () => env.ARC_RPC_URL, confirmations: 3, watch: 10, tokens: { USDC: { address: "0x3600000000000000000000000000000000000000", decimals: 6 } }, native: { coin: "USDC", decimals: 18 } },
];
export const evmChain = (n: string) => EVM_CHAINS.find((c) => c.network === n);
/** Every contract a chain's coins live at, each with its coin. */
export const contractsOf = (c: EvmChain): ({ coin: Coin } & Token)[] => [
  ...(Object.entries(c.tokens) as [Coin, Token][]).map(([coin, t]) => ({ coin, ...t })),
  ...(c.extra ?? []).map((e) => ({ coin: e.coin, ...e.token })),
];

export const SOL_MINTS: Partial<Record<Coin, string>> = { USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" };
export const MOVE_ASSETS: Partial<Record<Coin, string>> = {
  USDC: "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e", // USDCx
  USDT: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d",
};
export const MOVE_INDEXER = () => env.MOVEMENT_INDEXER_URL ?? "https://indexer.mainnet.movementnetwork.xyz/v1/graphql";

/**
 * Where a payment gets an address of its own, swept to the treasury once paid.
 * Not Ethereum: a sweep there costs more than a small payment is worth, so it
 * keeps the exact amount on the treasury. Stellar and TON use a memo instead.
 */
export const OWN_NETWORKS: readonly Network[] = ["Monad", "Base", "BNB Chain", "Arbitrum", "Optimism", "Arc", "Solana", "Movement"];
export const MEMO_NETWORKS: readonly Network[] = ["Stellar", "TON"];

/** How a new payment on this network is told apart. */
export function kindFor(network: Network): DepositKind {
  if (MEMO_NETWORKS.includes(network)) return "MEMO";
  if (OWN_NETWORKS.includes(network) && depositKeysReady()) return "OWN";
  return "AMOUNT";
}

/** Our treasury on a network: where AMOUNT and MEMO payments are sent, and own addresses are swept to. */
export function treasuryFor(network: string): string | null {
  if (network === "Solana") return env.TREASURY_SOLANA_ADDRESS ?? null;
  if (network === "Movement") return env.TREASURY_MOVEMENT_ADDRESS ?? null;
  if (network === "Stellar") return stellarReceiveAddress();
  if (network === "TON") return tonReceiveAddress();
  return evmChain(network) ? (env.TREASURY_EVM_ADDRESS ?? null) : null;
}

export const toMicros = (raw: bigint, decimals: number) => (decimals >= 6 ? raw / 10n ** BigInt(decimals - 6) : raw * 10n ** BigInt(6 - decimals));
export const fromMicros = (micros: bigint, decimals: number) => (decimals >= 6 ? micros * 10n ** BigInt(decimals - 6) : micros / 10n ** BigInt(6 - decimals));
export const sameHex = (a: string, b: string) => {
  const n = (x: string) => x.toLowerCase().replace(/^0x/, "").replace(/^0+/, "");
  return n(a) === n(b);
};
export const hexNum = (h: string) => Number.parseInt(h, 16);
export const toHex = (n: number) => `0x${n.toString(16)}`;
/** An address as it's compared: EVM and Movement hex lower-cased, everything else as it is. */
export const addressKey = (network: string, a: string) => (evmChain(network) || network === "Movement" ? a.toLowerCase() : a);

export async function rpc<T = any>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${r.status}`);
  return j.result as T;
}
