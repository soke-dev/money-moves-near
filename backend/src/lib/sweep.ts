import { prisma } from "./prisma";
import { env } from "../config/env";
import { getOnChainBalance } from "./balances";

/**
 * Sweep — scattered stablecoins into one USDCx balance on Movement.
 *
 * It is a sell that pays out in crypto. Each ticked balance leaves its chain
 * the way a sell leaves it, gas sponsored, into the sell treasury; then
 * treasury sends USDCx on Movement. No bridge and no new trust assumption: we
 * are the counterparty, as we already are on every sell.
 *
 * ── The rules ──────────────────────────────────────────────────────────
 *
 * Stablecoins only, from the three chains that are not the destination. Not
 * cNGN - that is naira, and converting it is an FX trade at the sell rate, not
 * a consolidation. Not MOVE or SOL - those are sales with real price risk.
 *
 * 1:1 on the dollar value, no spread. We carry the cost of ending up long USDT
 * on Solana and short USDCx on Movement.
 *
 * ── Why there is no minimum ────────────────────────────────────────────
 *
 * There was a fifty-cent floor on the total, and it was solving a problem that
 * turned out not to exist. Sponsored gas on these three chains runs a fifth of
 * a cent a leg, so the entire weekly allowance costs about a cent - against
 * which a floor that refuses to clear somebody's dust is the expensive side of
 * the trade, because clearing dust is the whole point of the feature.
 *
 * The weekly count is the block. It is a hard number that cannot be gamed by
 * splitting a sweep up, and unlike a floor it does not single out the people
 * with the least to move.
 */

export const SWEEP_ASSETS = ["USDC", "USDT"] as const;
export const SWEEP_CHAINS = ["SOL", "BASE", "BEP20", "ARC", "TON"] as const;

/**
 * What a swap leaves behind, on the two chains that pay their own way.
 *
 * On most chains the fee is a different asset and we sponsor it, so a swap
 * can ask for the entire balance. Two are not like that:
 *
 *   Arc  - the fee is USDC, the same USDC being swept, and nobody sponsors it.
 *   TON  - the relay that carries the transfer takes its fee in the USDT
 *          being swept, out of the same signed request.
 *
 * Either way, asking for all of it leaves nothing to pay with and the leg
 * fails for want of a fraction of a cent.
 *
 * Both reserves are far more than the fee actually costs, set high enough
 * that an estimate moving between the quote and the send cannot overtake
 * them: the cost of being wrong is a failed leg, the cost of being generous
 * is a cent. Whatever is left over stays theirs.
 *
 * They must stay in step with ARC_GAS_RESERVE and TON_FEE_RESERVE in
 * constants/transfer.ts, which is what the app holds back when somebody sends
 * the maximum by hand.
 */
export const ARC_SWEEP_RESERVE = 0.01;
export const TON_SWEEP_RESERVE = 0.02;

/**
 * The least worth moving, counted after the reserve.
 *
 * A gross balance of exactly the reserve would net to nothing, so the floor
 * is applied to what would actually leave. It is also why a swept balance
 * does not come back as dust on the next quote: what remains is the reserve,
 * which nets to zero.
 */
const ARC_MIN_NET = 0.01;
const TON_MIN_NET = 0.02;

/**
 * The least worth moving off a chain, after its own fee.
 *
 * A tenth of a cent is the floor everywhere else, not a millionth. Below
 * that a leg costs us a sponsored transaction to move something nobody can
 * spend - and since the app offers amounts to four places, a hundredth of a
 * cent is exactly what a full swap can leave behind. Without this it would
 * come straight back as a row offering to swap nothing.
 */
export function minNetFor(chain: SweepChain): number {
  if (chain === "ARC") return ARC_MIN_NET;
  if (chain === "TON") return TON_MIN_NET;
  return 0.001;
}

/** The fee a chain takes out of the very asset being swept, or nothing. */
function reserveFor(chain: SweepChain): number {
  if (chain === "ARC") return ARC_SWEEP_RESERVE;
  if (chain === "TON") return TON_SWEEP_RESERVE;
  return 0;
}

