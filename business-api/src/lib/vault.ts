/**
 * The documents a business gives us, encrypted before they're stored - and
 * never lost.
 *
 * AES-256-GCM with a key from DOCS_KEY (32 random bytes, base64) that lives
 * only in the service's variables - a copy of the database alone opens
 * nothing. Each file gets its own random IV, and the tag means a file altered
 * in the database fails to open rather than opening wrong.
 *
 * Every file records which key locked it (the first 8 bytes of the key's
 * SHA-256 - safe to show, useless to an attacker), so changing the key can't
 * strand what's already stored: the old key goes in DOCS_KEYS_OLD and keeps
 * opening the files it locked, while new ones use the new key. Files stored
 * before keys were recorded open with whichever configured key fits.
 *
 * On start the service tries to open recent documents. If it can't - DOCS_KEY
 * changed with the old one not kept - new uploads stop (so nothing more gets
 * locked with a key that may be thrown away) and the admin console says why.
 *
 * Staging and production refuse to start without the key (config/env). In
 * development only, a key is derived from CODE_PEPPER so a local setup works
 * without one more variable.
 */
import crypto from "crypto";
import { env, isDev } from "../config/env";
import { log } from "./log";
import { prisma } from "./prisma";

type Key = { id: Buffer; key: Buffer };

/** "MMB2", then the key's id, IV, tag and ciphertext. Files without it are the first format: IV, tag, ciphertext. */
const V2 = Buffer.from("MMB2", "latin1");
const ID_LEN = 8;

const idOf = (key: Buffer) => crypto.createHash("sha256").update(key).digest().subarray(0, ID_LEN);

function parseKey(b64: string, name: string): Buffer {
  const k = Buffer.from(b64.trim(), "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64`);
  return k;
}

let ring: { current: Key; all: Key[] } | null = null;

function keys() {
  if (ring) return ring;
  let current: Buffer;
  if (env.DOCS_KEY) current = parseKey(env.DOCS_KEY, "DOCS_KEY");
  else if (isDev) current = Buffer.from(crypto.hkdfSync("sha256", env.CODE_PEPPER, "mmb-documents", "dev-only", 32));
  else throw new Error("DOCS_KEY is not set");
  const old = (env.DOCS_KEYS_OLD ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => parseKey(s, `DOCS_KEYS_OLD #${i + 1}`));
  const all = [current, ...old].map((key) => ({ id: idOf(key), key }));
  ring = { current: all[0]!, all };
  return ring;
}

/** The current key's id, as hex - for the admin console and the logs. */
export const keyId = () => keys().current.id.toString("hex");

export function seal(plain: Buffer): Buffer {
  const { current } = keys();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", current.key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([V2, current.id, iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, iv: Buffer, tag: Buffer, body: Buffer) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export class LockedDocument extends Error {
  constructor(public readonly keyId: string | null) {
    super(keyId ? `This document was locked with key ${keyId}, which isn't configured. Put that key back in DOCS_KEY or DOCS_KEYS_OLD.` : "None of the configured keys opens this document.");
  }
}

/** Opens a stored file with the key that locked it. Throws LockedDocument if that key isn't configured. */
export function open(sealed: Buffer): Buffer {
  const { all } = keys();
  if (sealed.length > V2.length + ID_LEN && sealed.subarray(0, V2.length).equals(V2)) {
    const id = sealed.subarray(V2.length, V2.length + ID_LEN);
    const k = all.find((x) => x.id.equals(id));
    if (!k) throw new LockedDocument(id.toString("hex"));
    const at = V2.length + ID_LEN;
    return decrypt(k.key, sealed.subarray(at, at + 12), sealed.subarray(at + 12, at + 28), sealed.subarray(at + 28));
  }
  // The first format: no key recorded - the tag tells us which key fits.
  for (const k of all) {
    try {
      return decrypt(k.key, sealed.subarray(0, 12), sealed.subarray(12, 28), sealed.subarray(28));
    } catch {
      /* not this key */
    }
  }
  throw new LockedDocument(null);
}

/** Which key a stored file was locked with, when it says. */
export function keyIdOf(sealed: Buffer): string | null {
  return sealed.length > V2.length + ID_LEN && sealed.subarray(0, V2.length).equals(V2) ? sealed.subarray(V2.length, V2.length + ID_LEN).toString("hex") : null;
}

// ─── Is everything stored still readable? ─────────────────────────────────

type VaultState = { state: "ok" | "locked" | "unchecked"; reason: string | null; checkedAt: Date | null };
let vault: VaultState = { state: "unchecked", reason: null, checkedAt: null };

export const vaultState = () => ({ ...vault, keyId: keyId(), oldKeys: keys().all.length - 1 });

/** Uploads wait while stored documents can't be opened: nothing more gets locked with a key that may be thrown away. */
export const uploadsOpen = () => vault.state !== "locked";

/** On start: try the newest documents. One that won't open means the key changed without the old one kept. */
export async function checkVault(sample = 5): Promise<VaultState> {
  try {
    const recent = await prisma.document.findMany({ orderBy: { createdAt: "desc" }, take: sample, select: { id: true, data: true } });
    for (const d of recent) {
      try {
        open(Buffer.from(d.data));
      } catch (e) {
        const why = e instanceof LockedDocument ? e.message : "A stored document didn't open.";
        vault = { state: "locked", reason: why, checkedAt: new Date() };
        log.error("[vault] stored documents can't be opened, uploads are paused until the key is put right", { documentId: d.id, keyId: keyId(), reason: why });
        return vault;
      }
    }
    vault = { state: "ok", reason: null, checkedAt: new Date() };
  } catch (e) {
    log.warn("[vault] couldn't check the stored documents", { reason: e instanceof Error ? e.message : String(e) });
  }
  return vault;
}

/** Opens every stored document and checks it against the fingerprint taken when it arrived. */
export async function checkEveryDocument() {
  const out = { total: 0, readable: 0, unreadable: [] as { id: string; businessId: string; kind: string; why: string }[], altered: [] as { id: string; businessId: string; kind: string }[], byKey: {} as Record<string, number> };
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.document.findMany({ orderBy: { id: "asc" }, take: 25, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, businessId: true, kind: true, sha256: true, data: true } });
    if (!batch.length) break;
    for (const d of batch) {
      out.total++;
      const sealed = Buffer.from(d.data);
      const kid = keyIdOf(sealed) ?? "first format";
      out.byKey[kid] = (out.byKey[kid] ?? 0) + 1;
      try {
        const file = open(sealed);
        if (crypto.createHash("sha256").update(file).digest("hex") === d.sha256) out.readable++;
        else out.altered.push({ id: d.id, businessId: d.businessId, kind: d.kind });
      } catch (e) {
        out.unreadable.push({ id: d.id, businessId: d.businessId, kind: d.kind, why: e instanceof Error ? e.message : String(e) });
      }
    }
    cursor = batch[batch.length - 1]!.id;
  }
  vault = out.unreadable.length ? { state: "locked", reason: `${out.unreadable.length} stored document(s) won't open with the configured keys.`, checkedAt: new Date() } : { state: "ok", reason: null, checkedAt: new Date() };
  return { ...out, keyId: keyId(), checkedAt: vault.checkedAt };
}

/** What a file really is, by its first bytes - never by its name or what the browser said. */
export function sniff(buf: Buffer): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}
