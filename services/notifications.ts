import { api } from "./api";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface Notification {
  id: string;
  type: string; // transaction, security, savings, system
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPrefs {
  pushEnabled: boolean;
  emailEnabled: boolean;
  txAlerts: boolean;
  securityAlerts: boolean;
  savingsAlerts: boolean;
  promoAlerts: boolean;
  appUpdates: boolean;
}

// ─── In-app notifications ───────────────────────────────────

export async function getNotifications(): Promise<Notification[]> {
  const { data } = await api.get("/notifications");
  return data;
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await api.get("/notifications/unread-count");
  return data.count;
}

export async function markRead(id: string): Promise<void> {
  await api.patch(`/notifications/${id}/read`);
}

export async function markAllRead(): Promise<void> {
  await api.patch("/notifications/read-all");
}

// ─── Notification preferences ───────────────────────────────

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const { data } = await api.get("/notifications/prefs");
  return data;
}

export async function updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const { data } = await api.patch("/notifications/prefs", prefs);
  return data;
}

// ─── Push notifications ─────────────────────────────────────

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  // shouldShowAlert is gone: SDK 54 splits it into the banner (the drop-down
  // while the phone is in use) and the list (Notification Centre afterwards),
  // and passing the old key alongside the new ones only earns a deprecation
  // warning on every launch.
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request push notification permission, get Expo push token, and register it
 * with the backend. Call this after login / on app launch.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log("[PUSH] Not a physical device, skipping registration");
    return null;
  }

  // Check / request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("[PUSH] Permission not granted");
    return null;
  }

  // Android notification channel.
  //
  // The name is what shows in the phone's own notification settings for this
  // app, so it has to read as something a person recognises - it used to say
  // "default" there. The id stays "default": that is what the server addresses
  // and what existing installs already hold.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Transactions and alerts",
      description: "Money in and out, sign-ins, and verification results.",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#81FB02",
    });
  }

  // Get Expo push token
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  const token = tokenData.data;

  // Register token with backend
  try {
    await api.post("/notifications/push-token", { token });
  } catch (err) {
    console.warn("[PUSH] Failed to register token with backend (will retry later)");
  }

  return token;
}

/**
 * Where a tapped notification lands.
 *
 * Without this, tapping "You received 8.50 USDC" opened the home screen and
 * left the person to go find it, which is the one thing the notification was
 * meant to save them. The push carries only its type, so that is what routes:
 * anything about money goes to the transaction list, anything about the
 * account goes to Security, the rest to the notification list.
 */
/**
 * Screens a broadcast can open, by the name the admin console picks. A name
 * this list doesn't know is ignored, so a push can never send someone to a
 * route the app doesn't have.
 */
const BROADCAST_LINKS: Record<string, string> = {
  notifications: "/notifications",
  home: "/(tabs)",
  add_money: "/deposit",
  sell: "/sell",
  bills: "/bills",
  vouchers: "/voucher",
  referrals: "/referrals",
  leaderboard: "/leaderboard",
  savings: "/(tabs)/savings",
  rates: "/(tabs)/rates",
  transactions: "/transactions",
  kyc: "/account/kyc",
  security: "/account/security",
};

function routeForType(type?: string): string {
  if (type === "transaction") return "/transactions";
  if (type === "security") return "/account/security";
  // A business asking to be paid into this account: straight to where it's approved.
  if (type === "business_link") return "/account/linked-businesses";
  // A business's checkout waiting to be paid from here.
  if (type === "business_payment") return "/business-pay";
  return "/notifications";
}

/**
 * The last tap we have already acted on.
 *
 * Android keeps the last notification response and hands it back to every
 * launch, not only the one it started. So a single tap, any tap, redirected
 * every cold start from then on - and a push with no type routes to the
 * notification list, which is where people kept finding themselves. iOS
 * clears it, which is why this only showed up on the APK.
 *
 * Stored rather than held in memory: the whole problem is that the value
 * survives the process, so what suppresses it has to survive the process too.
 */
const HANDLED_KEY = "notif:lastHandledResponse";

/**
 * Whether a response is really a tap on one of our notifications.
 *
 * The check above was not enough, because on Android not every "response" is
 * a tap. expo-notifications treats ANY launch intent carrying extras as a
 * notification response (ExpoNotificationLifecycleListener.onCreate), and
 * builds it in NotificationSerializer.toResponseBundleFromExtras with an
 * identifier of `google.message_id` - absent when there was no push - and
 * data copied from whatever the extras were. Plenty of Android launchers put
 * extras on an ordinary tap of the app icon, and reopening from Recents
 * replays the original launch intent. So an app opened normally arrived as a
 * "tap" with no id, which skipped the handled check because it keyed on the
 * id, and no type, which routes to the notification list. Most cold starts,
 * on those phones, and never on iOS.
 *
 * Every push the backend sends carries `data.type` (see lib/push.ts) and
 * every real push has a message id, so a response missing either is not a
 * tap to act on.
 */
function isOurTap(response: Notifications.NotificationResponse | null): boolean {
  if (!response) return false;
  const id = response.notification?.request?.identifier;
  const type = response.notification?.request?.content?.data?.type;
  return !!id && typeof type === "string" && type.length > 0;
}

/**
 * Forget the response once acted on, so this process cannot hand it back
 * again - the stored id above covers the next launch, this covers the rest of
 * this one. Guarded: the library throws a plain error, not a crash, on a
 * build without it.
 */
function clearLastResponse(): void {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {}
}

/**
 * Attach tap handling. Call once from a screen that only mounts after the app
 * is unlocked - routing from a cold start while the PIN pad is up would
 * navigate away from it.
 *
 * Returns a teardown function.
 */
export function attachNotificationRouting(): () => void {
  const go = (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data;
    const type = data?.type as string | undefined;
    // A broadcast can name the screen it's about; anything else goes by its type.
    const link = typeof data?.link === "string" ? BROADCAST_LINKS[data.link] : undefined;
    router.push((link ?? routeForType(type)) as any);
  };

  // A tap that launched the app from cold arrives here rather than on the
  // listener, because it happened before anything was listening. Acted on once
  // and once only - see HANDLED_KEY - and only if it is a real tap on one of
  // ours - see isOurTap.
  Notifications.getLastNotificationResponseAsync()
    .then(async (response) => {
      if (!response || !isOurTap(response)) return;
      const id = response.notification.request.identifier;
      const handled = await AsyncStorage.getItem(HANDLED_KEY).catch(() => null);
      if (handled === id) return;
      await AsyncStorage.setItem(HANDLED_KEY, id).catch(() => {});
      clearLastResponse();
      go(response);
    })
    .catch(() => {});

  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    // The same launch-intent "responses" reach the listener too, when an app
    // that is only backgrounded is brought forward with extras on its intent.
    if (!isOurTap(response)) return;
    // Recorded here too: this is the tap Android will replay at the next cold
    // start, and it has already been acted on.
    AsyncStorage.setItem(HANDLED_KEY, response.notification.request.identifier).catch(() => {});
    clearLastResponse();
    go(response);
  });

  // Opening the app is as good as reading them, as far as the springboard
  // badge is concerned.
  Notifications.setBadgeCountAsync(0).catch(() => {});

  return () => sub.remove();
}
