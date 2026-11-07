/**
 * wallet-core.ts — Fully client-side BIP-39 wallet.
 *
 * Generates a 12-word mnemonic, derives per-chain addresses,
 * stores encrypted in SecureStore. Server never sees the key.
 *
 * Supported chains:
 *   - EVM (Base, BNB):     m/44'/60'/0'/0/0  via BIP32 + ethers
 *   - Solana:              m/44'/501'/0'/0'   via SLIP-0010 + tweetnacl
 *   - Movement/Aptos:      m/44'/637'/0'/0'/0' via SLIP-0010 + tweetnacl
 *
 * Ed25519 chains use SLIP-0010 ("ed25519 seed") for HD derivation,
 * matching Phantom, Petra, and other standard wallets.
 */
import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { ethers } from "ethers";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import nacl from "tweetnacl";
import { hmac } from "@noble/hashes/hmac";
// Static import: Expo's async-require cannot resolve dynamic import() in the
// dev client (it throws "Cannot read property 'replace' of undefined" from
// buildUrlForBundle), which silently broke every Dynamic wallet call.
import { ensureSignerReady, signEd25519Hex, signEvmTx } from "./dynamic-wallet";
import { stellarAddressFromSolana } from "./stellar-address";
import { sha512 } from "@noble/hashes/sha2";

// ─── Hex helper (avoids Buffer dependency in Expo Go) ───────
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Base58 encoder (for Solana addresses, avoids heavy deps) ─
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58Encode(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

// ─── SLIP-0010: Ed25519 HD derivation (matches Phantom, Petra) ──
// Uses "ed25519 seed" as HMAC key instead of BIP32's "Bitcoin seed".
// Only supports hardened derivation (standard for Ed25519).
function slip10DeriveEd25519(seed: Uint8Array, path: string): Uint8Array {
  // Master key: HMAC-SHA512("ed25519 seed", seed)
  const ED25519_SEED = new TextEncoder().encode("ed25519 seed");
  let I = hmac(sha512, ED25519_SEED, seed);
  let key = I.slice(0, 32);
  let chainCode = I.slice(32);

  // Parse path segments (all must be hardened for Ed25519)
  const segments = path
    .replace("m/", "")
    .split("/")
    .map((s) => {
      const index = parseInt(s.replace("'", ""), 10);
      return (index + 0x80000000) >>> 0; // force hardened
    });

  for (const index of segments) {
    const data = new Uint8Array(37);
    data[0] = 0x00; // private key prefix
    data.set(key, 1);
    data[33] = (index >>> 24) & 0xff;
    data[34] = (index >>> 16) & 0xff;
    data[35] = (index >>> 8) & 0xff;
    data[36] = index & 0xff;

    I = hmac(sha512, chainCode, data);
    key = I.slice(0, 32);
    chainCode = I.slice(32);
  }

  return key;
}

// ─── Constants ──────────────────────────────────────────────
const MNEMONIC_PREFIX = "mm_mnemonic_";
const ACTIVE_USER_KEY = "mm_active_user";

// ─── Active user tracking (so signing/export can find the right mnemonic) ──
function storageKey(userId?: string): string {
  return userId ? `${MNEMONIC_PREFIX}${userId}` : MNEMONIC_PREFIX;
}

export async function setActiveUserId(userId: string): Promise<void> {
  if (Platform.OS === "web") {
    localStorage.setItem(ACTIVE_USER_KEY, userId);
  } else {
    await SecureStore.setItemAsync(ACTIVE_USER_KEY, userId);
  }
}

async function getActiveUserId(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(ACTIVE_USER_KEY);
  }
  return SecureStore.getItemAsync(ACTIVE_USER_KEY);
}

// ─── Types ──────────────────────────────────────────────────
export interface WalletAddresses {
  evm: string;
  solana: string;
  movement: string;
}

// ═══════════════════════════════════════════════════════════
//  MNEMONIC MANAGEMENT
// ═══════════════════════════════════════════════════════════

/** Generate a fresh 12-word BIP-39 mnemonic */
export function createMnemonic(): string {
  return generateMnemonic(wordlist, 128); // 128 bits = 12 words
}

/** Validate a mnemonic phrase */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
}

