/**
 * Manual identity checks in the app: a photo of the ID (the back too for a
 * driver's licence), a selfie and a three second smile video, taken on a page
 * the app opens and decided by the team in the console.
 *
 * Which method new checks use, and which IDs they accept, is a console switch
 * (Personal > ID checks), stored with the other service settings. A check
 * already under way finishes the way it began.
 *
 * The app reaches the page with a link holding a one-time code. Only its hash
 * is stored, it lasts half an hour, and the code can only add photos to this
 * one check - never read anything back. Files are encrypted (lib/kyc-vault).
 *
 * Approval does what an automatic approval does: the account is verified and
 * takes the name on the ID, and the ID's numbers are claimed so no second
 * account can verify with them.
 *
 * Wording rule for anything the person sees: say that we check it, never how.
 */
import { createHash, randomBytes } from "crypto";
import { Prisma, type KycFile, type KycVerification } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { sealKycFile, kycVaultReady } from "./kyc-vault";
import { sendNotification } from "./push";

export class KycError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export const ID_TYPES = ["nin", "passport", "licence"] as const;
export type IdType = (typeof ID_TYPES)[number];
export const PARTS = ["front", "back", "selfie", "video"] as const;
export type Part = (typeof PARTS)[number];
export const isPart = (p: string): p is Part => (PARTS as readonly string[]).includes(p);

export const HANDOFF_MS = 30 * 60_000;
export const MAX_IMAGE = 12 * 1024 * 1024;
export const MAX_VIDEO = 25 * 1024 * 1024;

/** The back only for a driver's licence: a NIN and a passport's photo page are one side. */
export const partsFor = (idType: string | null | undefined): Part[] => (idType === "licence" ? ["front", "back", "selfie", "video"] : ["front", "selfie", "video"]);

// ─── The console switch ──────────────────────────────────────────────────

export type IdentitySettings = { manual: boolean; nin: boolean; passport: boolean; licence: boolean };
const SETTINGS_KEY = "identityMethod";
const DEFAULTS: IdentitySettings = { manual: false, nin: true, passport: true, licence: true };
let cached: { at: number; value: IdentitySettings } | null = null;

export async function identitySettings(): Promise<IdentitySettings> {
  if (cached && Date.now() - cached.at < 5_000) return cached.value;
  const row = await prisma.serviceStatus.findUnique({ where: { key: SETTINGS_KEY }, select: { value: true } }).catch(() => null);
  let value = DEFAULTS;
  try {
    const parsed = row?.value ? JSON.parse(row.value) : null;
    if (parsed && typeof parsed === "object") value = { ...DEFAULTS, ...parsed };
  } catch {
    /* a bad row reads as the defaults */
  }
  cached = { at: Date.now(), value };
  return value;
}

export async function identitySettingsMeta() {
  const row = await prisma.serviceStatus.findUnique({ where: { key: SETTINGS_KEY }, select: { updatedBy: true, updatedAt: true } }).catch(() => null);
  return { updatedBy: row?.updatedBy ?? null, updatedAt: row?.updatedAt ?? null };
}

export async function setIdentitySettings(s: IdentitySettings, by: string): Promise<IdentitySettings> {
  if (!s.nin && !s.passport && !s.licence) throw new KycError(400, "Accept at least one kind of ID.", "no_ids");
  const value = JSON.stringify({ manual: !!s.manual, nin: !!s.nin, passport: !!s.passport, licence: !!s.licence });
  await prisma.serviceStatus.upsert({ where: { key: SETTINGS_KEY }, create: { key: SETTINGS_KEY, value, updatedBy: by }, update: { value, updatedBy: by } });
  cached = null;
  return identitySettings();
}

export async function acceptedIds(): Promise<IdType[]> {
  const s = await identitySettings();
  return ID_TYPES.filter((t) => s[t]);
}

// ─── The person's check ──────────────────────────────────────────────────

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");

/** The parts still asked for: the redo list if one was asked, else every part the ID needs. */
export function asked(v: Pick<KycVerification, "documentType" | "redo">): Part[] {
  const redo = Array.isArray(v.redo) ? (v.redo as string[]).filter(isPart) : [];
  return redo.length ? redo : partsFor(v.documentType);
}

export const currentFiles = (verificationId: string): Promise<KycFile[]> =>
  prisma.kycFile.findMany({ where: { verificationId, replacedAt: null }, orderBy: { createdAt: "asc" } });

