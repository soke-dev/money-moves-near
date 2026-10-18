/**
 * What our review team has asked a business for, and its answers: a written
 * answer, a photo or document, or a BVN. Each is a task in the business's
 * Compliance. A BVN is sealed like a document and only its last four digits
 * are shown back; a file is kept with the business's documents.
 */
import express, { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import type { Document, InfoRequest, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { seal, sniff, uploadsOpen } from "../lib/vault";
import { requireMember } from "../middleware/auth";

const router = Router({ mergeParams: true });

/** Who answers for the business: the people who can change its application. */
const MANAGE = ["OWNER", "ADMIN"] as const;
const MAX_FILE = 10 * 1024 * 1024;

/** A request as anyone may see it - never the sealed BVN, only its hint. */
export function requestShape(r: InfoRequest, doc?: Pick<Document, "id" | "filename" | "mime" | "size"> | null) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    status: r.status,
    askedAt: r.createdAt,
    answer:
      r.status === "OPEN"
        ? null
        : {
            text: r.answerText,
            hint: r.answerHint,
            file: doc ? { id: doc.id, filename: doc.filename, mime: doc.mime, size: doc.size } : null,
          },
    answeredAt: r.answeredAt,
    reviewedAt: r.reviewedAt,
    /** Why it was turned down, when it was. */
    reviewNote: r.reviewNote,
  };
}

async function fileOf(r: InfoRequest) {
  return r.documentId ? prisma.document.findUnique({ where: { id: r.documentId }, select: { id: true, filename: true, mime: true, size: true } }) : null;
}

async function mine(businessId: string, id: string) {
  const r = await prisma.infoRequest.findFirst({ where: { id, businessId } });
  if (!r) throw new HttpError(404, "That request isn't here.", "not_found");
  return r;
}

/** Open, or turned down and waiting for a better answer. */
function answerable(r: InfoRequest) {
  if (r.status !== "OPEN" && r.status !== "REJECTED") throw new HttpError(409, r.status === "ANSWERED" ? "That's with our team already." : "Nothing more is needed for this one.", "not_open");
}

router.get("/", requireMember(), async (req, res) => {
  const list = await prisma.infoRequest.findMany({ where: { businessId: req.member!.businessId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } });
  const docs = await prisma.document.findMany({ where: { id: { in: list.map((r) => r.documentId).filter((x): x is string => !!x) } }, select: { id: true, filename: true, mime: true, size: true } });
  res.json({ requests: list.map((r) => requestShape(r, docs.find((d) => d.id === r.documentId))) });
});

/** A written answer, or a BVN. */
router.post("/:requestId/answer", requireMember(...MANAGE), limited(30), async (req, res) => {
  const businessId = req.member!.businessId;
  const r = await mine(businessId, String(req.params.requestId));
  answerable(r);
  const b = body(z.object({ text: z.string().trim().min(1, "Write your answer.").max(4000, "Keep it under 4,000 characters.").optional(), bvn: z.string().optional() }), req);
  let data: Prisma.InfoRequestUncheckedUpdateInput;
  if (r.kind === "TEXT") {
    if (!b.text) throw new HttpError(400, "Write your answer.", "empty");
    data = { answerText: b.text };
  } else if (r.kind === "BVN") {
    const bvn = (b.bvn ?? "").replace(/\D/g, "");
    if (bvn.length !== 11) throw new HttpError(400, "A BVN is 11 digits.", "bad_bvn");
    data = { answerSealed: new Uint8Array(seal(Buffer.from(bvn))), answerHint: `•••••••${bvn.slice(-4)}` };
  } else {
    throw new HttpError(400, "This one needs a file.", "needs_file");
  }
  const saved = await prisma.infoRequest.update({
    where: { id: r.id },
    data: { ...data, status: "ANSWERED", answeredBy: req.auth!.userId, answeredAt: new Date(), reviewNote: null, reviewedAt: null, reviewedBy: null },
  });
  await audit(req, "request_answered", { businessId, detail: { requestId: r.id, kind: r.kind } });
  res.json({ request: requestShape(saved, await fileOf(saved)) });
});

/** A photo or document: the file is the request body, its type read from its first bytes. */
router.put("/:requestId/file", requireMember(...MANAGE), limited(30), express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
  const businessId = req.member!.businessId;
  const r = await mine(businessId, String(req.params.requestId));
  answerable(r);
  if (r.kind !== "FILE") throw new HttpError(400, "This one needs a written answer.", "needs_text");
  if (!uploadsOpen()) throw new HttpError(503, "Uploads are paused for a moment while we check something on our side. Try again a little later.", "uploads_paused");
  const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (file.length === 0) throw new HttpError(400, "That file is empty.", "empty");
  const mime = sniff(file);
  if (!mime) throw new HttpError(400, "Send a PDF, JPEG or PNG.", "bad_type");
  const kind = `request:${r.id}`;
  const filename = (() => {
    try {
      return decodeURIComponent(req.get("x-filename") ?? "").replace(/[\\/\r\n]/g, "").slice(0, 160) || `answer.${mime.split("/")[1]}`;
    } catch {
      return `answer.${mime.split("/")[1]}`;
    }
  })();
  const sha256 = createHash("sha256").update(file).digest("hex");
  const saved = await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({ where: { businessId, kind, replacedAt: null }, data: { replacedAt: new Date() } });
    const doc = await tx.document.create({ data: { businessId, kind, filename, mime, size: file.length, sha256, data: new Uint8Array(seal(file)), uploadedBy: req.auth!.userId } });
    return tx.infoRequest.update({
      where: { id: r.id },
      data: { documentId: doc.id, status: "ANSWERED", answeredBy: req.auth!.userId, answeredAt: new Date(), reviewNote: null, reviewedAt: null, reviewedBy: null },
    });
  });
  await audit(req, "request_answered", { businessId, detail: { requestId: r.id, kind: r.kind, size: file.length } });
  res.status(201).json({ request: requestShape(saved, await fileOf(saved)) });
});

export default router;
