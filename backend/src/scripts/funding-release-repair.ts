import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Purchases that were released by hand and never written down.
 *
 * Releasing a held deposit used to record the decision and nothing else, so
 * the coin went out from the treasury, the chain-watcher saw USDC arrive from
 * nowhere and filed it as an external deposit, and the purchase existed in no
 * report at all. Missing from buy volume, missing from fee revenue, and the
 * person who bought it saw "Deposited USDC" in their own history.
 *
 * Release writes the purchase itself now. This is for the ones released before
 * it did.
 *
 * What it writes is the same row the ordinary delivery path writes, under the
 * intent's own reference so it can never be written twice, and with no
 * transaction hash - the transfer was made by hand and there is nothing to
 * point at. It then removes the watcher's duplicate of the same money, which
 * is safe because balances are read from the chain and never summed from these
 * rows: this is history, not ledger.
 *
 * Dry run by default. Pass --yes to write.
 *
 *   npx tsx src/scripts/funding-release-repair.ts
 *   npx tsx src/scripts/funding-release-repair.ts --yes
 */

const COMMIT = process.argv.includes("--yes");

async function main() {
  const released = await prisma.fundingIntent.findMany({
    where: { status: "PAID", reviewedAt: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, reference: true, userId: true, token: true, chain: true,
      amountNaira: true, convertedAmount: true, reviewedAt: true, reviewedBy: true,
      user: { select: { username: true } },
    },
  });

  const orphans = [];
  for (const f of released) {
    const has = await prisma.transaction.findUnique({
      where: { reference: f.reference },
      select: { id: true },
    });
    if (!has) orphans.push(f);
  }

  console.log(`\n  ${released.length} hand-reviewed deposits, ${orphans.length} with no purchase recorded`);
  if (!orphans.length) return;
  if (!COMMIT) console.log("  DRY RUN — nothing is written. Pass --yes to apply.\n");
  else console.log("");

  for (const f of orphans) {
    const amount = Number(f.convertedAmount ?? 0);
    console.log(`  @${f.user?.username ?? "?"}  ${f.reference}`);
    console.log(`     ₦${f.amountNaira} → ${amount} ${f.token} on ${f.chain}`);

    if (!(amount > 0)) {
      console.log("     skipped: no converted amount on the intent");
      continue;
    }

    // The watcher's version of the same money, matched the way routed deposits
    // are: same person, same chain, an amount within a couple of per cent of
    // the quote, seen near the review.
    const dupe = await prisma.transaction.findFirst({
      where: {
        userId: f.userId,
        type: "DEPOSIT",
        chain: f.chain as any,
        metadata: { path: ["source"], equals: "external_deposit" },
        amount: { gte: amount * 0.98, lte: amount * 1.02 },
        ...(f.reviewedAt
          ? {
              createdAt: {
                gte: new Date(f.reviewedAt.getTime() - 6 * 60 * 60_000),
                lte: new Date(f.reviewedAt.getTime() + 6 * 60 * 60_000),
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, reference: true, amount: true },
    });
    console.log(
      dupe
        ? `     watcher duplicate to remove: ${dupe.reference} (${dupe.amount})`
        : "     no watcher duplicate found — leaving the purchase on its own",
    );

    if (!COMMIT) continue;

    await prisma.transaction.create({
      data: {
        userId: f.userId,
        type: "BUY",
        asset: f.token as any,
        chain: f.chain as any,
        amount,
        fee: 0,
        status: "COMPLETED",
        reference: f.reference,
        metadata: {
          amountNaira: Number(f.amountNaira ?? 0),
          txHash: null,
          fundingIntentId: f.id,
          repairedAt: new Date().toISOString(),
        },
      },
    });
    if (dupe) await prisma.transaction.delete({ where: { id: dupe.id } });
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
