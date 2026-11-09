/**
 * Payment links: a page anyone can pay, at an address that never changes.
 *
 * A link belongs to test mode or live mode for good. Test links run on the
 * simulator; live links need a verified business. For now customers pay by
 * bank transfer - the Money Moves app and crypto come next.
 */
import { Router } from "express";
import { z } from "zod";
import { Prisma, type PaymentLink } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { isDev } from "../config/env";
import { limitsFor, platform } from "../lib/platform";
import { acceptSchema, acceptToSave, type Accept } from "../lib/accept";
import { RESERVED, SLUG, minorFor, modeOf as mode, placesFor, slugFrom } from "../lib/checkouts";
import { requireMember } from "../middleware/auth";

const router = Router({ mergeParams: true });
const MANAGE = ["OWNER", "ADMIN", "FINANCE", "DEVELOPER"] as const;

const webAddress = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.protocol === "https:" || (isDev && url.protocol === "http:");
    } catch {
      return false;
    }
  }, "Enter a full web address, starting https://");

const fields = {
  name: z.string().trim().min(1, "Give the link a name.").max(80, "Keep the name under 80 characters."),
  description: z.string().trim().max(280, "Keep the description under 280 characters.").nullish(),
  currency: z.enum(["NGN", "USD"]),
  /** In the link's currency, in major units. Absent or null: the customer types the amount. */
  amount: z.number().positive("Enter an amount above zero.").nullish(),
  min: z.number().positive().nullish(),
  methods: z.array(z.enum(["APP", "CRYPTO", "NAIRA"])).min(1, "Pick at least one way to pay."),
  /** Coins and networks for crypto. Absent or null: every one that's switched on. */
  accept: acceptSchema,
  destination: z.enum(["BANK", "MONEY_MOVES", "WALLET"]),
  bankAccountId: z.string().nullish(),
  redirectUrl: z.union([webAddress, z.literal("")]).nullish(),
  /** The words on the button back to redirectUrl. Empty: "Return to" and the site's name. */
  redirectLabel: z.string().trim().max(40, "Keep the button text to 40 characters.").nullish(),
  askPhone: z.boolean().optional(),
  askName: z.boolean().optional(),
  /** Who pays the fee on this one: BUSINESS, CUSTOMER, or null to follow the business. */
  feePayer: z.enum(["BUSINESS", "CUSTOMER"]).nullish(),
};

const createInput = z.object({ mode: z.enum(["TEST", "LIVE"]), slug: z.string().trim().toLowerCase().optional(), ...fields });
const updateInput = z.object({ ...fields, active: z.boolean() }).partial();

type Stats = { paid: number; collectedCents: number };

export const linkShape = (l: PaymentLink, s?: Stats) => ({
  id: l.id,
  mode: l.mode,
  slug: l.slug,
  name: l.name,
  description: l.description,
  currency: l.currency,
  amount: l.amountMinor != null ? l.amountMinor / 100 : null,
  min: l.minMinor != null ? l.minMinor / 100 : null,
  methods: l.methods,
  accept: l.accept,
  destination: l.destination,
  bankAccountId: l.bankAccountId,
  redirectUrl: l.redirectUrl,
  redirectLabel: l.redirectLabel,
  askPhone: l.askPhone,
  askName: l.askName,
  feePayer: l.feePayer,
  active: l.active,
  createdAt: l.createdAt,
  paid: s?.paid ?? 0,
  collectedUsd: (s?.collectedCents ?? 0) / 100,
});

/** Payments made and money collected, per link. */
async function statsFor(linkIds: string[]): Promise<Map<string, Stats>> {
  if (!linkIds.length) return new Map();
  const rows = await prisma.payment.groupBy({ by: ["linkId"], where: { linkId: { in: linkIds }, status: "PAID" }, _count: { _all: true }, _sum: { amountCents: true } });
  return new Map(rows.map((r) => [r.linkId!, { paid: r._count._all, collectedCents: r._sum.amountCents ?? 0 }]));
}

router.get("/", requireMember(), async (req, res) => {
  // Checkouts made through the API are one-offs, not links the business shares - their payments show in Payments.
  const links = await prisma.paymentLink.findMany({ where: { businessId: req.member!.businessId, mode: mode(req.query.mode), deletedAt: null, apiKeyId: null }, orderBy: { createdAt: "desc" } });
  const stats = await statsFor(links.map((l) => l.id));
  res.json({ links: links.map((l) => linkShape(l, stats.get(l.id))) });
});

