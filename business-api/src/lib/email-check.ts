/**
 * Whether an email can open a business account.
 *
 * Any real inbox can - a freelancer's Gmail as much as a company domain - so
 * this only turns away the ones made to be thrown away. Three questions:
 *
 *  - Is the domain on the public list of disposable-mail domains?
 *  - Does its mail go to a throwaway-inbox service? Those services keep minting
 *    new domain names (maxxspace.com was one, delivered by mail.tm), so a list
 *    of names is always behind - but they all point their mail at the same few
 *    servers, and the domain's mail record says so on day one.
 *  - Can it receive mail at all? A domain with no mail server can't.
 *
 * If DNS doesn't answer, the address is let through: a slow resolver must never
 * cost a real business its sign-up. Verification still stands between any
 * account and live money.
 */
import { promises as dns } from "dns";
import { createRequire } from "module";

const requireJson = createRequire(__filename);
const DISPOSABLE: Set<string> = new Set(requireJson("disposable-email-domains") as string[]);

/** The mail servers behind throwaway-inbox services, matched by their host's ending. */
const THROWAWAY_MX = [
  "mail.tm", "mail.gw", "guerrillamail.com", "sharklasers.com", "mailinator.com", "temp-mail.org", "tempmail.plus",
  "tempmail.dev", "tmail.ws", "1secmail.com", "10minutemail.com", "yopmail.com", "dispostable.com", "emailondeck.com",
  "maildrop.cc", "getnada.com", "mohmal.com", "trashmail.com", "mailnesia.com", "moakt.com", "tempr.email",
  "fakemail.net", "emailfake.com", "inboxkitten.com", "tempmailo.com", "internxt.com", "burnermail.io",
];
/** Domains we've seen abused that the lists don't know yet. */
const EXTRA_BLOCKED = ["maxxspace.com"];

const endsWithHost = (host: string, suffix: string) => host === suffix || host.endsWith("." + suffix);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

export type EmailVerdict = { ok: true } | { ok: false; reason: "disposable" | "no_mail" };

export async function checkSignupEmail(email: string): Promise<EmailVerdict> {
  const domain = email.split("@")[1]?.trim().toLowerCase() ?? "";
  if (!domain) return { ok: false, reason: "no_mail" };
  const extra = (process.env.BLOCKED_EMAIL_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (DISPOSABLE.has(domain) || EXTRA_BLOCKED.includes(domain) || extra.includes(domain)) return { ok: false, reason: "disposable" };

  let mx: { exchange: string }[] | "timeout";
  try {
    mx = await withTimeout(dns.resolveMx(domain), 4_000);
  } catch (e: any) {
    // The domain exists but has no mail server, or doesn't exist at all.
    if (e?.code === "ENODATA" || e?.code === "ENOTFOUND") return { ok: false, reason: "no_mail" };
    return { ok: true };
  }
  if (mx === "timeout") return { ok: true };
  if (!mx.length) return { ok: false, reason: "no_mail" };
  const hosts = mx.map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
  if (hosts.some((h) => THROWAWAY_MX.some((s) => endsWithHost(h, s)) || DISPOSABLE.has(h.split(".").slice(-2).join(".")))) {
    return { ok: false, reason: "disposable" };
  }
  return { ok: true };
}
