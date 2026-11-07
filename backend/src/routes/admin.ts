import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { validate } from "../middleware/validate";
import { sendAdminLoginCode, sendAccountClosedEmail } from "../lib/email";
import { sendNotification, sendPushOnly } from "../lib/push";
import { adminChatRouter } from "./chat";
import { recheckDiditSubmission, sweepWaitingDidit } from "./kyc";
import { isStableyardConfigured } from "../lib/stableyard";
import {
  routedAssetStates,
  setRoutedAssetState,
  setAllRoutedAssetStates,
  type RoutedState,
} from "../lib/stableyard-visibility";
import { enrolledAccounts, routedActivityReadOnly, routedAddressesReadOnly } from "../lib/stableyard-account";
import { isSwapConfigured, isAuroraConfigured, isOneClickConfigured, isMovementRouteConfigured } from "../lib/aurora";
import { routeWalletAddress } from "../lib/aurora-swap";
import { getOnChainBalance } from "../lib/balances";
import { auroraSettings, updateAuroraSettings, LIMITS as AURORA_LIMITS } from "../lib/aurora-settings";
import {
  normaliseCode,
  generateCode as generateVoucherCode,
  parseRequirements,
  voucherReserved,
} from "../lib/voucher";
import { cutPot, parseSlices, describe, toAmount, type Spread } from "../lib/voucher-split";
import { escrowReconciliation, sweepRefunds } from "../lib/user-voucher";
import { SOL_CAP_RANGE, setSolTransfersPerDay, solCapMeta, solTransfersPerDay, SOL_TRANSFERS_PER_DAY } from "../lib/transfer-limits";
import { MAX_ACCOUNTS_PER_DEVICE } from "../lib/signup-limits";
import { voucherEscrowAddress, isVoucherEscrowConfigured } from "../lib/voucher-escrow";
import {
  isVoucherTreasuryConfigured,
  voucherTreasuryAddress,
  voucherTreasuryBalance,
} from "../lib/voucher-treasury";
import { fetchRates, invalidateRatesCache } from "./rates";
import { dollarNgn, postedNgn } from "../lib/ngn-rate";
import { RATE_KEYS, ensureRateSettings, rateSettings, rateSources, railwayRateSettings, setRateSetting } from "../lib/rate-settings";
import { checkActionPassword } from "../lib/action-password";
import { getTonUsdtBalance } from "../lib/ton";
import { tonRowState } from "../lib/ton-recovery";
import { KycError, PARTS as MANUAL_PARTS, asked as manualAsked, currentFiles as manualCurrentFiles, decide as decideManual, identitySettings, identitySettingsMeta, partsFor as manualPartsFor, setIdentitySettings, waitingWhere as manualWaitingWhere } from "../lib/manual-kyc";
import { kycVaultReady, openKycFile } from "../lib/kyc-vault";
import { listServices, setService, isServiceKey } from "../lib/service-status";
import { PAYOUT_PROVIDERS, PAYOUT_LABELS, configured as payoutConfigured, bankCodeByName, resolveAccount } from "../lib/payout";
import { psBalance } from "../lib/paystack";
import { flwBillsReachable } from "../lib/flw-bills";
import { BILLS_LABELS, billsConfigured } from "../lib/bills-provider";
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { appVersionStats } from "../middleware/app-version";
import { ourWallets } from "../lib/admin-wallets";

const router = Router();
const JWT_SECRET = env.JWT_ACCESS_SECRET;

// ─── In-memory OTP store (short-lived, OK in memory) ─────────
const adminCodes = new Map<string, { code: string; expiresAt: number }>();

function generateCode(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// ─── Admin auth middleware ────────────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No admin token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { email: string; role: string };
    if (payload.role !== "admin") return res.status(401).json({ error: "Not an admin token" });
    (req as any).adminEmail = payload.email;
    next();
  } catch {
    return res.status(401).json({ error: "Admin session expired. Please login again." });
  }
}

// ─── POST /admin/login — Request login code ──────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Constant-time password compare (avoids leaking length/timing).
function passwordMatches(input: string): boolean {
  const expected = env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

router.post(
  "/login",
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      // Gate: valid admin email AND the shared password — BEFORE any email is
      // sent. This is what stops bots from burning our email quota.
      if (!env.ADMIN_PASSWORD) {
        return res.status(503).json({ error: "Admin login is not configured. Set ADMIN_PASSWORD." });
      }
      if (!env.ADMIN_EMAIL.includes(email.toLowerCase()) || !passwordMatches(password)) {
        // Same generic error for wrong email or wrong password — no enumeration.
        return res.status(403).json({ error: "Invalid admin credentials" });
      }

      const code = generateCode();
      adminCodes.set(email.toLowerCase(), {
        code,
        expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      });

      // Always log the OTP to stdout — it's scoped to the admin email and
      // expires in 10 min, and gives a fallback channel (Railway logs) when
      // email delivery is broken.
      console.log(`[ADMIN OTP] ${email} code=${code} expires=${new Date(Date.now() + 10 * 60 * 1000).toISOString()}`);

      try {
        await sendAdminLoginCode(email, code);
      } catch (emailErr: any) {
        console.error("[ADMIN LOGIN] email send failed:", emailErr?.message || emailErr);
        return res.status(503).json({
          error: "Could not deliver the code by email. Check server logs for the OTP or try again.",
        });
      }

      return res.json({ message: "Verification code sent to your email" });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/verify — Verify code and get session ────────
const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

router.post(
  "/verify",
  validate(verifySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, code } = req.body;
      const key = email.toLowerCase();

      const stored = adminCodes.get(key);
      if (!stored || stored.expiresAt < Date.now()) {
        adminCodes.delete(key);
        return res.status(400).json({ error: "Code expired. Please request a new one." });
      }

      if (stored.code !== code) {
        return res.status(400).json({ error: "Invalid code" });
      }

      adminCodes.delete(key);

      const token = jwt.sign(
        { email: key, role: "admin" },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.json({ token, expiresIn: 604800 });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/crypto/wallets — our own wallets, read from the chains ──
//
// Each treasury, gas payer, voucher wallet and sell address: what it is for,
// its address and what it holds, live. Addresses only, never keys. ?fresh=1
// skips the 30-second cache.
router.get("/crypto/wallets", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await ourWallets(req.query.fresh === "1"));
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/app-versions — who is calling, and on what ───
//
// ─── GET /admin/payout/preflight — can each rail actually pay, from HERE ──
//
// The question a laptop cannot answer. A key works locally and fails in
// production for reasons that never show up in a diff: an IP allowlist on the
// provider, an environment variable set with a stray character, egress
// blocked. When somebody reports "account not found" the first thing worth
// knowing is whether the server can reach the provider at all, and until now
// the only way to find out was to add logging and redeploy.
//
// Optionally resolves one account, which is the end-to-end version of the
// same question.
router.get("/payout/preflight", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bankName = String(req.query.bankName || "");
    const accountNumber = String(req.query.accountNumber || "");

    const rails = await Promise.all(
      PAYOUT_PROVIDERS.map(async (p) => {
        const out: Record<string, unknown> = {
          id: p,
          label: PAYOUT_LABELS[p],
          configured: payoutConfigured(p),
        };
        if (!out.configured) return out;

        // Can it see the banks? This is the call that silently returns nothing
        // when a key is blocked, and an empty bank list is what turns into
        // "could not determine bank code" three layers up.
        try {
          const code = await bankCodeByName(p, bankName || "Access Bank");
          out.banks = !!code;
          out.sampleCode = code;
        } catch (e: any) {
          out.banks = false;
          out.banksError = e?.message || "failed";
        }

        if (p === "paystack") {
          const b = await psBalance();
          out.balance = b.ngn;
          if (!b.ok) out.balanceError = b.error;
        }

        if (bankName && accountNumber && out.sampleCode) {
          const r = await resolveAccount(p, String(out.sampleCode), accountNumber);
          out.resolved = r.ok;
          out.accountName = r.accountName;
          if (!r.ok) out.resolveError = r.error;
        }

        return out;
      }),
    );

    res.json({ rails, egressIp: await egressIp() });
  } catch (err) {
    next(err);
  }
});

/**
 * The address providers see us calling from.
 *
 * Two integrations now gate on an IP allowlist - Paystack can restrict a
 * secret key to one, and Flutterwave requires it outright for the bills API -
 * and neither failure says so. They come back as a generic refusal that reads
 * like a bad request, and the only way to tell was to guess.
 *
 * Asked of an outside service because a server behind a proxy cannot know its
 * own public address. Cached for an hour: it does not change often, and when
 * it does change without warning that is precisely the incident this exists to
 * explain.
 */
let cachedEgress: { ip: string; at: number } | null = null;

async function egressIp(): Promise<string | null> {
  if (cachedEgress && Date.now() - cachedEgress.at < 60 * 60 * 1000) return cachedEgress.ip;
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    const body: any = await res.json();
    if (body?.ip) {
      cachedEgress = { ip: String(body.ip), at: Date.now() };
      return cachedEgress.ip;
    }
  } catch {
    // Not knowing our own address is never a reason to fail the page.
  }
  return null;
}

// ─── GET /admin/bills/preflight — can this server actually buy a bill ──
//
// The bills API is behind an IP allowlist and the catalogue is not, so a
// server that can list every data plan may still be unable to buy one - and
// the refusal says "contact your account administrator", which names neither
// bills nor IPs. Separating the two reads is the whole point of this.
router.get("/bills/preflight", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const flw = billsConfigured("flutterwave") ? await flwBillsReachable() : null;

    res.json({
      egressIp: await egressIp(),
      providers: [
        {
          id: "flutterwave",
          label: BILLS_LABELS.flutterwave,
          configured: billsConfigured("flutterwave"),
          catalogue: flw?.catalogue ?? false,
          account: flw?.account ?? false,
          error: flw?.error,
        },
        {
          id: "vtu",
          label: BILLS_LABELS.vtu,
          configured: billsConfigured("vtu"),
          catalogue: true,
          account: true,
        },
      ],
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/rates — the naira markups, where each comes from, and the result ──
async function ratesPayload() {
  await ensureRateSettings();
  const feed = await dollarNgn().catch(() => 0);
  return {
    settings: rateSettings(),
    sources: rateSources(),
    railway: railwayRateSettings(),
    // One dollar of USDC on each side, at the feed's price right now, after
    // markup and ceiling - what a person would be quoted.
    live: {
      feed,
      fund: feed > 0 ? postedNgn("USDC", 1, "fund", feed) : 0,
      sell: feed > 0 ? postedNgn("USDC", 1, "sell", feed) : 0,
    },
  };
}

router.get("/rates", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await ratesPayload());
  } catch (err) {
    next(err);
  }
});

// ─── PUT /admin/rates — set any of them, or null to go back to Railway's ──
//
// Naira, not percent: a markup is "what a dollar should cost here", added to
// the feed. A ceiling of 0 turns that side's ceiling off, as in the env.
//
// Every change, going back to Railway's included, needs the rate password as
// well as the admin session (lib/action-password.ts).
const nullableNaira = (min: number, max: number) => z.union([z.number().min(min).max(max), z.null()]).optional();
const ratesSchema = z.object({
  fundMarkup: nullableNaira(-500, 1000),
  sellMarkup: nullableNaira(-500, 1000),
  fundMax: nullableNaira(0, 20000),
  sellMax: nullableNaira(0, 20000),
  password: z.string().max(200).optional(),
});

/**
 * How many Solana sends (withdrawals and username transfers together) one
 * account may make a day. Raising it lets more through, and every Solana send
 * can cost us rent, so a change takes the action password.
 */
router.get("/limits", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ solTransfersPerDay: await solTransfersPerDay(), defaultSolTransfersPerDay: SOL_TRANSFERS_PER_DAY, range: SOL_CAP_RANGE, ...(await solCapMeta()) });
  } catch (err) {
    next(err);
  }
});

