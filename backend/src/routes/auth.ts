import crypto from "crypto";
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { MAX_ACCOUNTS_PER_DEVICE } from "../lib/signup-limits";
import { hashPassword, verifyPassword, hashPin, verifyPin } from "../lib/hash";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateVerificationCode,
  getRefreshExpiry,
} from "../lib/tokens";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { checkSignupEmail } from "../lib/email-check";
import { verifyDynamicToken } from "../lib/dynamic";
import { fillMissingAddressesFromClaims } from "../lib/wallet-proof";
import { normaliseCode, findReferrer, attributionBlock, inviterName, claimWindow } from "../lib/referrals";
import { signupsPausedMessage } from "../lib/service-status";
import { healMissingIdentity } from "./kyc";
import { env } from "../config/env";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPinResetEmail,
  sendLoginAlertEmail,
  sendWelcomeEmail,
} from "../lib/email";
import {
  registerSchema,
  loginSchema,
  setPinSchema,
  verifyPinSchema,
  changePinSchema,
  verifyEmailSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
  requestPinResetSchema,
  confirmPinResetSchema,
  changePasswordSchema,
  enableBiometricSchema,
  refreshTokenSchema,
} from "./auth.schemas";

const router = Router();

// ─── Helper: generate unique referral code ───────────────────
function generateReferralCode(): string {
  return "MM" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

// ─── Helper: generate random username ───────────────────────
function generateUsername(firstName?: string): string {
  const base = (firstName || "user").toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = crypto.randomInt(1000, 99999);
  return `${base}_${suffix}`;
}

// ─── Helper: create session + tokens ────────────────────────
// `loginVerified` controls whether the session can pass `requireActiveSession`
// immediately. Login flow creates an unverified session; the user must enter
// the emailed code to activate it. Register/reset flows pass true because they
// have their own verification gates.
/**
 * Whether this handset may make another account.
 *
 * Counts distinct accounts that have ever had a session from this device, so
 * deleting the app does not reset it - on iOS, where the identifier lives in
 * the keychain and survives a reinstall.
 *
 * Fails open in two cases, both deliberate. A build from before the app sent
 * an identifier sends nothing, and refusing those would lock out every person
 * who has not taken the update. And a database error here must not stop people
 * signing up: the worst an outage should cost is the rule, not the business.
 */
async function deviceMayRegister(
  deviceId: string | undefined,
): Promise<{ ok: true } | { ok: false; count: number }> {
  if (!deviceId) return { ok: true };
  try {
    const waved = await prisma.deviceException.findUnique({
      where: { deviceId },
      select: { id: true },
    });
    if (waved) return { ok: true };

    const rows = await prisma.session.findMany({
      where: { deviceId },
      distinct: ["userId"],
      select: { userId: true },
    });
    if (rows.length >= MAX_ACCOUNTS_PER_DEVICE) return { ok: false, count: rows.length };
    return { ok: true };
  } catch (e: any) {
    console.error("[device] limit check failed, allowing:", e?.message);
    return { ok: true };
  }
}

/** The one refusal, so both signup routes say the same thing. */
const DEVICE_LIMIT_MESSAGE =
  `This device has already been used to create ${MAX_ACCOUNTS_PER_DEVICE} accounts. ` +
  `If you need another, contact support.`;

async function createSessionAndTokens(userId: string, req: Request, loginVerified: boolean = false) {
  // Create session
  const session = await prisma.session.create({
    data: {
      userId,
      deviceInfo: req.deviceInfo || "unknown",
      deviceId: req.deviceId ?? null,
      ipAddress: req.clientIp || "unknown",
      expiresAt: getRefreshExpiry(),
      loginVerifiedAt: loginVerified ? new Date() : null,
    },
  });

  // Create tokens
  const accessToken = signAccessToken({ userId, sessionId: session.id });
  const refreshToken = signRefreshToken({ userId, tokenId: session.id });

  // Store refresh token hash
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      deviceInfo: req.deviceInfo,
      ipAddress: req.clientIp,
      expiresAt: getRefreshExpiry(),
    },
  });

  return { accessToken, refreshToken, sessionId: session.id };
}

// ═══════════════════════════════════════════════════════════
// POST /auth/register
// ═══════════════════════════════════════════════════════════
/**
 * Closed. Accounts are made by signing in with an email code in the app
 * (POST /auth/dynamic), which is also what gives an account its wallet.
 *
 * This older route was still answering long after the app stopped using it,
 * and handed out a fully signed-in session before the email was even
 * confirmed - accounts made straight from a script, with no wallet of their
 * own, that could then claim any address they liked.
 */
