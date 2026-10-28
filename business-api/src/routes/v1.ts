/**
 * The API, for a business's own server. Called with a secret key, from a
 * server only, never a website or an app: a browser's request (anything with
 * an Origin) is refused, so a key pasted into a page simply doesn't work.
 *
 * A key belongs to one mode, and everything it makes and reads is in that
 * mode. A test key's checkouts are test checkouts: one-time accounts from the
 * simulator, crypto addresses that can't receive anything, the test banner on
 * the page. Only the test buttons can pay them, and nothing real ever moves.
 *
 * Every request a key makes is kept for 30 days (the dashboard's Logs), under
 * a request id that's also in the mm-request-id header and in every error. A
 * POST can carry an Idempotency-Key: the same key again, with the same body,
 * gets the first answer back instead of doing it twice.
 *
 * Lists are newest first, `limit` at a time (100 at most), and carry on from
 * `starting_after`: the last id of the page before.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash, randomBytes } from "crypto";
import rateLimit from "express-rate-limit";
import { z, type ZodTypeAny } from "zod";
import { Prisma, type ApiKey, type Destination, type Mode, type PayMethod, type Payment } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { forMode, limitsFor, platform, type Platform } from "../lib/platform";
import { minorFor, placesFor } from "../lib/checkouts";
import { acceptSchema, acceptToSave } from "../lib/accept";
import { appPayReady } from "../lib/app-pay";
import { ngnPerUsd } from "../lib/rates";
import { walletHoldings, type Holding } from "../lib/chain-balances";
import { EVENT_TYPES, eventObject } from "../lib/webhooks";
import { METHOD_IN, checkoutObject, disputeObject, paymentObject, refundObject, settlementObject } from "../lib/api-objects";
import { CUSTOMER_REASONS, businessReply, customerAccept, filesOf, raiseCustomerDispute } from "../services/disputes";
import { methodStates } from "../lib/methods";
import { askRefund, cancelRefund, checkRefundFunding, simulateFunding } from "../services/refunds";
import { hashKey } from "./api-keys";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ApiKey;
      /** "req_…": in the mm-request-id header, in every error, and in the Logs. */
      requestId?: string;
      idempotencyKey?: string;
    }
  }
}

const router = Router();

// ─── Every request: an id, and a line in the Logs ─────────────────────────

/** What's kept of a body: all of it up to 16 KB, a note past that. */
function kept(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === undefined || v === null) return Prisma.JsonNull;
  const text = JSON.stringify(v);
  if (text === undefined) return Prisma.JsonNull;
  return text.length > 16_000 ? { truncated: true, note: "Too long to keep in full." } : (v as Prisma.InputJsonValue);
}

router.use((req, res, next) => {
  const started = Date.now();
  const id = `req_${randomBytes(12).toString("base64url")}`;
  req.requestId = id;
  res.setHeader("mm-request-id", id);
  // What was sent back: for the Logs, and for an idempotent replay.
  const json = res.json.bind(res);
  res.json = ((b: unknown) => {
    res.locals.body = b;
    return json(b);
  }) as typeof res.json;
  res.on("finish", () => {
    const k = req.apiKey;
    if (!k) return;
    void prisma.apiRequest
      .create({
        data: {
          id,
          businessId: k.businessId,
          apiKeyId: k.id,
          mode: k.mode,
          method: req.method,
          path: req.originalUrl.replace(/^\/api/, "").slice(0, 500),
          status: res.statusCode,
          durationMs: Date.now() - started,
          ip: req.clientIp,
          idempotencyKey: req.idempotencyKey ?? null,
          requestBody: req.method === "GET" ? Prisma.JsonNull : kept(req.body),
          responseBody: kept(res.locals.body),
        },
      })
      .catch((e) => log.warn("[v1] couldn't log a request", { reason: e instanceof Error ? e.message : String(e) }));
  });
  next();
});

const tooMany = (_req: Request, _res: Response, next: NextFunction) => next(new HttpError(429, "Too many requests. Slow down, and try again in a minute.", "rate_limited"));
const perMinute = (limit: number, keyGenerator: (req: Request) => string) =>
  rateLimit({ windowMs: 60_000, limit, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator, validate: { xForwardedForHeader: false }, handler: tooMany });

