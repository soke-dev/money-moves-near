/**
 * The customer's side: no sign-in, just a link - a payment link, an invoice
 * from its email, or an outlet's counter QR. All three answer in the same
 * shape (a "link" with its price and ways to pay), so one checkout page serves
 * them; an invoice adds who it's billed to and what for.
 *
 * A customer opens a link, asks for an account to transfer to, and the page
 * keeps asking how the payment is doing until it's paid or closes. The page
 * holds the payment's random token, never anything that would find another
 * payment.
 *
 * Test payments (and everything on staging) run on the simulator, and only
 * those answer the "pretend it arrived" call the test checkout's buttons use.
 * In test mode that covers all three ways to pay: a bank transfer arriving, an
 * approval in the Money Moves app, and a crypto deposit. Live, bank transfers,
 * stablecoins on the networks that are live, and the Money Moves app.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { createHash } from "crypto";
import type { Business, Invoice, Mode, PayMethod, Payment, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { limited } from "../lib/limits";
import { ngnPerUsd } from "../lib/rates";
import { railRef } from "../lib/money";
import { NETWORKS, WAYS, forMode, limitsFor, platform, type OwnLimits, type Platform, type Way } from "../lib/platform";
import { COINS, offeredAccept, offersCrypto } from "../lib/accept";
import { canSimulate } from "../rails";
import { isDev } from "../config/env";
import { simulateArrival } from "../rails/simulator";
import { openLiveCryptoPayment, watchLiveCrypto, type Seen } from "../services/crypto-in";
import { chooseReturn, validReturnAddress, whyWords } from "../services/crypto-out";
import { evmChain } from "../lib/chains";
import { ethers } from "ethers";
import { openLiveAppPayment } from "../services/app-in";
import { appPayReady } from "../lib/app-pay";
import { checkPayment, confirmSimulated, fromInvoice, fromLink, fromOutlet, openNairaPayment, openSimulatedPayment, testAddress, type Checkout } from "../services/payments";
import { itemsOf } from "./invoices";
import { brandOf } from "../lib/brand";
import { methodsOpen } from "../lib/methods";
import { CUSTOMER_REASONS, RAISE_WITHIN_DAYS, customerAccept, customerReply, customerShape, raiseCustomerDispute } from "../services/disputes";

const router = Router();

// Each new payment opens a real account on the live rail, so starting one is the tight limit.
// (Development runs whole test suites from one address, so it gets room.)
const starting = limited(isDev ? 500 : 20);
const watching = limited(900);
const asking = limited(120);
const simulating = limited(60);


/** Whether the checkout behind this request is test or live - maintenance only stops live ones. */
async function modeOf(req: Request): Promise<Mode> {
  const token = String(req.params.token ?? "");
  const slug = String(req.params.slug ?? "").toLowerCase();
  if (req.path.startsWith("/p/")) return (await prisma.payment.findUnique({ where: { token }, select: { mode: true } }))?.mode ?? "LIVE";
  if (req.path.startsWith("/i/")) return (await prisma.invoice.findUnique({ where: { token }, select: { mode: true } }))?.mode ?? "LIVE";
  if (req.path.startsWith("/o/")) return (await prisma.outlet.findUnique({ where: { slug }, select: { mode: true } }))?.mode ?? "LIVE";
  return (await prisma.paymentLink.findUnique({ where: { slug }, select: { mode: true } }))?.mode ?? "LIVE";
}

/** Maintenance: no new live payment starts. Test checkouts carry on - the simulator moves nothing. A transfer already on its way still lands. */
async function notPaused(req: Request, _res: unknown, next: () => void) {
  if ((await platform()).maintenance && (await modeOf(req)) === "LIVE") throw new HttpError(503, "Payments are paused for a short while for maintenance. Try again soon. Nothing has been charged.", "maintenance");
  next();
}

/** Coins to show: two decimals, more only when they carry something ("5.0003"). */
const coinText = (micros: bigint) => (Number(micros) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });

