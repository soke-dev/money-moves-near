/**
 * Do the two payout providers agree about bank codes?
 *
 * Before Paystack can be a payout provider we have to know what happens to a
 * beneficiary saved under Flutterwave when the switch is thrown. We store the
 * bank NAME and resolve it to a code at payout time, so the question is
 * whether the same name lands on the same code at both providers - and where
 * it does not, whether that is a spelling difference we can alias or a real
 * disagreement about the institution.
 *
 * Run: npx tsx src/scripts/bank-codes.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { flwListBanks, flwBankCodeByName } from "../lib/flutterwave";


type PsBank = { name: string; code: string; slug?: string };

async function paystackBanks(): Promise<PsBank[]> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set");

  const res = await fetch("https://api.paystack.co/bank?country=nigeria&perPage=200", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body: any = await res.json();
  if (!body?.status) throw new Error(`Paystack: ${body?.message || res.status}`);
  return body.data as PsBank[];
}

/** The same shape of matching flwBankCodeByName does, minus the aliases. */
function plainMatch(name: string, banks: { name: string; code: string }[]): string | null {
  const wanted = name.trim().toLowerCase();
  const hit =
    banks.find((b) => b.name.toLowerCase() === wanted) ||
    banks.find((b) => b.name.toLowerCase().includes(wanted)) ||
    banks.find((b) => wanted.includes(b.name.toLowerCase()));
  return hit?.code ?? null;
}

/**
 * The list the app actually offers, read from the app rather than copied.
 *
 * It was copied once, by hand, and the copy was wrong - it said "Moniepoint
 * MFB" where the app says "Moniepoint", invented four banks the app does not
 * offer and missed one it does. Every conclusion drawn from it was therefore
 * about names nobody sends. Parsed at run time so it cannot drift again.
 */
function ours(): string[] {
  const file = path.resolve(__dirname, "../../../constants/transfer.ts");
  const src = fs.readFileSync(file, "utf8");
  const block = src.match(/NIGERIAN_BANKS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error("could not find NIGERIAN_BANKS in " + file);
  // Strip line comments first: the list is commented, and a comment that
  // quotes a provider's own spelling would otherwise be read as a bank we
  // offer - which is exactly what a note about Smartcash did.
  const entries = block[1].replace(/\/\/[^\n]*/g, "");
  return [...entries.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

(async () => {
  const OURS = ours();
  const [flw, ps] = await Promise.all([flwListBanks("NG"), paystackBanks()]);
  console.log(`Flutterwave lists ${flw.length} banks; Paystack lists ${ps.length}.\n`);

  const agree: string[] = [];
  const differ: string[] = [];
  const psMissing: string[] = [];
  const flwMissing: string[] = [];

  for (const name of OURS) {
    const f = await flwBankCodeByName(name);
    const p = plainMatch(name, ps as { name: string; code: string }[]);

    if (!f && !p) {
      flwMissing.push(`${name}  (neither)`);
      continue;
    }
    if (!p) {
      psMissing.push(`${name.padEnd(30)} flw=${f}  paystack=—`);
      continue;
    }
    if (!f) {
      flwMissing.push(`${name.padEnd(30)} flw=—  paystack=${p}`);
      continue;
    }
    if (String(f) === String(p)) agree.push(`${name.padEnd(30)} ${f}`);
    else differ.push(`${name.padEnd(30)} flw=${f}  paystack=${p}`);
  }

  const show = (title: string, rows: string[]) => {
    console.log(`\n── ${title} (${rows.length}) ──`);
    rows.forEach((r) => console.log("  " + r));
  };

  console.log(`Of ${OURS.length} banks the app offers:`);
  show("same code at both", agree);
  show("DIFFERENT code", differ);
  show("Paystack could not match the name", psMissing);
  show("Flutterwave could not match the name", flwMissing);
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
