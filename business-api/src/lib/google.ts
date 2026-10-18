/**
 * Google sign-in: the dashboard's Google button hands us an ID token, and
 * Google's own library checks its signature, issuer, expiry and that it was
 * minted for our client. Only a verified email is accepted.
 */
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { HttpError } from "./http";

const client = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

export async function verifyGoogle(idToken: string) {
  if (!client) throw new HttpError(404, "Google sign-in isn't switched on.", "google_off");
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID }).catch(() => null);
  const p = ticket?.getPayload();
  if (!p?.sub || !p.email || !p.email_verified) throw new HttpError(401, "Google couldn't confirm this account.", "google_unverified");
  return { sub: p.sub, email: p.email.trim().toLowerCase(), firstName: p.given_name ?? null, lastName: p.family_name ?? null };
}