/** Where to send, and what - live: the payment's own address or our treasury with its memo or exact amount. */
function depositOf(p: Payment) {
  if (!p.depositAddress) return null;
  const evm = !!evmChain(p.network ?? "");
  const address = evm && /^0x[0-9a-fA-F]{40}$/.test(p.depositAddress) ? ethers.getAddress(p.depositAddress) : p.depositAddress;
  const exact = p.depositKind === "AMOUNT" || (p.mode === "LIVE" && !p.depositKind);
  const amount = p.cryptoMicros == null ? null : exact ? (Number(p.cryptoMicros) / 1e6).toFixed(p.cryptoMicros % 100n === 0n ? 4 : 6) : coinText(p.cryptoMicros);
  const received = p.status === "OPEN" && p.receivedMicros && p.receivedMicros > 0n ? p.receivedMicros : null;
  return {
    coin: p.coin,
    network: p.network,
    address,
    amount,
    /** Stellar and TON: the memo to send with it - without it the payment can't be matched. */
    memo: p.depositMemo,
    /** An address made for this payment alone: any amount sent there counts towards it. */
    own: p.depositKind === "OWN",
    /** Part paid so far, and what's still to send. */
    received: received ? coinText(received) : null,
    left: received && p.cryptoMicros != null && p.cryptoMicros > received ? coinText(p.cryptoMicros - received) : null,
  };
}

/** Money that came in and goes back, waiting for the customer to say where. */
async function returnsOf(p: Payment) {
  if (p.method !== "CRYPTO" || p.mode !== "LIVE") return [];
  const list = await prisma.cryptoArrival.findMany({ where: { paymentId: p.id, returnStatus: { in: ["ASK", "QUEUED", "SENDING", "CONFIRMING", "RETURNED", "MANUAL"] } }, orderBy: { createdAt: "asc" } });
  return list.map((x) => ({ token: x.returnToken, amount: coinText(x.returnMicros ?? 0n), coin: x.coin, status: x.returnStatus, why: x.returnWhy }));
}

const publicPayment = (p: Payment, seen: Seen | null = null, returns: Awaited<ReturnType<typeof returnsOf>> = []) => ({
  token: p.token,
  ref: p.ref,
  mode: p.mode,
  method: p.method,
  status: p.status,
  currency: p.currency,
  amountNgn: p.amountKobo / 100,
  amountUsd: p.amountCents / 100,
  ngnPerUsd: p.ngnPerUsd,
  account: p.accountNumber ? { bank: p.accountBank, number: p.accountNumber, name: p.accountName } : null,
  /**
   * Live, by the app: one link that opens the payment in Money Moves - tapped on
   * the phone it's on, or shown as a QR to scan from another.
   */
  app: p.method === "APP" && p.appCode ? { link: `money-moves://business-pay?code=${p.appCode}` } : null,
  /** Crypto: where to send, and what. */
  deposit: depositOf(p),
  /** Live crypto: anything that came in and goes back - over, short, late, another coin. */
  returns,
  /** Live crypto, while it's open: the transfer as soon as it lands on chain, and its confirmations so far. */
  seen,
  /** The processing fee added on top for the customer, when the business has them pay it. */
  customerFeeNgn: p.customerFeeKobo != null ? p.customerFeeKobo / 100 : null,
  /** Paid by the app or crypto: the transaction on chain. */
  tx: (p.method === "CRYPTO" || p.method === "APP") && p.payerSession ? p.payerSession.split(":")[0] : null,
  expiresAt: p.expiresAt,
  receivedNgn: p.receivedKobo != null ? p.receivedKobo / 100 : null,
  paidAt: p.paidAt,
  email: p.customerEmail,
  simulator: canSimulate(p.mode),
});