router.put("/limits", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const by = String((req as any).adminEmail || "admin");
    const n = Number(req.body?.solTransfersPerDay);
    if (!Number.isInteger(n) || n < SOL_CAP_RANGE.min || n > SOL_CAP_RANGE.max) {
      return res.status(400).json({ error: `Pick a whole number from ${SOL_CAP_RANGE.min} to ${SOL_CAP_RANGE.max}.` });
    }
    const gate = await checkActionPassword(by, req.body.password, "limits");
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const before = await solTransfersPerDay();
    await setSolTransfersPerDay(n, by);
    console.log(`[ADMIN] Solana sends a day changed by ${by}: ${before} to ${n}`);
    res.json({ solTransfersPerDay: n, defaultSolTransfersPerDay: SOL_TRANSFERS_PER_DAY, range: SOL_CAP_RANGE, ...(await solCapMeta()) });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/rates",
  requireAdmin,
  validate(ratesSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const by = String((req as any).adminEmail || "admin");
      const gate = await checkActionPassword(by, req.body.password, "rates");
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      const changed: string[] = [];
      for (const key of RATE_KEYS) {
        if (!(key in req.body)) continue;
        const value = req.body[key] as number | null;
        await setRateSetting(key, value, by);
        changed.push(`${key}=${value ?? "railway"}`);
      }
      // The app's /rates holds computed prices for ten minutes; without this a
      // change would not reach anybody until the cache aged out.
      invalidateRatesCache();
      console.log(`[ADMIN] rates changed by ${by}: ${changed.join(", ") || "nothing"}`);
      res.json(await ratesPayload());
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/services — what is on, and who turned it off ──
router.get("/services", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ services: await listServices() });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /admin/services/:key — pause one, or edit what it says ──
//
// Everything is optional so the same route serves the toggle and the three
// text fields. An empty string clears a field rather than storing "", because
// a message nobody wrote should fall back to the default rather than show a
// blank sheet.
const serviceSchema = z.object({
  paused: z.boolean().optional(),
  note: z.string().max(80).optional(),
  message: z.string().max(400).optional(),
  // ISO, or empty to clear it.
  backBy: z.string().optional(),
  // For a choice rather than a toggle, e.g. which payout rail is live.
  value: z.string().max(40).optional(),
});

router.put(
  "/services/:key",
  requireAdmin,
  validate(serviceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = req.params.key;
      if (!isServiceKey(key)) {
        return res.status(404).json({ error: "No such service." });
      }

      const { paused, note, message, backBy, value } = req.body as {
        paused?: boolean;
        note?: string;
        message?: string;
        backBy?: string;
        value?: string;
      };

      // A choice may only be set to something it offers. Without this, a typo
      // in a request body silently picks a rail that does not exist, and
      // activePayoutProvider quietly falls back while the console shows the
      // typo as if it took.
      if (value !== undefined) {
        const svc = (await listServices()).find((s) => s.key === key);
        if (!svc?.options?.some((o) => o.id === value)) {
          return res.status(400).json({ error: "That is not one of the options." });
        }
      }

      let when: Date | null | undefined = undefined;
      if (backBy !== undefined) {
        if (!backBy.trim()) {
          when = null;
        } else {
          const parsed = new Date(backBy);
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ error: "That is not a time we can read." });
          }
          when = parsed;
        }
      }

      const services = await setService(
        key,
        {
          ...(paused !== undefined ? { paused } : {}),
          ...(note !== undefined ? { note: note.trim() || null } : {}),
          ...(message !== undefined ? { message: message.trim() || null } : {}),
          ...(when !== undefined ? { backBy: when } : {}),
          ...(value !== undefined ? { value } : {}),
        },
        (req as any).adminEmail || "admin",
      );

      return res.json({ services });
    } catch (err) {
      next(err);
    }
  }
);

// The tally the version gate keeps. It resets when the server restarts, so
// read it as a shape rather than a total: what matters is whether the share
// arriving with no version is still falling.
router.get("/app-versions", requireAdmin, async (_req: Request, res: Response) => {
  const rows = appVersionStats();
  const total = rows.reduce((n, r) => n + r.requests, 0);
  res.json({
    since: "server boot",
    total,
    minAppVersion: process.env.MIN_APP_VERSION || null,
    enforcing: !!process.env.MIN_APP_VERSION,
    versions: rows.map((r) => ({
      ...r,
      share: total ? Math.round((r.requests / total) * 1000) / 10 : 0,
    })),
  });
});

