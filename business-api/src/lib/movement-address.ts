/**
 * The Movement address that belongs to a Solana wallet's key - the way the app
 * derives it: the same Ed25519 public key, as an Aptos-style account,
 * sha3-256(public key || 0x00).
 */
import { createHash } from "crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58, as Solana writes a public key. */
export function base58Decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Buffer.from(bytes);
}

export function movementAddressFromSolana(solanaAddress: string): string | null {
  try {
    const key = base58Decode(solanaAddress);
    if (key.length !== 32) return null;
    return "0x" + createHash("sha3-256").update(Buffer.concat([key, Buffer.from([0])])).digest("hex");
  } catch {
    return null;
  }
}
