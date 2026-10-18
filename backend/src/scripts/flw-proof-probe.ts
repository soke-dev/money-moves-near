import "dotenv/config";
import { getFlutterwaveToken } from "../lib/flutterwave";
import { env } from "../config/env";

/**
 * Where does the dashboard get "Proof" from? Read-only.
 *
 * GET /transfers/{id} carries no session id on any settled transfer we have -
 * payment_information and extra_information come back empty every time - yet
 * the dashboard shows one. This tries the endpoints it could plausibly live
 * behind. Every call is a GET; nothing here moves money.
 *
 *   npx tsx src/scripts/flw-proof-probe.ts trf_GNqcM7QlceK7BHu0PWi5h
 */

// The same base the library uses, rather than one typed from memory.
const BASE = env.FLUTTERWAVE_BASE_URL.replace(/\/$/, "");

const PATHS = (id: string) => [
  `/transfers/${id}`,
  `/transfers/${id}/proof`,
  `/transfers/${id}/receipt`,
  `/transfers/${id}/events`,
  `/transfers/${id}/status`,
  `/transfers/${id}/retries`,
  `/transfers/${id}?expand=payment_information`,
  `/transfers?reference=${id}`,
];

(async () => {
  const id = process.argv[2];
  if (!id) {
    console.log("Usage: flw-proof-probe.ts <transfer id>");
    return;
  }

  const token = await getFlutterwaveToken();

  for (const path of PATHS(id)) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Trace-Id": `probe-${Date.now()}`,
        },
      });
      const text = await res.text();
      const short = text.length > 400 ? text.slice(0, 400) + "…" : text;
      console.log(`${String(res.status).padEnd(4)} ${path}`);
      if (res.ok) console.log(`      ${short}`);
    } catch (e: any) {
      console.log(`ERR  ${path}  ${e?.message}`);
    }
  }
})();
