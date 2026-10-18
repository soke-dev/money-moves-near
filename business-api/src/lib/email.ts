/**
 * Email, through Resend - in the same look as the Money Moves app's: a white
 * card on paper, the mark and a quiet label up top, one clear heading, hairline
 * rows, then the small print. Inline-styled tables, because that's the only
 * thing every mail client agrees on; no webfonts, no background images.
 *
 * Every email goes out as HTML and as plain text. Anything sent with text
 * alone is laid out in the card from that text, so nothing goes out bare.
 *
 * In development without a key the message is printed instead, so sign-in can
 * be tried locally - and only there: staging and production refuse to start
 * without a key (see config/env).
 */
import { Resend } from "resend";
import { env, isDev } from "../config/env";
import { log } from "./log";

/** An address as logs show it: enough to tell who, not enough to harvest. */
const masked = (to: string) => to.replace(/^(.{2}).*(@.*)$/, "$1***$2");

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const PAPER = "#EFEFEB";
const CARD = "#FFFFFF";
const INK = "#0B0D0A";
const BODY = "#5F6557";
const DIM = "#8A8F82";
const FAINT = "#A3A89C";
const RULE = "#EDEEE8";
const LINK = "#33600C";
const AMBER = "#C9781C";
const SANS = "-apple-system,'Segoe UI',system-ui,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";
// The app's mark, hosted with the app. Gmail hides images until allowed, so the alt carries the name.
const MARK = "https://app.usemoneymoves.xyz/images/logo.png";
export const SUPPORT = "support@usemoneymoves.xyz";

/** Where the dashboard lives, for buttons in emails. */
export const dashboardUrl = (path = "/dashboard") => `${env.ALLOWED_ORIGINS[0] ?? "http://localhost:5174"}${path}`;

/** Anything from user data goes through this. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── The pieces ───────────────────────────────────────────────────── */

/** The card. `label` is the small mono word top-right; `preheader` the line inboxes show after the subject. */
export function shell(o: { label: string; preheader: string; body: string }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${CARD};border-radius:14px;">
        <tr><td style="padding:26px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="34" style="padding:0;"><img src="${MARK}" width="30" height="30" alt="Money Moves" style="display:block;width:30px;height:30px;border-radius:8px;border:0;"></td>
            <td style="padding-left:10px;font-size:14.5px;font-weight:600;letter-spacing:-0.2px;color:${INK};">money moves <span style="font-weight:500;color:${FAINT};">business</span></td>
            <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.8px;color:${FAINT};">${esc(o.label.toUpperCase())}</td>
          </tr></table>
        </td></tr>
        ${o.body}
      </table>
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td style="padding:16px 28px 0;text-align:center;font-size:11px;line-height:1.6;color:${FAINT};">
          © ${new Date().getFullYear()} Money Moves Business · <a href="mailto:${SUPPORT}" style="color:${FAINT};text-decoration:underline;">${SUPPORT}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** The opening block when there's no figure to lead with. Takes HTML for the sub. */
export function heading(title: string, sub?: string) {
  return `<tr><td style="padding:32px 28px 0;">
    <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:-0.8px;line-height:1.2;color:${INK};">${esc(title)}</p>
    ${sub ? `<p style="margin:12px 0 0;font-size:14.5px;line-height:1.65;color:${BODY};">${sub}</p>` : ""}
  </td></tr>`;
}

/** The opening block of a receipt: what happened, in one figure. */
export function hero(o: { eyebrow: string; figure: string; sub?: string }) {
  return `<tr><td style="padding:32px 28px 0;">
    <p style="margin:0;font-size:13px;letter-spacing:0.2px;color:${DIM};">${esc(o.eyebrow)}</p>
    <p style="margin:8px 0 0;font-size:40px;font-weight:700;letter-spacing:-1.5px;line-height:1.05;color:${INK};">${esc(o.figure)}</p>
    ${o.sub ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:${BODY};">${o.sub}</p>` : ""}
  </td></tr>`;
}

/** A plain paragraph. Takes HTML. */
export function para(html: string) {
  return `<tr><td style="padding:14px 28px 0;"><p style="margin:0;font-size:14px;line-height:1.65;color:${BODY};">${html}</p></td></tr>`;
}

/** Something quoted from our team - a note, a reason - behind a thin rule. */
export function quote(text: string, tone: "plain" | "warn" = "plain") {
  return `<tr><td style="padding:18px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="3" style="background:${tone === "warn" ? AMBER : RULE};font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:2px 0 2px 14px;"><p style="margin:0;font-size:14px;line-height:1.65;color:${INK};white-space:pre-line;">${esc(text)}</p></td>
    </tr></table>
  </td></tr>`;
}

/** Hairline rows of what happened. */
export function rows(list: { k: string; v: string; mono?: boolean; strong?: boolean }[]) {
  const cells = list
    .map((r, i) => {
      const edge = `border-top:1px solid ${RULE};${i === list.length - 1 ? `border-bottom:1px solid ${RULE};` : ""}`;
      return `<tr>
        <td style="padding:11px 0;color:${r.strong ? INK : BODY};${r.strong ? "font-weight:600;" : ""}${edge}">${esc(r.k)}</td>
        <td align="right" style="padding:11px 0;color:${INK};${r.strong ? "font-weight:700;" : ""}${r.mono ? `font-family:${MONO};` : ""}${edge}">${esc(r.v)}</td>
      </tr>`;
    })
    .join("");
  return `<tr><td style="padding:24px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">${cells}</table></td></tr>`;
}

/** Numbered first steps. */
export function steps(list: [string, string][]) {
  const cells = list
    .map(
      ([title, body], i) => `<tr>
      <td width="30" valign="top" style="font-family:${MONO};font-size:11px;letter-spacing:1px;color:${FAINT};padding:0 0 ${i === list.length - 1 ? 4 : 18}px;">${String(i + 1).padStart(2, "0")}</td>
      <td style="padding:0 0 ${i === list.length - 1 ? 4 : 18}px;">
        <p style="margin:0;font-size:15px;font-weight:600;color:${INK};">${esc(title)}</p>
        <p style="margin:4px 0 0;font-size:13.5px;line-height:1.6;color:${BODY};">${esc(body)}</p>
      </td>
    </tr>`,
    )
    .join("");
  return `<tr><td style="padding:24px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table></td></tr>`;
}

