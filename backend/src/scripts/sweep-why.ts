import "dotenv/config";
import { prisma } from "../lib/prisma";
import { sweepQuote, SWEEP_ASSETS, SWEEP_CHAINS } from "../lib/sweep";

/**
 * Why the sweep tag is not showing for somebody. Read-only.
 *
 * The tag is hidden by three separate conditions and the app cannot tell them
 * apart - no quote, no sweepable balance, or no attempts left all draw the
 * same nothing. This prints all three so the answer is read rather than
 * guessed at.
 *
 *   npx tsx src/scripts/sweep-why.ts @username
 *   npx tsx src/scripts/sweep-why.ts            (finds likely candidates)
 */

async function main() {
  const who = (process.argv[2] || "").replace(/^@/, "");

  const users = who
    ? await prisma.user.findMany({
        where: { OR: [{ username: { equals: who, mode: "insensitive" } }, { email: who }] },
        select: { id: true, username: true, email: true },
      })
    : await prisma.user.findMany({
        where: {
          wallets: {
            some: {
              asset: { in: SWEEP_ASSETS as unknown as any[] },
              chain: { in: SWEEP_CHAINS as unknown as any[] },
              balance: { gt: 1 },
            },
          },
        },
        take: 12,
        select: { id: true, username: true, email: true },
      });

  if (!users.length) {
    console.log("Nobody matched.");
    return;
  }

  for (const u of users) {
    const quote = await sweepQuote(u.id);

    // Every wallet row sweep could have looked at, including the ones it
    // filtered out - a row sitting at zero is the answer more often than the
    // allowance is.
    const rows = await prisma.wallet.findMany({
      where: {
        userId: u.id,
        asset: { in: SWEEP_ASSETS as unknown as any[] },
        chain: { in: SWEEP_CHAINS as unknown as any[] },
      },
      select: { asset: true, chain: true, balance: true, address: true },
    });

    const recent = await prisma.transaction.findMany({
      where: {
        userId: u.id,
        type: "SWEEP",
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { reference: true, status: true, createdAt: true, metadata: true },
    });

    // Matches the app: the tag is about having something to gather, not
    // about having an attempt left.
    const canSwap = quote.balances.length > 0;

    console.log("─".repeat(70));
    console.log(`@${u.username ?? "?"}  ${u.email ?? ""}`);
    console.log(`  tag shows: ${canSwap ? "YES" : "NO"}`);
    console.log(
      `  allowance: ${quote.used} used, ${quote.left} left of ${quote.perWeek}` +
        (quote.resetsAt ? `  (back ${quote.resetsAt})` : ""),
    );
    console.log(`  sweepable: ${quote.balances.length} balance(s), total ${quote.total}`);
    for (const b of quote.balances) console.log(`      + ${b.asset} ${b.chain} ${b.amount}`);
    console.log(`  all rows sweep can see:`);
    for (const r of rows) {
      console.log(`      ${r.asset.padEnd(6)} ${String(r.chain).padEnd(7)} ${String(r.balance).padEnd(14)} ${r.address ? "" : "NO ADDRESS"}`);
    }
    if (!rows.length) console.log("      (none)");
    console.log(`  sweeps in the last 7 days: ${recent.length}`);
    for (const s of recent) {
      const landed = (s.metadata as any)?.anyLanded === true;
      console.log(`      ${s.createdAt.toISOString().slice(0, 16)}  ${s.reference}  ${s.status}  ${landed ? "COUNTS" : "free"}`);
    }
  }
  console.log("─".repeat(70));
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
