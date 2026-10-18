/**
 * business-payments.ts — a checkout on Money Moves Business, paid from this app.
 *
 * The business opens it here when a customer picks "Money Moves app" at
 * checkout, and shows its code as a QR and a link that opens the app. Only
 * whoever scans or opens it gets it - nobody can send a payment to someone else
 * by typing their username, which only invited people to approve what they
 * didn't recognise. The person approves it and sends
 * USDC or USDT from their own wallet, through the same prepare-and-sign flow as
 * any send, to the address the business gave for that chain. Nothing moves
 * without their signature, and the amount and address can't be changed on the
 * way - prepare holds them to what the business asked.
 *
 * Two doors, as with business links: internal for Money Moves Business (signed
 * with BUSINESS_LINK_SECRET), and the person's own.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import type { BusinessPayment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { signedByBusiness } from "./business-links";
import { env } from "../config/env";

/** The chains a business can be paid on from here, and the coins each carries. USDC on Movement is the native one, kept as USDCx. */
const PAY_CHAINS: Record<string, string[]> = {
  MOVE: ["USDCx", "USDT"],
  SOL: ["USDC", "USDT"],
  BASE: ["USDC", "USDT"],
  BEP20: ["USDC", "USDT"],
  ARC: ["USDC"],
  MONAD: ["USDC", "USDT"],
};
const EVM = new Set(["BASE", "BEP20", "ARC", "MONAD"]);

const lapsed = (p: Pick<BusinessPayment, "status" | "expiresAt">) => p.status === "PENDING" && p.expiresAt.getTime() <= Date.now();
const statusOf = (p: BusinessPayment) => (lapsed(p) ? "EXPIRED" : p.status);

const sameAddress = (chain: string, a: string, b: string) => (EVM.has(chain) ? a.toLowerCase() === b.toLowerCase() : a === b);

function addressesOf(p: BusinessPayment): Record<string, string> {
  const raw = (p.addresses ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [chain, a] of Object.entries(raw)) if (PAY_CHAINS[chain] && typeof a === "string" && a) out[chain] = a;
  return out;
}

/** A code for the checkout's QR: short enough to scan easily, long enough not to guess. */
const newCode = () => crypto.randomBytes(12).toString("base64url");

// ─── Internal: Money Moves Business ──────────────────────────────────────────

export const internalRouter = Router();
internalRouter.use(signedByBusiness);

/** How it reads to the business. */
async function forBusiness(p: BusinessPayment) {
  const user = p.userId ? await prisma.user.findUnique({ where: { id: p.userId }, select: { username: true } }) : null;
  return {
    id: p.id,
    code: p.code,
    status: statusOf(p),
    username: user?.username ?? null,
    chain: p.paidChain,
    asset: p.paidAsset,
    txHash: p.txHash,
    paidAt: p.paidAt,
  };
}

const openInput = z.object({
  businessId: z.string().min(1).max(64),
  businessName: z.string().trim().min(1).max(160),
  businessLogo: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only").optional(),
  paymentRef: z.string().min(1).max(64),
  title: z.string().trim().max(160).optional(),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/),
  priceLabel: z.string().trim().max(40).optional(),
  addresses: z.record(z.string().max(128)),
  expiresAt: z.string().datetime(),
});

/** Opened when a customer picks the app. The same payment asking again gets the one it has. */
internalRouter.post("/", async (req: Request, res: Response) => {
  const parsed = openInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const b = parsed.data;
  const addresses = Object.fromEntries(Object.entries(b.addresses).filter(([chain, a]) => PAY_CHAINS[chain] && a));
  if (!Object.keys(addresses).length || !(Number(b.amount) > 0)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const existing = await prisma.businessPayment.findUnique({ where: { paymentRef: b.paymentRef } });
  if (existing) {
    res.json({ payment: await forBusiness(existing) });
    return;
  }
  const row = await prisma.businessPayment.create({
    data: {
      code: newCode(),
      businessId: b.businessId,
      businessName: b.businessName,
      businessLogo: b.businessLogo || null,
      paymentRef: b.paymentRef,
      title: b.title || null,
      amount: b.amount,
      priceLabel: b.priceLabel || null,
      addresses,
      expiresAt: new Date(b.expiresAt),
    },
  });
  res.status(201).json({ payment: await forBusiness(row) });
});

/** Where several stand, in one call - the business checks its open ones together. */
internalRouter.post("/status", async (req: Request, res: Response) => {
  const ids = z.array(z.string().min(1).max(64)).max(200).safeParse(req.body?.ids);
  if (!ids.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const rows = await prisma.businessPayment.findMany({ where: { id: { in: ids.data } } });
  res.json({ payments: await Promise.all(rows.map(forBusiness)) });
});

/** The payment closed on the business's side: it leaves the person's list. One already being sent is left to finish. */
internalRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  await prisma.businessPayment.updateMany({ where: { id: String(req.params.id), status: { in: ["PENDING", "DECLINED"] } }, data: { status: "CANCELLED" } });
  const p = await prisma.businessPayment.findUnique({ where: { id: String(req.params.id) } });
  res.json({ payment: p ? await forBusiness(p) : null });
});

