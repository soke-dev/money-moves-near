/**
 * Rewrites a Solana private key in the form a Movement wallet accepts.
 *
 * Movement and Solana share one Ed25519 key on this account - the Movement
 * address is the Aptos single-key hash of the Solana public key - but the two
 * ecosystems write the key differently. Solana hands out the 64-byte secret
 * (seed ‖ public key) in base58; Aptos-family wallets want the 32-byte seed on
 * its own, as 0x hex. Importing one into the other is why Movement answers
 * "invalid key" for a key that is, in fact, the right one.
 *
 * Everything here is local arithmetic on a key the user has already revealed.
 * Nothing is stored and nothing leaves the device.
 */
import nacl from "tweetnacl";
import { sha3_256 } from "@noble/hashes/sha3.js";

export interface MovementKey {
  /** 0x + 64 hex characters: what an Aptos-family wallet asks for. */
  privateKeyHex: string;
  /** Derived from the key itself, so the user can check it against the address they know. */
  address: string;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bs58Decode(str: string): Uint8Array {
  const bytes = [0];
  for (const ch of str) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error("BAD_KEY");
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of str) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Accepts the three shapes a Solana key is handed out in: base58, hex, or the
 * JSON byte array a keypair file holds.
 *
 * Exported because the TON rewrite needs exactly the same reading of exactly
 * the same key - one parser, so the two cannot come to disagree about what a
 * valid key looks like.
 */
export function parseSolanaKeyBytes(input: string): Uint8Array {
  const raw = input.trim();
  if (!raw) throw new Error("BAD_KEY");

  if (raw.startsWith("[")) {
    const nums = JSON.parse(raw);
    if (!Array.isArray(nums) || nums.some((x) => typeof x !== "number")) throw new Error("BAD_KEY");
    return new Uint8Array(nums);
  }

  const hexish = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (/^[0-9a-fA-F]+$/.test(hexish) && (hexish.length === 64 || hexish.length === 128)) {
    return hexToBytes(hexish);
  }

  return bs58Decode(raw);
}

export function toMovementKey(input: string): MovementKey {
  const bytes = parseSolanaKeyBytes(input);

  let seed: Uint8Array;
  if (bytes.length === 64) {
    seed = bytes.slice(0, 32);
  } else if (bytes.length === 32) {
    seed = bytes;
  } else {
    throw new Error("BAD_KEY");
  }

  const pair = nacl.sign.keyPair.fromSeed(seed);

  // A real 64-byte secret carries its own public key in the tail. If that does
  // not match what the seed derives, this is not an Ed25519 secret key and the
  // hex below would be meaningless.
  if (bytes.length === 64) {
    const tail = bytes.slice(32);
    for (let i = 0; i < 32; i++) {
      if (tail[i] !== pair.publicKey[i]) throw new Error("BAD_KEY");
    }
  }

  // Aptos single-key authentication: sha3_256(publicKey ‖ 0x00).
  const payload = new Uint8Array(33);
  payload.set(pair.publicKey);
  payload[32] = 0x00;

  return {
    privateKeyHex: "0x" + bytesToHex(seed),
    address: "0x" + bytesToHex(sha3_256(payload)),
  };
}
