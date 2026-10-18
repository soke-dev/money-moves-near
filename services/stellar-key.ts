/**
 * Rewrites a Solana private key in the form a Stellar wallet accepts.
 *
 * Stellar and Solana share one Ed25519 key on this account - the G... address
 * is the Solana public key in Stellar's encoding - but the two write the
 * secret differently. Solana hands out the 64-byte secret (seed ‖ public key)
 * in base58; a Stellar wallet wants the 32-byte seed as an S... secret key:
 * a version byte, the seed and a checksum, in base32.
 *
 * Unlike TON, the address can be derived here, so the check is the direct
 * one: the key is accepted only if it derives this account's own G address.
 *
 * Everything here is local arithmetic on a key the user has already revealed.
 * Nothing is stored and nothing leaves the device.
 */
import nacl from "tweetnacl";
import { parseSolanaKeyBytes } from "./movement-key";
import { stellarAddressFromPublicKey, stellarSecretFromSeed } from "./stellar-address";

export interface StellarKey {
  /** The S... secret key, as a Stellar wallet imports it. */
  secret: string;
  /** The G... address this key opens, to check against the account's own. */
  address: string;
}

export function toStellarKey(input: string): StellarKey {
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
  // not match what the seed derives, this is not an Ed25519 secret key.
  if (bytes.length === 64) {
    const tail = bytes.slice(32);
    for (let i = 0; i < 32; i++) {
      if (tail[i] !== pair.publicKey[i]) throw new Error("BAD_KEY");
    }
  }

  return {
    secret: stellarSecretFromSeed(seed),
    address: stellarAddressFromPublicKey(pair.publicKey),
  };
}
