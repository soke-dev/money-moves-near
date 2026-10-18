/**
 * Each live crypto payment's own deposit address.
 *
 * Worked out, never stored: the key for a payment comes from DEPOSIT_SEED and
 * the payment's id (HKDF-SHA256), so any address can be opened again later -
 * to sweep it, to give money back from it, or to recover something sent on
 * the wrong chain - with nothing kept but the one seed. The EVM chains share
 * one address per payment (the same key on every one of them); Solana and
 * Movement each have their own.
 */
import crypto from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { env } from "../config/env";

const SALT = "money-moves-business/deposits/v1";
const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

let seed: Buffer | null | undefined;
function seedBytes(): Buffer | null {
  if (seed !== undefined) return seed;
  const raw = env.DEPOSIT_SEED?.trim();
  if (!raw) return (seed = null);
  const b = /^(0x)?[0-9a-fA-F]{64,}$/.test(raw) ? Buffer.from(raw.replace(/^0x/, ""), "hex") : Buffer.from(raw, "base64");
  if (b.length < 32) throw new Error("DEPOSIT_SEED must be at least 32 bytes, hex or base64");
  return (seed = b);
}

/** Whether payments can have addresses of their own. */
export const depositKeysReady = () => {
  try {
    return seedBytes() !== null;
  } catch {
    return false;
  }
};

function derive(purpose: string, paymentId: string): Buffer {
  const s = seedBytes();
  if (!s) throw new Error("DEPOSIT_SEED isn't set");
  return Buffer.from(crypto.hkdfSync("sha256", s, SALT, `${purpose}:${paymentId}`, 32));
}

/** The payment's key on every EVM chain. */
export function evmDepositWallet(paymentId: string): ethers.Wallet {
  for (let i = 0; ; i++) {
    const k = derive(i ? `evm:${i}` : "evm", paymentId);
    const n = BigInt(`0x${k.toString("hex")}`);
    if (n > 0n && n < N) return new ethers.Wallet(`0x${k.toString("hex")}`);
  }
}

export function solanaDepositKeypair(paymentId: string): Keypair {
  return Keypair.fromSeed(derive("solana", paymentId));
}

export function movementDepositAccount(paymentId: string) {
  return Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(derive("movement", paymentId)) });
}

/** Where the customer sends, on this network, for this payment. */
export function depositAddressFor(network: string, paymentId: string): string {
  if (network === "Solana") return solanaDepositKeypair(paymentId).publicKey.toBase58();
  if (network === "Movement") return movementDepositAccount(paymentId).accountAddress.toString();
  return evmDepositWallet(paymentId).address;
}
