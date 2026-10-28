/**
 * A business's direct account, from its own dashboard: the account number,
 * what came in and what we've settled, and the keys for direct checkouts.
 *
 * Only while our team has direct accounts switched on for the business.
 * Switched off, every route here says so and the tab disappears; switched
 * back on, the same account, payments and keys come back.
 */
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { requireMember } from "../middleware/auth";
import { hashKey, keyShape, newKey } from "./api-keys";
import { directLimits } from "../lib/direct";
import { platform } from "../lib/platform";
import { directPaymentRow, directTotals } from "../services/direct";

const router = Router({ mergeParams: true });

const KEYS = ["OWNER", "ADMIN", "DEVELOPER"] as const;
const MAX_KEYS = 5;

async function directBusiness(businessId: string) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!b.directAllowed) throw new HttpError(403, "Direct account checkouts aren't switched on for this business.", "direct_off");
  return b;
}

/** Everything the tab shows. */
router.get("/", requireMember(), async (req, res) => {
  const b = await directBusiness(req.member!.businessId);
  const p = await platform();
  const limits = directLimits(p, b);
  const [payments, keys, totals] = await Promise.all([
    prisma.payment.findMany({ where: { businessId: b.id, direct: true, status: { not: "OPEN" } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.apiKey.findMany({ where: { businessId: b.id, kind: "DIRECT", revokedAt: null }, orderBy: { createdAt: "desc" } }),
    directTotals(b.id),
  ]);
  res.json({
    account: b.psaAccountNumber ? { number: b.psaAccountNumber, bank: b.psaAccountBank, name: b.psaAccountName } : null,
    limits: { minNgn: limits.minKobo / 100, maxNgn: limits.maxKobo / 100, dailyNgn: b.directDailyNgn },
    totals,
    payments: payments.map(directPaymentRow),
    keys: keys.map(keyShape),
  });
});

/** A key for direct checkouts. Live only: there's no test mode for these. */
router.post("/keys", requireMember(...KEYS), limited(20), async (req, res) => {
  const b = await directBusiness(req.member!.businessId);
  const { name } = body(z.object({ name: z.string().trim().min(1, "Name the key, where it's used, say.").max(60) }), req);
  const count = await prisma.apiKey.count({ where: { businessId: b.id, kind: "DIRECT", revokedAt: null } });
  if (count >= MAX_KEYS) throw new HttpError(400, `You have ${MAX_KEYS} direct keys already. Revoke one you don't use first.`, "too_many_keys");
  const secret = newKey("LIVE");
  const key = await prisma.apiKey.create({ data: { businessId: b.id, mode: "LIVE", kind: "DIRECT", name, prefix: secret.slice(0, 14), hash: hashKey(secret), createdById: req.auth!.userId } });
  await audit(req, "api_key_created", { businessId: b.id, detail: { keyId: key.id, mode: key.mode, name: key.name, kind: "DIRECT" } });
  // The only time the whole key is ever sent.
  res.status(201).json({ key: keyShape(key), secret });
});

router.post("/keys/:keyId/revoke", requireMember(...KEYS), async (req, res) => {
  const b = await directBusiness(req.member!.businessId);
  const key = await prisma.apiKey.findFirst({ where: { id: String(req.params.keyId), businessId: b.id, kind: "DIRECT" } });
  if (!key || key.revokedAt) throw new HttpError(404, "That key isn't here any more.", "not_found");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const saved = await prisma.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date(), revokedBy: user.email } });
  await audit(req, "api_key_revoked", { businessId: b.id, detail: { keyId: key.id, kind: "DIRECT" } });
  res.json({ key: keyShape(saved) });
});

export default router;
