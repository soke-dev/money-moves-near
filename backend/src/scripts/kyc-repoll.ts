/**
 * Asks Didit for a session again, and shows what has changed since we last
 * looked.
 *
 * A decision is fetched once, when the session lands, and never again unless
 * the app happens to poll. Anything typed into Didit's console afterwards -
 * correcting a name the OCR misread, filling in what it could not read at all -
 * is invisible to us until somebody asks a second time. This is that asking.
 *
 * Dry by default: prints the difference. Pass --commit to write the fresh
 * values onto the KycVerification row and, for a verified account, onto the
 * profile name.
 *
 *   npx tsx src/scripts/kyc-repoll.ts <email|username|all>
 *   npx tsx src/scripts/kyc-repoll.ts matilda --commit
 */
import { prisma } from "../lib/prisma";
import { getDiditDecision, extractDiditDetails, effectiveDiditStatus } from "../lib/didit";
import { recheckDiditSubmission } from "../routes/kyc";

const who = process.argv[2];
const COMMIT = process.argv.includes("--commit");

if (!who || who.startsWith("--")) {
  console.error("Usage: npx tsx src/scripts/kyc-repoll.ts <email|username|all> [--commit]");
  process.exit(1);
}

(async () => {
  const users = await prisma.user.findMany({
    where:
      who === "all"
        ? { kycVerifications: { some: { provider: "didit", metamapRef: { not: null } } } }
        : {
            OR: [
              { email: { equals: who, mode: "insensitive" } },
              { username: { equals: who, mode: "insensitive" } },
            ],
          },
    select: { id: true, email: true, username: true, firstName: true, lastName: true, kycStatus: true },
  });

  if (!users.length) {
    console.log(`No account for "${who}".`);
    return;
  }

  for (const u of users) {
    const row = await prisma.kycVerification.findFirst({
      where: { userId: u.id, provider: "didit", metamapRef: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, metamapRef: true, status: true, firstName: true, lastName: true, documentNumber: true, dateOfBirth: true },
    });

    console.log(`\n${u.email} (@${u.username}) — account ${u.kycStatus}`);
    if (!row?.metamapRef) {
      console.log("  no Didit session attached (revoked by hand, or never started)");
      continue;
    }

    const decision = await getDiditDecision(row.metamapRef);
    const fresh = extractDiditDetails(decision);
    const status = effectiveDiditStatus(decision);

    const line = (k: string, was: any, now: any) => {
      const same = (was ?? null) === (now ?? null);
      console.log(`  ${k.padEnd(15)} ${String(was ?? "—").padEnd(24)} ${same ? "=" : "->"}  ${now ?? "—"}`);
    };
    console.log(`  didit says: ${status}`);
    line("firstName", row.firstName, fresh.firstName);
    line("lastName", row.lastName, fresh.lastName);
    line("documentNumber", row.documentNumber, fresh.documentNumber);
    line("dateOfBirth", row.dateOfBirth, fresh.dateOfBirth);

    if (!COMMIT) continue;

    /**
     * Through the same call the console button and the webhook use, rather
     * than writing the row here.
     *
     * Applying a decision is more than copying four fields onto it: it sets the
     * account's status, adopts the document's name, and records the identity
     * claims - and the NIN a naira deposit needs is read from those claims, not
     * from the row. A script that wrote the row itself looked like it had
     * worked and left the account unable to fund.
     */
    const applied = await recheckDiditSubmission(row.id);
    if (!applied.ok) {
      console.log(`  ${applied.error}`);
      continue;
    }

    const claims = await prisma.identityClaim.findMany({
      where: { userId: u.id },
      select: { kind: true, key: true },
    });
    console.log(`  applied. account is ${applied.status}`);
    for (const c of claims) console.log(`    claim ${c.kind} = ${c.key}`);
  }

  if (!COMMIT) console.log("\nDry run. Re-run with --commit to write.");
})()
  .catch((e) => { console.error(e?.message || e); process.exit(1); })
  .finally(() => prisma.$disconnect());
