import Expo, { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { prisma } from "./prisma";

const expo = new Expo();

// Notification type → preference field mapping
const TYPE_TO_PREF: Record<string, keyof Exclude<Awaited<ReturnType<typeof prisma.notificationPrefs.findUnique>>, null>> = {
  transaction: "txAlerts",
  security: "securityAlerts",
  savings: "savingsAlerts",
  promotion: "promoAlerts",
  system: "appUpdates",
};

/** A phone not heard from in this long is treated as gone. */
const TOKEN_MAX_AGE_MS = 90 * 86_400_000;

/**
 * Every phone that should get this person's notifications.
 *
 * One token per signed-in phone, from push_tokens: each phone registers on
 * every unlock, so this follows whichever phones are actually in use. A token
 * whose session has been signed out is skipped, so a phone handed back or
 * logged out stops getting the account's alerts.
 *
 * The single NotificationPrefs token is the fallback, and only a fallback:
 * for people whose phones have not re-registered since this shipped, and for
 * the case where push_tokens cannot be read at all. It is not added when the
 * per-phone list answered - that token belongs to whichever phone opened the
 * app last, which may be the one that has since signed out.
 */
async function deviceTokens(userId: string, legacy: string | null | undefined): Promise<string[]> {
  try {
    const rows = await prisma.pushToken.findMany({
      where: { userId, lastSeenAt: { gte: new Date(Date.now() - TOKEN_MAX_AGE_MS) } },
      select: { token: true, sessionId: true },
    });
    if (rows.length === 0) return legacy && Expo.isExpoPushToken(legacy) ? [legacy] : [];

    const sessionIds = rows.map((r) => r.sessionId).filter((id): id is string => !!id);
    const live = new Set(
      sessionIds.length
        ? (
            await prisma.session.findMany({
              where: { id: { in: sessionIds }, revokedAt: null, expiresAt: { gt: new Date() } },
              select: { id: true },
            })
          ).map((s) => s.id)
        : [],
    );
    return [...new Set(rows.filter((r) => !r.sessionId || live.has(r.sessionId)).map((r) => r.token))].filter((t) =>
      Expo.isExpoPushToken(t),
    );
  } catch (err: any) {
    console.warn(`[PUSH] per-phone tokens unavailable for ${userId}, using the single one: ${err?.message ?? err}`);
    return legacy && Expo.isExpoPushToken(legacy) ? [legacy] : [];
  }
}

/**
 * Send one notification to each of the person's phones.
 *
 * One request to Expo carries all of them, so a second phone costs nothing
 * measurable. A token Expo reports as no longer registered (the app was
 * uninstalled, or the OS revoked it) is removed, so it is not asked again.
 */
async function pushToPhones(
  userId: string,
  legacy: string | null | undefined,
  msg: { title: string; body: string; type: string; link?: string },
): Promise<void> {
  const tokens = await deviceTokens(userId, legacy);
  if (tokens.length === 0) return;

  const messages: ExpoPushMessage[] = tokens.map((to) => ({
    to,
    sound: "default",
    title: msg.title,
    body: msg.body,
    // `link` names a screen for the app to open when it's tapped (a broadcast's choice); older apps ignore it and go by type.
    data: msg.link ? { type: msg.type, link: msg.link } : { type: msg.type },
    // Android puts a notification on a channel, and the channel decides
    // whether it drops down over what you are doing or waits silently in the
    // shade. Without naming ours, these landed on the module's fallback
    // channel at default importance - visible on a swipe down, never a
    // banner. "default" is the MAX-importance channel the app creates on
    // first launch.
    channelId: "default",
    // Money moving is worth waking the radio for.
    priority: "high",
  }));

  const sent: { token: string; ticket: ExpoPushTicket }[] = [];
  for (const chunk of expo.chunkPushNotifications(messages)) {
    const tickets = await expo.sendPushNotificationsAsync(chunk);
    tickets.forEach((ticket, i) => sent.push({ token: chunk[i].to as string, ticket }));
  }

  for (const { token, ticket } of sent) {
    if (!("error" in ticket) || !ticket.error) continue;
    const error = (ticket as any).details?.error ?? ticket.error;
    console.error(`[PUSH] Error for user ${userId}:`, error);
    if (error === "DeviceNotRegistered") {
      await prisma.pushToken.deleteMany({ where: { token } }).catch(() => {});
      if (token === legacy) {
        await prisma.notificationPrefs.update({ where: { userId }, data: { expoPushToken: null } }).catch(() => {});
      }
    }
  }
}

/**
 * Create an in-app notification AND send a push notification to each of the
 * user's phones, unless they have turned that kind of notification off.
 */
export async function sendNotification(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
}) {
  const { userId, type, title, body } = opts;

  // 1. Always create in-app notification
  await prisma.notification.create({
    data: { userId, type, title, body },
  });

  // 2. Check prefs & send push
  try {
    const prefs = await prisma.notificationPrefs.findUnique({ where: { userId } });
    // No prefs row = defaults, all on.
    if (prefs && !prefs.pushEnabled) return;
    const prefKey = TYPE_TO_PREF[type];
    if (prefs && prefKey && prefs[prefKey] === false) return;

    await pushToPhones(userId, prefs?.expoPushToken, { title, body, type });
  } catch (err) {
    console.error("[PUSH] Send error:", err);
    // Push failure should not break the caller
  }
}

/**
 * Send a push notification only (no DB write). Used for broadcast where
 * the in-app notification is already created via createMany.
 */
export async function sendPushOnly(opts: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
}) {
  const { userId, type, title, body, link } = opts;
  try {
    const prefs = await prisma.notificationPrefs.findUnique({ where: { userId } });
    if (prefs && !prefs.pushEnabled) return;
    const prefKey = TYPE_TO_PREF[type];
    if (prefs && prefKey && prefs[prefKey] === false) return;

    await pushToPhones(userId, prefs?.expoPushToken, { title, body, type, link });
  } catch {}
}
