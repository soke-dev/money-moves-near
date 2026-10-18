/**
 * A business's application to go live: what it told us, the documents it
 * gave us, and the account representative's identity check - and whether all
 * of it is there.
 *
 * The dashboard saves the answers as the person types; nothing is checked
 * until they submit, and then everything is, here - the dashboard's own list
 * of what's missing is a convenience, never the rule.
 */
import type { IdentityCheck, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { recheckBanks } from "../lib/banks";
import { details, effectiveStatus, toIdentityStatus, warnings } from "../lib/didit";

const text = (max: number) => z.string().max(max).optional();

/** The answers, as the activation steps hold them. Unknown fields are dropped, sizes are capped. */
export const answersSchema = z
  .object({
    kind: z.enum(["individual", "registered"]).nullish(),
    structure: z.enum(["BN", "LTD", "PLC", "IT"]).nullish(),
    legalName: text(160),
    regDate: text(20),
    regNumber: text(30),
    tin: text(30),
    bizStreet: text(200),
    bizCity: text(80),
    bizState: text(40),
    category: text(80),
    phone: text(30),
    street: text(200),
    city: text(80),
    state: text(40),
    social: text(300),
    repDirector: z.boolean().optional(),
    repOwner: z.boolean().optional(),
    repShare: text(10),
    people: z
      .array(
        z
          .object({
            id: text(40),
            first: text(80),
            last: text(80),
            email: text(254),
            phone: text(30),
            dob: text(20),
            idCountry: text(2),
            idType: text(40),
            street: text(200),
            city: text(80),
            state: text(80),
            country: text(2),
            postal: text(20),
            director: z.boolean().optional(),
            owner: z.boolean().optional(),
            share: text(10),
          })
          .strip(),
      )
      .max(30)
      .optional(),
    website: text(300),
    description: text(6000),
    /** The business's social pages - each optional. */
    socials: z.object({ instagram: text(300), x: text(300), tiktok: text(300), facebook: text(300) }).strip().optional(),
    supportPhone: text(30),
    supportEmail: text(254),
    volume: text(40),
    /** A Money Moves account to be paid to as well - optional, linked in the app later. */
    wallet: z.object({ username: text(40) }).strip().optional(),
    attest: z.boolean().optional(),
    visited: z.array(z.string().max(20)).max(12).optional(),
  })
  .strip();

export type Answers = z.infer<typeof answersSchema>;

/** The filings each kind of registration needs. */
export const DOCS: Record<string, { kind: string; label: string }[]> = {
  BN: [
    { kind: "cert", label: "Certificate of registration" },
    { kind: "address", label: "Proof of business address" },
  ],
  LTD: [
    { kind: "cert", label: "Certificate of incorporation" },
    { kind: "memart", label: "Memorandum and articles of association" },
    { kind: "status", label: "Status report" },
    { kind: "address", label: "Proof of business address" },
  ],
  PLC: [
    { kind: "cert", label: "Certificate of incorporation" },
    { kind: "memart", label: "Memorandum and articles of association" },
    { kind: "status", label: "Status report" },
    { kind: "address", label: "Proof of business address" },
  ],
  IT: [
    { kind: "cert", label: "Certificate of registration" },
    { kind: "constitution", label: "Constitution" },
    { kind: "address", label: "Proof of business address" },
  ],
};
/** Every kind a file can be: the filings, and the person's own proof of address (optional). */
export const DOC_KINDS = new Set(["cert", "memart", "status", "constitution", "address", "proofOfAddress"]);

/** A director's or owner's ID photo: id-front:<their id> - and id-back:<their id> for a driver's licence. */
export const PERSON_DOC = /^id-(front|back):[a-z0-9]{1,40}$/i;
export const isDocKind = (kind: string) => DOC_KINDS.has(kind) || PERSON_DOC.test(kind);
/** A driver's licence has two sides worth seeing; every other ID, the front. */
export const needsBack = (idType?: string | null) => /licen[cs]e/i.test(idType ?? "");

export const EDITABLE = new Set(["DRAFT", "CHANGES_REQUESTED"]);

export type Gap = { step: string; label: string };

/** Where a business can be paid: its bank accounts, and its Money Moves accounts - linked, or waiting for their owner to approve. */
export type PayoutPlaces = { banks: number; linked: number; waiting: number };

export async function payoutPlaces(businessId: string): Promise<PayoutPlaces> {
  const [banks, links] = await Promise.all([
    prisma.bankAccount.count({ where: { businessId, removedAt: null } }),
    prisma.moneyMovesLink.findMany({ where: { businessId, status: { in: ["PENDING", "LINKED"] } }, select: { status: true } }),
  ]);
  return { banks, linked: links.filter((l) => l.status === "LINKED").length, waiting: links.filter((l) => l.status === "PENDING").length };
}

/** Everything still missing, step by step, in words a person would use. */
export function gaps(a: Answers, docs: { kind: string }[], identity: Pick<IdentityCheck, "status"> | null, places: PayoutPlaces): Gap[] {
  const out: Gap[] = [];
  const need = (step: string, ok: unknown, label: string) => {
    if (!ok) out.push({ step, label });
  };
  const has = (v?: string | null) => !!v && v.trim().length > 0;
  need("setup", a.kind, "Whether you are a registered business");
  if (a.kind === "registered") {
    need("business", a.structure, "Business structure");
    need("business", has(a.legalName), "Registered business name");
    need("business", has(a.regDate), "Date of registration");
    need("business", has(a.regNumber), "Registration number");
    need("business", has(a.bizStreet) && has(a.bizCity) && has(a.bizState), "Business address");
    need("business", has(a.category), "Industry");
    for (const doc of a.structure ? DOCS[a.structure]! : []) need("documents", docs.some((d) => d.kind === doc.kind), doc.label);
  }
  // Started is enough to submit: the team sees the result, and approving needs it approved. Declined has to be done again.
  need("you", identity && identity.status !== "DECLINED", "Identity check");
  need("you", (a.phone ?? "").replace(/\D/g, "").length >= 10, "Your phone number");
  need("you", has(a.street) && has(a.city) && has(a.state), "Your home address");
  if (a.kind === "registered") {
    const people = a.people ?? [];
    const companyish = a.structure === "LTD" || a.structure === "PLC";
    need("people", people.length > 0, "At least one person on your filing");
    for (const p of people) {
      // Everything we ask about each of them; a company's person is a director, an owner, or both.
      const share = Number(p.share);
      const complete =
        has(p.first) && has(p.last) && has(p.dob) && /\S+@\S+\.\S+/.test(p.email ?? "") && (p.phone ?? "").replace(/\D/g, "").length >= 7 &&
        has(p.idCountry) && has(p.idType) && has(p.street) && has(p.city) && has(p.state) && has(p.country) && has(p.postal) &&
        (!companyish || !!p.director || !!p.owner) && (!companyish || !p.owner || (share > 0 && share <= 100));
      const who = [p.first, p.last].filter(Boolean).join(" ") || "A person";
      need("people", complete, `${who}'s details`);
      const has2 = (side: "front" | "back") => !!p.id && docs.some((d) => d.kind === `id-${side}:${p.id}`);
      need("people", has2("front"), `${who}'s ID, a photo of the front`);
      if (needsBack(p.idType)) need("people", has2("back"), `${who}'s driver's licence, a photo of the back`);
    }
  }
  // A website and social pages are optional; the description isn't, and nor is one way to reach them.
  if (a.kind !== "registered") need("product", has(a.category), "What you sell");
  const description = (a.description ?? "").trim();
  need("product", description.length >= 100, "A description of at least 100 characters");
  need("product", (description ? description.split(/\s+/).length : 0) <= 500, "A description of 500 words or fewer");
  // A support email or a phone - either is enough, and one that is given has to be right.
  const supportEmailOk = /\S+@\S+\.\S+/.test(a.supportEmail ?? "");
  const supportPhoneOk = (a.supportPhone ?? "").replace(/\D/g, "").length >= 10;
  need("product", supportEmailOk || supportPhoneOk, "A support email or phone number");
  if ((a.supportEmail ?? "").trim()) need("product", supportEmailOk, "A support email that looks right");
  if ((a.supportPhone ?? "").trim()) need("product", supportPhoneOk, "A support phone number with all its digits");
  // Either is enough. A Money Moves account counts once its owner has approved it in the app.
  need("payout", places.banks > 0 || places.linked > 0, places.waiting ? "Approve the Money Moves request in the app, or add a bank account" : "A bank account or a Money Moves account");
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Records what Didit decided about one check. On approval, a person who never
 * gave us their name gets the one on their ID - and the bank accounts of their
 * "Just me" businesses, which must be in that name, are checked again.
 */
export async function applyDecision(check: IdentityCheck, decision: any): Promise<IdentityCheck> {
  const providerStatus = effectiveStatus(decision);
  const status = toIdentityStatus(providerStatus);
  const d = details(decision);
  const updated = await prisma.identityCheck.update({
    where: { id: check.id },
    data: {
      providerStatus,
      status,
      firstName: d.firstName ?? check.firstName,
      lastName: d.lastName ?? check.lastName,
      dateOfBirth: d.dateOfBirth ?? check.dateOfBirth,
      documentLast4: d.documentNumber ? d.documentNumber.slice(-4) : check.documentLast4,
      warnings: warnings(decision) as unknown as Prisma.InputJsonValue,
      checkedAt: new Date(),
    },
  });
  if (status === "APPROVED" && (d.firstName || d.lastName)) {
    const user = await prisma.user.findUnique({ where: { id: check.userId } });
    if (user && !user.firstName && !user.lastName) {
      await prisma.user.update({ where: { id: user.id }, data: { firstName: d.firstName ?? null, lastName: d.lastName ?? null } });
      const owned = await prisma.member.findMany({ where: { userId: user.id, role: "OWNER", business: { kind: "INDIVIDUAL" } }, select: { businessId: true } });
      for (const m of owned) await recheckBanks(m.businessId).catch((e) => log.warn("[identity] couldn't recheck banks", { businessId: m.businessId, reason: String(e?.message ?? e) }));
    }
  }
  return updated;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Who to tell about an application: the business's owners and admins. */
export async function ownersOf(businessId: string): Promise<string[]> {
  const ms = await prisma.member.findMany({ where: { businessId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true } });
  return ms.map((m) => m.user.email);
}
