import { Router, Request, Response } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../lib/prisma";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { hashToken, generateVerificationCode } from "../lib/tokens";
import {
  sendVerificationEmail,
  sendClosureRequestedEmail,
  sendClosureCancelledEmail,
  sendAccountClosedEmail,
} from "../lib/email";
import { fetchRates } from "./rates";
import {
  COUNTED,
  isCounted,
  normaliseCode,
  findReferrer,
  attributionBlock,
  inviterName,
  claimWindow,
  referralCounts,
} from "../lib/referrals";
import { ANON_LABEL, NO_NAME_LABEL } from "../lib/anon";


const router = Router();

// ─── Avatar Upload Config ───────────────────────────────────
// Avatars are stored in the DB as base64 data URIs (User.avatarData), so we
// buffer the upload in memory rather than writing to local disk.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ─── Schemas ────────────────────────────────────────────────
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(50).trim().optional(),
  lastName: z.string().min(1).max(50).trim().optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .trim()
    .optional(),
  phone: z
    .string()
    .min(7, "Phone number too short")
    .max(16, "Phone number too long")
    .optional(),
});

const updateNotifPrefsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  txAlerts: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  savingsAlerts: z.boolean().optional(),
  promoAlerts: z.boolean().optional(),
  appUpdates: z.boolean().optional(),
});

// ═══════════════════════════════════════════════════════════
// GET /user/profile
// ═══════════════════════════════════════════════════════════
router.get("/profile", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
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
        anonMode: true,
        pinHash: true,
        referralCode: true,
        createdAt: true,
        deletionRequestedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

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
        kycStatus: user.kycStatus,
        bioEnabled: user.bioEnabled,
        anonMode: user.anonMode,
        referralCode: user.referralCode,
        pinSet: !!user.pinHash,
        createdAt: user.createdAt,
        deletionRequestedAt: user.deletionRequestedAt,
      },
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// ═══════════════════════════════════════════════════════════
// PATCH /user/anon-mode — hide the username from other people
// ═══════════════════════════════════════════════════════════
const anonModeSchema = z.object({ enabled: z.boolean() });

/**
 * A setting, not a security control, so no PIN.
 *
 * Turning it ON reveals nothing and turning it OFF only republishes a handle
 * the person chose to publish in the first place - neither direction can lose
 * money or leak anything the account holder did not already have. Asking for
 * a PIN here would be ceremony, and ceremony teaches people to type their PIN
 * at prompts that did not need one.
 *
 * Nothing is rewritten retroactively. Transfers already sent carry the name
 * that was public when they were sent, because rewriting history in somebody
 * else's transaction list is a worse surprise than the handle they already
 * saw. It takes effect from here on.
 */
router.patch(
  "/anon-mode",
  requireAuth,
  requireActiveSession,
  validate(anonModeSchema),
  async (req: Request, res: Response) => {
    try {
      const enabled = req.body.enabled === true;
      await prisma.user.update({
        where: { id: req.user!.userId },
        data: { anonMode: enabled },
      });
      console.log(`[ANON] ${req.user!.userId} -> ${enabled ? "on" : "off"}`);
      res.json({ anonMode: enabled });
    } catch (err) {
      console.error("Anon mode error:", err);
      res.status(500).json({ error: "Could not change that just now. Try again." });
    }
  },
);

