/**
 * NEAR Intents 1Click — cross-chain deposit quote.
 *
 * User sends BTC or USDT-TRON to the generated deposit address from
 * any external wallet/exchange. NEAR Intents auto-swaps and delivers
 * USDCx to the user's existing Movement wallet.
 *
 * No on-device signing required — `depositType: "ORIGIN_CHAIN"` means
 * the user just sends. No refund address prompt either — we use
 * `refundType: "INTENTS"` so any failed swap is held in the user's
 * NEAR Intents virtual account and we restitute via support.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

const ONECLICK_BASE = "https://1click.chaindefuser.com";

// Whitelist of source assets. Add more by extending this map — no other
// code changes needed.
const SOURCE_ASSETS: Record<
  string,
  { assetId: string; symbol: string; chainName: string; decimals: number; minAmount: number }
> = {
  TRX_USDT: {
    assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
    symbol: "USDT",
    chainName: "Tron",
    decimals: 6,
    minAmount: 1,
  },
  BTC: {
    assetId: "nep141:btc.omft.near",
    symbol: "BTC",
    chainName: "Bitcoin",
    decimals: 8,
    minAmount: 0.00005,
  },
};

// USDCx on Movement — the only destination we currently settle to.
const DESTINATION_USDCX_MOVEMENT =
  "nep141:movement-6f9a70ef4605e7d9174f1abf8d8d3c15012f48f3.omft.near";

const quoteSchema = z.object({
  source: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
});

router.post(
  "/deposit/quote",
  requireAuth,
  requireActiveSession,
  validate(quoteSchema),
  async (req: Request, res: Response) => {
    try {
      if (!env.NEAR_INTENTS_JWT) {
        res.status(503).json({ error: "Cross-chain deposits aren't configured yet." });
        return;
      }

      const userId = req.user!.userId;
      const { source, amount } = req.body as { source: string; amount: string };

      const src = SOURCE_ASSETS[source];
      if (!src) {
        res.status(400).json({ error: "Unsupported source asset" });
        return;
      }

      const amountFloat = Number(amount);
      if (!Number.isFinite(amountFloat) || amountFloat < src.minAmount) {
        res.status(400).json({ error: `Minimum is ${src.minAmount} ${src.symbol}` });
        return;
      }

      // USDCx lands directly in the user's existing Movement wallet.
      const movementWallet = await prisma.wallet.findFirst({
        where: { userId, chain: "MOVE" },
        select: { address: true },
      });
      if (!movementWallet?.address) {
        res.status(400).json({ error: "Set up your Movement wallet first." });
        return;
      }

      const amountUnits = BigInt(Math.floor(amountFloat * 10 ** src.decimals)).toString();
      const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30-min window

      // refundType: INTENTS keeps any failed swap inside the NEAR Intents
      // virtual ledger, addressed by the user's NEAR implicit account (their
      // 64-byte hex Movement address, sans 0x prefix). We never have to ask
      // the user for a source-chain refund address.
      const refundTo = movementWallet.address.replace(/^0x/i, "");

      const resp = await fetch(`${ONECLICK_BASE}/v0/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.NEAR_INTENTS_JWT}`,
        },
        body: JSON.stringify({
          dry: false,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100, // 1%
          originAsset: src.assetId,
          depositType: "ORIGIN_CHAIN",
          destinationAsset: DESTINATION_USDCX_MOVEMENT,
          amount: amountUnits,
          recipient: movementWallet.address,
          recipientType: "DESTINATION_CHAIN",
          refundTo,
          refundType: "INTENTS",
          deadline,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        console.error(`[INTENTS] /quote failed ${resp.status}:`, errText.slice(0, 300));
        res.status(502).json({ error: "Quote failed. Please try again." });
        return;
      }

      const data: any = await resp.json();
      const quote = data.quote || data;

      res.json({
        depositAddress: quote.depositAddress,
        amountIn: amount,
        sourceSymbol: src.symbol,
        sourceChain: src.chainName,
        deadline,
        amountOutEstimate: quote.amountOut || null,
        timeEstimateSeconds: quote.timeEstimate || null,
      });
    } catch (err: any) {
      console.error("[INTENTS] /deposit/quote error:", err?.message || err);
      res.status(500).json({ error: "Could not start the deposit. Please try again." });
    }
  }
);

export default router;
