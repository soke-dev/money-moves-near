/**
 * business-links.ts — a business on Money Moves Business asking to be paid
 * into a person's Money Moves account, and the person's answer.
 *
 * Two doors:
 *
 *  - Internal, for Money Moves Business only, signed with BUSINESS_LINK_SECRET:
 *    ask by username, read where requests stand, end one. Without the secret
 *    set, or with the wrong one, these answer 404 as if they weren't there.
 *
 *  - The person's own: see requests, approve, decline, unlink. Nothing is
 *    linked until they approve here, and they can end it any time.
 *
 * Asked by username, answered by account: once approved the business is told
 * the account id, so a later username change breaks nothing. A request no one
 * answers lapses after a week.
 */
import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { sendNotification } from "../lib/push";
import { requireAuth, requireActiveSession } from "../middleware/auth";

const PENDING_FOR_MS = 7 * 86_400_000;
/** At most this many unanswered requests to one person at a time - nobody can bury someone in them. */
const MAX_PENDING_PER_USER = 5;

const lapsed = (l: { status: string; createdAt: Date }) => l.status === "PENDING" && Date.now() - l.createdAt.getTime() > PENDING_FOR_MS;

/** How a link reads to the business: the account id only once approved. */
function forBusiness(l: { id: string; status: string; userId: string; createdAt: Date }, username: string | null) {
  const status = lapsed(l) ? "DECLINED" : l.status;
  return { id: l.id, status, accountId: status === "APPROVED" ? l.userId : null, username };
}

// ─── Internal: Money Moves Business ──────────────────────────────────────────

export const internalRouter = Router();

/** The shared secret, compared in constant time. Anything else looks like a missing route. */
export function signedByBusiness(req: Request, res: Response, next: NextFunction) {
  const want = env.BUSINESS_LINK_SECRET;
  const got = String(req.headers["x-business-link-secret"] || "");
  const ok = !!want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

internalRouter.use(signedByBusiness);

const askInput = z.object({
  businessId: z.string().min(1).max(64),
  businessName: z.string().trim().min(1).max(160),
  businessLogo: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only").optional(),
  merchantId: z.string().min(1).max(32),
  username: z.string().trim().min(1).max(40),
  requestedBy: z.string().max(64).optional(),
});

internalRouter.post("/", async (req: Request, res: Response) => {
  const parsed = askInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const b = parsed.data;
  const username = b.username.replace(/^@/, "");
  const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: "insensitive" } }, select: { id: true, username: true } });
  if (!user) {
    res.status(404).json({ code: "no_user", error: "No account with that username" });
    return;
  }
  // The same business asking again gets the request it already has.
  const open = await prisma.businessLink.findFirst({ where: { userId: user.id, businessId: b.businessId, status: { in: ["PENDING", "APPROVED"] } }, orderBy: { createdAt: "desc" } });
  if (open && !lapsed(open)) {
    res.json({ link: forBusiness(open, user.username) });
    return;
  }
  const waiting = await prisma.businessLink.count({ where: { userId: user.id, status: "PENDING", createdAt: { gt: new Date(Date.now() - PENDING_FOR_MS) } } });
  if (waiting >= MAX_PENDING_PER_USER) {
    res.status(429).json({ code: "too_many", error: "Too many requests waiting for this person" });
    return;
  }
  const link = await prisma.businessLink.create({ data: { userId: user.id, businessId: b.businessId, businessName: b.businessName, businessLogo: b.businessLogo || null, merchantId: b.merchantId } });
  await sendNotification({
    userId: user.id,
    type: "business_link",
    title: `Link ${b.businessName}?`,
    body: `${b.businessName} wants its payments to land in your Money Moves account. Open Money Moves to approve or decline - nothing is linked until you do.`,
  }).catch((e) => console.error("[BUSINESS LINK] notify failed:", e));
  res.status(201).json({ link: forBusiness(link, user.username) });
});

