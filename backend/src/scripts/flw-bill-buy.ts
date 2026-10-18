/**
 * Buy one bill on Flutterwave v3, deliberately.
 *
 * This SPENDS REAL MONEY, so it refuses to run without --yes and prints
 * exactly what it is about to do first. It exists to prove the create shape
 * end to end before a client is written around it: the docs describe a body
 * the v3 API has changed more than once, and discovering that from a failed
 * user purchase is the expensive way to learn it.
 *
 * Run: npx tsx src/scripts/flw-bill-buy.ts BIL099 AT099 08012345678 100 --yes
 */
import "dotenv/config";
import { env } from "../config/env";

const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const body: any = await res.json().catch(() => null);
  return { status: res.status, body };
}

(async () => {
  const [biller, item, customer, amountArg] = process.argv.slice(2);
  const yes = process.argv.includes("--yes");
  const amount = Number(amountArg);

  if (!biller || !item || !customer || !amount) {
    console.error("usage: <billerCode> <itemCode> <customer> <amount> --yes");
    process.exit(1);
  }

  const reference = `MMTEST${Date.now()}`;
  console.log(`\n  biller     ${biller}\n  item       ${item}\n  customer   ${customer}\n  amount     ₦${amount}\n  reference  ${reference}\n`);

  if (!yes) {
    console.log("  Dry run. Pass --yes to actually buy this.\n");
    return;
  }

  const r = await call(`/billers/${biller}/items/${item}/payment`, {
    method: "POST",
    body: JSON.stringify({ country: "NG", customer_id: customer, amount, reference }),
  });

  console.log(`  POST  ${r.status}`);
  console.log(`  ${JSON.stringify(r.body, null, 2).slice(0, 900)}\n`);

  // Status, by both handles the API might accept.
  for (const handle of [reference, r.body?.data?.tx_ref].filter(Boolean)) {
    const s = await call(`/bills/${encodeURIComponent(handle)}`);
    console.log(`  GET /bills/${handle} -> ${s.status}`);
    console.log(`  ${JSON.stringify(s.body).slice(0, 500)}\n`);
  }
})();
