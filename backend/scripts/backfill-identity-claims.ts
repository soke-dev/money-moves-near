/**
 * backfill-identity-claims.ts
 *
 * Users verified before duplicate-blocking existed hold no IdentityClaim, which
 * means their ID is still unclaimed — a second account could present the same
 * document and pass. This walks every VERIFIED Didit check and claims the
 * identifiers out of its stored decision payload, closing that window.
 *
 * Safe to re-run: a key already held by the same user is skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-identity-claims.ts          # report only
 *   npx tsx scripts/backfill-identity-claims.ts --apply  # write claims
 */
import { prisma } from "../src/lib/prisma";
import { buildIdentityKeys } from "../src/lib/didit";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await prisma.kycVerification.findMany({
    where: { provider: "didit", status: "VERIFIED" },
    orderBy: { createdAt: "asc" },
    select: { userId: true, metamapRef: true, rawResponse: true },
  });

  console.log(`${rows.length} verified Didit check(s) to inspect\n`);

  let claimed = 0;
  let skipped = 0;
  const conflicts: string[] = [];

  for (const row of rows) {
    const keys = buildIdentityKeys(row.rawResponse as any);
    if (keys.length === 0) {
      console.log(`user ${row.userId}: no legible identifiers — skipped`);
      skipped++;
      continue;
    }

    for (const k of keys) {
      const existing = await prisma.identityClaim.findUnique({
        where: { key: k.key },
        select: { userId: true },
      });

      if (existing) {
        if (existing.userId === row.userId) {
          console.log(`user ${row.userId}: ${k.key} already claimed`);
        } else {
          // Two accounts already verified on one identity — this predates the
          // constraint, so it needs a human decision about which one keeps it.
          const msg = `CONFLICT ${k.key}: held by ${existing.userId}, also proven by ${row.userId}`;
          console.warn(msg);
          conflicts.push(msg);
        }
        continue;
      }

      if (APPLY) {
        await prisma.identityClaim.create({
          data: { userId: row.userId, key: k.key, kind: k.kind, sessionId: row.metamapRef },
        });
      }
      console.log(`${APPLY ? "claimed" : "would claim"} ${k.key} -> ${row.userId}`);
      claimed++;
    }
  }

  console.log(
    `\n${APPLY ? "claimed" : "would claim"}: ${claimed} | skipped: ${skipped} | conflicts: ${conflicts.length}`
  );
  if (conflicts.length > 0) {
    console.log("\nPre-existing duplicates need a manual call on which account keeps the identity:");
    for (const c of conflicts) console.log("  " + c);
  }
  if (!APPLY) console.log("\nDry run — re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
