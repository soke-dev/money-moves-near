/**
 * When a session is over, and the app has to say so.
 *
 * A sign-in the server no longer accepts used to leave the app signed in
 * anyway: balances still showed (they come from the chain), the PIN still
 * unlocked, and every transfer failed until the person happened to sign out
 * and back in. Now whatever finds the session dead - a refresh the server
 * turns down, or a wallet whose secure session has lapsed - calls endSession,
 * and the app signs out and opens sign-in with a line saying why.
 *
 * No imports from the API layer or the sheets, so both can use it without a
 * cycle.
 */
export type SessionEndReason = "server" | "wallet";

type Listener = (why: SessionEndReason) => void;
let listener: Listener | null = null;
let endedAt = 0;
let pendingReason: SessionEndReason | null = null;

/** Several requests fail together when a session dies; it ends once. */
const SETTLE_MS = 5_000;

export function onSessionEnded(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function endSession(why: SessionEndReason): void {
  if (Date.now() - endedAt < SETTLE_MS) return;
  endedAt = Date.now();
  pendingReason = why;
  listener?.(why);
}

/**
 * True for a few seconds after a session ends.
 *
 * The screen that was mid-transfer still runs its catch and would raise "That
 * didn't go through" over the sign-in screen, about an error the person can
 * do nothing with. The notice sheet stays down meanwhile.
 */
export function sessionJustEnded(): boolean {
  return Date.now() - endedAt < SETTLE_MS;
}

/** Why the last session ended, once - for the sign-in screen to say. */
export function takeSessionEndReason(): SessionEndReason | null {
  const why = pendingReason;
  pendingReason = null;
  return why;
}

/** Thrown where a dead session stops something; screens read `sessionEnded` to stay quiet. */
export class SessionEndedError extends Error {
  sessionEnded = true;
  // The flag the screens already check before raising an alert of their own.
  maintenanceHandled = true;
}
