import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Usernames that differ only by case.
 *
 * Two of these are one name as far as a transfer is concerned, because sending
 * compares case-insensitively. Resolution refuses on ambiguity now rather than
 * guessing, so nobody can be paid the wrong person - but until each pair has
 * one side renamed, anyone typing a spelling that matches neither exactly gets
 * turned away, and a lower(username) unique index cannot be created.
 *
 * Read-only. It counts and prints; it changes nothing.
 *
 *   npx tsx src/scripts/username-collisions.ts
 */
async function main() {
  const rows = await prisma.$queryRaw<
    { lowered: string; ids: string[]; names: string[]; emails: string[] }[]
  >`
    SELECT lower(username)          AS lowered,
           array_agg(id ORDER BY created_at)        AS ids,
           array_agg(username ORDER BY created_at)  AS names,
           array_agg(email ORDER BY created_at)     AS emails
      FROM users
     WHERE username IS NOT NULL
     GROUP BY lower(username)
    HAVING count(*) > 1
     ORDER BY lower(username)
  `;

  if (!rows.length) {
    console.log("\nNo collisions. Every username is unique ignoring case.\n");
    return;
  }

  console.log(`\n${rows.length} name${rows.length === 1 ? "" : "s"} held by more than one account\n`);

  for (const r of rows) {
    console.log(`  ${r.lowered}`);
    for (let i = 0; i < r.names.length; i++) {
      // Oldest first, so the one to keep is usually the top line.
      const claims = await prisma.voucherClaim.count({ where: { userId: r.ids[i] } });
      const txs = await prisma.transaction.count({ where: { userId: r.ids[i] } });
      console.log(
        `    @${(r.names[i] ?? "").padEnd(20)} ${(r.emails[i] ?? "").padEnd(34)} ` +
          `${txs} transaction${txs === 1 ? "" : "s"}, ${claims} claim${claims === 1 ? "" : "s"}`,
      );
    }
    console.log("");
  }

  console.log(
    "The account with history is the one to keep. Renaming the other frees the name,\n" +
      "and a lower(username) unique index can go on once every pair is settled.\n",
  );
}

main()
  .catch((e) => {
    console.error("FAILED:", e?.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // gas-sponsor keeps a timer alive at import, so this would otherwise hang.
    process.exit(process.exitCode ?? 0);
  });
