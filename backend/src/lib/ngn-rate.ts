import { rateSettings, ensureRateSettings } from "./rate-settings";
import { env } from "../config/env";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd,ngn&ids=movement,usd-coin,tether,ethereum,solana,compliant-naira";
const RATE_CACHE_TTL = 600_000; // refresh once a rate is this old

/**
 * The age past which a cached rate stops being a rate.
 *
 * The cache used to be returned whatever its age whenever a fetch failed,
 * so a feed that had been down for a day still priced sells off a number
 * nobody had checked since the market moved. Past this, every getter returns
 * zero - and zero refuses the quote rather than guessing at it.
 *
 * It applies to the dollar too, which is what converts every other token, so
 * a stale dollar stops the whole book rather than only the assets priced
 * directly off their own feed.
 */
const RATE_MAX_AGE = 1_800_000; // 30 minutes

interface NGNRate { raw: number; usd: number; ts: number }
const rateCache: Record<string, NGNRate> = {};

const CG_ID: Record<string, string> = {
  MOVE: "movement",
  USDC: "usd-coin",
  USDT: "tether",
  ETH: "ethereum",
  SOL: "solana",
  // A naira stablecoin, and deliberately not in IS_DOLLAR below: it is priced
  // in dollars off its own feed and converted back at the posted rate, exactly
  // as MOVE is. Treating it as the naira at par would pay out more than it is
  // worth, and by more than the fee on any sizeable sell.
  cNGN: "compliant-naira",
};

/** The cached rate for a token, or nothing if it is too old to price with. */
function fresh(token: string): NGNRate | null {
  const c = rateCache[token];
  if (!c) return null;
  return Date.now() - c.ts > RATE_MAX_AGE ? null : c;
}

async function getRawNgn(token: string): Promise<number> {
  // USDCx is a 1:1 USDC variant on Movement; CoinGecko doesn't list it
  // separately. Always price it as USDC.
  if (token === "USDCx") token = "USDC";

  const now = Date.now();
  if (rateCache[token] && now - rateCache[token].ts < RATE_CACHE_TTL) {
    return rateCache[token].raw;
  }

  try {
    const res = await fetch(COINGECKO_URL, {
      // The key, when there is one (COINGECKO_API_KEY); CoinGecko's keyless tier otherwise.
      headers: env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": env.COINGECKO_API_KEY } : {},
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data: any = await res.json();

    for (const [sym, cgId] of Object.entries(CG_ID)) {
      if (data[cgId]?.ngn) {
        rateCache[sym] = { raw: data[cgId].ngn, usd: data[cgId].usd ?? 0, ts: now };
      }
    }
  } catch (err) {
    console.error("[RATES] CoinGecko rate fetch failed:", err);
  }

  return fresh(token)?.raw ?? 0;
}

/**
 * What a dollar costs here, and what one is worth here.
 *
 * CoinGecko's dollar, plus a fixed number of naira on each side. The feed
 * tracks a rate below the one anyone here actually trades at, so it is the
 * shape rather than the level: it moves when the market moves, and the two
 * markups carry it up to where this desk trades. The gap between the two is
 * the spread.
 *
 * The dollar's feed price is passed in rather than read from the cache here:
 * the /rates route does its own CoinGecko call and never warms this module's
 * cache, so reading it there produced a rate of zero for every token while the
 * dollar figures beside them were perfectly correct.
 *
 * Naira rather than a percentage, deliberately. A percentage on a rate that
 * doubles doubles the margin too, which is not what was agreed with anyone -
 * and the thing being tuned is "what should a dollar cost here", which is a
 * number of naira and reads as one.
 *
 * Both are set on the admin Services page, falling back to Railway's environment
 * (lib/rate-settings.ts), because the market moves faster than releases.
 */
const usdNgn = (dollarNgn: number, side: "fund" | "sell"): number => {
  if (dollarNgn <= 0) return 0;
  // Admin-set on the Services page where set, else Railway's environment.
  const r = rateSettings();
  const posted = dollarNgn + (side === "fund" ? r.fundMarkup : r.sellMarkup);

  /**
   * The ceiling, applied here rather than at each caller.
   *
   * Every naira price in the app comes through this one line - the dollar
   * takes it as the rate, and everything else is that rate times a dollar
   * price - so capping it here caps the whole book at once. A cap bolted onto
   * the sell route would have left the rates feed, the quote and the limits
   * check quoting a number the payout would not honour.
   */
  const cap = side === "fund" ? r.fundMax : r.sellMax;
  if (cap > 0 && posted > cap) {
    console.warn(
      `[NGN-RATE] ${side} rate capped: feed ${dollarNgn.toFixed(2)} would post ` +
        `${posted.toFixed(2)}, ceiling is ${cap}`,
    );
    return cap;
  }
  return posted;
};

/** The dollar itself. These are the ones we settle in, and they are the unit. */
const IS_DOLLAR = new Set(["USDC", "USDT", "USDCx", "USDCe"]);

/**
 * A token's naira price on one side of the book.
 *
 * A stablecoin IS the dollar, so it takes the posted rate exactly - anything
 * else leaves the headline rate wobbling by a few naira as CoinGecko's idea of
 * a dollar drifts around 1.000. Everything else is priced in dollars and
 * converted at the same posted rate, so one change moves the whole book
 * together instead of leaving MOVE on a different basis from USDC.
 */
export function postedNgn(
  token: string,
  usd: number,
  side: "fund" | "sell",
  dollarNgn: number,
): number {
  const rate = usdNgn(dollarNgn, side);
  if (rate <= 0) return 0;
  if (IS_DOLLAR.has(token)) return rate;
  return usd > 0 ? usd * rate : 0;
}

/**
 * The dollar's own naira price, from the feed. Reading it needs the cache warm,
 * so both getters fetch before they ask.
 */
export async function dollarNgn(): Promise<number> {
  await ensureRateSettings();
  await getRawNgn("USDC");
  return fresh("USDC")?.raw ?? 0;
}

/** Sell rate (user sells crypto → NGN). */
export async function getLiveNgnRate(token: string): Promise<number> {
  await getRawNgn(token);
  const key = token === "USDCx" ? "USDC" : token;
  return postedNgn(token, fresh(key)?.usd ?? 0, "sell", await dollarNgn());
}

/** Fund rate (user pays NGN → crypto). */
export async function getLiveFundRate(token: string): Promise<number> {
  await getRawNgn(token);
  const key = token === "USDCx" ? "USDC" : token;
  return postedNgn(token, fresh(key)?.usd ?? 0, "fund", await dollarNgn());
}
