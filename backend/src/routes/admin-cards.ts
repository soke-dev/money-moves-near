/**
 * The console's Cards page.
 *
 * GET  /admin/cards/overview             figures, the float, what needs a look, settings
 * GET  /admin/cards/list?status=&q=      every card, with its holder
 * GET  /admin/cards/topups?status=       every top up
 * GET  /admin/cards/payments             card payments across recent cards, newest first
 * GET  /admin/cards/person/:userId       one person: balance, limits, cards, top ups
 * GET  /admin/cards/card/:id/activity    one card's payments
 * PUT  /admin/cards/settings             limits, fees, on/off          (action password)
 * PUT  /admin/cards/person/:userId       own limits, block or unblock  (action password)
 * POST /admin/cards/card/:id/freeze|unfreeze|delete                    (action password)
 * POST /admin/cards/topup/:id/retry      a failed top up, tried again  (action password)
 *
 * Card numbers and CVVs never come here. Balances are Nuvion's, read live.
 */
import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { requireAdmin } from "./admin";
import { checkActionPassword } from "../lib/action-password";
import * as nuvion from "../lib/nuvion";
import { syncTopups } from "../lib/card-topups";
import { cardSettings, saveCardSettings, validate, RANGES, limitsFor, type CardSettings, type PersonLimits } from "../lib/card-settings";

const router = Router();
router.use(requireAdmin);

const by = (req: Request) => String((req as any).adminEmail || "admin");
const usd = (cents: number) => Math.round(cents) / 100;

async function people(ids: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, email: true, username: true, firstName: true, lastName: true },
  });
  return new Map(users.map((u) => [u.id, { ...u, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null }]));
}

async function gate(req: Request, res: Response, what: string): Promise<boolean> {
  const g = await checkActionPassword(by(req), req.body?.password, what);
  if (!g.ok) res.status(g.status).json({ error: g.error });
  return g.ok;
}