/** How big one checkout can be for this business, in naira - what the page lets the customer type. Given a way to pay, that way's. */
export const limitsNgn = (p: Platform, b: OwnLimits, mode: Mode, way?: Way) => {
  const { minKobo, maxKobo } = limitsFor(p, b, mode, way);
  return { minNgn: minKobo / 100, maxNgn: maxKobo / 100 };
};
/** Each way to pay's own range, so the page can grey out a way the amount doesn't fit. */
export const wayLimitsNgn = (p: Platform, b: OwnLimits, mode: Mode) => Object.fromEntries(WAYS.map((w) => [w, limitsNgn(p, b, mode, w)])) as Record<Way, { minNgn: number; maxNgn: number }>;
const businessOf = (b: Business) => ({ name: b.name, verified: b.status === "VERIFIED", brand: brandOf(b), feePayer: b.feePayer, feePayers: { naira: b.feePayer, crypto: b.feePayerCrypto, app: "BUSINESS" as const } });


const customer = z.object({
  email: z.string().trim().toLowerCase().email("That email doesn't look right.").max(254).optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
});

/**
 * The ways to pay a checkout offers right now: switched on, and - live - the
 * app only once its side is set up. Crypto also needs at least one coin and
 * network left to offer.
 */
function usableMethods(methods: PayMethod[], mode: Mode, accept: Prisma.JsonValue | null, p: Platform): PayMethod[] {
  return methods.filter((m) =>
    m === "NAIRA" ? p.methods.naira : m === "APP" ? (mode === "TEST" || appPayReady()) && p.methods.app : p.methods.crypto && offersCrypto(offeredAccept(accept, p, mode)),
  );
}

const opening = customer.extend({ amount: z.number().positive().optional(), currency: z.enum(["NGN", "USD"]).optional() });
const openingCrypto = opening.extend({ coin: z.enum(COINS), network: z.enum(NETWORKS) });

/** Starts a payment by the app or crypto, from whichever checkout. */
async function openOther(c: Checkout, method: "APP" | "CRYPTO", req: Request, defaults: { email?: string | null; name?: string | null; title?: string | null } = {}) {
  const b: z.infer<typeof opening> & { coin?: string; network?: string } = method === "CRYPTO" ? body(openingCrypto, req) : body(opening, req);
  const input = { email: b.email ?? defaults.email ?? undefined, name: b.name ?? defaults.name ?? undefined, phone: b.phone, amount: b.amount, currency: b.currency };
  if (c.mode === "LIVE" && method === "CRYPTO") return openLiveCryptoPayment(c, input, b.coin!, b.network!);
  // Only where money is real: on staging a live checkout runs on the simulator, and must never reach someone's phone.
  if (c.mode === "LIVE" && method === "APP" && !canSimulate(c.mode)) return openLiveAppPayment(c, input, defaults.title);
  return openSimulatedPayment(c, input, method, method === "CRYPTO" ? { coin: b.coin!, network: b.network! } : undefined);
}

async function byToken(token: string) {
  const p = token.length <= 64 ? await prisma.payment.findUnique({ where: { token } }) : null;
  if (!p) throw new HttpError(404, "We can't find that payment.", "not_found");
  return p;
}

// ─── One payment ──────────────────────────────────────────────────────────

router.get("/p/:token", watching, async (req, res) => {
  const p = await byToken(String(req.params.token));
  // Live crypto: a look at the chain itself - at most every few seconds per payment, however often the page asks.
  const seen = await watchLiveCrypto(p);
  const now = p.method === "CRYPTO" && p.mode === "LIVE" ? await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }) : p;
  res.json({ payment: publicPayment(now, now.status === "OPEN" ? seen : null, await returnsOf(now)) });
});

/** "I've sent the money": ask the rail now rather than waiting for the next round. */
router.post("/p/:token/check", asking, async (req, res) => {
  const p = await checkPayment(await byToken(String(req.params.token)));
  // Live crypto: a look at the chain itself, which may also find it paid just now.
  const seen = await watchLiveCrypto(p);
  const now = p.method === "CRYPTO" && p.mode === "LIVE" ? await prisma.payment.findUniqueOrThrow({ where: { id: p.id } }) : p;
  res.json({ payment: publicPayment(now, now.status === "OPEN" ? seen : null, await returnsOf(now)) });
});

/**
 * Test checkout only: pretend the customer paid. A bank transfer arrives, in
 * full or ₦100 short; the app approves (always the exact amount); a crypto
 * deposit lands, in full or a dollar short.
 */