/** The one thing to do next. */
export function button(label: string, url: string) {
  return `<tr><td style="padding:26px 28px 0;">
    <a href="${esc(url)}" style="display:inline-block;background:${INK};color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px;">${esc(label)}</a>
  </td></tr>`;
}

export function divider() {
  return `<tr><td style="padding:26px 28px 0;"><div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div></td></tr>`;
}

/** Closing small print. Takes HTML. */
export function fine(html: string) {
  return `<tr><td style="padding:18px 28px 26px;"><p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">${html}</p></td></tr>`;
}

export const supportLine = () => `Questions reach a person, not a bot: <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>`;

/* ─── From plain text ──────────────────────────────────────────────── */

/** Links and email addresses in plain text, made clickable - after escaping. */
function linkify(escaped: string) {
  return escaped
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u) => `<a href="${u}" style="color:${LINK};text-decoration:none;border-bottom:1px solid #C3DDA0;">${u}</a>`)
    .replace(/(^|[\s(])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi, (_m, pre: string, e: string) => `${pre}<a href="mailto:${e}" style="color:${LINK};text-decoration:none;">${e}</a>`);
}

/** A text-only email laid out in the card: the subject as its heading, the text as paragraphs, the sign-off dropped. */
export function fromText(subject: string, text: string, o: { label?: string; cta?: { label: string; url: string } }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b && !/^-?\s*Money Moves( Business)?$/.test(b));
  const body = blocks.map((b) => para(linkify(esc(b)).replace(/\n/g, "<br>"))).join("");
  return shell({
    label: o.label ?? "Business",
    preheader: (blocks[0] ?? subject).slice(0, 140),
    body: `${heading(subject)}${body}${o.cta ? button(o.cta.label, o.cta.url) : ""}${fine(supportLine())}`,
  });
}

/* ─── Sending ──────────────────────────────────────────────────────── */

/** Sends it, and says whether it went. With no HTML of its own, it's laid out from the text. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  opts: { replyTo?: string; html?: string; label?: string; cta?: { label: string; url: string } } = {},
): Promise<boolean> {
  if (!resend) {
    if (isDev) console.log(`\n[email:dev] to ${to}\n  ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    return isDev;
  }
  const html = opts.html ?? fromText(subject, text, opts);
  const { error } = await resend.emails.send({ from: env.EMAIL_FROM, to, subject, text, html, ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) });
  // Never the subject: it can carry a code.
  if (error) log.error("[email] send failed", { to: masked(to), reason: error.message });
  return !error;
}

/* ─── The emails with a shape of their own ─────────────────────────── */

/** The code email - the code, big and spaced, how long it lasts, and what to do if it wasn't you. */
const CODE_WORDS = {
  VERIFY_EMAIL: ["confirm your email", "Your code to confirm your email"],
  SIGN_IN: ["finish signing in", "Your sign-in code"],
  RESET_PASSWORD: ["reset your password", "Your code to reset your password"],
  RESET_WALLET_PIN: ["reset your business wallet's transfer PIN", "Your code to reset your wallet PIN"],
} as const;

