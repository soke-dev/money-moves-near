import { prisma } from "./prisma";
import { sendNotification } from "./push";
import { syFailureStreak } from "./stableyard";
import {
  routedActivity,
  routedActivityReadOnly,
  enrolledAccounts,
  type RoutedDepositActivity,
  type RoutedStatus,
} from "./stableyard-account";

/**
 * A routed deposit, written into our own history.
 *
 * The provider owns the state machine and the deposit screen reads it live -
 * that has not changed. What changed is that a conversion in progress, and the
 * USDC that eventually lands, never appeared in the transaction list at all.
 * Money arrived in somebody's wallet with no row to explain where from.
 *
 * So this mirrors their deposits into ours, one row per deposit, keyed on
 * their id. It is a mirror and not a second source of truth: every field is
 * overwritten from theirs on every sync, and nothing here decides anything.
 *
 * It does NOT move a balance. The USDC lands on Movement on chain and the
 * wallet reads its balance from the chain, so crediting here would count it
 * twice - once by us and once by the chain.
 */

/** Their state machine, flattened onto the four we already draw. */
const LEDGER_STATUS: Record<
  Exclude<RoutedStatus, "ignored">,
  "PROCESSING" | "COMPLETED" | "FAILED"
> = {
  detected: "PROCESSING",
  converting: "PROCESSING",
  // requires_intervention. Still going as far as the depositor is concerned,
  // and the money is neither lost nor delivered - PROCESSING is exactly true.
  review: "PROCESSING",
  settled: "COMPLETED",
  failed: "FAILED",
};

/** Stable and unique, so a sync is idempotent however often it runs. */
const referenceFor = (depositId: string) => `SYDEP-${depositId}`;

/**
 * What lands, in the key the Movement wallet is actually held under.
 *
 * Native USDC on Movement is the USDCx asset everywhere else in this codebase;
 * the app prints it as "USDC". Writing plain USDC here put these rows in a
 * spelling nothing else uses, which is how a duplicate went unmatched.
 */
const SETTLES_AS = "USDCx" as const;

/**
 * Drop the chain-watcher's row for a transfer this deposit already explains.
 *
 * Two true rows for one arrival is worse than either alone: the history shows
 * the money twice. The routed row is the one kept, because it carries the
 * whole story - what was sent, on what chain, for what fee - and the other
 * says only that some USDC appeared.
 *
 * Deletes nothing it has not matched by the settlement hash or by an exact
 * amount inside the settlement window, and nothing carrying our own reference.
 */
async function removeDuplicate(
  userId: string,
  d: RoutedDepositActivity,
  keepId: string,
): Promise<void> {
  const dup = await findDuplicate(userId, d);
  if (!dup || dup.id === keepId) return;

  console.log(`[ROUTED] ${d.id} settled; removing duplicate deposit row ${dup.id}`);
  await prisma.transaction
    .delete({ where: { id: dup.id } })
    .catch((e: any) => console.error("[ROUTED] duplicate cleanup:", e?.message));
}

/**
 * Find the row the chain-watcher may already have written for this deposit.
 *
 * The USDC lands on Movement before we next ask the provider about it, and the
 * wallet's own external-deposit detector is watching that wallet. If it gets
 * there first it writes a plain "external deposit" row for the settlement
 * transaction - true, but missing the half that explains it.
 *
 * This finds that row so it can be adopted rather than duplicated. Without it
 * the person sees the same money twice.
 */
async function findDuplicate(userId: string, d: RoutedDepositActivity) {
  // Movement USDC is held as USDCx, and the chain-watcher writes whichever the
  // wallet is keyed on. Matching one spelling missed the row entirely.
  const notOurs = {
    userId,
    reference: { not: { startsWith: "SYDEP-" } },
    asset: { in: ["USDC", "USDCx"] as any },
  };

  if (d.settlementTxHash) {
    const byHash = await prisma.transaction.findFirst({
      where: { ...notOurs, metadata: { path: ["txHash"], equals: d.settlementTxHash } },
      select: { id: true, status: true, metadata: true },
    });
    if (byHash) return byHash;
  }

  /**
   * The same transfer, found without the hash.
   *
   * The hash match is exact and is the one to trust, but it only holds if the
   * provider writes the settlement hash in the same form the Movement indexer
   * reports it. If it does not - a case that cannot be tested until a deposit
   * actually settles - the duplicate slips through and somebody sees the same
   * money arrive twice.
   *
   * So also match on what the two rows unavoidably share: the same wallet, the
   * same amount to the last unit, and a detection within half an hour of
   * settlement. Both figures come from the same on-chain transfer, so a false
   * match needs a second identical deposit inside that window.
   */
  const settledAt = d.updatedAt ? new Date(d.updatedAt) : null;
  const amount = Number(d.receivedAmount ?? NaN);
  if (!settledAt || !Number.isFinite(amount) || amount <= 0) return null;

  return prisma.transaction.findFirst({
    where: {
      ...notOurs,
      type: "DEPOSIT",
      chain: "MOVE",
      amount,
      metadata: { path: ["source"], equals: "external_deposit" },
      createdAt: {
        gte: new Date(settledAt.getTime() - 30 * 60_000),
        lte: new Date(settledAt.getTime() + 30 * 60_000),
      },
    },
    select: { id: true, status: true, metadata: true },
  });
}

