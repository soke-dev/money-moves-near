/**
 * USD cards. Each card has its own balance (its own USD account at Nuvion).
 *
 * GET    /cards                     everything the Cards screen needs, each card with its live balance
 * GET    /cards/access              whether this account sees Cards at all
 * POST   /cards/topup               says where to send, for one card or for a new one (made once it lands)
 * POST   /cards/topup/sync          credits sends that have landed
 * POST   /cards                     refused: a card is made by funding it
 * GET    /cards/:id/details         number, CVV, expiry, billing (never stored, never logged)
 * POST   /cards/:id/freeze|unfreeze
 * PATCH  /cards/:id                 rename
 * POST   /cards/:id/withdraw        card balance back to the person's own wallet, as USDC on Solana
 * DELETE /cards/:id                 only once the card is empty
 * GET    /cards/:id/activity
 *
 * Verified, upgraded accounts only. Balances are always Nuvion's live figures.
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
import { IssueError, e164, cardCostCents, liveCardCount } from "../lib/card-issue";
import { ensureUserAccount, moneyOf, accountForNewCard, cardBalanceCents } from "../lib/card-accounts";
import { recordCardEvent } from "../lib/card-ledger";
import { syncWithdrawals } from "../lib/card-withdrawals";

const router = Router();

const SOON = "Cards are opening soon.";

function sendError(res: Response, err: any, fallback: string) {
  if (err instanceof IssueError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
    return;
  }
  if (err instanceof nuvion.NuvionError) {
    if (err.status === 400 && err.type === "error_card_creation_fee_required") {
      res.status(402).json({ error: "Add money to cover the card creation fee first.", code: "FEE_REQUIRED" });
      return;
    }
    res.status(502).json({ error: "Cards aren't answering right now. Try again in a minute." });
    return;
  }
  console.error(`[CARDS] ${fallback}:`, err?.message || err);
  res.status(500).json({ error: fallback });
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** While cards are tried out with a few accounts: is this one of them? "*" means everyone. */
async function allowedUser(userId: string): Promise<boolean> {
  if (env.CARDS_ALLOWED_USERS.includes("*")) return true;
  if (!env.CARDS_ALLOWED_USERS.length) return false;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  return !!u?.username && env.CARDS_ALLOWED_USERS.includes(u.username.toLowerCase());
}

// ═══ GET /cards/access ═══════════════════════════════════════
router.get("/access", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json({ visible: nuvion.cardsConfigured() && (await allowedUser(req.user!.userId)) });
  } catch {
    res.json({ visible: false });
  }
});