export function codeEmail(purpose: keyof typeof CODE_WORDS, code: string) {
  const [what, lead] = CODE_WORDS[purpose];
  return {
    subject: `${code} is your Money Moves Business code`,
    text: `Use ${code} to ${what}. It works for 10 minutes.\n\nIf this wasn't you, you can ignore this email. Nothing happens without the code.`,
    html: shell({
      label: "Security",
      preheader: `Use it to ${what}. It works for 10 minutes.`,
      body: `<tr><td style="padding:34px 28px 0;">
        <p style="margin:0;font-size:13px;letter-spacing:0.2px;color:${DIM};">${esc(lead)}</p>
        <div style="font-family:${MONO};font-size:46px;font-weight:500;letter-spacing:12px;color:${INK};padding:18px 0 10px;">${esc(code)}</div>
        <p style="margin:0;font-size:13px;color:${DIM};">Works for 10 minutes · once</p>
      </td></tr>
      ${divider()}
      <tr><td style="padding:18px 28px 28px;">
        <p style="margin:0 0 10px;font-size:13px;line-height:1.65;color:${BODY};">If this wasn't you, ignore this email - nothing happens without the code.</p>
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">Nobody at Money Moves will ever ask you for it. Not support, not on a call. <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a></p>
      </td></tr>`,
    }),
  };
}

/** Welcome, once the email is confirmed: what to do first, and that test mode works now. */
export function welcomeEmail(firstName: string | null) {
  const hello = firstName ? `Welcome, ${firstName}.` : "Welcome.";
  const first: [string, string][] = [
    ["Verify your business", "Tell us who you are and what you sell. Our review team usually responds within 24 hours."],
    ["Add where you get paid", "Your bank account, and your Money Moves account, if you like."],
    ["Take your first payment", "Test mode works from now: make a payment link and pay it with the test buttons. Nothing real moves."],
  ];
  return {
    subject: "Welcome to Money Moves Business",
    text: `${hello}\n\nYour account is ready. Three things to do first:\n\n${first.map(([t, b], i) => `${i + 1}. ${t}: ${b}`).join("\n")}\n\nOpen your dashboard: ${dashboardUrl()}\n\nQuestions reach a person, not a bot: ${SUPPORT}`,
    html: shell({
      label: "Welcome",
      preheader: "Your account is ready. Three things to do first.",
      body: `<tr><td style="padding:34px 28px 0;">
          <p style="margin:0;font-size:38px;font-weight:700;letter-spacing:-1.4px;line-height:1.05;color:${INK};">${esc(hello)}</p>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${BODY};">Your account is ready. Take payments by bank transfer, the Money Moves app or crypto, and get them where you want them, the moment they're paid. Three things to do first.</p>
        </td></tr>
        ${divider()}
        ${steps(first)}
        ${button("Open your dashboard", dashboardUrl())}
        ${divider()}
        ${fine(supportLine())}`,
    }),
  };
}

/** Approved: live mode is theirs. */
export function approvedEmail(businessName: string) {
  return {
    subject: `${businessName} is approved`,
    text: `Good news, ${businessName} is approved.\n\nSwitch to live mode in your dashboard to take real payments: ${dashboardUrl()}\n\nYour test links and settings stay as they are.`,
    html: shell({
      label: "Approved",
      preheader: "Switch to live mode to take real payments.",
      body: `${heading(`${businessName} is approved`, "Good news. Your business is verified. Switch to live mode in your dashboard to start taking real payments.")}
        ${rows([
          { k: "Business", v: businessName },
          { k: "Status", v: "Verified", strong: true },
        ])}
        ${button("Go live", dashboardUrl())}
        ${fine(`Your test links and settings stay as they are, in test mode. ${supportLine()}`)}`,
    }),
  };
}

