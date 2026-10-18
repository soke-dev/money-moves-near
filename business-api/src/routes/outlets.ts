/**
 * Outlets: a till or a shop, with a QR for the counter and a link. Customers
 * scan or tap, type the amount, and pay.
 *
 * An outlet keeps its address for life - the poster on the counter depends on
 * it - so it never changes, and a deleted outlet's address is never given to
 * another. Deleting one switches it off for good; the row stays, like every
 * record a business has. An outlet belongs to test mode or live mode for good;
 * live ones need a verified business.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, type Outlet } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { platform } from "../lib/platform";
import { acceptSchema, acceptToSave, type Accept } from "../lib/accept";
import { RESERVED, SLUG, modeOf, placesFor, slugFrom } from "../lib/checkouts";
import { requireMember } from "../middleware/auth";

const router = Router({ mergeParams: true });
const MANAGE = ["OWNER", "ADMIN", "FINANCE", "DEVELOPER"] as const;

const fields = {
  name: z.string().trim().min(1, "Name the outlet.").max(80, "Keep the name under 80 characters."),
  location: z.string().trim().min(1, "Add where it is. It goes on the counter poster.").max(120),
  currency: z.enum(["NGN", "USD"]),
  methods: z.array(z.enum(["APP", "CRYPTO", "NAIRA"])).min(1, "Pick at least one way to pay."),
  /** Coins and networks for crypto. Absent or null: every one that's switched on. */
  accept: acceptSchema,
  destination: z.enum(["BANK", "MONEY_MOVES", "WALLET"]),
  bankAccountId: z.string().nullish(),
  staffEmail: z.union([z.string().trim().toLowerCase().email("That email doesn't look right.").max(254), z.literal("")]).nullish(),
  askName: z.boolean().optional(),
  /** Who pays the fee on this one: BUSINESS, CUSTOMER, or null to follow the business. */
  feePayer: z.enum(["BUSINESS", "CUSTOMER"]).nullish(),
};
const createInput = z.object({ mode: z.enum(["TEST", "LIVE"]), slug: z.string().trim().toLowerCase().optional(), ...fields });
const updateInput = z.object({ ...fields, active: z.boolean() }).partial();

type Stats = { payments: number; collectedNgn: number; collectedUsd: number };

export const outletShape = (o: Outlet, s?: Stats) => ({
  id: o.id,
  mode: o.mode,
  slug: o.slug,
  name: o.name,
  location: o.location,
  currency: o.currency,
  methods: o.methods,
  accept: o.accept,
  destination: o.destination,
  bankAccountId: o.bankAccountId,
  staffEmail: o.staffEmail,
  askName: o.askName,
  feePayer: o.feePayer,
  active: o.active,
  deleted: !!o.deletedAt,
  createdAt: o.createdAt,
  payments: s?.payments ?? 0,
  collectedNgn: s?.collectedNgn ?? 0,
  collectedUsd: s?.collectedUsd ?? 0,
});

/** Payments taken and money collected, per outlet. */
export async function outletStats(ids: string[]): Promise<Map<string, Stats>> {
  if (!ids.length) return new Map();
  const rows = await prisma.payment.groupBy({ by: ["outletId"], where: { outletId: { in: ids }, status: "PAID" }, _count: { _all: true }, _sum: { receivedKobo: true, amountCents: true } });
  return new Map(rows.map((r) => [r.outletId!, { payments: r._count._all, collectedNgn: (r._sum.receivedKobo ?? 0) / 100, collectedUsd: (r._sum.amountCents ?? 0) / 100 }]));
}

router.get("/", requireMember(), async (req, res) => {
  const outlets = await prisma.outlet.findMany({ where: { businessId: req.member!.businessId, mode: modeOf(req.query.mode), deletedAt: null }, orderBy: { createdAt: "desc" } });
  const stats = await outletStats(outlets.map((o) => o.id));
  res.json({ outlets: outlets.map((o) => outletShape(o, stats.get(o.id))) });
});

