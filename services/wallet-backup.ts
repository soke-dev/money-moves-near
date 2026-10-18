/**
 * wallet-backup.ts — Cloud backup via system share sheet.
 *
 * Encrypts the mnemonic with a user-chosen backup password (AES-256-GCM),
 * saves as a file, then opens the share sheet so the user can save to
 * Google Drive, iCloud, Dropbox, email, etc.
 *
 * Restore reads the file via document picker and decrypts.
 * Server never sees the mnemonic or backup file.
 */
import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";

// ─── Constants ──────────────────────────────────────────────
const BACKUP_FILENAME = "money-moves-wallet-backup.json";
const BACKUP_VERSION = 1;
const ITERATIONS = 100_000;

// ─── Types ──────────────────────────────────────────────────
interface BackupPayload {
  version: number;
  salt: string;     // hex
  iv: string;       // hex
  ciphertext: string; // hex
}

// ═══════════════════════════════════════════════════════════
//  ENCRYPTION HELPERS (AES-256 via expo-crypto + @noble/ciphers)
// ═══════════════════════════════════════════════════════════

/** Derive a 256-bit key from password + salt using PBKDF2 */
async function deriveKey(password: string, saltHex: string): Promise<Uint8Array> {
  const { pbkdf2 } = await import("@noble/hashes/pbkdf2.js");
  const { sha256 } = await import("@noble/hashes/sha2.js");
  const salt = hexToBytes(saltHex);
  return pbkdf2(sha256, password, salt, { c: ITERATIONS, dkLen: 32 });
}

/** Encrypt plaintext with password → { salt, iv, ciphertext } */
async function encrypt(plaintext: string, password: string): Promise<BackupPayload> {
  const { gcm } = await import("@noble/ciphers/aes.js");

  // Generate random salt and IV
  const saltHex = await Crypto.getRandomBytesAsync(16).then(bytesToHex);
  const ivHex = await Crypto.getRandomBytesAsync(12).then(bytesToHex);

  const key = await deriveKey(password, saltHex);
  const iv = hexToBytes(ivHex);

  const cipher = gcm(key, iv);
  const encrypted = cipher.encrypt(new TextEncoder().encode(plaintext));

  return {
    version: BACKUP_VERSION,
    salt: saltHex,
    iv: ivHex,
    ciphertext: bytesToHex(encrypted),
  };
}

/** Decrypt ciphertext with password */
async function decrypt(payload: BackupPayload, password: string): Promise<string> {
  const { gcm } = await import("@noble/ciphers/aes.js");

  const key = await deriveKey(password, payload.salt);
  const iv = hexToBytes(payload.iv);
  const ciphertext = hexToBytes(payload.ciphertext);

  const cipher = gcm(key, iv);
  const decrypted = cipher.decrypt(ciphertext);

  return new TextDecoder().decode(decrypted);
}

// ═══════════════════════════════════════════════════════════
//  BACKUP: Encrypt → File → Share Sheet
// ═══════════════════════════════════════════════════════════

/** Create encrypted backup file and open share sheet */
export async function createBackup(mnemonic: string, password: string): Promise<void> {
  // Encrypt
  const payload = await encrypt(mnemonic, password);
  const json = JSON.stringify(payload);

  // Web: trigger a browser download. User then uploads it to
  // Google Drive / Dropbox / iCloud themselves.
  if (Platform.OS === "web") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = BACKUP_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  // Native: write to cache then open the system share sheet.
  const file = new File(Paths.cache, BACKUP_FILENAME);
  file.write(json);

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error("Sharing is not available on this device");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "Save Wallet Backup",
    UTI: "public.json",
  });

  try {
    file.delete();
  } catch {}
}

// ═══════════════════════════════════════════════════════════
//  RESTORE: Document Picker → Decrypt → Mnemonic
// ═══════════════════════════════════════════════════════════

/** Pick backup file from cloud/device and decrypt */
export async function restoreFromBackup(password: string): Promise<string> {
  const result = await DocumentPicker.getDocumentAsync({
    type: "application/json",
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) {
    throw new Error("PICKER_CANCELLED");
  }

  const asset = result.assets[0];

  // Web: the asset carries the native browser File object — read it directly.
  // Native: read via expo-file-system from the cache uri.
  let json: string;
  if (Platform.OS === "web") {
    const webFile = (asset as any).file as globalThis.File | undefined;
    if (webFile) {
      json = await webFile.text();
    } else {
      const resp = await fetch(asset.uri);
      json = await resp.text();
    }
  } else {
    const pickedFile = new File(asset.uri);
    json = await pickedFile.text();
  }

  let payload: BackupPayload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error("INVALID_BACKUP_FILE");
  }

  // Validate structure
  if (!payload.version || !payload.salt || !payload.iv || !payload.ciphertext) {
    throw new Error("INVALID_BACKUP_FILE");
  }

  // Decrypt
  try {
    const mnemonic = await decrypt(payload, password);
    return mnemonic.trim();
  } catch {
    throw new Error("WRONG_PASSWORD");
  }
}

// ═══════════════════════════════════════════════════════════
//  HEX HELPERS
// ═══════════════════════════════════════════════════════════

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
