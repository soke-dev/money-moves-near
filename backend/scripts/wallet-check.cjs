/**
 * What addresses we hold for one account, per asset and chain.
 *
 *   railway run --service backend node scripts/wallet-check.cjs <userId|email>
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const KEY = process.argv[2];

(async () => {
  const user = await prisma.user.findFirst({
    where: KEY.includes("@") ? { email: { equals: KEY, mode: "insensitive" } } : { id: KEY },
    select: { id: true, email: true, username: true, createdAt: true },
  }).catch(() => null);
  if (!user) return console.log("no such user");

  console.log(`${user.email} @${user.username}  id=${user.id}`);
  console.log(`joined ${user.createdAt.toISOString().slice(0, 10)}`);
  

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id },
    select: { asset: true, chain: true, address: true, balance: true, updatedAt: true },
    orderBy: [{ chain: "asc" }, { asset: "asc" }],
  });

  console.log("\nchain    asset   balance      address                                     updated");
  for (const w of wallets) {
    console.log(
      `${String(w.chain).padEnd(8)} ${String(w.asset).padEnd(6)} ${String(w.balance).padEnd(12)} ${String(w.address || "-").padEnd(44)} ${w.updatedAt.toISOString().slice(0, 16)}`,
    );
  }

  // Addresses that differ within the same chain are the thing that breaks a sell.
  const byChain = {};
  for (const w of wallets) if (w.address) (byChain[w.chain] ||= new Set()).add(w.address.toLowerCase());
  const split = Object.entries(byChain).filter(([, set]) => set.size > 1);
  console.log(split.length ? `\nchains holding more than one address: ${split.map(([c]) => c).join(", ")}` : "\none address per chain");
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
