import { Platform } from "react-native";
import { api, getAccessToken, getServerUrl } from "./api";

export interface ScanAccountResult {
  accountNumber: string | null;
  bankName: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Send a captured/picked image to the backend for OCR.
 * Returns the extracted 10-digit account number and bank name (if recognized).
 */
export async function scanAccountFromImage(uri: string): Promise<ScanAccountResult> {
  if (Platform.OS === "web") {
    // Convert the blob: URL the picker produces into a File the server can read.
    const resp = await fetch(uri);
    let blob = await resp.blob();
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(blob.type)) {
      blob = new Blob([blob], { type: "image/jpeg" });
    }
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";

    const form = new FormData();
    form.append("image", blob, `scan.${ext}`);

    const token = await getAccessToken();
    const res = await fetch(`${getServerUrl()}/api/ocr/scan-account`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      throw new Error(data?.error || `Scan failed (${res.status})`);
    }
    return data;
  }

  // Native: RN FormData accepts the { uri, name, type } shape.
  const form = new FormData();
  const ext = (uri.split(".").pop() || "jpg").toLowerCase();
  const mime =
    ext === "png" ? "image/png" :
    ext === "webp" ? "image/webp" :
    ext === "heic" || ext === "heif" ? "image/heic" :
    "image/jpeg";
  form.append("image", { uri, name: `scan.${ext}`, type: mime } as any);

  const res = await api.post("/ocr/scan-account", form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 45000,
  });
  return res.data;
}
