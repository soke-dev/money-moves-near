/**
 * Funding (on-ramp) routes — Flutterwave virtual accounts.
 *
 * POST /funding/initialize  — issue a one-shot NGN account to transfer into
 * GET  /funding/verify/:ref — check whether that transfer has landed
 * POST /funding/webhook     — Flutterwave charge.completed (signature-verified)
 *
 * The user no longer leaves the app to pay. We hand them a Nigerian account
 * number, they transfer to it from their own bank, and Flutterwave tells us it
 * arrived. That also means the credit path is a webhook we cannot attribute to
 * a user on its own - FundingIntent, written before the account number is ever
 * shown, is what makes it actionable.
 *
 * Paystack is retired. processFunding() below is provider-agnostic (it is the
 * crypto-delivery half) and is reused unchanged; only the collection step and
 * the webhook differ.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import Decimal from "decimal.js";
import { prisma } from "../lib/prisma";
import { settlePayoutWebhook, sessionIdFrom } from "../lib/payout";
import { verifyPaystackSignature, mapPaystackTransferStatus } from "../lib/paystack";
import { env } from "../config/env";
import { pauseGuard } from "../lib/service-status";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { sendTokensToUser } from "../lib/treasury";
import { sendFundingSuccessEmail } from "../lib/email";
import { sendNotification } from "../lib/push";
import { assetLabel } from "../lib/asset";
import { getLiveNgnRate, getLiveFundRate } from "../lib/ngn-rate";
import { payoutNotice } from "../lib/payout-notice";
import {
  isFlutterwaveConfigured,
  flwGetOrCreateCustomer,
  flwCreateVirtualAccount,
  flwGetCharge,
  flwFindChargeByReference,
  flwExtractSender,
  verifyFlutterwaveSignature,
  mapTransferStatus,
  type FlwSender,
} from "../lib/flutterwave";
import { checkSenderName, holdsOn, type NameCheck } from "../lib/name-match";

const router = Router();

// Fee percentage (1% = 0.01). Fee stays in Paystack balance.
const FEE_PERCENT = 1;
const FEE_RATE = FEE_PERCENT / 100;

// ─── Funding limits (verified users only) ───────────────────
const FUNDING_PER_TX = 20_000;   // ₦20,000 max per transaction
const FUNDING_DAILY  = 200_000;  // ₦200,000 max per day

/**
 * Naira put toward funding today, for the daily cap.
 *
 * Counts delivered purchases and payment accounts that are still open. An
 * intent is a virtual account issued for one exact amount, and no transaction
 * row exists until the transfer lands - so counting transactions alone let
 * someone open ten accounts inside a minute, each of them seeing a day's spend
 * of zero, and then pay all ten. Open intents count from the moment they are
 * issued and drop back out when they expire unpaid.
 */
async function fundingSpentToday(userId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const now = new Date();

  const [txs, openIntents] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        type: "BUY",
        status: { in: ["COMPLETED", "PENDING", "PROCESSING"] },
        createdAt: { gte: startOfDay },
      },
      select: { metadata: true },
    }),
    // PENDING only: a PAID intent has already become one of the transactions
    // above, and counting both would charge the same naira twice.
    prisma.fundingIntent.findMany({
      where: {
        userId,
        status: "PENDING",
        createdAt: { gte: startOfDay },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { amountNaira: true },
    }),
  ]);

  const delivered = txs.reduce((sum, t) => {
    const m = t.metadata as any;
    return sum + (m?.amountNaira ? Number(m.amountNaira) : 0);
  }, 0);
  const held = openIntents.reduce((sum, i) => sum + Number(i.amountNaira), 0);

  return delivered + held;
}

// ─── Schemas ────────────────────────────────────────────────
const initSchema = z.object({
  amountNaira: z.number().positive().max(FUNDING_PER_TX),
  email: z.string().email().optional(),
  metadata: z.object({
    token: z.enum(["USDC", "USDT", "USDCx", "MOVE", "SOL"]),
    chain: z.enum(["MOVE", "BASE", "SOL", "BEP20", "ARC"]),
    walletAddress: z.string().min(10).max(100),
    convertedAmount: z.number().positive(),
  }),
});

// ═══════════════════════════════════════════════════════════
// Shared funding delivery — called by BOTH the client verify
// endpoint and the Paystack webhook. Either path may win; the
// unique `reference` on Transaction is the single source of
// truth for idempotency, so crypto is delivered exactly once.
//
// Flow:
//   1. Claim the reference by INSERTing the tx row FIRST (status
//      PROCESSING). If the row already exists (or a concurrent
//      caller wins the insert → P2002), we DON'T send — return
//      the existing record. This is what prevents double-sends.
//   2. Only the caller that won the insert sends on-chain.
//   3. On success, flip the row to COMPLETED + credit balance.
//   4. On send failure / ambiguity, leave it PROCESSING (money is
//      recorded, never a blind or wrong send) for manual retry.
//
// `psTx` is Paystack's verified transaction object. The caller is
// responsible for authenticating it (verify endpoint via the
// Paystack verify API; webhook via HMAC signature).
// ═══════════════════════════════════════════════════════════
export type FundingResult =
  | { kind: "delivered"; transaction: any; alreadyProcessed: boolean }
  | { kind: "blocked"; reason: string };

/**
 * Exported so the admin console can release a held deposit through exactly the
 * same path a webhook takes. Delivering held money by any other route would
 * mean a second implementation of idempotency, caps and the treasury send, on
 * the one code path where being wrong twice costs real coin.
 */
