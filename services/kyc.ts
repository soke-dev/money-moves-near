import { api, getServerUrl, getAccessToken } from "./api";
import { Platform } from "react-native";

export interface KycVerification {
  id: string;
  documentType: string;
  status: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  firstName?: string;
  lastName?: string;
  middleName?: string;
  gender?: string;
  dateOfBirth?: string;
  photoUrl?: string;
  failureReason?: string;
  createdAt?: string;
}

export interface KycStatusResponse {
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  provider?: string;
  verification?: KycVerification | null;
}

export interface SubmitNinResponse {
  status: string;
  message: string;
  verification: {
    id: string;
    firstName: string;
    lastName: string;
    documentType: string;
    status: string;
  };
}

export async function getKycStatus(): Promise<KycStatusResponse> {
  const { data } = await api.get("/kyc/status");
  return data;
}

// ─── Didit hosted identity verification ─────────────────────
// The API key lives only on the backend; the app just receives a hosted URL.

export type DiditStatus =
  | "Not Started" | "In Progress" | "Awaiting User" | "In Review"
  | "Approved" | "Declined" | "Resubmitted" | "Expired" | "Kyc Expired" | "Abandoned";

export interface DiditSessionResponse {
  sessionId: string;
  url: string;
  status: DiditStatus;
}

export interface DiditStatusResponse {
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  diditStatus: DiditStatus | null;
  sessionId: string | null;
  /**
   * Why a REJECTED check failed. "DUPLICATE_IDENTITY" means the ID is already
   * tied to another account — final, so the UI must not invite a retry.
   */
  failureReason: string | null;
  /** Present when the newest check is one taken on our own page. */
  manual?: ManualKyc;
}

/**
 * Checks taken on our own page: photos of the ID, a selfie and a smile video,
 * sent from a browser opened inside the app.
 */
export type ManualPart = "front" | "back" | "selfie" | "video";
export interface ManualKyc {
  /** How a new check is done right now. */
  method: "auto" | "manual";
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  idTypes?: ("nin" | "passport" | "licence")[];
  check: {
    status: "PENDING" | "VERIFIED" | "REJECTED";
    idType: string | null;
    submittedAt: string | null;
    /** Parts asked for again. */
    redo: ManualPart[];
    note: string | null;
    have: ManualPart[];
    need: ManualPart[];
  } | null;
}

export async function getManualKyc(): Promise<ManualKyc> {
  const { data } = await api.get("/kyc/manual");
  return data;
}

/** A fresh link to the page the check is taken on. */
export async function startManualKyc(): Promise<{ url: string; expiresAt: string }> {
  const { data } = await api.post("/kyc/manual/handoff");
  return data;
}

/** Start (or resume) a hosted Didit verification and get the URL to open. */
export async function startDiditVerification(): Promise<DiditSessionResponse> {
  const { data } = await api.post("/kyc/didit/session");
  return data;
}

/** Ask the backend to re-check Didit and mirror the latest result. */
export async function getDiditStatus(): Promise<DiditStatusResponse> {
  const { data } = await api.get("/kyc/didit/status");
  return data;
}

// Append an image picked from camera/gallery to a FormData, handling the
// web (blob) vs native ({ uri, name, type }) differences.
async function appendImage(form: FormData, field: string, uri: string) {
  if (Platform.OS === "web") {
    const resp = await fetch(uri);
    let blob = await resp.blob();
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(blob.type)) blob = new Blob([blob], { type: "image/jpeg" });
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    form.append(field, blob, `${field}.${ext}`);
  } else {
    const ext = (uri.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    form.append(field, { uri, name: `${field}.${ext}`, type: mime } as any);
  }
}

export async function submitNin(payload: {
  nin: string;
  firstName: string;
  lastName: string;
  frontUri: string;
  backUri: string;
}): Promise<SubmitNinResponse> {
  const form = new FormData();
  form.append("nin", payload.nin);
  form.append("firstName", payload.firstName);
  form.append("lastName", payload.lastName);
  await appendImage(form, "front", payload.frontUri);
  await appendImage(form, "back", payload.backUri);

  if (Platform.OS === "web") {
    // Bypass axios so it can't override the multipart boundary.
    const token = await getAccessToken();
    const res = await fetch(`${getServerUrl()}/api/kyc/submit`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) throw new Error(data?.error || `Submission failed (${res.status})`);
    return data;
  }

  const { data } = await api.post("/kyc/submit", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}
