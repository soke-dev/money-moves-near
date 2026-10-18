/**
 * What the dashboard and the checkout show as on or off: ways to pay,
 * checkouts, settlement places and chains, coins and networks, the default
 * fees and limits. The API enforces all of it either way; this is so the
 * screens can say so before anyone tries. The payout switch and the review
 * limits are ours alone - a business is never told a payout is being checked.
 */
import { Router } from "express";
import { platform } from "../lib/platform";
import { appPayReady } from "../lib/app-pay";
import { offeredAccept } from "../lib/accept";

const router = Router();

router.get("/", async (_req, res) => {
  const p = await platform();
  const { payouts: _switch, review: _review, ...shown } = p;
  // What a live checkout can take today - the same rules the checkout itself applies.
  const crypto = offeredAccept(null, p, "LIVE");
  const cryptoNetworks = [...new Set(Object.values(crypto).flat())];
  res.json({
    platform: shown,
    live: { naira: p.methods.naira, app: p.methods.app && appPayReady(), crypto: p.methods.crypto && cryptoNetworks.length > 0, cryptoNetworks },
  });
});

export default router;
