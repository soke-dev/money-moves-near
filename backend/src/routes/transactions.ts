import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  SOL_TRANSFERS_PER_DAY,
  SPONSORED_PER_HOUR,
  SPONSORED_PER_DAY,
} from "../lib/transfer-limits";
import { env } from "../config/env";
import { pauseGuard } from "../lib/service-status";
import {
  sweepQuote,
  sweepableBalances,
  sweepAllowance,
  validateSelection,
  withSweepLock,
  treasuryCanCover,
  supersedeOpenSweeps,
  exactSweepAmount,
  legId,
  SWEEP_DEST_ASSET,
  SWEEP_DEST_CHAIN,
  SWEEP_PER_WEEK,
  type SweepLeg,
} from "../lib/sweep";
import { sendTokensToUser } from "../lib/treasury";
import {
  activePayoutProvider,
  configured as payoutConfigured,
  providerOf,
  bankCodeByName,
  createPayout,
  getPayout,
  PAYOUT_LABELS,
} from "../lib/payout";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { validate } from "../middleware/validate";
import { sendNotification } from "../lib/push";
import { assetLabel } from "../lib/asset";
// Bachs is retired; only ngnAmount (a formatting helper) is still used.
import { ngnAmount } from "../lib/bach";
import {
  isFlutterwaveConfigured,
  flwBankCodeByName,
  flwCreateTransfer,
  flwGetTransfer,
  mapTransferStatus,
} from "../lib/flutterwave";

/**
 * Flutterwave references must be alphanumeric, 6-42 characters, and unique.
 * Ours carry punctuation ("trx_..."), so strip anything else out.
 *
 * Deterministic on purpose: the same transaction always yields the same payout
 * reference, so a retry after a network timeout is recognised as the SAME
 * transfer rather than sending the money a second time.
 */
function payoutReferenceFor(txReference: string): string {
  return txReference.replace(/[^a-zA-Z0-9]/g, "").slice(0, 42);
}
import { Prisma, Asset, Chain } from "@prisma/client";
import crypto from "crypto";
import { payoutNotice } from "../lib/payout-notice";
import {
  prepareMovementWithdrawal,
  submitMovementWithdrawal,
  prepareSolanaWithdrawal,
  submitSolanaWithdrawal,
  prepareEvmWithdrawal,
  submitEvmWithdrawal,
  prepareTonWithdrawal,
  submitTonWithdrawal,
} from "../lib/gas-sponsor";
import * as ton from "../lib/ton";
import * as stellar from "../lib/stellar";
import { sendWithdrawalSuccessEmail, sendTransferOutEmail, sendTransferInEmail, sendSellSuccessEmail, sendBusinessPaymentEmail } from "../lib/email";
import { getOnChainBalance } from "../lib/balances";
import { getLiveNgnRate } from "../lib/ngn-rate";
import { solanaSendFee } from "../lib/service-status";
import { publicNameOf } from "../lib/anon";
import { checkPayable, claimForSend, markPaid, releaseAfterFailure } from "./business-payments";

const router = Router();

// ─── Valid asset-chain combinations ─────────────────────────
const VALID_ASSET_CHAINS: Record<string, string[]> = {
  // ARC carries USDC only, and as the chain's own currency rather than a token.
  USDC: ["MOVE", "BASE", "SOL", "BEP20", "ARC", "STELLAR", "MONAD"],
  // TON carries USDT and nothing else: USDC is not issued there. On Stellar
  // and Monad "USDT" is USDT0, Tether's own deployment there.
  USDT: ["MOVE", "BASE", "SOL", "BEP20", "TON", "STELLAR", "MONAD"],
  USDCx: ["MOVE"],
  MOVE: ["MOVE"],
  SOL:  ["SOL"],
  // Issued on these two only. Without this every cNGN withdrawal, sell and
  // username transfer was refused as an invalid asset/chain combination -
  // the token was priced, held and listed, and could not be moved.
  cNGN: ["BASE", "BEP20"],
};

/**
 * How often one account may make us pay for a transfer.
 *
 * Every withdrawal except Arc is gas we buy. There was no ceiling on that at
 * all, and one account made sixty-three in three and a half hours - a 0.20
 * USDC transfer, the smallest the floor allows, sent to the same address over
 * and over. Each one cost the Solana gas wallet real SOL.
 *
 * Counted from the transactions table rather than from memory, so it survives
 * a restart and holds across however many instances are running. Generous
 * enough that nobody moving their own money will meet it: a person emptying a
 * wallet does it a handful of times, not thirty.
 */


/**
 * Solana, counted together and capped hard.
 *
 * Solana is the chain where a sponsored transfer can cost us rent rather than
 * a fraction of a cent, so it gets a ceiling of its own on top of the general
 * one. Withdrawals and username transfers share the count because they are the
 * same thing to the gas wallet - a transfer we pay for, to an address the
 * sender chose - and counting them apart would just mean twenty.
 *
 * Exported so the admin radar reads the same number the gate enforces.
 */
export async function solanaTransfersToday(userId: string): Promise<number> {
  return prisma.transaction.count({
    where: {
      userId,
      type: { in: ["WITHDRAW", "TRANSFER_OUT"] },
      chain: "SOL",
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });
}

async function solanaDayLimit(
  userId: string,
  chain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (chain !== "SOL") return { ok: true };
  const used = await solanaTransfersToday(userId);
  if (used >= SOL_TRANSFERS_PER_DAY) {
    return {
      ok: false,
      error: `You have used all ${SOL_TRANSFERS_PER_DAY} of today's Solana transfers. Try again tomorrow.`,
    };
  }
  return { ok: true };
}

async function sponsoredWithdrawalsLeft(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  const [lastHour, lastDay] = await Promise.all([
    prisma.transaction.count({
      where: {
        userId,
        type: "WITHDRAW",
        // Arc costs us nothing - the sender pays their own gas there.
        chain: { not: "ARC" },
        createdAt: { gte: new Date(now - 60 * 60_000) },
      },
    }),
    prisma.transaction.count({
      where: {
        userId,
        type: "WITHDRAW",
        chain: { not: "ARC" },
        createdAt: { gte: new Date(now - 24 * 60 * 60_000) },
      },
    }),
  ]);

  if (lastHour >= SPONSORED_PER_HOUR) {
    return { ok: false, error: "That is a lot of withdrawals in one hour. Try again a bit later." };
  }
  if (lastDay >= SPONSORED_PER_DAY) {
    return { ok: false, error: "You have reached today's withdrawal count. Try again tomorrow." };
  }
  return { ok: true };
}

// ─── Minimum withdrawal amounts per asset ──────────────────
const MIN_WITHDRAW: Record<string, number> = {
  USDC: 0.20,
  USDT: 0.20,
  USDCx: 0.20,
  MOVE: 0.10,
  SOL:  0.001,
  // A naira rather than a dollar, so the floor is counted in naira. 100 cNGN
  // is about 99 naira - the same order as the 0.20 USDC above, not the 0.20
  // cNGN that copying the dollar figure would have given.
  cNGN: 100,
};

// ─── Address format validators ──────────────────────────────
const EVM_REGEX = /^0x[0-9a-fA-F]{40}$/;
const SOL_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MOVE_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * The chains that share one key, and therefore one address.
 *
 * A row missing on a newly added EVM chain is not a missing wallet - the
 * person's Base address IS their Arc address. Movement and Solana are
 * different keys and must never stand in for one another.
 */
const EVM_CHAINS: Chain[] = ["BASE", "BEP20", "ARB", "ARC", "MONAD"];

/**
 * Does the address the client derived match the one we hold?
 *
 * The check exists to catch a tampered-with address being substituted for the
 * real sender, so it has to be exact - but "exact" differs by chain.
 *
 * EVM addresses are hex and case carries no meaning, so they compare folded.
 * A TON address is base64ish, case DOES carry meaning, and the same account
 * has three valid spellings (EQ, UQ and raw) that all have to be accepted -
 * folding case there would both accept wrong addresses and reject right ones.
 *
 * TON is also the one chain whose address the app cannot derive for itself,
 * so what it sends back is whatever the server told it earlier. Rather than
 * trust that, the expected value is re-derived here from the Solana address -
 * the one the app really does derive and really does verify.
 */
async function senderAddressMatches(
  userId: string,
  chain: string,
  claimed: string,
  stored: string,
): Promise<{ ok: boolean; expected: string }> {
  if (chain === "STELLAR") {
    // Re-derived from the Solana row, like TON. A G... address is base32 and
    // upper case by definition, so it compares exactly.
    const sol = await prisma.wallet.findFirst({
      where: { userId, chain: "SOL", address: { not: null } },
      select: { address: true },
    });
    const expected = sol?.address ? stellar.stellarAddressFromSolana(sol.address) : "";
    return { ok: !!expected && claimed === expected, expected };
  }
  if (chain !== "TON") {
    return {
      ok: claimed.toLowerCase() === stored.toLowerCase(),
      expected: stored,
    };
  }
  const sol = await prisma.wallet.findFirst({
    where: { userId, chain: "SOL", address: { not: null } },
    select: { address: true },
  });
  const expected = sol?.address ? ton.tonAddressFromSolana(sol.address) : "";
  return { ok: !!expected && ton.sameTonAddress(claimed, expected), expected };
}

function isValidChainAddress(address: string, chain: string): boolean {
  switch (chain) {
    case "BASE":
    case "BEP20":
    case "ARB":
    case "ARC":
    case "MONAD":
      return EVM_REGEX.test(address);
    case "SOL":
      return SOL_REGEX.test(address);
    case "MOVE":
      return MOVE_REGEX.test(address);
    case "TON":
      // Not a regex. A TON address has three written forms - EQ..., UQ... and
      // raw 0:<hex> - that all name the same account and differ only in flags,
      // and the friendly ones carry a checksum worth actually verifying.
      return ton.isValidTonAddress(address);
    case "STELLAR":
      // G... with its checksum verified. Muxed M... addresses are not taken;
      // an exchange deposit goes as G... plus a memo.
      return stellar.isValidStellarAddress(address);
    default:
      return false;
  }
}

// ─── Schemas ────────────────────────────────────────────────
const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  type: z.enum(["DEPOSIT", "WITHDRAW", "BUY", "SELL", "TRANSFER", "AIRTIME", "TV", "LOCK", "UNLOCK"]).optional(),
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]).optional(),
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]).optional(),
});

// ═══════════════════════════════════════════════════════════
// GET /transactions
// Paginated, filterable transaction list
// ═══════════════════════════════════════════════════════════
router.get("/", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { page, limit, type, asset, status } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {
      userId,
      ...(type && { type }),
      ...(asset && { asset }),
      ...(status && { status }),
    };

    /**
     * Money that arrived and was not delivered, shown as what it is.
     *
     * A held deposit writes no transaction - the coin never moved, and the
     * row that would represent it is the one the delivery path creates when
     * it does. So a person whose naira was taken and held saw nothing at all
     * in their history: the worst possible moment to have nothing to point
     * at, because the money is gone from their bank and absent here.
     *
     * These are read straight off the funding intents and shaped like
     * transactions. Nothing is written, so the delivery path and its
     * reference-is-the-lock idempotency are untouched; when a hold is
     * released the real row appears and the intent stops being HELD, so the
     * two never both show.
     *
     * Page one only. They are few and they are recent, and merging two
     * sources across every page means either repeating rows or dropping them.
     */
    const held =
      page === 1 && !type && !asset
        ? await prisma.fundingIntent.findMany({
            where: { userId, status: { in: ["HELD", "REFUNDED"] } },
            orderBy: { createdAt: "desc" },
            take: 20,
          })
        : [];

    const heldRows = held
      .filter((i) => !status || (i.status === "REFUNDED" ? status === "REFUNDED" : status === "PROCESSING"))
      .map((i) => ({
        id: i.id,
        type: "BUY",
        asset: i.token,
        chain: i.chain,
        amount: i.convertedAmount,
        fee: null,
        // Under review is in flight, not failed: the naira is ours and the
        // buyer is owed either the coin or it back.
        status: i.status === "REFUNDED" ? "REFUNDED" : "PROCESSING",
        reference: i.reference,
        metadata: {
          amountNaira: Number(i.amountNaira),
          liveRateNgn: i.rate ? Number(i.rate) : null,
          heldForReview: i.status === "HELD",
          holdReason: i.holdReason,
          senderName: i.senderName,
          senderBank: i.senderBank,
          // The line the person waiting is meant to read.
          reviewNote:
            i.status === "REFUNDED"
              ? "This deposit was returned to the account it came from."
              : `${i.holdReason ?? "Name mismatch."} This deposit is under review and will be refunded if we cannot confirm it. Contact support if you think this is a mistake.`,
        },
        createdAt: i.createdAt,
      }));

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        select: {
          id: true,
          type: true,
          asset: true,
          chain: true,
          amount: true,
          fee: true,
          status: true,
          reference: true,
          metadata: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    // Reconcile anything still showing PROCESSING before returning it. Capped,
    // and only ever a handful in practice, since a settled row stops matching.
    const stuck = transactions
      .filter((t) => t.type === "SELL" && t.status === "PROCESSING")
      .slice(0, 5);

    if (stuck.length > 0) {
      const settled = await Promise.all(
        stuck.map((t) => syncSellPayout({ ...t, userId }).catch(() => null))
      );
      settled.forEach((status, i) => {
        if (status) {
          const row = transactions.find((t) => t.id === stuck[i].id);
          if (row) (row as any).status = status;
        }
      });
    }

    /**
     * Merged by date, so a held deposit sits where it happened rather than
     * being bolted to the top as a notice. It is a transaction from the
     * person's point of view - their money left their bank - and it should
     * read like the rest of their history.
     */
    const merged = [...heldRows, ...transactions].sort(
      (a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime(),
    );

    res.json({
      transactions: merged,
      pagination: {
        page,
        limit,
        total: total + heldRows.length,
        pages: Math.ceil((total + heldRows.length) / limit),
      },
    });
  } catch (err) {
    console.error("List transactions error:", err);
    res.status(500).json({ error: "Failed to get transactions" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /transactions/:id
// Single transaction detail
// ═══════════════════════════════════════════════════════════
router.get("/:id", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    /**
     * A held deposit has no transaction row, so its id is a funding intent's.
     * Without this the row the list just showed opens on "not found", which is
     * a worse place to land than not showing it at all.
     */
    const intent = await prisma.fundingIntent.findFirst({
      where: { id: String(req.params.id), userId, status: { in: ["HELD", "REFUNDED"] } },
    });
    if (intent) {
      res.json({
        transaction: {
          id: intent.id,
          type: "BUY",
          asset: intent.token,
          chain: intent.chain,
          amount: intent.convertedAmount,
          fee: null,
          status: intent.status === "REFUNDED" ? "REFUNDED" : "PROCESSING",
          reference: intent.reference,
          metadata: {
            amountNaira: Number(intent.amountNaira),
            liveRateNgn: intent.rate ? Number(intent.rate) : null,
            heldForReview: intent.status === "HELD",
            holdReason: intent.holdReason,
            senderName: intent.senderName,
            senderBank: intent.senderBank,
            reviewNote:
              intent.status === "REFUNDED"
                ? "This deposit was returned to the account it came from."
                : `${intent.holdReason ?? "Name mismatch."} This deposit is under review and will be refunded if we cannot confirm it. Contact support if you think this is a mistake.`,
          },
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
        },
      });
      return;
    }
    const id = req.params.id as string;

    const tx = await prisma.transaction.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        asset: true,
        chain: true,
        amount: true,
        fee: true,
        status: true,
        reference: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
      },
    });

    if (!tx || tx.userId !== userId) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }

    // Strip userId from response
    const { userId: _uid, ...txData } = tx;
    res.json({ transaction: txData });
  } catch (err) {
    console.error("Get transaction error:", err);
    res.status(500).json({ error: "Failed to get transaction" });
  }
});

// ─── Withdraw / Transfer Schemas ────────────────────────────
const withdrawSchema = z.object({
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  amount: z.number().positive(),
  address: z.string().min(10).max(100),
}).refine(
  (d) => VALID_ASSET_CHAINS[d.asset]?.includes(d.chain),
  { message: "Invalid asset/chain combination" }
);

