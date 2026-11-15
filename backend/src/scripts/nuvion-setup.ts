/**
 * Nuvion set-up for cards.
 *
 *   npx ts-node src/scripts/nuvion-setup.ts          read only: what exists, and what is missing
 *   npx ts-node src/scripts/nuvion-setup.ts --yes    also creates what is missing
 *
 * Creates, once each:
 *   - "MM card float"     USD account that pays every top up  -> NUVION_FLOAT_ACCOUNT_ID
 *   - "MM card deposits"  USDC account with a Solana wallet   -> NUVION_DEPOSIT_SOL
 *   - ourselves as a counterparty, for book transfers         -> NUVION_COUNTERPARTY_ID
 *
 * Needs NUVION_API_KEY in the environment (production; NUVION_BASE_URL=https://api.nuvion.dev for sandbox) in the
 * environment. Moves no money. Prints the values to set on Railway.
 */
const KEY = process.env.NUVION_API_KEY;
const BASE = process.env.NUVION_BASE_URL || "https://api.nuvion.co";
const WRITE = process.argv.includes("--yes");

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.status === "error") throw new Error(`${method} ${path}: ${res.status} ${json?.type || ""} ${json?.message || ""}`);
  return json?.data ?? json;
}

async function accountNamed(name: string, currency: string) {
  const data = await call("GET", `/accounts?currency=${currency}&display_name=${encodeURIComponent(name)}&limit=20`);
  const list: any[] = Array.isArray(data) ? data : data?.data || [];
  return list.find((a) => a.display_name === name) || null;
}

async function main() {
  if (!KEY) throw new Error("Set NUVION_API_KEY first");
  console.log(`Nuvion at ${BASE} (${WRITE ? "will create what is missing" : "read only; add --yes to create"})\n`);

  const all = await call("GET", "/accounts?limit=100");
  const list: any[] = Array.isArray(all) ? all : all?.data || [];
  console.log(`${list.length} account(s):`);
  for (const a of list) console.log(`  ${a.id}  ${a.currency}  ${a.display_name}  available ${a.balance?.available ?? "?"}`);
  console.log("");

  // Float.
  let float = await accountNamed("MM card float", "USD");
  if (!float && WRITE) float = (await call("POST", "/accounts", { type: "checking", currency: "USD", display_name: "MM card float" })).account;
  console.log(float ? `NUVION_FLOAT_ACCOUNT_ID=${float.id}` : "missing: MM card float (USD)");

  // Deposits, with a Solana wallet.
  let deposits = await accountNamed("MM card deposits", "USC");
  if (!deposits && WRITE) deposits = (await call("POST", "/accounts", { type: "checking", currency: "USC", display_name: "MM card deposits" })).account;
  if (deposits) {
    const full = await call("GET", `/accounts/${deposits.id}`);
    let sol = (full?.account_details || []).find((d: any) => d.chain === "sol");
    if (!sol && WRITE) sol = (await call("POST", "/account-details", { account_id: deposits.id, chain: "sol" })).account_details;
    if (sol) console.log(`NUVION_DEPOSIT_SOL=${sol.account_number}   (status ${sol.status})`);
    else console.log("missing: Solana wallet on MM card deposits");
  } else console.log("missing: MM card deposits (USC)");

  // Ourselves as a counterparty.
  const cps = await call("GET", "/counterparties?limit=100");
  const cpList: any[] = Array.isArray(cps) ? cps : cps?.data || cps?.counterparties || [];
  let me = cpList.find((c) => c.nickname === "MM card accounts");
  if (!me && WRITE) {
    me = await call("POST", "/counterparties", {
      type: "business",
      nickname: "MM card accounts",
      profile: {
        legal_name: "Movers Digital Technologies Ltd",
        relationship: "own account",
        email: "ava@usemoneymoves.xyz",
        registered_address: {
          line1: "20A Etete, off Adesuwa Road, GRA",
          city: "Benin City",
          state_or_province: "Edo",
          country: "NG",
        },
        identification: [{ type: "L", number: "RC 9567817", issuing_country: "NG" }],
      },
    });
  }
  console.log(me ? `NUVION_COUNTERPARTY_ID=${me.id}` : "missing: counterparty MM card accounts");

  if (float) {
    const fee = await call("GET", `/card-creation-fee/${float.id}?currency=USD`).catch((e) => ({ error: e.message }));
    console.log(`\nCard creation fee: ${JSON.stringify(fee)}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
