import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Accounts made after Dynamic shipped that carry no wallet type.
 *
 * These are almost certainly email wallets: nothing else has been handed out
 * since 9 September. They have no flag because the app writes it after the
 * wallet arrives, and any interruption in between - the save failing, the app
 * closing, never finishing onboarding - leaves the column empty.
 *
 * The signing guard refuses an empty column, so these are being stopped by a
 * rule aimed at somebody else. Listing them says how much that costs.
 *
 * Read-only.
 *
 *   npx tsx src/scripts/wallet-unflagged.ts
 */
const DYNAMIC_LAUNCH = new Date("2026-09-09T00:00:00Z");

async function main() {
  const rows = await prisma.user.findMany({
    where: { createdAt: { gte: DYNAMIC_LAUNCH }, walletType: null },
    orderBy: { createdAt: "asc" },
    select: {
      username: true,
      email: true,
      createdAt: true,
      kycStatus: true,
      wallets: { select: { address: true, balance: true } },
      _count: { select: { transactions: true } },
    },
  });

  console.log(`\n  ${rows.length} account${rows.length === 1 ? "" : "s"} made since 9 Sep with no wallet type\n`);

  for (const u of rows) {
    const held = u.wallets.reduce((sum, w) => sum + Number(w.balance), 0);
    const addressed = u.wallets.some((w) => w.address);
    console.log(
      `    @${(u.username ?? "?").padEnd(20)} ${(u.email ?? "").padEnd(32)} ` +
        `${u.createdAt.toISOString().slice(0, 10)}  ` +
        `${u._count.transactions} tx  ` +
        `${addressed ? "has addresses" : "NO ADDRESSES"}  ` +
        `${held > 0 ? held.toFixed(6) + " held" : "empty"}`,
    );
  }

  /**
   * An account with addresses but no flag got a wallet and lost only the label.
   * One with neither never finished onboarding, so blocking it costs nothing -
   * there is nothing there to send.
   */
  const withWallet = rows.filter((u) => u.wallets.some((w) => w.address));
  console.log(
    `\n  ${withWallet.length} of them have addresses, so they do have a wallet and only the\n` +
      `  label is missing. The rest never finished setting one up.\n`,
  );
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
