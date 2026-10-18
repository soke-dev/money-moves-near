/**
 * didit.ts — identity verification (KYC) via Didit's hosted flow.
 *
 * Flow:
 *   1. We create a session server-side (POST /v3/session/) and get back a hosted
 *      `url`. The API key is secret and never leaves the backend.
 *   2. The app opens that url; the user does ID + selfie on Didit's page.
 *   3. We learn the outcome either by polling the decision endpoint or via the
 *      webhook, and mirror it onto the user's kycStatus.
 *
 * Docs: https://docs.didit.me
 */
import { env } from "../config/env";

const BASE = env.DIDIT_BASE_URL.replace(/\/$/, "");

export const isDiditConfigured = !!(env.DIDIT_API_KEY && env.DIDIT_WORKFLOW_ID);

/** Session lifecycle values Didit can return. */
export type DiditStatus =
  | "Not Started"
  | "In Progress"
  | "Awaiting User"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Resubmitted"
  | "Expired"
  | "Kyc Expired"
  | "Abandoned";

async function didit<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!env.DIDIT_API_KEY) throw new Error("Didit is not configured (DIDIT_API_KEY missing)");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": env.DIDIT_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`Didit ${res.status}: ${String(detail).slice(0, 400)}`);
  }
  return body as T;
}

export interface DiditSession {
  session_id: string;
  url: string;
  status: DiditStatus;
  session_token?: string;
}

/**
 * Create a hosted verification session for a user.
 *
 * `vendorData` is our stable user id — Didit dedupes on it, so asking again for
 * the same user returns the SAME session rather than creating a new one.
 *
 * `email` is passed as contact_details purely so sessions are identifiable in
 * the Didit dashboard (otherwise they show only an opaque cuid, which makes
 * support and reconciliation painful). Didit's own notification emails are left
 * OFF — we send our own in-app notification when the decision lands, and two
 * sets of mail about one event would be confusing.
 */
export async function createDiditSession(
  vendorData: string,
  email?: string | null
): Promise<DiditSession> {
  return didit<DiditSession>("/v3/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: env.DIDIT_WORKFLOW_ID,
      vendor_data: vendorData,
      callback: env.DIDIT_CALLBACK_URL,
      ...(email
        ? { contact_details: { email, send_notification_emails: false } }
        : {}),
    }),
  });
}

/** Full decision payload for a session (status + per-feature results). */
export async function getDiditDecision(sessionId: string): Promise<any> {
  return didit<any>(`/v3/session/${encodeURIComponent(sessionId)}/decision/`);
}

/**
 * The status that should count, preferring a manual override from the Didit
 * dashboard over the automated verdict.
 *
 * A reviewer flipping a session Approved/Declined by hand records it in
 * `status_override` (null on an untouched session). Didit is expected to update
 * the top-level `status` too, but reading only that would silently ignore the
 * override if it ever does not — so the override wins when present, and the
 * shape is probed loosely because it is documented only by example.
 */
export function effectiveDiditStatus(decision: any): string | undefined {
  const o = decision?.status_override;
  const overridden =
    typeof o === "string" ? o : o?.new_status ?? o?.status ?? o?.overridden_status;
  return (overridden as string | undefined) || decision?.status;
}

/** Map Didit's session status onto our KycStatus enum. */
export function mapDiditStatus(status?: string): "NONE" | "PENDING" | "VERIFIED" | "REJECTED" {
  switch (status) {
    case "Approved":
      return "VERIFIED";
    case "Declined":
    case "Expired":
    case "Kyc Expired":
      return "REJECTED";
    case "Not Started":
      return "NONE";
    // In Progress / Awaiting User / In Review / Resubmitted / Abandoned
    default:
      return "PENDING";
  }
}