async function record(userId: string, d: RoutedDepositActivity): Promise<void> {
  const reference = referenceFor(d.id);

  /**
   * Nothing the provider has set aside belongs in somebody's history.
   *
   * A gas top-up arriving alongside a real deposit is not a deposit, and a
   * row for it is a transaction the person did not make. The delete is here
   * because the status can change after we have written the row: it is seen
   * first, ignored second.
   */
  if (d.status === "ignored") {
    const stale = await prisma.transaction.findUnique({
      where: { reference },
      select: { id: true },
    });
    if (stale) {
      console.log(`[ROUTED] ${d.id} ignored by provider; removing row ${stale.id}`);
      await prisma.transaction.delete({ where: { id: stale.id } }).catch(() => {});
    }
    return;
  }

  const status = LEDGER_STATUS[d.status];
  const settled = status === "COMPLETED";

  /**
   * What landed, once there is a figure for it.
   *
   * Their number comes from what actually arrived after fees, not from a
   * quote, so before settlement there is nothing truthful to put here. Zero is
   * what the column holds in the meantime and the app shows what was sent
   * instead - a pending row reading "+0 USDC" describes money that arrived and
   * came to nothing.
   */
  const amount = settled ? Number(d.receivedAmount ?? 0) : 0;

  const metadata = {
    source: "routed_deposit",
    provider: "stableyard",
    depositId: d.id,
    chainId: d.chainId,
    routedStatus: d.status,
    sentAmount: d.sentAmount,
    sentSymbol: d.sentSymbol,
    sourceTxHash: d.sourceTxHash,
    feeAmount: d.feeAmount,
    feeSymbol: d.feeSymbol,
    receivedBeforeFee: d.receivedBeforeFee,
    // metadata.txHash is the key every screen reads for an explorer link, and
    // it is also what the external-deposit detector dedupes on. Only set once
    // there is a settlement leg to point at.
    ...(d.settlementTxHash ? { txHash: d.settlementTxHash } : {}),
    settledAt: settled ? d.updatedAt : null,
  };

  const existing = await prisma.transaction.findUnique({
    where: { reference },
    select: { id: true, status: true, amount: true, metadata: true },
  });

  if (existing) {
    /**
     * Nothing to write when nothing changed - this runs on every screen open
     * and every two minutes besides.
     *
     * The status alone is not enough to decide that. A deposit sits at the
     * same status while the provider fills in a hash, a fee, or a settlement
     * amount, and comparing only the status meant those never reached us: a
     * field added to this mirror would silently never appear on rows that
     * already existed.
     */
    const unchanged =
      existing.status === status &&
      Number(existing.amount) === amount &&
      JSON.stringify(existing.metadata ?? {}) === JSON.stringify(metadata);
    if (unchanged) return;

    await prisma.transaction.update({
      where: { id: existing.id },
      data: { status, asset: SETTLES_AS, amount, metadata },
    });
    /**
     * The duplicate is looked for here too, not only when a row is first
     * written.
     *
     * The order that actually happens is: we write the row while it converts,
     * the USDC lands, the chain-watcher writes its own row for that transfer,
     * and only then do we hear it settled. Checking solely on the create path
     * meant that sequence - the common one - never looked, and the person saw
     * the same money arrive twice.
     */
    if (settled) await removeDuplicate(userId, d, existing.id);
    // Only on the crossing, never on a re-sync of a row that already settled.
    if (settled && existing.status !== "COMPLETED") await announce(userId, d);
    return;
  }

  const adopted = await findDuplicate(userId, d);
  if (adopted) {
    await prisma.transaction.update({
      where: { id: adopted.id },
      data: {
        reference,
        status,
        asset: SETTLES_AS,
        amount,
        // Their row is the fuller one, but keep whatever the detector learned
        // from the chain that we do not have.
        metadata: { ...(adopted.metadata as object), ...metadata },
      },
    });
    if (settled && adopted.status !== "COMPLETED") await announce(userId, d);
    return;
  }

  await prisma.transaction.create({
    data: {
      userId,
      type: "DEPOSIT",
      // Always what it becomes. The source asset is not in our Asset enum and
      // does not need to be - nobody holds BTC here, they hold what it turned
      // into, and metadata keeps the rest.
      asset: SETTLES_AS,
      chain: "MOVE",
      amount,
      fee: 0,
      status,
      reference,
      metadata,
    },
  });
  if (settled) await announce(userId, d);
  // The first sighting, and only here - this branch runs once per deposit.
  else if (status === "PROCESSING") await announceSeen(userId, d);
}

const sentText = (d: RoutedDepositActivity) =>
  d.sentAmount && d.sentSymbol ? `${d.sentAmount} ${d.sentSymbol}` : "Your deposit";

