import "dotenv/config";
import { prisma } from "../lib/prisma";
import { routedActivityReadOnly } from "../lib/stableyard-account";
import { syncRoutedLedger } from "../lib/stableyard-ledger";

/**
 * Mirror a person's routed deposits into our transaction history.
 *
 * The same thing the deposit screen does on every open and the poller does
 * every two minutes; this is for checking it by hand. Read-only unless --yes,
 * because it writes rows into a real history and can fire a notification when
 * a deposit has settled since the last look.
 *
 *   npx tsx src/scripts/stableyard-ledger-sync.ts <user>
 *   npx tsx src/scripts/stableyard-ledger-sync.ts <user> --yes
 */

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.log("Usage: stableyard-ledger-sync.ts <username|email> [--yes]");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  const live = await routedActivityReadOnly(user.id);
  console.log(`provider says (${live.length}):`);
  for (const d of live) {
    console.log(
      `  ${d.status.padEnd(11)} ${d.sentAmount ?? "?"} ${d.sentSymbol ?? ""} -> ` +
        `${d.receivedAmount ?? "pending"} ${d.receivedSymbol ?? ""}   ${d.id}`,
    );
  }

  const refs = live.map((d) => `SYDEP-${d.id}`);
  const ours = await prisma.transaction.findMany({
    where: { userId: user.id, reference: { in: refs } },
    select: { reference: true, status: true, amount: true, metadata: true },
  });
  console.log(`\nour rows (${ours.length}):`);
  for (const t of ours) {
    const m: any = t.metadata ?? {};
    console.log(
      `  ${String(t.status).padEnd(11)} ${t.amount} USDC   ` +
        `sent ${m.sentAmount ?? "?"} ${m.sentSymbol ?? ""}   ${t.reference}`,
    );
  }

  if (!process.argv.includes("--yes")) {
    const missing = refs.filter((r) => !ours.some((t) => t.reference === r));
    console.log(`\nRead-only. ${missing.length} row(s) would be written. Pass --yes to apply.`);
    return;
  }

  await syncRoutedLedger(user.id);
  const after = await prisma.transaction.findMany({
    where: { userId: user.id, reference: { in: refs } },
    select: { reference: true, status: true, amount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\nafter sync (${after.length}):`);
  for (const t of after) {
    console.log(`  ${String(t.status).padEnd(11)} ${t.amount} USDC   ${t.reference}`);
  }
}

main()
  .catch((e) => console.error(e?.message ?? e))
  .finally(() => prisma.$disconnect());
