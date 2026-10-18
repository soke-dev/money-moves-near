/**
 * Would a Flutterwave bank code, handed to Paystack, be rejected or obeyed?
 *
 * The payout path resolves a code from the bank name at send time but falls
 * back to a stored one. That fallback is safe while there is a single
 * provider and stops being safe the moment there are two - if a code minted
 * by one provider is a VALID code at the other for a DIFFERENT institution,
 * the fallback does not fail, it pays the wrong bank.
 *
 * This asks the question directly for every bank the app offers.
 *
 * Run: npx tsx src/scripts/bank-collisions.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { flwListBanks, flwBankCodeByName } from "../lib/flutterwave";


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
  const psByCode = new Map(ps.map((b) => [String(b.code), b.name]));
  const flwByCode = new Map(flw.map((b) => [String(b.code), b.name]));

  const misdirect: string[] = [];
  const rejected: string[] = [];

  for (const name of OURS) {
    const f = await flwBankCodeByName(name);
    if (!f) continue;

    const atPaystack = psByCode.get(String(f));
    if (!atPaystack) {
      rejected.push(`${name.padEnd(30)} flw ${f} -> Paystack has no such code`);
      continue;
    }

    const flwName = flwByCode.get(String(f)) || name;
    // Same code, and both lists agree it is the same institution: harmless.
    const sameInstitution =
      atPaystack.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6) ===
      flwName.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6);

    if (sameInstitution) continue;

    misdirect.push(
      `${name.padEnd(28)} code ${String(f).padEnd(8)} FLW "${flwName}"  ->  PAYSTACK "${atPaystack}"`,
    );
  }

  console.log("\n══ A Flutterwave code that Paystack would OBEY, for a different bank ══");
  if (misdirect.length === 0) console.log("  none");
  misdirect.forEach((m) => console.log("  " + m));

  console.log(`\n══ Flutterwave codes Paystack would simply reject (${rejected.length}) ══`);
  rejected.slice(0, 40).forEach((r) => console.log("  " + r));
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
