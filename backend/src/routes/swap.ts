import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { validate } from "../middleware/validate";
import { isAuroraConfigured, liveSwapAssets, auroraIncidents } from "../lib/aurora";
import { auroraSettings } from "../lib/aurora-settings";
import {
  SwapError,
  previewSwap,
  prepareSwap,
  submitSwap,
  submitSwapFee,
  refreshSwap,
  swapView,
} from "../lib/aurora-swap";

const router = Router();

/**
 * Swaps between chains, into the person's own wallet.
 *
 *   GET  /swap/config      what can be swapped, the fee and the minimum
 *   POST /swap/quote       a price to show (nothing reserved)
 *   POST /swap/prepare     a real quote and the transfer to sign
 *   POST /swap/submit      broadcast the signed transfer
 *   POST /swap/fee         broadcast the signed fee transfer (EVM only)
 *   GET  /swap/:id         where it has got to
 *
 * The fee and minimum come from the console and are re-checked on the
 * server at every step - whatever the app shows is only ever a preview.
 */

function fail(res: Response, err: any, label: string) {
  if (err instanceof SwapError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(`[SWAP] ${label}:`, err?.message || err);
  res.status(500).json({ error: "Something went wrong with the swap. Please try again." });
}

router.get("/config", requireAuth, requireActiveSession, async (_req: Request, res: Response) => {
  try {
    const settings = (await auroraSettings()).swap;
    const configured = isAuroraConfigured();
    const assets = configured ? await liveSwapAssets() : [];
    const incidents = configured ? await auroraIncidents() : null;
    res.json({
      enabled: configured && settings.enabled && assets.length > 0,
      feeBps: settings.feeBps,
      solanaFlatUsd: settings.solanaFlatUsd,
      minUsd: settings.minUsd,
      slippageBps: settings.slippageBps,
      assets: assets.map((a) => ({
        id: a.id,
        chain: a.chain,
        asset: a.asset,
        symbol: a.symbol,
        from: a.from,
        to: a.to,
        price: a.price,
        decimals: a.decimals,
      })),
      // Shown as a line on the screen when something on their side is slow.
      notice:
        incidents && incidents.status === "incidents"
          ? incidents.incidents.map((i) => i.publicDescription).filter(Boolean)[0] ?? "Some swaps may be slower than usual right now."
          : null,
    });
  } catch (err) {
    fail(res, err, "config");
  }
});

const pairSchema = z.object({
  from: z.string().min(1).max(32),
  to: z.string().min(1).max(32),
  amount: z.number().positive().max(1_000_000),
});

router.post("/quote", requireAuth, requireActiveSession, validate(pairSchema), async (req: Request, res: Response) => {
  try {
    const { from, to, amount } = req.body;
    res.json(await previewSwap(req.user!.userId, from, to, amount));
  } catch (err) {
    fail(res, err, "quote");
  }
});

router.post(
  "/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(pairSchema),
  async (req: Request, res: Response) => {
    try {
      const { from, to, amount } = req.body;
      res.json(await prepareSwap(req.user!.userId, from, to, amount));
    } catch (err) {
      fail(res, err, "prepare");
    }
  },
);

const signedSchema = z
  .object({
    swapId: z.string().min(1),
    // Empty when an MPC wallet signed the whole EVM transaction instead and sent signedRaw.
    signature: z.string().regex(/^[0-9a-fA-F]*$/).default(""),
    publicKey: z.string().regex(/^[0-9a-fA-F]*$/).default(""),
    signedRaw: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  })
  .refine((v) => !!v.signedRaw || (v.signature.length > 0 && v.publicKey.length > 0), {
    message: "A signature or a signed transaction is required",
  });

router.post("/submit", requireAuth, requireActiveSession, validate(signedSchema), async (req: Request, res: Response) => {
  try {
    const { swapId, signature, publicKey, signedRaw } = req.body;
    res.json(await submitSwap(req.user!.userId, swapId, { signature, publicKey, signedRaw }));
  } catch (err) {
    fail(res, err, "submit");
  }
});

router.post("/fee", requireAuth, requireActiveSession, validate(signedSchema), async (req: Request, res: Response) => {
  try {
    const { swapId, signature, publicKey, signedRaw } = req.body;
    res.json(await submitSwapFee(req.user!.userId, swapId, { signature, publicKey, signedRaw }));
  } catch (err) {
    fail(res, err, "fee");
  }
});

router.get("/:id", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const own = await prisma.transaction.findFirst({
      where: { id: String(req.params.id), userId: req.user!.userId, type: "SWEEP" },
      select: { id: true, metadata: true },
    });
    if (!own || (own.metadata as any)?.kind !== "swap") {
      res.status(404).json({ error: "Swap not found." });
      return;
    }
    const tx = await refreshSwap(own.id);
    res.json(swapView(tx!));
  } catch (err) {
    fail(res, err, "status");
  }
});

export default router;
