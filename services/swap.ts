import { api } from "./api";

/**
 * Swap between chains, into your own wallet.
 *
 * Not to be confused with services/sweep.ts, which gathers scattered
 * stablecoins into USDCx on Movement. This one takes a coin on one chain and
 * delivers another coin on another chain, both ends being the person's own
 * wallet.
 *
 * The server decides everything that matters - fee, minimum, which coins -
 * and re-checks it at every step. What this file shows is only ever a
 * preview of that.
 */

export type SwapChain = "SOL" | "BASE" | "BEP20" | "MONAD" | "TON" | "MOVE";

export interface SwapAsset {
  /** "SOL:USDC" - the id the server knows it by. */
  id: string;
  chain: SwapChain;
  /** Our asset key, for balances and logos. Monad's USDT0 is "USDT". */
  asset: "USDC" | "USDT" | "SOL" | "USDCx";
  /** What to print. */
  symbol: string;
  from: boolean;
  to: boolean;
  price: number;
  decimals: number;
}

export interface SwapConfig {
  enabled: boolean;
  feeBps: number;
  /** Extra flat fee, in dollars, on swaps paid from Solana. */
  solanaFlatUsd?: number;
  minUsd: number;
  /** The largest single swap, in dollars. */
  maxUsd?: number;
  slippageBps: number;
  assets: SwapAsset[];
  /** A line to show when something on the route is slow. */
  notice: string | null;
}

export interface SwapQuote {
  from: string;
  to: string;
  amount: number;
  fee: number;
  feeBps: number;
  /** The flat part of `fee`, in the coin sent. Zero off Solana. */
  feeFlat?: number;
  net: number;
  amountOut: number;
  minAmountOut: number;
  amountOutUsd: number | null;
  rate: number;
  /** Seconds. */
  timeEstimate: number;
  minUsd: number;
}

export interface PreparedSwap {
  swapId: string;
  chain: SwapChain;
  signingMessage: string;
  txRequest?: Record<string, string | number>;
  feeLegFollows: boolean;
  quote: SwapQuote & { deadline: string | null };
}

export interface SwapSide {
  id: string;
  asset: string;
  chain: SwapChain;
  symbol: string;
  amount?: number;
  net?: number;
  expected?: number;
  minimum?: number;
  address: string;
}

export interface SwapState {
  id: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "REFUNDED" | "FAILED" | "CANCELLED";
  swapStatus: string | null;
  from: SwapSide;
  to: SwapSide;
  fee: { amount: number; symbol: string; bps: number; collected: boolean } | null;
  amountOut: number;
  originTxHash: string | null;
  destinationTxHash: string | null;
  originExplorerUrl: string | null;
  destinationExplorerUrl: string | null;
  refundedAmount: number | null;
  /** Their coins reached us and the payout is being finished by hand. */
  held?: boolean;
  timeEstimate: number | null;
  createdAt: string;
  completedAt: string | null;
}

/** Signing and broadcasting can take a while on a slow chain. */
const CHAIN_TIMEOUT_MS = 90_000;

export const SWAP_CHAIN_NAME: Record<SwapChain, string> = {
  SOL: "Solana",
  BASE: "Base",
  BEP20: "BNB Chain",
  MONAD: "Monad",
  TON: "TON",
  MOVE: "Movement",
};

/**
 * The last config seen, held in memory. Home fetches it to decide whether to
 * show the Swap tag, so by the time somebody taps it the screen can open on
 * this at once and refresh behind it, instead of opening on a spinner.
 */
let lastConfig: SwapConfig | null = null;
export const cachedSwapConfig = () => lastConfig;

export async function getSwapConfig(): Promise<SwapConfig> {
  const { data } = await api.get("/swap/config");
  lastConfig = data;
  return data;
}

export async function getSwapQuote(from: string, to: string, amount: number): Promise<SwapQuote> {
  const { data } = await api.post("/swap/quote", { from, to, amount });
  return data;
}

export async function prepareSwap(from: string, to: string, amount: number): Promise<PreparedSwap> {
  const { data } = await api.post("/swap/prepare", { from, to, amount }, { timeout: CHAIN_TIMEOUT_MS });
  return data;
}

export async function submitSwap(params: {
  swapId: string;
  signature: string;
  publicKey: string;
  signedRaw?: string;
}): Promise<{ status: "PROCESSING"; txHash: string; feeLeg?: { signingMessage: string; txRequest?: Record<string, string | number> } }> {
  const { data } = await api.post("/swap/submit", params, { timeout: CHAIN_TIMEOUT_MS });
  return data;
}

export async function submitSwapFee(params: {
  swapId: string;
  signature: string;
  publicKey: string;
  signedRaw?: string;
}): Promise<{ collected: boolean }> {
  const { data } = await api.post("/swap/fee", params, { timeout: CHAIN_TIMEOUT_MS });
  return data;
}

export async function getSwap(id: string): Promise<SwapState> {
  const { data } = await api.get(`/swap/${id}`);
  return data;
}

/** Still moving, so still worth watching. */
export function isSwapInFlight(s: SwapState["status"]): boolean {
  return s === "PENDING" || s === "PROCESSING";
}

/** Two places for money, more when the amount is small or the coin is SOL. */
export function fmtCoin(n: number, symbol?: string): string {
  const max = n > 0 && n < 1 ? 6 : symbol === "SOL" ? 4 : 2;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: max });
}