export async function progress(v: KycVerification) {
  const files = await currentFiles(v.id);
  const need = asked(v);
  const have = need.filter((p) => files.some((f) => f.part === p));
  return { need, have, missing: need.filter((p) => !have.includes(p)), files };
}

/** The newest manual check, if the newest check of any kind is one. */
export async function latestManual(userId: string): Promise<KycVerification | null> {
  const latest = await prisma.kycVerification.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return latest?.provider === "manual" ? latest : null;
}

/** What the app shows about a manual check. */
export async function manualView(userId: string) {
  const [settings, v, user, idTypes] = await Promise.all([identitySettings(), latestManual(userId), prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } }), acceptedIds()]);
  const p = v ? await progress(v) : null;
  return {
    method: settings.manual ? ("manual" as const) : ("auto" as const),
    /** The IDs a new check takes, in the order they are offered. */
    idTypes,
    kycStatus: user?.kycStatus ?? "NONE",
    check: v && {
      status: v.status,
      idType: v.documentType || null,
      submittedAt: v.submittedAt,
      redo: Array.isArray(v.redo) ? (v.redo as string[]) : [],
      note: v.status === "PENDING" || v.status === "REJECTED" ? v.reviewNote : null,
      have: p?.have ?? [],
      need: p?.need ?? [],
    },
  };
}

/**
 * A fresh link for the person's manual check: the one being taken (or redone)
 * if there is one, else a new check. Refused once verified, or while a sent
 * check waits for its decision.
 */
export async function startHandoff(userId: string): Promise<{ url: string; expiresAt: Date }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (user?.kycStatus === "VERIFIED") throw new KycError(409, "You're already verified.", "already_verified");
  if (!kycVaultReady()) throw new KycError(503, "Identity checks are paused for a moment. Try again a little later.", "kyc_unavailable");
  const latest = await latestManual(userId);
  if (latest && latest.status === "PENDING" && latest.submittedAt && !(Array.isArray(latest.redo) && latest.redo.length)) {
    throw new KycError(409, "Your details are being checked. We'll let you know when it's done.", "in_review");
  }
  // One being taken, or being redone, carries on. Anything else starts afresh.
  const carryOn = latest && latest.status === "PENDING" && (!latest.submittedAt || (Array.isArray(latest.redo) && latest.redo.length)) ? latest : null;
  if (!carryOn && !(await identitySettings()).manual) throw new KycError(409, "Start the check from the verification screen.", "not_manual");
  const code = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_MS);
  const handoff = { handoffHash: hashOf(code), handoffExpiresAt: expiresAt, handoffOpenedAt: null };
  if (carryOn) await prisma.kycVerification.update({ where: { id: carryOn.id }, data: handoff });
  else await prisma.kycVerification.create({ data: { userId, provider: "manual", documentType: "", documentNumber: "", status: "PENDING", ...handoff } });
  return { url: `${env.KYC_PAGE_URL.replace(/\/$/, "")}/${code}`, expiresAt };
}

/** The check a link's code opens, if it is still good. */
export async function byCode(code: string): Promise<KycVerification> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) throw new KycError(404, "This link isn't right. Start the check again in the app.", "bad_link");
  const v = await prisma.kycVerification.findUnique({ where: { handoffHash: hashOf(code) } });
  if (!v) throw new KycError(404, "This link has already been used or replaced. Start the check again in the app.", "bad_link");
  if (!v.handoffExpiresAt || v.handoffExpiresAt.getTime() < Date.now()) throw new KycError(410, "This link has expired. Start the check again in the app.", "link_expired");
  if (v.status !== "PENDING") throw new KycError(409, "This check has already been sent.", "already_sent");
  return v;
}

/** What a file really is, from its first bytes: a photo (JPEG, PNG, WebP) or a video (WebM, MP4, MOV). */
export function sniffKycFile(buf: Buffer): { kind: "image" | "video"; mime: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: "image", mime: "image/jpeg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: "image", mime: "image/png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "image", mime: "image/webp" };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: "video", mime: "video/webm" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(brand)) return null;
    return { kind: "video", mime: brand.startsWith("qt") ? "video/quicktime" : "video/mp4" };
  }
  return null;
}