/** What can actually leave a chain, once its own fee is accounted for. */
function netOfReserve(chain: SweepChain, balance: number): number {
  return Math.max(0, balance - reserveFor(chain));
}

export const SWEEP_DEST_CHAIN = "MOVE";
export const SWEEP_DEST_ASSET = "USDCx";

export const SWEEP_PER_WEEK = 5;

/**
 * Accounts allowed more than the standard ration.
 *
 * Ours, for testing a chain across every path in a day without waiting a
 * week for the count to roll. In code rather than in the database because it
 * is a handful of ids that changes about never, and in the environment it
 * would be one more thing to remember on a redeploy.
 *
 * Comma-separated user ids in SWEEP_ALLOWANCE_OVERRIDES, each optionally
 * with its own count as id:count - so one variable covers a second account
 * without another deploy.
 */
function perWeekFor(userId: string): number {
  const raw = (process.env.SWEEP_ALLOWANCE_OVERRIDES || "").trim();
  const listed = raw
    ? raw.split(",").map((e) => e.trim()).filter(Boolean)
    : ["cmnvdqmvs00006dmkz32xnnvj:10"];
  for (const entry of listed) {
    const [id, count] = entry.split(":");
    if (id === userId) {
      const n = Number(count);
      return Number.isFinite(n) && n > 0 ? n : 10;
    }
  }
  return SWEEP_PER_WEEK;
}
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type SweepChain = (typeof SWEEP_CHAINS)[number];
export type SweepAsset = (typeof SWEEP_ASSETS)[number];

export type SweepLeg = {
  asset: SweepAsset;
  chain: SweepChain;
  /** What leaves the source chain. 1:1, so also what arrives as USDCx. */
  amount: number;
  /**
   * Five states, and the two in the middle are the important ones.
   *
   * `sending` is claimed: somebody is broadcasting it right now, and nobody
   * else may. `sent` is the bad one - their token reached treasury and the
   * credit did not go out. Neither is ever retried automatically, because the
   * only way to be sure a retry is not a second payout is to have a person
   * look.
   */
  status: "pending" | "sending" | "sent" | "landed" | "failed";
  /** The user's transfer into treasury. */
  txHash?: string;
  /** Our USDCx transfer out to them. */
  creditHash?: string;
  error?: string;
};

/**
 * One writer at a time, per sweep.
 *
 * Every leg is a read-modify-write of one JSON column. Two submits for the
 * same leg arriving together would both read `pending`, both broadcast, and
 * both pay out of treasury - the same balance credited twice. The two writes
 * would then clobber each other, so the second would erase the first leg's
 * record and the sweep would finish looking like less than it was.
 *
 * A row lock is the whole fix: the second request waits for the first to
 * commit, then reads the status the first one wrote. Nothing slow happens
 * inside it - the chain work sits between two of these, never during one -
 * because a transaction held open across a thirty-second broadcast is its own
 * kind of outage.
 *
 * `extra` writes columns beside the metadata under the same lock, so closing
 * the sweep sees every leg's final status rather than the copy one request
 * happened to be holding.
 */
export async function withSweepLock<T>(
  sweepId: string,
  fn: (state: { meta: any; legs: SweepLeg[] }) => Promise<T> | T,
  extra?: (state: { meta: any; legs: SweepLeg[] }) => Record<string, unknown>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ metadata: any }[]>`
      SELECT metadata FROM transactions WHERE id = ${sweepId} FOR UPDATE
    `;
    if (!rows.length) throw new Error("Sweep not found");

    const meta = (rows[0].metadata ?? {}) as any;
    const state = {
      meta,
      legs: (Array.isArray(meta.legs) ? meta.legs : []) as SweepLeg[],
    };

    const result = await fn(state);

    await tx.transaction.update({
      where: { id: sweepId },
      data: {
        ...(extra ? extra(state) : {}),
        metadata: { ...state.meta, legs: state.legs },
      },
    });

    return result;
  });
}

