/**
 * The help chat: conversations between a person in a business and our team.
 *
 * One conversation per person per business, kept for good - a new message on
 * a closed one opens it again. Both sides see new messages the moment they're
 * sent (lib/live). Whoever isn't there is emailed about the first message they
 * haven't seen, not every one after it.
 */
import type { Prisma, SupportFrom, SupportMessage, SupportThread } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { sendEmail } from "../lib/email";
import { live } from "../lib/live";
import { seal, sniff, uploadsOpen } from "../lib/vault";

export const SUPPORT_EMAIL = "support@usemoneymoves.xyz";
export const MAX_SUPPORT_FILE = 10 * 1024 * 1024;

/** A message as either side sees it - the file only by name; it's fetched on its own. */
export function messageShape(m: SupportMessage, forTeam = false) {
  return {
    id: m.id,
    threadId: m.threadId,
    from: m.from,
    // Our team speaks as the team to the business; the console sees who.
    author: m.from === "TEAM" && !forTeam ? "Money Moves" : m.author,
    text: m.text,
    file: m.fileName ? { name: m.fileName, mime: m.fileMime, size: m.fileSize } : null,
    at: m.createdAt,
    // Corrections are the console's business: the person just sees the message as it is now.
    ...(forTeam ? { editedAt: m.editedAt } : {}),
  };
}

type ThreadWithPeople = SupportThread & { user: { email: string; firstName: string | null; lastName: string | null }; business: { id: string; name: string; merchantId: string; status: string } | null };

export const threadInclude = {
  user: { select: { email: true, firstName: true, lastName: true } },
  business: { select: { id: true, name: true, merchantId: true, status: true } },
} satisfies Prisma.SupportThreadInclude;

/** A conversation as the inbox lists it: who, about which business, the last word, and what's unread. */
export async function threadSummary(t: ThreadWithPeople) {
  const [last, unread] = await Promise.all([
    prisma.supportMessage.findFirst({ where: { threadId: t.id }, orderBy: { createdAt: "desc" } }),
    prisma.supportMessage.count({ where: { threadId: t.id, from: "USER", ...(t.teamReadAt ? { createdAt: { gt: t.teamReadAt } } : {}) } }),
  ]);
  return {
    id: t.id,
    status: t.status,
    person: { email: t.user.email, name: [t.user.firstName, t.user.lastName].filter(Boolean).join(" ") || null },
    business: t.business,
    lastAt: t.lastAt,
    last: last ? messageShape(last, true) : null,
    unread,
    userReadAt: t.userReadAt,
    closedAt: t.closedAt,
    closedBy: t.closedBy,
  };
}

/** A sent file: a photo or a PDF, read from its first bytes, sealed for keeping. */
export function sealedFile(raw: unknown, name: string | undefined) {
  if (!uploadsOpen()) throw new HttpError(503, "Photos are paused for a moment while we check something on our side. Send it as text for now.", "uploads_paused");
  const file = Buffer.isBuffer(raw) ? raw : Buffer.alloc(0);
  if (file.length === 0) throw new HttpError(400, "That file is empty.", "empty");
  if (file.length > MAX_SUPPORT_FILE) throw new HttpError(413, "Keep it under 10 MB.", "too_big");
  const webp = file.length > 12 && file.subarray(0, 4).toString("latin1") === "RIFF" && file.subarray(8, 12).toString("latin1") === "WEBP";
  const mime = sniff(file) ?? (webp ? "image/webp" : null);
  if (!mime) throw new HttpError(400, "Send a photo (JPEG, PNG or WebP) or a PDF.", "bad_type");
  let fileName = `photo.${mime.split("/")[1]}`;
  try {
    fileName = decodeURIComponent(name ?? "").replace(/[\\/\r\n]/g, "").slice(0, 160) || fileName;
  } catch {
    /* keep the plain name */
  }
  return { file: new Uint8Array(seal(file)), fileName, fileMime: mime, fileSize: file.length };
}

const firstLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 140);

