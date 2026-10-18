import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { showMaintenanceAlert } from "@/components/PausedSheet";
import { PAUSED_TITLES, type ServiceKey } from "@/constants/services";
import { getDeviceId } from "./device-id";
import { endSession } from "./session";
import { noteLatestVersion, noteUpdateRequired } from "./store-update";

// Production backend on Railway
const PROD_API = "https://backend-production-6f042.up.railway.app";

// Local dev URLs
const LOCAL_API =
  Platform.OS === "web"
    ? "http://localhost:4000"
    : "http://192.168.1.250:4000";

/**
 * Force the production API while running in dev.
 *
 * It does nothing to a release build: `!__DEV__` already picks production, so
 * whatever this says, a shipped app talks to Railway. An earlier note here
 * claimed it had to be flipped back before building, which sent at least one
 * person looking for a release that could not exist.
 *
 * On, so a phone running the dev bundle talks to Railway and sees the same
 * data as everybody else. Set it back to false to point at a backend running
 * on this machine - LOCAL_API's LAN address has to be right for that, which is
 * the other thing that has to be true and usually is not.
 */
const USE_PROD = true;

const getBaseUrl = () => {
  const base = USE_PROD || !__DEV__ ? PROD_API : LOCAL_API;
  return `${base}/api`;
};

export const getServerUrl = () => {
  return USE_PROD || !__DEV__ ? PROD_API : LOCAL_API;
};

/**
 * Which app this is, said on every request.
 *
 * Nothing the app sent identified its version, so the server could not tell a
 * build from four months ago from one shipped today - and the old ones cannot
 * be reached by an update at all, because an update only applies within its
 * own runtime version. Saying so is the only way the server can ever decline
 * to serve them.
 *
 * The server's floor only ever reaches builds that send this. A request with
 * no version header is always served, because webhooks and the admin console
 * send none either - see the middleware that reads it. The token refresh below
 * goes out on bare axios without it, and is served for the same reason.
 *
 * `version` is app.json's, which is also the runtime version under the
 * appVersion policy, so one number answers both questions.
 */
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";

export const api = axios.create({
  baseURL: getBaseUrl(),
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    "X-App-Version": APP_VERSION,
    "X-App-Platform": Platform.OS,
  },
});

// ─── Token storage keys ────────────────────────────────────
const ACCESS_TOKEN_KEY = "@accessToken";
const REFRESH_TOKEN_KEY = "@refreshToken";
const SESSION_ID_KEY = "@sessionId";

export async function storeTokens(accessToken: string, refreshToken: string, sessionId?: string) {
  /**
   * Only write what we actually have.
   *
   * AsyncStorage.multiSet throws "Cannot read property 'replace' of undefined"
   * on an undefined value, and that exception propagates into whatever was
   * being done at the time - a PIN verification the server had already
   * accepted was surfacing as "Incorrect PIN" because of it. A response that
   * omits a token should leave the stored one alone, not crash the caller.
   */
  const pairs: [string, string][] = [];
  if (typeof accessToken === "string" && accessToken) pairs.push([ACCESS_TOKEN_KEY, accessToken]);
  if (typeof refreshToken === "string" && refreshToken) pairs.push([REFRESH_TOKEN_KEY, refreshToken]);
  if (typeof sessionId === "string" && sessionId) pairs.push([SESSION_ID_KEY, sessionId]);
  if (pairs.length) await AsyncStorage.multiSet(pairs);
}

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_TOKEN_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return AsyncStorage.getItem(REFRESH_TOKEN_KEY);
}

export async function clearTokens() {
  await AsyncStorage.multiRemove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, SESSION_ID_KEY]);
}

// ─── Request interceptor: attach access token ──────────────
api.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  /**
   * On every request rather than only on sign-up, so a device that already has
   * accounts is recognised as the same one when it comes back. Cached after
   * the first read, so this costs nothing per call.
   *
   * Absent if the keychain would not answer. The server treats a missing
   * header as an unknown device and lets the request through, which is the
   * only safe direction - refusing to let somebody sign in because their
   * storage failed would be a far worse bug than the one this prevents.
   */
  const deviceId = await getDeviceId();
  if (deviceId) {
    config.headers["X-Device-Id"] = deviceId;
  }
  return config;
});