/** Save mnemonic to device secure storage (per-user) */
export async function saveMnemonic(mnemonic: string, userId?: string): Promise<void> {
  const uid = userId || await getActiveUserId();
  const key = storageKey(uid || undefined);
  if (Platform.OS === "web") {
    localStorage.setItem(key, mnemonic);
  } else {
    await SecureStore.setItemAsync(key, mnemonic);
  }
}

/** Load mnemonic from device secure storage (per-user) */
export async function loadMnemonic(userId?: string): Promise<string | null> {
  const uid = userId || await getActiveUserId();
  const key = storageKey(uid || undefined);
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

/** Delete mnemonic from device secure storage (per-user) */
export async function deleteMnemonic(userId?: string): Promise<void> {
  const uid = userId || await getActiveUserId();
  const key = storageKey(uid || undefined);
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
  } else {
    await SecureStore.deleteItemAsync(key);
  }
}

/** Check if a wallet exists on this device for the given/active user */
export async function hasLocalWallet(userId?: string): Promise<boolean> {
  if (await hasEmbeddedKey(userId)) return true;
  if (await hasDynamicWallet(userId)) return true;
  const m = await loadMnemonic(userId);
  return !!m;
}

// ═══════════════════════════════════════════════════════════
//  WALLET TYPE + EMBEDDED (Web3Auth) KEY MANAGEMENT
// ═══════════════════════════════════════════════════════════
//
// Two wallet kinds share every signing path:
//   - "MNEMONIC": classic 12-word BIP-39 (above).
//   - "EMBEDDED": key comes from Web3Auth (email login). Web3Auth is only used
//     once, at create/recover, to fetch the raw key; we then persist it here so
//     all signing reuses the same SecureStore-backed path as the mnemonic.
//
// The embedded bundle holds the raw keys the signers need:
//   secp    — 32-byte secp256k1 private key (EVM: Base/BNB/Arb)
//   edSeed  — 32-byte Ed25519 seed          (Movement + Solana)
// Both are hex (no 0x). The Ed25519 seed is derived from the Web3Auth key via
// getED25519Key() in services/web3auth.ts — always the SAME way, so addresses
// are deterministic and match what's stored in the backend on recovery.

export type WalletType = "MNEMONIC" | "EMBEDDED";

export interface EmbeddedKeyBundle {
  secp: string;   // hex, 64 chars
  edSeed: string; // hex, 64 chars
}

const WALLET_TYPE_PREFIX = "mm_wallet_type_";
const EMBEDDED_PREFIX = "mm_embedded_";

async function kvSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") localStorage.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}
async function kvGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}
async function kvDel(key: string): Promise<void> {
  if (Platform.OS === "web") localStorage.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

/** Persist which wallet kind this user chose (per-user) */
export async function setWalletType(type: WalletType, userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await kvSet(`${WALLET_TYPE_PREFIX}${uid || ""}`, type);
}

/** Read the chosen wallet kind. null = not chosen yet (show the chooser). */
export async function getWalletType(userId?: string): Promise<WalletType | null> {
  const uid = userId || (await getActiveUserId());
  const v = await kvGet(`${WALLET_TYPE_PREFIX}${uid || ""}`);
  return v === "MNEMONIC" || v === "EMBEDDED" ? v : null;
}

/** Store the embedded key bundle for this user */
export async function saveEmbeddedKey(bundle: EmbeddedKeyBundle, userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await kvSet(`${EMBEDDED_PREFIX}${uid || ""}`, JSON.stringify(bundle));
}

/** Load the embedded key bundle for this user */
export async function loadEmbeddedKey(userId?: string): Promise<EmbeddedKeyBundle | null> {
  const uid = userId || (await getActiveUserId());
  const raw = await kvGet(`${EMBEDDED_PREFIX}${uid || ""}`);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    return b && typeof b.secp === "string" && typeof b.edSeed === "string" ? b : null;
  } catch {
    return null;
  }
}

export async function hasEmbeddedKey(userId?: string): Promise<boolean> {
  return !!(await loadEmbeddedKey(userId));
}

// ═════════════════════════════════════════════════════════
//  FINDING A WALLET LEFT BEHIND BY AN OLDER BUILD
// ═════════════════════════════════════════════════════════

const LEGACY_USER_KEY = "mm_legacy_user";

