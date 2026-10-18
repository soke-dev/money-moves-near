import { randomUUID } from "crypto";
import type { SimpleTransaction } from "@aptos-labs/ts-sdk";
import { prisma } from "./prisma";
import { cutPot, toAmount, type Spread } from "./voucher-split";
import { normaliseCode } from "./voucher";
import { sendFromEscrow, isVoucherEscrowConfigured } from "./voucher-escrow";

/**
 * Vouchers people make with their own money.
 *
 * Two rules shape everything here.
 *
 * The first is that we cannot move anybody's funds. The server has no key, so
 * funding is a transaction the creator signs on their device - which is why
 * making one is prepare-then-submit rather than a single call, and why the
 * voucher does not exist until the money has actually landed. An ACTIVE
 * voucher with no funding behind it would let people claim USDC nobody put in.
 *
 * The second is that whatever nobody claims goes back, without being asked.
 * There is no endpoint where a person requests money - not the creator, not
 * anybody - so there is nothing to attack. A sweep finds what is owed and
 * sends it. The only human control is ending a voucher early, which just
 * brings the same sweep forward.
 */

/** What a person may do, as agreed. */
export const LIMITS = {
  maxPot: 100,
  maxWinners: 20,
  minSlice: 0.1,
  /** Long enough to share, short enough that money is not parked for ever. */
  days: 7,
  /**
   * How many slices one person may take.
   *
   * Capped low on purpose. The point of a voucher is that it reaches several
   * people, and a high number turns the cap on winners into a fiction: one
   * person with the code first takes the lot. Three is enough for the case
   * this exists for - handing the same code to a small group and letting them
   * claim more than once - without making that possible.
   */
  maxPerUser: 3,
} as const;

export interface PreparedVoucher {
  userId: string;
  code: string;
  pot: number;
  slices: number[];
  spread: Spread;
  lucky: boolean;
  /** Only identity-verified accounts may claim. */
  verifiedOnly: boolean;
  /** Slices one person may take, 1 to LIMITS.maxPerUser. */
  perUserClaims: number;
  expiresAt: Date;
  createdAt: number;
  /**
   * The exact transaction the creator was asked to sign.
   *
   * Kept rather than rebuilt. A rebuild is a different transaction - the
   * sequence number may have moved and the expiry certainly has - so the
   * signature that came back would be for bytes nobody is submitting, and
   * Shinami rejects it. Holding the one that was signed is the only version
   * that can be submitted.
   */
  funding?: SimpleTransaction;
  /**
   * The address the pot came out of, and the only one it can go back to.
   *
   * Recorded at prepare from the creator's wallet on file, so a failure after
   * the transfer has confirmed can return the money without trusting anything
   * in the request that failed.
   */
  fundedFrom?: string;
}

/**
 * Prepared vouchers, held for as long as signing takes.
 *
 * In memory on purpose: nothing here is a promise to anybody until the funding
 * confirms, so a restart losing them costs somebody one retry and nothing
 * else. Writing them down would mean a table of half-vouchers to reconcile.
 */
const pending = new Map<string, PreparedVoucher>();
const PREPARE_TTL_MS = 10 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > PREPARE_TTL_MS) pending.delete(id);
  }
}, 60_000);

export function takePrepared(id: string, userId: string): PreparedVoucher | null {
  const p = pending.get(id);
  if (!p || p.userId !== userId) return null;
  if (Date.now() - p.createdAt > PREPARE_TTL_MS) {
    pending.delete(id);
    return null;
  }
  // Taken, not read: one prepare funds one voucher. Leaving it would let a
  // replayed submit mint a second voucher off a single transfer.
  pending.delete(id);
  return p;
}

/**
 * A code that says who made it.
 *
 * The tail is theirs, the head is their username, so `TOLU-PARTY` can only
 * have come from @tolu. A free-choice code lets somebody mint MONEYMOVES50 and
 * hand it round, and to whoever receives it that looks like it came from us -
 * namespacing removes the attack instead of policing it with a blocklist.
 */
export function userCode(username: string, wanted?: string): string {
  const head = normaliseCode(username).replace(/-/g, "").slice(0, 16);
  if (!head) throw new Error("Your account needs a username before you can send a voucher.");

  const tail = normaliseCode(wanted ?? "").replace(/^-+|-+$/g, "");
  if (!tail) {
    // Nothing typed: four characters that avoid the letters people misread.
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let r = "";
    for (let i = 0; i < 4; i++) r += abc[Math.floor(Math.random() * abc.length)];
    return `${head}-${r}`;
  }

  if (!/^[A-Z0-9-]{2,24}$/.test(tail)) {
    throw new Error("A code ending is 2 to 24 letters, digits or dashes.");
  }
  return `${head}-${tail}`;
}

