/**
 * Clears the Waiting queue and verifies one account by hand.
 *
 * Two things, in one transaction:
 *
 *   1. Deletes the two pending Didit submissions the console lists under
 *      Waiting. Nothing else is touched - the 162 manual verifications, the
 *      13 rejections and the 10 old manual pendings all stay.
 *
 *   2. Marks the TARGET_EMAIL account verified.
 *
 * The second needs more than a status write. `applyDiditDecision` re-applies
 * the provider's verdict on every poll and on every webhook, keyed on the
 * session id held in `metamapRef`, and the poll reads whichever Didit row is
 * newest. Left as they are, this account's rejected rows would put it straight
 * back to REJECTED the next time the app asked. So every Didit session on the
 * account is detached - the same move the admin Revoke flow makes, in the
 * other direction - and the reason is stamped into rawResponse so the record
 * says who did this and why.
 *
 * Dry by default. Pass --commit to write.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");
const TARGET = process.env.TARGET_EMAIL;
if (!TARGET) {
  console.error("Set TARGET_EMAIL to the account to mark verified.");
  process.exit(1);
}

// Named explicitly rather than matched by status, so this can only ever remove
// the two rows it was written to remove.
const DELETE_IDS = [
  "cmtzijpft0005n50xbovdpmpk", // didit PENDING  @soke    2026-09-13T07:49
  "cmtv5je9a00056d842ookjw2t", // didit PENDING  @airdro  2026-09-10T06:34
];

const NOTE = "Verified by an administrator from the console.";

(async () => {
  const doomed = await prisma.kycVerification.findMany({
    where: { id: { in: DELETE_IDS } },
    select: {
      id: true, provider: true, status: true, createdAt: true,
      user: { select: { username: true, email: true } },
    },
  });

  console.log(`to delete (${doomed.length} of ${DELETE_IDS.length} named):`);
  for (const r of doomed) {
    console.log(`  ${r.createdAt.toISOString()} ${r.provider} ${r.status} @${r.user?.username} <${r.user?.email}>`);
  }
  if (doomed.length !== DELETE_IDS.length) {
    console.error("\nRefusing to run: a named row is missing. Re-read the table first.");
    process.exit(1);
  }
  if (doomed.some((r) => r.status !== "PENDING")) {
    console.error("\nRefusing to run: a named row is no longer PENDING.");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: TARGET, mode: "insensitive" } },
    select: { id: true, email: true, username: true, kycStatus: true },
  });
  if (!user) {
    console.error(`\nRefusing to run: ${TARGET} not found.`);
    process.exit(1);
  }

  // Everything still attached to a Didit session after the deletes.
  const attached = await prisma.kycVerification.findMany({
    where: {
      userId: user.id,
      provider: "didit",
      metamapRef: { not: null },
      id: { notIn: DELETE_IDS },
    },
    select: { id: true, status: true, metamapRef: true, createdAt: true, failureReason: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\n${TARGET} (@${user.username}) is ${user.kycStatus} -> VERIFIED`);
  console.log(`  sessions to detach (${attached.length}):`);
  for (const r of attached) {
    console.log(`    ${r.createdAt.toISOString()} ${r.status} ${r.metamapRef} ${r.failureReason || ""}`);
  }
  const newest = attached[0];
  console.log(`  row to mark verified: ${newest ? newest.id : "(none - one will be created)"}`);

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
    return;
  }

  const stamp = { at: new Date().toISOString(), by: "admin", reason: NOTE };

  await prisma.$transaction(async (tx) => {
    await tx.kycVerification.deleteMany({ where: { id: { in: DELETE_IDS } } });

    // Detached one at a time: metamapRef is unique, and each row keeps its own
    // note of what was done to it.
    for (const r of attached) {
      await tx.kycVerification.update({
        where: { id: r.id },
        data: {
          metamapRef: null,
          rawResponse: { adminVerified: { ...stamp, previousSessionId: r.metamapRef } },
        },
      });
    }

    if (newest) {
      await tx.kycVerification.update({
        where: { id: newest.id },
        data: { status: "VERIFIED", failureReason: null },
      });
    } else {
      await tx.kycVerification.create({
        data: {
          userId: user.id,
          provider: "didit",
          documentType: "NIN",
          documentNumber: "",
          status: "VERIFIED",
          rawResponse: { adminVerified: stamp },
        },
      });
    }

    await tx.user.update({
      where: { id: user.id },
      data: { kycStatus: "VERIFIED", kycProvider: "didit" },
    });
  });

  console.log("\ncommitted.");

  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: { kycStatus: true, kycProvider: true },
  });
  const rows = await prisma.kycVerification.findMany({
    where: { userId: user.id },
    select: { provider: true, status: true, metamapRef: true, createdAt: true, failureReason: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`  user: ${after.kycStatus} / ${after.kycProvider}`);
  for (const r of rows) {
    console.log(`  ${r.createdAt.toISOString()} ${r.provider} ${r.status} ref=${r.metamapRef} ${r.failureReason || ""}`);
  }
  console.log(`\n  still pending anywhere: ${await prisma.kycVerification.count({ where: { status: "PENDING" } })}`);
  console.log(`  total rows: ${await prisma.kycVerification.count()}`);
})()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