router.post("/", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  if (!(await platform()).channels.outlets) throw new HttpError(503, "New outlets are paused by Money Moves right now. Try again a little later.", "channel_paused");
  const b = body(createInput, req);
  const { destination, bankAccountId, business } = await placesFor(businessId, b.mode, b);
  if (b.mode === "LIVE" && business.status !== "VERIFIED") throw new HttpError(403, "Activate your business to take real payments. Test outlets work in the meantime.", "business_unverified");
  if (b.slug !== undefined && b.slug !== "" && (!SLUG.test(b.slug) || RESERVED.has(b.slug))) throw new HttpError(400, "Use letters, numbers and dashes for the address, 3 to 48 of them.", "bad_slug");
  const chosen = b.slug || null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = chosen ?? (attempt === 0 ? slugFrom(b.name, "store") : `${slugFrom(b.name, "store").slice(0, 40)}-${randomBytes(2).toString("hex")}`);
    try {
      const outlet = await prisma.outlet.create({
        data: {
          businessId,
          mode: b.mode,
          slug,
          name: b.name,
          location: b.location,
          currency: b.currency,
          methods: b.methods,
          accept: acceptToSave(b.methods, b.accept),
          askName: b.askName ?? true,
          feePayer: b.feePayer ?? null,
          destination,
          bankAccountId,
          staffEmail: b.staffEmail || null,
          createdById: req.auth!.userId,
        },
      });
      await audit(req, "outlet_created", { businessId, detail: { outletId: outlet.id, slug, mode: outlet.mode } });
      res.status(201).json({ outlet: outletShape(outlet) });
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      if (chosen) throw new HttpError(409, "That address is taken. Try another.", "slug_taken");
    }
  }
  throw new HttpError(500, "Couldn't save the outlet just now. Try again.", "create_failed");
});

async function outletOf(req: Request) {
  const o = await prisma.outlet.findFirst({ where: { id: String(req.params.outletId), businessId: req.member!.businessId, deletedAt: null } });
  if (!o) throw new HttpError(404, "That outlet isn't here any more.", "not_found");
  return o;
}

router.patch("/:outletId", requireMember(...MANAGE), async (req, res) => {
  const o = await outletOf(req);
  const b = body(updateInput, req);
  const data: Prisma.OutletUncheckedUpdateInput = {};
  if (b.askName !== undefined) data.askName = b.askName;
  if (b.feePayer !== undefined) data.feePayer = b.feePayer;
  if (b.name !== undefined) data.name = b.name;
  if (b.location !== undefined) data.location = b.location;
  if (b.currency !== undefined) data.currency = b.currency;
  if (b.staffEmail !== undefined) data.staffEmail = b.staffEmail || null;
  if (b.active !== undefined) data.active = b.active;
  if (b.methods !== undefined || b.destination !== undefined || b.bankAccountId !== undefined) {
    const places = await placesFor(o.businessId, o.mode, { methods: b.methods ?? o.methods, destination: b.destination ?? o.destination, bankAccountId: b.bankAccountId !== undefined ? b.bankAccountId : o.bankAccountId });
    data.methods = b.methods ?? o.methods;
    data.destination = places.destination;
    data.bankAccountId = places.bankAccountId;
  }
  if (b.methods !== undefined || b.accept !== undefined) data.accept = acceptToSave(b.methods ?? o.methods, b.accept !== undefined ? b.accept : (o.accept as Accept | null));
  const saved = await prisma.outlet.update({ where: { id: o.id }, data });
  await audit(req, "outlet_updated", { businessId: o.businessId, detail: { outletId: o.id, fields: Object.keys(data) } });
  const stats = await outletStats([saved.id]);
  res.json({ outlet: outletShape(saved, stats.get(saved.id)) });
});

/** Off for good, its address kept so a poster still on a counter can never open someone else's checkout. */
router.delete("/:outletId", requireMember(...MANAGE), async (req, res) => {
  const o = await outletOf(req);
  await prisma.outlet.update({ where: { id: o.id }, data: { deletedAt: new Date(), active: false } });
  await audit(req, "outlet_deleted", { businessId: o.businessId, detail: { outletId: o.id, slug: o.slug } });
  res.json({ ok: true });
});

export default router;
