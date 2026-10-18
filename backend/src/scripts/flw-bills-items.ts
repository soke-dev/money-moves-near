import "dotenv/config";
import { env } from "../config/env";
const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;
(async () => {
  const r = await fetch(`${base}/bill-categories`, { headers: { Authorization: `Bearer ${key}` } });
  const all = ((await r.json()) as any).data as any[];
  const want = process.argv.slice(2);
  for (const code of want) {
    const items = all.filter((i) => i.biller_code === code && i.country === "NG");
    console.log(`\n${code} — ${items.length} item(s)`);
    for (const i of items.slice(0, 30))
      console.log(`  ${i.item_code.padEnd(10)} ${String(i.name).slice(0, 44).padEnd(44)} ${i.amount ? "₦" + i.amount : "(open)"}  fee=${i.fee} comm=${i.default_commission}`);
  }
  console.log("");
})();
