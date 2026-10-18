/**
 * Messages to our team from the dashboard. Feedback is emailed to support with
 * the sender as the reply-to. The help chat is a conversation kept here and
 * answered from the admin console, live (services/support). A business is
 * named only if the sender is part of it.
 */
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { limited } from "../lib/limits";
import { sendEmail } from "../lib/email";
import { requireUser } from "../middleware/auth";
import { isDev } from "../config/env";
import { live, listenAsPerson } from "../lib/live";
import { LockedDocument, open as openSealed } from "../lib/vault";
import { MAX_SUPPORT_FILE, addMessage, markRead, messageShape, sealedFile, threadInclude, threadSummary } from "../services/support";

export { SUPPORT_EMAIL } from "../services/support";
import { SUPPORT_EMAIL } from "../services/support";

const router = Router();
const KIND = { idea: "An idea", problem: "A problem", question: "A question", chat: "Help chat" } as const;
/** One line, for a subject. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

router.post("/", requireUser, limited(isDev ? 200 : 20), async (req, res) => {
  const b = body(
    z.object({
      kind: z.enum(["idea", "problem", "question", "chat"]),
      text: z.string().trim().min(1, "Write a message first.").max(4000, "Keep it under 4,000 characters."),
      businessId: z.string().max(64).optional(),
      page: z.string().max(200).optional(),
    }),
    req,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const member = b.businessId ? await prisma.member.findFirst({ where: { userId: user.id, businessId: b.businessId }, include: { business: true } }) : null;
  const biz = member?.business;
  const sent = await sendEmail(
    SUPPORT_EMAIL,
    `${KIND[b.kind]} from ${oneLine(biz ? biz.name : user.email)}`,
    [b.text, "", `From: ${user.email}`, biz ? `Business: ${biz.name} · ${biz.merchantId} · ${biz.status.toLowerCase()}` : null, b.page ? `Page: ${b.page}` : null]
      .filter((x): x is string => x !== null)
      .join("\n"),
    { replyTo: user.email },
  );
  if (!sent) throw new HttpError(502, `Couldn't send it just now. Write to ${SUPPORT_EMAIL} and we'll pick it up from there.`, "send_failed");
  res.json({ ok: true });
});

// ─── The help chat ────────────────────────────────────────────────────────

/** The business it's about - only one the person is part of; none for help before there's a business. */
async function businessFor(userId: string, businessId: unknown) {
  if (typeof businessId !== "string" || !businessId) return null;
  const member = await prisma.member.findFirst({ where: { userId, businessId } });
  if (!member) throw new HttpError(403, "You're not part of that business.", "not_member");
  return businessId;
}

/**
 * The conversation on screen: the one with the latest word, either way. Writing
 * after it's been resolved starts a new one rather than reopening the old.
 */
async function threadOf(userId: string, businessId: string | null, create: boolean) {
  const found = await prisma.supportThread.findFirst({ where: { userId, businessId }, orderBy: { lastAt: "desc" } });
  if (!create || (found && found.status === "OPEN")) return found;
  return prisma.supportThread.create({ data: { userId, businessId } });
}

/** A fresh conversation: the current one is set aside as resolved, if anything was said in it. */
router.post("/chat/new", requireUser, limited(isDev ? 200 : 20), async (req, res) => {
  const b = body(z.object({ businessId: z.string().max(64).optional() }), req);
  const businessId = await businessFor(req.auth!.userId, b.businessId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const current = await threadOf(user.id, businessId, false);
  const said = current ? await prisma.supportMessage.count({ where: { threadId: current.id } }) : 0;
  if (current && current.status === "OPEN" && said === 0) {
    res.json({ thread: { id: current.id, status: current.status } });
    return;
  }
  if (current && current.status === "OPEN") {
    const done = await prisma.supportThread.update({ where: { id: current.id }, data: { status: "CLOSED", closedAt: new Date(), closedBy: user.email }, include: threadInclude });
    live.toTeam({ type: "thread", thread: await threadSummary(done) });
  }
  const fresh = await prisma.supportThread.create({ data: { userId: user.id, businessId } });
  res.status(201).json({ thread: { id: fresh.id, status: fresh.status } });
});

/** Replies and "seen", the moment they happen. */
router.get("/stream", requireUser, (req, res) => {
  listenAsPerson(req, res, req.auth!.userId);
});

router.get("/chat", requireUser, async (req, res) => {
  const businessId = await businessFor(req.auth!.userId, req.query.businessId);
  const thread = await threadOf(req.auth!.userId, businessId, false);
  const messages = thread ? await prisma.supportMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, take: 200 }) : [];
  res.json({
    thread: thread && { id: thread.id, status: thread.status, userReadAt: thread.userReadAt, teamReadAt: thread.teamReadAt },
    messages: messages.reverse().map((m) => messageShape(m)),
    teamOnline: live.teamOnline(),
  });
});

const chatText = z.object({
  text: z.string().trim().min(1, "Write a message first.").max(4000, "Keep it under 4,000 characters."),
  businessId: z.string().max(64).optional(),
  page: z.string().max(200).optional(),
});

router.post("/chat/messages", requireUser, limited(isDev ? 400 : 60), async (req, res) => {
  const b = body(chatText, req);
  const businessId = await businessFor(req.auth!.userId, b.businessId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const thread = (await threadOf(user.id, businessId, true))!;
  const message = await addMessage(thread, "USER", user.email, { text: b.text, page: b.page });
  res.status(201).json({ message: messageShape(message) });
});

/** A photo or PDF: the file is the body; a caption can ride in a header. */
router.put("/chat/files", requireUser, limited(isDev ? 200 : 30), express.raw({ type: () => true, limit: MAX_SUPPORT_FILE }), async (req, res) => {
  const businessId = await businessFor(req.auth!.userId, req.query.businessId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
  const file = sealedFile(req.body, req.get("x-filename"));
  let caption: string | null = null;
  try {
    caption = decodeURIComponent(req.get("x-text") ?? "").slice(0, 4000) || null;
  } catch {
    /* no caption */
  }
  const page = typeof req.query.page === "string" ? req.query.page.slice(0, 200) : null;
  const thread = (await threadOf(user.id, businessId, true))!;
  const message = await addMessage(thread, "USER", user.email, { text: caption, page, file });
  res.status(201).json({ message: messageShape(message) });
});

router.post("/chat/read", requireUser, async (req, res) => {
  const b = body(z.object({ businessId: z.string().max(64).optional() }), req);
  const businessId = await businessFor(req.auth!.userId, b.businessId);
  const thread = await threadOf(req.auth!.userId, businessId, false);
  res.json({ at: thread ? await markRead(thread, "USER") : null });
});

/** A file from the person's own conversation. */
router.get("/files/:id", requireUser, async (req, res) => {
  const m = await prisma.supportMessage.findUnique({ where: { id: String(req.params.id) }, include: { thread: true } });
  if (!m || !m.file || m.thread.userId !== req.auth!.userId) throw new HttpError(404, "That file isn't here.", "not_found");
  let file: Buffer;
  try {
    file = openSealed(Buffer.from(m.file));
  } catch (e) {
    if (e instanceof LockedDocument) throw new HttpError(503, "That file can't be opened right now.", "locked");
    throw e;
  }
  res.setHeader("Content-Type", m.fileMime ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${(m.fileName ?? "file").replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.send(file);
});

export default router;
