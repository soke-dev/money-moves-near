import { env } from "../config/env";
import { auroraSettings, type SwapProvider } from "./aurora-settings";

/**
 * Aurora Intents — cross-chain swaps, and BTC / Tron deposits.
 *
 * Two products from the one key:
 *
 *  - Swap API: quote, send to the quote's own deposit address, follow it by
 *    that address. A swap in the app is the person's own coins leaving their
 *    own wallet for that address, and arriving back in their own wallet on
 *    the other chain. Refunds go to their own origin address too.
 *
 *  - Persistent deposit addresses: one permanent address per person per
 *    chain, that converts whatever lands on it and pays it out to a fixed
 *    recipient. BTC and Tron USDT use these, paid out as USDC to the person's
 *    own Solana wallet.
 *
 * The key travels in the path, not a header - that is how every endpoint is
 * shaped. Aurora calls it "not confidential", but it is still kept on the
 * server: everything here runs server-side, and the app never talks to them.
 *
 * Rate limits are per key and per endpoint (100 per 10 seconds, 2,000 an
 * hour), and a rejected call still counts against the hour. So a 429 parks
 * that endpoint until its Retry-After has passed rather than letting every
 * caller keep knocking.
 *
 * Swaps can also go through NEAR Intents 1Click directly, the network Aurora
 * is built on. Same requests and responses; the key goes in a header and the
 * paths sit under /v0. The console picks which one quotes swaps, and each
 * swap remembers which one it was quoted on, so its status is always asked of
 * the right one. Persistent deposits are Aurora's alone.
 */

const BASE = () => env.AURORA_INTENTS_BASE_URL.replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

export function isAuroraConfigured(): boolean {
  return !!env.AURORA_INTENTS_API_KEY;
}

export function isOneClickConfigured(): boolean {
  return !!env.ONECLICK_API_KEY;
}

/** Whether swaps can be quoted by anyone at all. */
export function isSwapConfigured(): boolean {
  return isAuroraConfigured() || isOneClickConfigured();
}

const configured = (p: SwapProvider) => (p === "oneclick" ? isOneClickConfigured() : isAuroraConfigured());

/**
 * Who quotes swaps right now: the console's choice when its key is set,
 * otherwise whichever one has a key, so a missing key never stops swaps.
 */
export async function swapProvider(): Promise<SwapProvider | null> {
  const chosen = (await auroraSettings()).swap.provider;
  if (configured(chosen)) return chosen;
  const other: SwapProvider = chosen === "oneclick" ? "aurora" : "oneclick";
  return configured(other) ? other : null;
}

export type AuroraResult<T> = { ok: boolean; status: number; data: T | null; error?: string };

/** Per endpoint: when it may be called again after a 429. */
const parkedUntil = new Map<string, number>();

/** One line a person can read: their message, never a page of markup. */
function summary(status: number, parsed: any, text: string): string {
  const m = parsed?.message ?? parsed?.error;
  if (m) return (Array.isArray(m) ? m.join("; ") : String(m)).replace(/\s+/g, " ").slice(0, 300);
  if (/^\s*</.test(text)) return `HTML error page (HTTP ${status})`;
  return text.replace(/\s+/g, " ").trim().slice(0, 300) || `HTTP ${status}`;
}

/**
 * One call. `name` is the endpoint segment before the key - "quote",
 * "status", "deposit/submit" and so on - and doubles as the rate-limit bucket.
 */
