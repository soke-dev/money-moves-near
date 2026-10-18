import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  SY_CHAIN,
  SY_DEPOSIT_CHAINS,
  isStableyardConfigured,
  createAccount,
  linkMovementWallet,
  listSettlementDestinations,
  setSettlementProfile,
  createDepositAddresses,
  listDepositAddresses,
} from "../lib/stableyard";

/**
 * Set one person up for routed deposits, end to end. Writes only with --yes.
 *
 * There is no Stableyard staging for this credential, so the first real test
 * is a real account. This does it for one named person - ours - so that a
 * deposit can be sent and watched before anybody else is enrolled.
 *
 * Every create carries an idempotency key derived from our own ids, so running
 * it twice returns the same UPA and the same addresses rather than a second
 * set. That matters more than usual here: a duplicate deposit address is money
 * pointed somewhere nobody is watching.
 *
 *   npx tsx src/scripts/stableyard-setup-user.ts <username>
 *   npx tsx src/scripts/stableyard-setup-user.ts <username> --yes
 */

// Every chain in the catalogue, visible in the app or not. An address issued
// early costs nothing; one issued late means telling somebody to wait.
const CHAINS = SY_DEPOSIT_CHAINS;

async function main() {
  const who = process.argv[2];
  const commit = process.argv.includes("--yes");

  if (!who) {
    console.log("Usage: stableyard-setup-user.ts <username> [--yes]");
    return;
  }
  if (!isStableyardConfigured()) {
    console.log("STABLEYARD_APP_ID / STABLEYARD_APP_SECRET are not set in backend/.env.");
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

  // Where everything will land. Without it there is nothing to settle to.
  const moveWallet = await prisma.wallet.findFirst({
    where: { userId: user.id, chain: "MOVE", address: { not: null } },
    select: { address: true },
  });
  if (!moveWallet?.address) {
    console.log("That account has no Movement wallet address.");
    return;
  }

  console.log(`@${user.username}  ${user.email}`);
  console.log(`  our user id      ${user.id}`);
  console.log(`  movement wallet  ${moveWallet.address}`);
  console.log(`  chains           ${CHAINS.join(", ")}  (Bitcoin, Tron)`);
  console.log(`  settles as       USDC on Movement (our USDCx)`);

  if (!commit) {
    console.log("\nWould create a UPA, link that wallet, set it as the settlement");
    console.log("destination, and issue Bitcoin + Tron deposit addresses.");
    console.log("\nNothing written. Pass --yes to do it.");
    return;
  }

  console.log("\n1. creating UPA…");
  const acct = await createAccount(user.id);
  const accountId = acct.data?.account?.id;
  if (!acct.ok || !accountId) {
    console.log(`   failed: ${acct.error ?? JSON.stringify(acct.data)}`);
    return;
  }
  console.log(`   account ${accountId}`);

  /**
   * Link only if it is not already linked.
   *
   * There is no endpoint that lists an account's wallets - /wallets is
   * write-only and 404s on GET - so the settlement destinations are what say
   * whether this has been done. Checking first is what makes re-running this
   * safe, because the link call takes no idempotency key and would otherwise
   * add the same wallet twice.
   */
  const findMovement = async () => {
    const d = await listSettlementDestinations(accountId);
    const list: any[] = d.data?.destinations ?? d.data ?? [];
    // chainId lives under capabilities.network, not on the destination itself.
    return Array.isArray(list)
      ? list.find(
          (x: any) => Number(x.capabilities?.network?.chainId) === SY_CHAIN.MOVEMENT,
        ) ?? null
      : null;
  };

  console.log("2. linking Movement wallet…");
  let move = await findMovement();
  if (move) {
    console.log("   already linked");
  } else {
    const linked = await linkMovementWallet(accountId, moveWallet.address);
    if (!linked.ok) {
      console.log(`   failed: ${linked.error}`);
      return;
    }
    move = await findMovement();
    console.log("   linked");
  }

  console.log("3. reading settlement destinations…");
  if (!move?.id) {
    console.log(`   could not find a Movement destination.`);
    return;
  }
  console.log(`   destination ${move.id}`);

  const profile = await setSettlementProfile(accountId, move.id);
  if (!profile.ok) {
    console.log(`   failed to set profile: ${profile.error}`);
    return;
  }
  console.log("   settlement profile set to Movement USDC");

  console.log("4. creating deposit addresses…");
  const created = await createDepositAddresses(accountId, CHAINS);
  if (!created.ok) {
    console.log(`   failed: ${created.error}`);
    return;
  }

  const addrs = await listDepositAddresses(accountId);
  const rows: any[] = addrs.data?.depositAddresses ?? addrs.data ?? [];
  console.log("\n── deposit addresses ──");
  for (const a of Array.isArray(rows) ? rows : []) {
    console.log(`  chain ${a.chainId}  ${a.address}`);
    for (const s of a.supportedAssets ?? []) {
      console.log(`     ${s.symbol}  min ${s.minimumDeposit?.amount ?? "?"}`);
    }
  }

  console.log(`\nDone. Send a test deposit and watch it with:`);
  console.log(`  npx tsx src/scripts/stableyard-deposits.ts ${who}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
