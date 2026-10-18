/**
 * Sends everyone back through identity verification.
 *
 * The old KYC was run by a previous provider against a previous account model.
 * Carrying those approvals into the new system would mean trusting checks we
 * can no longer see the evidence for, so every account is reset to NONE and
 * verifies again on Didit.
 *
 * KEEP is the one account already verified through the new provider; resetting
 * it would only make it repeat a check it has already passed here.
 *
 * Prints what it will do and requires --apply to write anything. The
 * KycVerification records are left alone: they are the audit trail of what was
 * checked and when, and deleting them would destroy history rather than reset
 * state.
 *
 *   railway run --service backend node scripts/reset-kyc.cjs
 *   railway run --service backend node scripts/reset-kyc.cjs --apply
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
// Comma-separated emails to keep verified. Required: an empty list would reset everyone.
const KEEP = (process.env.KEEP_EMAILS || "").split(",").map((e) => e.trim()).filter(Boolean);
if (KEEP.length === 0) {
  console.error("Set KEEP_EMAILS to the accounts that stay verified.");
  process.exit(1);
}
const APPLY = process.argv.includes("--apply");

(async () => {
  const affected = await prisma.user.findMany({
    where: {
      email: { notIn: KEEP },
      OR: [
        { kycStatus: { not: "NONE" } },
        { kycProvider: { not: null } },
        { kycReference: { not: null } },
      ],
    },
    select: { id: true, email: true, kycStatus: true, kycProvider: true, kycReference: true },
  });

  const byStatus = affected.reduce((acc, u) => {
    acc[u.kycStatus] = (acc[u.kycStatus] || 0) + 1;
    return acc;
  }, {});

  console.log(`Accounts to reset: ${affected.length}`);
  console.log("By current status:", byStatus);
  console.log("Kept as verified:", KEEP.join(", "));

  const kept = await prisma.user.findMany({
    where: { email: { in: KEEP } },
    select: { email: true, kycStatus: true },
  });
  kept.forEach((u) => console.log(`  ${u.email} stays ${u.kycStatus}`));

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  // Who was what, before the write. Nothing else records it, so without this
  // the reset could not be undone if it turns out to be the wrong call.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `kyc-before-${stamp}.json`;
  const snapshot = process.env.KYC_SNAPSHOT_DIR
    ? require("path").join(process.env.KYC_SNAPSHOT_DIR, file)
    : file;
  require("fs").writeFileSync(snapshot, JSON.stringify(affected, null, 2));
  console.log(`\nSnapshot of ${affected.length} accounts written to ${snapshot}`);

  const result = await prisma.user.updateMany({
    where: { email: { notIn: KEEP } },
    data: { kycStatus: "NONE", kycProvider: null, kycReference: null },
  });

  console.log(`\nReset ${result.count} accounts to NONE.`);
})()
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
