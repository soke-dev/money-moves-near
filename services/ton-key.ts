/**
 * Rewrites a Solana private key in the form a TON wallet accepts.
 *
 * TON and Solana share one Ed25519 key on this account - a TON address is the
 * wallet v5R1 contract holding the same key Solana uses - but the two write it
 * differently. Solana hands out the 64-byte secret (seed ‖ public key) in
 * base58; TON tooling wants the 32-byte seed on its own, as bare hex.
 *
 * ── There is no phrase, and there cannot be ──────────────────────────
 *
 * Every other chain here can be exported as words if the account began with a
 * mnemonic. TON cannot, ever, for this wallet: the key did not come from a
 * phrase, and turning a key back into one is impossible - TON's mnemonic
 * scheme is PBKDF2 and only runs forwards. TON's phrases are also not BIP39
 * phrases; the two share a wordlist and derive different keys, so our old
 * twelve words would open a different TON wallet than ours.
 *
 * So this is a key export, like Movement's, and the screen says so.
 *
 * ── Verified against Solana, not TON ─────────────────────────────────
 *
 * The Movement rewrite proves itself by deriving the Movement address and
 * matching it. The TON address cannot be derived here: it is the hash of a
 * wallet CONTRACT holding the key, which needs the contract's compiled code
 * and a cell serialiser - a TON library in the bundle for one comparison.
 *
 * The Solana address is the same key's public half, and the app already knows
 * it. So a key that derives the right Solana address is the right key, and
 * the TON wallet built on it is this account's. That is the same proof by a
 * shorter route.
 *
 * Everything here is local arithmetic on a key the user has already revealed.
 * Nothing is stored and nothing leaves the device.
 */
import nacl from "tweetnacl";
import { parseSolanaKeyBytes } from "./movement-key";

export interface TonKey {
  /** 64 hex characters, no 0x: the 32-byte seed, as TON tooling writes it. */
  privateKeyHex: string;
  /**
   * The Solana address this key derives, so it can be checked against the one
   * the account already has - see the note above on why the check is done on
   * this side rather than on the TON address.
   */
  solanaAddress: string;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
  let out = "";
  // Leading zero bytes are written as leading '1's, not dropped.
  for (const byte of bytes) {
    if (byte === 0) out += "1";
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function toTonKey(input: string): TonKey {
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

  return {
    // Bare, not 0x-prefixed: Movement's tooling wants the prefix and TON's
    // does not, and a key pasted with one where none is expected is rejected
    // as malformed.
    privateKeyHex: bytesToHex(seed),
    solanaAddress: bs58Encode(pair.publicKey),
  };
}
