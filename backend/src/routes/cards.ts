/**
 * USD cards.
 *
 * GET    /cards                     everything the Cards screen needs
 * POST   /cards/topup               opens the card account if needed, says where to send
 * POST   /cards/topup/sync          credits sends that have landed
 * POST   /cards                     issues a card
 * GET    /cards/:id/details         number, CVV, expiry, billing (never stored, never logged)
 * POST   /cards/:id/freeze|unfreeze
 * DELETE /cards/:id
 * GET    /cards/:id/activity
 *
 * Verified, upgraded accounts only. Card balance is always Nuvion's live
 * figure for the person's account, never one we keep.
 */
import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { walletUpgraded, UPGRADE_FIRST } from "../lib/upgraded";
import * as nuvion from "../lib/nuvion";
import { syncTopups, creditCentsFor } from "../lib/card-topups";
import { cardSettings, limitsFor } from "../lib/card-settings";
import { chargeCardFee, refundCardFee } from "../lib/card-fees";
import { randomUUID } from "crypto";

const router = Router();

const SOON = "Cards are opening soon.";

function sendError(res: Response, err: any, fallback: string) {
  if (err instanceof nuvion.NuvionError) {
    if (err.status === 400 && err.type === "error_card_creation_fee_required") {
      res.status(402).json({ error: "Top up your card balance to cover the card creation fee first.", code: "FEE_REQUIRED" });
      return;
    }
    res.status(502).json({ error: "Cards aren't answering right now. Try again in a minute." });
    return;
  }
  console.error(`[CARDS] ${fallback}:`, err?.message || err);
  res.status(500).json({ error: fallback });
}

/** Why this person can't use cards yet, or null when they can. */
async function blocker(userId: string): Promise<{ code: string; error: string } | null> {
  if (!nuvion.cardsConfigured()) return { code: "SOON", error: SOON };
  if ((await cardSettings()).paused) return { code: "PAUSED", error: "Cards are paused for a moment. Your balance is safe, so try again soon." };
  const acct = await prisma.cardAccount.findUnique({ where: { userId }, select: { blockedAt: true } });
  if (acct?.blockedAt) return { code: "BLOCKED", error: "Cards aren't available on your account. Contact support." };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycStatus: true, firstName: true, lastName: true, walletType: true, phone: true },
  });
  if (!user) return { code: "NO_USER", error: "Account not found" };
  if (user.kycStatus !== "VERIFIED") return { code: "KYC", error: "Verify your identity to get a card." };
  if (user.walletType !== "EMBEDDED") return { code: "UPGRADE", error: UPGRADE_FIRST };
  if (!user.firstName || !user.lastName) return { code: "NAME", error: "Your name is missing from your account. Contact support." };
  if (!e164(user.phone)) return { code: "PHONE", error: "Add your phone number in Profile to get a card." };
  return null;
}

