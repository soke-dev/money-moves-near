import { Router, Request, Response } from "express";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { isStableyardConfigured } from "../lib/stableyard";
import { offeredRoutedAssetStates } from "../lib/stableyard-visibility";
import { ensureRoutedAddresses } from "../lib/stableyard-account";
import { syncRoutedLedger } from "../lib/stableyard-ledger";
import { isAuroraConfigured } from "../lib/aurora";
import { AURORA_CHAIN_IDS, auroraRoutedAssets, syncAuroraLedger } from "../lib/aurora-deposits";

const router = Router();

/**
 * Deposits that arrive as something else.
 *
 * BTC, Tron USDT, and assets on chains we do not hold, all converted on the
 * way in and landing as USDCx in the person's existing Movement wallet. The
 * tokens we take natively never come through here - those have their own
 * screens and the user's own address.
 */

/**
 * ─── GET /routed-deposits — what this person can be sent, and where ──
 *
 * The addresses are made on first ask rather than at signup. Most people will
 * never use this, and issuing eight addresses each for an account that never
 * touches them is a lot of provider registrations for nothing.
 *
 * Returned per asset rather than per chain, because that is the choice being
 * made: somebody is deciding to send Bitcoin, not deciding to use chain 10001.
 * Several assets can share one address and that is fine - every EVM chain here
 * does, and since all of them are enabled, arriving on the wrong one still
 * lands.
 */
router.get(
  "/",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      /**
       * BTC and Tron USDT come from Aurora whenever it is configured, landing
       * as USDC on Solana; Stableyard keeps everything else, landing as USDCx
       * on Movement. Each asset says where it lands, because the list now
       * holds both.
       *
       * The rails are resolved separately, so one provider being down turns
       * its own rows off rather than taking the whole list with it.
       */
      const auroraOn = isAuroraConfigured();
      const auroraAssets = auroraOn ? await auroraRoutedAssets(userId).catch(() => []) : [];

      /**
       * The unavailable ones come too.
       *
       * They are drawn in the app, named and untappable, so somebody who used
       * one last week can see it is off rather than assume they imagined it.
       * Only `hidden` is absent from this list.
       */
      const offered = isStableyardConfigured()
        ? (await offeredRoutedAssetStates()).filter((a) => !auroraOn || !AURORA_CHAIN_IDS.includes(a.chainId))
        : [];

      let stableyardAssets: any[] = [];
      if (offered.length) {
        const chainIds = [...new Set(offered.map((a) => a.chainId))];
        const result = await ensureRoutedAddresses(userId, chainIds);
        if (!result.ok) {
          // Only fatal when it was the whole list. With Aurora's rows to show,
          // the Stableyard ones are simply missing until it recovers.
          if (!auroraAssets.length) {
            res.status(503).json({ error: result.error || "Deposits are unavailable right now." });
            return;
          }
          console.warn(`[ROUTED] Stableyard addresses unavailable for ${userId}: ${result.error}`);
        } else {
          const byChain = new Map(result.addresses.map((a) => [a.chainId, a]));

          /**
           * The minimum comes from the address we were just handed, never from a
           * table here. Theirs has contradicted their own documentation twice, and
           * a floor shown too low is somebody sending money that is ignored rather
           * than credited.
           */
          stableyardAssets = offered
            .map((a) => {
              const addr = byChain.get(a.chainId);
              if (!addr) return null;
              const asset = addr.assets.find((x) => x.symbol === a.symbol);
              return {
                chainId: a.chainId,
                symbol: a.symbol,
                state: a.state,
                address: addr.address,
                minimum: asset?.minimum ?? null,
                decimals: asset?.decimals ?? null,
                settlesAs: "USDC",
                settlesOn: "MOVE",
              };
            })
            .filter(Boolean);
        }
      }

      // Bitcoin and Tron lead, as they always have.
      res.json({ assets: [...auroraAssets, ...stableyardAssets], settlesAs: "USDC", settlesOn: "MOVE" });
    } catch (err: any) {
      console.error("[ROUTED] list error:", err?.message);
      res.status(500).json({ error: "Could not load deposit addresses." });
    }
  }
);

/**
 * ─── GET /routed-deposits/activity — what is on its way ──
 *
 * Read live from the provider. They own the state machine, and this screen
 * shows exactly what they say rather than a copy of it that could be stale -
 * on a screen whose entire purpose is telling somebody the truth about money
 * that has left their wallet.
 *
 * The same read also writes each deposit into our transaction history, so a
 * conversion in progress shows up in the list with everything else and turns
 * into a completed deposit when it lands. That mirror is downstream of this
 * call and never contradicts it: it is rewritten from their answer every time.
 */
router.get(
  "/activity",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      // Aurora's deposits are written into history the same way; the app only
      // reads the list for Stableyard's, and everything lands in transactions.
      if (isAuroraConfigured()) await syncAuroraLedger(userId).catch(() => {});
      if (!isStableyardConfigured()) {
        res.json({ deposits: [] });
        return;
      }
      res.json({ deposits: await syncRoutedLedger(userId) });
    } catch (err: any) {
      console.error("[ROUTED] activity error:", err?.message);
      res.status(500).json({ error: "Could not load your deposits." });
    }
  }
);

export default router;
