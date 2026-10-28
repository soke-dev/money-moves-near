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
import { randomUUID } from "crypto";
import { checkTotp, newRecoveryCodes, newSecret, openSecret, otpauthUri, sealSecret, useRecoveryCode } from "../lib/totp";

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
  /** Recovery codes left, for a lost phone. */
  recoveryLeft: u.twoStep === "APP" ? u.recoveryCodes.length : null,
  hasPassword: !!u.passwordHash,
  google: !!u.googleSub,
  passwordChangedAt: u.passwordChangedAt,
  avatar: imageUrl(u.avatarId),
});

async function me(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { include: { business: true }, orderBy: { createdAt: "asc" } } } });
  return {
    user: publicUser(user),
    businesses: user.memberships.map((m) => ({ id: m.business.id, name: m.business.name, kind: m.business.kind, merchantId: m.business.merchantId, status: m.business.status, settleChain: m.business.settleChain, role: m.role, verifiedAt: m.business.status === "VERIFIED" ? (m.business.statusChangedAt ?? m.business.updatedAt) : null, liveNoticeClosed: !!m.liveNoticeClosedAt, logo: imageUrl(m.business.logoId), feePayer: m.business.feePayer, feePayerCrypto: m.business.feePayerCrypto })),
  };
}

const failCode = (reason: keyof typeof CODE_ERRORS): never => {
  throw new HttpError(400, CODE_ERRORS[reason], `code_${reason}`);
};

// ─── The authenticator app ────────────────────────────────────────────────

const APP_MINUTES = 10;
const APP_TRIES = 5;
/** A code from the app, or a recovery code. */
const appCode = z.string().trim().min(6, "Enter the 6-digit code from your app.").max(14);
const APP_ERRORS = {
  expired: "That sign-in took too long. Sign in again.",
  wrong: "That code isn't right. Check the app and try the latest code.",
  too_many: "Too many wrong tries. Sign in again.",
} as const;

/** After the password or Google: a challenge whose code comes from the app, not an email. */
async function appChallenge(userId: string, via: "password" | "google") {
  await prisma.loginCode.updateMany({ where: { userId, purpose: "SIGN_IN_APP", usedAt: null }, data: { usedAt: new Date() } });
  const id = randomUUID();
  await prisma.loginCode.create({ data: { id, userId, purpose: "SIGN_IN_APP", codeHash: "-", via, expiresAt: new Date(Date.now() + APP_MINUTES * 60_000) } });
  return id;
}

/**
 * Checks a code from someone's app (or one of their recovery codes), once. The
 * step it was right for is claimed with a conditional update, so the same code
 * can't be used twice, even by two requests at once.
 */
async function appCodeIsRight(user: User, code: string): Promise<boolean> {
  if (!user.totpSecret) return false;
  const digits = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(digits)) {
    const step = checkTotp(openSecret(user.totpSecret), digits, user.totpLastStep);
    if (step == null) return false;
    const claimed = await prisma.user.updateMany({ where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return claimed.count === 1;
  }
  const left = useRecoveryCode(user.recoveryCodes, code);
  if (!left) return false;
  const claimed = await prisma.user.updateMany({ where: { id: user.id, recoveryCodes: { equals: user.recoveryCodes } }, data: { recoveryCodes: left } });
  if (claimed.count === 1) void sendEmail(user.email, "A recovery code was used to sign in", `Someone signed in to your Money Moves Business account with one of your recovery codes. You have ${left.length} left.\n\nIf this wasn't you, change your password now and write to support@usemoneymoves.xyz.`, { label: "Security" }).catch(() => false);
  return claimed.count === 1;
}

async function checkAppChallenge(challengeId: string, code: string): Promise<{ ok: true; userId: string; via: string } | { ok: false; reason: keyof typeof APP_ERRORS }> {
  const row = await prisma.loginCode.findUnique({ where: { id: challengeId } }).catch(() => null);
  if (!row || row.purpose !== "SIGN_IN_APP" || row.usedAt || row.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (row.attempts >= APP_TRIES) return { ok: false, reason: "too_many" };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: row.userId } });
  if (!(await appCodeIsRight(user, code))) {
    await prisma.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: row.attempts + 1 >= APP_TRIES ? "too_many" : "wrong" };
  }
  const used = await prisma.loginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (!used.count) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId, via: row.via ?? "password" };
}

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
  // 2-step is always on: a code from the authenticator app when it's set up, otherwise by email.
  if (user.twoStep === "APP" && user.totpSecret) {
    res.json({ challenge: await appChallenge(user.id, "password"), step: "two_step", method: "app" });
    return;
  }
  res.json({ challenge: await issueCode(user, "SIGN_IN"), step: "two_step", method: "email" });
});

