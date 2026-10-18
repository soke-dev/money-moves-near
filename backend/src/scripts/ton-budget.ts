import "dotenv/config";
import * as ton from "../lib/ton";

/**
 * How much of the rate limit does TON actually use?
 *
 * The free TonAPI tier is one request per second, and going over it does not
 * error cleanly - it drops the connection or returns an empty body, which
 * reads as an empty wallet. So the number of requests per operation is a
 * budget, not a detail, and this counts it rather than estimating.
 *
 * Counts by wrapping fetch, so it sees exactly what leaves the process,
 * including retries.
 *
 *   npx tsx src/scripts/ton-budget.ts
 */

const real = globalThis.fetch;
let calls: { path: string; at: number }[] = [];

globalThis.fetch = ((input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? "");
  if (url.includes("tonapi")) {
    calls.push({ path: url.replace(/^https?:\/\/[^/]+/, ""), at: Date.now() });
  }
  return real(input, init);
}) as typeof fetch;

function reset() {
  calls = [];
}

function report(label: string, started: number) {
  const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
  const min = gaps.length ? Math.min(...gaps) : 0;
  console.log(`\n  ${label}`);
  console.log(`     requests   ${calls.length}`);
  console.log(`     elapsed    ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (gaps.length) {
    console.log(`     min gap    ${min}ms  ${min >= 950 ? "(respects 1 rps)" : "(TOO FAST)"}`);
  }
  for (const c of calls) console.log(`       ${c.path.slice(0, 72)}`);
}

async function main() {
  // A wallet that holds nothing, so nothing here can move money.
  const owner = ton.tonAddressFromSolana("6MsUtS2roHFRyK4TaU8FrkJdG653MCPNjyDNuPDbNrj9");
  console.log(`\nprobing against ${owner}`);
  console.log(`rate limit set to ${process.env.TONAPI_RPS ?? 1} rps\n`);

  // ── a balance refresh, twice, to show the cache ──
  reset();
  let t = Date.now();
  await ton.getTonUsdtBalance(owner, ton.TON_BALANCE_TTL_MS);
  await ton.getTonUsdtBalance(owner, ton.TON_BALANCE_TTL_MS);
  await ton.getTonUsdtBalance(owner, ton.TON_BALANCE_TTL_MS);
  report("three balance refreshes in a row", t);

  // ── the same read on the send path, which must not be cached ──
  reset();
  t = Date.now();
  await ton.getTonUsdtBalance(owner);
  await ton.getTonUsdtBalance(owner);
  report("two balance reads on the SEND path (no cache, by design)", t);

  // ── what a send costs ──
  reset();
  t = Date.now();
  await ton.gaslessSupportsUsdt();        // config, cached after first
  await ton.derivedJettonWallet(owner);   // cached for ever after first
  await ton.getSeqno(owner);              // seqno, which also says "needs init"
  report("a send's lookups, cold", t);

  reset();
  t = Date.now();
  await ton.gaslessSupportsUsdt();
  await ton.derivedJettonWallet(owner);
  await ton.getSeqno(owner);
  report("the same send's lookups, warm (what a real send costs)", t);

  console.log(
    "\n  A real send adds the relay estimate and the broadcast, so warm it is\n" +
    "  the above plus two. Every one is queued at the rate above.\n",
  );
}

main().catch((e) => {
  console.error("FAILED:", e?.message);
  process.exitCode = 1;
});
