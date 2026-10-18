/**
 * Sending USDC out of a business wallet on Movement or Solana. Both are signed
 * by the owner's Ed25519 key - the Solana key, which is Movement's too - and
 * we pay the fee: the Movement float sponsors the transaction, the Solana fee
 * payer covers it.
 *
 * We build the exact transaction, the owner's wallet signs its bytes in the
 * dashboard, and we check the signature is theirs over exactly those bytes
 * before adding ours and broadcasting. Nothing they didn't approve can go out.
 * It's built when the owner presses Approve, not before: both chains'
 * transactions go stale within a minute or two.
 */
import { Account, AccountAuthenticatorEd25519, Aptos, AptosApiError, AptosConfig, Ed25519PrivateKey, Ed25519PublicKey, Ed25519Signature, Network, generateSigningMessageForTransaction, generateUserTransactionHash, type SimpleTransaction } from "@aptos-labs/ts-sdk";
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { env } from "../config/env";
import { HttpError } from "./http";

export type EdChain = "MOVEMENT" | "SOLANA";
export const isEdChain = (c: string): c is EdChain => c === "MOVEMENT" || c === "SOLANA";

const MOVE_USDC = "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e"; // USDCx
const SOL_USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
/** How long a built transaction waits for the owner's signature. */
const SIGN_WITHIN_MS = 110_000;

const off = (what: string) => new HttpError(503, `Sending on ${what} isn't switched on yet.`, "network_off");
const aptos = () => {
  if (!env.MOVEMENT_RPC_URL) throw off("Movement");
  return new Aptos(new AptosConfig({ network: Network.CUSTOM, fullnode: env.MOVEMENT_RPC_URL }));
};
const moveSponsor = () => {
  if (!env.FLOAT_MOVEMENT_PRIVATE_KEY) throw off("Movement");
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(env.FLOAT_MOVEMENT_PRIVATE_KEY) });
};
const solConnection = () => {
  if (!env.SOLANA_RPC_URL) throw off("Solana");
  return new Connection(env.SOLANA_RPC_URL, { commitment: "confirmed" });
};
const solFeePayer = () => {
  const k = env.SOLANA_GASLESS_PRIVATE_KEY ?? env.FLOAT_SOLANA_PRIVATE_KEY;
  if (!k) throw off("Solana");
  return Keypair.fromSecretKey(bs58.decode(k));
};

/** Whether an address can be sent to on the chain. */
export function validEdAddress(chain: EdChain, address: string): boolean {
  if (chain === "MOVEMENT") return /^0x[0-9a-fA-F]{1,64}$/.test(address.trim());
  try {
    return new PublicKey(address.trim()).toBase58() === address.trim();
  } catch {
    return false;
  }
}

/** USDC the wallet holds on the chain, read live, six decimals. */
export async function edUsdcOf(chain: EdChain, owner: string): Promise<bigint> {
  if (chain === "MOVEMENT") {
    const [raw] = await aptos().view({ payload: { function: "0x1::primary_fungible_store::balance", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [owner, MOVE_USDC] } });
    return BigInt(String(raw ?? "0"));
  }
  const bal = await solConnection()
    .getTokenAccountBalance(getAssociatedTokenAddressSync(SOL_USDC, new PublicKey(owner)))
    .catch(() => null);
  return BigInt(bal?.value.amount ?? "0");
}

type Pending =
  | { chain: "MOVEMENT"; tx: SimpleTransaction; message: Uint8Array; solana: string; at: number }
  | { chain: "SOLANA"; tx: Transaction; message: Uint8Array; solana: string; at: number };
const pending = new Map<string, Pending>();

/**
 * The transaction for a prepared send, built now: its bytes, hex, for the
 * owner's wallet to sign. `owner` is the wallet's address on the chain;
 * `solana` its Solana address, whose key signs on both.
 */
