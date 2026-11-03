/**
 * Manual identity checks: the account representative's ID photos, a selfie and
 * a three second smile video, judged by our team in the console.
 *
 * The person usually starts on a computer and carries on on a phone. The two
 * are joined by a handoff code: the computer asks for one, shows it as a QR
 * code, and the phone uses it to add photos to that one check - nothing else,
 * not even reading them back. Only its hash is stored, it lasts half an hour,
 * and sending the check for review spends it.
 *
 * Files are encrypted like documents (lib/vault). A part taken again replaces
 * the one before, which is kept for the record and never shown to anyone but
 * our team.
 *
 * Wording rule for anything the person sees: say that we check it, never how.
 */
import { createHash, randomBytes } from "crypto";
import { Prisma, type IdentityCheck, type IdentityFile } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { log } from "../lib/log";
import { platform } from "../lib/platform";
import { seal } from "../lib/vault";
import { sendEmail, identityEmail } from "../lib/email";
import { recheckBanks } from "../lib/banks";

export const ID_TYPES = ["nin", "passport", "licence"] as const;
export type IdType = (typeof ID_TYPES)[number];
export const PARTS = ["front", "back", "selfie", "video"] as const;
export type Part = (typeof PARTS)[number];
export const isPart = (p: string): p is Part => (PARTS as readonly string[]).includes(p);

/** Half an hour: long enough to find a phone and take four photos, short enough not to linger in a screenshot. */
export const HANDOFF_MS = 30 * 60_000;
export const MAX_IMAGE = 12 * 1024 * 1024;
export const MAX_VIDEO = 25 * 1024 * 1024;

/** Which parts a check needs: the back only for a driver's licence. A NIN and a passport's photo page are one side. */
export const partsFor = (idType: string | null | undefined): Part[] => (idType === "licence" ? ["front", "back", "selfie", "video"] : ["front", "selfie", "video"]);

/** The IDs a manual check accepts right now, from the console's Services. */
export async function acceptedIds(): Promise<IdType[]> {
  const i = (await platform()).identity;
  return ID_TYPES.filter((t) => i[t] !== false);
}

/** Whether new checks are manual, from the console's Services switch. */
export async function manualOn(): Promise<boolean> {
  return (await platform()).identity.manual;
}

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");

/** The parts still asked for: the redo list if our team asked, else every part the ID needs. */
export function asked(check: Pick<IdentityCheck, "idType" | "redo">): Part[] {
  const redo = Array.isArray(check.redo) ? (check.redo as string[]).filter(isPart) : [];
  return redo.length ? redo : partsFor(check.idType);
}

/** The current file of each part. */
export async function currentFiles(checkId: string): Promise<IdentityFile[]> {
  return prisma.identityFile.findMany({ where: { checkId, replacedAt: null }, orderBy: { createdAt: "asc" } });
}

/** Of the parts asked for, which have a photo in now. */
export async function progress(check: IdentityCheck) {
  const files = await currentFiles(check.id);
  const need = asked(check);
  const have = need.filter((p) => files.some((f) => f.part === p));
  return { need, have, missing: need.filter((p) => !have.includes(p)), files };
}

/**
 * A fresh handoff code for the business's manual check: the one being taken
 * (or being redone) if there is one, else a new check. Refused while a check
 * is with our team or already approved.
 */
export async function startHandoff(businessId: string, userId: string): Promise<{ code: string; expiresAt: Date; check: IdentityCheck }> {
  const latest = await prisma.identityCheck.findFirst({ where: { businessId }, orderBy: { createdAt: "desc" } });
  if (latest?.status === "APPROVED") throw new HttpError(409, "Your identity is already verified.", "already_verified");
  if (latest?.provider === "manual" && latest.status === "IN_REVIEW") throw new HttpError(409, "Your identity check is being checked. We'll email you when it's done.", "in_review");
  // One being taken (or redone) carries on, whoever on the team started it; a declined one, or an automatic one, starts afresh.
  const carryOn = latest?.provider === "manual" && latest.status === "PENDING" ? latest : null;
  if (!carryOn && !(await manualOn())) throw new HttpError(409, "Identity checks happen on the partner's page right now. Start the check from the identity step.", "not_manual");
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_MS);
  const handoff = { handoffHash: hashOf(code), handoffExpiresAt: expiresAt, handoffOpenedAt: null };
  const check = carryOn
    ? await prisma.identityCheck.update({ where: { id: carryOn.id }, data: handoff })
    : await prisma.identityCheck.create({
        data: { businessId, userId, provider: "manual", sessionId: `manual_${randomBytes(12).toString("hex")}`, url: "", providerStatus: "Not sent", status: "PENDING", ...handoff },
      });
  return { code, expiresAt, check };
}