router.post("/p/:token/simulate", simulating, notPaused, async (req, res) => {
  const p = await byToken(String(req.params.token));
  if (!canSimulate(p.mode)) throw new HttpError(404, "Nothing here.", "not_found");
  const owner = await prisma.business.findUnique({ where: { id: p.businessId }, select: { status: true } });
  if (owner?.status === "SUSPENDED") throw new HttpError(403, "This business isn't taking payments right now.", "business_suspended");
  const b = body(z.object({ outcome: z.enum(["full", "short"]), failSettlement: z.boolean().optional() }), req);
  if (p.status !== "OPEN") throw new HttpError(409, "This payment isn't waiting to be paid.", "not_open");
  if (Date.now() > p.expiresAt.getTime()) throw new HttpError(409, "This payment has closed.", "expired");
  // Test payments never fail. Only a simulated live one (staging) can be told to, for ops to practise on.
  const ready = b.failSettlement && p.mode === "LIVE" ? await prisma.payment.update({ where: { id: p.id }, data: { simFailSettlement: true } }) : p;

  if (p.method === "NAIRA") {
    if (!p.accountNumber) throw new HttpError(409, "This payment isn't waiting for a transfer.", "not_open");
    if (await prisma.simInbound.findFirst({ where: { ref: railRef(p.ref) } })) throw new HttpError(409, "A transfer already arrived for this payment.", "already_arrived");
    // Short by ₦100 - or by half, for the smallest payments.
    const amountKobo = b.outcome === "short" ? p.amountKobo - Math.min(100 * 100, Math.floor(p.amountKobo / 2)) : p.amountKobo;
    await simulateArrival(railRef(p.ref), amountKobo);
    res.json({ payment: publicPayment(await checkPayment(ready)) });
    return;
  }

  const sim = createHash("sha256").update(`${p.token}:${p.method}`).digest("hex");
  if (p.method === "APP") {
    if (b.outcome === "short") throw new HttpError(400, "An app payment is always the exact amount.", "bad_outcome");
    const paid = await confirmSimulated(ready, { amountKobo: p.amountKobo, payerName: "Test customer", payerBank: "Money Moves", payerAccount: "@test.customer", session: `TEST-APP-${sim.slice(0, 16).toUpperCase()}` });
    res.json({ payment: publicPayment(paid) });
    return;
  }
  // Crypto: a dollar short - or half, for the smallest payments.
  const dollarKobo = Math.round(p.ngnPerUsd * 100);
  const amountKobo = b.outcome === "short" ? p.amountKobo - Math.min(dollarKobo, Math.floor(p.amountKobo / 2)) : p.amountKobo;
  const paid = await confirmSimulated(ready, {
    amountKobo,
    payerName: null,
    payerBank: `${p.coin} on ${p.network}`,
    payerAccount: testAddress(p.network ?? "", `from:${p.token}`),
    session: `0xTEST${sim.slice(0, 58)}`,
  });
  res.json({ payment: publicPayment(paid) });
});

// ─── A receipt ────────────────────────────────────────────────────────────

/**
 * A paid payment's receipt, for the customer: the link in their receipt email
 * leads here. The token is the payment's own unguessable one, so only whoever
 * has the link sees it. Nothing that isn't on a receipt.
 */
