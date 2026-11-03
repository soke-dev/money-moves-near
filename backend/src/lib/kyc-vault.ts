/**
 * Encryption for the photos and smile video of manual identity checks.
 *
 * AES-256-GCM with KYC_FILES_KEY. Each file carries the id of the key that
 * sealed it, so the key can be replaced: the new one seals, and the old ones
 * kept in KYC_FILES_KEYS_OLD still open what they sealed. Without a key,
 * nothing can be stored - a check simply can't be taken until one is set.
 */
import crypto from "crypto";
import { env } from "../config/env";

const MAGIC = Buffer.from("MMK1", "latin1");
const ID_LEN = 8;

type Key = { id: Buffer; key: Buffer };
let ring: Key[] | null = null;

function parse(b64: string, name: string): Buffer {
  const k = Buffer.from(b64.trim(), "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
}

function keys(): Key[] {
  if (ring) return ring;
  if (!env.KYC_FILES_KEY) return [];
  const all = [parse(env.KYC_FILES_KEY, "KYC_FILES_KEY"), ...(env.KYC_FILES_KEYS_OLD ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s, i) => parse(s, `KYC_FILES_KEYS_OLD #${i + 1}`))];
  ring = all.map((key) => ({ id: crypto.createHash("sha256").update(key).digest().subarray(0, ID_LEN), key }));
  return ring;
}

/** Whether files can be stored at all. */
export const kycVaultReady = () => keys().length > 0;

export function sealKycFile(plain: Buffer): Buffer {
  const k = keys()[0];
  if (!k) throw new Error("KYC_FILES_KEY is not set");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k.key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, k.id, iv, c.getAuthTag(), body]);
}

export function openKycFile(sealed: Buffer): Buffer {
  if (!sealed.subarray(0, 4).equals(MAGIC)) throw new Error("Not a sealed identity file");
  const id = sealed.subarray(4, 4 + ID_LEN);
  const k = keys().find((x) => x.id.equals(id));
  if (!k) throw new Error("The key that sealed this file isn't set any more. Put it back in KYC_FILES_KEYS_OLD.");
  const iv = sealed.subarray(4 + ID_LEN, 16 + ID_LEN);
  const tag = sealed.subarray(16 + ID_LEN, 32 + ID_LEN);
  const d = crypto.createDecipheriv("aes-256-gcm", k.key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(32 + ID_LEN)), d.final()]);
}
