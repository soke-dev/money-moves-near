import { Request, Response, NextFunction } from "express";

/**
 * Who is still on an old app, and whether to keep serving them.
 *
 * An update only ever applies within its own runtime version, so a build from
 * April cannot be reached by anything published today - it will keep calling
 * this API, with whatever rules it was shipped with, until somebody reinstalls
 * from the store. The server is the only thing that can decline.
 *
 * It declines only what says it is older. A request with no version is let
 * through, because absence was never only old apps: the admin console, the
 * landing page, every payment and KYC webhook, the health check and the app's
 * own token refresh all arrive without one. Refusing absence would have
 * stopped deposits being credited the moment the floor went up. What that
 * gives up is the builds from before the header, which the floor cannot reach.
 */

/** version → requests seen, since boot. Read by GET /api/admin/app-versions. */
const seen = new Map<string, number>();

export function appVersionStats(): { version: string; requests: number }[] {
  return [...seen.entries()]
    .map(([version, requests]) => ({ version, requests }))
    .sort((a, b) => b.requests - a.requests);
}

/**
 * Compare two dotted versions. Missing parts count as zero, so "2.0" and
 * "2.0.0" are the same version and neither is newer.
 */
export function versionBelow(sent: string, floor: string): boolean {
  const a = sent.split(".").map((n) => parseInt(n, 10) || 0);
  const b = floor.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function appVersionGate(req: Request, res: Response, next: NextFunction) {
  const sent = String(req.headers["x-app-version"] || "").trim();
  const key = sent || "(none)";
  seen.set(key, (seen.get(key) ?? 0) + 1);

  /**
   * The version on this caller's store, told to every caller.
   *
   * Separate from MIN_APP_VERSION, and much softer. The floor refuses to serve
   * somebody; this only lets the app know a newer build exists, so it can ask
   * them to fetch it. A store build cannot be delivered over the air, so asking
   * is the only move available.
   *
   * Per platform, because the two stores never approve together. 2.0.1 cleared
   * Apple while Google was still reviewing, and one shared value would have
   * sent every Android user to a Play listing that did not have it yet - which
   * is worse than saying nothing, because it looks like the app is broken
   * rather than like the update is late.
   *
   * LATEST_APP_VERSION stays as the fallback for when both are live and there
   * is nothing to tell apart, so the ordinary case is still one variable.
   *
   * Sent as a header rather than an endpoint so it costs no round trip, and
   * read from the environment so each store can be switched on the moment it
   * goes live, without shipping anything.
   */
  const platform = String(req.headers["x-app-platform"] || "").trim().toLowerCase();
  const perPlatform =
    platform === "ios"
      ? process.env.LATEST_APP_VERSION_IOS
      : platform === "android"
        ? process.env.LATEST_APP_VERSION_ANDROID
        : undefined;
  const latest = (perPlatform || process.env.LATEST_APP_VERSION || "").trim();
  if (latest) res.setHeader("X-Latest-App-Version", latest);

  /**
   * The floor, per platform for the same reason as the latest version above.
   * One shared floor raised when Apple approves would refuse every Android user
   * and send them to a Play listing that cannot satisfy it yet. MIN_APP_VERSION
   * stays as the fallback for when both stores have the build.
   */
  const perPlatformFloor =
    platform === "ios"
      ? process.env.MIN_APP_VERSION_IOS
      : platform === "android"
        ? process.env.MIN_APP_VERSION_ANDROID
        : undefined;
  const floor = (perPlatformFloor || process.env.MIN_APP_VERSION || "").trim();
  if (!floor) return next();

  // Only a version we can read, and that is provably older, is refused. See the
  // top of this file for why no version at all is let through.
  if (!sent || sent === "unknown" || !versionBelow(sent, floor)) return next();

  console.warn(`[VERSION] refused ${key} on ${req.method} ${req.originalUrl} — floor is ${floor}`);
  res.status(426).json({
    error:
      "This version of Money Moves is no longer supported. Update from the app store to carry on.",
    minAppVersion: floor,
    appVersion: sent || null,
  });
}