// Before the key is even looked up: no address floods the database.
router.use(perMinute(600, (req) => req.clientIp));

// ─── The key ──────────────────────────────────────────────────────────────

/** Who's calling: a secret key for this business, from a server. */
async function requireKey(req: Request, _res: Response, next: NextFunction) {
  if (req.get("origin")) throw new HttpError(403, "Secret keys work from your server only, never in a website or an app.", "browser_not_allowed");
  const key = req.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!/^sk_(test|live)_[A-Za-z0-9]{20,80}$/.test(key)) throw new HttpError(401, "Send your secret key as: Authorization: Bearer sk_test_…", "no_key");
  const found = await prisma.apiKey.findUnique({ where: { hash: hashKey(key) } });
  if (!found || found.revokedAt) throw new HttpError(401, "That key isn't valid. It may have been revoked.", "bad_key");
  // A real key from here: whatever happens next is in the business's Logs.
  req.apiKey = found;
  const business = await prisma.business.findUniqueOrThrow({ where: { id: found.businessId }, select: { status: true } });
  if (business.status === "SUSPENDED") throw new HttpError(403, "This business has been deactivated.", "business_suspended");
  if (found.mode === "LIVE" && business.status !== "VERIFIED") throw new HttpError(403, "Live keys work once the business is verified.", "business_unverified");
  if (!(await platform()).channels.api) throw new HttpError(503, "The API is paused by Money Moves right now. Try again a little later.", "channel_paused");
  // Last used, to the minute: not a write on every call.
  if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > 60_000) await prisma.apiKey.update({ where: { id: found.id }, data: { lastUsedAt: new Date() } });
  next();
}
router.use(requireKey);
router.use(perMinute(300, (req) => req.apiKey!.id));

// ─── Idempotency ──────────────────────────────────────────────────────────

/**
 * A POST with an Idempotency-Key: the first answer is kept for a day, and the
 * same key with the same body gets it back, marked idempotent-replayed. The
 * same key with a different body is refused. A failure on our side (5xx) isn't
 * kept, so it can be tried again with the same key.
 */
async function idempotent(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "POST") return next();
  const raw = req.get("idempotency-key");
  if (raw === undefined) return next();
  const key = raw.trim();
  if (!key || key.length > 255) throw new HttpError(400, "Idempotency-Key has to be 1 to 255 characters.", "bad_idempotency_key");
  const apiKeyId = req.apiKey!.id;
  const requestHash = createHash("sha256").update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`).digest("hex");
  let recordId: string | null = null;
  for (let attempt = 0; attempt < 2 && !recordId; attempt++) {
    try {
      recordId = (await prisma.idempotencyRecord.create({ data: { apiKeyId, key, requestHash } })).id;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      const was = await prisma.idempotencyRecord.findUnique({ where: { apiKeyId_key: { apiKeyId, key } } });
      if (!was) continue;
      if (was.requestHash !== requestHash) throw new HttpError(422, "This Idempotency-Key was used with a different request. Use a new key for a new request.", "idempotency_key_reused");
      if (was.status == null) {
        // The first one never finished (a restart mid-request): let this one run instead.
        if (Date.now() - was.createdAt.getTime() > 2 * 60_000) {
          await prisma.idempotencyRecord.deleteMany({ where: { id: was.id, status: null } });
          continue;
        }
        throw new HttpError(409, "The first request with this Idempotency-Key is still running. Try again in a moment.", "idempotency_in_progress");
      }
      res.setHeader("idempotent-replayed", "true");
      res.status(was.status).json(was.body);
      return;
    }
  }
  if (!recordId) throw new HttpError(409, "Try that again.", "idempotency_in_progress");
  req.idempotencyKey = key;
  const id = recordId;
  // The answer is kept before it's sent, so a retry that arrives the instant the first one finishes gets it back.
  const send = res.json.bind(res);
  res.json = ((b: unknown) => {
    const done = res.statusCode >= 500 ? prisma.idempotencyRecord.delete({ where: { id } }) : prisma.idempotencyRecord.update({ where: { id }, data: { status: res.statusCode, body: kept(b) } });
    void done.catch(() => {}).finally(() => send(b));
    return res;
  }) as typeof res.json;
  next();
}
router.use(idempotent);

// ─── Reading what was sent ────────────────────────────────────────────────

/** Input, checked: the first problem becomes a 400 that names the field. */
function input<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue?.path.join(".");
  const message = issue ? (issue.code === "unrecognized_keys" ? `${issue.keys.join(", ")} isn't a field here.` : field && !issue.message.startsWith(field) ? `${field}: ${issue.message}` : issue.message) : "That request isn't quite right.";
  throw new HttpError(400, message, "invalid_request");
}