/**
 * A settlement from Money Moves Business into this person's account, final on
 * chain. Filed as a settlement from the business - by its transaction, so the
 * wallet's own deposit check, which may have seen the coins land first, ends up
 * with the same one row, relabelled rather than doubled.
 */
const settledInput = z.object({
  txHash: z.string().min(10).max(200),
  chain: z.enum(["MOVE", "SOL", "ARC", "MONAD"]),
  asset: z.enum(["USDC", "USDCx"]),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/),
  businessName: z.string().trim().min(1).max(160),
  reference: z.string().min(1).max(64),
  nairaAmount: z.number().nonnegative().optional(),
});

internalRouter.post("/:id/settlement", async (req: Request, res: Response) => {
  const parsed = settledInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const b = parsed.data;
  const link = await prisma.businessLink.findUnique({ where: { id: String(req.params.id) } });
  if (!link) {
    res.status(404).json({ code: "not_found", error: "No such link" });
    return;
  }
  const settlement = { source: "business_settlement", businessName: b.businessName, settlementRef: b.reference, txHash: b.txHash, ...(b.nairaAmount != null ? { nairaAmount: b.nairaAmount } : {}) };
  const seen = await prisma.transaction.findFirst({ where: { userId: link.userId, metadata: { path: ["txHash"], equals: b.txHash } } });
  if (seen) {
    await prisma.transaction.update({ where: { id: seen.id }, data: { metadata: { ...((seen.metadata as object) ?? {}), ...settlement } } });
    res.json({ ok: true });
    return;
  }
  await prisma.transaction.create({
    data: {
      userId: link.userId,
      type: "DEPOSIT",
      asset: b.asset as any,
      chain: b.chain as any,
      amount: Number(b.amount),
      fee: 0,
      status: "COMPLETED",
      reference: `BSET-${b.reference}`,
      metadata: settlement,
    },
  });
  await sendNotification({
    userId: link.userId,
    type: "transaction",
    title: `Settlement from ${b.businessName}`,
    body: `${Number(b.amount).toFixed(2)} ${b.asset === "USDCx" ? "USDC" : b.asset} from ${b.businessName} landed in your account.`,
  }).catch(() => {});
  res.status(201).json({ ok: true });
});

