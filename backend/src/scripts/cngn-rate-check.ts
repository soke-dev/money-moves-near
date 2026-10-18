/**
 * What the desk is posting, and what happens when the feed is not there.
 *
 * A rate of zero is the refusal: every sell path checks `!ngnRate || ngnRate <= 0`
 * and rejects, so an unpriceable asset cannot be sold rather than being sold at
 * a guess. This prints both halves so the second one is not taken on trust.
 */
import { getLiveNgnRate, getLiveFundRate } from "../lib/ngn-rate";

(async () => {
  console.log("posted rates");
  for (const t of ["USDC", "USDT", "MOVE", "cNGN"]) {
    const sell = await getLiveNgnRate(t);
    const fund = await getLiveFundRate(t);
    console.log(`  ${t.padEnd(6)} sell ${sell.toFixed(4).padStart(12)}   fund ${fund.toFixed(4).padStart(12)}`);
  }

  const r = await getLiveNgnRate("cNGN");
  console.log("");
  console.log(`  1,000 cNGN   -> ${(1000 * r).toFixed(2)} gross`);
  console.log(`  100,000 cNGN -> ${(100000 * r).toFixed(2)} gross`);

  console.log("");
  console.log("no feed for this asset");
  const unknown = await getLiveNgnRate("NOTATOKEN");
  console.log(`  NOTATOKEN sell rate = ${unknown}  ${unknown === 0 ? "-> sell refused" : "-> PRICED, which is wrong"}`);
})();
