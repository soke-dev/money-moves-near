/**
 * Writes down Movement deposits that arrived and were never recorded.
 *
 * A deposit used to be noticed only as a gap between the database and the
 * chain, and only when nothing else had touched that asset in ten minutes. A
 * second deposit landing inside the window its predecessor opened was
 * discarded - and once the balance had synced there was no gap left, so it
 * could never be noticed again. The money is in the balance; the history is
 * simply missing a line.
 *
 * Deposits are recorded from the transfer itself now, so this is a one-off for
 * what the old rule dropped. It only ever inserts. Nothing existing is touched,
 * because a historical money record is not something to rewrite on a guess.
 *
 * A chain deposit counts as already recorded if some transaction carries its
 * hash, or - for rows written before hashes were kept - if a DEPOSIT of the
 * same asset and amount sits within ten minutes of it.
 *
 * Dry by default. Pass --commit to write.
 */
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

const COMMIT = process.argv.includes("--commit");
const ONLY = process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]);

const INDEXER =
  process.env.MOVEMENT_INDEXER_URL || "https://indexer.mainnet.movementnetwork.xyz/v1/graphql";
const RPC = process.env.MOVEMENT_RPC_URL || "https://mainnet.movementnetwork.xyz/v1";

const META = {
  USDC: "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39",
  USDT: "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d",
  USDCx: "0xba11833544a2f99eec743f41a228ca6ffa7f13c3b6b04681d5a79a8b75ff225e",
};

async function chainDeposits(address, asset) {
  const query = `query A($a: String!, $t: String!) {
    fungible_asset_activities(
      where: {
        owner_address: {_eq: $a},
        asset_type: {_eq: $t},
        type: {_eq: "0x1::fungible_asset::Deposit"}
      }
      order_by: { transaction_version: desc }
      limit: 25
    ) { transaction_version transaction_timestamp amount }
  }`;
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { a: address, t: META[asset] } }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await res.json();
  return (body?.data?.fungible_asset_activities ?? []).map((a) => ({
    version: String(a.transaction_version),
    at: new Date(a.transaction_timestamp + "Z"),
    amount: Number(a.amount) / 1e6,
  }));
}

async function txDetail(version) {
  try {
    const res = await fetch(`${RPC.replace(/\/$/, "")}/transactions/by_version/${version}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return {};
    const tx = await res.json();
    return { hash: tx?.hash ?? null, sender: tx?.sender ?? null };
  } catch {
    return {};
  }
}

(async () => {
  const users = await prisma.user.findMany({
    where: ONLY ? { username: ONLY } : { wallets: { some: { chain: "MOVE", address: { not: null } } } },
    select: { id: true, username: true },
  });

  const missing = [];

  for (const u of users) {
    const w = await prisma.wallet.findFirst({
      where: { userId: u.id, chain: "MOVE", address: { not: null } },
      select: { address: true },
    });
    if (!w?.address) continue;

    const existing = await prisma.transaction.findMany({
      where: { userId: u.id, chain: "MOVE" },
      select: { type: true, asset: true, amount: true, createdAt: true, metadata: true },
    });
    const seenHashes = new Set(
      existing.map((t) => (t.metadata || {}).txHash).filter(Boolean).map(String),
    );

    for (const asset of Object.keys(META)) {
      let deposits = [];
      try {
        deposits = await chainDeposits(w.address, asset);
      } catch {
        continue;
      }

      for (const d of deposits) {
        const { hash, sender } = await txDetail(d.version);
        if (hash && seenHashes.has(hash)) continue;

        const near = existing.some(
          (t) =>
            t.type === "DEPOSIT" &&
            t.asset === asset &&
            Math.abs(Number(t.amount) - d.amount) < 1e-6 &&
            Math.abs(t.createdAt.getTime() - d.at.getTime()) < 10 * 60 * 1000,
        );
        if (near) continue;

        missing.push({ user: u, asset, ...d, hash, sender });
      }
    }
  }

  if (!missing.length) {
    console.log("Every Movement deposit is already in the history.");
    return;
  }

  console.log(`Deposits on chain with no record: ${missing.length}\n`);
  for (const m of missing) {
    console.log(
      `  @${m.user.username}  ${m.at.toISOString()}  +${m.amount} ${m.asset}  ` +
        `${m.hash ? m.hash.slice(0, 16) + "…" : "(no hash)"}`,
    );
  }

  if (!COMMIT) {
    console.log("\nDry run. Re-run with --commit to write.");
    return;
  }

  for (const m of missing) {
    await prisma.transaction.create({
      data: {
        userId: m.user.id,
        type: "DEPOSIT",
        asset: m.asset,
        chain: "MOVE",
        amount: m.amount,
        fee: 0,
        status: "COMPLETED",
        reference: `EXTDEP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`,
        createdAt: m.at,
        metadata: {
          source: "external_deposit",
          amountFrom: "chain",
          backfilled: true,
          ...(m.hash ? { txHash: m.hash } : {}),
          ...(m.sender ? { fromAddress: m.sender } : {}),
          chainVersion: m.version,
          chainTime: m.at.toISOString(),
        },
      },
    });
    console.log(`  wrote @${m.user.username} +${m.amount} ${m.asset}`);
  }
})()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
