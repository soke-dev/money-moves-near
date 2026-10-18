/**
 * Gasless transaction builders for all chains.
 * - Movement: Shinami fee-payer sponsorship (user signs, Shinami pays gas)
 * - Solana:   Treasury fee-payer (user signs transfer, treasury pays SOL gas)
 * - EVM:      Treasury-sponsored gas (fund user wallet, then broadcast) -
 *             Base, BSC, Arbitrum and Monad; Arc pays its own way
 */
import { env } from "../config/env";
import { prisma } from "./prisma";
import {
  Aptos,
  AptosConfig,
  Network,
  AccountAuthenticatorEd25519,
  Ed25519PublicKey,
  Ed25519Signature,
  generateSigningMessageForTransaction,
} from "@aptos-labs/ts-sdk";
import {
  Connection,
  PublicKey,
  Transaction as SolTransaction,
  SystemProgram,
  Keypair,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { ethers } from "ethers";
import bs58 from "bs58";
import {
  Address,
  Cell,
  SendMode,
  beginCell,
  internal as tonInternal,
  storeMessageRelaxed,
  toNano,
} from "@ton/core";
import * as ton from "./ton";

// ═══════════════════════════════════════════════════════════
//  SHARED – In-memory pending transactions (2-min TTL)
// ═══════════════════════════════════════════════════════════
interface PendingTx {
  type: "movement" | "solana" | "evm" | "ton";
  data: any;
  senderAddress: string;
  expiresAt: number;
}
const pendingTxs = new Map<string, PendingTx>();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingTxs) {
    if (entry.expiresAt < now) pendingTxs.delete(id);
  }
}, 60_000);

// ═══════════════════════════════════════════════════════════
//  MOVEMENT – Shinami fee-payer sponsorship (direct REST API)
// ═══════════════════════════════════════════════════════════
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: env.MOVEMENT_RPC_URL,
  clientConfig: { API_KEY: env.SHINAMI_ACCESS_KEY },
  transactionGenerationConfig: { defaultTxnExpirySecFromNow: 120 },
});
const aptos = new Aptos(aptosConfig);

const MOVE_USDC_METADATA =
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";
const MOVE_USDT_METADATA =
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";
const MOVE_USDCX_METADATA =
  "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

const SHINAMI_GAS_URL = "https://api.us1.shinami.com/movement/gas/v1";

/**
 * Shinami's gas station, spoken to directly.
 *
 * Exported because the voucher payout needs the same fee payer: there the
 * sender is a wallet we hold the key to rather than the person's, so it signs
 * for itself and Shinami still covers the gas.
 */
