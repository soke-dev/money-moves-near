/**
 * Where a request really came from.
 *
 * Railway's edge sets X-Real-IP to the caller's address, replacing whatever the
 * caller sent - checked on staging: a forged X-Real-IP comes out as the real
 * one. (X-Forwarded-For ends with Railway's own relay, so it can't be used.)
 *
 * The dashboard reaches us through its own proxy. It passes the edge's value on
 * as X-MMB-Real-IP and proves it's the proxy with a secret only the two
 * services share. Without the secret that header is ignored - a caller can't
 * claim to be someone else by sending it.
 *
 * Getting this right matters beyond logs: rate limits are per address, and if
 * every visitor looked like the proxy, one busy minute would lock everyone out.
 */
import { createHash, timingSafeEqual } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

const digest = (s: string) => createHash("sha256").update(s).digest();

function fromDashboardProxy(req: Request) {
  if (!env.PROXY_SECRET) return false;
  const sent = req.get("x-mmb-proxy");
  return !!sent && timingSafeEqual(digest(sent), digest(env.PROXY_SECRET));
}

export function clientIp(req: Request) {
  const viaProxy = fromDashboardProxy(req);
  const real = (viaProxy ? req.get("x-mmb-real-ip") : req.get("x-real-ip"))?.trim();
  // Locally there's no edge in front: the connection itself is the caller.
  return { ip: real || req.socket.remoteAddress || "unknown", viaProxy };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clientIp: string;
      viaDashboard: boolean;
    }
  }
}

/** Works the address out once, first thing, for everything after it. */
export function resolveClientIp(req: Request, _res: Response, next: NextFunction) {
  const { ip, viaProxy } = clientIp(req);
  req.clientIp = ip;
  req.viaDashboard = viaProxy;
  next();
}
