import { prisma } from "./prisma";

/**
 * How often one account may make us pay for a transfer.
 *
 * Here rather than beside the route that enforces it, because the admin radar
 * reports against the same number and a route importing another route is a
 * cycle waiting to happen - the kind that resolves to undefined at whichever
 * end loads first, which for a limit means no limit.
 */

/**
 * Solana withdrawals and username transfers, counted together, per day.
 *
 * Together because to the gas wallet they are one thing: a sponsored transfer
 * to an address the sender chose. Counting them apart would have meant twenty.
 *
 * Solana has a ceiling of its own because it is the chain where a sponsored
 * transfer can cost rent rather than a fraction of a cent. Opening a token
 * account for a recipient costs about 0.0015 SOL, and that rent is refundable
 * to whoever owns the account - so an address could take a withdrawal, close
 * the account we opened, pocket the rent and come back. One account did that
 * fifty-six times in an afternoon and emptied the wallet.
 */
export const SOL_TRANSFERS_PER_DAY = 5;

/** Where the console keeps its own number, and how far it may go: never off, never a free-for-all. */
const SOL_CAP_KEY = "limits:solTransfersPerDay";
export const SOL_CAP_RANGE = { min: 1, max: 50 } as const;

let solCap: { at: number; value: number } | null = null;

/**
 * Today's Solana cap: the console's number when it has set one, else the
 * shipped five. Read on every Solana send and by the radar, so both always
 * agree; held for a few seconds so a change in the console lands at once.
 */
export async function solTransfersPerDay(): Promise<number> {
  if (solCap && Date.now() - solCap.at < 5_000) return solCap.value;
  const row = await prisma.serviceStatus.findUnique({ where: { key: SOL_CAP_KEY }, select: { value: true } }).catch(() => null);
  const n = Number(row?.value);
  const value = Number.isInteger(n) && n >= SOL_CAP_RANGE.min && n <= SOL_CAP_RANGE.max ? n : SOL_TRANSFERS_PER_DAY;
  solCap = { at: Date.now(), value };
  return value;
}

/** Who changed it last, and when, for the console. */
export async function solCapMeta(): Promise<{ updatedBy: string | null; updatedAt: Date | null }> {
  const row = await prisma.serviceStatus.findUnique({ where: { key: SOL_CAP_KEY }, select: { updatedBy: true, updatedAt: true } }).catch(() => null);
  return { updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null };
}

export async function setSolTransfersPerDay(n: number, by: string): Promise<number> {
  if (!Number.isInteger(n) || n < SOL_CAP_RANGE.min || n > SOL_CAP_RANGE.max) {
    throw new Error(`Solana sends a day must be a whole number from ${SOL_CAP_RANGE.min} to ${SOL_CAP_RANGE.max}.`);
  }
  await prisma.serviceStatus.upsert({ where: { key: SOL_CAP_KEY }, create: { key: SOL_CAP_KEY, value: String(n), updatedBy: by }, update: { value: String(n), updatedBy: by } });
  solCap = null;
  return n;
}

/** Sponsored withdrawals on any chain we pay gas for. Arc is not one. */
export const SPONSORED_PER_HOUR = 10;
export const SPONSORED_PER_DAY = 30;
