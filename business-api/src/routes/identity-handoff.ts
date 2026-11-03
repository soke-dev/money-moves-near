/**
 * The phone side of a manual identity check, reached by the code in the QR
 * the computer shows. No sign-in: the code is the key, and it opens one thing
 * only - adding photos to that one check. Nothing here reads a photo back.
 */
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { limited } from "../lib/limits";
import { log } from "../lib/log";
import { uploadsOpen } from "../lib/vault";
import { ID_TYPES, MAX_VIDEO, acceptedIds, asked, byCode, isPart, progress, savePart, submit } from "../services/identity";

const router = Router();
router.use(limited(400));

/** What the phone needs to show: whose check, which ID, what's still to take. */
router.get("/:code", async (req, res) => {
  const check = await byCode(String(req.params.code));
  if (!check.handoffOpenedAt) await prisma.identityCheck.update({ where: { id: check.id }, data: { handoffOpenedAt: new Date() } });
  const [user, business, p, idTypes] = await Promise.all([
    prisma.user.findUnique({ where: { id: check.userId }, select: { firstName: true, lastName: true } }),
    prisma.business.findUnique({ where: { id: check.businessId }, select: { name: true } }),
    progress(check),
    acceptedIds(),
  ]);
  const redo = Array.isArray(check.redo) && check.redo.length > 0;
  res.json({
    business: business?.name ?? null,
    name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
    idType: check.idType,
    /** The IDs that can be chosen. */
    idTypes,
    need: p.need,
    have: p.have,
    redo,
    note: redo ? check.reviewNote : null,
    expiresAt: check.handoffExpiresAt,
  });
});

router.put("/:code/id-type", async (req, res) => {
  const check = await byCode(String(req.params.code));
  const b = body(z.object({ idType: z.enum(ID_TYPES) }), req);
  if (Array.isArray(check.redo) && check.redo.length) throw new HttpError(409, "Keep the same ID for the parts being taken again.", "redo_keeps_id");
  if (!(await acceptedIds()).includes(b.idType)) throw new HttpError(400, "That ID isn't accepted right now. Choose one of the others.", "id_not_accepted");
  // Another ID means other photos: anything taken of the old one is set aside.
  if (check.idType && check.idType !== b.idType) await prisma.identityFile.updateMany({ where: { checkId: check.id, part: { in: ["front", "back"] }, replacedAt: null }, data: { replacedAt: new Date() } });
  const updated = await prisma.identityCheck.update({ where: { id: check.id }, data: { idType: b.idType } });
  const p = await progress(updated);
  res.json({ idType: updated.idType, need: p.need, have: p.have });
});

/** The photo or video is the request body; what it is is read from its first bytes. */
router.put("/:code/files/:part", express.raw({ type: () => true, limit: MAX_VIDEO }), async (req, res) => {
  const check = await byCode(String(req.params.code));
  const part = String(req.params.part);
  if (!isPart(part)) throw new HttpError(400, "That isn't a part of the check.", "bad_part");
  if (!check.idType) throw new HttpError(400, "Choose which ID you're using first.", "no_id_type");
  if (!uploadsOpen()) throw new HttpError(503, "Uploads are paused for a moment on our side. Try again a little later.", "uploads_paused");
  const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  await savePart(check, part, file);
  const p = await progress(check);
  res.status(201).json({ need: p.need, have: p.have, missing: p.missing });
});

router.post("/:code/submit", async (req, res) => {
  const check = await byCode(String(req.params.code));
  const sent = await submit(check);
  log.info("[identity] sent from the handoff link", { check: sent.id, parts: asked(check) });
  res.json({ status: sent.status });
});

export default router;
