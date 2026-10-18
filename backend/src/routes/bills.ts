import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { pauseGuard } from "../lib/service-status";
import {
  activeBillsProvider,
  billsProviderOf,
  cablePackages,
  checkSmartcard,
  BILLS_LABELS,
  dataPlans,
  checkMeter,
  checkBettingAccount,
  supportsDisco,
  buyBill,
  findExistingBill,
} from "../lib/bills-provider";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { validate } from "../middleware/validate";
import { Asset, Chain } from "@prisma/client";
import crypto from "crypto";
import {
  prepareMovementWithdrawal,
  submitMovementWithdrawal,
  prepareSolanaWithdrawal,
  submitSolanaWithdrawal,
  prepareEvmWithdrawal,
  prepareTonWithdrawal,
  submitTonWithdrawal,
  submitEvmWithdrawal,
} from "../lib/gas-sponsor";
import { getOnChainBalance } from "../lib/balances";
import * as stellar from "../lib/stellar";
import { getLiveNgnRate } from "../lib/ngn-rate";
import { sendNotification } from "../lib/push";
import {
  purchaseAirtime,
  purchaseData,
  purchaseElectricity,
  verifyMeter,
  getDataVariations,
  generateRequestId,
  networkToServiceId,
  requeryOrder,
  BETTING_PROVIDERS,
} from "../lib/vtu";
import { sendBillSuccessEmail } from "../lib/email";

const router = Router();

// ─── Sell treasury lookup (same as transactions.ts) ─────────
/** Chains that share one key, so one address serves all of them. */
const EVM_CHAINS: Chain[] = ["BASE", "BEP20", "ARB", "ARC", "MONAD"];

function getSellTreasury(chain: string): string | null {
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
      return env.SELL_TON_ADDRESS || null;
    case "STELLAR":
      return stellar.sellAddress();
    default:
      return null;
  }
}

// ─── Valid asset-chain combos ───────────────────────────────
const VALID_ASSET_CHAINS: Record<string, string[]> = {
  USDC: ["MOVE", "BASE", "SOL", "BEP20", "ARC", "STELLAR", "MONAD"],
  USDCx: ["MOVE"],
  // TON carries USDT and nothing else: USDC is not issued there. On Stellar
  // and Monad "USDT" is USDT0.
  USDT: ["MOVE", "BASE", "SOL", "BEP20", "TON", "STELLAR", "MONAD"],
  MOVE: ["MOVE"],
  SOL: ["SOL"],
};

const NETWORKS = ["MTN", "Airtel", "Glo", "9Mobile"];
const DISCOS = ["IKEDC", "EKEDC", "KEDCO", "PHED", "JED", "IBEDC", "KAEDCO", "AEDC", "EEDC", "BEDC", "ABEDC", "YEDC"];
/**
 * What we add on top of a utility bill.
 *
 * Electricity and cable both cost us a flat fee at the provider and neither
 * pays a percentage worth counting, unlike airtime and data which carry a
 * 2.5-3% commission and no fee at all. So those two are charged for and the
 * other two are not.
 *
 * Named per service rather than shared, because they are the same number by
 * coincidence rather than by rule, and a single constant would make changing
 * one of them change both.
 */
const ELECTRICITY_FEE = 200;
const CABLE_PROVIDERS = ["DSTV", "GOtv", "StarTimes"];
const CABLE_FEE = 200;

/**
 * ₦0 for airtime, data and betting; they earn on commission instead.
 *
 * Betting is free for a second reason on top of the 0.2% vtu.ng returns: the
 * floor here is ₦100, and a ₦200 fee on a ₦100 top-up is not a fee, it is a
 * refusal written as arithmetic.
 */
function billFee(type: string): number {
  if (type === "electricity") return ELECTRICITY_FEE;
  if (type === "cable" || type === "tv") return CABLE_FEE;
  return 0;
}

/**
 * Which daily pool a bill spends from.
 *
 * Three pools, not a boolean. This was `isElectricity` compared against
 * itself, which worked while there were two kinds of bill and silently
 * merges the third into whichever side it is not - so betting would have
 * eaten the airtime allowance and airtime would have eaten betting's.
 *
 * Cable counts as airtime, which is where it already sat before this existed.
 */
type BillCategory = "airtime" | "electricity" | "betting";

function billCategory(type: string): BillCategory {
  if (type === "electricity") return "electricity";
  if (type === "betting") return "betting";
  return "airtime";
}

/**
 * The tier, per pool: [unverified, verified].
 *
 * Betting takes the same number for one transfer as for the day, because the
 * ceiling it was given is a daily one and inventing a smaller per-transfer
 * figure underneath it would refuse a single funding that the day plainly
 * allows.
 */
