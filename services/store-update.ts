import { Platform, Linking } from "react-native";
import Constants from "expo-constants";

/**
 * Whether there is a newer build on the stores than the one running.
 *
 * An update over the air only ever reaches installs on its own runtime
 * version, and the runtime version is the app version. So the moment a store
 * build goes out, everybody still on the previous one is beyond the reach of
 * anything we publish - the only way to move them is to ask.
 *
 * The server says what the newest version is, on every response, in
 * X-Latest-App-Version. A header rather than an endpoint because it costs no
 * round trip, and from the server rather than a constant in here because a
 * constant would need the very update these people cannot receive.
 *
 * Comparison is numeric per part, so 2.0.10 is above 2.0.9 - a string compare
 * gets that backwards and would stop prompting exactly when a release series
 * got long enough to matter.
 */

const RUNNING = Constants.expoConfig?.version ?? "";

const PLAY_URL = "https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app";
const APP_STORE_URL = "https://apps.apple.com/app/id6785696053";

type Listener = (latest: string | null) => void;

let latest: string | null = null;
const listeners = new Set<Listener>();

/** True when `a` is an earlier version than `b`. Missing parts count as zero. */
export function isOlder(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = a.split(".").map((n) => parseInt(n, 10) || 0);
  const y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p < q;
  }
  return false;
}

/**
 * Called from the response interceptor with whatever the header said.
 *
 * Only ever moves to a newer version. A response arriving from a stale cache
 * or an older instance mid-deploy must not withdraw a prompt that is correct.
 */
export function noteLatestVersion(value: unknown): void {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || !isOlder(RUNNING, v)) return;
  if (latest && !isOlder(latest, v)) return;
  latest = v;
  for (const l of listeners) l(latest);
}

/** The newer version, or null when this build is current. */
export function storeUpdateAvailable(): string | null {
  return latest;
}

export function subscribeStoreUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Opens this platform's store page. Never throws at a device with no handler. */
export function openStore(): void {
  const url = Platform.OS === "ios" ? APP_STORE_URL : PLAY_URL;
  Linking.openURL(url).catch(() => {});
}

/** The version this bundle says it is: the one sent in X-App-Version. */
export function runningVersion(): string {
  return RUNNING;
}

/**
 * The floor, once the server has refused this build for being under it.
 *
 * The prompt above asks; this is the server no longer answering. Every call
 * gets the same 426 until the app is replaced from the store, so the first one
 * is enough to know, and the whole app gives way to the screen that says so.
 *
 * Only a floor this build is actually under. The server compares the same
 * header the same way, so the check is only here so that a garbled reply
 * cannot raise a screen nobody can get past.
 */
let required: string | null = null;
const requiredListeners = new Set<Listener>();

export function noteUpdateRequired(floor: unknown): void {
  const v = typeof floor === "string" ? floor.trim() : "";
  if (!v || !isOlder(RUNNING, v)) return;
  if (required && !isOlder(required, v)) return;
  required = v;
  for (const l of requiredListeners) l(required);
}

/** The version the server insists on, or null while it still serves this one. */
export function storeUpdateRequired(): string | null {
  return required;
}

export function subscribeUpdateRequired(listener: Listener): () => void {
  requiredListeners.add(listener);
  return () => {
    requiredListeners.delete(listener);
  };
}
