/**
 * The business's application to go live, from its own dashboard.
 *
 * Answers save as the person types. Documents arrive as the file itself (the
 * request body is the file - PDF, JPEG or PNG, up to 10 MB), are checked for
 * what they really are, and are encrypted before they're stored. The identity
 * check opens Didit's own page; its result is Didit's decision, read by us.
 * Submitting checks everything and puts the business in our team's queue.
 */
import express, { Router, type Request } from "express";
import { createHash } from "crypto";
import { z } from "zod";
import type { Document, IdentityCheck } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { sendEmail, submittedEmail } from "../lib/email";
import { env } from "../config/env";
import { seal, sniff, uploadsOpen } from "../lib/vault";
import { createSession, diditReady, getDecision } from "../lib/didit";
import { recheckBanks } from "../lib/banks";
import { requireMember } from "../middleware/auth";
import { EDITABLE, isDocKind, answersSchema, applyDecision, gaps, ownersOf, payoutPlaces, type Answers } from "../services/application";

const router = Router({ mergeParams: true });
const MANAGE = ["OWNER", "ADMIN"] as const;
const MAX_FILE = 10 * 1024 * 1024;

const docShape = (d: Document) => ({ id: d.id, kind: d.kind, filename: d.filename, mime: d.mime, size: d.size, verdict: d.verdict, verdictNote: d.verdictNote, createdAt: d.createdAt });

const identityShape = (c: IdentityCheck | null, startedBy?: string | null) =>
  c && {
    status: c.status,
    providerStatus: c.providerStatus,
    firstName: c.firstName,
    lastName: c.lastName,
    dateOfBirth: c.dateOfBirth,
    documentLast4: c.documentLast4,
    startedBy: startedBy ?? null,
    checkedAt: c.checkedAt,
  };

/** The application, created empty the first time anyone looks. */
const applicationFor = (businessId: string) => prisma.application.upsert({ where: { businessId }, create: { businessId }, update: {} });
/** The application's documents - not files sent in answer to something our team asked for later (kind "request:…"). */
const activeDocs = (businessId: string) => prisma.document.findMany({ where: { businessId, replacedAt: null, NOT: { kind: { startsWith: "request:" } } }, orderBy: { createdAt: "asc" } });
const latestIdentity = (businessId: string) => prisma.identityCheck.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } });

async function editable(businessId: string) {
  const app = await applicationFor(businessId);
  if (!EDITABLE.has(app.status)) throw new HttpError(409, "This application is with our team. You can change it again if they ask.", "not_editable");
  return app;
}

async function view(businessId: string) {
  const [app, docs, identity, places] = await Promise.all([applicationFor(businessId), activeDocs(businessId), latestIdentity(businessId), payoutPlaces(businessId)]);
  const starter = identity ? await prisma.user.findUnique({ where: { id: identity.userId }, select: { email: true } }) : null;
  const answers = answersSchema.parse(app.answers ?? {});
  return {
    application: { status: app.status, answers, submittedAt: app.submittedAt, reviewedAt: app.reviewedAt, decisionNote: app.decisionNote },
    documents: docs.map(docShape),
    identity: identityShape(identity, starter?.email),
    identityReady: diditReady(),
    gaps: gaps(answers, docs, identity, places),
  };
}

router.get("/", requireMember(), async (req, res) => {
  res.json(await view(req.member!.businessId));
});

router.put("/answers", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ answers: answersSchema }), req);
  await editable(businessId);
  await prisma.application.update({ where: { businessId }, data: { answers: b.answers } });
  res.json({ ok: true });
});

