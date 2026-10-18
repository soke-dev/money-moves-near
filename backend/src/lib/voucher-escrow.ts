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
 * The wallet that holds other people's money.
 *
 * A user voucher is funded from the creator's own balance, and that money sits
 * here until somebody claims it or it goes back. Deliberately NOT the promo
 * treasury: that one holds money we chose to give away, and a bug there costs
 * us a float. A bug here costs somebody their own USDC, which is a different
 * kind of wrong and deserves a different wallet.
 *
 * Keeping them apart also makes the one number that matters computable. What
 * this address holds should equal what we owe - unclaimed slices plus refunds
 * not yet sent - and the moment those disagree, something is wrong that no
 * table of ours can reveal, because every table would be wrong together.
 * Mixed in with the promo float that check is impossible.
 *
 * Gas is Shinami's. This wallet only ever holds USDC, so it cannot be full of
 * people's money and unable to move it for want of MOVE.
 */

const aptos = new Aptos(
  new AptosConfig({ network: Network.CUSTOM, fullnode: env.MOVEMENT_RPC_URL }),
);

/** USDC on Movement. The same asset the promo treasury pays in. */
const USDCX_METADATA =
  "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

const DECIMALS = 6;

export function isVoucherEscrowConfigured(): boolean {
  return !!(env.VOUCHER_ESCROW_PRIVATE_KEY && env.VOUCHER_ESCROW_ADDRESS);
}

export function voucherEscrowAddress(): string | null {
  return env.VOUCHER_ESCROW_ADDRESS || null;
}

function account(): Account {
  if (!isVoucherEscrowConfigured()) {
    throw new Error("The voucher escrow wallet is not configured.");
  }
  return Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(env.VOUCHER_ESCROW_PRIVATE_KEY),
    address: env.VOUCHER_ESCROW_ADDRESS,
  });
}

/**
 * What the wallet actually holds, read from the chain.
 *
 * The chain is the only source that cannot be wrong. Reconciliation compares
 * this against what our rows say we owe, so taking it from a table would make
 * the check compare our bookkeeping to itself and always agree.
 */
export async function voucherEscrowBalance(): Promise<number> {
  if (!isVoucherEscrowConfigured()) return 0;
  try {
    const [raw] = await aptos.view<[string]>({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [env.VOUCHER_ESCROW_ADDRESS, USDCX_METADATA],
      },
    });
    return Number(raw) / 10 ** DECIMALS;
  } catch (e: any) {
    console.error("[ESCROW] could not read balance:", e?.message);
    return 0;
  }
}

/**
 * The transaction a creator has to sign to fund their voucher.
 *
 * Built here and signed on their device: the server has no access to anybody's
 * key, which is the whole reason this is a two-step flow rather than one call.
 * `withFeePayer` leaves the payer empty for Shinami, so the transaction cannot
 * be submitted any other way - it is sponsored or it does not happen.
 */
export async function buildFundingTransaction(args: {
  fromAddress: string;
  amount: number;
  /** Seconds the signed transaction stays valid. Matches the prepare's own TTL. */
  ttlSeconds?: number;
}) {
  if (!isVoucherEscrowConfigured()) {
    throw new Error("The voucher escrow wallet is not configured.");
  }
  if (!(args.amount > 0)) throw new Error("A voucher needs more than nothing in it.");

  const units = BigInt(Math.floor(args.amount * 10 ** DECIMALS));
  if (units <= 0n) throw new Error("That amount rounds to nothing at six decimals.");

  /**
   * Twenty seconds is the SDK default and it is not enough here.
   *
   * Between building this and the person signing it there is a whole review
   * screen - the split, the code, a look at the numbers - and a transaction
   * that expired while they read it fails at submission with nothing on screen
   * to explain why. The window matches how long the prepare itself lives, so
   * the two cannot disagree.
   */
  const ttl = args.ttlSeconds ?? 600;

  return aptos.transaction.build.simple({
    sender: args.fromAddress,
    withFeePayer: true,
    data: {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [USDCX_METADATA, env.VOUCHER_ESCROW_ADDRESS, units],
    },
    options: { expireTimestamp: Math.floor(Date.now() / 1000) + ttl },
  });
}

/**
 * Send money out of escrow: a claim, or a refund going home.
 *
 * Returns a hash or throws. There is no third outcome, because a payout
 * recorded on anything weaker than a hash is a payout that can happen twice -
 * and on this wallet that means paying somebody with money that belongs to
 * somebody else.
 *
 * A confirmation that times out carries the hash on the error. Past broadcast
 * the transfer exists whatever happens here, so a caller that records failure
 * without the hash has thrown away the only way to find out whether the money
 * actually moved.
 */
export async function sendFromEscrow(
  recipientAddress: string,
  amount: number,
  what: "claim" | "refund" = "claim",
): Promise<string> {
  if (!(amount > 0)) throw new Error("Nothing to send.");

  const escrow = account();
  const units = BigInt(Math.floor(amount * 10 ** DECIMALS));
  if (units <= 0n) throw new Error("That amount rounds to nothing at six decimals.");

  const transaction = await aptos.transaction.build.simple({
    sender: escrow.accountAddress,
    withFeePayer: true,
    data: {
      function: "0x1::primary_fungible_store::transfer",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [USDCX_METADATA, recipientAddress, units],
    },
  });

  const senderAuth = aptos.transaction.sign({ signer: escrow, transaction });
  const rawTxHex = Buffer.from(transaction.rawTransaction.bcsToBytes()).toString("hex");
  const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");

  const sponsored = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [
    rawTxHex,
    senderAuthHex,
  ]);
  const hash: string = sponsored?.pendingTransaction?.hash || sponsored?.hash || sponsored;
  if (!hash || typeof hash !== "string") {
    throw new Error(`Shinami returned no transaction hash: ${JSON.stringify(sponsored)}`);
  }

  try {
    const result = await aptos.waitForTransaction({
      transactionHash: hash,
      options: { timeoutSecs: 60, checkSuccess: true },
    });
    console.log(`[ESCROW] ${what} of ${amount} USDC to ${recipientAddress}: ${result.hash}`);
    return result.hash as string;
  } catch (e: any) {
    e.txHash = hash;
    throw e;
  }
}

/**
 * Submit a funding transaction the creator signed on their device.
 *
 * Separate from sendFromEscrow because the signer is different: there the
 * escrow wallet signs its own transfer, here the person does, and we only
 * relay it to Shinami for sponsorship.
 */
export async function submitSignedFunding(
  rawTxHex: string,
  senderAuthHex: string,
): Promise<string> {
  const sponsored = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [
    rawTxHex,
    senderAuthHex,
  ]);
  const hash: string = sponsored?.pendingTransaction?.hash || sponsored?.hash || sponsored;
  if (!hash || typeof hash !== "string") {
    throw new Error(`Shinami returned no transaction hash: ${JSON.stringify(sponsored)}`);
  }

  /**
   * Waited for, not assumed.
   *
   * The voucher is created off the back of this, so a broadcast that never
   * lands would leave an ACTIVE voucher with nothing behind it - people
   * claiming money that was never put in. Confirmation is the gate.
   */
  const result = await aptos.waitForTransaction({
    transactionHash: hash,
    options: { timeoutSecs: 60, checkSuccess: true },
  });
  return result.hash as string;
}