// ─── GET /admin/kyc — List KYC submissions ───────────────────
router.get(
  "/kyc",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as string) || "PENDING";
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const search = (req.query.search as string || "").trim();
      // "didit" is what the current flow writes; anything else is a submission
      // from the system that came before it, kept for the record.
      const provider = (req.query.provider as string) || "";

      // status AND (username | email | name | NIN matches the search term)
      const where: any = {};
      if (status && status !== "ALL") where.status = status as any;
      if (provider === "didit") where.provider = "didit";
      else if (provider === "legacy") where.provider = { not: "didit" };

      /**
       * An attempt the account has moved on from is not a person in a queue.
       *
       * Every session at the provider writes its own row, and the rows are
       * kept - they are the record of what happened. But someone refused and
       * then passed has one of each, and the tabs listed the rows, so they
       * stood in Rejected and Verified at the same time and were counted in
       * both. The account's own status is what tracks the live attempt:
       * starting a session rewrites it, and so does every decision.
       *
       * So a decided tab asks the account to agree with it, and the queue asks
       * only that the account is still undecided - which also drops the
       * abandoned attempts of people who have since been through it.
       *
       * The provider is asked, not this: the tabs sort people, they do not
       * decide anything, and nothing here writes to a row.
       */
      if (provider === "didit") {
        if (status === "VERIFIED" || status === "REJECTED") {
          where.user = { kycStatus: status as any };
        } else if (status === "PENDING") {
          where.user = { kycStatus: { notIn: ["VERIFIED", "REJECTED"] as any } };
        }
      }
      if (search) {
        where.OR = [
          { documentNumber: { contains: search, mode: "insensitive" } },
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { user: { username: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
        ];
      }

      const [submissions, total] = await Promise.all([
        prisma.kycVerification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          // Explicit select — never ship the base64 image blobs in the list
          // (they're fetched on demand via /admin/kyc/:id/documents).
          select: {
            id: true,
            documentType: true,
            documentNumber: true,
            status: true,
            firstName: true,
            lastName: true,
            failureReason: true,
            createdAt: true,
            user: {
              select: { id: true, email: true, username: true, firstName: true, lastName: true },
            },
          },
        }),
        prisma.kycVerification.count({ where }),
      ]);

      return res.json({
        submissions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/kyc/:id/documents — NIN + front/back images ──
router.get(
  "/kyc/:id/documents",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const doc = await prisma.kycVerification.findUnique({
        where: { id },
        select: {
          userId: true,
          documentType: true,
          documentNumber: true,
          metamapRef: true,
          firstName: true,
          lastName: true,
          frontImage: true,
          backImage: true,
        },
      });
      if (!doc) return res.status(404).json({ error: "KYC submission not found" });

      /**
       * A number nobody can read is worse than no number.
       *
       * Starting a session writes the session id into documentNumber as a
       * placeholder, to be replaced when the decision lands and the document
       * is actually read. Until then the field holds a uuid, and the sheet
       * printed it under the heading "Number" - where it looks exactly like a
       * document number that disagrees with the provider's.
       */
      const placeholder = (n: string | null, ref: string | null) => !!n && n === ref;
      /**
       * And a uuid is never a document number, whether or not it matches the
       * session we happen to be looking at.
       *
       * Comparing against metamapRef only catches the placeholder written by
       * the session it belongs to. A second attempt inherits the first one's
       * uuid and sails past that check, which is how a submission came to
       * print e5e2df6f-cd23-49c5-bda2-87ebe3c6a5d5 under "Number" as though a
       * bank could do something with it.
       */
      const isUuid = (n: string | null) =>
        !!n && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n);
      let documentNumber =
        placeholder(doc.documentNumber, doc.metamapRef) || isUuid(doc.documentNumber)
          ? null
          : doc.documentNumber;
      let firstName = doc.firstName;
      let lastName = doc.lastName;
      let borrowedFrom: string | null = null;

      /**
       * And where this attempt has nothing, the person's earlier one usually
       * does.
       *
       * Somebody who submits an ID and then starts again - which the records
       * show happening within minutes - ends up with the read document on the
       * first session and an empty second one on top of it. The queue lists
       * the newest, so the sheet showed the empty one while the provider's
       * dashboard showed the full one, and the two looked like they disagreed
       * about the same person.
       */
      if (!documentNumber || !firstName) {
        const siblings = await prisma.kycVerification.findMany({
          where: { userId: doc.userId, id: { not: id } },
          orderBy: { createdAt: "desc" },
          select: {
            documentNumber: true,
            metamapRef: true,
            firstName: true,
            lastName: true,
            createdAt: true,
          },
          take: 10,
        });
        const better = siblings.find(
          (s) => (s.firstName && !firstName) || (!placeholder(s.documentNumber, s.metamapRef) && s.documentNumber && !documentNumber),
        );
        if (better) {
          documentNumber = documentNumber ?? (placeholder(better.documentNumber, better.metamapRef) ? null : better.documentNumber);
          firstName = firstName ?? better.firstName;
          lastName = lastName ?? better.lastName;
          borrowedFrom = better.createdAt.toISOString();
        }
      }

      /**
       * What the account holds, beside what the provider read.
       *
       * These are different questions and the sheet was only answering one of
       * them. Didit's OCR on a Nigerian ID card routinely returns the card's
       * field labels run together with its values - "Surnaml Nationalioontity-
       * njmoer Okoh Firstname..." - and a reviewer looking at that has no way
       * to tell what was actually approved, or whether the person can transact
       * at all. The NIN in particular is the thing funding needs and the thing
       * nobody could see.
       *
       * Both are shown rather than one chosen: guessing which garbled string
       * is a name is not something to do quietly, and the provider's raw read
       * is the audit trail.
       */
      const account = await prisma.user.findUnique({
        where: { id: doc.userId },
        select: { firstName: true, lastName: true },
      });
      /**
       * The one funding would actually use, not merely the newest.
       *
       * The gate accepts an eleven-digit number with no leading zero, because
       * that is what the bank's validator reads. A claim that fails it is
       * still a claim - it just cannot open a payment account - and showing it
       * here as "NIN on file" told a reviewer the person was fine when they
       * were about to be refused. Where one exists but is unusable, say so
       * rather than showing either a number that will not work or nothing at
       * all.
       */
      const ninClaims = await prisma.identityClaim.findMany({
        where: { userId: doc.userId, kind: "national_number" },
        orderBy: { createdAt: "desc" },
        select: { key: true },
      });
      const ninValues = ninClaims.map((c) => c.key.replace(/^nin:/, ""));
      const usableNin = ninValues.find((v) => /^[1-9]\d{10}$/.test(v)) ?? null;

      return res.json({
        documentType: doc.documentType,
        documentNumber,
        firstName,
        lastName,
        onFile: {
          firstName: account?.firstName ?? null,
          lastName: account?.lastName ?? null,
          nin: usableNin,
          // Set when something is on file that the bank will not take: the
          // difference between "never verified with a NIN" and "verified with
          // one we cannot use" is the whole of what support needs to say.
          ninUnusable: usableNin ? null : ninValues[0] ?? null,
        },
        // When set, these details came off an earlier attempt by the same
        // person rather than the one being looked at.
        borrowedFrom,
        frontImage: doc.frontImage,
        backImage: doc.backImage,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/kyc/:id/approve — Approve KYC ──────────────
router.post(
  "/kyc/:id/approve",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      const verification = await prisma.kycVerification.findUnique({ where: { id } });
      if (!verification) return res.status(404).json({ error: "KYC submission not found" });
      if (verification.status === "VERIFIED") {
        return res.status(400).json({ error: "Already verified" });
      }

      await prisma.kycVerification.update({
        where: { id },
        data: { status: "VERIFIED" },
      });

      await prisma.user.update({
        where: { id: verification.userId },
        data: {
          kycStatus: "VERIFIED",
          firstName: verification.firstName || undefined,
          lastName: verification.lastName || undefined,
        },
      });

      return res.json({ message: "KYC approved", verificationId: id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/kyc/:id/reject — Reject KYC ────────────────
const rejectSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
});

router.post(
  "/kyc/:id/reject",
  requireAdmin,
  validate(rejectSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { reason } = req.body;

      const verification = await prisma.kycVerification.findUnique({ where: { id } });
      if (!verification) return res.status(404).json({ error: "KYC submission not found" });

      /**
       * Revoking a verification the provider still calls approved.
       *
       * The app polls /kyc/didit/status, which re-reads the decision and
       * re-applies it - so a straight status write would be undone the next
       * time the account opened the verification screen. Detaching the session
       * id stops that poll from finding anything to re-apply, and the id is
       * kept in rawResponse so the decision can still be traced.
       */
      const previousRef = verification.metamapRef;
      const raw = (verification.rawResponse as Record<string, unknown> | null) ?? {};

      await prisma.kycVerification.update({
        where: { id },
        data: {
          status: "REJECTED",
          failureReason: reason,
          metamapRef: null,
          rawResponse: {
            ...raw,
            adminRevoked: {
              at: new Date().toISOString(),
              by: (req as any).adminEmail ?? null,
              reason,
              previousSessionId: previousRef,
            },
          },
        },
      });

      await prisma.user.update({
        where: { id: verification.userId },
        data: { kycStatus: "REJECTED" },
      });

      return res.json({ message: "KYC rejected", verificationId: id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/users — List users (overview) ────────────────
router.get(
  "/users",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const search = (req.query.search as string) || "";
      // "active" | "deleted" | "deletion_requested" | "" (all)
      const status = (req.query.status as string) || "";

      const where: any = {};

      // Status filter
      if (status === "deleted") {
        where.deletedAt = { not: null };
      } else if (status === "active") {
        where.deletedAt = null;
      } else if (status === "deletion_requested") {
        // Asked to be closed, not yet closed - the queue to work through.
        where.deletionRequestedAt = { not: null };
        where.deletedAt = null;
      }

      // Search filter
      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" as const } },
          { username: { contains: search, mode: "insensitive" as const } },
          { firstName: { contains: search, mode: "insensitive" as const } },
          { lastName: { contains: search, mode: "insensitive" as const } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true, email: true, phone: true, username: true, firstName: true, lastName: true,
            kycStatus: true, emailVerified: true, createdAt: true, deletedAt: true,
            deletionRequestedAt: true, deletionReason: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      return res.json({
        users,
        total,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/stats — Dashboard stats ──────────────────────
router.get(
  "/stats",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const [totalUsers, verifiedUsers, activeUsers, pendingKyc, totalTransactions, processingTxns] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { kycStatus: "VERIFIED" } }),
        /**
         * People who have actually done something, not people who signed up.
         *
         * Same definition the analytics endpoint already uses - at least one
         * COMPLETED transaction - so the two figures agree rather than the
         * overview and the analytics page each having their own idea of
         * "active". Grouped by user, so somebody with forty transactions is
         * one person.
         */
        prisma.transaction
          .groupBy({ by: ["userId"], where: { status: "COMPLETED" } })
          .then((rows) => rows.length),
        /**
         * People still waiting, not rows still open.
         *
         * didit only: the previous system left ten submissions sitting at
         * PENDING that nobody will ever decide, and counting them put
         * permanent work on the overview that could not be cleared.
         *
         * And the row is not the question. Somebody who passes and taps Verify
         * again leaves a submission at PENDING behind an account that is
         * already VERIFIED - three of the six this used to count were exactly
         * that. The overview said six while the queue held three, which is the
         * worst kind of wrong: work that cannot be cleared because it is
         * already done.
         *
         * Grouped by user so two open submissions from one person are one
         * person waiting.
         */
        prisma.kycVerification
          .groupBy({
            by: ["userId"],
            where: {
              status: "PENDING",
              provider: "didit",
              user: { kycStatus: { notIn: ["VERIFIED", "REJECTED"] } },
            },
          })
          .then((rows) => rows.length),
        prisma.transaction.count(),
        prisma.transaction.count({ where: { status: "PROCESSING" } }),
      ]);

      return res.json({ totalUsers, verifiedUsers, activeUsers, pendingKyc, totalTransactions, processingTxns });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/stats/detailed — Detailed volume & activity stats ────
router.get(
  "/stats/detailed",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      /**
       * What each asset is worth, and nothing invented where it is not known.
       *
       * The dollars are the dollars - USDC and USDT and the two USDC variants
       * that trade under other names. Everything else has to come from the
       * feed, and anything the feed has no price for contributes nothing.
       *
       * It used to fall back to a dollar apiece, which is how 3,162 cNGN -
       * worth about two dollars and change - was posted as $3,162 of volume,
       * ahead of every chain the business actually runs on. A number missing
       * from a total is a number someone goes looking for; a number that is
       * wrong by thirteen hundred times is one they believe.
       */
      let usdPrices: Record<string, number> = { USDC: 1, USDT: 1, USDCx: 1, USDCe: 1 };
      let usdNgnRate = 1500; // fallback
      const rates = await fetchRates();
      if (rates) {
        const r = rates as unknown as Record<string, { usd?: number; ngn?: number }>;
        for (const sym of ["MOVE", "SOL", "ETH", "cNGN", "USDC", "USDT"]) {
          const usd = Number(r[sym]?.usd);
          if (usd > 0) usdPrices[sym] = usd;
        }
        // The two variants are the same dollar under another name.
        usdPrices.USDCx = usdPrices.USDC;
        usdPrices.USDCe = usdPrices.USDC;
        // USDC ≈ $1, so its NGN price is effectively the USD→NGN rate
        if (rates.USDC.ngn) usdNgnRate = rates.USDC.ngn;
      }
      console.log("[STATS] USD prices used:", usdPrices, "USD→NGN:", usdNgnRate);

      // All completed transactions
      const txns = await prisma.transaction.findMany({
        where: { status: "COMPLETED" },
        select: { type: true, amount: true, asset: true, chain: true, fee: true, metadata: true, createdAt: true },
      });

      let totalVolumeUsd = 0;
      let buyVolumeUsd = 0;
      let sellVolumeUsd = 0;
      let billsVolumeNgn = 0;
      let billsVolumeUsd = 0;
      let depositVolumeUsd = 0;
      let withdrawVolumeUsd = 0;
      let transferVolumeUsd = 0;
      let usernameTransferVolumeUsd = 0;
      let externalTransferVolumeUsd = 0;
      let totalFeesUsd = 0;
      let txCountByType: Record<string, number> = {};
      const unpriced = new Set<string>();
      let volumeByAsset: Record<string, number> = {};
      let volumeByChain: Record<string, number> = {};
      let countByAsset: Record<string, number> = {};
      let countByChain: Record<string, number> = {};
      let dailyVolumeUsd: Record<string, number> = {};

      for (const tx of txns) {
        const amt = Number(tx.amount) || 0;
        const fee = Number(tx.fee) || 0;
        const meta = tx.metadata as any;
        // No price, no volume. See the note on usdPrices above.
        const price = usdPrices[tx.asset] ?? 0;
        if (!price) unpriced.add(tx.asset);
        const amtUsd = amt * price;
        const feeUsd = fee * price;

        // Count by type
        txCountByType[tx.type] = (txCountByType[tx.type] || 0) + 1;

        // Volume by asset (in USD)
        volumeByAsset[tx.asset] = (volumeByAsset[tx.asset] || 0) + amtUsd;
        countByAsset[tx.asset] = (countByAsset[tx.asset] || 0) + 1;

        /**
         * And by chain, which answers a different question.
         *
         * The asset says what people hold; the chain says where the money
         * actually moves, and that is what decides which RPCs matter, where
         * the gas goes and which network an outage would cost us. A bank
         * payout has no chain of its own - it is the crypto leg that has one -
         * so a row without one is counted as such rather than dropped, or the
         * two tables would not add up to the same total and someone would
         * spend an afternoon working out why.
         */
        const chain = tx.chain || "OFF-CHAIN";
        volumeByChain[chain] = (volumeByChain[chain] || 0) + amtUsd;
        countByChain[chain] = (countByChain[chain] || 0) + 1;

        // Daily volume in USD (last 30 days)
        const day = tx.createdAt.toISOString().slice(0, 10);
        dailyVolumeUsd[day] = (dailyVolumeUsd[day] || 0) + amtUsd;

        // Bills (AIRTIME, TV, ELECTRICITY) use nairaAmount from metadata
        const billTypes = ["AIRTIME", "TV", "ELECTRICITY"];
        if (billTypes.includes(tx.type)) {
          const naira = meta?.nairaAmount || meta?.totalNaira || 0;
          billsVolumeNgn += Number(naira);
          billsVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "BUY") {
          buyVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "SELL") {
          sellVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "DEPOSIT") {
          depositVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "WITHDRAW") {
          withdrawVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "TRANSFER_IN" || tx.type === "TRANSFER_OUT") {
          usernameTransferVolumeUsd += amtUsd;
          transferVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else if (tx.type === "TRANSFER") {
          externalTransferVolumeUsd += amtUsd;
          transferVolumeUsd += amtUsd;
          totalVolumeUsd += amtUsd;
        } else {
          totalVolumeUsd += amtUsd;
        }

        totalFeesUsd += feeUsd;
      }

      // Estimated gas (rough: ~$0.001 per on-chain tx for Move/Base, ~$0.002 for SOL)
      const onChainTypes = ["BUY", "SELL", "DEPOSIT", "WITHDRAW", "TRANSFER", "TRANSFER_OUT", "AIRTIME", "TV", "ELECTRICITY"];
      const onChainCount = txns.filter(t => onChainTypes.includes(t.type)).length;
      const estGasUsd = onChainCount * 0.0015;

      // Active users (users with at least 1 completed tx)
      const activeUsers = await prisma.transaction.groupBy({
        by: ["userId"],
        where: { status: "COMPLETED" },
        _count: true,
      });

      // Sort daily volume to last 30 days
      const sortedDays = Object.entries(dailyVolumeUsd)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30);

      return res.json({
        totalVolumeUsd,
        buyVolumeUsd,
        sellVolumeUsd,
        billsVolumeNgn,
        billsVolumeUsd,
        depositVolumeUsd,
        withdrawVolumeUsd,
        transferVolumeUsd,
        usernameTransferVolumeUsd,
        externalTransferVolumeUsd,
        totalFeesUsd,
        estGasUsd,
        totalCompletedTxns: txns.length,
        activeUsers: activeUsers.length,
        txCountByType,
        // Named so a gap in the totals is findable rather than mysterious.
        unpricedAssets: [...unpriced],
        volumeByAsset,
        volumeByChain,
        countByAsset,
        countByChain,
        dailyVolume: sortedDays,
        usdPrices,
        usdNgnRate,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/transactions — List transactions ─────────────
router.get(
  "/transactions",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as string) || "";
      const kind = (req.query.kind as string) || "";
      const search = (req.query.search as string) || "";
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

      /**
       * What kind of thing this was, which is not the same as its type.
       *
       * A person looking at this list is asking about one flow at a time -
       * bank payouts, or bills, or on-chain sends - and those do not map one
       * to one onto the type column. Bills are AIRTIME and TV; a transfer
       * between two accounts is TRANSFER_OUT, and so is nothing else, while an
       * on-chain send is WITHDRAW. The grouping lives here so every caller
       * gets the same answer to the same question.
       */
      const KINDS: Record<string, string[]> = {
        bank: ["SELL"],
        bills: ["AIRTIME", "TV"],
        username: ["TRANSFER", "TRANSFER_OUT"],
        crypto: ["WITHDRAW"],
        deposit: ["DEPOSIT", "BUY"],
      };

      const where: any = {};
      if (status) where.status = status;
      if (KINDS[kind]) where.type = { in: KINDS[kind] };
      // Money moved out of an older wallet into the one the account uses now.
      if (kind === "migrated") where.metadata = { path: ["tonRecovery"], equals: true };

      /**
       * One row per transfer, not one per side of it.
       *
       * A transfer between two accounts writes two rows - the sender's
       * TRANSFER_OUT and the recipient's TRANSFER_IN - because each person's
       * own history has to show it. This list is not anybody's history: it is
       * every transaction there is, so both halves landed in it and every
       * transfer appeared twice, a row apart, differing only in whose name sat
       * beside it.
       *
       * The sender's half is the one kept. It carries both parties, it is the
       * one that exists when a transfer fails before the recipient is credited
       * at all, and its reference is the base the other is derived from.
       *
       * Checked against the database rather than assumed: all 157 TRANSFER_IN
       * rows are username transfers, so nothing else is caught by this.
       */
      where.NOT = {
        type: "TRANSFER_IN",
        metadata: { path: ["transferType"], equals: "username" },
      };

      if (search) {
        where.OR = [
          { reference: { contains: search, mode: "insensitive" } },
          { user: { email: { contains: search, mode: "insensitive" } } },
          { user: { username: { contains: search, mode: "insensitive" } } },
          // The recipient is no longer a row of their own, so their name has
          // to be searchable on the sender's - otherwise hiding the mirror
          // would have quietly cost support the ability to look up "transfers
          // to @wanfeel" at all.
          { metadata: { path: ["recipientUsername"], string_contains: search } },
        ];
      }

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { id: true, email: true, username: true } },
          },
        }),
        prisma.transaction.count({ where }),
      ]);

      return res.json({
        transactions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /admin/transactions/:id/status — Update tx status ─
const txStatusSchema = z.object({
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]),
  txHash: z.string().optional(),
  note: z.string().max(500).optional(),
});

router.patch(
  "/transactions/:id/status",
  requireAdmin,
  validate(txStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const { status, txHash, note } = req.body;

      const transaction = await prisma.transaction.findUnique({ where: { id } });
      if (!transaction) return res.status(404).json({ error: "Transaction not found" });

      /**
       * A completed transaction can still be refunded.
       *
       * This refused every change once something had completed, which is the
       * wrong invariant: the thing that must not happen twice is the wallet
       * credit below, not the record being corrected. A sale that went through
       * and was later refunded had nowhere to say so - the one case the
       * REFUNDED status exists for.
       *
       * So only re-completing is refused. Marking a completed transaction
       * refused, cancelled or refunded is a note on the record and touches no
       * balance, the same as it does from any other status.
       */
      if (transaction.status === "COMPLETED" && status === "COMPLETED") {
        return res.status(400).json({ error: "Transaction already completed" });
      }

      const meta: any = transaction.metadata || {};
      if (txHash) meta.txHash = txHash;
      if (note) meta.adminNote = note;
      meta.adminUpdatedAt = new Date().toISOString();
      meta.adminUpdatedBy = (req as any).adminEmail;
      meta.previousStatus = transaction.status;

      await prisma.transaction.update({
        where: { id },
        data: { status: status as any, metadata: meta },
      });

      // If marking as COMPLETED, update wallet balance
      if (status === "COMPLETED") {
        await prisma.wallet.updateMany({
          where: {
            userId: transaction.userId,
            asset: transaction.asset as any,
            chain: (transaction.chain || undefined) as any,
          },
          data: {
            balance: { increment: Number(transaction.amount) },
          },
        });

        // Send success notification
        const cryptoDisplay = Number(transaction.amount).toFixed(
          transaction.asset === "ETH" ? 5 : 4
        );
        await sendNotification({
          userId: transaction.userId,
          type: "transaction",
          title: "Purchase Completed",
          body: `Your ${cryptoDisplay} ${transaction.asset} purchase has been delivered.`,
        }).catch(() => {});
      }

      return res.json({ message: `Transaction updated to ${status}`, transactionId: id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/savings-locks — List all savings locks ───────
router.get(
  "/savings-locks",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = (req.query.status as string) || "";
      const search = (req.query.search as string) || "";
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

      const where: any = {};
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { user: { email: { contains: search, mode: "insensitive" } } },
          { user: { username: { contains: search, mode: "insensitive" } } },
          { name: { contains: search, mode: "insensitive" } },
        ];
      }

      const [locks, total, counts] = await Promise.all([
        prisma.savingsLock.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { id: true, email: true, username: true } },
          },
        }),
        prisma.savingsLock.count({ where }),
        prisma.savingsLock.groupBy({ by: ["status"], _count: { _all: true } }),
      ]);

      const countsByStatus: Record<string, number> = {};
      for (const c of counts) countsByStatus[c.status] = c._count._all;

      return res.json({
        locks,
        counts: countsByStatus,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Who a broadcast reaches ─────────────────────────────────
const BROADCAST_AUDIENCES = ["everyone", "verified", "unverified", "active", "inactive", "one"] as const;
/** Screens a broadcast can open. The app maps each name to its own route, so nothing here can send someone somewhere odd. */
const BROADCAST_LINKS = ["notifications", "home", "add_money", "sell", "bills", "vouchers", "referrals", "leaderboard", "savings", "rates", "transactions", "kyc", "security"] as const;

/** The accounts an audience means, as a Prisma filter. Closed accounts are never in it. */
function audienceWhere(audience: (typeof BROADCAST_AUDIENCES)[number], to?: string): Prisma.UserWhereInput | null {
  const live: Prisma.UserWhereInput = { deletedAt: null };
  const since = new Date(Date.now() - 30 * 86_400_000);
  switch (audience) {
    case "verified":
      return { ...live, kycStatus: "VERIFIED" };
    case "unverified":
      return { ...live, kycStatus: { not: "VERIFIED" } };
    case "active":
      return { ...live, transactions: { some: { createdAt: { gte: since } } } };
    case "inactive":
      return { ...live, transactions: { none: { createdAt: { gte: since } } } };
    case "one": {
      const who = (to ?? "").replace(/^@/, "").trim();
      if (!who) return null;
      return { ...live, OR: [{ email: { equals: who, mode: "insensitive" } }, { username: { equals: who, mode: "insensitive" } }] };
    }
    default:
      return live;
  }
}

// ─── GET /admin/broadcasts/audience — how many an audience reaches ─
router.get(
  "/broadcasts/audience",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audience = String(req.query.audience || "everyone") as (typeof BROADCAST_AUDIENCES)[number];
      if (!BROADCAST_AUDIENCES.includes(audience)) return res.status(400).json({ error: "Pick who it goes to." });
      const where = audienceWhere(audience, req.query.to as string | undefined);
      if (!where) return res.json({ count: 0 });
      const [count, one] = await Promise.all([
        prisma.user.count({ where }),
        audience === "one" ? prisma.user.findFirst({ where, select: { username: true, email: true } }) : null,
      ]);
      res.json({ count, person: one ? (one.username ? `@${one.username}` : one.email) : null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/notifications/broadcast — Send to all users ─
const broadcastSchema = z.object({
  /**
   * "promotion" was missing, and the console offers it.
   *
   * So every promotional broadcast was rejected at validation and never
   * reached anybody - while the console cleared the form and reloaded the
   * list, which looks exactly like success. push.ts already knew the type and
   * maps it to promoAlerts; only this list did not.
   */
  type: z.enum(["system", "promotion", "transaction", "security", "savings"]).default("system"),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  /** Who it goes to. "one" is a test: a single person, named in `to`, and not kept as a broadcast. */
  audience: z.enum(BROADCAST_AUDIENCES).default("everyone"),
  to: z.string().trim().max(254).optional(),
  /** The screen the app opens when it's tapped - one the app knows by this name. */
  link: z.enum(BROADCAST_LINKS).optional(),
});

router.post(
  "/notifications/broadcast",
  requireAdmin,
  validate(broadcastSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type, title, body, audience, to, link } = req.body;
      const adminEmail = (req as any).adminEmail as string | undefined;

      const where = audienceWhere(audience, to);
      if (!where) return res.status(400).json({ error: "Name the person to send the test to, by email or username." });
      const users = await prisma.user.findMany({ where, select: { id: true } });

      // A test reaches one person and leaves nothing in the list of broadcasts.
      if (audience === "one") {
        if (users.length === 0) return res.status(404).json({ error: "Nobody with that email or username." });
        await prisma.notification.create({ data: { userId: users[0]!.id, type, title, body } });
        sendPushOnly({ userId: users[0]!.id, type, title, body, link }).catch(() => {});
        return res.json({ message: "Test sent", count: 1, test: true });
      }
      if (users.length === 0) {
        const empty = await prisma.broadcast.create({
          data: { type, title, body, recipientCount: 0, createdBy: adminEmail ?? null },
        });
        return res.json({ message: "No users to notify", count: 0, broadcast: empty });
      }

      const broadcast = await prisma.broadcast.create({
        data: { type, title, body, recipientCount: users.length, createdBy: adminEmail ?? null },
      });

      const result = await prisma.notification.createMany({
        data: users.map((u) => ({ userId: u.id, type, title, body, broadcastId: broadcast.id })),
      });

      // Send push notifications in background
      for (const u of users) {
        sendPushOnly({ userId: u.id, type, title, body, link }).catch(() => {});
      }

      return res.json({
        message: `Notification sent to ${result.count} user(s)`,
        count: result.count,
        broadcast,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/broadcasts — list past broadcasts ────────────
router.get(
  "/broadcasts",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const broadcasts = await prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      // How many opened each one in the app: its notifications marked read.
      const reads = broadcasts.length
        ? await prisma.notification.groupBy({ by: ["broadcastId"], where: { broadcastId: { in: broadcasts.map((b) => b.id) }, read: true }, _count: { _all: true } })
        : [];
      const readBy = new Map(reads.map((r) => [r.broadcastId, r._count._all]));
      res.json({ broadcasts: broadcasts.map((b) => ({ ...b, readCount: readBy.get(b.id) ?? 0 })) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /admin/broadcasts/:id — remove broadcast + its notifications ─
router.delete(
  "/broadcasts/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const existing = await prisma.broadcast.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: "Broadcast not found" });
      }
      await prisma.broadcast.delete({ where: { id } });
      console.log(`[ADMIN] broadcast deleted id=${id} by=${(req as any).adminEmail}`);
      res.json({ message: "Broadcast deleted" });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Savings Vault Config (on-chain) ─────────────────────────
const SAVINGS_MODULE =
  "0x8c15ae884eada05ebff5dc5f4cb74b32bc8f676711cf40e172fe2c9a71b2dd18::savings_vault";

const vaultAptos = new Aptos(
  new AptosConfig({ network: Network.CUSTOM, fullnode: env.MOVEMENT_RPC_URL })
);

// GET /admin/vault-config — read on-chain vault config
router.get("/vault-config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await vaultAptos.view({
      payload: {
        function: `${SAVINGS_MODULE}::get_config` as `${string}::${string}::${string}`,
        functionArguments: [],
      },
    });
    // Returns (admin, fee_wallet, fee_bps, vault_address)
    const [admin, feeWallet, feeBps, vaultAddress] = result as [string, string, string, string];
    res.json({
      admin,
      feeWallet,
      feeBps: Number(feeBps),
      feePercent: (Number(feeBps) / 100).toFixed(2),
      vaultAddress,
    });
  } catch (err: any) {
    console.error("Get vault config error:", err);
    res.status(500).json({ error: "Failed to read vault config from chain" });
  }
});

// POST /admin/vault-config/update — update fee wallet and fee bps on-chain
const updateVaultSchema = z.object({
  feeWallet: z.string().min(1, "Fee wallet address required"),
  feeBps: z.number().int().min(0).max(500, "Max fee is 5% (500 bps)"),
});

router.post(
  "/vault-config/update",
  requireAdmin,
  validate(updateVaultSchema),
  async (req: Request, res: Response) => {
    try {
      const { feeWallet, feeBps } = req.body;

      const privateKey = new Ed25519PrivateKey(env.MOVEMENT_TREASURY_PRIVATE_KEY);
      const adminAccount = Account.fromPrivateKey({
        privateKey,
        address: env.MOVEMENT_TREASURY_ADDRESS,
      });

      const transaction = await vaultAptos.transaction.build.simple({
        sender: adminAccount.accountAddress,
        data: {
          function: `${SAVINGS_MODULE}::update_fee` as `${string}::${string}::${string}`,
          functionArguments: [feeWallet, BigInt(feeBps)],
        },
      });

      const committedTxn = await vaultAptos.signAndSubmitTransaction({
        signer: adminAccount,
        transaction,
      });

      await vaultAptos.waitForTransaction({ transactionHash: committedTxn.hash });

      console.log(`[ADMIN] Vault fee updated — wallet: ${feeWallet}, bps: ${feeBps}, tx: ${committedTxn.hash}`);

      res.json({
        message: "Vault fee updated on-chain",
        feeWallet,
        feeBps,
        feePercent: (feeBps / 100).toFixed(2),
        txHash: committedTxn.hash,
      });
    } catch (err: any) {
      console.error("Update vault config error:", err);
      const msg = err.message?.includes("ENOT_ADMIN")
        ? "Treasury wallet is not the vault admin. Only the contract deployer can update fees."
        : err.message || "Failed to update vault config";
      res.status(500).json({ error: msg });
    }
  }
);

// ─── GET /admin/users/:id/wallets — List a user's wallets ────
router.get(
  "/users/:id/wallets",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, username: true, firstName: true, lastName: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const wallets = await prisma.wallet.findMany({
        where: { userId },
        orderBy: [{ chain: "asc" }, { asset: "asc" }],
      });

      return res.json({ user, wallets });
    } catch (err) {
      next(err);
    }
  }
);

// ─── /admin/users/:id/ton-recovery — one person's older TON wallet ──
async function tonRecoveryView(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tonRecoveryEnabled: true } });
  if (!user) return null;
  const state = await tonRowState(userId);
  // Live from the chain, and blank rather than wrong if the chain can't be read.
  const balance = state.stale && state.saved ? await getTonUsdtBalance(state.saved).catch(() => null) : null;
  return {
    enabled: user.tonRecoveryEnabled,
    stale: state.stale,
    savedAddress: state.saved,
    currentAddress: state.current,
    balance,
  };
}

router.get("/users/:id/ton-recovery", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = await tonRecoveryView(req.params.id as string);
    if (!view) return res.status(404).json({ error: "User not found" });
    res.json(view);
  } catch (err) {
    next(err);
  }
});

router.put("/users/:id/ton-recovery", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const by = String((req as any).adminEmail || "admin");
    const gate = await checkActionPassword(by, req.body?.password, "ton recovery");
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "On or off?" });
    const userId = req.params.id as string;
    await prisma.user.update({ where: { id: userId }, data: { tonRecoveryEnabled: req.body.enabled } });
    console.log(`[ADMIN] TON recovery ${req.body.enabled ? "on" : "off"} for ${userId} by ${by}`);
    res.json(await tonRecoveryView(userId));
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/users/:id/deposit-addresses — where they can send other coins ──
//
// Bitcoin and Tron (one permanent address each, paying USDC into their Solana
// wallet) and the converted-deposit addresses (paying USDCx on Movement). Read
// only: nothing is created for somebody who never opened these screens.
router.get(
  "/users/:id/deposit-addresses",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;
      const NAMES: Record<number, string> = {
        1: "Ethereum", 56: "BNB Chain", 137: "Polygon", 4663: "Robinhood Chain",
        10001: "Bitcoin", 10103: "Solana", 42161: "Arbitrum", 728126428: "Tron",
      };
      const out: { chainId: number; name: string; assets: string[]; address: string; settles: string }[] = [];

      const au = await prisma.serviceStatus.findMany({
        where: { key: { in: ["auaddr:btc:" + userId, "auaddr:tron:" + userId] } },
        select: { key: true, value: true },
      });
      for (const row of au) {
        try {
          const v = JSON.parse(row.value ?? "");
          if (!v?.address) continue;
          const btc = row.key.startsWith("auaddr:btc:");
          out.push({ chainId: btc ? 10001 : 728126428, name: btc ? "Bitcoin" : "Tron", assets: [btc ? "BTC" : "USDT"], address: v.address, settles: "USDC on Solana" });
        } catch {}
      }

      let convertedError: string | null = null;
      try {
        const routed = await routedAddressesReadOnly(userId);
        // Bitcoin and Tron are no longer offered from here, so their old addresses are left out.
        for (const a of routed.filter((r) => r.chainId !== 10001 && r.chainId !== 728126428)) {
          out.push({ chainId: a.chainId, name: NAMES[a.chainId] ?? String(a.chainId), assets: a.assets.map((x) => x.symbol), address: a.address, settles: "USDCx on Movement" });
        }
      } catch (e: any) {
        convertedError = "Could not read the converted-deposit addresses right now.";
        console.warn("[ADMIN] deposit addresses:", e?.message);
      }

      return res.json({ addresses: out, convertedError });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /admin/users/:id/transactions — List a user's transactions ──
router.get(
  "/users/:id/transactions",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const [transactions, total] = await Promise.all([
        prisma.transaction.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.transaction.count({ where: { userId } }),
      ]);

      return res.json({
        transactions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /admin/wallets/:id — Delete a single wallet row ──
router.delete(
  "/wallets/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const wallet = await prisma.wallet.findUnique({ where: { id } });
      if (!wallet) return res.status(404).json({ error: "Wallet not found" });

      await prisma.wallet.delete({ where: { id } });
      console.log(
        `[ADMIN] wallet deleted id=${id} user=${wallet.userId} ${wallet.chain}/${wallet.asset} balance=${wallet.balance}`
      );
      return res.json({ message: "Wallet deleted", walletId: id });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /admin/users/:id/wallets — Delete all a user's wallets ──
router.delete(
  "/users/:id/wallets",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return res.status(404).json({ error: "User not found" });

      const result = await prisma.wallet.deleteMany({ where: { userId } });
      // Reset the chosen wallet kind so the user is re-prompted (email vs 12-word)
      // and can pick a fresh type on next setup.
      await prisma.user.update({ where: { id: userId }, data: { walletType: null } });
      console.log(`[ADMIN] all wallets deleted + walletType reset for user=${userId} count=${result.count}`);
      return res.json({ message: `Deleted ${result.count} wallet(s)`, count: result.count });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /admin/users/:id — Soft-delete a user account ───
// Mirrors the self-delete flow in /user/account: wipes auth, revokes sessions,
// marks deletedAt. Keeps KYC/wallets/transactions for AML compliance (5-yr retain).
// Needs the action password in the body as well as the admin session.
router.delete(
  "/users/:id",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.params.id as string;

      const gate = await checkActionPassword(
        String((req as any).adminEmail || "admin"),
        req.body?.password,
        `closing ${userId}`
      );
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, avatarUrl: true, deletedAt: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      if (env.ADMIN_EMAIL.includes(user.email.toLowerCase())) {
        return res.status(400).json({ error: "Cannot delete an admin account" });
      }

      if (user.deletedAt) {
        return res.status(400).json({ error: "User account is already deleted" });
      }

      await prisma.$transaction([
        prisma.notification.deleteMany({ where: { userId } }),
        prisma.notificationPrefs.deleteMany({ where: { userId } }),
        prisma.chatMessage.deleteMany({ where: { conversation: { userId } } }),
        prisma.chatConversation.deleteMany({ where: { userId } }),
        prisma.beneficiary.deleteMany({ where: { userId } }),
        prisma.savingsLock.deleteMany({ where: { userId } }),

        prisma.session.deleteMany({ where: { userId } }),
        prisma.verificationCode.deleteMany({ where: { userId } }),
        prisma.refreshToken.deleteMany({ where: { userId } }),

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

      if (user.avatarUrl) {
        try {
          const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");
          const filePath = path.join(uploadsRoot, "avatars", path.basename(user.avatarUrl));
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
      }

      console.log(`[ADMIN] user soft-deleted id=${userId} email=${user.email} by=${(req as any).adminEmail}`);
      // Not awaited: the closure has happened; a mail failure is logged, not
      // reported to the console as if the delete had failed.
      sendAccountClosedEmail(user.email, new Date()).catch((e) =>
        console.error("[ADMIN] closed email failed:", e?.message),
      );
      return res.json({ message: "User account deleted", userId });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/kyc/:id/recheck — read Didit again ──────────
//
// A reviewer who corrects a name in Didit's console is editing their copy. Ours
// was taken when the decision landed and is not updated by the edit - Didit
// emits a data.updated webhook for exactly this, but only to a URL subscribed
// to it. This is the button for when that is not set up, or for seeing the
// correction land now rather than at the account's next sign-in.
// ─── POST /admin/kyc/recheck-all — re-read every waiting submission ──
//
// One at a time is fine for a correction somebody just made. It is the wrong
// tool for the queue as a whole, which is where submissions go stale: a person
// who passes and then taps Verify again leaves an abandoned session on top of
// an approved one, and nothing goes back to look unless they open the app.
// This asks about every waiting submission at once.
//
// Sequential on purpose. The queue is small - single digits - and a burst of
// parallel calls at the provider to save two seconds is not a trade worth
// making against a rate limit.
router.post(
  "/kyc/recheck-all",
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // The same sweep the hourly one runs, so the button and the schedule can
      // never drift into asking different questions.
      const { checked, rows, changed, unchanged, failed } = await sweepWaitingDidit();

      console.log(
        `[KYC] recheck-all: ${checked} people asked (${rows} rows), ${changed.length} decided, ${unchanged} still waiting, ${failed} could not be read`,
      );
      return res.json({ checked, changed, unchanged, failed });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  "/kyc/:id/recheck",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await recheckDiditSubmission(req.params.id as string);
      if (!result.ok) return res.status(400).json({ error: result.error });

      const row = await prisma.kycVerification.findUnique({
        where: { id: req.params.id as string },
        select: {
          id: true, status: true, firstName: true, lastName: true,
          documentNumber: true, dateOfBirth: true, failureReason: true,
        },
      });
      // How many documents the harvest newly wrote down. A reviewer pressing
      // this because somebody has no NIN needs to know whether that changed.
      return res.json({
        ok: true,
        status: result.status,
        harvested: result.harvested ?? 0,
        submission: row,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// Deposits held because of who sent them
//
// A naira deposit must come from an account in the buyer's own name. Where the
// sender does not match the verified ID - or the rail named nobody at all - the
// money is taken and the crypto is not released, and it waits here.
//
// Two ways out, and both are a person's decision:
//   release - the sender was fine after all; deliver what was bought
//   reject  - it was not; the naira is refunded by hand in the Flutterwave
//             dashboard, and this records that it was
// ═══════════════════════════════════════════════════════════

/**
 * ─── GET /admin/radar — accounts moving crypto unusually often ──
 *
 * Counts sponsored transfers, which is to say the ones that cost us gas:
 * withdrawals and username transfers. Solana is broken out on its own because
 * that is the chain where a transfer can cost rent rather than a fraction of a
 * cent - an address can take a withdrawal, close the token account we opened
 * for it, and pocket the rent, which is how one account emptied the Solana gas
 * wallet in an afternoon.
 *
 * Grouped in the database rather than pulled row by row: this runs over every
 * transaction in the window, and fetching them to count in JavaScript is the
 * version that falls over the month it matters.
 *
 *   ?hours=24   how far back (default 24, max 168)
 *   ?min=10     how many before it is worth showing (default 10)
 */
router.get("/radar", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
    const solCap = await solTransfersPerDay();
    const min = Math.max(Number(req.query.min) || solCap, 1);
    const since = new Date(Date.now() - hours * 60 * 60_000);

    const rows = await prisma.transaction.groupBy({
      by: ["userId", "type", "chain"],
      where: { type: { in: ["WITHDRAW", "TRANSFER_OUT"] }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    });

    type Tally = {
      userId: string;
      withdrawals: number;
      usernameTransfers: number;
      solana: number;
      total: number;
      chains: Record<string, number>;
    };
    const byUser = new Map<string, Tally>();

    for (const r of rows) {
      const t =
        byUser.get(r.userId) ??
        { userId: r.userId, withdrawals: 0, usernameTransfers: 0, solana: 0, total: 0, chains: {} };
      const n = r._count._all;
      if (r.type === "WITHDRAW") t.withdrawals += n;
      else t.usernameTransfers += n;
      if (r.chain === "SOL") t.solana += n;
      t.total += n;
      const chain = String(r.chain ?? "?");
      t.chains[chain] = (t.chains[chain] ?? 0) + n;
      byUser.set(r.userId, t);
    }

    /**
     * Either count on its own is enough to show up.
     *
     * Somebody at nine withdrawals and nine username transfers is doing the
     * same thing as somebody at eighteen of one, so the combined total is a
     * third way in - otherwise splitting the activity across two rails is all
     * it takes to stay off the list.
     */
    const flagged = [...byUser.values()].filter(
      (t) => t.withdrawals >= min || t.usernameTransfers >= min || t.solana >= min || t.total >= min,
    );
    flagged.sort((a, b) => b.solana - a.solana || b.total - a.total);

    const users = flagged.length
      ? await prisma.user.findMany({
          where: { id: { in: flagged.map((t) => t.userId) } },
          select: {
            id: true, email: true, username: true, kycStatus: true,
            createdAt: true, walletType: true,
          },
        })
      : [];
    const who = new Map(users.map((u) => [u.id, u]));

    res.json({
      window: { hours, since: since.toISOString() },
      threshold: min,
      solanaDailyCap: solCap,
      count: flagged.length,
      rows: flagged.map((t) => {
        const u = who.get(t.userId);
        return {
          userId: t.userId,
          email: u?.email ?? null,
          username: u?.username ?? null,
          kycStatus: u?.kycStatus ?? null,
          walletType: u?.walletType ?? null,
          joined: u?.createdAt ?? null,
          withdrawals: t.withdrawals,
          usernameTransfers: t.usernameTransfers,
          solana: t.solana,
          total: t.total,
          chains: t.chains,
          // Already refused by the gate rather than merely noticed.
          atCap: t.solana >= solCap,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ─── Devices at the account-creation limit ──────────────────────
 *
 * GET  /admin/devices          who is at or near it
 * POST /admin/devices/allow    wave one through  { deviceId, note }
 *
 * Somebody legitimate will be caught - a shared phone in a household is
 * ordinary, and a shop demonstrating the app will make several accounts. This
 * is how support lets them past without waiting for a deploy.
 */
router.get("/devices", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const min = Math.max(Number(req.query.min) || 2, 1);

    const rows = await prisma.session.findMany({
      where: { deviceId: { not: null } },
      select: { deviceId: true, userId: true, createdAt: true },
    });

    const byDevice = new Map<string, { users: Set<string>; first: Date; last: Date }>();
    for (const r of rows) {
      const d = r.deviceId!;
      const e = byDevice.get(d) ?? { users: new Set<string>(), first: r.createdAt, last: r.createdAt };
      e.users.add(r.userId);
      if (r.createdAt < e.first) e.first = r.createdAt;
      if (r.createdAt > e.last) e.last = r.createdAt;
      byDevice.set(d, e);
    }

    const flagged = [...byDevice.entries()]
      .filter(([, e]) => e.users.size >= min)
      .sort((a, b) => b[1].users.size - a[1].users.size)
      .slice(0, 100);

    const waved = new Set(
      (await prisma.deviceException.findMany({ select: { deviceId: true } })).map((d) => d.deviceId),
    );

    const userIds = [...new Set(flagged.flatMap(([, e]) => [...e.users]))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, username: true, kycStatus: true, createdAt: true },
        })
      : [];
    const who = new Map(users.map((u) => [u.id, u]));

    res.json({
      limit: MAX_ACCOUNTS_PER_DEVICE,
      count: flagged.length,
      rows: flagged.map(([deviceId, e]) => ({
        deviceId,
        accounts: e.users.size,
        atLimit: e.users.size >= MAX_ACCOUNTS_PER_DEVICE,
        allowed: waved.has(deviceId),
        firstSeen: e.first,
        lastSeen: e.last,
        users: [...e.users].map((id) => {
          const u = who.get(id);
          return {
            email: u?.email ?? null,
            username: u?.username ?? null,
            kycStatus: u?.kycStatus ?? null,
            joined: u?.createdAt ?? null,
          };
        }),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/devices/allow", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deviceId = String(req.body?.deviceId ?? "").trim();
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : null;
    if (!/^[A-Za-z0-9._-]{8,64}$/.test(deviceId)) {
      return res.status(400).json({ error: "That is not a device id." });
    }

    // Upsert, so pressing it twice is not an error and the note can be updated.
    const row = await prisma.deviceException.upsert({
      where: { deviceId },
      create: { deviceId, note, createdBy: (req as any).adminEmail ?? null },
      update: { note, createdBy: (req as any).adminEmail ?? null },
    });
    console.log(`[device] ${deviceId} waved through by ${(req as any).adminEmail}`);
    return res.json({ ok: true, deviceId: row.deviceId });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/funding/held — the review queue ──────────────
router.get(
  "/funding/held",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ALL is here so the shadow period can be read: nothing reaches HELD
      // while the check is only recording, and the verdicts are the whole
      // point of that period.
      const status = (req.query.status as string) || "HELD";
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);

      const where: any = status === "ALL" ? { senderName: { not: null } } : { status };
      if (req.query.verdict) where.nameVerdict = req.query.verdict as string;

      const [rows, total] = await Promise.all([
        prisma.fundingIntent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true, reference: true, status: true,
            amountNaira: true, token: true, chain: true, convertedAmount: true,
            senderName: true, senderBank: true, nameVerdict: true, holdReason: true,
            reviewedAt: true, reviewedBy: true, createdAt: true,
            user: {
              select: {
                id: true, email: true, username: true, firstName: true, lastName: true, kycStatus: true,
                // Every address they hold, so the one this deposit would pay
                // can be picked out below without a query per row.
                wallets: { select: { asset: true, chain: true, address: true } },
              },
            },
          },
        }),
        prisma.fundingIntent.count({ where }),
      ]);

      return res.json({
        // The name each transfer was measured against, alongside the one it
        // carried, so the person reviewing is not left to work it out.
        held: rows.map((r) => {
          const { wallets, ...user } = r.user ?? ({} as any);
          return {
            ...r,
            user,
            amountNaira: Number(r.amountNaira),
            convertedAmount: Number(r.convertedAmount),
            expectedName: [r.user?.firstName, r.user?.lastName].filter(Boolean).join(" ") || null,
            /**
             * Where the coin would land, resolved the same way the payout
             * resolves it: the row for this exact asset and chain, and failing
             * that any address on the chain, because one key serves every
             * asset on it.
             *
             * Worth seeing before approving. The reviewer is deciding whether
             * to release somebody else's money, and until now the one thing
             * the screen would not tell them is where it goes - an account
             * with no wallet on that chain looks identical to one that is
             * ready, right up to the moment the payout fails.
             */
            payoutAddress:
              (wallets ?? []).find((w: any) => w.asset === r.token && w.chain === r.chain)?.address ??
              (wallets ?? []).find((w: any) => w.chain === r.chain)?.address ??
              null,
          };
        }),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/funding/:id/release — deliver it after all ──
/**
 * The purchase behind a released deposit.
 *
 * Written with the same shape a webhook-delivered buy has, so every report
 * that counts buys counts this one too. The amount is the quote the person was
 * given rather than whatever was typed into a wallet - that is the figure they
 * agreed to, and the one the naira was priced against.
 *
 * No transaction hash. The transfer is made by hand and nobody is going to
 * paste one in, and a row that waits for a field that never arrives is worse
 * than a row without it. The intent's reference ties it back to the deposit if
 * anybody needs the chain.
 *
 * The reference is the intent's own, so this is idempotent: pressing release
 * twice, or a second admin pressing it, cannot write a second purchase.
 */
async function recordReleasedPurchase(
  intent: { id: string; userId: string; reference: string; token: string; chain: string; amountNaira: any; convertedAmount: any },
  adminEmail: string | null,
): Promise<void> {
  const amount = Number(intent.convertedAmount ?? 0);
  if (!(amount > 0)) {
    console.warn(`[FUNDING] released ${intent.reference} has no converted amount; no purchase written`);
    return;
  }

  try {
    await prisma.transaction.create({
      data: {
        userId: intent.userId,
        type: "BUY",
        asset: intent.token as any,
        chain: intent.chain as any,
        amount,
        fee: 0,
        status: "COMPLETED",
        reference: intent.reference,
        metadata: {
          amountNaira: Number(intent.amountNaira ?? 0),
          txHash: null,
          releasedBy: adminEmail,
          fundingIntentId: intent.id,
        },
      },
    });
  } catch (e: any) {
    // Already written - by an earlier release, or by the ordinary delivery
    // path if the hold lifted on its own. Either way there is nothing to add.
    if (e?.code === "P2002") return;
    console.error(`[FUNDING] could not record the purchase for ${intent.reference}:`, e?.message);
    return;
  }

  /**
   * And the watcher's version of the same money goes.
   *
   * The coin is sent by hand, so it carries no reference we can match on - the
   * chain-watcher sees USDC arrive from nowhere and writes an external deposit
   * for it. Leaving that beside the purchase shows the same money twice.
   *
   * Matched the way the routed deposits are: same person, same chain, an
   * amount within a hair of the quote, and detected near the release. Deleted
   * rather than adopted, because the purchase row above is the fuller record
   * and the deposit has nothing to add to it.
   */
  const near = await prisma.transaction.findFirst({
    where: {
      userId: intent.userId,
      type: "DEPOSIT",
      chain: intent.chain as any,
      metadata: { path: ["source"], equals: "external_deposit" },
      createdAt: { gte: new Date(Date.now() - 6 * 60 * 60_000) },
      // Hand-sent amounts are rounded, so this is deliberately loose: within
      // two per cent of the quote, which no second deposit is likely to be.
      amount: { gte: amount * 0.98, lte: amount * 1.02 },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, amount: true },
  });

  if (near) {
    await prisma.transaction.delete({ where: { id: near.id } }).catch(() => {});
    console.log(
      `[FUNDING] ${intent.reference}: purchase recorded, removed the watcher's duplicate of ${near.amount}`,
    );
  }
}

router.post(
  "/funding/:id/release",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const note = String(req.body?.note || "").slice(0, 500);

      const intent = await prisma.fundingIntent.findUnique({ where: { id } });
      if (!intent) return res.status(404).json({ error: "Not found" });
      if (intent.status !== "HELD") {
        return res.status(409).json({ error: `This deposit is ${intent.status}, not held.` });
      }

      /**
       * Records the decision. It still does NOT send anything.
       *
       * The coin goes out from the treasury, by whoever approved it. Sending
       * from here would put an automatic payout behind a button whose whole
       * reason for existing is that a person looked at the transfer and judged
       * it - and an approval that pays out on click is not a review, it is a
       * slower webhook.
       *
       * What it DOES do now is write the purchase down. Releasing used to
       * record only the decision, so a released deposit had a PAID intent and
       * no transaction anywhere: the coin arrived, the chain-watcher saw USDC
       * turn up from nowhere and filed it as an external deposit, and the
       * purchase existed in no report. It was missing from buy volume, missing
       * from fee revenue, and the person who bought it saw "Deposited USDC"
       * in their own history.
       */
      await prisma.fundingIntent.update({
        where: { id },
        data: {
          status: "PAID",
          holdReason: null,
          reviewedAt: new Date(),
          reviewedBy: `released${note ? `: ${note}` : ""}`,
        },
      });

      await recordReleasedPurchase(intent, (req as any).adminEmail ?? null);

      await sendNotification({
        userId: intent.userId,
        type: "transaction",
        title: "Deposit approved",
        body: `Your ₦${Number(intent.amountNaira).toLocaleString()} deposit passed review and your ${intent.token} is on the way.`,
      }).catch(() => {});

      return res.json({ ok: true, sendBy: "treasury-by-hand", token: intent.token, amount: Number(intent.convertedAmount), chain: intent.chain });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /admin/funding/:id/reject — refunded by hand ───────
router.post(
  "/funding/:id/reject",
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;
      const note = String(req.body?.note || "").slice(0, 500);

      const intent = await prisma.fundingIntent.findUnique({ where: { id } });
      if (!intent) return res.status(404).json({ error: "Not found" });
      if (intent.status !== "HELD") {
        return res.status(409).json({ error: `This deposit is ${intent.status}, not held.` });
      }

      /**
       * Records the decision. It does NOT move any money: the originating
       * account number arrives masked, so there is nothing to pay back to from
       * here, and the refund is issued against the charge in the Flutterwave
       * dashboard. Saying so plainly beats a button that looks like it
       * refunded and did not.
       */
      await prisma.fundingIntent.update({
        where: { id },
        data: {
          status: "REFUNDED",
          reviewedAt: new Date(),
          reviewedBy: `rejected${note ? `: ${note}` : ""}`,
        },
      });

      await sendNotification({
        userId: intent.userId,
        type: "transaction",
        title: "Deposit returned",
        body: `Your ₦${Number(intent.amountNaira).toLocaleString()} deposit was sent from an account that isn't in your name, so it's being refunded to where it came from.`,
      }).catch(() => {});

      return res.json({ ok: true, refundBy: "flutterwave-dashboard", chargeId: intent.chargeId });
    } catch (err) {
      next(err);
    }
  }
);

// ═══════════════════════════════════════════════════════════
// ROUTED DEPOSITS — Stableyard
//
// BTC, Tron USDT and other chains we do not hold, converted on the way in and
// landing as USDCx. Two things are wanted here: seeing what is in flight, and
// turning an asset off without a deploy.
// ═══════════════════════════════════════════════════════════

// ─── GET /admin/swap/settings — swaps, and the BTC / Tron deposit switches ──
//
// Swaps (fee, minimum, slippage, daily cap, on/off) and the two deposits that
// arrive as USDC on Solana (on, off or hidden, and their dollar minimum).
// Every value is re-read by the API on each request, so a change here takes
// effect within seconds and needs no deploy.
/** Which keys are set, and the two wallets swaps out of Movement run through. */
async function swapWiring() {
  const baseAddress = routeWalletAddress();
  let baseUsdc: number | null = null;
  if (baseAddress) baseUsdc = await getOnChainBalance("USDC", "BASE", baseAddress).catch(() => null);
  return {
    providers: { oneclick: isOneClickConfigured(), aurora: isAuroraConfigured() },
    movementRoute: {
      configured: isMovementRouteConfigured(),
      movementAddress: env.SWAP_MOVEMENT_ADDRESS || null,
      baseAddress,
      baseUsdc,
    },
  };
}

router.get("/swap/settings", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({ configured: isSwapConfigured(), settings: await auroraSettings(), limits: AURORA_LIMITS, ...(await swapWiring()) });
  } catch (err) {
    next(err);
  }
});

router.put("/swap/settings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const settings = await updateAuroraSettings(req.body ?? {}, (req as any).admin?.email);
    return res.json({ configured: isSwapConfigured(), settings, limits: AURORA_LIMITS, ...(await swapWiring()) });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not change that." });
  }
});

// ─── GET /admin/swap/recent — the latest swaps, and whether their fee came in ──
router.get("/swap/recent", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.transaction.findMany({
      where: { type: "SWEEP", metadata: { path: ["kind"], equals: "swap" } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, userId: true, status: true, amount: true, createdAt: true, metadata: true, user: { select: { email: true, username: true } } },
    });
    return res.json({
      swaps: rows.map((r) => {
        const m = (r.metadata ?? {}) as any;
        return {
          id: r.id,
          user: r.user?.username ? `@${r.user.username}` : r.user?.email ?? r.userId,
          status: r.status,
          swapStatus: m.swapStatus ?? null,
          from: m.from ? `${m.from.amount} ${m.from.symbol} on ${m.from.chain}` : null,
          to: m.to ? `${Number(r.amount)} ${m.to.symbol} on ${m.to.chain}` : null,
          fee: m.fee ? { amount: m.fee.amount, symbol: m.fee.symbol, collected: !!m.fee.collected, error: m.fee.error ?? m.fee.skipped ?? null } : null,
          originTxHash: m.originTxHash ?? null,
          createdAt: r.createdAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /admin/routed/assets — the catalogue and its switches ──
router.get("/routed/assets", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    return res.json({
      configured: isStableyardConfigured(),
      assets: await routedAssetStates(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ─── PUT /admin/routed/assets — set one, or all of them ──
 *
 * Three states: visible, unavailable, hidden. Unavailable is the one worth
 * having - the token stays in the app, named and inert, instead of vanishing
 * and leaving somebody who used it last week wondering where it went.
 */
router.put("/routed/assets", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chainId, symbol, state, all } = req.body ?? {};
    const ok: RoutedState[] = ["visible", "unavailable", "hidden"];
    if (!ok.includes(state)) {
      return res.status(400).json({ error: "state must be visible, unavailable or hidden" });
    }

    // All of them, for the day the provider is unwell.
    if (all === true) {
      await setAllRoutedAssetStates(state, (req as any).admin?.email);
      return res.json({ assets: await routedAssetStates() });
    }

    if (typeof chainId !== "number" || typeof symbol !== "string") {
      return res.status(400).json({ error: "chainId and symbol are required" });
    }
    await setRoutedAssetState(chainId, symbol, state, (req as any).admin?.email);
    return res.json({ assets: await routedAssetStates() });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not change that." });
  }
});

/**
 * ─── GET /admin/routed/deposits — what is in flight, across everyone ──
 *
 * Read from the provider per account rather than from our own mirror, because
 * the point of this screen is to see what THEY think is happening - our rows
 * only ever show what was last synced.
 *
 * Who to ask about comes from our own enrolment markers, not from guessing.
 * It used to take the sixty newest users with a Movement wallet, which missed
 * everybody older than that - including the only account that had actually
 * deposited, which is why this screen sat empty with a live deposit in it.
 *
 * Worse, the call it used creates an account when it does not find one. An
 * admin opening this tab would have registered sixty people at a payment
 * provider who had never asked for it. The read-only variant cannot.
 */
router.get("/routed/deposits", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isStableyardConfigured()) return res.json({ deposits: [], enrolled: 0 });

    const accounts = await enrolledAccounts();
    if (!accounts.length) return res.json({ deposits: [], enrolled: 0 });

    const users = await prisma.user.findMany({
      where: { id: { in: accounts.map((a) => a.userId) } },
      select: { id: true, username: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const out: any[] = [];
    for (const a of accounts) {
      const acts = await routedActivityReadOnly(a.userId, a.accountId).catch(() => []);
      const u = byId.get(a.userId);
      for (const d of acts) {
        out.push({ ...d, user: { username: u?.username ?? null, email: u?.email ?? null } });
      }
    }

    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return res.json({ deposits: out, enrolled: accounts.length });
  } catch (err) {
    next(err);
  }
});

/* ═══ Vouchers ══════════════════════════════════════════════ */

/**
 * ─── GET /admin/vouchers/from-users — what people made, and what escrow holds ──
 *
 * Its own endpoint rather than a flag on the main list, because the numbers
 * are different numbers. Ours are a promo budget; these are other people's
 * money, and the figure that matters is whether the wallet still holds what we
 * believe we owe.
 */
router.get("/vouchers/from-users", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isVoucherEscrowConfigured()) {
      return res.json({ configured: false, vouchers: [], escrow: null });
    }

    const [recon, rows] = await Promise.all([
      escrowReconciliation(),
      prisma.voucher.findMany({
        where: { createdByUserId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true, code: true, mode: true, status: true, potAmount: true,
          totalClaims: true, endsAt: true, createdAt: true, fundingTxHash: true,
          refundState: true, refundAmount: true, refundTxHash: true,
          refundAttempts: true, refundError: true, refundedAt: true,
          creator: { select: { username: true, email: true } },
          claims: { where: { status: { in: ["PENDING", "SENT"] } }, select: { amount: true } },
        },
      }),
    ]);

    return res.json({
      configured: true,
      escrow: { address: voucherEscrowAddress(), ...recon },
      vouchers: rows.map((v) => ({
        id: v.id,
        code: v.code,
        lucky: v.mode === "LUCKY",
        status: v.status,
        pot: Number(v.potAmount ?? 0),
        claimed: v.claims.length,
        of: v.totalClaims ?? 0,
        paidOut: v.claims.reduce((sum, c) => sum + Number(c.amount), 0),
        createdAt: v.createdAt,
        endsAt: v.endsAt,
        by: v.creator?.username ?? v.creator?.email ?? null,
        fundingTxHash: v.fundingTxHash,
        refund: {
          state: v.refundState,
          amount: Number(v.refundAmount ?? 0),
          txHash: v.refundTxHash,
          attempts: v.refundAttempts,
          error: v.refundError,
          at: v.refundedAt,
        },
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** ─── POST /admin/vouchers/refunds/sweep — run it now rather than at the interval ── */
router.post("/vouchers/refunds/sweep", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await sweepRefunds();
    console.log(`[ESCROW] manual sweep: ${result.sent} sent, ${result.failed} failed`);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not run the sweep." });
  }
});



/**
 * ─── GET /admin/vouchers — every voucher, and what the float can cover ──
 *
 * The float is read from the chain and the reserve from our own rows, because
 * they answer different questions: one is what is there, the other is what is
 * already promised. A console that showed only the balance would let somebody
 * promise the same money twice.
 */
router.get("/vouchers", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isVoucherTreasuryConfigured()) {
      return res.json({ configured: false, vouchers: [], float: null });
    }

    const [vouchers, balance, reserve] = await Promise.all([
      prisma.voucher.findMany({
        // Ours only. The ones people made have their own tab, their own
        // wallet, and numbers that mean something different.
        where: { createdByUserId: null },
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { claims: true } },
          claims: {
            where: { status: { in: ["PENDING", "SENT"] } },
            select: { amount: true },
          },
        },
      }),
      voucherTreasuryBalance(),
      voucherReserved(),
    ]);

    return res.json({
      configured: true,
      float: {
        address: voucherTreasuryAddress(),
        balance,
        reserved: reserve.reserved,
        uncapped: reserve.uncapped,
        free: Math.max(balance - reserve.reserved, 0),
      },
      vouchers: vouchers.map((v) => ({
        id: v.id,
        code: v.code,
        kind: v.kind,
        status: v.status,
        mode: v.mode,
        potAmount: v.potAmount === null ? null : Number(v.potAmount),
        rewardAmount: Number(v.rewardAmount),
        totalClaims: v.totalClaims,
        perUserClaims: v.perUserClaims,
        requirements: v.requirements,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        note: v.note,
        createdAt: v.createdAt,
        // Places held, not rows: a failed claim is not one somebody has.
        claimed: v.claims.length,
        paidOut: v.claims.reduce((sum, c) => sum + Number(c.amount), 0),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * ─── GET /admin/vouchers/:id/slices — the spread, and what is left of it ──
 *
 * Only for a lucky voucher. Shows every slice largest first, marked taken or
 * waiting, so the shape of the thing can be read at a glance after it is live
 * as well as before.
 */
router.get("/vouchers/:id/slices", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slices = await prisma.voucherSlice.findMany({
      where: { voucherId: String(req.params.id) },
      orderBy: { amount: "desc" },
      select: {
        id: true,
        amount: true,
        claimId: true,
        claim: { select: { createdAt: true, user: { select: { username: true } } } },
      },
      take: 1000,
    });

    return res.json({
      slices: slices.map((s) => ({
        id: s.id,
        amount: Number(s.amount),
        taken: !!s.claimId,
        by: s.claim?.user?.username ?? null,
        at: s.claim?.createdAt ?? null,
      })),
      left: slices.filter((s) => !s.claimId).length,
      owed: slices.filter((s) => !s.claimId).reduce((sum, s) => sum + Number(s.amount), 0),
    });
  } catch (err) {
    next(err);
  }
});

/** ─── GET /admin/vouchers/:id/claims — who claimed it, and what became of it ── */
router.get("/vouchers/:id/claims", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const claims = await prisma.voucherClaim.findMany({
      where: { voucherId: String(req.params.id) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true, amount: true, status: true, txHash: true, error: true, createdAt: true,
        user: { select: { username: true, email: true } },
      },
    });
    return res.json({
      claims: claims.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        status: c.status,
        txHash: c.txHash,
        error: c.error,
        createdAt: c.createdAt,
        who: c.user.username ? `@${c.user.username}` : c.user.email,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The cut a request asks for, whether it is being previewed or kept.
 *
 * Shared so the preview cannot show one shape and the saved voucher hold
 * another. It cuts a fresh set every time it is called - which is the point of
 * Reshuffle - so what the admin finally keeps is the cut made by the create
 * call, not the one they were looking at.
 *
 * That is deliberate. Carrying the previewed slices through would mean
 * trusting a list of amounts posted by the browser, and a compromised console
 * could then hand itself the whole pot in one slice.
 */
function cutFromRequest(b: any): { slices: number[]; warning: string | null; pot: number } {
  const pot = Number(b.potAmount);
  if (!Number.isFinite(pot) || pot <= 0) throw new Error("A pot has to be more than nothing.");

  if (typeof b.amounts === "string" && b.amounts.trim()) {
    return { slices: parseSlices(b.amounts, pot), warning: null, pot };
  }

  const cut = cutPot({
    pot,
    winners: Number(b.winners),
    min: b.minAmount != null && b.minAmount !== "" ? Number(b.minAmount) : undefined,
    max: b.maxAmount != null && b.maxAmount !== "" ? Number(b.maxAmount) : undefined,
    spread: (["even", "mixed", "wild"].includes(b.spread) ? b.spread : "mixed") as Spread,
  });
  return { ...cut, pot };
}

/**
 * ─── POST /admin/vouchers/preview — cut a pot without keeping it ──
 *
 * Read-only in every sense: nothing is written, nothing is reserved. It exists
 * so the spread can be looked at and reshuffled before a voucher exists at
 * all - the alternative was creating one to see what it would pay.
 */
router.post("/vouchers/preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { slices, warning } = cutFromRequest(req.body ?? {});
    return res.json({
      amounts: [...slices].sort((a, b) => b - a).map(toAmount),
      summary: describe(slices),
      warning,
    });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not cut that pot." });
  }
});

/** ─── POST /admin/vouchers — make one ── */
router.post("/vouchers", requireAdmin, async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const code = normaliseCode(b.code || generateVoucherCode());
    if (!/^[A-Z0-9-]{4,64}$/.test(code)) {
      return res.status(400).json({ error: "A code is 4 to 64 letters, digits or dashes." });
    }

    const lucky = b.mode === "LUCKY";

    /**
     * A lucky voucher's pot is cut here, before anything is written.
     *
     * If the cut is impossible - a pot too small for its floor, typed amounts
     * that do not add up - this throws and no voucher exists. The alternative
     * is a voucher with no slices, which reads as ACTIVE and pays nobody.
     */
    const cut = lucky ? cutFromRequest(b) : null;

    // On a lucky voucher this is the average, shown wherever a list wants one
    // number. The slices are what actually get paid.
    const rewardAmount = cut
      ? toAmount(Math.round(cut.slices.reduce((a, n) => a + n, 0) / cut.slices.length))
      : Number(b.rewardAmount);
    if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
      return res.status(400).json({ error: "A voucher pays more than nothing." });
    }

    /**
     * A lucky voucher is always a shared code.
     *
     * UNIQUE means good once, and a pot cut twenty ways needs twenty claims to
     * empty it - the two together make a voucher that hands out one slice and
     * strands nineteen. Forced here rather than validated, because the console
     * offers both toggles and this is not a mistake worth a refusal.
     */
    const kind = lucky ? "PUBLIC" : b.kind === "UNIQUE" ? "UNIQUE" : "PUBLIC";
    // A unique code is one per QR by definition; letting it be capped at
    // anything else makes the word mean nothing.
    // A lucky voucher's cap is how many slices it has. It cannot be uncapped -
    // the pot is finite by definition - and it cannot be anything else, or the
    // cap and the slices would disagree about when it is finished.
    const totalClaims = cut
      ? cut.slices.length
      : kind === "UNIQUE"
        ? 1
        : b.totalClaims == null
          ? null
          : Math.max(1, Number(b.totalClaims));
    const perUserClaims = Math.max(1, Number(b.perUserClaims ?? 1));

    if (totalClaims !== null && perUserClaims > totalClaims) {
      return res.status(400).json({ error: "One person cannot claim more times than the voucher allows." });
    }

    const voucher = await prisma.voucher.create({
      data: {
        code,
        kind,
        mode: lucky ? "LUCKY" : "FIXED",
        potAmount: cut ? cut.pot : null,
        // Written with the voucher, so one can never exist without the other.
        ...(cut
          ? {
              slices: {
                create: cut.slices.map((amount, position) => ({
                  position,
                  amount: toAmount(amount),
                })),
              },
            }
          : {}),
        rewardAmount,
        totalClaims,
        perUserClaims,
        requirements: parseRequirements(b.requirements),
        status: b.activate === true ? "ACTIVE" : "DRAFT",
        startsAt: b.startsAt ? new Date(b.startsAt) : null,
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        note: b.note ? String(b.note).slice(0, 300) : null,
        createdBy: (req as any).admin?.email ?? null,
      },
      select: { id: true, code: true, status: true },
    });

    return res.json({ voucher, warning: cut?.warning ?? null });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(400).json({ error: "That code is already taken." });
    }
    console.error("[VOUCHER] create failed:", err?.message);
    return res.status(400).json({ error: err?.message || "Could not create that." });
  }
});

/**
 * ─── PUT /admin/vouchers/:id — change its state ──
 *
 * Only the status. A live voucher's reward or cap cannot be edited: people
 * have already claimed against those numbers, and changing them would make the
 * claims table disagree with the thing it is a record of. End it and make
 * another.
 */
router.put("/vouchers/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const status = req.body?.status;
    const allowed = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "status must be DRAFT, ACTIVE, PAUSED or ENDED" });
    }

    const current = await prisma.voucher.findUnique({
      where: { id: String(req.params.id) },
      select: { status: true },
    });
    if (!current) return res.status(404).json({ error: "No such voucher." });
    // Ended is final. Reopening one would let a voucher somebody was told had
    // finished start paying again.
    if (current.status === "ENDED" && status !== "ENDED") {
      return res.status(400).json({ error: "That voucher has ended. Make a new one." });
    }

    await prisma.voucher.update({ where: { id: String(req.params.id) }, data: { status } });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Could not change that." });
  }
});

/**
 * ─── POST /admin/vouchers/batch — end or delete several at once ──
 *
 * Ending is always allowed. It stops a voucher paying and leaves every claim
 * against it standing.
 *
 * Deleting is not. Claims cascade with the voucher, so removing one that has
 * paid somebody takes the record of that payout with it — the float is short
 * and nothing left says why. A voucher that has ever paid is ended instead,
 * and the reply says how many, because silently doing less than was asked is
 * the worse answer.
 */
router.post("/vouchers/batch", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { ids, action } = req.body ?? {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Pick at least one voucher." });
    }
    if (ids.length > 200) {
      return res.status(400).json({ error: "Two hundred at a time, at most." });
    }
    const clean = [...new Set(ids.filter((i: unknown): i is string => typeof i === "string"))];
    if (!clean.length) return res.status(400).json({ error: "Pick at least one voucher." });

    if (action === "end") {
      const { count } = await prisma.voucher.updateMany({
        where: { id: { in: clean }, status: { not: "ENDED" } },
        data: { status: "ENDED" },
      });
      return res.json({ ended: count });
    }

    if (action === "delete") {
      // Counted before anything is removed: the answer decides what is
      // allowed, and a delete cannot be walked back.
      const paid = await prisma.voucherClaim.groupBy({
        by: ["voucherId"],
        where: { voucherId: { in: clean }, status: { in: ["PENDING", "SENT"] } },
      });
      const spent = new Set(paid.map((c) => c.voucherId));
      const safe = clean.filter((id) => !spent.has(id));

      const deleted = safe.length
        ? (await prisma.voucher.deleteMany({ where: { id: { in: safe } } })).count
        : 0;

      if (spent.size) {
        await prisma.voucher.updateMany({
          where: { id: { in: [...spent] }, status: { not: "ENDED" } },
          data: { status: "ENDED" },
        });
      }

      return res.json({
        deleted,
        endedInstead: spent.size,
        note: spent.size
          ? `${spent.size} ${spent.size === 1 ? "voucher has" : "vouchers have"} been claimed, so ${spent.size === 1 ? "it was" : "they were"} ended instead — deleting one would take the record of what it paid with it.`
          : null,
      });
    }

    return res.status(400).json({ error: "action must be end or delete" });
  } catch (err: any) {
    console.error("[VOUCHER] batch failed:", err?.message);
    return res.status(400).json({ error: err?.message || "Could not do that." });
  }
});

// ─── ID checks: manual identity checks in the app ─────────────────────────
//
// Same shape as the Business console's, so one screen serves both. Opening a
// photo or the video is logged; approving and declining take the action
// password; asking for a redo doesn't.

const statusWord = (v: { status: string; submittedAt: Date | null; redo: unknown }) =>
  v.status === "VERIFIED" ? "APPROVED" : v.status === "REJECTED" ? "DECLINED" : v.submittedAt && !(Array.isArray(v.redo) && v.redo.length) ? "IN_REVIEW" : "PENDING";

const IDENTITY_VIEWS: Record<string, Prisma.KycVerificationWhereInput> = {
  waiting: manualWaitingWhere,
  redo: { provider: "manual", status: "PENDING", submittedAt: { not: null }, NOT: { redo: { equals: Prisma.DbNull } } },
  approved: { provider: "manual", status: "VERIFIED" },
  declined: { provider: "manual", status: "REJECTED" },
};

router.get("/identity-settings", requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ settings: await identitySettings(), ...(await identitySettingsMeta()), ready: kycVaultReady() });
  } catch (err) {
    next(err);
  }
});

router.put("/identity-settings", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const by = String((req as any).adminEmail || "admin");
    const b = z.object({ manual: z.boolean(), nin: z.boolean(), passport: z.boolean(), licence: z.boolean(), password: z.string().max(200).optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "Send all four switches." });
    const gate = await checkActionPassword(by, b.data.password, "identity_settings");
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const { password: _pw, ...s } = b.data;
    void _pw;
    const settings = await setIdentitySettings(s, by);
    console.log(`[ADMIN] identity checks set by ${by}: ${JSON.stringify(settings)}`);
    res.json({ settings, ...(await identitySettingsMeta()), ready: kycVaultReady() });
  } catch (err) {
    if (err instanceof KycError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

router.get("/identity-checks", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = String(req.query.view ?? "waiting");
    const where = IDENTITY_VIEWS[view] ?? IDENTITY_VIEWS.waiting!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = 50;
    const [total, rows, waiting, redo] = await Promise.all([
      prisma.kycVerification.count({ where }),
      prisma.kycVerification.findMany({
        where,
        orderBy: view === "waiting" ? { submittedAt: "asc" } : { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, username: true, email: true, firstName: true, lastName: true } } },
      }),
      prisma.kycVerification.count({ where: IDENTITY_VIEWS.waiting! }),
      prisma.kycVerification.count({ where: IDENTITY_VIEWS.redo! }),
    ]);
    const tries = await prisma.kycVerification.groupBy({ by: ["userId"], where: { provider: "manual", userId: { in: rows.map((r) => r.userId) }, submittedAt: { not: null } }, _count: { _all: true } });
    res.json({
      checks: rows.map((v) => ({
        id: v.id,
        status: statusWord(v),
        idType: v.documentType || null,
        person: [v.user.firstName, v.user.lastName].filter(Boolean).join(" ") || null,
        email: v.user.email,
        business: { id: v.user.id, name: `@${v.user.username}`, kind: "PERSON" },
        submittedAt: v.submittedAt,
        reviewedAt: v.reviewedAt,
        reviewedBy: v.reviewedBy,
        tries: tries.find((t) => t.userId === v.userId)?._count._all ?? 1,
      })),
      counts: { waiting, redo },
      pagination: { page, pages: Math.max(1, Math.ceil(total / limit)), total },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/identity-checks/:id", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await prisma.kycVerification.findUnique({ where: { id: String(req.params.id) }, include: { user: { select: { id: true, username: true, email: true, phone: true, firstName: true, lastName: true, kycStatus: true } } } });
    if (!v || v.provider !== "manual") return res.status(404).json({ error: "No manual identity check with that id." });
    const [files, earlier] = await Promise.all([
      manualCurrentFiles(v.id),
      prisma.kycVerification.findMany({ where: { userId: v.userId, id: { not: v.id } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, provider: true, status: true, submittedAt: true, redo: true, reviewNote: true, failureReason: true, createdAt: true } }),
    ]);
    const u = v.user;
    res.json({
      check: {
        id: v.id,
        status: statusWord(v),
        idType: v.documentType || null,
        firstName: v.firstName,
        lastName: v.lastName,
        documentLast4: v.status === "VERIFIED" && v.documentNumber ? v.documentNumber.slice(-4) : null,
        submittedAt: v.submittedAt,
        reviewedAt: v.reviewedAt,
        reviewedBy: v.reviewedBy,
        reviewNote: v.reviewNote,
        redo: Array.isArray(v.redo) ? v.redo : [],
        need: manualPartsFor(v.documentType),
        asked: manualAsked(v),
        createdAt: v.createdAt,
      },
      person: { name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone },
      business: { id: u.id, name: `@${u.username}`, kind: "PERSON", merchantId: u.username, status: u.kycStatus, legalName: null, application: null },
      files: files.map((f) => ({ id: f.id, part: f.part, mime: f.mime, size: f.size, createdAt: f.createdAt })),
      earlier: earlier.map((e) => ({ id: e.id, method: e.provider === "manual" ? "manual" : "auto", status: statusWord(e), note: e.reviewNote ?? e.failureReason, createdAt: e.createdAt })),
    });
  } catch (err) {
    next(err);
  }
});

/** One photo or the video, decrypted, for an admin to look at. Every opening is logged. */
router.get("/identity-files/:id", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const f = await prisma.kycFile.findUnique({ where: { id: String(req.params.id) }, include: { verification: { select: { userId: true } } } });
    if (!f) return res.status(404).json({ error: "No file with that id." });
    let file: Buffer;
    try {
      file = openKycFile(Buffer.from(f.data));
    } catch (e: any) {
      return res.status(423).json({ error: e?.message || "That file can't be opened." });
    }
    console.log(`[ADMIN] identity file viewed by ${String((req as any).adminEmail || "admin")}: ${f.part} of ${f.verificationId} (user ${f.verification.userId})`);
    res.setHeader("Content-Type", f.mime);
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "no-store");
    res.send(file);
  } catch (err) {
    next(err);
  }
});

router.post("/identity-checks/:id/decision", requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const by = String((req as any).adminEmail || "admin");
    const b = z
      .object({
        decision: z.enum(["approve", "redo", "decline"]),
        parts: z.array(z.enum(MANUAL_PARTS)).max(4).optional(),
        note: z.string().trim().max(1000).optional(),
        firstName: z.string().trim().max(80).optional(),
        lastName: z.string().trim().max(80).optional(),
        documentNumber: z.string().trim().max(40).optional(),
        nin: z.string().trim().max(20).optional(),
        password: z.string().max(200).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "That decision isn't complete." });
    if (b.data.decision !== "redo") {
      const gate = await checkActionPassword(by, b.data.password, `identity_${b.data.decision}`);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    }
    const { password: _pw, ...d } = b.data;
    void _pw;
    const v = await decideManual(String(req.params.id), d, by);
    console.log(`[ADMIN] identity ${b.data.decision} by ${by}: check ${v.id}, user ${v.userId}${b.data.parts ? `, parts ${b.data.parts.join(",")}` : ""}`);
    res.json({ status: statusWord(v) });
  } catch (err) {
    if (err instanceof KycError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

// ─── Admin Chat Routes (delegated to chat router) ───────────
router.use("/chat", requireAdmin, adminChatRouter);

export default router;
