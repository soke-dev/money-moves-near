import { useEffect, useReducer } from "react";
import { AppState } from "react-native";
import { fetchServiceStatus } from "@/services/status";
import type { ServiceKey, ServiceMap } from "@/constants/services";

/**
 * One answer, shared by every screen that asks.
 *
 * A module-level store rather than a context: the Home sheet, the summary
 * screens and the 503 handler all want the same small object, and threading a
 * provider through the tree to deliver four booleans is more machinery than
 * the question deserves. Everything subscribed re-renders when it changes.
 *
 * Not knowing is treated as everything being live. That is what the app did
 * before this existed, and the guards on the server are still the thing that
 * actually stops a paused service — this only decides how early somebody
 * hears about it.
 */

let snapshot: ServiceMap = {};
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Twenty seconds between asks, against a server that caches for thirty.
 *
 * Coming back to the app is the moment this matters — somebody who left the
 * phone on the Home screen for an hour should not tap into a service that
 * went down while they were away — and that is also the moment it is easiest
 * to ask several times over.
 */
const MIN_GAP_MS = 20_000;

export async function refreshServiceStatus(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - fetchedAt < MIN_GAP_MS) return;

  inFlight = (async () => {
    try {
      snapshot = await fetchServiceStatus();
      fetchedAt = Date.now();
      listeners.forEach((l) => l());
    } catch {
      // Silent on purpose. A status call that fails should never be the
      // reason somebody cannot use the app.
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** What is known right now, without subscribing. For one-shot checks. */
export function serviceSnapshot(): ServiceMap {
  return snapshot;
}

export function isServicePaused(key: ServiceKey): boolean {
  return snapshot[key]?.paused === true;
}

export function useServiceStatus() {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(bump);
    refreshServiceStatus();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshServiceStatus();
    });

    return () => {
      listeners.delete(bump);
      sub.remove();
    };
  }, []);

  return {
    services: snapshot,
    paused: (key: ServiceKey) => snapshot[key]?.paused === true,
    detail: (key: ServiceKey) => snapshot[key] ?? null,
  };
}