export async function setIdType(v: KycVerification, idType: IdType): Promise<KycVerification> {
  if (Array.isArray(v.redo) && v.redo.length) throw new KycError(409, "Keep the same ID for the parts being taken again.", "redo_keeps_id");
  if (!(await acceptedIds()).includes(idType)) throw new KycError(400, "That ID isn't accepted right now. Choose one of the others.", "id_not_accepted");
  if (v.documentType && v.documentType !== idType) {
    await prisma.kycFile.updateMany({ where: { verificationId: v.id, part: { in: ["front", "back"] }, replacedAt: null }, data: { replacedAt: new Date() } });
  }
  return prisma.kycVerification.update({ where: { id: v.id }, data: { documentType: idType } });
}

export async function savePart(v: KycVerification, part: Part, file: Buffer): Promise<void> {
  if (!v.documentType) throw new KycError(400, "Choose which ID you're using first.", "no_id_type");
  if (!asked(v).includes(part)) throw new KycError(400, part === "back" ? "Only a driver's licence needs the back." : "That part isn't needed.", "bad_part");
  if (!kycVaultReady()) throw new KycError(503, "Identity checks are paused for a moment. Try again a little later.", "kyc_unavailable");
  if (file.length === 0) throw new KycError(400, "That file is empty.", "empty");
  const what = sniffKycFile(file);
  const wantVideo = part === "video";
  if (!what || (what.kind === "video") !== wantVideo) throw new KycError(400, wantVideo ? "Send a video: WebM, MP4 or MOV." : "Send a photo: JPEG, PNG or WebP.", "bad_type");
  if (file.length > (wantVideo ? MAX_VIDEO : MAX_IMAGE)) throw new KycError(413, wantVideo ? "That video is too large. Keep it to a few seconds." : "That photo is too large.", "too_large");
  const sha256 = createHash("sha256").update(file).digest("hex");
  await prisma.$transaction(async (tx) => {
    await tx.kycFile.updateMany({ where: { verificationId: v.id, part, replacedAt: null }, data: { replacedAt: new Date() } });
    await tx.kycFile.create({ data: { verificationId: v.id, part, mime: what.mime, size: file.length, sha256, data: new Uint8Array(sealKycFile(file)) } });
  });
}

/** Sends the check for a decision: every part asked for has to be in. Spends the link. */
export async function submit(v: KycVerification): Promise<void> {
  if (!v.documentType) throw new KycError(400, "Choose which ID you're using first.", "no_id_type");
  const { missing } = await progress(v);
  if (missing.length) throw new KycError(400, `Still missing: ${missing.join(", ")}.`, "incomplete");
  const sent = await prisma.kycVerification.updateMany({
    where: { id: v.id, status: "PENDING", handoffHash: v.handoffHash },
    data: { submittedAt: new Date(), redo: Prisma.DbNull, handoffHash: null, handoffExpiresAt: null, failureReason: null },
  });
  if (!sent.count) throw new KycError(409, "This check has already been sent.", "already_sent");
  // The account shows as being checked, and its limits stay where they are until it's decided.
  await prisma.user.updateMany({ where: { id: v.userId, kycStatus: { not: "VERIFIED" } }, data: { kycStatus: "PENDING", kycProvider: "manual" } });
  console.log(`[kyc] manual check sent ${v.id} for ${v.userId}`);
}

// ─── The team's decision ─────────────────────────────────────────────────

/** A sent check waiting for a decision: submitted, still pending, nothing asked again. */
export const waitingWhere: Prisma.KycVerificationWhereInput = { provider: "manual", status: "PENDING", submittedAt: { not: null }, redo: { equals: Prisma.DbNull } };

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const DOC_TYPE: Record<IdType, string> = { nin: "IDENTITYCARD", passport: "PASSPORT", licence: "DRIVERSLICENSE" };

/** The identity keys a manual approval proves, in the same shape as the automatic check's. */
function claimKeys(idType: IdType, docNo: string, nin: string | null): { kind: string; key: string }[] {
  const keys: { kind: string; key: string }[] = [];
  if (idType === "nin") keys.push({ kind: "national_number", key: `nin:${docNo}` });
  else keys.push({ kind: "document", key: `doc:NGA:${DOC_TYPE[idType]}:${docNo}` });
  if (nin && idType !== "nin") keys.push({ kind: "national_number", key: `nin:${nin}` });
  return keys;
}

