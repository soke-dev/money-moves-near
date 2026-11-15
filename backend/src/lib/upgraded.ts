import { prisma } from "./prisma";

/**
 * Whether money may be sent to this person's wallet: only once they're on the
 * upgraded (email) wallet.
 *
 * Wherever we choose which of someone's addresses to pay - a voucher, a buy, a
 * business paying a linked account, a deposit address made for them, a
 * username transfer - an account still on the old 12-word wallet would be paid
 * at its OLD address, which the app no longer shows. On 13 Nov 2026 a voucher
 * claimed twenty minutes before its claimer upgraded went exactly there.
 *
 * Unknown (no wallet type on record) counts as not upgraded, as it does for
 * signing: the app records EMBEDDED on every launch for an upgraded account,
 * so the worst case for one with a stale record is opening the app once.
 */
export async function walletUpgraded(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { walletType: true } });
  return u?.walletType === "EMBEDDED";
}

/** What the person is told when something can't be paid to them yet. */
export const UPGRADE_FIRST = "Your account hasn't moved to Money Moves 2.0 yet. Open the app and sign in to finish moving to your new wallet, then try again.";
