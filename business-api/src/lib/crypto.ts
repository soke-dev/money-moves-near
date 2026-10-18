/**
 * The small, careful pieces: random tokens, one-way hashes, and comparisons
 * that take the same time whether the first byte matches or the last.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { env } from "../config/env";

/** A session token: 32 random bytes, safe in a cookie. */
export const newToken = () => randomBytes(32).toString("base64url");

/** What's kept of a token: its SHA-256. A leaked table can't be replayed. */
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A six-digit code, every value equally likely. */
export const newCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

/**
 * What's kept of a code: an HMAC keyed with the pepper. Six digits are only a
 * million guesses, so a plain hash would fall to a lookup table; without the
 * pepper, which never touches the database, there's nothing to look up.
 */
export const hashCode = (code: string, challengeId: string) => createHmac("sha256", env.CODE_PEPPER).update(`${challengeId}:${code}`).digest("hex");

export function sameHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A public merchant id: short, readable, no look-alike letters. */
export function newMerchantId() {
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}
