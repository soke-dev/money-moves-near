import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { StringValue } from "ms";
import { env } from "../config/env";

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as StringValue,
    algorithm: "HS512",
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRY as StringValue,
    algorithm: "HS512",
    // Unique every time. Without it two tokens for one session issued in the
    // same second were identical, and storing the second broke the unique hash -
    // a refresh that failed outright when several requests renewed at once.
    jwtid: crypto.randomUUID(),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ["HS512"],
  }) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    algorithms: ["HS512"],
  }) as RefreshTokenPayload;
}

/** Hash a refresh token for DB storage (never store raw tokens) */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Generate a cryptographically secure 6-digit code */
export function generateVerificationCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/** Compute refresh token expiry date */
export function getRefreshExpiry(): Date {
  const days = parseInt(env.JWT_REFRESH_EXPIRY) || 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