export async function processFunding(psTx: any): Promise<FundingResult> {
  const reference: string = psTx.reference;
  const metadata = psTx.metadata || {};
  const userId: string | undefined = metadata.userId;

  if (!userId) {
    // No user attribution — cannot safely deliver. Record nothing.
    console.error(`[FUNDING] No userId in metadata for ${reference} — cannot process`);
    return { kind: "blocked", reason: "Missing user attribution" };
  }

  // ── Idempotency: if a tx already exists for this reference, we're done ──
  const existingTx = await prisma.transaction.findUnique({ where: { reference } });
  if (existingTx) {
    return { kind: "delivered", transaction: existingTx, alreadyProcessed: true };
  }

  const amountNaira = new Decimal(psTx.amount).div(100); // kobo → naira (gross, what the customer paid)
  // The cap is on the user's purchase intent, not the gross paid amount. When
  // Paystack's "pass charges to customer" setting is on, the gross can exceed
  // the cap by their ~1.5% + ₦100 fee even though the user requested exactly
  // the cap. /initialize already validates intent against FUNDING_PER_TX, so
  // trusting metadata here is safe.
  //
  // Safety guard: clamp to gross. If Paystack ever reports a gross smaller
  // than the metadata intent (shouldn't happen, but be defensive), we credit
  // based on what was actually paid — never more.
  const metadataIntent = metadata.originalAmountNaira
    ? new Decimal(metadata.originalAmountNaira)
    : amountNaira;
  const intendedNaira = Decimal.min(metadataIntent, amountNaira);
  const requestedToken: string = metadata.token || "USDC";
  const chain: string = metadata.chain || "MOVE";
  // Treasury holds USDCx (not USDC) on Movement, so deliver USDCx whenever a
  // user buys USDC on Movement. Same fungible-asset family, same wallet
  // address, 1:1 peg — user picks "USDC on Movement" and receives USDCx.
  const token: string = (requestedToken === "USDC" && chain === "MOVE") ? "USDCx" : requestedToken;

  // ── Server-known wallet address ONLY — never trust client input ──
  const userWallets = await prisma.wallet.findMany({
    where: { userId },
    select: { asset: true, chain: true, address: true },
  });
  const walletAddress: string =
    userWallets.find((w) => w.asset === token && w.chain === chain)?.address ||
    userWallets.find((w) => w.chain === chain)?.address || "";

  if (!walletAddress) {
    console.error(`[FUNDING] No wallet on file for user ${userId}, chain ${chain} — ref ${reference}`);
    return { kind: "blocked", reason: "No wallet address on file for this chain. Please set up your wallet first." };
  }

  // ── Max cap (mirrors initialize limit) ──
  // Check against the user's intended amount, not the gross — see comment above.
  if (intendedNaira.gt(FUNDING_PER_TX)) {
    console.error(`[FUNDING] Intended amount ${intendedNaira} exceeds cap — ref ${reference}`);
    return { kind: "blocked", reason: `Maximum funding amount is ₦${FUNDING_PER_TX.toLocaleString()}` };
  }

  // ── Fee + server-side rate ──
  // Use the user's intended amount for the conversion. When Paystack's
  // "pass charges to customer" setting is on, the gross (amountNaira) is
  // larger than what hits our Paystack balance — using gross here would
  // over-deliver crypto and we'd lose the Paystack fee out of pocket.
  const feeNaira = intendedNaira.mul(FEE_RATE).toDecimalPlaces(2);
  const netNaira = intendedNaira.minus(feeNaira);

  const liveRate = await getLiveFundRate(token);
  if (!liveRate || liveRate <= 0) {
    console.error(`[FUNDING] Rate unavailable for ${token} — ref ${reference}`);
    return { kind: "blocked", reason: "Exchange rate unavailable. Try again shortly." };
  }
  const finalCrypto = netNaira.div(liveRate);

  // ── Claim the reference: INSERT FIRST (status PROCESSING). ──
  // The unique constraint on `reference` makes this the idempotency
  // gate — a concurrent caller that loses the race gets P2002 and
  // bails WITHOUT sending. We send only after we own the row.
  let transaction;
  try {
    transaction = await prisma.transaction.create({
      data: {
        userId,
        type: "BUY",
        asset: token as any,
        chain: chain as any,
        amount: finalCrypto.toDecimalPlaces(8).toNumber(),
        fee: 0,
        status: "PROCESSING",
        reference,
        metadata: {
          amountNaira: intendedNaira.toNumber(),
          grossPaidNaira: intendedNaira.toNumber(),
          feeNaira: feeNaira.toNumber(),
          feePercent: FEE_PERCENT,
          netNaira: netNaira.toNumber(),
          txHash: null,
          walletAddress,
          paystackRef: reference,
          liveRateNgn: liveRate,
        },
      },
    });
  } catch (err: any) {
    if (err.code === "P2002" || err.message?.includes("Unique constraint")) {
      // Another caller (webhook or client) already claimed it. Don't send.
      console.log(`[FUNDING] Reference ${reference} already claimed by concurrent caller — skipping send`);
      const existing = await prisma.transaction.findUnique({ where: { reference } });
      if (existing) return { kind: "delivered", transaction: existing, alreadyProcessed: true };
    }
    throw err;
  }

  console.log(`[FUNDING] Claimed ${reference} → tx ${transaction.id}, sending ${finalCrypto} ${token} on ${chain}`);

  // ── Send on-chain (we own the row now) ──
  let txHash: string | null = null;
  try {
    txHash = await sendTokensToUser(walletAddress, finalCrypto.toNumber(), chain, token);
  } catch (sendErr: any) {
    console.error(`[FUNDING] Token send failed for ${reference}:`, sendErr.message);
    // Leave the row PROCESSING — payment recorded, delivery pending manual retry.
  }

  const finalStatus: "COMPLETED" | "PROCESSING" = txHash ? "COMPLETED" : "PROCESSING";

  transaction = await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      status: finalStatus,
      metadata: { ...(transaction.metadata as any), txHash },
    },
  });

  console.log(`[FUNDING] ✅ Tx ${transaction.id} | ${finalCrypto} ${token} on ${chain} | status=${finalStatus}`);

  // ── Credit wallet balance on success ──
  if (finalStatus === "COMPLETED") {
    await prisma.wallet.updateMany({
      where: { userId, asset: token as any, chain: chain as any },
      data: { balance: { increment: finalCrypto.toDecimalPlaces(8).toNumber() } },
    });
  }

  // ── Email + push (fire-and-forget) ──
  const cryptoDisplay = finalCrypto.toDecimalPlaces(token === "ETH" ? 8 : 4).toString();
  const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  if (finalStatus === "COMPLETED") {
    if (dbUser?.email) {
      sendFundingSuccessEmail(dbUser.email, {
        amountNaira: intendedNaira.toNumber(),
        cryptoAmount: cryptoDisplay,
        asset: assetLabel(token),
        chain,
        fee: feeNaira.toNumber(),
        txHash,
        reference,
        date: new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }),
      }).catch((e) => console.error("[FUNDING] Email error:", e));
    }
    sendNotification({
      userId,
      type: "transaction",
      title: "Purchase Successful",
      body: `You bought ${cryptoDisplay} ${assetLabel(token)} on ${chain} for ₦${intendedNaira.toNumber().toLocaleString()}`,
    }).catch((e) => console.error("[FUNDING] Notification error:", e));
  } else {
    sendNotification({
      userId,
      type: "transaction",
      title: "Purchase Processing",
      body: `Your payment of ₦${intendedNaira.toNumber().toLocaleString()} was received. ${cryptoDisplay} ${assetLabel(token)} delivery is being processed.`,
    }).catch((e) => console.error("[FUNDING] Notification error:", e));
  }

  return { kind: "delivered", transaction, alreadyProcessed: false };
}

