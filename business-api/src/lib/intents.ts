/**
 * Paying with another coin, through NEAR Intents (the 1Click API).
 *
 * The customer picks BTC, ETH, SOL and the rest. We ask 1Click for an exact
 * output quote: the payment's price in USDC, delivered to the payment's own
 * deposit address on the business's settle chain. 1Click gives back an address
 * on the customer's chain and how much of their coin to send. Once they send,
 * solvers swap it and USDC lands on our side, where the usual stablecoin
 * payment takes over: seen, confirmed, swept to the treasury, settled to the
 * business however it chose (bank, Money Moves, its wallet).
 *
 * Where the USDC lands follows the business's settle chain where Intents can
 * deliver there and the payment has an address of its own: Solana and Monad.
 * Everything else (Arc, Movement, Stellar) lands on Solana. Stellar payments
 * are told apart by memo, which a swap can't carry. Settlement is paid from
 * the float on the business's own chain either way, so it never notices.
 *
 * Anything that goes wrong on the swap side (sent too little, too late) is
 * refunded by Intents to our own account there, never lost, and handed back
 * by our team.
 */
import type { SettleChain } from "@prisma/client";
import { env } from "../config/env";
import { log } from "./log";
import { kindFor } from "./chains";
import { coinLiveReady, type Network } from "./accept";
import type { Platform } from "./platform";

export type IntentCoin = {
  key: string;
  symbol: string;
  name: string;
  /** The chain the customer sends on, as shown. */
  chain: string;
  assetId: string;
  decimals: number;
  /** Slow to confirm: the address is held for an hour rather than half of one. */
  slow?: boolean;
};