router.post("/register", (_req: Request, res: Response) => {
  res.status(410).json({ error: "Sign up in the Money Moves app with your email address.", code: "SIGNUP_MOVED" });
});

// ═══════════════════════════════════════════════════════════
// POST /auth/login
// ═══════════════════════════════════════════════════════════
router.post("/login", validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Always do a password comparison even if user doesn't exist (prevents timing attacks)
    if (!user) {
      await hashPassword("dummy-password-timing-safe");
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    // Block deleted accounts
    if (user.deletedAt) {
      res.status(403).json({ error: "This account has been deleted. Please contact support if you need assistance." });
      return;
    }

    // Check account lockout
    if (user.loginLockedUntil && user.loginLockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.loginLockedUntil.getTime() - Date.now()) / 60000);
      res.status(429).json({
        error: `Account locked. Try again in ${minutesLeft} minutes`,
        code: "ACCOUNT_LOCKED",
        lockedUntil: user.loginLockedUntil,
      });
      return;
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const lockout =
        attempts >= env.MAX_LOGIN_ATTEMPTS
          ? new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60 * 1000)
          : null;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          loginLockedUntil: lockout,
        },
      });

      if (lockout) {
        res.status(429).json({
          error: `Too many failed attempts. Account locked for ${env.LOGIN_LOCKOUT_MINUTES} minutes`,
          code: "ACCOUNT_LOCKED",
          lockedUntil: lockout,
        });
      } else {
        res.status(401).json({
          error: "Invalid email or password",
          attemptsRemaining: env.MAX_LOGIN_ATTEMPTS - attempts,
        });
      }
      return;
    }

    // Reset failed attempts on successful login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        loginLockedUntil: null,
      },
    });

    // App-review accounts skip the login OTP (reviewers can't receive our email).
    const isReviewer = env.REVIEW_EMAILS.includes(user.email.toLowerCase());

    // Create session + tokens (review accounts are login-verified immediately).
    const tokens = await createSessionAndTokens(user.id, req, isReviewer);

    if (!isReviewer) {
      // Send login verification code (2FA for every login)
      const loginCode = generateVerificationCode();
      const loginCodeHash = hashToken(loginCode);
      await prisma.verificationCode.create({
        data: {
          userId: user.id,
          type: "EMAIL_VERIFY",
          codeHash: loginCodeHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      sendVerificationEmail(user.email, loginCode).catch(() => {});

      // Send login alert for new device (non-blocking)
      sendLoginAlertEmail(user.email, req.deviceInfo || "", req.clientIp || "").catch(() => {});
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone,
        referralCode: user.referralCode,
        emailVerified: user.emailVerified,
        loginVerified: isReviewer,
        kycStatus: user.kycStatus,
        pinSet: !!user.pinHash,
        bioEnabled: user.bioEnabled,
        avatarUrl: user.avatarData ?? user.avatarUrl,
      },
      ...tokens,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /auth/referral/:code — is this a code, and whose?
// ═══════════════════════════════════════════════════════════
/**
 * Asked before anybody is signed in, so the sign-up screen can say "Invited
 * by @soke" while the code is still being typed.
 *
 * Open by necessity and rate-limited in index.ts. What it can tell a stranger
 * is bounded: codes are six random hex digits, so there is nothing to guess
 * at speed, and an anonymous referrer confirms the code without naming
 * themselves.
 *
 * It runs the same device check sign-up does, so the preview cannot promise
 * a credit that sign-up would then quietly refuse.
 */
router.get("/referral/:code", async (req: Request, res: Response) => {
  try {
    const code = normaliseCode(req.params.code);
    const referrer = await findReferrer(code);
    if (!referrer) {
      res.json({ valid: false });
      return;
    }
    const block = await attributionBlock({ referrer, refereeId: null, deviceId: req.deviceId });
    if (block) {
      res.json({ valid: false, reason: block });
      return;
    }
    res.json({ valid: true, inviter: inviterName(referrer) });
  } catch (err: any) {
    console.error("[REFERRAL] check failed:", err?.message);
    res.status(500).json({ error: "Could not check that code." });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /auth/dynamic
// Email-only login via Dynamic.xyz. The client logs in with Dynamic (email OTP)
// and sends us its access-token JWT; we verify it against Dynamic's JWKS and
// upsert the user by the verified email, then issue our own session tokens.
// New users get a generated username, a random (unused) password, and
// walletType=EMBEDDED (Dynamic embedded wallet). Existing users just sign in —
// this doubles as the migration path (they keep their existing wallet type).
// ═══════════════════════════════════════════════════════════
router.post("/dynamic", async (req: Request, res: Response) => {
  try {
    const { token, referralCode: rawReferral } = req.body;
    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Missing token" });
      return;
    }

    // Verify the Dynamic JWT (signature + RS256 + email claim).
    let claims;
    try {
      claims = await verifyDynamicToken(token);
    } catch (e) {
      console.warn("Dynamic token verification failed:", (e as any)?.message);
      res.status(401).json({ error: "Invalid or expired sign-in. Please try again." });
      return;
    }
    const email = claims.email;

    let user = await prisma.user.findUnique({ where: { email } });

    if (user?.deletedAt) {
      res.status(403).json({ error: "This account has been deleted. Please contact support if you need assistance." });
      return;
    }

    if (!user) {
      /**
       * The console's sign-up switch, for a new account only.
       *
       * Here and not at the top for the same reason as the device limit below:
       * this endpoint signs people IN as well, and an existing account must
       * never meet this. `paused` and `service` are what the app's 503 handler
       * keys on, so builds already on people's phones raise the maintenance
       * sheet with this message rather than a bare error.
       */
      const signupsPaused = await signupsPausedMessage();
      if (signupsPaused) {
        console.log(`[SIGNUPS] refused a new account while paused (${email.split("@")[1] ?? "?"})`);
        res.status(503).json({ error: signupsPaused, paused: true, service: "signups" });
        return;
      }

      /**
       * Checked here rather than at the top, because this endpoint is sign-IN
       * as well as sign-up. A handset at the limit must still be able to reach
       * the accounts it already has - locking somebody out of an account they
       * own is a worse failure than letting them make one too many.
       */
      const allowed = await deviceMayRegister(req.deviceId);
      if (!allowed.ok) {
        console.warn(`[device] refused a 4th account on ${req.deviceId} (has ${allowed.count})`);
        res.status(429).json({ error: DEVICE_LIMIT_MESSAGE });
        return;
      }

      // A real inbox only, for a new account. Temporary ones are what scripted
      // sign-ups use, and their domains rotate faster than any list - see lib/email-check.
      const verdict = await checkSignupEmail(email);
      if (!verdict.ok) {
        console.warn(`[SIGNUPS] refused a new account from ${email.split("@")[1] ?? "?"} (${verdict.reason})`);
        res.status(400).json({
          error: verdict.reason === "disposable"
            ? "Use an email address you'll keep. Temporary inboxes can't open a Money Moves account."
            : "That email address can't receive mail. Check it and try again.",
          code: "EMAIL_NOT_ACCEPTED",
        });
        return;
      }

      // ── New user ──
      // Default username from the email local-part (editable later in-app).
      let finalUsername = "";
      for (let i = 0; i < 6; i++) {
        const candidate = generateUsername(email.split("@")[0]);
        // Case-insensitive, like every other check on a username. findUnique
        // compares exactly, so this could hand out "mrrevy" while "MrRevy"
        // already existed - two accounts, one name to anybody sending money.
        const taken = await prisma.user.findFirst({
          where: { username: { equals: candidate, mode: "insensitive" } },
          select: { id: true },
        });
        if (!taken) { finalUsername = candidate; break; }
      }
      if (!finalUsername) finalUsername = "user_" + Date.now().toString(36);

      let referralCode = "";
      for (let i = 0; i < 5; i++) {
        const candidate = generateReferralCode();
        const taken = await prisma.user.findUnique({ where: { referralCode: candidate } });
        if (!taken) { referralCode = candidate; break; }
      }
      if (!referralCode) referralCode = "MM" + Date.now().toString(36).toUpperCase();

      // Random unusable password — Dynamic users never log in with a password,
      // and this avoids a schema migration to make passwordHash optional.
      const passwordHash = await hashPassword(crypto.randomBytes(24).toString("hex"));

      /**
       * Who invited them, if anybody - read ONLY for a new account.
       *
       * The same screen signs people in and signs them up, so a returning
       * user can arrive here with a code typed too. It is ignored for them:
       * attribution belongs to the moment an account is made, and an existing
       * account adding one late goes through the week-long claim instead.
       *
       * Email is already verified by the time this runs - Dynamic issued the
       * token only after the OTP - so attributing here is attributing after
       * verification. Counting waits for the PIN; see lib/referrals.
       *
       * Its own try: a referral is a nicety, and nothing about it may ever be
       * the reason somebody cannot sign up.
       */
      let referredBy: string | null = null;
      try {
        const code = normaliseCode(rawReferral);
        if (code) {
          const referrer = await findReferrer(code);
          if (referrer) {
            const block = await attributionBlock({ referrer, refereeId: null, deviceId: req.deviceId });
            if (block) console.log(`[REFERRAL] ${code} not credited at sign-up: ${block}`);
            else referredBy = referrer.id;
          }
        }
      } catch (e: any) {
        console.warn("[REFERRAL] sign-up attribution skipped:", e?.message);
      }

      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          username: finalUsername,
          referralCode,
          referredBy,
          emailVerified: true,
          walletType: "EMBEDDED",
        },
      });

      sendWelcomeEmail(email, finalUsername).catch(() => {});
    } else if (!user.emailVerified) {
      // Existing user whose email Dynamic has now verified.
      await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
      user.emailVerified = true;
    }

    // Reset any prior login lock — Dynamic already authenticated them.
    if (user.failedLoginAttempts || user.loginLockedUntil) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, loginLockedUntil: null },
      });
    }

    // Dynamic did the OTP, so the session is fully login-verified immediately.
    const tokens = await createSessionAndTokens(user.id, req, true);

    // Verified, and nameless because the provider's read came back empty and
    // was corrected in their console after we stored it. Asks again, without
    // holding up the sign-in.
    healMissingIdentity(user.id).catch(() => {});
    // The token just verified names this account's wallets: record any the app never managed to.
    fillMissingAddressesFromClaims(user.id, claims).catch((e: any) => console.warn("[WALLET] fill from token failed:", e?.message));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone,
        referralCode: user.referralCode,
        emailVerified: true,
        loginVerified: true,
        kycStatus: user.kycStatus,
        pinSet: !!user.pinHash,
        bioEnabled: user.bioEnabled,
        avatarUrl: user.avatarData ?? user.avatarUrl,
        walletType: user.walletType ?? "EMBEDDED",
        // Lets the app tell a returning account from a new one, which decides
        // whether it explains what changed in this version.
        createdAt: user.createdAt,
        // The same two /auth/me carries, so the app has them from the moment
        // of sign-in rather than only after its first refresh.
        anonMode: user.anonMode === true,
        referralClaim: claimWindow(user.createdAt, !!user.referredBy),
      },
      ...tokens,
    });
  } catch (err) {
    console.error("Dynamic auth error:", err);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /auth/verify-email
// ═══════════════════════════════════════════════════════════
router.post(
  "/verify-email",
  requireAuth,
  validate(verifyEmailSchema),
  async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Find most recent unused code
      const verification = await prisma.verificationCode.findFirst({
        where: {
          userId,
          type: "EMAIL_VERIFY",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!verification) {
        res.status(400).json({ error: "No valid verification code found. Request a new one." });
        return;
      }

      // Rate limit: max 5 attempts per code
      if (verification.attempts >= 5) {
        res.status(429).json({ error: "Too many attempts. Request a new code." });
        return;
      }

      // Increment attempts
      await prisma.verificationCode.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });

      // Verify code
      const valid = hashToken(code) === verification.codeHash;
      if (!valid) {
        res.status(400).json({
          error: "Invalid code",
          attemptsRemaining: 4 - verification.attempts,
        });
        return;
      }

      // Mark code as used, verify email, and activate the current session
      const wasAlreadyVerified = user.emailVerified;
      await prisma.$transaction([
        prisma.verificationCode.update({
          where: { id: verification.id },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { emailVerified: true },
        }),
        prisma.session.update({
          where: { id: req.user!.sessionId },
          data: { loginVerifiedAt: new Date() },
        }),
      ]);

      // Send welcome email only on first-time verification (registration), not login
      if (!wasAlreadyVerified) {
        const verifiedUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true } });
        if (verifiedUser?.email) {
          sendWelcomeEmail(verifiedUser.email, verifiedUser.username || "there").catch(() => {});
        }
      }

      res.json({ message: "Email verified successfully" });
    } catch (err) {
      console.error("Verify email error:", err);
      res.status(500).json({ error: "Verification failed" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/resend-verification
// ═══════════════════════════════════════════════════════════
router.post("/resend-verification", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Rate limit: max 1 code per 60 seconds
    const recent = await prisma.verificationCode.findFirst({
      where: {
        userId,
        type: "EMAIL_VERIFY",
        createdAt: { gt: new Date(Date.now() - 60 * 1000) },
      },
    });

    if (recent) {
      res.status(429).json({ error: "Please wait 60 seconds before requesting a new code" });
      return;
    }

    const code = generateVerificationCode();
    await prisma.verificationCode.create({
      data: {
        userId,
        type: "EMAIL_VERIFY",
        codeHash: hashToken(code),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    await sendVerificationEmail(user.email, code);
    res.json({ message: "Verification code sent" });
  } catch (err) {
    console.error("Resend verification error:", err);
    res.status(500).json({ error: "Failed to resend code" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /auth/pin/set
// ═══════════════════════════════════════════════════════════
router.post(
  "/pin/set",
  requireAuth,
  requireActiveSession,
  validate(setPinSchema),
  async (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // If PIN already set, require current PIN or password re-verification
      if (user.pinHash) {
        res.status(400).json({ error: "PIN already set. Use /auth/pin/reset to change it." });
        return;
      }

      const pinHash = await hashPin(pin);
      await prisma.user.update({
        where: { id: userId },
        data: { pinHash },
      });

      res.json({ message: "PIN set successfully" });
    } catch (err) {
      console.error("Set PIN error:", err);
      res.status(500).json({ error: "Failed to set PIN" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/pin/verify
// ═══════════════════════════════════════════════════════════
router.post(
  "/pin/verify",
  requireAuth,
  validate(verifyPinSchema),
  async (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.pinHash) {
        res.status(400).json({ error: "PIN not set" });
        return;
      }

      // Check PIN lockout
      if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
        const minutesLeft = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60000);
        res.status(429).json({
          error: `PIN locked. Try again in ${minutesLeft} minutes`,
          code: "PIN_LOCKED",
          lockedUntil: user.pinLockedUntil,
        });
        return;
      }

      const valid = await verifyPin(pin, user.pinHash);

      if (!valid) {
        const attempts = user.failedPinAttempts + 1;
        const lockout =
          attempts >= env.MAX_PIN_ATTEMPTS
            ? new Date(Date.now() + env.PIN_LOCKOUT_MINUTES * 60 * 1000)
            : null;

        await prisma.user.update({
          where: { id: userId },
          data: {
            failedPinAttempts: attempts,
            pinLockedUntil: lockout,
          },
        });

        if (lockout) {
          res.status(429).json({
            error: `Too many failed attempts. PIN locked for ${env.PIN_LOCKOUT_MINUTES} minutes`,
            code: "PIN_LOCKED",
            lockedUntil: lockout,
          });
        } else {
          res.status(401).json({
            error: "Incorrect PIN",
            attemptsRemaining: env.MAX_PIN_ATTEMPTS - attempts,
          });
        }
        return;
      }

      // Reset failed attempts
      await prisma.user.update({
        where: { id: userId },
        data: {
          failedPinAttempts: 0,
          pinLockedUntil: null,
        },
      });

      // Return fresh access token (PIN acts as a re-auth step)
      const accessToken = signAccessToken({ userId, sessionId: req.user!.sessionId });

      res.json({ message: "PIN verified", accessToken });
    } catch (err) {
      console.error("Verify PIN error:", err);
      res.status(500).json({ error: "PIN verification failed" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/password/reset-request
// ═══════════════════════════════════════════════════════════
router.post(
  "/password/reset-request",
  validate(requestPasswordResetSchema),
  async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(404).json({ error: "No account found with that email address" });
        return;
      }

      // Rate limit: 1 code per 60 seconds
      const recent = await prisma.verificationCode.findFirst({
        where: {
          userId: user.id,
          type: "PASSWORD_RESET",
          createdAt: { gt: new Date(Date.now() - 60 * 1000) },
        },
      });

      if (recent) {
        res.json({ message: "Reset code sent to your email" });
        return;
      }

      const code = generateVerificationCode();
      await prisma.verificationCode.create({
        data: {
          userId: user.id,
          type: "PASSWORD_RESET",
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await sendPasswordResetEmail(email, code);
      res.json({ message: "Reset code sent to your email" });
    } catch (err) {
      console.error("Password reset request error:", err);
      res.status(500).json({ error: "Failed to process request" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/password/reset-confirm
// ═══════════════════════════════════════════════════════════
router.post(
  "/password/reset-confirm",
  validate(confirmPasswordResetSchema),
  async (req: Request, res: Response) => {
    try {
      const { email, code, newPassword } = req.body;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        res.status(400).json({ error: "Invalid code" });
        return;
      }

      const verification = await prisma.verificationCode.findFirst({
        where: {
          userId: user.id,
          type: "PASSWORD_RESET",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!verification) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }

      if (verification.attempts >= 5) {
        res.status(429).json({ error: "Too many attempts. Request a new code." });
        return;
      }

      await prisma.verificationCode.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });

      if (hashToken(code) !== verification.codeHash) {
        res.status(400).json({
          error: "Invalid code",
          attemptsRemaining: 4 - verification.attempts,
        });
        return;
      }

      // Update password + invalidate all sessions
      const passwordHash = await hashPassword(newPassword);
      await prisma.$transaction([
        prisma.verificationCode.update({
          where: { id: verification.id },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            failedLoginAttempts: 0,
            loginLockedUntil: null,
          },
        }),
        // Revoke all sessions — user must log in again
        prisma.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
        prisma.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);

      res.json({ message: "Password reset successfully. Please log in." });
    } catch (err) {
      console.error("Password reset confirm error:", err);
      res.status(500).json({ error: "Failed to reset password" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/pin/reset-request
// ═══════════════════════════════════════════════════════════
router.post(
  "/pin/reset-request",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Rate limit
      const recent = await prisma.verificationCode.findFirst({
        where: {
          userId,
          type: "PIN_RESET",
          createdAt: { gt: new Date(Date.now() - 60 * 1000) },
        },
      });

      if (recent) {
        res.status(429).json({ error: "Please wait 60 seconds before requesting a new code" });
        return;
      }

      const code = generateVerificationCode();
      await prisma.verificationCode.create({
        data: {
          userId,
          type: "PIN_RESET",
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      await sendPinResetEmail(user.email, code);
      res.json({ message: "PIN reset code sent to your email" });
    } catch (err) {
      console.error("PIN reset request error:", err);
      res.status(500).json({ error: "Failed to process request" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/pin/reset-confirm
// ═══════════════════════════════════════════════════════════
router.post(
  "/pin/reset-confirm",
  requireAuth,
  requireActiveSession,
  validate(confirmPinResetSchema),
  async (req: Request, res: Response) => {
    try {
      const { code, newPin } = req.body;
      const userId = req.user!.userId;

      const verification = await prisma.verificationCode.findFirst({
        where: {
          userId,
          type: "PIN_RESET",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!verification) {
        res.status(400).json({ error: "Invalid or expired code" });
        return;
      }

      if (verification.attempts >= 5) {
        res.status(429).json({ error: "Too many attempts. Request a new code." });
        return;
      }

      await prisma.verificationCode.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });

      if (hashToken(code) !== verification.codeHash) {
        res.status(400).json({
          error: "Invalid code",
          attemptsRemaining: 4 - verification.attempts,
        });
        return;
      }

      const pinHash = await hashPin(newPin);
      await prisma.$transaction([
        prisma.verificationCode.update({
          where: { id: verification.id },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: userId },
          data: {
            pinHash,
            failedPinAttempts: 0,
            pinLockedUntil: null,
          },
        }),
      ]);

      res.json({ message: "PIN reset successfully" });
    } catch (err) {
      console.error("PIN reset confirm error:", err);
      res.status(500).json({ error: "Failed to reset PIN" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/password/change
// ═══════════════════════════════════════════════════════════
router.post(
  "/password/change",
  requireAuth,
  requireActiveSession,
  validate(changePasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const passwordHash = await hashPassword(newPassword);

      // Update password and revoke all other sessions
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: { passwordHash },
        }),
        // Revoke all sessions EXCEPT current
        prisma.session.updateMany({
          where: {
            userId,
            id: { not: req.user!.sessionId },
            revokedAt: null,
          },
          data: { revokedAt: new Date() },
        }),
      ]);

      res.json({ message: "Password changed successfully" });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ error: "Failed to change password" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/pin/change
// ═══════════════════════════════════════════════════════════
/**
 * Change a PIN the user already knows.
 *
 * The app has called this since the Security screen was built; there was no
 * route behind it, so "Change Pin" 404'd every time. /pin/set deliberately
 * refuses when a PIN already exists, and the reset flow needs an emailed code
 * - neither covers "I know my PIN and want a different one".
 *
 * Other sessions are left alone, unlike a password change: the PIN authorises
 * payments on this device rather than proving who you are, so changing it is
 * not a reason to sign someone out everywhere.
 */
router.post(
  "/pin/change",
  requireAuth,
  requireActiveSession,
  validate(changePinSchema),
  async (req: Request, res: Response) => {
    try {
      const { currentPin, newPin } = req.body;
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (!user.pinHash) {
        res.status(400).json({ error: "No PIN set yet. Set one first." });
        return;
      }

      const valid = await verifyPin(currentPin, user.pinHash);
      if (!valid) {
        res.status(401).json({ error: "Current PIN is incorrect" });
        return;
      }

      if (currentPin === newPin) {
        res.status(400).json({ error: "New PIN must be different from the current one" });
        return;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { pinHash: await hashPin(newPin) },
      });

      res.json({ message: "PIN changed successfully" });
    } catch (err) {
      console.error("Change PIN error:", err);
      res.status(500).json({ error: "Failed to change PIN" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/biometric
// ═══════════════════════════════════════════════════════════
router.post(
  "/biometric",
  requireAuth,
  requireActiveSession,
  validate(enableBiometricSchema),
  async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      const userId = req.user!.userId;

      await prisma.user.update({
        where: { id: userId },
        data: { bioEnabled: enabled },
      });

      res.json({ message: `Biometric login ${enabled ? "enabled" : "disabled"}` });
    } catch (err) {
      console.error("Biometric toggle error:", err);
      res.status(500).json({ error: "Failed to update biometric setting" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /auth/refresh
// ═══════════════════════════════════════════════════════════
router.post("/refresh", validate(refreshTokenSchema), async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    const tokenHash = hashToken(refreshToken);

    // Verify JWT
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({ error: "Invalid refresh token", code: "TOKEN_INVALID" });
      return;
    }

    // Find token in DB
    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.revokedAt) {
      // Three sub-cases:
      // 1. Revoked + replacedBy set → harmless race (two tabs refreshed at once).
      // 2. Revoked + no replacedBy → token of an explicitly-logged-out session
      //    being replayed. Real attack signature — nuke all active sessions.
      // 3. Not in DB at all → most likely a migration/cleanup gap or a race
      //    we can't classify. Reject THIS token, but don't burn every other
      //    device the user owns.
      if (storedToken?.revokedAt && storedToken?.replacedBy) {
        res.status(401).json({ error: "Refresh token already used", code: "TOKEN_ALREADY_ROTATED" });
        return;
      }
      if (storedToken?.revokedAt && !storedToken.replacedBy) {
        // Replay of a manually-revoked token — treat as compromise.
        await prisma.refreshToken.updateMany({
          where: { userId: storedToken.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await prisma.session.updateMany({
          where: { userId: storedToken.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        res.status(401).json({ error: "Invalid refresh token", code: "TOKEN_REUSE" });
        return;
      }
      // `!storedToken` — unknown token. Could be an attack, but it could also
      // be a DB cleanup, cross-region replica lag, or our own bug. Err on the
      // side of not logging the user out of their other devices.
      res.status(401).json({ error: "Invalid refresh token", code: "TOKEN_INVALID" });
      return;
    }

    if (storedToken.expiresAt < new Date()) {
      res.status(401).json({ error: "Refresh token expired", code: "TOKEN_EXPIRED" });
      return;
    }

    /**
     * The session this token belongs to.
     *
     * Signed out, or ended by us or by a replayed token: there is nothing to
     * refresh, and saying so lets the app sign out and open sign-in. Before
     * this a fresh token was handed out for any session at all, every request
     * then refused it, and the app stayed signed in with nothing working.
     *
     * A session that is past its date but not revoked is renewed instead. It
     * was fixed at thirty days from sign-in while its refresh token slid forward
     * with every use, so somebody using the app every day was cut off on day
     * thirty all the same. The refresh token in hand is proof of use within the
     * last thirty days, which is all that date was ever meant to require.
     */
    const session = await prisma.session.findUnique({
      where: { id: payload.tokenId },
      select: { id: true, revokedAt: true },
    });
    if (!session || session.revokedAt) {
      res.status(401).json({ error: "Session expired or revoked", code: "SESSION_INVALID" });
      return;
    }

    // Rotate: revoke old token, issue new pair
    const newRefreshToken = signRefreshToken({ userId: payload.userId, tokenId: payload.tokenId });
    const newTokenHash = hashToken(newRefreshToken);

    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date(), replacedBy: newTokenHash },
      }),
      // Alive for as long as it is used: the same thirty days the new refresh token gets.
      prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: getRefreshExpiry() },
      }),
      prisma.refreshToken.create({
        data: {
          userId: payload.userId,
          tokenHash: newTokenHash,
          deviceInfo: req.deviceInfo,
          ipAddress: req.clientIp,
          expiresAt: getRefreshExpiry(),
        },
      }),
    ]);

    const accessToken = signAccessToken({
      userId: payload.userId,
      sessionId: payload.tokenId,
    });

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) {
    console.error("Token refresh error:", err);
    res.status(500).json({ error: "Token refresh failed" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /auth/logout
// ═══════════════════════════════════════════════════════════
router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const sessionId = req.user!.sessionId;

    // Revoke current session and its refresh tokens
    await prisma.$transaction([
      prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Logout failed" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /auth/logout-all
// ═══════════════════════════════════════════════════════════
router.post("/logout-all", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    await prisma.$transaction([
      prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    res.json({ message: "All sessions revoked" });
  } catch (err) {
    console.error("Logout all error:", err);
    res.status(500).json({ error: "Failed to revoke sessions" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /auth/sessions
// ═══════════════════════════════════════════════════════════
router.get("/sessions", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const currentSessionId = req.user!.sessionId;

    const sessions = await prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        deviceInfo: true,
        ipAddress: true,
        lastActiveAt: true,
        createdAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
    });

    res.json({
      sessions: sessions.map((s) => ({
        ...s,
        isCurrent: s.id === currentSessionId,
      })),
    });
  } catch (err) {
    console.error("Get sessions error:", err);
    res.status(500).json({ error: "Failed to get sessions" });
  }
});

// ═══════════════════════════════════════════════════════════
// DELETE /auth/sessions/:id
// ═══════════════════════════════════════════════════════════
router.delete(
  "/sessions/:id",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const sessionId = req.params.id as string;

      // Can't revoke current session via this endpoint
      if (sessionId === req.user!.sessionId) {
        res.status(400).json({ error: "Use /auth/logout to end current session" });
        return;
      }

      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== userId) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });

      res.json({ message: "Session revoked" });
    } catch (err) {
      console.error("Revoke session error:", err);
      res.status(500).json({ error: "Failed to revoke session" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /auth/me
// Tolerates login-unverified sessions so the client can render the
// verify-email screen without being kicked back to the login form.
// Still rejects revoked/expired sessions and deleted accounts.
// ═══════════════════════════════════════════════════════════
router.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await prisma.session.findUnique({
      where: { id: req.user!.sessionId },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      res.status(401).json({ error: "Session expired or revoked", code: "SESSION_INVALID" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        avatarData: true,
        emailVerified: true,
        kycStatus: true,
        bioEnabled: true,
        pinHash: true,
        referralCode: true,
        referredBy: true,
        anonMode: true,
        walletType: true,
        deletedAt: true,
        createdAt: true,
      },
    });

    if (!user || user.deletedAt) {
      res.status(user?.deletedAt ? 403 : 404).json({
        error: user?.deletedAt ? "Account has been deleted" : "User not found",
        ...(user?.deletedAt ? { code: "ACCOUNT_DELETED" } : {}),
      });
      return;
    }

    // Refresh lastActiveAt for non-critical observability
    prisma.session.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => {});

    res.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarData ?? user.avatarUrl,
        emailVerified: user.emailVerified,
        loginVerified: !!session.loginVerifiedAt,
        kycStatus: user.kycStatus,
        bioEnabled: user.bioEnabled,
        pinSet: !!user.pinHash,
        referralCode: user.referralCode,
        walletType: user.walletType ?? null,
        createdAt: user.createdAt,
        /**
         * This is the endpoint the app refreshes the user from, so anything
         * the app reads off the user has to be here - not only in
         * /user/profile. anonMode was only there, which left the app always
         * believing it was off: the Security switch showed off on every
         * visit, and tapping it sent "on", so it could never be turned off.
         */
        anonMode: user.anonMode === true,
        /**
         * Whether they can still add a friend's code, so the app can point
         * a new user at it from where they look - Account and Loyalty -
         * without asking the referral endpoint on every visit.
         */
        referralClaim: claimWindow(user.createdAt, !!user.referredBy),
      },
    });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "Failed to get user" });
  }
});

export default router;