// ═══════════════════════════════════════════════════════════
// POST /funding/initialize
// ═══════════════════════════════════════════════════════════
router.post(
  "/initialize",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      // ── Maintenance gate ────────────────────────────────
      const fundingPaused = await pauseGuard("funding");
      if (fundingPaused) {
        res.status(503).json({ error: fundingPaused, paused: true, service: "funding" });
        return;
      }

      const parsed = initSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors });
        return;
      }

      const { amountNaira, email, metadata } = parsed.data;

      // ── USDCx funding not yet supported ──────────────────
      if (metadata.token === "USDCx") {
        res.status(503).json({ error: "USDCx purchases are coming soon. Please choose another token for now." });
        return;
      }

      // ── Per-token maintenance gates ──────────────────────
      if (env.USDT_FUNDING_MAINTENANCE && metadata.token === "USDT") {
        res.status(503).json({ error: "USDT purchases are temporarily under maintenance. Please try again later." });
        return;
      }
      if (env.SOL_FUNDING_MAINTENANCE && metadata.token === "SOL") {
        res.status(503).json({ error: "SOL purchases are temporarily under maintenance. Please try again later." });
        return;
      }
      if (env.USDC_BASE_FUNDING_MAINTENANCE && metadata.token === "USDC" && metadata.chain === "BASE") {
        res.status(503).json({ error: "USDC purchases on Base are temporarily under maintenance. Please try again later." });
        return;
      }
      if (env.USDC_SOL_FUNDING_MAINTENANCE && metadata.token === "USDC" && metadata.chain === "SOL") {
        res.status(503).json({ error: "USDC purchases on Solana are temporarily under maintenance. Please try again later." });
        return;
      }
      const userId = req.user!.userId;

      // ── Rate availability gate ────────────────────────────
      const liveRate = await getLiveFundRate(metadata.token);
      if (!liveRate || liveRate <= 0) {
        res.status(503).json({ error: "Exchange rate unavailable. Please try again shortly." });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // KYC gate
      if (user.kycStatus !== "VERIFIED") {
        res.status(403).json({ error: "KYC verification required to buy crypto" });
        return;
      }

      // Per-transaction limit
      if (amountNaira > FUNDING_PER_TX) {
        res.status(400).json({ error: `Maximum ₦${FUNDING_PER_TX.toLocaleString()} per transaction` });
        return;
      }

      // Daily limit check
      const spentToday = await fundingSpentToday(userId);
      const remaining = FUNDING_DAILY - spentToday;

      if (amountNaira > remaining) {
        res.status(400).json({
          error: remaining <= 0
            ? `Daily funding limit of ₦${FUNDING_DAILY.toLocaleString()} reached. Try again tomorrow.`
            : `Exceeds daily limit. You have ₦${Math.floor(remaining).toLocaleString()} remaining today.`,
          dailyLimit: FUNDING_DAILY,
          spentToday,
          remaining: Math.max(remaining, 0),
        });
        return;
      }

      if (!isFlutterwaveConfigured()) {
        res.status(503).json({ error: "Payments are temporarily unavailable. Please try again shortly." });
        return;
      }

      /**
       * Flutterwave will not issue a virtual account without a BVN or NIN, and
       * we already hold the NIN as an identity claim from Didit - the same
       * claim that stops one ID verifying two accounts - so no new data is
       * collected and no new document is asked for.
       *
       * All of them, not the first one. Didit can produce two national_number
       * claims for one person: one from `personal_number` and one from the
       * document number of a NIN slip. `findFirst` with no ordering picked
       * between them arbitrarily, and a verified user with a real NIN on file
       * was told their payment account could not be opened because the other
       * claim went to the bank instead.
       */
      const ninClaims = await prisma.identityClaim.findMany({
        where: { userId, kind: "national_number" },
        select: { key: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      /**
       * What Flutterwave will actually accept.
       *
       * Its validator reads the NIN as a NUMBER - "must be a positive or
       * unsigned, non-zero number and must be 11 digits long" - so a value with
       * a leading zero is ten digits to it and is rejected every single time.
       * 09012345678 is eleven characters and was refused on all four attempts.
       *
       * The claim key is a dedupe identifier and is deliberately looser than
       * this: it also holds national numbers from documents that are not
       * Nigerian. Filtering here rather than at claim time keeps dedupe as wide
       * as it was while sending the bank only what it can use.
       */
      const usableNin = (v: string) => /^[1-9]\d{10}$/.test(v);
      const candidates = ninClaims
        .map((c) => c.key.replace(/^nin:/, ""))
        .filter(usableNin);

      /**
       * Prefer the number on the document they actually verified with.
       *
       * Where there is a choice, the one a reviewer saw on the ID is the one
       * the bank's own records will agree with. Everything else is a fallback,
       * newest first.
       */
      const verified = await prisma.kycVerification.findFirst({
        where: { userId, status: "VERIFIED" },
        orderBy: { createdAt: "desc" },
        select: { documentNumber: true },
      });
      const onDocument = (verified?.documentNumber ?? "").replace(/\D/g, "");

      /**
       * And last, the one they typed.
       *
       * A Nigerian passport does not carry the NIN anywhere the scanner can
       * read it - the MRZ personal-number field comes back empty - so somebody
       * who verified with one is approved, correct, and permanently unable to
       * be given an account. Re-verifying does not help: the number is not on
       * the document. Asking them for it is the only way through.
       *
       * Ranked below the verified claims on purpose. A number that came off a
       * document a reviewer saw beats a number somebody typed, every time.
       */
      const declared =
        user.declaredNin && usableNin(user.declaredNin) ? user.declaredNin : null;

      const nin =
        candidates.find((c) => c === onDocument) ?? candidates[0] ?? declared ?? null;

      if (!nin) {
        // A verified user reaching this point did verify - just with a document
        // that carried no NIN. Telling them to "complete verification" would be
        // both wrong and impossible to act on: their passport will never carry
        // the number, however many times they scan it. So the app is told it
        // may ask for the number instead.
        res.status(403).json({
          // One sentence only. The app adds why we could not read it, and
          // saying it in both places read as an apology repeated twice.
          error: "Your bank needs your National Identity Number to open a payment account",
          code: "NIN_REQUIRED",
          // The app shows a field rather than sending them back to verification.
          canDeclare: user.kycStatus === "VERIFIED",
        });
        console.warn(
          `[FUNDING] No usable NIN for user ${userId} (kyc=${user.kycStatus}, ` +
            `claims=${ninClaims.length}, declared=${user.declaredNin ? "unusable" : "none"})`
        );
        return;
      }

      if (nin === declared && !candidates.length) {
        console.log(`[FUNDING] using declared NIN for ${userId} - no document carried one`);
      }

      // Alphanumeric only, and comfortably inside Flutterwave's 6-42 range.
      const reference = `mm${Date.now().toString(36)}${crypto.randomBytes(8).toString("hex")}`;

      // One customer per email, looked up rather than recreated. Creating is not
      // idempotent, and the id is cached the moment it exists so a failure
      // later in this flow cannot orphan it.
      const customer = await flwGetOrCreateCustomer({
        email: email || user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      if (!customer.ok || !customer.id) {
        console.error("[FUNDING] Flutterwave customer error:", customer.error);
        res.status(502).json({ error: "Couldn't set up your payment account. Please try again." });
        return;
      }
      const customerId = customer.id;

      const EXPIRY_MINUTES = 30;
      const va = await flwCreateVirtualAccount({
        customerId,
        amount: amountNaira,
        reference,
        nin,
        expiresInMinutes: EXPIRY_MINUTES,
      });

      if (!va.ok || !va.account?.account_number) {
        console.error("[FUNDING] Flutterwave virtual account error:", va.error);
        res.status(502).json({ error: "Couldn't open a payment account right now. Please try again." });
        return;
      }

      const expiresAt = va.account.account_expiration_datetime
        ? new Date(va.account.account_expiration_datetime)
        : new Date(Date.now() + EXPIRY_MINUTES * 60_000);

      // Written BEFORE the account number reaches the user: the webhook that
      // credits them carries no session, so this row is the only thing that can
      // say who paid and what they were promised.
      await prisma.fundingIntent.create({
        data: {
          userId,
          reference,
          provider: "flutterwave",
          amountNaira,
          token: metadata.token,
          chain: metadata.chain,
          convertedAmount: metadata.convertedAmount,
          rate: liveRate,
          customerId,
          accountNumber: va.account.account_number,
          bankName: va.account.account_bank_name || "Flutterwave MFB",
          expiresAt,
          status: "PENDING",
        },
      });

      console.log("[FUNDING] ✅ Virtual account issued:", reference);

      // Show what Flutterwave says must be sent, not what we asked for. With
      // "customer pays charges" enabled the account expects the amount plus a
      // fee, and telling the user the lower figure guarantees a short payment
      // the account then rejects.
      const payable = typeof va.account.amount === "number" ? va.account.amount : amountNaira;
      if (payable !== amountNaira) {
        console.log(`[FUNDING] Payable ₦${payable} differs from purchase ₦${amountNaira} (fees passed to customer)`);
      }

      res.json({
        reference,
        accountNumber: va.account.account_number,
        bankName: va.account.account_bank_name || "Flutterwave MFB",
        // Falls back to the narration, which is what resolves in the payer's
        // banking app when Flutterwave sends no name of its own.
        accountName: va.account.account_name || "Money Moves",
        // What to transfer.
        amountNaira: payable,
        // What is being bought, when a fee makes the two differ.
        purchaseNaira: amountNaira,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (err: any) {
      console.error("[FUNDING] Initialize error:", err);
      res.status(500).json({ error: "Failed to initialize payment" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /funding/limits — return current user's funding limits
// ═══════════════════════════════════════════════════════════
/**
 * ─── POST /funding/nin — the number their document did not carry ──
 *
 * Only for accounts that are already verified. This is not a way around
 * identity checks: the person has passed one, and the document they passed it
 * with simply does not print the NIN. Somebody unverified gains nothing by
 * typing a number here, so they are refused outright.
 *
 * What is stored never enters identity_claims. Those keys decide whether two
 * accounts are the same person, and a number somebody typed is not proof of
 * anything - putting it there would let one person claim a stranger's NIN and
 * lock the real owner out of the product for good.
 *
 * The one check worth making is the mirror of that: a NIN that a DIFFERENT
 * account proved with a document is refused here, because the real holder has
 * already shown us the document and this one has not.
 */
router.post(
  "/nin",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const nin = String(req.body?.nin ?? "").replace(/\D/g, "");

      /**
       * Eleven digits, no leading zero - Flutterwave reads the NIN as a number,
       * so 09012345678 is ten digits to it and is refused every time. Better to
       * say so here than to let the bank reject it later with no explanation.
       */
      if (!/^[1-9]\d{10}$/.test(nin)) {
        res.status(400).json({
          error: nin.startsWith("0")
            ? "Your bank cannot accept a NIN that starts with 0. Please check the number."
            : "A NIN is 11 digits. Please check the number and try again.",
        });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { kycStatus: true },
      });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      if (user.kycStatus !== "VERIFIED") {
        res.status(403).json({ error: "Please verify your identity first." });
        return;
      }

      // Proved by somebody else, with a document. Theirs, not this account's.
      const heldElsewhere = await prisma.identityClaim.findFirst({
        where: { key: `nin:${nin}`, kind: "national_number", userId: { not: userId } },
        select: { id: true },
      });
      if (heldElsewhere) {
        console.warn(`[FUNDING] ${userId} declared a NIN already proved by another account`);
        res.status(409).json({
          error: "That number is already on another Money Moves account. Please contact support.",
        });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { declaredNin: nin, declaredNinAt: new Date() },
      });
      console.log(`[FUNDING] ${userId} supplied a NIN their document did not carry`);

      res.json({ ok: true });
    } catch (err) {
      console.error("[FUNDING] declare NIN failed:", err);
      res.status(500).json({ error: "Could not save that. Please try again." });
    }
  }
);

router.get(
  "/limits",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }
      if (user.kycStatus !== "VERIFIED") {
        res.json({ allowed: false, perTx: 0, dailyLimit: 0, spentToday: 0, remaining: 0 });
        return;
      }
      const spentToday = await fundingSpentToday(userId);
      res.json({
        allowed: true,
        perTx: FUNDING_PER_TX,
        dailyLimit: FUNDING_DAILY,
        spentToday: Math.round(spentToday),
        remaining: Math.max(FUNDING_DAILY - spentToday, 0),
      });
    } catch (err) {
      console.error("[FUNDING] Limits error:", err);
      res.status(500).json({ error: "Failed to fetch limits" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /funding/callback?reference=...
// Paystack redirects here after payment — serves a simple page
// The WebView detects this URL and triggers verification
// ═══════════════════════════════════════════════════════════
router.get("/callback", (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Payment Complete</title>
    <style>body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:system-ui;background:#0a0a0a;color:#fff;text-align:center}
    .wrap{padding:24px;max-width:320px}.icon{font-size:48px;margin-bottom:16px}h1{font-size:22px;margin:0 0 8px}p{color:#888;font-size:14px;margin:0 0 24px}
    button{background:#C8F53C;color:#000;border:0;border-radius:12px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
    button:active{opacity:.8}</style></head>
    <body><div class="wrap"><div class="icon">✅</div><h1>Payment Received</h1><p>Returning to Money Moves…</p><button onclick="closeWin()">Return to Money Moves</button></div>
    <script>
      (function(){
        var params = new URLSearchParams(window.location.search);
        var reference = params.get('reference') || params.get('trxref') || '';
        // Notify opener (cross-origin safe via postMessage)
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: 'PAYSTACK_CALLBACK', reference: reference }, '*');
          }
        } catch(e) {}
        function closeWin(){
          try { window.close(); } catch(e) {}
          // If close is blocked, try navigating opener then self-nav as last resort
          try {
            if (window.opener && !window.opener.closed) {
              window.opener.focus();
            }
          } catch(e) {}
        }
        window.closeWin = closeWin;
        // Auto-attempt close after a short delay; button is the manual fallback
        setTimeout(closeWin, 1200);
      })();
    </script></body></html>`);
});

// ═══════════════════════════════════════════════════════════
// GET /funding/verify/:reference
// ═══════════════════════════════════════════════════════════
//
// The client polls this while the user is making the bank transfer. It is a
// convenience, not the source of truth: the webhook owns delivery, and this
// endpoint exists so the waiting screen can move on promptly rather than
// sitting on a spinner until a push arrives.
//
// It also doubles as a self-heal. If the webhook was missed - dropped, or our
// bug - a paid intent with no transaction is delivered here instead of leaving
// the user paid-but-uncredited. processFunding() is idempotent, so the two
// paths racing is harmless.
router.get(
  "/verify/:reference",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const reference = String(req.params.reference || "");
      const userId = req.user!.userId;

      if (!reference) {
        res.status(400).json({ error: "Reference required" });
        return;
      }

      const intent = await prisma.fundingIntent.findUnique({ where: { reference } });
      if (!intent) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }
      if (intent.userId !== userId) {
        // Do not leak that the reference exists.
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      const respondWithTx = (t: any, alreadyProcessed?: boolean) =>
        res.json({
          status: "success",
          transaction: {
            id: t.id,
            type: t.type,
            asset: t.asset,
            chain: t.chain,
            amount: t.amount,
            status: t.status,
            reference: t.reference,
            metadata: t.metadata,
            createdAt: t.createdAt,
          },
          message: alreadyProcessed ? "Already processed" : undefined,
        });

      // Already delivered.
      const existing = await prisma.transaction.findUnique({ where: { reference } });
      if (existing) {
        respondWithTx(existing, true);
        return;
      }

      // Ask Flutterwave directly when we have not seen a webhook yet. Its answer
      // is authoritative; ours is only a cache of it.
      //
      // Searching by OUR reference rather than a charge id matters: the charge
      // id normally arrives on the webhook, so requiring it would make this poll
      // useless in exactly the cases it exists for - a webhook that is late,
      // dropped, or (running locally) cannot reach us at all.
      let paid = intent.status === "PAID";
      let paidAmount: number | null = null;
      // Carried down to the gate below. A charge we did not have to fetch -
      // already PAID from the webhook - leaves this empty, and the gate reads
      // a missing name exactly as the rail sending none.
      let senderSeen: FlwSender = { name: null, bank: null, accountMasked: null };

      if (!paid && isFlutterwaveConfigured()) {
        try {
          const charge = intent.chargeId
            ? await flwGetCharge(intent.chargeId).then((c) => ({
                id: intent.chargeId,
                status: c.data?.status ?? null,
                amount: typeof c.data?.amount === "number" ? c.data.amount : null,
                sender: flwExtractSender(c.data),
              }))
            : await flwFindChargeByReference(reference);
          senderSeen = charge.sender;

          paid = ["succeeded", "successful", "success"].includes(
            String(charge.status || "").toLowerCase()
          );
          paidAmount = charge.amount;
          // An amount we can't read is a transfer we haven't seen yet: never delivered on a guess.
          if (paid && !(paidAmount !== null && paidAmount > 0)) paid = false;

          if (paid) {
            // Same guard as the webhook: never hand over crypto quoted for the
            // full amount when less than that arrived.
            const owed = Number(intent.amountNaira);
            if (paidAmount !== null && paidAmount > 0 && paidAmount + 0.01 < owed) {
              await prisma.fundingIntent.update({
                where: { id: intent.id },
                data: { status: "FAILED", chargeId: charge.id ?? undefined },
              });
              res.status(400).json({
                error: `We received ₦${paidAmount.toLocaleString()} but expected ₦${owed.toLocaleString()}. Contact support and we'll sort it out.`,
              });
              return;
            }

            await prisma.fundingIntent.update({
              where: { id: intent.id },
              data: { status: "PAID", chargeId: charge.id ?? undefined },
            });
          }
        } catch (e: any) {
          console.warn("[FUNDING] Charge lookup failed for", reference, e?.message);
        }
      }

      if (!paid) {
        const expired = !!intent.expiresAt && intent.expiresAt.getTime() < Date.now();
        res.json({
          status: expired ? "expired" : "pending",
          message: expired
            ? "This payment account has expired. Start again to get a new one."
            : "We haven't seen your transfer yet.",
          accountNumber: intent.accountNumber,
          bankName: intent.bankName,
          amountNaira: Number(intent.amountNaira),
          expiresAt: intent.expiresAt?.toISOString() ?? null,
        });
        return;
      }

      /**
       * The webhook may have marked this paid before the poll arrived, in which
       * case the block above never ran and there is no sender in hand. Go and
       * get one rather than judge without it; the gate also refuses to re-judge
       * on an empty hand, so this is the belt to that pair of braces.
       */
      if (paid && !senderSeen.name && !intent.nameVerdict && isFlutterwaveConfigured()) {
        try {
          senderSeen = intent.chargeId
            ? flwExtractSender((await flwGetCharge(intent.chargeId)).data)
            : (await flwFindChargeByReference(reference)).sender;
        } catch (e: any) {
          console.warn("[FUNDING] sender lookup failed for", reference, e?.message);
        }
      }

      // Same gate as the webhook, or a held deposit would be released by the
      // next poll - the poll exists precisely for when the webhook did not run.
      const gate = await gateSender(intent, senderSeen);
      if (gate.hold) {
        res.json({
          status: "held",
          message: gate.check.reason,
          amountNaira: Number(intent.amountNaira),
        });
        return;
      }

      // Paid but undelivered - the webhook was missed. Deliver now.
      const result = await processFunding({
        reference: intent.reference,
        amount: Math.round(Number(intent.amountNaira) * 100),
        metadata: {
          userId: intent.userId,
          type: "buy",
          originalAmountNaira: Number(intent.amountNaira),
          token: intent.token,
          chain: intent.chain,
          convertedAmount: Number(intent.convertedAmount),
        },
      });

      if (result.kind === "blocked") {
        res.status(400).json({ error: result.reason });
        return;
      }

      respondWithTx(result.transaction, result.alreadyProcessed);
    } catch (err: any) {
      console.error("[FUNDING] Verify error:", err);
      res.status(500).json({ error: "Verification failed" });
    }
  }
);