/**
 * When each conversation last emailed each side. One email until they've read
 * it - kept in memory, so a restart costs at most one extra email.
 */
const emailed = { USER: new Map<string, number>(), TEAM: new Map<string, number>() };
const owesEmail = (to: "USER" | "TEAM", threadId: string, readAt: Date | null) => (emailed[to].get(threadId) ?? 0) <= (readAt?.getTime() ?? 0);

/** Adds a message, opens the conversation again if it was closed, tells both sides, and emails whoever isn't there. */
export async function addMessage(
  thread: SupportThread,
  from: SupportFrom,
  author: string,
  content: { text?: string | null; page?: string | null; file?: ReturnType<typeof sealedFile> | null },
) {
  const text = content.text?.trim() || null;
  if (!text && !content.file) throw new HttpError(400, "Write a message first.", "empty");
  const now = new Date();

  const [message, updated] = await prisma.$transaction([
    prisma.supportMessage.create({
      data: { threadId: thread.id, from, author, text, page: content.page ?? null, ...(content.file ?? {}) },
    }),
    prisma.supportThread.update({
      where: { id: thread.id },
      // Whoever writes has read everything before it.
      data: { lastAt: now, status: "OPEN", closedAt: null, closedBy: null, ...(from === "USER" ? { userReadAt: now } : { teamReadAt: now }) },
      include: threadInclude,
    }),
  ]);

  live.toPerson(updated.userId, { type: "message", businessId: updated.businessId, message: messageShape(message) });
  live.toTeam({ type: "message", message: messageShape(message, true), thread: await threadSummary(updated) });

  const what = text ? firstLine(text) : "a photo";
  if (from === "USER" && !live.teamOnline() && owesEmail("TEAM", thread.id, thread.teamReadAt)) {
    emailed.TEAM.set(thread.id, Date.now());
    void sendEmail(
      SUPPORT_EMAIL,
      `Help chat: ${updated.business?.name ?? updated.user.email}`,
      [text ?? "(sent a photo)", "", `From: ${updated.user.email}`, updated.business ? `Business: ${updated.business.name} · ${updated.business.merchantId}` : null, content.page ? `Page: ${content.page}` : null, "", "Reply in the admin console: Business → Support."]
        .filter((x): x is string => x !== null)
        .join("\n"),
      { replyTo: updated.user.email },
    ).catch(() => {});
  }
  if (from === "TEAM" && !live.personOnline(updated.userId) && owesEmail("USER", thread.id, thread.userReadAt)) {
    emailed.USER.set(thread.id, Date.now());
    const dashboard = env.ALLOWED_ORIGINS[0] ?? "http://localhost:5174";
    void sendEmail(
      updated.user.email,
      "The Money Moves team replied",
      `${text ? `"${what}"` : "The team sent you a photo."}\n\nOpen the chat in your dashboard to read it and reply: ${dashboard}/dashboard\n\n- Money Moves Business`,
    ).catch(() => {});
  }
  return message;
}

/** Our team corrects one of its own messages. The person sees it change, with nothing saying it did. */
export async function editMessage(m: SupportMessage & { thread: SupportThread }, text: string) {
  const saved = await prisma.supportMessage.update({ where: { id: m.id }, data: { text, editedAt: new Date() } });
  live.toPerson(m.thread.userId, { type: "edited", businessId: m.thread.businessId, message: messageShape(saved) });
  live.toTeam({ type: "edited", message: messageShape(saved, true) });
  return saved;
}

/** Marks one side as having read everything so far, and tells the other side. */
export async function markRead(thread: SupportThread, side: SupportFrom) {
  const at = new Date();
  await prisma.supportThread.update({ where: { id: thread.id }, data: side === "USER" ? { userReadAt: at } : { teamReadAt: at } });
  if (side === "USER") live.toTeam({ type: "read", threadId: thread.id, side, at });
  else live.toPerson(thread.userId, { type: "read", businessId: thread.businessId, side, at });
  return at;
}