const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  starting_after: z.string().min(1).max(64).optional(),
};
const since = {
  created_after: z.coerce.date().optional(),
  created_before: z.coerce.date().optional(),
};

type Paging = { limit: number; starting_after?: string; created_after?: Date; created_before?: Date };

/** Newest first, one more than asked for, to know whether there's another page. */
const pageArgs = (q: Paging) => ({
  take: q.limit + 1,
  ...(q.starting_after ? { cursor: { id: q.starting_after }, skip: 1 } : {}),
  orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
});
const created = (q: Paging) =>
  q.created_after || q.created_before ? { createdAt: { ...(q.created_after ? { gt: q.created_after } : {}), ...(q.created_before ? { lt: q.created_before } : {}) } } : {};

function listOf<T extends { id: string }, O>(rows: T[], limit: number, shape: (r: T) => O) {
  const page = rows.slice(0, limit);
  const more = rows.length > limit;
  return { object: "list", data: page.map(shape), has_more: more, next_cursor: more ? page[page.length - 1]!.id : null };
}

const notFound = (what: string) => new HttpError(404, `No ${what} with that id in this key's mode.`, "not_found");
const mine = (k: ApiKey) => ({ businessId: k.businessId, mode: k.mode });

// ─── The account ──────────────────────────────────────────────────────────

/** Whose key this is: a quick way to check a key works. */
router.get("/account", async (req, res) => {
  const k = req.apiKey!;
  const b = await prisma.business.findUniqueOrThrow({ where: { id: k.businessId } });
  res.json({
    object: "account",
    merchant_id: b.merchantId,
    name: b.name,
    mode: k.mode === "TEST" ? "test" : "live",
    verified: b.status === "VERIFIED",
    key: { name: k.name, prefix: k.prefix },
  });
});

// ─── Checkouts ────────────────────────────────────────────────────────────

const DEST_IN = { bank: "BANK", money_moves: "MONEY_MOVES", wallet: "WALLET" } as const satisfies Record<string, Destination>;

/** Your own data on a checkout: up to 20 keys, short values. It comes back on the checkout, its payment and every event. */
const metadataSchema = z
  .record(z.string().min(1).max(40, "metadata keys are 40 characters at most."), z.union([z.string().max(500, "metadata values are 500 characters at most."), z.number(), z.boolean()]))
  .refine((m) => Object.keys(m).length <= 20, "metadata can have 20 keys at most.");

