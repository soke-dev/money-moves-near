/**
 * What does each provider actually call the banks we cannot match?
 *
 * Companion to bank-codes.ts. Given a fragment, prints every bank on both
 * lists whose name contains it, so an alias can be written from what the
 * provider really says rather than from what we assume it says.
 *
 * Run: npx tsx src/scripts/bank-search.ts moniepoint rubies taj
 */
import "dotenv/config";
import { flwListBanks } from "../lib/flutterwave";

async function paystackBanks(): Promise<{ name: string; code: string }[]> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");
  const res = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=200", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body: any = await res.json();
  if (!body?.status) throw new Error(`Paystack: ${body?.message || res.status}`);
  return body.data;
}

(async () => {
  const terms = process.argv.slice(2).map((t) => t.toLowerCase());
  if (terms.length === 0) {
    console.error("give me one or more fragments to look for");
    process.exit(1);
  }

  const [flw, ps] = await Promise.all([flwListBanks("NG"), paystackBanks()]);

  for (const term of terms) {
    console.log(`\n══ "${term}" ══`);

    const f = flw.filter((b) => b.name.toLowerCase().includes(term));
    const p = ps.filter((b) => b.name.toLowerCase().includes(term));

    console.log(`  Flutterwave (${f.length}):`);
    f.slice(0, 8).forEach((b) => console.log(`    ${String(b.code).padEnd(9)} ${b.name}`));
    if (f.length === 0) console.log("    — nothing —");

    console.log(`  Paystack (${p.length}):`);
    p.slice(0, 8).forEach((b) => console.log(`    ${String(b.code).padEnd(9)} ${b.name}`));
    if (p.length === 0) console.log("    — nothing —");
  }
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
