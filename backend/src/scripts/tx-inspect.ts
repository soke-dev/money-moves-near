import "dotenv/config";
import { prisma } from "../lib/prisma";

/**
 * Why a person's transactions failed. Read-only.
 *
 * Prints the rows with the parts of metadata that say what went wrong -
 * failReason, payoutStatus, the chain error, the provider's own message - so a
 * failure can be read rather than guessed at.
 *
 *   npx tsx src/scripts/tx-inspect.ts <username> [type] [limit]
 *   npx tsx src/scripts/tx-inspect.ts Dee SELL 8
 */

const INTERESTING = [
  "failReason",
  "error",
  "clientError",
  "payoutStatus",
  "payoutProvider",
  "payoutError",
  "chainError",
  "bankName",
  "accountNumber",
  "accountName",
  "bankCode",
  "ngnNet",
  "ngnGross",
  "ngnRate",
  "txHash",
  "flwTransferId",
  "payoutReference",
  "toAddress",
  "sessionId",
];

async function main() {
  const who = process.argv[2];
  const type = process.argv[3];
  const limit = Number(process.argv[4] || 10);

  if (!who) {
    console.log("Usage: tx-inspect.ts <username> [TYPE] [limit]");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true, email: true, kycStatus: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  console.log(`@${user.username}  ${user.email}  (kyc ${user.kycStatus})\n`);

  const rows = await prisma.transaction.findMany({
    where: { userId: user.id, ...(type ? { type: type as any } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  for (const t of rows) {
    const m = (t.metadata ?? {}) as any;
    console.log("─".repeat(72));
    console.log(
      `${t.type}  ${t.status}  ${t.asset}${t.chain ? "/" + t.chain : ""}  ${t.amount}  ${t.createdAt.toISOString()}`
    );
    console.log(`  ref ${t.reference}`);
    for (const k of INTERESTING) {
      if (m[k] !== undefined && m[k] !== null && m[k] !== "") {
        const v = typeof m[k] === "object" ? JSON.stringify(m[k]) : String(m[k]);
        console.log(`  ${k.padEnd(18)} ${v.length > 300 ? v.slice(0, 300) + "…" : v}`);
      }
    }
    const rest = Object.keys(m).filter((k) => !INTERESTING.includes(k));
    if (rest.length) console.log(`  (other keys: ${rest.join(", ")})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
