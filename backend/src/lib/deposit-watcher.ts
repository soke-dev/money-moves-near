import { prisma } from "./prisma";
import { env } from "../config/env";
import { syncAndReadWallets, lastWalletSync, type WatchedChain } from "../routes/wallet";

/**
 * Notices deposits while the app is closed.
 *
 * A deposit from an outside wallet only exists to us once somebody reads the
 * balance and sees it rise - and the only thing that read balances was the app,
 * on open, unlock and return to the foreground. So money sent to a closed app
 * got no "Crypto Received" until the person happened to open it, and was then
 * filed under the day they opened it rather than the day it came.
 *
 * This reads the balances itself, every few minutes, for people active in the
 * last week, through the same sync the app uses - so a deposit it finds is
 * recorded, dated and notified exactly as if the app had found it.
 *
 * Kept light, because these are shared public endpoints:
 *  - Movement, Solana, TON, Stellar and Monad. Base, BSC and Arc are left
 *    out: their public RPCs already refuse batch calls under the app's own
 *    load. Monad's node takes them, and it is one call a person.
 *  - One person at a time, with a pause between, never a burst.
 *  - Anyone whose balances were read in the last couple of minutes - by the
 *    app or by us - is skipped; there is nothing new to learn.
 *  - TON only for people who use it - who hold USDT there or have ever moved
 *    money on it. Its indexer is on a tier that allows about one request a
 *    second, shared with the app; reading TON for everyone, even one round in
 *    three, ran it into 429s that would have stalled people's own TON balances.
 *  - Stellar only for people who have opened it (the sync already does that).
 *
 * The phones' own balance screens read the chains directly from the device, so
 * none of this sits in front of what a person sees in the app.
 */

const ACTIVE_DAYS = 7;
const FRESH_MS = 2 * 60_000;
const GAP_MS = 500;

/** Who uses TON: anyone holding USDT there, or with any TON transaction. */
async function tonUsers(): Promise<Set<string>> {
  const [held, moved] = await Promise.all([
    prisma.wallet.findMany({ where: { chain: "TON", balance: { gt: 0 } }, select: { userId: true } }),
    prisma.transaction.findMany({ where: { chain: "TON" }, distinct: ["userId"], select: { userId: true } }),
  ]);
  return new Set([...held, ...moved].map((r) => r.userId));
}

let running = false;
let round = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function watchOnce(): Promise<void> {
  if (running) return;
  running = true;
  const started = Date.now();
  round++;
  let checked = 0;
  let skipped = 0;
  let failed = 0;
  let tonRead = 0;
  try {
    const onTon = await tonUsers();
    const since = new Date(Date.now() - ACTIVE_DAYS * 86_400_000);
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        sessions: { some: { lastActiveAt: { gte: since } } },
        wallets: { some: { chain: { in: ["MOVE", "SOL"] }, address: { not: null } } },
      },
      select: { id: true },
    });

    for (const u of users) {
      const last = lastWalletSync.get(u.id);
      if (last && Date.now() - last < FRESH_MS) {
        skipped++;
        continue;
      }
      const chains: WatchedChain[] = onTon.has(u.id)
        ? ["MOVE", "SOL", "STELLAR", "MONAD", "TON"]
        : ["MOVE", "SOL", "STELLAR", "MONAD"];
      if (onTon.has(u.id)) tonRead++;
      try {
        await syncAndReadWallets(u.id, { chains });
        checked++;
      } catch (err: any) {
        failed++;
        console.warn(`[DEPOSIT-WATCH] ${u.id}: ${err?.message ?? err}`);
      }
      await sleep(GAP_MS);
    }

    console.log(
      `[DEPOSIT-WATCH] round ${round}: ${checked} checked (${tonRead} with TON), ${skipped} fresh, ` +
        `${failed} failed, ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
  } catch (err: any) {
    console.error("[DEPOSIT-WATCH] round failed:", err?.message ?? err);
  } finally {
    running = false;
  }
}

/** Starts the watcher. DEPOSIT_WATCH_MINUTES=0 turns it off. */
export function startDepositWatcher(): void {
  const minutes = env.DEPOSIT_WATCH_MINUTES;
  if (!minutes || minutes <= 0) {
    console.log("[DEPOSIT-WATCH] off (DEPOSIT_WATCH_MINUTES=0)");
    return;
  }
  // A minute after boot, so a deploy's own startup traffic settles first.
  setTimeout(() => watchOnce().catch(() => {}), 60_000);
  setInterval(() => watchOnce().catch(() => {}), minutes * 60_000);
  console.log(`[DEPOSIT-WATCH] every ${minutes} min for users active in the last ${ACTIVE_DAYS} days`);
}
