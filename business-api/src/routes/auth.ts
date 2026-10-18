/**
 * Signing in to Money Moves Business.
 *
 * Two ways in: an email and password followed by a six-digit code (2-step,
 * always on), or Google. Business users are not Money Moves app users - this
 * is its own sign-in, and Dynamic plays no part in it (Dynamic only creates
 * the business wallet once a business is activated, and signs from it).
 *
 * Sign-in says so when an email has no account - a plain answer beats a
 * puzzling one. The per-address limit below keeps anyone from checking emails
 * in bulk. Sign-up and "forgot password" still answer the same way either way.
 */
import express, { Router, type Request } from "express";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { checkCode, CODE_ERRORS, decoyChallenge, issueCode } from "../lib/codes";
import { endOtherSessions, endSession, startSession } from "../lib/session";
import { verifyGoogle } from "../lib/google";
import { sendEmail, welcomeEmail } from "../lib/email";
import { audit } from "../lib/audit";
import { requireUser } from "../middleware/auth";
import { limited } from "../lib/limits";
import { checkSignupEmail } from "../lib/email-check";
import { MAX_IMAGE, imageUrl, storeImage } from "../lib/images";

const router = Router();

const email = z.string().trim().toLowerCase().email("Enter a valid email.").max(254);
const password = z.string().min(10, "Use at least 10 characters.").max(200, "That password is too long.");
const name = z.string().trim().min(1, "Enter your name.").max(60);
const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");
const challenge = z.string().uuid("That code request isn't valid any more. Ask for a new one.");

// Brute force: per address, a handful of tries a quarter-hour. Codes have their own limit per challenge too.
const authLimiter = limited(30);
const codeLimiter = limited(40);

/** The person as the dashboard sees them - never a hash or a Google id. */
const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  phone: u.phone,
  twoStep: u.twoStep,
  hasPassword: !!u.passwordHash,
  google: !!u.googleSub,
  passwordChangedAt: u.passwordChangedAt,
  avatar: imageUrl(u.avatarId),
});

async function me(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { include: { business: true }, orderBy: { createdAt: "asc" } } } });
  return {
    user: publicUser(user),
    businesses: user.memberships.map((m) => ({ id: m.business.id, name: m.business.name, kind: m.business.kind, merchantId: m.business.merchantId, status: m.business.status, settleChain: m.business.settleChain, role: m.role, verifiedAt: m.business.status === "VERIFIED" ? (m.business.statusChangedAt ?? m.business.updatedAt) : null, liveNoticeClosed: !!m.liveNoticeClosedAt, logo: imageUrl(m.business.logoId), feePayer: m.business.feePayer })),
  };
}

const failCode = (reason: keyof typeof CODE_ERRORS): never => {
  throw new HttpError(400, CODE_ERRORS[reason], `code_${reason}`);
};

// ─── Sign up ──────────────────────────────────────────────────────────────

router.post("/signup", authLimiter, async (req, res) => {
  // Names are optional here: they come off the ID during verification.
  const b = body(z.object({ email, password, firstName: name.optional(), lastName: name.optional() }), req);
  // A real inbox only - temporary ones are what scripted sign-ups use. See lib/email-check.
  const verdict = await checkSignupEmail(b.email);
  if (!verdict.ok) {
    throw new HttpError(
      400,
      verdict.reason === "disposable"
        ? "Use an email address you'll keep. Temporary inboxes can't open a business account."
        : "That email address can't receive mail. Check it and try again.",
      "email_not_accepted",
    );
  }
  const existing = await prisma.user.findUnique({ where: { email: b.email } });
  if (existing?.emailVerified) {
    // Answer as if it worked; tell the real owner by email instead.
    await sendEmail(b.email, "You already have a Money Moves Business account", "Someone tried to sign up with this email. If it was you, sign in instead, or reset your password if you've forgotten it.");
    res.json({ challenge: decoyChallenge() });
    return;
  }
  const passwordHash = await hash(b.password, 12);
  // An unconfirmed address can be claimed again: only whoever reads the email can finish.
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, firstName: b.firstName ?? existing.firstName, lastName: b.lastName ?? existing.lastName } })
    : await prisma.user.create({ data: { email: b.email, passwordHash, firstName: b.firstName ?? null, lastName: b.lastName ?? null } });
  res.json({ challenge: await issueCode(user, "VERIFY_EMAIL") });
});

