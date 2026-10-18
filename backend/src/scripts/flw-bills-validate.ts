import "dotenv/config";
import { env } from "../config/env";
const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;

async function call(path: string, init?: RequestInit) {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const b: any = await r.json().catch(() => null);
  return { status: r.status, body: b };
}

(async () => {
  const [item, biller, customer] = process.argv.slice(2);
  console.log(`\nvalidating ${customer} against ${biller}/${item}\n`);

  const shapes = [
    { label: "GET  /bill-items/{item}/validate", path: `/bill-items/${item}/validate?code=${biller}&customer=${encodeURIComponent(customer)}` },
    { label: "POST /bills/validate", path: `/bills/validate`, init: { method: "POST", body: JSON.stringify({ item_code: item, code: biller, customer }) } },
  ];

  for (const s of shapes) {
    const r = await call(s.path, s.init as RequestInit);
    console.log(`  ${String(r.status).padEnd(4)} ${s.label}`);
    console.log(`       ${JSON.stringify(r.body).slice(0, 260)}`);
  }
  console.log("");
})();