const bankTransferSchema = z.object({
  amount: z.number().positive(),
  bankName: z.string().min(2).max(100),
  accountNumber: z.string().regex(/^\d{10}$/),
  accountName: z.string().min(2).max(100),
  narration: z.string().max(200).optional(),
  saveBeneficiary: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════
// POST /transactions/withdraw
// DISABLED — legacy endpoint that deducted DB balance without on-chain transfer.
// Use the 2-phase withdraw/prepare + withdraw/submit flow instead.
// ═══════════════════════════════════════════════════════════
router.post(
  "/withdraw",
  requireAuth,
  requireActiveSession,
  async (_req: Request, res: Response) => {
    res.status(410).json({ error: "This endpoint is deprecated. Use withdraw/prepare + withdraw/submit." });
  }
);

// ═══════════════════════════════════════════════════════════
// POST /transactions/withdraw/prepare
// Phase 1: Build tx, sponsor gas, return signing message
// ═══════════════════════════════════════════════════════════
const withdrawPrepareSchema = z.object({
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  amount: z.number().positive(),
  address: z.string().min(10).max(100),
  senderAddress: z.string().min(10).max(128).optional(), // client-derived address for tamper check
  // Stellar only: what an exchange asks for to credit the right account.
  memo: z.string().max(64).optional(),
  // Paying a checkout on Money Moves Business: the send is held to what it asked for.
  payRequestId: z.string().min(1).max(64).optional(),
}).refine(
  (d) => VALID_ASSET_CHAINS[d.asset]?.includes(d.chain),
  { message: "Invalid asset/chain combination" }
);

router.post(
  "/withdraw/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(withdrawPrepareSchema),
  async (req: Request, res: Response) => {
    try {
      // ── Pause gate ──────────────────────────────────────
      const withdrawPaused = await pauseGuard("withdraw");
      if (withdrawPaused) {
        res.status(503).json({ error: withdrawPaused, paused: true, service: "withdraw" });
        return;
      }

      const userId = req.user!.userId;
      const { asset, chain, amount, address } = req.body;

      if (!isValidChainAddress(address, chain)) {
        res.status(400).json({ error: `Invalid wallet address for ${chain} network` });
        return;
      }

      // Paying a business's checkout: exactly the amount and address it asked for, or nothing is built.
      let paying: { id: string; businessName: string; paymentRef: string; title: string | null; priceLabel: string | null } | null = null;
      if (req.body.payRequestId) {
        const check = await checkPayable(userId, req.body.payRequestId, { asset, chain, amount, address });
        if (!check.ok) {
          res.status(check.status).json({ error: check.error });
          return;
        }
        paying = check.payment;
      }

      // Enforce minimum withdrawal amount. A checkout has its own floor, set by the business side.
      const minAmount = MIN_WITHDRAW[asset] ?? 0.01;
      if (!paying && amount < minAmount) {
        res.status(400).json({ error: `Minimum withdrawal is ${minAmount} ${asset}` });
        return;
      }

      // Checked before anything is built, because preparing is what reserves a
      // sponsored transaction in the first place.
      const allowance = await sponsoredWithdrawalsLeft(userId);
      if (!allowance.ok) {
        console.warn(`[WITHDRAW] rate limited ${userId}`);
        res.status(429).json({ error: allowance.error });
        return;
      }

      const solDay = await solanaDayLimit(userId, chain);
      if (!solDay.ok) {
        console.warn(`[WITHDRAW] Solana day cap hit by ${userId}`);
        res.status(429).json({ error: solDay.error });
        return;
      }

      // Lookup user's on-chain address for this chain
      let wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset, chain } },
      });
      // Fallback: for native assets (SOL, MOVE) the wallet row may not exist yet — find any wallet on the same chain
      if (!wallet?.address) {
        const fallback = await prisma.wallet.findFirst({
          // One key across EVM, so a row missing on a new chain is not a
          // missing wallet.
          where: { userId, chain: EVM_CHAINS.includes(chain as Chain) ? { in: EVM_CHAINS } : (chain as Chain), address: { not: null } },
        });
        if (fallback?.address) {
          // Auto-create the missing wallet record
          wallet = await prisma.wallet.upsert({
            where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
            update: { address: fallback.address },
            create: { userId, asset: asset as Asset, chain: chain as Chain, balance: 0, address: fallback.address },
          });
        }
      }
      if (!wallet?.address) {
        res.status(400).json({ error: "No wallet address found for this chain" });
        return;
      }

      // Cross-check client-derived address against DB to detect tampering
      const { senderAddress } = req.body;
      if (senderAddress) {
        /**
         * On TON the client sends its SOLANA address, and that is the one to
         * check.
         *
         * A TON address cannot be derived in the app - it needs the wallet
         * contract's code to hash, which would mean a TON library in the
         * bundle for one comparison. But a TON address is a pure function of
         * the Solana public key, and that address the app does derive. So
         * verifying the Solana row verifies the TON one that comes out of it,
         * and the row below is the very one prepare derives from.
         *
         * Compared exactly, not case-insensitively: the friendly TON and
         * Solana forms are both base64ish and case carries meaning in them,
         * unlike the hex of an EVM address.
         */
        const { ok: matches, expected } = await senderAddressMatches(
          userId, chain, senderAddress, wallet.address,
        );
        if (!matches) {
          console.error(
            `[WITHDRAW] ⚠️ ADDRESS MISMATCH — user ${userId}, chain ${chain}, DB: ${expected}, client: ${senderAddress}`
          );
          res.status(409).json({ error: "Wallet address mismatch detected. Withdrawal blocked for security." });
          return;
        }
      }

      const fee = 0;

      // Verify actual on-chain balance before creating pending tx.
      let onChainBalance: number;
      try {
        onChainBalance = await getOnChainBalance(asset, chain, wallet.address);
      } catch (err: any) {
        console.error(`[WITHDRAW] on-chain balance check failed: ${err.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }
      /**
       * The Solana send charge, if it is switched on.
       *
       * Only the stablecoins, and only this flow and the username one -
       * selling and bills are untouched. Zero whenever the switch is off,
       * which is how it ships.
       */
      const sendFee =
        chain === "SOL" && (asset === "USDC" || asset === "USDT")
          ? await solanaSendFee()
          : 0;

      // Both must fit, or the transfer reverts on chain having cost the
      // sponsor a signature for nothing.
      if (onChainBalance < amount + sendFee) {
        res.status(400).json({
          error: sendFee
            ? `Insufficient balance. This send also carries a ${sendFee} ${assetLabel(asset)} fee.`
            : "Insufficient on-chain balance",
        });
        return;
      }

      // Create PENDING withdrawal
      const reference = `WDR-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: "WITHDRAW",
          asset: asset as Asset,
          chain: chain as Chain,
          amount,
          fee,
          status: "PENDING",
          reference,
          metadata: {
            address,
            networkChain: chain,
            senderAddress: wallet.address,
            // A checkout paid: who, what for, and the business's own reference - so the receipt says so.
            ...(paying
              ? { businessPaymentId: paying.id, payee: paying.businessName, payeeRef: paying.paymentRef, ...(paying.title ? { payFor: paying.title } : {}), ...(paying.priceLabel ? { priceLabel: paying.priceLabel } : {}) }
              : {}),
          },
        },
      });

      /**
       * Remember the destination so the Recent list fills itself.
       *
       * Recorded here rather than on completion: an address the user committed
       * to sending to belongs in Recent whether or not the chain later accepts
       * it, and this point cannot be missed by a dropped webhook. Wrapped
       * because address bookkeeping must never fail a withdrawal.
       */
      // A business's checkout address isn't someone they send to, so it stays out of Recent.
      if (!paying) prisma.cryptoContact
        .upsert({
          where: { userId_address_chain: { userId, address, chain } },
          create: { userId, address, chain },
          update: { lastUsedAt: new Date() },
        })
        .catch((err) => console.warn("[WITHDRAW] could not record address:", err?.message));

      // Build tx and get sponsored signing message
      if (chain === "MOVE") {
        const { signingMessage } = await prepareMovementWithdrawal(
          transaction.id,
          wallet.address,
          address,
          amount,
          asset as "MOVE" | "USDC" | "USDT" | "USDCx"
        );

        res.json({
          withdrawalId: transaction.id,
          signingMessage,
          chain,
        });
      } else if (chain === "SOL") {
        const { signingMessage } = await prepareSolanaWithdrawal(
          transaction.id,
          wallet.address,
          address,
          amount,
          asset as "USDC" | "USDT" | "SOL",
          sendFee,
        );

        res.json({
          withdrawalId: transaction.id,
          signingMessage,
          chain,
          // Zero unless the Solana charge is switched on, so the screen can
          // name it rather than leaving it to be noticed in the balance.
          sendFee,
        });
      } else if (chain === "TON") {
        /**
         * Named by the Solana address, not the TON one.
         *
         * A TON address is a hash of the wallet code and the public key, so
         * it cannot be turned back into the key that has to sign - and the
         * key is the Ed25519 one Solana and Movement already share. The TON
         * address is derived from it inside prepare, which also means the two
         * can never disagree.
         */
        const solWallet = await prisma.wallet.findFirst({
          where: { userId, chain: "SOL", address: { not: null } },
          select: { address: true },
        });
        if (!solWallet?.address) {
          res.status(400).json({ error: "No Solana key found to derive the TON wallet from" });
          return;
        }

        const { signingMessage, commission } = await prepareTonWithdrawal(
          transaction.id,
          solWallet.address,
          address,
          amount,
          asset as "USDT"
        );

        res.json({
          withdrawalId: transaction.id,
          signingMessage,
          chain,
          // What the relay will take out of the same USDT, so the app can say
          // so rather than leaving the user to notice the difference.
          relayFee: commission,
        });
      } else if (chain === "STELLAR") {
        // The user's own account is the source; the treasury fee-bumps it at
        // submit, so they need no XLM. The destination is checked for an open
        // account and trustline inside, with the refusal in words.
        const memo = typeof req.body.memo === "string" ? req.body.memo : null;
        if (memo) {
          await prisma.transaction.update({
            where: { id: transaction.id },
            data: { metadata: { address, networkChain: chain, senderAddress: wallet.address, memo } },
          });
        }
        const { signingMessage } = await stellar.preparePayment(transaction.id, {
          from: wallet.address,
          to: address,
          coin: asset as stellar.StellarCoin,
          amount,
          memo,
        });
        res.json({ withdrawalId: transaction.id, signingMessage, chain });
      } else if (EVM_CHAINS.includes(chain as Chain)) {
        const { signingMessage, txRequest } = await prepareEvmWithdrawal(
          transaction.id,
          wallet.address,
          address,
          amount,
          asset as "USDC" | "USDT" | "ETH",
          chain as "BASE" | "BEP20" | "ARB"
        );

        res.json({
          withdrawalId: transaction.id,
          signingMessage,
          // Only MPC wallets use this; key-holding wallets sign the hash above.
          txRequest,
          chain,
        });
      } else {
        res.status(400).json({ error: `Unsupported chain: ${chain}` });
      }
    } catch (err: any) {
      console.error("Withdraw prepare error:", err);
      const msg = err?.message || "";
      if (msg.includes("Insufficient")) {
        res.status(400).json({ error: "Insufficient balance for this withdrawal" });
      } else if (err?.name === "AtaRentRefused") {
        // Says what is wrong with the destination and what to do about it.
        // Behind the generic message it would read as our outage.
        res.status(400).json({ error: msg });
      } else if (msg.includes("Unsupported asset") || err?.name === "StellarError") {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: "Failed to prepare withdrawal" });
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /transactions/withdraw/submit
// Phase 2: Receive user signature, submit on-chain
// ═══════════════════════════════════════════════════════════
const withdrawSubmitSchema = z.object({
  withdrawalId: z.string().min(1),
  // Empty is allowed because an MPC wallet signs the whole transaction instead
  // of a hash and sends `signedRaw`; the refine below insists on one or the
  // other, so a request carrying neither is still rejected.
  signature: z.string().regex(/^[0-9a-fA-F]*$/, "Signature must be hex").default(""),
  publicKey: z.string().regex(/^[0-9a-fA-F]*$/, "Public key must be hex").default(""),
  signedRaw: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Signed transaction must be 0x-prefixed hex")
    .optional(),
})
  // One or the other must be present. Without this, `signature` defaulting to ""
  // would let a request carrying no proof at all pass validation.
  .refine((v) => !!v.signedRaw || (v.signature.length > 0 && v.publicKey.length > 0), {
    message: "A signature or a signed transaction is required",
  });

