/**
 * Sessions: a random token in an httpOnly cookie, and only its hash in the
 * database. The dashboard never sees the token - script on the page can't
 * read the cookie - and a copy of the sessions table can't sign anyone in.
 */
import type { CookieOptions, Request, Response } from "express";
import { env, isDev } from "../config/env";
import { prisma } from "./prisma";
import { newToken, sha256 } from "./crypto";

export const COOKIE = "mmb_session";
const DAYS = 30;

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: !isDev,
  sameSite: "lax",
  path: "/",
  maxAge: DAYS * 86_400_000,
  domain: env.COOKIE_DOMAIN || undefined,
});

export async function startSession(req: Request, res: Response, userId: string, method: "password" | "google") {
  const token = newToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      userAgent: req.get("user-agent")?.slice(0, 300) ?? null,
      ip: req.clientIp ?? null,
      method,
      expiresAt: new Date(Date.now() + DAYS * 86_400_000),
    },
  });
  res.cookie(COOKIE, token, cookieOptions());
}

export async function endSession(res: Response, sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Signs out every device but this one - after a password change, say. */
export const endOtherSessions = (userId: string, keepId?: string) =>
  prisma.session.updateMany({ where: { userId, revokedAt: null, ...(keepId ? { id: { not: keepId } } : {}) }, data: { revokedAt: new Date() } });

/** The session a cookie belongs to, if it's still good. */
export async function sessionFor(token: string | undefined) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  // "Last seen" without a write on every request.
  if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  return s;
}