/**
 * Remember which account the phrase on this device belonged to.
 *
 * The migration hands an old user a NEW account with a new id, and their
 * phrase stays filed under the OLD one. Without this note it would be
 * unreachable: SecureStore has no way to list keys, so an id nobody recorded
 * is an id nobody can ask for. Call this at migration time, before the new
 * account takes over.
 */
export async function setLegacyUserId(userId: string): Promise<void> {
  await kvSet(LEGACY_USER_KEY, userId);
}

export async function getLegacyUserId(): Promise<string | null> {
  return kvGet(LEGACY_USER_KEY);
}

export interface LegacyWallet {
  /** The 12 words, if this device ever held them. */
  mnemonic: string | null;
  /** The Web3Auth-era raw keys, for users who never had a phrase. */
  embedded: { evmPrivateKey: string; ed25519Seed: string } | null;
}

/**
 * Look for an older wallet under every id it could be filed against.
 *
 * There are four, and which one holds the phrase depends on when the account
 * was made and what has happened to it since:
 *   - no id at all, from before storage was split per user;
 *   - the id the last build marked active;
 *   - the id of whoever is signed in now;
 *   - the id recorded at migration, for an account that has since been
 *     replaced by a Dynamic one.
 *
 * Checking all four is cheap and means an upgrade path nobody anticipated
 * cannot strand someone's only copy of their key.
 */
export async function findLegacyWallet(currentUserId?: string): Promise<LegacyWallet> {
  const active = await getActiveUserId();
  const legacy = await getLegacyUserId();

  const ids: (string | undefined)[] = [];
  for (const id of [undefined, active ?? undefined, currentUserId, legacy ?? undefined]) {
    if (!ids.includes(id)) ids.push(id);
  }

  let mnemonic: string | null = null;
  let embedded: LegacyWallet["embedded"] = null;

  for (const id of ids) {
    if (!mnemonic) {
      const m = await loadMnemonic(id);
      if (m) mnemonic = m;
    }
    if (!embedded) {
      const e = await loadEmbeddedKey(id);
      if (e) embedded = { evmPrivateKey: "0x" + e.secp, ed25519Seed: "0x" + e.edSeed };
    }
    if (mnemonic && embedded) break;
  }

  return { mnemonic, embedded };
}

/** An older wallet's Solana key, held only while moving what is left in it. */
export interface OldWalletKey {
  solanaAddress: string;
  seed: Uint8Array;
}

/** Words only: a pasted list can carry numbers, line breaks and capitals. */
export function cleanPhrase(phrase: string): string {
  return phrase.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

/**
 * The keys a 12-word phrase can hold on Solana, the app's own path first.
 * The others are the accounts and paths other wallets use. Works on the phone only.
 */
export function oldWalletKeysFromPhrase(phrase: string): OldWalletKey[] {
  const seed = mnemonicToSeedSync(cleanPhrase(phrase));
  return ["m/44'/501'/0'/0'", "m/44'/501'/0'", "m/44'/501'/1'/0'", "m/44'/501'/2'/0'"].map((path) => {
    const key = slip10DeriveEd25519(seed, path);
    return { solanaAddress: solanaAddressFromEd25519Seed(key), seed: key };
  });
}

/** Every older key on this phone. An id nobody expected can still hold a phrase. */
export async function findOldWalletKeys(currentUserId?: string): Promise<OldWalletKey[]> {
  const ids = new Set<string | undefined>([undefined, (await getActiveUserId()) ?? undefined, currentUserId, (await getLegacyUserId()) ?? undefined]);
  const keys: OldWalletKey[] = [];
  for (const id of ids) {
    const phrase = await loadMnemonic(id).catch(() => null);
    if (phrase) keys.push(...oldWalletKeysFromPhrase(phrase));
    const embedded = await loadEmbeddedKey(id).catch(() => null);
    if (embedded) keys.push(oldWalletKeyFromSeedHex(embedded.edSeed));
  }
  return keys;
}

export function oldWalletKeyFromSeedHex(seedHex: string): OldWalletKey {
  const seed = hexToBytes(seedHex);
  return { solanaAddress: solanaAddressFromEd25519Seed(seed), seed };
}

/** Signs with an older wallet by name, the one thing a phrase is still needed for. */
export function signWithOldWalletKey(key: OldWalletKey, signingMessageHex: string): string {
  const kp = nacl.sign.keyPair.fromSeed(key.seed);
  return bytesToHex(nacl.sign.detached(hexToBytes(signingMessageHex), kp.secretKey));
}

/** Delete the embedded key bundle (device-side) */
export async function deleteEmbeddedKey(userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await kvDel(`${EMBEDDED_PREFIX}${uid || ""}`);
}

// ─── Dynamic embedded wallet addresses ──────────────────────
// Dynamic (MPC) never gives us a raw key, so instead of a key bundle we cache
// the derived addresses (EVM/Solana/Movement) so balance polling doesn't need a
// live Dynamic session. Signing goes through services/dynamic-wallet at tx time.
const DYNAMIC_ADDR_PREFIX = "mm_dynamic_addr_";

export async function saveDynamicAddresses(addr: WalletAddresses, userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await kvSet(`${DYNAMIC_ADDR_PREFIX}${uid || ""}`, JSON.stringify(addr));
}

export async function loadDynamicAddresses(userId?: string): Promise<WalletAddresses | null> {
  const uid = userId || (await getActiveUserId());
  const raw = await kvGet(`${DYNAMIC_ADDR_PREFIX}${uid || ""}`);
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    return a && a.evm && a.solana && a.movement ? a : null;
  } catch {
    return null;
  }
}