const createInput = z
  .object({
    amount: z.number().positive("amount has to be more than zero."),
    currency: z.enum(["NGN", "USD"]),
    description: z.string().trim().max(200).optional(),
    /** Your own reference: an order number, say. */
    reference: z.string().trim().max(100).optional(),
    methods: z.array(z.enum(["bank_transfer", "app", "crypto"])).min(1).max(3).optional(),
    /** Crypto only: which coins on which networks, like { "USDC": ["Base", "Solana"] }. Left out: every pair that's on. */
    accept: acceptSchema,
    customer: z.object({ email: z.string().trim().email("customer.email isn't an email address.").max(200).optional(), name: z.string().trim().max(100).optional() }).strict().optional(),
    metadata: metadataSchema.optional(),
    /** Seconds from now, 5 minutes to 30 days. Or expires_at. Left out: it doesn't expire. */
    expires_in: z.number().int().min(300, "expires_in is 300 seconds at least.").max(30 * 86_400, "expires_in is 30 days at most.").optional(),
    expires_at: z.string().datetime({ offset: true, message: "expires_at has to be an ISO 8601 time, like 2026-10-20T12:00:00Z." }).optional(),
    fee_payer: z.enum(["business", "customer"]).optional(),
    settle_to: z.enum(["bank", "money_moves", "wallet"]).optional(),
    redirect_url: z
      .string()
      .trim()
      .url("redirect_url has to be a full address, starting https://")
      .max(500)
      .refine((u) => /^https?:\/\//i.test(u), "redirect_url has to start https://")
      .optional(),
  })
  .strict();

/** The ways to pay that work right now in this mode, for a checkout that doesn't say. */
function defaultMethods(mode: Mode, p: Platform): PayMethod[] {
  const on = forMode(p, mode).methods;
  const out: PayMethod[] = [];
  if (on.naira) out.push("NAIRA");
  if (on.app && (mode === "TEST" || appPayReady())) out.push("APP");
  if (on.crypto) out.push("CRYPTO");
  return out;
}

/**
 * Where a checkout's money goes when it doesn't say: the place the business
 * chose for API payments, while it can take them; otherwise a checked bank
 * account, then a linked Money Moves account, then the business wallet.
 */
export async function defaultDestination(businessId: string, mode: Mode, p: Platform): Promise<{ destination: Destination; bankAccountId?: string }> {
  if (mode === "TEST") return { destination: "BANK" };
  const on = forMode(p, mode).destinations;
  const chosen = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { apiSettleTo: true, apiBankAccountId: true } });
  if (chosen.apiSettleTo === "BANK" && on.bank) {
    const bank = await prisma.bankAccount.findFirst({ where: { businessId, removedAt: null, nameMatches: true, ...(chosen.apiBankAccountId ? { id: chosen.apiBankAccountId } : {}) } });
    if (bank) return { destination: "BANK", bankAccountId: bank.id };
  }
  if (chosen.apiSettleTo === "MONEY_MOVES" && on.moneyMoves && (await prisma.moneyMovesLink.count({ where: { businessId, status: "LINKED" } }))) return { destination: "MONEY_MOVES" };
  if (chosen.apiSettleTo === "WALLET" && on.wallet && (await prisma.businessWallet.count({ where: { businessId } }))) return { destination: "WALLET" };
  const [bank, linked, wallet] = await Promise.all([
    prisma.bankAccount.count({ where: { businessId, removedAt: null, nameMatches: true } }),
    prisma.moneyMovesLink.count({ where: { businessId, status: "LINKED" } }),
    prisma.businessWallet.count({ where: { businessId } }),
  ]);
  if (bank && on.bank) return { destination: "BANK" };
  if (linked && on.moneyMoves) return { destination: "MONEY_MOVES" };
  if (wallet && on.wallet) return { destination: "WALLET" };
  return { destination: "BANK" };
}

function expiryOf(b: { expires_in?: number; expires_at?: string }): Date | null {
  if (b.expires_in != null && b.expires_at) throw new HttpError(400, "Send expires_in or expires_at, not both.", "invalid_request");
  const at = b.expires_in != null ? new Date(Date.now() + b.expires_in * 1000) : b.expires_at ? new Date(b.expires_at) : null;
  if (at && (at.getTime() < Date.now() + 5 * 60_000 || at.getTime() > Date.now() + 30 * 86_400_000)) {
    throw new HttpError(400, "A checkout can expire between 5 minutes and 30 days from now.", "bad_expiry");
  }
  return at;
}

/** The latest successful payment of each checkout. */
async function paidFor(linkIds: string[]): Promise<Map<string, Payment>> {
  const out = new Map<string, Payment>();
  if (!linkIds.length) return out;
  const list = await prisma.payment.findMany({ where: { linkId: { in: linkIds }, status: "PAID" }, orderBy: { paidAt: "desc" } });
  for (const p of list) if (p.linkId && !out.has(p.linkId)) out.set(p.linkId, p);
  return out;
}

async function findCheckout(k: ApiKey, id: string) {
  const link = await prisma.paymentLink.findFirst({ where: { id, ...mine(k), apiKeyId: { not: null }, deletedAt: null } });
  if (!link) throw notFound("checkout");
  return link;
}