router.get("/r/:token", watching, async (req, res) => {
  const p = await byToken(String(req.params.token));
  if (p.status !== "PAID" && p.status !== "UNDERPAID") throw new HttpError(404, "There's no receipt for this payment yet.", "not_paid");
  const [business, link, invoice, outlet] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: p.businessId } }),
    p.linkId ? prisma.paymentLink.findUnique({ where: { id: p.linkId }, select: { name: true, description: true } }) : null,
    p.invoiceId ? prisma.invoice.findUnique({ where: { id: p.invoiceId } }) : null,
    p.outletId ? prisma.outlet.findUnique({ where: { id: p.outletId }, select: { name: true, location: true } }) : null,
  ]);
  const network = p.method === "CRYPTO" ? p.network : p.payerBank?.match(/ on (.+)$/)?.[1] ?? null;
  res.json({
    receipt: {
      business: { name: business.name, logo: brandOf(business).logo, verified: business.status === "VERIFIED" },
      title: link?.name ?? (invoice ? `Invoice ${invoice.number}` : outlet ? outlet.name : "Payment"),
      description: link?.description ?? invoice?.note ?? outlet?.location ?? null,
      items: invoice ? itemsOf(invoice) : null,
      currency: p.currency,
      amountNgn: p.amountKobo / 100,
      amountUsd: p.amountCents / 100,
      customerFeeNgn: p.customerFeeKobo != null ? p.customerFeeKobo / 100 : null,
      ngnPerUsd: p.ngnPerUsd,
      method: p.method,
      paidWith: p.method === "NAIRA" ? "Bank transfer" : p.method === "APP" ? "Money Moves app" : `${p.coin ?? "Stablecoin"} on ${p.network ?? "chain"}`,
      network,
      tx: (p.method === "CRYPTO" || p.method === "APP") && p.payerSession ? p.payerSession.split(":")[0] : null,
      ref: p.ref,
      paidAt: p.paidAt,
      payerName: p.customerName,
      payerEmail: p.customerEmail,
      status: p.status,
      test: p.mode === "TEST",
    },
  });
});

// ─── A dispute, from the receipt ──────────────────────────────────────────

/**
 * The customer questions a payment from its receipt, follows it there, and
 * answers the business. The receipt token is the only key: whoever has the
 * link is whoever got the receipt.
 */
const disputing = limited(isDev ? 200 : 10, 60 * 60_000);

async function receiptDispute(token: string) {
  const p = await byToken(token);
  if (p.status !== "PAID" && p.status !== "UNDERPAID") throw new HttpError(404, "There's no receipt for this payment yet.", "not_paid");
  const d = await prisma.dispute.findFirst({ where: { paymentId: p.id, kind: "CUSTOMER" }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  return { p, d };
}
const reread = (id: string) => prisma.dispute.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });

router.get("/r/:token/dispute", watching, async (req, res) => {
  const { p, d } = await receiptDispute(String(req.params.token));
  const canRaise = !d && (!p.paidAt || Date.now() - p.paidAt.getTime() <= RAISE_WITHIN_DAYS * 86_400_000);
  res.json({ dispute: d ? customerShape(d) : null, canRaise, emailNeeded: !p.customerEmail });
});

router.post("/r/:token/dispute", disputing, async (req, res) => {
  const b = body(
    z.object({
      reason: z.enum(CUSTOMER_REASONS),
      message: z.string().trim().min(10, "Tell the business what went wrong, in a sentence or two.").max(2000, "Keep it under 2,000 characters."),
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email("Enter an email we can reach you on.").max(200).optional(),
    }),
    req,
  );
  const { p } = await receiptDispute(String(req.params.token));
  if (!b.email && !p.customerEmail) throw new HttpError(400, "Enter an email we can reach you on.", "email_needed");
  const d = await raiseCustomerDispute(p, b);
  res.status(201).json({ dispute: customerShape(await reread(d.id)), canRaise: false });
});

router.post("/r/:token/dispute/reply", disputing, async (req, res) => {
  const b = body(z.object({ message: z.string().trim().min(1, "Write your reply.").max(2000, "Keep it under 2,000 characters.") }), req);
  const { d } = await receiptDispute(String(req.params.token));
  if (!d) throw new HttpError(404, "There's no dispute on this payment.", "not_found");
  await customerReply(d, b.message);
  res.json({ dispute: customerShape(await reread(d.id)), canRaise: false });
});

router.post("/r/:token/dispute/accept", disputing, async (req, res) => {
  const { d } = await receiptDispute(String(req.params.token));
  if (!d) throw new HttpError(404, "There's no dispute on this payment.", "not_found");
  await customerAccept(d);
  res.json({ dispute: customerShape(await reread(d.id)), canRaise: false });
});

// ─── Money going back ─────────────────────────────────────────────────────

/**
 * Crypto that came in when it wasn't needed - more than the price, after the
 * payment closed, the wrong coin - and goes back. The customer's emailed link
 * leads here, to say where it should go. The token is the arrival's own,
 * unguessable one.
 */