/** The email-confirmation code - after sign-up, or when an unconfirmed person signs in. */
router.post("/signup/verify", codeLimiter, async (req, res) => {
  const b = body(z.object({ challenge, code }), req);
  const r = await checkCode(b.challenge, b.code, "VERIFY_EMAIL");
  if (!r.ok) return failCode(r.reason);
  const confirmed = await prisma.user.update({ where: { id: r.userId }, data: { emailVerified: new Date() } });
  await startSession(req, res, r.userId, "password");
  await audit(req, "signed_up", { userId: r.userId });
  const hello = welcomeEmail(confirmed.firstName);
  void sendEmail(confirmed.email, hello.subject, hello.text, { html: hello.html }).catch(() => {});
  res.json(await me(r.userId));
});

// ─── Sign in ──────────────────────────────────────────────────────────────

router.post("/login", authLimiter, async (req, res) => {
  const b = body(z.object({ email, password: z.string().min(1, "Enter your password.").max(200) }), req);
  const user = await prisma.user.findUnique({ where: { email: b.email } });
  if (!user) throw new HttpError(404, "There's no account with this email.", "no_account");
  if (!user.passwordHash) throw new HttpError(400, "This account signs in with Google. Use the Google button above.", "use_google");
  if (!(await compare(b.password, user.passwordHash))) {
    await audit(req, "sign_in_failed", { userId: user.id });
    throw new HttpError(401, "That password isn't right.", "bad_password");
  }
  if (!user.emailVerified) {
    res.json({ challenge: await issueCode(user, "VERIFY_EMAIL"), step: "verify_email" });
    return;
  }
  // 2-step is always on. Authenticator apps arrive with the profile screen; until then the code goes by email.
  res.json({ challenge: await issueCode(user, "SIGN_IN"), step: "two_step", method: "email" });
});

router.post("/login/verify", codeLimiter, async (req, res) => {
  const b = body(z.object({ challenge, code }), req);
  const r = await checkCode(b.challenge, b.code, "SIGN_IN");
  if (!r.ok) return failCode(r.reason);
  await startSession(req, res, r.userId, "password");
  await audit(req, "signed_in", { userId: r.userId, detail: { method: "password" } });
  res.json(await me(r.userId));
});

/**
 * Google. A Google account with a verified email signs in to the matching
 * person, or becomes one. If the matching person never confirmed their email,
 * their password is dropped as Google links: nobody ever proved they own that
 * address, so a password set by someone else must not survive the link.
 */
router.post("/google", authLimiter, async (req, res) => {
  const b = body(z.object({ idToken: z.string().min(20).max(4096) }), req);
  const g = await verifyGoogle(b.idToken);
  let user = await prisma.user.findUnique({ where: { googleSub: g.sub } });
  // Someone new, or someone whose email was never confirmed until now: welcome them.
  let welcome = false;
  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: g.email } });
    welcome = !byEmail?.emailVerified;
    user = byEmail
      ? await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleSub: g.sub,
            emailVerified: byEmail.emailVerified ?? new Date(),
            ...(byEmail.emailVerified ? {} : { passwordHash: null }),
            firstName: byEmail.firstName ?? g.firstName,
            lastName: byEmail.lastName ?? g.lastName,
          },
        })
      : await prisma.user.create({ data: { email: g.email, googleSub: g.sub, emailVerified: new Date(), firstName: g.firstName, lastName: g.lastName } });
  }
  await startSession(req, res, user.id, "google");
  await audit(req, "signed_in", { userId: user.id, detail: { method: "google" } });
  if (welcome) {
    const hello = welcomeEmail(user.firstName);
    void sendEmail(user.email, hello.subject, hello.text, { html: hello.html }).catch(() => {});
  }
  res.json(await me(user.id));
});

