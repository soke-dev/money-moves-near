/**
 * Is the Paystack rail actually able to pay, before we trust it with a sell?
 *
 * Everything here is read-only. The point is to answer the questions that
 * otherwise only get answered by a real payout failing: does the key work, is
 * there naira behind it, can it see the banks, and does it resolve an account.
 *
 * Run: npx tsx src/scripts/paystack-preflight.ts [bankName] [accountNumber]
 */
import "dotenv/config";
import { psListBanks, psBankCodeByName, psResolveAccount } from "../lib/paystack";

const key = process.env.PAYSTACK_SECRET_KEY || "";

async function get(path: string): Promise<any> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  return res.json();
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString()}`;

(async () => {
  console.log("");

  // ── the key ──
  if (!key) {
    console.log("  key        ✗ PAYSTACK_SECRET_KEY is not set here");
    process.exit(1);
  }
  const mode = key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "TEST" : "unknown";
  console.log(`  key        ${mode === "live" ? "✓" : "!"} ${mode} mode`);
  if (mode === "TEST") {
    console.log("             a test key reports healthy and never moves real money");
  }

  // ── the balance, which is what a payout draws on ──
  const bal = await get("/balance");
  if (!bal?.status) {
    console.log(`  balance    ✗ ${bal?.message || "could not read"}`);
  } else {
    const ngn = (bal.data || []).find((b: any) => b.currency === "NGN");
    console.log(
      ngn
        ? `  balance    ${ngn.balance > 0 ? "✓" : "✗"} ${naira(ngn.balance)} NGN`
        : "  balance    ✗ no NGN balance on this account",
    );
  }

  // ── the bank list, which every payout resolves against ──
  const banks = await psListBanks();
  console.log(`  banks      ${banks.length > 0 ? "✓" : "✗"} ${banks.length} listed`);

  // ── whether OTP is off, which no endpoint will tell us ──
  const transfers = await get("/transfer?perPage=5");
  const recent = transfers?.data || [];
  const stuck = recent.filter((t: any) => t.status === "otp").length;
  console.log(
    recent.length === 0
      ? "  otp        ? no transfers yet — only a real one proves OTP is off"
      : stuck > 0
      ? `  otp        ✗ ${stuck} of the last ${recent.length} transfers are waiting on an OTP`
      : `  otp        ✓ none of the last ${recent.length} transfers waited on an OTP`,
  );

  // ── an account, if one was named ──
  const [bankName, accountNumber] = process.argv.slice(2);
  if (bankName && accountNumber) {
    const code = await psBankCodeByName(bankName);
    if (!code) {
      console.log(`  resolve    ✗ no Paystack code for "${bankName}"`);
    } else {
      const r = await psResolveAccount(code, accountNumber);
      console.log(
        r.ok
          ? `  resolve    ✓ ${code} ${accountNumber} → ${r.accountName}`
          : `  resolve    ✗ ${r.error}`,
      );
    }
  } else {
    console.log("  resolve    – pass a bank name and account number to test one");
  }

  console.log("");
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
