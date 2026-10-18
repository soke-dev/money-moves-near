/**
 * What can Flutterwave v3 actually sell us in Nigeria, and under what codes?
 *
 * Bills do not exist in the v4 API the rest of this integration uses, so they
 * run on v3 with the old FLWSECK secret. The published docs name several
 * endpoints loosely, so this asks the live API instead - and prints the real
 * biller and item codes, which are what the implementation has to be written
 * against.
 *
 * The list is not Nigeria-only despite the country filter: Ugandan and Ghanaian
 * billers come back in the same payload, so everything here is filtered on
 * country === "NG" before it is trusted.
 *
 * Read-only. Every call is a GET; nothing here buys anything.
 *
 * Run: npx tsx src/scripts/flw-bills-probe.ts [what]
 *   what: airtime | data | power | cable   (default: a summary of all four)
 */
import "dotenv/config";
import { env } from "../config/env";

const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;

type Item = {
  biller_code: string;
  item_code: string;
  name: string;
  biller_name: string;
  short_name: string;
  country: string;
  is_airtime: boolean;
  amount: number;
  fee: number;
  default_commission: number;
  label_name: string;
};

async function v3(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* a status is still an answer */
  }
  return { status: res.status, body };
}

const GROUPS: Record<string, RegExp> = {
  airtime: /airtime|recharge/i,
  data: /data\s*bundle|data\b|internet/i,
  power: /electric|power|disco|energy|eko|ikeja|abuja|kano|jos|ibadan|enugu|benin|kaduna|yola|portharcourt|ph\b/i,
  cable: /dstv|gotv|startimes|multichoice|showmax|cable|tv\b/i,
};

(async () => {
  if (!key) {
    console.error("FLW_V3_SECRET_KEY is not set");
    process.exit(1);
  }

  console.log(`\nbase ${base}\n`);

  console.log("which paths answer");
  const candidates = ["/bill-categories", "/bill-categories?country=NG", "/bills/categories", "/billers"];
  let all: Item[] = [];
  for (const p of candidates) {
    const r = await v3(p);
    const n = Array.isArray(r.body?.data) ? r.body.data.length : 0;
    console.log(`  ${r.status === 404 ? "—" : r.status < 300 ? "✓" : "?"} ${String(r.status).padEnd(4)} ${p.padEnd(32)} ${n || ""}`);
    if (r.status < 300 && n > all.length) all = r.body.data;
  }

  const ng = all.filter((i) => i.country === "NG");
  console.log(`\n${all.length} items returned, ${ng.length} of them Nigerian.\n`);

  const only = process.argv[2];

  for (const [group, re] of Object.entries(GROUPS)) {
    if (only && only !== group) continue;

    // An item matches on either its own name or its biller's.
    const hits = ng.filter((i) => re.test(i.name || "") || re.test(i.biller_name || ""));

    // One line per biller when summarising, every item when asked for one group.
    const byBiller = new Map<string, Item[]>();
    for (const h of hits) {
      const k = `${h.biller_code}`;
      byBiller.set(k, [...(byBiller.get(k) || []), h]);
    }

    console.log(`── ${group} — ${hits.length} items across ${byBiller.size} billers ──`);

    for (const [code, items] of [...byBiller.entries()].slice(0, only ? 99 : 8)) {
      const first = items[0];
      console.log(
        `  ${code.padEnd(9)} ${String(first.short_name || first.biller_name).slice(0, 38).padEnd(38)} ` +
          `${String(items.length).padStart(3)} item(s)  asks for: ${first.label_name}  comm ${(first.default_commission * 100).toFixed(1)}%`,
      );
      if (only) {
        for (const i of items.slice(0, 40)) {
          console.log(`      ${i.item_code.padEnd(10)} ${String(i.name).slice(0, 46).padEnd(46)} ${i.amount ? "₦" + i.amount : "(open amount)"}`);
        }
      }
    }
    console.log("");
  }
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
