/**
 * Today's naira rate, from the Money Moves app's own public rates - so a
 * business checkout and the app never quote two different numbers.
 *
 * It's the app's selling rate - what a dollar of USDC is worth in naira - used
 * to turn a dollar price into the naira to transfer, and to show the other
 * currency as an equivalent.
 *
 * Kept for five minutes. If the feed is down, the last rate is used for up to
 * half an hour; past that a dollar price can't be quoted in naira, and the
 * checkout says so rather than guessing.
 */
import { env } from "../config/env";
import { HttpError } from "./http";
import { log } from "./log";

const FRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 60_000;

let cache: { ngnPerUsd: number; at: number } | null = null;

export async function ngnPerUsd(): Promise<number> {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache.ngnPerUsd;
  try {
    const res = await fetch(env.RATES_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`rates ${res.status}`);
    const json = (await res.json()) as { USDC?: { ngn?: unknown } };
    const rate = Number(json.USDC?.ngn);
    // A rate outside this band is a broken feed, not the market.
    if (!Number.isFinite(rate) || rate < 100 || rate > 100_000) throw new Error("rate out of range");
    cache = { ngnPerUsd: rate, at: Date.now() };
    return rate;
  } catch (e) {
    log.warn("[rates] couldn't refresh the naira rate", { reason: e instanceof Error ? e.message : String(e) });
    if (cache && Date.now() - cache.at < MAX_AGE_MS) return cache.ngnPerUsd;
    throw new HttpError(503, "We can't get today's naira rate right now. Try again in a minute.", "rate_unavailable");
  }
}
