import { api } from "./api";

/**
 * Sweep — scattered stablecoins into one USDCx balance on Movement.
 *
 * Three calls rather than the usual two: quote to draw the sheet, prepare to
 * open the record and get a signing payload per chain, then submit once per
 * leg. Legs are deliberately separate all the way down - one chain hanging
 * must never hold the others.
 */

export interface SweepBalance {
  asset: "USDC" | "USDT";
  chain: "SOL" | "BASE" | "BEP20" | "ARC" | "TON" | "MONAD";
  amount: number;
  address: string | null;
}

export interface SweepQuote {
  balances: SweepBalance[];
  total: number;
  destination: { chain: string; asset: string };
  used: number;
  left: number;
  perWeek: number;
  /**
   * When the next attempt comes back, ISO, or null while there are some left.
   *
   * The window rolls rather than following a calendar, so "this week" is not
   * something anybody can work out for themselves - the server says the date
   * because only the server knows which attempt is the oldest.
   */
  resetsAt: string | null;
}

export interface PreparedLeg {
  asset: "USDC" | "USDT";
  chain: "SOL" | "BASE" | "BEP20" | "ARC" | "TON" | "MONAD";
  amount: number;
  signingMessage: string;
  txRequest?: Record<string, string | number>;
}

/**
 * What the server says came of a leg.
 *
 * `sending` and `pending` come back when the server already has this leg in
 * hand - a double tap, or a retry of a call that was still running. They are
 * not outcomes; only `landed` is, and everything else leaves the balance where
 * it was.
 */
export type SweepLegStatus = "pending" | "sending" | "sent" | "landed" | "failed";

export async function getSweepQuote(): Promise<SweepQuote> {
  const { data } = await api.get("/transactions/sweep/quote");
  return data;
}

export async function prepareSweep(
  /**
   * `amount` is optional and means all of that balance when left out, which
   * is what a swap always did. Whatever is given the server clamps to what
   * the chain actually holds, and clamps again against the live balance just
   * before signing - so this is a request, not an instruction.
   */
  legs: { asset: string; chain: string; amount?: number }[],
): Promise<{ sweepId: string; reference: string; total: number; legs: PreparedLeg[] }> {
  const { data } = await api.post("/transactions/sweep/prepare", { legs });
  return data;
}

export async function submitSweepLeg(params: {
  sweepId: string;
  chain: string;
  signature: string;
  publicKey: string;
  signedRaw?: string;
}): Promise<{ status: SweepLegStatus; done?: boolean }> {
  const { data } = await api.post("/transactions/sweep/submit", params);
  return data;
}
