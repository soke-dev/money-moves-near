/**
 * Prepares the App Store reviewer's account.
 *
 * Apple reviews from outside Nigeria and cannot hold a Nigerian ID, receive our
 * email, or send a naira transfer - so the account they sign in to has to be
 * made to look verified by hand. This does that, and only that: a name, a
 * verified status, and a stand-in NIN so the screens that ask for one render.
 *
 * The NIN is deliberately 00000000000. It is well-formed enough to pass our own
 * shape check and unmistakable enough that nobody reads it as a real person's
 * in the console. It is NOT a working NIN: Flutterwave will refuse to open a
 * payment account with it, so naira funding will fail at that step for this
 * account. Everything that does not touch the bank works.
 *
 * The verification row is recorded as manual, not didit, because it is - which
 * also keeps it out of the live provider queue and stops anything trying to
 * re-poll a session that does not exist.
 *
 * Idempotent. Dry by default; pass --commit to write.
 *
 *   node scripts/review-account.cjs <email> [--commit]
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const EMAIL = process.argv[2];
const COMMIT = process.argv.includes("--commit");

const FIRST = "App";
const LAST = "Review";
const NIN = "00000000000";

if (!EMAIL || EMAIL.startsWith("--")) {
  console.error("Usage: node scripts/review-account.cjs <email> [--commit]");
  process.exit(1);
}

(async () => {
  const user = await prisma.user.findFirst({
    where: { email: { equals: EMAIL, mode: "insensitive" } },
    select: { id: true, email: true, username: true, firstName: true, lastName: true, kycStatus: true },
  });

  if (!user) {
    console.error(`No account for ${EMAIL}. Sign in once with it first, then re-run.`);
    process.exit(1);
  }

  const rows = await prisma.kycVerification.count({ where: { userId: user.id } });
  const claim = await prisma.identityClaim.findFirst({
    where: { userId: user.id, kind: "national_number" },
    select: { key: true },
  });

  console.log(JSON.stringify(user, null, 2));
  console.log(`  verification rows: ${rows}`);
  console.log(`  nin claim:         ${claim?.key ?? "none"}`);
  console.log(`\n  -> ${FIRST} ${LAST}, VERIFIED, nin:${NIN}`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { firstName: FIRST, lastName: LAST, kycStatus: "VERIFIED", kycProvider: "manual" },
  });

  const existing = await prisma.kycVerification.findFirst({
    where: { userId: user.id, provider: "manual" },
    select: { id: true },
  });
  if (existing) {
    await prisma.kycVerification.update({
      where: { id: existing.id },
      data: { status: "VERIFIED", firstName: FIRST, lastName: LAST, documentNumber: NIN, failureReason: null },
    });
  } else {
    await prisma.kycVerification.create({
      data: {
        userId: user.id,
        provider: "manual",
        documentType: "NIN",
        documentNumber: NIN,
        status: "VERIFIED",
        firstName: FIRST,
        lastName: LAST,
        rawResponse: { appReviewAccount: { at: new Date().toISOString(), note: "Prepared for App Store review" } },
      },
    });
  }

  // The NIN the funding screens read comes from here, not from the row above.
  const key = `nin:${NIN}`;
  const held = await prisma.identityClaim.findUnique({ where: { key }, select: { userId: true } });
  if (!held) {
    await prisma.identityClaim.create({ data: { userId: user.id, key, kind: "national_number" } });
  } else if (held.userId !== user.id) {
    console.warn(`  ${key} already belongs to another account - not reassigned`);
  }

  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, username: true, firstName: true, lastName: true, kycStatus: true },
  });
  const claims = await prisma.identityClaim.findMany({
    where: { userId: user.id },
    select: { kind: true, key: true },
  });
  console.log("\nwritten:", JSON.stringify(after));
  for (const c of claims) console.log(`  claim ${c.kind} = ${c.key}`);
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