/**
 * What will actually transfer, rather than what we had written down.
 *
 * A wallet balance is read off the chain into a float and stored as
 * numeric(20,8). Six decimals survive that intact; eighteen do not. BSC USDT
 * holding 0.494263575… on chain becomes 0.49426358 in the column, because the
 * column rounds half-up - and a sweep asks for every last unit, so the transfer
 * is for more than is there and the contract reverts with no reason attached.
 * That is exactly why the Solana leg swept cleanly and the BNB leg did not:
 * Solana USDC and Base USDC are six-decimal tokens and BSC USDT is eighteen.
 *
 * Two things fix it. The live balance is read again here, so a stale row cannot
 * over-ask either; and the result is floored rather than rounded, so the figure
 * can only ever be under. What gets left behind is under a hundred-millionth
 * of a token.
 */
function floorToEight(n: number): number {
  return Math.floor(n * 1e8) / 1e8;
}

export async function exactSweepAmount(
  asset: SweepAsset,
  chain: SweepChain,
  address: string,
  recorded: number,
): Promise<number> {
  /**
   * `recorded` is the figure they agreed to, which itself came from the chain
   * (sweepableBalances reads it live) - never a balance stored in our database.
   * It caps the leg so nobody is swapped more than they saw.
   *
   * It has already had Arc's reserve taken off it, because the quote
   * showed the person a net figure and that is the number they agreed to. So
   * the reserve is applied to the LIVE balance here rather than subtracted
   * again - taking it twice would quietly shrink every Arc swap by a cent and
   * the arithmetic would still look right.
   */
  try {
    const live = await getOnChainBalance(asset, chain, address);
    return Math.max(0, floorToEight(Math.min(netOfReserve(chain, live), recorded)));
  } catch {
    // The chain would not answer, so this leg doesn't move. What we pay back is
    // only ever sized by what the chain says they hold - never by the figure in
    // our database - and a leg of 0 is dropped before anything is signed.
    return 0;
  }
}

/**
 * Whether we can pay for what we are about to take.
 *
 * A sweep moves their token into treasury first and sends USDCx back second.
 * If the second half cannot happen, the tokens are ours and they have nothing
 * - the one state here that needs a person to unpick. So the balance is read
 * before anything leaves a chain.
 *
 * A read that fails refuses the sweep rather than waving it through. Sweeping
 * is a tidy-up nobody is waiting on: being told to come back later costs
 * somebody nothing, and guessing costs them their money.
 */
export async function treasuryCanCover(
  amount: number,
): Promise<{ ok: boolean; have: number | null }> {
  try {
    const have = await getOnChainBalance(
      SWEEP_DEST_ASSET,
      SWEEP_DEST_CHAIN,
      env.MOVEMENT_TREASURY_ADDRESS,
    );
    return { ok: have >= amount, have };
  } catch (err: any) {
    console.error("[SWEEP] Could not read treasury balance:", err?.message);
    return { ok: false, have: null };
  }
}

/**
 * Close the sweeps somebody opened and never sent.
 *
 * Prepare is what counts the weekly allowance, so preparing a dozen sweeps
 * against one remaining attempt banks a dozen sets of signing payloads behind
 * a limit that was checked once. The payloads expire from memory after two
 * minutes, which bounds it, but the open rows outlive them - so each new
 * prepare closes the ones before it.
 *
 * Only rows with nothing on a chain are touched. A sweep holding a leg that is
 * sending, sent or landed is mid-flight and is left exactly alone.
 */
