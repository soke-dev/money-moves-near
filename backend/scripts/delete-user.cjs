/**
 * Hard-deletes one account by email, so the same address can sign up again.
 *
 * Not the same as the in-app deletion, which sets deletedAt and leaves the row:
 * /auth/dynamic refuses a soft-deleted account, so a soft delete would lock the
 * address out rather than free it. Everything hanging off the user cascades.
 *
 * Refuses an account with any completed money movement - those rows are the
 * record of real money and are not something a convenience script removes.
 *
 * Dry by default. Pass --commit to write.
 *
 *   node scripts/delete-user.cjs someone@example.com
 *   node scripts/delete-user.cjs someone@example.com --commit
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const email = process.argv[2];
const COMMIT = process.argv.includes("--commit");

if (!email || email.startsWith("--")) {
  console.error("Usage: node scripts/delete-user.cjs <email> [--commit]");
  process.exit(1);
}

(async () => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true, email: true, username: true, createdAt: true,
      kycStatus: true, walletType: true, deletedAt: true,
    },
  });

  if (!user) {
    console.log(`No account for ${email}. Nothing to do.`);
    return;
  }

  console.log(JSON.stringify(user, null, 2));

  const counts = {
    transactions: await prisma.transaction.count({ where: { userId: user.id } }),
    wallets: await prisma.wallet.count({ where: { userId: user.id } }),
    sessions: await prisma.session.count({ where: { userId: user.id } }),
    kycVerifications: await prisma.kycVerification.count({ where: { userId: user.id } }),
    beneficiaries: await prisma.beneficiary.count({ where: { userId: user.id } }),
    notifications: await prisma.notification.count({ where: { userId: user.id } }),
  };
  console.log("\nrows that cascade:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${v}`);

  // The guard. A test account has no settled money; anything that does is not
  // a test account, whatever it was created for.
  const settled = await prisma.transaction.count({
    where: { userId: user.id, status: { in: ["COMPLETED", "PROCESSING"] } },
  });
  if (settled > 0) {
    console.error(`\nRefusing: ${settled} completed or in-flight transaction(s). Delete by hand if you mean it.`);
    process.exit(1);
  }

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to delete.");
    return;
  }

  await prisma.user.delete({ where: { id: user.id } });
  console.log("\ndeleted.");

  const gone = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
  console.log(gone ? "  STILL PRESENT — check the cascade" : `  ${email} is free to sign up again`);
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
