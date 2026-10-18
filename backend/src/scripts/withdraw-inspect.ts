import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getOnChainBalance } from "../lib/balances";

/**
 * Why a withdrawal failed, when nothing was written down. Read-only.
 *
 * A SELL that never gets signed records a clientError, because sell/abandon
 * exists to report one. WITHDRAW has no equivalent - it is prepared, and if the
 * phone never comes back the row is flipped to FAILED by the ten-minute sweeper
 * with no reason attached. So this reconstructs what can still be known: the
 * full metadata, the balance the wallet actually held, and whether anything
 * reached the chain.
 *
 *   npx tsx src/scripts/withdraw-inspect.ts <username> [limit]
 */

async function main() {
  const who = process.argv[2];
  const limit = Number(process.argv[3] || 6);
  if (!who) {
    console.log("Usage: withdraw-inspect.ts <username> [limit]");
    return;
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  const rows = await prisma.transaction.findMany({
    where: { userId: user.id, type: "WITHDRAW" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  for (const t of rows) {
    const m = (t.metadata ?? {}) as any;
    console.log("─".repeat(70));
    console.log(
      `${t.status.padEnd(10)} ${t.asset}/${t.chain}  ${t.amount}  ${t.createdAt.toISOString()}`
    );
    console.log(`  updated ${t.updatedAt.toISOString()}`);
    console.log(`  ${JSON.stringify(m)}`);
  }

  // What the wallet holds now, on chain and in our records.
  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id, asset: "USDT" },
    select: { chain: true, balance: true, address: true },
  });
  console.log("\n── USDT wallets ──");
  for (const w of wallets) {
    let live: number | string = "?";
    try {
      live = w.address ? await getOnChainBalance("USDT", w.chain as string, w.address) : "no address";
    } catch (e: any) {
      live = `read failed: ${e?.message}`;
    }
    console.log(`  ${String(w.chain).padEnd(8)} db ${w.balance.toString().padEnd(14)} chain ${live}`);
    if (w.address) console.log(`           ${w.address}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