/** The customer's receipt for a paid checkout - sent by us, on the business's behalf. */
export function receiptEmail(o: {
  business: string;
  amount: string;
  approx?: string | null;
  what?: string | null;
  method: string;
  reference: string;
  paidAt: Date;
  tx?: { short: string; url: string | null } | null;
  note?: string | null;
  /** The receipt's own page, to view or download. */
  link?: string | null;
}) {
  const when = o.paidAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  const list = [
    { k: "Paid to", v: o.business },
    ...(o.what ? [{ k: "For", v: o.what }] : []),
    { k: "Paid with", v: o.method },
    { k: "Reference", v: o.reference, mono: true },
    { k: "Date", v: when },
    ...(o.tx ? [{ k: "Transaction", v: o.tx.short, mono: true }] : []),
    { k: "Amount", v: o.amount, strong: true },
  ];
  return {
    subject: `Your receipt from ${o.business}`,
    text: [`You paid ${o.business} ${o.amount}.`, "", ...list.map((r) => `${r.k}: ${r.v}`), ...(o.tx?.url ? ["", `On chain: ${o.tx.url}`] : []), ...(o.note ? ["", o.note] : [])].join("\n"),
    html: shell({
      label: "Receipt",
      preheader: `${o.business} has your payment of ${o.amount}.`,
      body: `${hero({ eyebrow: `You paid ${o.business}`, figure: o.amount, sub: o.approx ? esc(o.approx) : undefined })}
        ${o.note ? quote(o.note) : ""}
        ${rows(list)}
        ${o.link ? button("View your receipt", o.link) : ""}
        ${fine(`This receipt comes from Money Moves on behalf of ${esc(o.business)}. Questions about your order go to them, reply to this email. ${supportLine()}`)}`,
    }),
  };
}

/** To the business's owners: a payment came in, with the way to it in their dashboard. */
export function paymentReceivedEmail(o: { business: string; amount: string; approx?: string | null; what?: string | null; method: string; reference: string; payer?: string | null; paidAt: Date }) {
  const when = o.paidAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
  const list = [
    ...(o.payer ? [{ k: "From", v: o.payer }] : []),
    ...(o.what ? [{ k: "For", v: o.what }] : []),
    { k: "Paid with", v: o.method },
    { k: "Reference", v: o.reference, mono: true },
    { k: "Date", v: when },
    { k: "Amount", v: o.amount, strong: true },
  ];
  const url = dashboardUrl(`/transactions?q=${encodeURIComponent(o.reference)}`);
  return {
    subject: `${o.amount} received${o.payer ? ` from ${o.payer}` : ""}`,
    text: [`${o.business} received ${o.amount}.`, "", ...list.map((r) => `${r.k}: ${r.v}`), "", `See it in your dashboard: ${url}`].join("\n"),
    html: shell({
      label: "Payment received",
      preheader: `${o.amount} for ${o.business}. It settles on its own.`,
      body: `${hero({ eyebrow: `${o.business} received`, figure: o.amount, sub: o.approx ? esc(o.approx) : undefined })}
        ${rows(list)}
        ${button("View in your dashboard", url)}
        ${fine(`It settles to you on its own. You'll see it under Settlements. ${supportLine()}`)}`,
    }),
  };
}

/** A note from our team: a change to make, or why it wasn't approved. */
export function decisionEmail(kind: "changes" | "reject", businessName: string, note: string) {
  if (kind === "changes")
    return {
      subject: `One change for ${businessName}'s application`,
      text: `Our review team needs a change before ${businessName} can go live:\n\n${note}\n\nOpen your dashboard and go to Activate to update it, everything else you sent is kept: ${dashboardUrl("/verify")}`,
      html: shell({
        label: "Review",
        preheader: "One change and you're back with our review team.",
        body: `${heading("One change, then we'll finish", `Our review team needs a change before ${esc(businessName)} can go live:`)}
          ${quote(note, "warn")}
          ${para("Everything else you sent is kept. Only this needs your attention.")}
          ${button("Make the change", dashboardUrl("/verify"))}
          ${fine(supportLine())}`,
      }),
    };
  return {
    subject: `About ${businessName}'s application`,
    text: `We can't approve ${businessName} right now:\n\n${note}\n\nReply to this email if you'd like to talk it through.`,
    html: shell({
      label: "Review",
      preheader: `We can't approve ${businessName} right now.`,
      body: `${heading(`We can't approve ${businessName} right now`, "Our review team looked carefully. Here's why:")}
        ${quote(note)}
        ${fine(`Reply to this email if you'd like to talk it through. ${supportLine()}`)}`,
    }),
  };
}

/** The application is with our team. */
export function submittedEmail(businessName: string) {
  return {
    subject: `${businessName} is with our review team`,
    text: `Thanks. We've got everything we need to review ${businessName}.\n\nOur review team usually responds within 24 hours, and we'll email you the moment it's done. Test mode stays yours meanwhile.`,
    html: shell({
      label: "In review",
      preheader: "Our review team usually responds within 24 hours.",
      body: `${heading("Application submitted", `Thanks. We've got everything we need to review ${esc(businessName)}.`)}
        ${steps([
          ["In review", "Our review team usually responds within 24 hours."],
          ["We email you", "The moment it's done, or if we need anything else."],
          ["You go live", "Switch to live mode and take real payments. Test mode stays yours meanwhile."],
        ])}
        ${button("Open your dashboard", dashboardUrl())}
        ${fine(supportLine())}`,
    }),
  };
}
