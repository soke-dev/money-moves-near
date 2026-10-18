import { Router, Request, Response } from "express";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { requireDynamicWallet } from "../middleware/wallet-kind";
import { prisma } from "../lib/prisma";
import { redeemVoucher, normaliseCode } from "../lib/voucher";
import {
  buildFundingTransaction,
  submitSignedFunding,
  sendFromEscrow,
  isVoucherEscrowConfigured,
} from "../lib/voucher-escrow";
import {
  planVoucher,
  holdPrepared,
  takePrepared,
  sweepRefunds,
  LIMITS,
} from "../lib/user-voucher";
import { toAmount } from "../lib/voucher-split";
import {
  AccountAuthenticatorEd25519,
  Ed25519PublicKey,
  Ed25519Signature,
  generateSigningMessageForTransaction,
} from "@aptos-labs/ts-sdk";
import { sendNotification } from "../lib/push";
import { sendVoucherEmail } from "../lib/email";
import { anonCodeHandle, publicNameOf } from "../lib/anon";

const router = Router();

/**
 * Claiming a voucher.
 *
 * The code is the only credential here, so the thing to stop is somebody
 * working through the space of them. A short code is guessable by a script and
 * not by a person, which makes the rate limit the whole defence.
 */

const TRIES = 8;
const WINDOW_MS = 10 * 60_000;
const attempts = new Map<string, { n: number; until: number }>();

/**
 * Counts failures, not requests.
 *
 * A successful claim costs nothing: somebody with five real codes should be
 * able to use all five. It is the wrong guesses that are worth limiting, and
 * counting both would punish the honest case to catch the other.
 */