/** Everything a person is allowed to ask for, checked in one place. */
export function planVoucher(args: {
  userId: string;
  username: string;
  pot: number;
  winners: number;
  lucky: boolean;
  spread?: Spread;
  wantedCode?: string;
  verifiedOnly?: boolean;
  perUserClaims?: number;
}): PreparedVoucher {
  if (!isVoucherEscrowConfigured()) {
    throw new Error("Sending vouchers is not switched on right now.");
  }

  const pot = Number(args.pot);
  const winners = Math.floor(Number(args.winners));

  if (!Number.isFinite(pot) || pot <= 0) throw new Error("Choose how much to put in.");
  if (pot > LIMITS.maxPot) throw new Error(`The most you can send in one voucher is ${LIMITS.maxPot}.`);
  if (!Number.isFinite(winners) || winners < 1) throw new Error("Choose how many people.");
  if (winners > LIMITS.maxWinners) throw new Error(`Up to ${LIMITS.maxWinners} people per voucher.`);

  /**
   * Checked here rather than trusted from the request.
   *
   * This decides how many slices one account can take, so a number arriving
   * unvalidated is a way to empty a voucher with one claimer. Defaults to one,
   * which is what the voucher did before this existed.
   */
  const perUserClaims = Math.floor(Number(args.perUserClaims ?? 1));
  if (!Number.isFinite(perUserClaims) || perUserClaims < 1 || perUserClaims > LIMITS.maxPerUser) {
    throw new Error(`One person can claim between 1 and ${LIMITS.maxPerUser} times.`);
  }
  // More claims each than there are slices is not a rule, it is a typo.
  if (perUserClaims > winners) {
    throw new Error(
      `You have cut this ${winners} ${winners === 1 ? "way" : "ways"}, so one person cannot claim ${perUserClaims} times.`,
    );
  }

  /**
   * The floor is what really limits this, not the cap on people.
   *
   * Said before the cut rather than after, because "2 split 20 ways" fails on
   * arithmetic and the arithmetic's own message talks about pots and floors
   * rather than about the two numbers the person actually chose.
   */
  if (pot < LIMITS.minSlice * winners) {
    const most = Math.floor(pot / LIMITS.minSlice);
    throw new Error(
      most >= 1
        ? `${pot} USDC can go to at most ${most} ${most === 1 ? "person" : "people"} — everyone gets at least ${LIMITS.minSlice}.`
        : `A voucher needs at least ${LIMITS.minSlice} USDC.`,
    );
  }

  const slices = args.lucky
    ? cutPot({ pot, winners, min: LIMITS.minSlice, spread: args.spread ?? "mixed" }).slices
    : evenSlices(pot, winners);

  const prepared: PreparedVoucher = {
    userId: args.userId,
    code: userCode(args.username, args.wantedCode),
    pot,
    slices,
    spread: args.spread ?? "mixed",
    lucky: args.lucky,
    verifiedOnly: args.verifiedOnly === true,
    perUserClaims,
    expiresAt: new Date(Date.now() + LIMITS.days * 86_400_000),
    createdAt: Date.now(),
  };
  return prepared;
}

export function holdPrepared(
  p: PreparedVoucher,
  extra?: { funding?: SimpleTransaction; fundedFrom?: string },
): string {
  const id = randomUUID();
  pending.set(id, extra ? { ...p, ...extra } : p);
  return id;
}

/** Same each, in minor units, with the odd remainder spread rather than dumped. */
function evenSlices(pot: number, winners: number): number[] {
  const total = Math.round(pot * 100);
  const each = Math.floor(total / winners);
  const out = new Array(winners).fill(each);
  let left = total - each * winners;
  for (let i = 0; left > 0; i = (i + 1) % winners, left--) out[i]++;
  return out;
}

/**
 * Money owed back, and sending it.
 *
 * A voucher is owed a refund once it can no longer pay: ended, expired, or
 * paused past its end. What is owed is the sum of slices nobody took - the
 * same figure the escrow reconciliation uses, so the two can never disagree.
 */
