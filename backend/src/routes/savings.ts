import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession, requireVerifiedEmail } from "../middleware/auth";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { validate } from "../middleware/validate";
import { Prisma } from "@prisma/client";
import { getOnChainBalance } from "../lib/balances";
import { env } from "../config/env";
import { sendSavingsLockEmail, sendSavingsWithdrawEmail } from "../lib/email";
import {
  Aptos,
  AptosConfig,
  Network,
  AccountAuthenticatorEd25519,
  Ed25519PublicKey,
  Ed25519Signature,
  generateSigningMessageForTransaction,
} from "@aptos-labs/ts-sdk";

const router = Router();

// ─── Movement contract constants ────────────────────────────
const SAVINGS_MODULE =
  "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::savings_vault";
const MOVE_USDC_METADATA =
  "0x83121c9f9b0527d1f056e21a950d6bf3b9e9e2e8353d0e95ccea726713cbea39";
const MOVE_USDT_METADATA =
  "0x447721a30109c662dde9c73a0c2c9c9c459fb5e5a9c92f03c50fa69737f5d08d";

const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: env.MOVEMENT_RPC_URL,
  clientConfig: { API_KEY: env.SHINAMI_ACCESS_KEY },
  transactionGenerationConfig: { defaultTxnExpirySecFromNow: 120 },
});
const aptos = new Aptos(aptosConfig);

// ─── Shinami gas sponsorship ────────────────────────────────
const SHINAMI_GAS_URL = "https://api.us1.shinami.com/movement/gas/v1";

async function shinamiRpc(method: string, params: any[]): Promise<any> {
  if (!env.SHINAMI_ACCESS_KEY) throw new Error("SHINAMI_ACCESS_KEY not set");
  const res = await fetch(SHINAMI_GAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.SHINAMI_ACCESS_KEY,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(`Shinami ${method}: ${json.error.message}`);
  return json.result;
}

// ─── Pending savings transactions (2-min TTL) ───────────────
interface PendingSavingsTx {
  transaction: any;
  senderAddress: string;
  userId: string;
  meta: Record<string, any>;
  expiresAt: number;
}
const pendingSavingsTxs = new Map<string, PendingSavingsTx>();
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of pendingSavingsTxs) {
    if (entry.expiresAt < now) pendingSavingsTxs.delete(id);
  }
}, 60_000);

// ─── Schemas ────────────────────────────────────────────────
const createLockSchema = z.object({
  asset: z.enum(["USDC", "USDT"]),
  chain: z.enum(["MOVE"]),
  amount: z.number().positive("Amount must be positive"),
  durationDays: z.number().positive("Duration must be positive").max(180, "Maximum lock duration is 180 days"),
  name: z.string().max(50).optional(),
});

const submitLockSchema = z.object({
  prepareId: z.string().min(1),
  signature: z.string().min(1),
  publicKey: z.string().min(1),
});

const submitWithdrawSchema = z.object({
  prepareId: z.string().min(1),
  signature: z.string().min(1),
  publicKey: z.string().min(1),
});

const addToLockSchema = z.object({
  amount: z.number().positive("Amount must be positive"),
});

const submitAddToLockSchema = z.object({
  prepareId: z.string().min(1),
  signature: z.string().min(1),
  publicKey: z.string().min(1),
});

const listLocksSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
  status: z.enum(["ACTIVE", "COMPLETED", "WITHDRAWN"]).optional(),
});