/** A Nigerian number in international form, or null. The card issuer needs one for every holder. */
function e164(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  if (/^234\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+234${d.slice(1)}`;
  return null;
}

/** The person's card account, opened on first use. */
async function ensureAccount(userId: string) {
  const existing = await prisma.cardAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true } });
  const displayName = `MM card ${userId}`;
  // A create can succeed and lose its answer; the name is unique, so look first.
  const account =
    (await nuvion.findAccountByName(displayName)) ||
    (await nuvion.createUsdAccount(displayName, { user_id: userId, purpose: "card" }));
  const ban = account.nuvion_ban || (await nuvion.getAccount(account.id)).nuvion_ban;
  if (!ban) throw new Error("Card account has no account number yet");
  const paymentDetailId = await nuvion.addBookDetail(ban, `${user.firstName} ${user.lastName}`.trim());
  return prisma.cardAccount.upsert({
    where: { userId },
    create: { userId, nuvionAccountId: account.id, nuvionBan: ban, paymentDetailId },
    update: {},
  });
}

async function ownCard(userId: string, id: string) {
  return prisma.card.findFirst({ where: { id, userId, deletedAt: null } });
}

// ═══ GET /cards ══════════════════════════════════════════════
router.get("/", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const block = await blocker(userId);
    if (block?.code === "SOON") {
      res.json({ enabled: false, message: SOON });
      return;
    }
    await syncTopups(userId).catch((err) => console.warn(`[CARDS] sync on open failed: ${err?.message}`));

    const account = await prisma.cardAccount.findUnique({ where: { userId } });
    const limits = await limitsFor(userId);
    const [cards, topups, balanceCents, feeCents] = await Promise.all([
      prisma.card.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
      prisma.cardTopup.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      account ? nuvion.accountAvailableCents(account.nuvionAccountId).catch(() => null) : Promise.resolve(0),
      account ? nuvion.cardCreationFeeCents(account.nuvionAccountId).catch(() => null) : Promise.resolve(null),
    ]);

    res.json({
      enabled: true,
      blocked: block,
      balance: balanceCents === null ? null : balanceCents / 100,
      // Theirs and ours together: what a new card costs the person.
      cardFee: feeCents === null ? (account ? null : limits.cardFee) : feeCents / 100 + limits.cardFee,
      minTopup: limits.minTopup,
      maxTopup: limits.maxTopup,
      dailyTopup: limits.dailyTopup,
      maxCards: limits.maxCards,
      topupFeeBps: limits.topupFeeBps,
      cards: cards.map((c) => ({
        id: c.id,
        kind: c.kind === "DISPOSABLE" ? "one-time" : "everyday",
        name: c.name,
        last4: c.last4,
        status: c.status,
        createdAt: c.createdAt,
      })),
      topups: topups.map((t) => ({
        id: t.id,
        asset: t.asset,
        amount: Number(t.amount),
        credit: t.creditCents / 100,
        // Shown as "on its way" until it lands; failures are ours to sort out by hand.
        status: t.status === "CREDITED" ? "done" : t.status === "FAILED" ? "held" : "pending",
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    sendError(res, err, "Couldn't load your cards");
  }
});

// ═══ POST /cards/topup ═══════════════════════════════════════
const topupSchema = z.object({
  amount: z.number().positive().max(10_000),
  asset: z.enum(["USDC", "USDT"]).default("USDC"),
});

router.post("/topup", requireAuth, requireActiveSession, validate(topupSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const block = await blocker(userId);
    if (block) {
      res.status(403).json(block);
      return;
    }
    const { amount, asset } = req.body as z.infer<typeof topupSchema>;
    const limits = await limitsFor(userId);
    if (amount < limits.minTopup) {
      res.status(400).json({ error: `The smallest top up is $${limits.minTopup}.` });
      return;
    }
    if (amount > limits.maxTopup) {
      res.status(400).json({ error: `The most you can top up at once is $${limits.maxTopup.toLocaleString("en-US")}.` });
      return;
    }
    // Everything opened in the last 24 hours that hasn't failed counts.
    const day = await prisma.cardTopup.aggregate({
      where: { userId, status: { not: "FAILED" }, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { amount: true },
    });
    const used = Number(day._sum.amount ?? 0);
    if (used + amount > limits.dailyTopup) {
      const left = Math.max(0, limits.dailyTopup - used);
      res.status(400).json({
        error:
          left > 0
            ? `You can top up $${left.toFixed(2)} more today.`
            : `You've reached today's top up limit of $${limits.dailyTopup.toLocaleString("en-US")}.`,
      });
      return;
    }
    await ensureAccount(userId);
    res.json({
      address: env.NUVION_DEPOSIT_SOL,
      chain: "SOL",
      asset,
      amount,
      credit: creditCentsFor(amount, limits.topupFeeBps) / 100,
    });
  } catch (err) {
    sendError(res, err, "Couldn't start the top up");
  }
});

// ═══ POST /cards/topup/sync ══════════════════════════════════
router.post("/topup/sync", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    await syncTopups(req.user!.userId);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, "Couldn't check your top up");
  }
});

// ═══ POST /cards ═════════════════════════════════════════════
const createSchema = z.object({
  kind: z.enum(["everyday", "one-time"]),
  name: z.string().trim().min(1).max(40),
});

router.post("/", requireAuth, requireActiveSession, validate(createSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const block = await blocker(userId);
    if (block) {
      res.status(403).json(block);
      return;
    }
    if (!(await walletUpgraded(userId))) {
      res.status(403).json({ code: "UPGRADE", error: UPGRADE_FIRST });
      return;
    }
    const { kind, name } = req.body as z.infer<typeof createSchema>;
    const limits = await limitsFor(userId);
    const live = await prisma.card.count({ where: { userId, deletedAt: null, status: { in: ["active", "blocked"] } } });
    if (live >= limits.maxCards) {
      res.status(400).json({ error: `You can hold up to ${limits.maxCards} card${limits.maxCards === 1 ? "" : "s"}. Delete one to add another.` });
      return;
    }

    const account = await prisma.cardAccount.findUnique({ where: { userId } });
    if (!account) {
      res.status(402).json({ error: "Top up your card balance to cover the card creation fee first.", code: "FEE_REQUIRED" });
      return;
    }
    // Nuvion takes its fee from the account and we take ours; check both first so the person hears why.
    const ourFee = Math.round(limits.cardFee * 100);
    const [issuerFee, balance] = await Promise.all([
      nuvion.cardCreationFeeCents(account.nuvionAccountId),
      nuvion.accountAvailableCents(account.nuvionAccountId),
    ]);
    const fee = issuerFee + ourFee;
    if (balance < fee) {
      res.status(402).json({
        error: `Top up at least $${((fee - balance) / 100).toFixed(2)} to cover the card creation fee first.`,
        code: "FEE_REQUIRED",
        fee: fee / 100,
      });
      return;
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, phone: true },
    });
    // Our fee first; given back if the card then doesn't appear.
    const feeRef = randomUUID();
    let feeTransferId: string | null = null;
    if (ourFee > 0) feeTransferId = await chargeCardFee(account.nuvionAccountId, ourFee, feeRef);
    // Create is not idempotent at Nuvion: one attempt per tap, never retried here.
    const made = await nuvion
      .createCard({
        kind: kind === "one-time" ? "disposable" : "virtual",
        accountId: account.nuvionAccountId,
        name,
        holder: {
          first_name: user.firstName!,
          last_name: user.lastName!,
          email: user.email,
          phone_number: e164(user.phone)!,
        },
      })
      .catch(async (err) => {
        if (feeTransferId) {
          await refundCardFee(account.paymentDetailId, ourFee, feeRef).catch((e) =>
            console.error(`[CARDS] card fee ${feeRef} for ${userId} not returned after a failed create: ${e?.message}`),
          );
        }
        throw err;
      });
    let last4: string | null = null;
    try {
      last4 = (await nuvion.cardDetails(made.id)).number.slice(-4);
    } catch {
      /* shown as •••• until the next read */
    }
    const card = await prisma.card.create({
      data: {
        userId,
        nuvionCardId: made.id,
        kind: kind === "one-time" ? "DISPOSABLE" : "VIRTUAL",
        name,
        last4,
        status: made.status || "active",
        feeCents: ourFee,
        feeTransferId,
      },
    });
    console.log(`[CARDS] ${userId} got a ${kind} card ${card.id}`);
    res.status(201).json({ id: card.id });
  } catch (err) {
    sendError(res, err, "Couldn't create the card");
  }
});

// ═══ GET /cards/:id/details ══════════════════════════════════
router.get("/:id/details", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const card = await ownCard(userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const d = await nuvion.cardDetails(card.nuvionCardId);
    if (d.status !== card.status || (!card.last4 && d.number)) {
      await prisma.card.update({ where: { id: card.id }, data: { status: d.status, last4: d.number?.slice(-4) || card.last4 } });
    }
    res.set("Cache-Control", "no-store");
    res.json({
      number: d.number,
      cvv: d.cvv,
      expiry: `${d.expiration_month}/${d.expiration_year}`,
      name: [d.first_name, d.last_name].filter(Boolean).join(" ").toUpperCase(),
      billing: d.billing || null,
      status: d.status,
    });
  } catch (err) {
    sendError(res, err, "Couldn't show the card details");
  }
});

// ═══ POST /cards/:id/freeze | unfreeze ═══════════════════════
for (const action of ["freeze", "unfreeze"] as const) {
  router.post(`/:id/${action}`, requireAuth, requireActiveSession, async (req: Request, res: Response) => {
    try {
      const card = await ownCard(req.user!.userId, String(req.params.id));
      if (!card) {
        res.status(404).json({ error: "Card not found" });
        return;
      }
      if (card.status === "deactivated") {
        res.status(400).json({ error: "This one-time card has been used and is closed." });
        return;
      }
      // Frozen by us from the console: only the console unfreezes it.
      if (action === "unfreeze" && card.adminAction === "frozen") {
        res.status(403).json({ error: "We've paused this card. Contact support to turn it back on." });
        return;
      }
      if (action === "freeze") await nuvion.freezeCard(card.nuvionCardId);
      else await nuvion.unfreezeCard(card.nuvionCardId);
      const status = action === "freeze" ? "blocked" : "active";
      await prisma.card.update({ where: { id: card.id }, data: { status } });
      res.json({ status });
    } catch (err) {
      sendError(res, err, `Couldn't ${action} the card`);
    }
  });
}

