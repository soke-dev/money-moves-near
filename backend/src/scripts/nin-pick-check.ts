import { prisma } from "../lib/prisma";

/**
 * Which NIN funding would send to the bank, for every account that has one.
 * Read-only — it decides nothing and writes nothing.
 *
 * Mirrors the selection in routes/funding.ts exactly, so a change there can be
 * checked against real accounts before it reaches anybody.
 *
 *   npx tsx src/scripts/nin-pick-check.ts            # only accounts with a problem
 *   npx tsx src/scripts/nin-pick-check.ts --all      # every account with a claim
 */

const usableNin = (v: string) => /^[1-9]\d{10}$/.test(v);

async function main() {
  const showAll = process.argv.includes("--all");

  const claims = await prisma.identityClaim.findMany({
    where: { kind: "national_number" },
    select: { userId: true, key: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const byUser = new Map<string, string[]>();
  for (const c of claims) {
    const list = byUser.get(c.userId) ?? [];
    list.push(c.key.replace(/^nin:/, ""));
    byUser.set(c.userId, list);
  }

  let broken = 0;
  let rescued = 0;

  for (const [userId, all] of byUser) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, email: true, kycStatus: true },
    });
    const verified = await prisma.kycVerification.findFirst({
      where: { userId, status: "VERIFIED" },
      orderBy: { createdAt: "desc" },
      select: { documentNumber: true },
    });
    const onDocument = (verified?.documentNumber ?? "").replace(/\D/g, "");

    const candidates = all.filter(usableNin);
    const chosen = candidates.find((c) => c === onDocument) ?? candidates[0] ?? null;

    // What the old code could have picked: any claim, 11 chars, leading zero ok.
    const oldCould = all.filter((v) => /^\d{11}$/.test(v));
    const oldCouldFail = oldCould.some((v) => !usableNin(v));

    const interesting = !chosen || oldCouldFail || all.length > 1;
    if (!interesting && !showAll) continue;

    if (!chosen) broken++;
    else if (oldCouldFail) rescued++;

    console.log(`@${user?.username ?? "?"}  ${user?.email ?? ""}  (${user?.kycStatus})`);
    console.log(`   claims    ${all.join(", ")}`);
    console.log(`   onDoc     ${onDocument || "—"}`);
    console.log(
      `   chosen    ${chosen ?? "NONE — cannot fund"}` +
        (oldCouldFail ? "   (old code could have sent a leading-zero value)" : "")
    );
    console.log("");
  }

  console.log(`accounts with a national_number claim: ${byUser.size}`);
  console.log(`  still cannot fund (no usable NIN):   ${broken}`);
  console.log(`  at risk before this change:          ${rescued}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
