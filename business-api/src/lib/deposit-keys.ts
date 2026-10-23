/**
 * Each live crypto payment's own deposit address.
 *
 * Worked out, never stored: the key for a payment comes from DEPOSIT_SEED and
 * the payment's id (HKDF-SHA256), so any address can be opened again later -
 * to sweep it, to give money back from it, or to recover something sent on
 * the wrong chain - with nothing kept but the seed. The EVM chains share one
 * address per payment (the same key on every one of them); Solana and
 * Movement each have their own.
 *
 * The seed can be replaced without stranding anything: the old one goes in
 * DEPOSIT_SEEDS_OLD (comma-separated, newest first). New payments get
 * addresses from DEPOSIT_SEED; opening an existing payment's key tries each
 * seed and keeps the one that gives back the address stored on the payment.
 * Never drop an old seed while any address made from it can still receive or
 * hold money.
 */
import crypto from "crypto";
import { ethers } from "ethers";
import { Keypair } from "@solana/web3.js";
import { Account, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";
import { env } from "../config/env";

const SALT = "money-moves-business/deposits/v1";
const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");

function parseSeed(raw: string, name: string): Buffer {
  const b = /^(0x)?[0-9a-fA-F]{64,}$/.test(raw) ? Buffer.from(raw.replace(/^0x/, ""), "hex") : Buffer.from(raw, "base64");
  if (b.length < 32) throw new Error(`${name} must be at least 32 bytes, hex or base64`);
  return b;
}

let seeds: Buffer[] | undefined;
/** The current seed first, then the old ones. Empty when no seed is set. */
function allSeeds(): Buffer[] {
  if (seeds) return seeds;
  const current = env.DEPOSIT_SEED?.trim();
  if (!current) return (seeds = []);
  const old = (env.DEPOSIT_SEEDS_OLD ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => parseSeed(s, `DEPOSIT_SEEDS_OLD #${i + 1}`));
  return (seeds = [parseSeed(current, "DEPOSIT_SEED"), ...old]);
}

/** Whether payments can have addresses of their own. */
export const depositKeysReady = () => {
  try {
    return allSeeds().length > 0;
  } catch {
    return false;
  }
};

/** How many old seeds are kept for opening earlier payments' addresses. */
export const oldDepositSeeds = () => {
  try {
    return Math.max(0, allSeeds().length - 1);
  } catch {
    return 0;
  }
};

function derive(seed: Buffer, purpose: string, paymentId: string): Buffer {
  return Buffer.from(crypto.hkdfSync("sha256", seed, SALT, `${purpose}:${paymentId}`, 32));
}

const evmFrom = (seed: Buffer, paymentId: string): ethers.Wallet => {
  for (let i = 0; ; i++) {
    const k = derive(seed, i ? `evm:${i}` : "evm", paymentId);
    const n = BigInt(`0x${k.toString("hex")}`);
    if (n > 0n && n < N) return new ethers.Wallet(`0x${k.toString("hex")}`);
  }
};
const solanaFrom = (seed: Buffer, paymentId: string) => Keypair.fromSeed(derive(seed, "solana", paymentId));
const movementFrom = (seed: Buffer, paymentId: string) => Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(derive(seed, "movement", paymentId)) });

/**
 * The key for a payment, from whichever seed made its address.
 *
 * With `stored` (the address on the payment), only a key that gives back that
 * exact address is returned: a payment made before the seed changed still
 * opens, and a wrong key is never used. Without it, the current seed.
 */
function pick<T>(paymentId: string, stored: string | null | undefined, from: (seed: Buffer, id: string) => T, address: (k: T) => string): T {
  const all = allSeeds();
  if (!all.length) throw new Error("DEPOSIT_SEED isn't set");
  if (!stored) return from(all[0]!, paymentId);
  // 0x addresses (EVM, Movement) are stored lowercased; Solana's are case-sensitive and compared exactly.
  const same = (a: string) => a === stored || (a.startsWith("0x") && a.toLowerCase() === stored.toLowerCase());
  for (const seed of all) {
    const k = from(seed, paymentId);
    if (same(address(k))) return k;
  }
  throw new Error("None of the deposit seeds gives this payment's address. Its seed must be added back to DEPOSIT_SEEDS_OLD before its money can move.");
}

/** The payment's key on every EVM chain. */
export const evmDepositWallet = (paymentId: string, stored?: string | null): ethers.Wallet => pick(paymentId, stored, evmFrom, (w) => w.address);

export const solanaDepositKeypair = (paymentId: string, stored?: string | null): Keypair => pick(paymentId, stored, solanaFrom, (k) => k.publicKey.toBase58());

export const movementDepositAccount = (paymentId: string, stored?: string | null) => pick(paymentId, stored, movementFrom, (a) => a.accountAddress.toString());

/** Where the customer sends, on this network, for a new payment: always the current seed. */
export function depositAddressFor(network: string, paymentId: string): string {
  if (network === "Solana") return solanaDepositKeypair(paymentId).publicKey.toBase58();
  if (network === "Movement") return movementDepositAccount(paymentId).accountAddress.toString();
  return evmDepositWallet(paymentId).address;
}
