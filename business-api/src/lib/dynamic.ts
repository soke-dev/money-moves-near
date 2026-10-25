/**
 * Dynamic sign-ins, checked: the business owner signs in to the business's own
 * Dynamic environment in the dashboard, and the dashboard hands us the token.
 * We check its signature against the environment's public keys (no secret is
 * needed - the same check the app's backend makes), then trust the email and
 * the wallet addresses in it.
 *
 * Node's own crypto does the work: keys are fetched once an hour, and a token
 * signed with a key we haven't seen fetches them again, once.
 */
import { createPublicKey, createVerify, type JsonWebKey, type KeyObject } from "crypto";
import { env } from "../config/env";
import { HttpError } from "./http";

type Jwk = JsonWebKey & { kid?: string };
let keys: { at: number; byKid: Map<string, KeyObject> } | null = null;

async function loadKeys(): Promise<Map<string, KeyObject>> {
  const res = await fetch(`https://app.dynamic.xyz/api/v0/sdk/${env.DYNAMIC_ENVIRONMENT_ID}/.well-known/jwks`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Dynamic keys unavailable (${res.status})`);
  const json = (await res.json()) as { keys?: Jwk[] };
  const byKid = new Map<string, KeyObject>();
  for (const k of json.keys ?? []) if (k.kid && k.kty === "RSA") byKid.set(k.kid, createPublicKey({ key: k, format: "jwk" }));
  keys = { at: Date.now(), byKid };
  return byKid;
}

async function keyFor(kid: string): Promise<KeyObject | null> {
  if (keys && Date.now() - keys.at < 60 * 60_000 && keys.byKid.has(kid)) return keys.byKid.get(kid)!;
  return (await loadKeys()).get(kid) ?? null;
}

const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

export interface DynamicSignIn {
  /** Dynamic's id for the person. */
  userId: string;
  email: string;
  evmAddress: string | null;
  solanaAddress: string | null;
  /** Every wallet the sign-in proves, by chain: an owner with several businesses holds one wallet each. */
  evmAddresses: string[];
  solanaAddresses: string[];
}

/** A Dynamic token, checked - or a 401 the dashboard shows as "sign in to your wallet again". */
export async function checkDynamicToken(token: string): Promise<DynamicSignIn> {
  if (!env.DYNAMIC_ENVIRONMENT_ID) throw new HttpError(503, "Business wallets aren't switched on yet.", "wallets_off");
  const bad = () => new HttpError(401, "Your wallet sign-in has expired. Sign in to your wallet again.", "wallet_signin");
  const pieces = token.split(".");
  if (pieces.length !== 3) throw bad();
  let header: { alg?: string; kid?: string }, claims: Record<string, any>;
  try {
    header = part(pieces[0]!);
    claims = part(pieces[1]!);
  } catch {
    throw bad();
  }
  if (header.alg !== "RS256" || !header.kid) throw bad();
  const key = await keyFor(header.kid);
  if (!key) throw bad();
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${pieces[0]}.${pieces[1]}`);
  if (!verifier.verify(key, Buffer.from(pieces[2]!, "base64url"))) throw bad();
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now - 30) throw bad();
  // Signed for this environment, not another (the app's, say).
  const envOf = String(claims.environment_id ?? claims.iss ?? "");
  if (!envOf.includes(env.DYNAMIC_ENVIRONMENT_ID)) throw bad();

  const creds: { address?: string; chain?: string; format?: string; email?: string }[] = Array.isArray(claims.verified_credentials) ? claims.verified_credentials : [];
  const wallets = creds.filter((c) => c.format === "blockchain" && c.address);
  const email = String(claims.email ?? creds.find((c) => c.format === "email")?.email ?? "").trim().toLowerCase();
  const evmAddresses = wallets.filter((c) => /^(eip155|evm)$/i.test(String(c.chain))).map((c) => String(c.address));
  const solanaAddresses = wallets.filter((c) => /^(solana|sol)$/i.test(String(c.chain))).map((c) => String(c.address));
  const evm = evmAddresses[0] ?? null;
  const sol = solanaAddresses[0] ?? null;
  if (!claims.sub || !email) throw bad();
  return { userId: String(claims.sub), email, evmAddress: evm, solanaAddress: sol, evmAddresses, solanaAddresses };
}