router.post("/logout", requireUser, async (req, res) => {
  await endSession(res, req.auth!.sessionId);
  await audit(req, "signed_out");
  res.json({ ok: true });
});

// ─── You ──────────────────────────────────────────────────────────────────

router.get("/me", requireUser, async (req, res) => {
  res.json(await me(req.auth!.userId));
});

router.patch("/me", requireUser, async (req, res) => {
  const b = body(z.object({ firstName: name.optional(), lastName: name.optional(), phone: z.string().trim().max(30).optional() }), req);
  await prisma.user.update({ where: { id: req.auth!.userId }, data: b });
  await audit(req, "profile_updated");
  res.json(await me(req.auth!.userId));
});

/** Your photo is the request body: PNG, JPEG or WebP. */
router.put("/me/avatar", requireUser, express.raw({ type: () => true, limit: MAX_IMAGE }), async (req, res) => {
  const avatarId = await storeImage(req.body, req.auth!.userId);
  await prisma.user.update({ where: { id: req.auth!.userId }, data: { avatarId } });
  await audit(req, "photo_changed");
  res.json(await me(req.auth!.userId));
});

router.delete("/me/avatar", requireUser, async (req, res) => {
  await prisma.user.update({ where: { id: req.auth!.userId }, data: { avatarId: null } });
  await audit(req, "photo_removed");
  res.json(await me(req.auth!.userId));
});

// ─── Where you're signed in ───────────────────────────────────────────────

router.get("/sessions", requireUser, async (req, res) => {
  const list = await prisma.session.findMany({ where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  res.json({
    sessions: list.map((s) => ({ id: s.id, userAgent: s.userAgent, ip: s.ip, method: s.method, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === req.auth!.sessionId })),
  });
});

router.delete("/sessions/:id", requireUser, async (req, res) => {
  const done = await prisma.session.updateMany({ where: { id: String(req.params.id), userId: req.auth!.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count) await audit(req, "session_signed_out", { detail: { sessionId: String(req.params.id) } });
  res.json({ ok: true });
});

router.post("/sessions/sign-out-others", requireUser, async (req, res) => {
  await endOtherSessions(req.auth!.userId, req.auth!.sessionId);
  await audit(req, "other_sessions_signed_out");
  res.json({ ok: true });
});

// ─── Passwords ────────────────────────────────────────────────────────────

router.post("/password/forgot", authLimiter, async (req, res) => {
  const b = body(z.object({ email }), req);
  const user = await prisma.user.findUnique({ where: { email: b.email } });
  res.json({ challenge: user?.emailVerified ? await issueCode(user, "RESET_PASSWORD") : decoyChallenge() });
});

/** A reset signs out every device; the person then signs in fresh, with 2-step. */
router.post("/password/reset", codeLimiter, async (req, res) => {
  const b = body(z.object({ challenge, code, password }), req);
  const r = await checkCode(b.challenge, b.code, "RESET_PASSWORD");
  if (!r.ok) return failCode(r.reason);
  await prisma.user.update({ where: { id: r.userId }, data: { passwordHash: await hash(b.password, 12), passwordChangedAt: new Date() } });
  await endOtherSessions(r.userId);
  await audit(req, "password_reset", { userId: r.userId });
  res.json({ ok: true });
});

/** Changing it while signed in: the current one first (unless there's none yet - a Google-only account setting one). */
router.post("/password/change", requireUser, authLimiter, async (req: Request, res) => {
  const b = body(z.object({ current: z.string().max(200).optional(), next: password }), req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (user.passwordHash && !(b.current && (await compare(b.current, user.passwordHash)))) throw new HttpError(400, "Your current password isn't right.", "bad_current_password");
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(b.next, 12), passwordChangedAt: new Date() } });
  await endOtherSessions(user.id, req.auth!.sessionId);
  await audit(req, "password_changed");
  res.json({ ok: true });
});

export default router;
