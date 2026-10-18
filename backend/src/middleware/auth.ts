import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenPayload } from "../lib/tokens";
import { prisma } from "../lib/prisma";

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
      clientIp?: string;
      deviceId?: string;
      deviceInfo?: string;
    }
  }
}

/**
 * Require a valid JWT access token.
 * Attaches user payload to req.user.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      res.status(401).json({ error: "Token expired", code: "TOKEN_EXPIRED" });
    } else {
      res.status(401).json({ error: "Invalid token" });
    }
  }
}

/**
 * Verify the session is still valid (not revoked).
 * Use after requireAuth for sensitive operations.
 */
export async function requireActiveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id: req.user.sessionId },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    res.status(401).json({ error: "Session expired or revoked", code: "SESSION_INVALID" });
    return;
  }

  // New-device login requires email code verification. Unverified sessions
  // can only hit `requireAuth`-only endpoints (verify-email, resend, me, logout).
  if (!session.loginVerifiedAt) {
    res.status(401).json({ error: "Login verification required", code: "LOGIN_NOT_VERIFIED" });
    return;
  }

  // Block deleted accounts
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { deletedAt: true },
  });
  if (!user || user.deletedAt) {
    res.status(403).json({ error: "Account has been deleted", code: "ACCOUNT_DELETED" });
    return;
  }

  // Update last active
  await prisma.session.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() },
  });

  next();
}

/**
 * Require the user's email to be verified.
 * Use after requireAuth for financial operations.
 */
export async function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    select: { emailVerified: true },
  });

  if (!user || !user.emailVerified) {
    res.status(403).json({ error: "Email verification required", code: "EMAIL_NOT_VERIFIED" });
    return;
  }

  next();
}

/**
 * Extract client IP and device info from request headers.
 */
export function extractClientInfo(req: Request, _res: Response, next: NextFunction): void {
  req.clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";
  req.deviceInfo = req.headers["user-agent"] || "unknown";
  /**
   * The handset, as far as we can tell.
   *
   * Not the user-agent, which is useless for this: four hundred of our
   * sessions report the identical string "okhttp/4.12.0", because that is the
   * HTTP library every Android build ships with. This is a value the app makes
   * once and keeps in the device keychain.
   *
   * Undefined for every build from before it existed, and for anything that
   * is not our app. Nothing may treat absence as a device.
   */
  const raw = req.headers["x-device-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  req.deviceId = typeof id === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(id) ? id : undefined;
  next();
}
