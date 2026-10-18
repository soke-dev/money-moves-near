/**
 * dynamic.ts — verifies Dynamic.xyz login JWTs on the backend.
 *
 * The mobile app logs the user in with Dynamic (email OTP) and receives a signed
 * access-token JWT (`dynamicClient.auth.token`). It sends that to POST /auth/dynamic,
 * and we verify it here against Dynamic's public JWKS (RS256) before trusting the
 * email claim. No secret/API key is needed — JWKS is public, keyed by the
 * environment id (see config/dynamic.ts on the client).
 */
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

// Public environment id (safe to hardcode; overridable via env).
const DYNAMIC_ENV_ID =
  process.env.DYNAMIC_ENVIRONMENT_ID || "fc3e249c-2359-4773-8334-571176f9d8ea";

const JWKS_URI = `https://app.dynamic.xyz/api/v0/sdk/${DYNAMIC_ENV_ID}/.well-known/jwks`;

const client = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 60 * 60 * 1000, // 1 hour
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err || new Error("Signing key not found"));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

export interface DynamicClaims {
  email: string;
  dynamicUserId: string; // JWT `sub`
  /** The wallets Dynamic signed into the token as this user's - the only proof of whose an address is. */
  evmAddresses: string[];
  solanaAddresses: string[];
}

/**
 * Verify a Dynamic access-token JWT and extract the verified email.
 * Throws if the signature/claims are invalid or no email is present.
 */
export async function verifyDynamicToken(token: string): Promise<DynamicClaims> {
  const decoded: any = await new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, payload) => {
      if (err) reject(err);
      else resolve(payload);
    });
  });

  // Dynamic exposes the email at the top level and/or inside verified_credentials.
  let email: string | undefined =
    typeof decoded?.email === "string" ? decoded.email : undefined;
  if (!email && Array.isArray(decoded?.verified_credentials)) {
    const cred = decoded.verified_credentials.find(
      (c: any) => c?.email || c?.format === "email"
    );
    email = cred?.email;
  }
  if (!email) throw new Error("No email claim in Dynamic token");

  const creds: any[] = Array.isArray(decoded?.verified_credentials) ? decoded.verified_credentials : [];
  const wallets = creds.filter((c) => c?.format === "blockchain" && typeof c?.address === "string" && c.address);
  const evmAddresses = wallets.filter((c) => /^(eip155|evm)$/i.test(String(c.chain))).map((c) => String(c.address));
  const solanaAddresses = wallets.filter((c) => /^(solana|sol)$/i.test(String(c.chain))).map((c) => String(c.address));

  return { email: email.toLowerCase().trim(), dynamicUserId: String(decoded?.sub || ""), evmAddresses, solanaAddresses };
}

export const isDynamicConfigured = !!DYNAMIC_ENV_ID;