/** Pull the applicant's extracted details out of a decision payload, best-effort. */
/** "OKOTETE COLLINS" as a barcode prints it, in the case a person reads. */
function titleCase(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * What the document actually said, from whichever part of the session read it.
 *
 * Didit's OCR fields are the first choice and are frequently empty: a real
 * approved session on this platform came back with first_name, last_name,
 * full_name, date_of_birth, document_number and personal_number ALL null, and
 * warnings from feature_ocr saying it could not detect them. Approving a
 * session by hand in their console does not re-run the read, so those nulls are
 * permanent for that session.
 *
 * The barcode is the second choice, and on that same session it held the lot -
 * "Full Name", "Date of Birth", "Document Number" - because a Nigerian licence
 * or ID carries a PDF417 that parses even when the printed face does not.
 *
 * Where only a full name survives it goes in firstName whole, and lastName is
 * left empty. Splitting it would mean guessing which end is the surname, and
 * Nigerian documents print both orders - the same guess that already put one
 * account's name in backwards.
 */
export function extractDiditDetails(decision: any): {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  documentNumber?: string;
} {
  /**
   * The same list, for the same reason.
   *
   * Where a session holds two documents and the first was the one the OCR
   * struggled with, the second usually has the fields - so each is tried in
   * turn and the first answer wins per field, rather than the first document
   * winning outright.
   */
  const all: any[] = Array.isArray(decision?.id_verifications)
    ? decision.id_verifications.filter(Boolean)
    : [];

  const pick = (read: (d: any, barcode: any) => string | undefined): string | undefined => {
    for (const idv of all) {
      const d = idv?.document || idv?.extracted_data || idv || {};
      const barcode =
        (Array.isArray(idv?.barcodes) ? idv.barcodes.find((b: any) => b?.data) : null)?.data ?? {};
      const got = read(d, barcode);
      if (got) return got;
    }
    return undefined;
  };

  const first = pick((d) => str(d.first_name) ?? str(d.given_names));
  const last = pick((d) => str(d.last_name) ?? str(d.surname));
  const whole = pick((d, barcode) => titleCase(d.full_name) ?? titleCase(barcode["Full Name"]));

  return {
    firstName: first ?? (last ? undefined : whole),
    lastName: last,
    dateOfBirth: pick((d, barcode) => str(d.date_of_birth) ?? str(barcode["Date of Birth"])),
    documentNumber: pick(
      (d, barcode) =>
        str(d.document_number) ?? str(d.personal_number) ?? str(barcode["Document Number"]),
    ),
  };
}

// ═══════════════════════════════════════════════════════════
// Duplicate-identity detection
// ═══════════════════════════════════════════════════════════
//
// Didit ALREADY runs a 1:N face search against every session we've had
// approved — it is bundled into the LIVENESS feature, so there is nothing to
// switch on. But the result never changes the top-level verdict: a session with
// a confirmed duplicate face still comes back `status: "Approved"`, and the hits
// are buried in `liveness_checks[].warnings` / `liveness_checks[].matches`.
// Reading only the top-level status (which is all mapDiditStatus does) silently
// throws that away — so we mine it here.

/** A 1:N face-search hit against a *different* account. */
export interface DuplicateMatch {
  sessionId?: string;
  vendorData?: string;
  similarity?: number;
  blocklisted: boolean;
  fullName?: string;
  documentNumber?: string;
}

function collectMatches(decision: any): any[] {
  const out: any[] = [];
  for (const check of decision?.liveness_checks ?? []) {
    for (const m of check?.matches ?? []) out.push(m);
  }
  // Standalone /v3/face-search/ responses nest under face_search instead.
  for (const m of decision?.face_search?.matches ?? []) out.push(m);
  return out;
}

/**
 * Find face-search hits belonging to someone other than `ownVendorData`.
 *
 * The vendor_data comparison is the crucial part: we set vendor_data to our own
 * userId, so a match carrying the SAME id is just this person re-submitting
 * after a failed attempt — blocking that would lock users out of their own
 * retries. Only a hit with a different vendor_data means a second account.
 */
export function findDuplicateMatches(
  decision: any,
  ownVendorData: string,
  minSimilarity = 80
): DuplicateMatch[] {
  const hits: DuplicateMatch[] = [];
  for (const m of collectMatches(decision)) {
    const vendor = m?.vendor_data ? String(m.vendor_data) : undefined;
    if (vendor && vendor === ownVendorData) continue; // same user retrying
    if (m?.is_allowlisted) continue;
    const similarity = typeof m?.similarity_percentage === "number" ? m.similarity_percentage : undefined;
    // A blocklisted face is always a hit, whatever the score.
    if (!m?.is_blocklisted && similarity !== undefined && similarity < minSimilarity) continue;
    hits.push({
      sessionId: m?.session_id,
      vendorData: vendor,
      similarity,
      blocklisted: !!m?.is_blocklisted,
      fullName: m?.user_details?.full_name,
      documentNumber: m?.user_details?.document_number,
    });
  }
  return hits;
}

/** True if Didit raised a duplicate-related risk anywhere in the decision. */
export function hasDuplicateWarning(decision: any): boolean {
  const buckets = [
    ...(decision?.liveness_checks ?? []),
    ...(decision?.id_verifications ?? []),
    ...(decision?.face_matches ?? []),
  ];
  for (const b of buckets) {
    for (const w of b?.warnings ?? []) {
      const risk = String(w?.risk ?? "");
      if (risk === "DUPLICATED_FACE" || risk === "POSSIBLE_DUPLICATED_USER") return true;
    }
  }
  return false;
}

/**
 * Build the set of identifiers this decision proves the person owns.
 *
 * Two kinds, because one person legitimately holds several:
 *  - `nin:` from personal_number — the national number printed on a Nigerian
 *    passport, NIN slip and driver's licence alike, so it is the key that
 *    survives someone switching document type on their second attempt.
 *  - `doc:` from issuing state + type + number, which covers documents that
 *    carry no national number.
 *
 * Both are claimed, and a collision on EITHER blocks the account.
 */
export function buildIdentityKeys(decision: any): { kind: string; key: string }[] {
  /**
   * Every document the session carried, not the first one.
   *
   * id_verifications is a list because a person can put more than one document
   * into a single session - and somebody who verifies with a passport and an
   * ID card has the NIN on the second one. Reading [0] threw it away: the
   * account came back approved, with the passport's number on file, and was
   * then told at funding that its ID carried no National Identity Number.
   * Nothing in the queue showed why, because the document holding the answer
   * was never read.
   */
  const all: any[] = Array.isArray(decision?.id_verifications)
    ? decision.id_verifications.filter(Boolean)
    : [];
  if (!all.length) return [];

  const keys: { kind: string; key: string }[] = [];
  for (const idv of all) keys.push(...keysFromOneDocument(idv));

  // One document's number can be another's personal number, so the same key
  // can come off two of them.
  const seen = new Set<string>();
  return keys.filter((k) => (seen.has(k.key) ? false : (seen.add(k.key), true)));
}

/**
 * Placeholders Didit's OCR writes into a field it could not read.
 *
 * Seen in the wild as the literal string "none" in personal_number on an
 * approved Nigerian passport. Length alone nearly caught that one - "NONE" is
 * four characters - but "NOT SPECIFIED" normalises to twelve and would have
 * sailed through as a national number.
 *
 * That is worse than it sounds. The first account to submit such a document
 * would own the key `nin:NOTSPECIFIED`, and every later person whose passport
 * said the same thing would collide with it and be refused as a duplicate
 * identity. A placeholder is the one value many unrelated people share.
 */
const PLACEHOLDER = new Set([
  "NONE", "NIL", "NA", "NULL", "UNKNOWN", "NOTSPECIFIED", "NOTAVAILABLE",
  "NOTAPPLICABLE", "NOTPROVIDED", "NOTFOUND", "UNDEFINED", "XXX", "XXXX",
]);

function keysFromOneDocument(idv: any): { kind: string; key: string }[] {
  const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const keys: { kind: string; key: string }[] = [];

  // Nigerian NIN is 11 digits; require a plausible length so an OCR scrap can
  // never become a key that blocks a real person. And a national number always
  // contains digits - which is what separates a short real one from a word the
  // scanner put there because it found nothing.
  const personal = norm(idv.personal_number);
  if (personal.length >= 8 && /\d/.test(personal) && !PLACEHOLDER.has(personal)) {
    keys.push({ kind: "national_number", key: `nin:${personal}` });
  }

  const number = norm(idv.document_number);
  const state = norm(idv.issuing_state) || "XXX";
  const type = norm(idv.document_type) || "DOC";

  if (number.length >= 5 && !PLACEHOLDER.has(number)) {
    keys.push({ kind: "document", key: `doc:${state}:${type}:${number}` });
  }

  // A Nigerian passport carries the NIN separately in personal_number, but on a
  // NIN slip or national ID card the NIN IS the document number. Without this,
  // the same person claims doc:NGA:IDENTITYCARD:<nin> on one account and
  // nin:<nin> on another and collides with neither - switching document type
  // would walk straight past the check.
  //
  // Scoped to an 11-digit number on an ID card so an unrelated document that
  // happens to carry 11 digits cannot mint a NIN key and lock out whoever
  // genuinely holds that number.
  //
  // "Nigerian OR unstated", not "Nigerian". Didit leaves issuing_state null far
  // more often than it fills it in - on a manually corrected session it stays
  // null even once a reviewer has typed the name and number in by hand - and
  // requiring NGA meant a real NIN produced no national_number claim at all.
  // The account then verified successfully and was told, at the moment it tried
  // to fund, that its ID carried no National Identity Number.
  //
  // Absent is not the same as foreign: a document that says GBR is still
  // excluded. This widens to the unknown case only, which in a Nigeria-only
  // product is overwhelmingly a Nigerian document.
  const plausibleState = state === "NGA" || state === "XXX";
  const looksLikeNin = plausibleState && /^\d{11}$/.test(number);
  const isIdCard = type.includes("IDENTITY") || type.includes("NATIONAL") || type === "ID";
  if (looksLikeNin && isIdCard) {
    const key = `nin:${number}`;
    if (!keys.some((k) => k.key === key)) keys.push({ kind: "national_number", key });
  }

  return keys;
}
