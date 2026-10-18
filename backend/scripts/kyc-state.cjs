const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const users = await prisma.user.findMany({
    where: { OR: [{ username: "soke" }, { email: { contains: "okotete", mode: "insensitive" } }] },
    select: { id: true, email: true, username: true, kycStatus: true, kycProvider: true, kycReference: true },
  });
  for (const u of users) {
    console.log(`${u.email} @${u.username} | kycStatus=${u.kycStatus} provider=${u.kycProvider} ref=${u.kycReference}`);
    const v = await prisma.kycVerification.findMany({
      where: { userId: u.id },
      select: { provider: true, status: true, metamapRef: true, createdAt: true, failureReason: true },
      orderBy: { createdAt: "desc" },
    });
    if (!v.length) console.log("   no kycVerification rows");
    for (const r of v) console.log(`   ${r.createdAt.toISOString()} ${r.provider} ${r.status} ref=${r.metamapRef} ${r.failureReason || ""}`);
  }
  const stale = await prisma.kycVerification.count({ where: { provider: "didit", status: "VERIFIED" } });
  const resetUsers = await prisma.user.count({ where: { kycStatus: "NONE" } });
  console.log(`\ndidit rows still marked approved: ${stale}`);
  console.log(`users at kycStatus NONE: ${resetUsers}`);
})().catch(e => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
