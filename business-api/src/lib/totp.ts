/**
 * Authenticator-app codes (TOTP, RFC 6238): the six digits Google
 * Authenticator, 1Password, Authy and the rest show, a new one every 30
 * seconds. The secret is kept sealed, like a document. A code is accepted for
 * its own step or the one either side (a phone's clock drifts), and never for
 * a step at or before the last one used, so a code seen over someone's
 * shoulder can't be used again.
 *
 * Recovery codes cover a lost phone: ten, each good once, kept only as hashes.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { open, seal } from "./vault";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret, as the app is given it: 160 random bits in base32. */
export const newSecret = () => toBase32(randomBytes(20));

/** What the QR code holds: the app reads the name, the account and the secret from it. */
export const otpauthUri = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent("Money Moves Business")}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent("Money Moves Business")}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", fromBase32(secret)).update(counter).digest();
  const at = mac[mac.length - 1]! & 15;
  const n = (mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000;
  return n.toString().padStart(6, "0");
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The step a code is right for, near now and after the last one used; null when it isn't right. */
export function checkTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (same(codeAt(secret, s), code)) return s;
  }
  return null;
}

/** For tests: the code an app would show right now. */
export const currentCode = (secret: string, now = Date.now()) => codeAt(secret, Math.floor(now / 1000 / STEP_SECONDS));

export const sealSecret = (secret: string) => seal(Buffer.from(secret, "utf8")).toString("base64");
export const openSecret = (sealed: string) => open(Buffer.from(sealed, "base64")).toString("utf8");

// ─── Recovery codes ───────────────────────────────────────────────────────

const RC = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const hashRecovery = (code: string) => createHash("sha256").update(`mm-recovery:${code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`).digest("hex");

/** Ten codes like "K7Q2-9XHD", shown once; what's kept is their hashes. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 10 }, () => {
    const pick = Array.from({ length: 8 }, () => RC[randomInt(0, RC.length)]).join("");
    return `${pick.slice(0, 4)}-${pick.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

/** Whether this is one of the codes left; if it is, the hashes without it. */
export function useRecoveryCode(hashes: string[], code: string): string[] | null {
  const h = hashRecovery(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : [...hashes.slice(0, i), ...hashes.slice(i + 1)];
}