// ═══════════════════════════════════════════════════════════
// PATCH /user/profile
// ═══════════════════════════════════════════════════════════
router.patch(
  "/profile",
  requireAuth,
  requireActiveSession,
  validate(updateProfileSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { firstName, lastName, username, phone } = req.body;

      /**
       * A name is never set by hand. It comes off the identity document.
       *
       * Refused here rather than only hidden in the app, and for every account
       * rather than only verified ones: the name decides whether a naira
       * deposit is released, so an account that could name itself before
       * verifying could name the account it intended to fund from, and the
       * document would then be checked against a name of its own choosing.
       * Verification is the only writer.
       */
      if (firstName !== undefined || lastName !== undefined) {
        res.status(403).json({
          error: "Your name comes from your verified ID and can't be set by hand.",
        });
        return;
      }

      // Check uniqueness for username and phone
      if (username || phone) {
        const conflicts = await prisma.user.findFirst({
          where: {
            id: { not: userId },
            OR: [
              /**
               * Case-insensitive, because the two halves of this used to
               * disagree. Claiming a name compared it exactly, so MrRevy did
               * not stop mrrevy being taken - while SENDING to a name compared
               * it loosely and matched both. Two accounts, one name as far as
               * a transfer was concerned, and the database free to return
               * whichever it liked.
               */
              ...(username
                ? [{ username: { equals: username, mode: "insensitive" as const } }]
                : []),
              ...(phone ? [{ phone }] : []),
            ],
          },
        });

        if (conflicts) {
          res.status(409).json({ error: "Username or phone already taken" });
          return;
        }
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(username !== undefined && { username }),
          ...(phone !== undefined && { phone }),
        },
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
        },
      });

      const { avatarData, ...rest } = user;
      res.json({ user: { ...rest, avatarUrl: avatarData ?? user.avatarUrl } });
    } catch (err) {
      console.error("Update profile error:", err);
      res.status(500).json({ error: "Failed to update profile" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /user/notification-prefs
// ═══════════════════════════════════════════════════════════
router.get("/notification-prefs", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    let prefs = await prisma.notificationPrefs.findUnique({
      where: { userId },
      select: {
        pushEnabled: true,
        emailEnabled: true,
        txAlerts: true,
        securityAlerts: true,
        savingsAlerts: true,
        promoAlerts: true,
        appUpdates: true,
      },
    });

    // Return defaults if not set
    if (!prefs) {
      prefs = {
        pushEnabled: true,
        emailEnabled: true,
        txAlerts: true,
        securityAlerts: true,
        savingsAlerts: true,
        promoAlerts: true,
        appUpdates: true,
      };
    }

    res.json({ preferences: prefs });
  } catch (err) {
    console.error("Get notification prefs error:", err);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

// ═══════════════════════════════════════════════════════════
// PATCH /user/notification-prefs
// ═══════════════════════════════════════════════════════════
router.patch(
  "/notification-prefs",
  requireAuth,
  requireActiveSession,
  validate(updateNotifPrefsSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      const prefs = await prisma.notificationPrefs.upsert({
        where: { userId },
        update: req.body,
        create: { userId, ...req.body },
        select: {
          pushEnabled: true,
          emailEnabled: true,
          txAlerts: true,
          securityAlerts: true,
          savingsAlerts: true,
          promoAlerts: true,
          appUpdates: true,
        },
      });

      res.json({ preferences: prefs });
    } catch (err) {
      console.error("Update notification prefs error:", err);
      res.status(500).json({ error: "Failed to update preferences" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /user/referrals — the referral dashboard
// ═══════════════════════════════════════════════════════════
/**
 * Everything the dashboard draws, in one call.
 *
 * Counted and pending are counts, not lengths of the list, so somebody with
 * two hundred friends is told two hundred while the list stops at fifty.
 * Nothing about a friend's PIN leaves here but whether they have one.
 */
router.get("/referrals", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, referredBy: true, createdAt: true },
    });
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [counted, total, friends, board] = await Promise.all([
      prisma.user.count({ where: { referredBy: userId, ...COUNTED } }),
      prisma.user.count({ where: { referredBy: userId, deletedAt: null } }),
      prisma.user.findMany({
        where: { referredBy: userId, deletedAt: null },
        select: {
          username: true,
          firstName: true,
          anonMode: true,
          emailVerified: true,
          pinHash: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      referralCounts(),
    ]);

    const idx = board.findIndex((b) => b.userId === userId);
    const claim = claimWindow(me.createdAt, !!me.referredBy);

    res.json({
      code: me.referralCode,
      counted,
      /**
       * Everybody attributed who does not count yet, derived rather than
       * queried. A separate "no PIN" count would miss a friend with a PIN and
       * an unverified email, who would then be in neither number while the
       * list showed them - two figures that did not add up to the list.
       */
      pending: Math.max(0, total - counted),
      rank: idx >= 0 ? idx + 1 : null,
      friends: friends.map((f) => ({
        // Anonymous friends stay anonymous to the person who invited them
        // too - the toggle hides the handle from everybody else.
        name: f.anonMode ? ANON_LABEL : f.username || f.firstName || NO_NAME_LABEL,
        anon: f.anonMode === true,
        counted: isCounted(f),
        joinedAt: f.createdAt,
      })),
      claim: { open: claim.open, daysLeft: claim.daysLeft },
    });
  } catch (err: any) {
    console.error("[REFERRAL] dashboard error:", err?.message);
    res.status(500).json({ error: "Could not load your referrals." });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /user/referrals/claim — add the code you forgot at sign-up
// ═══════════════════════════════════════════════════════════
const claimSchema = z.object({ code: z.string().min(1).max(32) });

/**
 * Once, and only in the first week.
 *
 * The week is what separates "I forgot to type it" from "I am shopping for
 * whoever will credit me", and once is what stops a referrer being swapped.
 * The final write is conditional on referredBy still being empty, so two taps
 * racing each other cannot both succeed.
 */
router.post(
  "/referrals/claim",
  requireAuth,
  requireActiveSession,
  validate(claimSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const code = normaliseCode(req.body.code);

      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { referredBy: true, createdAt: true, referralCode: true },
      });
      if (!me) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (me.referredBy) {
        res.status(400).json({ error: "You have already added a referral code." });
        return;
      }
      if (!claimWindow(me.createdAt, false).open) {
        res.status(400).json({ error: "Referral codes can only be added in your first 7 days." });
        return;
      }
      if (code === me.referralCode) {
        res.status(400).json({ error: "That is your own code." });
        return;
      }

      const referrer = await findReferrer(code);
      if (!referrer) {
        res.status(400).json({ error: "We don't recognise that code." });
        return;
      }
      const block = await attributionBlock({ referrer, refereeId: userId, deviceId: req.deviceId });
      if (block) {
        console.log(`[REFERRAL] claim of ${code} by ${userId} refused: ${block}`);
        res.status(400).json({
          error: block === "own_code" ? "That is your own code." : "That code can't be used on this account.",
        });
        return;
      }

      const written = await prisma.user.updateMany({
        where: { id: userId, referredBy: null },
        data: { referredBy: referrer.id },
      });
      if (written.count === 0) {
        res.status(400).json({ error: "You have already added a referral code." });
        return;
      }

      console.log(`[REFERRAL] ${userId} claimed ${code}`);
      res.json({ ok: true, inviter: inviterName(referrer) });
    } catch (err: any) {
      console.error("[REFERRAL] claim error:", err?.message);
      res.status(500).json({ error: "Could not add that code just now. Try again." });
    }
  },
);

// ═══════════════════════════════════════════════════════════
// GET /user/referral-stats
// ═══════════════════════════════════════════════════════════
router.get("/referral-stats", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Loyalty points: 1 point per ₦100 volume on BUY, SELL, AIRTIME, TV, LOCK
    const volumeTxns = await prisma.transaction.findMany({
      where: {
        userId,
        type: { in: ["BUY", "SELL", "AIRTIME", "TV", "LOCK"] },
        status: "COMPLETED",
      },
      select: { type: true, asset: true, amount: true, metadata: true },
    });

    const rates = await fetchRates();
    /**
     * A lock is worth what the asset locked is worth.
     *
     * This read `tx.asset === "USDT" ? usdtNgn : usdcNgn`, so everything that
     * was not USDT was valued at the dollar - a MOVE lock counted at about a
     * hundred times its worth, and a cNGN lock would count at over a thousand.
     * Only the two dollar tokens were ever right.
     *
     * No fallback rate either. An asset nobody can price contributes nothing
     * to the total rather than being counted as if it were a dollar, which is
     * the same rule the sell quote follows.
     */
    const lockNgn = (asset: string): number => {
      const key = asset === "USDCx" ? "USDC" : asset;
      return Number((rates as any)?.[key]?.ngn) || 0;
    };

    let totalNairaVolume = 0;
    for (const tx of volumeTxns) {
      const meta = tx.metadata as any;
      if (tx.type === "LOCK") {
        totalNairaVolume += Number(tx.amount) * lockNgn(tx.asset);
      } else if (tx.type === "BUY") {
        if (meta?.amountNaira) totalNairaVolume += Number(meta.amountNaira);
      } else if (tx.type === "SELL") {
        if (meta?.ngnGross) totalNairaVolume += Number(meta.ngnGross);
      } else if (meta?.nairaAmount) {
        // AIRTIME, TV
        totalNairaVolume += Number(meta.nairaAmount);
      }
    }

    const loyaltyPoints = Math.floor(totalNairaVolume / 100);

    // Referral count
    // Counted friends only - the same rule the board and the dashboard use.
    const referralCount = await prisma.user.count({ where: { referredBy: userId, ...COUNTED } });

    res.json({
      referralCode: user.referralCode,
      stats: {
        loyaltyPoints,
        totalVolume: totalNairaVolume,
        referralCount,
      },
    });
  } catch (err) {
    console.error("Referral stats error:", err);
    res.status(500).json({ error: "Failed to get referral stats" });
  }
});

// ═══════════════════════════════════════════════════════════
// POST /user/avatar
// ═══════════════════════════════════════════════════════════
router.post(
  "/avatar",
  requireAuth,
  requireActiveSession,
  avatarUpload.single("avatar"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
      }

      const userId = req.user!.userId;

      // Store the image directly in the DB as a base64 data URI.
      const avatarData = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      await prisma.user.update({
        where: { id: userId },
        // Clear any legacy disk-based URL so avatarData is the source of truth.
        data: { avatarData, avatarUrl: null },
      });

      res.json({ avatarUrl: avatarData });
    } catch (err) {
      console.error("Avatar upload error:", err);
      res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// DELETE /user/avatar
// ═══════════════════════════════════════════════════════════
router.delete("/avatar", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;

    await prisma.user.update({
      where: { id: userId },
      data: { avatarData: null, avatarUrl: null },
    });

    res.json({ message: "Avatar removed" });
  } catch (err) {
    console.error("Avatar delete error:", err);
    res.status(500).json({ error: "Failed to remove avatar" });
  }
});

// ═══════════════════════════════════════════════════════════
// GET /user/check-username/:username
// ═══════════════════════════════════════════════════════════
router.get(
  "/check-username/:username",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const username = req.params.username as string;
      if (!username || username.length < 3) {
        res.json({ available: false, reason: "Username must be at least 3 characters" });
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        res.json({ available: false, reason: "Only letters, numbers, and underscores" });
        return;
      }
      // The same comparison the claim uses, or this says "available" about a
      // name the claim will then refuse - or worse, accept.
      const existing = await prisma.user.findFirst({
        where: { username: { equals: username, mode: "insensitive" } },
      });
      if (existing && existing.id !== req.user!.userId) {
        res.json({ available: false, reason: "This username is taken" });
        return;
      }
      res.json({ available: true });
    } catch (err) {
      console.error("Check username error:", err);
      res.status(500).json({ error: "Failed to check username" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /user/phone-change/request  — sends verification code to email
// ═══════════════════════════════════════════════════════════
const phoneChangeSchema = z.object({
  phone: z.string().min(7, "Phone number too short").max(16, "Phone number too long"),
});

router.post(
  "/phone-change/request",
  requireAuth,
  requireActiveSession,
  validate(phoneChangeSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { phone } = req.body;

      // Check phone not taken
      const conflict = await prisma.user.findFirst({
        where: { phone, id: { not: userId } },
      });
      if (conflict) {
        res.status(409).json({ error: "Phone number already in use" });
        return;
      }

      // Rate limit: 1 per 60s
      const recent = await prisma.verificationCode.findFirst({
        where: {
          userId,
          type: "PHONE_CHANGE",
          createdAt: { gt: new Date(Date.now() - 60 * 1000) },
        },
      });
      if (recent) {
        res.status(429).json({ error: "Please wait 60 seconds before requesting a new code" });
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) { res.status(404).json({ error: "User not found" }); return; }

      const code = generateVerificationCode();
      await prisma.verificationCode.create({
        data: {
          userId,
          type: "PHONE_CHANGE",
          codeHash: hashToken(code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          metadata: phone, // store pending phone in metadata
        },
      });

      await sendVerificationEmail(user.email, code);
      res.json({ message: "Verification code sent to your email" });
    } catch (err) {
      console.error("Phone change request error:", err);
      res.status(500).json({ error: "Failed to send verification code" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /user/phone-change/verify  — verifies code and updates phone
// ═══════════════════════════════════════════════════════════
const phoneVerifySchema = z.object({
  code: z.coerce.string().length(6),
});

router.post(
  "/phone-change/verify",
  requireAuth,
  requireActiveSession,
  validate(phoneVerifySchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { code } = req.body;

      const verification = await prisma.verificationCode.findFirst({
        where: {
          userId,
          type: "PHONE_CHANGE",
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!verification) {
        res.status(400).json({ error: "No valid verification code found" });
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
        console.log("Phone verify mismatch:", { code, hashed: hashToken(code), stored: verification.codeHash });
        res.status(400).json({
          error: "Invalid code",
          attemptsRemaining: 4 - verification.attempts,
        });
        return;
      }

      const newPhone = verification.metadata;
      if (!newPhone) {
        res.status(400).json({ error: "Phone data missing" });
        return;
      }

      await prisma.$transaction([
        prisma.verificationCode.update({
          where: { id: verification.id },
          data: { usedAt: new Date() },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { phone: newPhone },
        }),
      ]);

      res.json({ message: "Phone number updated", phone: newPhone });
    } catch (err) {
      console.error("Phone change verify error:", err);
      res.status(500).json({ error: "Verification failed" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// GET /user/lookup/:username
// Lookup a user by username for internal transfers.
// Returns basic info only — no sensitive data.
// ═══════════════════════════════════════════════════════════
router.get(
  "/lookup/:username",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const senderId = req.user!.userId;
      const username = String(req.params.username || "").trim().toLowerCase();

      if (!username || username.length < 3) {
        res.status(400).json({ error: "Username must be at least 3 characters" });
        return;
      }

      // No KYC check on either side. A username transfer moves tokens between
      // two self-custody wallets on chain, so there is no payout rail to gate;
      // requiring the recipient to be VERIFIED only meant a 403 the sender
      // could do nothing about.
      /**
       * Every match, then one of them deliberately.
       *
       * findFirst with no ordering handed back whichever row the database
       * reached first, which for two accounts differing only in case is a coin
       * toss - and the coin decided who received money. An exact match wins;
       * failing that a single loose match is fine; two loose matches and
       * nobody is chosen at all.
       */
      const matches = await prisma.user.findMany({
        where: { username: { equals: username, mode: "insensitive" } },
        select: {
          id: true,
          username: true,
          firstName: true,
          lastName: true,
          anonMode: true,
          avatarUrl: true,
          avatarData: true,
        },
        take: 5,
      });

      const target =
        matches.find((m) => m.username === username) ??
        (matches.length === 1 ? matches[0] : null);

      if (!target && matches.length > 1) {
        console.error(
          `[USERNAME] ambiguous lookup "${username}" matched ${matches.length}: ` +
            matches.map((m) => m.username).join(", "),
        );
        res.status(409).json({
          error: "More than one account uses that name. Check the spelling exactly as they wrote it.",
          code: "USERNAME_AMBIGUOUS",
        });
        return;
      }

      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (target.id === senderId) {
        res.status(400).json({ error: "You cannot send to yourself" });
        return;
      }


      /**
       * An anonymous account confirms as a handle and a face, not a name.
       *
       * This is the one endpoint anonymous mode deliberately keeps working,
       * because somebody who was given the handle has to be able to pay it.
       * But "can pay you" and "knows your legal name" are different
       * permissions, and returning both made the first grant the second - so
       * anyone who could guess a handle could also read the name behind it.
       *
       * The picture stays. It is what the sender actually checks against
       * before confirming, and it is already the person's chosen public face
       * on the leaderboard.
       */
      const hideName = target.anonMode === true;

      res.json({
        user: {
          id: target.id,
          username: target.username,
          firstName: hideName ? null : target.firstName,
          lastName: hideName ? null : target.lastName,
          anon: hideName,
          avatarUrl: target.avatarData ?? target.avatarUrl,
        },
      });
    } catch (err) {
      console.error("Lookup user error:", err);
      res.status(500).json({ error: "Failed to look up user" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// DELETE /user/account — Soft-delete (compliance: retain records 5 yrs)
// ═══════════════════════════════════════════════════════════
router.delete("/account", requireAuth, requireActiveSession, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    // Read first: the email survives the soft-delete, but asking for it before
    // keeps the notice independent of what the transaction wipes.
    const owner = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

    await prisma.$transaction([
      // Purge non-essential data
      prisma.notification.deleteMany({ where: { userId } }),
      prisma.notificationPrefs.deleteMany({ where: { userId } }),
      prisma.chatMessage.deleteMany({ where: { conversation: { userId } } }),
      prisma.chatConversation.deleteMany({ where: { userId } }),
      prisma.beneficiary.deleteMany({ where: { userId } }),
      prisma.savingsLock.deleteMany({ where: { userId } }),

      // Revoke all auth — blocks login immediately
      prisma.session.deleteMany({ where: { userId } }),
      prisma.verificationCode.deleteMany({ where: { userId } }),
      prisma.refreshToken.deleteMany({ where: { userId } }),

      // Soft-delete: wipe sensitive fields, mark deleted
      // KEEP: email, phone, firstName, lastName, kycStatus, kycProvider,
      //       kycReference, referralCode, transactions, wallets, kycVerifications
      //       (retained 5 years for AML/CFT compliance)
      prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          passwordHash: "DELETED",
          pinHash: null,
          bioEnabled: false,
          avatarUrl: null,
          avatarData: null,
          username: null,
          failedLoginAttempts: 0,
          loginLockedUntil: null,
          failedPinAttempts: 0,
          pinLockedUntil: null,
        },
      }),
    ]);

    if (owner?.email) {
      sendAccountClosedEmail(owner.email, new Date()).catch((e) =>
        console.error("[ACCOUNT] closed email failed:", e?.message),
      );
    }
    res.json({ message: "Account deleted successfully" });
  } catch (err) {
    console.error("Account delete error:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

// ═════════════════════════════════════════════════════════
// POST /user/account/deletion-request — ask us to close the account
//
// Not a delete. A closure wipes auth and ends sessions, and the account may
// still hold crypto the user has not moved out, so it is reviewed by a person
// before anything is destroyed. Until then the account works normally.
// ═════════════════════════════════════════════════════════
router.post(
  "/account/deletion-request",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const raw = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      const reason = raw ? raw.slice(0, 500) : null;

      const existing = await prisma.user.findUnique({
        where: { id: userId },
        select: { deletionRequestedAt: true },
      });

      // Asking twice is not an error; it is the same request.
      if (existing?.deletionRequestedAt) {
        res.json({ deletionRequestedAt: existing.deletionRequestedAt, alreadyRequested: true });
        return;
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: new Date(), deletionReason: reason },
        select: { deletionRequestedAt: true, email: true },
      });

      console.log("[ACCOUNT] deletion requested by", userId, reason ? "- " + reason : "");
      // Not awaited: the request is saved whether or not the email goes out,
      // and a slow mail provider should not hold the screen.
      if (user.deletionRequestedAt) {
        sendClosureRequestedEmail(user.email, user.deletionRequestedAt).catch((e) =>
          console.error("[ACCOUNT] closure-request email failed:", e?.message),
        );
      }
      res.json({ deletionRequestedAt: user.deletionRequestedAt, alreadyRequested: false });
    } catch (err) {
      console.error("Deletion request error:", err);
      res.status(500).json({ error: "Failed to submit your request" });
    }
  }
);

// ═════════════════════════════════════════════════════════
// DELETE /user/account/deletion-request — withdraw it
// ═════════════════════════════════════════════════════════
router.delete(
  "/account/deletion-request",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const before = await prisma.user.findUnique({
        where: { id: userId },
        select: { deletionRequestedAt: true, email: true },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: null, deletionReason: null },
      });

      // Only when there was a request to cancel: a second tap, or a cancel
      // from a stale screen, is not news worth an email.
      if (before?.deletionRequestedAt && before.email) {
        console.log("[ACCOUNT] deletion request cancelled by", userId);
        sendClosureCancelledEmail(before.email, new Date()).catch((e) =>
          console.error("[ACCOUNT] closure-cancelled email failed:", e?.message),
        );
      }
      res.json({ deletionRequestedAt: null });
    } catch (err) {
      console.error("Deletion request cancel error:", err);
      res.status(500).json({ error: "Failed to cancel your request" });
    }
  }
);

export default router;
