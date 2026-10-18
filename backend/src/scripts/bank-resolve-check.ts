import "dotenv/config";
import { flwBankCodeByName } from "../lib/flutterwave";
import { psBankCodeByName } from "../lib/paystack";

/**
 * Would both rails find this bank, given the name we would store? Read-only.
 *
 * Our list holds names, not codes, and each provider turns a name into its own
 * code at payout time. A name that only one of them can match is a bank that
 * works until the payout switch is thrown - so a candidate is checked against
 * both before it is offered to anybody.
 *
 *   npx tsx src/scripts/bank-resolve-check.ts "Smartcash Payment Service Bank"
 */

(async () => {
  const names = process.argv.slice(2);
  if (!names.length) {
    console.log('Usage: bank-resolve-check.ts "Bank Name" ["Another"]');
    return;
  }

  for (const name of names) {
    const [flw, ps] = await Promise.all([
      flwBankCodeByName(name).catch((e) => `ERROR: ${e.message}`),
      psBankCodeByName(name).catch((e) => `ERROR: ${e.message}`),
    ]);

    const agree = flw && ps && String(flw) === String(ps);
    console.log(`"${name}"`);
    console.log(`   Flutterwave  ${flw ?? "NOT FOUND"}`);
    console.log(`   Paystack     ${ps ?? "NOT FOUND — needs a PS_NAME_ALIASES entry"}`);
    console.log(
      `   verdict      ${
        !flw
          ? "unusable: the funding/default rail cannot find it"
          : !ps
            ? "half-usable: works on Flutterwave, fails the moment payouts switch to Paystack"
            : agree
              ? "both rails, same code"
              : "both rails, different codes (fine — each is asked separately)"
      }`
    );
    console.log("");
  }
})();
