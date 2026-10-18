/**
 * Does every bank the app offers resolve on BOTH rails, aliases included?
 *
 * bank-codes.ts shows the raw name gap deliberately, without aliases, so it
 * always lists the ones the alias tables exist to cover. This is the question
 * that actually matters before a switch is thrown: can each provider turn every
 * name the app can send into a code.
 *
 * Run: npx tsx src/scripts/bank-coverage.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { flwBankCodeByName } from "../lib/flutterwave";
import { psBankCodeByName } from "../lib/paystack";

function ours(): string[] {
  const src = fs.readFileSync(path.resolve(__dirname, "../../../constants/transfer.ts"), "utf8");
  const block = src.match(/NIGERIAN_BANKS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) throw new Error("could not find NIGERIAN_BANKS");
  // Strip line comments first: the list is commented, and a comment that
  // quotes a provider's own spelling would otherwise be read as a bank we
  // offer - which is exactly what a note about Smartcash did.
  const entries = block[1].replace(/\/\/[^\n]*/g, "");
  return [...entries.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

(async () => {
  const names = ours();
  const gaps: string[] = [];

  for (const n of names) {
    const [f, p] = await Promise.all([flwBankCodeByName(n), psBankCodeByName(n)]);
    if (!f || !p) gaps.push(`  ${n.padEnd(32)} flw=${f || "—"}  paystack=${p || "—"}`);
  }

  console.log(`\n${names.length} banks offered.`);
  if (gaps.length === 0) {
    console.log("Every one resolves on both rails.\n");
  } else {
    console.log(`\n${gaps.length} cannot be resolved somewhere:`);
    gaps.forEach((g) => console.log(g));
    console.log("");
    process.exitCode = 1;
  }
})();