/** What customers can pay with. Each id is checked against 1Click's own token list. */
export const INTENT_COINS: IntentCoin[] = [
  { key: "BTC", symbol: "BTC", name: "Bitcoin", chain: "Bitcoin", assetId: "nep141:btc.omft.near", decimals: 8, slow: true },
  { key: "ETH", symbol: "ETH", name: "Ether", chain: "Ethereum", assetId: "nep141:eth.omft.near", decimals: 18 },
  { key: "ETH_BASE", symbol: "ETH", name: "Ether", chain: "Base", assetId: "nep141:base.omft.near", decimals: 18 },
  { key: "ETH_ARB", symbol: "ETH", name: "Ether", chain: "Arbitrum", assetId: "nep141:arb.omft.near", decimals: 18 },
  { key: "SOL", symbol: "SOL", name: "Solana", chain: "Solana", assetId: "nep141:sol.omft.near", decimals: 9 },
  { key: "NEAR", symbol: "NEAR", name: "NEAR", chain: "NEAR", assetId: "nep141:wrap.near", decimals: 24 },
  { key: "BNB", symbol: "BNB", name: "BNB", chain: "BNB Chain", assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", decimals: 18 },
  { key: "USDT_TRON", symbol: "USDT", name: "Tether USD", chain: "Tron", assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", decimals: 6 },
  { key: "TRX", symbol: "TRX", name: "Tron", chain: "Tron", assetId: "nep141:tron.omft.near", decimals: 6 },
  { key: "XRP", symbol: "XRP", name: "XRP", chain: "XRP Ledger", assetId: "nep141:xrp.omft.near", decimals: 6 },
  { key: "DOGE", symbol: "DOGE", name: "Dogecoin", chain: "Dogecoin", assetId: "nep141:doge.omft.near", decimals: 8, slow: true },
  { key: "LTC", symbol: "LTC", name: "Litecoin", chain: "Litecoin", assetId: "nep141:ltc.omft.near", decimals: 8, slow: true },
  { key: "BCH", symbol: "BCH", name: "Bitcoin Cash", chain: "Bitcoin Cash", assetId: "nep141:bch.omft.near", decimals: 8, slow: true },
  { key: "ZEC", symbol: "ZEC", name: "Zcash", chain: "Zcash", assetId: "nep141:zec.omft.near", decimals: 8, slow: true },
  { key: "SUI", symbol: "SUI", name: "Sui", chain: "Sui", assetId: "nep141:sui.omft.near", decimals: 9 },
  { key: "AVAX", symbol: "AVAX", name: "Avalanche", chain: "Avalanche", assetId: "nep245:v2_1.omni.hot.tg:43114_11111111111111111111", decimals: 18 },
  { key: "POL", symbol: "POL", name: "Polygon", chain: "Polygon", assetId: "nep245:v2_1.omni.hot.tg:137_11111111111111111111", decimals: 18 },
  { key: "ADA", symbol: "ADA", name: "Cardano", chain: "Cardano", assetId: "nep141:cardano.omft.near", decimals: 6, slow: true },
];
export const INTENT_KEYS = INTENT_COINS.map((c) => c.key);
export const intentCoin = (key: string) => INTENT_COINS.find((c) => c.key === key);

/**
 * Our own stablecoins, as NEAR Intents names them - for when Services routes
 * USDC and USDT through it too. Each checked with a live quote (2026-11-08).
 * Not here, so always paid the default way: Arc (Intents isn't on it),
 * Stellar (no quotes for it), Movement (no liquidity), Base USDT (not listed).
 * BNB Chain is here but currently needs $1,000 or more; below that a payment
 * simply goes the default way.
 */
const STABLE_IN: Record<string, { assetId: string; decimals: number }> = {
  "USDC:Solana": { assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6 },
  "USDT:Solana": { assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", decimals: 6 },
  "USDC:Ethereum": { assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6 },
  "USDT:Ethereum": { assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6 },
  "USDC:Arbitrum": { assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6 },
  "USDT:Arbitrum": { assetId: "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", decimals: 6 },
  "USDC:Base": { assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6 },
  "USDC:BNB Chain": { assetId: "nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r", decimals: 18 },
  "USDT:BNB Chain": { assetId: "nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g", decimals: 18 },
  "USDC:Optimism": { assetId: "nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ", decimals: 6 },
  "USDT:Optimism": { assetId: "nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo", decimals: 6 },
  "USDT:TON": { assetId: "nep245:v2_1.omni.hot.tg:1117_3tsdfyziyc7EJbP2aULWSKU4toBaAcN4FdTgfm5W1mC4ouR", decimals: 6 },
  "USDC:Monad": { assetId: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx", decimals: 6 },
  "USDT:Monad": { assetId: "nep245:v2_1.omni.hot.tg:143_4EJiJxSALvGoTZbnc8K7Ft9533et", decimals: 6 },
};

/** A stablecoin on one of our networks as a coin Intents takes, or null when it can't. */
export function stableIntentCoin(coin: "USDC" | "USDT", network: Network): IntentCoin | null {
  const s = STABLE_IN[`${coin}:${network}`];
  if (!s) return null;
  return { key: `${coin}_${network.replace(/\s+/g, "")}`, symbol: coin, name: coin === "USDC" ? "USD Coin" : "Tether USD", chain: network, assetId: s.assetId, decimals: s.decimals };
}
/** The networks each stablecoin can go through Intents on, for the console. */
export const STABLE_INTENT_PAIRS = Object.keys(STABLE_IN);

/** USDC where Intents delivers it, on the networks a payment can land on. Six decimals on both. */
const USDC_OUT: Partial<Record<Network, string>> = {
  Solana: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  Monad: "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
};

/** A network a swap can land on right now: Intents delivers there, live payments are open there, and each payment gets its own address. */
const canLand = (n: Network) => !!USDC_OUT[n] && coinLiveReady("USDC", n) && kindFor(n) === "OWN";

/** Where the USDC lands for a business settling on this chain: the chain itself where it can, else Solana. Null: nowhere can. */
export function landingFor(chain: SettleChain): Network | null {
  // Where its payout goes out: Solana for a Solana business, Monad for everyone else (see payoutChain).
  const own: Network = chain === "SOLANA" ? "Solana" : "Monad";
  if (canLand(own)) return own;
  const other: Network = own === "Monad" ? "Solana" : "Monad";
  return canLand(other) ? other : null;
}
/** The same in test mode, where nothing needs to be live: only which network it would be. */
export const testLandingFor = (chain: SettleChain): Network => (chain === "SOLANA" ? "Solana" : "Monad");

/** The network a payout chain's float lives on, where a payment's money is converted to. */
export const floatNetworkOf = (chain: string): "Monad" | "Solana" | null => (chain === "MONAD" ? "Monad" : chain === "SOLANA" ? "Solana" : null);

/**
 * A payment's own money converted into a float: exactly what's there (`raw`,
 * in the coin's own units) in, USDC on `to` out to the float. What NEAR
 * Intents takes for it is ours to bear: the business is paid in full.
 */
export async function quoteConversion(input: { from: IntentCoin; raw: bigint; to: "Monad" | "Solana"; recipient: string }): Promise<IntentQuote> {
  const account = intentsAccount();
  if (!account) throw new IntentQuoteError("Needs INTENTS_ACCOUNT or TREASURY_EVM_ADDRESS set.");
  const r = await call("/v0/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: input.from.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_OUT[input.to],
      amount: input.raw.toString(),
      recipient: input.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: account,
      refundType: "INTENTS",
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
      referral: "moneymoves",
    }),
  });
  if (!r.ok) {
    const message = String(r.body?.message ?? `HTTP ${r.status}`);
    // Any minimum at all means this payment is too small to convert: the caller falls back.
    const minimum = /minimum|at least|too low/i.test(message);
    throw new IntentQuoteError(message, minimum ? 1 : null);
  }
  const q = r.body?.quote ?? {};
  if (!q.depositAddress) throw new IntentQuoteError("The quote came back without an address.");
  return { depositAddress: q.depositAddress, depositMemo: q.depositMemo ?? null, amountIn: String(q.amountIn ?? input.raw), amountInFormatted: String(q.amountInFormatted ?? ""), minAmountIn: String(q.minAmountIn ?? q.amountIn ?? input.raw), amountInUsd: q.amountInUsd ?? null, deadline: q.deadline ?? "", timeEstimate: typeof q.timeEstimate === "number" ? q.timeEstimate : null, correlationId: r.body?.correlationId ?? null };
}

/** The coins this checkout can offer: switched on in Services, live or test. */
export function intentsOffered(p: Platform, mode: "TEST" | "LIVE", chain: SettleChain) {
  if (!p.intents.on && mode === "LIVE") return [];
  if (mode === "LIVE" && !landingFor(chain)) return [];
  return INTENT_COINS.filter((c) => p.intentCoins[c.key] !== false).map(({ key, symbol, name, chain: on, slow }) => ({ key, symbol, name, chain: on, slow: !!slow }));
}

/** Our account on NEAR Intents: refunds and our fee land here. */
export const intentsAccount = () => (env.INTENTS_ACCOUNT ?? env.TREASURY_EVM_ADDRESS ?? "").toLowerCase();

const base = () => env.ONECLICK_BASE_URL.replace(/\/$/, "");
const headers = (): Record<string, string> => ({ "content-type": "application/json", ...(env.ONECLICK_API_KEY ? { authorization: `Bearer ${env.ONECLICK_API_KEY}` } : {}) });

/** 1Click, with a couple of retries: its edge drops the odd connection. */
async function call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: any }> {
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${base()}${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(15_000) });
      const body = await r.json().catch(() => ({}));
      if (r.status >= 500 && i < 2) continue;
      return { ok: r.ok, status: r.status, body };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("NEAR Intents didn't answer");
}

