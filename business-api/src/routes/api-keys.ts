/**
 * A business's secret keys, from its dashboard. The key is shown once, when
 * it's made, and never again: only its hash is kept, and enough of its start
 * to tell keys apart. Live keys once the business is verified.
 */
import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { requireMember } from "../middleware/auth";
import { modeOf } from "../lib/checkouts";

const router = Router({ mergeParams: true });

/** Who can see and make keys: whoever builds with them, and whoever runs the business. */
const KEYS = ["OWNER", "ADMIN", "DEVELOPER"] as const;
const MAX_KEYS = 10;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** sk_test_ and 40 random letters and digits. */
function newKey(mode: "TEST" | "LIVE") {
  const bytes = randomBytes(40);
  let tail = "";
  for (const b of bytes) tail += ALPHABET[b % ALPHABET.length];
  return `sk_${mode === "TEST" ? "test" : "live"}_${tail}`;
}

export function keyShape(k: ApiKey) {
  return { id: k.id, name: k.name, mode: k.mode, prefix: k.prefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, revokedAt: k.revokedAt };
}

router.get("/", requireMember(...KEYS), async (req, res) => {
  const mode = modeOf(req.query.mode);
  const keys = await prisma.apiKey.findMany({ where: { businessId: req.member!.businessId, mode, revokedAt: null }, orderBy: { createdAt: "desc" } });
  res.json({ keys: keys.map(keyShape) });
});

router.post("/", requireMember(...KEYS), limited(20), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ name: z.string().trim().min(1, "Name the key, where it's used, say.").max(60), mode: z.enum(["TEST", "LIVE"]) }), req);
  if (b.mode === "LIVE") {
    const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { status: true } });
    if (business.status !== "VERIFIED") throw new HttpError(403, "Live keys open once your business is verified. Build with test keys until then. Only the key changes when you go live.", "business_unverified");
  }
  const count = await prisma.apiKey.count({ where: { businessId, mode: b.mode, revokedAt: null } });
  if (count >= MAX_KEYS) throw new HttpError(400, `You have ${MAX_KEYS} keys already. Revoke one you don't use first.`, "too_many_keys");
  const secret = newKey(b.mode);
  const key = await prisma.apiKey.create({ data: { businessId, mode: b.mode, name: b.name, prefix: secret.slice(0, 14), hash: hashKey(secret), createdById: req.auth!.userId } });
  await audit(req, "api_key_created", { businessId, detail: { keyId: key.id, mode: key.mode, name: key.name } });
  // The only time the whole key is ever sent.
  res.status(201).json({ key: keyShape(key), secret });
});

router.post("/:keyId/revoke", requireMember(...KEYS), async (req, res) => {
  const businessId = req.member!.businessId;
  const key = await prisma.apiKey.findFirst({ where: { id: String(req.params.keyId), businessId } });
  if (!key || key.revokedAt) throw new HttpError(404, "That key isn't here any more.", "not_found");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const saved = await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date(), revokedBy: user.email } });
  await audit(req, "api_key_revoked", { businessId, detail: { keyId: key.id, mode: key.mode } });
  res.json({ key: keyShape(saved) });
});

export default router;