export async function buildEdSend(sendId: string, chain: EdChain, owner: string, solana: string, to: string, micros: bigint): Promise<string> {
  for (const [id, p] of pending) if (Date.now() - p.at > SIGN_WITHIN_MS * 2) pending.delete(id);
  if ((await edUsdcOf(chain, owner)) < micros) throw new HttpError(400, `There isn't that much USDC on ${chain === "MOVEMENT" ? "Movement" : "Solana"} in the wallet.`, "insufficient_balance");
  if (chain === "MOVEMENT") {
    const client = aptos();
    const sponsor = moveSponsor();
    const tx = await client.transaction.build.simple({
      sender: owner,
      withFeePayer: true,
      data: { function: "0x1::primary_fungible_store::transfer", typeArguments: ["0x1::fungible_asset::Metadata"], functionArguments: [MOVE_USDC, to, micros] },
      options: { expireTimestamp: Math.floor((Date.now() + SIGN_WITHIN_MS + 60_000) / 1000) },
    });
    // The sponsor named before the owner signs, so both sign the same thing.
    tx.feePayerAddress = sponsor.accountAddress;
    const message = generateSigningMessageForTransaction(tx);
    pending.set(sendId, { chain, tx, message, solana, at: Date.now() });
    return Buffer.from(message).toString("hex");
  }
  const conn = solConnection();
  const payer = solFeePayer();
  const from = new PublicKey(owner);
  const toOwner = new PublicKey(to);
  const toAta = getAssociatedTokenAddressSync(SOL_USDC, toOwner, true);
  const tx = new Transaction().add(
    // Their USDC account, opened if it isn't there yet - paid by us.
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, toAta, toOwner, SOL_USDC),
    createTransferInstruction(getAssociatedTokenAddressSync(SOL_USDC, from), toAta, from, micros),
  );
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payer.publicKey;
  const message = tx.serializeMessage();
  pending.set(sendId, { chain, tx, message, solana, at: Date.now() });
  return Buffer.from(message).toString("hex");
}

/** The owner's signature on the built transaction: checked against their key, ours added, broadcast. Returns its hash. */
export async function submitEdSend(sendId: string, signature: Buffer): Promise<string> {
  const p = pending.get(sendId);
  if (!p || Date.now() - p.at > SIGN_WITHIN_MS) throw new HttpError(410, "That took too long to approve. Approve it again.", "expired");
  const pub = bs58.decode(p.solana);
  if (p.chain === "MOVEMENT") {
    const key = new Ed25519PublicKey(pub);
    const sig = new Ed25519Signature(signature);
    if (!key.verifySignature({ message: p.message, signature: sig })) throw new HttpError(400, "That signature isn't from your wallet, so nothing was sent.", "bad_signature");
    const client = aptos();
    const senderAuthenticator = new AccountAuthenticatorEd25519(key, sig);
    const feePayerAuthenticator = client.transaction.signAsFeePayer({ signer: moveSponsor(), transaction: p.tx });
    // Its hash is known before it goes, so an answer lost on the way still leaves something to follow.
    const hash = generateUserTransactionHash({ transaction: p.tx, senderAuthenticator, feePayerAuthenticator });
    try {
      await client.transaction.submit.simple({ transaction: p.tx, senderAuthenticator, feePayerAuthenticator });
    } catch (e) {
      // The node answered and turned it down: nothing was sent.
      if (e instanceof AptosApiError && e.status >= 400 && e.status < 500) throw e;
      throw unclear(e, hash);
    }
    pending.delete(sendId);
    return hash;
  }
  const owner = new PublicKey(pub);
  p.tx.addSignature(owner, signature);
  p.tx.partialSign(solFeePayer());
  if (!p.tx.verifySignatures()) throw new HttpError(400, "That signature isn't from your wallet, so nothing was sent.", "bad_signature");
  const hash = bs58.encode(p.tx.signature!);
  try {
    await solConnection().sendRawTransaction(p.tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  } catch (e) {
    if (e instanceof SendTransactionError) throw e;
    throw unclear(e, hash);
  }
  pending.delete(sendId);
  return hash;
}

/** Sent, maybe: no clear answer came back. Carries the hash, for the caller to follow on the chain rather than send again. */
export class SentUnclear extends Error {
  constructor(message: string, public txHash: string) {
    super(message);
  }
}
const unclear = (e: unknown, hash: string) => new SentUnclear(`No clear answer from the network: ${(e as Error)?.message ?? e}`, hash);
