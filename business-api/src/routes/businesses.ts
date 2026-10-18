/**
 * Businesses and who's in them.
 *
 * Anyone signed in can start a business and becomes its owner. Everything
 * under /:businessId checks membership first; roles narrow it further.
 */
import express, { Router } from "express";
import { z } from "zod";
import { Prisma, type Business, type Member } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { newMerchantId } from "../lib/crypto";
import { audit } from "../lib/audit";
import { requireMember, requireUser } from "../middleware/auth";
import { platform } from "../lib/platform";
import { ngnPerUsd } from "../lib/rates";
import { canSimulate } from "../rails";
import { limitsNgn } from "./pay";
import { brandOf } from "../lib/brand";
import { MAX_IMAGE, imageUrl, storeImage } from "../lib/images";
import { newReferralCode } from "../lib/money";
import { dashboardUrl } from "../lib/email";

const router = Router();

const summary = (b: Business) => ({ id: b.id, name: b.name, kind: b.kind, merchantId: b.merchantId, status: b.status, country: b.country, settleChain: b.settleChain, createdAt: b.createdAt, verifiedAt: verifiedAt(b), logo: imageUrl(b.logoId), feePayer: b.feePayer });
/** When our team approved it - for the dashboard's notification and its one-time "you're approved" notice. */
const verifiedAt = (b: Business) => (b.status === "VERIFIED" ? (b.statusChangedAt ?? b.updatedAt) : null);
const forMember = (m: Pick<Member, "role" | "liveNoticeClosedAt">) => ({ role: m.role, liveNoticeClosed: !!m.liveNoticeClosedAt });

router.get("/", requireUser, async (req, res) => {
  const ms = await prisma.member.findMany({ where: { userId: req.auth!.userId }, include: { business: true }, orderBy: { createdAt: "asc" } });
  res.json({ businesses: ms.map((m) => ({ ...summary(m.business), ...forMember(m) })) });
});

router.post("/", requireUser, async (req, res) => {
  const b = body(
    z.object({
      name: z.string().trim().min(2, "Enter the business name.").max(120),
      kind: z.enum(["REGISTERED", "INDIVIDUAL"]),
      /** Another business's referral code, from its link or typed in. */
      ref: z.string().trim().max(32).optional(),
    }),
    req,
  );
  if (!(await platform()).newBusinesses) throw new HttpError(503, "New businesses can't be opened right now. Try again a little later.", "new_businesses_paused");
  // A code that doesn't match anyone is let go quietly: it never stops a business being opened.
  const code = b.ref?.replace(/\s+/g, "").toUpperCase();
  const referrer = code ? await prisma.business.findUnique({ where: { referralCode: code }, select: { id: true } }) : null;
  // A merchant id clash is vanishingly rare; a few tries makes it impossible in practice.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const business = await prisma.business.create({
        data: { name: b.name, kind: b.kind, merchantId: newMerchantId(), referredById: referrer?.id ?? null, members: { create: { userId: req.auth!.userId, role: "OWNER" } } },
      });
      await audit(req, "business_created", { businessId: business.id, detail: { name: business.name, kind: business.kind } });
      res.status(201).json({ business: { ...summary(business), role: "OWNER", liveNoticeClosed: false } });
      return;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  throw new HttpError(500, "Couldn't create the business just now. Try again.", "create_failed");
});

router.get("/:businessId", requireMember(), async (req, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.member!.businessId } });
  res.json({ business: { ...summary(business), ...forMember(req.member!) } });
});

/**
 * The fees this business pays today, as set in admin: the platform's rates,
 * with this business's own naira rate and cap when our team has set one - and
 * who pays them by default.
 */
router.get("/:businessId/fees", requireMember(), async (req, res) => {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: req.member!.businessId }, select: { feeRateBps: true, feeCapKobo: true, feePayer: true } });
  const p = await platform();
  res.json({
    fees: {
      naira: { rateBps: b.feeRateBps ?? p.fees.nairaRateBps, capNgn: b.feeCapKobo != null ? b.feeCapKobo / 100 : p.fees.nairaCapNgn },
      crypto: { rateBps: p.fees.cryptoRateBps, capUsd: p.fees.cryptoCapUsd },
      app: { rateBps: p.fees.appRateBps },
      payoutNgn: p.fees.payoutNgn,
    },
    payer: b.feePayer,
  });
});

/** Who pays the processing fee - from the next payment on. Owners, admins and finance decide. */
router.patch("/:businessId/fees", requireMember("OWNER", "ADMIN", "FINANCE"), async (req, res) => {
  const b = body(z.object({ payer: z.enum(["BUSINESS", "CUSTOMER"]) }), req);
  const business = await prisma.business.update({ where: { id: req.member!.businessId }, data: { feePayer: b.payer } });
  await audit(req, "fee_payer_changed", { businessId: business.id, detail: { payer: b.payer } });
  res.json({ business: { ...summary(business), ...forMember(req.member!) } });
});