async function call<T>(
  method: "GET" | "POST",
  name: string,
  opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  provider: SwapProvider = "aurora",
): Promise<AuroraResult<T>> {
  if (!configured(provider)) return { ok: false, status: 0, data: null, error: "not configured" };
  const bucket = provider + ":" + name;
  const tag = provider === "oneclick" ? "1CLICK" : "AURORA";

  const parked = parkedUntil.get(bucket);
  if (parked && parked > Date.now()) {
    return { ok: false, status: 429, data: null, error: "rate limited, waiting for the window to reset" };
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const query = qs.size ? `?${qs}` : "";
  const url =
    provider === "oneclick"
      ? `${env.ONECLICK_BASE_URL.replace(/\/$/, "")}/v0/${name}${query}`
      : `${BASE()}/api/${name}/${encodeURIComponent(env.AURORA_INTENTS_API_KEY)}${query}`;
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (provider === "oneclick") headers.Authorization = `Bearer ${env.ONECLICK_API_KEY}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (res.status === 429) {
      // Retry-After is seconds. Wait at least that, plus a little, so the
      // first call after the window is not also the one that trips it again.
      const after = Number(res.headers.get("retry-after"));
      const ms = (Number.isFinite(after) && after > 0 ? after : 10) * 1000 + Math.floor(Math.random() * 1000);
      parkedUntil.set(bucket, Date.now() + ms);
    }

    if (!res.ok) {
      const message = summary(res.status, parsed, text);
      // Never the URL: it carries the key.
      console.error(`[${tag}] ${method} ${name} -> ${res.status} ${message}`);
      return { ok: false, status: res.status, data: null, error: message };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    const message = timedOut ? `no answer within ${TIMEOUT_MS / 1000}s` : err?.message || "request failed";
    console.error(`[${tag}] ${method} ${name} ${timedOut ? "timed out" : "threw"}: ${message}`);
    return { ok: false, status: 0, data: null, error: message };
  }
}

/* ─── Tokens ───────────────────────────────────────────────────────── */

export type AuroraToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
};

let tokenCache: { at: number; provider: SwapProvider; byId: Map<string, AuroraToken> } | null = null;
const TOKENS_TTL_MS = 5 * 60_000;

/**
 * Every token they list, keyed by asset id, refreshed every few minutes.
 *
 * Their guidance is to fetch at startup and every few minutes, never per
 * action - and this list is also where decimals and prices come from, so a
 * stale copy is far better than none. A failed refresh keeps the last one.
 */
export async function auroraTokens(): Promise<Map<string, AuroraToken>> {
  const provider = (await swapProvider()) ?? "aurora";
  if (tokenCache && tokenCache.provider === provider && Date.now() - tokenCache.at < TOKENS_TTL_MS) return tokenCache.byId;
  // Aurora wraps the list in { tokens }; 1Click returns it bare.
  const r = await call<{ tokens: AuroraToken[] } | AuroraToken[]>("GET", "tokens", {}, provider);
  const list = Array.isArray(r.data) ? r.data : r.data?.tokens;
  if (r.ok && Array.isArray(list)) {
    tokenCache = { at: Date.now(), provider, byId: new Map(list.map((t) => [t.assetId, t])) };
  } else if (!tokenCache) {
    return new Map();
  }
  return tokenCache!.byId;
}

/* ─── What the app swaps between ───────────────────────────────────── */

export type SwapChain = "SOL" | "BASE" | "BEP20" | "MONAD" | "TON" | "MOVE";

export type SwapAsset = {
  /** Ours: "SOL:USDC". What the app sends back and forth. */
  id: string;
  chain: SwapChain;
  /** Our Asset enum. Monad's USDT0 is held as USDT, as it is everywhere else here. */
  asset: "USDC" | "USDT" | "SOL" | "USDCx";
  /** What the app shows. */
  symbol: string;
  assetId: string;
  /** Whether it can be spent in a swap. Only what the app can sign for, with a fee it can take. */
  from: boolean;
  /** Whether it can be received. Only coins the person's own wallet holds. */
  to: boolean;
  /**
   * Routed through our own wallets rather than swapped directly: the coin
   * comes to us, and USDC on this chain goes out in its place. Movement has
   * no liquidity on the network, so its USDCx takes this way.
   */
  via?: "BASE";
};

/** Swaps out of Movement need both wallets set: one to receive, one to pay. */
export function isMovementRouteConfigured(): boolean {
  return !!env.SWAP_MOVEMENT_ADDRESS && !!env.SWAP_EVM_PRIVATE_KEY;
}

/**
 * The catalogue. Checked against the live token list on every read, so a
 * token they stop listing quietly drops out instead of failing at quote time.
 *
 * Stablecoins only, both sides. Spend side: Solana and the EVM chains, the
 * ones the withdrawal builders can send with our gas. TON is receive-only for
 * now: its sends go through a relay that charges in the same USDT, which this
 * first version does not price. Movement USDCx is listed by Aurora but quotes
 * "No liquidity available" in both directions, so it is left out until it
 * routes.
 *
 * Arbitrum is left out on both sides: the app does not list balances there.
 */
export const SWAP_ASSETS: readonly SwapAsset[] = [
  { id: "SOL:USDC", chain: "SOL", asset: "USDC", symbol: "USDC", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", from: true, to: true },
  { id: "SOL:USDT", chain: "SOL", asset: "USDT", symbol: "USDT", assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", from: true, to: true },
  { id: "BASE:USDC", chain: "BASE", asset: "USDC", symbol: "USDC", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", from: true, to: true },
  { id: "BEP20:USDC", chain: "BEP20", asset: "USDC", symbol: "USDC", assetId: "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", from: true, to: true },
  { id: "BEP20:USDT", chain: "BEP20", asset: "USDT", symbol: "USDT", assetId: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", from: true, to: true },
  { id: "MONAD:USDC", chain: "MONAD", asset: "USDC", symbol: "USDC", assetId: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx", from: true, to: true },
  { id: "MONAD:USDT", chain: "MONAD", asset: "USDT", symbol: "USDT0", assetId: "nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et", from: true, to: true },
  { id: "TON:USDT", chain: "TON", asset: "USDT", symbol: "USDT", assetId: "nep245:v2_1.omni.hot.tg:1117_3tsdfyziyc7EJbP2aULWSKU4toBaAcN4FdTgfm5W1mC4ouR", from: false, to: true },
  // Out only, through our wallets: see `via`.
  { id: "MOVE:USDCX", chain: "MOVE", asset: "USDCx", symbol: "USDCx", assetId: "nep141:movement-6f9a70ef4605e7d9174f1abf8d8d3c15012f48f3.omft.near", from: true, to: false, via: "BASE" },
];

export const swapAssetById = (id: string) => SWAP_ASSETS.find((a) => a.id === id) ?? null;

/** The catalogue with live decimals and price, minus anything they no longer list. */
export async function liveSwapAssets(): Promise<(SwapAsset & { decimals: number; price: number })[]> {
  const tokens = await auroraTokens();
  return SWAP_ASSETS.flatMap((a) => {
    if (a.via && !isMovementRouteConfigured()) return [];
    const t = tokens.get(a.assetId);
    if (t) return [{ ...a, decimals: t.decimals, price: t.price }];
    // A routed coin never touches their liquidity, so it does not need listing.
    return a.via ? [{ ...a, decimals: 6, price: 1 }] : [];
  });
}

/* ─── Amounts ──────────────────────────────────────────────────────── */

/** A decimal number to the token's smallest unit, without float drift. */
export function toBaseUnits(amount: number, decimals: number): string {
  // Eight places at most: past that a double prints its own noise
  // (4.95.toFixed(18) is "4.950000000000000178").
  const [whole, frac = ""] = amount.toFixed(Math.min(decimals, 8)).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

/** The other way, for display and records. */
export function fromBaseUnits(raw: string | null | undefined, decimals: number): number {
  if (!raw) return 0;
  const n = BigInt(raw);
  const d = 10n ** BigInt(decimals);
  return Number(n / d) + Number(n % d) / Number(d);
}

/* ─── Swap API ─────────────────────────────────────────────────────── */

export type QuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT";
  depositType: "ORIGIN_CHAIN";
  depositMode?: "SIMPLE" | "MEMO";
  amount: string;
  originAsset: string;
  destinationAsset: string;
  slippageTolerance: number;
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  deadline?: string;
  quoteWaitingTimeMs?: number;
  sessionId?: string;
};

export type Quote = {
  timeEstimate: number;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  depositAddress?: string;
  depositMemo?: string;
  deadline?: string;
  timeWhenInactive?: string;
  refundFee?: string | null;
  withdrawFee?: string | null;
};

export type QuoteResponse = {
  timestamp: string;
  signature: string;
  correlationId?: string | null;
  quoteRequest: QuoteRequest & Record<string, unknown>;
  quote: Quote;
};

/** A quote from whoever quotes swaps now. The provider comes back too: the swap keeps it. */
export async function requestQuote(
  body: QuoteRequest,
): Promise<AuroraResult<QuoteResponse> & { provider: SwapProvider | null }> {
  const provider = await swapProvider();
  if (!provider) return { ok: false, status: 0, data: null, error: "not configured", provider: null };
  let sent: QuoteRequest = body;
  if (provider === "oneclick") {
    // 1Click requires a deadline; SIMPLE is its default mode, so it is left out.
    const { depositMode, ...rest } = body;
    sent = {
      ...rest,
      ...(depositMode && depositMode !== "SIMPLE" ? { depositMode } : {}),
      deadline: body.deadline ?? new Date(Date.now() + 60 * 60_000).toISOString(),
    };
  }
  return { ...(await call<QuoteResponse>("POST", "quote", { body: sent }, provider)), provider };
}

export type SwapStatus =
  | "KNOWN_DEPOSIT_TX"
  | "PENDING_DEPOSIT"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export type ChainTx = { hash: string; explorerUrl: string };

export type StatusResponse = {
  correlationId: string;
  status: SwapStatus;
  updatedAt: string;
  swapDetails: {
    intentHashes: string[];
    nearTxHashes: string[];
    originChainTxHashes: ChainTx[];
    destinationChainTxHashes: ChainTx[];
    amountIn?: string | null;
    amountInFormatted?: string | null;
    amountOut?: string | null;
    amountOutFormatted?: string | null;
    amountOutUsd?: string | null;
    slippage?: number | null;
    depositedAmount?: string | null;
    depositedAmountFormatted?: string | null;
    refundedAmount?: string | null;
    refundedAmountFormatted?: string | null;
    refundReason?: string | null;
  };
};

export function swapStatus(depositAddress: string, depositMemo?: string, provider: SwapProvider = "aurora") {
  return call<StatusResponse>("GET", "status", { query: { depositAddress, depositMemo } }, provider);
}

/**
 * Tell them the deposit is on its way. Optional, and it only speeds things up
 * - a failure here changes nothing, so callers never wait on it or retry it.
 */
export function submitDepositTx(txHash: string, depositAddress: string, memo?: string, provider: SwapProvider = "aurora") {
  return call<StatusResponse>("POST", "deposit/submit", { body: { txHash, depositAddress, ...(memo ? { memo } : {}) } }, provider);
}

export type Incidents =
  | { status: "operational" }
  | { status: "incidents"; incidents: { scopeType: string; scopeValue: string; direction: string | null; publicDescription: string | null }[] };

let incidentCache: { at: number; value: Incidents | null } | null = null;

/** Live incidents, cached for a minute. Null when it cannot be read. */
export async function auroraIncidents(): Promise<Incidents | null> {
  // Aurora's own status page; 1Click has none to read.
  if ((await swapProvider()) !== "aurora") return null;
  if (incidentCache && Date.now() - incidentCache.at < 60_000) return incidentCache.value;
  const r = await call<Incidents>("GET", "incidents");
  incidentCache = { at: Date.now(), value: r.ok ? r.data : null };
  return incidentCache.value;
}

/* ─── Persistent deposit addresses ─────────────────────────────────── */

export type PersistentChain = "btc" | "tron";

export function createPersistentAddress(body: {
  recipient: string;
  sender: string;
  depositChain: PersistentChain;
  destinationChain: "sol";
  destinationAsset: string;
}) {
  return call<{ depositAddress: string; alreadyExists: boolean; memo?: string; correlationId?: string }>(
    "POST",
    "persistent-deposit-address",
    { body: { ...body, recipientType: "DESTINATION_CHAIN" } },
  );
}

export type PersistentDeposit = {
  tx_hash: string;
  asset_id: string | null;
  decimals: number | null;
  amount: string;
  from?: string;
  created_at: string;
  intents_account: string;
  deposit_address: string;
  recipient: string;
  fromChain?: string | null;
  destinationChain?: string | null;
};

/**
 * One address's deposits of one kind. `received` is what reached them,
 * `success` and `failed` are the payouts to the recipient. There is no id
 * linking a payout to the deposit it came from - see the ledger for how
 * the two are paired.
 */
export function persistentDeposits(
  address: string,
  type: "received" | "success" | "failed",
  page?: { limit?: number; offset?: number },
) {
  return call<{ deposits: PersistentDeposit[] }>("GET", "persistent-deposit-status", {
    query: { type, address, limit: page?.limit, offset: page?.offset },
  });
}
