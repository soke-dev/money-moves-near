/**
 * Re-date past deposits to when they arrived on chain.
 *
 * Deposits from outside wallets used to be stamped with the moment the app next
 * read the balance - often hours or days after the money came in. Where the
 * record kept the chain's own time (metadata.chainTime), this moves the date to
 * it. Records without one are left alone: there is nothing true to move them to.
 *
 * Movement's times were saved without a zone; they are UTC and read as such.
 *
 *   npx tsx src/scripts/deposit-dates.ts          what would change (read-only)
 *   npx tsx src/scripts/deposit-dates.ts --yes    change it
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--yes");
const TOLERANCE_MS = 2 * 60_000;

function chainDate(at: unknown): Date | null {
  if (typeof at !== "string" || !at) return null;
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(at) ? at : `${at}Z`);
  return Number.isFinite(d.getTime()) && d.getTime() > Date.UTC(2025, 0, 1) ? d : null;
}

(async () => {
  const deposits = await prisma.transaction.findMany({
    where: { type: "DEPOSIT" },
    select: { id: true, chain: true, createdAt: true, metadata: true },
  });

  const moves: { id: string; chain: string; from: Date; to: Date; meta: any }[] = [];
  for (const d of deposits) {
    const meta = (d.metadata ?? {}) as any;
    if (meta.source !== "external_deposit") continue;
    const at = chainDate(meta.chainTime);
    if (!at) continue;
    // Only ever earlier: a chain time after the record would be a bad match.
    if (d.createdAt.getTime() - at.getTime() <= TOLERANCE_MS) continue;
    moves.push({ id: d.id, chain: d.chain ?? "?", from: d.createdAt, to: at, meta });
  }

  const byChain: Record<string, number> = {};
  for (const m of moves) byChain[m.chain] = (byChain[m.chain] || 0) + 1;
  const hours = moves.map((m) => (m.from.getTime() - m.to.getTime()) / 3_600_000).sort((a, b) => a - b);
  console.log(`${moves.length} deposit(s) to re-date`, JSON.stringify(byChain));
  if (hours.length) {
    console.log(
      `  lag: median ${hours[Math.floor(hours.length / 2)].toFixed(1)}h, longest ${hours[hours.length - 1].toFixed(1)}h`,
    );
  }
  for (const m of moves.slice(0, 8)) {
    console.log(`  ${m.chain.padEnd(8)} ${m.from.toISOString()} -> ${m.to.toISOString()}`);
  }

  // How many people the deposit watcher would cover today, for sizing.
  const since = new Date(Date.now() - 7 * 86_400_000);
  const watched = await prisma.user.count({
    where: {
      deletedAt: null,
      sessions: { some: { lastActiveAt: { gte: since } } },
      wallets: { some: { chain: { in: ["MOVE", "SOL"] }, address: { not: null } } },
    },
  });
  console.log(`deposit watcher would cover ${watched} user(s) active in the last 7 days`);

  if (!APPLY) {
    console.log("\nRead-only. Run with --yes to re-date them.");
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const m of moves) {
    await prisma.transaction.update({
      where: { id: m.id },
      data: {
        createdAt: m.to,
        metadata: { ...m.meta, chainTime: m.to.toISOString(), detectedAt: m.from.toISOString(), redatedAt: new Date().toISOString() },
      },
    });
    done++;
  }
  console.log(`\nRe-dated ${done} deposit(s).`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e?.message ?? e);
  await prisma.$disconnect();
  process.exit(1);
});
