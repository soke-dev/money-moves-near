import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Takes the username off one account, freeing the name.
 *
 * For a duplicate account: with the name gone, nobody can send to it by
 * username, and the other side of the pair can hold that name cleanly. The
 * account itself is untouched - it keeps its history, its wallet and whatever
 * is in it - so this is reversible by setting the name back.
 *
 * Targeted by EMAIL, never by username, because the whole reason this script
 * exists is that two accounts answer to the same name.
 *
 *   npx tsx src/scripts/release-username.ts <email> --yes
 */
async function main() {
  const email = process.argv[2];
  const confirmed = process.argv.includes("--yes");
  if (!email) {
    console.log("Usage: release-username.ts <email> --yes");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      email: true,
      username: true,
      walletType: true,
      _count: { select: { transactions: true } },
    },
  });

  if (!user) {
    console.log(`No account with email ${email}`);
    return;
  }

  console.log("\n  account   " + user.email);
  console.log("  username  @" + (user.username ?? "(none)"));
  console.log("  wallet    " + (user.walletType ?? "(not recorded)"));
  console.log("  history   " + user._count.transactions + " transactions\n");

  if (!user.username) {
    console.log("  Already has no username. Nothing to do.\n");
    return;
  }

  if (!confirmed) {
    console.log("  Dry run. Add --yes to actually release the name.\n");
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { username: null } });
  console.log(`  Released @${user.username}. The account keeps everything else.\n`);
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
