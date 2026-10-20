/**
 * A business's team: who's in it, who's been asked, and the invite link.
 *
 * The owner and admins invite people by email, in any role but owner - a
 * business has one owner, the person who opened it. An admin can't make,
 * change or remove another admin. Whoever is invited signs in (or signs up)
 * with that same email and accepts; the link's token is kept only as a hash.
 *
 * What each role can do is held where the work happens. The business wallet,
 * bank accounts and Money Moves links are the owner's alone, whatever else a
 * role allows.
 */
import { Router } from "express";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import type { Invite, Member, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { dashboardUrl, sendEmail } from "../lib/email";
import { imageUrl } from "../lib/images";
import { requireMember, requireUser } from "../middleware/auth";
import { describe, type ActivityGroup } from "../lib/activity";

/** Inside a business: /api/businesses/:businessId/team */
export const teamRouter = Router({ mergeParams: true });
/** The invite link, before and as it's accepted: /api/invites */
export const invitesRouter = Router();

const INVITE_DAYS = 7;
const MANAGERS = ["OWNER", "ADMIN"] as const;
const INVITABLE = ["ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "VIEWER"] as const;

export const ROLE_WORDS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  FINANCE: "Finance",
  DEVELOPER: "Developer",
  SUPPORT: "Support",
  VIEWER: "Viewer",
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const clean = (email: string) => email.trim().toLowerCase();
const live = (i: Invite) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date();

const inviteShape = (i: Invite) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  invitedAt: i.createdAt,
  expiresAt: i.expiresAt,
  status: i.acceptedAt ? "accepted" : i.revokedAt ? "revoked" : i.expiresAt <= new Date() ? "expired" : "pending",
});

/** Owners and admins manage the team; an admin only the roles under it. */
function canManage(me: Member, role: Role) {
  if (role === "OWNER") return false;
  if (me.role === "OWNER") return true;
  return me.role === "ADMIN" && role !== "ADMIN";
}

async function sendInvite(businessId: string, email: string, role: Role, token: string, inviter: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } });
  const url = dashboardUrl(`/invite/${token}`);
  await sendEmail(
    email,
    `Join ${business.name} on Money Moves Business`,
    `${inviter} invited you to ${business.name} on Money Moves Business, as ${ROLE_WORDS[role].toLowerCase()}.\n\nAccept with this email address, ${email}. If you don't have an account yet, you'll make one first.\n\n${url}\n\nThe link works for ${INVITE_DAYS} days. If you weren't expecting it, you can ignore this email.`,
    { label: "Team", cta: { label: "Accept the invite", url } },
  ).catch(() => false);
}

async function inviterName(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, email: true } });
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.email || "Someone";
}

teamRouter.get("/", requireMember(), async (req, res) => {
  const businessId = req.member!.businessId;
  const [members, invites, business] = await Promise.all([
    prisma.member.findMany({ where: { businessId }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    prisma.invite.findMany({ where: { businessId, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { requireAppTwoStep: true } }),
  ]);
  res.json({
    requireAppTwoStep: business.requireAppTwoStep,
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      addedAt: m.createdAt,
      name: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || null,
      email: m.user.email,
      you: m.userId === req.auth!.userId,
      /** How they sign in: a code by email, or an authenticator app. */
      twoStep: m.user.twoStep,
    })),
    invites: invites.map(inviteShape),
  });
});

