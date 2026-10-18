import { Router } from "express";
import { postedNgn } from "../lib/ngn-rate";
import { ensureRateSettings } from "../lib/rate-settings";
import { env } from "../config/env";

const router = Router();

// ─── CoinGecko Config ───────────────────────────────────────
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd,ngn&include_24hr_change=true&ids=movement,usd-coin,tether,solana,compliant-naira";
const SPARKLINE_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=ngn&ids=movement,usd-coin,tether,solana,compliant-naira&sparkline=true&sparkline_in_7d=true";
const CACHE_TTL = 600_000; // 10 minutes

// ─── Rate Cache ─────────────────────────────────────────────
interface TokenRate {
  usd: number;
  ngn: number;
  fundNgn: number;
  change24h: number;
  sparkline: number[];
}

interface RateCache {
  MOVE: TokenRate;
  USDC: TokenRate;
  USDT: TokenRate;
  USDCx: TokenRate;
  SOL: TokenRate;
  cNGN: TokenRate;
  lastFetched: number;
}

let cache: RateCache | null = null;

/** Drop the cached prices, so a markup changed on the admin page shows at once rather than in ten minutes. */
export function invalidateRatesCache(): void {
  cache = null;
}

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return res;
    } catch (err: any) {
      clearTimeout(timeout);
      const isTransient = err?.cause?.code === "ECONNRESET" || err?.name === "AbortError" || err?.cause?.code === "ECONNREFUSED";
      if (attempt < retries && isTransient) {
        await new Promise(r => setTimeout(r, 500 * attempt)); // 500ms, 1000ms backoff
        continue;
      }
      throw err;
    }
  }
  throw new Error("fetchWithRetry exhausted");
}

export async function fetchRates(): Promise<RateCache | null> {
  const now = Date.now();
  if (cache && now - cache.lastFetched < CACHE_TTL) return cache;
  await ensureRateSettings();

  try {
    // The key, when there is one (COINGECKO_API_KEY); CoinGecko's keyless tier otherwise.
    const headers: Record<string, string> = env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": env.COINGECKO_API_KEY } : {};
    const [priceRes, sparkRes] = await Promise.all([
      fetchWithRetry(COINGECKO_URL, { headers }),
      fetchWithRetry(SPARKLINE_URL, { headers }).catch(() => null),
    ]);

    if (!priceRes.ok) throw new Error(`CoinGecko ${priceRes.status}`);
    const data = await priceRes.json() as Record<string, Record<string, number>>;

    // Parse sparkline data (7-day, sample down to ~30 points)
    const sparkMap: Record<string, number[]> = {};
    if (sparkRes && sparkRes.ok) {
      try {
        const sparkData = (await sparkRes.json()) as any[];
        for (const coin of sparkData) {
          const prices: number[] = coin.sparkline_in_7d?.price || [];
          // Sample ~30 points from the full array
          const step = Math.max(1, Math.floor(prices.length / 30));
          sparkMap[coin.id] = prices.filter((_: number, i: number) => i % step === 0);
        }
      } catch {}
    }

    if (!data.movement?.usd || !data["usd-coin"]?.usd || !data.tether?.usd || !data.solana?.usd) {
      console.error("[RATES] CoinGecko returned incomplete data:", Object.keys(data));
      return cache; // keep stale cache if any
    }

    cache = {
      MOVE: {
        usd: data.movement.usd,
        ngn: postedNgn("MOVE", data.movement.usd, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("MOVE", data.movement.usd, "fund", data["usd-coin"].ngn),
        change24h: data.movement.usd_24h_change ?? 0,
        sparkline: sparkMap["movement"] || [],
      },
      USDC: {
        usd: data["usd-coin"].usd,
        ngn: postedNgn("USDC", data["usd-coin"].usd, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("USDC", data["usd-coin"].usd, "fund", data["usd-coin"].ngn),
        change24h: data["usd-coin"].usd_24h_change ?? 0,
        sparkline: sparkMap["usd-coin"] || [],
      },
      // USDCx is a 1:1 USDC variant on Movement; mirror USDC's rates.
      USDCx: {
        usd: data["usd-coin"].usd,
        ngn: postedNgn("USDCx", data["usd-coin"].usd, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("USDCx", data["usd-coin"].usd, "fund", data["usd-coin"].ngn),
        change24h: data["usd-coin"].usd_24h_change ?? 0,
        sparkline: sparkMap["usd-coin"] || [],
      },
      USDT: {
        usd: data.tether.usd,
        ngn: postedNgn("USDT", data.tether.usd, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("USDT", data.tether.usd, "fund", data["usd-coin"].ngn),
        change24h: data.tether.usd_24h_change ?? 0,
        sparkline: sparkMap["tether"] || [],
      },
      SOL: {
        usd: data.solana.usd,
        ngn: postedNgn("SOL", data.solana.usd, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("SOL", data.solana.usd, "fund", data["usd-coin"].ngn),
        change24h: data.solana.usd_24h_change ?? 0,
        sparkline: sparkMap["solana"] || [],
      },
      /**
       * A naira stablecoin, priced the long way round on purpose.
       *
       * It is worth about a naira but not exactly one - the market trades it a
       * little under par - so it goes through the same dollar path as every
       * other token rather than being pinned at 1.00. Pinning it would pay out
       * more than it is worth on every sell, and by more than the fee earns on
       * anything sizeable.
       *
       * Zero when the feed omits it, which is what stops it being offered: the
       * quote refuses a rate of zero rather than inventing one.
       */
      cNGN: {
        usd: data["compliant-naira"]?.usd ?? 0,
        ngn: postedNgn("cNGN", data["compliant-naira"]?.usd ?? 0, "sell", data["usd-coin"].ngn),
        fundNgn: postedNgn("cNGN", data["compliant-naira"]?.usd ?? 0, "fund", data["usd-coin"].ngn),
        change24h: data["compliant-naira"]?.usd_24h_change ?? 0,
        sparkline: sparkMap["compliant-naira"] || [],
      },
      lastFetched: now,
    };
    console.log("[RATES] CoinGecko updated — MOVE ₦%s, USDC ₦%s, USDT ₦%s, SOL ₦%s", cache.MOVE.ngn, cache.USDC.ngn, cache.USDT.ngn, cache.SOL.ngn);
  } catch (err) {
    console.error("[RATES] CoinGecko fetch failed:", err);
    // keep stale cache if available
  }

  return cache;
}

// ─── Public endpoint (no auth required) ─────────────────────
router.get("/", async (_req, res) => {
  const rates = await fetchRates();
  if (!rates) {
    return res.status(503).json({ error: "Rates not available yet. Try again shortly." });
  }
  // Spread, not a hand-written list. cNGN was priced into the cache above and
  // then left out here, because this named five assets and nobody thought to
  // add the sixth - so the rate existed and never reached anyone.
  const { lastFetched, ...tokens } = rates;
  res.json({
    ...tokens,
    lastUpdated: lastFetched ? new Date(lastFetched).toISOString() : null,
  });
});

export default router;
