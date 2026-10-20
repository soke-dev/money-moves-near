/**
 * Invoices: a bill to one customer, by email, with a link to pay it from.
 *
 * Saved as a draft, or sent at once. A sent invoice can be reminded about, and
 * one not yet paid can be voided - never deleted. An invoice belongs to test
 * mode or live mode for good; live ones need a verified business. Test
 * invoices aren't emailed: trying invoices out never sends a stranger a bill -
 * the business opens or shares the link itself.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, type Invoice, type Payment } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { env } from "../config/env";
import { toMinor } from "../lib/money";
import { limitsFor, platform } from "../lib/platform";
import { acceptSchema, acceptToSave } from "../lib/accept";
import { minorFor, modeOf, placesFor } from "../lib/checkouts";
import { requireMember } from "../middleware/auth";
import { advance, emailInvoice as emailAny, nextInvoiceNumber } from "../services/recurring";

const router = Router({ mergeParams: true });
const MANAGE = ["OWNER", "ADMIN", "FINANCE", "DEVELOPER"] as const;
/** A reminder at most this often. */
const REMIND_EVERY_MS = 12 * 60 * 60_000;

type Item = { name: string; qty: number; priceMinor: number };

/** The line items as the customer and the dashboard read them: prices in major units. */
export const itemsOf = (i: Pick<Invoice, "items">) => ((i.items as Item[] | null) ?? []).map((x) => ({ name: x.name, qty: x.qty, price: x.priceMinor / 100 }));

export const invoiceShape = (i: Invoice & { payments?: Payment[] }) => {
  const paid = i.payments?.find((p) => p.status === "PAID");
  return {
    id: i.id,
    number: i.number,
    token: i.token,
    mode: i.mode,
    customerName: i.customerName,
    customerEmail: i.customerEmail,
    currency: i.currency,
    items: itemsOf(i),
    note: i.note,
    amount: i.amountMinor / 100,
    status: i.status,
    dueAt: i.dueAt,
    feePayer: i.feePayer,
    sentAt: i.sentAt,
    viewedAt: i.viewedAt,
    remindedAt: i.remindedAt,
    paidAt: i.paidAt,
    voidedAt: i.voidedAt,
    methods: i.methods,
    accept: i.accept,
    destination: i.destination,
    bankAccountId: i.bankAccountId,
    createdAt: i.createdAt,
    /** Sent again on a schedule: how often, until when, and when the next one goes. */
    repeat: i.repeatEvery ? { every: i.repeatEvery, until: i.repeatUntil, next: i.nextIssueAt } : null,
    /** Sent from a series: the first invoice's id. */
    repeatOf: i.repeatOfId,
    payment: paid ? { ref: paid.ref, method: paid.method, paidAt: paid.paidAt, receivedNgn: paid.receivedKobo != null ? paid.receivedKobo / 100 : null, amountUsd: paid.amountCents / 100 } : null,
  };
};

const createInput = z.object({
  mode: z.enum(["TEST", "LIVE"]),
  customerName: z.string().trim().min(1, "Add the customer's name.").max(120),
  customerEmail: z.string().trim().toLowerCase().email("That email doesn't look right.").max(254),
  currency: z.enum(["NGN", "USD"]),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Name each item.").max(120),
        qty: z.number().int("Quantities are whole numbers.").min(1).max(10_000),
        price: z.number().positive("Each item needs a price above zero.").max(100_000_000),
      }),
    )
    .min(1, "Add at least one item.")
    .max(50, "That's the most items one invoice can have (50)."),
  note: z.string().trim().max(1000).nullish(),
  /** A calendar day, YYYY-MM-DD. */
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Pick a due date."),
  methods: z.array(z.enum(["APP", "CRYPTO", "NAIRA"])).min(1, "Pick at least one way to pay."),
  /** Coins and networks for crypto. Absent or null: every one that's switched on. */
  accept: acceptSchema,
  destination: z.enum(["BANK", "MONEY_MOVES", "WALLET"]),
  bankAccountId: z.string().nullish(),
  /** Who pays the fee on this invoice: BUSINESS, CUSTOMER, or null to follow the business. */
  feePayer: z.enum(["BUSINESS", "CUSTOMER"]).nullish(),
  /** Send it now; otherwise it's saved as a draft. */
  send: z.boolean().optional(),
  /** Send a fresh one on a schedule, until a day (YYYY-MM-DD) or until it's stopped. */
  repeat: z
    .object({
      every: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Pick the last day it repeats.").nullish(),
    })
    .nullish(),
});

