/**
 * How often a settled collection actually names its sender.
 *
 * Read-only. Walks the charges Flutterwave has for this environment and
 * tabulates, per payment method and per originating bank, whether
 * originator_name arrived. That is the number the hold rule depends on: a rail
 * that routinely sends nothing would hold good deposits for no reason.
 *
 * Names are printed, because whether a value is a person or a wallet alias
 * cannot be judged from a length.
 *
 *   npx tsx src/scripts/originator-audit.ts [pages]
 */
import { getFlutterwaveToken, isFlutterwaveConfigured } from "../lib/flutterwave";
import { env } from "../config/env";

const PAGES = Math.max(1, Math.min(Number(process.argv[2]) || 3, 20));

async function get(path: string): Promise<any> {
  const token = await getFlutterwaveToken();
  const res = await fetch(`${env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Trace-Id": crypto.randomUUID(),
    },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) console.log(`  [${res.status}] ${path} ${body?.message ?? ""}`);
  return body;
}

(async () => {
  if (!isFlutterwaveConfigured()) {
    console.error("Flutterwave is not configured here.");
    process.exit(1);
  }

  const rows: any[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const r = await get(`/charges?page=${page}&size=50`);
    const batch = Array.isArray(r?.data) ? r.data : [];
    rows.push(...batch);
    if (batch.length < 50) break;
  }

  console.log(`charges seen: ${rows.length}\n`);
  if (!rows.length) return;

  const byMethod = new Map<string, { total: number; named: number }>();
  const byBank = new Map<string, { total: number; named: number }>();
  const unnamed: any[] = [];

  for (const c of rows) {
    const d = c?.payment_method_details ?? {};
    const method = String(d.type ?? "unknown");
    const bt = d.bank_transfer ?? {};
    const name = typeof bt.originator_name === "string" ? bt.originator_name.trim() : "";
    const bank = String(bt.originator_bank_name ?? "—");

    const m = byMethod.get(method) ?? { total: 0, named: 0 };
    m.total++; if (name) m.named++;
    byMethod.set(method, m);

    if (method === "bank_transfer") {
      const b = byBank.get(bank) ?? { total: 0, named: 0 };
      b.total++; if (name) b.named++;
      byBank.set(bank, b);
      if (!name) unnamed.push({ id: c.id, status: c.status, bank, amount: c.amount });
    }
  }

  const table = (title: string, m: Map<string, { total: number; named: number }>) => {
    console.log(title);
    for (const [k, v] of [...m.entries()].sort((a, b) => b[1].total - a[1].total)) {
      const pct = v.total ? Math.round((v.named / v.total) * 100) : 0;
      console.log(`  ${k.padEnd(24)} ${String(v.named).padStart(4)}/${String(v.total).padEnd(4)}  ${pct}% named`);
    }
    console.log("");
  };

  table("by payment method:", byMethod);
  table("by originating bank (bank_transfer only):", byBank);

  const names = rows
    .map((c) => c?.payment_method_details?.bank_transfer?.originator_name)
    .filter((n: any) => typeof n === "string" && n.trim());
  console.log(`distinct sender names: ${new Set(names).size}`);
  for (const n of [...new Set(names)].slice(0, 25)) console.log(`  ${n}`);

  if (unnamed.length) {
    console.log(`\nbank transfers with NO originator_name: ${unnamed.length}`);
    for (const u of unnamed.slice(0, 15)) console.log(`  ${u.id} ${u.status} ${u.bank} ${u.amount}`);
  } else {
    console.log("\nevery bank transfer carried a sender name");
  }
})().catch((e) => { console.error(e?.message || e); process.exit(1); });