export async function supersedeOpenSweeps(userId: string): Promise<number> {
  const open = await prisma.transaction.findMany({
    where: { userId, type: "SWEEP", status: "PENDING" },
    select: { id: true, metadata: true },
  });

  const untouched = open.filter((row) => {
    // A cross-chain swap shares this row type but is not a sweep; it closes itself.
    if ((row.metadata as any)?.kind === "swap") return false;
    const legs = ((row.metadata as any)?.legs ?? []) as SweepLeg[];
    return legs.every((l) => l.status === "pending" || l.status === "failed");
  });
  if (!untouched.length) return 0;

  const { count } = await prisma.transaction.updateMany({
    where: { id: { in: untouched.map((r) => r.id) } },
    data: { status: "CANCELLED" },
  });
  return count;
}

export function isSweepChain(v: unknown): v is SweepChain {
  return SWEEP_CHAINS.includes(v as SweepChain);
}

export function isSweepAsset(v: unknown): v is SweepAsset {
  return SWEEP_ASSETS.includes(v as SweepAsset);
}

/**
 * One gas-sponsor slot per leg.
 *
 * The sponsor keys its pending transactions by a single id, and a sweep has
 * several in flight at once - so each leg gets its own, derived rather than
 * stored so submit can rebuild it from what the client sends back.
 */
export function legId(sweepId: string, chain: string): string {
  return `${sweepId}:${chain}`;
}

/** What this person could sweep right now. */
export async function sweepableBalances(userId: string): Promise<
  { asset: SweepAsset; chain: SweepChain; amount: number; address: string | null }[]
