import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Approve a waiting submission using identity we already hold. Read-only
 * without --yes.
 *
 * The console's own Approve copies the submission's firstName and lastName
 * straight onto the account, which is right when the provider read the card
 * properly and very wrong when it did not - and it creates no identity claim,
 * so an approved account can still be unable to fund. This does the job
 * carefully, for the cases where a human has looked.
 *
 * What it does NOT do is rewrite the submission's own fields. That row is the
 * record of what the provider actually returned, and an audit trail that has
 * been tidied up is not one.
 *
 *   npx tsx src/scripts/kyc-approve-manual.ts <username> <First> <Last> <NIN>
 *   npx tsx src/scripts/kyc-approve-manual.ts <username> <First> <Last> <NIN> --yes
 */

async function main() {
  const [who, first, last, nin] = process.argv.slice(2);
  const commit = process.argv.includes("--yes");

  if (!who || !first || !last || !nin) {
    console.log("Usage: kyc-approve-manual.ts <username> <First> <Last> <NIN> [--yes]");
    return;
  }
  if (!/^[1-9]\d{10}$/.test(nin)) {
    console.log(`Refusing: "${nin}" is not an 11-digit NIN without a leading zero.`);
    console.log("Flutterwave reads the NIN as a number, so a leading zero can never open an account.");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true, email: true, firstName: true, lastName: true, kycStatus: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  const pending = await prisma.kycVerification.findFirst({
    where: { userId: user.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, provider: true, createdAt: true, firstName: true, lastName: true, documentNumber: true },
  });

  const key = `nin:${nin}`;
  const clash = await prisma.identityClaim.findUnique({
    where: { key },
    select: { userId: true },
  });
  const clashUser =
    clash && clash.userId !== user.id
      ? await prisma.user.findUnique({
          where: { id: clash.userId },
          select: { username: true, email: true },
        })
      : null;

  console.log(`@${user.username}  ${user.email}`);
  console.log(`  kycStatus   ${user.kycStatus}  ->  VERIFIED`);
  console.log(`  name        ${user.firstName} ${user.lastName}  ->  ${first} ${last}`);
  console.log(`  claim       ${key}  ${clash ? (clashUser ? "ALREADY HELD BY ANOTHER ACCOUNT" : "(already theirs)") : "(new)"}`);
  if (clashUser) console.log(`                held by @${clashUser.username} ${clashUser.email}`);
  console.log(
    `  submission  ${pending ? `${pending.provider} ${pending.createdAt.toISOString()} -> VERIFIED` : "none pending"}`
  );
  if (pending) {
    console.log(`                provider read: ${JSON.stringify(`${pending.firstName} ${pending.lastName}`)}`);
    console.log(`                provider number: ${JSON.stringify(pending.documentNumber)}`);
    console.log("                left exactly as returned — this is the audit trail, not the account");
  }

  if (clashUser) {
    console.log("\nRefusing: that NIN already verifies a different account.");
    return;
  }
  if (!commit) {
    console.log("\nNothing written. Pass --yes to apply.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (pending) {
      await tx.kycVerification.update({ where: { id: pending.id }, data: { status: "VERIFIED" } });
    }
    await tx.user.update({
      where: { id: user.id },
      data: { kycStatus: "VERIFIED", firstName: first, lastName: last },
    });
    if (!clash) {
      // Without this an approved account still cannot open a payment account:
      // funding looks for a national_number claim, not for kycStatus.
      await tx.identityClaim.create({
        data: { userId: user.id, kind: "national_number", key },
      });
    }
  });

  console.log("\nWritten.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