export async function hasDynamicWallet(userId?: string): Promise<boolean> {
  return !!(await loadDynamicAddresses(userId));
}

export async function deleteDynamicAddresses(userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await kvDel(`${DYNAMIC_ADDR_PREFIX}${uid || ""}`);
}

/** Wipe all local wallet material + type for a user (used on admin-deletion re-onboard) */
export async function clearLocalWallet(userId?: string): Promise<void> {
  const uid = userId || (await getActiveUserId());
  await deleteMnemonic(uid || undefined);
  await deleteEmbeddedKey(uid || undefined);
  await deleteDynamicAddresses(uid || undefined);
  await kvDel(`${WALLET_TYPE_PREFIX}${uid || ""}`);
}

/** Derive all chain addresses from an embedded key bundle */
export function deriveAddressesFromEmbedded(bundle: EmbeddedKeyBundle): WalletAddresses {
  const secp = hexToBytes(bundle.secp);
  const edSeed = hexToBytes(bundle.edSeed);
  return {
    evm: evmAddressFromPrivateKey(secp),
    solana: solanaAddressFromEd25519Seed(edSeed),
    movement: movementAddressFromEd25519Seed(edSeed),
  };
}

// ═══════════════════════════════════════════════════════════
//  ADDRESS DERIVATION FROM MNEMONIC
// ═══════════════════════════════════════════════════════════

// ─── Address-from-key helpers (shared by mnemonic + embedded paths) ──
// Keeping address formatting in one place guarantees an embedded-wallet key
// produces byte-identical addresses to the mnemonic path.

/** EVM address from a 32-byte secp256k1 private key */
function evmAddressFromPrivateKey(privKey: Uint8Array): string {
  return new ethers.Wallet("0x" + bytesToHex(privKey)).address;
}

/** Solana address (base58 pubkey) from a 32-byte Ed25519 seed */
function solanaAddressFromEd25519Seed(seedBytes: Uint8Array): string {
  const kp = nacl.sign.keyPair.fromSeed(seedBytes);
  return bs58Encode(kp.publicKey);
}

/** Movement/Aptos address (single-key auth) from a 32-byte Ed25519 seed */
function movementAddressFromEd25519Seed(seedBytes: Uint8Array): string {
  const { sha3_256 } = require("@noble/hashes/sha3.js");
  const kp = nacl.sign.keyPair.fromSeed(seedBytes);
  const payload = new Uint8Array(kp.publicKey.length + 1);
  payload.set(kp.publicKey);
  payload[kp.publicKey.length] = 0x00; // single-key auth scheme
  return "0x" + bytesToHex(sha3_256(payload));
}

/** Derive EVM (Base, BNB) address: m/44'/60'/0'/0/0 */
function deriveEvmAddress(seed: Uint8Array): string {
  const hd = HDKey.fromMasterSeed(seed);
  const child = hd.derive("m/44'/60'/0'/0/0");
  if (!child.privateKey) throw new Error("Failed to derive EVM key");
  return evmAddressFromPrivateKey(child.privateKey);
}

/** Derive Solana address: m/44'/501'/0'/0' (SLIP-0010) */
function deriveSolanaAddress(seed: Uint8Array): string {
  return solanaAddressFromEd25519Seed(slip10DeriveEd25519(seed, "m/44'/501'/0'/0'"));
}

