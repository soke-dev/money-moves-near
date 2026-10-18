/**
 * Brings a verified account's profile name into line with its own document.
 *
 * Verification writes the document's name onto the account from now on, but
 * accounts verified before that - or verified by hand from the console, which
 * detaches the provider session so no poll will ever run again - keep whatever
 * was typed. This settles them.
 *
 * Only touches accounts at VERIFIED that hold a verified KYC row with a name,
 * and only where the two actually differ.
 *
 * Dry by default. Pass --commit to write.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");

(async () => {
  const users = await prisma.user.findMany({
    where: { kycStatus: "VERIFIED" },
    select: { id: true, email: true, username: true, firstName: true, lastName: true },
  });

  const changes = [];
  const skipped = [];

  for (const u of users) {
    const kyc = await prisma.kycVerification.findFirst({
      where: { userId: u.id, status: "VERIFIED" },
      orderBy: { createdAt: "desc" },
      select: { firstName: true, lastName: true, provider: true, createdAt: true },
    });

    if (!kyc?.firstName && !kyc?.lastName) {
      skipped.push(`${u.email} — no verified row carrying a name`);
      continue;
    }

    const first = kyc.firstName ?? u.firstName;
    const last = kyc.lastName ?? u.lastName;
    if (first === u.firstName && last === u.lastName) {
      skipped.push(`${u.email} — already matches`);
      continue;
    }

    changes.push({ id: u.id, email: u.email, from: `${u.firstName ?? "—"} ${u.lastName ?? "—"}`, to: `${first ?? "—"} ${last ?? "—"}`, first, last, src: kyc.provider });
  }

  console.log(`verified accounts: ${users.length}`);
  for (const s of skipped) console.log(`  skip  ${s}`);
  console.log(`\nto align: ${changes.length}`);
  for (const c of changes) console.log(`  ${c.email}\n      ${c.from}  ->  ${c.to}   (from the ${c.src} row)`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
    return;
  }

  for (const c of changes) {
    await prisma.user.update({ where: { id: c.id }, data: { firstName: c.first, lastName: c.last } });
  }
  console.log(`\naligned ${changes.length} account(s).`);
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
