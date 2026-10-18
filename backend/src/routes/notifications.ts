import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { z } from "zod";

const router = Router();

// ─── Notification Preferences ────────────────────────────────

// GET /notifications/prefs — get user's notification preferences
router.get(
  "/prefs",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const prefs = await prisma.notificationPrefs.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      res.json(prefs);
    } catch (err) {
      console.error("[NOTIF PREFS] Get error:", err);
      res.status(500).json({ error: "Failed to fetch preferences" });
    }
  }
);

// PATCH /notifications/prefs — update user's notification preferences
const prefsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  txAlerts: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  savingsAlerts: z.boolean().optional(),
  promoAlerts: z.boolean().optional(),
  appUpdates: z.boolean().optional(),
});

router.patch(
  "/prefs",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const data = prefsSchema.parse(req.body);
      const prefs = await prisma.notificationPrefs.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      res.json(prefs);
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Invalid preferences", details: err.errors });
        return;
      }
      console.error("[NOTIF PREFS] Update error:", err);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  }
);

// POST /notifications/push-token — register Expo push token
const pushTokenSchema = z.object({
  token: z.string().min(1),
});

router.post(
  "/push-token",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { token } = pushTokenSchema.parse(req.body);
      await prisma.notificationPrefs.upsert({
        where: { userId },
        create: { userId, expoPushToken: token },
        update: { expoPushToken: token },
      });

      /**
       * And as one of this person's phones.
       *
       * The single field above is replaced by every phone that registers, so
       * only the newest was ever notified. This keeps a row per phone, tied to
       * the session it registered under, refreshed on every unlock. Keyed on
       * the token, so a phone that switches accounts moves to the new one.
       * Best effort: the single field is already saved, so a failure here
       * only means this phone is notified the old way for now.
       */
      const platform = String(req.headers["x-app-platform"] ?? "").toLowerCase().slice(0, 16) || null;
      const sessionId = req.user!.sessionId ?? null;
      await prisma.pushToken
        .upsert({
          where: { token },
          create: { userId, token, sessionId, platform },
          update: { userId, sessionId, platform, lastSeenAt: new Date() },
        })
        .catch((err) => console.warn("[PUSH TOKEN] per-phone save failed:", err?.message ?? err));

      res.json({ success: true });
    } catch (err: any) {
      if (err.name === "ZodError") {
        res.status(400).json({ error: "Invalid token" });
        return;
      }
      console.error("[PUSH TOKEN] Register error:", err);
      res.status(500).json({ error: "Failed to register push token" });
    }
  }
);

// GET /notifications — list user's notifications (newest first)
router.get(
  "/",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      res.json(notifications);
    } catch (err) {
      console.error("[NOTIFICATIONS] List error:", err);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  }
);

// GET /notifications/unread-count
router.get(
  "/unread-count",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const count = await prisma.notification.count({
        where: { userId, read: false },
      });
      res.json({ count });
    } catch (err) {
      res.status(500).json({ error: "Failed to count" });
    }
  }
);

// PATCH /notifications/:id/read — mark one as read
router.patch(
  "/:id/read",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = String(req.params.id);
      await prisma.notification.updateMany({
        where: { id, userId },
        data: { read: true },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update" });
    }
  }
);

// PATCH /notifications/read-all — mark all as read
router.patch(
  "/read-all",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to update" });
    }
  }
);

export default router;