// ═══════════════════════════════════════════════════════════
// POST /savings/lock/prepare
// Build on-chain create_lock tx, Shinami-sponsored
// ═══════════════════════════════════════════════════════════
router.post(
  "/lock/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  requireVerifiedEmail,
  validate(createLockSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { asset, chain, amount, durationDays, name } = req.body;

      const wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset, chain } },
      });
      if (!wallet?.address) {
        res.status(400).json({ error: "Wallet not found. Initialize wallets first." });
        return;
      }

      // Check on-chain balance (amount includes fee — contract takes 0.5% internally)
      let onChainBalance: number;
      try {
        onChainBalance = await getOnChainBalance(asset, chain, wallet.address);
      } catch (err: any) {
        console.error(`[SAVINGS] on-chain balance check failed: ${err.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }

      // Contract takes 0.5% fee internally, so user needs the full amount
      if (onChainBalance < amount) {
        res.status(400).json({
          error: "Insufficient balance",
          available: onChainBalance,
          required: amount,
        });
        return;
      }

      const faAddress = asset === "USDT" ? MOVE_USDT_METADATA : MOVE_USDC_METADATA;
      const amountUnits = BigInt(Math.floor(amount * 1e6));
      const unlockTimestamp = BigInt(Math.floor(Date.now() / 1000) + Math.round(durationDays * 86400));

      const transaction = await aptos.transaction.build.simple({
        sender: wallet.address,
        withFeePayer: true,
        data: {
          function: `${SAVINGS_MODULE}::create_lock` as `${string}::${string}::${string}`,
          functionArguments: [faAddress, amountUnits, unlockTimestamp],
        },
      });

      const signingMessage = generateSigningMessageForTransaction(transaction);
      const prepareId = `savings_lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      pendingSavingsTxs.set(prepareId, {
        transaction,
        senderAddress: wallet.address,
        userId,
        meta: { asset, chain, amount, durationDays, unlockTimestamp: Number(unlockTimestamp), name },
        expiresAt: Date.now() + 120_000,
      });

      res.json({
        prepareId,
        signingMessage: Buffer.from(signingMessage).toString("hex"),
        chain: "MOVE",
      });
    } catch (err: any) {
      console.error("Prepare savings lock error:", err);
      res.status(500).json({ error: "Failed to prepare lock" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /savings/lock/submit
// Submit user-signed create_lock tx via Shinami
// ═══════════════════════════════════════════════════════════
router.post(
  "/lock/submit",
  requireAuth,
  requireActiveSession,
  validate(submitLockSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { prepareId, signature, publicKey } = req.body;

      const pending = pendingSavingsTxs.get(prepareId);
      if (!pending || pending.userId !== userId) {
        res.status(400).json({ error: "Transaction expired or not found" });
        return;
      }

      const senderAuth = new AccountAuthenticatorEd25519(
        new Ed25519PublicKey(publicKey),
        new Ed25519Signature(signature)
      );

      const rawTxHex = Buffer.from(pending.transaction.rawTransaction.bcsToBytes()).toString("hex");
      const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");
      const sponsorResult = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [rawTxHex, senderAuthHex]);

      const txHash: string = sponsorResult?.pendingTransaction?.hash || sponsorResult?.hash || sponsorResult;
      if (!txHash || typeof txHash !== "string") {
        throw new Error(`Shinami returned no tx hash: ${JSON.stringify(sponsorResult)}`);
      }

      await aptos.waitForTransaction({ transactionHash: txHash, options: { timeoutSecs: 60, checkSuccess: true } });
      pendingSavingsTxs.delete(prepareId);

      const { asset, chain, amount, durationDays, unlockTimestamp, name } = pending.meta;
      const fee = amount * 0.005; // 0.5% taken by contract
      const unlocksAt = new Date(unlockTimestamp * 1000);

      // Record in DB
      const lock = await prisma.savingsLock.create({
        data: {
          userId,
          asset,
          chain,
          amount: new Prisma.Decimal(amount - fee),
          durationDays: Math.max(1, Math.round(durationDays)),
          unlocksAt,
          txHash,
          ...(name && { name }),
        },
      });

      await prisma.transaction.create({
        data: {
          userId,
          type: "LOCK",
          asset,
          chain,
          amount: new Prisma.Decimal(amount),
          fee: new Prisma.Decimal(fee),
          status: "COMPLETED",
          reference: txHash,
          metadata: { durationDays, unlocksAt: unlocksAt.toISOString(), txHash },
        },
      });

      console.log(`[SAVINGS] Lock created on-chain: ${txHash}`);

      // Send email notification (fire-and-forget)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        const durationLabel = durationDays >= 90 ? `${Math.round(durationDays / 30)} Months` : `${durationDays} Days`;
        sendSavingsLockEmail(user.email, {
          amount: (amount - fee).toFixed(2),
          asset,
          chain,
          fee: fee.toFixed(4),
          duration: durationLabel,
          unlockDate: unlocksAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
          txHash,
          date: new Date().toLocaleString("en-US"),
        }).catch((e) => console.error("[SAVINGS] Lock email failed:", e.message));
      }

      res.status(201).json({
        lock: {
          id: lock.id,
          asset: lock.asset,
          chain: lock.chain,
          amount: Number(lock.amount),
          durationDays: lock.durationDays,
          fee,
          lockedAt: lock.lockedAt,
          unlocksAt: lock.unlocksAt,
          status: lock.status,
          txHash,
          name: lock.name,
        },
      });
    } catch (err: any) {
      console.error("Submit savings lock error:", err);
      const userMsg = err?.name === "AptosApiError" || err?.name === "WaitForTransactionError" || err?.name === "FailedTransactionError"
        ? "Transaction failed on the Movement network. Please try again."
        : err.message || "Failed to submit lock";
      res.status(500).json({ error: userMsg });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /savings/locks
// List user's savings locks (paginated, filterable)
// ═══════════════════════════════════════════════════════════
router.get("/locks", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const parsed = listLocksSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query params" });
      return;
    }

    const { page, limit, status } = parsed.data;
    const skip = (page - 1) * limit;

    const where: Prisma.SavingsLockWhereInput = {
      userId,
      ...(status && { status }),
    };

    const [locks, total] = await Promise.all([
      prisma.savingsLock.findMany({
        where,
        select: {
          id: true,
          asset: true,
          chain: true,
          amount: true,
          durationDays: true,
          status: true,
          lockedAt: true,
          unlocksAt: true,
          unlockedAt: true,
          txHash: true,
          name: true,
        },
        orderBy: { lockedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.savingsLock.count({ where }),
    ]);

    // Calculate total locked
    const totalLocked = await prisma.savingsLock.aggregate({
      where: { userId, status: "ACTIVE" },
      _sum: { amount: true },
    });

    res.json({
      locks: locks.map((l) => ({
        ...l,
        amount: Number(l.amount),
      })),
      totalLocked: Number(totalLocked._sum.amount || 0),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("List locks error:", err);
    res.status(500).json({ error: "Failed to get locks" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /savings/locks/:id
// Single lock detail
// ═══════════════════════════════════════════════════════════
router.get("/locks/:id", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const id = req.params.id as string;

    const lock = await prisma.savingsLock.findUnique({ where: { id } });

    if (!lock || lock.userId !== userId) {
      res.status(404).json({ error: "Lock not found" });
      return;
    }

    res.json({
      lock: {
        id: lock.id,
        asset: lock.asset,
        chain: lock.chain,
        amount: Number(lock.amount),
        durationDays: lock.durationDays,
        status: lock.status,
        lockedAt: lock.lockedAt,
        unlocksAt: lock.unlocksAt,
        unlockedAt: lock.unlockedAt,
        txHash: lock.txHash,
        name: lock.name,
      },
    });
  } catch (err) {
    console.error("Get lock error:", err);
    res.status(500).json({ error: "Failed to get lock" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /savings/locks/:id/withdraw/prepare
// Build on-chain withdraw tx, Shinami-sponsored
// ═══════════════════════════════════════════════════════════
router.post(
  "/locks/:id/withdraw/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;

      const lock = await prisma.savingsLock.findUnique({ where: { id } });

      if (!lock || lock.userId !== userId) {
        res.status(404).json({ error: "Lock not found" });
        return;
      }

      if (lock.status !== "ACTIVE") {
        res.status(400).json({ error: "Lock is not active" });
        return;
      }

      if (lock.unlocksAt > new Date()) {
        res.status(400).json({
          error: "Lock has not matured yet",
          unlocksAt: lock.unlocksAt,
        });
        return;
      }

      const wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset: lock.asset, chain: lock.chain } },
      });
      if (!wallet?.address) {
        res.status(400).json({ error: "Wallet not found" });
        return;
      }

      // Query on-chain lock count to find the lock_id
      // Lock IDs are per-user sequential starting at 1
      // We need to query the contract's view function to find the right lock_id
      const userLocksResult = await aptos.view({
        payload: {
          function: `${SAVINGS_MODULE}::get_user_locks` as `${string}::${string}::${string}`,
          functionArguments: [wallet.address],
        },
      });

      // Parse the on-chain locks to find the matching one
      const onChainLocks = (userLocksResult[0] as any[]) || [];
      const faAddress = lock.asset === "USDT" ? MOVE_USDT_METADATA : MOVE_USDC_METADATA;
      const lockAmount = Math.floor(Number(lock.amount) * 1e6);

      // Match by fa_address and approximate amount (within rounding tolerance)
      const matchedLock = onChainLocks.find((l: any) => {
        const addrMatch = l.fa_address === faAddress;
        const amtDiff = Math.abs(Number(l.amount) - lockAmount);
        return addrMatch && amtDiff < 10; // within 10 units (rounding)
      });

      if (!matchedLock) {
        res.status(400).json({ error: "On-chain lock not found. It may have already been withdrawn." });
        return;
      }

      const onChainLockId = BigInt(matchedLock.lock_id);

      const transaction = await aptos.transaction.build.simple({
        sender: wallet.address,
        withFeePayer: true,
        data: {
          function: `${SAVINGS_MODULE}::withdraw` as `${string}::${string}::${string}`,
          functionArguments: [onChainLockId],
        },
      });

      const signingMessage = generateSigningMessageForTransaction(transaction);
      const prepareId = `savings_withdraw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      pendingSavingsTxs.set(prepareId, {
        transaction,
        senderAddress: wallet.address,
        userId,
        meta: { lockDbId: id, asset: lock.asset, chain: lock.chain, amount: Number(lock.amount) },
        expiresAt: Date.now() + 120_000,
      });

      res.json({
        prepareId,
        signingMessage: Buffer.from(signingMessage).toString("hex"),
        chain: "MOVE",
      });
    } catch (err: any) {
      console.error("Prepare savings withdraw error:", err);
      res.status(500).json({ error: "Failed to prepare withdrawal" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /savings/locks/:id/withdraw/submit
// Submit user-signed withdraw tx via Shinami
// ═══════════════════════════════════════════════════════════
router.post(
  "/locks/:id/withdraw/submit",
  requireAuth,
  requireActiveSession,
  validate(submitWithdrawSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { prepareId, signature, publicKey } = req.body;

      const pending = pendingSavingsTxs.get(prepareId);
      if (!pending || pending.userId !== userId) {
        res.status(400).json({ error: "Transaction expired or not found" });
        return;
      }

      const senderAuth = new AccountAuthenticatorEd25519(
        new Ed25519PublicKey(publicKey),
        new Ed25519Signature(signature)
      );

      const rawTxHex = Buffer.from(pending.transaction.rawTransaction.bcsToBytes()).toString("hex");
      const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");
      const sponsorResult = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [rawTxHex, senderAuthHex]);

      const txHash: string = sponsorResult?.pendingTransaction?.hash || sponsorResult?.hash || sponsorResult;
      if (!txHash || typeof txHash !== "string") {
        throw new Error(`Shinami returned no tx hash: ${JSON.stringify(sponsorResult)}`);
      }

      await aptos.waitForTransaction({ transactionHash: txHash, options: { timeoutSecs: 60, checkSuccess: true } });
      pendingSavingsTxs.delete(prepareId);

      const { lockDbId, asset, chain, amount } = pending.meta;

      // Update DB
      await prisma.$transaction([
        prisma.savingsLock.update({
          where: { id: lockDbId },
          data: { status: "WITHDRAWN", unlockedAt: new Date() },
        }),
        prisma.transaction.create({
          data: {
            userId,
            type: "UNLOCK",
            asset,
            chain,
            amount: new Prisma.Decimal(amount),
            status: "COMPLETED",
            reference: txHash,
            metadata: { lockId: lockDbId, txHash },
          },
        }),
      ]);

      console.log(`[SAVINGS] Withdraw confirmed on-chain: ${txHash}`);

      // Send email notification (fire-and-forget)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        sendSavingsWithdrawEmail(user.email, {
          amount: amount.toFixed(2),
          asset,
          chain,
          txHash,
          date: new Date().toLocaleString("en-US"),
        }).catch((e) => console.error("[SAVINGS] Withdraw email failed:", e.message));
      }

      res.json({
        message: "Lock withdrawn successfully",
        amount,
        asset,
        chain,
        txHash,
      });
    } catch (err: any) {
      console.error("Submit savings withdraw error:", err);
      const userMsg = err?.name === "AptosApiError" || err?.name === "WaitForTransactionError" || err?.name === "FailedTransactionError"
        ? "Transaction failed on the Movement network. Please try again."
        : err.message || "Failed to submit withdrawal";
      res.status(500).json({ error: userMsg });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /savings/locks/:id/add/prepare
// Build on-chain add_to_lock tx, Shinami-sponsored
// ═══════════════════════════════════════════════════════════
router.post(
  "/locks/:id/add/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  requireVerifiedEmail,
  validate(addToLockSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;
      const { amount } = req.body;

      const lock = await prisma.savingsLock.findUnique({ where: { id } });
      if (!lock || lock.userId !== userId) {
        res.status(404).json({ error: "Lock not found" });
        return;
      }
      if (lock.status !== "ACTIVE") {
        res.status(400).json({ error: "Lock is not active" });
        return;
      }
      if (lock.unlocksAt <= new Date()) {
        res.status(400).json({ error: "Lock has already expired. Cannot add to an expired lock." });
        return;
      }

      const wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset: lock.asset, chain: lock.chain } },
      });
      if (!wallet?.address) {
        res.status(400).json({ error: "Wallet not found" });
        return;
      }

      // Check on-chain balance
      let onChainBalance: number;
      try {
        onChainBalance = await getOnChainBalance(lock.asset, lock.chain, wallet.address);
      } catch (err: any) {
        console.error(`[SAVINGS] on-chain balance check failed: ${err.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }
      if (onChainBalance < amount) {
        res.status(400).json({ error: "Insufficient balance", available: onChainBalance, required: amount });
        return;
      }

      // Find on-chain lock_id
      const userLocksResult = await aptos.view({
        payload: {
          function: `${SAVINGS_MODULE}::get_user_locks` as `${string}::${string}::${string}`,
          functionArguments: [wallet.address],
        },
      });
      const onChainLocks = (userLocksResult[0] as any[]) || [];
      const faAddress = lock.asset === "USDT" ? MOVE_USDT_METADATA : MOVE_USDC_METADATA;
      const lockAmount = Math.floor(Number(lock.amount) * 1e6);

      const matchedLock = onChainLocks.find((l: any) => {
        const addrMatch = l.fa_address === faAddress;
        const amtDiff = Math.abs(Number(l.amount) - lockAmount);
        return addrMatch && amtDiff < 10;
      });
      if (!matchedLock) {
        res.status(400).json({ error: "On-chain lock not found." });
        return;
      }

      const onChainLockId = BigInt(matchedLock.lock_id);
      const amountUnits = BigInt(Math.floor(amount * 1e6));

      const transaction = await aptos.transaction.build.simple({
        sender: wallet.address,
        withFeePayer: true,
        data: {
          function: `${SAVINGS_MODULE}::add_to_lock` as `${string}::${string}::${string}`,
          functionArguments: [onChainLockId, amountUnits],
        },
      });

      const signingMessage = generateSigningMessageForTransaction(transaction);
      const prepareId = `savings_add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      pendingSavingsTxs.set(prepareId, {
        transaction,
        senderAddress: wallet.address,
        userId,
        meta: { lockDbId: id, asset: lock.asset, chain: lock.chain, amount },
        expiresAt: Date.now() + 120_000,
      });

      res.json({
        prepareId,
        signingMessage: Buffer.from(signingMessage).toString("hex"),
        chain: "MOVE",
      });
    } catch (err: any) {
      console.error("Prepare add-to-lock error:", err);
      res.status(500).json({ error: "Failed to prepare add-to-lock" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /savings/locks/:id/add/submit
// Submit user-signed add_to_lock tx via Shinami
// ═══════════════════════════════════════════════════════════
router.post(
  "/locks/:id/add/submit",
  requireAuth,
  requireActiveSession,
  validate(submitAddToLockSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { prepareId, signature, publicKey } = req.body;

      const pending = pendingSavingsTxs.get(prepareId);
      if (!pending || pending.userId !== userId) {
        res.status(400).json({ error: "Transaction expired or not found" });
        return;
      }

      const senderAuth = new AccountAuthenticatorEd25519(
        new Ed25519PublicKey(publicKey),
        new Ed25519Signature(signature)
      );

      const rawTxHex = Buffer.from(pending.transaction.rawTransaction.bcsToBytes()).toString("hex");
      const senderAuthHex = Buffer.from(senderAuth.bcsToBytes()).toString("hex");
      const sponsorResult = await shinamiRpc("gas_sponsorAndSubmitSignedTransaction", [rawTxHex, senderAuthHex]);

      const txHash: string = sponsorResult?.pendingTransaction?.hash || sponsorResult?.hash || sponsorResult;
      if (!txHash || typeof txHash !== "string") {
        throw new Error(`Shinami returned no tx hash: ${JSON.stringify(sponsorResult)}`);
      }

      await aptos.waitForTransaction({ transactionHash: txHash, options: { timeoutSecs: 60, checkSuccess: true } });
      pendingSavingsTxs.delete(prepareId);

      const { lockDbId, asset, chain, amount } = pending.meta;
      const fee = amount * 0.005; // 0.5% taken by contract
      const depositAmount = amount - fee;

      // Update DB: increment lock amount
      const updatedLock = await prisma.savingsLock.update({
        where: { id: lockDbId },
        data: { amount: { increment: new Prisma.Decimal(depositAmount) } },
      });

      await prisma.transaction.create({
        data: {
          userId,
          type: "LOCK",
          asset,
          chain,
          amount: new Prisma.Decimal(amount),
          fee: new Prisma.Decimal(fee),
          status: "COMPLETED",
          reference: txHash,
          metadata: { lockId: lockDbId, type: "add_to_lock", txHash },
        },
      });

      console.log(`[SAVINGS] Add-to-lock confirmed on-chain: ${txHash}`);

      // Send email notification (fire-and-forget)
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        sendSavingsLockEmail(user.email, {
          amount: depositAmount.toFixed(2),
          asset,
          chain,
          fee: fee.toFixed(4),
          duration: "Added to existing lock",
          unlockDate: updatedLock.unlocksAt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
          txHash,
          date: new Date().toLocaleString("en-US"),
        }).catch((e) => console.error("[SAVINGS] Add-to-lock email failed:", e.message));
      }

      res.json({
        lock: {
          id: updatedLock.id,
          asset: updatedLock.asset,
          chain: updatedLock.chain,
          amount: Number(updatedLock.amount),
          durationDays: updatedLock.durationDays,
          fee,
          lockedAt: updatedLock.lockedAt,
          unlocksAt: updatedLock.unlocksAt,
          status: updatedLock.status,
          txHash,
        },
      });
    } catch (err: any) {
      console.error("Submit add-to-lock error:", err);
      const userMsg = err?.name === "AptosApiError" || err?.name === "WaitForTransactionError" || err?.name === "FailedTransactionError"
        ? "Transaction failed on the Movement network. Please try again."
        : err.message || "Failed to submit add-to-lock";
      res.status(500).json({ error: userMsg });
    }
  }
);

export default router;
