import { env } from "../config/env";
import {
  Account,
  Aptos,
  AptosConfig,
  Network,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { shinamiRpc } from "./gas-sponsor";

/**
 * The wallet vouchers pay out of, and nothing else.
 *
 * Separate from the main treasury on purpose. That one settles funding - money
 * somebody has already paid for - and a bug in a giveaway must not be able to
 * reach it. Here the blast radius is whatever was put in this wallet: a
 * voucher loop that pays a thousand times empties the float and stops, rather
 * than emptying the float that owes people their deposits.
 *
 * It also makes the accounting legible. What a promotion cost is the balance
 * that left this address, not a line item to be picked out of everything else
 * the treasury did that week.
 *
 * Unconfigured is a valid state: no key means vouchers are off, the same way
 * missing Stableyard credentials mean routed deposits are off. It must never
 * fall back to the main treasury.
 *
 * Gas is Shinami's, not this wallet's. It signs as the sender and Shinami pays
 * the fee, so the float only ever has to hold USDC - a wallet full of rewards
 * and out of MOVE would fail every claim while looking perfectly funded, which
 * is the kind of outage nobody diagnoses quickly.
 */

const aptos = new Aptos(
  new AptosConfig({ network: Network.CUSTOM, fullnode: env.MOVEMENT_RPC_URL }),
);

/** USDC on Movement - the asset the app holds and the one vouchers pay in. */
const USDCX_METADATA =
  "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

const DECIMALS = 6;

export function isVoucherTreasuryConfigured(): boolean {
  return !!(env.VOUCHER_TREASURY_PRIVATE_KEY && env.VOUCHER_TREASURY_ADDRESS);
}

export function voucherTreasuryAddress(): string | null {
  return env.VOUCHER_TREASURY_ADDRESS || null;
}

function account(): Account {
  if (!isVoucherTreasuryConfigured()) {
    throw new Error("Voucher treasury is not configured.");
  }
  return Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(env.VOUCHER_TREASURY_PRIVATE_KEY),
    address: env.VOUCHER_TREASURY_ADDRESS,
  });
}

/**
 * What is left to give away.
 *
 * Read from the chain rather than tracked in a table, because the chain is the
 * only place that cannot be wrong - somebody topping the wallet up by hand, or
 * a send that failed after broadcasting, both leave a table saying something
 * the balance does not.
 */
export async function voucherTreasuryBalance(): Promise<number> {
  if (!isVoucherTreasuryConfigured()) return 0;
  try {
    const [raw] = await aptos.view<[string]>({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [env.VOUCHER_TREASURY_ADDRESS, USDCX_METADATA],
      },
    });
    return Number(raw) / 10 ** DECIMALS;
  } catch (e: any) {
    // A wallet that has never held the asset has no store, which reads as an
    // error rather than a zero. Either way there is nothing to give away.
    console.error("[VOUCHER] balance read failed:", e?.message);
    return 0;
  }
}

/**
 * Pay one voucher.
 *
 * Deliberately does not check the balance first: a read and a send are not one
 * operation, so passing that check proves nothing by the time the transaction
 * lands. The caller reserves against a balance it has already taken, and this
 * either returns a hash or throws - there is no third outcome for it to
 * report, and a claim recorded as paid on anything less than a hash is a claim
 * that can be paid twice.
 */
export async function sendVoucherReward(
  recipientAddress: string,
  amount: number,
): Promise<string> {
  if (!(amount > 0)) throw new Error("A voucher pays more than nothing.");

  const treasury = account();
  const units = BigInt(Math.floor(amount * 10 ** DECIMALS));
  if (units <= 0n) throw new Error("That amount rounds to nothing at six decimals.");

  // withFeePayer leaves the payer as 0x0 for Shinami to fill in. Built this
  // way the transaction cannot be submitted normally - it is sponsored or it
  // is nothing, which is the intent.
  const transaction = await aptos.transaction.build.simple({
    sender: treasury.accountAddress,
    withFeePayer: true,
    data: {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [USDCX_METADATA, recipientAddress, units],
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: treasury, transaction });
  const rawTxHex = Buffer.from(transaction.rawTransaction.bcsToBytes()).toString("hex");
  const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");

  const sponsored = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [
    rawTxHex,
    senderAuthHex,
  ]);
  const hash: string =
    sponsored?.pendingTransaction?.hash || sponsored?.hash || sponsored;
  if (!hash || typeof hash !== "string") {
    throw new Error(`Shinami returned no transaction hash: ${JSON.stringify(sponsored)}`);
  }

  /**
   * Broadcast is not arrival.
   *
   * Past this point the transfer exists on chain whatever happens here, so a
   * confirmation that times out carries the hash on the error - a caller that
   * records a claim as failed without it has lost the only way to find out
   * whether the money actually moved.
   */
  try {
    const result = await aptos.waitForTransaction({
      transactionHash: hash,
      options: { timeoutSecs: 60, checkSuccess: true },
    });
    console.log(`[VOUCHER] paid ${amount} USDC to ${recipientAddress}: ${result.hash}`);
    return result.hash as string;
  } catch (e: any) {
    e.txHash = hash;
    throw e;
  }
}
