/**
 * Treasury transfer module.
 * Sends crypto from treasury (hot wallet) to user wallets after Paystack funding.
 *
 * Supported chains:
 *  - Movement (MOVE native, USDC fungible asset)
 *  - EVM (Base, BSC, Arbitrum) — native + USDC/USDT ERC-20
 *  - Solana (native SOL + USDC/USDT SPL tokens)
 */
import { env } from "../config/env";
import { isNativeAsset } from "./gas-sponsor";
import {
  Account,
  Aptos,
  AptosConfig,
  Network,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { ethers } from "ethers";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";

// ═══════════════════════════════════════════════════════════
//  EVM TOKEN ADDRESSES
// ═══════════════════════════════════════════════════════════
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const EVM_TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
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
};

// Solana SPL token mints
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

// Movement fungible asset metadata objects
const MOVE_USDC_METADATA =
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";
const MOVE_USDT_METADATA =
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";
const MOVE_USDCX_METADATA =
  "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e";

// ═══════════════════════════════════════════════════════════
//  RPC PROVIDERS
// ═══════════════════════════════════════════════════════════
function getEvmProvider(chain: string): ethers.JsonRpcProvider {
  switch (chain) {
    case "BASE":
      return new ethers.JsonRpcProvider(env.BASE_RPC_URL);
    case "BEP20":
      return new ethers.JsonRpcProvider(env.BSC_RPC_URL);
    case "ARB":
      return new ethers.JsonRpcProvider(env.ARB_RPC_URL);
    case "ARC":
      return new ethers.JsonRpcProvider(env.ARC_RPC_URL);
    default:
      throw new Error(`Unknown EVM chain: ${chain}`);
  }
}

// ═══════════════════════════════════════════════════════════
//  MOVEMENT TRANSFERS
// ═══════════════════════════════════════════════════════════
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: env.MOVEMENT_RPC_URL,
});
const aptos = new Aptos(aptosConfig);

export async function sendMovement(
  recipientAddress: string,
  amount: number,
  asset: "MOVE" | "USDC" | "USDT" | "USDCx"
): Promise<string> {
  const privateKey = new Ed25519PrivateKey(env.MOVEMENT_TREASURY_PRIVATE_KEY);
  const treasury = Account.fromPrivateKey({
    privateKey,
    address: env.MOVEMENT_TREASURY_ADDRESS,
  });

  let transaction;
  if (asset === "MOVE") {
    const amountOctas = BigInt(Math.floor(amount * 1e8));
    transaction = await aptos.transaction.build.simple({
      sender: treasury.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer_coins",
        typeArguments: ["0x1::aptos_coin::AptosCoin"],
        functionArguments: [recipientAddress, amountOctas],
      },
    });
  } else {
    // USDC/USDT/USDCx on Movement uses primary_fungible_store
    const metadata =
      asset === "USDT" ? MOVE_USDT_METADATA :
      asset === "USDCx" ? MOVE_USDCX_METADATA :
      MOVE_USDC_METADATA;
    const amountUnits = BigInt(Math.floor(amount * 1e6));
    transaction = await aptos.transaction.build.simple({
      sender: treasury.accountAddress,
      data: {
        function: "0x1::primary_fungible_store::transfer",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [metadata, recipientAddress, amountUnits],
      },
    });
  }

  const signer = aptos.transaction.sign({ signer: treasury, transaction });
  const submitted = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator: signer,
  });
  const result = await aptos.waitForTransaction({ transactionHash: submitted.hash });
  console.log(`[TREASURY] Movement ${asset} sent: ${result.hash}`);
  return result.hash as string;
}

// ═══════════════════════════════════════════════════════════
//  EVM TRANSFERS (Base, BSC, Arbitrum)
// ═══════════════════════════════════════════════════════════
export async function sendEvm(
  recipientAddress: string,
  amount: number,
  chain: string,
  asset: "ETH" | "USDC" | "USDT"
): Promise<string> {
  const provider = getEvmProvider(chain);
  const wallet = new ethers.Wallet(env.EVM_TREASURY_PRIVATE_KEY, provider);

  /**
   * Native, which on Arc means USDC.
   *
   * Arc's own currency is USDC at 18 decimals, so paying somebody USDC there is
   * a value send rather than a contract call - and there is no entry for it in
   * EVM_TOKENS below, deliberately, because the ERC-20 on Arc is the same money
   * and putting it there would offer two ways to move one balance.
   */
  if (isNativeAsset(chain, asset)) {
    // Send native ETH/BNB, or USDC where that is the chain's currency
    const value = ethers.parseUnits(amount.toFixed(18), 18);
    const tx = await wallet.sendTransaction({ to: recipientAddress, value });
    const receipt = await tx.wait();
    if (!receipt) throw new Error("EVM tx not confirmed");
    console.log(`[TREASURY] EVM ${chain} native sent: ${receipt.hash}`);
    return receipt.hash;
  }

  // ERC-20 token transfer
  const tokenInfo = EVM_TOKENS[chain]?.[asset];
  if (!tokenInfo) throw new Error(`Token ${asset} not supported on ${chain}`);

  const contract = new ethers.Contract(tokenInfo.address, ERC20_ABI, wallet);
  const amountWei = ethers.parseUnits(amount.toFixed(tokenInfo.decimals), tokenInfo.decimals);
  const tx = await contract.transfer(recipientAddress, amountWei);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("ERC-20 tx not confirmed");
  console.log(`[TREASURY] EVM ${chain} ${asset} sent: ${receipt.hash}`);
  return receipt.hash;
}