export async function markRefundsDue(): Promise<number> {
  const now = new Date();
  const finished = await prisma.voucher.findMany({
    where: {
      createdByUserId: { not: null },
      refundState: "NONE",
      OR: [{ status: "ENDED" }, { endsAt: { lt: now } }],
    },
    select: { id: true },
    take: 200,
  });
  if (!finished.length) return 0;

  let marked = 0;
  for (const v of finished) {
    const owed = await prisma.voucherSlice.aggregate({
      where: { voucherId: v.id, claimId: null },
      _sum: { amount: true },
    });
    const amount = Number(owed._sum.amount ?? 0);

    await prisma.voucher.update({
      where: { id: v.id },
      data: {
        status: "ENDED",
        // Nothing left over is still a finished voucher; SENT with no transfer
        // keeps it out of the queue without pretending money moved.
        refundState: amount > 0 ? "DUE" : "SENT",
        refundAmount: amount,
        ...(amount > 0 ? {} : { refundedAt: now }),
      },
    });
    marked++;
  }

  marked += await reopenSettledWithSlices();
  return marked;
}

/**
 * Vouchers that finished owing nothing and then came to owe something.
 *
 * A claim holds its slice while the payout runs, and the payout runs outside
 * the lock - so a claim still in flight as the voucher expires is counted as
 * money going out, and the voucher settles with nothing to refund. If that
 * payout then fails, the slice is released and its money is suddenly owed to
 * the creator, on a row that has already been written off.
 *
 * Only rows where no transfer ever happened are reconsidered: refundTxHash is
 * null on exactly the ones marked SENT because there was nothing to send. A
 * row that really did pay is never reopened, whatever its slices say, because
 * reopening one of those is how a refund goes out twice.
 */
async function reopenSettledWithSlices(): Promise<number> {
  const settled = await prisma.voucher.findMany({
    where: {
      createdByUserId: { not: null },
      status: "ENDED",
      refundState: "SENT",
      refundTxHash: null,
      slices: { some: { claimId: null } },
    },
    select: { id: true, code: true },
    take: 50,
  });

  let reopened = 0;
  for (const v of settled) {
    const owed = await prisma.voucherSlice.aggregate({
      where: { voucherId: v.id, claimId: null },
      _sum: { amount: true },
    });
    const amount = Number(owed._sum.amount ?? 0);
    if (!(amount > 0)) continue;

    await prisma.voucher.update({
      where: { id: v.id },
      data: { refundState: "DUE", refundAmount: amount, refundedAt: null },
    });
    console.log(`[ESCROW] ${v.code} settled owing nothing and now owes ${amount} — reopened`);
    reopened++;
  }
  return reopened;
}

/**
 * Send what is owed, back to whoever put it in.
 *
 * Addressed to the creator's wallet on file, never to anything supplied by a
 * request. That is the whole guard: there is no input to this, so there is
 * nothing for somebody to point at their own address.
 */
/** Tries before a refund stops being retried and waits for a person. */
const REFUND_MAX_ATTEMPTS = 12;

let sweeping = false;

export async function sweepRefunds(): Promise<{ sent: number; failed: number }> {
  if (!isVoucherEscrowConfigured()) return { sent: 0, failed: 0 };

  /**
   * One sweep at a time in this process.
   *
   * Four things start one: the timer, the run soon after boot, the admin
   * button, and every voucher somebody ends. The row claim below is what
   * actually makes a double payout impossible; this only stops the overlap
   * happening in the first place, which is cheaper than losing the race
   * politely twenty-five times.
   */
  if (sweeping) return { sent: 0, failed: 0 };
  sweeping = true;
  try {
    return await runSweep();
  } finally {
    sweeping = false;
  }
}

