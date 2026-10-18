/**
 * A business's disputes, one mode at a time: the open ones, each with its
 * conversation, and the reply - with files - while it's the business's turn.
 * Refunding instead goes through refunds, which closes the dispute.
 */
import express, { Router } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import type { Dispute, DisputeMessage, Payment, PaymentLink, Settlement } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { LockedDocument, open as openDocument, seal, sniff, uploadsOpen } from "../lib/vault";
import { requireMember } from "../middleware/auth";
import { paymentShape } from "./money";
import { businessReply, filesOf, isOpen, messageShape } from "../services/disputes";

const router = Router({ mergeParams: true });

/** Who answers disputes: the people who look after customers and money. */
const ANSWER = ["OWNER", "ADMIN", "FINANCE", "SUPPORT"] as const;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 5;

type Full = Dispute & {
  messages: DisputeMessage[];
  payment: Payment & { link: Pick<PaymentLink, "id" | "name" | "slug"> | null; invoice: { id: string; number: string } | null; outlet: { id: string; name: string } | null; settlement: Settlement | null };
};
const include = {
  messages: { orderBy: { createdAt: "asc" } },
  payment: { include: { link: { select: { id: true, name: true, slug: true } }, invoice: { select: { id: true, number: true } }, outlet: { select: { id: true, name: true } }, settlement: true } },
} as const;

export function disputeShape(d: Full, files: Map<string, string>) {
  return {
    id: d.id,
    ref: d.ref,
    mode: d.mode,
    kind: d.kind,
    reason: d.reason,
    status: d.status,
    amountNgn: d.amountKobo / 100,
    openedAt: d.createdAt,
    replyBy: d.replyBy,
    waitUntil: d.waitUntil,
    closedAt: d.closedAt,
    outcome: d.outcome,
    refundId: d.refundId,
    customer: { name: d.customerName, email: d.customerEmail },
    messages: d.messages.map((m) => messageShape(m, files)),
    payment: paymentShape(d.payment),
  };
}

const mode = (q: unknown) => (String(q).toLowerCase() === "live" ? "LIVE" : "TEST");

async function mine(businessId: string, id: string) {
  const d = await prisma.dispute.findFirst({ where: { id, businessId }, include });
  if (!d) throw new HttpError(404, "That dispute isn't here.", "not_found");
  return d;
}
const shaped = async (d: Full) => disputeShape(d, await filesOf([d]));

router.get("/", requireMember(), async (req, res) => {
  const list = await prisma.dispute.findMany({ where: { businessId: req.member!.businessId, mode: mode(req.query.mode) }, orderBy: { createdAt: "desc" }, take: 200, include });
  const files = await filesOf(list);
  res.json({ disputes: list.map((d) => disputeShape(d, files)) });
});

router.get("/:disputeId", requireMember(), async (req, res) => {
  res.json({ dispute: await shaped(await mine(req.member!.businessId, String(req.params.disputeId))) });
});

/** A file for the next reply: a PDF, JPEG or PNG, kept sealed like every document. */
router.put("/:disputeId/files", requireMember(...ANSWER), limited(40), express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
  const businessId = req.member!.businessId;
  const d = await mine(businessId, String(req.params.disputeId));
  if (!isOpen(d) || d.refundId) throw new HttpError(409, "This dispute is closed.", "closed");
  if (!uploadsOpen()) throw new HttpError(503, "Uploads are paused for a moment while we check something on our side. Try again a little later.", "uploads_paused");
  const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (file.length === 0) throw new HttpError(400, "That file is empty.", "empty");
  const mime = sniff(file);
  if (!mime) throw new HttpError(400, "Send a PDF, JPEG or PNG.", "bad_type");
  const kind = `dispute:${d.id}`;
  if ((await prisma.document.count({ where: { businessId, kind } })) >= 30) throw new HttpError(400, "That's as many files as one dispute takes.", "too_many_files");
  const filename = (() => {
    try {
      return decodeURIComponent(req.get("x-filename") ?? "").replace(/[\\/\r\n]/g, "").slice(0, 160) || `proof.${mime.split("/")[1]}`;
    } catch {
      return `proof.${mime.split("/")[1]}`;
    }
  })();
  const doc = await prisma.document.create({
    data: { businessId, kind, filename, mime, size: file.length, sha256: createHash("sha256").update(file).digest("hex"), data: new Uint8Array(seal(file)), uploadedBy: req.auth!.userId },
  });
  res.status(201).json({ file: { id: doc.id, name: doc.filename } });
});

/** One of this dispute's files, for whoever on the team opens it. */
router.get("/:disputeId/files/:fileId", requireMember(), async (req, res) => {
  const businessId = req.member!.businessId;
  const d = await mine(businessId, String(req.params.disputeId));
  const doc = await prisma.document.findFirst({ where: { id: String(req.params.fileId), businessId, kind: `dispute:${d.id}` } });
  if (!doc) throw new HttpError(404, "That file isn't here.", "not_found");
  let file: Buffer;
  try {
    file = openDocument(Buffer.from(doc.data));
  } catch (e) {
    if (e instanceof LockedDocument) throw new HttpError(503, "Files can't be opened for a moment. Try again shortly.", "document_locked");
    throw e;
  }
  res.setHeader("Content-Type", doc.mime);
  res.setHeader("Content-Disposition", `inline; filename="${doc.filename.replace(/["\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(file);
});

router.post("/:disputeId/reply", requireMember(...ANSWER), limited(60), async (req, res) => {
  const b = body(
    z.object({
      message: z.string().trim().min(1, "Write your reply.").max(4000, "Keep the reply under 4,000 characters."),
      files: z.array(z.string().min(1)).max(MAX_FILES, `Attach up to ${MAX_FILES} files at a time.`).optional(),
    }),
    req,
  );
  const businessId = req.member!.businessId;
  const d = await mine(businessId, String(req.params.disputeId));
  await businessReply(d, b.message, b.files ?? [], req.auth!.userId);
  await audit(req, "dispute_replied", { businessId, detail: { ref: d.ref, files: b.files?.length ?? 0 } });
  res.json({ dispute: await shaped(await mine(businessId, d.id)) });
});

export default router;
