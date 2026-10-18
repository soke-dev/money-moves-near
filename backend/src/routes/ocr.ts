import { Router, Request, Response } from "express";
import multer from "multer";
import { env } from "../config/env";
import { requireAuth, requireActiveSession } from "../middleware/auth";

const router = Router();

// In-memory storage — we don't persist scanned images.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB cap
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, WEBP or HEIC images are allowed"));
    }
  },
});

// Canonical bank names the rest of the app uses. Gemini is told to return
// names from this list when it recognizes one, so the frontend can map
// directly to its existing bank picker / BANK_LOGOS without a second mapping
// step.
const KNOWN_BANKS = [
  "9 Payment Solutions Bank", "Access Bank", "Carbon", "Citibank",
  "Coronation Bank", "Ecobank", "Fairmoney Microfinance Bank",
  "Fidelity Bank", "First Bank of Nigeria", "First City Monument Bank", "Flutterwave MFB",
  "Globus Bank", "Guaranty Trust Bank", "Jaiz Bank",
  "Keystone Bank", "Kuda Bank", "Lotus Bank", "Moniepoint",
  "Momo PSB", "Nomba", "Opay", "Palmpay", "Paystack-Titan", "Polaris Bank", "Premium Trust Bank",
  "Providus Bank", "Rubies Microfinance Bank", "Sparkle",
  "Stanbic IBTC Bank", "Standard Chartered", "Sterling Bank",
  "SunTrust Bank", "TAJBank", "Titan Trust Bank", "Union Bank",
  "United Bank for Africa", "Unity Bank", "VFD Microfinance Bank",
  "Wema Bank", "Zenith Bank",
];

// Map common aliases / shorter forms back to the canonical name.
const BANK_ALIASES: Record<string, string> = {
  "gtb": "Guaranty Trust Bank",
  "gtbank": "Guaranty Trust Bank",
  "uba": "United Bank for Africa",
  "fcmb": "First City Monument Bank",
  "first bank": "First Bank of Nigeria",
  "firstbank": "First Bank of Nigeria",
  "kuda": "Kuda Bank",
  "opay digital services": "Opay",
  "palm pay": "Palmpay",
  "moniepoint mfb": "Moniepoint",
  "moniepoint microfinance bank": "Moniepoint",
  "stanbic": "Stanbic IBTC Bank",
  "nombank": "Nomba",
  "nombank mfb": "Nomba",
  "nombank microfinance bank": "Nomba",
  "nomba financial services limited": "Nomba",
  "paystack titan": "Paystack-Titan",
  "titan paystack": "Paystack-Titan",
  "flutterwave microfinance bank": "Flutterwave MFB",
  "ok mfb": "Flutterwave MFB",
};

function normalizeBank(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Exact match first
  if (KNOWN_BANKS.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (BANK_ALIASES[lower]) return BANK_ALIASES[lower];
  // Case-insensitive exact
  const ci = KNOWN_BANKS.find((b) => b.toLowerCase() === lower);
  if (ci) return ci;
  // Contains match (e.g. "Access Bank Plc" → "Access Bank")
  const contains = KNOWN_BANKS.find(
    (b) => lower.includes(b.toLowerCase()) || b.toLowerCase().includes(lower)
  );
  if (contains) return contains;
  return null;
}

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

const SYSTEM_PROMPT = `You extract Nigerian bank account information from a photo or screenshot.

The image may show: handwriting on paper, a sign on a wall, a screenshot of a chat/social media post, a printed receipt, or a bank app screen.

Extract:
1. accountNumber — the 10-digit Nigerian bank account number (NUBAN). If multiple numbers are visible, pick the one most clearly labelled as an account number. Do not return phone numbers (those usually start with 0 and are 11 digits, or +234...). Do not return BVN (11 digits). Must be exactly 10 digits.
2. bankName — the Nigerian bank the account belongs to, if visible (text or logo). Use ONE of these exact names when possible:
${KNOWN_BANKS.map((b) => `- ${b}`).join("\n")}

Respond ONLY with valid JSON in this exact shape, no markdown:
{"accountNumber": "1234567890" | null, "bankName": "Opay" | null, "confidence": "high" | "medium" | "low"}

If you cannot find a 10-digit account number, return null for accountNumber.
If no bank is visible, return null for bankName.`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

async function callGemini(imageBuffer: Buffer, mimeType: string, apiKey: string) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBuffer.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(GEMINI_URL(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned an empty response");
  return text;
}

// ═══════════════════════════════════════════════════════════
// POST /ocr/scan-account
// Accepts a multipart upload (field name "image") and returns
// extracted account number + bank name.
// ═══════════════════════════════════════════════════════════
router.post(
  "/scan-account",
  requireAuth,
  requireActiveSession,
  (req: Request, res: Response, next) => {
    upload.single("image")(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message || "Upload failed" });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(503).json({ error: "Image scanning is not configured on the server" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "No image uploaded" });
        return;
      }

      const text = await callGemini(req.file.buffer, req.file.mimetype, apiKey);

      let parsed: { accountNumber?: string | null; bankName?: string | null; confidence?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        res.status(502).json({ error: "Could not parse OCR response" });
        return;
      }

      // Validate account number: must be exactly 10 digits.
      let accountNumber: string | null = null;
      if (typeof parsed.accountNumber === "string") {
        const digits = parsed.accountNumber.replace(/\D/g, "");
        if (digits.length === 10) accountNumber = digits;
      }

      const bankName = normalizeBank(parsed.bankName ?? null);

      res.json({
        accountNumber,
        bankName,
        confidence: parsed.confidence || "low",
      });
    } catch (err: any) {
      const detail = String(err?.message || err);
      console.error("[ocr/scan-account]", detail);

      /**
       * Say which kind of failure it is.
       *
       * Everything used to come back as "Failed to scan image", so being out
       * of quota, having no key, and pointing the camera at a wall all read
       * the same on the phone - and the one of those that needs a human to do
       * something about it was indistinguishable from the two that do not.
       */
      if (detail.includes("429") || /quota|rate.?limit/i.test(detail)) {
        res.status(429).json({
          error: "Scanning is over its limit right now. Try again shortly.",
        });
        return;
      }
      if (detail.includes("403") || detail.includes("401")) {
        res.status(502).json({ error: "Scanning is not authorised on the server." });
        return;
      }
      res.status(500).json({ error: "Could not scan that. Please try again." });
    }
  }
);

export default router;
