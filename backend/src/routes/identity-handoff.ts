/**
 * The page side of a manual identity check, reached by the link the app opens.
 * No sign-in: the code in the link is the key, and it opens one thing only -
 * adding photos to that one check. Nothing here reads a photo back.
 */
import express, { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ID_TYPES, KycError, MAX_VIDEO, acceptedIds, asked, byCode, isPart, progress, savePart, setIdType, submit } from "../lib/manual-kyc";

const router = Router();

// Per link rather than per address: the page is one person, and phones on a carrier share addresses.
router.use(
  rateLimit({
    windowMs: 15 * 60_000,
    max: 300,
    keyGenerator: (req) => `handoff:${String(req.params.code ?? req.path.split("/")[1] ?? "")}`,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many tries. Wait a few minutes and try again." },
  }),
);

const fail = (res: Response, next: NextFunction, e: unknown) => {
  if (e instanceof KycError) return res.status(e.status).json({ error: e.message, code: e.code });
  next(e);
};

/** What the page shows: whose check, which ID, what's still to take. */
router.get("/:code", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await byCode(String(req.params.code));
    if (!v.handoffOpenedAt) await prisma.kycVerification.update({ where: { id: v.id }, data: { handoffOpenedAt: new Date() } });
    const [user, p, idTypes] = await Promise.all([prisma.user.findUnique({ where: { id: v.userId }, select: { firstName: true, lastName: true } }), progress(v), acceptedIds()]);
    const redo = Array.isArray(v.redo) && v.redo.length > 0;
    res.json({
      business: null,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null,
      idType: v.documentType || null,
      idTypes,
      need: p.need,
      have: p.have,
      redo,
      note: redo ? v.reviewNote : null,
      expiresAt: v.handoffExpiresAt,
    });
  } catch (e) {
    fail(res, next, e);
  }
});

router.put("/:code/id-type", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await byCode(String(req.params.code));
    const b = z.object({ idType: z.enum(ID_TYPES) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: "Choose an ID.", code: "invalid_request" });
    const updated = await setIdType(v, b.data.idType);
    const p = await progress(updated);
    res.json({ idType: updated.documentType, need: p.need, have: p.have });
  } catch (e) {
    fail(res, next, e);
  }
});

/** The photo or video is the request body; what it is is read from its first bytes. */
router.put("/:code/files/:part", express.raw({ type: () => true, limit: MAX_VIDEO }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await byCode(String(req.params.code));
    const part = String(req.params.part);
    if (!isPart(part)) return res.status(400).json({ error: "That isn't a part of the check.", code: "bad_part" });
    const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    await savePart(v, part, file);
    const p = await progress(v);
    res.status(201).json({ need: p.need, have: p.have, missing: p.missing });
  } catch (e) {
    fail(res, next, e);
  }
});

router.post("/:code/submit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const v = await byCode(String(req.params.code));
    await submit(v);
    console.log(`[kyc] sent from the link, parts ${asked(v).join(",")}`);
    res.json({ status: "SENT" });
  } catch (e) {
    fail(res, next, e);
  }
});

export default router;