async function runSweep(): Promise<{ sent: number; failed: number }> {
  await markRefundsDue().catch((e) =>
    console.error("[ESCROW] could not mark refunds due:", e?.message),
  );

  const owed = await prisma.voucher.findMany({
    where: { refundState: { in: ["DUE", "FAILED"] }, refundAttempts: { lt: REFUND_MAX_ATTEMPTS } },
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      code: true,
      refundAmount: true,
      refundAttempts: true,
      createdByUserId: true,
      creator: { select: { wallets: { where: { chain: "MOVE" }, select: { address: true }, take: 1 } } },
    },
    take: 25,
  });

  let sent = 0;
  let failed = 0;

  for (const v of owed) {
    /**
     * Take the row before spending anything against it.
     *
     * Two sweeps overlapping both listed this voucher as DUE, and with nothing
     * between the list and the transfer both would have sent it - the same
     * refund paid twice out of a wallet holding other people's money. The
     * attempt counter doubles as the token: the update only matches the count
     * that was read, so exactly one of them can increment it, and the other
     * gets nothing back and moves on.
     *
     * Counting the attempt here rather than on failure also fixes a quieter
     * one. A send that took the process down with it never incremented
     * anything, so it came back on the next sweep, for ever.
     */
    const claimed = await prisma.voucher.updateMany({
      where: {
        id: v.id,
        refundState: { in: ["DUE", "FAILED"] },
        refundAttempts: v.refundAttempts,
      },
      data: { refundAttempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    const address = v.creator?.wallets?.[0]?.address;
    if (!address) {
      await prisma.voucher.update({
        where: { id: v.id },
        data: { refundState: "FAILED", refundError: "No wallet on file for the creator" },
      });
      failed++;
      continue;
    }

    /**
     * What is owed now, not what was owed when it was marked.
     *
     * A payout that failed after this voucher settled released its slice back
     * into the pot, so the figure written at marking time can be short. The
     * slices are the truth: anything still unclaimed is money nobody is
     * getting, and a slice held by a claim in flight is excluded because it
     * has a claim id on it.
     */
    const live = await prisma.voucherSlice.aggregate({
      where: { voucherId: v.id, claimId: null },
      _sum: { amount: true },
    });
    const amount = Number(live._sum.amount ?? 0);

    if (!(amount > 0)) {
      // Everything was claimed after all. Finished, not failed.
      await prisma.voucher.update({
        where: { id: v.id },
        data: { refundState: "SENT", refundAmount: 0, refundedAt: new Date(), refundError: null },
      });
      continue;
    }

    try {
      const hash = await sendFromEscrow(address, amount, "refund");
      await prisma.voucher.update({
        where: { id: v.id },
        data: {
          refundState: "SENT",
          refundAmount: amount,
          refundTxHash: hash,
          refundedAt: new Date(),
          refundError: null,
        },
      });
      console.log(`[ESCROW] refunded ${amount} USDC for ${v.code}: ${hash}`);
      sent++;
    } catch (e: any) {
      /**
       * A send that broadcast but could not be confirmed is parked, not retried.
       *
       * Past broadcast the transfer exists whatever happened here, so sending
       * it again is how the same refund goes out twice - and this wallet holds
       * other people's money, so the second one comes out of somebody else's
       * voucher. The old code said exactly this and then did the opposite: it
       * wrote the hash and left the row DUE, which is precisely the state the
       * next sweep picks up.
       *
       * Parking means pushing the attempt count past the ceiling. It stays DUE
       * on purpose rather than being called SENT, because nobody has confirmed
       * that it was: the reconciliation keeps counting it as owed, so if the
       * money really did leave, escrow comes up short against our own figure
       * and says so. A person resolves it from there.
       */
      const hash: string | undefined = e?.txHash;
      await prisma.voucher.update({
        where: { id: v.id },
        data: hash
          ? {
              refundTxHash: hash,
              refundAttempts: REFUND_MAX_ATTEMPTS,
              refundError: `Unconfirmed, needs checking: ${e?.message ?? "timeout"}`,
            }
          : {
              refundState: "FAILED",
              refundError: String(e?.message ?? "send failed").slice(0, 300),
            },
      });
      console.error(`[ESCROW] refund failed for ${v.code}:`, e?.message);
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * What escrow holds against what it owes.
 *
 * The only figure in the console that is not a total of our own rows. If these
 * disagree, one of our beliefs is wrong - and every table would be wrong
 * together, so nothing else could reveal it.
 */
export async function escrowReconciliation(): Promise<{
  balance: number;
  owedToClaimers: number;
  refundsDue: number;
  unaccounted: number;
}> {
  const { voucherEscrowBalance } = await import("./voucher-escrow");

  const [balance, unclaimed, refunds] = await Promise.all([
    voucherEscrowBalance(),
    prisma.voucherSlice.aggregate({
      where: { claimId: null, voucher: { createdByUserId: { not: null }, status: "ACTIVE" } },
      _sum: { amount: true },
    }),
    prisma.voucher.aggregate({
      where: { refundState: { in: ["DUE", "FAILED"] } },
      _sum: { refundAmount: true },
    }),
  ]);

  const owedToClaimers = Number(unclaimed._sum.amount ?? 0);
  const refundsDue = Number(refunds._sum.refundAmount ?? 0);
  return {
    balance,
    owedToClaimers,
    refundsDue,
    unaccounted: Number((balance - owedToClaimers - refundsDue).toFixed(6)),
  };
}