async function arrivalByToken(token: string) {
  const x = token.length <= 64 ? await prisma.cryptoArrival.findUnique({ where: { returnToken: token }, include: { payment: { include: { business: { select: { name: true } } } } } }) : null;
  if (!x) throw new HttpError(404, "We can't find this. Check the link in your email.", "not_found");
  return x;
}

const returnShape = (x: Awaited<ReturnType<typeof arrivalByToken>>) => ({
  amount: coinText(x.returnMicros ?? 0n),
  coin: x.coin,
  network: x.network,
  why: whyWords(x.returnWhy),
  from: x.fromAddress,
  status: x.returnStatus,
  to: x.returnTo,
  tx: x.returnTx,
  ref: x.payment?.ref ?? null,
  business: x.payment?.business.name ?? null,
  /** Stellar and TON: exchanges there need a memo to credit the right person. */
  memo: x.network === "Stellar" || x.network === "TON",
});

router.get("/x/:token", watching, async (req, res) => {
  res.json({ return: returnShape(await arrivalByToken(String(req.params.token))) });
});

router.post("/x/:token", asking, async (req, res) => {
  const b = body(z.object({ address: z.string().trim().min(20, "Paste the full address.").max(120), memo: z.string().trim().max(28).optional() }), req);
  const x = await arrivalByToken(String(req.params.token));
  if (x.returnStatus !== "ASK") throw new HttpError(409, "This has already been sorted out.", "not_waiting");
  if (!validReturnAddress(x.network, b.address)) throw new HttpError(400, `That isn't an address on ${x.network}. Check it and try again.`, "bad_address");
  await chooseReturn(x.returnToken!, b.address, b.memo || null, "customer");
  res.json({ return: returnShape(await arrivalByToken(String(req.params.token))) });
});

// ─── An invoice ───────────────────────────────────────────────────────────

export const loadInvoice = async (token: string) => {
  const inv = token.length <= 64 ? await prisma.invoice.findUnique({ where: { token }, include: { business: true } }) : null;
  // A draft hasn't been sent: as far as anyone with the link knows, it doesn't exist yet.
  if (!inv || inv.status === "DRAFT") throw new HttpError(404, "This invoice doesn't exist.", "not_found");
  return inv;
};

/** A payment already opened on this invoice, with time left on its account - given again rather than opening a second. */
const openPaymentFor = (invoiceId: string) =>
  prisma.payment.findFirst({ where: { invoiceId, status: "OPEN", expiresAt: { gt: new Date(Date.now() + 5 * 60_000) } }, orderBy: { createdAt: "desc" } });

/**
 * An invoice is paid once. An open payment the same way is given again; in
 * test mode, one opened another way gives way to the new one, so a bill can't
 * be paid twice by switching.
 */
export async function reusable(invoiceId: string, method: PayMethod): Promise<Payment | null> {
  const open = await openPaymentFor(invoiceId);
  if (!open || open.method === method) return open;
  if (open.mode === "TEST") await prisma.payment.updateMany({ where: { id: open.id, status: "OPEN" }, data: { status: "EXPIRED" } });
  return null;
}

const invoiceTitle = (inv: Invoice) => `Invoice ${inv.number}`;