/** Derive Movement/Aptos address: m/44'/637'/0'/0'/0' (SLIP-0010) */
function deriveMovementAddress(seed: Uint8Array): string {
  return movementAddressFromEd25519Seed(slip10DeriveEd25519(seed, "m/44'/637'/0'/0'/0'"));
}

/** Derive all chain addresses from a mnemonic */
export function deriveAddresses(mnemonic: string): WalletAddresses {
  const seed = mnemonicToSeedSync(mnemonic);
  return {
    evm: deriveEvmAddress(seed),
    solana: deriveSolanaAddress(seed),
    movement: deriveMovementAddress(seed),
  };
}

/** Format addresses for saving to backend */
export function formatAddressesForSave(addr: WalletAddresses) {
  return [
    { chain: "MOVE", address: addr.movement },
    { chain: "SOL", address: addr.solana },
    { chain: "BASE", address: addr.evm },
    { chain: "BEP20", address: addr.evm },
    { chain: "ARC", address: addr.evm },
    { chain: "ARB", address: addr.evm },
  ];
}

/**
 * The TON address, which is the one address this app does not work out itself.
 *
 * It is a pure function of the Solana public key, like the Movement one - but
 * where Movement's derivation is a single sha3 of the key, TON's is the hash
 * of a wallet CONTRACT holding that key, which means the contract's compiled
 * code and a cell serialiser. That is a TON library in the bundle, for one
 * address, and the last new dependency added here nearly took the app down.
 *
 * So the server derives it and this remembers what the server said. Safe to
 * trust: the derivation is deterministic from the Solana address, and the
 * Solana address IS verified here - the send path re-checks the two against
 * each other before anything moves.
 */
const TON_ADDR_KEY = "mm_ton_address";
let tonAddressCache: string | null = null;

export async function saveTonAddress(address: string): Promise<void> {
  if (!address || address === tonAddressCache) return;
  tonAddressCache = address;
  try {
    await AsyncStorage.setItem(TON_ADDR_KEY, address);
  } catch {}
}

export async function loadTonAddress(): Promise<string | null> {
  if (tonAddressCache) return tonAddressCache;
  try {
    tonAddressCache = await AsyncStorage.getItem(TON_ADDR_KEY);
  } catch {
    tonAddressCache = null;
  }
  return tonAddressCache;
}

/**
 * Derive local addresses keyed by chain tag.
 * Used to verify backend addresses haven't been tampered with.
 */
export async function getLocalAddresses(): Promise<Record<string, string> | null> {
  // Dynamic (MPC) wallets store their addresses directly — no key to derive from.
  const dynamic = await loadDynamicAddresses();
  const embedded = dynamic ? null : await loadEmbeddedKey();
  const addr = dynamic
    ? dynamic
    : embedded
    ? deriveAddressesFromEmbedded(embedded)
    : await (async () => {
        const mnemonic = await loadMnemonic();
        return mnemonic ? deriveAddresses(mnemonic) : null;
      })();
  if (!addr) return null;
  const tonAddress = await loadTonAddress();
  // Stellar's address IS the Solana key, re-encoded - worked out here, on the
  // device, so it is as tamper-proof as the Solana one it comes from.
  const stellarAddress = addr.solana ? stellarAddressFromSolana(addr.solana) : null;
  return {
    MOVE: addr.movement,
    SOL: addr.solana,
    BASE: addr.evm,
    BEP20: addr.evm,
    ARC: addr.evm,
    ARB: addr.evm,
    MONAD: addr.evm,
    // Absent until the server has told us once. Everything that reads this
    // map treats a missing chain as "no address yet" already, so the first
    // run before a sync simply shows no TON rather than a wrong one.
    ...(tonAddress ? { TON: tonAddress } : {}),
    ...(stellarAddress ? { STELLAR: stellarAddress } : {}),
  };
}

// ═══════════════════════════════════════════════════════════
//  TRANSACTION SIGNING
// ═══════════════════════════════════════════════════════════

