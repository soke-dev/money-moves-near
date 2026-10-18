import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Referrals, decided in one place.
 *
 * There is no reward. A referral moves the referrer up the referral board and
 * nothing else, which is what keeps the bar for counting low enough to be
 * honest about: a finished sign-up, not a funded account.
 *
 * ── The rule ───────────────────────────────────────────────────────────
 *
 * A friend is ATTRIBUTED when they sign up with the code, or add it inside
 * their first week. They are COUNTED once sign-up is complete - their PIN is
 * set - and they have not deleted the account. Between the two they show as
 * pending on the referrer's dashboard and count for nothing.
 *
 * Email verification needs no rule of its own: Dynamic only issues the token
 * /auth/dynamic creates an account from after the OTP succeeds, so there is no
 * moment at which an unverified account exists to be attributed.
 *
 * Kept here because three places read it - the dashboard, the referral board
 * and the loyalty stats - and a counting rule applied in two of three is how a
 * dashboard says twelve while the board says fifteen.
 */

/** How long after joining somebody may still add the code they forgot. */
export const CLAIM_WINDOW_DAYS = 7;
const CLAIM_WINDOW_MS = CLAIM_WINDOW_DAYS * 86_400_000;

/**
 * A referee who counts. Spread into any `where` over users.
 *
 * Email verified is stated rather than assumed. Every Dynamic account is
 * verified before it exists, but the old password /register route can still
 * make one that is not, and "counts once the email is verified and sign-up is
 * complete" should be true of every account, not just the usual path.
 */
export const COUNTED: Prisma.UserWhereInput = {
  emailVerified: true,
  pinHash: { not: null },
  deletedAt: null,
};

/** The same rule, for a row already in hand. */
export function isCounted(u: { emailVerified: boolean; pinHash: string | null; deletedAt?: Date | null }): boolean {
  return u.emailVerified && !!u.pinHash && !u.deletedAt;
}

/**
 * Codes are issued upper-case ("MM" and six hex digits), and people type them
 * however they like - lower case, with a space, off a screenshot.
 */
export function normaliseCode(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Plausible shape, checked before a query is spent on it. */
export function looksLikeCode(code: string): boolean {
  return /^[A-Z0-9]{4,16}$/.test(code);
}

export type Referrer = {
  id: string;
  username: string | null;
  anonMode: boolean;
  referredBy: string | null;
};

/** The live account a code belongs to, or nothing. */
export async function findReferrer(code: string): Promise<Referrer | null> {
  if (!looksLikeCode(code)) return null;
  const u = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, username: true, anonMode: true, referredBy: true, deletedAt: true },
  });
  if (!u || u.deletedAt) return null;
  return { id: u.id, username: u.username, anonMode: u.anonMode, referredBy: u.referredBy };
}

/**
 * The name a referrer is announced by - even when they are anonymous.
 *
 * A referral code is only ever in somebody's hands because its owner gave it
 * to them, which makes it the same kind of permission as being given the
 * username directly: the one case anonymous mode already lets through. So
 * "Invited by @soke" shows whatever soke's setting, and the anonymous-mode
 * sheet says so. Null only for an account with no username at all.
 */
export function inviterName(r: Referrer): string | null {
  return r.username;
}

export type Block = "own_code" | "cycle" | "same_device";

/**
 * Why this referrer may not be credited for this account, or null when they
 * may.
 *
 * - own_code: nobody refers themselves.
 * - cycle: A may not take B's code when A is the one who referred B. Without
 *   it two people could credit each other and each climb for nothing.
 * - same_device: the referrer has signed in on the phone this is happening
 *   on. A second account on your own handset is the cheapest way to farm a
 *   board, and sessions already record the device.
 *
 * `refereeId` is null at sign-up, before the row exists - at which point the
 * first two cannot happen, since a brand-new account has no code and has
 * referred nobody.
 */
export async function attributionBlock(args: {
  referrer: Referrer;
  refereeId: string | null;
  deviceId?: string;
}): Promise<Block | null> {
  const { referrer, refereeId, deviceId } = args;
  if (refereeId && referrer.id === refereeId) return "own_code";
  if (refereeId && referrer.referredBy === refereeId) return "cycle";
  if (deviceId) {
    const shared = await prisma.session.findFirst({
      where: { userId: referrer.id, deviceId },
      select: { id: true },
    });
    if (shared) return "same_device";
  }
  return null;
}

/** Whether an account is still inside the week it may add a code in. */
export function claimWindow(createdAt: Date, alreadyReferred: boolean): { open: boolean; daysLeft: number } {
  if (alreadyReferred) return { open: false, daysLeft: 0 };
  const left = CLAIM_WINDOW_MS - (Date.now() - createdAt.getTime());
  if (left <= 0) return { open: false, daysLeft: 0 };
  // Rounded up, so the last day reads "1 day left" rather than "0".
  return { open: true, daysLeft: Math.max(1, Math.ceil(left / 86_400_000)) };
}

/**
 * Every referrer with at least one counted friend, most first.
 *
 * The board and the dashboard's rank both come from this, so a person's rank
 * on their dashboard is the position they would find on the board.
 */
export async function referralCounts(): Promise<{ userId: string; count: number }[]> {
  const groups = await prisma.user.groupBy({
    by: ["referredBy"],
    _count: { id: true },
    where: { referredBy: { not: null }, ...COUNTED },
    orderBy: { _count: { id: "desc" } },
  });
  return groups
    .filter((g) => !!g.referredBy)
    .map((g) => ({ userId: g.referredBy as string, count: g._count.id }));
}
