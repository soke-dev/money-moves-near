/**
 * Read-only: what the Verification console is showing, and what sits behind it.
 *
 * Counts by status and provider, the pending rows in full, and the current
 * state of one named account.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const TARGET = process.env.TARGET_EMAIL;
if (!TARGET) {
  console.error("Set TARGET_EMAIL to the account to audit.");
  process.exit(1);
}

(async () => {
  const byStatus = await prisma.kycVerification.groupBy({
    by: ["provider", "status"],
    _count: { _all: true },
  });
  console.log("kycVerification rows:");
  for (const g of byStatus.sort((a, b) => (a.provider + a.status).localeCompare(b.provider + b.status))) {
    console.log(`  ${String(g.provider).padEnd(10)} ${String(g.status).padEnd(12)} ${g._count._all}`);
  }
  console.log(`  TOTAL      ${await prisma.kycVerification.count()}`);

  const pending = await prisma.kycVerification.findMany({
    where: { status: "PENDING" },
    select: {
      id: true, provider: true, status: true, metamapRef: true, createdAt: true,
      user: { select: { id: true, email: true, username: true, kycStatus: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\npending (${pending.length}):`);
  for (const r of pending) {
    console.log(`  ${r.createdAt.toISOString()} ${r.provider} @${r.user?.username} <${r.user?.email}> userKyc=${r.user?.kycStatus} ref=${r.metamapRef} id=${r.id}`);
  }

  const u = await prisma.user.findFirst({
    where: { email: { equals: TARGET, mode: "insensitive" } },
    select: {
      id: true, email: true, username: true, firstName: true, lastName: true,
      kycStatus: true, kycProvider: true, kycReference: true,
    },
  });
  console.log(`\n${TARGET}:`);
  console.log(u ? JSON.stringify(u, null, 2) : "  NOT FOUND");

  if (u) {
    const rows = await prisma.kycVerification.findMany({
      where: { userId: u.id },
      select: { id: true, provider: true, status: true, metamapRef: true, createdAt: true, failureReason: true },
      orderBy: { createdAt: "desc" },
    });
    console.log(`  its kycVerification rows (${rows.length}):`);
    for (const r of rows) {
      console.log(`    ${r.createdAt.toISOString()} ${r.provider} ${r.status} ref=${r.metamapRef} ${r.failureReason || ""} id=${r.id}`);
    }
  }
})()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
