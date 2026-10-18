/**
 * The action password's hash: "scrypt:<salt hex>:<key hex>" - the app's own
 * format, so one password can unlock both consoles.
 *
 * Nothing here reads the server's settings, so the script that makes the hash
 * (scripts/action-password-hash.ts) runs anywhere, with no database or .env.
 */
import crypto from "crypto";
import { promisify } from "util";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEYLEN = 32;

export async function hashActionPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const k = await scrypt(password, salt, KEYLEN);
  return `scrypt:${salt.toString("hex")}:${k.toString("hex")}`;
}

/** A stored hash, read leniently: pasted with its name in front, or in quotes, it still counts. */
export function parseActionHash(stored: string): { salt: Buffer; key: Buffer } | null {
  const value = stored
    .trim()
    .replace(/^ADMIN_ACTION_PASSWORD_HASH\s*=\s*/, "")
    .replace(/^["']|["']$/g, "");
  const [prefix, salt, k] = value.split(":");
  if (prefix !== "scrypt" || !/^[0-9a-f]{32}$/i.test(salt ?? "") || !/^[0-9a-f]{64}$/i.test(k ?? "")) return null;
  return { salt: Buffer.from(salt!, "hex"), key: Buffer.from(k!, "hex") };
}

/** Whether a password matches a stored hash - compared in constant time. */
export async function actionPasswordMatches(password: string, stored: { salt: Buffer; key: Buffer }): Promise<boolean> {
  const got = await scrypt(password, stored.salt, KEYLEN);
  return crypto.timingSafeEqual(got, stored.key);
}
