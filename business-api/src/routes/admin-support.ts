/**
 * The help chat, from the team's side: every conversation, newest first,
 * answered live from the admin console. Mounted inside the admin router, so
 * it's admins only.
 */
import express, { Router } from "express";
import { z } from "zod";
import type { Request } from "express";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { live, listenAsTeam } from "../lib/live";
import { LockedDocument, open as openSealed } from "../lib/vault";
import { MAX_SUPPORT_FILE, addMessage, editMessage, markRead, messageShape, sealedFile, threadInclude, threadSummary } from "../services/support";

const router = Router();

async function threadById(id: string) {
  const t = await prisma.supportThread.findUnique({ where: { id }, include: threadInclude });
  if (!t) throw new HttpError(404, "No conversation with that id.", "not_found");
  return t;
}

/** New messages, reads and closes across every conversation, the moment they happen. */
router.get("/stream", (req, res) => {
  listenAsTeam(req, res);
});

/** Which open page is speaking - each says "here" and "away" for itself. */
const pageOf = (req: Request) => String(req.body?.page ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 32) || "page";

/** The inbox is open on someone's screen - sent every so often while it is, and once more when it closes. */
router.post("/here", (req, res) => {
  live.here(`${req.admin!.email}:${pageOf(req)}`);
  res.json({ ok: true });
});
router.post("/away", (req, res) => {
  live.away(`${req.admin!.email}:${pageOf(req)}`);
  res.json({ ok: true });
});

router.get("/threads", async (req, res) => {
  const view = req.query.view === "closed" ? "closed" : req.query.view === "all" ? "all" : "open";
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const where = {
    ...(view === "all" ? {} : { status: view === "open" ? ("OPEN" as const) : ("CLOSED" as const) }),
    ...(q ? { OR: [{ user: { email: { contains: q, mode: "insensitive" as const } } }, { business: { name: { contains: q, mode: "insensitive" as const } } }] } : {}),
  };
  const [list, open, closed] = await Promise.all([
    prisma.supportThread.findMany({ where, include: threadInclude, orderBy: { lastAt: "desc" }, take: 100 }),
    prisma.supportThread.count({ where: { status: "OPEN" } }),
    prisma.supportThread.count({ where: { status: "CLOSED" } }),
  ]);
  const threads = await Promise.all(list.map(threadSummary));
  res.json({ threads, counts: { open, closed, waiting: threads.filter((t) => t.status === "OPEN" && t.unread > 0).length } });
});

/** One conversation - opening it reads it. */
router.get("/threads/:id", async (req, res) => {
  const t = await threadById(String(req.params.id));
  const messages = await prisma.supportMessage.findMany({ where: { threadId: t.id }, orderBy: { createdAt: "desc" }, take: 300 });
  await markRead(t, "TEAM");
  res.json({ thread: await threadSummary({ ...t, teamReadAt: new Date() }), messages: messages.reverse().map((m) => messageShape(m, true)) });
});

router.post("/threads/:id/messages", async (req, res) => {
  const b = body(z.object({ text: z.string().trim().min(1, "Write a reply first.").max(4000, "Keep it under 4,000 characters.") }), req);
  const t = await threadById(String(req.params.id));
  const message = await addMessage(t, "TEAM", req.admin!.email, { text: b.text });
  res.status(201).json({ message: messageShape(message, true) });
});

router.put("/threads/:id/files", express.raw({ type: () => true, limit: MAX_SUPPORT_FILE }), async (req, res) => {
  const t = await threadById(String(req.params.id));
  const file = sealedFile(req.body, req.get("x-filename"));
  let caption: string | null = null;
  try {
    caption = decodeURIComponent(req.get("x-text") ?? "").slice(0, 4000) || null;
  } catch {
    /* no caption */
  }
  const message = await addMessage(t, "TEAM", req.admin!.email, { text: caption, file });
  res.status(201).json({ message: messageShape(message, true) });
});

/** Corrects one of the team's messages - the business sees the new words, with no mark that they changed. */
router.patch("/messages/:id", async (req, res) => {
  const b = body(z.object({ text: z.string().trim().min(1, "Write something.").max(4000, "Keep it under 4,000 characters.") }), req);
  const m = await prisma.supportMessage.findUnique({ where: { id: String(req.params.id) }, include: { thread: true } });
  if (!m) throw new HttpError(404, "That message isn't here.", "not_found");
  if (m.from !== "TEAM") throw new HttpError(403, "Only the team's own messages can be changed.", "not_ours");
  const saved = await editMessage(m, b.text);
  res.json({ message: messageShape(saved, true) });
});

router.post("/threads/:id/read", async (req, res) => {
  const t = await threadById(String(req.params.id));
  res.json({ at: await markRead(t, "TEAM") });
});

async function setStatus(req: Request, status: "OPEN" | "CLOSED") {
  const t = await threadById(String(req.params.id));
  const saved = await prisma.supportThread.update({
    where: { id: t.id },
    data: status === "CLOSED" ? { status, closedAt: new Date(), closedBy: req.admin!.email } : { status, closedAt: null, closedBy: null },
    include: threadInclude,
  });
  await audit(req, status === "CLOSED" ? "support_closed" : "support_reopened", { businessId: saved.businessId ?? undefined, detail: { threadId: t.id, by: req.admin!.email } });
  const summary = await threadSummary(saved);
  live.toTeam({ type: "thread", thread: summary });
  live.toPerson(saved.userId, { type: "thread", businessId: saved.businessId, threadId: saved.id, status: saved.status });
  return summary;
}
router.post("/threads/:id/close", async (req, res) => res.json({ thread: await setStatus(req, "CLOSED") }));
router.post("/threads/:id/reopen", async (req, res) => res.json({ thread: await setStatus(req, "OPEN") }));

router.get("/files/:id", async (req, res) => {
  const m = await prisma.supportMessage.findUnique({ where: { id: String(req.params.id) } });
  if (!m || !m.file) throw new HttpError(404, "That file isn't here.", "not_found");
  let file: Buffer;
  try {
    file = openSealed(Buffer.from(m.file));
  } catch (e) {
    if (e instanceof LockedDocument) throw new HttpError(503, "The documents key doesn't open this. Check DOCS_KEY.", "locked");
    throw e;
  }
  res.setHeader("Content-Type", m.fileMime ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${(m.fileName ?? "file").replace(/"/g, "")}"`);
  res.send(file);
});

export default router;