export type IntentQuote = {
  depositAddress: string;
  depositMemo: string | null;
  amountIn: string;
  amountInFormatted: string;
  minAmountIn: string;
  amountInUsd: string | null;
  deadline: string;
  timeEstimate: number | null;
  correlationId: string | null;
};

export class IntentQuoteError extends Error {
  /** Set when the amount is under what this coin's route can carry: the least, in dollars. */
  constructor(message: string, readonly leastUsd: number | null = null) {
    super(message);
  }
}

/**
 * An exact output quote: `micros` of USDC to `recipient` on `landing`, paid in
 * `coin`, open until `deadline`. Our fee, when there is one, is taken inside
 * the swap and lands in our Intents account.
 */
export async function quoteIntent(input: { coin: IntentCoin; landing: Network; recipient: string; micros: bigint; deadline: Date; feeBps: number; dry?: boolean }): Promise<IntentQuote> {
  const destinationAsset = USDC_OUT[input.landing];
  const account = intentsAccount();
  if (!destinationAsset) throw new IntentQuoteError(`Swaps can't land on ${input.landing}.`);
  if (!account) throw new IntentQuoteError("Needs INTENTS_ACCOUNT or TREASURY_EVM_ADDRESS set.");
  const r = await call("/v0/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: !!input.dry,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: input.coin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset,
      amount: input.micros.toString(),
      recipient: input.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: account,
      refundType: "INTENTS",
      deadline: input.deadline.toISOString(),
      referral: "moneymoves",
      ...(input.feeBps > 0 ? { appFees: [{ recipient: account, fee: input.feeBps }] } : {}),
    }),
  });
  if (!r.ok) {
    const message = String(r.body?.message ?? `HTTP ${r.status}`);
    // "try at least 4839673" is in USDC's own units; "minimum swap amount is $1,000" in dollars.
    const units = /at least (\d+)/i.exec(message);
    const dollars = /minimum[^$]*\$([\d,]+(?:\.\d+)?)/i.exec(message);
    const least = units ? Math.ceil(Number(units[1]) / 1e4) / 100 : dollars ? Number(dollars[1]!.replace(/,/g, "")) : null;
    log.warn("[intents] quote refused", { coin: input.coin.key, landing: input.landing, status: r.status, message: message.slice(0, 200) });
    throw new IntentQuoteError(message, least);
  }
  const q = r.body?.quote ?? {};
  if (!input.dry && !q.depositAddress) throw new IntentQuoteError("The quote came back without an address.");
  return {
    depositAddress: q.depositAddress ?? "",
    depositMemo: q.depositMemo ?? null,
    amountIn: String(q.amountIn ?? "0"),
    amountInFormatted: String(q.amountInFormatted ?? "0"),
    minAmountIn: String(q.minAmountIn ?? q.amountIn ?? "0"),
    amountInUsd: q.amountInUsd ?? null,
    deadline: q.deadline ?? input.deadline.toISOString(),
    timeEstimate: typeof q.timeEstimate === "number" ? q.timeEstimate : null,
    correlationId: r.body?.correlationId ?? null,
  };
}

