import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getAccountByExternalId, listDepositAddresses, listDeposits } from "../lib/stableyard";

/**
 * Watch a test deposit arrive. Read-only.
 *
 * Prints the addresses we issued and every deposit Stableyard has recorded
 * against them, with its state. The one that matters is settled - that is the
 * point at which USDCx has reached the person's Movement wallet and we would
 * credit our own ledger.
 *
 *   npx tsx src/scripts/stableyard-deposits.ts <username>
 *   npx tsx src/scripts/stableyard-deposits.ts <username> --watch
 */

async function show(userId: string) {
  const acct = await getAccountByExternalId(userId);
  // Wrapped as { account, ... }, same as create.
  const accountId = acct.data?.account?.id ?? acct.data?.id;
  if (!accountId) {
    console.log(`No UPA for ${userId}. Run stableyard-setup-user.ts first.`);
    return false;
  }

  const addrs = await listDepositAddresses(accountId);
  const rows: any[] = addrs.data?.depositAddresses ?? addrs.data ?? [];
  console.log(`account ${accountId}`);
  for (const a of Array.isArray(rows) ? rows : []) {
    console.log(`  chain ${String(a.chainId).padEnd(12)} ${a.address}   ${a.status ?? ""}`);
  }

  const deps = await listDeposits(accountId);
  const list: any[] = deps.data?.deposits ?? deps.data ?? [];
  console.log(`\ndeposits (${Array.isArray(list) ? list.length : 0}):`);

  /**
   * Atomic units, always. Their decimals differ per asset and per side - BTC
   * is 8 and Movement USDC is 6 on the same deposit - so nothing here assumes
   * a shared scale.
   */
  const human = (atomic: unknown, decimals: unknown) => {
    const n = Number(atomic);
    const d = Number(decimals);
    if (!Number.isFinite(n) || !Number.isFinite(d)) return "?";
    return (n / 10 ** d).toFixed(Math.min(d, 8)).replace(/0+$/, "").replace(/\.$/, "");
  };

  for (const d of Array.isArray(list) ? list : []) {
    const src = d.amount ?? {};
    const srcSym = src.asset?.symbol ?? "?";
    const sent = human(src.amount, src.asset?.decimals);

    const snap = d.settlementProfileSnapshot ?? {};
    const settle = d.settlement ?? {};
    const got = d.netSettlementAmount
      ? human(d.netSettlementAmount, snap.assetDecimals)
      : null;

    console.log(
      `  ${String(d.status).padEnd(12)} ${sent} ${srcSym}  ->  ` +
        `${got ?? "pending"} ${snap.assetSymbol ?? ""}  (settlement ${settle.status ?? "?"})`
    );
    console.log(`     id      ${d.id}`);
    if (d.txHash) console.log(`     source  ${d.txHash}`);
    if (settle.txHash) console.log(`     settled ${settle.txHash}`);
    if (snap.destinationAddress) console.log(`     into    ${snap.destinationAddress}`);

    const f = d.fees ?? {};
    const fd = f.denomination?.decimals;
    if (f.networkAmountAtomic || f.platformAmountAtomic) {
      console.log(
        `     fees    network ${human(f.networkAmountAtomic, fd)} ` +
          `platform ${human(f.platformAmountAtomic, fd)} ${f.denomination?.symbol ?? ""}`
      );
    }
    if (d.failureReason) console.log(`     reason  ${d.failureReason}`);
  }
  return true;
}

async function main() {
  const who = process.argv[2];
  if (!who) {
    console.log("Usage: stableyard-deposits.ts <username> [--watch]");
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

  if (!process.argv.includes("--watch")) {
    await show(user.id);
    return;
  }

  // A BTC deposit is minutes, not seconds - finality is the slow part.
  for (let i = 0; i < 40; i++) {
    console.log(`\n── ${new Date().toISOString()} ──`);
    await show(user.id);
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
