import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { sendNotification } from "../lib/push";
import { KycError, identitySettings, latestManual, manualView, startHandoff } from "../lib/manual-kyc";
import {
  createDiditSession,
  getDiditDecision,
  mapDiditStatus,
  extractDiditDetails,
  effectiveDiditStatus,
  isDiditConfigured,
  findDuplicateMatches,
  hasDuplicateWarning,
  buildIdentityKeys,
} from "../lib/didit";

const router = Router();

// NIN document images are stored in the DB as base64 data URIs (no local disk).
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per image

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 2 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG or WEBP images are allowed"));
  },
});

function toDataUri(file: Express.Multer.File): string {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

// --- POST /kyc/submit — User submits NIN + front/back images for review --
const submitNinSchema = z.object({
  nin: z
    .string()
    .length(11, "NIN must be 11 digits")
    .regex(/^\d{11}$/, "NIN must be 11 digits"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

router.post(
  "/submit",
  requireAuth,
  upload.fields([
    { name: "front", maxCount: 1 },
    { name: "back", maxCount: 1 },
  ]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;

      // multipart text fields arrive as strings on req.body
      const parsed = submitNinSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid input" });
      }
      const { nin, firstName, lastName } = parsed.data;

      // Require both document images
      const files = req.files as { front?: Express.Multer.File[]; back?: Express.Multer.File[] } | undefined;
      const frontFile = files?.front?.[0];
      const backFile = files?.back?.[0];
      if (!frontFile || !backFile) {
        return res.status(400).json({ error: "Please upload clear photos of the front and back of your NIN." });
      }

      // Check if user already has a pending or verified KYC
      const existing = await prisma.kycVerification.findFirst({
        where: { userId, status: { in: ["PENDING", "VERIFIED"] } },
        orderBy: { createdAt: "desc" },
      });

      if (existing?.status === "VERIFIED") {
        return res.status(400).json({ error: "Your identity is already verified" });
      }
      if (existing?.status === "PENDING") {
        return res.status(400).json({ error: "Your verification is already in progress. We'll notify you as soon as it's complete." });
      }

      // Reject if the same NIN is already tied to another account (pending or verified)
      const ninInUse = await prisma.kycVerification.findFirst({
        where: {
          documentType: "NIN",
          documentNumber: nin,
          status: { in: ["PENDING", "VERIFIED"] },
          userId: { not: userId },
        },
        select: { id: true },
      });
      if (ninInUse) {
        return res.status(400).json({ error: "This NIN is already linked to another account." });
      }

      // Create verification record (PENDING — admin will review)
      const verification = await prisma.kycVerification.create({
        data: {
          userId,
          documentType: "NIN",
          documentNumber: nin,
          firstName,
          lastName,
          provider: "manual",
          status: "PENDING",
          frontImage: toDataUri(frontFile),
          backImage: toDataUri(backFile),
        },
      });

      // Update user KYC status
      await prisma.user.update({
        where: { id: userId },
        data: { kycStatus: "PENDING", kycProvider: "manual", kycReference: verification.id },
      });

      return res.json({
        status: "pending",
        message: "Your NIN has been submitted for verification. You will be notified once reviewed.",
        verification: {
          id: verification.id,
          firstName,
          lastName,
          documentType: "NIN",
          status: "PENDING",
        },
      });
    } catch (err: any) {
      // Multer errors (size/type) surface as generic errors — return a clean 400
      if (err?.message && (err.message.includes("images are allowed") || err.code === "LIMIT_FILE_SIZE")) {
        return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Each image must be under 8MB." : err.message });
      }
      next(err);
    }
  }
);

// --- GET /kyc/status — Get current KYC status ---------------
router.get(
  "/status",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { kycStatus: true, kycProvider: true, firstName: true, lastName: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const latest = await prisma.kycVerification.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, documentType: true, status: true,
          firstName: true, lastName: true, failureReason: true, createdAt: true,
        },
      });

      return res.json({
        kycStatus: user.kycStatus,
        provider: user.kycProvider,
        verification: latest || null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// Didit hosted identity verification
// ═══════════════════════════════════════════════════════════
//
// NOTE ON STORAGE: we reuse the existing KycVerification columns rather than
// migrating the production schema — provider="didit" and metamapRef holds the
// Didit session id (it is just a unique external reference). documentType /
// documentNumber are NOT NULL, so they're seeded and later filled in from the
// decision payload.

/** Reason code stored on a rejection caused by an identity already in use. */
/**
 * How long after a refusal before another attempt may be started, and how many
 * attempts one account gets in a day. Both guard the same thing: a session at
 * the provider costs money and a refused one teaches nobody anything when it
 * is repeated a second later.
 */
const KYC_RETRY_WAIT_MS = 60_000;
const KYC_MAX_ATTEMPTS_PER_DAY = 3;

const DUPLICATE_REASON = "DUPLICATE_IDENTITY";

/**
 * Refuse an approval when this person - or this document - has already verified
 * another account. Returns a failure reason to reject with, or null to allow.
 *
 * Two independent gates, because each catches what the other misses:
 *
 *  1. Didit's 1:N face search (already running inside LIVENESS) catches someone
 *     who returns with a DIFFERENT document, since the face is the constant.
 *  2. A unique index on the identifiers themselves catches identical twins, and
 *     any session where the face capture was too poor to match. Being a database
 *     constraint it also settles the case where two accounts approve in the same
 *     instant - a check-then-write cannot.
 */
/**
 * Write down the identifiers this account verified with.
 *
 * Separate from the gate below, because the two want opposite timing. The gate
 * may only run on the way INTO verified - re-running it against an account that
 * already holds its own claims would match them and revoke a good account. But
 * RECORDING has to be able to run later, because the data often arrives later:
 * Didit's OCR fails on a Nigerian document, an administrator approves the
 * session and types the details into their console afterwards, and only then is
 * there a NIN to write down.
 *
 * That gap had a consequence past bookkeeping. The virtual account a naira
 * deposit pays into cannot be issued without an 11-digit NIN, and the NIN is
 * read from these claims - so an account verified from a blank decision was
 * told its ID carried no National Identity Number, however many times the
 * number was corrected upstream.
 *
 * A key already held by somebody else is skipped and logged, never written and
 * never used to reject: deciding that is the gate's job, on the transition,
 * with the whole session in front of it.
 */
async function recordIdentityClaims(
  userId: string,
  sessionId: string,
  decision: any
): Promise<number> {
  const keys = buildIdentityKeys(decision);
  if (keys.length === 0) return 0;

  const existing = await prisma.identityClaim.findMany({
    where: { key: { in: keys.map((k) => k.key) } },
    select: { key: true, userId: true },
  });
  const held = new Map(existing.map((e) => [e.key, e.userId]));

  const toCreate = keys.filter((k) => {
    const owner = held.get(k.key);
    if (!owner) return true;
    if (owner !== userId) {
      console.warn("[kyc] identity key belongs to another account, not recording", {
        userId,
        sessionId,
        key: k.key,
        heldBy: owner,
      });
    }
    return false;
  });
  if (toCreate.length === 0) return 0;

  try {
    const { count } = await prisma.identityClaim.createMany({
      data: toCreate.map((k) => ({ userId, key: k.key, kind: k.kind, sessionId })),
      skipDuplicates: true,
    });
    console.log(`[kyc] recorded ${count} identity claim(s) for ${userId}`);
    return count;
  } catch (err: any) {
    // Losing the race here is not a rejection - the gate decides that.
    if (err?.code !== "P2002") throw err;
    return 0;
  }
}

/**
 * Every approved session this person has, not only the one that decided their
 * status.
 *
 * findDecision stops at the first session that decided anything, which is the
 * right answer for "are they verified?" and the wrong one for "what documents
 * do they hold?". Somebody who verified with a passport and then submitted a
 * national ID card has two approved sessions; only the first was ever read, so
 * the NIN on the second was never written down. The account showed VERIFIED
 * with no NIN on file, and was refused a payment account with nothing in the
 * queue explaining why - which is exactly how it looked from the outside: all
 * approved, no NIN.
 *
 * Additive and safe to repeat. A key another account already holds is skipped
 * by recordIdentityClaims and never overwritten, so this can only ever fill in
 * what a person genuinely proved.
 *
 * Called from the admin re-read rather than from every poll: it costs one
 * provider call per past session, and the reviewer pressing that button is
 * asking this precise question.
 */
async function harvestIdentityClaims(userId: string): Promise<number> {
  const rows = await prisma.kycVerification.findMany({
    where: { userId, provider: "didit" },
    orderBy: { createdAt: "desc" },
    select: { metamapRef: true },
    take: 8,
  });

  const refs = [...new Set(rows.map((r) => r.metamapRef).filter((r): r is string => !!r))];
  let added = 0;

  for (const ref of refs) {
    const decision = await getDiditDecision(ref).catch(() => null);
    if (!decision) continue;
    if (mapDiditStatus(effectiveDiditStatus(decision)) !== "VERIFIED") continue;
    added += await recordIdentityClaims(userId, ref, decision);
  }

  if (added) console.log(`[kyc] harvest found ${added} new claim(s) for ${userId} across ${refs.length} session(s)`);
  return added;
}

async function enforceUniqueIdentity(
  userId: string,
  sessionId: string,
  decision: any
): Promise<string | null> {
  // --- Gate 1: biometric -------------------------------------------------
  // vendor_data is our userId, so a hit carrying this same id is just this
  // person re-submitting after a failed attempt - never block that.
  const matches = findDuplicateMatches(decision, userId);
  if (matches.length > 0) {
    console.warn("[kyc] blocked duplicate face", {
      userId,
      sessionId,
      warned: hasDuplicateWarning(decision),
      matches: matches.map((m) => ({
        otherVendorData: m.vendorData,
        otherSession: m.sessionId,
        similarity: m.similarity,
        blocklisted: m.blocklisted,
      })),
    });
    return DUPLICATE_REASON;
  }

  // --- Gate 2: the identifiers themselves --------------------------------
  const keys = buildIdentityKeys(decision);
  if (keys.length === 0) {
    // Nothing legible to claim. Gate 1 still applied, so let it through rather
    // than punishing a user for a document our OCR read only partially.
    console.warn("[kyc] no identity keys extracted", { userId, sessionId });
    return null;
  }

  const existing = await prisma.identityClaim.findMany({
    where: { key: { in: keys.map((k) => k.key) } },
    select: { key: true, userId: true },
  });

  const foreign = existing.find((e) => e.userId !== userId);
  if (foreign) {
    console.warn("[kyc] blocked duplicate identity key", {
      userId,
      sessionId,
      key: foreign.key,
      alreadyHeldBy: foreign.userId,
    });
    return DUPLICATE_REASON;
  }

  const alreadyMine = new Set(existing.map((e) => e.key));
  const toCreate = keys.filter((k) => !alreadyMine.has(k.key));
  if (toCreate.length > 0) {
    try {
      await prisma.identityClaim.createMany({
        data: toCreate.map((k) => ({ userId, key: k.key, kind: k.kind, sessionId })),
      });
    } catch (err: any) {
      // P2002 = the unique index fired, i.e. another account claimed the same
      // identifier between our read and our write. Losing that race is exactly
      // what this constraint exists for.
      if (err?.code === "P2002") {
        console.warn("[kyc] lost identity-claim race", { userId, sessionId });
        return DUPLICATE_REASON;
      }
      throw err;
    }
  }

  return null;
}

/** Mirror a Didit decision onto our KycVerification row + user.kycStatus. */
async function applyDiditDecision(userId: string, sessionId: string, decision: any) {
  // Prefer a manual dashboard override over the automated verdict.
  const diditStatus = effectiveDiditStatus(decision);
  let mapped = mapDiditStatus(diditStatus);
  const details = extractDiditDetails(decision);

  // An approval from Didit is necessary but not sufficient: its verdict answers
  // "is this a real person holding a real ID?", not "has this identity already
  // been used here?". Duplicate hits arrive as warnings on an Approved session,
  // so a clean top-level status proves nothing on its own.
  //
  // The previous status is read first because it decides two things: whether to
  // notify, and whether the duplicate gate should run at all.
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { kycStatus: true, firstName: true, lastName: true },
  });

  let duplicateBlocked = false;
  // Only gate the transition INTO verified. This runs on every poll, and an
  // account that is already verified holds its identity claims — re-checking
  // would match them against their own history and revoke a good account.
  if (mapped === "VERIFIED" && before?.kycStatus !== "VERIFIED") {
    const reason = await enforceUniqueIdentity(userId, sessionId, decision);
    if (reason) {
      mapped = "REJECTED";
      duplicateBlocked = true;
    }
  }

  /**
   * Whatever the document says, written down, every time we are told - not only
   * the first time. Runs after the gate, so a session the gate is about to
   * reject never records anything.
   */
  if (mapped === "VERIFIED" && !duplicateBlocked) {
    await recordIdentityClaims(userId, sessionId, decision);
  }

  /**
   * A re-read never takes verification away.
   *
   * Didit's OCR fails on Nigerian documents often enough that approving by
   * hand is a normal part of the job - and the session that was approved by
   * hand is still "not approved" at Didit for ever after. So pressing "Re-read
   * from Didit" on such an account used to quietly un-verify the person: the
   * name and the identity claims stayed, the status went back to PENDING, and
   * they lost their limits without anybody deciding that.
   *
   * Enrichment still applies - a name corrected in Didit's console is exactly
   * what the button is for. Only the downgrade is refused, and Revoke is the
   * deliberate act that exists for taking verification away.
   */
  if (mapped !== "VERIFIED" && before?.kycStatus === "VERIFIED") {
    console.log(
      `[kyc] ${userId} is verified and Didit says ${String(diditStatus)} — keeping it; use Revoke to undo a verification`
    );
    mapped = "VERIFIED";
  }

  await prisma.kycVerification.updateMany({
    where: { userId, metamapRef: sessionId },
    data: {
      status: mapped === "VERIFIED" ? "VERIFIED" : mapped === "REJECTED" ? "REJECTED" : "PENDING",
      firstName: details.firstName ?? undefined,
      lastName: details.lastName ?? undefined,
      dateOfBirth: details.dateOfBirth ?? undefined,
      documentNumber: details.documentNumber ?? undefined,
      rawResponse: decision ?? undefined,
      failureReason: duplicateBlocked
        ? DUPLICATE_REASON
        : mapped === "REJECTED"
        ? String(diditStatus ?? "Declined")
        : null,
    },
  });

  /**
   * A verified account takes the name off its own document.
   *
   * The profile name used to be whatever someone typed, and nothing ever
   * reconciled it with the ID: this platform's first account held firstName
   * "Okotete", lastName "Collins" while its Didit row had them the other way
   * round. That is a cosmetic problem right up until the name is load-bearing,
   * which it now is - a naira deposit is checked against it before any crypto
   * is released.
   *
   * Only for the fields the document actually yielded: a provider that
   * returned no surname must not blank one.
   *
   * And only on the way in, or onto an account that has no name at all. It
   * used to run on every poll that came back verified, which had two teeth:
   * a re-read of a session approved by hand adopted whatever that session's
   * OCR had produced, and on a Nigerian ID card that is the card's own field
   * labels - "Nationalldentity Card Surnaml Nationalioontitynjmoer Okoh
   * Firstname..." went onto a real account as a real name, over the one a
   * reviewer had just typed in. A name already on file is now left alone;
   * filling a blank one is what healMissingIdentity needs and still works.
   */
  const entering = before?.kycStatus !== "VERIFIED";
  const nameless = !before?.firstName && !before?.lastName;
  const adoptName =
    mapped === "VERIFIED" && (entering || nameless)
      ? {
          ...(details.firstName ? { firstName: details.firstName } : {}),
          ...(details.lastName ? { lastName: details.lastName } : {}),
        }
      : {};

  // Only NONE/PENDING/VERIFIED/REJECTED are valid on the user.
  await prisma.user.update({
    where: { id: userId },
    data: { kycStatus: mapped, kycProvider: "didit", ...adoptName },
  });

  if (before?.kycStatus !== mapped && (mapped === "VERIFIED" || mapped === "REJECTED")) {
    sendNotification({
      userId,
      type: "security",
      title: mapped === "VERIFIED" ? "Identity verified" : "Verification unsuccessful",
      body:
        mapped === "VERIFIED"
          ? "You're verified. Your full limits are now live."
          : duplicateBlocked
          ? "This ID is already linked to another Money Moves account."
          : "We couldn't verify your identity. Open Money Moves to try again.",
    }).catch(() => {});
  }

  return mapped;
}

// --- POST /kyc/didit/session — start (or resume) a hosted verification ---
// --- GET /kyc/manual — how a new check is done, and where a manual one stands ---
router.get("/manual", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await manualView(req.user!.userId));
  } catch (err) {
    next(err);
  }
});

