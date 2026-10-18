import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { Asset, Chain } from "@prisma/client";
import crypto from "crypto";
import { requireAuth, requireActiveSession, requireVerifiedEmail } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  fetchAllBalances,
  ChainAddresses,
  findMovementDeposit,
  findSolanaDeposit,
  findEvmDeposit,
  findArcDeposit,
  findMonadDeposit,
  evmTokenFor,
} from "../lib/balances";
import * as ton from "../lib/ton";
import * as stellar from "../lib/stellar";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { sendNotification } from "../lib/push";
import { assetLabel } from "../lib/asset";
import { isProven, provenByHeld, provenByToken, sameAddress } from "../lib/wallet-proof";

const router = Router();

// Minimum deposit threshold to avoid noise from dust/rounding
const MIN_DEPOSIT_THRESHOLD: Record<string, number> = {
  USDC: 0.01,
  USDT: 0.01,
  MOVE: 0.001,
  SOL: 0.0001,
  ETH: 0.00001,
};

// ─── Schemas ────────────────────────────────────────────────
const getBalanceSchema = z.object({
  asset: z.enum(["USDC", "USDT", "ETH", "MOVE"]).optional(),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARB", "ARC", "TON", "STELLAR", "MONAD"]).optional(),
});

// ═══════════════════════════════════════════════════════════
// Shared helper: sync DB balances from on-chain, then read back.
// DB is a write-through cache — on-chain is the source of truth.
// ═══════════════════════════════════════════════════════════

/** The chains the background deposit watcher reads. */
export type WatchedChain = "MOVE" | "SOL" | "TON" | "STELLAR" | "MONAD";

/** When each user's wallets were last read against the chain, by anyone. */
export const lastWalletSync = new Map<string, number>();

const syncQueue = new Map<string, Promise<unknown>>();

/**
 * One sync per user at a time, the next waiting for the last.
 *
 * Two syncs racing for the same person both saw the same balance rise, both
 * found no record of it, and both wrote one: a deposit recorded twice, and two
 * "Crypto Received" notifications. The app could already do this by refreshing
 * twice; the background watcher would have done it routinely. Queued, the
 * second one reads the balance the first already brought up to date.
 *
 * `chains` limits which chains are read - the watcher passes the ones it can
 * afford to poll. Omitted, everything is read, as the app has always had.
 */
export function syncAndReadWallets(userId: string, opts: { chains?: WatchedChain[] } = {}) {
  const run = (syncQueue.get(userId) ?? Promise.resolve())
    .catch(() => {})
    .then(() => doSyncAndReadWallets(userId, opts));
  syncQueue.set(userId, run);
  run
    .finally(() => {
      lastWalletSync.set(userId, Date.now());
      if (syncQueue.get(userId) === run) syncQueue.delete(userId);
    })
    .catch(() => {});
  return run;
}

/**
 * When a transfer happened on chain, or null when that is unknown or not believable.
 *
 * Movement's indexer writes UTC without saying so ("2026-10-05T08:41:35"), and
 * a bare timestamp is read as local time by whatever parses it next - on a
 * phone in Lagos, an hour out. So one without a zone is marked UTC here.
 */
function chainDate(at: unknown): Date | null {
  if (at == null) return null;
  let d: Date;
  if (at instanceof Date) d = at;
  else if (typeof at === "string") d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(at) ? at : `${at}Z`);
  else if (typeof at === "number") d = new Date(at);
  else return null;
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  const now = Date.now();
  // In the future is a skewed clock or a bad parse; before this year is a
  // missing timestamp read as zero. Either way the detection time is safer.
  if (t > now + 2 * 60_000 || t < now - 180 * 86_400_000) return null;
  return d;
}