// ═══════════════════════════════════════════════════════════
// POST /funding/webhook — Flutterwave events
// ═══════════════════════════════════════════════════════════
//
// Unauthenticated by nature, and it credits real money, so the signature is
// the only thing standing between a stranger and a free purchase. It is an
// HMAC-SHA256 over the RAW bytes: express.json stashes them on req.rawBody
// precisely because re-serialising req.body would reorder keys and break the
// digest.
//
// The payload is never trusted for the amount or the asset. It tells us WHICH
// deposit landed; the FundingIntent written at /initialize says what that
// deposit was for, at the rate the user was actually shown.
/**
 * Does this deposit come from an account in the buyer's own name?
 *
 * The rule is that it must. Flutterwave tells us who sent the transfer; the
 * name we trust is the one on the verified ID, taken from the most recent
 * verified KYC row and falling back to the profile, which on some accounts
 * holds the given name and surname the other way round.
 *
 * Records the answer on the intent in every mode - the recorded verdicts are
 * the only way to learn what real senders look like - and returns whether
 * delivery should stop. See FUNDING_NAME_CHECK in config/env.
 */
/**
 * Telling somebody their deposit is held, once it is clear that it is.
 *
 * A hold can be undone within seconds and a notification cannot. Both delivery
 * paths judge the sender and they do not see the same thing: the webhook is
 * handed the charge, the poll goes and fetches it. When the webhook arrives
 * with no usable sender the verdict is MISSING, which holds - and then the
 * poll turns up with the real name, the verdict becomes MATCH, the hold lifts
 * and the coin goes out. The money was never at risk and the purchase
 * succeeded, but the phone had already been told it was under review, so the
 * two notifications arrived in that order: held, then successful.
 *
 * So the hold is immediate and the notice is not. After the wait the state is
 * read again, and a deposit that has since been released or delivered says
 * nothing at all.
 *
 * A restart loses a pending notice. That costs a push on a genuinely held
 * deposit - it still sits in the review queue, and the app still says held
 * when it next asks - which is the better way round for this to fail.
 */
