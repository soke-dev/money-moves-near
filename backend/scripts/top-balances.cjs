/**
 * Who is holding the most, by the balances stored against each wallet.
 *
 * These are the figures the backend last recorded, not a fresh on-chain read,
 * so treat them as an indication rather than a settlement position - a wallet
 * whose owner has not opened the app in a while can be stale.
 *
 * Stablecoins are counted at a dollar and MOVE/SOL are priced from the live
 * rates endpoint, so the ranking is by USD value rather than by token count.
 *
 *   railway run --service backend node scripts/top-balances.cjs [rows]
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const ROWS = Number(process.argv[2]) || 25;

/** USDC and USDT are a dollar; the rest need a price. */
async function prices() {
  const fallback = { USDC: 1, USDCx: 1, USDT: 1, MOVE: 0, SOL: 0, ETH: 0 };
  try {
    const res = await fetch("https://backend-production-6f042.up.railway.app/api/rates");
    const r = await res.json();
    return {
      ...fallback,
      MOVE: r?.MOVE?.usd ?? 0,
      SOL: r?.SOL?.usd ?? 0,
    };
  } catch {
    return fallback;
  }
}

(async () => {
  const usd = await prices();

  const wallets = await prisma.wallet.findMany({
    where: { balance: { gt: 0 }, user: { deletedAt: null } },
    select: {
      asset: true,
      chain: true,
      balance: true,
      user: { select: { id: true, email: true, username: true, kycStatus: true } },
    },
  });

  const byUser = new Map();
  for (const w of wallets) {
    const key = w.user.id;
    const value = Number(w.balance) * (usd[w.asset] ?? 0);
    const row =
      byUser.get(key) ||
      { email: w.user.email, username: w.user.username, kyc: w.user.kycStatus, usd: 0, holdings: {} };
    row.usd += value;
    row.holdings[w.asset] = (row.holdings[w.asset] || 0) + Number(w.balance);
    byUser.set(key, row);
  }

  const ranked = [...byUser.values()].sort((a, b) => b.usd - a.usd).slice(0, ROWS);

  const money = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const holdings = (h) =>
    Object.entries(h)
      .filter(([, v]) => v > 0)
      .map(([a, v]) => `${Number(v.toFixed(a === "SOL" ? 4 : 2))} ${a}`)
      .join(", ");

  console.log(`Prices used: MOVE $${usd.MOVE}, SOL $${usd.SOL}, stables $1\n`);
  console.log(`Top ${ranked.length} by stored balance value:\n`);

  ranked.forEach((r, i) => {
    const who = r.username ? `@${r.username}` : r.email;
    console.log(
      `${String(i + 1).padStart(3)}. ${money(r.usd).padStart(12)}  ${who.padEnd(24)} ${r.kyc.padEnd(9)} ${holdings(r.holdings)}`,
    );
  });

  const total = [...byUser.values()].reduce((s, r) => s + r.usd, 0);
  console.log(`\nHolders with a non-zero balance: ${byUser.size}`);
  console.log(`Total across all of them: ${money(total)}`);
})()
  .catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