router.get("/i/:token", watching, async (req, res) => {
  const inv = await loadInvoice(String(req.params.token));
  const rate = await ngnPerUsd().catch(() => null);
  const p = forMode(await platform(), inv.mode);
  // The first time the customer opens it is worth knowing.
  if (inv.status === "OPEN" && !inv.viewedAt) await prisma.invoice.update({ where: { id: inv.id }, data: { viewedAt: new Date() } });
  const takes = await methodsOpen(inv.business, inv.mode);
  const methods = usableMethods(inv.methods, inv.mode, inv.accept, p).filter((m) => takes.has(m));
  const [paid, open] = await Promise.all([
    inv.status === "PAID" ? prisma.payment.findFirst({ where: { invoiceId: inv.id, status: "PAID" }, orderBy: { paidAt: "desc" } }) : null,
    inv.status === "OPEN" ? openPaymentFor(inv.id) : null,
  ]);
  res.json({
    link: {
      slug: inv.token,
      name: invoiceTitle(inv),
      description: inv.note,
      mode: inv.mode,
      active: inv.status === "OPEN" && inv.business.status !== "SUSPENDED" && p.channels.invoices && methods.length > 0,
      currency: inv.currency,
      amount: inv.amountMinor / 100,
      min: null,
      methods,
      accept: offeredAccept(inv.accept, p, inv.mode),
      redirectUrl: null,
      askPhone: false,
    },
    invoice: {
      number: inv.number,
      customerName: inv.customerName,
      customerEmail: inv.customerEmail,
      items: itemsOf(inv),
      dueAt: inv.dueAt,
      status: inv.status,
      paidAt: inv.paidAt,
      paymentRef: paid?.ref ?? null,
    },
    business: businessOf(inv.business),
    rate,
    limits: limitsNgn(p, inv.business, inv.mode),
    wayLimits: wayLimitsNgn(p, inv.business, inv.mode),
    simulator: canSimulate(inv.mode),
    maintenance: p.maintenance,
    // An account already opened for it, still open: the page picks up where the customer left off.
    payment: open ? publicPayment(open) : null,
  });
});

router.post("/i/:token/naira", starting, notPaused, async (req, res) => {
  const inv = await loadInvoice(String(req.params.token));
  const b = body(customer, req);
  const open = inv.status === "OPEN" ? await reusable(inv.id, "NAIRA") : null;
  if (open) {
    res.json({ payment: publicPayment(open) });
    return;
  }
  const payment = await openNairaPayment(fromInvoice(inv), { email: b.email ?? inv.customerEmail, name: b.name ?? inv.customerName, phone: b.phone });
  res.status(201).json({ payment: publicPayment(payment) });
});

for (const method of ["APP", "CRYPTO"] as const) {
  router.post(`/i/:token/${method.toLowerCase()}`, starting, notPaused, async (req, res) => {
    const inv = await loadInvoice(String(req.params.token));
    const open = inv.status === "OPEN" ? await reusable(inv.id, method) : null;
    if (open) {
      res.json({ payment: publicPayment(open) });
      return;
    }
    const payment = await openOther(fromInvoice(inv), method, req, { email: inv.customerEmail, name: inv.customerName, title: `Invoice ${inv.number}` });
    res.status(201).json({ payment: publicPayment(payment) });
  });
}

// ─── An outlet ────────────────────────────────────────────────────────────

export const loadOutlet = async (slug: string) => {
  const o = slug.length <= 64 ? await prisma.outlet.findUnique({ where: { slug }, include: { business: true } }) : null;
  if (!o || o.deletedAt) throw new HttpError(404, "This store's link doesn't exist.", "not_found");
  return o;
};

router.get("/o/:slug", watching, async (req, res) => {
  const o = await loadOutlet(String(req.params.slug).toLowerCase());
  const rate = await ngnPerUsd().catch(() => null);
  const p = forMode(await platform(), o.mode);
  const takes = await methodsOpen(o.business, o.mode);
  const methods = usableMethods(o.methods, o.mode, o.accept, p).filter((m) => takes.has(m));
  res.json({
    link: {
      slug: o.slug,
      name: o.name,
      description: o.location,
      mode: o.mode,
      active: o.active && o.business.status !== "SUSPENDED" && p.channels.outlets && methods.length > 0,
      currency: o.currency,
      amount: null,
      min: null,
      methods,
      accept: offeredAccept(o.accept, p, o.mode),
      redirectUrl: null,
      askPhone: false,
      askName: o.askName,
      feePayer: o.feePayer ?? o.business.feePayer,
    },
    outlet: { name: o.name, location: o.location },
    business: businessOf(o.business),
    rate,
    limits: limitsNgn(p, o.business, o.mode),
    wayLimits: wayLimitsNgn(p, o.business, o.mode),
    simulator: canSimulate(o.mode),
    maintenance: p.maintenance,
  });
});