export type IntentStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

/** Where a swap has got to, by its deposit address. */
export async function intentStatus(depositAddress: string, depositMemo?: string | null): Promise<{ status: IntentStatus; originTx: string | null; destinationTx: string | null } | null> {
  const q = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
  const r = await call(`/v0/status?${q}`);
  if (!r.ok) return null;
  const d = r.body?.swapDetails ?? {};
  return {
    status: r.body?.status as IntentStatus,
    originTx: d.originChainTxHashes?.[0]?.hash ?? null,
    destinationTx: d.destinationChainTxHashes?.[0]?.hash ?? null,
  };
}

/** Tells 1Click the customer's transaction, so it starts on it before its own watcher would. */
export async function submitIntentDeposit(depositAddress: string, txHash: string, memo?: string | null): Promise<boolean> {
  const r = await call("/v0/deposit/submit", { method: "POST", body: JSON.stringify({ txHash, depositAddress, ...(memo ? { memo } : {}) }) }).catch(() => null);
  return !!r?.ok;
}

/** Prices from 1Click's own token list, for test checkouts that don't ask for a real quote. Kept ten minutes. */
let prices: { at: number; byId: Map<string, number> } | null = null;
export async function intentPrice(assetId: string): Promise<number | null> {
  if (!prices || Date.now() - prices.at > 10 * 60_000) {
    try {
      const r = await call("/v0/tokens");
      if (Array.isArray(r.body)) prices = { at: Date.now(), byId: new Map(r.body.map((t: any) => [t.assetId, Number(t.price)])) };
    } catch {
      /* the last list, or none */
    }
  }
  return prices?.byId.get(assetId) ?? null;
}
