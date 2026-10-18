import { prisma } from "../lib/prisma";
import type { SweepLeg } from "../lib/sweep";

/**
 * Close sweeps that can no longer change, by hand.
 *
 * The same rule the cleanup job applies every five minutes, available when
 * waiting for the next tick is not what you want - after a deploy, say, or for
 * a row that predates the job existing.
 *
 * Anything that landed makes the sweep COMPLETED for that amount; only a sweep
 * that moved nothing is FAILED. A leg we took and did not credit is left
 * exactly alone, because closing it would file away something a person still
 * has to settle.
 *
 *   npx tsx src/scripts/sweep-settle.ts            # say what would change
 *   npx tsx src/scripts/sweep-settle.ts --yes      # change it
 */

async function main() {
  const commit = process.argv.includes("--yes");

  const open = await prisma.transaction.findMany({
    where: { status: "PENDING", type: "SWEEP" },
    select: { id: true, reference: true, amount: true, metadata: true },
    orderBy: { createdAt: "desc" },
  });

  if (!open.length) {
    console.log("No open sweeps.");
    return;
  }

  for (const row of open) {
    const meta = (row.metadata ?? {}) as any;
    const legs = ((meta.legs ?? []) as SweepLeg[]).map((l) =>
      l.status === "pending" || l.status === "sending"
        ? { ...l, status: "failed" as const, error: l.error || "The app never sent this one" }
        : l
    );

    if (legs.some((l) => l.status === "sent")) {
      console.log(`${row.reference}: holding a leg we took and did not credit — left alone`);
      continue;
    }

    const landed = legs.filter((l) => l.status === "landed");
    const status = landed.length > 0 ? "COMPLETED" : "FAILED";
    const amount = landed.reduce((n, l) => n + l.amount, 0);

    console.log(
      `${row.reference}: PENDING → ${status}, ${row.amount} → ${amount}` +
        `  (${landed.length} of ${legs.length} landed)`
    );

    if (!commit) continue;

    await prisma.transaction.update({
      where: { id: row.id },
      data: {
        status,
        amount,
        metadata: { ...meta, legs, completedAt: new Date().toISOString() },
      },
    });
  }

  console.log(commit ? "\nWritten." : "\nNothing written. Pass --yes to apply.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