// ─── The person's own ────────────────────────────────────────────────────────

export const userRouter = Router();
userRouter.use(requireAuth, requireActiveSession);

/** How it reads in the app: who, how much, and where each chain pays to. */
const mine = (p: BusinessPayment) => ({
  id: p.id,
  businessName: p.businessName,
  businessLogo: p.businessLogo,
  /** The business's own reference for it, as on its receipt. */
  reference: p.paymentRef,
  title: p.title,
  amount: Number(p.amount).toFixed(6).replace(/0{1,4}$/, ""),
  priceLabel: p.priceLabel,
  pay: Object.entries(addressesOf(p)).map(([chain, address]) => ({ chain, address, assets: PAY_CHAINS[chain] })),
  status: statusOf(p),
  txHash: p.txHash,
  paidChain: p.paidChain,
  paidAsset: p.paidAsset,
  paidAt: p.paidAt,
  expiresAt: p.expiresAt,
  createdAt: p.createdAt,
});

/** Waiting to be paid. */
userRouter.get("/", async (req: Request, res: Response) => {
  const rows = await prisma.businessPayment.findMany({
    where: { userId: req.user!.userId, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ payments: rows.map(mine) });
});

/** A code scanned at a checkout: it becomes theirs to pay. */
userRouter.post("/claim", async (req: Request, res: Response) => {
  const code = z.string().trim().min(8).max(64).safeParse(req.body?.code);
  const p = code.success ? await prisma.businessPayment.findUnique({ where: { code: code.data } }) : null;
  if (!p) {
    res.status(404).json({ error: "We can't find that payment. Ask for a fresh code." });
    return;
  }
  if (p.status === "PAID") {
    res.status(409).json({ error: "This has been paid already." });
    return;
  }
  if (lapsed(p) || !["PENDING", "DECLINED"].includes(p.status)) {
    res.status(409).json({ error: "This payment has closed. Ask for a fresh code." });
    return;
  }
  const row = p.userId === req.user!.userId && p.status === "PENDING" ? p : await prisma.businessPayment.update({ where: { id: p.id }, data: { userId: req.user!.userId, status: "PENDING" } });
  res.json({ payment: mine(row) });
});

// ─── A checkout scanned with the app ─────────────────────────────────────────
//
// A poster, a link's QR or an invoice's, scanned with the app's own scanner:
// instead of the web page, the app asks Money Moves Business what the checkout
// is, then opens an app payment on it for this person and claims it for them -
// and the pay screen shows it like any other. A phone's own camera still opens
// the web checkout. Business makes every check a web checkout makes.

const CHECKOUT_KINDS = ["link", "outlet", "invoice"] as const;
const checkoutRef = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

async function askBusiness(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; data: any }> {
  if (!env.BUSINESS_LINK_SECRET) return { status: 503, data: { error: "Paying businesses isn't switched on yet." } };
  try {
    const r = await fetch(`${env.BUSINESS_API_URL.replace(/\/$/, "")}/api/internal/app-checkouts${path}`, {
      method,
      headers: { "content-type": "application/json", "x-business-link-secret": env.BUSINESS_LINK_SECRET },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { status: 502, data: { error: "We couldn't reach the business just now. Try again in a moment." } };
  }
}

function checkoutPath(req: Request, res: Response): string | null {
  const kind = String(req.params.kind);
  const ref = checkoutRef.safeParse(req.params.ref);
  if (!CHECKOUT_KINDS.includes(kind as (typeof CHECKOUT_KINDS)[number]) || !ref.success) {
    res.status(404).json({ error: "That isn't a checkout we know." });
    return null;
  }
  return `/${kind}/${encodeURIComponent(ref.data)}`;
}

/** Opened per person: a poster scanned again and again shouldn't open payments without end. */
const OPEN_WINDOW_MS = 10 * 60_000;
const OPEN_MAX = 10;
const opened = new Map<string, number[]>();
function tooManyOpens(userId: string): boolean {
  const now = Date.now();
  const recent = (opened.get(userId) ?? []).filter((t) => now - t < OPEN_WINDOW_MS);
  if (recent.length >= OPEN_MAX) {
    opened.set(userId, recent);
    return true;
  }
  recent.push(now);
  opened.set(userId, recent);
  return false;
}

/** What it is: who, what for, a set price or a range to type in - or why the app can't take it. */
userRouter.get("/checkout/:kind/:ref", async (req: Request, res: Response) => {
  const path = checkoutPath(req, res);
  if (!path) return;
  const r = await askBusiness("GET", path);
  res.status(r.status).json(r.data ?? { error: "Something went wrong. Try again in a moment." });
});

/** Opens the payment for this person and hands it straight to the pay screen. */
userRouter.post("/checkout/:kind/:ref/open", async (req: Request, res: Response) => {
  const path = checkoutPath(req, res);
  if (!path) return;
  const b = z.object({ amount: z.number().positive().max(100_000_000).optional(), currency: z.enum(["NGN", "USD"]).optional() }).safeParse(req.body ?? {});
  if (!b.success) {
    res.status(400).json({ error: "That amount doesn't look right." });
    return;
  }
  const userId = req.user!.userId;
  if (tooManyOpens(userId)) {
    res.status(429).json({ error: "You've opened a lot of checkouts just now. Try again in a few minutes." });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, lastName: true, username: true } });
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || (user?.username ? `@${user.username}` : undefined);
  const r = await askBusiness("POST", `${path}/open`, { ...b.data, ...(user?.email ? { email: user.email } : {}), ...(name ? { name: name.slice(0, 80) } : {}) });
  const code = typeof r.data?.code === "string" ? r.data.code : null;
  if (r.status >= 400 || !code) {
    res.status(r.status >= 400 ? r.status : 502).json({ error: r.data?.error || "We couldn't open this checkout just now. Try again in a moment.", code: r.data?.code });
    return;
  }
  const p = await prisma.businessPayment.findUnique({ where: { code } });
  if (!p || lapsed(p) || !["PENDING", "DECLINED"].includes(p.status)) {
    res.status(409).json({ error: "This payment has closed. Scan the code again." });
    return;
  }
  // Someone else's already (an invoice another person is paying): not this person's to take.
  if (p.userId && p.userId !== userId && p.status === "PENDING") {
    res.status(409).json({ error: "Someone else is paying this already." });
    return;
  }
  const row = p.userId === userId && p.status === "PENDING" ? p : await prisma.businessPayment.update({ where: { id: p.id }, data: { userId, status: "PENDING" } });
  res.status(201).json({ payment: mine(row) });
});

userRouter.get("/:id", async (req: Request, res: Response) => {
  const p = await prisma.businessPayment.findFirst({ where: { id: String(req.params.id), userId: req.user!.userId } });
  if (!p) {
    res.status(404).json({ error: "We can't find that payment." });
    return;
  }
  res.json({ payment: mine(p) });
});

userRouter.post("/:id/decline", async (req: Request, res: Response) => {
  const done = await prisma.businessPayment.updateMany({ where: { id: String(req.params.id), userId: req.user!.userId, status: "PENDING" }, data: { status: "DECLINED" } });
  if (!done.count) {
    res.status(404).json({ error: "That payment isn't waiting any more." });
    return;
  }
  res.json({ ok: true });
});

// ─── Paying it: held to what the business asked ─────────────────────────────

/**
 * Checked by withdraw/prepare when a send is paying a business: theirs to pay,
 * still open, and exactly the amount and address the business asked for on a
 * chain and coin it takes. Anything else is refused before a thing is built.
 */
export async function checkPayable(
  userId: string,
  id: string,
  send: { asset: string; chain: string; amount: number; address: string },
): Promise<{ ok: true; payment: BusinessPayment } | { ok: false; status: number; error: string }> {
  const p = await prisma.businessPayment.findFirst({ where: { id, userId } });
  if (!p) return { ok: false, status: 404, error: "We can't find that payment." };
  if (p.status !== "PENDING" || lapsed(p)) return { ok: false, status: 409, error: p.status === "PAID" ? "This has been paid already." : "This payment isn't waiting any more." };
  const to = addressesOf(p)[send.chain];
  if (!to || !PAY_CHAINS[send.chain]?.includes(send.asset)) return { ok: false, status: 400, error: `${p.businessName} doesn't take ${send.asset} on that network.` };
  if (!sameAddress(send.chain, to, send.address)) return { ok: false, status: 400, error: "That isn't where this payment goes." };
  if (Math.abs(send.amount - Number(p.amount)) > 1e-7) return { ok: false, status: 400, error: "That isn't the amount of this payment." };
  return { ok: true, payment: p };
}

/** Taken by the send that is paying it, at submit - so two sends can't both pay it. */
export async function claimForSend(id: string, userId: string, transactionId: string): Promise<boolean> {
  const done = await prisma.businessPayment.updateMany({
    where: { id, userId, status: "PENDING", expiresAt: { gt: new Date() } },
    data: { status: "PAYING", transactionId },
  });
  return done.count === 1;
}

export async function markPaid(id: string, paid: { chain: string; asset: string; txHash: string }) {
  return prisma.businessPayment.update({ where: { id }, data: { status: "PAID", paidChain: paid.chain, paidAsset: paid.asset, txHash: paid.txHash, paidAt: new Date() } });
}

/**
 * The send failed. Back to waiting if nothing reached the chain; if it was
 * broadcast and only the confirming failed, it stays PAYING with the hash for
 * our team to look up - it may well have landed.
 */
export async function releaseAfterFailure(id: string, txHash?: string | null) {
  if (txHash) await prisma.businessPayment.updateMany({ where: { id, status: "PAYING" }, data: { txHash } });
  else await prisma.businessPayment.updateMany({ where: { id, status: "PAYING" }, data: { status: "PENDING", transactionId: null } });
}
