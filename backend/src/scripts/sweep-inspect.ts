import { prisma } from "../lib/prisma";

/**
 * What became of the recent sweeps. Read-only.
 *
 * Nothing here writes, sends or spends - it prints the row and the legs inside
 * it so a failure can be read rather than guessed at. A leg still sitting at
 * `pending` never reached the server at all, which is a different fault from
 * one that says `failed` with a reason attached.
 *
 *   npx tsx src/scripts/sweep-inspect.ts [limit]
 */

async function main() {
  const limit = Number(process.argv[2] || 10);

  const sweeps = await prisma.transaction.findMany({
    where: { type: "SWEEP" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      reference: true,
      status: true,
      amount: true,
      createdAt: true,
      metadata: true,
      user: { select: { username: true, email: true } },
    },
  });

  if (!sweeps.length) {
    console.log("No sweeps on record.");
    return;
  }

  for (const s of sweeps) {
    const meta = (s.metadata ?? {}) as any;
    const legs = (meta.legs ?? []) as any[];
    const who = s.user?.username ? `@${s.user.username}` : s.user?.email ?? "?";

    console.log("─".repeat(72));
    console.log(`${s.reference}   ${s.status}   ${who}`);
    console.log(`  id         ${s.id}`);
    console.log(`  created    ${s.createdAt.toISOString()}`);
    console.log(`  amount     ${s.amount}`);
    console.log(`  anyLanded  ${meta.anyLanded === true}`);
    console.log(`  destination ${meta.destination ?? "—"}`);

    for (const l of legs) {
      console.log(`  ── ${l.asset} on ${l.chain}: ${l.status}  (${l.amount})`);
      if (l.txHash) console.log(`       out    ${l.txHash}`);
      if (l.creditHash) console.log(`       credit ${l.creditHash}`);
      if (l.error) console.log(`       error  ${l.error}`);
      if (l.status === "pending") {
        console.log("       note   never reached the server — the phone gave up before submitting");
      }
    }
  }
  console.log("─".repeat(72));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
