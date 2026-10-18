/**
 * Can this machine use the Flutterwave bills API at all?
 *
 * READ-ONLY. It used to include two create calls, which was safe only for as
 * long as the API refused them - the moment the IP was whitelisted, running it
 * bought two airtime top-ups nobody asked for. A diagnostic that spends money
 * when it starts working is not a diagnostic. Buying lives in flw-bill-buy.ts,
 * which will not move without --yes.
 *
 * The three reads tell the failures apart:
 *   categories  is not account-scoped, so it answers even to a blocked caller
 *   balances    proves the key itself is valid
 *   history     is account-scoped AND behind the bills IP allowlist
 *
 * categories ✓ balances ✓ history ✗  ->  the IP is not whitelisted
 * categories ✓ balances ✗            ->  the key is wrong
 *
 * Run: npx tsx src/scripts/flw-bills-diag.ts
 */
import "dotenv/config";
import { env } from "../config/env";

const base = env.FLW_V3_BASE_URL.replace(/\/$/, "");
const key = env.FLW_V3_SECRET_KEY;

async function read(path: string) {
  const r = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  const b: any = await r.json().catch(() => null);
  return { status: r.status, message: b?.message || "" };
}

(async () => {
  if (!key) {
    console.error("FLW_V3_SECRET_KEY is not set");
    process.exit(1);
  }

  const checks: [string, string][] = [
    ["bill categories (public)", "/bill-categories?country=NG"],
    ["wallet balances (key)", "/balances"],
    ["bill history (key + IP)", "/bills/history"],
  ];

  console.log("");
  const results: Record<string, number> = {};
  for (const [label, path] of checks) {
    const r = await read(path);
    results[label] = r.status;
    console.log(`  ${String(r.status).padEnd(4)} ${label.padEnd(26)} ${r.message.slice(0, 60)}`);
  }

  const [cats, bal, hist] = Object.values(results);
  console.log("");
  if (hist === 200) console.log("  Bills are usable from this machine.\n");
  else if (bal !== 200) console.log("  The secret key is being rejected.\n");
  else if (cats === 200) console.log("  Key is fine; this machine's IP is not on the bills allowlist.\n");
  else console.log("  Cannot reach the API at all.\n");
})();
