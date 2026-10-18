import "dotenv/config";
import { prisma } from "../lib/prisma";
import * as ton from "../lib/ton";

/**
 * TON transfers whose receipt links nowhere.
 *
 * Sends made before the hash fix recorded the hash of the external message
 * this server builds - and that message never reaches the chain. It goes to
 * the relay over HTTP, and the relay makes its own transaction carrying the
 * signed request inside it. So the stored hash resolves to nothing and every
 * one of those receipts opens a 404.
 *
 * What does exist is an event on the sender's account with a GasRelay action
 * in it. This finds the one that matches, by sender and by time, and writes
 * its id in place of the dead hash.
 *
 * Matching is deliberately narrow: same account, a GasRelay action, and
 * within a few minutes of the transaction being recorded. Anything with more
 * than one candidate is left alone and reported rather than guessed at - a
 * wrong link is worse than a dead one, because it looks right.
 *
 * Dry run by default. Pass --yes to write.
 *
 *   npx tsx src/scripts/ton-hash-backfill.ts
 *   npx tsx src/scripts/ton-hash-backfill.ts --yes
 */

const COMMIT = process.argv.includes("--yes");
const WINDOW_MS = 6 * 60_000;

async function resolves(hash: string): Promise<boolean> {
  try {
    await ton.eventById(hash);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const txs = await prisma.transaction.findMany({
    where: { chain: "TON", status: "COMPLETED" },
    select: {
      id: true, userId: true, type: true, amount: true,
      metadata: true, createdAt: true,
      user: { select: { username: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Only the outgoing ones went through the relay; a deposit's hash is an
  // event id already, because it was read off the chain rather than built.
  const relayed = txs.filter((t) =>
    ["WITHDRAW", "SELL", "TRANSFER_OUT", "TRANSFER_IN"].includes(t.type),
  );

  const dead: typeof relayed = [];
  for (const t of relayed) {
    const h = (t.metadata as any)?.txHash;
    if (!h) continue;
    if (!(await resolves(h))) dead.push(t);
  }

  console.log(`\n  ${relayed.length} relayed transfers, ${dead.length} with a dead link`);
  if (!dead.length) return;
  console.log(COMMIT ? "" : "  DRY RUN — nothing is written. Pass --yes to apply.\n");

  /**
   * Grouped by the dead hash, because a username transfer wrote two rows
   * against one transaction and only the sender's account carries the
   * GasRelay event. Resolving from the recipient's side finds nothing.
   */
  const groups = new Map<string, typeof dead>();
  for (const t of dead) {
    const h = (t.metadata as any).txHash as string;
    groups.set(h, [...(groups.get(h) ?? []), t]);
  }

  const eventsFor = new Map<string, any[]>();
  const fixes: { ids: string[]; from: string; to: string; label: string }[] = [];

  for (const [old, rows] of groups) {
    // The outgoing side, which is the account the relay acted for.
    const t = rows.find((r) => r.type !== "TRANSFER_IN") ?? rows[0];
    const label = `@${t.user?.username ?? "?"} ${t.type} ${t.amount}`;

    const sol = await prisma.wallet.findFirst({
      where: { userId: t.userId, chain: "SOL", address: { not: null } },
      select: { address: true },
    });
    if (!sol?.address) {
      console.log(`  ${label}: no Solana key, cannot derive the account`);
      continue;
    }
    const owner = ton.tonAddressFromSolana(sol.address);
    if (!eventsFor.has(owner)) {
      eventsFor.set(owner, await ton.accountEvents(owner, 50));
    }

    /**
     * Matched on the amount, not just the clock.
     *
     * Three sends inside eight minutes made a time window useless - every
     * one of them had two or three candidates. The amount is exact: a
     * transfer of 0.1484 USDT is one event and not the others. Time is kept
     * only as a guard, so a repeat of the same amount weeks later cannot be
     * mistaken for this one.
     */
    const want = BigInt(Math.round(Number(t.amount) * 10 ** ton.TON_USDT_DECIMALS));
    const at = t.createdAt.getTime();
    const candidates = (eventsFor.get(owner) ?? []).filter((e: any) => {
      if (Math.abs(Number(e?.timestamp ?? 0) * 1000 - at) > WINDOW_MS) return false;
      if (!(e?.actions ?? []).some((a: any) => a?.type === "GasRelay")) return false;
      return (e?.actions ?? []).some((a: any) => {
        const jt = a?.JettonTransfer;
        if (!jt) return false;
        try { return BigInt(jt.amount ?? "0") === want; } catch { return false; }
      });
    });

    if (candidates.length !== 1) {
      console.log(`  ${label}: ${candidates.length} candidates on amount ${want} — left alone`);
      continue;
    }
    fixes.push({
      ids: rows.map((r) => r.id),
      from: old,
      to: String(candidates[0].event_id),
      label,
    });
  }

  const seen = new Set<string>();
  for (const f of fixes) {
    if (seen.has(f.from)) continue;
    seen.add(f.from);
    console.log(`\n  ${f.label}  (${f.ids.length} row${f.ids.length === 1 ? "" : "s"})`);
    console.log(`     ${f.from}`);
    console.log(`  →  ${f.to}`);
    if (!COMMIT) continue;
    for (const id of f.ids) {
      const row = await prisma.transaction.findUnique({
        where: { id }, select: { metadata: true },
      });
      await prisma.transaction.update({
        where: { id },
        data: { metadata: { ...(row?.metadata as any), txHash: f.to } },
      });
    }
    console.log("     written");
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e?.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