/** Makes a checkout: one amount, and one page to send the customer to. */
router.post("/checkouts", async (req, res) => {
  const key = req.apiKey!;
  const b = input(createInput, req.body);
  const p = await platform();
  // The business's own switches: a way to pay it turned off, or has nowhere to settle, isn't offered.
  const owner = await prisma.business.findUniqueOrThrow({ where: { id: key.businessId }, select: { id: true, kind: true, methodsOff: true } });
  const states = await methodStates(owner, key.mode);
  const wanted: PayMethod[] = b.methods ? [...new Set(b.methods.map((m) => METHOD_IN[m]))] : defaultMethods(key.mode, p);
  const shut = wanted.filter((m) => !states[m].on);
  if (b.methods && shut.length) {
    const name = { NAIRA: "bank_transfer", APP: "app", CRYPTO: "crypto" } as const;
    throw new HttpError(400, `${shut.map((m) => name[m]).join(", ")} is switched off for this business. ${states[shut[0]!].why ?? "Turn it on in the dashboard, Settings, Payment methods."}`, "method_off");
  }
  const methods = wanted.filter((m) => states[m].on);
  if (!methods.length) throw new HttpError(503, "No way to pay is switched on for this business. Turn one on in the dashboard, Settings, Payment methods.", "methods_paused");
  if (b.accept && !methods.includes("CRYPTO")) throw new HttpError(400, "accept is for crypto. Add crypto to methods, or leave accept out.", "invalid_request");
  const fallback = b.settle_to ? null : await defaultDestination(key.businessId, key.mode, p);
  const asked = b.settle_to ? DEST_IN[b.settle_to] : fallback!.destination;
  const { destination, bankAccountId, business } = await placesFor(key.businessId, key.mode, { methods, destination: asked, bankAccountId: fallback?.bankAccountId });
  const amountMinor = await minorFor(b.amount, b.currency, "The amount", limitsFor(p, business, key.mode));
  const expiresAt = expiryOf(b);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = `${key.mode === "TEST" ? "test-" : ""}co-${randomBytes(6).toString("hex")}`;
    try {
      const link = await prisma.paymentLink.create({
        data: {
          businessId: key.businessId,
          mode: key.mode,
          slug,
          name: b.description || (b.reference ? `Order ${b.reference}` : "Checkout"),
          description: b.description || null,
          currency: b.currency,
          amountMinor,
          methods,
          accept: acceptToSave(methods, b.accept ?? null),
          destination,
          bankAccountId,
          redirectUrl: b.redirect_url || null,
          apiKeyId: key.id,
          reference: b.reference || null,
          metadata: b.metadata ?? Prisma.DbNull,
          expiresAt,
          customerEmail: b.customer?.email || null,
          customerName: b.customer?.name || null,
          feePayer: b.fee_payer ? (b.fee_payer === "customer" ? "CUSTOMER" : "BUSINESS") : null,
        },
      });
      res.status(201).json(checkoutObject(link, null));
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new HttpError(500, "Couldn't make the checkout just now. Try again.", "create_failed");
});

router.get("/checkouts", async (req, res) => {
  const key = req.apiKey!;
  const q = input(z.object({ ...paging, ...since, reference: z.string().max(100).optional() }).strict(), req.query);
  const rows = await prisma.paymentLink.findMany({ where: { ...mine(key), apiKeyId: { not: null }, deletedAt: null, ...(q.reference ? { reference: q.reference } : {}), ...created(q) }, ...pageArgs(q) });
  const paid = await paidFor(rows.map((r) => r.id));
  res.json(listOf(rows, q.limit, (l) => checkoutObject(l, paid.get(l.id) ?? null)));
});

/** One checkout: open, paid, expired or cancelled, and its payment once there is one. */
router.get("/checkouts/:id", async (req, res) => {
  const link = await findCheckout(req.apiKey!, String(req.params.id));
  res.json(checkoutObject(link, (await paidFor([link.id])).get(link.id) ?? null));
});

/** Stops a checkout taking payments. A customer already part way through a transfer can still finish it. */
router.post("/checkouts/:id/cancel", async (req, res) => {
  const link = await findCheckout(req.apiKey!, String(req.params.id));
  if ((await paidFor([link.id])).has(link.id)) throw new HttpError(409, "This checkout has been paid, so it can't be cancelled. Refund the payment instead.", "already_paid");
  const saved = link.active ? await prisma.paymentLink.update({ where: { id: link.id }, data: { active: false } }) : link;
  res.json(checkoutObject(saved, null));
});

// ─── Payments ─────────────────────────────────────────────────────────────

const PAYMENT_STATUS_IN = { open: "OPEN", successful: "PAID", underpaid: "UNDERPAID", expired: "EXPIRED" } as const;
const linkBits = { select: { id: true, metadata: true, reference: true, apiKeyId: true } } as const;

/** Every payment in this mode: through API checkouts, payment links, invoices and store QRs. */
router.get("/payments", async (req, res) => {
  const key = req.apiKey!;
  const q = input(
    z.object({ ...paging, ...since, status: z.enum(["open", "successful", "underpaid", "expired"]).optional(), method: z.enum(["bank_transfer", "app", "crypto"]).optional(), checkout: z.string().max(64).optional() }).strict(),
    req.query,
  );
  const rows = await prisma.payment.findMany({
    where: { ...mine(key), ...(q.status ? { status: PAYMENT_STATUS_IN[q.status] } : {}), ...(q.method ? { method: METHOD_IN[q.method] } : {}), ...(q.checkout ? { linkId: q.checkout } : {}), ...created(q) },
    include: { link: linkBits },
    ...pageArgs(q),
  });
  res.json(listOf(rows, q.limit, (p) => paymentObject(p, p.link)));
});

/** One payment, by its id or its reference. */
router.get("/payments/:id", async (req, res) => {
  const id = String(req.params.id);
  const p = await prisma.payment.findFirst({ where: { ...mine(req.apiKey!), OR: [{ id }, { ref: id }] }, include: { link: linkBits } });
  if (!p) throw notFound("payment");
  res.json(paymentObject(p, p.link));
});

// ─── Settlements ──────────────────────────────────────────────────────────

router.get("/settlements", async (req, res) => {
  const key = req.apiKey!;
  const q = input(z.object({ ...paging, ...since, status: z.enum(["pending", "completed"]).optional(), payment: z.string().max(64).optional() }).strict(), req.query);
  const rows = await prisma.settlement.findMany({
    where: { ...mine(key), ...(q.status ? { status: q.status === "completed" ? "SETTLED" : { not: "SETTLED" } } : {}), ...(q.payment ? { paymentId: q.payment } : {}), ...created(q) },
    include: { payment: { select: { ref: true } } },
    ...pageArgs(q),
  });
  res.json(listOf(rows, q.limit, (s) => settlementObject(s, s.payment.ref)));
});

router.get("/settlements/:id", async (req, res) => {
  const id = String(req.params.id);
  const s = await prisma.settlement.findFirst({ where: { ...mine(req.apiKey!), OR: [{ id }, { ref: id }] }, include: { payment: { select: { ref: true } } } });
  if (!s) throw notFound("settlement");
  res.json(settlementObject(s, s.payment.ref));
});

// ─── Refunds ──────────────────────────────────────────────────────────────

async function findRefund(k: ApiKey, id: string) {
  const r = await prisma.refund.findFirst({ where: { ...mine(k), OR: [{ id }, { ref: id }] } });
  if (!r) throw notFound("refund");
  return r;
}

/**
 * Money back to a customer, the way they paid. You fund it: the refund comes
 * back with a one-time account to transfer to (the amount less our fee on it,
 * given back), and once your transfer lands we send the customer their money.
 * An underpayment we never settled goes straight back, with nothing to fund.
 */
router.post("/refunds", async (req, res) => {
  const key = req.apiKey!;
  const b = input(
    z.object({ payment: z.string().min(1, "payment is the id of the payment to refund.").max(64), amount: z.number().positive("amount has to be more than zero.").optional(), reason: z.string().trim().max(280).optional() }).strict(),
    req.body,
  );
  const p = await prisma.payment.findFirst({ where: { ...mine(key), OR: [{ id: b.payment }, { ref: b.payment }] }, select: { id: true } });
  if (!p) throw notFound("payment");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: key.businessId } });
  const r = await askRefund({ business, paymentId: p.id, amount: b.amount, funding: "BANK", reason: b.reason, by: `api:${key.prefix}` });
  res.status(201).json(refundObject(r));
});

