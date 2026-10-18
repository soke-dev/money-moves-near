import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getAccountByExternalId } from "../lib/stableyard";
import { enrolledAccounts } from "../lib/stableyard-account";

/**
 * Who we know has a Stableyard account.
 *
 * The provider has no endpoint that lists accounts, so we keep our own note
 * whenever one is found or made. Anybody enrolled before that note existed has
 * no marker, and the admin console cannot see them - this backfills those.
 *
 * The look-up is read-only: it asks whether an account exists and never makes
 * one. Writing the marker needs --yes.
 *
 *   npx tsx src/scripts/stableyard-enrolled.ts                 list markers
 *   npx tsx src/scripts/stableyard-enrolled.ts <user>          check one
 *   npx tsx src/scripts/stableyard-enrolled.ts <user> --yes    and remember it
 */

async function main() {
  const who = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
  const write = process.argv.includes("--yes");

  if (!who) {
    const rows = await enrolledAccounts();
    if (!rows.length) {
      console.log("No enrolment markers yet.");
      return;
    }
    const users = await prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, username: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    console.log(`${rows.length} enrolled:`);
    for (const r of rows) {
      const u = byId.get(r.userId);
      console.log(`  ${(u?.username ? "@" + u.username : u?.email ?? r.userId).padEnd(28)} ${r.accountId}`);
    }
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true, email: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  const r = await getAccountByExternalId(user.id).catch(() => null);
  const accountId = r?.data?.account?.id ?? null;
  if (!accountId) {
    console.log(`${who} has no Stableyard account. Nothing to remember.`);
    return;
  }

  console.log(`${who}  ->  ${accountId}`);
  if (!write) {
    console.log("Read-only. Pass --yes to write the marker.");
    return;
  }

  const key = `syacct:${user.id}`;
  await prisma.serviceStatus.upsert({
    where: { key },
    create: { key, value: accountId, updatedBy: "backfill" },
    update: { value: accountId, updatedBy: "backfill" },
  });
  console.log("Remembered.");
}

main()
  .catch((e) => console.error(e?.message ?? e))
  .finally(() => prisma.$disconnect());
