import "dotenv/config";
import { env } from "../config/env";
const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;
const get = async (p: string) => {
  const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${key}` } });
  return r.json() as any;
};
(async () => {
  const all = (await get("/bill-categories")).data as any[];
  const ng = all.filter((i) => i.country === "NG");

  console.log("\n══ airtime, by the is_airtime flag rather than by name ══");
  for (const i of ng.filter((x) => x.is_airtime))
    console.log(`  ${i.biller_code.padEnd(9)} ${i.item_code.padEnd(9)} ${String(i.name).slice(0,40).padEnd(40)} amt=${i.amount} comm=${i.default_commission}`);

  console.log("\n══ every distinct biller, NG ══");
  const seen = new Map<string, any>();
  for (const i of ng) if (!seen.has(i.biller_code)) seen.set(i.biller_code, i);
  for (const [code, i] of [...seen.entries()].sort())
    console.log(`  ${code.padEnd(9)} ${String(i.biller_name).slice(0,44).padEnd(44)} asks:${String(i.label_name).padEnd(16)} n=${ng.filter(x=>x.biller_code===code).length}`);

  console.log("\n══ /billers (the other endpoint) ══");
  const b = (await get("/billers")).data;
  console.log(JSON.stringify(b, null, 1).slice(0, 900));
})();