// ─── Overview ────────────────────────────────────────────────
router.get("/overview", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const day = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [settings, accounts, blocked, byStatus, byKind, topupsByStatus, credited24, credited7, creditedAll, cardFees, floatCents] =
      await Promise.all([
        cardSettings(true),
        prisma.cardAccount.count(),
        prisma.cardAccount.count({ where: { blockedAt: { not: null } } }),
        prisma.card.groupBy({ by: ["status"], _count: true }),
        prisma.card.groupBy({ by: ["kind"], where: { deletedAt: null }, _count: true }),
        prisma.cardTopup.groupBy({ by: ["status"], _count: true, _sum: { creditCents: true, amount: true } }),
        prisma.cardTopup.aggregate({ where: { status: "CREDITED", createdAt: { gte: day } }, _sum: { creditCents: true }, _count: true }),
        prisma.cardTopup.aggregate({ where: { status: "CREDITED", createdAt: { gte: week } }, _sum: { creditCents: true }, _count: true }),
        prisma.cardTopup.aggregate({ where: { status: "CREDITED" }, _sum: { creditCents: true, amount: true }, _count: true }),
        prisma.card.aggregate({ _sum: { feeCents: true } }),
        env.NUVION_FLOAT_ACCOUNT_ID ? nuvion.accountAvailableCents(env.NUVION_FLOAT_ACCOUNT_ID).catch(() => null) : Promise.resolve(null),
      ]);

    const status = (s: string) => byStatus.find((r) => r.status === s)?._count ?? 0;
    const tStatus = (s: string) => topupsByStatus.find((r) => r.status === s);
    const waitingCents = (tStatus("PENDING")?._sum.creditCents ?? 0) + (tStatus("PROCESSING")?._sum.creditCents ?? 0);
    const topupFees = Math.max(0, Number(creditedAll._sum.amount ?? 0) * 100 - (creditedAll._sum.creditCents ?? 0));

    const waitingReasons = await prisma.cardTopup.groupBy({
      by: ["reason"],
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      _count: true,
    });

    const attention: string[] = [];
    if (!nuvion.cardsConfigured()) attention.push("Cards are switched off on the server (CARDS_ENABLED or a Nuvion setting is missing).");
    if (settings.paused) attention.push("Cards are paused from this page. Nobody can top up or make a card.");
    if (floatCents === null) attention.push("The float's balance couldn't be read from Nuvion.");
    else if (floatCents < waitingCents) attention.push(`The float holds $${usd(floatCents).toFixed(2)} but $${usd(waitingCents).toFixed(2)} of top ups are waiting. Add money to the float.`);
    else if (floatCents < 2000) attention.push(`The float is low: $${usd(floatCents).toFixed(2)}.`);
    const failed = tStatus("FAILED")?._count ?? 0;
    if (failed) attention.push(`${failed} top up${failed === 1 ? "" : "s"} failed and need a person.`);

    res.json({
      settings,
      ranges: RANGES,
      configured: nuvion.cardsConfigured(),
      depositAddress: env.NUVION_DEPOSIT_SOL || null,
      floatBalance: floatCents === null ? null : usd(floatCents),
      attention,
      figures: {
        people: accounts,
        blockedPeople: blocked,
        cards: { active: status("active"), frozen: status("blocked"), used: status("deactivated"), deleted: status("deleted"), fraud: status("fraud") },
        kinds: { everyday: byKind.find((k) => k.kind === "VIRTUAL")?._count ?? 0, oneTime: byKind.find((k) => k.kind === "DISPOSABLE")?._count ?? 0 },
        topups: {
          credited: { count: creditedAll._count, usd: usd(creditedAll._sum.creditCents ?? 0) },
          last24h: { count: credited24._count, usd: usd(credited24._sum.creditCents ?? 0) },
          last7d: { count: credited7._count, usd: usd(credited7._sum.creditCents ?? 0) },
          waiting: { count: (tStatus("PENDING")?._count ?? 0) + (tStatus("PROCESSING")?._count ?? 0), usd: usd(waitingCents) },
          failed: { count: failed, usd: usd(tStatus("FAILED")?._sum.creditCents ?? 0) },
        },
        earned: { topupFees: usd(topupFees), cardFees: usd(cardFees._sum.feeCents ?? 0) },
      },
      waitingReasons: waitingReasons.map((r) => ({ reason: r.reason || "not tried yet", count: r._count })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Lists ───────────────────────────────────────────────────
router.get("/list", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = String(req.query.status || "");
    const q = String(req.query.q || "").trim();
    let userIds: string[] | undefined;
    if (q) {
      const found = await prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true },
        take: 50,
      });
      userIds = found.map((u) => u.id);
    }
    const cards = await prisma.card.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(userIds ? { OR: [{ userId: { in: userIds } }, { last4: q }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const who = await people(cards.map((c) => c.userId));
    res.json({
      cards: cards.map((c) => ({
        id: c.id,
        userId: c.userId,
        person: who.get(c.userId) || null,
        kind: c.kind === "DISPOSABLE" ? "one-time" : "everyday",
        name: c.name,
        last4: c.last4,
        status: c.status,
        fee: usd(c.feeCents),
        adminAction: c.adminAction,
        createdAt: c.createdAt,
        deletedAt: c.deletedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/topups", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = String(req.query.status || "");
    const topups = await prisma.cardTopup.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const [who, sends] = await Promise.all([
      people(topups.map((t) => t.userId)),
      prisma.transaction.findMany({ where: { id: { in: topups.map((t) => t.transactionId) } }, select: { id: true, metadata: true } }),
    ]);
    const hash = new Map(sends.map((s) => [s.id, ((s.metadata || {}) as any).txHash as string | undefined]));
    res.json({
      topups: topups.map((t) => ({
        id: t.id,
        userId: t.userId,
        person: who.get(t.userId) || null,
        asset: t.asset,
        amount: Number(t.amount),
        credit: usd(t.creditCents),
        fee: Math.max(0, Number(t.amount) - usd(t.creditCents)),
        status: t.status,
        reason: t.reason,
        txHash: hash.get(t.transactionId) || null,
        nuvionTransferId: t.nuvionTransferId,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

function shape(p: nuvion.NuvionCardPayment) {
  const reversal = p.payment_type === "card-debit-reversal" || p.payment_type === "card-credit-refund";
  const where = p.recipient?.address;
  return {
    id: p._id,
    merchant: p.recipient?.name || p.narration || "Card payment",
    narration: p.narration || null,
    place: where ? [where.city, where.state, where.country].filter(Boolean).join(", ") : null,
    amount: p.amount / 100,
    fee: (p.applicable_fee || 0) / 100,
    direction: p.type === "inflow" ? "in" : "out",
    kind: reversal ? "reversal" : p.payment_type === "card-debit-recoup" ? "recoup" : "payment",
    status: p.status,
    reason: p.status_reason || null,
    at: p.created,
  };
}

// Across cards, so the console sees spending as it happens. Nuvion has no
// all-cards feed, so this reads the most recent live cards one by one.
router.get("/payments", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cards = await prisma.card.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const who = await people(cards.map((c) => c.userId));
    const lists = await Promise.all(
      cards.map(async (c) => {
        try {
          const ps = await nuvion.cardPayments(c.nuvionCardId, 20);
          return ps.map((p) => ({ ...shape(p), cardId: c.id, cardName: c.name, last4: c.last4, userId: c.userId, person: who.get(c.userId) || null }));
        } catch {
          return [];
        }
      }),
    );
    const all = lists.flat().sort((a, b) => b.at - a.at).slice(0, 300);
    res.json({ payments: all, cardsRead: cards.length });
  } catch (err) {
    next(err);
  }
});

router.get("/card/:id/activity", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const card = await prisma.card.findUnique({ where: { id: String(req.params.id) } });
    if (!card) return res.status(404).json({ error: "No such card" });
    if (card.deletedAt) return res.json({ payments: [], note: "Deleted cards' history can't be read from Nuvion." });
    const ps = await nuvion.cardPayments(card.nuvionCardId, 100);
    res.json({ payments: ps.map(shape) });
  } catch (err) {
    next(err);
  }
});

router.get("/person/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const [who, account, cards, topups, limits] = await Promise.all([
      people([userId]),
      prisma.cardAccount.findUnique({ where: { userId } }),
      prisma.card.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
      prisma.cardTopup.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
      limitsFor(userId),
    ]);
    const balance = account ? await nuvion.accountAvailableCents(account.nuvionAccountId).catch(() => null) : null;
    res.json({
      person: who.get(userId) || null,
      account: account
        ? {
            nuvionAccountId: account.nuvionAccountId,
            accountNumber: account.nuvionBan,
            balance: balance === null ? null : usd(balance),
            blockedAt: account.blockedAt,
            blockedBy: account.blockedBy,
            openedAt: account.createdAt,
          }
        : null,
      limits: {
        effective: { maxTopup: limits.maxTopup, dailyTopup: limits.dailyTopup, maxCards: limits.maxCards },
        own: limits.own,
      },
      cards: cards.map((c) => ({
        id: c.id,
        kind: c.kind === "DISPOSABLE" ? "one-time" : "everyday",
        name: c.name,
        last4: c.last4,
        status: c.status,
        adminAction: c.adminAction,
        createdAt: c.createdAt,
      })),
      topups: topups.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        asset: t.asset,
        credit: usd(t.creditCents),
        status: t.status,
        reason: t.reason,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Changes (action password) ──────────────────────────────
router.put("/settings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body || {};
    const numbers: Partial<CardSettings> = {};
    for (const k of Object.keys(RANGES) as (keyof CardSettings)[]) {
      if (body[k] !== undefined && body[k] !== "") numbers[k] = Number(body[k]);
    }
    const bad = validate(numbers);
    if (bad) return res.status(400).json({ error: bad });
    if (numbers.minTopup !== undefined && numbers.maxTopup !== undefined && numbers.minTopup > numbers.maxTopup) {
      return res.status(400).json({ error: "The smallest top up can't be more than the largest." });
    }
    if (!(await gate(req, res, "card settings"))) return;
    const before = await cardSettings(true);
    const after = await saveCardSettings({ ...numbers, ...(typeof body.paused === "boolean" ? { paused: body.paused } : {}) }, by(req));
    console.log(`[ADMIN] card settings changed by ${by(req)}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    res.json({ settings: after });
  } catch (err) {
    next(err);
  }
});

router.put("/person/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const account = await prisma.cardAccount.findUnique({ where: { userId } });
    if (!account) return res.status(404).json({ error: "This person hasn't opened a card account yet." });
    const body = req.body || {};
    const own: PersonLimits = {};
    for (const k of ["maxTopup", "dailyTopup", "maxCards"] as const) {
      const v = body.limits?.[k];
      if (v === undefined || v === null || v === "") continue;
      own[k] = Number(v);
    }
    const bad = validate(own);
    if (bad) return res.status(400).json({ error: bad });
    if (!(await gate(req, res, "card person"))) return;
    const data: any = {};
    if (body.limits !== undefined) data.limits = Object.keys(own).length ? own : null;
    if (typeof body.blocked === "boolean") {
      data.blockedAt = body.blocked ? new Date() : null;
      data.blockedBy = body.blocked ? by(req) : null;
    }
    await prisma.cardAccount.update({ where: { userId }, data });
    console.log(`[ADMIN] card limits for ${userId} changed by ${by(req)}: ${JSON.stringify(data)}`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

for (const action of ["freeze", "unfreeze", "delete"] as const) {
  router.post(`/card/:id/${action}`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const card = await prisma.card.findUnique({ where: { id: String(req.params.id) } });
      if (!card || card.deletedAt) return res.status(404).json({ error: "No such card, or it's deleted." });
      if (!(await gate(req, res, `card ${action}`))) return;
      if (action === "freeze") {
        await nuvion.freezeCard(card.nuvionCardId);
        await prisma.card.update({ where: { id: card.id }, data: { status: "blocked", adminAction: "frozen" } });
      } else if (action === "unfreeze") {
        await nuvion.unfreezeCard(card.nuvionCardId);
        await prisma.card.update({ where: { id: card.id }, data: { status: "active", adminAction: null } });
      } else {
        try {
          await nuvion.deleteCard(card.nuvionCardId);
        } catch (err) {
          if (!(err instanceof nuvion.NuvionError && err.status === 404)) throw err;
        }
        await prisma.card.update({ where: { id: card.id }, data: { status: "deleted", deletedAt: new Date(), adminAction: "deleted" } });
      }
      console.log(`[ADMIN] card ${card.id} (${card.userId}) ${action} by ${by(req)}`);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof nuvion.NuvionError) return res.status(502).json({ error: `Nuvion said: ${err.message}` });
      next(err);
    }
  });
}

router.post("/topup/:id/retry", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const t = await prisma.cardTopup.findUnique({ where: { id: String(req.params.id) } });
    if (!t) return res.status(404).json({ error: "No such top up" });
    if (t.status === "CREDITED") return res.status(400).json({ error: "Already on the card." });
    if (!(await gate(req, res, "card top up retry"))) return;
    // Back to waiting. The reference check stops a second payment if the first actually went.
    await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "PENDING", reason: `retried by ${by(req)}` } });
    await syncTopups(t.userId);
    const after = await prisma.cardTopup.findUnique({ where: { id: t.id } });
    res.json({ status: after?.status, reason: after?.reason });
  } catch (err) {
    next(err);
  }
});

export default router;