/** The check a handoff code opens, if it's still good. */
export async function byCode(code: string): Promise<IdentityCheck> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) throw new HttpError(404, "This link isn't right. Scan the code on your computer again.", "bad_link");
  const check = await prisma.identityCheck.findUnique({ where: { handoffHash: hashOf(code) } });
  if (!check) throw new HttpError(404, "This link has already been used or replaced. Scan the code on your computer again.", "bad_link");
  if (!check.handoffExpiresAt || check.handoffExpiresAt.getTime() < Date.now()) throw new HttpError(410, "This link has expired. Make a new code on your computer and scan it again.", "link_expired");
  if (check.status !== "PENDING") throw new HttpError(409, "This check has already been sent.", "already_sent");
  return check;
}

/**
 * What a file really is, from its first bytes: a photo (JPEG, PNG or WebP) or
 * a video (WebM, MP4 or QuickTime). Anything else is refused.
 */
export function sniffIdentity(buf: Buffer): { kind: "image" | "video"; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: "video", mime: "video/webm" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    // HEIC photos share the box; only video brands get through.
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) return null;
    return { kind: "video", mime: brand.startsWith("qt") ? "video/quicktime" : "video/mp4" };
  }
  return null;
}

/** Stores one part, replacing the one before. */
export async function savePart(check: IdentityCheck, part: Part, file: Buffer): Promise<IdentityFile> {
  if (!asked(check).includes(part)) throw new HttpError(400, part === "back" ? "A passport doesn't need a back." : "That part isn't needed.", "bad_part");
  if (file.length === 0) throw new HttpError(400, "That file is empty.", "empty");
  const what = sniffIdentity(file);
  const wantVideo = part === "video";
  if (!what || (what.kind === "video") !== wantVideo) throw new HttpError(400, wantVideo ? "Send a video: WebM, MP4 or MOV." : "Send a photo: JPEG, PNG or WebP.", "bad_type");
  if (file.length > (wantVideo ? MAX_VIDEO : MAX_IMAGE)) throw new HttpError(413, wantVideo ? "That video is too large. Keep it to a few seconds." : "That photo is too large.", "too_large");
  const sha256 = createHash("sha256").update(file).digest("hex");
  return prisma.$transaction(async (tx) => {
    await tx.identityFile.updateMany({ where: { checkId: check.id, part, replacedAt: null }, data: { replacedAt: new Date() } });
    return tx.identityFile.create({ data: { checkId: check.id, part, mime: what.mime, size: file.length, sha256, data: new Uint8Array(seal(file)) } });
  });
}

/** Sends the check to our team: every part asked for has to be in. Spends the handoff code. */
export async function submit(check: IdentityCheck): Promise<IdentityCheck> {
  if (!check.idType) throw new HttpError(400, "Choose which ID you're using first.", "no_id_type");
  const { missing } = await progress(check);
  if (missing.length) throw new HttpError(400, `Still missing: ${missing.join(", ")}.`, "incomplete");
  const sent = await prisma.identityCheck.updateMany({
    where: { id: check.id, status: "PENDING" },
    data: { status: "IN_REVIEW", providerStatus: "Sent", submittedAt: new Date(), redo: Prisma.DbNull, handoffHash: null, handoffExpiresAt: null },
  });
  if (!sent.count) throw new HttpError(409, "This check has already been sent.", "already_sent");
  log.info("[identity] manual check sent", { check: check.id, business: check.businessId });
  return prisma.identityCheck.findUniqueOrThrow({ where: { id: check.id } });
}

export type Decision = { decision: "approve" | "redo" | "decline"; parts?: Part[]; note?: string | null; firstName?: string; lastName?: string; documentNumber?: string };