// ═══ DELETE /cards/:id ═══════════════════════════════════════
router.delete("/:id", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const card = await ownCard(req.user!.userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    try {
      await nuvion.deleteCard(card.nuvionCardId);
    } catch (err) {
      // Already gone at Nuvion: finish the delete on our side.
      if (!(err instanceof nuvion.NuvionError && err.status === 404)) throw err;
    }
    await prisma.card.update({ where: { id: card.id }, data: { deletedAt: new Date(), status: "deleted" } });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err, "Couldn't delete the card");
  }
});

// ═══ GET /cards/:id/activity ═════════════════════════════════
router.get("/:id/activity", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const card = await ownCard(req.user!.userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const payments = await nuvion.cardPayments(card.nuvionCardId, 50);
    res.json({
      items: payments.map((p) => {
        const where = p.recipient?.address;
        const reversal = p.payment_type === "card-debit-reversal" || p.payment_type === "card-credit-refund";
        return {
          id: p._id,
          merchant: reversal
            ? (p.narration || "").replace(/^REVERSAL \| Payment to /i, "").replace(/ for [\d.]+ \w+$/, "") || "Reversal"
            : p.recipient?.name || p.narration || "Card payment",
          place: where ? [where.city, where.country].filter(Boolean).join(", ") : null,
          amount: p.amount / 100,
          fee: (p.applicable_fee || 0) / 100,
          direction: p.type === "inflow" ? "in" : "out",
          kind: reversal ? "reversal" : "payment",
          // new = in flight, failed = declined.
          status: p.status === "successful" ? "done" : p.status === "failed" ? "declined" : "pending",
          at: p.created,
        };
      }),
    });
  } catch (err) {
    sendError(res, err, "Couldn't load the card activity");
  }
});

export default router;
