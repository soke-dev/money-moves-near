import { env } from "../config/env";
import { prisma } from "./prisma";
import * as ton from "./ton";

/**
 * A TON row left behind by a key change.
 *
 * A TON address is calculated from the Solana key, but it is also saved as a row
 * of its own, and moving an account to its email wallet only rewrites the chains
 * the app sends. So the row went on naming the old key's wallet: balances read
 * it, the deposit screen showed it, money arrived there, and the new key could
 * not sign for it. A send then failed as an address mismatch, correctly.
 *
 * An empty stale row is simply corrected. One holding money is left alone, since
 * correcting it would show the person a balance of nothing; the recovery routes
 * move the money first and correct the row afterwards.
 */

export interface TonRowState {
  /** The account's Solana address, the key it signs with now. */
  solana: string | null;
  /** The address saved in the TON row. */
  saved: string | null;
  /** The TON address its current key actually controls. */
  current: string | null;
  stale: boolean;
}

export function compareTonRow(solana: string | null, saved: string | null): TonRowState {
  if (!solana || !saved) return { solana, saved, current: null, stale: false };
  try {
    const current = ton.tonAddressFromSolana(solana);
    return { solana, saved, current, stale: !ton.sameTonAddress(saved, current) };
  } catch {
    return { solana, saved, current: null, stale: false };
  }
}

export async function tonRowState(userId: string): Promise<TonRowState> {
  const rows = await prisma.wallet.findMany({
    where: { userId, chain: { in: ["SOL", "TON"] }, address: { not: null } },
    select: { chain: true, address: true },
  });
  const solana = rows.find((r) => r.chain === "SOL")?.address ?? null;
  const saved = rows.find((r) => r.chain === "TON")?.address ?? null;
  return compareTonRow(solana, saved);
}

/** The recovery opens for named accounts first; "*" opens it for everyone. */
export function recoveryAllowed(username: string | null | undefined): boolean {
  const list = env.TON_RECOVERY_USERS.split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (list.includes("*")) return true;
  return !!username && list.includes(username.toLowerCase());
}

/** Point the TON rows at the current key, keeping a note of the old address. */
export async function correctTonRow(userId: string, oldAddress: string, current: string): Promise<void> {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { displacedAddresses: true } });
  const displaced = Array.isArray(account?.displacedAddresses) ? (account!.displacedAddresses as any[]) : [];
  await prisma.$transaction([
    prisma.wallet.updateMany({ where: { userId, chain: "TON" }, data: { address: current, balance: 0 } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        displacedAddresses: [
          ...displaced,
          { chain: "TON", address: oldAddress, replacedBy: current, at: new Date().toISOString() },
        ].slice(-20),
      },
    }),
  ]);
  console.warn(`[TON] corrected row for user ${userId}: was ${oldAddress}, now ${current}`);
}

const lastHealAttempt = new Map<string, number>();
const HEAL_EVERY_MS = 10 * 60_000;

/**
 * Correct a stale row if nothing is sitting at it.
 *
 * Called from the balance sync, so it heals an account the next time it opens
 * the app. Only ever on a live read of the chain: a read that fails leaves the
 * row alone, and a row holding money is logged rather than touched.
 */
export async function healStaleTonRow(userId: string, state: TonRowState): Promise<void> {
  if (!state.stale || !state.saved || !state.current) return;
  const last = lastHealAttempt.get(userId) ?? 0;
  if (Date.now() - last < HEAL_EVERY_MS) return;
  lastHealAttempt.set(userId, Date.now());

  try {
    const balance = await ton.getTonUsdtBalance(state.saved);
    if (balance > 0) {
      console.warn(`[TON] stale row holds money: user ${userId}, ${balance} USDT at ${state.saved}, current key is ${state.current}`);
      return;
    }
    await correctTonRow(userId, state.saved, state.current);
  } catch (err: any) {
    console.warn(`[TON] could not check stale row for user ${userId}: ${err?.message}`);
  }
}