router.post(
  "/withdraw/submit",
  requireAuth,
  requireActiveSession,
  validate(withdrawSubmitSchema),
  async (req: Request, res: Response) => {
    // A business's checkout this send took on, released again if the send fails.
    let paymentClaimed: string | null = null;
    try {
      // ── Pause gate ──────────────────────────────────────
      const withdrawPaused = await pauseGuard("withdraw");
      if (withdrawPaused) {
        res.status(503).json({ error: withdrawPaused, paused: true, service: "withdraw" });
        return;
      }

      const userId = req.user!.userId;
      const { withdrawalId, signature, publicKey, signedRaw } = req.body;

      // Atomically claim the PENDING tx to prevent double-submit race condition
      const claimResult = await prisma.transaction.updateMany({
        where: { id: withdrawalId, userId, status: "PENDING" },
        data: { status: "PROCESSING" },
      });
      if (claimResult.count === 0) {
        // Either tx not found, wrong user, or already processed
        const existing = await prisma.transaction.findUnique({ where: { id: withdrawalId } });
        if (!existing || existing.userId !== userId) {
          res.status(404).json({ error: "Transaction not found" });
        } else {
          res.status(400).json({ error: "Transaction already processed" });
        }
        return;
      }
      const tx = await prisma.transaction.findUnique({ where: { id: withdrawalId } });
      if (!tx) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }

      // Paying a business: taken now, before anything is broadcast, so it can't be paid twice.
      const businessPaymentId = (tx.metadata as any)?.businessPaymentId as string | undefined;
      const payee = (tx.metadata as any)?.payee as string | undefined;
      if (businessPaymentId) {
        if (!(await claimForSend(businessPaymentId, userId, tx.id))) {
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { status: "CANCELLED", metadata: { ...(tx.metadata as any), chainError: "The payment closed before it was sent" } },
          });
          res.status(409).json({ error: "This payment isn't waiting any more. Nothing was sent." });
          return;
        }
        paymentClaimed = businessPaymentId;
      }

      let txHash: string;
      if (tx.chain === "MOVE") {
        txHash = await submitMovementWithdrawal(withdrawalId, signature, publicKey);
      } else if (tx.chain === "SOL") {
        txHash = await submitSolanaWithdrawal(withdrawalId, signature, publicKey);
      } else if (tx.chain === "TON") {
        // No public key: the relay already has it from prepare, and the wallet
        // is rebuilt from the key stored against this request rather than from
        // whatever the client sends back.
        txHash = await submitTonWithdrawal(withdrawalId, signature);
      } else if (tx.chain === "STELLAR") {
        // Horizon answers after the ledger closes, so a hash means it moved.
        txHash = await stellar.submitPayment(withdrawalId, signature);
      } else if (EVM_CHAINS.includes(tx.chain as Chain)) {
        txHash = await submitEvmWithdrawal(withdrawalId, signature, publicKey, signedRaw);
      } else {
        res.status(400).json({ error: `Submit not supported for ${tx.chain}` });
        return;
      }

      // Mark completed and deduct balance
      const totalDebit = Number(tx.amount);
      const [updatedTx] = await prisma.$transaction([
        prisma.transaction.update({
          where: { id: withdrawalId },
          data: {
            status: "COMPLETED",
            metadata: { ...(tx.metadata as any), txHash },
          },
        }),
        prisma.wallet.update({
          where: { userId_asset_chain: { userId, asset: tx.asset, chain: tx.chain! } },
          data: { balance: { decrement: totalDebit } },
        }),
      ]);
      if (businessPaymentId) {
        // On chain now: the business reads it as paid at its next look.
        await markPaid(businessPaymentId, { chain: tx.chain!, asset: tx.asset, txHash }).catch((e) =>
          console.error(`[WITHDRAW] paid business payment ${businessPaymentId} but couldn't mark it:`, e),
        );
        paymentClaimed = null;
      }

      res.json({
        transaction: {
          id: updatedTx.id,
          type: updatedTx.type,
          asset: updatedTx.asset,
          chain: updatedTx.chain,
          amount: updatedTx.amount,
          fee: updatedTx.fee,
          status: updatedTx.status,
          reference: updatedTx.reference,
          metadata: updatedTx.metadata,
          createdAt: updatedTx.createdAt,
        },
      });

      // Send withdrawal confirmation email (fire-and-forget)
      const withdrawUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
      // Paying a business: a receipt that names it, not a "withdrawal".
      if (withdrawUser?.email && businessPaymentId) {
        const meta = (updatedTx.metadata as any) || {};
        sendBusinessPaymentEmail(withdrawUser.email, {
          payee: payee || "the business",
          amount: String(updatedTx.amount),
          asset: assetLabel(updatedTx.asset),
          chain: updatedTx.chain || "",
          txHash: txHash || null,
          reference: updatedTx.reference || "",
          checkoutRef: meta.payeeRef || null,
          payFor: meta.payFor || null,
          priceLabel: meta.priceLabel || null,
          date: new Date().toLocaleString(),
        }).catch((e) => console.error("Business payment email failed:", e));
      }
      if (withdrawUser?.email && !businessPaymentId) {
        const meta = (updatedTx.metadata as any) || {};
        sendWithdrawalSuccessEmail(withdrawUser.email, {
          amount: String(updatedTx.amount),
          asset: assetLabel(updatedTx.asset),
          chain: updatedTx.chain || "",
          address: meta.address || "",
          txHash: txHash || null,
          reference: updatedTx.reference || "",
          date: new Date().toLocaleString(),
        }).catch((e) => console.error("Withdrawal email failed:", e));
      }

      // Notify the sender that their withdrawal went through (fire-and-forget)
      sendNotification({
        userId,
        type: "transaction",
        title: businessPaymentId ? `Paid ${payee || "the business"}` : "Withdrawal Sent",
        body: businessPaymentId
          ? `You paid ${Number(updatedTx.amount).toFixed(2)} ${assetLabel(updatedTx.asset)} to ${payee || "the business"}`
          : `You sent ${Number(updatedTx.amount).toFixed(4)} ${assetLabel(updatedTx.asset)} on ${updatedTx.chain}`,
      }).catch(() => {});

      // ── If destination address belongs to a Money Moves user, credit them ──
      const destAddress = ((tx.metadata as any)?.address || "").toLowerCase();
      if (destAddress && tx.chain) {
        const recipientWallet = await prisma.wallet.findFirst({
          where: {
            asset: tx.asset,
            chain: tx.chain as Chain,
            address: { equals: destAddress, mode: "insensitive" },
            userId: { not: userId }, // not the sender
          },
          select: { userId: true },
        });
        if (recipientWallet) {
          const depositRef = `DEP-${Date.now().toString(36).slice(-8)}-${crypto.randomBytes(3).toString("hex")}`;
          await prisma.$transaction([
            prisma.transaction.create({
              data: {
                userId: recipientWallet.userId,
                type: "DEPOSIT",
                asset: tx.asset,
                chain: tx.chain as Chain,
                amount: Number(tx.amount),
                fee: 0,
                status: "COMPLETED",
                reference: depositRef,
                metadata: {
                  fromAddress: ((await prisma.wallet.findUnique({
                    where: { userId_asset_chain: { userId, asset: tx.asset, chain: tx.chain as Chain } },
                    select: { address: true },
                  }))?.address) || "",
                  fromUsername: withdrawUser?.username || null,
                  txHash,
                  source: "internal_withdraw",
                },
              },
            }),
            prisma.wallet.update({
              where: { userId_asset_chain: { userId: recipientWallet.userId, asset: tx.asset, chain: tx.chain as Chain } },
              data: { balance: { increment: Number(tx.amount) } },
            }),
          ]).catch((e) => console.error("[WITHDRAW] Recipient deposit record failed:", e));

          // Notify recipient
          sendNotification({
            userId: recipientWallet.userId,
            type: "transaction",
            title: "Crypto Received",
            body: `You received ${Number(tx.amount).toFixed(4)} ${assetLabel(tx.asset)} on ${tx.chain}`,
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      console.error("Withdraw submit error:", err);
      if (paymentClaimed) await releaseAfterFailure(paymentClaimed, err?.txHash).catch(() => {});

      // If on-chain failed, mark as FAILED (only if still PROCESSING).
      // If broadcast succeeded but confirmation failed, the chain helper
      // attaches `txHash` to the error — preserve it in metadata so admins
      // can look it up on the explorer.
      if (req.body?.withdrawalId) {
        const failedHash = err?.txHash;
        const existing = await prisma.transaction.findUnique({
          where: { id: req.body.withdrawalId },
          select: { metadata: true, status: true },
        }).catch(() => null);
        if (existing && existing.status === "PROCESSING") {
          await prisma.transaction.update({
            where: { id: req.body.withdrawalId },
            data: {
              status: "FAILED",
              metadata: {
                ...((existing.metadata as any) || {}),
                ...(failedHash ? { txHash: failedHash } : {}),
                chainError: err?.message || "On-chain submit failed",
              },
            },
          }).catch(() => {});
        }
      }

      res.status(500).json({ error: err.message || "Failed to submit withdrawal" });
    }
  }
);

// ─── Sell (Offramp) — user sends crypto, receives NGN to bank ─────────

const SELL_FEE_RATE = 0.005; // 0.5%
const SELL_PROCESSING_FEE = 50; // ₦50 flat processing fee, applied to all sells

// ─── Signed sell quote ──────────────────────────────────────
// Backend mints a quote (rate locked, math done server-side, HMAC-signed),
// client passes it back on /sell/prepare. Eliminates rate drift between
// summary screen and Paystack payout: bank receives exactly the net the
// user agreed to.
const QUOTE_TTL_MS = 60_000;
const QUOTE_VERSION = 1;

type SellQuote = {
  v: number;
  userId: string;
  asset: "USDC" | "USDT" | "MOVE" | "SOL";
  chain: "MOVE" | "BASE" | "SOL" | "BEP20";
  amount: number;     // crypto to send on-chain
  ngnRate: number;
  ngnGross: number;
  ngnFee: number;
  ngnNet: number;     // exact amount Paystack will pay out
  expiresAt: number;  // ms epoch
};

function quoteSecret(): string {
  return env.SELL_QUOTE_SECRET || env.JWT_ACCESS_SECRET;
}

function canonicalizeQuote(q: SellQuote): string {
  return JSON.stringify({
    v: q.v, userId: q.userId, asset: q.asset, chain: q.chain,
    amount: q.amount, ngnRate: q.ngnRate, ngnGross: q.ngnGross,
    ngnFee: q.ngnFee, ngnNet: q.ngnNet, expiresAt: q.expiresAt,
  });
}

function signQuote(q: SellQuote): string {
  return crypto.createHmac("sha256", quoteSecret()).update(canonicalizeQuote(q)).digest("hex");
}

function verifyQuoteSig(q: SellQuote, sig: string): boolean {
  const expected = signQuote(q);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

// Find the smallest integer gross such that round(gross - fee) >= desiredNet.
// Mirrors the client solver so a user typing ₦60,000 always receives ≥ ₦60,000.
function solveSellQuote(desiredNetNgn: number, ngnRate: number) {
  const netAt = (g: number) => {
    const pct = Math.round(g * SELL_FEE_RATE);
    return Math.round(g - pct - SELL_PROCESSING_FEE);
  };
  let g = Math.ceil((desiredNetNgn + SELL_PROCESSING_FEE) / (1 - SELL_FEE_RATE));
  let safety = 200;
  while (safety-- > 0 && netAt(g) < desiredNetNgn) g++;
  safety = 200;
  while (safety-- > 0 && g > 1 && netAt(g - 1) >= desiredNetNgn) g--;
  const percentFee = Math.round(g * SELL_FEE_RATE);
  const fee = percentFee + SELL_PROCESSING_FEE;
  const ngnNet = Math.round(g - fee);
  const amount = g / ngnRate;
  return { grossNgn: g, fee, ngnNet, amount };
}

// Sell limits (NGN) — same structure as funding.
//
// The daily figure is summed from SELL transactions whose status is COMPLETED
// or PROCESSING. PENDING is deliberately excluded: prepare writes a PENDING row
// before the user signs and submit is what turns it into PROCESSING, so a
// PENDING row is a sale that was abandoned, not one that spent anything.
const SELL_PER_TX_KYC    = 500_000;
const SELL_DAILY_KYC     = 2_000_000;
const SELL_PER_TX_NO_KYC = 10_000;
const SELL_DAILY_NO_KYC  = 20_000;

// Sell treasury addresses per chain
function getSellTreasury(chain: string): string {
  switch (chain) {
    case "BASE":
    case "BEP20":
    // Arc is EVM, so the same address receives there. It arrives as native
    // USDC rather than a token - and because USDC is also Arc's gas, the
    // treasury is self-funding: what it receives is what it spends to move on.
    case "ARC":
    // Monad is EVM too: the same address, receiving USDC or USDT0 as tokens.
    case "MONAD":
      return env.SELL_EVM_ADDRESS;
    case "MOVE":
      return env.SELL_MOVEMENT_ADDRESS;
    case "SOL":
      return env.SELL_SOLANA_ADDRESS;
    case "TON":
      return env.SELL_TON_ADDRESS;
    case "STELLAR":
      // The treasury unless SELL_STELLAR_ADDRESS says otherwise; blank (and so
      // refused) while Stellar is not configured.
      return stellar.sellAddress() ?? "";
    default:
      return "";
  }
}

// ═══════════════════════════════════════════════════════════
// POST /transactions/sell/quote
// Mints a signed quote: backend solves for crypto amount + fee + net at the
// current live rate, signs it, returns it. Client passes the signed quote
// back on /sell/prepare so the bank payout matches what the user saw.
// ═══════════════════════════════════════════════════════════
const sellQuoteSchema = z.object({
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  desiredNetNgn: z.number().int().positive(),
}).refine(
  (d) => VALID_ASSET_CHAINS[d.asset]?.includes(d.chain),
  { message: "Invalid asset/chain combination" }
);

router.post(
  "/sell/quote",
  requireAuth,
  requireActiveSession,
  validate(sellQuoteSchema),
  async (req: Request, res: Response) => {
    try {
      const bankPaused = await pauseGuard("bank");
      if (bankPaused) {
        res.status(503).json({ error: bankPaused, paused: true, service: "bank" });
        return;
      }
      const userId = req.user!.userId;
      const { asset, chain, desiredNetNgn } = req.body;

      const ngnRate = await getLiveNgnRate(asset);
      if (!ngnRate || ngnRate <= 0) {
        res.status(503).json({ error: "Exchange rate unavailable. Please try again." });
        return;
      }

      const { grossNgn, fee, ngnNet, amount } = solveSellQuote(desiredNetNgn, ngnRate);

      const quote: SellQuote = {
        v: QUOTE_VERSION,
        userId,
        asset,
        chain,
        amount,
        ngnRate,
        ngnGross: grossNgn,
        ngnFee: fee,
        ngnNet,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      };

      res.json({ quote, signature: signQuote(quote) });
    } catch (err: any) {
      console.error("[SELL/QUOTE] error:", err);
      res.status(500).json({ error: "Failed to generate quote" });
    }
  }
);

const sellQuoteShape = z.object({
  v: z.number().int(),
  userId: z.string().min(1),
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  amount: z.number().positive(),
  ngnRate: z.number().positive(),
  ngnGross: z.number().positive(),
  ngnFee: z.number().nonnegative(),
  ngnNet: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

const sellPrepareSchema = z.object({
  // New signed-quote path (preferred)
  quote: sellQuoteShape.optional(),
  signature: z.string().regex(/^[a-f0-9]+$/i).optional(),
  // Legacy path — kept so older clients (pre-quote OTA) continue to work
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]).optional(),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]).optional(),
  amount: z.number().positive().optional(),
  quotedRate: z.number().positive().optional(),
  // Common
  bankName: z.string().min(2).max(100),
  accountNumber: z.string().regex(/^\d{10}$/),
  accountName: z.string().min(2).max(100),
  bankCode: z.string().optional(),
  saveBeneficiary: z.boolean().optional(),
  /** The sender's own note for this transfer. Shown back to them; see below. */
  narration: z.string().max(100).optional(),
  senderAddress: z.string().min(10).max(128).optional(),
}).refine(
  (d) => {
    if (d.quote && d.signature) return VALID_ASSET_CHAINS[d.quote.asset]?.includes(d.quote.chain);
    if (d.asset && d.chain && d.amount) return VALID_ASSET_CHAINS[d.asset]?.includes(d.chain);
    return false;
  },
  { message: "Invalid request: provide either a signed quote or (asset, chain, amount)" }
);