async function doSyncAndReadWallets(userId: string, opts: { chains?: WatchedChain[] }) {
  const wallets = await prisma.wallet.findMany({
    where: { userId },
    select: { id: true, asset: true, chain: true, address: true, balance: true },
  });

  const addrMap: ChainAddresses = {};
  for (const w of wallets) {
    if (!w.address) continue;
    if (w.chain === "MOVE" && !addrMap.movement) addrMap.movement = w.address;
    if (w.chain === "SOL" && !addrMap.solana) addrMap.solana = w.address;
    if (["BASE", "BEP20", "ARB"].includes(w.chain) && !addrMap.evm) addrMap.evm = w.address;
    if (w.chain === "TON" && !addrMap.ton) addrMap.ton = w.address;
    // Only once the user has opened Stellar: the row is written at activation,
    // and without it nobody's refresh spends a Horizon request on an account
    // that does not exist.
    if (w.chain === "STELLAR" && !addrMap.stellar) addrMap.stellar = w.address;
  }

  /**
   * TON needs no row of its own to be readable.
   *
   * The address is a pure function of the Solana public key, so anyone with a
   * Solana wallet already has a TON one whether or not the database has heard
   * of it. Deriving it here means balances appear the moment the chain is
   * switched on rather than only for accounts created afterwards - and it is
   * the same derivation the send path uses, so the two cannot drift.
   */
  if (!addrMap.ton && addrMap.solana) {
    try {
      addrMap.ton = ton.tonAddressFromSolana(addrMap.solana);
    } catch (err: any) {
      console.warn(`[WALLET] could not derive TON address: ${err?.message}`);
    }
  }

  // Monad is the EVM address too, read on its own node - see ChainAddresses.
  if (addrMap.evm) addrMap.monad = addrMap.evm;

  // Only the chains asked for. The watcher never reads Base, BSC or Arc, whose
  // public RPCs already refuse batch calls under the app's own load; Monad it
  // can, which is why Monad has a slot of its own.
  if (opts.chains) {
    const want = new Set<string>(opts.chains);
    if (!want.has("MOVE")) delete addrMap.movement;
    if (!want.has("SOL")) delete addrMap.solana;
    if (!want.has("TON")) delete addrMap.ton;
    if (!want.has("STELLAR")) delete addrMap.stellar;
    if (!want.has("MONAD")) delete addrMap.monad;
    delete addrMap.evm;
  }

  let synced = false;
  if (addrMap.movement || addrMap.solana || addrMap.evm || addrMap.ton || addrMap.stellar || addrMap.monad) {
    const onChain = await fetchAllBalances(addrMap);

    for (const { asset, chain, balance: onChainBal } of onChain) {
      // Find the current DB wallet for this asset+chain
      let dbWallet = wallets.find(
        (w) => w.asset === asset && w.chain === chain
      );

      /**
       * No row for something the chain can hold.
       *
       * An account seeded before an asset was added here has no row for it, and
       * the deposit check below reads `dbWallet` - so it skipped, silently, for
       * ever. That is how two USDCx sat on Movement with a balance on screen,
       * nothing in the database, and no transaction to show for it.
       *
       * The row is created carrying what is on chain right now rather than
       * zero. Zero would make this first sighting look like a deposit that had
       * just arrived, and it may have arrived months ago through a route that
       * already recorded itself. An account with no history at all for the pair
       * is the one case where the balance can only have come from outside, and
       * that is recorded below.
       */
      if (!dbWallet) {
        const addressForChain =
          chain === "MOVE" ? addrMap.movement
          : chain === "SOL" ? addrMap.solana
          : chain === "TON" ? addrMap.ton
          : chain === "STELLAR" ? addrMap.stellar
          : chain === "MONAD" ? addrMap.monad
          : addrMap.evm;
        const everTraded = await prisma.transaction.count({
          where: { userId, asset: asset as Asset, chain: chain as Chain },
        });
        /**
         * Upsert, because two syncs can race for the same missing row.
         *
         * A create threw a unique-constraint error when the second one landed,
         * and the throw took the whole sync with it - so adding cNGN, which
         * gave every account two rows it had never had, turned an ordinary
         * refresh into a 500 for anyone who happened to refresh twice at once.
         *
         * `update: {}` on purpose: if the row already exists it is somebody
         * else's freshly written truth, and the balance is reconciled below
         * rather than overwritten here.
         */
        const created = await prisma.wallet.upsert({
          where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
          create: {
            userId,
            asset: asset as Asset,
            chain: chain as Chain,
            address: addressForChain ?? null,
            balance: everTraded > 0 ? onChainBal : 0,
          },
          update: {},
          select: { id: true, asset: true, chain: true, address: true, balance: true },
        });
        console.warn(
          `[WALLET] created a missing ${asset}/${chain} row for ${userId}` +
            (everTraded > 0 ? " (seeded to on-chain, history exists)" : " (fresh, any balance reads as a deposit)"),
        );
        wallets.push(created);
        dbWallet = created;
      }

      const dbBal = dbWallet ? Number(dbWallet.balance) : 0;
      const diff = onChainBal - dbBal;
      const threshold = MIN_DEPOSIT_THRESHOLD[asset] ?? 0.001;

      // Detect external deposit: on-chain went up more than dust
      if (diff > threshold && dbWallet) {
        // Skip if there's *any* recent wallet-affecting tx for this asset/chain.
        // Outgoing tx (SELL/WITHDRAW/TRANSFER) can transiently leave dbBal lower
        // than onChainBal during the gap between on-chain confirmation and DB
        // decrement, which would otherwise be misclassified as an external deposit.
        /**
         * The transfer that caused it, looked up before anything is decided.
         *
         * A balance going up says money arrived and nothing about where from.
         * The chain does know, and knowing lets this be judged on the transfer
         * itself rather than on the clock - see the duplicate check below.
         *
         * Best effort: if the lookup is slow or unavailable the deposit is
         * still recorded, just without the link, and the time window decides.
         */
        const onChainTx = await (async () => {
          if (chain === "MOVE" && addrMap.movement) {
            return findMovementDeposit(addrMap.movement, asset);
          }
          if (chain === "SOL" && addrMap.solana) {
            return findSolanaDeposit(addrMap.solana, asset);
          }
          /**
           * TON is read from an indexer rather than scanned.
           *
           * There is no log filter to sweep here, and one jetton arrival is
           * several transactions that only an indexer reassembles into a
           * single "somebody was paid" - so this is not an optimisation, it
           * is the only practical way to see a TON deposit at all.
           */
          if (chain === "TON" && addrMap.ton) {
            const found = await ton.findTonDeposit(addrMap.ton);
            return found
              ? {
                  hash: found.txHash,
                  sender: found.from,
                  // TON has no sequential version number; the event id is the
                  // handle every explorer and the duplicate check below use.
                  version: found.txHash,
                  at: found.at.toISOString(),
                  amount: found.amount,
                }
              : null;
          }
          if (chain === "STELLAR" && addrMap.stellar && stellar.isStellarCoin(asset)) {
            const found = await stellar.findStellarDeposit(addrMap.stellar, asset);
            return found
              ? {
                  hash: found.txHash,
                  sender: found.from,
                  // The same hash a sender's own record carries (a fee-bumped
                  // transfer is known by its outer hash on both sides), so a
                  // username transfer is not written twice.
                  version: found.txHash,
                  at: found.at.toISOString(),
                  amount: found.amount,
                }
              : null;
          }
          // Walked back in windows, with the block's time - see findMonadDeposit.
          if (chain === "MONAD" && addrMap.monad) {
            return findMonadDeposit(addrMap.monad, asset);
          }
          if (addrMap.evm) {
            const t = evmTokenFor(asset, chain);
            const viaToken = t ? await findEvmDeposit(t.rpcUrl, t.token, addrMap.evm) : null;
            if (viaToken) return viaToken;

            /**
             * On Arc the money can also arrive as a plain value send, which
             * emits no log for the scan above to find. Tried second because
             * walking blocks costs more than one getLogs call, and most
             * arrivals do leave a log.
             */
            if (chain === "ARC") return findArcDeposit(addrMap.evm);
          }
          return null;
        })();

        /**
         * Has this exact transfer already been written down?
         *
         * It used to ask a blunter question: has anything at all touched this
         * asset in ten minutes. That guard exists because an outgoing transfer,
         * or a purchase not yet synced, leaves the database behind the chain
         * for a moment and would otherwise read as money arriving. But it also
         * threw away real deposits - two arrived eleven minutes apart on a test
         * account and only the first was ever recorded, because the second
         * landed inside the window the first had opened.
         *
         * With the hash in hand the question becomes exact, and back-to-back
         * deposits are no longer indistinguishable from an artefact of one.
         * Without a hash there is nothing to compare, so the window still
         * decides - being occasionally silent is better than inventing
         * deposits out of a sync lag.
         */
        let alreadyRecorded: boolean;
        if (onChainTx?.hash) {
          alreadyRecorded = !!(await prisma.transaction.findFirst({
            where: { userId, metadata: { path: ["txHash"], equals: onChainTx.hash } },
            select: { id: true },
          }));
        } else {
          alreadyRecorded =
            (await prisma.transaction.count({
              where: {
                userId,
                asset: asset as Asset,
                chain: chain as Chain,
                // SWEEP belongs here too: its credit is a treasury transfer
                // into the same wallet, which looks exactly like a deposit.
                type: { in: ["BUY", "DEPOSIT", "SELL", "WITHDRAW", "TRANSFER", "TRANSFER_IN", "TRANSFER_OUT", "SWEEP"] },
                createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
              },
            })) > 0;
        }

        if (!alreadyRecorded) {
          const ref = `EXTDEP-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
          /**
           * Dated when it arrived, not when we noticed.
           *
           * A deposit is only seen when its balance is next read, which used to
           * mean the next time the person opened the app - so money that came
           * in on Monday and was seen on Tuesday sat in the history as
           * Tuesday's. The chain's own time is used whenever it is known.
           */
          const arrivedAt = chainDate(onChainTx?.at);

          await prisma.transaction.create({
            data: {
              userId,
              ...(arrivedAt ? { createdAt: arrivedAt } : {}),
              type: "DEPOSIT",
              asset: asset as Asset,
              chain: chain as Chain,
              /**
               * What the transfer moved, where the chain will say, and only
               * the balance difference where it will not.
               *
               * The difference is what prompted the look, not what arrived.
               * Two deposits and one withdrawal inside three minutes left a
               * difference of 0.409508 on a test account - a figure that had
               * never been sent anywhere, written into the history as though
               * it had.
               */
              amount: onChainTx?.amount ?? diff,
              fee: 0,
              status: "COMPLETED",
              reference: ref,
              metadata: {
                source: "external_deposit",
                detectedAmount: diff,
                amountFrom: onChainTx?.amount != null ? "chain" : "balance-difference",
                previousBalance: dbBal,
                newBalance: onChainBal,
                // metadata.txHash is where every other transaction keeps it -
                // the column on the model belongs to savings locks - and it is
                // the key the receipt screen reads to draw the explorer link.
                ...(onChainTx
                  ? {
                      txHash: onChainTx.hash,
                      fromAddress: onChainTx.sender,
                      chainVersion: onChainTx.version,
                      chainTime: arrivedAt ? arrivedAt.toISOString() : onChainTx.at,
                    }
                  : {}),
                ...(arrivedAt ? { detectedAt: new Date().toISOString() } : {}),
              },
            },
          }).catch((e) => console.error("[WALLET] External deposit record failed:", e));

          // Create notification
          await sendNotification({
            userId,
            type: "transaction",
            title: "Crypto Received",
            body: `You received ${diff < 0.01 ? diff.toFixed(6) : diff.toFixed(4)} ${assetLabel(asset)} on ${chain} from an external wallet`,
          }).catch(() => {});

          console.log(`[WALLET] External deposit detected: ${diff} ${asset} on ${chain} for user ${userId}`);
        }
      }

      // Always sync DB to on-chain value
      await prisma.wallet.updateMany({
        where: { userId, asset: asset as Asset, chain: chain as Chain },
        data: { balance: onChainBal },
      });
    }
    synced = true;
  }

  const updated = await prisma.wallet.findMany({
    where: { userId },
    select: { id: true, asset: true, chain: true, balance: true, address: true },
    orderBy: [{ asset: "asc" }, { chain: "asc" }],
  });

  const totals: Record<string, number> = {};
  for (const w of updated) {
    totals[w.asset] = (totals[w.asset] || 0) + Number(w.balance);
  }

  return { wallets: updated, totals, synced };
}

// ═══════════════════════════════════════════════════════════
// GET /wallet/balances
// Syncs on-chain balances, then returns them.
// ═══════════════════════════════════════════════════════════
router.get("/balances", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const result = await syncAndReadWallets(req.user!.userId);
    res.json(result);
  } catch (err) {
    console.error("Get balances error:", err);
    res.status(500).json({ error: "Failed to get balances" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /wallet/balance/:asset/:chain
// Returns balance for a specific asset on a specific chain
// ═══════════════════════════════════════════════════════════
router.get(
  "/balance/:asset/:chain",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { asset, chain } = req.params;

      const parsed = getBalanceSchema.safeParse({ asset, chain });
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid asset or chain" });
        return;
      }

      await syncAndReadWallets(userId).catch((err) =>
        console.error("[wallet] sync in /balance failed:", err)
      );

      const wallet = await prisma.wallet.findUnique({
        where: {
          userId_asset_chain: {
            userId,
            asset: parsed.data.asset!,
            chain: parsed.data.chain!,
          },
        },
        select: {
          id: true,
          asset: true,
          chain: true,
          balance: true,
          address: true,
        },
      });

      if (!wallet) {
        res.json({ balance: "0", asset: parsed.data.asset, chain: parsed.data.chain });
        return;
      }

      res.json(wallet);
    } catch (err) {
      console.error("Get balance error:", err);
      res.status(500).json({ error: "Failed to get balance" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /wallet/initialize
// Creates wallets for a new user (all asset+chain combos)
// Called after registration / first login
// ═══════════════════════════════════════════════════════════
router.post("/initialize", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Check if wallets already exist
    const existing = await prisma.wallet.count({ where: { userId } });
    if (existing > 0) {
      res.json({ message: "Wallets already initialized" });
      return;
    }

    // Define which chains each asset supports
    // Must cover everything lib/balances.ts can report. USDCx was missing, and
    // it is the asset naira funding actually settles in - so a funded or
    // deposited balance had no row to be written to and was invisible here.
    const assetChains: Record<string, string[]> = {
      USDC:  ["MOVE", "BASE", "SOL", "BEP20", "ARC"],
      USDCx: ["MOVE"],
      USDT:  ["MOVE", "BASE", "SOL", "BEP20", "TON"],
      ETH:   ["BASE", "ARB"],
      MOVE:  ["MOVE"],
      SOL:   ["SOL"],
    };

    const walletData = [];
    for (const [asset, chains] of Object.entries(assetChains)) {
      for (const chain of chains) {
        walletData.push({
          userId,
          asset: asset as Asset,
          chain: chain as Chain,
          balance: 0,
        });
      }
    }

    await prisma.wallet.createMany({ data: walletData });

    const wallets = await prisma.wallet.findMany({
      where: { userId },
      select: { id: true, asset: true, chain: true, balance: true },
    });

    res.status(201).json({ message: "Wallets initialized", wallets });
  } catch (err) {
    console.error("Initialize wallets error:", err);
    res.status(500).json({ error: "Failed to initialize wallets" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /wallet/type
// Records the wallet kind the user chose at setup (MNEMONIC | EMBEDDED).
// Set once; the client reads it back from /auth/me to drive recovery/export.
// ═══════════════════════════════════════════════════════════
const setWalletTypeSchema = z.object({
  type: z.enum(["MNEMONIC", "EMBEDDED"]),
});

router.post(
  "/type",
  requireAuth,
  requireActiveSession,
  validate(setWalletTypeSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { type } = req.body as { type: "MNEMONIC" | "EMBEDDED" };

      /**
       * One direction only: towards the email wallet, never away from it.
       *
       * The app can reach its 12-word setup screen while a Dynamic wallet is
       * still deriving in the background - `walletType` is null for that
       * moment, and null read as "no wallet" rather than "not known yet". An
       * account that had just been given a Dynamic address was downgraded to
       * MNEMONIC, posted a freshly derived address, and the server adopted it
       * over the one money had already been sent to.
       *
       * Refused here rather than fixed only in the app, because the build that
       * does it is already on people's phones and an update does not reach
       * them until their second launch.
       */
      const current = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletType: true },
      });

      if (current?.walletType === "EMBEDDED" && type === "MNEMONIC") {
        console.warn(`[WALLET] refused downgrade EMBEDDED -> MNEMONIC for user ${userId}`);
        res.status(409).json({
          error: "This account already has an email wallet.",
          code: "WALLET_DOWNGRADE_REFUSED",
          walletType: "EMBEDDED",
        });
        return;
      }

      await prisma.user.update({ where: { id: userId }, data: { walletType: type } });
      res.json({ message: "Wallet type saved", walletType: type });
    } catch (err) {
      console.error("Set wallet type error:", err);
      res.status(500).json({ error: "Failed to save wallet type" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /wallet/addresses
// Saves on-chain addresses to wallet rows (called after key derivation)
// ═══════════════════════════════════════════════════════════
const saveAddressesSchema = z.object({
  addresses: z.array(
    z.object({
      chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARB", "ARC", "TON", "MONAD"]),
      address: z.string().min(10).max(128),
    })
  ).min(1).max(10),
  // The email wallet's sign-in token: what proves a new address is this account's.
  dynamicToken: z.string().min(20).max(8000).optional(),
});

router.post("/addresses", requireAuth, requireActiveSession, validate(saveAddressesSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { addresses, dynamicToken } = req.body as { addresses: { chain: string; address: string }[]; dynamicToken?: string };

    // Read once: both the account's kind, which decides whether it may displace
    // an address at all, and whatever it has displaced before.
    const account = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletType: true, displacedAddresses: true, email: true },
    });

    /**
     * Only addresses this account can show are its own.
     *
     * This stored whatever the app sent, and an account pointed at a stranger's
     * funded wallet had that wallet's holdings recorded as its deposits by the
     * next balance sync. An address it already holds goes through untouched; a
     * new or different one must be proven by the email wallet's signed sign-in
     * token, or be the same key it already holds on another chain. See
     * lib/wallet-proof.
     */
    const heldRows = await prisma.wallet.findMany({
      where: { userId, address: { not: null } },
      select: { chain: true, address: true },
      distinct: ["chain"],
    });
    const held = heldRows.map((w) => ({ chain: w.chain as string, address: w.address! }));
    const byToken = await provenByToken(dynamicToken, account?.email ?? "");
    const byHeld = provenByHeld(held);
    const refused: { chain: string; address: string }[] = [];
    const accepted = addresses.filter(({ chain, address }) => {
      const current = held.find((w) => w.chain === chain)?.address;
      if (current && sameAddress(chain, current, address)) return true;
      if (isProven(byToken, chain, address) || isProven(byHeld, chain, address)) return true;
      refused.push({ chain, address });
      return false;
    });
    if (refused.length) {
      console.warn(
        `[WALLET] refused unproven address(es) for user ${userId}${dynamicToken ? (byToken ? "" : " (token did not verify for this account)") : " (no token)"}:`,
        refused.map((r) => `${r.chain} ${r.address}`).join(", "),
      );
    }
    const kind = account?.walletType ?? null;
    const displaced = (account?.displacedAddresses ?? []) as any[];

    // Update each wallet row with the address for its chain
    // Also create missing wallet records for native assets (e.g. SOL-SOL)
    const nativeAssets: Record<string, string[]> = {
      MOVE: ["MOVE"],
      SOL: ["SOL"],
      // Arc's native currency IS USDC, so the USDC row is the native row.
      ARC: ["USDC"],
    };

    // The wallet an account signs with can change exactly once in its life:
    // when it moves from the old derived wallet to the embedded one. Held
    // addresses were treated as immutable, which was right while every account
    // had one wallet forever - and wrong the moment migration gave them a new
    // one. A migrated account kept its April address here, signed with its new
    // one in the app, and every sell was refused as an address mismatch.
    for (const { chain, address } of accepted) {
      // Fill in anything not yet set. This is the ordinary case for a new
      // account and does not touch an address that already exists.
      await prisma.wallet.updateMany({
        where: { userId, chain: chain as Chain, address: null },
        data: { address },
      });

      const existingChainWallet = await prisma.wallet.findFirst({
        where: { userId, chain: chain as Chain, address: { not: null } },
        select: { address: true },
      });

      /**
       * The migration case: the app is presenting a different address for this
       * chain than the one on file. Adopt it, and say so in the log with both
       * addresses - the old one still holds whatever was in it, and someone may
       * need to find it again.
       *
       * Not gated on walletType: only three accounts of three hundred carry
       * that flag, and the rest would have been left signing with a wallet the
       * server refuses to recognise.
       *
       * An address can only ever be swapped for one the signed-in app derived,
       * and nothing moves without a signature from it, so a swapped address
       * cannot redirect funds - only change which wallet this account reads
       * and spends from.
       */
      const heldAddress = existingChainWallet?.address ?? null;
      const differs = !!heldAddress && heldAddress.toLowerCase() !== address.toLowerCase();

      /**
       * Only an email wallet may take over an address.
       *
       * Adoption exists for one journey - an old derived wallet moving to the
       * embedded one - and it was running in both directions, so the same code
       * that carried somebody forward also let a stray 12-word wallet overwrite
       * a Dynamic address that had already received money.
       *
       * The account's own type decides it: MNEMONIC cannot displace anything.
       * Nothing about this can strand funds on its own - an address that is not
       * adopted simply stays as it is - whereas the unguarded version could,
       * and did.
       */
      if (differs && kind === "MNEMONIC") {
        console.warn(
          `[WALLET] refused address change — user ${userId}, chain ${chain}, ` +
            `keeping ${heldAddress}, rejected ${address} (account is MNEMONIC)`,
        );
        continue;
      }

      if (differs) {
        console.warn(
          `[WALLET] address adopted — user ${userId}, chain ${chain}, was ${heldAddress}, now ${address}`,
        );

        /**
         * The displaced address, written down rather than only logged.
         *
         * It is the only pointer to money sent to the old one, and a log line
         * is not somewhere support can look months later. Best-effort: losing
         * the note must not stop the address being fixed.
         */
        await prisma.user
          .update({
            where: { id: userId },
            data: {
              displacedAddresses: [
                ...(Array.isArray(displaced) ? displaced : []),
                { chain, address: heldAddress, replacedBy: address, at: new Date().toISOString() },
              ].slice(-20),
            },
          })
          .catch((e) => console.error("[WALLET] could not record displaced address:", e?.message));

        await prisma.wallet.updateMany({
          where: { userId, chain: chain as Chain },
          data: { address, balance: 0 },
        });
      }

      const canonicalAddress = differs ? address : existingChainWallet?.address || address;

      // Ensure native asset wallet rows exist for this chain
      const natives = nativeAssets[chain];
      if (natives) {
        for (const asset of natives) {
          // upsert but never overwrite an existing address
          const existing = await prisma.wallet.findUnique({
            where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
            select: { address: true },
          });
          if (!existing) {
            await prisma.wallet.create({
              data: { userId, asset: asset as Asset, chain: chain as Chain, balance: 0, address: canonicalAddress },
            });
          } else if (!existing.address) {
            await prisma.wallet.update({
              where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
              data: { address: canonicalAddress },
            });
          }
        }
      }
    }

    if (refused.length) {
      res.status(403).json({
        error: "Some of these addresses couldn't be confirmed as this account's wallet.",
        code: "ADDRESS_NOT_PROVEN",
        saved: accepted.length,
        refused: refused.map((r) => r.chain),
      });
      return;
    }
    res.json({ message: "Addresses saved", count: accepted.length });
  } catch (err) {
    console.error("Save addresses error:", err);
    res.status(500).json({ error: "Failed to save addresses" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /wallet/sync
// Fetches on-chain balances for the user's addresses and
// updates the database, then returns the refreshed data.
// ═══════════════════════════════════════════════════════════
router.post("/sync", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const result = await syncAndReadWallets(req.user!.userId);
    res.json(result);
  } catch (err) {
    console.error("Sync balances error:", err);
    res.status(500).json({ error: "Failed to sync balances" });
  }
});

// ═══════════════════════════════════════════════════════════
// STELLAR — opened per coin, on first use
//
// Nothing exists on Stellar until the user picks it. The first time they
// pick USDC, the account is opened with a USDC trustline only; picking USDT
// later adds a USDT0 trustline and nothing else. The treasury pays the fee and
// sponsors the reserve, so the user's account starts, and stays, at zero XLM.
// ═══════════════════════════════════════════════════════════

/** The user's Stellar address, from their Solana row. */
async function stellarAddressFor(userId: string): Promise<string | null> {
  const sol = await prisma.wallet.findFirst({
    where: { userId, chain: "SOL", address: { not: null } },
    select: { address: true },
  });
  return sol?.address ? stellar.stellarAddressFromSolana(sol.address) : null;
}

// GET /wallet/stellar — address, and which coins are open
router.get("/stellar", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    if (!stellar.isStellarConfigured()) {
      res.json({ available: false });
      return;
    }
    const address = await stellarAddressFor(req.user!.userId);
    if (!address) {
      res.status(400).json({ error: "No wallet found to open Stellar on" });
      return;
    }
    const state = await stellar.getAccountState(address);
    res.json({ available: true, address, ...state });
  } catch (err: any) {
    console.error("[STELLAR] status failed:", err?.message);
    res.status(503).json({ error: "Could not reach Stellar. Try again." });
  }
});

const stellarActivateSchema = z.object({ coin: z.enum(["USDC", "USDT"]) });

// POST /wallet/stellar/activate/prepare — something to sign, or nothing to do
router.post(
  "/stellar/activate/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(stellarActivateSchema),
  async (req: Request, res: Response) => {
    try {
      if (!stellar.isStellarConfigured()) {
        res.status(503).json({ error: "Stellar is not available right now" });
        return;
      }
      const userId = req.user!.userId;
      const coin = req.body.coin as stellar.StellarCoin;
      const address = await stellarAddressFor(userId);
      if (!address) {
        res.status(400).json({ error: "No wallet found to open Stellar on" });
        return;
      }
      const activationId = `stellar-${userId}-${crypto.randomBytes(6).toString("hex")}`;
      const built = await stellar.prepareActivation(activationId, address, coin);
      if (!built) {
        // Already open for this coin; make sure the row exists so balances read.
        await prisma.wallet.upsert({
          where: { userId_asset_chain: { userId, asset: coin as Asset, chain: "STELLAR" } },
          create: { userId, asset: coin as Asset, chain: "STELLAR", balance: 0, address },
          update: { address },
        });
        res.json({ alreadyActive: true, address });
        return;
      }
      res.json({ activationId, signingMessage: built.signingMessage, address });
    } catch (err: any) {
      console.error("[STELLAR] activate prepare failed:", err?.message);
      res.status(err?.name === "StellarError" ? 400 : 503).json({
        error: err?.name === "StellarError" ? err.message : "Could not set up Stellar. Try again.",
      });
    }
  },
);

const stellarActivateSubmitSchema = z.object({
  activationId: z.string().min(1).max(100),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/, "Signature must be 64 bytes of hex"),
  coin: z.enum(["USDC", "USDT"]),
});

// POST /wallet/stellar/activate/submit — open it
router.post(
  "/stellar/activate/submit",
  requireAuth,
  requireActiveSession,
  validate(stellarActivateSubmitSchema),
  async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const { activationId, signature, coin } = req.body;
    // The id carries the user it was prepared for; nobody submits someone else's.
    if (!String(activationId).startsWith(`stellar-${userId}-`)) {
      res.status(404).json({ error: "That request expired. Please try again." });
      return;
    }
    try {
      const txHash = await stellar.submitActivation(activationId, signature);
      const address = await stellarAddressFor(userId);
      await prisma.wallet.upsert({
        where: { userId_asset_chain: { userId, asset: coin as Asset, chain: "STELLAR" } },
        create: { userId, asset: coin as Asset, chain: "STELLAR", balance: 0, address },
        update: { address },
      });
      console.log(`[STELLAR] opened ${coin} for ${userId} in ${txHash}`);
      res.json({ ok: true, address, txHash });
    } catch (err: any) {
      if (err?.name === "StellarRetry") {
        // Another activation took the treasury's sequence number first.
        // Nothing happened on chain; the app prepares and signs again.
        res.status(409).json({ error: err.message, retry: true });
        return;
      }
      console.error("[STELLAR] activate submit failed:", err?.message);
      res.status(err?.name === "StellarError" ? 400 : 503).json({
        error: err?.name === "StellarError" ? err.message : "Could not set up Stellar. Try again.",
      });
    }
  },
);

export default router;