/**
 * A 12-word wallet signs only when something asks for it by name.
 *
 * Every signer used to read "embedded key if present, else mnemonic". Nobody
 * chose that as a feature - it was a default that quietly caught every path in
 * the app, so an account whose embedded wallet never actually arrived went on
 * signing with its old phrase and nothing anywhere said so. That is how one
 * account came to hold two wallets, send from the old one, and receive a
 * username transfer at an address its owner thought he had left behind.
 *
 * The fallback is gone. `legacy: true` is the only way to reach a mnemonic,
 * and exactly one caller passes it: moving what is left of an old wallet into
 * the new one. That keeps the one thing a phrase is still needed for, without
 * it being the answer to every other question.
 */
export interface SignerOptions {
  /** Deliberately sign with the old 12-word wallet. Only the migration uses this. */
  legacy?: boolean;
}

function noLegacy(): never {
  throw new Error(
    "LEGACY_WALLET_NOT_ALLOWED: this account is still on a 12-word wallet. " +
      "Move it to your email wallet to keep sending.",
  );
}

/** The EVM private key. Embedded, unless a caller explicitly asks for the old one. */
async function getEvmPrivateKeyHex(opts?: SignerOptions): Promise<string> {
  const embedded = await loadEmbeddedKey();
  if (embedded) return "0x" + embedded.secp;
  if (!opts?.legacy) noLegacy();
  const mnemonic = await loadMnemonic();
  if (!mnemonic) throw new Error("NO_WALLET");
  const seed = mnemonicToSeedSync(mnemonic);
  const hd = HDKey.fromMasterSeed(seed);
  const child = hd.derive("m/44'/60'/0'/0/0");
  return "0x" + bytesToHex(child.privateKey!);
}

/** Get EVM signer from stored wallet */
export async function getEvmSigner(rpcUrl: string): Promise<ethers.Wallet> {
  const hexKey = await getEvmPrivateKeyHex();
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(hexKey, provider);
}

/** Sign and send an EVM transaction */
export async function signEVMTransaction(
  tx: ethers.TransactionRequest,
  rpcUrl: string
): Promise<string> {
  const wallet = await getEvmSigner(rpcUrl);
  const response = await wallet.sendTransaction(tx);
  return response.hash;
}

/** Export mnemonic for user display (12 words) */
export async function exportMnemonic(): Promise<string> {
  const mnemonic = await loadMnemonic();
  if (!mnemonic) throw new Error("NO_WALLET");
  return mnemonic;
}

/**
 * Export the embedded wallet's raw private key (0x-prefixed secp256k1) for
 * display on the export screen. Movement/Solana share the Ed25519 seed.
 */
export async function exportEmbeddedKey(): Promise<{ evmPrivateKey: string; ed25519Seed: string }> {
  const embedded = await loadEmbeddedKey();
  if (!embedded) throw new Error("NO_WALLET");
  return { evmPrivateKey: "0x" + embedded.secp, ed25519Seed: "0x" + embedded.edSeed };
}

// ═══════════════════════════════════════════════════════════
//  CHAIN-SPECIFIC SIGNERS (for gasless user-signed txns)
// ═══════════════════════════════════════════════════════════

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Movement/Aptos keypair. Embedded, unless a caller explicitly asks for the old one. */
async function getMovementKeypair(opts?: SignerOptions): Promise<nacl.SignKeyPair> {
  const embedded = await loadEmbeddedKey();
  if (embedded) return nacl.sign.keyPair.fromSeed(hexToBytes(embedded.edSeed));
  if (!opts?.legacy) noLegacy();
  const mnemonic = await loadMnemonic();
  if (!mnemonic) throw new Error("NO_WALLET");
  const seed = mnemonicToSeedSync(mnemonic);
  const seedBytes = slip10DeriveEd25519(seed, "m/44'/637'/0'/0'/0'");
  return nacl.sign.keyPair.fromSeed(seedBytes);
}

/**
 * Sign a hex-encoded signing message with Movement Ed25519 key.
 * Returns hex-encoded signature (128 chars) and public key (64 chars).
 */
/**
 * Before a transfer is started: whether the wallet can still sign.
 *
 * Asked once signing time comes, an expired session signs the person out after
 * the server has already opened a row for the transfer, and with them signed
 * out the app can no longer close it, so it sat waiting and then read as
 * failed with no reason. Asked first, nothing is opened. A wallet that keeps
 * its key on the phone has no session to lose, so this is the embedded one only.
 */
export async function ensureSigningSession(): Promise<void> {
  if (await hasDynamicWallet()) await ensureSignerReady();
}