const HOLD_NOTICE_DELAY_MS = 90_000;
const holdNotices = new Map<string, NodeJS.Timeout>();

function cancelHoldNotice(intentId: string): void {
  const t = holdNotices.get(intentId);
  if (t) {
    clearTimeout(t);
    holdNotices.delete(intentId);
  }
}

function scheduleHoldNotice(intentId: string): void {
  // One pending notice per deposit, however many times the gate runs.
  if (holdNotices.has(intentId)) return;

  const timer = setTimeout(async () => {
    holdNotices.delete(intentId);
    try {
      const now = await prisma.fundingIntent.findUnique({
        where: { id: intentId },
        select: { status: true, reference: true, userId: true },
      });
      if (!now || now.status !== "HELD") return;

      // Held on paper but already delivered is not held. Saying so would be
      // the same wrong notification arriving late instead of early.
      const delivered = await prisma.transaction.findUnique({
        where: { reference: now.reference },
        select: { id: true },
      });
      if (delivered) return;

      /**
       * Short, because it is a notification.
       *
       * This used to carry the whole finding - which bank told us what, and
       * the rule about funding from someone else's account - into a line on a
       * lock screen. Nobody reads a paragraph there, and the part that matters
       * is that the money arrived and is not lost. The reason is on the
       * transaction itself, where there is room for it and where somebody goes
       * looking when they want to know.
       */
      await sendNotification({
        userId: now.userId,
        type: "transaction",
        title: "Deposit held for review",
        body: "We'll look into it and get back to you within 24 hours.",
      });
    } catch (e: any) {
      console.error(`[FUNDING] hold notice for ${intentId} failed:`, e?.message);
    }
  }, HOLD_NOTICE_DELAY_MS);

  // Never a reason to keep the process alive.
  timer.unref?.();
  holdNotices.set(intentId, timer);
}

