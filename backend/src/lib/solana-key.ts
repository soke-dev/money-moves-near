import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

/** A Solana secret key as a wallet app exports it (base58), or as a JSON byte array (solana-keygen). */
export function solanaKeypairFrom(secret: string): Keypair {
  const s = secret.trim();
  const bytes = s.startsWith("[") ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  return Keypair.fromSecretKey(bytes);
}
