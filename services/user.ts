import { Platform } from "react-native";
import { api, getAccessToken, getServerUrl } from "./api";

/**
 * Where a locally-cached profile picture is kept, per account.
 *
 * It used to be one device-wide "@avatar", which logout never cleared - so the
 * next account to sign in on the same phone, having no picture of its own,
 * showed the previous one's. Keyed by account, that cannot happen, and the
 * cache survives a sign-out and back in as it was meant to.
 *
 * The unkeyed name is kept as the fallback so a photo cached by an older build
 * is not orphaned mid-upgrade.
 */
export function avatarKey(userId?: string | null): string {
  return userId ? `@avatar_${userId}` : "@avatar";
}

// ─── Types ──────────────────────────────────────────────────
export interface UserProfile {
  id: string;
  email: string;
  phone: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  kycStatus: string;
  bioEnabled: boolean;
  /** Username hidden from other people. Absent on older servers. */
  anonMode?: boolean;
  pinSet: boolean;
  createdAt: string;
  /** Set once the user has asked us to close the account. */
  deletionRequestedAt: string | null;
}

export interface NotificationPrefs {
  pushEnabled: boolean;
  emailEnabled: boolean;
  txAlerts: boolean;
  priceAlerts: boolean;
  promoAlerts: boolean;
}

// ─── Profile ────────────────────────────────────────────────
export async function getProfile(): Promise<UserProfile> {
  const res = await api.get("/user/profile");
  return res.data;
}

export async function updateProfile(data: {
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}): Promise<UserProfile> {
  const res = await api.patch("/user/profile", data);
  return res.data;
}

// ─── Notification Preferences ───────────────────────────────
export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  const res = await api.get("/user/notification-prefs");
  return res.data;
}

export async function updateNotificationPrefs(data: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
  const res = await api.patch("/user/notification-prefs", data);
  return res.data;
}

// ─── Referral Stats ─────────────────────────────────────────
export interface ReferralStats {
  referralCode: string;
  stats: {
    loyaltyPoints: number;
    totalVolume: number;
    referralCount: number;
  };
}

export async function getReferralStats(): Promise<ReferralStats> {
  const res = await api.get("/user/referral-stats");
  return res.data;
}

// ─── Avatar ─────────────────────────────────────────────────
export async function uploadAvatar(uri: string): Promise<{ avatarUrl: string }> {
  if (Platform.OS === "web") {
    // Fetch the blob the picker gave us.
    const resp = await fetch(uri);
    let blob = await resp.blob();

    // Normalize mime: the server's fileFilter only allows image/jpeg|png|webp.
    // expo-image-picker on web sometimes produces blobs with empty or
    // application/octet-stream types, which would be rejected with a 400.
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(blob.type)) {
      blob = new Blob([blob], { type: "image/jpeg" });
    }
    const ext =
      blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";

    const form = new FormData();
    form.append("avatar", blob, `avatar.${ext}`);

    // Bypass axios entirely so its default application/json Content-Type
    // can't override the browser's multipart boundary.
    const token = await getAccessToken();
    const res = await fetch(`${getServerUrl()}/api/user/avatar`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      throw new Error(data?.error || `Upload failed (${res.status})`);
    }
    return data;
  }

  // Native: React Native's FormData accepts { uri, name, type }.
  const form = new FormData();
  const ext = (uri.split(".").pop() || "jpg").toLowerCase();
  const mime = ext === "png" ? "image/png" : "image/jpeg";
  form.append("avatar", { uri, name: `avatar.${ext}`, type: mime } as any);
  const res = await api.post("/user/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function deleteAvatar(): Promise<void> {
  await api.delete("/user/avatar");
}

// ─── Username Availability ──────────────────────────────────
export async function checkUsername(username: string): Promise<{ available: boolean; reason?: string }> {
  const res = await api.get(`/user/check-username/${encodeURIComponent(username)}`);
  return res.data;
}

// ─── Phone Change (with email verification) ─────────────────
export async function requestPhoneChange(phone: string): Promise<{ message: string }> {
  const res = await api.post("/user/phone-change/request", { phone });
  return res.data;
}

export async function verifyPhoneChange(code: string): Promise<{ message: string; phone: string }> {
  const res = await api.post("/user/phone-change/verify", { code });
  return res.data;
}

// ─── Username Lookup (for internal transfers) ───────────────
export interface LookupUser {
  id: string;
  username: string;
  /**
   * Null when the account is anonymous.
   *
   * The screens already fall back to the username when both are missing, so
   * this needs no special handling - a name is simply not part of what an
   * anonymous account confirms with.
   */
  firstName: string | null;
  lastName: string | null;
  /** True when the name was withheld rather than never set. */
  anon?: boolean;
  avatarUrl: string | null;
}

export async function lookupUsername(username: string): Promise<LookupUser> {
  const res = await api.get(`/user/lookup/${encodeURIComponent(username)}`);
  return res.data.user;
}

/**
 * Ask for the account to be closed.
 *
 * Nothing is destroyed by this call - a person reviews it, and the account
 * keeps working in the meantime. `deleteAccount` below is the immediate wipe,
 * which the app no longer calls.
 */
export async function requestAccountDeletion(
  reason?: string,
): Promise<{ deletionRequestedAt: string; alreadyRequested: boolean }> {
  const res = await api.post("/user/account/deletion-request", reason ? { reason } : {});
  return res.data;
}

export async function cancelAccountDeletion(): Promise<void> {
  await api.delete("/user/account/deletion-request");
}

export async function deleteAccount(): Promise<void> {
  await api.delete("/user/account");
}

/**
 * Hide the username from other people, or stop hiding it.
 *
 * Takes effect from here on rather than retroactively: transfers already sent
 * keep the name that was public when they were sent.
 */
export async function setAnonMode(enabled: boolean): Promise<{ anonMode: boolean }> {
  const res = await api.patch("/user/anon-mode", { enabled });
  return res.data;
}

// ─── Referrals ──────────────────────────────────────────────

export interface ReferralFriend {
  /** "User" when the friend is anonymous. */
  name: string;
  anon: boolean;
  /** PIN set: sign-up finished, and they count on the board. */
  counted: boolean;
  joinedAt: string;
}

export interface ReferralDashboard {
  code: string;
  counted: number;
  pending: number;
  /** Position on the referral board, or null with nobody counted yet. */
  rank: number | null;
  /** Newest first, at most fifty. The two counts above are not capped. */
  friends: ReferralFriend[];
  /** Whether this account may still add the code it forgot at sign-up. */
  claim: { open: boolean; daysLeft: number };
}

export async function getReferralDashboard(): Promise<ReferralDashboard> {
  const res = await api.get("/user/referrals");
  return res.data;
}

export async function claimReferralCode(
  code: string,
): Promise<{ ok: boolean; inviter: string | null }> {
  const res = await api.post("/user/referrals/claim", { code });
  return res.data;
}