export async function signMovementTransaction(
  signingMessageHex: string
): Promise<{ signature: string; publicKey: string }> {
  // Dynamic wallets sign through the MPC SDK (no local key). Movement shares the
  // Ed25519 (Solana) key, so we sign the same hex message there.
  if (await hasDynamicWallet()) {
    return signEd25519Hex(signingMessageHex);
  }
  const kp = await getMovementKeypair();
  const message = hexToBytes(signingMessageHex);
  const signature = nacl.sign.detached(message, kp.secretKey);
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(kp.publicKey),
  };
}

/** Solana keypair. Embedded, unless a caller explicitly asks for the old one. */
async function getSolanaKeypairForSigning(opts?: SignerOptions): Promise<nacl.SignKeyPair> {
  const embedded = await loadEmbeddedKey();
  if (embedded) return nacl.sign.keyPair.fromSeed(hexToBytes(embedded.edSeed));
  if (!opts?.legacy) noLegacy();
  const mnemonic = await loadMnemonic();
  if (!mnemonic) throw new Error("NO_WALLET");
  const seed = mnemonicToSeedSync(mnemonic);
  const seedBytes = slip10DeriveEd25519(seed, "m/44'/501'/0'/0'");
  return nacl.sign.keyPair.fromSeed(seedBytes);
}

/**
 * Sign a hex-encoded message with Solana Ed25519 key.
 */
export async function signSolanaTransaction(
  signingMessageHex: string
): Promise<{ signature: string; publicKey: string }> {
  if (await hasDynamicWallet()) {
    return signEd25519Hex(signingMessageHex);
  }
  const kp = await getSolanaKeypairForSigning();
  const message = hexToBytes(signingMessageHex);
  const signature = nacl.sign.detached(message, kp.secretKey);
  return {
    signature: bytesToHex(signature),
    publicKey: bytesToHex(kp.publicKey),
  };
}

/**
 * Sign a TON request.
 *
 * The same Ed25519 key Solana and Movement already use, signing the same
 * shape - a bare 32-byte hash. On TON that hash is of a cell rather than a
 * transaction message, but the signature is computed identically and the
 * wallet contract verifies it the same way, so there is nothing chain-
 * specific to do here beyond the name.
 *
 * Kept as its own function rather than calling the Solana one at each site,
 * because the two will diverge the day either chain changes its scheme, and
 * a call named after the wrong chain is how that goes unnoticed.
 */
export async function signTonTransaction(
  signingMessageHex: string
): Promise<{ signature: string; publicKey: string }> {
  return signSolanaTransaction(signingMessageHex);
}

/**
 * Sign an EVM transaction.
 *
 * Two routes, because the two wallet kinds can do fundamentally different
 * things:
 *
 *  - A mnemonic/embedded-key wallet holds the raw secp256k1 key, so it signs
 *    the bare hash the backend prepared and returns just the signature.
 *  - A Dynamic MPC wallet has NO exportable key and will not sign an opaque
 *    hash - blind-signing a 32-byte digest with a secp256k1 key is exactly the
 *    hazard that drains wallets. It signs the whole transaction instead and
 *    returns the serialised signed bytes, which the backend re-parses and
 *    checks field by field before broadcasting.
 *
 * `txRequest` is only needed for the Dynamic route; it comes back from the
 * backend's prepare step alongside the hash.
 */
export async function signEvmTransaction(
  txHashHex: string,
  txRequest?: any
): Promise<{ signature: string; publicKey: string; signedRaw?: string }> {
  if (await hasDynamicWallet()) {
    if (!txRequest) {
      throw new Error(
        "This transaction can't be signed on this device. Please update the app."
      );
    }
    const { signedRaw } = await signEvmTx(txRequest);
    // The signature fields stay empty on this route: the raw transaction IS the
    // signature, and inventing values here would only invite the backend to
    // reassemble a transaction that differs from the one actually signed.
    return { signature: "", publicKey: "", signedRaw };
  }

  const hexKey = await getEvmPrivateKeyHex();
  const signingKey = new ethers.SigningKey(hexKey);
  const sig = signingKey.sign("0x" + txHashHex);
  return {
    signature: sig.serialized.slice(2), // remove 0x prefix
    publicKey: signingKey.compressedPublicKey.slice(2), // remove 0x prefix
  };
}