teamRouter.post("/invites", requireMember(...MANAGERS), limited(40), async (req, res) => {
  const b = body(z.object({ email: z.string().trim().email("Enter their email address.").max(200), role: z.enum(INVITABLE) }), req);
  const me = req.member!;
  const email = clean(b.email);
  if (!canManage(me, b.role)) throw new HttpError(403, "Only the owner can add an admin.", "forbidden");
  const already = await prisma.member.findFirst({ where: { businessId: me.businessId, user: { email: { equals: email, mode: "insensitive" } } } });
  if (already) throw new HttpError(409, "They're already on the team.", "already_member");
  if ((await prisma.invite.count({ where: { businessId: me.businessId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } })) >= 50) {
    throw new HttpError(429, "That's a lot of invites waiting. Cancel some you don't need first.", "too_many_invites");
  }
  // Asking the same email again replaces the old link.
  await prisma.invite.updateMany({ where: { businessId: me.businessId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomBytes(24).toString("base64url");
  const invite = await prisma.invite.create({
    data: { businessId: me.businessId, email, role: b.role, tokenHash: hash(token), invitedBy: req.auth!.userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
  });
  await sendInvite(me.businessId, email, b.role, token, await inviterName(req.auth!.userId));
  await audit(req, "team_invited", { businessId: me.businessId, detail: { email, role: b.role } });
  res.status(201).json({ invite: inviteShape(invite) });
});

/** A fresh link, sent again: the old one stops working. */
teamRouter.post("/invites/:inviteId/resend", requireMember(...MANAGERS), limited(40), async (req, res) => {
  const me = req.member!;
  const old = await prisma.invite.findFirst({ where: { id: String(req.params.inviteId), businessId: me.businessId, acceptedAt: null, revokedAt: null } });
  if (!old) throw new HttpError(404, "That invite isn't waiting any more.", "not_found");
  if (!canManage(me, old.role)) throw new HttpError(403, "Only the owner can add an admin.", "forbidden");
  const token = randomBytes(24).toString("base64url");
  const invite = await prisma.invite.update({ where: { id: old.id }, data: { tokenHash: hash(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
  await sendInvite(me.businessId, invite.email, invite.role, token, await inviterName(req.auth!.userId));
  res.json({ invite: inviteShape(invite) });
});

teamRouter.post("/invites/:inviteId/cancel", requireMember(...MANAGERS), async (req, res) => {
  const me = req.member!;
  const old = await prisma.invite.findFirst({ where: { id: String(req.params.inviteId), businessId: me.businessId, acceptedAt: null, revokedAt: null } });
  if (!old) throw new HttpError(404, "That invite isn't waiting any more.", "not_found");
  if (!canManage(me, old.role)) throw new HttpError(403, "Only the owner can change an admin's invite.", "forbidden");
  await prisma.invite.update({ where: { id: old.id }, data: { revokedAt: new Date() } });
  await audit(req, "team_invite_cancelled", { businessId: me.businessId, detail: { email: old.email } });
  res.json({ ok: true });
});

teamRouter.patch("/members/:memberId", requireMember(...MANAGERS), async (req, res) => {
  const b = body(z.object({ role: z.enum(INVITABLE) }), req);
  const me = req.member!;
  const m = await prisma.member.findFirst({ where: { id: String(req.params.memberId), businessId: me.businessId }, include: { user: { select: { email: true } } } });
  if (!m) throw new HttpError(404, "They aren't on the team.", "not_found");
  if (m.id === me.id) throw new HttpError(400, "You can't change your own role.", "self");
  if (!canManage(me, m.role) || !canManage(me, b.role)) throw new HttpError(403, m.role === "OWNER" ? "The owner's role can't be changed." : "Only the owner can make or change an admin.", "forbidden");
  const saved = await prisma.member.update({ where: { id: m.id }, data: { role: b.role } });
  await audit(req, "team_role_changed", { businessId: me.businessId, detail: { memberId: m.id, email: m.user.email, from: m.role, to: b.role } });
  res.json({ member: { id: saved.id, role: saved.role } });
});

/** Removed by an owner or admin, or leaving by themselves. The owner can't be removed and can't leave. */
teamRouter.delete("/members/:memberId", requireMember(), async (req, res) => {
  const me = req.member!;
  const m = await prisma.member.findFirst({ where: { id: String(req.params.memberId), businessId: me.businessId }, include: { user: { select: { email: true } } } });
  if (!m) throw new HttpError(404, "They aren't on the team.", "not_found");
  if (m.role === "OWNER") throw new HttpError(403, "The owner can't be removed.", "forbidden");
  const leaving = m.id === me.id;
  if (!leaving && !canManage(me, m.role)) throw new HttpError(403, "Only the owner can remove an admin.", "forbidden");
  await prisma.member.delete({ where: { id: m.id } });
  await audit(req, leaving ? "team_left" : "team_removed", { businessId: me.businessId, detail: { memberId: m.id, email: m.user.email, role: m.role } });
  res.json({ ok: true });
});

/**
 * The owner's rule: everyone on the team signs in with an authenticator app.
 * Turning it on needs the owner's own app first, so they can't lock themselves out.
 * Anyone without one is asked to set it up before they can open the business.
 */
teamRouter.patch("/security", requireMember("OWNER"), async (req, res) => {
  const b = body(z.object({ requireAppTwoStep: z.boolean() }), req);
  const me = req.member!;
  if (b.requireAppTwoStep) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { twoStep: true } });
    if (user.twoStep !== "APP") throw new HttpError(400, "Turn on your own authenticator app first, in your profile.", "owner_needs_app");
  }
  await prisma.business.update({ where: { id: me.businessId }, data: { requireAppTwoStep: b.requireAppTwoStep } });
  await audit(req, b.requireAppTwoStep ? "team_app_required" : "team_app_optional", { businessId: me.businessId });
  res.json({ requireAppTwoStep: b.requireAppTwoStep });
});

// ─── Activity ─────────────────────────────────────────────────────────────

/**
 * What the team has done, newest first, in words: invites and roles, refunds
 * and dispute replies, payout places and settings, links and invoices, keys
 * and webhooks, and the business wallet. For the owner and admins.
 */
teamRouter.get("/activity", requireMember(...MANAGERS), limited(240), async (req, res) => {
  const me = req.member!;
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  const who = typeof req.query.who === "string" && req.query.who ? req.query.who : null;
  const group = typeof req.query.group === "string" ? (req.query.group as ActivityGroup) : null;
  const PAGE = 50;
  const out: { id: string; at: Date; text: string; group: ActivityGroup; who: { id: string; name: string | null; email: string } | null }[] = [];
  let cursor = before;
  let exhausted = false;
  // Our team's own entries aren't shown: read on until a page is full.
  for (let round = 0; round < 6 && out.length < PAGE; round++) {
    const rows = await prisma.auditLog.findMany({
      where: { businessId: me.businessId, NOT: { action: { startsWith: "admin_" } }, ...(who ? { userId: who } : {}), ...(cursor ? { createdAt: { lt: cursor } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (!rows.length) {
      exhausted = true;
      break;
    }
    cursor = rows[rows.length - 1]!.createdAt;
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))] } }, select: { id: true, email: true, firstName: true, lastName: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const r of rows) {
      const d = describe(r.action, (r.detail as Record<string, unknown> | null) ?? null);
      if (!d || (group && d.group !== group)) continue;
      const u = r.userId ? byId.get(r.userId) : undefined;
      out.push({ id: r.id, at: r.createdAt, text: d.text, group: d.group, who: u ? { id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null, email: u.email } : null });
      if (out.length >= PAGE) break;
    }
    if (rows.length < 100) {
      exhausted = true;
      break;
    }
  }
  // Where the next page starts: after the last entry shown, or after the last one read when nothing on this page was shown.
  const next = out.length >= PAGE ? out[out.length - 1]!.at : exhausted ? null : cursor;
  res.json({ activity: out, next });
});

// ─── The invite link ──────────────────────────────────────────────────────

async function inviteByToken(token: string) {
  const i = token.length >= 20 && token.length <= 64 ? await prisma.invite.findUnique({ where: { tokenHash: hash(token) }, include: { business: { select: { id: true, name: true, logoId: true } } } }) : null;
  if (!i || i.revokedAt) throw new HttpError(404, "This invite isn't valid any more. Ask for a new one.", "invite_invalid");
  return i;
}

/** What the link is for, so the page can say who's asking before anyone signs in. */
invitesRouter.get("/:token", limited(60), async (req, res) => {
  const i = await inviteByToken(String(req.params.token));
  res.json({
    invite: {
      business: { name: i.business.name, logo: imageUrl(i.business.logoId) },
      email: i.email,
      role: i.role,
      status: i.acceptedAt ? "accepted" : i.expiresAt <= new Date() ? "expired" : "pending",
    },
  });
});

invitesRouter.post("/:token/accept", requireUser, limited(30), async (req, res) => {
  const i = await inviteByToken(String(req.params.token));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { id: true, email: true } });
  if (clean(user.email) !== clean(i.email)) throw new HttpError(403, `This invite is for ${i.email}. Sign in with that email to accept it.`, "wrong_email");
  const existing = await prisma.member.findUnique({ where: { businessId_userId: { businessId: i.businessId, userId: user.id } } });
  if (existing) {
    res.json({ businessId: i.businessId, role: existing.role });
    return;
  }
  if (i.acceptedAt) throw new HttpError(409, "This invite has already been used.", "invite_used");
  if (!live(i)) throw new HttpError(410, "This invite has expired. Ask for a new one.", "invite_expired");
  // Once: the invite is claimed and the member made together.
  const member = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({ where: { id: i.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date(), acceptedBy: user.id } });
    if (!claimed.count) throw new HttpError(409, "This invite has already been used.", "invite_used");
    return tx.member.create({ data: { businessId: i.businessId, userId: user.id, role: i.role } });
  });
  await audit(req, "team_joined", { businessId: i.businessId, detail: { role: member.role } });
  res.json({ businessId: i.businessId, role: member.role });
});
