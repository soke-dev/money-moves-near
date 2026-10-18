import crypto from "crypto";

/**
 * Anonymous mode, decided in one place.
 *
 * The username is the only field in this product that is both public and
 * addressable - it appears on a leaderboard a stranger can read, and it is
 * also the thing you type to send somebody money. Anonymous mode separates
 * those two: it stops us publishing the handle without stopping the handle
 * working.
 *
 * ── The rule ───────────────────────────────────────────────────────────
 *
 * An anonymous account's username is never returned to another user, with
 * two exceptions, both for something the owner handed over themselves: the
 * lookup that resolves a handle somebody already typed, and "Invited by" for
 * somebody signing up with the owner's referral code (lib/referrals). Being
 * given the handle, or the code, is the permission. This module refuses to
 * hand the name out; it does not refuse to honour what its owner shared.
 *
 * Everything else about the account stays visible - points, volume, referral
 * count, profile picture, rank. Hiding those would make the toggle a choice
 * between privacy and appearing at all, which is not a choice anybody should
 * have to make to avoid being searchable.
 *
 * Kept here rather than inlined at each call site because there are five of
 * them across three files, and a masking rule that is only applied in four
 * of five places is not a masking rule.
 */

/**
 * What another user sees where the handle would have been.
 *
 * "User" rather than "Anon": the app already calls an unnamed counterparty
 * that ("Received from User" is the existing fallback when a transfer has no
 * handle at all), so this reads as the same product rather than as a special
 * state. "Anon" also sounds like a choice made against the person reading
 * it, which is not what it is.
 */
export const ANON_LABEL = "User";

/** The fallback for an account that simply never picked a username. */
export const NO_NAME_LABEL = "Anonymous";

export interface NameableUser {
  id?: string;
  username?: string | null;
  firstName?: string | null;
  anonMode?: boolean | null;
}

/**
 * The name to show this user to somebody else.
 *
 * Returns the flag alongside the string on purpose. A caller that only gets
 * "Anon" back cannot tell a hidden handle from a person literally called
 * that, and the leaderboard needs to know which it is to draw the blur and
 * the explanation.
 */
export function publicName(u: NameableUser): { name: string; anon: boolean } {
  if (u.anonMode) return { name: ANON_LABEL, anon: true };
  return { name: u.username || u.firstName || NO_NAME_LABEL, anon: false };
}

/**
 * The same, for a place that can only carry a string.
 */
export function publicNameOf(u: NameableUser): string {
  return publicName(u).name;
}

/**
 * A stable stand-in for the username in a voucher code.
 *
 * Voucher codes are namespaced by the creator's handle - TOLU-PARTY can only
 * have come from @tolu - which is what stops somebody minting MONEYMOVES50
 * and passing it off as ours. That property is worth keeping, but the plain
 * handle in it would publish the very thing anonymous mode hides, to
 * everybody the voucher is shared with.
 *
 * So an anonymous creator gets a pseudonym instead: derived from their id, so
 * it is stable across their vouchers and still traces to exactly one account
 * for us, while telling a recipient nothing. Letters and digits that are hard
 * to misread, matching the alphabet the random tail already uses.
 *
 * Not reversible by design, and it does not need to be - we resolve a code to
 * its creator through the row, never by reading the prefix.
 */
const UNAMBIGUOUS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function anonCodeHandle(userId: string): string {
  const digest = crypto.createHash("sha256").update(`voucher-handle:${userId}`).digest();
  let out = "";
  for (let i = 0; i < 6; i++) out += UNAMBIGUOUS[digest[i] % UNAMBIGUOUS.length];
  return out;
}
