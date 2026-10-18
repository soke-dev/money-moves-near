/**
 * wallet-proof.ts — whose an address is, before we take it as an account's.
 *
 * Every balance, deposit and payout here hangs off the address stored for each
 * chain, and /wallet/addresses used to store whatever the app sent. Pointing an
 * account at somebody else's funded wallet was then enough for the balance sync
 * to record that wallet's holdings as deposits. Nothing could be spent - every
 * send still needs that wallet's signature - but the books said otherwise.
 *
 * So a new or changed address has to be proven:
 *
 *  - by the email wallet's own sign-in token, which Dynamic signs and which
 *    names the account's EVM and Solana wallets. Movement and TON addresses come
 *    from the Solana key, so they are worked out here rather than taken; or
 *  - by being the same key the account already holds: an EVM address it holds
 *    on one network is its address on every EVM network, and its TON address is
 *    a function of the Solana one it already has.
 */
import crypto from "crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyDynamicToken } from "./dynamic";
import * as ton from "./ton";

export const EVM_FAMILY = ["BASE", "BEP20", "ARB", "ARC", "MONAD"];

/** Movement's single-key address for an Ed25519 public key: sha3-256(key || 0x00). */
export function movementAddressFromSolana(solanaAddress: string): string {
  const pub = new PublicKey(solanaAddress).toBytes();
  return "0x" + crypto.createHash("sha3-256").update(Buffer.concat([Buffer.from(pub), Buffer.from([0])])).digest("hex");
}

export function sameAddress(chain: string, a: string, b: string): boolean {
  if (!a || !b) return false;
  if (chain === "TON") {
    try {
      return ton.sameTonAddress(a, b);
    } catch {
      return false;
    }
  }
  // Solana's base58 is case-sensitive; hex addresses are not.
  return chain === "SOL" ? a === b : a.toLowerCase() === b.toLowerCase();
}

export type Proven = Record<string, string[]>;

/**
 * The addresses a Dynamic sign-in token proves, by chain. Null when there is no
 * token, it doesn't verify, or it belongs to a different email than this account.
 */
export async function provenByToken(token: string | undefined, accountEmail: string): Promise<Proven | null> {
  if (!token) return null;
  let claims;
  try {
    claims = await verifyDynamicToken(token);
  } catch {
    return null;
  }
  if (claims.email !== accountEmail.trim().toLowerCase()) return null;
  const out: Proven = {};
  for (const c of EVM_FAMILY) out[c] = [...claims.evmAddresses];
  out.SOL = [...claims.solanaAddresses];
  out.MOVE = [];
  out.TON = [];
  for (const sol of claims.solanaAddresses) {
    try {
      out.MOVE.push(movementAddressFromSolana(sol));
      out.TON.push(ton.tonAddressFromSolana(sol));
    } catch {
      // Not a valid Solana key - proves nothing.
    }
  }
  return out;
}

/** What the account's existing addresses already prove: the same key, seen on another chain. */
export function provenByHeld(held: { chain: string; address: string }[]): Proven {
  const out: Proven = {};
  const evm = held.filter((w) => EVM_FAMILY.includes(w.chain)).map((w) => w.address);
  for (const c of EVM_FAMILY) out[c] = evm;
  const sol = held.filter((w) => w.chain === "SOL").map((w) => w.address);
  out.TON = [];
  for (const s of sol) {
    try {
      out.TON.push(ton.tonAddressFromSolana(s));
    } catch {}
  }
  return out;
}

export function isProven(proven: Proven | null, chain: string, address: string): boolean {
  return !!proven?.[chain]?.some((a) => sameAddress(chain, a, address));
}