/** Where the customer pays: the dashboard the business is using, if it's one of ours. */
function checkoutOrigin(req: Request) {
  const origin = req.get("origin");
  return origin && env.ALLOWED_ORIGINS.includes(origin) ? origin : (env.ALLOWED_ORIGINS[0] ?? "http://localhost:5174");
}

/** Emails the invoice - live invoices only - with the pay link on the dashboard the business is using. */
const emailInvoice = (req: Request, inv: Invoice, businessName: string, reminder: boolean) => emailAny(inv, businessName, reminder, checkoutOrigin(req));
const nextNumber = nextInvoiceNumber;

router.get("/", requireMember(), async (req, res) => {
  const businessId = req.member!.businessId;
  const mode = modeOf(req.query.mode);
  const [invoices, next] = await Promise.all([
    prisma.invoice.findMany({
      // Voided ones are the business's "deleted": kept, but not shown to it.
      where: { businessId, mode, status: { not: "VOID" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { payments: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1 } },
    }),
    // Voided invoices keep their numbers, so the dashboard can't work this out from the list.
    nextNumber(businessId, mode, 0),
  ]);
  res.json({ invoices: invoices.map(invoiceShape), next });
});

router.post("/", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const p = await platform();
  if (!p.channels.invoices) throw new HttpError(503, "New invoices are paused by Money Moves right now. Try again a little later.", "channel_paused");
  const b = body(createInput, req);
  const { destination, bankAccountId, business } = await placesFor(businessId, b.mode, b);
  if (b.mode === "LIVE" && business.status !== "VERIFIED") throw new HttpError(403, "Activate your business to bill real customers. Test invoices work in the meantime.", "business_unverified");

  const due = new Date(`${b.dueAt.slice(0, 10)}T23:59:59+01:00`);
  if (Number.isNaN(due.getTime())) throw new HttpError(400, "Pick a due date.", "bad_due");
  if (due.getTime() < Date.now()) throw new HttpError(400, "The due date can't be in the past.", "bad_due");

  const until = b.repeat?.until ? new Date(`${b.repeat.until.slice(0, 10)}T23:59:59+01:00`) : null;
  if (until && (Number.isNaN(until.getTime()) || until < due)) throw new HttpError(400, "The last day it repeats has to be after the first due date.", "bad_until");

  const items: Item[] = b.items.map((x) => ({ name: x.name, qty: x.qty, priceMinor: toMinor(x.price) }));
  const amountMinor = items.reduce((a, x) => a + x.priceMinor * x.qty, 0);
  // The total, inside what one checkout can be for this kind of business.
  await minorFor(amountMinor / 100, b.currency, "The total", limitsFor(p, business.kind, b.mode));

  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const inv = await prisma.invoice.create({
        data: {
          businessId,
          mode: b.mode,
          number: await nextNumber(businessId, b.mode, attempt),
          token: randomBytes(16).toString("base64url"),
          customerName: b.customerName,
          customerEmail: b.customerEmail,
          currency: b.currency,
          items: items as unknown as Prisma.InputJsonValue,
          note: b.note || null,
          amountMinor,
          methods: b.methods,
          accept: acceptToSave(b.methods, b.accept),
          destination,
          bankAccountId,
          dueAt: due,
          feePayer: b.feePayer ?? null,
          status: b.send ? "OPEN" : "DRAFT",
          // Made and sent in the same moment, so its history never shows it sent before it existed.
          createdAt: now,
          sentAt: b.send ? now : null,
          repeatEvery: b.repeat?.every ?? null,
          repeatUntil: until,
          // The schedule starts when it's sent: a draft waits.
          nextIssueAt: b.repeat && b.send ? advance(now, b.repeat.every) : null,
          createdById: req.auth!.userId,
        },
      });
      const emailed = b.send ? await emailInvoice(req, inv, business.name, false) : false;
      await audit(req, b.send ? "invoice_sent" : "invoice_created", { businessId, detail: { invoiceId: inv.id, number: inv.number, mode: inv.mode, emailed } });
      res.status(201).json({ invoice: invoiceShape(inv), emailed });
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new HttpError(500, "Couldn't save the invoice just now. Try again.", "create_failed");
});