export async function shinamiRpc(method: string, params: any[]): Promise<any> {
  if (!env.SHINAMI_ACCESS_KEY) throw new Error("SHINAMI_ACCESS_KEY not set");
  const res = await fetch(SHINAMI_GAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.SHINAMI_ACCESS_KEY,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json: any = await res.json();
  if (json.error) {
    /**
     * `data` is where the reason lives.
     *
     * `message` is almost always "Transaction submission failed", which says
     * only that it did not work - the sequence number, the expiry, the failed
     * signature check are all in `data`, and throwing it away cost an evening
     * of guessing at which of them it was.
     */
    const detail =
      json.error.data == null
        ? ""
        : ` — ${typeof json.error.data === "string" ? json.error.data : JSON.stringify(json.error.data)}`;
    throw new Error(`Shinami ${method}: ${json.error.message}${detail}`);
  }
  return json.result;
}

export async function prepareMovementWithdrawal(
  withdrawalId: string,
  senderAddress: string,
  recipientAddress: string,
  amount: number,
  asset: "MOVE" | "USDC" | "USDT" | "USDCx"
): Promise<{ signingMessage: string }> {
  const faMetadata =
    asset === "USDT" ? MOVE_USDT_METADATA :
    asset === "USDCx" ? MOVE_USDCX_METADATA :
    MOVE_USDC_METADATA;

  const fnData =
    asset === "MOVE"
      ? {
          function: "0x1::aptos_account::transfer_coins" as `${string}::${string}::${string}`,
          typeArguments: ["0x1::aptos_coin::AptosCoin" as `${string}::${string}::${string}`],
          functionArguments: [recipientAddress, BigInt(Math.floor(amount * 1e8))],
        }
      : {
          function: "0x1::primary_fungible_store::transfer" as `${string}::${string}::${string}`,
          typeArguments: ["0x1::fungible_asset::Metadata" as `${string}::${string}::${string}`],
          functionArguments: [
            faMetadata,
            recipientAddress,
            BigInt(Math.floor(amount * 1e6)),
          ],
        };

  // Build transaction with Shinami as fee payer (withFeePayer: true sets fee payer to 0x0)
  const transaction = await aptos.transaction.build.simple({
    sender: senderAddress,
    withFeePayer: true,
    data: fnData,
  });

  // Store for submission (user signs against 0x0 wildcard fee payer — Shinami allows this)
  pendingTxs.set(withdrawalId, {
    type: "movement",
    data: { transaction },
    senderAddress,
    expiresAt: Date.now() + 120_000,
  });

  // Generate the bytes the user needs to sign
  const signingMessage = generateSigningMessageForTransaction(transaction);

  return {
    signingMessage: Buffer.from(signingMessage).toString("hex"),
  };
}

export async function submitMovementWithdrawal(
  withdrawalId: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<string> {
  const pending = pendingTxs.get(withdrawalId);
  if (!pending || pending.type !== "movement")
    throw new Error("Transaction expired or not found");

  const senderAuth = new AccountAuthenticatorEd25519(
    new Ed25519PublicKey(publicKeyHex),
    new Ed25519Signature(signatureHex)
  );

  const transaction = pending.data.transaction;

  // Sponsor AND submit via Shinami in one call
  // Params: [rawTransaction (hex), senderSignature (hex)]
  const rawTxHex = Buffer.from(transaction.rawTransaction.bcsToBytes()).toString("hex");
  const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");
  const sponsorResult = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [rawTxHex, senderAuthHex]);

  console.log("[MOVEMENT] Shinami sponsorAndSubmit response:", JSON.stringify(sponsorResult));

  // Response wraps in pendingTransaction: { hash, sender, ... }
  const txHash: string = sponsorResult?.pendingTransaction?.hash || sponsorResult?.hash || sponsorResult;
  if (!txHash || typeof txHash !== "string") {
    throw new Error(`Shinami returned no tx hash: ${JSON.stringify(sponsorResult)}`);
  }

  // Broadcast succeeded — attach the hash to any confirmation-time error so
  // callers can persist it on FAILED transactions.
  try {
    const result = await aptos.waitForTransaction({
      transactionHash: txHash,
      options: { timeoutSecs: 60, checkSuccess: true },
    });
    pendingTxs.delete(withdrawalId);
    console.log(`[MOVEMENT] Shinami-sponsored tx confirmed: ${result.hash}`);
    return result.hash as string;
  } catch (err: any) {
    pendingTxs.delete(withdrawalId);
    (err as any).txHash = txHash;
    console.warn(`[MOVEMENT] Confirmation failed for tx ${txHash}: ${err?.message}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
//  SOLANA – Treasury fee-payer (user signs transfer, we pay gas)
// ═══════════════════════════════════════════════════════════
const SOL_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SOL_USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");

function getSolanaConnection(fallback = false): Connection {
  const url = fallback ? env.SOLANA_RPC_FALLBACK : env.SOLANA_RPC_URL;
  return new Connection(url, {
    commitment: "confirmed",
    wsEndpoint: false as any, // Disable WebSocket — Alchemy free tier doesn't support signatureSubscribe
  });
}

function getSolanaFeePayer(): Keypair {
  return Keypair.fromSecretKey(bs58.decode(env.SOLANA_GASLESS_PRIVATE_KEY));
}

/** Poll-based tx confirmation (avoids WebSocket signatureSubscribe) */
async function pollSolanaConfirmation(
  connection: Connection,
  txHash: string,
  lastValidBlockHeight: number,
  maxRetries = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const { value } = await connection.getSignatureStatuses([txHash]);
    const status = value?.[0];
    if (status) {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return;
    }
    const blockHeight = await connection.getBlockHeight();
    if (blockHeight > lastValidBlockHeight) throw new Error("Transaction expired (block height exceeded)");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction confirmation timeout");
}

/**
 * Build a Solana transfer with treasury as fee-payer.
 * Returns serialized tx (hex) for the user to partially sign.
 */
export class AtaRentRefused extends Error {
  constructor() {
    super(
      "This destination cannot receive USDC right now. Its token account was " +
        "closed after we opened it. Open one at the receiving wallet, or send " +
        "to an address that already holds this token.",
    );
    this.name = "AtaRentRefused";
  }
}

export async function prepareSolanaWithdrawal(
  withdrawalId: string,
  senderAddress: string,
  recipientAddress: string,
  amount: number,
  asset: "USDC" | "USDT" | "SOL",
  /**
   * A flat charge paid into the sell wallet alongside the transfer, or zero.
   *
   * Passed by the caller rather than read here, because only two of the five
   * flows through this function are charged: sending to a wallet and sending
   * to a username. Selling and paying a bill are how value leaves the app
   * usefully and carry fees of their own, and a swap is already rationed.
   *
   * Carried in the same transaction as the transfer, so it is one signature
   * and the two cannot come apart - the fee cannot land without the transfer
   * or the transfer without the fee.
   */
  feeAmount = 0,
): Promise<{ signingMessage: string }> {
  let connection = getSolanaConnection();
  const feePayer = getSolanaFeePayer();
  const sender = new PublicKey(senderAddress);
  const recipient = new PublicKey(recipientAddress);

  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
  } catch (err: any) {
    console.warn(`[SOLANA] Primary RPC failed for getLatestBlockhash (${err.message}), trying fallback`);
    connection = getSolanaConnection(true);
    ({ blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed"));
  }

  const tx = new SolTransaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = feePayer.publicKey; // Treasury pays gas

  // Rent-exempt minimum for a basic Solana account (~0.00089 SOL)
  const RENT_EXEMPT_MIN = 890_880n; // lamports

  if (asset === "SOL") {
    // Native SOL transfer — reserve rent so sender doesn't go below minimum
    const lamports = BigInt(Math.floor(amount * 1e9));
    const senderBalance = BigInt(await connection.getBalance(sender));
    // Max sendable = balance - rent reserve (fee is paid by treasury)
    const maxSendable = senderBalance > RENT_EXEMPT_MIN ? senderBalance - RENT_EXEMPT_MIN : 0n;
    const actualLamports = lamports > maxSendable ? maxSendable : lamports;
    if (actualLamports <= 0n) throw new Error("Insufficient SOL balance (need to keep rent-exempt minimum)");

    tx.add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports: actualLamports,
      })
    );
  } else {
    // SPL token (USDC or USDT)
    const mint = asset === "USDC" ? SOL_USDC_MINT : SOL_USDT_MINT;
    const decimals = 6; // Both SOL USDC and SOL USDT are 6 decimals

    const senderAta = await getAssociatedTokenAddress(mint, sender);
    const recipientAta = await getAssociatedTokenAddress(mint, recipient);

    // Create recipient ATA if it doesn't exist (treasury pays)
    let needsAta = false;
    try {
      await getAccount(connection, recipientAta);
    } catch {
      needsAta = true;
    }

    /**
     * Opened once, at our expense. Never again.
     *
     * Rent on a token account is about 0.0015 SOL and the fee payer puts it
     * up - and that rent is refundable to whoever owns the account, by closing
     * it. So an address can take a withdrawal, close its token account to
     * pocket our rent, and come back for another: each round trip moves real
     * SOL out of the gas wallet into theirs, for the price of a 0.20 USDC
     * transfer they send straight back. Fifty-six of those in one afternoon
     * emptied it.
     *
     * The chain says which case this is without us having to remember. An
     * address that has never held this token has no history at all, and that
     * is the one we open for. History but no account means it existed and was
     * closed, and the only way to need a second one is to have closed the
     * first - so whoever closed it can pay to open it again.
     */
    if (needsAta) {
      const priorLife = await connection
        .getSignaturesForAddress(recipientAta, { limit: 1 })
        .catch(() => [] as unknown[]);
      if (priorLife.length > 0) {
        console.warn(
          `[SOLANA] refusing to reopen a closed token account for ${recipientAddress}`,
        );
        throw new AtaRentRefused();
      }
    }

    if (needsAta) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          feePayer.publicKey, // payer
          recipientAta,
          recipient,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
      console.log(`[SOLANA] opening token account for ${recipientAddress} — rent is on us, once`);
    }

    tx.add(
      createTransferInstruction(
        senderAta,
        recipientAta,
        sender, // authority — user must sign
        BigInt(Math.floor(amount * 10 ** decimals))
      )
    );

    /**
     * The fee, into the sell wallet, in the same transaction.
     *
     * Only on the stablecoins: a SOL send has no token account to take it
     * from, and charging a twentieth of a SOL would be a different order of
     * money entirely.
     *
     * The sell wallet is assumed to hold both already - it receives them all
     * day - so no account is opened here. If it somehow does not, the
     * transfer fails whole rather than silently skipping the fee, which is
     * the right way round.
     */
    if (feeAmount > 0 && env.SELL_SOLANA_ADDRESS) {
      const feeTo = new PublicKey(env.SELL_SOLANA_ADDRESS);
      const feeAta = await getAssociatedTokenAddress(mint, feeTo);
      tx.add(
        createTransferInstruction(
          senderAta,
          feeAta,
          sender,
          BigInt(Math.round(feeAmount * 10 ** decimals))
        )
      );
    }
  }

  // Treasury partially signs (fee payer)
  tx.partialSign(feePayer);

  // Serialize the partially-signed tx — user needs to add their signature
  const serialized = tx.serialize({ requireAllSignatures: false });

  pendingTxs.set(withdrawalId, {
    type: "solana",
    data: { serializedTx: serialized, blockhash, lastValidBlockHeight },
    senderAddress,
    expiresAt: Date.now() + 120_000,
  });

  // The user signs the transaction message (excludes signatures section)
  const message = tx.serializeMessage();
  return {
    signingMessage: Buffer.from(message).toString("hex"),
  };
}

export async function submitSolanaWithdrawal(
  withdrawalId: string,
  signatureHex: string,
  publicKeyHex: string
): Promise<string> {
  const pending = pendingTxs.get(withdrawalId);
  if (!pending || pending.type !== "solana")
    throw new Error("Transaction expired or not found");

  // Reconstruct the transaction from the stored serialization
  const tx = SolTransaction.from(pending.data.serializedTx);

  // Add the user's signature
  const sigBytes = Buffer.from(signatureHex, "hex");
  const pubkey = new PublicKey(Buffer.from(publicKeyHex, "hex"));
  tx.addSignature(pubkey, sigBytes);

  // Submit — try primary RPC, fall back to public
  let connection = getSolanaConnection();
  const rawTx = tx.serialize();
  let txHash: string;
  try {
    txHash = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  } catch (err: any) {
    console.warn(`[SOLANA] Primary RPC send failed (${err.message}), trying fallback`);
    connection = getSolanaConnection(true);
    txHash = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
  }

  // Confirm via polling (no WebSocket). Broadcast already succeeded, so any
  // confirmation failure should still surface the hash to the caller.
  try {
    try {
      await pollSolanaConfirmation(connection, txHash, pending.data.lastValidBlockHeight);
    } catch (err: any) {
      console.warn(`[SOLANA] Primary RPC confirm failed (${err.message}), trying fallback`);
      const fallback = getSolanaConnection(true);
      await pollSolanaConfirmation(fallback, txHash, pending.data.lastValidBlockHeight);
    }
  } catch (err: any) {
    pendingTxs.delete(withdrawalId);
    (err as any).txHash = txHash;
    console.warn(`[SOLANA] Confirmation failed for tx ${txHash}: ${err?.message}`);
    throw err;
  }

  pendingTxs.delete(withdrawalId);
  console.log(`[SOLANA] Tx confirmed: ${txHash}`);
  return txHash;
}

// ═══════════════════════════════════════════════════════════
//  EVM – Treasury-sponsored gas
// ═══════════════════════════════════════════════════════════
const ERC20_TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];

const EVM_TOKEN_ADDRESSES: Record<string, Record<string, { address: string; decimals: number }>> = {
  BASE: {
    USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    USDT: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
    // Six decimals on both chains, unlike USDC/USDT which differ between
    // them - read from the contracts rather than assumed.
    cNGN: { address: "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F", decimals: 6 },
  },
  BEP20: {
    USDC: { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    USDT: { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    cNGN: { address: "0xa8AEA66B361a8d53e8865c62D142167Af28Af058", decimals: 6 },
  },
  ARB: {
    USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  },
  // Circle's USDC and Tether's USDT0, both six decimals - read off the
  // contracts (decimals() and symbol()) rather than assumed. USDT0 is held
  // under the USDT key, as it is on Stellar.
  MONAD: {
    USDC: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
    USDT: { address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6 },
  },
};

const CHAIN_RPC: Record<string, string> = {
  BASE: env.BASE_RPC_URL,
  BEP20: env.BSC_RPC_URL,
  ARB: env.ARB_RPC_URL,
  ARC: env.ARC_RPC_URL,
  MONAD: env.MONAD_RPC_URL,
};

const EVM_CHAIN_IDS: Record<string, number> = {
  BASE: 8453,
  BEP20: 56,
  ARB: 42161,
  // Arc. 42161 above is Arbitrum; these two are one letter apart everywhere.
  ARC: 5042,
  MONAD: 143,
};

/**
 * Chains whose gas token is not ether, and which asset that is.
 *
 * Arc runs on USDC: it is the native currency, at 18 decimals, and there is an
 * ERC-20 USDC as well that is the SAME balance rather than a second one. So a
 * USDC transfer on Arc is a plain value send, and reading both would count the
 * same money twice.
 *
 * Kept as a map rather than `chain === "ARC"` scattered about, because the next
 * chain like this should be one line here and nothing else.
 */
const NATIVE_ASSET: Record<string, string> = {
  ARC: "USDC",
};

/**
 * How far Monad's consensus runs ahead of execution: three blocks, at about
 * 400ms each, plus margin. See the wait after a top-up in submitEvmWithdrawal.
 */
const MONAD_CONSENSUS_LAG_MS = 2_000;

/**
 * Monad's reserve: an ordinary wallet's MON transfers may not take it below
 * 10 MON, except one transfer when it has sent nothing for three blocks. The
 * gas wallet tops people up with MON, so it needs to sit well above this -
 * otherwise only a lone, spaced-out top-up gets through and two at once fail.
 */
const MONAD_RESERVE = ethers.parseEther("10");

/**
 * Monad top-ups, one after another.
 *
 * Two at once would both ask for the gas wallet's next nonce, and on Monad
 * "pending" means "latest", so both get the same one and the second is
 * refused. Queued, each waits for the last to land. It also spaces them, which
 * is what lets the reserve's one-transfer exception apply near 10 MON.
 */
let monadFunding: Promise<unknown> = Promise.resolve();

/** Whether this asset moves as the chain's own currency rather than a token. */
export function isNativeAsset(chain: string, asset: string): boolean {
  if (asset === "ETH") return true;
  return NATIVE_ASSET[chain] === asset;
}

/**
 * Build an EVM token transfer.
 * For native ETH: sends directly. For ERC-20: builds transfer calldata.
 * Returns the typed data hash or serialized tx for the user to sign.
 */
export async function prepareEvmWithdrawal(
  withdrawalId: string,
  senderAddress: string,
  recipientAddress: string,
  amount: number,
  asset: "USDC" | "USDT" | "ETH",
  chain: "BASE" | "BEP20" | "ARB" | "ARC" | "MONAD"
): Promise<{ signingMessage: string; txRequest: Record<string, string | number> }> {
  const rpcUrl = CHAIN_RPC[chain];
  if (!rpcUrl) throw new Error(`No RPC configured for ${chain}`);
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  let txRequest: ethers.TransactionLike;
  const isLegacyChain = chain === "BEP20"; // BSC doesn't support EIP-1559

  /**
   * On Arc, USDC is the chain's own currency, so it goes down the value-send
   * path rather than the token path - same branch ETH takes everywhere else.
   * parseEther is right for it: Arc's native USDC has 18 decimals, not the six
   * USDC has as a token.
   */
  if (isNativeAsset(chain, asset)) {
    // Native ETH/BNB transfer
    const value = ethers.parseEther(amount.toFixed(18));

    // In parallel: none of these depend on each other, and BSC answers in
    // roughly a second per call, so three round trips in series was most of a
    // 30s client timeout before any of the rest of the work.
    //
    // Estimate gas — user may have 0 balance at this point so estimate often fails.
    // Use generous fallback: L2s like Arbitrum charge L1 data gas on top of execution.
    const [nonce, feeData, estimated] = await Promise.all([
      provider.getTransactionCount(senderAddress, "pending"),
      provider.getFeeData(),
      provider
        .estimateGas({ from: senderAddress, to: recipientAddress, value })
        .catch(() => 0n),
    ]);
    let gasLimit = estimated;
    // Native transfer is 21k; use 2x buffer, fallback 100k
    gasLimit = gasLimit > 0n ? gasLimit * 2n : 100_000n;

    if (isLegacyChain) {
      txRequest = {
        to: recipientAddress,
        value,
        nonce,
        chainId: EVM_CHAIN_IDS[chain],
        gasLimit,
        gasPrice: feeData.gasPrice ?? ethers.parseUnits("3", "gwei"),
        type: 0,
      };
    } else {
      txRequest = {
        to: recipientAddress,
        value,
        nonce,
        chainId: EVM_CHAIN_IDS[chain],
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei"),
        type: 2,
      };
    }
  } else {
    // ERC-20 transfer
    const tokenInfo = EVM_TOKEN_ADDRESSES[chain]?.[asset];
    if (!tokenInfo) throw new Error(`Unsupported asset ${asset} on ${chain}`);

    /**
     * Ask for what is there, when the difference is only rounding.
     *
     * Balances are stored as numeric(20,8) and the column rounds half-up. On a
     * six-decimal token nothing is lost. On an eighteen-decimal one the stored
     * figure can land a few billionths ABOVE what the wallet holds, and asking
     * a token contract for more than the balance reverts with no reason
     * attached - which is how a BSC USDT sweep of 0.494263565847626374 came to
     * request 0.49426357 and revert, while the same code swept Solana and Base
     * without a mark on it.
     *
     * The clamp is deliberately narrow: only a shortfall smaller than one unit
     * at the stored precision is treated as rounding and pulled back to the
     * balance. Anything larger is a genuine overdraft and is left to revert,
     * because quietly sending less than somebody asked for is the worse bug.
     */
    let units = ethers.parseUnits(amount.toFixed(tokenInfo.decimals), tokenInfo.decimals);
    try {
      const held: bigint = await new ethers.Contract(
        tokenInfo.address,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      ).balanceOf(senderAddress);

      const roundingUnit = 10n ** BigInt(Math.max(0, tokenInfo.decimals - 8));
      if (units > held && units - held <= roundingUnit) {
        console.log(
          `[EVM] ${asset} on ${chain}: asked for ${units}, wallet holds ${held} — rounding, clamping`
        );
        units = held;
      }
    } catch (err: any) {
      // Could not read it. The transfer either fits or reverts; neither costs
      // anything beyond this one attempt.
      console.warn(`[EVM] Could not read ${asset} balance on ${chain}: ${err?.message}`);
    }

    const iface = new ethers.Interface(ERC20_TRANSFER_ABI);
    const calldata = iface.encodeFunctionData("transfer", [recipientAddress, units]);

    const [nonce, feeData, estimated] = await Promise.all([
      provider.getTransactionCount(senderAddress, "pending"),
      provider.getFeeData(),
      provider
        .estimateGas({ from: senderAddress, to: tokenInfo.address, data: calldata })
        .catch(() => 0n),
    ]);
    let gasLimit = estimated;
    // ERC-20 transfer is ~65k; use 2x buffer, fallback 150k
    gasLimit = gasLimit > 0n ? gasLimit * 2n : 150_000n;

    if (isLegacyChain) {
      txRequest = {
        to: tokenInfo.address,
        data: calldata,
        value: 0n,
        nonce,
        chainId: EVM_CHAIN_IDS[chain],
        gasLimit,
        gasPrice: feeData.gasPrice ?? ethers.parseUnits("3", "gwei"),
        type: 0,
      };
    } else {
      txRequest = {
        to: tokenInfo.address,
        data: calldata,
        value: 0n,
        nonce,
        chainId: EVM_CHAIN_IDS[chain],
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("5", "gwei"),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? ethers.parseUnits("1", "gwei"),
        type: 2,
      };
    }
  }

  // Serialize unsigned tx for user to sign
  const unsignedTx = ethers.Transaction.from(txRequest);
  const signingHash = unsignedTx.unsignedHash;

  pendingTxs.set(withdrawalId, {
    type: "evm",
    data: { txRequest, chain },
    senderAddress,
    expiresAt: Date.now() + 120_000,
  });

  return {
    signingMessage: signingHash.slice(2), // remove 0x prefix, return hex
    // MPC wallets cannot sign a bare hash, so they need the transaction itself.
    // BigInts are stringified because this crosses JSON; the client converts
    // them back before signing.
    //
    // `from` is included so the client signs with the SAME account we prepared
    // for. A wallet holding several EVM accounts would otherwise sign with
    // whichever came first, and the signature would recover to an address the
    // backend rejects - with no clue as to why.
    txRequest: { ...jsonSafeTx(txRequest), from: senderAddress },
  };
}

/** BigInt-free copy of a transaction, safe to send over JSON. */
function jsonSafeTx(tx: ethers.TransactionLike): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(tx)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "bigint" ? v.toString() : (v as string | number);
  }
  return out;
}

export async function submitEvmWithdrawal(
  withdrawalId: string,
  signatureHex: string,
  _publicKeyHex: string,
  clientSignedRaw?: string
): Promise<string> {
  const pending = pendingTxs.get(withdrawalId);
  if (!pending || pending.type !== "evm")
    throw new Error("Transaction expired or not found");

  const { txRequest, chain } = pending.data;
  const rpcUrl = CHAIN_RPC[chain as string];
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // ─── Treasury-funded gas + direct broadcast ───
  let signedRaw: string;

  if (clientSignedRaw) {
    // An MPC wallet signed the whole transaction, so we broadcast exactly what
    // it signed rather than reassembling our own copy - any difference would
    // invalidate the signature or, worse, send something the user never saw.
    //
    // It is still checked field by field against what we prepared. The client
    // could otherwise hand us a valid signature over a DIFFERENT transaction -
    // a different recipient, or a larger amount - and we would broadcast it.
    const parsed = ethers.Transaction.from(clientSignedRaw);
    const expected = ethers.Transaction.from(txRequest);

    // Compare field by field and report exactly which one differs. A single
    // boolean tells you a signed transaction was rejected but not why, and the
    // difference is usually one field an SDK normalised differently.
    const differences: string[] = [];
    const cmp = (label: string, got: unknown, want: unknown) => {
      const g = typeof got === "bigint" ? got.toString() : String(got ?? "");
      const w = typeof want === "bigint" ? want.toString() : String(want ?? "");
      if (g.toLowerCase() !== w.toLowerCase()) differences.push(`${label}: got ${g}, want ${w}`);
    };

    cmp("from", parsed.from, pending.senderAddress);
    cmp("to", parsed.to, expected.to);
    cmp("data", parsed.data ?? "0x", expected.data ?? "0x");
    cmp("value", parsed.value, expected.value);
    cmp("nonce", parsed.nonce, expected.nonce);
    cmp("chainId", parsed.chainId, expected.chainId);

    /**
     * The fees it signed, within reason of what we prepared.
     *
     * We pay for this transaction's gas before it goes. Signed with fees far
     * above what it needs, it can't afford itself, the broadcast fails, and
     * the top-up stays in the wallet - a few cents each time, for as long as
     * somebody cares to repeat it.
     */
    const signedFee = parsed.maxFeePerGas ?? parsed.gasPrice ?? 0n;
    const preparedFee = expected.maxFeePerGas ?? expected.gasPrice ?? 0n;
    if (parsed.gasLimit > expected.gasLimit * 2n || (preparedFee > 0n && signedFee > preparedFee * 3n)) {
      differences.push(`fees: got ${parsed.gasLimit} at ${signedFee}, prepared ${expected.gasLimit} at ${preparedFee}`);
    }

    if (differences.length > 0) {
      console.error("[EVM] Signed transaction does not match prepared", {
        withdrawalId,
        differences,
        parsedType: parsed.type,
        expectedType: expected.type,
      });
      throw new Error(
        `Signed transaction did not match the prepared transaction (${differences
          .map((d) => d.split(":")[0])
          .join(", ")})`
      );
    }

    signedRaw = clientSignedRaw;
  } else {
    const unsignedTx = ethers.Transaction.from(txRequest);
    const sig = "0x" + signatureHex;
    unsignedTx.signature = ethers.Signature.from(sig);
    signedRaw = unsignedTx.serialized;
  }

  /**
   * Signed by the account's own key, or nothing happens - checked before any
   * gas is sent.
   *
   * The signature path above put whatever signature the client sent onto our
   * transaction and never asked who it recovered to. The gas top-up below
   * then went to the stored address first, so a junk signature still cost us
   * a top-up every time, and the broadcast failed only afterwards.
   */
  const signer = ethers.Transaction.from(signedRaw).from;
  if (!signer || signer.toLowerCase() !== String(pending.senderAddress).toLowerCase()) {
    console.error("[EVM] signature does not recover to the sender - refused before funding", {
      withdrawalId,
      sender: pending.senderAddress,
      recovered: signer,
    });
    throw new Error("That signature isn't from this wallet. Nothing was sent.");
  }

  // Fund the user's wallet with enough gas to cover the tx
  const senderAddr = pending.senderAddress;
  const treasuryWallet = new ethers.Wallet(env.EVM_GAS_SPONSOR_PRIVATE_KEY, provider);

  // Get fresh fee data at submit time (more accurate than prepare time)
  const feeData = await provider.getFeeData();
  const feePerGas = BigInt(feeData.maxFeePerGas ?? feeData.gasPrice ?? ethers.parseUnits("1", "gwei"));

  /**
   * What a token transfer costs, at its worst rather than its usual.
   *
   * 80,000 was sized on an ERC-20 transfer costing about 65,000 - which is
   * what it costs when the recipient already holds some of that token. The
   * first time an address receives one, the transfer writes a brand-new
   * storage slot instead of updating one, and the estimate goes to about
   * 92,000. Doubled at prepare, that is 183,338 of gas against the 160,000
   * this was funding, and the node refused it.
   *
   * Base never showed it because an L2 gets three times this figure rather
   * than two - 240,000 - which happened to clear the higher estimate. BNB got
   * two and did not. cNGN hits it every time because almost nobody holds any
   * yet; the same send would have failed with USDT to a first-time recipient.
   *
   * 120,000 gives BNB 240,000 and Base 360,000, so both clear a first
   * transfer with room left.
   */
  const gasLimit = txRequest.data ? 120_000n : 25_000n;
  const gasCost = gasLimit * feePerGas;
  // L1 data posting adds a small overhead on L2s
  const isL2 = chain === "BASE" || chain === "ARB";
  const stipend = isL2 ? gasCost * 3n : gasCost * 2n;

  // For native ETH/BNB transfers the user needs value + gas
  const txValue = BigInt(txRequest.value ?? 0n);
  // At least what the signed transaction itself needs, so a top-up is never left behind by a send that can't afford itself.
  const final = ethers.Transaction.from(signedRaw);
  const signedCost = final.gasLimit * (final.maxFeePerGas ?? final.gasPrice ?? 0n);
  const totalNeeded = txValue + (signedCost > stipend ? signedCost : stipend);
  const currentBal = await provider.getBalance(senderAddr);

  /**
   * Arc pays its own way.
   *
   * Sponsorship exists for the chains where somebody holds the token but not
   * the gas - USDC on Base with no ETH, USDT on BNB with no BNB. On Arc the gas
   * IS USDC, so the person sending already holds exactly what the fee is paid
   * in, and topping them up would mean sending USDC to cover USDC. There is no
   * gap to bridge, only a fee of well under a cent taken from what they have.
   *
   * It also retires the one piece of this that could not be reasoned about:
   * the stipend maths above assumes value and gas are different currencies,
   * and on Arc they are the same one.
   *
   * The amount they may send is reduced by a reserve before it ever gets here,
   * so a balance short of value + gas means something upstream let through an
   * amount it should not have.
   */
  if (chain === "ARC") {
    if (currentBal < totalNeeded) {
      throw new Error(
        "Not enough USDC on Arc to cover this transfer and its fee. " +
          "Send a little less — the fee comes out of the same balance.",
      );
    }
    console.log(`[EVM:ARC] sender pays their own gas, no sponsorship`);
  } else if (currentBal < totalNeeded) {
    // Only top up the shortfall
    const needed = totalNeeded - currentBal;
    console.log(`[EVM:${chain}] Funding ${senderAddr} with ${ethers.formatEther(needed)} (bal: ${ethers.formatEther(currentBal)}, need: ${ethers.formatEther(totalNeeded)})`);
    const fund = async () => {
      if (chain === "MONAD") {
        const held = await provider.getBalance(treasuryWallet.address);
        if (held - needed < MONAD_RESERVE) {
          console.warn(
            `[EVM:MONAD] gas wallet ${treasuryWallet.address} holds ${ethers.formatEther(held)} MON. ` +
              `Monad will not let it go below 10 MON except one transfer every few blocks - top it up.`,
          );
        }
      }
      const fundTx = await treasuryWallet.sendTransaction({ to: senderAddr, value: needed });
      await fundTx.wait(1, chain === "MONAD" ? 60_000 : undefined);
      console.log(`[EVM:${chain}] Gas funded: ${fundTx.hash}`);
    };
    // One Monad top-up at a time - see monadFunding.
    if (chain === "MONAD") {
      const run = monadFunding.catch(() => {}).then(fund);
      monadFunding = run;
      await run;
    } else {
      await fund();
    }

    // Wait for the funded balance to be visible on the RPC node (load-balancer lag)
    for (let i = 0; i < 10; i++) {
      const bal = await provider.getBalance(senderAddr);
      if (bal >= totalNeeded) break;
      console.log(`[EVM:${chain}] Waiting for funded balance to appear (attempt ${i + 1})...`);
      await new Promise(r => setTimeout(r, 1500));
    }

    /**
     * Monad decides whether a transaction can pay from a balance three blocks
     * old, not the current one - execution runs behind consensus there. So a
     * top-up the node already shows can still be invisible to the block that
     * would include the transfer, and Monad's RPC accepts the transaction
     * anyway and drops it later rather than refusing it now. Waiting out the
     * three blocks (about a second and a quarter) means it is seen.
     */
    if (chain === "MONAD") await new Promise(r => setTimeout(r, MONAD_CONSENSUS_LAG_MS));
  } else {
    console.log(`[EVM:${chain}] Sender ${senderAddr} has sufficient balance (${ethers.formatEther(currentBal)}), no funding needed`);
  }

  // Broadcast with retry — if first attempt fails due to stale balance, wait and retry
  let txResponse;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      txResponse = await provider.broadcastTransaction(signedRaw);
      break;
    } catch (err: any) {
      if (attempt < 2 && err.message?.includes("insufficient funds")) {
        console.warn(`[EVM:${chain}] Broadcast attempt ${attempt + 1} failed (insufficient funds), retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  if (!txResponse) throw new Error("Failed to broadcast after retries");

  // Broadcast succeeded — preserve the hash for FAILED-status persistence even
  // if confirmation throws.
  const broadcastHash = txResponse.hash;
  try {
    // Bounded on Monad, where a transaction the RPC accepted can still be
    // dropped before inclusion (see above); unbounded, the wait would never
    // return. Blocks there are under half a second, so a minute is generous.
    const receipt = await txResponse.wait(1, chain === "MONAD" ? 60_000 : undefined);
    if (!receipt) {
      const e: any = new Error("Transaction failed");
      e.txHash = broadcastHash;
      throw e;
    }
    pendingTxs.delete(withdrawalId);
    console.log(`[EVM:${chain}] Tx confirmed: ${receipt.hash}`);
    return receipt.hash;
  } catch (err: any) {
    pendingTxs.delete(withdrawalId);
    if (!err.txHash) err.txHash = broadcastHash;
    console.warn(`[EVM:${chain}] Confirmation failed for tx ${broadcastHash}: ${err?.message}`);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
//  TON – relay-paid, fee taken in the USDT being moved
// ═══════════════════════════════════════════════════════════
/**
 * Unlike every other chain here, nobody sponsors this one.
 *
 * Movement has Shinami, Solana and the EVM chains have fee payers we top up,
 * and each of those is a wallet we fund, watch and occasionally find empty.
 * TON has none: the relay pays the gas and takes its fee out of the same USDT
 * the user is sending, so there is no float to run dry and no rent for anyone
 * to farm.
 *
 * The shape still matches the others - prepare returns something to sign,
 * submit takes the signature - because that is what the routes and the app
 * already speak. What differs is what gets signed: not a transaction, but a
 * W5 request that a stranger will carry.
 *
 * Note the sender is named by their SOLANA address, not their TON one. A TON
 * address is a hash of the wallet code and the public key, so it cannot be
 * turned back into the key that has to sign - and the key is the Solana one.
 * Deriving the TON address here rather than accepting it also means the two
 * can never disagree.
 */
export async function prepareTonWithdrawal(
  withdrawalId: string,
  senderSolanaAddress: string,
  recipientAddress: string,
  amount: number,
  asset: "USDT",
): Promise<{ signingMessage: string; commission: number; senderAddress: string }> {
  if (asset !== "USDT") {
    throw new Error(`Unsupported asset on TON: ${asset}`);
  }

  const recipient = ton.parseTonAddress(recipientAddress);
  if (!recipient) throw new Error("Invalid TON recipient address");

  if (!(await ton.gaslessSupportsUsdt())) {
    throw new Error("The TON relay is not accepting USDT right now");
  }

  const publicKey = ton.publicKeyFromSolana(senderSolanaAddress);
  const wallet = ton.walletFor(publicKey);
  const senderAddress = wallet.address.toString({ bounceable: false, urlSafe: true });

  const jettonWallet = await ton.derivedJettonWallet(senderAddress);
  const cfg = await ton.gaslessConfig();
  const relay = Address.parse(cfg.relay_address);

  const units = BigInt(Math.round(amount * 10 ** ton.TON_USDT_DECIMALS));
  if (units <= 0n) throw new Error("Amount too small to send");

  const proposed = beginCell()
    .store(
      storeMessageRelaxed(
        tonInternal({
          to: Address.parse(jettonWallet),
          value: toNano("0.1"),
          bounce: true,
          body: ton.jettonTransferBody({
            amount: units,
            destination: recipient,
            // The relay, deliberately. See jettonTransferBody: anything else
            // here costs twenty-eight times as much and says nothing.
            responseDestination: relay,
          }),
        }),
      ),
    )
    .endCell();

  const estimate = await ton.estimateGasless(senderAddress, publicKey, proposed);
  // Checked, not trusted: see messagesFromEstimate. Throws rather than
  // handing the user something unexpected to sign.
  const messages = ton.messagesFromEstimate(estimate, {
    units,
    destination: recipient,
    relay,
  });
  // Zero means this wallet has never sent anything, which on TON means it has
  // not been deployed - receiving USDT deploys the jetton wallet, not this
  // one. So the first send of every user's life carries state init.
  const seqno = await ton.getSeqno(senderAddress);

  // createTransfer calls this with the cell it is about to sign. Returning a
  // placeholder of the right length keeps it building; what we want is the
  // cell itself, so that what the user signs is exactly what the library will
  // later pack and there is no second implementation to drift.
  let toSign: Cell | null = null;
  await wallet.createTransfer({
    seqno,
    timeout: estimate.valid_until,
    authType: "internal",
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages,
    signer: async (cell: Cell) => {
      toSign = cell;
      return Buffer.alloc(64);
    },
  });
  if (!toSign) throw new Error("Could not build the TON request");

  pendingTxs.set(withdrawalId, {
    type: "ton",
    data: {
      seqno,
      timeout: estimate.valid_until,
      messages,
      publicKey: publicKey.toString("hex"),
      needsInit: seqno === 0,
      commission: Number(estimate.commission) / 10 ** ton.TON_USDT_DECIMALS,
      // What the chain has to show before this counts as sent.
      units: units.toString(),
      recipient: recipient.toRawString(),
      senderAddress,
    },
    senderAddress,
    // The relay's own window is about four minutes and is the binding one;
    // holding it longer here would only mean a nicer error later.
    expiresAt: Math.min(Date.now() + 120_000, estimate.valid_until * 1000 - 10_000),
  });

  return {
    // A TON signature is over the cell's hash, which is 32 bytes - the same
    // shape the Ed25519 path already signs for Movement and Solana.
    signingMessage: (toSign as Cell).hash().toString("hex"),
    commission: Number(estimate.commission) / 10 ** ton.TON_USDT_DECIMALS,
    senderAddress,
  };
}

/**
 * Attach the signature and hand the result to the relay.
 *
 * Rebuilt from the stored arguments rather than patched, because every input
 * was pinned at prepare - seqno, timeout and the relay's own messages - so
 * building again with the real signature produces the identical cell whose
 * hash the user signed.
 *
 * What comes back is not a transaction hash. The relay acknowledges before
 * the chain has seen anything, so this names the request; the deposit watcher
 * is what later confirms the money actually moved.
 */
/**
 * A TON event, claimed for one transaction - or refused if another has it.
 *
 * Under a database lock on the event, so two servers can't both claim it, and
 * written onto the transaction in the same step (a sweep's legs share their
 * sweep's row, hence the id before the colon). Read back by its txHash too,
 * which is where everything written before this keeps it.
 */
async function claimTonEvent(ownerTxId: string, eventId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`ton-event:${eventId}`}))`;
    const taken = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM transactions
       WHERE id <> ${ownerTxId}
         AND (metadata->>'txHash' = ${eventId} OR jsonb_exists(coalesce(metadata->'tonEvents', '[]'::jsonb), ${eventId}))
       LIMIT 1`;
    if (taken.length) return false;
    await tx.$executeRaw`
      UPDATE transactions
         SET metadata = jsonb_set(CASE WHEN jsonb_typeof(metadata) = 'object' THEN metadata ELSE '{}'::jsonb END, '{tonEvents}', coalesce(metadata->'tonEvents', '[]'::jsonb) || to_jsonb(${eventId}::text))
       WHERE id = ${ownerTxId}`;
    return true;
  });
}

