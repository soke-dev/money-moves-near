/**
 * Clears the typed-in profile name from every account that has not verified.
 *
 * The name on a profile used to be whatever someone entered, and nothing
 * reconciled it with their ID. It is now load-bearing - a naira deposit is
 * released or held on it - so a self-declared name is worse than no name: it
 * looks authoritative and is not.
 *
 * Verification writes the document's name onto the account from here on, so an
 * unverified account with a blank name fills itself in the moment it verifies.
 * A verified account keeps what it has; the rule is that a verified name came
 * from an ID, and clearing it would throw away the only checked name on file.
 *
 * Dry by default. Pass --commit to write.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");

(async () => {
  const where = {
    kycStatus: { not: "VERIFIED" },
    OR: [{ firstName: { not: null } }, { lastName: { not: null } }],
  };

  const affected = await prisma.user.findMany({
    where,
    select: { email: true, username: true, firstName: true, lastName: true, kycStatus: true },
    orderBy: { createdAt: "asc" },
  });

  const kept = await prisma.user.findMany({
    where: { kycStatus: "VERIFIED" },
    select: { email: true, firstName: true, lastName: true },
  });

  console.log(`accounts keeping their name (verified): ${kept.length}`);
  for (const k of kept) console.log(`  ${k.email}  ${k.firstName ?? "—"} ${k.lastName ?? "—"}`);

  console.log(`\naccounts to clear: ${affected.length}`);
  for (const a of affected.slice(0, 20)) {
    console.log(`  ${String(a.kycStatus).padEnd(9)} @${a.username ?? "—"}  ${a.firstName ?? "—"} ${a.lastName ?? "—"}`);
  }
  if (affected.length > 20) console.log(`  … and ${affected.length - 20} more`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to clear.");
    return;
  }

  const r = await prisma.user.updateMany({ where, data: { firstName: null, lastName: null } });
  console.log(`\ncleared ${r.count} account(s).`);

  const left = await prisma.user.count({ where });
  console.log(left ? `  ${left} still carry a name — re-run` : "  none left");
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
