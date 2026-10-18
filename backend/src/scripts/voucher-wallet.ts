import "dotenv/config";
import fs from "fs";
import path from "path";
import { Account } from "@aptos-labs/ts-sdk";
import {
  isVoucherTreasuryConfigured,
  voucherTreasuryAddress,
  voucherTreasuryBalance,
} from "../lib/voucher-treasury";

/**
 * Make, or inspect, the wallet vouchers pay out of.
 *
 * The private key is written straight into backend/.env and never printed.
 * A key that passes through a terminal is a key in scrollback, in the shell
 * history, and in whatever is recording the session - and this one can be
 * swept by anybody who reads it.
 *
 *   npx tsx src/scripts/voucher-wallet.ts            what is configured now
 *   npx tsx src/scripts/voucher-wallet.ts --create   make one, write it to .env
 */

const ENV_PATH = path.join(process.cwd(), ".env");

async function show() {
  if (!isVoucherTreasuryConfigured()) {
    console.log("No voucher treasury configured.");
    console.log("Run with --create to make one.");
    return;
  }
  const address = voucherTreasuryAddress();
  const balance = await voucherTreasuryBalance();
  console.log(`address  ${address}`);
  console.log(`balance  ${balance} USDC`);
  console.log(`explorer https://explorer.movementnetwork.xyz/account/${address}`);
  if (balance === 0) {
    console.log("\nEmpty. Send USDC here before turning any voucher on.");
  }
}

async function create() {
  /**
   * Refuses to overwrite.
   *
   * Replacing the key of a funded wallet orphans the money in it - the address
   * is still there, holding USDC nobody can move any more.
   */
  if (isVoucherTreasuryConfigured()) {
    console.log("A voucher treasury is already configured:");
    await show();
    console.log("\nRefusing to replace it. Clear both VOUCHER_TREASURY_ lines");
    console.log("from .env by hand first, and move the balance out before you do.");
    return;
  }
  if (!fs.existsSync(ENV_PATH)) {
    console.log(`No .env at ${ENV_PATH}. Run this from backend/.`);
    return;
  }

  const account = Account.generate();
  const address = account.accountAddress.toString();
  const privateKey = account.privateKey.toString();

  const block =
    `\n# ── Voucher treasury (Movement) ──\n` +
    `# Pays voucher rewards, and nothing else. Keep it apart from the main\n` +
    `# treasury so a giveaway bug cannot reach money people have paid in.\n` +
    `VOUCHER_TREASURY_ADDRESS=${address}\n` +
    `VOUCHER_TREASURY_PRIVATE_KEY=${privateKey}\n`;

  fs.appendFileSync(ENV_PATH, block, "utf8");

  console.log("Voucher treasury created and written to backend/.env.");
  console.log(`\naddress  ${address}`);
  console.log(`explorer https://explorer.movementnetwork.xyz/account/${address}`);
  console.log("\nThe private key was written to .env and is not printed here.");
  console.log("Next:");
  console.log("  1. Send USDC to that address, and a little MOVE for gas.");
  console.log("  2. Set both VOUCHER_TREASURY_ vars on Railway - seal the key.");
}

(process.argv.includes("--create") ? create() : show()).catch((e) =>
  console.error(e?.message ?? e),
);
