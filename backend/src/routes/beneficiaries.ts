import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { requireAuth, requireActiveSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { activePayoutProvider, bankCodeByName, resolveAccount } from "../lib/payout";

const router = Router();

// ─── Schemas ────────────────────────────────────────────────
const createSchema = z.object({
  accountName: z.string().min(2).max(100),
  accountNumber: z.string().regex(/^\d{10}$/, "Must be a 10-digit account number"),
  bankName: z.string().min(2).max(100),
  bankCode: z.string().optional(),
  favourite: z.boolean().optional(),
});

const listSchema = z.object({
  favourite: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
  page: z.coerce.number().min(1).default(1),
});

// ═══════════════════════════════════════════════════════════
// GET /beneficiaries
// List beneficiaries (recent by default, filterable)
// ═══════════════════════════════════════════════════════════
router.get(
  "/",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid query params" });
        return;
      }

      const { favourite, search, limit, page } = parsed.data;
      const skip = (page - 1) * limit;

      const where: any = { userId };
      if (favourite !== undefined) where.favourite = favourite;
      if (search) {
        where.OR = [
          { accountName: { contains: search, mode: "insensitive" } },
          { accountNumber: { contains: search } },
          { bankName: { contains: search, mode: "insensitive" } },
        ];
      }

      const [beneficiaries, total] = await Promise.all([
        prisma.beneficiary.findMany({
          where,
          select: {
            id: true,
            accountName: true,
            accountNumber: true,
            bankName: true,
            bankCode: true,
            favourite: true,
            createdAt: true,
          },
          orderBy: { updatedAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.beneficiary.count({ where }),
      ]);

      res.json({
        beneficiaries,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error("List beneficiaries error:", err);
      res.status(500).json({ error: "Failed to list beneficiaries" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /beneficiaries
// Create (or update) a saved beneficiary
// ═══════════════════════════════════════════════════════════
router.post(
  "/",
  requireAuth,
  requireActiveSession,
  validate(createSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { accountName, accountNumber, bankName, bankCode, favourite } = req.body;

      const beneficiary = await prisma.beneficiary.upsert({
        where: {
          userId_accountNumber_bankName: { userId, accountNumber, bankName },
        },
        create: {
          userId,
          accountName,
          accountNumber,
          bankName,
          bankCode: bankCode || null,
          favourite: favourite || false,
        },
        update: {
          accountName,
          bankCode: bankCode || undefined,
          favourite: favourite !== undefined ? favourite : undefined,
          updatedAt: new Date(),
        },
      });

      res.status(201).json({ beneficiary });
    } catch (err) {
      console.error("Create beneficiary error:", err);
      res.status(500).json({ error: "Failed to save beneficiary" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// PATCH /beneficiaries/:id/favourite
// Toggle favourite status
// ═══════════════════════════════════════════════════════════
router.patch(
  "/:id/favourite",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;

      const existing = await prisma.beneficiary.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        res.status(404).json({ error: "Beneficiary not found" });
        return;
      }

      const beneficiary = await prisma.beneficiary.update({
        where: { id },
        data: { favourite: !existing.favourite },
      });

      res.json({ beneficiary });
    } catch (err) {
      console.error("Toggle favourite error:", err);
      res.status(500).json({ error: "Failed to toggle favourite" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// DELETE /beneficiaries/:id
// Remove a saved beneficiary
// ═══════════════════════════════════════════════════════════
router.delete(
  "/:id",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const id = req.params.id as string;

      const existing = await prisma.beneficiary.findFirst({
        where: { id, userId },
      });
      if (!existing) {
        res.status(404).json({ error: "Beneficiary not found" });
        return;
      }

      await prisma.beneficiary.delete({ where: { id } });
      res.json({ message: "Beneficiary removed" });
    } catch (err) {
      console.error("Delete beneficiary error:", err);
      res.status(500).json({ error: "Failed to remove beneficiary" });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST /beneficiaries/resolve
// Resolve bank account name via Paystack
// ═══════════════════════════════════════════════════════════

// ─── Bank name → Paystack bank_code mapping ─────────────────
const BANK_CODES: Record<string, string> = {
  "9 Payment Solutions Bank":        "120001",
  "Access Bank":                     "044",
  "Carbon":                          "565",
  "Citibank":                        "023",
  "Coronation Bank":                 "559",
  "Ecobank":                         "050",
  "Fairmoney Microfinance Bank":     "51318",
  "Fidelity Bank":                   "070",
  "First Bank of Nigeria":           "011",
  "First City Monument Bank":        "214",
  "Flutterwave MFB":                 "090567",
  "Globus Bank":                     "00103",
  "Guaranty Trust Bank":             "058",
  "Heritage Bank":                   "030",
  "Jaiz Bank":                       "301",
  "Keystone Bank":                   "082",
  "Kuda Bank":                       "50211",
  "Lotus Bank":                      "303",
  "Moniepoint":                      "50515",
  "Momo PSB":                        "120003",
  "Nomba":                           "50072",  // Nombank MFB
  "Opay":                            "999992",
  "Palmpay":                         "999991",
  "Paystack-Titan":                  "100039",
  "Polaris Bank":                    "076",
  "Premium Trust Bank":              "105",
  "Providus Bank":                   "101",
  "Rubies Microfinance Bank":        "125",
  "Sparkle":                         "51310",
  "Stanbic IBTC Bank":               "221",
  "Standard Chartered":              "068",
  "Sterling Bank":                   "232",
  "SunTrust Bank":                   "100",
  "TAJBank":                         "302",
  "Titan Trust Bank":                "102",
  "Union Bank":                      "032",
  "United Bank for Africa":          "033",
  "Unity Bank":                      "215",
  "VFD Microfinance Bank":           "566",
  "Wema Bank":                       "035",
  "Zenith Bank":                     "057",
};

// Paystack bank list cache (24h)
let paystackBankCache: { code: string; name: string }[] = [];
let bankCacheTs = 0;
const BANK_CACHE_TTL = 86_400_000; // 24 hours

async function getPaystackBankCode(bankName: string): Promise<string | null> {
  // 1) Try hardcoded map first
  if (BANK_CODES[bankName]) return BANK_CODES[bankName];

  // 2) Fetch from Paystack and fuzzy-match
  const now = Date.now();
  if (!paystackBankCache.length || now - bankCacheTs > BANK_CACHE_TTL) {
    try {
      const res = await fetch("https://api.paystack.co/bank", {
        headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
      });
      if (res.ok) {
        const data: any = await res.json();
        paystackBankCache = (data.data || []).map((b: any) => ({ code: b.code, name: b.name }));
        bankCacheTs = now;
      }
    } catch {}
  }

  // Fuzzy match: check if bank name contains or is contained
  const lower = bankName.toLowerCase();
  const match = paystackBankCache.find(
    (b) => b.name.toLowerCase() === lower || b.name.toLowerCase().includes(lower) || lower.includes(b.name.toLowerCase())
  );
  return match?.code || null;
}

router.post(
  "/resolve",
  requireAuth,
  requireActiveSession,
  async (req: Request, res: Response) => {
    try {
      const { accountNumber, bankCode, bankName } = req.body;

      if (!accountNumber || (!bankCode && !bankName)) {
        res.status(400).json({ error: "accountNumber and bankCode or bankName are required" });
        return;
      }

      /**
       * The rail that is live, because this has to agree with the payout.
       *
       * Resolving on one provider and paying on another hands back a code the
       * payout will not accept - only twenty of the forty banks share a code
       * between the two. And it is the same outage either way: when a provider
       * is down, nobody can add a bank account on it, so this follows the
       * switch rather than staying pinned to one.
       *
       * From the bank NAME where we have one. A stored code may be from a
       * legacy provider, or from the other rail.
       */
      const provider = await activePayoutProvider();
      const code = bankName ? await bankCodeByName(provider, bankName) : bankCode;
      if (!code) {
        res.status(400).json({ error: "Could not determine bank code" });
        return;
      }

      const resolved = await resolveAccount(provider, code, accountNumber);
      res.json({
        accountName: resolved.accountName,
        resolved: resolved.ok,
        bankCode: code,
      });
    } catch (err) {
      console.error("Resolve account error:", err);
      res.status(500).json({ error: "Failed to resolve account" });
    }
  }
);

export default router;