router.post("/login/verify", codeLimiter, async (req, res) => {
  const b = body(z.object({ challenge, code: appCode }), req);
  const row = await prisma.loginCode.findUnique({ where: { id: b.challenge }, select: { purpose: true } }).catch(() => null);
  if (row?.purpose === "SIGN_IN_APP") {
    const r = await checkAppChallenge(b.challenge, b.code);
    if (!r.ok) throw new HttpError(400, APP_ERRORS[r.reason], `code_${r.reason}`);
    const method = r.via === "google" ? "google" : "password";
    await startSession(req, res, r.userId, method);
    await audit(req, "signed_in", { userId: r.userId, detail: { method, twoStep: "app" } });
    res.json(await me(r.userId));
    return;
  }
  if (!/^\d{6}$/.test(b.code)) throw new HttpError(400, "Enter the 6-digit code.", "code_wrong");
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
  // With the authenticator app on, Google gets them as far as the code, the same as a password does.
  if (user.twoStep === "APP" && user.totpSecret) {
    res.json({ challenge: await appChallenge(user.id, "google"), step: "two_step", method: "app" });
    return;
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

// ─── 2-step: the authenticator app ────────────────────────────────────────

const appLimiter = limited(20);

/** A new secret to scan. Nothing changes until a code from the app confirms it. */
router.post("/me/two-step/app/start", requireUser, appLimiter, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const secret = newSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpPending: sealSecret(secret) } });
  res.json({ secret, uri: otpauthUri(secret, user.email) });
});

/** The first code from the app: it's on, and here are the recovery codes, shown this once. */
router.post("/me/two-step/app/confirm", requireUser, appLimiter, async (req, res) => {
  const b = body(z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your app.") }), req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (!user.totpPending) throw new HttpError(400, "Start again: scan a new code first.", "no_pending");
  const secret = openSecret(user.totpPending);
  const step = checkTotp(secret, b.code, null);
  if (step == null) throw new HttpError(400, "That code isn't right. Check the app's clock is set automatically, and try the latest code.", "code_wrong");
  const rc = newRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { twoStep: "APP", totpSecret: user.totpPending, totpPending: null, totpLastStep: step, recoveryCodes: rc.hashes } });
  await audit(req, "two_step_app_on");
  void sendEmail(user.email, "Your authenticator app is on", "From now on, signing in to Money Moves Business asks for the 6-digit code from your authenticator app instead of an email.\n\nIf you didn't turn this on, change your password now and write to support@usemoneymoves.xyz.", { label: "Security" }).catch(() => false);
  res.json({ ...(await me(user.id)), recoveryCodes: rc.codes });
});

/** Back to codes by email: it takes a code from the app (or a recovery code), and no business may require the app. */
router.post("/me/two-step/email", requireUser, appLimiter, async (req, res) => {
  const b = body(z.object({ code: appCode }), req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (user.twoStep !== "APP") {
    res.json(await me(user.id));
    return;
  }
  const requiring = await prisma.member.findFirst({ where: { userId: user.id, business: { requireAppTwoStep: true } }, include: { business: { select: { name: true } } } });
  if (requiring) throw new HttpError(409, `${requiring.business.name} asks everyone on its team to use an authenticator app, so it can't be turned off.`, "app_required");
  if (!(await appCodeIsRight(user, b.code))) throw new HttpError(400, APP_ERRORS.wrong, "code_wrong");
  await prisma.user.update({ where: { id: user.id }, data: { twoStep: "EMAIL", totpSecret: null, totpPending: null, totpLastStep: null, recoveryCodes: [] } });
  await audit(req, "two_step_app_off");
  void sendEmail(user.email, "Your authenticator app is off", "Signing in to Money Moves Business now sends a code to this email instead of asking your authenticator app.\n\nIf you didn't do this, change your password now and write to support@usemoneymoves.xyz.", { label: "Security" }).catch(() => false);
  res.json(await me(user.id));
});

/** A fresh set of recovery codes, for a code from the app. The old ones stop working. */
router.post("/me/two-step/recovery", requireUser, appLimiter, async (req, res) => {
  const b = body(z.object({ code: appCode }), req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  if (user.twoStep !== "APP") throw new HttpError(400, "Turn on the authenticator app first.", "not_app");
  if (!(await appCodeIsRight(user, b.code))) throw new HttpError(400, APP_ERRORS.wrong, "code_wrong");
  const rc = newRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: rc.hashes } });
  await audit(req, "two_step_recovery_codes");
  res.json({ ...(await me(user.id)), recoveryCodes: rc.codes });
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
