import "dotenv/config";
import { sy } from "../lib/stableyard";

/**
 * Every chain and asset we could accept, with its live minimum. Read-only.
 *
 * The minimums are the server's, not the documentation's - the docs said Tron
 * USDT was "greater than 3" when the live figure was 100, and it has since
 * moved again. Nothing here should ever be hardcoded from a table.
 *
 *   npx tsx src/scripts/stableyard-assets.ts
 */

(async () => {
  const r = await sy<any>("GET", "/v2/partners/config");
  if (!r.ok) {
    console.log(`failed: ${r.error}`);
    return;
  }

  const cfg = r.data;
  const live: number[] = cfg?.capabilities?.depositAddresses?.availableChainIds ?? [];
  const networks: any[] = cfg?.networks ?? [];

  console.log(
    `${"NETWORK".padEnd(12)}${"CHAIN ID".padEnd(12)}${"ASSET".padEnd(7)}${"MIN".padEnd(12)}KIND`
  );
  console.log("─".repeat(62));

  for (const n of networks) {
    const cid = Number(n.chainId);
    if (!live.includes(cid)) continue; // deposits not available to us
    for (const a of n.supportedAssets ?? []) {
      const min = a.minimumDeposit?.amount ?? "?";
      const inc = a.minimumDeposit?.inclusive ? "" : " (above)";
      console.log(
        `${String(n.code).padEnd(12)}${String(cid).padEnd(12)}${String(a.symbol).padEnd(7)}` +
          `${(min + inc).padEnd(12)}${a.kind}`
      );
    }
  }

  const notLive = (cfg?.capabilities?.depositAddresses?.supportedChainIds ?? []).filter(
    (c: number) => !live.includes(c)
  );
  console.log(`\ndeposit-capable for us : ${live.join(", ")}`);
  console.log(`supported but not live : ${notLive.join(", ")}`);
})();
