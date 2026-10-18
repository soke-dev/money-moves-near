import { prisma } from "../lib/prisma";

/**
 * What identity we actually hold for one person. Read-only.
 *
 * Funding needs an eleven-digit national number as an identity claim before a
 * bank will open a virtual account, and "verified" is not the same thing - a
 * document can verify somebody and carry no NIN, or carry one this never wrote
 * down. This prints both sides so the difference can be seen rather than
 * guessed at.
 *
 *   npx tsx src/scripts/kyc-claims.ts <username|email>
 */

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.log("Usage: kyc-claims.ts <username|email>");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: {
      id: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      kycStatus: true,
      kycProvider: true,
    },
  });

  if (!user) {
    console.log("No such user.");
    return;
  }

  console.log(`@${user.username}  ${user.email}`);
  console.log(`  name        ${user.firstName} ${user.lastName}`);
  console.log(`  kycStatus   ${user.kycStatus}`);
  console.log(`  kycProvider ${user.kycProvider ?? "—"}`);

  const claims = await prisma.identityClaim.findMany({
    where: { userId: user.id },
    select: { kind: true, key: true, createdAt: true },
  });

  console.log(`\n  identity claims (${claims.length}):`);
  for (const c of claims) {
    const stripped = c.key.replace(/^nin:/, "");
    const usable = /^\d{11}$/.test(stripped);
    console.log(
      `    ${c.kind.padEnd(18)} key=${JSON.stringify(c.key)}` +
        (c.kind === "national_number" ? `   funding-usable: ${usable}` : "")
    );
  }
  if (!claims.length) console.log("    (none)");

  const kv = await prisma.kycVerification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      status: true,
      provider: true,
      createdAt: true,
      documentNumber: true,
      firstName: true,
      lastName: true,
      failureReason: true,
    },
  });

  console.log(`\n  kyc verifications (${kv.length} most recent):`);
  for (const v of kv) {
    console.log(`    ${v.createdAt.toISOString()}  ${v.provider}  ${v.status}`);
    console.log(`       documentNumber = ${JSON.stringify(v.documentNumber)}`);
    console.log(`       name           = ${v.firstName ?? "—"} ${v.lastName ?? "—"}`);
    if (v.failureReason) console.log(`       failureReason  = ${v.failureReason}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
