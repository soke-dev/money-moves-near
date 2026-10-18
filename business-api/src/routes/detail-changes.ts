/**
 * A business asking to change its name, phone or support contacts. Owners ask
 * and cancel; anyone on the team can see where it stands. Nothing goes live
 * until our team approves it (services/detail-changes).
 */
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { body } from "../lib/http";
import { audit } from "../lib/audit";
import { requireMember } from "../middleware/auth";
import { cancelChange, changeInput, changeShape, currentDetails, requestChange } from "../services/detail-changes";

const router = Router({ mergeParams: true });

/** What it shows now, and any change waiting - or the last one decided, so a turned-down change says why. */
router.get("/", requireMember(), async (req, res) => {
  const businessId = String(req.params.businessId);
  const [current, latest] = await Promise.all([
    currentDetails(businessId),
    prisma.detailChange.findFirst({ where: { businessId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({ current, change: latest ? changeShape(latest) : null });
});

router.post("/", requireMember("OWNER"), async (req, res) => {
  const businessId = String(req.params.businessId);
  const c = await requestChange(businessId, req.auth!.userId, body(changeInput, req));
  await audit(req, "details_change_requested", { businessId, detail: { changes: c.changes as object } });
  res.status(201).json({ change: changeShape(c) });
});

router.post("/:changeId/cancel", requireMember("OWNER"), async (req, res) => {
  const businessId = String(req.params.businessId);
  await cancelChange(businessId, String(req.params.changeId));
  await audit(req, "details_change_cancelled", { businessId });
  res.json({ ok: true });
});

export default router;