> {
  const wallets = await prisma.wallet.findMany({
    where: {
      userId,
      asset: { in: SWEEP_ASSETS as unknown as any[] },
      chain: { in: SWEEP_CHAINS as unknown as any[] },
      address: { not: null },
    },
    select: { asset: true, chain: true, address: true },
  });

  /**
   * Read from the chain, every time - never the balance stored in our
   * database. A swap is paid out of treasury, so what it offers, and what it
   * pays back, is only ever what the chain says this wallet holds. A balance
   * the chain won't confirm right now simply isn't offered.
   */
  const live = await Promise.all(
    wallets.map(async (w) => {
      try {
        return await getOnChainBalance(w.asset as any, w.chain as any, w.address!);
      } catch {
        return null;
      }
    }),
  );

  return wallets
    .map((w, i) => ({
      asset: w.asset as SweepAsset,
      chain: w.chain as SweepChain,
      // Net, so the sheet offers the figure that will actually move rather
      // than one a cent larger than the transfer it produces.
      amount: live[i] == null ? 0 : netOfReserve(w.chain as SweepChain, live[i]!),
      address: w.address,
    }))
    /**
     * A figure at the bottom of the column is noise, not a balance.
     *
     * Balances are stored to eight places, so 0.00000001 is the smallest thing
     * the column can say - and it is what it says for anything between half and
     * one and a half of that. After a sweep of BSC USDT the chain held
     * 0.000000005847, which the column rounds up to exactly 0.00000001, and a
     * `>= 1e-8` test let it through. The tag offered a sweep; prepare then read
     * the chain, floored the real figure to zero, dropped the leg and refused
     * the whole thing.
     *
     * A hundred of those steps is the test now. It is a millionth of a dollar,
     * so nothing anybody holds on purpose is anywhere near it, and nothing that
     * rounding invented can reach it.
     */
    .filter((b) =>
      b.amount >=
      minNetFor(b.chain as SweepChain),
    )
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Sweeps that count against the weekly two.
 *
 * Only ones where something actually landed. A sweep that delivered nothing is
 * our failure, and charging somebody an attempt for it is how they lose both
 * tries to an outage - so the counter is written when a leg confirms, never
 * when the attempt starts.
 *
 * Rolling seven days rather than a calendar week, so a Sunday-and-Monday pair
 * is two rather than four.
 */
/**
 * How many are left, and when the next one comes back.
 *
 * "0 of 3 left this week" is only half an answer - there is no calendar week
 * here to count to, because the window rolls. The date is the oldest counting
 * sweep plus seven days, which is the moment it drops out of the window and
 * frees the place it is holding.
 *
 * Null whenever there is nothing to wait for, so the app has one thing to test
 * rather than a date it has to compare against now.
 */
export async function sweepAllowance(
  userId: string,
): Promise<{ used: number; left: number; perWeek: number; resetsAt: string | null }> {
  const since = new Date(Date.now() - WEEK_MS);
  const counting = await prisma.transaction.findMany({
    where: {
      userId,
      type: "SWEEP",
      createdAt: { gte: since },
      metadata: { path: ["anyLanded"], equals: true },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const used = counting.length;
  const perWeek = perWeekFor(userId);
  const left = Math.max(0, perWeek - used);
  const resetsAt =
    left > 0 || !counting.length
      ? null
      : new Date(counting[0].createdAt.getTime() + WEEK_MS).toISOString();

  return { used, left, perWeek, resetsAt };
}

/**
 * Whether a set of legs is one we will actually run.
 *
 * Amounts are taken from the wallet rather than from the request: the client
 * says which balances to sweep, never how much is in them.
 */
/**
 * What was picked, and how much of it.
 *
 * An amount is optional: leaving it out means all of that balance, which is
 * what a swap always did and still does by default. Where one is given it is
 * CLAMPED to what the chain actually holds rather than believed - the client
 * is choosing from its own copy of the balances, which may be stale, and a
 * request for more than is there should quietly become all of it instead of
 * an error or, far worse, a leg that promises more than the chain can give.
 *
 * exactSweepAmount caps it a second time against the live balance just before
 * anything is signed, so a balance that moved in between cannot over-ask.
 */
export function validateSelection(
  selected: { asset: string; chain: string; amount?: number }[],
  available: { asset: SweepAsset; chain: SweepChain; amount: number }[],
): { ok: true; legs: SweepLeg[]; total: number } | { ok: false; error: string } {
  if (!selected.length) return { ok: false, error: "Pick at least one balance to swap." };

  const legs: SweepLeg[] = [];
  for (const want of selected) {
    if (!isSweepAsset(want.asset) || !isSweepChain(want.chain)) {
      return { ok: false, error: "That is not something swap can move." };
    }
    if (legs.some((l) => l.asset === want.asset && l.chain === want.chain)) {
      return { ok: false, error: "The same balance was listed twice." };
    }
    const have = available.find((a) => a.asset === want.asset && a.chain === want.chain);
    if (!have || have.amount <= 0) {
      return { ok: false, error: `You have no ${want.asset} on ${want.chain} to swap.` };
    }

    const asked = Number(want.amount);
    const amount =
      Number.isFinite(asked) && asked > 0
        ? Math.min(floorToEight(asked), have.amount)
        : have.amount;

    /**
     * A part of a balance still has to clear the floor.
     *
     * On the chains that pay their own fee out of the asset, a couple of
     * cents nets to nothing - so a leg for it would be signed, sent, and
     * arrive as zero. Said plainly here rather than discovered on chain.
     */
    const floor = minNetFor(have.chain);
    if (amount < floor) {
      return {
        ok: false,
        error: `The least you can swap from ${want.chain} is ${floor} ${want.asset}.`,
      };
    }

    legs.push({ asset: have.asset, chain: have.chain, amount, status: "pending" });
  }

  const total = legs.reduce((n, l) => n + l.amount, 0);
  if (total <= 0) return { ok: false, error: "There is nothing in what you picked." };

  return { ok: true, legs, total };
}

/** Everything the app needs to draw the sheet. */
export async function sweepQuote(userId: string) {
  const [balances, allowance] = await Promise.all([
    sweepableBalances(userId),
    sweepAllowance(userId),
  ]);

  return {
    balances,
    total: balances.reduce((n, b) => n + b.amount, 0),
    destination: { chain: SWEEP_DEST_CHAIN, asset: SWEEP_DEST_ASSET },
    // allowance already carries perWeek, and it carries the figure THIS
    // account was allowed. Restating the constant here overrode it, so a
    // raised allowance still drew five pips.
    ...allowance,
  };
}