/** The file is the request body. Its type is read from its first bytes, not from its name. */
router.put("/documents/:kind", requireMember(...MANAGE), limited(80), express.raw({ type: () => true, limit: MAX_FILE }), async (req, res) => {
  const businessId = req.member!.businessId;
  const kind = String(req.params.kind);
  if (!isDocKind(kind)) throw new HttpError(400, "That isn't a document we ask for.", "bad_kind");
  // Stored documents that won't open mean the key changed: nothing more is locked until it's put right.
  if (!uploadsOpen()) throw new HttpError(503, "Uploads are paused for a moment while we check something on our side. Try again a little later.", "uploads_paused");
  await editable(businessId);
  const file = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (file.length === 0) throw new HttpError(400, "That file is empty.", "empty");
  const mime = sniff(file);
  if (!mime) throw new HttpError(400, "Send a PDF, JPEG or PNG.", "bad_type");
  const filename = (() => {
    try {
      return decodeURIComponent(req.get("x-filename") ?? "").replace(/[\\/\r\n]/g, "").slice(0, 160) || `${kind}.${mime.split("/")[1]}`;
    } catch {
      return `${kind}.${mime.split("/")[1]}`;
    }
  })();
  const sha256 = createHash("sha256").update(file).digest("hex");
  const doc = await prisma.$transaction(async (tx) => {
    await tx.document.updateMany({ where: { businessId, kind, replacedAt: null }, data: { replacedAt: new Date() } });
    return tx.document.create({ data: { businessId, kind, filename, mime, size: file.length, sha256, data: new Uint8Array(seal(file)), uploadedBy: req.auth!.userId } });
  });
  await audit(req, "document_uploaded", { businessId, detail: { kind, documentId: doc.id, size: file.length } });
  res.status(201).json({ document: docShape(doc) });
});

router.delete("/documents/:docId", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  await editable(businessId);
  const done = await prisma.document.updateMany({ where: { id: String(req.params.docId), businessId, replacedAt: null }, data: { replacedAt: new Date() } });
  if (!done.count) throw new HttpError(404, "That file isn't there any more.", "not_found");
  await audit(req, "document_removed", { businessId, detail: { documentId: String(req.params.docId) } });
  res.json({ ok: true });
});

/** Where Didit sends the person back to: the dashboard they came from, if it's one of ours. */
function returnTo(req: Request) {
  const origin = req.get("origin");
  const base = origin && env.ALLOWED_ORIGINS.includes(origin) ? origin : (env.ALLOWED_ORIGINS[0] ?? "http://localhost:5174");
  return `${base}/verify?identity=back`;
}

/** Starts the check - or resumes it: Didit returns the same session for the same person and business. */
router.post("/identity", requireMember(...MANAGE), limited(30), async (req, res) => {
  const businessId = req.member!.businessId;
  await editable(businessId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const session = await createSession({ businessId, userId: user.id, email: user.email, callback: returnTo(req) });
  await prisma.identityCheck.upsert({
    where: { sessionId: session.session_id },
    create: { businessId, userId: user.id, sessionId: session.session_id, url: session.url, providerStatus: session.status ?? "Not Started" },
    update: { url: session.url },
  });
  await audit(req, "identity_started", { businessId });
  res.json({ url: session.url });
});

/** Back from Didit, or waiting on it: ask Didit what it decided. */
router.post("/identity/refresh", requireMember(), limited(120), async (req, res) => {
  const businessId = req.member!.businessId;
  const check = await latestIdentity(businessId);
  if (!check) throw new HttpError(404, "No identity check has been started yet.", "not_started");
  if (diditReady()) await applyDecision(check, await getDecision(check.sessionId));
  res.json(await view(businessId));
});

router.post("/submit", requireMember(...MANAGE), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ attest: z.literal(true, { errorMap: () => ({ message: "Confirm the details are true first." }) }) }), req);
  void b;
  const app = await editable(businessId);
  const answers: Answers = answersSchema.parse(app.answers ?? {});
  const [docs, identity, places] = await Promise.all([activeDocs(businessId), latestIdentity(businessId), payoutPlaces(businessId)]);
  const missing = gaps(answers, docs, identity, places);
  if (missing.length) throw new HttpError(400, `Still missing: ${missing[0]!.label}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ""}.`, "incomplete");

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const kind = answers.kind === "registered" ? "REGISTERED" : "INDIVIDUAL";
  await prisma.$transaction([
    prisma.application.update({ where: { businessId }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedBy: req.auth!.userId, decisionNote: null, answers: { ...answers, attest: true } } }),
    prisma.business.update({ where: { id: businessId }, data: { status: "IN_REVIEW", statusChangedAt: new Date(), kind } }),
  ]);
  // Answering "Just me" or "registered" here can change whose name the bank accounts must be in.
  if (kind !== business.kind) await recheckBanks(businessId);
  await audit(req, "application_submitted", { businessId });
  for (const to of await ownersOf(businessId)) {
    const m = submittedEmail(business.name);
    await sendEmail(to, m.subject, m.text, { html: m.html });
  }
  res.json(await view(businessId));
});

export default router;
