import { getServerUrl } from "./api";

export interface TokenRate {
  usd: number;
  ngn: number;
  /** The buy rate: CoinGecko's mid plus our markup. What a deposit converts at. */
  fundNgn: number;
  change24h: number;
  sparkline: number[];
}

export interface RatesResponse {
  MOVE: TokenRate;
  USDC: TokenRate;
  USDT: TokenRate;
  USDCx: TokenRate;
  SOL: TokenRate;
  cNGN: TokenRate;
  lastUpdated: string | null;
}

export async function getRates(): Promise<RatesResponse> {
  const url = `${getServerUrl()}/api/rates`;
  console.log("[RATES] Fetching from:", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Rates fetch failed: ${res.status}`);
  const data = await res.json();
  console.log("[RATES] Got:", JSON.stringify(data).slice(0, 200));
  return data;
}
