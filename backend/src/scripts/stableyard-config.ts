import "dotenv/config";
import { env } from "../config/env";

/**
 * What Stableyard has actually enabled for our credential. Read-only.
 *
 * The docs repeat, in several places, not to hardcode networks, assets, fees or
 * capabilities - GET /v2/partners/config is the only truth for a given app. So
 * before any of the routed-deposit work is written, this asks.
 *
 * It answers the two questions that decide whether the feature is possible:
 *
 *   1. Is Movement (10002) enabled as a settlement destination for us?
 *   2. Is routing INTO Movement advertised? The docs describe routing OUT of
 *      Movement and say no pool exists for THBT or JPYC, but never confirm
 *      Movement as a routing destination. If it is not there, BTC cannot
 *      become USDCx and the design has no path.
 *
 * And the three source chains we intend to use: Bitcoin (10001), Tron
 * (728126428), Ethereum (1).
 *
 *   npx tsx src/scripts/stableyard-config.ts          # reads backend/.env
 *   npx tsx src/scripts/stableyard-config.ts --raw    # dump the whole payload
 */

const WANT_SOURCES: Record<string, string> = {
  "10001": "Bitcoin (BTC)",
  "728126428": "Tron (USDT)",
  "1": "Ethereum (USDC/USDT/ETH)",
};
const WANT_DESTINATION = "10002"; // Movement — USDCx

async function main() {
  const { STABLEYARD_BASE_URL: base, STABLEYARD_APP_ID: id, STABLEYARD_APP_SECRET: secret } = env;

  if (!id || !secret) {
    console.log("STABLEYARD_APP_ID / STABLEYARD_APP_SECRET are not set in backend/.env.");
    console.log("Add them (staging keys are fine) and run this again.");
    return;
  }

  /**
   * Named, not blocked.
   *
   * Our credential is a production one - there is no staging app - so refusing
   * to reach prod would just mean never reading the config. This call only
   * reads our own configuration and creates nothing.
   *
   * The line that matters is the next one: anything that CREATES a UPA, a
   * deposit address or a payment against these keys is real, and belongs
   * behind an explicit --yes the way flw-bill-buy and sweep-settle are.
   */
  if (base.includes("prod-api")) {
    console.log("PRODUCTION credentials — this call is read-only and creates nothing.\n");
  }

  console.log(`GET ${base}/v2/partners/config`);
  const res = await fetch(`${base}/v2/partners/config`, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    console.log(`\nHTTP ${res.status}`);
    console.log(text.slice(0, 800));
    return;
  }

  const body: any = JSON.parse(text);
  if (process.argv.includes("--raw")) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  const cfg = body?.data ?? body;

  const money = (n: any) => (n === undefined || n === null ? "?" : String(n));

  console.log("\n── who we are ──");
  console.log(`  namespace ${cfg.namespace}  status ${cfg.status}  mode ${cfg.credentialMode}`);
  console.log(`  scopes    ${(cfg.scopes ?? []).join(", ")}`);

  const fees = cfg.fees ?? {};
  console.log(
    `\n── fees ──\n  platform ${money(fees.platformFeePercent)}%  partner ${money(
      fees.partnerFeePercent
    )}%  total ${money(fees.totalFeePercent)}%  (${fees.model})`
  );

  console.log("\n── modules ──");
  for (const m of cfg.modules ?? []) {
    console.log(
      `  ${String(m.id).padEnd(20)} ${m.available ? "available" : "UNAVAILABLE"}` +
        (m.disabledReason ? `  (${m.disabledReason})` : "")
    );
  }

  /**
   * Payment methods, which is where routing actually lives.
   *
   * Not on the network objects, where a first reading of the docs would put
   * it - "routing" is a payment METHOD, and its runtime state is the single
   * thing that decides whether a BTC deposit can become USDCx.
   */
  const methods = cfg.capabilities?.payments?.methods ?? {};
  console.log("\n── payment methods ──");
  for (const [name, m] of Object.entries<any>(methods)) {
    console.log(
      `  ${name.padEnd(12)} entitled=${m.entitled} operational=${m.operational} available=${m.available}` +
        (m.disabledReason ? `  (${m.disabledReason})` : "")
    );
  }

  const da = cfg.capabilities?.depositAddresses ?? {};
  const available: number[] = da.availableChainIds ?? [];
  const supported: number[] = da.supportedChainIds ?? [];

  console.log("\n── the chains we want ──");
  const networks: any[] = cfg.networks ?? [];
  const byId = new Map(networks.map((n) => [Number(n.chainId), n]));

  const report = (cid: string, label: string) => {
    const n = byId.get(Number(cid));
    if (!n) {
      console.log(`  ${label.padEnd(26)} NOT in config`);
      return;
    }
    const d = n.depositAddresses ?? {};
    const live = available.includes(Number(cid));
    console.log(
      `  ${label.padEnd(26)} deposits=${d.supported ? "supported" : "no"} ` +
        `operational=${d.operational} ${live ? "LIVE" : "not available yet"}` +
        (d.disabledReason ? `  (${d.disabledReason})` : "")
    );
    for (const a of n.supportedAssets ?? []) {
      console.log(
        `       ${String(a.symbol).padEnd(6)} min ${a.minimumDeposit?.amount ?? "?"}` +
          `${a.minimumDeposit?.inclusive ? " (inclusive)" : ""}  ${a.tokenAddress}`
      );
    }
  };

  for (const [cid, label] of Object.entries(WANT_SOURCES)) report(cid, label);
  report(WANT_DESTINATION, "Movement (destination)");

  const move = byId.get(Number(WANT_DESTINATION));
  console.log(
    `\n  Movement settlement: ${move?.settlement?.supported ? "YES" : "NO"}` +
      `   default asset: ${move?.defaultAsset?.tokenAddress ?? "?"}`
  );
  console.log(`  deposit chains live now: ${available.join(", ")}`);
  console.log(`  supported but not live : ${supported.filter((c) => !available.includes(c)).join(", ")}`);

  console.log("\n(Run with --raw to see the whole payload, including fees.)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
