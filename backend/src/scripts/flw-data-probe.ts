/**
 * Is it MTN data, or all data?
 *
 * Airtime buys on this account and data does not, with a bare "Transaction
 * Failed" that names no field. The codes check out against the live catalogue,
 * so the next question is whether the failure follows the network or the whole
 * product. One cheapest plan per network, stopping at the FIRST SUCCESS so this
 * costs one purchase at most.
 */
import "dotenv/config";
import { env } from "../config/env";

const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;
const BILLERS: [string, string][] = [
  ["MTN", "BIL108"],
  ["Airtel", "BIL110"],
  ["Glo", "BIL109"],
  ["9Mobile", "BIL111"],
];

(async () => {
  const r = await fetch(`${base}/bill-categories?country=NG`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const all: any[] = ((await r.json()) as any).data;

  console.log("");
  for (const [network, biller] of BILLERS) {
    const items = all
      .filter((i) => i.biller_code === biller && i.amount > 0)
      .sort((a, b) => a.amount - b.amount);
    if (!items.length) {
      console.log(`  --   ${network.padEnd(8)} no items`);
      continue;
    }

    const cheapest = items[0];
    const reference = `MMPROBE${Date.now()}`;
    const res = await fetch(`${base}/billers/${biller}/items/${cheapest.item_code}/payment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        country: "NG",
        customer_id: "08012345678",
        amount: cheapest.amount,
        reference,
      }),
    });
    const b: any = await res.json().catch(() => null);

    console.log(
      `  ${String(res.status).padEnd(4)} ${network.padEnd(8)} ${cheapest.item_code.padEnd(7)} NGN${String(cheapest.amount).padEnd(7)} ${b?.message || ""}`,
    );

    if (res.status < 300 && b?.status !== "error") {
      console.log(`\n  ${network} data WORKS. So the failure is per-network, not the product.\n`);
      return;
    }
  }
  console.log("\n  Every network's data failed — the product is not available on this account.\n");
})();