router.get("/refunds", async (req, res) => {
  const key = req.apiKey!;
  const q = input(
    z.object({ ...paging, ...since, status: z.enum(["awaiting_funds", "processing", "completed", "cancelled"]).optional(), payment: z.string().max(64).optional() }).strict(),
    req.query,
  );
  const STATUS = { awaiting_funds: "AWAITING_FUNDS", processing: "SENDING", completed: "REFUNDED", cancelled: "CANCELLED" } as const;
  const rows = await prisma.refund.findMany({ where: { ...mine(key), ...(q.status ? { status: STATUS[q.status] } : {}), ...(q.payment ? { paymentId: q.payment } : {}), ...created(q) }, ...pageArgs(q) });
  res.json(listOf(rows, q.limit, refundObject));
});

router.get("/refunds/:id", async (req, res) => {
  const r = await findRefund(req.apiKey!, String(req.params.id));
  // Asked about: look at the funding account now rather than at the worker's next round.
  res.json(refundObject(r.status === "AWAITING_FUNDS" ? await checkRefundFunding(r) : r));
});

/** Calls off a refund that's still waiting for your money. */
router.post("/refunds/:id/cancel", async (req, res) => {
  const key = req.apiKey!;
  const r = await findRefund(key, String(req.params.id));
  res.json(refundObject(await cancelRefund(r, `api:${key.prefix}`)));
});