function announce(userId: string, d: RoutedDepositActivity) {
  const got = d.receivedAmount ? `${d.receivedAmount} USDC` : "USDC";
  return sendNotification({
    userId,
    type: "transaction",
    title: "Deposit Arrived",
    body: `${sentText(d)} converted to ${got} in your wallet.`,
  }).catch(() => {});
}

/**
 * Told the moment it is seen, not only when it lands.
 *
 * A Bitcoin conversion is minutes at best and was hours on the one we have
 * watched. Saying nothing until it settles leaves somebody who has just sent
 * money to an address they have never used before with no signal that it
 * arrived anywhere - which is exactly the window in which people write to
 * support, or send it again.
 *
 * Fired only where a row is first written, so it cannot repeat on a re-sync.
 */
function announceSeen(userId: string, d: RoutedDepositActivity) {
  return sendNotification({
    userId,
    type: "transaction",
    title: "Deposit Seen",
    body: `${sentText(d)} is converting to USDC. We will tell you when it lands.`,
  }).catch(() => {});
}

/**
 * Read the provider, mirror what it says, hand back what it said.
 *
 * Returns the live list so a caller that was going to fetch it anyway does not
 * pay for a second round trip. One failed row never stops the rest: a deposit
 * we could not write down is still a deposit the screen should show.
 */
export async function syncRoutedLedger(userId: string): Promise<RoutedDepositActivity[]> {
  const list = await routedActivity(userId);
  for (const d of list) {
    await record(userId, d).catch((e: any) =>
      console.error(`[ROUTED] ledger ${d.id}:`, e?.message),
    );
  }
  return list;
}

/**
 * Everyone with something still moving.
 *
 * Seeded from our own rows, which makes this the FAST lane and not the whole
 * story: a deposit we have never seen has no row, so nothing here would ever
 * find it. That is what `discoverRoutedDeposits` is for.
 */
/**
 * Whether a sweep is still going, one flag each.
 *
 * Both run on setInterval, which fires on schedule whether or not the last
 * run has finished. That is harmless while a pass takes seconds; when the
 * provider stopped answering, a pass took most of an hour and a fresh one
 * started every five minutes on top of it. A pass still running is a reason
 * to skip this turn, not to start another.
 */
let inFlightSweepRunning = false;
let discoverySweepRunning = false;

/**
 * Stop a pass once the provider has failed this many times in a row.
 *
 * Counted within the pass, from the shared streak in lib/stableyard, so the
 * next scheduled pass always gets to probe again - a provider that has come
 * back is noticed within one interval rather than never.
 */
const STOP_AFTER_FAILURES = 3;

async function sweep<T>(label: string, items: T[], visit: (item: T) => Promise<void>): Promise<number> {
  let done = 0;
  let failuresInARow = 0;
  for (const item of items) {
    if (failuresInARow >= STOP_AFTER_FAILURES) {
      console.warn(
        `[ROUTED] ${label}: Stableyard failing (${failuresInARow} in a row), stopping this pass after ${done} of ${items.length}`,
      );
      break;
    }
    const before = syFailureStreak();
    try {
      await visit(item);
      done++;
    } catch (e: any) {
      console.error(`[ROUTED] ${label}:`, e?.message);
    }
    failuresInARow = syFailureStreak() > before ? failuresInARow + 1 : 0;
  }
  return done;
}

export async function syncInFlightRoutedDeposits(): Promise<number> {
  if (inFlightSweepRunning) return 0;
  inFlightSweepRunning = true;
  try {
    const rows = await prisma.transaction.findMany({
      where: {
        reference: { startsWith: "SYDEP-" },
        status: { in: ["PENDING", "PROCESSING"] },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    return await sweep("poll", rows, async (r) => {
      await syncRoutedLedger(r.userId);
    });
  } finally {
    inFlightSweepRunning = false;
  }
}

/**
 * Everyone who COULD have deposited, whether or not we know they did.
 *
 * The bug this exists for: money arriving at an address nobody is watching.
 * Polling only the accounts with an in-flight row means a first deposit is
 * discovered when the person next opens the deposit screen - so somebody who
 * sent and closed the app saw no pending row at all, and the transaction
 * appeared already settled, with the whole conversion having happened
 * invisibly.
 *
 * Enrolled accounts come from our own markers, so this costs one provider call
 * each and never creates anything. It runs slower than the fast lane because
 * it is discovery rather than tracking - and if the enrolled set ever grows
 * past what one call each can carry, this is the thing that has to become a
 * webhook.
 */
export async function discoverRoutedDeposits(): Promise<number> {
  if (discoverySweepRunning) return 0;
  discoverySweepRunning = true;
  try {
    const accounts = await enrolledAccounts();

    return await sweep("discover", accounts, async (a) => {
      const list = await routedActivityReadOnly(a.userId, a.accountId);
      for (const d of list) {
        await record(a.userId, d).catch((e: any) =>
          console.error(`[ROUTED] discover ${d.id}:`, e?.message),
        );
      }
    });
  } finally {
    discoverySweepRunning = false;
  }
}
