import "dotenv/config";
import { prisma } from "../lib/prisma";
import { isStableyardConfigured } from "../lib/stableyard";
import { routedAssetStates, setRoutedAssetState } from "../lib/stableyard-visibility";
import { ensureRoutedAddresses, routedActivity } from "../lib/stableyard-account";

/**
 * Does the routed-deposit plumbing actually work? Read-only except for the
 * visibility round-trip, which puts back whatever it found.
 *
 * Exercises the same functions the routes call, so a break shows up here
 * rather than as an empty section on somebody's phone.
 *
 *   npx tsx src/scripts/stableyard-selftest.ts <username>
 */

async function main() {
  const who = process.argv[2] || "soke";
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: who.replace(/^@/, "") }, { email: who }] },
    select: { id: true, username: true },
  });
  if (!user) {
    console.log("No such user.");
    return;
  }

  const ok = (label: string, good: boolean, detail = "") =>
    console.log(`  ${good ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${detail}`);

  console.log(`@${user.username}\n`);

  ok("credentials configured", isStableyardConfigured());

  // ── visibility ──
  const states = await routedAssetStates();
  const visible = states.filter((a) => a.visible);
  ok("catalogue readable", states.length > 0, `${states.length} assets, ${visible.length} visible`);
  console.log(
    `        visible: ${visible.map((a) => `${a.symbol}/${a.chainId}`).join(", ") || "none"}`
  );

  // A real write and put it back, so the console's toggle is proven.
  const probe = states[0];
  const before = probe.overridden ? probe.state : null;
  await setRoutedAssetState(
    probe.chainId,
    probe.symbol,
    probe.state === "visible" ? "hidden" : "visible",
    "selftest",
  );
  const flipped = (await routedAssetStates()).find(
    (a) => a.chainId === probe.chainId && a.symbol === probe.symbol
  );
  ok(
    "state toggle works",
    flipped?.state === (probe.state === "visible" ? "hidden" : "visible"),
    `${probe.symbol}/${probe.chainId}`,
  );
  if (before === null) {
    await prisma.serviceStatus.delete({ where: { key: `sy:${probe.chainId}:${probe.symbol}` } });
  } else {
    await setRoutedAssetState(probe.chainId, probe.symbol, before, "selftest");
  }
  const restored = (await routedAssetStates()).find(
    (a) => a.chainId === probe.chainId && a.symbol === probe.symbol
  );
  ok("toggle restored", restored?.visible === probe.visible);

  // ── addresses ──
  const chainIds = [...new Set(visible.map((a) => a.chainId))];
  const t0 = Date.now();
  const addrs = await ensureRoutedAddresses(user.id, chainIds);
  ok(
    "addresses resolve",
    addrs.ok && addrs.addresses.length === chainIds.length,
    `${addrs.addresses.length}/${chainIds.length} in ${Date.now() - t0}ms${addrs.error ? " — " + addrs.error : ""}`
  );

  const t1 = Date.now();
  await ensureRoutedAddresses(user.id, chainIds);
  ok("second call cached", Date.now() - t1 < 200, `${Date.now() - t1}ms`);

  const everyMinimum = addrs.addresses.every((a) => a.assets.some((x) => x.minimum));
  ok("minimums present", everyMinimum, "read from the server, never hardcoded");

  for (const a of addrs.addresses) {
    console.log(`        ${String(a.chainId).padEnd(12)} ${a.address}`);
  }

  // ── activity ──
  const acts = await routedActivity(user.id);
  ok("activity readable", Array.isArray(acts), `${acts.length} deposit(s)`);
  for (const d of acts) {
    console.log(
      `        ${d.status.padEnd(12)} ${d.sentAmount} ${d.sentSymbol} -> ` +
        `${d.receivedAmount ?? "pending"} ${d.receivedSymbol ?? ""}`
    );
  }

  // ── what is NOT built ──
  console.log("\n  not built yet:");
  console.log("    - webhook receiver (deposit.settled etc)");
  console.log("    - ledger credit: a settled deposit creates no Transaction row");
  console.log("    - notification on arrival");
  console.log("    - reconciliation with our own external-deposit detector");
  console.log("    - admin console tab");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
