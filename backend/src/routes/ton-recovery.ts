import crypto from "crypto";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { prepareTonWithdrawal, submitTonWithdrawal } from "../lib/gas-sponsor";
import { prisma } from "../lib/prisma";
import { sendNotification } from "../lib/push";
import { pauseGuard } from "../lib/service-status";
import * as ton from "../lib/ton";
import { correctTonRow, recoveryAllowed, tonRowState } from "../lib/ton-recovery";

/**
 * Moving USDT out of a TON wallet an account's old key controls, into the one
 * its current key controls. See lib/ton-recovery for how an account gets here.
 *
 * The old key signs on the phone and never reaches this server. The destination
 * is not an input: it is always calculated from the account's own current key,
 * so a stolen session or a tampered app has nowhere else to send it.
 */
const router = Router();
router.use(requireAuth, requireActiveSession);

/** The account's recovery, or the reason there isn't one. */
async function loadRecovery(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!recoveryAllowed(user?.username)) return null;
  const state = await tonRowState(userId);
  if (!state.stale || !state.saved || !state.current) return null;
  return { oldAddress: state.saved, currentAddress: state.current };
}

const recoveryRows = (userId: string, status: "PENDING" | "PROCESSING") => ({
  userId,
  status,
  chain: "TON" as const,
  metadata: { path: ["tonRecovery"], equals: true },
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const recovery = await loadRecovery(req.user!.userId);
    if (!recovery) {
      res.json({ available: false });
      return;
    }
    // Live from the chain, always. The stored balance never sizes a send.
    const balance = await ton.getTonUsdtBalance(recovery.oldAddress);
    const amount = ton.netOfTonFee(balance);
    if (amount <= 0) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, asset: "USDT", balance, amount, ...recovery });
  } catch (err: any) {
    // Not offered this time. The money is unaffected and the next look asks again.
    console.warn(`[TON-RECOVERY] status failed: ${err?.message}`);
    res.json({ available: false });
  }
});

const keySchema = z.object({ oldSolanaAddress: z.string().min(32).max(64) });

/** Whether a key found on the phone, or typed in, is the one that controls the old wallet. */
function keyMatches(oldSolanaAddress: string, oldAddress: string): boolean {
  try {
    return ton.sameTonAddress(ton.tonAddressFromSolana(oldSolanaAddress), oldAddress);
  } catch {
    return false;
  }
}

router.post("/check", validate(keySchema), async (req: Request, res: Response) => {
  const recovery = await loadRecovery(req.user!.userId);
  res.json({ matches: !!recovery && keyMatches(req.body.oldSolanaAddress, recovery.oldAddress) });
});

router.post("/prepare", requireDynamicWallet, validate(keySchema), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  let rowId: string | null = null;
  try {
    const paused = await pauseGuard("withdraw");
    if (paused) {
      res.status(503).json({ error: paused, paused: true, service: "withdraw" });
      return;
    }

    const recovery = await loadRecovery(userId);
    if (!recovery) {
      res.status(404).json({ error: "There is nothing to move.", code: "NOTHING_TO_RECOVER" });
      return;
    }
    const { oldSolanaAddress } = req.body;
    if (!keyMatches(oldSolanaAddress, recovery.oldAddress)) {
      res.status(409).json({ error: "These words belong to a different wallet.", code: "WRONG_KEY" });
      return;
    }

    if (await prisma.transaction.findFirst({ where: recoveryRows(userId, "PROCESSING"), select: { id: true } })) {
      res.status(409).json({ error: "This is already on its way. Check your balance in a moment.", code: "IN_PROGRESS" });
      return;
    }
    // One at a time: an earlier attempt that was never signed is finished with.
    await prisma.transaction.updateMany({ where: recoveryRows(userId, "PENDING"), data: { status: "CANCELLED" } });

    const balance = await ton.getTonUsdtBalance(recovery.oldAddress);
    const amount = ton.netOfTonFee(balance);
    if (amount <= 0) {
      res.status(404).json({ error: "There is nothing to move.", code: "NOTHING_TO_RECOVER" });
      return;
    }

    const row = await prisma.transaction.create({
      data: {
        userId,
        type: "WITHDRAW",
        asset: "USDT",
        chain: "TON",
        amount,
        fee: 0,
        status: "PENDING",
        reference: `TRC-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
        metadata: {
          tonRecovery: true,
          address: recovery.currentAddress,
          networkChain: "TON",
          senderAddress: recovery.oldAddress,
        },
      },
    });
    rowId = row.id;

    const { signingMessage, commission } = await prepareTonWithdrawal(
      row.id,
      oldSolanaAddress,
      recovery.currentAddress,
      amount,
      "USDT",
    );

    res.json({
      id: row.id,
      signingMessage,
      amount,
      relayFee: commission,
      asset: "USDT",
      oldAddress: recovery.oldAddress,
      currentAddress: recovery.currentAddress,
    });
  } catch (err: any) {
    console.error("[TON-RECOVERY] prepare failed:", err?.message);
    if (rowId) {
      await prisma.transaction
        .update({ where: { id: rowId }, data: { status: "FAILED" } })
        .catch(() => {});
    }
    res.status(500).json({ error: "We couldn't start this. Nothing was moved. Please try again." });
  }
});

const submitSchema = z.object({
  id: z.string().min(1).max(64),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

router.post("/submit", validate(submitSchema), async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { id, signature } = req.body;

  // Taken once, so a second tap can't send twice.
  const claim = await prisma.transaction.updateMany({
    where: { id, ...recoveryRows(userId, "PENDING") },
    data: { status: "PROCESSING" },
  });
  if (claim.count === 0) {
    res.status(400).json({ error: "This has already been handled." });
    return;
  }
  const tx = await prisma.transaction.findUnique({ where: { id } });
  const meta = (tx?.metadata ?? {}) as any;

  try {
    const txHash = await submitTonWithdrawal(id, signature);

    await prisma.transaction.update({
      where: { id },
      data: { status: "COMPLETED", metadata: { ...meta, txHash } },
    });
    // The money is across, so the account can now show its real address.
    await correctTonRow(userId, meta.senderAddress, meta.address).catch((e) =>
      console.error(`[TON-RECOVERY] moved but could not correct the row for ${userId}:`, e?.message),
    );

    sendNotification({
      userId,
      type: "transaction",
      title: "USDT moved",
      body: `${Number(tx!.amount).toFixed(2)} USDT is now in your current wallet.`,
    }).catch(() => {});

    res.json({ ok: true, amount: tx!.amount, asset: "USDT", txHash, currentAddress: meta.address });
  } catch (err: any) {
    console.error(`[TON-RECOVERY] submit failed for ${id}:`, err?.message);
    await prisma.transaction
      .update({ where: { id }, data: { status: "FAILED", metadata: { ...meta, chainError: err?.message || "Submit failed" } } })
      .catch(() => {});

    // Accepted by the relay but not yet seen on the chain: it may still land.
    const unseen = /accepted but has not appeared/i.test(err?.message || "");
    res.status(502).json({
      code: unseen ? "UNCONFIRMED" : "FAILED",
      error: unseen
        ? "Check your balance in a few minutes before trying again."
        : "Your USDT is still in your older wallet and nothing was taken.",
    });
  }
});

export default router;
