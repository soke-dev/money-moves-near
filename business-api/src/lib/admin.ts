/**
 * Money Moves admins, here.
 *
 * The admin console is the Money Moves app's, and so is its sign-in: a
 * password, an emailed code, then a token the app's backend signs with its own
 * main secret. That secret stays there - a copy here would let this service
 * forge app sessions. Instead this asks the app's backend whether a token is a
 * live admin session (any admin-only route answers that; app-versions is the
 * cheapest, it never touches a database) and remembers the answer for a
 * minute. The token's payload is read for the admin's email only after the app
 * has vouched for it.
 *
 * The actions that cost the most if abused also take the action password,
 * checked here against a hash - the same lock, and the same hash format, as the
 * app's own admin actions.
 */
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "./http";
import { log } from "./log";
import { actionPasswordMatches, parseActionHash } from "./action-password";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { email: string };
    }
  }
}

// ─── Who's asking ─────────────────────────────────────────────────────────

const VOUCHED_FOR_MS = 60_000;
const vouched = new Map<string, { email: string; until: number }>();

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function payloadOf(token: string): { email?: unknown; exp?: unknown } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length > 4096) throw new HttpError(401, "Sign in to the admin console.", "admin_signed_out");

  const key = sha256(token);
  const hit = vouched.get(key);
  if (hit && hit.until > Date.now()) {
    req.admin = { email: hit.email };
    return next();
  }

  let answer: globalThis.Response;
  try {
    answer = await fetch(`${env.APP_API_URL}/api/admin/app-versions`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    log.warn("[admin] couldn't reach the app to check a session", { reason: e instanceof Error ? e.message : String(e) });
    throw new HttpError(503, "Can't check your admin session right now. Try again in a moment.", "admin_check_failed");
  }
  if (answer.status === 401 || answer.status === 403) throw new HttpError(401, "Your admin session has ended. Sign in again.", "admin_signed_out");
  if (!answer.ok) throw new HttpError(503, "Can't check your admin session right now. Try again in a moment.", "admin_check_failed");

  const p = payloadOf(token);
  const email = typeof p.email === "string" ? p.email : "admin";
  const expires = typeof p.exp === "number" ? p.exp * 1000 : Number.POSITIVE_INFINITY;
  vouched.set(key, { email, until: Math.min(Date.now() + VOUCHED_FOR_MS, expires) });
  if (vouched.size > 500) for (const [k, v] of vouched) if (v.until < Date.now()) vouched.delete(k);
  req.admin = { email };
  next();
}

// ─── The action password ──────────────────────────────────────────────────

const MAX_FAILS = 5;
const WINDOW_MS = 60 * 60_000;

const fails = new Map<string, number[]>();

/**
 * Throws unless the password is right. Five wrong in an hour locks that admin
 * out of these actions until the oldest guess is an hour old. A blank box is a
 * slip, not a guess, so it isn't counted.
 */
export async function needActionPassword(req: Request, password: unknown, action: string) {
  const who = req.admin?.email ?? "admin";
  const stored = env.ADMIN_ACTION_PASSWORD_HASH ? parseActionHash(env.ADMIN_ACTION_PASSWORD_HASH) : null;
  if (!stored) {
    throw new HttpError(503, env.ADMIN_ACTION_PASSWORD_HASH ? "Locked: the action password on the server is set but not valid." : "Locked: no action password is set on the server.", "action_locked");
  }
  const now = Date.now();
  const recent = (fails.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS) {
    const mins = Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 60_000));
    throw new HttpError(429, `Too many wrong passwords. Try again in ${mins} min.`, "action_locked");
  }
  if (typeof password !== "string" || password === "") throw new HttpError(403, "Enter the action password.", "action_password");

  if (await actionPasswordMatches(password, stored)) {
    fails.delete(who);
    return;
  }
  recent.push(now);
  fails.set(who, recent);
  log.warn("[admin] wrong action password", { admin: who, action, attempt: recent.length });
  throw new HttpError(403, recent.length >= MAX_FAILS ? "Wrong password. Locked for an hour." : "Wrong password.", "action_password");
}
