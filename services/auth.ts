import { api, storeTokens, clearTokens, getRefreshToken } from "./api";

// ─── Types ──────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  referralCode: string | null;
  emailVerified: boolean;
  loginVerified: boolean;
  kycStatus: string;
  bioEnabled: boolean;
  /** Username hidden from other people. Absent on older servers. */
  anonMode?: boolean;
  pinSet: boolean;
  walletType?: "MNEMONIC" | "EMBEDDED" | null;
  createdAt: string;
  /**
   * Whether they can still add a friend's referral code - open for the first
   * 7 days if they have no referrer yet. Absent on older servers.
   */
  referralClaim?: { open: boolean; daysLeft: number };
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

// ─── Register ───────────────────────────────────────────────
export async function registerUser(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  referralCode?: string;
}): Promise<{ user: AuthUser } & AuthTokens> {
  const res = await api.post("/auth/register", data);
  const { accessToken, refreshToken, sessionId, user } = res.data;
  await storeTokens(accessToken, refreshToken, sessionId);
  return res.data;
}

// ─── Login ──────────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ user: AuthUser } & AuthTokens> {
  const res = await api.post("/auth/login", { email, password });
  const { accessToken, refreshToken, sessionId } = res.data;
  await storeTokens(accessToken, refreshToken, sessionId);
  return res.data;
}

// ─── Dynamic (email-only) auth ──────────────────────────────
// Exchanges a verified Dynamic.xyz login JWT for our own session tokens.
export async function authenticateWithDynamic(
  token: string,
  /**
   * Only read by the server when this turns out to be a new account. The
   * same call signs returning users in, and for them it is ignored.
   */
  referralCode?: string,
): Promise<{ user: AuthUser } & AuthTokens> {
  const res = await api.post("/auth/dynamic", referralCode ? { token, referralCode } : { token });
  const { accessToken, refreshToken, sessionId } = res.data;
  await storeTokens(accessToken, refreshToken, sessionId);
  return res.data;
}

/**
 * Is this a referral code, and whose?
 *
 * Asked before sign-in, while the code is being typed. `inviter` is null when
 * the owner is anonymous - the code still works, it just does not name them.
 * `valid: false` with a `reason` means the code exists but would not credit
 * anybody from this phone.
 */
export async function checkReferralCode(
  code: string,
): Promise<{ valid: boolean; inviter?: string | null; reason?: string }> {
  const res = await api.get(`/auth/referral/${encodeURIComponent(code)}`);
  return res.data;
}

// ─── Verify Email ───────────────────────────────────────────
export async function verifyEmail(
  email: string,
  code: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/verify-email", { email, code });
  return res.data;
}

// ─── Resend Verification ────────────────────────────────────
export async function resendVerification(
  email: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/resend-verification", { email });
  return res.data;
}

// ─── Set PIN ────────────────────────────────────────────────
export async function setUserPin(pin: string): Promise<{ message: string }> {
  const res = await api.post("/auth/pin/set", { pin });
  return res.data;
}

// ─── Verify PIN ─────────────────────────────────────────────
export async function verifyUserPin(
  pin: string
): Promise<{ accessToken: string }> {
  const res = await api.post("/auth/pin/verify", { pin });

  /**
   * Storing the refreshed token must not be able to fail the verification.
   *
   * This wrote res.data.accessToken straight into AsyncStorage, and multiSet
   * throws on an undefined value - so when the response came back 2xx without
   * a token, a PIN the server had just ACCEPTED was reported to the caller as
   * an exception, and the lock screen said "Incorrect PIN". The session keeps
   * the token it already has instead.
   */
  try {
    const fresh = res?.data?.accessToken;
    // Plain import: this module already imports ./api statically, so the
    // dynamic form was avoiding a cycle that does not exist - and a rejected
    // import() is one more way for a verified PIN to look like a failure.
    const currentRefresh = await getRefreshToken();
    if (typeof fresh === "string" && fresh && typeof currentRefresh === "string" && currentRefresh) {
      await storeTokens(fresh, currentRefresh);
    } else if (__DEV__) {
      console.warn(
        "[PIN] verified, but no fresh token stored —",
        "accessToken:", typeof fresh,
        "| refresh:", typeof currentRefresh,
        "| body keys:", Object.keys(res?.data ?? {}),
      );
    }
  } catch (err) {
    // Whatever goes wrong storing the refreshed token, the PIN was still
    // correct - the server said so. Swallowing this is the difference between
    // a working lock screen and one that rejects the right PIN.
    if (__DEV__) {
      console.warn(
        "[PIN] token bookkeeping after verify failed (ignored) —",
        "message:", (err as any)?.message,
        "| stack:", String((err as any)?.stack || "").split(/\n/).slice(0, 4).join(" | "),
      );
    }
  }

  return res.data;
}

// ─── Toggle Biometric ───────────────────────────────────────
export async function toggleBiometric(
  enabled: boolean
): Promise<{ message: string }> {
  const res = await api.post("/auth/biometric", { enabled });
  return res.data;
}

// ─── Get Current User ───────────────────────────────────────
export async function getMe(): Promise<{ user: AuthUser }> {
  const res = await api.get("/auth/me");
  return res.data;
}

// ─── Logout ─────────────────────────────────────────────────
export async function logoutUser(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch {
    // Best-effort — clear local tokens regardless
  }
  await clearTokens();
}

// ─── Password Reset ─────────────────────────────────────────
export async function requestPasswordReset(
  email: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/password/reset-request", { email });
  return res.data;
}

export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/password/reset-confirm", {
    email,
    code,
    newPassword,
  });
  return res.data;
}

// ─── Change Password ────────────────────────────────────────
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/password/change", {
    currentPassword,
    newPassword,
  });
  return res.data;
}

// ─── PIN Reset ──────────────────────────────────────────────
export async function requestPinReset(): Promise<{ message: string }> {
  const res = await api.post("/auth/pin/reset-request");
  return res.data;
}

export async function confirmPinReset(
  code: string,
  newPin: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/pin/reset-confirm", { code, newPin });
  return res.data;
}

// ─── Change PIN (with current PIN verification) ─────────────
export async function changePin(
  currentPin: string,
  newPin: string
): Promise<{ message: string }> {
  const res = await api.post("/auth/pin/change", { currentPin, newPin });
  return res.data;
}