// --- POST /kyc/manual/handoff — a link to the page the check is taken on ---
router.post("/manual/handoff", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await startHandoff(req.user!.userId));
  } catch (err) {
    if (err instanceof KycError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.post("/didit/session", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // With manual checks on, a new check is taken on our page; one already started with the partner can still finish.
    if ((await identitySettings()).manual) {
      const started = await prisma.kycVerification.findFirst({ where: { userId: req.user!.userId, provider: "didit", status: "PENDING" }, orderBy: { createdAt: "desc" } });
      if (!started) return res.status(409).json({ error: "Start the check from the verification screen.", code: "manual_identity" });
    }
    if (!isDiditConfigured) {
      return res.status(503).json({ error: "Identity verification is not configured yet." });
    }
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, email: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.kycStatus === "VERIFIED") {
      return res.status(409).json({ error: "Your identity is already verified.", kycStatus: "VERIFIED" });
    }

    /**
     * A pause after a refusal, and a ceiling on the day.
     *
     * Every tap opens a session at the provider and every session is billed,
     * and the records show retries landing one second after the decline was
     * recorded - which is not somebody reading the result and deciding to go
     * again, it is a button still live while the screen catches up. One person
     * spent four sessions in six minutes that way.
     *
     * The wait is short on purpose. A refusal is usually the light, or a thumb
     * over the document, and the fix is to try again in a moment - so this is
     * long enough to make the retry deliberate and not so long that someone
     * who knows what went wrong is left sitting there.
     *
     * It lives here rather than on the button because the button is not the
     * only thing that can call this, and a guard that ships in an app version
     * protects only the people who have that version.
     */
    const recent = await prisma.kycVerification.findFirst({
      where: { userId, provider: "didit" },
      orderBy: { createdAt: "desc" },
      select: { status: true, updatedAt: true },
    });
    if (recent?.status === "REJECTED") {
      const waited = Date.now() - recent.updatedAt.getTime();
      if (waited < KYC_RETRY_WAIT_MS) {
        const seconds = Math.ceil((KYC_RETRY_WAIT_MS - waited) / 1000);
        res.status(429).json({
          error: `That check did not pass. Give it ${seconds} seconds, make sure your face and your ID are well lit, and try again.`,
          retryAfter: seconds,
        });
        return;
      }
    }

    /**
     * A rolling day, so the answer is a number of hours rather than "tomorrow".
     *
     * The window runs from each attempt, not from midnight, which means the
     * cap frees up twenty-four hours after the oldest of the three - a time
     * this can work out and say, instead of leaving someone to guess whether
     * midnight or the morning is what unlocks it.
     */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const attempts = await prisma.kycVerification.findMany({
      where: { userId, provider: "didit", createdAt: { gte: since } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const today = attempts.length;
    if (today >= KYC_MAX_ATTEMPTS_PER_DAY) {
      const freeAt = attempts[0].createdAt.getTime() + 24 * 60 * 60 * 1000;
      const hours = Math.max(1, Math.ceil((freeAt - Date.now()) / (60 * 60 * 1000)));
      res.status(429).json({
        // The number, not "several". Someone just refused wants to know
        // whether to try again in a minute or tomorrow, and the screen has
        // been showing them this figure since before they began.
        error: `That is ${KYC_MAX_ATTEMPTS_PER_DAY} attempts in 24 hours, which is the limit. You can try again in ${hours} ${hours === 1 ? "hour" : "hours"}, or message support and we will look at what is going wrong.`,
        attemptsPerDay: KYC_MAX_ATTEMPTS_PER_DAY,
        retryInHours: hours,
      });
      return;
    }

    // A duplicate block is final: the ID belongs to another account, so another
    // pass at the same documents cannot change the outcome. Say so instead of
    // letting them loop through the hosted flow forever.
    const blocked = await prisma.kycVerification.findFirst({
      where: { userId, provider: "didit", failureReason: DUPLICATE_REASON },
      select: { id: true },
    });
    if (blocked) {
      return res.status(409).json({
        error:
          "This ID is already linked to another Money Moves account. Contact support if you believe this is a mistake.",
        kycStatus: "REJECTED",
        code: DUPLICATE_REASON,
      });
    }

    const session = await createDiditSession(userId, user.email);

    // Didit dedupes on vendor_data: asking again for the same user returns the
    // SAME session_id rather than erroring. metamapRef is unique, so this must
    // upsert — a plain create blew up with a unique-constraint violation the
    // moment a user restarted an abandoned verification.
    const mapped = mapDiditStatus(effectiveDiditStatus(session));
    await prisma.kycVerification.upsert({
      where: { metamapRef: session.session_id },
      create: {
        userId,
        provider: "didit",
        metamapRef: session.session_id,
        documentType: "DIDIT",
        documentNumber: session.session_id, // placeholder until the decision lands
        status: mapped === "VERIFIED" ? "VERIFIED" : mapped === "REJECTED" ? "REJECTED" : "PENDING",
      },
      update: {
        status: mapped === "VERIFIED" ? "VERIFIED" : mapped === "REJECTED" ? "REJECTED" : "PENDING",
        failureReason: null,
      },
    });
    await prisma.user.update({
      where: { id: userId },
      // Reflect what Didit actually reports — a freshly created session is
      // "Not Started", so don't claim PENDING before they've submitted anything.
      data: { kycStatus: mapped, kycProvider: "didit" },
    });

    return res.json({
      sessionId: session.session_id,
      url: session.url,
      status: session.status,
    });
  } catch (err: any) {
    console.error("Didit create-session error:", err?.message || err);
    return res.status(502).json({
      error: "Couldn't start verification right now. Please try again in a moment.",
    });
  }
});

/**
 * Which of a person's sessions actually decided something.
 *
 * Starting verification opens a session; abandoning it and starting again
 * opens another. The provider reports an abandoned one as "Not Started" and
 * goes on reporting that forever, so asking about the newest can be asking a
 * question with no answer while an Approved session sits one row below. Two
 * people were stranded that way: verified IDs on file, unverified accounts.
 *
 * Newest first, because where two have decided the later one is the truth - a
 * revoked or re-run check has to be able to overturn an older pass. Only when
 * the newest has not started does this look behind it.
 *
 * One place, so the user's own poll and both admin buttons agree about what
 * the answer is.
 */
export async function findDecision(
  userId: string,
  preferredRef?: string | null,
): Promise<{ ref: string; decision: any } | null> {
  if (!isDiditConfigured) return null;

  const recent = await prisma.kycVerification.findMany({
    where: { userId, provider: "didit" },
    orderBy: { createdAt: "desc" },
    select: { metamapRef: true },
    take: 5,
  });

  const refs = [
    ...(preferredRef ? [preferredRef] : []),
    ...recent.map((r) => r.metamapRef).filter((r): r is string => !!r),
  ];

  let fallback: { ref: string; decision: any } | null = null;
  const asked = new Set<string>();

  for (const ref of refs) {
    if (asked.has(ref)) continue;
    asked.add(ref);
    const decision = await getDiditDecision(ref).catch(() => null);
    if (!decision) continue;
    if (mapDiditStatus(effectiveDiditStatus(decision)) !== "NONE") {
      return { ref, decision };
    }
    // Nothing decided here, but it is still the honest answer if none of the
    // others decided either.
    fallback = fallback ?? { ref, decision };
  }

  return fallback;
}

// --- GET /kyc/didit/status — poll Didit and mirror the result ---
router.get("/didit/status", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // The newest check is a manual one: its state is ours, nothing to ask the partner.
    const manual = await latestManual(userId);
    if (manual) {
      const view = await manualView(userId);
      return res.json({
        kycStatus: view.kycStatus,
        diditStatus: null,
        sessionId: null,
        failureReason: view.check?.note ?? null,
        manual: view,
      });
    }

    /**
     * The newest session is not always the one that decided anything.
     *
     * Somebody who passes and then taps Verify again leaves a second session
     * behind that they never submit. Didit reports it as "Not Started" and
     * goes on reporting that forever, so polling the newest asked a question
     * with no answer while an Approved session sat one row below - and the
     * person stayed unverified with a verified ID on file. It happened within
     * three minutes of passing.
     *
     * So the recent sessions are read, not just the last, and the first that
     * carries a real decision is the one applied. Newest first, because where
     * two have decided the later one is the truth - a revoked or re-run check
     * has to be able to overturn an older pass.
     */
    const recent = await prisma.kycVerification.findMany({
      where: { userId, provider: "didit" },
      orderBy: { createdAt: "desc" },
      select: { metamapRef: true, status: true, failureReason: true },
      take: 5,
    });
    const decided = recent.find((r) => r.status === "VERIFIED" || r.status === "REJECTED");
    const latest = decided ?? recent[0] ?? null;

    if (!latest?.metamapRef) {
      // No session to ask about: either nothing was ever started, or an
      // administrator revoked the last one and detached it deliberately. Either
      // way the account's own status is the answer, and the reason with it.
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      return res.json({
        kycStatus: u?.kycStatus ?? "NONE",
        diditStatus: null,
        sessionId: null,
        failureReason: latest?.failureReason ?? null,
      });
    }

    if (!isDiditConfigured) {
      return res.json({
        kycStatus: latest.status,
        diditStatus: null,
        sessionId: latest.metamapRef,
        failureReason: latest.failureReason,
      });
    }

    const found = await findDecision(userId, latest.metamapRef);
    if (!found) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
      return res.json({
        kycStatus: u?.kycStatus ?? "NONE",
        diditStatus: null,
        sessionId: latest.metamapRef,
        failureReason: latest.failureReason,
      });
    }
    const { ref, decision } = found;
    const kycStatus = await applyDiditDecision(userId, ref, decision);

    const after = await prisma.kycVerification.findFirst({
      where: { userId, metamapRef: latest.metamapRef },
      select: { failureReason: true },
    });

    return res.json({
      kycStatus,
      diditStatus: effectiveDiditStatus(decision) ?? null,
      sessionId: ref,
      failureReason: after?.failureReason ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// --- POST /kyc/didit/webhook — Didit pushes status changes here ---
// Unauthenticated (Didit calls it), so we trust only the session id it names and
// re-fetch the decision from Didit rather than believing the body.
router.post("/didit/webhook", async (req: Request, res: Response) => {
  try {
    const sessionId: string | undefined =
      req.body?.session_id || req.body?.sessionId || req.body?.data?.session_id;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const record = await prisma.kycVerification.findFirst({
      where: { metamapRef: sessionId, provider: "didit" },
      select: { userId: true },
    });
    if (!record) return res.status(404).json({ error: "Unknown session" });

    if (isDiditConfigured) {
      const decision = await getDiditDecision(sessionId);
      await applyDiditDecision(record.userId, sessionId, decision);
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("Didit webhook error:", err);
    // Always 200 so Didit doesn't hammer us with retries on our own bug.
    return res.json({ received: true });
  }
});

/**
 * Ask Didit about one submission again, and apply whatever comes back.
 *
 * For the console. A reviewer who corrects a name or types in what the OCR
 * could not read is editing Didit's copy, not ours, and our copy was taken
 * when the decision first landed. This re-reads it on demand, so the person
 * who just made the correction can see it land rather than waiting for the
 * account's next sign-in.
 */
/**
 * Ask Didit about everybody still waiting.
 *
 * Didit's decision webhook fires once. A reviewer who then approves a session
 * BY HAND in their console produces no second call - that is `data.updated`,
 * which only reaches a URL subscribed to it - so an account decided that way
 * sat at Waiting in our queue until the person opened the app or somebody
 * pressed the button. Both are things that might not happen for days.
 *
 * One ask per PERSON, not per row: somebody with an abandoned session on top
 * of a real one has two waiting rows that resolve to the same decision, and
 * asking twice doubles the provider calls to learn the same thing. The newest
 * row is the one to ask about; everything behind it is reached from there.
 *
 * Capped at 50 so this cannot turn into a thousand provider calls if the queue
 * is ever somehow enormous, and it costs nothing at all when it is empty.
 */
export async function sweepWaitingDidit(): Promise<{
  checked: number;
  rows: number;
  changed: { username: string | null; status: string }[];
  unchanged: number;
  failed: number;
}> {
  const rows = await prisma.kycVerification.findMany({
    where: { provider: "didit", status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, user: { select: { username: true } } },
    take: 50,
  });

  const waiting = rows.filter((r, i) => rows.findIndex((o) => o.userId === r.userId) === i);

  const changed: { username: string | null; status: string }[] = [];
  let unchanged = 0;
  let failed = 0;

  // Sequential on purpose. The queue is small and a burst of parallel calls at
  // the provider to save two seconds is not a trade worth making against a
  // rate limit.
  for (const row of waiting) {
    try {
      const result = await recheckDiditSubmission(row.id);
      if (!result.ok) {
        failed++;
        continue;
      }
      if (result.status === "VERIFIED" || result.status === "REJECTED") {
        changed.push({ username: row.user?.username ?? null, status: result.status });
      } else {
        unchanged++;
      }
    } catch {
      failed++;
    }
  }

  return { checked: waiting.length, rows: rows.length, changed, unchanged, failed };
}

export async function recheckDiditSubmission(verificationId: string): Promise<
  | { ok: true; status: string; harvested?: number }
  | { ok: false; error: string }
> {
  const row = await prisma.kycVerification.findUnique({
    where: { id: verificationId },
    select: { userId: true, metamapRef: true, provider: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (row.provider !== "didit") {
    return { ok: false, error: "This submission predates Didit, so there is nothing to re-read." };
  }
  if (!row.metamapRef) {
    return { ok: false, error: "No Didit session on this submission - it was revoked and detached." };
  }
  if (!isDiditConfigured) return { ok: false, error: "Didit is not configured on this server." };

  // Through findDecision rather than this row's session alone: the row an
  // administrator is looking at is the newest, and the newest is exactly the
  // one that may be an abandoned session with an approval underneath it.
  const found = await findDecision(row.userId, row.metamapRef);
  if (!found) return { ok: false, error: "Didit did not answer for any of this person's sessions." };

  const status = await applyDiditDecision(row.userId, found.ref, found.decision);

  /**
   * Read from the account rather than from `status`, because applyDiditDecision
   * refuses to downgrade somebody who was approved by hand - so what it returns
   * is what Didit says, not what this account now is.
   */
  const now = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { kycStatus: true },
  });

  /**
   * Harvest only when there is something for it to find.
   *
   * It costs one provider call per past session, and the hourly sweep asks
   * about every PENDING row - including the abandoned session somebody leaves
   * on top of an account that verified months ago. Without this that account
   * would re-read all eight of its sessions every hour for ever, to learn the
   * same thing each time.
   *
   * A usable NIN is the whole reason this exists, so holding one already is
   * the signal that there is nothing left to look for.
   */
  const held = await prisma.identityClaim.findMany({
    where: { userId: row.userId, kind: "national_number" },
    select: { key: true },
  });
  const hasUsableNin = held.some((c) => /^[1-9]\d{10}$/.test(c.key.replace(/^nin:/, "")));

  const harvested =
    now?.kycStatus === "VERIFIED" && !hasUsableNin
      ? await harvestIdentityClaims(row.userId)
      : 0;

  return { ok: true, status, harvested };
}

/**
 * Fetch a verified account's session once more, for the one that came back
 * blank.
 *
 * A decision is read when it lands and never again. Didit's OCR routinely
 * fails to parse a Nigerian document, and the fix is for an administrator to
 * approve the session and type the details into Didit's console afterwards -
 * which happens after we have already stored what we were given, and which
 * fires no webhook. The account is then verified and nameless, and nothing
 * would ever ask again.
 *
 * So: an account that is verified, holds a session, and has no name on file
 * asks once more. Called without awaiting, on sign-in, because nothing depends
 * on the answer arriving before the response does.
 */
export async function healMissingIdentity(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true, firstName: true, lastName: true },
    });
    if (user?.kycStatus !== "VERIFIED" || user.firstName || user.lastName) return;

    const row = await prisma.kycVerification.findFirst({
      where: { userId, provider: "didit", metamapRef: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { metamapRef: true },
    });
    if (!row?.metamapRef || !isDiditConfigured) return;

    const decision = await getDiditDecision(row.metamapRef);
    await applyDiditDecision(userId, row.metamapRef, decision);
    console.log(`[kyc] re-read a blank verified session for ${userId}`);
  } catch (e: any) {
    // Best effort. A sign-in must not fail because a provider was slow.
    console.warn("[kyc] identity heal failed:", e?.message);
  }
}

export default router;