const BILL_LIMITS: Record<BillCategory, { perTx: [number, number]; daily: [number, number]; min: number }> = {
  airtime:     { perTx: [1_000, 5_000],  daily: [3_000, 10_000],  min: 50 },
  electricity: { perTx: [5_000, 10_000], daily: [5_000, 20_000],  min: 50 },
  /**
   * Betting is verified-only, so the unverified column is zero rather than a
   * tier.
   *
   * The refusal comes from an explicit KYC gate in /prepare, which says so in
   * words. These zeros are the backstop underneath it: if that gate were ever
   * moved or removed, the limit check still refuses rather than quietly
   * handing an unverified account the verified allowance.
   *
   * vtu.ng's own floor for every bookmaker is ₦100, so ours cannot be lower.
   */
  betting:     { perTx: [0, 10_000],     daily: [0, 10_000],      min: 100 },
};

// VTU.ng returns the electricity token under varying keys depending on disco
// (token, purchased_code, elec_token, meter_token, std_token). Walk both the
// top level and the nested data object to find it.
function extractElectricityToken(vtuResult: any): { token: string | null; units: string | null } {
  if (!vtuResult) return { token: null, units: null };
  const candidates = [vtuResult, vtuResult.data, vtuResult.data?.data].filter(Boolean);
  const tokenKeys = ["recharge_token", "token", "purchased_code", "elec_token", "meter_token", "std_token", "standard_token_value", "purchasedCode"];
  const unitsKeys = ["units", "unit", "kwh", "energy_value", "total_units"];
  let token: string | null = null;
  let units: string | null = null;
  for (const src of candidates) {
    if (!token) {
      for (const k of tokenKeys) {
        const v = src?.[k];
        if (v != null && String(v).trim() !== "") { token = String(v).trim(); break; }
      }
    }
    if (!units) {
      for (const k of unitsKeys) {
        const v = src?.[k];
        if (v != null && String(v).trim() !== "") { units = String(v).trim(); break; }
      }
    }
    if (token && units) break;
  }
  return { token, units };
}

