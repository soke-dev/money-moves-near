/**
 * Request guards that run before anything else.
 *
 * `sameOrigin` is the cross-site defence for a cookie session: anything that
 * changes state has to come from the dashboard's own origin. The cookie is
 * SameSite=Lax as well; the two together stop a page elsewhere from acting as
 * a signed-in person. Development allows tools like curl, which send no Origin.
 */
import type { NextFunction, Request, Response } from "express";
import { env, isDev } from "../config/env";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  // The admin console (on the Money Moves site, through its own proxy) sends a
  // bearer token and never a cookie - nothing a page elsewhere could borrow -
  // so its calls don't need to come from the dashboard.
  if (req.path.startsWith("/api/admin/")) return next();
  // Outside services call these with no browser and no cookie, and each one re-reads
  // what it's told from the service itself (routes/webhooks).
  if (req.path.startsWith("/api/webhooks/")) return next();
  // The API: a business's server, with a secret key and no cookie - and it refuses browsers itself (routes/v1).
  if (req.path.startsWith("/api/v1/")) return next();
  // Money Moves itself, server to server, with the shared secret - checked by the route (routes/app-checkouts).
  if (req.path.startsWith("/api/internal/")) return next();
  const origin = req.get("origin");
  // The customer's checkout has no session to borrow. A server paying for someone (an agent,
  // through PayBox) sends no Origin; a browser always does on a cross-site POST, and still has to be ours.
  if (req.path.startsWith("/api/pay/") && !origin) return next();
  if (origin ? env.ALLOWED_ORIGINS.includes(origin) : isDev) return next();
  res.status(403).json({ error: "This request has to come from the Money Moves Business dashboard.", code: "bad_origin" });
}

const isApi = (req: Request) => req.originalUrl === "/api/v1" || req.originalUrl.startsWith("/api/v1/") || req.originalUrl.startsWith("/api/v1?");

/**
 * An error, in the caller's own shape: the dashboard gets { error, code }; the
 * API (a developer's server) gets { error: { code, message, request_id } }, the
 * request id matching the one in their Logs.
 */
function fail(req: Request, res: Response, status: number, message: string, code = "error") {
  if (isApi(req)) res.status(status).json({ error: { code, message, ...(req.requestId ? { request_id: req.requestId } : {}) } });
  else res.status(status).json({ error: message, code });
}

export function notFound(req: Request, res: Response) {
  fail(req, res, 404, isApi(req) ? "There's no such endpoint. Check the method and the path." : "Nothing here.", "not_found");
}

/** Errors for people are shown as they are; anything else is logged and kept vague. */
export function errors(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    fail(req, res, err.status, err.message, err.code);
    return;
  }
  // The body readers say what went wrong in a field of their own.
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.too.large") {
    fail(req, res, 413, isApi(req) ? "That body is too big. 100 KB at most." : "That's too big. Files can be up to 10 MB.", "too_large");
    return;
  }
  if (type === "entity.parse.failed") {
    fail(req, res, 400, isApi(req) ? "The body isn't valid JSON." : "That request isn't quite right.", isApi(req) ? "invalid_json" : "invalid_request");
    return;
  }
  log.error("[error] unhandled", { path: req.path, method: req.method, reason: err instanceof Error ? err.message : String(err) });
  fail(req, res, 500, "Something went wrong on our side. Try again in a moment.", "server_error");
}
