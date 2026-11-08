import { prisma } from "./prisma";
import { sendNotification } from "./push";
import { alertIfLargeDeposit, networkName } from "./deposit-alerts";
import {
  isAuroraConfigured,
  auroraTokens,
  createPersistentAddress,
  persistentDeposits,
  type PersistentChain,
  type PersistentDeposit,
} from "./aurora";
import { auroraSettings, type AuroraDepositKind, type DepositState } from "./aurora-settings";

/**
 * BTC and Tron USDT, arriving as USDC in the person's own Solana wallet.
 *
 * Each person gets one permanent address per chain. It never expires and
 * takes any number of deposits; whatever lands is converted and paid out to
 * their Solana address, which is fixed when the address is made. That makes
 * the recipient part of the address's identity: if a person's Solana wallet
 * ever changes, a new address is made for the new one, and the old address
 * keeps paying the old wallet - which is still theirs.
 *
 * The chain ids are the ones the routed-deposit screens already use for
 * Bitcoin and Tron, so the app draws these exactly as it drew Stableyard's.
 *
 * Addresses are written down (service_status `auaddr:` rows) so that the
 * sweeps below know whom to ask about without asking Aurora to list every
 * address, and so opening the deposit screen twice does not create twice.
 */

export type AuroraDepositAsset = { symbol: string; assetId: string; decimals: number };

/**
 * One network. Its address takes any coin Aurora lists on that chain, so the assets here are only the ones the app
 * offers (each shown or not by the Converted tab). symbol, assetId and decimals are its first, for the screens and
 * watchers that only ever deal in one (Bitcoin, Tron).
 */
export type AuroraDepositChain = {
  kind: AuroraDepositKind;
  chainId: number;
  symbol: string;
  depositChain: PersistentChain;
  assetId: string;
  decimals: number;
  assets: readonly AuroraDepositAsset[];
};

const chainOf = (kind: AuroraDepositKind, chainId: number, depositChain: PersistentChain, assets: AuroraDepositAsset[]): AuroraDepositChain => ({
  kind,
  chainId,
  depositChain,
  symbol: assets[0]!.symbol,
  assetId: assets[0]!.assetId,
  decimals: assets[0]!.decimals,
  assets,
});

