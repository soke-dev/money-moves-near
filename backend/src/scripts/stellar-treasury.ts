/**
 * The Stellar treasury: create it, check it, give it its trustlines.
 *
 * The treasury pays every Stellar fee (a fee bump over the user's own signed
 * transaction) and sponsors the reserve each new account and trustline locks,
 * so users never hold XLM. It is an ordinary mainnet account holding XLM, and
 * by default it is also where Stellar sells and bill payments land.
 *
 *   npx tsx src/scripts/stellar-treasury.ts --new           make a keypair
 *   npx tsx src/scripts/stellar-treasury.ts                 status, read-only
 *   npx tsx src/scripts/stellar-treasury.ts --setup --yes   add the USDC and USDT0 trustlines
 *
 * --new writes the secret to backend/.env.stellar-treasury.local (gitignored)
 * and prints only the address: the secret never goes to the screen, where it
 * would end up in scrollback and logs. Copy it from that file into Railway as
 * STELLAR_TREASURY_SECRET and into backend/.env, then delete the file.
 *
 * Everything else reads STELLAR_TREASURY_SECRET from the environment or
 * backend/.env, falling back to that file.
 */
// Before the check below, which otherwise runs ahead of anything that loads it.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";

const LOCAL_FILE = path.join(__dirname, "../../.env.stellar-treasury.local");
const args = process.argv.slice(2);

/** What one user costs the treasury in locked reserve, in XLM. */
const FIRST_COIN_XLM = 1.5; // the account (2 x 0.5) plus its first trustline
const SECOND_COIN_XLM = 0.5;

function readLocalSecret(): string {
  try {
    const m = fs.readFileSync(LOCAL_FILE, "utf8").match(/^STELLAR_TREASURY_SECRET=(S[A-Z2-7]{55})\s*$/m);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

(async () => {
  if (args.includes("--new")) {
    if (fs.existsSync(LOCAL_FILE)) {
      console.error(`${LOCAL_FILE} already exists. Not overwriting a key that may already hold XLM.`);
      process.exit(1);
    }
    const kp = Keypair.random();
    fs.writeFileSync(LOCAL_FILE, `STELLAR_TREASURY_SECRET=${kp.secret()}\n`, { mode: 0o600 });
    console.log(`Treasury address: ${kp.publicKey()}`);
    console.log(`Secret written to: ${LOCAL_FILE}`);
    console.log("\nNext: send XLM to the address above (no memo), then run this script again for status.");
    return;
  }

  if (!process.env.STELLAR_TREASURY_SECRET) process.env.STELLAR_TREASURY_SECRET = readLocalSecret();
  if (!process.env.STELLAR_TREASURY_SECRET) {
    console.error("No treasury secret: set STELLAR_TREASURY_SECRET, or run with --new first.");
    process.exit(1);
  }

  // Loaded only now, so it sees the secret set above.
  const stellar = await import("../lib/stellar");
  const address = stellar.treasuryAddress()!;
  console.log(`Network:   ${stellar.STELLAR_PASSPHRASE.startsWith("Public") ? "PUBLIC (mainnet)" : "TESTNET"}`);
  console.log(`Treasury:  ${address}`);

  let status;
  try {
    status = await stellar.treasuryStatus();
  } catch (err: any) {
    if (err?.response?.status === 404 || err?.name === "NotFoundError") {
      console.log("\nNot funded yet: the account does not exist on chain until it receives XLM.");
      console.log("Send XLM to the address above (an exchange withdrawal works; no memo needed).");
      return;
    }
    throw err;
  }

  console.log(`XLM:       ${status.xlm.toFixed(4)}  (spendable ${status.spendableXlm.toFixed(4)})`);
  console.log(`Sponsoring ${status.sponsoring} reserve entries for users`);
  console.log(`Trustlines USDC ${status.trust.USDC ? "yes" : "NO"}, USDT0 ${status.trust.USDT ? "yes" : "NO"}`);
  console.log(
    `Room for   ~${Math.max(0, Math.floor((status.spendableXlm - stellar.FEE_FLOOR_XLM) / FIRST_COIN_XLM))} more users opening Stellar ` +
      `(${FIRST_COIN_XLM} XLM each, +${SECOND_COIN_XLM} for their second coin; ${stellar.FEE_FLOOR_XLM} XLM always kept for fees)`,
  );

  if (!args.includes("--setup")) {
    if (!status.trust.USDC || !status.trust.USDT) {
      console.log("\nSells and bills on Stellar need both trustlines: run again with --setup --yes.");
    }
    return;
  }

  if (!args.includes("--yes")) {
    console.log("\n--setup spends XLM (0.5 reserve per trustline plus a fee). Add --yes to go ahead.");
    return;
  }
  const hash = await stellar.ensureTreasuryTrustlines();
  console.log(hash ? `\nTrustlines added: ${stellar.stellarExplorerUrl(hash)}` : "\nBoth trustlines were already there.");
})().catch((err) => {
  console.error(err?.response?.data?.extras?.result_codes ?? err?.message ?? err);
  process.exit(1);
});
