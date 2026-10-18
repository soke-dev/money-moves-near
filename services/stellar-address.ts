/**
 * Stellar address encoding, with no React Native imports so it can be
 * checked against the Stellar SDK from Node.
 *
 * A G... address is: version byte (6 << 3), the 32-byte Ed25519 public key,
 * and a CRC16-XModem checksum written little-endian, all in RFC 4648 base32.
 * The public key is the user's Solana key, so the Solana address decodes
 * straight into it.
 */

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VERSION_ACCOUNT = 6 << 3;
const VERSION_SEED = 18 << 3;

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) return null;
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** Version byte, 32 bytes, checksum: Stellar's encoding for keys of any kind. */
function encodeCheck(version: number, key: Uint8Array): string {
  if (key.length !== 32) throw new Error("BAD_KEY");
  const payload = new Uint8Array(33);
  payload[0] = version;
  payload.set(key, 1);
  const crc = crc16xmodem(payload);
  const full = new Uint8Array(35);
  full.set(payload);
  full[33] = crc & 0xff;
  full[34] = crc >> 8;
  return base32Encode(full);
}

/** The user's G... address, from their Solana address. */
export function stellarAddressFromSolana(solanaAddress: string): string | null {
  try {
    return encodeCheck(VERSION_ACCOUNT, base58Decode(solanaAddress));
  } catch {
    return null;
  }
}

/** A G... address from the 32-byte Ed25519 public key. */
export function stellarAddressFromPublicKey(publicKey: Uint8Array): string {
  return encodeCheck(VERSION_ACCOUNT, publicKey);
}

/**
 * The S... secret key, from the 32-byte Ed25519 seed - the same seed Solana's
 * 64-byte secret starts with, in the spelling a Stellar wallet imports.
 */
export function stellarSecretFromSeed(seed: Uint8Array): string {
  return encodeCheck(VERSION_SEED, seed);
}

/** Version byte and checksum checked, so a typo is caught before sending. */
export function isStellarAddress(value: string): boolean {
  const a = (value || "").trim();
  if (!/^G[A-Z2-7]{55}$/.test(a)) return false;
  const bytes = base32Decode(a);
  if (!bytes || bytes.length !== 35 || bytes[0] !== VERSION_ACCOUNT) return false;
  const crc = crc16xmodem(bytes.slice(0, 33));
  return bytes[33] === (crc & 0xff) && bytes[34] === crc >> 8;
}