/** How its checkout looks: logo, colours, the line after a payment. */
router.get("/:businessId/branding", requireMember(), async (req, res) => {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: req.member!.businessId } });
  res.json({ brand: brandOf(b) });
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #121210.");
router.patch("/:businessId/branding", requireMember("OWNER", "ADMIN"), async (req, res) => {
  const b = body(z.object({ surface: hex, accent: hex, success: z.string().trim().max(280) }), req);
  const brand = { surface: b.surface.toUpperCase(), accent: b.accent.toUpperCase(), success: b.success };
  const business = await prisma.business.update({ where: { id: req.member!.businessId }, data: { brand } });
  await audit(req, "branding_changed", { businessId: business.id, detail: brand });
  res.json({ brand: brandOf(business) });
});

/** The logo is the request body: PNG, JPEG or WebP. */
router.put("/:businessId/branding/logo", requireMember("OWNER", "ADMIN"), express.raw({ type: () => true, limit: MAX_IMAGE }), async (req, res) => {
  const logoId = await storeImage(req.body, req.auth!.userId);
  const business = await prisma.business.update({ where: { id: req.member!.businessId }, data: { logoId } });
  await audit(req, "logo_changed", { businessId: business.id, detail: { logoId } });
  res.json({ brand: brandOf(business) });
});

router.delete("/:businessId/branding/logo", requireMember("OWNER", "ADMIN"), async (req, res) => {
  const business = await prisma.business.update({ where: { id: req.member!.businessId }, data: { logoId: null } });
  await audit(req, "logo_removed", { businessId: business.id });
  res.json({ brand: brandOf(business) });
});

/** Closes the "you're approved" notice for this person, for good. */
router.post("/:businessId/live-notice/close", requireMember(), async (req, res) => {
  await prisma.member.update({ where: { id: req.member!.id }, data: { liveNoticeClosedAt: new Date() } });
  res.json({ ok: true });
});

/** What the builders' preview needs to draw a checkout as customers will see it: today's rate and this business's limits. */
router.get("/:businessId/checkout-preview", requireMember(), async (req, res) => {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: req.member!.businessId } });
  const mode = req.query.mode === "LIVE" ? "LIVE" : "TEST";
  const rate = await ngnPerUsd().catch(() => null);
  res.json({ rate, limits: limitsNgn(await platform(), business.kind, mode), simulator: canSimulate(mode) });
});

/**
 * Where crypto settles: USDC on Movement, Arc or Monad. Whatever chain a
 * customer pays on, the payment lands in our treasury and the business gets
 * USDC on this one. Owners, admins and finance can change it; it applies to
 * payments from then on.
 */
router.patch("/:businessId/settlement", requireMember("OWNER", "ADMIN", "FINANCE"), async (req, res) => {
  const b = body(z.object({ settleChain: z.enum(["MOVEMENT", "ARC", "MONAD", "SOLANA", "STELLAR"]) }), req);
  // Movement is the default and can always be picked; while it's paused its payouts wait in the queue.
  if (b.settleChain !== "MOVEMENT" && !(await platform()).settleChains[b.settleChain]) throw new HttpError(400, "That chain isn't available right now. Pick another.", "chain_paused");
  const business = await prisma.business.update({ where: { id: req.member!.businessId }, data: { settleChain: b.settleChain } });
  await audit(req, "settlement_chain_changed", { businessId: business.id, detail: { settleChain: b.settleChain } });
  res.json({ business: { ...summary(business), ...forMember(req.member!) } });
});

/**
 * Referrals: this business's own link, and how each business that signed up
 * with it is getting on - signed up, sent for review, verified, taking real
 * payments. The code is made the first time it's asked for.
 */
router.get("/:businessId/referrals", requireMember("OWNER", "ADMIN"), async (req, res) => {
  const businessId = req.member!.businessId;
  let { referralCode } = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { referralCode: true } });
  for (let attempt = 0; !referralCode && attempt < 5; attempt++) {
    try {
      referralCode = (await prisma.business.update({ where: { id: businessId }, data: { referralCode: newReferralCode() } })).referralCode;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  const invited = await prisma.business.findMany({
    where: { referredById: businessId },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, name: true, status: true, createdAt: true, statusChangedAt: true, application: { select: { submittedAt: true } } },
  });
  const paying = new Set(
    (await prisma.payment.groupBy({ by: ["businessId"], where: { businessId: { in: invited.map((x) => x.id) }, mode: "LIVE", status: { in: ["PAID", "UNDERPAID"] } } })).map((x) => x.businessId),
  );
  res.json({
    code: referralCode,
    link: dashboardUrl(`/signup?ref=${referralCode}`),
    businesses: invited.map((x) => ({
      name: x.name,
      joinedAt: x.createdAt,
      stage: paying.has(x.id) ? "paying" : x.status === "VERIFIED" ? "verified" : x.status === "IN_REVIEW" || x.application?.submittedAt ? "review" : "joined",
    })),
  });
});

router.get("/:businessId/members", requireMember(), async (req, res) => {
  const ms = await prisma.member.findMany({ where: { businessId: req.member!.businessId }, include: { user: true }, orderBy: { createdAt: "asc" } });
  res.json({
    members: ms.map((m) => ({ id: m.id, role: m.role, addedAt: m.createdAt, name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || null, email: m.user.email })),
  });
});

export default router;