export async function submitTonWithdrawal(
  withdrawalId: string,
  signatureHex: string,
): Promise<string> {
  const pending = pendingTxs.get(withdrawalId);
  if (!pending || pending.type !== "ton") {
    throw new Error("Transaction expired or not found");
  }

  const signature = Buffer.from(signatureHex, "hex");
  if (signature.length !== 64) {
    throw new Error("A TON signature must be 64 bytes");
  }

  const publicKey = Buffer.from(pending.data.publicKey, "hex");
  const wallet = ton.walletFor(publicKey);

  const signedBody = await wallet.createTransfer({
    seqno: pending.data.seqno,
    timeout: pending.data.timeout,
    authType: "internal",
    sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
    messages: pending.data.messages,
    signer: async () => signature,
  });

  const wrapped = ton.wrapForRelay(
    wallet.address,
    signedBody,
    // Only on a first send. An already-deployed wallet refuses a message that
    // carries state init rather than ignoring it.
    pending.data.needsInit ? wallet.init : null,
  );

  /**
   * Handing it over, which may need a few goes.
   *
   * The relay can transiently refuse while it catches up with the chain, and
   * a refusal costs nothing: nothing has been broadcast yet. Retrying after
   * it has accepted would be a different matter, which is why confirmation
   * lives outside this loop rather than in it.
   */
  const startedAt = Math.floor(Date.now() / 1000) - 5;
  let accepted = false;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 4 && !accepted; attempt++) {
    try {
      const res = await ton.sendGasless(publicKey, wrapped);
      accepted = true;
      console.log(`[TON] relay accepted ${res?.external ?? "(no id)"}`);
    } catch (err: any) {
      lastErr = err;
      console.warn(`[TON] relay refused (attempt ${attempt + 1}): ${err?.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  pendingTxs.delete(withdrawalId);
  if (!accepted) {
    throw lastErr ?? new Error("The TON relay would not take the transfer");
  }

  /**
   * The relay saying yes is not the chain saying yes.
   *
   * Every other chain here confirms before returning - Solana polls, Movement
   * waits for the transaction, EVM waits a block - and the callers depend on
   * that: a sell pays naira the moment this resolves, and a swap credits
   * USDCx. Returning on an HTTP acknowledgement would pay for transfers that
   * never happened.
   *
   * Relay outages are the dull version. The sharp one is that a W5 request
   * carries a seqno, so two requests prepared against the same seqno are both
   * signable while only one can ever execute. Submit the other first and this
   * one is refused on chain after the relay has already answered 200, which
   * is a way to be paid for money that never left. So the chain is asked, and
   * asked for the exact amount at the exact destination rather than merely
   * whether something happened.
   *
   * The event id is also the only handle an explorer resolves, so the receipt
   * gets its working link out of the same wait.
   */
  const eventId = await ton.findRelayedEvent(
    pending.data.senderAddress,
    startedAt,
    {
      units: BigInt(pending.data.units),
      destination: Address.parse(pending.data.recipient),
    },
    undefined,
    // An event another sell, bill or transfer was already paid on is not proof of this one.
    async (id) => !(await claimTonEvent(withdrawalId.split(":")[0]!, id)),
  );
  if (!eventId) {
    throw new Error(
      "The transfer was accepted but has not appeared on chain. " +
        "Nothing has been deducted; check your balance before retrying.",
    );
  }
  console.log(`[TON] confirmed as ${eventId}`);
  return eventId;
}