async function gateSender(
  intent: { id: string; userId: string; reference: string },
  sender: FlwSender,
): Promise<{ hold: boolean; check: NameCheck }> {
  const mode = env.FUNDING_NAME_CHECK;

  const [delivered, current] = await Promise.all([
    prisma.transaction.findUnique({
      where: { reference: intent.reference },
      select: { id: true },
    }),
    prisma.fundingIntent.findUnique({
      where: { id: intent.id },
      select: { status: true, nameVerdict: true, senderName: true, holdReason: true },
    }),
  ]);

  /**
   * Judged already, and this caller brought no sender.
   *
   * Both delivery paths gate, and they see different things: the webhook is
   * handed the charge, the poll has to go and fetch it, and when the webhook
   * got there first the poll skips the fetch entirely. Judging again on an
   * empty hand records the caller's blind spot as a fact about the transfer -
   * which is precisely how a deposit that had passed, and been delivered, was
   * marked MISSING two seconds later and held.
   */
  if (!sender.name && current?.nameVerdict) {
    return {
      hold: current.status === "HELD",
      check: {
        verdict: current.nameVerdict as NameCheck["verdict"],
        senderName: current.senderName,
        expected: null,
        reason: current.holdReason ?? "",
      },
    };
  }

  /**
   * The name to compare against, from wherever it actually is.
   *
   * KYC first, because a verified document is better evidence than whatever
   * somebody typed at sign-up. But a verified row does not always carry
   * names - plenty here have them null - and the profile used to be read
   * only when NO row existed, so a row with nothing in it meant nothing was
   * compared. The verdict came back NO_REFERENCE and the deposit was held
   * for review with the person's name sitting in the console two lines
   * above, which is how one held purchase looked like a name mismatch when
   * the names were identical.
   *
   * Both are loaded now, and the fallback is per FIELD rather than per row.
   */
  const [kyc, profile] = await Promise.all([
    prisma.kycVerification.findFirst({
      where: { userId: intent.userId, status: "VERIFIED" },
      orderBy: { createdAt: "desc" },
      select: { firstName: true, lastName: true },
    }),
    prisma.user.findUnique({
      where: { id: intent.userId },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const check = checkSenderName({
    senderName: sender.name,
    first: kyc?.firstName || profile?.firstName,
    last: kyc?.lastName || profile?.lastName,
  });

  /**
   * Holding is a decision taken before the coin moves. Once it has moved there
   * is nothing to hold, and saying otherwise leaves a delivered purchase
   * sitting in the review queue looking like money somebody still owes.
   */
  const wouldHold = mode === "off" ? false : holdsOn(mode, check.verdict);
  const hold = wouldHold && !delivered;

  if (wouldHold && delivered) {
    console.warn(
      `[FUNDING] sender ${check.verdict} on ${intent.id} but the coin is already out - not holding`,
    );
  }

  await prisma.fundingIntent.update({
    where: { id: intent.id },
    data: {
      senderName: sender.name,
      senderBank: sender.bank,
      nameVerdict: mode === "off" ? null : check.verdict,
      holdReason: hold ? check.reason : null,
      /**
       * Both ways round. A hold is recorded, and a hold is lifted.
       *
       * The two paths can reach the gate in either order, and one of them may
       * be the one that actually saw the sender. If the poll held a deposit
       * while it could not see who sent it, and the webhook then arrives with
       * the name and passes, the money must not stay marked held - the coin is
       * about to go out, and a record saying otherwise is the thing that puts
       * a delivered purchase in the review queue.
       */
      ...(hold ? { status: "HELD" } : current?.status === "HELD" ? { status: "PAID" } : {}),
    },
  });

  if (!hold) {
    // Whether or not this read saw HELD: an earlier gate may have queued a
    // notice that this judgement has just made wrong.
    cancelHoldNotice(intent.id);
  }
  if (!hold && current?.status === "HELD") {
    console.log(`[FUNDING] hold lifted on ${intent.id} — ${check.verdict}, sender ${check.senderName ?? "(none)"}`);
  }

  if (check.verdict !== "MATCH" && mode !== "off") {
    console.warn(
      `[FUNDING] sender ${check.verdict} on ${intent.id} — from ${sender.name ?? "(no name)"}` +
        ` (${sender.bank ?? "?"}), expected ${check.expected ?? "(nothing on file)"}` +
        ` — ${hold ? "HELD" : "released, " + mode}`,
    );
  }

  if (hold) {
    // Queued, not sent. The other delivery path may be seconds behind with a
    // sender name that clears this.
    scheduleHoldNotice(intent.id);
  }

  return { hold, check };
}

router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature =
      (req.headers["flutterwave-signature"] as string) ||
      (req.headers["Flutterwave-Signature"] as string);
    const raw = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));

    if (!verifyFlutterwaveSignature(raw, signature)) {
      console.warn("[FUNDING] Webhook signature rejected");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const type: string = req.body?.type || req.body?.event || "";
    const data: any = req.body?.data || {};

    // ── On-ramp: the user's bank transfer landed ──────────────
    if (type === "charge.completed") {
      const reference: string | undefined = data.reference || data.meta?.reference;
      const succeeded = ["succeeded", "successful", "success"].includes(
        String(data.status || "").toLowerCase()
      );

      console.log("[FUNDING] charge.completed:", reference, data.status);

      if (!reference) {
        console.warn("[FUNDING] charge.completed with no reference — ignoring");
        res.sendStatus(200);
        return;
      }

      const intent = await prisma.fundingIntent.findUnique({ where: { reference } });
      if (!intent) {
        // Not ours, or an account we never issued. Acknowledge so Flutterwave
        // stops retrying, but credit nothing.
        console.warn("[FUNDING] No funding intent for", reference);
        res.sendStatus(200);
        return;
      }

      if (!succeeded) {
        await prisma.fundingIntent.update({
          where: { id: intent.id },
          data: { status: "FAILED", chargeId: data.id ?? undefined },
        });
        res.sendStatus(200);
        return;
      }

      // Credit only what actually arrived. If the user under-pays we must not
      // hand over the crypto they were quoted for the full amount.
      let paid = Number(data.amount ?? 0);
      // No amount in the notice: asked of Flutterwave itself. Still none, nothing is delivered on a guess.
      if (!(paid > 0)) {
        paid = (await flwFindChargeByReference(reference).catch(() => null))?.amount ?? 0;
        if (!(paid > 0)) {
          console.warn(`[FUNDING] ${reference}: no amount in the notice or the charge, not delivered. The client's check or ops will pick it up.`);
          res.sendStatus(200);
          return;
        }
      }
      const owed = Number(intent.amountNaira);
      if (paid + 0.01 < owed) {
        console.warn(`[FUNDING] Underpaid ${reference}: got ${paid}, expected ${owed}`);
        await prisma.fundingIntent.update({
          where: { id: intent.id },
          data: { status: "FAILED", chargeId: data.id ?? undefined },
        });
        await sendNotification({
          userId: intent.userId,
          type: "transaction",
          title: "Payment short",
          body: `We received ₦${paid.toLocaleString()} but expected ₦${owed.toLocaleString()}. Contact support and we'll sort it out.`,
        }).catch(() => {});
        res.sendStatus(200);
        return;
      }

      await prisma.fundingIntent.update({
        where: { id: intent.id },
        data: { status: "PAID", chargeId: data.id ?? undefined },
      });

      // Whose account did this come from? Recorded either way; in enforce mode
      // a transfer that names nobody we recognise stops here, with the naira
      // ours and the crypto undelivered until someone looks at it.
      const { hold } = await gateSender(intent, flwExtractSender(data));
      if (hold) {
        res.sendStatus(200);
        return;
      }

      // processFunding is the Paystack-era delivery half and is entirely
      // provider-agnostic - it just wants a reference, an amount in kobo, and
      // metadata. Adapting to it beats reimplementing idempotency, wallet
      // lookup, caps and treasury sends on a money path that already works.
      const adapted = {
        reference: intent.reference,
        amount: Math.round(Number(intent.amountNaira) * 100),
        metadata: {
          userId: intent.userId,
          type: "buy",
          originalAmountNaira: Number(intent.amountNaira),
          token: intent.token,
          chain: intent.chain,
          convertedAmount: Number(intent.convertedAmount),
        },
      };

      const existing = await prisma.transaction.findUnique({
        where: { reference: intent.reference },
      });
      if (existing) {
        console.log("[FUNDING] Webhook: tx already exists for", reference);
      } else {
        try {
          const result = await processFunding(adapted);
          console.log(`[FUNDING] Delivery result for ${reference}:`, result.kind);
        } catch (e: any) {
          console.error(`[FUNDING] Delivery error for ${reference}:`, e?.message);
        }
      }

      res.sendStatus(200);
      return;
    }

    // ── Off-ramp: a payout to the user's bank settled or failed ──
    //
    // Through settlePayoutWebhook rather than inline, because the transaction
    // has to be checked against the rail that actually sent it. Both providers
    // use our reference as their idempotency key, so the same string names a
    // transfer at both, and a late Flutterwave webhook must not be allowed to
    // fail a payout that has since gone out on Paystack.
    if (type.startsWith("transfer.")) {
      const reference: string | undefined = data.reference;
      const status = String(data.status || "").toUpperCase();

      /**
       * The proof, which only ever arrives here.
       *
       * The transfer object does not carry it and there is no endpoint that
       * does, so if it is not in this payload we cannot show it to anybody. On
       * the settlements where we find nothing, the payload is logged once so
       * the shape can be read from a real event rather than guessed at again.
       */
      const sessionId = sessionIdFrom(data);
      console.log(
        `[SELL] ${type}:`,
        reference,
        status,
        sessionId ? `session=${sessionId}` : "(no session id in payload)"
      );
      if (!sessionId && status === "SUCCESSFUL") {
        console.log(`[SELL] ${type} payload for inspection:`, JSON.stringify(data));
      }

      if (reference) {
        await settlePayoutWebhook({
          provider: "flutterwave",
          reference,
          sessionId,
          // The uppercased one: mapTransferStatus matches "SUCCESSFUL"
          // exactly, and Flutterwave is not consistent about the case it
          // sends. Passing the raw value quietly mapped every settlement to
          // PENDING, which does nothing at all.
          status: mapTransferStatus(status),
          reason: data.complete_message || data.narration || type,
        });
      }
    }

    res.sendStatus(200);
  } catch (err: any) {
    console.error("[FUNDING] Webhook error:", err);
    // Acknowledge regardless: a 500 here would have Flutterwave retry our own
    // bug in a loop.
    res.sendStatus(200);
  }
});


