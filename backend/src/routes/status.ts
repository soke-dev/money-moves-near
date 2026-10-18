import { Router, Request, Response } from "express";
import { listServices, isAppFacing, solanaSendFee } from "../lib/service-status";
import { publicStats } from "../lib/public-stats";

const router = Router();

/**
 * GET /status/analytics — the public analytics page's figures, live.
 *
 * Aggregates only, so it needs no session; at most ten minutes old (see
 * lib/public-stats.ts).
 */
router.get("/analytics", async (_req: Request, res: Response) => {
  try {
    res.set("Cache-Control", "public, max-age=300");
    res.json(await publicStats());
  } catch (err: any) {
    console.error("[STATUS] analytics failed:", err?.message ?? err);
    res.status(503).json({ error: "Figures are unavailable right now." });
  }
});

/**
 * GET /status — what is on, for anyone who asks.
 *
 * Unauthenticated, because the app needs it before a session exists and
 * there is nothing private in it: which services are up is something every
 * person using the app is about to discover anyway. It is behind the same
 * global rate limiter as everything else under /api.
 *
 * This is the piece that was missing. The guards inside the routes already
 * stopped a paused service from doing anything; nothing told the app so
 * beforehand, which is why somebody could pick Bank Transfer, choose an
 * account and type an amount before hearing about it.
 *
 * Shaped as a map rather than a list so the app can ask about one service
 * without scanning.
 */
router.get("/", async (_req: Request, res: Response) => {
  const services = await listServices();

  const map: Record<string, unknown> = {};
  for (const s of services) {
    // Switches with no row in the app have nothing for it to mark.
    if (!isAppFacing(s.key)) continue;
    map[s.key] = {
      paused: s.paused,
      note: s.note,
      message: s.message,
      backBy: s.backBy,
    };
  }

  // A short cache header for anything between us and the phone. The server's
  // own cache is thirty seconds; there is no sense in a proxy holding it far
  // longer than that.
  res.set("Cache-Control", "public, max-age=20");
  /**
   * Fees alongside the services, because a charge is something the app has
   * to say BEFORE somebody commits, not after.
   *
   * The screen that names it renders before prepare is called, so it cannot
   * learn the figure from the response to a send it has not made yet. And a
   * fee schedule is public by nature: it is on the confirm screen of every
   * transfer regardless.
   */
  res.json({
    services: map,
    fees: { solanaSend: await solanaSendFee() },
  });
});

export default router;
