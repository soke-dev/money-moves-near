/**
 * Who's asking, and what they may do.
 *
 * `loadSession` reads the cookie on every request; `requireUser` turns away
 * anyone not signed in; `requireMember` checks they belong to the business in
 * the URL - and, when roles are given, that their role is one of them. A
 * business someone isn't part of answers 404, not 403, so its existence isn't
 * confirmed to strangers.
 */
import type { NextFunction, Request, Response } from "express";
import type { Member, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { COOKIE, sessionFor } from "../lib/session";
import { HttpError } from "../lib/http";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; sessionId: string };
      member?: Member;
    }
  }
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const s = await sessionFor(req.cookies?.[COOKIE]);
  if (s) req.auth = { userId: s.userId, sessionId: s.id };
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw new HttpError(401, "Sign in to continue.", "signed_out");
  next();
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A member of this business, in one of these roles. A business our team has
 * deactivated can still be signed into and looked at - its history is its own -
 * but nothing about it can be changed and no money moved: every request that
 * would is refused here, whatever the route.
 */
export function requireMember(...roles: Role[]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw new HttpError(401, "Sign in to continue.", "signed_out");
    const businessId = String(req.params.businessId ?? "");
    const member = businessId ? await prisma.member.findUnique({ where: { businessId_userId: { businessId, userId: req.auth.userId } } }) : null;
    if (!member) throw new HttpError(404, "No business here.", "not_found");
    if (roles.length && !roles.includes(member.role)) throw new HttpError(403, "Your role can't do that. Ask an owner or admin.", "forbidden");
    if (!READS.has(req.method)) {
      const b = await prisma.business.findUnique({ where: { id: businessId }, select: { status: true } });
      if (b?.status === "SUSPENDED") throw new HttpError(403, "Money Moves has deactivated this business, so nothing can be changed. You can still see its history. Write to support@usemoneymoves.xyz about it.", "business_deactivated");
    }
    req.member = member;
    next();
  };
}