async function invoiceOf(req: Request) {
  const inv = await prisma.invoice.findFirst({ where: { id: String(req.params.invoiceId), businessId: req.member!.businessId, status: { not: "VOID" } }, include: { business: true } });
  if (!inv) throw new HttpError(404, "That invoice isn't here any more.", "not_found");
  return inv;
}

router.post("/:invoiceId/send", requireMember(...MANAGE), async (req, res) => {
  const inv = await invoiceOf(req);
  if (inv.status !== "DRAFT") throw new HttpError(409, "It's already been sent.", "already_sent");
  if (!(await platform()).channels.invoices) throw new HttpError(503, "Invoices are paused by Money Moves right now. Try again a little later.", "channel_paused");
  if (inv.mode === "LIVE" && inv.business.status !== "VERIFIED") throw new HttpError(403, "Activate your business to bill real customers.", "business_unverified");
  const now = new Date();
  const sent = await prisma.invoice.update({ where: { id: inv.id }, data: { status: "OPEN", sentAt: now, ...(inv.repeatEvery ? { nextIssueAt: advance(now, inv.repeatEvery) } : {}) } });
  const emailed = await emailInvoice(req, sent, inv.business.name, false);
  await audit(req, "invoice_sent", { businessId: inv.businessId, detail: { invoiceId: inv.id, number: inv.number, emailed } });
  res.json({ invoice: invoiceShape(sent), emailed });
});

router.post("/:invoiceId/remind", requireMember(...MANAGE), async (req, res) => {
  const inv = await invoiceOf(req);
  if (inv.status !== "OPEN") throw new HttpError(409, inv.status === "PAID" ? "It's been paid." : "Send it first.", "not_open");
  if (inv.remindedAt && Date.now() - inv.remindedAt.getTime() < REMIND_EVERY_MS) {
    throw new HttpError(429, "You reminded them in the last 12 hours. Give them a little time first.", "reminded_recently");
  }
  const reminded = await prisma.invoice.update({ where: { id: inv.id }, data: { remindedAt: new Date() } });
  const emailed = await emailInvoice(req, reminded, inv.business.name, true);
  await audit(req, "invoice_reminded", { businessId: inv.businessId, detail: { invoiceId: inv.id, number: inv.number, emailed } });
  res.json({ invoice: invoiceShape(reminded), emailed });
});

/** No more from this series. The invoices already sent stay as they are. */
router.post("/:invoiceId/stop-repeat", requireMember(...MANAGE), async (req, res) => {
  const inv = await invoiceOf(req);
  if (!inv.repeatEvery) throw new HttpError(400, "This invoice doesn't repeat.", "not_repeating");
  const stopped = await prisma.invoice.update({ where: { id: inv.id }, data: { nextIssueAt: null, repeatUntil: new Date() } });
  await audit(req, "invoice_repeat_stopped", { businessId: inv.businessId, detail: { invoiceId: inv.id, number: inv.number } });
  res.json({ invoice: invoiceShape(stopped) });
});

/** Voided, never deleted: the business stops seeing it, the record stays. */
router.delete("/:invoiceId", requireMember(...MANAGE), async (req, res) => {
  const inv = await invoiceOf(req);
  if (inv.status === "PAID") throw new HttpError(409, "A paid invoice stays. It's part of your records.", "paid");
  // Voiding the first of a series stops it too.
  await prisma.invoice.update({ where: { id: inv.id }, data: { status: "VOID", voidedAt: new Date(), nextIssueAt: null } });
  await audit(req, "invoice_voided", { businessId: inv.businessId, detail: { invoiceId: inv.id, number: inv.number } });
  res.json({ ok: true });
});

export default router;