/** Test keys only: pretend your transfer to the refund's account landed. */
router.post("/refunds/:id/simulate", async (req, res) => {
  const key = req.apiKey!;
  if (key.mode !== "TEST") throw new HttpError(400, "Only test refunds can be simulated. A live refund waits for your real transfer.", "test_only");
  const r = await findRefund(key, String(req.params.id));
  res.json(refundObject(await simulateFunding(r, `api:${key.prefix}`)));
});

// ─── Disputes ─────────────────────────────────────────────────────────────

const DISPUTE_STATUS = { needs_reply: "NEEDS_REPLY", under_review: "UNDER_REVIEW", won: "WON", refunded: "REFUNDED", lost: "LOST" } as const;

async function findDispute(k: ApiKey, id: string) {
  const d = await prisma.dispute.findFirst({ where: { ...mine(k), OR: [{ id }, { ref: id }] }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!d) throw notFound("dispute");
  return d;
}
const disputeWithMessages = async (k: ApiKey, id: string) => {
  const d = await findDispute(k, id);
  return disputeObject(d, await filesOf([d]));
};

/** Disputes on your payments: customers who raised one from their receipt, and bank claims on bank transfers. */
router.get("/disputes", async (req, res) => {
  const key = req.apiKey!;
  const q = input(
    z
      .object({
        ...paging,
        ...since,
        status: z.enum(["needs_reply", "under_review", "won", "refunded", "lost"]).optional(),
        kind: z.enum(["customer", "bank_claim"]).optional(),
        payment: z.string().max(64).optional(),
      })
      .strict(),
    req.query,
  );
  const rows = await prisma.dispute.findMany({
    where: {
      ...mine(key),
      ...(q.status ? { status: DISPUTE_STATUS[q.status] } : {}),
      ...(q.kind ? { kind: q.kind === "bank_claim" ? ("BANK" as const) : ("CUSTOMER" as const) } : {}),
      ...(q.payment ? { payment: { OR: [{ id: q.payment }, { ref: q.payment }] } } : {}),
      ...created(q),
    },
    ...pageArgs(q),
  });
  res.json(listOf(rows, q.limit, (d) => disputeObject(d)));
});

/** One dispute, with its whole conversation. */
router.get("/disputes/:id", async (req, res) => {
  res.json(await disputeWithMessages(req.apiKey!, String(req.params.id)));
});

/**
 * Your reply. A customer then has 3 days to accept it or answer; a bank claim
 * goes to the bank. Files are attached from the dashboard.
 */
router.post("/disputes/:id/reply", async (req, res) => {
  const key = req.apiKey!;
  const b = input(z.object({ message: z.string().trim().min(1, "message is your reply.").max(4000, "Keep message under 4,000 characters.") }).strict(), req.body);
  const d = await findDispute(key, String(req.params.id));
  await businessReply(d, b.message, [], `api:${key.prefix}`);
  res.json(await disputeWithMessages(key, d.id));
});

/** Test keys only: open a dispute on a paid test payment, as its customer would from the receipt. */
router.post("/disputes", async (req, res) => {
  const key = req.apiKey!;
  if (key.mode !== "TEST") throw new HttpError(400, "Only test disputes can be opened with a key. Live ones are raised by customers from their receipts.", "test_only");
  const b = input(
    z
      .object({
        payment: z.string().min(1, "payment is the id of a paid test payment.").max(64),
        reason: z.enum(["not_received", "duplicate", "not_as_described"]).default("not_received"),
        message: z.string().trim().min(10, "message is what the customer says, at least 10 characters.").max(2000),
      })
      .strict(),
    req.body,
  );
  const p = await prisma.payment.findFirst({ where: { ...mine(key), OR: [{ id: b.payment }, { ref: b.payment }] } });
  if (!p) throw notFound("payment");
  const reason = b.reason.toUpperCase() as (typeof CUSTOMER_REASONS)[number];
  const d = await raiseCustomerDispute(p, { reason, message: b.message, email: p.customerEmail ?? "customer@example.com" });
  res.status(201).json(await disputeWithMessages(key, d.id));
});

/** Test keys only: the customer accepts your reply, and the dispute closes in your favour. */
router.post("/disputes/:id/accept", async (req, res) => {
  const key = req.apiKey!;
  if (key.mode !== "TEST") throw new HttpError(400, "Only a test customer can be made to accept. Live customers answer from their receipts.", "test_only");
  const d = await findDispute(key, String(req.params.id));
  await customerAccept(d);
  res.json(await disputeWithMessages(key, d.id));
});

// ─── Balance and rates ────────────────────────────────────────────────────

/** What a wallet holds, read from the chains at most every 15 seconds. */
const holdingsSeen = new Map<string, { at: number; holdings: Holding[] }>();
async function holdingsOf(w: { id: string; evmAddress: string | null; solanaAddress: string | null; movementAddress: string | null }) {
  const seen = holdingsSeen.get(w.id);
  if (seen && Date.now() - seen.at < 15_000) return seen.holdings;
  const holdings = await walletHoldings(w);
  holdingsSeen.set(w.id, { at: Date.now(), holdings });
  return holdings;
}

/**
 * Where the business's money is: on its way to where it settles, and (live)
 * what the business wallet holds, read from each chain now.
 */
router.get("/balance", async (req, res) => {
  const key = req.apiKey!;
  const [settling, wallet, rate] = await Promise.all([
    prisma.settlement.aggregate({ where: { ...mine(key), status: { not: "SETTLED" } }, _sum: { amountKobo: true }, _count: true }),
    key.mode === "LIVE" ? prisma.businessWallet.findUnique({ where: { businessId: key.businessId } }) : null,
    ngnPerUsd().catch(() => null),
  ]);
  const holdings = wallet ? await holdingsOf(wallet) : null;
  const usd = holdings ? Math.round(holdings.reduce((s, h) => s + h.amount, 0) * 100) / 100 : null;
  res.json({
    object: "balance",
    mode: key.mode === "TEST" ? "test" : "live",
    settling: { amount_ngn: (settling._sum.amountKobo ?? 0) / 100, count: settling._count },
    wallet: holdings
      ? { holdings: holdings.filter((h) => h.amount > 0).map((h) => ({ coin: h.asset, network: h.chain, amount: h.amount })), total_usd: usd, total_ngn: rate && usd != null ? Math.round(usd * rate * 100) / 100 : null }
      : null,
    rate_ngn_per_usd: rate,
    as_of: new Date().toISOString(),
  });
});

/** Today's rate: what a dollar (one USDC or USDT) is in naira. The one every checkout uses. */
router.get("/rates", async (_req, res) => {
  res.json({ object: "rate", base: "USD", quote: "NGN", ngn_per_usd: await ngnPerUsd(), as_of: new Date().toISOString() });
});

// ─── Events ───────────────────────────────────────────────────────────────

/** Everything that happened, as the webhooks sent it: for catching up after your server was down. */
router.get("/events", async (req, res) => {
  const key = req.apiKey!;
  const q = input(z.object({ ...paging, ...since, type: z.string().max(60).optional() }).strict(), req.query);
  if (q.type && !EVENT_TYPES.includes(q.type)) throw new HttpError(400, `type has to be one of: ${EVENT_TYPES.join(", ")}.`, "invalid_request");
  const rows = await prisma.webhookEvent.findMany({ where: { ...mine(key), type: q.type ?? { not: "webhook.test" }, ...created(q) }, ...pageArgs(q) });
  res.json(listOf(rows, q.limit, eventObject));
});

router.get("/events/:id", async (req, res) => {
  const e = await prisma.webhookEvent.findFirst({ where: { id: String(req.params.id), ...mine(req.apiKey!) } });
  if (!e) throw notFound("event");
  res.json(eventObject(e));
});

export default router;