export const AURORA_DEPOSIT_CHAINS: readonly AuroraDepositChain[] = [
  chainOf("btc", 10001, "btc", [{ symbol: "BTC", assetId: "nep141:btc.omft.near", decimals: 8 }]),
  chainOf("tron", 728126428, "tron", [{ symbol: "USDT", assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", decimals: 6 }]),
  // What Stableyard used to carry. Chain ids are the ones the routed-deposit screens already use.
  chainOf("eth", 1, "eth", [
    { symbol: "USDC", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6 },
    { symbol: "USDT", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", decimals: 6 },
    { symbol: "ETH", assetId: "nep141:eth.omft.near", decimals: 18 },
  ]),
  chainOf("bsc", 56, "bsc", [{ symbol: "BNB", assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", decimals: 18 }]),
  chainOf("sol", 10103, "sol", [{ symbol: "SOL", assetId: "nep141:sol.omft.near", decimals: 9 }]),
  chainOf("arb", 42161, "arb", [
    { symbol: "USDC", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6 },
    { symbol: "USDT", assetId: "nep141:arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", decimals: 6 },
    { symbol: "ETH", assetId: "nep141:arb.omft.near", decimals: 18 },
  ]),
  chainOf("pol", 137, "pol", [
    { symbol: "USDC", assetId: "nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L", decimals: 6 },
    { symbol: "USDT", assetId: "nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr", decimals: 6 },
    { symbol: "POL", assetId: "nep245:v2_1.omni.hot.tg:137_11111111111111111111", decimals: 18 },
  ]),
];

/** Bitcoin and Tron: Aurora only, never Stableyard, whatever the console says. */
export const AURORA_CHAIN_IDS = AURORA_DEPOSIT_CHAINS.filter((c) => c.kind === "btc" || c.kind === "tron").map((c) => c.chainId);

/** The coin a deposit came as, by Aurora's asset id or the symbol we wrote down, else the network's first. */
export function assetOf(chain: AuroraDepositChain, assetId?: string | null, symbol?: string | null): AuroraDepositAsset {
  return chain.assets.find((a) => (assetId && a.assetId === assetId) || (symbol && a.symbol === symbol)) ?? chain.assets[0]!;
}

/**
 * The chain ids whose deposits Aurora carries right now, or that are off: Stableyard offers none of them. Bitcoin
 * and Tron always; the others while their rail is Aurora or they're switched off.
 */
export async function chainsNotOnStableyard(): Promise<number[]> {
  const settings = await auroraSettings();
  return AURORA_DEPOSIT_CHAINS.filter((c) => AURORA_CHAIN_IDS.includes(c.chainId) || settings.deposits[c.kind].rail === "aurora" || settings.deposits[c.kind].state === "hidden").map((c) => c.chainId);
}

/** USDC on Solana, what every deposit here becomes. Six decimals. */
const SOL_USDC_ASSET = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const SOL_USDC_DECIMALS = 6;

const ADDR_KEY = (kind: AuroraDepositKind, userId: string) => `auaddr:${kind}:${userId}`;

type StoredAddress = { address: string; recipient: string };

async function readStored(kind: AuroraDepositKind, userId: string): Promise<StoredAddress | null> {
  const row = await prisma.serviceStatus.findUnique({ where: { key: ADDR_KEY(kind, userId) }, select: { value: true } });
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value);
    return v?.address && v?.recipient ? v : null;
  } catch {
    return null;
  }
}

async function solanaAddressOf(userId: string): Promise<string | null> {
  // The stored wallet row, never anything the app sends: these addresses were
  // proven against the person's key when they were registered.
  const w = await prisma.wallet.findFirst({
    where: { userId, chain: "SOL", address: { not: null } },
    select: { address: true },
  });
  return w?.address ?? null;
}

export type AuroraAddressResult =
  | { ok: true; address: string }
  | { ok: false; reason: "no_wallet" | "not_approved" | "unavailable"; error: string };

/**
 * This person's address on one chain, made the first time it is asked for.
 *
 * Aurora returns the same address for the same inputs, so even a lost note
 * here cannot produce a second address for the same person and recipient.
 */
export async function ensureAuroraAddress(userId: string, chain: AuroraDepositChain): Promise<AuroraAddressResult> {
  const recipient = await solanaAddressOf(userId);
  if (!recipient) return { ok: false, reason: "no_wallet", error: "Set up your Solana wallet first." };

  const stored = await readStored(chain.kind, userId);
  if (stored && stored.recipient === recipient) return { ok: true, address: stored.address };

  const made = await createPersistentAddress({
    recipient,
    sender: userId,
    depositChain: chain.depositChain,
    destinationChain: "sol",
    destinationAsset: SOL_USDC_ASSET,
  });
  if (!made.ok || !made.data?.depositAddress) {
    // 403: the key is not approved for persistent addresses yet.
    if (made.status === 403) {
      return { ok: false, reason: "not_approved", error: "This deposit is not available yet." };
    }
    return { ok: false, reason: "unavailable", error: "Could not open a deposit address right now." };
  }

  const value: StoredAddress = { address: made.data.depositAddress, recipient };
  await prisma.serviceStatus.upsert({
    where: { key: ADDR_KEY(chain.kind, userId) },
    create: { key: ADDR_KEY(chain.kind, userId), value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  return { ok: true, address: value.address };
}

/**
 * The smallest deposit, in the coin itself, from the dollar floor in the
 * console and the live price. Rounded up, never down: a minimum shown a hair
 * too low is somebody sending money that is not credited.
 */
async function minimumInCoin(asset: AuroraDepositAsset, minUsd: number): Promise<string | null> {
  const price = (await auroraTokens()).get(asset.assetId)?.price;
  if (!price || price <= 0) return null;
  // Enough places that a dollar floor still shows: six for BTC and ETH, four for SOL and BNB, two for the rest.
  const places = price >= 1_000 ? 6 : price >= 10 ? 4 : 2;
  const step = 10 ** places;
  return (Math.ceil((minUsd / price) * step) / step).toFixed(places);
}

export type AuroraRoutedAsset = {
  chainId: number;
  symbol: string;
  state: Exclude<DepositState, "hidden">;
  address: string;
  minimum: string | null;
  decimals: number;
  settlesAs: "USDC";
  settlesOn: "SOL";
};

/**
 * What the deposit list shows for this rail.
 *
 * An address that cannot be made turns its row unavailable rather than
 * removing it, the same rule the routed list already follows: a row that
 * vanishes leaves somebody wondering whether their money is stuck.
 */
export async function auroraRoutedAssets(userId: string, coinStates: { chainId: number; symbol: string; state: DepositState }[] = []): Promise<AuroraRoutedAsset[]> {
  if (!isAuroraConfigured()) return [];
  const settings = await auroraSettings();
  const out: AuroraRoutedAsset[] = [];
  const order: DepositState[] = ["visible", "unavailable", "hidden"];
  const worse = (a: DepositState, b: DepositState): DepositState => (order.indexOf(a) >= order.indexOf(b) ? a : b);

  for (const chain of AURORA_DEPOSIT_CHAINS) {
    const { state, minUsd, rail } = settings.deposits[chain.kind];
    if (state === "hidden" || rail !== "aurora") continue;
    const onlyAurora = AURORA_CHAIN_IDS.includes(chain.chainId);

    // Each coin: the network's state, and (off Bitcoin and Tron) the coin's own from the Converted tab, whichever is less.
    const rows = chain.assets
      .map((a) => ({ a, st: onlyAurora ? state : worse(state, coinStates.find((c) => c.chainId === chain.chainId && c.symbol === a.symbol)?.state ?? "hidden") }))
      .filter((r) => r.st !== "hidden");
    if (!rows.length) continue;

    let address = "";
    let failed = false;
    if (rows.some((r) => r.st === "visible")) {
      const r = await ensureAuroraAddress(userId, chain);
      if (r.ok) address = r.address;
      else {
        failed = true;
        console.warn(`[AU-DEP] ${chain.kind} unavailable for ${userId}: ${r.reason}`);
      }
    }

    for (const { a, st } of rows) {
      const effective: "visible" | "unavailable" = st === "visible" && !failed ? "visible" : "unavailable";
      out.push({
        chainId: chain.chainId,
        symbol: a.symbol,
        state: effective,
        address: effective === "visible" ? address : "",
        minimum: effective === "visible" ? await minimumInCoin(a, minUsd) : null,
        decimals: a.decimals,
        settlesAs: "USDC",
        settlesOn: "SOL",
      });
    }
  }
  return out;
}

/* ─── The ledger ───────────────────────────────────────────────────── */

const referenceFor = (txHash: string) => `AUDEP-${txHash}`;

/** A Solana signature is base58 and about 88 characters; anything else is not one. */
const looksLikeSolanaTx = (h: string | undefined | null) => !!h && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(h);

type Pairing = {
  received: PersistentDeposit;
  payout: PersistentDeposit | null;
  /** A payout to the recipient failed after this deposit; Aurora retries those. */
  retrying: boolean;
};

/**
 * Match each deposit to the payout it became.
 *
 * Aurora gives no id linking the two, so they are paired in arrival order:
 * the first payout after a deposit is that deposit's. One address has one
 * sender and one recipient, and payouts follow deposits in order, so this is
 * the pairing the data allows. A payout is never matched to a deposit that
 * arrived after it.
 */
function pair(received: PersistentDeposit[], success: PersistentDeposit[], failed: PersistentDeposit[]): Pairing[] {
  const t = (d: PersistentDeposit) => Date.parse(d.created_at) || 0;
  const r = [...received].sort((a, b) => t(a) - t(b));
  const s = [...success].sort((a, b) => t(a) - t(b));
  const used = new Set<number>();
  const SKEW_MS = 60_000;

  return r.map((dep) => {
    const i = s.findIndex((p, idx) => !used.has(idx) && t(p) >= t(dep) - SKEW_MS);
    if (i >= 0) {
      used.add(i);
      return { received: dep, payout: s[i], retrying: false };
    }
    const retrying = failed.some((f) => t(f) >= t(dep) - SKEW_MS);
    return { received: dep, payout: null, retrying };
  });
}

/**
 * The chain watcher may already have written the USDC landing in the Solana
 * wallet as an ordinary deposit. That row and ours are the same money, so
 * once ours is settled, theirs goes - by hash when we have the Solana one,
 * otherwise by amount and time, the same way the Stableyard ledger does it.
 */
async function removeWatcherDuplicate(userId: string, amount: number, payout: PersistentDeposit, keepId: string) {
  const notOurs = { userId, id: { not: keepId }, reference: { not: { startsWith: "AUDEP-" } } };
  let dup: { id: string } | null = null;
  if (looksLikeSolanaTx(payout.tx_hash)) {
    dup = await prisma.transaction.findFirst({
      where: { ...notOurs, metadata: { path: ["txHash"], equals: payout.tx_hash } },
      select: { id: true },
    });
  }
  if (!dup && amount > 0) {
    const at = Date.parse(payout.created_at);
    if (at) {
      dup = await prisma.transaction.findFirst({
        where: {
          ...notOurs,
          type: "DEPOSIT",
          chain: "SOL",
          asset: "USDC",
          amount: { gte: amount - 0.000001, lte: amount + 0.000001 },
          metadata: { path: ["source"], equals: "external_deposit" },
          createdAt: { gte: new Date(at - 30 * 60_000), lte: new Date(at + 30 * 60_000) },
        },
        select: { id: true },
      });
    }
  }
  if (dup) {
    console.log(`[AU-DEP] removing watcher duplicate ${dup.id}`);
    await prisma.transaction.delete({ where: { id: dup.id } }).catch(() => {});
  }
}

async function record(userId: string, chain: AuroraDepositChain, p: Pairing): Promise<void> {
  const reference = referenceFor(p.received.tx_hash);
  const coin = assetOf(chain, p.received.asset_id);
  const sentAmount = (Number(p.received.amount) / 10 ** (p.received.decimals ?? coin.decimals)).toString();
  const settled = !!p.payout;
  const amount = settled ? Number(p.payout!.amount) / 10 ** (p.payout!.decimals ?? SOL_USDC_DECIMALS) : 0;
  const status = settled ? "COMPLETED" : "PROCESSING";

  // The same shape the Stableyard ledger writes, so the app draws these
  // rows without knowing which rail they came through.
  const metadata = {
    source: "routed_deposit",
    provider: "aurora",
    chainId: chain.chainId,
    routedStatus: settled ? "settled" : p.retrying ? "review" : "converting",
    sentAmount,
    sentSymbol: coin.symbol,
    sourceTxHash: p.received.tx_hash,
    depositAddress: p.received.deposit_address,
    ...(settled ? { payoutTxHash: p.payout!.tx_hash } : {}),
    // metadata.txHash is what every screen links to and what the chain
    // watcher dedupes on, so it is set only to a real Solana signature.
    ...(settled && looksLikeSolanaTx(p.payout!.tx_hash) ? { txHash: p.payout!.tx_hash } : {}),
    settledAt: settled ? p.payout!.created_at : null,
  };

  let existing = await prisma.transaction.findUnique({
    where: { reference },
    select: { id: true, status: true, amount: true, metadata: true },
  });

  /**
   * Our watcher may have written this deposit first, from the chain itself.
   * That row becomes this one rather than sitting beside it, whatever hash
   * Aurora reports; the chain's own hash is kept so the watcher still knows it.
   */
  // Already settled from the wallet: the same payout, so the same row.
  if (!existing && settled && looksLikeSolanaTx(p.payout!.tx_hash)) {
    const byPayout = await prisma.transaction.findFirst({
      where: { userId, reference: { startsWith: "AUDEP-" }, metadata: { path: ["payoutTxHash"], equals: p.payout!.tx_hash } },
      select: { id: true, status: true, amount: true, metadata: true },
    });
    if (byPayout) {
      await prisma.transaction.update({ where: { id: byPayout.id }, data: { reference } });
      existing = byPayout;
    }
  }
  if (!existing) {
    // Same person, same coin, and the amount that was sent. Aurora's address
    // and hash formats are not guaranteed to match the chain's, so neither is
    // required; the amount picks between candidates, else the oldest wins.
    const candidates = await prisma.transaction.findMany({
      where: {
        userId,
        status: "PENDING",
        reference: { startsWith: "AUDEP-" },
        AND: [
          { metadata: { path: ["watched"], equals: true } },
          { metadata: { path: ["chainId"], equals: chain.chainId } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, amount: true, metadata: true },
    });
    const sentNum = Number(sentAmount);
    const watched =
      candidates.find((c) => Math.abs(Number((c.metadata as any)?.sentAmount) - sentNum) < 1e-9) ??
      candidates.find((c) => (c.metadata as any)?.depositAddress === p.received.deposit_address) ??
      candidates[0] ??
      null;
    if (watched) {
      console.log(`[AU-DEP] ${chain.kind} ${p.received.tx_hash} takes over watched row ${watched.id}`);
      await prisma.transaction.update({ where: { id: watched.id }, data: { reference } });
      existing = watched;
    }
  }
  const prior = (existing?.metadata ?? {}) as any;
  const chainTxHash: string | undefined = prior.chainTxHash ?? (prior.watched ? prior.sourceTxHash : undefined);
  if (chainTxHash && chainTxHash !== p.received.tx_hash) (metadata as any).chainTxHash = chainTxHash;

  if (existing) {
    const unchanged =
      existing.status === status &&
      Number(existing.amount) === amount &&
      JSON.stringify(existing.metadata ?? {}) === JSON.stringify(metadata);
    if (unchanged) return;
    await prisma.transaction.update({ where: { id: existing.id }, data: { status, amount, metadata } });
    if (settled && existing.status !== "COMPLETED") {
      await removeWatcherDuplicate(userId, amount, p.payout!, existing.id);
      await announceArrived(userId, sentAmount, coin.symbol, amount);
    }
    return;
  }

  const row = await prisma.transaction.create({
    data: {
      userId,
      type: "DEPOSIT",
      // What it becomes. The coin sent is in metadata: nobody holds BTC here.
      asset: "USDC",
      chain: "SOL",
      amount,
      fee: 0,
      status,
      reference,
      metadata,
      createdAt: Date.parse(p.received.created_at) ? new Date(p.received.created_at) : undefined,
    },
  });
  void alertIfLargeDeposit({
    userId,
    reference,
    amount: Number(sentAmount),
    symbol: coin.symbol,
    network: networkName(chain.chainId),
    kind: settled ? "converted to USDC" : "converting to USDC",
    converting: true,
    txHash: p.received.tx_hash,
  });
  if (settled) {
    await removeWatcherDuplicate(userId, amount, p.payout!, row.id);
    await announceArrived(userId, sentAmount, coin.symbol, amount);
  } else {
    await sendNotification({
      userId,
      type: "transaction",
      title: "Deposit Seen",
      body: `${sentAmount} ${coin.symbol} is converting to USDC on Solana. We will tell you when it lands.`,
    }).catch(() => {});
  }
}

function announceArrived(userId: string, sentAmount: string, symbol: string, usdc: number) {
  return sendNotification({
    userId,
    type: "transaction",
    title: "Deposit Arrived",
    body: `${sentAmount} ${symbol} converted to ${usdc.toFixed(2)} USDC in your Solana wallet.`,
  }).catch(() => {});
}

/** Read one address from Aurora and write what it says. Returns false if Aurora did not answer. */
async function syncAddress(userId: string, chain: AuroraDepositChain, address: string): Promise<boolean> {
  const received = await persistentDeposits(address, "received", { limit: 100 });
  if (!received.ok) {
    console.warn(`[AU-DEP] ${chain.kind} status read failed (${received.status}) for ${userId}`);
    return false;
  }
  const deposits = received.data?.deposits ?? [];

  const [success, failed] = await Promise.all([
    persistentDeposits(address, "success"),
    persistentDeposits(address, "failed"),
  ]);
  // What Aurora says for this address, so a row that will not settle can be read rather than guessed at.
  console.log(
    `[AU-DEP] sync ${chain.kind} ${userId}: received ${deposits.length} [${deposits.map((d) => d.tx_hash.slice(0, 12)).join(",")}]` +
      ` success ${success.data?.deposits?.length ?? `err ${success.status}`} failed ${failed.data?.deposits?.length ?? `err ${failed.status}`}`,
  );
  if (!deposits.length) return true;
  if (!success.ok) return false;

  for (const p of pair(deposits, success.data?.deposits ?? [], failed.ok ? failed.data?.deposits ?? [] : [])) {
    await record(userId, chain, p).catch((e: any) => console.error(`[AU-DEP] record ${p.received.tx_hash}:`, e?.message));
  }
  return true;
}

/** Everything this person has on this rail, written into their history. */
export async function syncAuroraLedger(userId: string): Promise<void> {
  if (!isAuroraConfigured()) return;
  for (const chain of AURORA_DEPOSIT_CHAINS) {
    const stored = await readStored(chain.kind, userId);
    if (stored) await syncAddress(userId, chain, stored.address);
  }
}

/* ─── Background ───────────────────────────────────────────────────── */

let inFlightRunning = false;
/** How long a deposit still converting is followed before a person takes over. */
const FOLLOW_FOR_MS = 3 * 24 * 60 * 60_000;
let discoveryRunning = false;

/** Deposits already seen and still converting: finish them while the app is closed. */
export async function syncInFlightAuroraDeposits(): Promise<void> {
  if (inFlightRunning || !isAuroraConfigured()) return;
  inFlightRunning = true;
  try {
    /**
     * Followed for three days, then left for a person.
     *
     * Every followed row costs status reads against an hourly limit shared by
     * everyone, and a row that will never settle - dust under the minimum,
     * sent by mistake or on purpose - would otherwise be read forever, until
     * nobody's deposits could be read at all. Past three days it says it is
     * taking longer than usual and stops being polled.
     */
    const cutoff = new Date(Date.now() - FOLLOW_FOR_MS);
    const stale = await prisma.transaction.findMany({
      where: { reference: { startsWith: "AUDEP-" }, status: { in: ["PENDING", "PROCESSING"] }, createdAt: { lt: cutoff } },
      select: { id: true, metadata: true },
      take: 200,
    });
    for (const s of stale) {
      const m = (s.metadata ?? {}) as any;
      if (m.routedStatus === "review") continue;
      await prisma.transaction.update({ where: { id: s.id }, data: { metadata: { ...m, routedStatus: "review" } } }).catch(() => {});
    }

    const rows = await prisma.transaction.findMany({
      where: { reference: { startsWith: "AUDEP-" }, status: { in: ["PENDING", "PROCESSING"] }, createdAt: { gte: cutoff } },
      select: { userId: true },
      distinct: ["userId"],
    });
    for (const r of rows) await syncAuroraLedger(r.userId).catch(() => {});
    // Whatever the feed did not settle, the wallet may already have.
    await settleFromWallet().catch((e: any) => console.error("[AU-DEP] settle from wallet:", e?.message));
  } finally {
    inFlightRunning = false;
  }
}

/**
 * Find deposits nobody has opened the app to see.
 *
 * Every address on file, one read each, stopping early if Aurora stops
 * answering - their hourly limit counts refused calls too, so knocking on
 * through an outage only digs the hole deeper.
 */
export async function discoverAuroraDeposits(): Promise<void> {
  if (discoveryRunning || !isAuroraConfigured()) return;
  discoveryRunning = true;
  try {
    const rows = await prisma.serviceStatus.findMany({
      where: { key: { startsWith: "auaddr:" } },
      select: { key: true, value: true },
    });
    let failures = 0;
    for (const row of rows) {
      if (failures >= 3) {
        console.warn("[AU-DEP] discovery stopped early: Aurora not answering");
        break;
      }
      const [, kind, userId] = row.key.split(":");
      const chain = AURORA_DEPOSIT_CHAINS.find((c) => c.kind === kind);
      let address: string | null = null;
      try {
        address = JSON.parse(row.value ?? "")?.address ?? null;
      } catch {
        address = null;
      }
      if (!chain || !userId || !address) continue;
      const ok = await syncAddress(userId, chain, address).catch(() => false);
      failures = ok ? 0 : failures + 1;
    }
  } finally {
    discoveryRunning = false;
  }
}

/* ─── Watching the addresses ourselves ─────────────────────────────── */

/**
 * A deposit the moment it is broadcast, before Aurora has seen it.
 *
 * Aurora reports a deposit only once it has picked it up, and a Bitcoin
 * payment sent at a low fee can sit unconfirmed for hours first - with nothing
 * in the person's history to say it exists. So each address is read straight
 * off its chain: Bitcoin from mempool.space, which shows unconfirmed payments
 * too, and Tron USDT from TronGrid. What is found becomes a "detected" row,
 * and Aurora's own record takes that row over when it arrives (see record()).
 *
 * Read-only public APIs, no keys.
 */
type Incoming = { txHash: string; amount: number; confirmed: boolean; at: Date };

const TRON_USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function incomingBtc(address: string): Promise<Incoming[] | null> {
  const txs = await getJson(`https://mempool.space/api/address/${encodeURIComponent(address)}/txs`);
  if (!Array.isArray(txs)) return null;
  const out: Incoming[] = [];
  for (const tx of txs) {
    const sats = (tx.vout ?? [])
      .filter((v: any) => v.scriptpubkey_address === address)
      .reduce((n: number, v: any) => n + Number(v.value || 0), 0);
    if (sats <= 0 || !tx.txid) continue;
    const confirmed = !!tx.status?.confirmed;
    out.push({
      txHash: tx.txid,
      amount: sats / 1e8,
      confirmed,
      at: confirmed && tx.status?.block_time ? new Date(tx.status.block_time * 1000) : new Date(),
    });
  }
  return out;
}

async function incomingTron(address: string): Promise<Incoming[] | null> {
  const j = await getJson(
    `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions/trc20?only_to=true&limit=20&contract_address=${TRON_USDT_CONTRACT}`,
  );
  if (!j || !Array.isArray(j.data)) return null;
  return j.data
    .filter((t: any) => t.to === address && t.transaction_id)
    .map((t: any) => ({
      txHash: t.transaction_id,
      amount: Number(t.value || 0) / 1e6,
      // TronGrid lists a transfer once it is in a block, and Tron finalises in seconds.
      confirmed: true,
      at: t.block_timestamp ? new Date(t.block_timestamp) : new Date(),
    }))
    .filter((t: Incoming) => t.amount > 0);
}

/** Write what the chain shows that Aurora has not reported yet. */
async function watchAddress(userId: string, chain: AuroraDepositChain, address: string): Promise<void> {
  const found = chain.kind === "btc" ? await incomingBtc(address) : await incomingTron(address);
  if (!found?.length) return;

  // Only recent ones: anything older that Aurora never reported is not "on its way".
  const since = Date.now() - 3 * 24 * 60 * 60_000;
  for (const inc of found) {
    if (inc.at.getTime() < since) continue;
    const reference = referenceFor(inc.txHash);
    const existing = await prisma.transaction.findFirst({
      where: {
        userId,
        OR: [
          { reference },
          { reference: { startsWith: "AUDEP-" }, metadata: { path: ["sourceTxHash"], equals: inc.txHash } },
          { reference: { startsWith: "AUDEP-" }, metadata: { path: ["chainTxHash"], equals: inc.txHash } },
        ],
      },
      select: { id: true, status: true, metadata: true },
    });

    const sentAmount = String(Number(inc.amount.toFixed(chain.decimals)));
    if (existing) {
      // Still ours and still waiting: keep the confirmation flag current.
      const m = (existing.metadata ?? {}) as any;
      if (m.watched && existing.status === "PENDING" && m.confirmed !== inc.confirmed) {
        await prisma.transaction.update({ where: { id: existing.id }, data: { metadata: { ...m, confirmed: inc.confirmed } } });
      }
      continue;
    }

    await prisma.transaction.create({
      data: {
        userId,
        type: "DEPOSIT",
        asset: "USDC",
        chain: "SOL",
        amount: 0,
        fee: 0,
        status: "PENDING",
        reference,
        createdAt: inc.at,
        metadata: {
          source: "routed_deposit",
          provider: "aurora",
          chainId: chain.chainId,
          routedStatus: "detected",
          sentAmount,
          sentSymbol: chain.symbol,
          sourceTxHash: inc.txHash,
          depositAddress: address,
          confirmed: inc.confirmed,
          // Ours, from the chain, until Aurora's record replaces it.
          watched: true,
          settledAt: null,
        },
      },
    });
    console.log(`[AU-DEP] watching ${chain.kind} ${inc.txHash} for ${userId} (${inc.confirmed ? "confirmed" : "unconfirmed"})`);
    void alertIfLargeDeposit({
      userId,
      reference,
      amount: inc.amount,
      symbol: chain.symbol,
      network: networkName(chain.chainId),
      kind: inc.confirmed ? "converting to USDC" : "converting to USDC, not yet confirmed",
      converting: true,
      txHash: inc.txHash,
    });
    await sendNotification({
      userId,
      type: "transaction",
      title: "Deposit Seen",
      body: `${sentAmount} ${chain.symbol} is on its way. It converts to USDC on Solana once the network confirms it.`,
    }).catch(() => {});
  }
}

let watchRunning = false;

/** Every deposit address on file, read off its own chain. */
export async function watchAuroraAddresses(): Promise<void> {
  if (watchRunning || !isAuroraConfigured()) return;
  watchRunning = true;
  try {
    const rows = await prisma.serviceStatus.findMany({
      where: { key: { startsWith: "auaddr:" } },
      select: { key: true, value: true },
    });
    for (const row of rows) {
      const [, kind, userId] = row.key.split(":");
      const chain = AURORA_DEPOSIT_CHAINS.find((c) => c.kind === kind);
      let address: string | null = null;
      try {
        address = JSON.parse(row.value ?? "")?.address ?? null;
      } catch {
        address = null;
      }
      if (!chain || !userId || !address) continue;
      // Read off their own chains ahead of Aurora: Bitcoin and Tron only. The other networks wait for Aurora's own feed.
      if (chain.kind !== "btc" && chain.kind !== "tron") continue;
      await watchAddress(userId, chain, address).catch((e: any) => console.error(`[AU-DEP] watch ${kind}:`, e?.message));
    }
  } finally {
    watchRunning = false;
  }
}

/* ─── Settling from the wallet itself ──────────────────────────────── */

/**
 * The converter's status feed is not the only witness: the USDC lands in the
 * person's own Solana wallet, and the general deposit watcher writes that down
 * as an ordinary "Received USDC". When that happens after a pending BTC or
 * Tron row, for about what the coin was worth, it is that deposit arriving -
 * so the pending row settles for the amount that landed and the ordinary row,
 * which is the same money, goes.
 *
 * Fifteen percent either way covers the converter's fees and the price moving
 * while Bitcoin confirms, and is tight enough that an unrelated USDC transfer
 * of a different size is never mistaken for it. Only USDC that arrived after
 * the deposit was sent, and within a day of it, is considered.
 */
async function settleFromWallet(): Promise<void> {
  const pending = await prisma.transaction.findMany({
    where: {
      reference: { startsWith: "AUDEP-" },
      status: { in: ["PENDING", "PROCESSING"] },
      createdAt: { gte: new Date(Date.now() - FOLLOW_FOR_MS) },
    },
    select: { id: true, userId: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  if (!pending.length) return;

  const tokens = await auroraTokens().catch(() => null);
  const claimed = new Set<string>();

  for (const row of pending) {
    const m = (row.metadata ?? {}) as any;
    const chain = AURORA_DEPOSIT_CHAINS.find((c) => c.chainId === Number(m.chainId));
    if (!chain) continue;
    // Nothing can have been paid for a payment its own chain has not confirmed,
    // so USDC arriving meanwhile is somebody else's and must not be taken for it.
    if (m.watched && m.confirmed === false) continue;
    const sentCoin = assetOf(chain, null, m.sentSymbol);
    const price = sentCoin.symbol === "USDT" || sentCoin.symbol === "USDC" ? 1 : tokens?.get(sentCoin.assetId)?.price;
    const sent = Number(m.sentAmount);
    if (!price || !(sent > 0)) continue;
    const expected = sent * price;

    const landed = await prisma.transaction.findMany({
      where: {
        userId: row.userId,
        id: { notIn: [...claimed] },
        type: "DEPOSIT",
        chain: "SOL",
        asset: "USDC",
        status: "COMPLETED",
        reference: { not: { startsWith: "AUDEP-" } },
        metadata: { path: ["source"], equals: "external_deposit" },
        createdAt: { gte: row.createdAt, lte: new Date(row.createdAt.getTime() + 24 * 60 * 60_000) },
      },
      select: { id: true, amount: true, metadata: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const match = landed.find((l) => {
      const a = Number(l.amount);
      return a >= expected * 0.85 && a <= expected * 1.15;
    });
    if (!match) continue;
    claimed.add(match.id);

    const amount = Number(match.amount);
    const payoutHash: string | undefined = (match.metadata as any)?.txHash;
    const { watched: _w, ...rest } = m;
    await prisma.transaction.update({
      where: { id: row.id },
      data: {
        status: "COMPLETED",
        amount,
        metadata: {
          ...rest,
          routedStatus: "settled",
          ...(m.watched ? { chainTxHash: m.sourceTxHash } : {}),
          ...(payoutHash ? { payoutTxHash: payoutHash, ...(looksLikeSolanaTx(payoutHash) ? { txHash: payoutHash } : {}) } : {}),
          settledAt: match.createdAt.toISOString(),
          settledBy: "wallet",
        },
      },
    });
    await prisma.transaction.delete({ where: { id: match.id } }).catch(() => {});
    console.log(`[AU-DEP] ${chain.kind} row ${row.id} settled from the wallet: ${amount} USDC (row ${match.id} merged)`);
    await announceArrived(row.userId, String(m.sentAmount), sentCoin.symbol, amount);
  }
}