// ═══════════════════════════════════════════════════════════
//  SOLANA TRANSFERS
// ═══════════════════════════════════════════════════════════
function getSolanaKeypair(): Keypair {
  const secret = bs58.decode(env.SOLANA_TREASURY_PRIVATE_KEY);
  return Keypair.fromSecretKey(secret);
}

/** Poll-based tx confirmation (avoids WebSocket signatureSubscribe) */
async function pollSolanaConfirmation(
  connection: Connection,
  sig: string,
  maxRetries = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const { value } = await connection.getSignatureStatuses([sig]);
    const status = value?.[0];
    if (status) {
      if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transaction confirmation timeout");
}

function getSolConnection(fallback = false): Connection {
  const url = fallback ? env.SOLANA_RPC_FALLBACK : env.SOLANA_RPC_URL;
  return new Connection(url, {
    commitment: "confirmed",
    wsEndpoint: false as any,
  });
}

/** Send a Solana transaction and confirm via polling with fallback RPC */
async function sendAndConfirmSolTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = signers[0].publicKey;
  tx.sign(...signers);
  const rawTx = tx.serialize();
  let sig: string;
  try {
    sig = await connection.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (err: any) {
    console.warn(`[TREASURY] Primary Solana RPC send failed (${err.message}), trying fallback`);
    const fallback = getSolConnection(true);
    sig = await fallback.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: "confirmed" });
    await pollSolanaConfirmation(fallback, sig);
    return sig;
  }
  try {
    await pollSolanaConfirmation(connection, sig);
  } catch (err: any) {
    console.warn(`[TREASURY] Primary Solana RPC confirm failed (${err.message}), trying fallback`);
    const fallback = getSolConnection(true);
    await pollSolanaConfirmation(fallback, sig);
  }
  return sig;
}

export async function sendSolana(
  recipientAddress: string,
  amount: number,
  asset: "USDC" | "USDT" | "SOL"
): Promise<string> {
  const connection = getSolConnection();
  const treasury = getSolanaKeypair();
  const recipient = new PublicKey(recipientAddress);

  // Native SOL transfer
  if (asset === "SOL") {
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: recipient,
        lamports,
      })
    );
    const sig = await sendAndConfirmSolTx(connection, tx, [treasury]);
    console.log(`[TREASURY] Solana native SOL sent: ${sig}`);
    return sig;
  }

  // SPL token transfer
  const mintAddress =
    asset === "USDC" ? new PublicKey(SOL_USDC_MINT) : new PublicKey(SOL_USDT_MINT);

  const treasuryAta = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    mintAddress,
    treasury.publicKey
  );

  const recipientAta = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury, // payer for ATA creation if needed
    mintAddress,
    recipient
  );

  const mint = await getMint(connection, mintAddress);
  const amountLamports = BigInt(Math.floor(amount * 10 ** mint.decimals));

  const tx = new Transaction().add(
    createTransferInstruction(
      treasuryAta.address,
      recipientAta.address,
      treasury.publicKey,
      amountLamports
    )
  );

  const sig = await sendAndConfirmSolTx(connection, tx, [treasury]);
  console.log(`[TREASURY] Solana ${asset} sent: ${sig}`);
  return sig;
}

// ═══════════════════════════════════════════════════════════
//  UNIFIED DISPATCHER
// ═══════════════════════════════════════════════════════════
export async function sendTokensToUser(
  recipientAddress: string,
  amount: number,
  chain: string,
  asset: string
): Promise<string> {
  console.log(
    `[TREASURY] Sending ${amount} ${asset} on ${chain} to ${recipientAddress}`
  );

  switch (chain) {
    case "MOVE":
      return sendMovement(recipientAddress, amount, asset as "MOVE" | "USDC" | "USDT" | "USDCx");
    case "BASE":
    case "BEP20":
    case "ARB":
    case "ARC":
      return sendEvm(recipientAddress, amount, chain, asset as "ETH" | "USDC" | "USDT");
    case "SOL":
      return sendSolana(recipientAddress, amount, asset as "USDC" | "USDT" | "SOL");
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}