/**
 * POST /funding/webhook/paystack — a Paystack payout settled or failed.
 *
 * Its own route rather than a branch of the Flutterwave one: the signature
 * schemes are different (HMAC SHA512 of the raw body against the secret key,
 * versus Flutterwave's own header), and a single endpoint that tried both
 * would accept anything either of them would - which is the wrong shape for
 * the door money leaves by.
 *
 * Payouts only. Paystack does no funding here, so a charge event arriving on
 * this route is acknowledged and ignored rather than acted on.
 */
router.post("/webhook/paystack", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-paystack-signature"] as string | undefined;
    const raw = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));

    if (!verifyPaystackSignature(raw, signature)) {
      console.warn("[PS] Webhook signature rejected");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const event: string = req.body?.event || "";
    const data: any = req.body?.data || {};

    if (event.startsWith("transfer.")) {
      const reference: string | undefined = data.reference;
      console.log(`[PS] ${event}:`, reference, data.status);

      if (reference) {
        await settlePayoutWebhook({
          provider: "paystack",
          reference,
          // Paystack names the outcome in the event as well as the payload;
          // the payload is the one that carries "reversed".
          status: mapPaystackTransferStatus(data.status),
          reason: data.reason || data.message || event,
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("[PS] Webhook error:", err);
    // Acknowledged regardless: a 500 has Paystack retry our own bug in a loop.
    res.sendStatus(200);
  }
});

export default router;
