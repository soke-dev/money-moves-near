import crypto from "crypto";
import { promisify } from "util";
import { env } from "../config/env";

/**
 * The second lock on the admin actions that cost the most if abused: changing
 * a naira rate and closing an account.
 *
 * An admin session is enough to read a user or pause a service; it should not
 * be enough to move the price everybody is quoted or to shut somebody out of
 * their wallet. Those also take this password, and the server is what checks
 * it - the admin page only carries it - so a stolen admin session still cannot
 * do either.
 *
 * Railway holds only a hash (ADMIN_ACTION_PASSWORD_HASH, made by
 * scripts/action-password-hash.ts), so the password itself is in no file, no
 * commit and no environment variable. Without the hash these actions are
 * refused outright rather than left open.
 *
 * Wrong guesses are counted per admin, across both actions: five in an hour
 * locks that admin out until the oldest of them is an hour old.
 */

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const PREFIX = "scrypt";
const KEYLEN = 32;
const MAX_FAILS = 5;
const WINDOW_MS = 60 * 60_000;

/** "scrypt:<salt hex>:<key hex>" - no "$", so nothing on the way to Railway can expand it. */
export async function hashActionPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN);
  return `${PREFIX}:${salt.toString("hex")}:${key.toString("hex")}`;
}

function parse(stored: string): { salt: Buffer; key: Buffer } | null {
  // Forgiving of the usual pastes: the whole "NAME=value" line, or quotes.
  const value = stored
    .trim()
    .replace(/^ADMIN_ACTION_PASSWORD_HASH\s*=\s*/, "")
    .replace(/^["']|["']$/g, "");
  const [prefix, salt, key] = value.split(":");
  if (prefix !== PREFIX || !/^[0-9a-f]{32}$/i.test(salt ?? "") || !/^[0-9a-f]{64}$/i.test(key ?? "")) return null;
  return { salt: Buffer.from(salt, "hex"), key: Buffer.from(key, "hex") };
}

const fails = new Map<string, number[]>();

export type ActionPasswordCheck = { ok: true } | { ok: false; status: number; error: string };

export async function checkActionPassword(who: string, password: unknown, action: string): Promise<ActionPasswordCheck> {
  const stored = env.ADMIN_ACTION_PASSWORD_HASH ? parse(env.ADMIN_ACTION_PASSWORD_HASH) : null;
  if (!stored) {
    if (env.ADMIN_ACTION_PASSWORD_HASH) {
      console.error("[ADMIN] ADMIN_ACTION_PASSWORD_HASH is not a valid scrypt hash");
      return { ok: false, status: 503, error: "Locked: the action password on the server is set but not valid." };
    }
    return { ok: false, status: 503, error: "Locked: no action password is set on the server." };
  }

  const now = Date.now();
  const recent = (fails.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    const mins = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 60_000));
    return { ok: false, status: 429, error: `Too many wrong passwords. Try again in ${mins} min.` };
  }

  // A blank box is a slip, not a guess, so it is not counted.
  if (typeof password !== "string" || password === "") {
    return { ok: false, status: 403, error: "Enter the password." };
  }

  const got = await scrypt(password, stored.salt, KEYLEN);
  if (crypto.timingSafeEqual(got, stored.key)) {
    fails.delete(who);
    return { ok: true };
  }

  recent.push(now);
  fails.set(who, recent);
  console.warn(`[ADMIN] wrong action password from ${who} for ${action} (${recent.length}/${MAX_FAILS} this hour)`);
  return {
    ok: false,
    status: 403,
    error: recent.length >= MAX_FAILS ? "Wrong password. Locked for an hour." : "Wrong password.",
  };
}