router.post("/o/:slug/naira", starting, notPaused, async (req, res) => {
  const o = await loadOutlet(String(req.params.slug).toLowerCase());
  const b = body(customer.extend({ amount: z.number().positive("Enter the amount you're paying."), currency: z.enum(["NGN", "USD"]).optional() }), req);
  const payment = await openNairaPayment(fromOutlet(o), b);
  res.status(201).json({ payment: publicPayment(payment) });
});

for (const method of ["APP", "CRYPTO"] as const) {
  router.post(`/o/:slug/${method.toLowerCase()}`, starting, notPaused, async (req, res) => {
    const o = await loadOutlet(String(req.params.slug).toLowerCase());
    if (!(req.body?.amount > 0)) throw new HttpError(400, "Enter the amount you're paying.", "amount_required");
    res.status(201).json({ payment: publicPayment(await openOther(fromOutlet(o), method, req, { title: o.name })) });
  });
}

// ─── A link ───────────────────────────────────────────────────────────────

export const loadLink = async (slug: string) => {
  const link = slug.length <= 64 ? await prisma.paymentLink.findUnique({ where: { slug }, include: { business: true } }) : null;
  if (!link || link.deletedAt) throw new HttpError(404, "This payment link doesn't exist.", "not_found");
  return link;
};

router.get("/:slug", watching, async (req, res) => {
  const link = await loadLink(String(req.params.slug).toLowerCase());
  // The rate is for showing the other currency; a link priced in naira works without it.
  const rate = await ngnPerUsd().catch(() => null);
  const p = forMode(await platform(), link.mode);
  // Only the ways to pay that work today and are switched on.
  const takes = await methodsOpen(link.business, link.mode);
  const methods = usableMethods(link.methods, link.mode, link.accept, p).filter((m) => takes.has(m));
  // An API checkout can be given an end.
  const expired = !!link.expiresAt && link.expiresAt.getTime() <= Date.now();
  res.json({
    link: {
      slug: link.slug,
      name: link.name,
      description: link.description,
      mode: link.mode,
      // A deactivated business takes no payments, whatever its links say - nor a link with no way to pay left.
      active: link.active && !expired && link.business.status !== "SUSPENDED" && p.channels.links && methods.length > 0,
      expired,
      expiresAt: link.expiresAt,
      // Who it's for, when the business's server said: filled in for them.
      customer: link.customerEmail || link.customerName ? { email: link.customerEmail, name: link.customerName } : null,
      currency: link.currency,
      amount: link.amountMinor != null ? link.amountMinor / 100 : null,
      min: link.minMinor != null ? link.minMinor / 100 : null,
      methods,
      accept: offeredAccept(link.accept, p, link.mode),
      redirectUrl: link.redirectUrl,
      askPhone: link.askPhone,
      askName: link.askName,
      feePayer: link.feePayer ?? link.business.feePayer,
    },
    business: businessOf(link.business),
    rate,
    limits: limitsNgn(p, link.business, link.mode),
    wayLimits: wayLimitsNgn(p, link.business, link.mode),
    simulator: canSimulate(link.mode),
    maintenance: p.maintenance,
  });
});

router.post("/:slug/naira", starting, notPaused, async (req, res) => {
  const link = await loadLink(String(req.params.slug).toLowerCase());
  const b = body(customer.extend({ amount: z.number().positive().optional(), currency: z.enum(["NGN", "USD"]).optional() }), req);
  if (link.askPhone && !b.phone) throw new HttpError(400, "Add your phone number.", "phone_required");
  const payment = await openNairaPayment(fromLink(link), b);
  res.status(201).json({ payment: publicPayment(payment) });
});

for (const method of ["APP", "CRYPTO"] as const) {
  router.post(`/:slug/${method.toLowerCase()}`, starting, notPaused, async (req, res) => {
    const link = await loadLink(String(req.params.slug).toLowerCase());
    if (link.askPhone && !req.body?.phone) throw new HttpError(400, "Add your phone number.", "phone_required");
    res.status(201).json({ payment: publicPayment(await openOther(fromLink(link), method, req, { title: link.name })) });
  });
}

export default router;