/**
 * Our team's decision on a check that was sent. A redo keeps every part that
 * was fine and asks for the named ones again; the person hears by email.
 */
export async function decide(checkId: string, d: Decision, by: string): Promise<IdentityCheck> {
  const check = await prisma.identityCheck.findUnique({ where: { id: checkId } });
  if (!check || check.provider !== "manual") throw new HttpError(404, "No manual identity check with that id.", "not_found");
  if (check.status !== "IN_REVIEW") throw new HttpError(409, "Only a check that was sent and is waiting can be decided.", "not_waiting");
  const note = d.note?.trim() || null;
  const now = new Date();
  let updated: IdentityCheck;
  if (d.decision === "redo") {
    const needs = partsFor(check.idType);
    const parts = [...new Set(d.parts ?? [])].filter((p) => needs.includes(p));
    if (!parts.length) throw new HttpError(400, "Pick at least one part to take again.", "no_parts");
    updated = await prisma.$transaction(async (tx) => {
      await tx.identityFile.updateMany({ where: { checkId, part: { in: parts }, replacedAt: null }, data: { replacedAt: now } });
      return tx.identityCheck.update({ where: { id: checkId }, data: { status: "PENDING", providerStatus: "Redo asked", redo: parts, reviewNote: note, reviewedBy: by, reviewedAt: now } });
    });
  } else if (d.decision === "approve") {
    // The name as it reads on the ID, typed by our team: it goes on the check and becomes the person's name.
    const firstName = d.firstName?.trim() ?? "";
    const lastName = d.lastName?.trim() ?? "";
    if (firstName.length < 1 || lastName.length < 1) throw new HttpError(400, "Enter the first and last name as they are on the ID.", "name_required");
    // The NIN, passport or licence number as read off the ID. Only its last four are kept, as with the partner's checks.
    const docNo = (d.documentNumber ?? "").replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z0-9]{6,20}$/.test(docNo)) throw new HttpError(400, "Enter the ID number as it is on the ID: letters and digits, 6 to 20 of them.", "document_required");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: check.userId } });
    const renamed = user.firstName !== firstName || user.lastName !== lastName;
    updated = await prisma.$transaction(async (tx) => {
      if (renamed) await tx.user.update({ where: { id: user.id }, data: { firstName, lastName } });
      return tx.identityCheck.update({
        where: { id: checkId },
        data: { status: "APPROVED", providerStatus: "Approved", reviewNote: note, reviewedBy: by, reviewedAt: now, checkedAt: now, firstName, lastName, documentLast4: docNo.slice(-4) },
      });
    });
    // A "Just me" business is paid into accounts in this person's name: a new name means checking them again.
    if (renamed) {
      const owned = await prisma.member.findMany({ where: { userId: user.id, role: "OWNER", business: { kind: "INDIVIDUAL" } }, select: { businessId: true } });
      for (const m of owned) await recheckBanks(m.businessId).catch((e) => log.warn("[identity] couldn't recheck banks", { businessId: m.businessId, reason: String((e as Error)?.message ?? e) }));
    }
  } else {
    if ((note ?? "").length < 3) throw new HttpError(400, "Say why. The person sees this note.", "note_required");
    updated = await prisma.identityCheck.update({ where: { id: checkId }, data: { status: "DECLINED", providerStatus: "Declined", reviewNote: note, reviewedBy: by, reviewedAt: now, checkedAt: now } });
  }
  void tell(updated).catch((e) => log.warn("[identity] couldn't email the outcome", { check: checkId, reason: String((e as Error)?.message ?? e) }));
  return updated;
}

async function tell(check: IdentityCheck) {
  const [user, business] = await Promise.all([prisma.user.findUnique({ where: { id: check.userId } }), prisma.business.findUnique({ where: { id: check.businessId } })]);
  if (!user || !business) return;
  const kind = check.status === "APPROVED" ? "approved" : check.status === "DECLINED" ? "declined" : "redo";
  const m = identityEmail(kind, { businessName: business.name, note: check.reviewNote, parts: Array.isArray(check.redo) ? (check.redo as string[]) : [] });
  await sendEmail(user.email, m.subject, m.text, { html: m.html });
}

