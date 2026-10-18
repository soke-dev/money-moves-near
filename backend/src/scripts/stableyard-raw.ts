import "dotenv/config";
import { sy } from "../lib/stableyard";

/**
 * One Stableyard call, printed whole.
 *
 * For learning response shapes without guessing. A POST here is real, so it is
 * only ever used with an idempotency key that makes replaying it the same
 * request rather than a second one.
 *
 *   npx tsx src/scripts/stableyard-raw.ts GET /v2/accounts
 *   npx tsx src/scripts/stableyard-raw.ts POST /v2/accounts '{"externalUserId":"x","subjectType":"individual"}' upa-x
 */

(async () => {
  const method = (process.argv[2] || "GET").toUpperCase() as "GET" | "POST" | "PUT";
  const path = process.argv[3];
  const body = process.argv[4] ? JSON.parse(process.argv[4]) : undefined;
  const key = process.argv[5];

  if (!path) {
    console.log("Usage: stableyard-raw.ts <METHOD> <path> [jsonBody] [idempotencyKey]");
    return;
  }

  const r = await sy(method, path, body, key);
  console.log(`status ${r.status}  ok ${r.ok}`);
  if (r.error) console.log(`error  ${r.error}`);
  console.log(JSON.stringify(r.data, null, 2));
})();
