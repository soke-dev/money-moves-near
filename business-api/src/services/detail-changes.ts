/**
 * Changing a live business's name, phone or support contacts.
 *
 * These are what customers see on checkouts and receipts, and what we checked
 * when the business activated - so a change goes through us too. The owner
 * asks; it waits as pending, and nothing changes until our team approves it.
 * Then the new details go live and the owners are told. Turned down, they're
 * told why. One change waits at a time.
 */
import type { DetailChange, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/http";
import { sendEmail } from "../lib/email";
import { answersSchema, ownersOf } from "./application";

export const DETAIL_FIELDS = ["name", "phone", "supportEmail", "supportPhone"] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type Details = Record<DetailField, string>;

export const DETAIL_LABELS: Record<DetailField, string> = {
  name: "Business name",
  phone: "Business phone",
  supportEmail: "Support email",
  supportPhone: "Support phone",
};

const digits = (s: string) => s.replace(/\D/g, "");
/** A Nigerian number as the activation form keeps it: ten digits, no +234 or leading 0 - so "+234 801 234 5678", "08012345678" and "8012345678" are one number. */
const nationalPhone = (s: string) => {
  const d = digits(s);
  if (d.length === 13 && d.startsWith("234")) return d.slice(3);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  return d;
};

export const changeInput = z
  .object({
    name: z.string().trim().min(2, "Give the business a name of at least 2 characters.").max(160).optional(),
    phone: z.string().trim().max(30).refine((v) => digits(v).length >= 10, "A business phone number needs all its digits.").optional(),
    supportEmail: z.string().trim().toLowerCase().max(254).email("That support email doesn't look right.").optional(),
    supportPhone: z.string().trim().max(30).refine((v) => digits(v).length >= 10, "A support phone number needs all its digits.").optional(),
  })
  .strip();

/** What the business shows now. */
export async function currentDetails(businessId: string): Promise<Details> {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, include: { application: true } });
  const a = b.application ? answersSchema.parse(b.application.answers ?? {}) : null;
  return { name: b.name, phone: a?.phone ?? "", supportEmail: a?.supportEmail ?? "", supportPhone: a?.supportPhone ?? "" };
}

export const changeShape = (c: DetailChange) => ({
  id: c.id,
  status: c.status,
  changes: c.changes as Partial<Details>,
  before: c.before as Partial<Details>,
  note: c.note,
  createdAt: c.createdAt,
  decidedAt: c.decidedAt,
});

/** The owner asks. Only what actually differs is kept; nothing goes live yet. */
export async function requestChange(businessId: string, userId: string, input: z.infer<typeof changeInput>): Promise<DetailChange> {
  const app = await prisma.application.findUnique({ where: { businessId }, select: { status: true } });
  if (!app || app.status === "DRAFT") throw new HttpError(409, "Change these in your activation form. It isn't submitted yet.", "not_submitted");
  if (await prisma.detailChange.count({ where: { businessId, status: "PENDING" } })) {
    throw new HttpError(409, "A change is already waiting for us to check. Cancel it first to ask for a different one.", "change_pending");
  }
  const now = await currentDetails(businessId);
  const changes: Partial<Details> = {};
  const before: Partial<Details> = {};
  for (const k of DETAIL_FIELDS) {
    const raw = input[k];
    if (raw === undefined) continue;
    const isPhone = k === "phone" || k === "supportPhone";
    const v = isPhone ? nationalPhone(raw) : raw.trim();
    const same = isPhone ? v === nationalPhone(now[k]) : v === now[k].trim();
    if (same) continue;
    changes[k] = v;
    before[k] = now[k];
  }
  if (!Object.keys(changes).length) throw new HttpError(400, "That's the same as what you have now.", "no_change");
  return prisma.detailChange.create({ data: { businessId, requestedBy: userId, changes, before } });
}

export async function cancelChange(businessId: string, id: string): Promise<void> {
  const done = await prisma.detailChange.updateMany({ where: { id, businessId, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
  if (!done.count) throw new HttpError(404, "That change isn't waiting any more.", "not_pending");
}

const list = (changes: Partial<Details>) =>
  DETAIL_FIELDS.filter((k) => changes[k] !== undefined)
    .map((k) => `${DETAIL_LABELS[k]}: ${changes[k]}`)
    .join("\n");

/** Approved: the new details go live, everywhere they're read from. */
export async function approveChange(id: string, adminEmail: string): Promise<DetailChange> {
  const c = await prisma.detailChange.findUnique({ where: { id }, include: { business: { include: { application: true } } } });
  if (!c || c.status !== "PENDING") throw new HttpError(404, "That change isn't waiting any more.", "not_pending");
  const changes = c.changes as Partial<Details>;
  const answers = { ...((c.business.application?.answers as Prisma.JsonObject | null) ?? {}) };
  for (const k of ["phone", "supportEmail", "supportPhone"] as const) if (changes[k] !== undefined) answers[k] = changes[k]!;
  const [done] = await prisma.$transaction([
    prisma.detailChange.update({ where: { id }, data: { status: "APPROVED", decidedAt: new Date(), decidedBy: adminEmail } }),
    ...(changes.name ? [prisma.business.update({ where: { id: c.businessId }, data: { name: changes.name } })] : []),
    ...(c.business.application ? [prisma.application.update({ where: { businessId: c.businessId }, data: { answers } })] : []),
  ]);
  const name = changes.name ?? c.business.name;
  for (const to of await ownersOf(c.businessId)) {
    void sendEmail(to, `Your details for ${name} are updated`, `We checked the change you asked for and it's now live:\n\n${list(changes)}\n\nCustomers see the new details on your checkouts and receipts from now on.`).catch(() => {});
  }
  return done;
}

export async function declineChange(id: string, adminEmail: string, note: string): Promise<DetailChange> {
  const c = await prisma.detailChange.findUnique({ where: { id }, include: { business: { select: { name: true } } } });
  if (!c || c.status !== "PENDING") throw new HttpError(404, "That change isn't waiting any more.", "not_pending");
  const done = await prisma.detailChange.update({ where: { id }, data: { status: "DECLINED", note, decidedAt: new Date(), decidedBy: adminEmail } });
  for (const to of await ownersOf(c.businessId)) {
    void sendEmail(to, `We couldn't make the change to ${c.business.name}`, `We looked at the change you asked for:\n\n${list(c.changes as Partial<Details>)}\n\nWe couldn't make it: ${note}\n\nYour details are as they were. You can ask again from Settings once that's sorted.`).catch(() => {});
  }
  return done;
}