// ─── Response interceptor: refresh on 401 ──────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => {
    if (error) p.reject(error);
    else p.resolve(token!);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => {
    // Every response carries the newest version on the stores. Read here so a
    // build that can no longer be updated over the air still learns that a
    // newer one exists.
    noteLatestVersion(response.headers?.["x-latest-app-version"]);
    return response;
  },
  async (error) => {
    // Failures carry it too - a 401 or a 503 is still a reply from a server
    // that knows the current version, and somebody stuck on an old build is
    // more likely to be seeing errors than not.
    noteLatestVersion(error?.response?.headers?.["x-latest-app-version"]);
    const originalRequest = error.config;

    /**
     * This build is under the floor the server now enforces.
     *
     * The update screen takes over from here. `maintenanceHandled` is set so
     * the screens it replaces do not raise alerts of their own on the way out
     * - the same flag the paused-service sheet uses, which they already read.
     */
    if (error.response?.status === 426) {
      noteUpdateRequired(error.response?.data?.minAppVersion);
      error.maintenanceHandled = true;
    }

    /**
     * A paused service, caught mid-flow.
     *
     * The backstop for the case the app could not warn about in advance -
     * the switch was flipped while somebody was already typing. Screens read
     * `maintenanceHandled` to know the sheet has spoken and they should not
     * also raise their own alert.
     *
     * `paused` and `service` are what the server sends now; the word test is
     * kept because a build already on somebody's phone may be talking to a
     * newer server than the one it was written against, and the default
     * messages still carry the word.
     */
    if (error.response?.status === 503) {
      const data = error.response?.data || {};
      const msg = data.error;
      const named = typeof data.service === "string" ? (data.service as ServiceKey) : null;

      if (typeof msg === "string" && (data.paused === true || /maintenance/i.test(msg))) {
        showMaintenanceAlert(msg, named ? PAUSED_TITLES[named] : undefined);
        error.maintenanceHandled = true;
      }
    }

    /**
     * Refreshed, retried, and still refused for the session itself.
     *
     * The server used to hand out a fresh token for a session it no longer
     * accepted, so the retry failed exactly like the first try and the app
     * stayed signed in with every transfer failing until the person signed out
     * and back in by chance. A session the server won't take back is over:
     * sign out and say so.
     */
    if (
      error.response?.status === 401 &&
      originalRequest?._retry &&
      error.response?.data?.code === "SESSION_INVALID"
    ) {
      await clearTokens();
      endSession("server");
      error.sessionEnded = true;
      error.maintenanceHandled = true;
      return Promise.reject(error);
    }

    // Don't retry refresh endpoint or already-retried requests
    if (
      error.response?.status !== 401 ||
      originalRequest._retry ||
      originalRequest.url?.includes("/auth/refresh") ||
      originalRequest.url?.includes("/auth/login")
    ) {
      return Promise.reject(error);
    }

    // Mark immediately to prevent the same request from entering twice
    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    isRefreshing = true;

    let usedRefreshToken: string | null = null;
    try {
      const refreshToken = await getRefreshToken();
      usedRefreshToken = refreshToken;
      if (!refreshToken) {
        processQueue(new Error("No refresh token"), null);
        // Don't clear tokens — access token may still be valid for other requests
        return Promise.reject(new Error("No refresh token"));
      }

      const { data } = await axios.post(`${getBaseUrl()}/auth/refresh`, {
        refreshToken,
      });

      await storeTokens(data.accessToken, data.refreshToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      processQueue(null, data.accessToken);
      return api(originalRequest);
    } catch (refreshError: any) {
      // The backend ROTATES refresh tokens: each use revokes the previous one.
      // When several requests 401 at once (home loads balances, transactions,
      // savings and rates together), one of them can present a token that has
      // already been rotated. The backend flags that as a harmless race —
      // TOKEN_ALREADY_ROTATED — and does NOT revoke the session, so the right
      // move is to pick up whatever token is now stored and retry, not to fail.
      const code = refreshError?.response?.data?.code;
      if (code === "TOKEN_ALREADY_ROTATED") {
        // Give the concurrent refresh a beat to finish writing the new pair.
        await new Promise((r) => setTimeout(r, 400));
        const latest = await getRefreshToken();
        // Only worth another go if storage now holds a DIFFERENT refresh token —
        // that means another caller rotated it and we can use the new one. Do a
        // real refresh: reusing the stored access token is pointless because it
        // is the same expired one that triggered this 401 in the first place.
        if (latest && latest !== usedRefreshToken) {
          try {
            const { data } = await axios.post(`${getBaseUrl()}/auth/refresh`, {
              refreshToken: latest,
            });
            await storeTokens(data.accessToken, data.refreshToken);
            processQueue(null, data.accessToken);
            originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
            return api(originalRequest);
          } catch {
            // Fall through and reject with the original error.
          }
        }
      }
      processQueue(refreshError, null);

      // Distinguish a dead session from a flaky network. A transient failure has
      // NO response at all, and must never log anyone out. But any 401 from the
      // refresh endpoint means the refresh token is unusable - expired, revoked,
      // replayed, or its session ended - and older servers sent some of those
      // with no code at all ("Refresh token expired"). Keeping it only strands
      // the user in a zombie session where every transfer fails, so sign out
      // now and open sign-in, rather than waiting for the next launch.
      const status = refreshError?.response?.status;
      if (status === 401) {
        await clearTokens();
        endSession("server");
        refreshError.sessionEnded = true;
        refreshError.maintenanceHandled = true;
      }

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);
