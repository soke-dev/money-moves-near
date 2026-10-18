/**
 * The account representative's identity check, by Didit: NIN and a selfie on
 * Didit's own hosted page.
 *
 *  1. We create a session with our API key (never sent to a browser) and get
 *     back Didit's page to open.
 *  2. The person does the check there; Didit sends them back to the dashboard.
 *  3. We read Didit's decision ourselves - when the dashboard asks, when
 *     Didit's webhook names the session, and every few minutes while one is
 *     waiting - and never believe a status anyone else hands us.
 *
 * Not configured (no DIDIT_API_KEY / DIDIT_WORKFLOW_ID): the check is
 * unavailable, said plainly. There is no stand-in - an identity check is never
 * simulated, anywhere.
 */
import { env } from "../config/env";
import { HttpError } from "./http";

export const diditReady = () => !!(env.DIDIT_API_KEY && env.DIDIT_WORKFLOW_ID);

async function didit<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!diditReady()) throw new HttpError(503, "Identity checks aren't switched on yet. We'll email you the moment they are.", "identity_unavailable");
  const res = await fetch(`${env.DIDIT_BASE_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { "x-api-key": env.DIDIT_API_KEY!, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`Didit ${res.status}: ${String(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 300)}`);
  return body as T;
}

export interface DiditSession {
  session_id: string;
  url: string;
  status: string;
}

/**
 * A session for one person on one business. Didit returns the same session
 * for the same vendor_data, so asking again resumes rather than starting over.
 * Didit's own emails stay off - ours say what happened.
 */
export function createSession(p: { businessId: string; userId: string; email: string; callback: string }) {
  return didit<DiditSession>("/v3/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: env.DIDIT_WORKFLOW_ID,
      vendor_data: `mmb:${p.businessId}:${p.userId}`,
      callback: p.callback,
      contact_details: { email: p.email, send_notification_emails: false },
    }),
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getDecision(sessionId: string) {
  return didit<any>(`/v3/session/${encodeURIComponent(sessionId)}/decision/`);
}

/** The status that counts: a reviewer's override in Didit's console wins over the automatic verdict. */
export function effectiveStatus(decision: any): string {
  const o = decision?.status_override;
  const overridden = typeof o === "string" ? o : (o?.new_status ?? o?.status ?? o?.overridden_status);
  return String(overridden || decision?.status || "Not Started");
}

export function toIdentityStatus(s: string): "PENDING" | "IN_REVIEW" | "APPROVED" | "DECLINED" {
  if (s === "Approved") return "APPROVED";
  if (s === "Declined" || s === "Expired" || s === "Kyc Expired") return "DECLINED";
  if (s === "In Review") return "IN_REVIEW";
  return "PENDING";
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const title = (v: unknown) => text(v)?.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());

/**
 * What the document said - from the OCR first, then the barcode, which often
 * reads when the printed face doesn't. A lone full name stays whole in the
 * first name rather than guessing which end is the surname.
 */
export function details(decision: any): { firstName?: string; lastName?: string; dateOfBirth?: string; documentNumber?: string } {
  const all: any[] = Array.isArray(decision?.id_verifications) ? decision.id_verifications.filter(Boolean) : [];
  const pick = (read: (d: any, barcode: any) => string | undefined) => {
    for (const idv of all) {
      const d = idv?.document || idv?.extracted_data || idv || {};
      const barcode = (Array.isArray(idv?.barcodes) ? idv.barcodes.find((b: any) => b?.data) : null)?.data ?? {};
      const got = read(d, barcode);
      if (got) return got;
    }
    return undefined;
  };
  const first = pick((d) => title(d.first_name) ?? title(d.given_names));
  const last = pick((d) => title(d.last_name) ?? title(d.surname));
  const whole = pick((d, b) => title(d.full_name) ?? title(b["Full Name"]));
  return {
    firstName: first ?? (last ? undefined : whole),
    lastName: last,
    dateOfBirth: pick((d, b) => text(d.date_of_birth) ?? text(b["Date of Birth"])),
    documentNumber: pick((d, b) => text(d.document_number) ?? text(d.personal_number) ?? text(b["Document Number"])),
  };
}

/** Didit's warnings worth a person's attention - a face found on another account, chiefly. */
export function warnings(decision: any): string[] {
  const out: string[] = [];
  for (const check of decision?.liveness_checks ?? []) {
    for (const w of check?.warnings ?? []) out.push(String(w?.short_description ?? w?.risk ?? w));
    if ((check?.matches ?? []).length) out.push(`${check.matches.length} similar face(s) on other sessions`);
  }
  for (const idv of decision?.id_verifications ?? []) for (const w of idv?.warnings ?? []) out.push(String(w?.short_description ?? w?.risk ?? w));
  return [...new Set(out)].slice(0, 20);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