/** Why this person can't use cards yet, or null when they can. */
async function blocker(userId: string): Promise<{ code: string; error: string } | null> {
  if (!nuvion.cardsConfigured()) return { code: "SOON", error: SOON };
  if (!(await allowedUser(userId))) return { code: "SOON", error: SOON };
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
    await syncWithdrawals(userId).catch((err) => console.warn(`[CARDS] withdrawal sync failed: ${err?.message}`));

    const account = await prisma.cardAccount.findUnique({ where: { userId } });
    const limits = await limitsFor(userId);
    const [cards, topups, issuerFee] = await Promise.all([
      prisma.card.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: "desc" } }),
      prisma.cardTopup.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10 }),
      account ? nuvion.cardCreationFeeCents(account.nuvionAccountId).catch(() => null) : Promise.resolve(0),
    ]);
    const balances = await Promise.all(cards.map((c) => cardBalanceCents(c).catch(() => null)));

    res.json({
      enabled: true,
      blocked: block,
      // What a new card costs: Nuvion's fee (if any) plus ours.
      cardFee: issuerFee === null ? limits.cardFee : issuerFee / 100 + limits.cardFee,
      minTopup: limits.minTopup,
      maxTopup: limits.maxTopup,
      dailyTopup: limits.dailyTopup,
      maxCards: limits.maxCards,
      maxCardBalance: limits.maxCardBalance,
      topupFeeBps: limits.topupFeeBps,
      pendingCard: account?.pendingCard
        ? {
            kind: (account.pendingCard as any).kind,
            name: (account.pendingCard as any).name,
            stuck: !!account.pendingCardError && !account.pendingCardAt,
          }
        : null,
      cards: cards.map((c, i) => ({
        id: c.id,
        kind: c.kind === "DISPOSABLE" ? "one-time" : "everyday",
        name: c.name,
        last4: c.last4,
        status: c.status,
        balance: balances[i] === null ? null : balances[i]! / 100,
        createdAt: c.createdAt,
      })),
      topups: topups.map((t) => ({
        id: t.id,
        target: t.target,
        asset: t.asset,
        amount: Number(t.amount),
        credit: (t.creditCents - t.cardFeeCents) / 100,
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
  /** The card being topped up. */
  cardId: z.string().optional(),
  /** Or a new card, made by itself once this lands, with the fee kept back from it. */
  card: z
    .object({
      kind: z.enum(["everyday", "one-time"]),
      name: z.string().trim().min(1).max(40),
    })
    .optional(),
});

router.post("/topup", requireAuth, requireActiveSession, validate(topupSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const block = await blocker(userId);
    if (block) {
      res.status(403).json(block);
      return;
    }
    const { amount, asset, cardId, card } = req.body as z.infer<typeof topupSchema>;
    if (!card && !cardId) {
      res.status(400).json({ error: "Pick the card to top up." });
      return;
    }
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
    await ensureUserAccount(userId);
    const credit = creditCentsFor(amount, limits.topupFeeBps);
    const maxCents = Math.round(limits.maxCardBalance * 100);
    let cardFee = 0;
    let target: string;

    if (card) {
      /**
       * One new card at a time. A second would replace the first one's request
       * while its money is already on the way, leaving that money in an account
       * no card uses (or two cards sharing one balance).
       */
      const acctNow = await prisma.cardAccount.findUnique({ where: { userId }, select: { pendingCard: true, pendingCardAt: true, pendingCardError: true } });
      const waitingCard = acctNow?.pendingCard as { name?: string; feeTopupId?: string } | null;
      if (waitingCard) {
        const stuck = !!acctNow!.pendingCardError && !acctNow!.pendingCardAt;
        const inFlight =
          stuck ||
          !!waitingCard.feeTopupId ||
          (await prisma.cardTopup.count({ where: { userId, target: "new", status: { in: ["PENDING", "PROCESSING", "CREDITED"] } } })) > 0;
        if (inFlight) {
          res.status(409).json({
            error: stuck
              ? `Your ${waitingCard.name || "last"} card needs a quick check by us before you can add another. Contact support.`
              : `Your ${waitingCard.name || "new"} card is still being made. Give it a minute, then try again.`,
            code: "CARD_IN_PROGRESS",
          });
          return;
        }
      }
      if ((await liveCardCount(userId)) >= limits.maxCards) {
        res.status(400).json({ error: `You can hold up to ${limits.maxCards} card${limits.maxCards === 1 ? "" : "s"}. Delete one to add another.` });
        return;
      }
      // The new card's own account, opened now; the fee is kept back from this top up.
      const acct = await accountForNewCard(userId, card.name);
      const [cost, balance] = await Promise.all([
        cardCostCents(userId, acct.accountId),
        nuvion.accountAvailableCents(acct.accountId),
      ]);
      cardFee = cost.total;
      if (balance + credit < cost.total) {
        res.status(400).json({ error: `Add at least ${money(cost.total - balance)} to cover the card creation fee.` });
        return;
      }
      if (balance + credit - cost.total > maxCents) {
        res.status(400).json({ error: `A card can hold up to ${money(maxCents)}. Lower the amount.` });
        return;
      }
      target = "new";
      await prisma.cardAccount.update({
        where: { userId },
        data: {
          pendingCard: { ...card, accountId: acct.accountId, paymentDetailId: acct.paymentDetailId },
          pendingCardAt: new Date(),
          pendingCardError: null,
        },
      });
    } else {
      const c = await ownCard(userId, cardId!);
      if (!c || !["active", "blocked"].includes(c.status)) {
        res.status(400).json({ error: "That card can't be topped up." });
        return;
      }
      const balance = await cardBalanceCents(c);
      if (balance + credit > maxCents) {
        const room = Math.max(0, maxCents - balance);
        res.status(400).json({
          error:
            room > 0
              ? `A card can hold up to ${money(maxCents)}. You can add about ${money(room)} more to this one.`
              : `This card is at its ${money(maxCents)} limit.`,
          code: "CARD_FULL",
        });
        return;
      }
      target = c.id;
    }

    // The send that lands next is credited to this card.
    await prisma.cardAccount.update({ where: { userId }, data: { topupTarget: target, topupTargetAt: new Date() } });
    res.json({
      address: env.NUVION_DEPOSIT_SOL,
      chain: "SOL",
      asset,
      amount,
      credit: credit / 100,
      cardFee: cardFee / 100,
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
// A card is made by funding it (POST /cards/topup with `card`), so each card
// starts with its own money and never spends another card's.
router.post("/", requireAuth, requireActiveSession, async (_req: Request, res: Response) => {
  res.status(402).json({ error: "Add money to your new card to create it.", code: "FEE_REQUIRED" });
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

// ═══ PATCH /cards/:id (rename) ═══════════════════════════════
// The name is ours alone: Nuvion has no rename, and it never shows on the card.
const renameSchema = z.object({ name: z.string().trim().min(1).max(40) });

router.patch("/:id", requireAuth, requireActiveSession, validate(renameSchema), async (req: Request, res: Response) => {
  try {
    const card = await ownCard(req.user!.userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const { name } = req.body as z.infer<typeof renameSchema>;
    await prisma.card.update({ where: { id: card.id }, data: { name } });
    res.json({ name });
  } catch (err) {
    sendError(res, err, "Couldn't rename the card");
  }
});

// ═══ POST /cards/:id/withdraw ════════════════════════════════
const withdrawSchema = z.object({
  /** Dollars. Or `max` for everything on the card. */
  amount: z.number().positive().max(100_000).optional(),
  max: z.boolean().optional(),
});

router.post("/:id/withdraw", requireAuth, requireActiveSession, validate(withdrawSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const card = await ownCard(userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    const { amount, max } = req.body as z.infer<typeof withdrawSchema>;
    if (!max && !amount) {
      res.status(400).json({ error: "Enter an amount." });
      return;
    }
    // Only ever to the person's own upgraded wallet.
    if (!(await walletUpgraded(userId))) {
      res.status(403).json({ code: "UPGRADE", error: UPGRADE_FIRST });
      return;
    }
    const { startWithdrawal } = await import("../lib/card-withdrawals");
    const out = await startWithdrawal({ userId, card, cents: max ? null : Math.round(amount! * 100) });
    res.json(out);
  } catch (err: any) {
    if (err?.userMessage) {
      res.status(400).json({ error: err.userMessage });
      return;
    }
    sendError(res, err, "Couldn't withdraw the money");
  }
});

// ═══ DELETE /cards/:id ═══════════════════════════════════════
router.delete("/:id", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const card = await ownCard(req.user!.userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    // Money still on its way in or out would land on a card that's gone.
    const [incoming, outgoing] = await Promise.all([
      prisma.cardTopup.count({ where: { userId: card.userId, target: card.id, status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.cardWithdrawal.count({ where: { userId: card.userId, cardId: card.id, status: "PENDING" } }),
    ]);
    if (incoming || outgoing) {
      res.status(409).json({
        error: incoming ? "A top up to this card is still on its way. Delete it once that lands." : "A withdrawal from this card is still on its way. Delete it once that finishes.",
        code: "IN_FLIGHT",
      });
      return;
    }
    // Its money is its own: move it out first, or it would be stranded.
    const balance = await cardBalanceCents(card).catch(() => null);
    if (balance === null) {
      res.status(502).json({ error: "Couldn't check the card balance. Try again in a minute." });
      return;
    }
    if (balance > 0) {
      res.status(409).json({
        error: `This card still has ${money(balance)} on it. Withdraw it to your wallet first.`,
        code: "HAS_BALANCE",
        balance: balance / 100,
      });
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
    const userId = req.user!.userId;
    const card = await ownCard(userId, String(req.params.id));
    if (!card) {
      res.status(404).json({ error: "Card not found" });
      return;
    }
    // This card's own top ups. An older card on the first account also has the ones from before cards were split.
    const first = await prisma.cardAccount.findUnique({ where: { userId }, select: { nuvionAccountId: true } });
    const onFirst = !card.nuvionAccountId || card.nuvionAccountId === first?.nuvionAccountId;
    const [payments, topups, outs] = await Promise.all([
      nuvion.cardPayments(card.nuvionCardId, 50),
      prisma.cardTopup.findMany({
        where: { userId, OR: [{ target: card.id }, ...(onFirst ? [{ target: null }] : [])] },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.cardWithdrawal.findMany({ where: { userId, cardId: card.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);

    const spending = payments.map((p) => {
      const where = p.recipient?.address;
      const reversal = p.payment_type === "card-debit-reversal" || p.payment_type === "card-credit-refund";
      return {
        id: p._id,
        merchant: reversal
          ? (p.narration || "").replace(/^REVERSAL \| Payment to /i, "").replace(/ for [\d.]+ \w+$/, "") || "Reversal"
          : p.recipient?.name || p.narration || "Card payment",
        place: where ? [where.city, where.country].filter(Boolean).join(", ") : null,
        note: p.status === "failed" ? p.status_reason || null : null,
        amount: p.amount / 100,
        fee: (p.applicable_fee || 0) / 100,
        direction: p.type === "inflow" ? "in" : "out",
        kind: reversal ? "reversal" : "payment",
        status: p.status === "successful" ? "done" : p.status === "failed" ? "declined" : "pending",
        at: p.created,
      };
    });

    const added = topups.map((t) => {
      const sent = Number(t.amount);
      const fee = Math.max(0, Math.round(sent * 100) - t.creditCents) / 100;
      const parts = [`${sent} ${t.asset} from your wallet`];
      if (fee > 0) parts.push(`$${fee.toFixed(2)} top up fee`);
      if (t.cardFeeCents > 0) parts.push(`$${(t.cardFeeCents / 100).toFixed(2)} card creation fee`);
      return {
        id: `topup-${t.id}`,
        merchant: "Top up",
        place: null,
        note: parts.join(" · "),
        amount: (t.creditCents - t.cardFeeCents) / 100,
        fee,
        direction: "in",
        kind: "topup",
        status: t.status === "CREDITED" ? "done" : t.status === "FAILED" ? "held" : "pending",
        at: t.createdAt.getTime(),
      };
    });

    const moved = outs.map((w) => ({
      id: `out-${w.id}`,
      merchant: "Withdrawn to your wallet",
      place: null,
      note:
        w.status === "FAILED"
          ? "Didn't go through. Nothing left your card."
          : `USDC on Solana${w.feeCents > 0 ? ` · $${(w.feeCents / 100).toFixed(2)} network fee` : ""}`,
      amount: w.amountCents / 100,
      fee: w.feeCents / 100,
      direction: "out",
      kind: "withdraw",
      // A failed withdrawal moved nothing, so it reads like a decline, not as money held.
      status: w.status === "SENT" ? "done" : w.status === "FAILED" ? "declined" : "pending",
      at: w.createdAt.getTime(),
    }));

    const made = {
      id: `created-${card.id}`,
      merchant: card.kind === "DISPOSABLE" ? "One-time card created" : "Card created",
      place: null,
      note: card.feeCents > 0 ? "Card creation fee, paid from your top up" : null,
      amount: card.feeCents / 100,
      fee: 0,
      direction: "out",
      kind: "created",
      status: "done",
      at: card.createdAt.getTime(),
    };

    res.json({ items: [...spending, ...added, ...moved, made].sort((a, b) => b.at - a.at) });
  } catch (err) {
    sendError(res, err, "Couldn't load the card activity");
  }
});

export default router;
