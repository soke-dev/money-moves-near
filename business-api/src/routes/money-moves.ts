/**
 * Money Moves accounts a business can be paid to (Payout places), up to five.
 * Asked for by username; linked only once the account's owner approves it in
 * the app. Ending one ends it on both sides; the record is kept.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import type { MoneyMovesLink } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { requestLink, revokeLink } from "../lib/app-links";
import { publicImageUrl } from "../lib/images";
import { syncLink } from "../services/money-moves";
import { requireMember } from "../middleware/auth";

const router = Router({ mergeParams: true });
/** Only the owner links, changes or removes a Money Moves account. */
const MANAGE = ["OWNER"] as const;
export const MAX_MM = 2;
/** Each request notifies a person in the app: a few an hour is plenty. */
const asking = limited(20, 60 * 60_000);

export const linkShape = (l: MoneyMovesLink) => ({
  id: l.id,
  username: l.username,
  status: l.status,
  isDefault: l.isDefault,
  createdAt: l.createdAt,
  linkedAt: l.linkedAt,
});

const current = (businessId: string) =>
  prisma.moneyMovesLink.findMany({ where: { businessId, status: { in: ["PENDING", "LINKED"] } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });

router.get("/", requireMember(), async (req, res) => {
  res.json({ accounts: (await current(req.member!.businessId)).map(linkShape), max: MAX_MM });
});

router.post("/", requireMember(...MANAGE), asking, async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ username: z.string().trim().min(2, "Type the Money Moves username.").max(40) }), req);
  const username = b.username.replace(/^@/, "").toLowerCase();
  const open = await current(businessId);
  if (open.length >= MAX_MM) throw new HttpError(409, `That's the most, ${MAX_MM} Money Moves accounts. Unlink one first.`, "too_many_accounts");
  if (open.some((l) => l.username.toLowerCase() === username)) throw new HttpError(409, "That account is already linked, or waiting for approval.", "already");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const app = await requestLink({ businessId, businessName: business.name, businessLogo: publicImageUrl(business.logoId), merchantId: business.merchantId, username, requestedBy: req.auth!.userId });
  const link = await prisma.moneyMovesLink.create({ data: { businessId, username: app.username ?? username, appLinkId: app.id, requestedBy: req.auth!.userId } });
  await audit(req, "money_moves_requested", { businessId, detail: { linkId: link.id, username: link.username } });
  res.status(201).json({ account: linkShape(link) });
});

async function linkOf(req: Request) {
  const l = await prisma.moneyMovesLink.findFirst({ where: { id: String(req.params.linkId), businessId: req.member!.businessId } });
  if (!l) throw new HttpError(404, "That account isn't here any more.", "not_found");
  return l;
}

/** "I've approved it" - ask the app now rather than at the next round. */
router.post("/:linkId/check", requireMember(), limited(60), async (req, res) => {
  res.json({ account: linkShape(await syncLink(await linkOf(req))) });
});

router.post("/:linkId/default", requireMember(...MANAGE), async (req, res) => {
  const l = await linkOf(req);
  if (l.status !== "LINKED") throw new HttpError(409, "Only a linked account can be the default.", "not_linked");
  await prisma.$transaction([
    prisma.moneyMovesLink.updateMany({ where: { businessId: l.businessId, isDefault: true }, data: { isDefault: false } }),
    prisma.moneyMovesLink.update({ where: { id: l.id }, data: { isDefault: true } }),
  ]);
  res.json({ ok: true });
});

/** Unlinked (or a request cancelled): ended on both sides, kept on record. */
router.delete("/:linkId", requireMember(...MANAGE), async (req, res) => {
  const l = await linkOf(req);
  if (l.status !== "PENDING" && l.status !== "LINKED") throw new HttpError(409, "It's already ended.", "ended");
  await revokeLink(l.appLinkId).catch(() => {
    /* ended here either way; the app's side is asked again by the worker */
  });
  await prisma.moneyMovesLink.update({ where: { id: l.id }, data: { status: "UNLINKED", isDefault: false, endedAt: new Date() } });
  const rest = await prisma.moneyMovesLink.findMany({ where: { businessId: l.businessId, status: "LINKED" }, orderBy: { linkedAt: "asc" } });
  if (l.isDefault && rest[0]) await prisma.moneyMovesLink.update({ where: { id: rest[0].id }, data: { isDefault: true } });
  await audit(req, "money_moves_unlinked", { businessId: l.businessId, detail: { linkId: l.id, username: l.username } });
  res.json({ ok: true });
});

export default router;