// ═══════════════════════════════════════════════════════════
// GET /bills/data-plans?network=MTN
// Public data plan variations from VTU.ng (no auth needed)
// ═══════════════════════════════════════════════════════════
router.get("/data-plans", async (req: Request, res: Response) => {
  try {
    const network = req.query.network as string;
    if (!network || !NETWORKS.includes(network)) {
      res.status(400).json({ error: "Invalid network. Use: MTN, Airtel, Glo, 9Mobile" });
      return;
    }
    /**
     * From the provider that will be asked to fulfil it.
     *
     * The two sell different plans at different prices, and a plan is
     * identified by an id one of them minted - so serving Flutterwave's list
     * and buying on vtu.ng would spend money on nothing. The purchase stamps
     * the provider it was prepared under for the same reason.
     */
    const provider = await activeBillsProvider("data");
    res.json(await dataPlans(provider, network));
  } catch (err: any) {
    console.error("[BILLS] Data plans fetch error:", err.message);
    res.status(502).json({ error: "Unable to fetch data plans. Try again." });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /bills/cable-packages?provider=DSTV
//
// Real packages and real prices, from whichever provider is live. The screen
// used to carry a hardcoded list and a made-up exchange rate, which is fine
// until a price changes and somebody pays last quarter's.
// ═══════════════════════════════════════════════════════════
router.get("/cable-packages", async (req: Request, res: Response) => {
  try {
    const provider = String(req.query.provider || "");
    if (!CABLE_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Unknown provider. Use: DSTV, GOtv, StarTimes" });
      return;
    }

    const rail = await activeBillsProvider("cable");
    const packages = await cablePackages(rail, provider);
    res.json({ provider, packages });
  } catch (err: any) {
    console.error("[BILLS] Cable packages error:", err.message);
    res.status(502).json({ error: "Unable to load packages. Try again." });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /bills/verify-smartcard
// Whose decoder this is, before anybody pays for it.
// ═══════════════════════════════════════════════════════════
const verifySmartcardSchema = z.object({
  smartcard: z.string().min(5).max(20),
  provider: z.string().min(2),
  packageCode: z.string().min(2),
});

router.post(
  "/verify-smartcard",
  requireAuth,
  validate(verifySmartcardSchema),
  async (req: Request, res: Response) => {
    try {
      const { smartcard, provider, packageCode } = req.body;
      const rail = await activeBillsProvider("cable");

      const r = await checkSmartcard(rail, { provider, packageCode, smartcard });
      if (!r.ok || !r.name) {
        res.status(400).json({ error: r.error || "We could not find that smartcard number." });
        return;
      }

      res.json({ verified: true, customerName: r.name });
    } catch (err: any) {
      console.error("[BILLS] Smartcard verify error:", err.message);
      res.status(400).json({ error: "Unable to check that smartcard. Try again." });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /bills/verify-meter
// Verify electricity meter number via VTU.ng
// ═══════════════════════════════════════════════════════════
const verifyMeterSchema = z.object({
  customerId: z.string().min(5).max(20),
  disco: z.enum(["IKEDC", "EKEDC", "KEDCO", "PHED", "JED", "IBEDC", "KAEDCO", "AEDC", "EEDC", "BEDC", "ABEDC", "YEDC"]),
  type: z.enum(["prepaid", "postpaid"]),
});

router.post(
  "/verify-meter",
  requireAuth,
  validate(verifyMeterSchema),
  async (req: Request, res: Response) => {
    try {
      const { customerId, disco, type } = req.body;

      // Checked on the rail that will pay it: resolving against one provider
      // and paying through the other is how a valid meter gets refused.
      const provider = await activeBillsProvider("electricity");
      if (!supportsDisco(provider, disco)) {
        res.status(400).json({ error: `${disco} is not available right now.` });
        return;
      }

      // Retry up to 3 times for ECONNRESET
      let result: any;
      let lastErr: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await verifyMeter({ customerId, disco, type });
          break;
        } catch (e: any) {
          lastErr = e;
          const msg = e?.message || "";
          if (msg.includes("ECONNRESET") && attempt < 2) {
            console.warn(`[BILLS] Meter verify ECONNRESET, retrying (${attempt + 1}/3)...`);
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw e;
        }
      }

      if (result?.code === "success" && result?.data) {
        res.json({
          verified: true,
          customerName: result.data.customer_name || result.data.Customer_Name || "",
          customerAddress: result.data.customer_address || result.data.Address || "",
          meterNumber: result.data.meter_number || result.data.Meter_Number || customerId,
          minAmount: result.data.min_purchase_amount || 1000,
          maxAmount: result.data.max_purchase_amount || 100000,
        });
      } else {
        res.status(400).json({ error: "Meter verification failed. Check the meter number and try again." });
      }
    } catch (err: any) {
      const errData = err?.response?.data;
      const errMsg = errData?.message || err.message;
      console.error("[BILLS] Meter verify error:", errMsg);
      res.status(400).json({ error: errMsg || "Unable to verify meter. Check the number and try again." });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /bills/betting-providers
// The bookmakers we fund, for the picker.
// ═══════════════════════════════════════════════════════════
router.get("/betting-providers", requireAuth, async (_req: Request, res: Response) => {
  // Served rather than hardcoded in the app so adding a third bookmaker is a
  // backend deploy, not a store release.
  const paused = await pauseGuard("betting");
  res.json({ providers: BETTING_PROVIDERS, paused: !!paused, pausedReason: paused || null });
});

// ═══════════════════════════════════════════════════════════
// POST /bills/verify-betting
// Whose betting account this is, before anyone funds it.
// ═══════════════════════════════════════════════════════════
const verifyBettingSchema = z.object({
  // 5, not 3, to match the `phone` field the prepare schema shares between
  // meter numbers and account ids. A looser floor here would let an id
  // verify and then be refused at the step that spends, which is the worst
  // place to learn it. Every SportyBet (phone number) and Bet9ja (user id)
  // account clears this comfortably.
  // Bounded to 20 to match the `phone` field the prepare schema shares
  // between meter numbers and account ids. A wider ceiling here would let a
  // long id verify and then be refused at the step that spends.
  customerId: z.string().min(5).max(20),
  provider: z.string().min(1),
});

router.post(
  "/verify-betting",
  requireAuth,
  validate(verifyBettingSchema),
  async (req: Request, res: Response) => {
    try {
      const { customerId, provider: bettingProvider } = req.body;

      if (!BETTING_PROVIDERS.includes(bettingProvider)) {
        res.status(400).json({ error: "Invalid betting provider" });
        return;
      }

      /**
       * Gated here as well as at /prepare.
       *
       * Not belt and braces: this endpoint looks up a stranger's name from an
       * account id, so leaving it open to unverified accounts would make it a
       * free lookup service for anybody who can register an email. The screen
       * refuses first, but the screen is not the thing being protected.
       */
      const u = await prisma.user.findUnique({
        where: { id: req.user!.userId },
        select: { kycStatus: true },
      });
      if (u?.kycStatus !== "VERIFIED") {
        res.status(403).json({
          error: "Verify your ID to fund a betting account.",
          needsKyc: true,
        });
        return;
      }

      const provider = await activeBillsProvider("betting");
      const r = await checkBettingAccount(provider, { customerId, bettingProvider });

      if (!r.ok) {
        res.status(400).json({ error: r.error || "We could not find that account." });
        return;
      }

      res.json({
        verified: true,
        customerName: r.name || "",
        customerUsername: r.username || "",
        // Their floor and ceiling, which the screen shows alongside the tier's.
        // Defaulted to vtu.ng's documented bounds when a provider omits them.
        minAmount: r.min ?? 100,
        maxAmount: r.max ?? 100_000,
      });
    } catch (err: any) {
      const errMsg = err?.response?.data?.message || err.message;
      console.error("[BILLS] Betting verify error:", errMsg);
      res.status(400).json({ error: errMsg || "Unable to verify that account. Check the ID and try again." });
    }
  }
);

const BILL_NAMES: Record<string, string> = {
  airtime: "Airtime",
  data: "Data",
  electricity: "Electricity",
  cable: "TV subscription",
  betting: "Betting top-up",
};

/**
 * The push for a finished bill, in the words of what was bought.
 *
 * Anything that was not airtime or electricity used to fall through to
 * "Data", so funding SportyBet arrived as "Data Sent: ₦200 SportyBet betting
 * sent to 12345".
 */
function billNotice(
  meta: any,
  outcome: "delivered" | "failed",
  elecToken?: string | null,
): { title: string; body: string } {
  const naira = `₦${Number(meta.nairaAmount).toLocaleString()}`;
  const failed = outcome === "failed";
  const tail = " failed. Please contact support.";
  switch (meta.billType) {
    case "electricity": {
      const disco = meta.disco || meta.network;
      return {
        title: failed ? "Electricity Failed" : "Electricity Sent",
        body: failed
          ? `${naira} ${disco} electricity to meter ${meta.phone}${tail}`
          : elecToken
            ? `${naira} ${disco} token: ${elecToken}`
            : `${naira} ${disco} electricity token sent to meter ${meta.phone}`,
      };
    }
    case "cable": {
      const what = [meta.network, meta.planLabel].filter(Boolean).join(" ");
      return {
        title: failed ? "TV Subscription Failed" : "TV Subscription Paid",
        body: failed
          ? `${naira} ${what} for smartcard ${meta.phone}${tail}`
          : `${naira} ${what} paid for smartcard ${meta.phone}`,
      };
    }
    case "betting":
      return {
        title: failed ? "Betting Top-up Failed" : "Betting Wallet Funded",
        body: failed
          ? `${naira} to your ${meta.network} account ${meta.phone}${tail}`
          : `${naira} sent to your ${meta.network} account ${meta.phone}`,
      };
    default: {
      const label = meta.billType === "data" ? "Data" : "Airtime";
      const kind = meta.billType === "data" ? "data" : "airtime";
      return {
        title: `${label} ${failed ? "Failed" : "Sent"}`,
        body: failed
          ? `${naira} ${meta.network} ${kind} to ${meta.phone}${tail}`
          : `${naira} ${meta.network} ${kind} sent to ${meta.phone}`,
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════
// POST /bills/prepare
// Validates, converts NGN amount to crypto, prepares on-chain tx
// ═══════════════════════════════════════════════════════════
const billsPrepareSchema = z.object({
  type: z.enum(["airtime", "data", "electricity", "cable", "betting"]),
  phone: z.string().min(5).max(20), // phone for airtime/data, meter for electricity, account id for betting
  network: z.string().min(1), // network for airtime/data, disco for electricity, bookmaker for betting
  amount: z.number().positive(), // Naira amount
  variationId: z.string().optional(), // required for data
  planLabel: z.string().optional(), // for display
  asset: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL"]),
  chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC", "TON", "STELLAR", "MONAD"]),
  senderAddress: z.string().optional(),
  // Electricity-specific
  meterType: z.enum(["prepaid", "postpaid"]).optional(),
  customerName: z.string().optional(),
  disco: z.string().optional(),
  // Cable-specific. The item code IS the package; `amount` must match what the
  // provider lists for it, so the client sends back what we gave it.
  packageCode: z.string().optional(),
  packageName: z.string().optional(),
});

router.post(
  "/prepare",
  requireAuth,
  requireActiveSession,
  requireDynamicWallet,
  validate(billsPrepareSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { type, phone, network, amount, planLabel, asset, chain, senderAddress, meterType, customerName, disco, packageCode, packageName } = req.body;
      // A cable package identifies its item the same way a data plan does, so it
      // travels in the same field rather than inventing a second one the
      // purchase would also have to know about.
      const variationId = req.body.variationId || packageCode || undefined;

      // ── Maintenance gates ────────────────────────────────
      if (type === "airtime" || type === "data") {
        // Asked of the one that matches, not of a shared key: a paused data
        // service must not stop airtime, and the sheet the app raises names
        // the service it was refused for.
        const key = type === "airtime" ? "airtime" : "data";
        const billPaused = await pauseGuard(key);
        if (billPaused) {
          res.status(503).json({ error: billPaused, paused: true, service: key });
          return;
        }
      }
      if (type === "electricity") {
        const powerPaused = await pauseGuard("electricity");
        if (powerPaused) {
          res.status(503).json({ error: powerPaused, paused: true, service: "electricity" });
          return;
        }
      }
      if (type === "cable" || type === "tv") {
        const cablePaused = await pauseGuard("cable");
        if (cablePaused) {
          res.status(503).json({ error: cablePaused, paused: true, service: "cable" });
          return;
        }
      }
      if (type === "betting") {
        const bettingPaused = await pauseGuard("betting");
        if (bettingPaused) {
          res.status(503).json({ error: bettingPaused, paused: true, service: "betting" });
          return;
        }
      }

      // Validate data purchase has variationId
      if (type === "data" && !variationId) {
        res.status(400).json({ error: "variationId is required for data purchases" });
        return;
      }

      // Validate electricity purchase
      if (type === "electricity") {
        if (!meterType) { res.status(400).json({ error: "meterType is required for electricity" }); return; }
        if (!disco || !DISCOS.includes(disco)) { res.status(400).json({ error: "Invalid disco provider" }); return; }
      }

      // Validate airtime/data network
      if ((type === "airtime" || type === "data") && !NETWORKS.includes(network)) {
        res.status(400).json({ error: "Invalid network" }); return;
      }

      /**
       * Validate the bookmaker against our own list, not vtu.ng's.
       *
       * They carry fourteen and we offer two, so an unchecked `network` here
       * would let a client fund a bookmaker we never listed - which works,
       * and is exactly the sort of thing that is discovered months later in
       * a reconciliation nobody can explain.
       */
      if (type === "betting" && !BETTING_PROVIDERS.includes(network)) {
        res.status(400).json({ error: "Invalid betting provider" }); return;
      }

      // Valid asset-chain combo
      if (!VALID_ASSET_CHAINS[asset]?.includes(chain)) {
        res.status(400).json({ error: `${asset} is not supported on ${chain}` });
        return;
      }

      // ── KYC & limits ────────────────────────────────────
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      const verified = user.kycStatus === "VERIFIED";

      /**
       * Betting needs a verified identity, unlike every other bill.
       *
       * Money leaving into a gambling account is the one thing here that
       * cannot be clawed back or resent, so the account behind it has to be
       * one we can name. Refused before the limit check so the reason given
       * is "verify your ID" rather than a ₦0 ceiling nobody can interpret.
       */
      if (type === "betting" && !verified) {
        res.status(403).json({
          error: "Verify your ID to fund a betting account.",
          needsKyc: true,
        });
        return;
      }

      // Type-specific limits
      const category = billCategory(type);
      const tier = BILL_LIMITS[category];
      const perTxLimit = tier.perTx[verified ? 1 : 0];
      const dailyLimit = tier.daily[verified ? 1 : 0];

      if (amount < tier.min) { res.status(400).json({ error: `Minimum amount is ₦${tier.min.toLocaleString()}` }); return; }
      if (amount > perTxLimit) {
        res.status(400).json({ error: `Maximum ₦${perTxLimit.toLocaleString()} per transaction${verified ? "" : " (verify KYC to increase)"}` });
        return;
      }

      // Daily limit check — one pool per category, so spending on airtime
      // never eats the electricity or betting allowance, or the reverse.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const todayBills = await prisma.transaction.findMany({
        // PENDING is a purchase that was prepared and never signed - submit is
        // what moves it to PROCESSING - so it has not spent anything.
        where: { userId, type: "AIRTIME", status: { in: ["COMPLETED", "PROCESSING"] }, createdAt: { gte: startOfDay } },
        select: { metadata: true },
      });
      const spentToday = todayBills.reduce((sum, t) => {
        const m = t.metadata as any;
        // Rows written before billType existed are airtime, which is what the
        // default here makes them.
        if (billCategory(m?.billType || "airtime") !== category) return sum;
        return sum + (m?.nairaAmount ? Number(m.nairaAmount) : 0);
      }, 0);
      if (spentToday + amount > dailyLimit) {
        const remaining = Math.max(dailyLimit - spentToday, 0);
        res.status(400).json({
          error: remaining <= 0
            ? `Daily bills limit of ₦${dailyLimit.toLocaleString()} reached.`
            : `Exceeds daily limit. ₦${remaining.toLocaleString()} remaining today.`,
        });
        return;
      }

      /**
       * For betting, prove the account exists before taking any money.
       *
       * This is the only bill whose destination is a free-text id somebody
       * typed, and a failed vend does not give their crypto back: the chain
       * leg has already settled by the time the provider refuses, the
       * transaction is marked FAILED, and making the person whole is a manual
       * job. A mistyped account id is far and away the likeliest cause, so it
       * is worth one extra call to catch it while refusing still costs
       * nothing.
       *
       * The app checks too. The app is not what is being protected - this
       * endpoint is reachable without it.
       */
      if (type === "betting") {
        const bettingRail = await activeBillsProvider("betting");
        const check = await checkBettingAccount(bettingRail, {
          customerId: phone,
          bettingProvider: network,
        });
        if (!check.ok) {
          res.status(400).json({ error: check.error || "We could not find that betting account." });
          return;
        }
        /**
         * And their bounds, not just ours.
         *
         * The bookmaker's floor and ceiling are theirs to change without
         * telling us, and a top-up outside them fails at the vend - which is
         * the expensive place to find out.
         */
        if (check.min != null && amount < check.min) {
          res.status(400).json({ error: `${network} takes a minimum of ₦${check.min.toLocaleString()}.` });
          return;
        }
        if (check.max != null && amount > check.max) {
          res.status(400).json({ error: `${network} takes a maximum of ₦${check.max.toLocaleString()}.` });
          return;
        }
      }

      // ── Live rate ───────────────────────────────────────
      const ngnRate = await getLiveNgnRate(asset);
      if (!ngnRate || ngnRate <= 0) {
        res.status(503).json({ error: "Exchange rate unavailable. Please try again." });
        return;
      }
      /**
       * The rail, decided once and written down.
       *
       * Every later step - the purchase, the retry, the requery - reads the
       * stamp rather than asking the switch again, so flipping the switch only
       * affects bills that have not started. It matters more here than for
       * payouts: a data plan is an id minted by one provider, and handing it
       * to the other buys nothing at best.
       */
      const billsProvider = await activeBillsProvider(type);

      const fee = billFee(type);
      const totalNaira = amount + fee;
      const cryptoAmount = totalNaira / ngnRate; // How much crypto for this Naira amount

      // ── Wallet lookup ───────────────────────────────────
      let wallet = await prisma.wallet.findUnique({
        where: { userId_asset_chain: { userId, asset: asset as Asset, chain: chain as Chain } },
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
      if (senderAddress && senderAddress.toLowerCase() !== wallet.address.toLowerCase()) {
        res.status(409).json({ error: "Wallet address mismatch. Blocked for security." });
        return;
      }

      // On-chain balance check
      let onChainBalance: number;
      try { onChainBalance = await getOnChainBalance(asset, chain, wallet.address); }
      catch (err: any) {
        console.error(`[BILLS] on-chain balance check failed: ${err?.message}`);
        res.status(503).json({ error: "Unable to verify on-chain balance. Try again." });
        return;
      }
      if (onChainBalance < cryptoAmount) {
        res.status(400).json({ error: "Insufficient balance" });
        return;
      }

      // ── Sell treasury ───────────────────────────────────
      const treasury = getSellTreasury(chain);
      if (!treasury) {
        res.status(500).json({ error: "Treasury not configured for this chain" });
        return;
      }

      // ── Cancel any existing PENDING bills tx ────────────
      await prisma.transaction.updateMany({
        where: { userId, type: "AIRTIME", status: "PENDING" },
        data: { status: "FAILED" },
      });

      // ── Create PENDING tx ──────────────────────────────
      const reference = `BILL-${Date.now().toString(36).slice(-8)}-${crypto.randomBytes(3).toString("hex")}`;
      const vtuRequestId = generateRequestId();

      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: "AIRTIME",
          asset: asset as Asset,
          chain: chain as Chain,
          amount: cryptoAmount,
          fee: 0,
          status: "PENDING",
          reference,
          metadata: {
            billType: type, // "airtime", "data", or "electricity"
            phone, // phone for airtime/data, meter number for electricity
            network, // network for airtime/data, disco for electricity
            nairaAmount: amount,
            fee,
            totalNaira: totalNaira,
            variationId: variationId || null,
            planLabel: planLabel || packageName || null,
            ngnRate,
            cryptoAmount,
            treasury,
            senderAddress: wallet.address,
            vtuRequestId,
            // Which rail this bill was prepared on. Read by the purchase, the
            // retry and the requery, so none of them can drift onto the other.
            billsProvider,
            // Electricity-specific
            ...(type === "electricity" ? {
              disco,
              meterType,
              customerName: customerName || null,
            } : {}),
          },
        },
      });

      // ── Prepare on-chain tx (user → treasury) ──────────
      let signingMessage: string;
      let txRequest: Record<string, string | number> | undefined;
      if (chain === "MOVE") {
        ({ signingMessage } = await prepareMovementWithdrawal(
          transaction.id, wallet.address, treasury, cryptoAmount, asset as "MOVE" | "USDC" | "USDT" | "USDCx"
        ));
      } else if (chain === "SOL") {
        ({ signingMessage } = await prepareSolanaWithdrawal(
          transaction.id, wallet.address, treasury, cryptoAmount, asset as "USDC" | "USDT" | "SOL"
        ));
      } else if (chain === "TON") {
        // The Solana address, because that is where the signing key lives: a
        // TON address is a hash of the wallet code and the public key, so it
        // cannot be turned back into the key that has to sign.
        const solWallet = await prisma.wallet.findFirst({
          where: { userId, chain: "SOL", address: { not: null } },
          select: { address: true },
        });
        if (!solWallet?.address) {
          res.status(400).json({ error: "No Solana key found to derive the TON wallet from" });
          return;
        }
        ({ signingMessage } = await prepareTonWithdrawal(
          transaction.id, solWallet.address, treasury, cryptoAmount, asset as "USDT"
        ));
      } else if (chain === "STELLAR") {
        // User → treasury, fee-bumped by the treasury at submit.
        ({ signingMessage } = await stellar.preparePayment(transaction.id, {
          from: wallet.address,
          to: treasury,
          coin: asset as stellar.StellarCoin,
          amount: cryptoAmount,
        }));
      } else {
        ({ signingMessage, txRequest } = await prepareEvmWithdrawal(
          transaction.id, wallet.address, treasury, cryptoAmount,
          asset as "USDC" | "USDT", chain as "BASE" | "BEP20"
        ));
      }

      res.json({
        billId: transaction.id,
        signingMessage,
        txRequest,
        chain,
        ngnRate,
        nairaAmount: amount,
        cryptoAmount,
        treasury,
      });
    } catch (err: any) {
      console.error("[BILLS] Prepare error:", err);
      const msg = err?.message || "";
      if (msg.includes("Insufficient")) {
        res.status(400).json({ error: "Insufficient balance to complete this payment" });
      } else if (msg.includes("Unsupported asset") || err?.name === "StellarError") {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: "Failed to prepare bill payment" });
      }
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /bills/submit
// Receive signature, submit on-chain, then call VTU.ng
// ═══════════════════════════════════════════════════════════
const billsSubmitSchema = z.object({
  billId: z.string().min(1),
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
  "/submit",
  requireAuth,
  requireActiveSession,
  validate(billsSubmitSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { billId, signature, publicKey, signedRaw } = req.body;

      // Atomically claim PENDING → PROCESSING
      const claimResult = await prisma.transaction.updateMany({
        where: { id: billId, userId, status: "PENDING", type: "AIRTIME" },
        data: { status: "PROCESSING" },
      });
      if (claimResult.count === 0) {
        const existing = await prisma.transaction.findUnique({ where: { id: billId } });
        if (!existing || existing.userId !== userId) {
          res.status(404).json({ error: "Transaction not found" });
        } else {
          res.status(400).json({ error: "Transaction already processed" });
        }
        return;
      }

      const tx = await prisma.transaction.findUnique({ where: { id: billId } });
      if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
      const meta = tx.metadata as any;

      // ── Submit on-chain ─────────────────────────────────
      let txHash: string;
      try {
        if (tx.chain === "MOVE") {
          txHash = await submitMovementWithdrawal(billId, signature, publicKey);
        } else if (tx.chain === "SOL") {
          txHash = await submitSolanaWithdrawal(billId, signature, publicKey);
        } else if (tx.chain === "TON") {
          txHash = await submitTonWithdrawal(billId, signature);
        } else if (tx.chain === "STELLAR") {
          txHash = await stellar.submitPayment(billId, signature);
        } else if (EVM_CHAINS.includes(tx.chain as Chain)) {
          txHash = await submitEvmWithdrawal(billId, signature, publicKey, signedRaw);
        } else {
          res.status(400).json({ error: `Unsupported chain: ${tx.chain}` });
          return;
        }
      } catch (chainErr: any) {
        console.error("[BILLS] On-chain submit failed:", chainErr);
        const failedHash = chainErr?.txHash;
        await prisma.transaction.update({
          where: { id: billId },
          data: {
            status: "FAILED",
            metadata: {
              ...meta,
              ...(failedHash ? { txHash: failedHash } : {}),
              chainError: chainErr?.message || "On-chain submit failed",
            },
          },
        }).catch(() => {});
        res.status(500).json({ error: "On-chain transfer failed. No airtime was purchased." });
        return;
      }

      // ── Buy it, on the rail this bill was prepared on ────
      const provider = billsProviderOf(meta);

      let vtuResult: any;
      let vtuStatus = "pending";
      let vtuError = "";
      let directToken: string | null = null;
      let directUnits: string | null = null;

      /**
       * Ask before sending. Always, not only after a failure.
       *
       * The crypto leg has already settled by the time we are here, so the
       * only two outcomes that matter are "bought once" and "bought twice" -
       * and a submit can be replayed by a retried request, a double tap, or a
       * client that timed out and came back. Our request id is stable across
       * all of them, so the first thing we do is ask the provider whether it
       * has already seen it.
       *
       * vtu.ng answers by requery on the request id. Flutterwave answers by
       * finding our reference in its bill history - and there it is not
       * optional politeness: we have NOT established that Flutterwave enforces
       * `customer_reference` as an idempotency key, so a second POST may well
       * be a second charge. Asking first is what makes that unknown safe.
       */
      const already = await findExistingBill(provider, meta.vtuRequestId).catch(() => null);

      if (already?.found) {
        vtuResult = already.raw;
        vtuStatus =
          already.status === "delivered"
            ? "delivered"
            : already.status === "failed"
            ? "vtu_failed"
            : "pending";
        console.log(
          `[BILLS] ${BILLS_LABELS[provider]} already had ${meta.vtuRequestId} (${already.status}) — not sending again`,
        );
      } else {
        const bought = await buyBill(provider, {
          type: meta.billType,
          customer: meta.phone,
          network: meta.network,
          disco: meta.disco,
          meterType: meta.meterType,
          amount: meta.nairaAmount,
          variationId: meta.variationId,
          reference: meta.vtuRequestId,
        });

        vtuResult = bought.raw;
        directToken = bought.token;
        directUnits = bought.units;

        if (bought.ok) {
          vtuStatus = bought.status === "delivered" ? "delivered" : "pending";
          console.log(
            `[BILLS] ✅ ${BILLS_LABELS[provider]} ${meta.billType}: ${meta.vtuRequestId} — ₦${meta.nairaAmount} to ${meta.phone}`,
          );
        } else {
          /**
           * A failure is not proof that nothing happened.
           *
           * A timeout, a reset connection or a malformed reply can all arrive
           * after the purchase landed. So the provider is asked once more
           * before this is called a failure - and it is asked rather than
           * retried, because retrying is the thing that charges twice.
           */
          await new Promise((r) => setTimeout(r, 6000));
          const after = await findExistingBill(provider, meta.vtuRequestId).catch(() => null);

          if (after?.found && after.status !== "failed") {
            vtuResult = after.raw;
            vtuStatus = after.status === "delivered" ? "delivered" : "pending";
            console.log(
              `[BILLS] ${BILLS_LABELS[provider]} reported an error but ${meta.vtuRequestId} did land (${after.status})`,
            );
          } else {
            vtuStatus = "vtu_failed";
            vtuError = bought.error || "Purchase failed";
            console.error(
              `[BILLS] ❌ ${BILLS_LABELS[provider]} ${meta.vtuRequestId} failed: ${vtuError}`,
            );
          }
        }
      }

      const finalStatus = vtuStatus === "delivered" ? "COMPLETED"
        : (vtuStatus === "vtu_failed" || vtuStatus === "refunded") ? "FAILED"
        : "PROCESSING";

      // Extract electricity token/units so the frontend doesn't have to
      // know VTU.ng's per-disco field naming quirks.
      const dug = meta.billType === "electricity"
        ? extractElectricityToken(vtuResult)
        : { token: null, units: null };
      // Flutterwave returns it on the purchase itself; vtu.ng buries it under
      // a different key per disco, which is what extractElectricityToken is for.
      const elecToken = directToken || dug.token;
      const elecUnits = directUnits || dug.units;

      await prisma.transaction.update({
        where: { id: billId },
        data: {
          status: finalStatus,
          metadata: {
            ...meta,
            txHash,
            vtuStatus,
            vtuError: vtuError || undefined,
            vtuResult: vtuResult || undefined,
            ...(elecToken ? { electricityToken: elecToken } : {}),
            ...(elecUnits ? { electricityUnits: elecUnits } : {}),
            completedAt: vtuStatus === "delivered" ? new Date().toISOString() : undefined,
          },
        },
      });

      // ── Notify user ─────────────────────────────────────
      if (vtuStatus === "delivered") {
        sendNotification({
          userId,
          type: "transaction",
          ...billNotice(meta, "delivered", elecToken),
        }).catch(() => {});

        // Send confirmation email
        prisma.user.findUnique({ where: { id: userId }, select: { email: true } }).then((u) => {
          if (u?.email) {
            sendBillSuccessEmail(u.email, {
              billType: meta.billType,
              amountNaira: meta.nairaAmount,
              cryptoAmount: parseFloat(meta.cryptoAmount?.toString() || tx.amount?.toString() || "0").toFixed(6),
              asset: tx.asset,
              chain: tx.chain || meta.chain || "MOVE",
              phone: meta.phone,
              network: meta.network,
              planLabel: meta.planLabel,
              disco: meta.disco,
              meterType: meta.meterType,
              customerName: meta.customerName,
              electricityToken: elecToken || undefined,
              electricityUnits: elecUnits || undefined,
              reference: meta.vtuRequestId,
              date: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
            }).catch((e) => console.error("[BILLS] Email send failed:", e.message));
          }
        }).catch(() => {});
      } else if (finalStatus === "FAILED") {
        sendNotification({
          userId,
          type: "transaction",
          ...billNotice(meta, "failed"),
        }).catch(() => {});
      }

      res.json({
        status: finalStatus,
        txHash,
        vtuStatus,
        billId,
        vtuResult: vtuResult || undefined,
        electricityToken: elecToken || undefined,
        electricityUnits: elecUnits || undefined,
        message: vtuStatus === "delivered"
          ? `${BILL_NAMES[meta.billType] ?? "Airtime"} delivered successfully!`
          : finalStatus === "FAILED"
          ? `Purchase failed: ${vtuError}. Please contact support.`
          : "Payment received. Delivery is being processed.",
      });

    } catch (err: any) {
      console.error("[BILLS] Submit error:", err);
      res.status(500).json({ error: "Failed to process bill payment" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /bills/requery
// Check the status of a VTU order
// ═══════════════════════════════════════════════════════════
router.post(
  "/requery",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { billId } = req.body;
      if (!billId) { res.status(400).json({ error: "billId is required" }); return; }

      const tx = await prisma.transaction.findUnique({ where: { id: billId } });
      if (!tx || tx.userId !== req.user!.userId) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }

      const meta = tx.metadata as any;
      if (!meta?.vtuRequestId) {
        res.status(400).json({ error: "No VTU request ID found" });
        return;
      }

      // Asked of the rail this bill was actually bought on. Asking the other
      // one returns "not found", which reads exactly like a failed purchase
      // and is not one.
      const provider = billsProviderOf(meta);
      const found = await findExistingBill(provider, meta.vtuRequestId);
      const result = found.raw;

      if (found.found && found.status === "delivered" && tx.status !== "COMPLETED") {
        const { token: elecToken, units: elecUnits } = meta.billType === "electricity"
          ? extractElectricityToken(result)
          : { token: null, units: null };
        await prisma.transaction.update({
          where: { id: billId },
          data: {
            status: "COMPLETED",
            metadata: {
              ...meta,
              vtuStatus: "delivered",
              vtuResult: result,
              ...(elecToken ? { electricityToken: elecToken } : {}),
              ...(elecUnits ? { electricityUnits: elecUnits } : {}),
              completedAt: new Date().toISOString(),
            },
          },
        });
      }

      res.json({ status: found.status || "pending", details: result });
    } catch (err: any) {
      console.error("[BILLS] Requery error:", err.message);
      res.status(502).json({ error: "Unable to check status. Try again." });
    }
  }
);

export default router;