/** Where several requests stand, in one call - Money Moves Business checks its waiting ones together. */
internalRouter.post("/status", async (req: Request, res: Response) => {
  const ids = z.array(z.string().min(1).max(64)).max(200).safeParse(req.body?.ids);
  if (!ids.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const links = await prisma.businessLink.findMany({ where: { id: { in: ids.data } }, include: { user: { select: { username: true } } } });
  res.json({ links: links.map((l) => forBusiness(l, l.user.username)) });
});

internalRouter.get("/:id", async (req: Request, res: Response) => {
  const l = await prisma.businessLink.findUnique({ where: { id: String(req.params.id) }, include: { user: { select: { username: true } } } });
  if (!l) {
    res.status(404).json({ code: "not_found", error: "No such request" });
    return;
  }
  res.json({ link: forBusiness(l, l.user.username) });
});

/**
 * Where a business pays a linked account: the person's USDC address on the
 * chain the business settles on. Only for an approved link - the person said
 * yes to being paid by this business. EVM chains share one address, so a
 * missing Monad or Arc row falls back to the person's other EVM address.
 */
const SETTLE_CHAINS: Record<string, string[]> = {
  MOVEMENT: ["MOVE"],
  SOLANA: ["SOL"],
  ARC: ["ARC", "BASE", "MONAD", "BEP20", "ARB"],
  MONAD: ["MONAD", "BASE", "ARC", "BEP20", "ARB"],
  // Stellar: only once the person has opened it in the app - an address that isn't open can't receive.
  STELLAR: ["STELLAR"],
};
internalRouter.get("/:id/address", async (req: Request, res: Response) => {
  const order = SETTLE_CHAINS[String(req.query.chain ?? "")];
  if (!order) {
    res.status(400).json({ code: "bad_chain", error: "Unknown chain" });
    return;
  }
  const l = await prisma.businessLink.findUnique({ where: { id: String(req.params.id) } });
  if (!l || lapsed(l) || l.status !== "APPROVED") {
    res.status(404).json({ code: "not_linked", error: "Not an approved link" });
    return;
  }
  const wallets = await prisma.wallet.findMany({ where: { userId: l.userId, chain: { in: order as any }, address: { not: null } }, select: { chain: true, address: true } });
  const hit = order.map((c) => wallets.find((w) => w.chain === c && w.address)).find(Boolean);
  if (!hit?.address) {
    res.status(404).json({ code: "no_address", error: "No address on that chain" });
    return;
  }
  res.json({ address: hit.address });
});

/** Ended by the business: the person is told, and it leaves their list. */
internalRouter.post("/:id/revoke", async (req: Request, res: Response) => {
  const l = await prisma.businessLink.findUnique({ where: { id: String(req.params.id) } });
  if (!l) {
    res.status(404).json({ code: "not_found", error: "No such request" });
    return;
  }
  if (l.status === "PENDING" || l.status === "APPROVED") {
    await prisma.businessLink.update({ where: { id: l.id }, data: { status: "REVOKED", revokedBy: "business", endedAt: new Date() } });
    if (l.status === "APPROVED") {
      await sendNotification({
        userId: l.userId,
        type: "business_link",
        title: `${l.businessName} unlinked`,
        body: `${l.businessName} no longer sends payments to your Money Moves account.`,
      }).catch(() => {});
    }
  }
  res.json({ ok: true });
});

// ─── The person's own ────────────────────────────────────────────────────────

export const userRouter = Router();
userRouter.use(requireAuth, requireActiveSession);

const mine = (l: { id: string; businessName: string; businessLogo: string | null; merchantId: string; status: string; createdAt: Date; decidedAt: Date | null }) => ({
  id: l.id,
  businessName: l.businessName,
  businessLogo: l.businessLogo,
  merchantId: l.merchantId,
  status: l.status,
  createdAt: l.createdAt,
  decidedAt: l.decidedAt,
});

/** Requests waiting for an answer, and businesses linked now. */
userRouter.get("/", async (req: Request, res: Response) => {
  const links = await prisma.businessLink.findMany({
    where: { userId: req.user!.userId, status: { in: ["PENDING", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ links: links.filter((l) => !lapsed(l)).map(mine) });
});

async function ownPending(req: Request, res: Response) {
  const l = await prisma.businessLink.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!l || l.status !== "PENDING" || lapsed(l)) {
    res.status(404).json({ error: "That request isn't waiting any more." });
    return null;
  }
  return l;
}

userRouter.post("/:id/approve", async (req: Request, res: Response) => {
  const l = await ownPending(req, res);
  if (!l) return;
  const done = await prisma.businessLink.update({ where: { id: l.id }, data: { status: "APPROVED", decidedAt: new Date() } });
  res.json({ link: mine(done) });
});

userRouter.post("/:id/decline", async (req: Request, res: Response) => {
  const l = await ownPending(req, res);
  if (!l) return;
  const done = await prisma.businessLink.update({ where: { id: l.id }, data: { status: "DECLINED", decidedAt: new Date() } });
  res.json({ link: mine(done) });
});

/** Ended by the person: the business sees it unlinked at its next check. */
userRouter.post("/:id/unlink", async (req: Request, res: Response) => {
  const l = await prisma.businessLink.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId, status: "APPROVED" } });
  if (!l) {
    res.status(404).json({ error: "That business isn't linked any more." });
    return;
  }
  await prisma.businessLink.update({ where: { id: l.id }, data: { status: "REVOKED", revokedBy: "user", endedAt: new Date() } });
  res.json({ ok: true });
});
