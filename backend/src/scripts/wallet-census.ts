import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * How many accounts are really on a 12-word wallet.
 *
 * `walletType` cannot answer this. It is set to EMBEDDED whenever the app finds
 * itself signed into Dynamic, which says nothing about which key holds the
 * money - so an account created long before embedded wallets existed can carry
 * the flag and still be signing with a phrase.
 *
 * The date can answer it. Dynamic email sign-in shipped on 2026-09-09; every
 * account made before that was given twelve words, because nothing else
 * existed. So age is the honest signal and the flag is the unreliable one, and
 * printing them side by side shows how far apart they are.
 *
 * Read-only.
 *
 *   npx tsx src/scripts/wallet-census.ts
 */
const DYNAMIC_LAUNCH = new Date("2026-09-09T00:00:00Z");

async function main() {
  const [before, after] = await Promise.all([
    prisma.user.groupBy({
      by: ["walletType"],
      where: { createdAt: { lt: DYNAMIC_LAUNCH } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["walletType"],
      where: { createdAt: { gte: DYNAMIC_LAUNCH } },
      _count: { _all: true },
    }),
  ]);

  const show = (rows: typeof before) =>
    rows
      .map((r) => `${(r.walletType ?? "(no flag)").padEnd(12)} ${r._count._all}`)
      .join("\n      ") || "none";

  console.log(`\n  Accounts made BEFORE 9 Sep — twelve words, whatever the flag says`);
  console.log("      " + show(before));
  console.log(`\n  Accounts made AFTER 9 Sep — genuinely embedded`);
  console.log("      " + show(after));

  /**
   * The ones that matter: old accounts holding something. Blocking an empty
   * account costs nobody anything; blocking a funded one strands money.
   */
  const oldOnes = await prisma.user.findMany({
    where: { createdAt: { lt: DYNAMIC_LAUNCH } },
    select: {
      id: true,
      username: true,
      email: true,
      walletType: true,
      wallets: { where: { balance: { gt: 0 } }, select: { asset: true, chain: true, balance: true } },
    },
  });

  const funded = oldOnes.filter((u) => u.wallets.length > 0);

  console.log(`\n  Of ${oldOnes.length} pre-Dynamic accounts, ${funded.length} still hold a balance\n`);

  for (const u of funded.slice(0, 40)) {
    const held = u.wallets
      .map((w) => `${Number(w.balance)} ${w.asset}/${w.chain}`)
      .join(", ");
    console.log(`    @${(u.username ?? "?").padEnd(18)} ${(u.walletType ?? "(no flag)").padEnd(10)} ${held}`);
  }
  if (funded.length > 40) console.log(`    … and ${funded.length - 40} more`);

  console.log(
    "\n  Those are the accounts a signing block strands. Recorded balances, not\n" +
      "  chain reads - a row saying zero can still hold something.\n",
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
