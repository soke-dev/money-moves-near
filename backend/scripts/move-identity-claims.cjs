/**
 * Moves an identity claim to the account that actually proved it.
 *
 * A claim is written by the uniqueness gate before Didit's verdict is known,
 * so a verification that goes on to be REJECTED still leaves the NIN staked to
 * that account. When the same person later verifies properly on another
 * account, the gate sees the number held elsewhere and the recorder skips it -
 * and the second account ends up VERIFIED with no national_number claim.
 *
 * Nothing visible breaks until they try to fund. The virtual account a naira
 * deposit pays into cannot be issued without an 11-digit NIN, and that NIN is
 * read from these claims, so the person is told the ID they verified with
 * carries no National Identity Number - about an ID that plainly does.
 *
 * ── What this will and will not move ────────────────────────────────────────
 *
 * Only a claim the destination has PROVEN: its identifier has to appear on a
 * VERIFIED KycVerification row belonging to the destination account. A claim
 * the destination merely attempted, or never presented at all, is left where
 * it is. That is the whole safety property - this cannot be used to hand one
 * person's identity to another, because the destination has to already hold a
 * passed verification carrying that same number.
 *
 * The source must also not be VERIFIED. A verified account has a legitimate
 * hold on its own identity and this refuses to touch it.
 *
 * Idempotent. Dry by default; pass --commit to write.
 *
 *   node scripts/move-identity-claims.cjs <from> <to> [--commit]
 *
 * <from> and <to> are a username or an email.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const COMMIT = process.argv.includes("--commit");
const [FROM, TO] = args;

if (!FROM || !TO) {
  console.error("Usage: node scripts/move-identity-claims.cjs <from> <to> [--commit]");
  process.exit(1);
}

const find = (handle) =>
  prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: handle, mode: "insensitive" } },
        { email: { equals: handle, mode: "insensitive" } },
      ],
    },
    select: { id: true, email: true, username: true, kycStatus: true },
  });

/** Every identifier the account has actually passed a verification with. */
async function provenNumbers(userId) {
  const rows = await prisma.kycVerification.findMany({
    where: { userId, status: "VERIFIED" },
    select: { documentNumber: true },
  });
  return new Set(rows.map((r) => (r.documentNumber || "").trim()).filter(Boolean));
}

(async () => {
  const from = await find(FROM);
  const to = await find(TO);

  if (!from) { console.error(`No account for "${FROM}".`); process.exit(1); }
  if (!to) { console.error(`No account for "${TO}".`); process.exit(1); }
  if (from.id === to.id) { console.error("Source and destination are the same account."); process.exit(1); }

  console.log(`from  @${from.username}  ${from.email}  kyc=${from.kycStatus}`);
  console.log(`to    @${to.username}  ${to.email}  kyc=${to.kycStatus}\n`);

  if (from.kycStatus === "VERIFIED") {
    console.error("Refusing: the source account is VERIFIED and has a legitimate hold on its identity.");
    process.exit(1);
  }
  if (to.kycStatus !== "VERIFIED") {
    console.error("Refusing: the destination account is not VERIFIED, so it has proven nothing to move.");
    process.exit(1);
  }

  const claims = await prisma.identityClaim.findMany({
    where: { userId: from.id },
    select: { id: true, key: true, kind: true },
  });
  if (claims.length === 0) {
    console.log("The source account holds no identity claims. Nothing to do.");
    return;
  }

  const proven = await provenNumbers(to.id);
  console.log(`${to.username} has passed verification with: ${[...proven].join(", ") || "(nothing)"}\n`);

  const movable = [];
  for (const c of claims) {
    // The key is "<prefix>:<identifier>" - the identifier is the last segment.
    const identifier = c.key.split(":").pop();
    if (proven.has(identifier)) {
      movable.push(c);
      console.log(`  MOVE  ${c.key}  (${c.kind}) - proven by @${to.username}`);
    } else {
      console.log(`  keep  ${c.key}  (${c.kind}) - not on any verified row for @${to.username}`);
    }
  }

  if (movable.length === 0) {
    console.log("\nNothing qualifies. No claim on the source account was proven by the destination.");
    return;
  }

  if (!COMMIT) {
    console.log(`\nDry run. ${movable.length} claim(s) would move. Re-run with --commit to write.`);
    return;
  }

  for (const c of movable) {
    await prisma.identityClaim.update({ where: { id: c.id }, data: { userId: to.id } });
    console.log(`  moved ${c.key} -> @${to.username}`);
  }

  const after = await prisma.identityClaim.findMany({
    where: { userId: to.id },
    select: { kind: true, key: true },
  });
  console.log(`\n@${to.username} now holds:`);
  for (const c of after) console.log(`  ${c.kind} = ${c.key}`);
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