// ═══════════════════════════════════════════════════════════
// POST /transactions/sell/prepare
// Phase 1: Validate, calculate NGN, return sell treasury + signing message
// ═══════════════════════════════════════════════════════════
router.post(
  "/sell/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(sellPrepareSchema),
  async (req: Request, res: Response) => {
    try {
      // ── Maintenance gate ────────────────────────────────
      const bankPaused = await pauseGuard("bank");
      if (bankPaused) {
        res.status(503).json({ error: bankPaused, paused: true, service: "bank" });
        return;
      }

      const userId = req.user!.userId;
      const { bankName, accountNumber, accountName, bankCode, saveBeneficiary, narration, senderAddress } = req.body;

      // ── KYC & limits ────────────────────────────────────
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      const verified = user.kycStatus === "VERIFIED";
      const perTx = verified ? SELL_PER_TX_KYC : SELL_PER_TX_NO_KYC;
      const dailyLimit = verified ? SELL_DAILY_KYC : SELL_DAILY_NO_KYC;

      // ── Resolve quote (signed quote preferred, legacy fallback) ──
      let asset: "USDC" | "USDT" | "MOVE" | "SOL";
      // ARC was already reached through the EVM else-branch without being
      // named here; TON needs naming because it has a branch of its own.
      let chain: "MOVE" | "BASE" | "SOL" | "BEP20" | "ARC" | "TON" | "STELLAR" | "MONAD";
      let amount: number;
      let ngnRate: number;
      let grossNgn: number;
      let fee: number;
      let netNgn: number;

      if (req.body.quote && req.body.signature) {
        const quote = req.body.quote as SellQuote;
        if (!verifyQuoteSig(quote, req.body.signature)) {
          res.status(400).json({ error: "Invalid quote signature" });
          return;
        }
        if (quote.userId !== userId) {
          res.status(403).json({ error: "Quote not valid for this account" });
          return;
        }
        if (Date.now() > quote.expiresAt) {
          res.status(409).json({ error: "Quote expired. Please refresh and try again." });
          return;
        }
        asset = quote.asset;
        chain = quote.chain;
        amount = quote.amount;
        ngnRate = quote.ngnRate;
        grossNgn = quote.ngnGross;
        fee = quote.ngnFee;
        netNgn = quote.ngnNet;
      } else {
        // Legacy path (pre-quote OTA): client supplies crypto amount + optional rate hint.
        asset = req.body.asset;
        chain = req.body.chain;
        amount = req.body.amount;
        const quotedRate = req.body.quotedRate;

        const liveRate = await getLiveNgnRate(asset);
        if (!liveRate || liveRate <= 0) {
          res.status(503).json({ error: "Exchange rate unavailable. Please try again." });
          return;
        }
        ngnRate = liveRate;
        if (quotedRate && quotedRate > 0) {
          const drift = Math.abs(quotedRate - liveRate) / liveRate;
          if (drift > 0.01) {
            res.status(409).json({ error: "Rate moved while you were confirming. Please review and try again." });
            return;
          }
          ngnRate = quotedRate;
        }
        grossNgn = amount * ngnRate;
        const percentFee = Math.round(grossNgn * SELL_FEE_RATE);
        fee = percentFee + SELL_PROCESSING_FEE;
        netNgn = Math.round(grossNgn - fee);
      }

      if (netNgn < 100) {
        res.status(400).json({ error: "Amount too small. Minimum payout is ₦100." });
        return;
      }
      if (netNgn > perTx) {
        res.status(400).json({ error: `Maximum ₦${perTx.toLocaleString()} per transaction${verified ? "" : " (verify KYC to increase)"}` });
        return;
      }

      // Daily limit check
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todaySells = await prisma.transaction.findMany({
        // PENDING is a prepared sale nobody signed - see the note above the
        // limits constants. Only money that actually left counts.
        where: { userId, type: "SELL", status: { in: ["COMPLETED", "PROCESSING"] }, createdAt: { gte: startOfDay } },
        select: { metadata: true },
      });
      const spentToday = todaySells.reduce((sum, t) => {
        const m = t.metadata as any;
        return sum + (m?.ngnNet ? Number(m.ngnNet) : 0);
      }, 0);
      if (spentToday + netNgn > dailyLimit) {
        const remaining = Math.max(dailyLimit - spentToday, 0);
        res.status(400).json({
          error: remaining <= 0
            ? `Daily sell limit of ₦${dailyLimit.toLocaleString()} reached.`
            : `Exceeds daily limit. ₦${remaining.toLocaleString()} remaining today.`,
        });
        return;
      }

      // ── Minimum crypto amounts ──────────────────────────
      const minAmount = MIN_WITHDRAW[asset] ?? 0.01;
      if (amount < minAmount) {
        res.status(400).json({ error: `Minimum sell is ${minAmount} ${asset}` });
        return;
      }

      // ── Wallet lookup ───────────────────────────────────
      let wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset, chain } },
      });
      if (!wallet?.address) {
        const fallback = await prisma.wallet.findFirst({ where: { userId, chain: EVM_CHAINS.includes(chain as Chain) ? { in: EVM_CHAINS } : (chain as Chain), address: { not: null } } });
        if (fallback?.address) {
          wallet = await prisma.wallet.upsert({
            where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
            update: { address: fallback.address },
            create: { userId, asset: asset as Asset, chain: chain as Chain, balance: 0, address: fallback.address },
          });
        }
      }
      if (!wallet?.address) {
        res.status(400).json({ error: "No wallet address found for this chain" });
        return;
      }

      // Cross-check client address
      if (senderAddress) {
        const { ok, expected } = await senderAddressMatches(
          userId, chain, senderAddress, wallet.address,
        );
        if (!ok) {
          console.error(`[SELL] ⚠️ ADDRESS MISMATCH — user ${userId}, chain ${chain}, DB: ${expected}, client: ${senderAddress}`);
          res.status(409).json({ error: "Wallet address mismatch. Sell blocked for security." });
          return;
        }
      }

      // On-chain balance check — never fall back to DB balance
      let onChainBalance: number;
      try { onChainBalance = await getOnChainBalance(asset, chain, wallet.address); }
      catch (err: any) {
        console.error(`[SELL] on-chain balance check failed: ${err?.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }
      if (onChainBalance < amount) {
        res.status(400).json({ error: "Insufficient on-chain balance" });
        return;
      }

      // ── Sell treasury address ───────────────────────────
      const sellTreasury = getSellTreasury(chain);
      if (!sellTreasury) {
        res.status(500).json({ error: "Sell treasury not configured for this chain" });
        return;
      }

      // ── Cancel any existing PENDING sell for this user (prevent race condition) ──
      await prisma.transaction.updateMany({
        where: { userId, type: "SELL", status: "PENDING" },
        data: { status: "FAILED" },
      });

      // ── Create PENDING sell tx ──────────────────────────
      // Neutral prefix: this string is shown on receipts and read out to
      // support, and "SELL" describes our side of the trade rather than
      // anything the customer did.
      const reference = `trx_${Date.now().toString(36).slice(-8)}${crypto.randomBytes(4).toString("hex")}`;
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: "SELL",
          asset: asset as Asset,
          chain: chain as Chain,
          amount,
          fee: fee / ngnRate, // fee in crypto terms for consistency
          status: "PENDING",
          reference,
          metadata: {
            bankName, accountNumber, accountName, bankCode: bankCode || null,
            ngnRate, ngnGross: grossNgn, ngnFee: fee, ngnNet: netNgn,
            sellTreasury, senderAddress: wallet.address,
            saveBeneficiary: saveBeneficiary || false,
            narration: (narration || "").trim() || null,
          },
        },
      });

      // ── Prepare on-chain tx (user → sell treasury) ──────
      // Reuse the existing withdraw prepare functions but with sell treasury as destination
      let signingMessage: string;
      let txRequest: Record<string, string | number> | undefined;
      // Only TON has one: the relay's cut, taken from the same USDT. Undefined
      // everywhere else, where gas is a separate asset somebody sponsors.
      let relayFee: number | undefined;
      if (chain === "MOVE") {
        ({ signingMessage } = await prepareMovementWithdrawal(
          transaction.id, wallet.address, sellTreasury, amount, asset as "MOVE" | "USDC" | "USDT" | "USDCx"
        ));
      } else if (chain === "SOL") {
        ({ signingMessage } = await prepareSolanaWithdrawal(
          transaction.id, wallet.address, sellTreasury, amount, asset as "USDC" | "USDT" | "SOL"
        ));
      } else if (chain === "TON") {
        // The Solana address, because that is where the signing key lives -
        // see the same note on withdraw/prepare.
        const solWallet = await prisma.wallet.findFirst({
          where: { userId, chain: "SOL", address: { not: null } },
          select: { address: true },
        });
        if (!solWallet?.address) {
          res.status(400).json({ error: "No Solana key found to derive the TON wallet from" });
          return;
        }
        ({ signingMessage, relayFee } = await prepareTonWithdrawal(
          transaction.id, solWallet.address, sellTreasury, amount, asset as "USDT"
        ).then((r) => ({ signingMessage: r.signingMessage, relayFee: r.commission })));
      } else if (chain === "STELLAR") {
        // User → sell treasury, fee-bumped by the treasury at submit.
        ({ signingMessage } = await stellar.preparePayment(transaction.id, {
          from: wallet.address,
          to: sellTreasury,
          coin: asset as stellar.StellarCoin,
          amount,
        }));
      } else {
        ({ signingMessage, txRequest } = await prepareEvmWithdrawal(
          transaction.id, wallet.address, sellTreasury, amount,
          asset as "USDC" | "USDT", chain as "BASE" | "BEP20"
        ));
      }

      res.json({
        sellId: transaction.id,
        signingMessage,
        txRequest,
        relayFee,
        chain,
        ngnRate,
        ngnGross: grossNgn,
        ngnFee: fee,
        ngnNet: netNgn,
        sellTreasury,
      });
    } catch (err: any) {
      console.error("[SELL] Prepare error:", err);
      const msg = err?.message || "";
      if (msg.includes("Insufficient")) {
        res.status(400).json({ error: "Insufficient balance to complete this sale" });
      } else if (msg.includes("Unsupported asset") || err?.name === "StellarError") {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: "Failed to prepare sell" });
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /transactions/sell/submit
// Phase 2: Receive user signature, submit on-chain, initiate Paystack payout
// ═══════════════════════════════════════════════════════════
const sellSubmitSchema = z.object({
  sellId: z.string().min(1),
  // Empty is allowed because an MPC wallet signs the whole transaction instead
  // of a hash and sends `signedRaw`; the refine below insists on one or the
  // other, so a request carrying neither is still rejected.
  signature: z.string().regex(/^[0-9a-fA-F]*$/, "Signature must be hex").default(""),
  publicKey: z.string().regex(/^[0-9a-fA-F]*$/, "Public key must be hex").default(""),
  signedRaw: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Signed transaction must be 0x-prefixed hex")
    .optional(),
})
  // One or the other must be present. Without this, `signature` defaulting to ""
  // would let a request carrying no proof at all pass validation.
  .refine((v) => !!v.signedRaw || (v.signature.length > 0 && v.publicKey.length > 0), {
    message: "A signature or a signed transaction is required",
  });

router.post(
  "/sell/submit",
  requireAuth,
  requireActiveSession,
  validate(sellSubmitSchema),
  async (req: Request, res: Response) => {
    try {
      // ── Maintenance gate ────────────────────────────────
      const bankPaused = await pauseGuard("bank");
      if (bankPaused) {
        res.status(503).json({ error: bankPaused, paused: true, service: "bank" });
        return;
      }

      const userId = req.user!.userId;
      const { sellId, signature, publicKey, signedRaw } = req.body;

      // Atomically claim PENDING → PROCESSING
      const claimResult = await prisma.transaction.updateMany({
        where: { id: sellId, userId, status: "PENDING", type: "SELL" },
        data: { status: "PROCESSING" },
      });
      if (claimResult.count === 0) {
        const existing = await prisma.transaction.findUnique({ where: { id: sellId } });
        if (!existing || existing.userId !== userId) {
          res.status(404).json({ error: "Transaction not found" });
        } else {
          res.status(400).json({ error: "Transaction already processed" });
        }
        return;
      }

      const tx = await prisma.transaction.findUnique({ where: { id: sellId } });
      if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
      const meta = tx.metadata as any;

      // ── Submit on-chain (user → sell treasury) ──────────
      let txHash: string;
      try {
        if (tx.chain === "MOVE") {
          txHash = await submitMovementWithdrawal(sellId, signature, publicKey);
        } else if (tx.chain === "SOL") {
          txHash = await submitSolanaWithdrawal(sellId, signature, publicKey);
        } else if (tx.chain === "TON") {
          txHash = await submitTonWithdrawal(sellId, signature);
        } else if (tx.chain === "STELLAR") {
          txHash = await stellar.submitPayment(sellId, signature);
        } else if (EVM_CHAINS.includes(tx.chain as Chain)) {
          txHash = await submitEvmWithdrawal(sellId, signature, publicKey, signedRaw);
        } else {
          res.status(400).json({ error: `Unsupported chain: ${tx.chain}` });
          return;
        }
      } catch (chainErr: any) {
        console.error("[SELL] On-chain submit failed:", chainErr);
        const failedHash = chainErr?.txHash;
        await prisma.transaction.update({
          where: { id: sellId },
          data: {
            status: "FAILED",
            metadata: failedHash
              ? { ...meta, txHash: failedHash, chainError: chainErr?.message || "Confirmation failed" }
              : { ...meta, chainError: chainErr?.message || "On-chain submit failed" },
          },
        }).catch(() => {});
        res.status(500).json({ error: "On-chain transfer failed. No money was deducted from your bank." });
        return;
      }

      // ── Deduct wallet balance ───────────────────────────
      await prisma.wallet.update({
        where: { userId_asset_chain: { userId, asset: tx.asset, chain: tx.chain! } },
        data: { balance: { decrement: Number(tx.amount) } },
      }).catch(() => {});

      // ── Bach payout (off-ramp to bank) ──────────────────
      const ngnNet = meta.ngnNet;
      const bankName = meta.bankName;
      const accountNumber = meta.accountNumber;
      const accountName = meta.accountName;

      /**
       * The rail, decided once and written down.
       *
       * Every later read - the verify poll, the retry, the webhook, an admin
       * re-check - takes the provider from the transaction rather than asking
       * the switch again. Flipping the switch therefore only affects payouts
       * that have not started; anything in flight finishes on the rail that
       * sent it. See lib/payout.ts.
       */
      const payoutProvider = await activePayoutProvider();

      let payoutStatus = "pending";
      let flwTransferId = "";
      let payoutSessionId: string | null = null;
      let payoutError = "";
      let bankCode = "";
      const payoutReference = payoutReferenceFor(tx.reference!);

      try {
        if (!payoutConfigured(payoutProvider)) throw new Error("Payouts are not configured");

        /**
         * Resolved from the bank NAME, never from a stored code.
         *
         * A code belongs to the rail that issued it. Only twenty of the forty
         * banks the app offers share a code between Flutterwave and Paystack -
         * Opay is 100004 on one and 999992 on the other - so a stored code
         * handed to the other provider is at best rejected. Saved
         * beneficiaries may also still carry a Bachs-era code.
         */
        bankCode = (await bankCodeByName(payoutProvider, bankName)) || "";
        if (!bankCode) throw new Error("Could not resolve bank code");

        // One call. The reference doubles as the idempotency key on both rails.
        const payout = await createPayout(payoutProvider, {
          amount: Number(ngnNet),
          bankCode,
          accountNumber,
          accountName,
          reference: payoutReference,
          meta: { userId, sellId },
        });
        if (!payout.ok) throw new Error(payout.error || "Payout failed");

        flwTransferId = payout.transferId;
        payoutSessionId = payout.sessionId;
        payoutStatus = payout.status === "COMPLETED" ? "completed" : "pending";
        console.log(
          `[SELL] ✅ ${PAYOUT_LABELS[payoutProvider]} transfer ${flwTransferId} — ₦${ngnNet} to ${accountNumber}`,
        );
      } catch (payErr: any) {
        console.error(`[SELL] ${PAYOUT_LABELS[payoutProvider]} payout error:`, payErr.message);
        payoutError = payErr.message;
        payoutStatus = "payout_failed";
      }

      // ── Update transaction with results ─────────────────
      // Payouts settle asynchronously; the webhook flips the row to
      // COMPLETED/FAILED, and the client's verify poll is a backstop for a
      // webhook that never arrives.
      const finalStatus = payoutStatus === "completed" ? "COMPLETED" : "PROCESSING";
      await prisma.transaction.update({
        where: { id: sellId },
        data: {
          status: finalStatus,
          metadata: {
            ...meta,
            txHash,
            flwTransferId,
            // Stored so the webhook can find this transaction: Flutterwave
            // echoes the stripped reference, not tx.reference.
            payoutReference,
            // Only present when Flutterwave sends it; the receipt shows a dash
            // rather than an empty row when it does not.
            ...(payoutSessionId ? { sessionId: payoutSessionId } : {}),
            payoutStatus,
            payoutError: payoutError || undefined,
            bankCode,
            // Which rail this went out on. Absent on anything written before
            // there were two, which is Flutterwave by definition.
            payoutProvider,
            ...(finalStatus === "COMPLETED" ? { completedAt: new Date().toISOString() } : {}),
          },
        },
      });

      // If completed immediately, send notification
      if (finalStatus === "COMPLETED") {
        await sendNotification({
          userId,
          type: "transaction",
          title: "Sell Completed",
          body: `₦${ngnNet.toLocaleString()} sent to ${accountName} (${bankName})`,
        }).catch(() => {});
      }

      // Auto-save beneficiary
      if (meta.saveBeneficiary) {
        await prisma.beneficiary.upsert({
          where: { userId_accountNumber_bankName: { userId, accountNumber, bankName } },
          create: { userId, accountName, accountNumber, bankName, bankCode },
          update: { accountName, bankCode, updatedAt: new Date() },
        }).catch(() => {});
      }

      // Send sell confirmation email (fire-and-forget)
      const sellUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (sellUser?.email) {
        const chainLabel = ({ MOVE: "Movement", BASE: "Base", SOL: "Solana", BEP20: "BNB Chain", ARB: "Arbitrum", ARC: "Arc", TON: "TON", STELLAR: "Stellar", MONAD: "Monad" } as Record<string, string>)[tx.chain!] || tx.chain;
        sendSellSuccessEmail(sellUser.email, {
          cryptoAmount: Number(tx.amount).toFixed(4),
          asset: assetLabel(tx.asset),
          chain: chainLabel || tx.chain!,
          ngnNet,
          ngnFee: meta.ngnFee,
          bankName,
          accountNumber,
          accountName,
          reference: tx.reference || sellId,
          date: new Date().toLocaleString(),
        }).catch((e) => console.error("Sell email failed:", e));
      }

      res.json({
        status: payoutStatus === "payout_failed" ? "payout_failed" : "processing",
        transaction: {
          id: tx.id,
          type: tx.type,
          asset: tx.asset,
          chain: tx.chain,
          amount: tx.amount,
          status: finalStatus,
          reference: tx.reference,
          metadata: {
            ngnNet, ngnFee: meta.ngnFee, ngnGross: meta.ngnGross,
            bankName, accountNumber, accountName,
            txHash, payoutStatus,
          },
          createdAt: tx.createdAt,
        },
        message: payoutStatus === "payout_failed"
          ? "Crypto received but bank payout failed. Our team will process it manually."
          : "Sell processing — bank transfer initiated.",
      });
    } catch (err: any) {
      console.error("[SELL] Submit error:", err);
      // If on-chain failed, mark FAILED — preserve broadcast hash if present.
      if (req.body?.sellId) {
        const failedHash = err?.txHash;
        const existing = await prisma.transaction.findUnique({
          where: { id: req.body.sellId },
          select: { metadata: true, status: true },
        }).catch(() => null);
        if (existing && existing.status === "PROCESSING") {
          await prisma.transaction.update({
            where: { id: req.body.sellId },
            data: {
              status: "FAILED",
              metadata: {
                ...((existing.metadata as any) || {}),
                ...(failedHash ? { txHash: failedHash } : {}),
                chainError: err?.message || "On-chain submit failed",
              },
            },
          }).catch(() => {});
        }
      }
      res.status(500).json({ error: err.message || "Failed to process sell" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
/**
 * Bring a PROCESSING sell up to date with Flutterwave.
 *
 * A payout is created as NEW and settles asynchronously. The webhook is what
 * normally finishes the row, but it cannot reach a backend running locally, and
 * in production a single dropped delivery would strand a sell in PROCESSING
 * forever with the user's money already sent. So the list reconciles what it is
 * about to show.
 *
 * Returns the status it settled on, or null if nothing changed.
 */
async function syncSellPayout(tx: {
  id: string;
  userId: string;
  status: string;
  metadata: unknown;
}): Promise<"COMPLETED" | "FAILED" | null> {
  const meta = (tx.metadata ?? {}) as any;
  const lookup = meta.flwTransferId || meta.payoutReference;

  // The rail that sent it, not the one that is live now. Asking the wrong
  // provider about a transfer it never sent returns "not found", which reads
  // exactly like a failed payout and is not one.
  const provider = providerOf(meta);
  if (!lookup || !payoutConfigured(provider)) return null;

  const found = await getPayout(provider, lookup).catch(() => null);
  if (!found?.ok) return null;

  const mapped = found.status;
  if (mapped === "PENDING") return null;

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      status: mapped,
      metadata: {
        ...meta,
        payoutStatus: mapped === "COMPLETED" ? "completed" : "failed",
        ...(mapped === "COMPLETED" ? { completedAt: new Date().toISOString() } : {}),
        ...(mapped === "FAILED"
          ? {
              failReason:
                found.raw?.complete_message || found.raw?.reason || "Payout failed",
            }
          : {}),
      },
    },
  });

  sendNotification({
    userId: tx.userId,
    type: "transaction",
    ...payoutNotice(meta, mapped === "COMPLETED" ? "sent" : "failed"),
  }).catch(() => {});

  return mapped;
}

// GET /transactions/sell/status/:id
// Check Paystack transfer status & update DB if completed
// ═══════════════════════════════════════════════════════════
router.get(
  "/sell/status/:id",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const txId = req.params.id as string;
      const tx = await prisma.transaction.findUnique({ where: { id: txId } });
      if (!tx || tx.userId !== userId || tx.type !== "SELL") {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }

      // Already final
      if ((tx.status as string) === "COMPLETED" || (tx.status as string) === "FAILED") {
        res.json({ status: tx.status });
        return;
      }

      const meta = tx.metadata as any;
      // Look up by our reference rather than Flutterwave's id: the id is absent
      // when the original call timed out, but the reference always exists
      // because we derive it from the transaction.
      const lookupRef: string =
        meta.payoutReference || (tx.reference ? payoutReferenceFor(tx.reference) : "");

      // The rail this payout was sent on, or would have been.
      const sentOn = providerOf(meta);

      if (!lookupRef || !payoutConfigured(sentOn)) {
        res.json({ status: tx.status });
        return;
      }

      // The crypto leg has already settled by the time we get here, so a payout
      // that never got created leaves the user's money stranded: taken on
      // chain, never paid out. Retry it.
      //
      // Safe to repeat because the reference is derived from the transaction
      // and doubles as the idempotency key - if a transfer was in fact created
      // last time, this returns that same one rather than paying twice.
      if (!meta.flwTransferId) {
        /**
         * Ask the original rail before sending anything.
         *
         * No recorded id does not mean no payout: the call may have timed out
         * after the transfer was created. Treating that as unpaid is precisely
         * how somebody gets paid twice - it reports an unpaid sell, a person
         * pays it by hand, and the original settles later.
         *
         * So the rail that was stamped on this transaction is asked first,
         * using the reference, which is the idempotency key on both providers.
         * Only when it has nothing does a new transfer go out, and only then
         * may the rail change - which is the case the switch exists for: a
         * payout that never got created while Flutterwave was down should
         * leave on Paystack now.
         */
        const already = await getPayout(sentOn, lookupRef).catch(() => null);

        let usedProvider = sentOn;
        let transferId: string | null = null;
        let failure: string | undefined;

        if (already?.ok) {
          transferId = lookupRef;
          console.log(
            `[SELL] Payout already existed for ${tx.reference} on ${PAYOUT_LABELS[sentOn]}`,
          );
        } else {
          const provider = await activePayoutProvider();
          const bankCode = (await bankCodeByName(provider, meta.bankName)) || "";

          if (!bankCode) {
            failure = "Could not resolve bank code";
          } else {
            const retry = await createPayout(provider, {
              amount: Number(meta.ngnNet),
              bankCode,
              accountNumber: meta.accountNumber,
              accountName: meta.accountName,
              reference: lookupRef,
              meta: { userId, sellId: tx.id },
            });
            if (retry.ok) {
              transferId = retry.transferId;
              usedProvider = provider;
              meta.bankCode = bankCode;
            } else {
              failure = retry.error;
            }
          }
        }

        if (transferId) {
          meta.flwTransferId = transferId;
          meta.payoutReference = lookupRef;
          meta.payoutProvider = usedProvider;
          meta.payoutStatus = "pending";
          meta.payoutError = undefined;
          await prisma.transaction.update({
            where: { id: tx.id },
            data: { metadata: { ...meta } },
          });
          console.log(
            `[SELL] ♻️ Payout resolved for ${tx.reference} on ${PAYOUT_LABELS[usedProvider]}: ${transferId}`,
          );
        } else {
          console.error(`[SELL] Payout retry failed for ${tx.reference}:`, failure);
          res.json({ status: tx.status, payoutStatus: "payout_failed", payoutError: failure });
          return;
        }
      }

      // Re-read the stamp: the retry above may have moved this to the other rail.
      const found = await getPayout(providerOf(meta), meta.flwTransferId || lookupRef);
      if (!found.ok) {
        res.json({ status: tx.status });
        return;
      }
      const mapped = found.status;
      const payoutStatus = mapped === "COMPLETED" ? "completed" : mapped === "FAILED" ? "failed" : "pending";

      if (payoutStatus === "completed" && (tx.status as string) !== "COMPLETED") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "COMPLETED",
            metadata: { ...meta, payoutStatus: "completed", completedAt: new Date().toISOString() },
          },
        });
        await sendNotification({
          userId,
          type: "transaction",
          title: "Sell Completed",
          body: `₦${(meta.ngnNet || 0).toLocaleString()} sent to ${meta.accountName || "your bank"} (${meta.bankName || ""})`,
        }).catch(() => {});
        res.json({ status: "COMPLETED" });
        return;
      }

      if (payoutStatus === "failed" && (tx.status as string) !== "FAILED") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            status: "FAILED",
            metadata: {
              ...meta,
              payoutStatus: "failed",
              // Each rail names the reason differently.
              failReason: found.raw?.complete_message || found.raw?.reason || undefined,
            },
          },
        });
        res.json({ status: "FAILED" });
        return;
      }

      res.json({ status: tx.status, payoutStatus });
    } catch (err: any) {
      console.error("[SELL] Status check error:", err);
      res.status(500).json({ error: "Failed to check status" });
    }
  }
);

// ─── Sell limits endpoint ───────────────────────────────────
router.get(
  "/sell/limits",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }

      const verified = user.kycStatus === "VERIFIED";
      const perTx = verified ? SELL_PER_TX_KYC : SELL_PER_TX_NO_KYC;
      const dailyLimit = verified ? SELL_DAILY_KYC : SELL_DAILY_NO_KYC;

      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todaySells = await prisma.transaction.findMany({
        // PENDING is a prepared sale nobody signed - see the note above the
        // limits constants. Only money that actually left counts.
        where: { userId, type: "SELL", status: { in: ["COMPLETED", "PROCESSING"] }, createdAt: { gte: startOfDay } },
        select: { metadata: true },
      });
      const spentToday = todaySells.reduce((sum, t) => {
        const m = t.metadata as any;
        return sum + (m?.ngnNet ? Number(m.ngnNet) : 0);
      }, 0);

      res.json({
        verified,
        perTx,
        dailyLimit,
        spentToday: Math.round(spentToday),
        remaining: Math.max(dailyLimit - spentToday, 0),
      });
    } catch (err) {
      console.error("[SELL] Limits error:", err);
      res.status(500).json({ error: "Failed to fetch sell limits" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /transactions/bank-transfer
// DISABLED — legacy endpoint that deducted DB balance without Paystack payout.
// Use the sell/prepare + sell/submit flow for bank payouts instead.
// ═══════════════════════════════════════════════════════════
router.post(
  "/bank-transfer",
  requireAuth,
  requireActiveSession,
  async (_req: Request, res: Response) => {
    res.status(410).json({ error: "This endpoint is deprecated. Use sell/prepare + sell/submit for bank transfers." });
  }
);

// ─── Daily Usage ────────────────────────────────────────────
router.get("/usage/today", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const rows = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId,
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      _sum: { amount: true },
    });

    // Map type -> total naira spent today
    // For BUY transactions, the naira amount is in metadata.amountNaira
    const buyTxs = await prisma.transaction.findMany({
      where: {
        userId,
        type: "BUY",
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      select: { metadata: true },
    });
    const buyNaira = buyTxs.reduce((sum, t) => {
      const meta = t.metadata as any;
      return sum + (meta?.amountNaira ? Number(meta.amountNaira) : 0);
    }, 0);

    // For TRANSFER_OUT transactions, the naira amount is in metadata.amountNaira
    const transferOutTxs = await prisma.transaction.findMany({
      where: {
        userId,
        type: "TRANSFER_OUT",
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      select: { metadata: true },
    });
    const transferOutNaira = transferOutTxs.reduce((sum, t) => {
      const meta = t.metadata as any;
      return sum + (meta?.amountNaira ? Number(meta.amountNaira) : 0);
    }, 0);

    // For SELL (bank transfer) transactions, the naira amount is in metadata.ngnNet
    const sellTxs = await prisma.transaction.findMany({
      where: {
        userId,
        type: "SELL",
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      select: { metadata: true },
    });
    const sellNaira = sellTxs.reduce((sum, t) => {
      const meta = t.metadata as any;
      return sum + (meta?.ngnNet ? Number(meta.ngnNet) : 0);
    }, 0);

    const usage: Record<string, number> = {};
    for (const r of rows) {
      // For crypto amounts, convert to naira using metadata where available
      usage[r.type] = Number(r._sum.amount ?? 0);
    }
    // Override BUY with naira value from metadata
    usage["BUY"] = buyNaira;
    // Override TRANSFER_OUT with naira value from metadata
    usage["TRANSFER_OUT"] = transferOutNaira;
    // Override SELL with naira value from metadata
    usage["SELL"] = sellNaira;

    // Override AIRTIME with naira value from metadata (amount field stores crypto, not naira)
    // Split into airtime/data vs electricity
    const airtimeTxs = await prisma.transaction.findMany({
      where: {
        userId,
        type: "AIRTIME",
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      select: { metadata: true },
    });
    let airtimeNaira = 0;
    let electricityNaira = 0;
    let bettingNaira = 0;
    for (const t of airtimeTxs) {
      const meta = t.metadata as any;
      const amt = meta?.nairaAmount ? Number(meta.nairaAmount) : 0;
      // Three buckets, matching the three daily pools the bills route
      // enforces. An else-branch of two would put betting in with airtime and
      // have the limits screen report a bar against the wrong allowance.
      if (meta?.billType === "electricity") {
        electricityNaira += amt;
      } else if (meta?.billType === "betting") {
        bettingNaira += amt;
      } else {
        airtimeNaira += amt;
      }
    }
    usage["AIRTIME"] = airtimeNaira;
    usage["ELECTRICITY"] = electricityNaira;
    usage["BETTING"] = bettingNaira;

    res.json({ usage });
  } catch (err) {
    console.error("Usage fetch error:", err);
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

// ─── POST /transactions/withdraw/abandon — the app could not sign it ──
//
// The sell version of this exists because a sell that is never signed used to
// close ten minutes later with no reason. Withdrawals had the same hole and no
// such endpoint, so two failures on the same day - same person, same cause as
// six sells that did record one - arrived as blank rows: no error, no hash, no
// way to tell a signing timeout from a chain that refused.
//
// Nothing here moves money or touches a chain. It closes a record that was
// already going to close, sooner and with the cause attached.
const withdrawAbandonSchema = z.object({
  withdrawalId: z.string().min(1),
  reason: z.string().max(300).optional(),
  stage: z.string().max(40).optional(),
});

router.post(
  "/withdraw/abandon",
  requireAuth,
  requireActiveSession,
  validate(withdrawAbandonSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { withdrawalId, reason, stage } = req.body;

      // PENDING only. Anything further along has been submitted and may have a
      // transfer behind it; the client's opinion must never close that.
      const tx = await prisma.transaction.findFirst({
        where: { id: withdrawalId, userId, type: "WITHDRAW", status: "PENDING" },
      });
      if (!tx) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const meta = (tx.metadata ?? {}) as any;
      await prisma.transaction.update({
        where: { id: withdrawalId },
        data: {
          status: "FAILED",
          metadata: {
            ...meta,
            neverSigned: true,
            clientStage: stage || "sign",
            clientError: String(reason || "").slice(0, 300) || "The app could not sign it",
          },
        },
      });

      console.log(
        `[WITHDRAW] never signed — ${tx.reference} on ${tx.chain}/${tx.asset}: ${String(
          reason || ""
        ).slice(0, 160)}`
      );

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[WITHDRAW] Abandon error:", err?.message);
      res.status(500).json({ error: "Could not close that withdrawal." });
    }
  }
);

// ─── POST /transactions/sell/abandon — the app could not sign it ──
//
// A sell that is prepared and never submitted used to sit PENDING until a
// sweeper failed it ten minutes later with no reason attached. Two problems
// with that, and the second is the expensive one.
//
// The person watches a transaction say "Processing" for ten minutes for
// something that never left their phone. And we learn nothing: roughly one in
// seven Movement sells ends this way and the cause is invisible from the
// server, because the only thing that knows is the client that failed to sign.
//
// So the app says so, and the row carries the reason. Nothing here moves money
// or touches a chain; it only closes a record that was already going to close.
const abandonSchema = z.object({
  sellId: z.string().min(1),
  reason: z.string().max(300).optional(),
  stage: z.string().max(40).optional(),
});

router.post(
  "/sell/abandon",
  requireAuth,
  requireActiveSession,
  validate(abandonSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { sellId, reason, stage } = req.body;

      // PENDING only. A sell that reached PROCESSING has been submitted and
      // may have money behind it - the client's opinion must never close that.
      const tx = await prisma.transaction.findFirst({
        where: { id: sellId, userId, type: "SELL", status: "PENDING" },
      });
      if (!tx) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const meta = (tx.metadata ?? {}) as any;
      await prisma.transaction.update({
        where: { id: sellId },
        data: {
          status: "FAILED",
          metadata: {
            ...meta,
            neverSigned: true,
            clientStage: stage || "sign",
            clientError: String(reason || "").slice(0, 300) || "The app could not sign it",
          },
        },
      });

      console.log(
        `[SELL] never signed — ${tx.reference} on ${tx.chain}/${tx.asset}: ${String(reason || "").slice(0, 160)}`,
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("[SELL] abandon error:", err);
      res.json({ ok: true });
    }
  }
);

// ─── POST /transactions/transfer/username/abandon — the app could not sign it ──
//
// The same hole sells had, on username sends. A transfer the phone failed to
// sign sat PENDING for good - no sweeper covered it - reading as "Pending" to
// the sender and to support, with the cause known only to the handset. One
// person's wallet session timing out left four of them stuck in a row.
//
// PENDING only, and that is the whole safety argument: submit claims the row
// as PROCESSING before anything is broadcast, so a PENDING row has never been
// sent anywhere and closing it cannot strand money.
const usernameAbandonSchema = z.object({
  transferId: z.string().min(1),
  reason: z.string().max(300).optional(),
  stage: z.string().max(40).optional(),
});

router.post(
  "/transfer/username/abandon",
  requireAuth,
  requireActiveSession,
  validate(usernameAbandonSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { transferId, reason, stage } = req.body;

      const tx = await prisma.transaction.findFirst({
        where: { id: transferId, userId, type: "TRANSFER_OUT", status: "PENDING" },
      });
      const meta = (tx?.metadata ?? {}) as any;
      if (!tx || meta.txHash) {
        res.json({ ok: true, ignored: true });
        return;
      }

      await prisma.transaction.update({
        where: { id: transferId },
        data: {
          status: "FAILED",
          metadata: {
            ...meta,
            neverSigned: true,
            clientStage: stage || "sign",
            clientError: String(reason || "").slice(0, 300) || "The app could not sign it",
          },
        },
      });

      console.log(
        `[USERNAME] never signed — ${tx.reference} on ${tx.chain}/${tx.asset}: ${String(reason || "").slice(0, 160)}`,
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("[USERNAME] abandon error:", err);
      res.json({ ok: true });
    }
  }
);


// ═══════════════════════════════════════════════════════════
// SWEEP — scattered stablecoins into one USDCx balance
//
// A sell that pays out in crypto. Each ticked balance leaves its chain the way
// a sell leaves it, gas sponsored, into the sell treasury; then treasury sends
// USDCx on Movement. Reuses both rails; adds only the choosing, the counting
// and the record.
// ═══════════════════════════════════════════════════════════

// ─── GET /transactions/sweep/quote — what could go, and how many are left ──
router.get(
  "/sweep/quote",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      res.json(await sweepQuote(req.user!.userId));
    } catch (err: any) {
      console.error("[SWEEP] Quote error:", err.message);
      res.status(500).json({ error: "Could not read your balances. Try again." });
    }
  }
);

// ─── POST /transactions/sweep/prepare — one record, one leg per chain ──
const sweepPrepareSchema = z.object({
  legs: z
    .array(
      z.object({
        asset: z.string().min(1),
        chain: z.string().min(1),
        // Optional: absent means the whole balance, which is what a swap
        // always did. validateSelection clamps whatever is given.
        amount: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(6),
});

router.post(
  "/sweep/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(sweepPrepareSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      const { left, perWeek } = await sweepAllowance(userId);
      if (left <= 0) {
        res.status(429).json({
          // From the figure this account was actually allowed, not the
          // constant: an account with a raised allowance was being told it
          // had used all five of ten.
          error: `You have used all ${perWeek} of your swaps this week.`,
        });
        return;
      }

      const available = await sweepableBalances(userId);
      const checked = validateSelection(req.body.legs, available);
      if (!checked.ok) {
        res.status(400).json({ error: checked.error });
        return;
      }

      // Where the USDCx will land. Without this there is nothing to credit, so
      // it is checked before anything leaves a chain.
      const destWallet = await prisma.wallet.findFirst({
        where: { userId, chain: SWEEP_DEST_CHAIN as any, address: { not: null } },
        select: { address: true },
      });
      if (!destWallet?.address) {
        res.status(400).json({ error: "You do not have a Movement wallet yet." });
        return;
      }

      /**
       * Re-price against the chain before anything is written down.
       *
       * The stored balance is what a sweep would otherwise ask for, and on an
       * eighteen-decimal token it can be a shade more than is actually there -
       * which is a revert, not a shortfall. Asking the chain and flooring the
       * answer means the transfer can only ever be for less.
       */
      for (const leg of checked.legs) {
        const from = available.find((a) => a.asset === leg.asset && a.chain === leg.chain);
        if (!from?.address) continue;
        leg.amount = await exactSweepAmount(leg.asset, leg.chain, from.address, leg.amount);
      }
      checked.legs = checked.legs.filter((l) => l.amount > 0);
      checked.total = checked.legs.reduce((n, l) => n + l.amount, 0);

      if (!checked.legs.length) {
        res.status(400).json({
          error: "There is nothing on those chains to swap right now.",
        });
        return;
      }

      /**
       * Nothing leaves a chain we cannot pay for.
       *
       * Checked here rather than at credit time, because at credit time their
       * token is already ours and refusing costs them everything.
       */
      const cover = await treasuryCanCover(checked.total);
      if (!cover.ok) {
        console.error(
          `[SWEEP] Refused ${checked.total} for ${userId} — treasury holds ${
            cover.have ?? "unknown"
          } ${SWEEP_DEST_ASSET}`
        );
        res.status(503).json({
          error: "Swap is briefly unavailable. Please try again shortly.",
        });
        return;
      }

      // Whatever they prepared and never sent stops holding a place.
      await supersedeOpenSweeps(userId);

      /**
       * One row for the whole sweep.
       *
       * Somebody who sweeps three balances did one thing, and three rows in
       * their history would say otherwise. The legs live in metadata with
       * their own hashes.
       */
      const reference = `SWEEP-${crypto.randomBytes(6).toString("hex")}`;
      const sweep = await prisma.transaction.create({
        data: {
          userId,
          type: "SWEEP",
          asset: SWEEP_DEST_ASSET as any,
          chain: SWEEP_DEST_CHAIN as any,
          amount: checked.total,
          status: "PENDING",
          reference,
          metadata: {
            legs: checked.legs,
            destination: destWallet.address,
            total: checked.total,
            anyLanded: false,
          },
        },
      });

      // Each leg gets its own gas-sponsor slot, keyed on the sweep and chain.
      const prepared: any[] = [];
      for (const leg of checked.legs) {
        const from = available.find((a) => a.asset === leg.asset && a.chain === leg.chain);
        if (!from?.address) {
          res.status(400).json({ error: `No ${leg.chain} wallet address on file.` });
          return;
        }

        const to = getSellTreasury(leg.chain);
        if (!to) {
          res.status(500).json({ error: `Swap is not configured for ${leg.chain}.` });
          return;
        }

        const id = legId(sweep.id, leg.chain);
        if (leg.chain === "SOL") {
          const { signingMessage } = await prepareSolanaWithdrawal(
            id, from.address, to, leg.amount, leg.asset as "USDC" | "USDT"
          );
          prepared.push({ ...leg, signingMessage });
        } else if (leg.chain === "TON") {
          /**
           * Named by the Solana address, like every other TON path.
           *
           * A TON address is a hash of the wallet code and the public key, so
           * it cannot be turned back into the key that signs - and the key is
           * the Ed25519 one Solana already holds. `from.address` is the TON
           * address, which is the wrong end of that.
           */
          const solWallet = await prisma.wallet.findFirst({
            where: { userId, chain: "SOL", address: { not: null } },
            select: { address: true },
          });
          if (!solWallet?.address) {
            res.status(400).json({ error: "No Solana key found to derive the TON wallet from" });
            return;
          }
          const { signingMessage } = await prepareTonWithdrawal(
            id, solWallet.address, to, leg.amount, leg.asset as "USDT"
          );
          prepared.push({ ...leg, signingMessage });
        } else if (leg.chain === "STELLAR") {
          // A payment to the sell address; the treasury's fee bump pays the network, so they need no XLM.
          const { signingMessage } = await stellar.preparePayment(id, {
            from: from.address,
            to,
            coin: leg.asset as stellar.StellarCoin,
            amount: leg.amount,
          });
          prepared.push({ ...leg, signingMessage });
        } else {
          const { signingMessage, txRequest } = await prepareEvmWithdrawal(
            id, from.address, to, leg.amount,
            leg.asset as "USDC" | "USDT", leg.chain as "BASE" | "BEP20" | "ARC"
          );
          prepared.push({ ...leg, signingMessage, txRequest });
        }
      }

      res.json({
        sweepId: sweep.id,
        reference,
        total: checked.total,
        destination: { chain: SWEEP_DEST_CHAIN, asset: SWEEP_DEST_ASSET },
        legs: prepared,
      });
    } catch (err: any) {
      console.error("[SWEEP] Prepare error:", err);
      res.status(500).json({ error: err?.message || "Could not start that sweep." });
    }
  }
);

// ─── POST /transactions/sweep/submit — one leg, on its own ──
const sweepSubmitSchema = z.object({
  sweepId: z.string().min(1),
  chain: z.string().min(1),
  signature: z.string().default(""),
  publicKey: z.string().default(""),
  signedRaw: z.string().optional(),
});

router.post(
  "/sweep/submit",
  requireAuth,
  requireActiveSession,
  validate(sweepSubmitSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { sweepId, chain, signature, publicKey, signedRaw } = req.body;

      /**
       * Ownership and openness first, outside the lock.
       *
       * A sweep that is not theirs must not get as far as taking a row lock,
       * and one that is no longer open must not be submittable at all.
       *
       * The status matters more than it looks. Superseding closes the row of a
       * sweep somebody prepared and abandoned, but it cannot reach into the gas
       * sponsor and tear up the signing payload, which lives in memory for two
       * minutes more. Without this check they could prepare a second sweep to
       * close the first, then submit the first anyway - and spend an allowance
       * that had already been handed back.
       */
      const owned = await prisma.transaction.findFirst({
        where: {
          id: sweepId,
          userId,
          type: "SWEEP",
          status: { in: ["PENDING", "PROCESSING"] },
        },
        select: { id: true },
      });
      if (!owned) {
        res.status(404).json({ error: "That swap is no longer open." });
        return;
      }

      /**
       * Claim the leg before touching a chain.
       *
       * Under the row lock, so a double tap, a retry or a replayed call finds
       * the leg already claimed and gets its status back - rather than a second
       * broadcast and a second payout out of treasury.
       */
      const claim = await withSweepLock(sweepId, ({ meta, legs }) => {
        const leg = legs.find((l) => l.chain === chain);
        if (!leg) {
          return {
            kind: "reject" as const,
            body: { error: "That chain is not part of this swap." },
          };
        }
        if (leg.status !== "pending") {
          return { kind: "busy" as const, body: { status: leg.status, leg } };
        }
        leg.status = "sending";
        return {
          kind: "go" as const,
          asset: leg.asset as string,
          amount: leg.amount,
          destination: meta.destination as string,
        };
      });

      if (claim.kind === "reject") {
        res.status(400).json(claim.body);
        return;
      }
      if (claim.kind === "busy") {
        res.json(claim.body);
        return;
      }

      // ── the slow half, with no lock held ──
      const id = legId(sweepId, chain);

      let txHash: string;
      try {
        txHash =
          chain === "SOL"
            ? await submitSolanaWithdrawal(id, signature, publicKey)
            : chain === "TON"
            ? await submitTonWithdrawal(id, signature)
            : chain === "STELLAR"
            ? await stellar.submitPayment(id, signature)
            : await submitEvmWithdrawal(id, signature, publicKey, signedRaw);
      } catch (chainErr: any) {
        const message = chainErr?.message || "That chain refused the transfer";
        console.error(`[SWEEP] ${sweepId} ${chain} failed on chain:`, message);
        const out = await finishLeg(sweepId, chain, userId, {
          status: "failed",
          error: message,
        });
        res.json({ status: "failed", leg: out.leg, done: out.done });
        return;
      }

      /**
       * The token has left their wallet, so the balance should say so.
       *
       * Without this the row sits at its old figure until the next chain sync,
       * which is what let the sweep tag keep offering a balance that had
       * already gone.
       */
      await prisma.wallet
        .updateMany({
          where: { userId, asset: claim.asset as any, chain: chain as any },
          data: { balance: { decrement: claim.amount } },
        })
        .catch(() => {});

      /**
       * Credit as this leg lands, not after all of them.
       *
       * A chain that hangs must never hold the others hostage - two arriving
       * and one failing is an ordinary outcome, and the person should have the
       * two.
       */
      let creditHash: string | undefined;
      let creditError: string | undefined;
      try {
        creditHash = await sendTokensToUser(
          claim.destination,
          claim.amount,
          SWEEP_DEST_CHAIN,
          SWEEP_DEST_ASSET
        );
        /**
         * Write the credit down, the way a purchase does.
         *
         * A balance going up with nothing in the database to explain it is what
         * the wallet sync calls an external deposit - so a sweep landed on
         * Movement and the person was told they had received a deposit of their
         * own money. Recording it here means the sync sees the figure it
         * expects and has nothing to report.
         */
        await prisma.wallet
          .updateMany({
            where: { userId, asset: SWEEP_DEST_ASSET as any, chain: SWEEP_DEST_CHAIN as any },
            data: { balance: { increment: claim.amount } },
          })
          .catch(() => {});
      } catch (err: any) {
        creditError = err?.message || "Credit failed";
        /**
         * Their token is in treasury and the USDCx did not go out.
         *
         * The leg stays `sent`, which the claim refuses to re-enter, so this is
         * never retried on its own: a retry that was wrong about whether the
         * first credit landed pays twice. It needs a person, so it is loud.
         */
        console.error(
          `[SWEEP] ⚠️ ${sweepId} ${chain}: token received, ${SWEEP_DEST_ASSET} NOT sent —`,
          creditError
        );
      }

      const out = await finishLeg(
        sweepId,
        chain,
        userId,
        creditHash
          ? { status: "landed", txHash, creditHash }
          : { status: "sent", txHash, error: creditError }
      );

      res.json({ status: out.leg.status, leg: out.leg, done: out.done });
    } catch (err: any) {
      console.error("[SWEEP] Submit error:", err);
      res.status(500).json({ error: "Could not finish that leg." });
    }
  }
);

/**
 * Write one leg's outcome and, if it was the last, close the sweep.
 *
 * Under the lock, so the closing read sees every leg's final status rather
 * than the copy this one request happened to be holding.
 */
async function finishLeg(
  sweepId: string,
  chain: string,
  userId: string,
  patch: Partial<SweepLeg> & { status: SweepLeg["status"] }
): Promise<{ leg: SweepLeg; done: boolean }> {
  // A leg still `sending` or `sent` is not finished and must never look it.
  const settled = (legs: SweepLeg[]) =>
    legs.every((l) => l.status === "landed" || l.status === "failed");

  const out = await withSweepLock(
    sweepId,
    ({ meta, legs }) => {
      const leg = legs.find((l) => l.chain === chain);
      if (!leg) throw new Error("Leg vanished mid-sweep");

      Object.assign(leg, patch);
      if (patch.status === "landed") meta.anyLanded = true;

      const done = settled(legs);
      if (done) meta.completedAt = new Date().toISOString();

      return {
        leg: { ...leg },
        done,
        landedTotal: legs
          .filter((l) => l.status === "landed")
          .reduce((n, l) => n + l.amount, 0),
      };
    },
    ({ legs }) => {
      if (!settled(legs)) return {};
      const landed = legs.filter((l) => l.status === "landed");
      return {
        // Anything landing makes this a sweep that delivered, whatever else
        // did not. Only a sweep that moved nothing is a failed one.
        status: landed.length > 0 ? "COMPLETED" : "FAILED",
        amount: landed.reduce((n, l) => n + l.amount, 0),
      };
    }
  );

  if (out.done && out.landedTotal > 0) {
    sendNotification({
      userId,
      type: "transaction",
      title: "Swapped to Movement",
      body: `${out.landedTotal.toFixed(4)} USDC is now in your Movement wallet.`,
    }).catch(() => {});
  }

  return { leg: out.leg, done: out.done };
}

// ─── Expire stale PENDING / PROCESSING transactions (runs every 5 min) ───
async function cleanupStaleTransactions() {
  try {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    // Expire stale withdrawals
    const { count } = await prisma.transaction.updateMany({
      where: {
        status: { in: ["PENDING", "PROCESSING"] },
        type: "WITHDRAW",
        createdAt: { lt: tenMinAgo },
      },
      data: { status: "FAILED" },
    });
    if (count > 0) console.log(`[TX CLEANUP] Expired ${count} stale withdrawal(s)`);

    // Expire stale PENDING sell transactions (not submitted within 10 min)
    const { count: sellPending } = await prisma.transaction.updateMany({
      where: {
        status: "PENDING",
        type: "SELL",
        createdAt: { lt: tenMinAgo },
      },
      // Marked as never signed, same as the ones the app reports itself: the
      // difference is only whether the phone was still around to say so.
      data: { status: "FAILED" },
    });
    if (sellPending > 0) console.log(`[TX CLEANUP] Expired ${sellPending} stale PENDING sell(s) — never signed`);

    // Expire stale PENDING bill purchases (not submitted within 10 min).
    // Without this they sat PENDING forever; the daily bills cap used to count
    // them, so a few backed-out airtime screens could lock an account out for
    // the day. The cap no longer counts PENDING, but leaving dead rows in the
    // ledger still shows the user a purchase that never happened.
    const { count: billPending } = await prisma.transaction.updateMany({
      where: {
        status: "PENDING",
        type: "AIRTIME",
        createdAt: { lt: tenMinAgo },
      },
      data: { status: "FAILED" },
    });
    if (billPending > 0) console.log(`[TX CLEANUP] Expired ${billPending} stale PENDING bill(s)`);

    /**
     * Username sends nobody signed, for the phones that could not say so.
     *
     * Not covered before, so an unsigned transfer stayed "Pending" for good.
     * PENDING is the guarantee: submit claims the row as PROCESSING before
     * broadcasting, so these were never sent. A hash on the row would mean
     * otherwise, and such a row is left for a person.
     */
    const unsignedTransfers = await prisma.transaction.findMany({
      where: { status: "PENDING", type: "TRANSFER_OUT", createdAt: { lt: tenMinAgo } },
      select: { id: true, metadata: true },
    });
    let transferPending = 0;
    for (const row of unsignedTransfers) {
      const meta = (row.metadata ?? {}) as any;
      if (meta.txHash) continue;
      await prisma.transaction.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          metadata: { ...meta, neverSigned: true, clientError: meta.clientError || "Not signed within 10 minutes" },
        },
      });
      transferPending++;
    }
    if (transferPending > 0) console.log(`[TX CLEANUP] Expired ${transferPending} stale PENDING username transfer(s) — never signed`);

    /**
     * Settle sweeps nobody came back to finish.
     *
     * A leg only reaches the server when the phone submits it. An app closed
     * mid-flight, a signature the wallet refused, a request that never left the
     * handset - any of them leaves a leg at `pending` and the row PENDING for
     * ever. After ten minutes the signing payloads have long expired from
     * memory and nothing more can arrive, so what landed is all that ever will.
     *
     * Not the blanket FAILED the others get. A sweep that moved two chains out
     * of three delivered, and calling that failed would tell somebody their
     * money did not arrive while it is sitting in their wallet.
     */
    const openSweeps = await prisma.transaction.findMany({
      where: { status: "PENDING", type: "SWEEP", createdAt: { lt: tenMinAgo } },
      select: { id: true, reference: true, metadata: true },
    });

    let settledSweeps = 0;
    for (const row of openSweeps) {
      const meta = (row.metadata ?? {}) as any;
      const legs = ((meta.legs ?? []) as SweepLeg[]).map((l) =>
        l.status === "pending" || l.status === "sending"
          ? { ...l, status: "failed" as const, error: l.error || "The app never sent this one" }
          : l
      );

      /**
       * A leg we took and did not pay for stays open on purpose.
       *
       * Their token is in treasury and the credit never went out. Closing the
       * row would file it away as finished when somebody still has to send that
       * money by hand, so it stays PENDING and says so once every cycle until
       * a person deals with it.
       */
      if (legs.some((l) => l.status === "sent")) {
        console.error(
          `[SWEEP] ⚠️ ${row.reference} is holding a leg we took and did not credit — needs a person`
        );
        continue;
      }

      const landed = legs.filter((l) => l.status === "landed");
      await prisma.transaction.update({
        where: { id: row.id },
        data: {
          status: landed.length > 0 ? "COMPLETED" : "FAILED",
          amount: landed.reduce((n, l) => n + l.amount, 0),
          metadata: { ...meta, legs, completedAt: new Date().toISOString() },
        },
      });
      settledSweeps++;
    }
    if (settledSweeps > 0) console.log(`[TX CLEANUP] Settled ${settledSweeps} open sweep(s)`);

    // Expire PROCESSING sells stuck for over 1 hour (Paystack should have resolved by then)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { count: sellProcessing } = await prisma.transaction.updateMany({
      where: {
        status: "PROCESSING",
        type: "SELL",
        createdAt: { lt: oneHourAgo },
      },
      data: { status: "FAILED" },
    });
    if (sellProcessing > 0) console.log(`[TX CLEANUP] Expired ${sellProcessing} stale PROCESSING sell(s)`);
  } catch (err) {
    console.error("[TX CLEANUP] Error:", err);
  }
}

setInterval(cleanupStaleTransactions, 5 * 60 * 1000);

/**
 * And once shortly after boot, not only five minutes in.
 *
 * An interval starts counting when the process does, so every deploy pushed
 * the first sweep five minutes into the future - and a row waiting to be
 * settled waited that long again each time something shipped. Twenty seconds
 * is enough for the database pool to be up and short enough that nobody
 * watching a stuck row has to wonder whether the job exists.
 */
setTimeout(cleanupStaleTransactions, 20_000);

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Username Transfer — 2-phase on-chain transfer
// Phase 1: Validate, build tx, sponsor gas → return signing message
// Phase 2: Receive user sig, broadcast on-chain, update DB
//
// No KYC gate and no naira cap: the transfer moves the user own tokens
// between two wallets on chain, so there is no payout rail to limit. This
// header claimed both users had to be VERIFIED, which nothing enforced.
// ═══════════════════════════════════════════════════════════

// ─── Minimum transfer amounts per asset ─────────────────
const MIN_TRANSFER: Record<string, number> = {
  USDC: 0.10,
  USDT: 0.10,
  MOVE: 0.05,
  SOL:  0.001,
};

const usernameTransferPrepareSchema = z.object({
  recipientUsername: z.string().min(3).max(30).trim(),
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL", "cNGN"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  amount: z.number().positive(),
  /**
   * The sender's memo, copied onto both sides' transactions.
   *
   * Capped at what the receipt prints; the client caps at the same number, so
   * this is the backstop rather than the rule anyone meets.
   */
  narration: z.string().max(80).optional(),
  senderAddress: z.string().min(10).max(128).optional(),
});

/**
 * Can this person receive on Stellar, coin by coin?
 *
 * Asked by the send screen before anything is signed, so a Stellar holding
 * the recipient cannot take is greyed out in the picker instead of refused on
 * the summary screen. The app only asks when the sender holds something on
 * Stellar, since each answer is a Horizon read from the server's allowance.
 *
 * known: false when Stellar could not be reached. The app then leaves the row
 * alone, and prepare - which checks again - still has the final word.
 */
router.get(
  "/transfer/username/stellar/:recipientId",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    const none = { USDC: false, USDT: false };
    try {
      if (!stellar.isStellarConfigured()) {
        res.json({ ...none, known: true });
        return;
      }
      const userId = String(req.params.recipientId);
      const row = await prisma.wallet.findFirst({
        where: { userId, chain: "STELLAR", address: { not: null } },
        select: { address: true },
      });
      let address = row?.address ?? null;
      if (!address) {
        const sol = await prisma.wallet.findFirst({
          where: { userId, chain: "SOL", address: { not: null } },
          select: { address: true },
        });
        address = sol?.address ? stellar.stellarAddressFromSolana(sol.address) : null;
      }
      if (!address) {
        res.json({ ...none, known: true });
        return;
      }
      const state = await stellar.getAccountState(address);
      res.json({
        USDC: state.exists && state.trust.USDC,
        USDT: state.exists && state.trust.USDT,
        known: true,
      });
    } catch (err: any) {
      console.warn(`[USERNAME] Stellar recipient check failed: ${err?.message ?? err}`);
      res.json({ ...none, known: false });
    }
  },
);

// POST /transactions/transfer/username/prepare
router.post(
  "/transfer/username/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(usernameTransferPrepareSchema),
  async (req: Request, res: Response) => {
    try {
      // ── Pause gate ──────────────────────────────────────
      const usernamePaused = await pauseGuard("username");
      if (usernamePaused) {
        res.status(503).json({ error: usernamePaused, paused: true, service: "username" });
        return;
      }

      const senderId = req.user!.userId;
      const { recipientUsername, asset, chain, amount } = req.body;
      // Absent rather than empty when nothing was typed, so every reader can
      // ask `meta.narration ?` and get the answer it expects.
      const narration = (req.body.narration || "").trim() || undefined;

      // Validate asset+chain combo
      const validChains = VALID_ASSET_CHAINS[asset];
      if (!validChains || !validChains.includes(chain)) {
        res.status(400).json({ error: `${asset} is not supported on ${chain}` });
        return;
      }

      /**
       * The same Solana ceiling withdrawals answer to.
       *
       * Shared with withdrawals rather than counted separately: to the gas
       * wallet these are one thing, a sponsored Solana transfer to an address
       * the sender picked, and a username on the other end does not make it
       * cheaper. Counting them apart would have meant twenty a day.
       */
      const solDay = await solanaDayLimit(senderId, chain);
      if (!solDay.ok) {
        console.warn(`[USERNAME] Solana day cap hit by ${senderId}`);
        res.status(429).json({ error: solDay.error });
        return;
      }

      // ── Fetch sender info ───────────────────────────────
      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { username: true, email: true, firstName: true },
      });
      if (!sender) {
        res.status(404).json({ error: "Sender not found" });
        return;
      }

      // ── Find recipient ──────────────────────────────────
      const recipient = await (async () => {
        /**
         * Who exactly, or nobody.
         *
         * This was findFirst on a case-insensitive match, so two accounts whose
         * names differ only in case - mrrevy and MrRevy - both matched and the
         * database returned whichever it pleased. A transfer went to the wrong
         * person, and neither the sender nor the receiver could have told.
         *
         * Refusing on ambiguity is the only safe answer. Money is the one thing
         * that must not be delivered on a guess, and the sender can always be
         * asked to type the name the way it is written.
         */
        const found = await prisma.user.findMany({
          where: { username: { equals: recipientUsername, mode: "insensitive" } },
          select: { id: true, username: true, email: true, firstName: true, walletType: true },
          take: 5,
        });
        const exact = found.find((u) => u.username === recipientUsername);
        if (!exact && found.length > 1) {
          console.error(
            `[TRANSFER] ambiguous recipient "${recipientUsername}" matched ${found.length}: ` +
              found.map((u) => u.username).join(", "),
          );
          return null;
        }
        return exact ?? (found.length === 1 ? found[0] : null);
      })()
      if (!recipient) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }
      if (recipient.id === senderId) {
        res.status(400).json({ error: "You cannot send to yourself" });
        return;
      }

      /**
       * Only an email wallet may be sent to by name.
       *
       * Receiving on chain is not ours to control - any address can be paid by
       * anyone. But a username transfer is: we choose which address the money
       * goes to, and choosing a 12-word wallet now means choosing one that can
       * no longer send. The money would arrive somewhere its owner cannot
       * spend from, which is worse than not arriving.
       *
       * Refused before the sender signs anything, so nothing is spent finding
       * out.
       */
      if (recipient.walletType === "MNEMONIC") {
        res.status(409).json({
          error: `@${recipient.username} is still on the old wallet and cannot receive by username yet. Ask them to open the app to upgrade.`,
          code: "RECIPIENT_WALLET_OLD",
        });
        return;
      }

      // ── Minimum amount check ───────────────────────────
      const minTransfer = MIN_TRANSFER[asset] ?? 0.01;
      if (amount < minTransfer) {
        res.status(400).json({ error: `Minimum transfer is ${minTransfer} ${asset}` });
        return;
      }

      // ── Naira limit checks ─────────────────────────────
      const ngnRate = await getLiveNgnRate(asset);
      if (!ngnRate) {
        res.status(503).json({ error: "Unable to fetch current rate. Please try again." });
        return;
      }
      // At par for cNGN, matching what the sender was asked to type. Pricing
      // the same transfer at the market here would have put 100 cNGN on the
      // receipt beside a naira value of 98.87 - the same surprise the send
      // screen just stopped causing, one screen later.
      const amountNaira = asset === "cNGN" ? amount : amount * ngnRate;

      // ── Lookup sender on-chain wallet ───────────────────
      let senderWallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId: senderId, asset: asset as Asset, chain: chain as Chain } },
      });
      if (!senderWallet?.address) {
        // Same reasoning as the recipient lookup below: one key serves every
        // EVM chain, so a row missing on a newly added one is not a missing
        // wallet. Never across Movement or Solana, which are different keys.
        const fallback = await prisma.wallet.findFirst({
          where: {
            userId: senderId,
            chain: EVM_CHAINS.includes(chain as Chain) ? { in: EVM_CHAINS } : (chain as Chain),
            address: { not: null },
          },
        });
        if (fallback?.address) {
          senderWallet = await prisma.wallet.upsert({
            where: { userId_asset_chain: { userId: senderId, asset: asset as Asset, chain: chain as Chain } },
            update: { address: fallback.address },
            create: { userId: senderId, asset: asset as Asset, chain: chain as Chain, balance: 0, address: fallback.address },
          });
        }
      }
      if (!senderWallet?.address) {
        res.status(400).json({ error: "No wallet address found for this chain" });
        return;
      }

      // Cross-check client-derived address
      const { senderAddress } = req.body;
      if (senderAddress) {
        const { ok, expected } = await senderAddressMatches(
          senderId, chain, senderAddress, senderWallet.address,
        );
        if (!ok) {
          console.error(`[TRANSFER] ADDRESS MISMATCH — user ${senderId}, chain ${chain}, DB: ${expected}, client: ${senderAddress}`);
          res.status(409).json({ error: "Wallet address mismatch detected. Transfer blocked for security." });
          return;
        }
      }

      // ── Lookup recipient on-chain wallet ────────────────
      let recipientWallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId: recipient.id, asset: asset as Asset, chain: chain as Chain } },
      });
      if (!recipientWallet?.address) {
        /**
         * One address serves every EVM chain, so look across them.
         *
         * This searched the target chain only, which works while a person has
         * rows everywhere - and fails the moment a chain is added, because
         * their rows are created when they next open the app and a sender is
         * not going to wait for that. The recipient's Base address IS their
         * Arc address; there is nothing to wait for.
         *
         * Scoped to EVM deliberately. A Movement or Solana address is a
         * different key and must never be substituted for one another.
         */
        const fallback = await prisma.wallet.findFirst({
          where: {
            userId: recipient.id,
            chain: EVM_CHAINS.includes(chain as Chain) ? { in: EVM_CHAINS } : (chain as Chain),
            address: { not: null },
          },
        });
        if (fallback?.address) {
          recipientWallet = await prisma.wallet.upsert({
            where: { userId_asset_chain: { userId: recipient.id, asset: asset as Asset, chain: chain as Chain } },
            update: { address: fallback.address },
            create: { userId: recipient.id, asset: asset as Asset, chain: chain as Chain, balance: 0, address: fallback.address },
          });
        }

        /**
         * TON, which nobody should have to open the app to receive on.
         *
         * A TON address is a pure function of the Solana public key, so a
         * recipient has one from the moment they have a Solana wallet -
         * whether or not this database has written it down. The row is
         * created when they next sync, and a sender is not going to wait for
         * that: without this, sending to somebody who had not opened the app
         * since TON shipped was refused as "no wallet on this chain", which
         * is not true of them and not something they could act on.
         *
         * Derived rather than looked up, for the same reason the EVM
         * fallback above copies an address across chains: there is nothing
         * to wait for.
         */
        if (!recipientWallet?.address && chain === "TON") {
          const sol = await prisma.wallet.findFirst({
            where: { userId: recipient.id, chain: "SOL", address: { not: null } },
            select: { address: true },
          });
          if (sol?.address) {
            const derived = ton.tonAddressFromSolana(sol.address);
            recipientWallet = await prisma.wallet.upsert({
              where: { userId_asset_chain: { userId: recipient.id, asset: asset as Asset, chain: "TON" } },
              update: { address: derived },
              create: {
                userId: recipient.id, asset: asset as Asset, chain: "TON",
                balance: 0, address: derived,
              },
            });
          }
        }

        /**
         * Stellar, which unlike TON cannot be received on until it is opened.
         *
         * The address is still a pure function of the Solana key, but an
         * account has to exist, with a trustline for the coin, before a payment
         * can land - and opening it needs the recipient's own signature, so a
         * sender cannot do it for them. The row is only written once the
         * account is really there, so nobody's balance refresh starts reading
         * Horizon for an account that does not exist.
         */
        if (!recipientWallet?.address && chain === "STELLAR") {
          const sol = await prisma.wallet.findFirst({
            where: { userId: recipient.id, chain: "SOL", address: { not: null } },
            select: { address: true },
          });
          if (sol?.address) {
            const derived = stellar.stellarAddressFromSolana(sol.address);
            const state = await stellar.getAccountState(derived).catch(() => null);
            if (!state) {
              res.status(503).json({ error: "Could not reach Stellar. Try again." });
              return;
            }
            if (state.exists && state.trust[asset as stellar.StellarCoin]) {
              recipientWallet = await prisma.wallet.upsert({
                where: { userId_asset_chain: { userId: recipient.id, asset: asset as Asset, chain: "STELLAR" } },
                update: { address: derived },
                create: { userId: recipient.id, asset: asset as Asset, chain: "STELLAR", balance: 0, address: derived },
              });
            }
          }
        }
      }
      if (!recipientWallet?.address) {
        res.status(400).json({
          error:
            chain === "STELLAR"
              ? `@${recipient.username} hasn't turned on ${asset === "USDT" ? "USDT" : "USDC"} on Stellar yet. Send it on another network.`
              : "Recipient does not have a wallet on this chain yet",
        });
        return;
      }

      // A row can exist for one coin while the other has no trustline yet.
      if (chain === "STELLAR") {
        const state = await stellar.getAccountState(recipientWallet.address).catch(() => null);
        if (!state) {
          res.status(503).json({ error: "Could not reach Stellar. Try again." });
          return;
        }
        if (!state.exists || !state.trust[asset as stellar.StellarCoin]) {
          res.status(400).json({
            error: `@${recipient.username} hasn't turned on ${asset === "USDT" ? "USDT" : "USDC"} on Stellar yet. Send it on another network.`,
          });
          return;
        }
      }

      // ── Verify on-chain balance — never fall back to DB balance ──
      let onChainBalance: number;
      try {
        onChainBalance = await getOnChainBalance(asset, chain, senderWallet.address);
      } catch (err: any) {
        console.error(`[TRANSFER] on-chain balance check failed: ${err.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }
      /**
       * The Solana send charge, if it is switched on.
       *
       * Only the stablecoins, and only this flow and the username one -
       * selling and bills are untouched. Zero whenever the switch is off,
       * which is how it ships.
       */
      const sendFee =
        chain === "SOL" && (asset === "USDC" || asset === "USDT")
          ? await solanaSendFee()
          : 0;

      if (onChainBalance < amount + sendFee) {
        res.status(400).json({
          error: sendFee
            ? `Insufficient balance. This send also carries a ${sendFee} ${assetLabel(asset)} fee.`
            : "Insufficient on-chain balance",
        });
        return;
      }

      // ── Create PENDING transaction ──────────────────────
      const reference = `INT-${Date.now().toString(36).slice(-8)}-${crypto.randomBytes(3).toString("hex")}`;
      const transaction = await prisma.transaction.create({
        data: {
          userId: senderId,
          type: "TRANSFER_OUT",
          asset: asset as Asset,
          chain: chain as Chain,
          amount,
          fee: 0,
          status: "PENDING",
          reference: `${reference}-OUT`,
          metadata: {
            recipientUsername: recipient.username,
            recipientId: recipient.id,
            recipientAddress: recipientWallet.address,
            senderAddress: senderWallet.address,
            transferType: "username",
            amountNaira: Math.round(amountNaira),
            ...(narration ? { narration } : {}),
          },
        },
      });

      // ── Build on-chain tx + sponsor gas ─────────────────
      let signingMessage: string;
      // Only the EVM branch produces one. An MPC wallet cannot sign a bare
      // hash, so it signs the whole transaction and needs the request itself;
      // without this the client throws "can't be signed on this device".
      let txRequest: Record<string, string | number> | undefined;
      // TON only: what the relay takes out of the transfer to pay the gas.
      let relayFee: number | undefined;
      if (chain === "MOVE") {
        ({ signingMessage } = await prepareMovementWithdrawal(
          transaction.id, senderWallet.address, recipientWallet.address,
          amount, asset as "MOVE" | "USDC" | "USDT" | "USDCx"
        ));
      } else if (chain === "SOL") {
        ({ signingMessage } = await prepareSolanaWithdrawal(
          transaction.id, senderWallet.address, recipientWallet.address,
          amount, asset as "USDC" | "USDT" | "SOL", sendFee,
        ));
      } else if (chain === "TON") {
        /**
         * Both sides named by their Solana address.
         *
         * The sender's because that is where the signing key is; the
         * recipient's because their TON address is derived from it the same
         * way, and deriving it here beats trusting a stored row that may
         * predate TON entirely.
         */
        const solWallets = await prisma.wallet.findMany({
          where: {
            userId: { in: [senderId, recipient.id] },
            chain: "SOL",
            address: { not: null },
          },
          select: { userId: true, address: true },
        });
        const senderSol = solWallets.find((w) => w.userId === senderId)?.address;
        const recipientSol = solWallets.find((w) => w.userId === recipient.id)?.address;
        if (!senderSol || !recipientSol) {
          res.status(400).json({
            error: !senderSol
              ? "No Solana key found to derive your TON wallet from"
              : `@${recipient.username} cannot receive on TON yet`,
          });
          return;
        }
        ({ signingMessage, relayFee } = await prepareTonWithdrawal(
          transaction.id, senderSol, ton.tonAddressFromSolana(recipientSol),
          amount, asset as "USDT"
        ).then((r) => ({ signingMessage: r.signingMessage, relayFee: r.commission })));
      } else if (chain === "STELLAR") {
        ({ signingMessage } = await stellar.preparePayment(transaction.id, {
          from: senderWallet.address,
          to: recipientWallet.address,
          coin: asset as stellar.StellarCoin,
          amount,
        }));
      } else {
        ({ signingMessage, txRequest } = await prepareEvmWithdrawal(
          transaction.id, senderWallet.address, recipientWallet.address,
          amount, asset as "USDC" | "USDT" | "ETH", chain as "BASE" | "BEP20" | "ARB"
        ));
      }

      res.json({
        transferId: transaction.id,
        signingMessage,
        // Only MPC wallets use this; key-holding wallets sign the hash above.
        txRequest,
        chain,
        // TON only: the relay's cut, out of the same USDT.
        relayFee,
        // Solana only, and only when the charge is switched on.
        sendFee,
      });
    } catch (err: any) {
      console.error("Username transfer prepare error:", err);
      const msg = err?.message || "";
      if (msg.includes("Insufficient")) {
        res.status(400).json({ error: "Insufficient balance for this transfer" });
      } else if (msg.includes("Unsupported asset") || err?.name === "StellarError") {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: "Failed to prepare transfer" });
      }
    }
  }
);

// POST /transactions/transfer/username/submit
const usernameTransferSubmitSchema = z.object({
  transferId: z.string().min(1),
  // Empty is allowed because an MPC wallet signs the whole transaction instead
  // of a hash and sends `signedRaw`; the refine below insists on one or the
  // other, so a request carrying neither is still rejected.
  signature: z.string().regex(/^[0-9a-fA-F]*$/, "Signature must be hex").default(""),
  publicKey: z.string().regex(/^[0-9a-fA-F]*$/, "Public key must be hex").default(""),
  signedRaw: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, "Signed transaction must be 0x-prefixed hex")
    .optional(),
})
  // One or the other must be present. Without this, `signature` defaulting to ""
  // would let a request carrying no proof at all pass validation.
  .refine((v) => !!v.signedRaw || (v.signature.length > 0 && v.publicKey.length > 0), {
    message: "A signature or a signed transaction is required",
  });

router.post(
  "/transfer/username/submit",
  requireAuth,
  requireActiveSession,
  validate(usernameTransferSubmitSchema),
  async (req: Request, res: Response) => {
    try {
      // ── Pause gate ──────────────────────────────────────
      const usernamePaused = await pauseGuard("username");
      if (usernamePaused) {
        res.status(503).json({ error: usernamePaused, paused: true, service: "username" });
        return;
      }

      const userId = req.user!.userId;
      const { transferId, signature, publicKey, signedRaw } = req.body;

      // Atomically claim the PENDING tx
      const claimResult = await prisma.transaction.updateMany({
        where: { id: transferId, userId, type: "TRANSFER_OUT", status: "PENDING" },
        data: { status: "PROCESSING" },
      });
      if (claimResult.count === 0) {
        const existing = await prisma.transaction.findUnique({ where: { id: transferId } });
        if (!existing || existing.userId !== userId) {
          res.status(404).json({ error: "Transaction not found" });
        } else {
          res.status(400).json({ error: "Transaction already processed" });
        }
        return;
      }

      const tx = await prisma.transaction.findUnique({ where: { id: transferId } });
      if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }

      const meta = tx.metadata as any;
      const recipientId = meta.recipientId;
      const recipientUsername = meta.recipientUsername;
      const amountNaira = meta.amountNaira;

      // ── Submit on-chain ─────────────────────────────────
      let txHash: string;
      if (tx.chain === "MOVE") {
        txHash = await submitMovementWithdrawal(transferId, signature, publicKey);
      } else if (tx.chain === "SOL") {
        txHash = await submitSolanaWithdrawal(transferId, signature, publicKey);
      } else if (tx.chain === "TON") {
        txHash = await submitTonWithdrawal(transferId, signature);
      } else if (tx.chain === "STELLAR") {
        txHash = await stellar.submitPayment(transferId, signature);
      } else if (EVM_CHAINS.includes(tx.chain as Chain)) {
        txHash = await submitEvmWithdrawal(transferId, signature, publicKey, signedRaw);
      } else {
        res.status(400).json({ error: `Unsupported chain: ${tx.chain}` });
        return;
      }

      // ── Update DB: mark completed, update balances, create recipient tx ──
      const amount = Number(tx.amount);
      const reference = tx.reference!.replace(/-OUT$/, "");

      const [senderTx, , , recipientTx] = await prisma.$transaction([
        // Mark sender tx completed with on-chain hash
        prisma.transaction.update({
          where: { id: transferId },
          data: {
            status: "COMPLETED",
            metadata: { ...meta, txHash },
          },
        }),
        // Debit sender DB balance
        prisma.wallet.update({
          where: { userId_asset_chain: { userId, asset: tx.asset, chain: tx.chain! } },
          data: { balance: { decrement: amount } },
        }),
        // Credit recipient DB balance
        prisma.wallet.update({
          where: { userId_asset_chain: { userId: recipientId, asset: tx.asset, chain: tx.chain! } },
          data: { balance: { increment: amount } },
        }),
        // Create recipient transaction record
        prisma.transaction.create({
          data: {
            userId: recipientId,
            type: "TRANSFER_IN",
            asset: tx.asset,
            chain: tx.chain,
            amount,
            fee: 0,
            status: "COMPLETED",
            reference: `${reference}-IN`,
            metadata: {
              /**
               * Masked at write time, not at read time.
               *
               * This row's metadata is handed to the recipient's app whole,
               * so a real handle stored here is a real handle shipped -
               * whatever the screen chooses to draw. `senderId` stays for
               * support to trace; it is not a handle and nothing resolves it
               * back to one.
               */
              senderUsername: publicNameOf(
                (await prisma.user.findUnique({
                  where: { id: userId },
                  select: { username: true, firstName: true, anonMode: true },
                })) ?? {},
              ),
              senderId: userId,
              transferType: "username",
              amountNaira,
              // The sender's memo, on the receiving side too. A note only one
              // party can read is not a note, it is a reminder.
              ...(meta.narration ? { narration: meta.narration } : {}),
              txHash,
            },
          },
        }),
      ]);

      console.log(`[TRANSFER] on-chain confirmed: ${txHash} — ${amount} ${tx.asset}/${tx.chain} ref=${reference}`);

      // ── Emails (fire-and-forget) ───────────────────────
      const sender = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true, firstName: true, anonMode: true } });
      // What the recipient is allowed to be told. The sender's own email and
      // push below still name the recipient in full - anonymous mode hides
      // your handle from others, it does not hide theirs from you.
      const senderLabel = sender ? publicNameOf(sender) : "Unknown";
      const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { email: true, username: true } });
      const dateStr = new Date().toLocaleString("en-US", { month: "short", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      const amountStr = amount.toFixed(tx.asset === "ETH" ? 8 : 4);

      if (sender?.email) {
        sendTransferOutEmail(sender.email, {
          amount: amountStr, asset: assetLabel(tx.asset), chain: tx.chain!,
          recipientUsername: recipientUsername,
          reference, date: dateStr,
        }).catch((e) => console.error("[TRANSFER] Sender email error:", e));
      }
      if (recipient?.email) {
        sendTransferInEmail(recipient.email, {
          amount: amountStr, asset: assetLabel(tx.asset), chain: tx.chain!,
          senderUsername: senderLabel,
          reference, date: dateStr,
        }).catch((e) => console.error("[TRANSFER] Recipient email error:", e));
      }

      // ── Notifications ──────────────────────────────────
      sendNotification({
        userId, type: "transaction", title: "Transfer Sent", body: `You sent ${amountStr} ${assetLabel(tx.asset)} to @${recipientUsername}`,
      }).catch(() => {});
      sendNotification({
        userId: recipientId, type: "transaction", title: "Transfer Received", body: `You received ${amountStr} ${assetLabel(tx.asset)} from @${senderLabel}`,
      }).catch(() => {});

      res.json({ status: "success", transaction: senderTx });
    } catch (err: any) {
      console.error("Username transfer submit error:", err);

      // Mark as FAILED if still PROCESSING — preserve broadcast hash if present.
      if (req.body?.transferId) {
        const failedHash = err?.txHash;
        const existing = await prisma.transaction.findUnique({
          where: { id: req.body.transferId },
          select: { metadata: true, status: true },
        }).catch(() => null);
        if (existing && existing.status === "PROCESSING") {
          await prisma.transaction.update({
            where: { id: req.body.transferId },
            data: {
              status: "FAILED",
              metadata: {
                ...((existing.metadata as any) || {}),
                ...(failedHash ? { txHash: failedHash } : {}),
                chainError: err?.message || "On-chain submit failed",
              },
            },
          }).catch(() => {});
        }
      }

      res.status(500).json({ error: err.message || "Transfer failed" });
    }
  }
);

export default router;