export type Decision = { decision: "approve" | "redo" | "decline"; parts?: Part[]; note?: string | null; firstName?: string; lastName?: string; documentNumber?: string; nin?: string };

export async function decide(id: string, d: Decision, by: string): Promise<KycVerification> {
  const v = await prisma.kycVerification.findUnique({ where: { id } });
  if (!v || v.provider !== "manual") throw new KycError(404, "No manual identity check with that id.", "not_found");
  const waiting = v.status === "PENDING" && !!v.submittedAt && !(Array.isArray(v.redo) && v.redo.length);
  if (!waiting) throw new KycError(409, "Only a check that was sent and is waiting can be decided.", "not_waiting");
  const note = d.note?.trim() || null;
  const now = new Date();

  if (d.decision === "redo") {
    const parts = [...new Set(d.parts ?? [])].filter((p) => partsFor(v.documentType).includes(p));
    if (!parts.length) throw new KycError(400, "Pick at least one part to take again.", "no_parts");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.kycFile.updateMany({ where: { verificationId: id, part: { in: parts }, replacedAt: null }, data: { replacedAt: now } });
      return tx.kycVerification.update({ where: { id }, data: { redo: parts, reviewNote: note, reviewedBy: by, reviewedAt: now } });
    });
    sendNotification({ userId: v.userId, type: "security", title: "One more try", body: "We need part of your identity check again. Open Money Moves to redo it." }).catch(() => {});
    return updated;
  }

  if (d.decision === "decline") {
    if ((note ?? "").length < 3) throw new KycError(400, "Say why. The person sees this note.", "note_required");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: v.userId }, data: { kycStatus: "REJECTED", kycProvider: "manual" } });
      return tx.kycVerification.update({ where: { id }, data: { status: "REJECTED", failureReason: note, reviewNote: note, reviewedBy: by, reviewedAt: now } });
    });
    sendNotification({ userId: v.userId, type: "security", title: "Verification unsuccessful", body: "We couldn't verify your identity. Open Money Moves to try again." }).catch(() => {});
    return updated;
  }

  // Approve: the name and number as read off the ID.
  const firstName = d.firstName?.trim() ?? "";
  const lastName = d.lastName?.trim() ?? "";
  if (!firstName || !lastName) throw new KycError(400, "Enter the first and last name as they are on the ID.", "name_required");
  const idType = (ID_TYPES as readonly string[]).includes(v.documentType) ? (v.documentType as IdType) : "nin";
  const docNo = norm(d.documentNumber ?? "");
  if (!/^[A-Z0-9]{6,20}$/.test(docNo)) throw new KycError(400, "Enter the ID number as it is on the ID: letters and digits, 6 to 20 of them.", "document_required");
  if (idType === "nin" && !/^\d{11}$/.test(docNo)) throw new KycError(400, "A NIN is 11 digits.", "document_required");
  const nin = d.nin ? norm(d.nin) : null;
  if (nin && !/^\d{11}$/.test(nin)) throw new KycError(400, "A NIN is 11 digits.", "nin_invalid");

  // The same ID can verify one account only: refused if any of its numbers is already someone else's.
  const keys = claimKeys(idType, docNo, nin);
  const held = await prisma.identityClaim.findMany({ where: { key: { in: keys.map((k) => k.key) }, userId: { not: v.userId } }, select: { key: true, user: { select: { username: true } } } });
  if (held.length) throw new KycError(409, `This ID already verified another account${held[0]!.user?.username ? ` (@${held[0]!.user.username})` : ""}. Decline it instead.`, "duplicate_identity");

  const updated = await prisma.$transaction(async (tx) => {
    for (const k of keys) {
      const mine = await tx.identityClaim.findUnique({ where: { key: k.key } });
      if (!mine) await tx.identityClaim.create({ data: { userId: v.userId, key: k.key, kind: k.kind, sessionId: `manual:${v.id}` } });
    }
    await tx.user.update({ where: { id: v.userId }, data: { kycStatus: "VERIFIED", kycProvider: "manual", firstName, lastName } });
    return tx.kycVerification.update({
      where: { id },
      data: { status: "VERIFIED", firstName, lastName, documentNumber: docNo, failureReason: null, reviewNote: note, reviewedBy: by, reviewedAt: now },
    });
  });
  sendNotification({ userId: v.userId, type: "security", title: "Identity verified", body: "You're verified. Your full limits are now live." }).catch(() => {});
  return updated;
}