function tooManyMisses(userId: string): string | null {
  const rec = attempts.get(userId);
  const now = Date.now();
  if (!rec || now > rec.until) return null;
  if (rec.n < TRIES) return null;
  const mins = Math.ceil((rec.until - now) / 60_000);
  return `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
}

function noteMiss(userId: string): void {
  const now = Date.now();
  const rec = attempts.get(userId);
  if (!rec || now > rec.until) {
    attempts.set(userId, { n: 1, until: now + WINDOW_MS });
  } else {
    rec.n++;
  }

  /**
   * Swept, because this map only ever grew.
   *
   * One entry per account that has ever mistyped a code, held for the life of
   * the process - which on a long-running server is a slow leak keyed on
   * something an outsider controls. Expired entries are dead weight anyway.
   */
  if (attempts.size > 500) {
    for (const [key, v] of attempts) if (now > v.until) attempts.delete(key);
  }
}

/** ─── POST /vouchers/redeem ── */
router.post("/redeem", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    /**
     * No wallet check here any more.
     *
     * This one asked whether the PROMO treasury was configured, and refused
     * every claim if it was not - including user vouchers, whose money is in
     * escrow and has nothing to do with that wallet. redeemVoucher already
     * picks the right wallet from the voucher itself and checks that one, so
     * asking here could only ever be the wrong question.
     */

    const blocked = tooManyMisses(userId);
    if (blocked) {
      res.status(429).json({ error: blocked });
      return;
    }

    const code = normaliseCode(req.body?.code);
    if (!code || code.length > 64) {
      res.status(400).json({ error: "Type a code first." });
      return;
    }

    const result = await redeemVoucher(userId, code, req.body?.viaScan === true);

    if (!result.ok) {
      noteMiss(userId);
      // The rules travel with the refusal so the app can show which one failed
      // and offer the fix, rather than a dead end.
      res.status(400).json({ error: result.reason, rules: result.rules ?? null });
      return;
    }

    /**
     * Told twice, on purpose: a push they see now and an email they can find
     * later. Fire and forget - a notification that fails must never turn a
     * reward that landed into an error on the screen.
     */
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true },
    });

    /**
     * The code is deliberately absent.
     *
     * A voucher handed out only as a printed QR stays un-shareable exactly as
     * long as nothing hands the code back in readable form. A push that names
     * it is a code on a lock screen, forwardable by anyone who scanned once -
     * which turns a hundred single-use QRs into one public code.
     */
    sendNotification({
      userId,
      type: "transaction",
      title: "Voucher claimed",
      body: `${result.amount} USDC is in your wallet.`,
    }).catch(() => {});

    if (user?.email) {
      // Nor here: an email carrying the code is a code that can be forwarded.
      sendVoucherEmail(user.email, {
        amount: result.amount,
        txHash: result.txHash,
        name: user.firstName ?? null,
      }).catch((e) => console.error("[VOUCHER] email failed:", e?.message));
    }

    res.json({
      claimed: true,
      // Null for a QR-only voucher, so there is nothing to read off the
      // confirmation screen and pass on.
      code: result.showCode ? result.code : null,
      amount: result.amount,
      txHash: result.txHash,
      claimedAt: result.claimedAt,
    });
  } catch (err: any) {
    console.error("[VOUCHER] redeem error:", err?.message);
    res.status(500).json({ error: "Could not claim that. Try again shortly." });
  }
});

/** ─── GET /vouchers/mine — what this person has already claimed ── */
router.get("/mine", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const claims = await prisma.voucherClaim.findMany({
      // A failed claim is not something they got, and showing it on their own
      // list only raises a question the list cannot answer.
      where: { userId: req.user!.userId, status: { in: ["PENDING", "SENT"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        amount: true,
        status: true,
        txHash: true,
        createdAt: true,
        viaScan: true,
        voucher: { select: { code: true, kind: true } },
      },
    });

    res.json({
      claims: claims.map((c) => ({
        // The history is the last place a code could be read back, so both
        // conditions apply here too: a public voucher somebody SCANNED is one
        // they never read, and this list would hand it to them for ever.
        code: c.voucher.kind === "PUBLIC" && !c.viaScan ? c.voucher.code : null,
        amount: Number(c.amount),
        status: c.status,
        txHash: c.txHash,
        claimedAt: c.createdAt,
      })),
    });
  } catch (err: any) {
    console.error("[VOUCHER] mine error:", err?.message);
    res.status(500).json({ error: "Could not load your vouchers." });
  }
});


/* ═══ Vouchers people make ═══════════════════════════════════════ */

/**
 * ─── POST /vouchers/mine/prepare — work out the split, build the transfer ──
 *
 * Nothing is written here and no money moves. It returns the shape of the
 * voucher and a transaction for the person to sign, because the server holds
 * no keys and cannot move anybody's balance itself.
 *
 * Calling it again just replaces the plan - which is what Reshuffle is.
 */
router.post("/mine/prepare", requireAuth, requireActiveSession, requireDynamicWallet, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    if (!isVoucherEscrowConfigured()) {
      return res.status(503).json({ error: "Sending vouchers is not switched on right now." });
    }

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, kycStatus: true, anonMode: true },
    });
    if (!me?.username) {
      return res.status(400).json({ error: "Pick a username before you send a voucher." });
    }
    /**
     * Verified only.
     *
     * Not to gatekeep a nice feature, but because an unverified account is one
     * we cannot name - and a voucher is money leaving one person for several
     * others under a code they chose.
     */
    if (me.kycStatus !== "VERIFIED") {
      return res.status(403).json({ error: "Verify your identity before you can send a voucher." });
    }

    const wallet = await prisma.wallet.findFirst({
      where: { userId, chain: "MOVE" },
      select: { address: true },
    });
    if (!wallet?.address) {
      return res.status(400).json({ error: "Your wallet is not ready yet. Try again in a moment." });
    }

    const b = req.body ?? {};
    const plan = planVoucher({
      userId,
      /**
       * The code is namespaced by the creator, and a voucher code travels
       * further than anything else in this product - it gets pasted into
       * group chats and printed on paper. So an anonymous creator is
       * namespaced by a stable pseudonym instead of their handle.
       *
       * The property that matters is kept: a code still belongs to exactly
       * one account, so nobody can mint MONEYMOVES50. What goes is a
       * recipient being able to read the sender's handle off it.
       */
      username: me.anonMode ? anonCodeHandle(userId) : me.username,
      pot: Number(b.pot),
      winners: Number(b.winners),
      lucky: b.lucky !== false,
      spread: ["even", "mixed", "wild"].includes(b.spread) ? b.spread : "mixed",
      wantedCode: typeof b.code === "string" ? b.code : undefined,
      verifiedOnly: b.verifiedOnly === true,
      perUserClaims: b.perUserClaims,
    });

    // Taken before the transaction is built: a code somebody else holds should
    // cost a round trip, not a signature.
    const clash = await prisma.voucher.findUnique({ where: { code: plan.code }, select: { id: true } });
    if (clash) return res.status(400).json({ error: "You have used that code already. Try another ending." });

    const transaction = await buildFundingTransaction({ fromAddress: wallet.address, amount: plan.pot });
    // Held with the plan, because this exact transaction is the only one the
    // signature coming back will be valid for.
    const prepareId = holdPrepared(plan, { funding: transaction, fundedFrom: wallet.address });

    return res.json({
      prepareId,
      code: plan.code,
      pot: plan.pot,
      expiresAt: plan.expiresAt,
      amounts: [...plan.slices].sort((a, b) => b - a).map(toAmount),
      verifiedOnly: plan.verifiedOnly,
      perUserClaims: plan.perUserClaims,
      /**
       * The signing message, not the raw transaction.
       *
       * These are different things and sending the wrong one is why every
       * funding attempt was refused. A fee-payer transaction is signed over
       * RawTransactionWithData - a domain-separated prefix, the fee payer's
       * address and the transaction - so a signature taken over the bare
       * RawTransaction bytes cannot verify against it, and Shinami says only
       * "Transaction submission failed".
       *
       * Signed on the device; we never see the key that signs it.
       */
      signingMessage: Buffer.from(generateSigningMessageForTransaction(transaction)).toString("hex"),
      limits: LIMITS,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not work that out." });
  }
});

/**
 * ─── POST /vouchers/mine/submit — the signed transfer, then the voucher ──
 *
 * The order is the whole point. The funding is submitted and WAITED FOR, and
 * only once it has confirmed does the voucher exist. Creating it first would
 * leave an ACTIVE voucher with nothing behind it, paying out money nobody put
 * in - and the people claiming would be the ones to discover it.
 */
router.post("/mine/submit", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { prepareId, signature, publicKey } = req.body ?? {};

    const plan = takePrepared(String(prepareId ?? ""), userId);
    if (!plan) {
      return res.status(400).json({ error: "That took too long. Start the voucher again." });
    }
    if (typeof signature !== "string" || typeof publicKey !== "string") {
      return res.status(400).json({ error: "That was not signed." });
    }

    /**
     * The transaction from prepare, never a new one.
     *
     * Rebuilding looks harmless and is not: build.simple reads the sequence
     * number off the chain and stamps a fresh expiry, so the second build is a
     * different transaction with a different hash. The signature was taken
     * over the first one, so submitting the second could only ever fail.
     */
    const funding = plan.funding;
    if (!funding) {
      return res.status(400).json({ error: "That took too long. Start the voucher again." });
    }

    const senderAuth = new AccountAuthenticatorEd25519(
      new Ed25519PublicKey(publicKey),
      new Ed25519Signature(signature),
    );

    let fundingTxHash: string;
    try {
      fundingTxHash = await submitSignedFunding(
        Buffer.from(funding.rawTransaction.bcsToBytes()).toString("hex"),
        Buffer.from(senderAuth.bcsToBytes()).toString("hex"),
      );
    } catch (e: any) {
      console.error("[ESCROW] funding failed:", e?.message);
      return res.status(400).json({
        error: "That transfer did not go through, so nothing was created. Your balance is untouched.",
      });
    }

    /**
     * Past this line the money is already in escrow.
     *
     * Funding is confirmed on chain and the voucher does not exist yet, so
     * anything that stops the row being written leaves the pot sitting in a
     * wallet with nothing pointing at it - no voucher to claim, no refund row
     * for the sweep to find, and nobody to notice but the reconciliation. The
     * commonest way in is the unique code: two prepares with the same ending
     * both pass the check above and the second one loses at insert.
     *
     * So a failure here sends it straight back, to the address that funded it
     * and nowhere else.
     */
    let voucher;
    try {
      voucher = await prisma.voucher.create({
      data: {
        code: plan.code,
        kind: "PUBLIC",
        mode: plan.lucky ? "LUCKY" : "FIXED",
        potAmount: plan.pot,
        rewardAmount: toAmount(Math.round(plan.slices.reduce((a, n) => a + n, 0) / plan.slices.length)),
        totalClaims: plan.slices.length,
        perUserClaims: plan.perUserClaims,
        /**
         * The creator's choice, expressed in the same shape our own vouchers
         * use - so the claim path checks it through checkRules exactly as it
         * checks a promo voucher, and the refusal tells the claimer what to do
         * about it rather than just saying no.
         */
        requirements: plan.verifiedOnly ? [{ kind: "verified" }] : [],
        status: "ACTIVE",
        endsAt: plan.expiresAt,
        createdByUserId: userId,
        fundingTxHash,
        slices: {
          create: plan.slices.map((amount, position) => ({ position, amount: toAmount(amount) })),
        },
      },
        select: { id: true, code: true, endsAt: true },
      });
    } catch (e: any) {
      console.error(`[ESCROW] voucher row failed after funding ${fundingTxHash}:`, e?.message);
      try {
        const back = await sendFromEscrow(plan.fundedFrom!, plan.pot, "refund");
        console.log(`[ESCROW] returned ${plan.pot} USDC to ${plan.fundedFrom}: ${back}`);
        return res.status(400).json({
          error: "That code was taken while you were signing. Your money has been sent back.",
        });
      } catch (back: any) {
        // Both halves failed. Say so loudly - this one needs a person, and the
        // reconciliation is the only other thing that would ever notice.
        console.error(
          `[ESCROW] STRANDED ${plan.pot} USDC from ${plan.fundedFrom} — funding ${fundingTxHash}, refund failed:`,
          back?.message,
        );
        return res.status(500).json({
          error: "Something went wrong after your transfer. We can see it and will put it right.",
        });
      }
    }

    /**
     * And into their history, as money that left rather than money that vanished.
     *
     * Creating a voucher debits the creator's Movement balance on chain, and
     * without a row here the only trace is the balance being smaller than it
     * was - which is exactly the shape of a bug to whoever is looking at it.
     * The claim side already writes one of these, so the pair reconciles.
     *
     * Best effort: the voucher exists and the money has moved, and a missing
     * history row is a reporting problem rather than a reason to tell somebody
     * their voucher failed.
     */
    await prisma.transaction
      .create({
        data: {
          userId,
          type: "TRANSFER_OUT",
          asset: "USDCx",
          chain: "MOVE",
          amount: plan.pot,
          fee: 0,
          status: "COMPLETED",
          reference: `VOUCHER-OUT-${voucher.id}`,
          metadata: {
            source: "voucher",
            kind: "created",
            voucherCode: voucher.code,
            voucherId: voucher.id,
            winners: plan.slices.length,
            mode: plan.lucky ? "LUCKY" : "FIXED",
            endsAt: plan.expiresAt,
            txHash: fundingTxHash,
            address: plan.fundedFrom,
          },
        },
      })
      .catch((e: any) =>
        console.error(`[ESCROW] history row failed for voucher ${voucher.code}:`, e?.message),
      );

    return res.json({ voucher, fundingTxHash });
  } catch (err: any) {
    console.error("[ESCROW] submit failed:", err?.message);
    return res.status(400).json({ error: err?.message || "Could not create that." });
  }
});

/** ─── GET /vouchers/mine/sent — the ones they made ── */
router.get("/mine/sent", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const rows = await prisma.voucher.findMany({
      where: { createdByUserId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, code: true, mode: true, status: true, potAmount: true,
        totalClaims: true, endsAt: true, createdAt: true,
        refundState: true, refundAmount: true, refundTxHash: true,
        claims: {
          where: { status: { in: ["PENDING", "SENT"] } },
          orderBy: { createdAt: "desc" },
          select: {
            amount: true,
            createdAt: true,
            user: { select: { username: true, firstName: true, anonMode: true } },
          },
        },
      },
    });

    return res.json({
      vouchers: rows.map((v) => {
        const taken = v.claims.reduce((sum, c) => sum + Number(c.amount), 0);
        const pot = Number(v.potAmount ?? 0);
        return {
          id: v.id,
          code: v.code,
          lucky: v.mode === "LUCKY",
          status: v.status,
          pot,
          claimed: v.claims.length,
          of: v.totalClaims ?? v.claims.length,
          takenAmount: taken,
          leftAmount: Number((pot - taken).toFixed(2)),
          endsAt: v.endsAt,
          createdAt: v.createdAt,
          refund: { state: v.refundState, amount: Number(v.refundAmount ?? 0), txHash: v.refundTxHash },
          // Claiming a stranger's voucher should not out you either, so the
          // same rule applies in this direction.
          who: v.claims.map((c) => ({
            username: c.user ? publicNameOf(c.user) : null,
            amount: Number(c.amount),
            at: c.createdAt,
          })),
        };
      }),
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not load those." });
  }
});

/**
 * ─── POST /vouchers/mine/:id/end — stop it, and bring the refund forward ──
 *
 * The only money-back control anybody has, and it takes no amount and no
 * address: it ends a voucher the caller owns and lets the sweep do the rest,
 * which sends to the creator's wallet on file. There is nothing here to point
 * somewhere else.
 */
router.post("/mine/:id/end", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const mine = await prisma.voucher.findFirst({
      where: { id: String(req.params.id), createdByUserId: userId },
      select: { id: true, status: true },
    });
    if (!mine) return res.status(404).json({ error: "No such voucher." });
    if (mine.status === "ENDED") return res.status(400).json({ error: "That one has already ended." });

    await prisma.voucher.update({ where: { id: mine.id }, data: { status: "ENDED" } });

    // Straight away rather than at the next sweep: somebody who just pressed
    // this is watching for the money.
    sweepRefunds().catch((e) => console.error("[ESCROW] sweep after end failed:", e?.message));

    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not end that." });
  }
});

export default router;