router.post("/", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const p = await platform();
  if (!p.channels.links) throw new HttpError(503, "New payment links are paused by Money Moves right now. Try again a little later.", "channel_paused");
  const b = body(createInput, req);
  const { destination, bankAccountId, business } = await placesFor(businessId, b.mode, b);
  if (b.mode === "LIVE" && business.status !== "VERIFIED") throw new HttpError(403, "Activate your business to take real payments. Test links work in the meantime.", "business_unverified");
  const limits = limitsFor(p, business, b.mode);

  const fixed = b.amount != null;
  const data = {
    businessId,
    mode: b.mode,
    name: b.name,
    description: b.description || null,
    currency: b.currency,
    amountMinor: fixed ? await minorFor(b.amount!, b.currency, "The amount", limits) : null,
    minMinor: !fixed && b.min != null ? await minorFor(b.min, b.currency, "The minimum", limits) : null,
    methods: b.methods,
    accept: acceptToSave(b.methods, b.accept),
    destination,
    bankAccountId,
    redirectUrl: b.redirectUrl || null,
    redirectLabel: b.redirectLabel || null,
    askPhone: b.askPhone ?? false,
    askName: b.askName ?? true,
    feePayer: b.feePayer ?? null,
    createdById: req.auth!.userId,
  };

  // Chosen addresses must be free; made-up ones just try again with a few letters added.
  if (b.slug !== undefined && b.slug !== "" && (!SLUG.test(b.slug) || RESERVED.has(b.slug))) throw new HttpError(400, "Use letters, numbers and dashes for the address, 3 to 48 of them.", "bad_slug");
  const chosen = b.slug || null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = chosen ?? (attempt === 0 ? slugFrom(b.name) : `${slugFrom(b.name).slice(0, 40)}-${randomBytes(2).toString("hex")}`);
    try {
      const link = await prisma.paymentLink.create({ data: { ...data, slug } });
      await audit(req, "link_created", { businessId, detail: { linkId: link.id, slug, mode: link.mode } });
      res.status(201).json({ link: linkShape(link) });
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      if (chosen) throw new HttpError(409, "That address is taken. Try another.", "slug_taken");
    }
  }
  throw new HttpError(500, "Couldn't save the link just now. Try again.", "create_failed");
});

router.patch("/:linkId", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const link = await prisma.paymentLink.findFirst({ where: { id: String(req.params.linkId), businessId, deletedAt: null } });
  if (!link) throw new HttpError(404, "That link isn't here any more.", "not_found");
  const b = body(updateInput, req);
  const own = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { kind: true, ownCheckout: true } });
  const limits = limitsFor(await platform(), own, link.mode);
  const currency = b.currency ?? link.currency;
  const data: Prisma.PaymentLinkUncheckedUpdateInput = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.description !== undefined) data.description = b.description || null;
  if (b.currency !== undefined) data.currency = b.currency;
  // A price is in its currency: switching currency without a new price would turn ₦5,000 into $5,000.
  if (b.currency !== undefined && b.currency !== link.currency) {
    if (b.amount === undefined && link.amountMinor != null) throw new HttpError(400, "Enter the amount again in the new currency.", "amount_required");
    if (b.min === undefined) data.minMinor = null;
  }
  if (b.amount !== undefined) {
    data.amountMinor = b.amount == null ? null : await minorFor(b.amount, currency, "The amount", limits);
    if (b.amount != null) data.minMinor = null;
  }
  if (b.min !== undefined) data.minMinor = b.min == null ? null : await minorFor(b.min, currency, "The minimum", limits);
  if (b.redirectUrl !== undefined) data.redirectUrl = b.redirectUrl || null;
  if (b.redirectLabel !== undefined) data.redirectLabel = b.redirectLabel || null;
  if (b.askPhone !== undefined) data.askPhone = b.askPhone;
  if (b.askName !== undefined) data.askName = b.askName;
  if (b.feePayer !== undefined) data.feePayer = b.feePayer;
  if (b.active !== undefined) data.active = b.active;
  if (b.methods !== undefined || b.destination !== undefined || b.bankAccountId !== undefined) {
    const s = await placesFor(businessId, link.mode, { methods: b.methods ?? link.methods, destination: b.destination ?? link.destination, bankAccountId: b.bankAccountId !== undefined ? b.bankAccountId : link.bankAccountId });
    data.methods = b.methods ?? link.methods;
    data.destination = s.destination;
    data.bankAccountId = s.bankAccountId;
  }
  if (b.methods !== undefined || b.accept !== undefined) data.accept = acceptToSave(b.methods ?? link.methods, b.accept !== undefined ? b.accept : (link.accept as Accept | null));
  const saved = await prisma.paymentLink.update({ where: { id: link.id }, data });
  await audit(req, "link_updated", { businessId, detail: { linkId: link.id, fields: Object.keys(data) } });
  const stats = await statsFor([saved.id]);
  res.json({ link: linkShape(saved, stats.get(saved.id)) });
});

/** The address stays taken, so a link someone saved can never open somebody else's checkout. */
router.delete("/:linkId", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const done = await prisma.paymentLink.updateMany({ where: { id: String(req.params.linkId), businessId, deletedAt: null }, data: { deletedAt: new Date(), active: false } });
  if (!done.count) throw new HttpError(404, "That link isn't here any more.", "not_found");
  await audit(req, "link_deleted", { businessId, detail: { linkId: String(req.params.linkId) } });
  res.json({ ok: true });
});

export default router;
