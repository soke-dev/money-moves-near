import { env } from "../config/env";

/**
 * Blocks sign-ups from disposable / throwaway email providers, which are the
 * usual source of scripted fake accounts (e.g. the @tosagree.com spam wave).
 *
 * Add more domains at runtime via the BLOCKED_EMAIL_DOMAINS env var
 * (comma-separated) without touching this list.
 */
const BUILTIN_BLOCKED = new Set<string>([
  // Seen in the wild against this app
  "tosagree.com",
  // Common disposable / temp-mail providers
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "grr.la",
  "spam4.me",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "tempmailo.com",
  "tempr.email",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "throwawaymail.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "mintemail.com",
  "moakt.com",
  "inboxbear.com",
  "discard.email",
  "byom.de",
]);

/** Returns true if the email's domain is a known disposable/blocked provider. */
export function isDisposableEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return false;
  return BUILTIN_BLOCKED.has(domain) || env.BLOCKED_EMAIL_DOMAINS.includes(domain);
}
