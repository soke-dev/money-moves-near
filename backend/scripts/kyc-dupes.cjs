/**
 * Accounts with more than one live verification attempt.
 *
 * Starting verification creates a session at the provider and a row against
 * that session id. Abandon it, start again, and you have two rows - both
 * PENDING, both real attempts.
 *
 *   railway run --service backend node scripts/kyc-dupes.cjs
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  const rows = await prisma.kycVerification.findMany({
    where: { provider: "didit", status: "PENDING" },
    select: { id: true, userId: true, createdAt: true, metamapRef: true, user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });

  const byUser = {};
  for (const r of rows) (byUser[r.userId] ||= []).push(r);

  const dupes = Object.values(byUser).filter((v) => v.length > 1);
  console.log(`pending didit rows: ${rows.length} across ${Object.keys(byUser).length} accounts`);
  console.log(`accounts with more than one: ${dupes.length}\n`);

  for (const list of dupes) {
    console.log(list[0].user.email);
    for (const r of list) {
      console.log(`   ${r.createdAt.toISOString()}  session ${String(r.metamapRef).slice(0, 12)}…`);
    }
  }
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
