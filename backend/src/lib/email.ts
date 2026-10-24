import { Resend } from "resend";
import { assetLabel } from "./asset";
import { env } from "../config/env";
import { isPaused } from "./service-status";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  /** Resend takes the bytes; `content` is the file itself, not a link. */
  attachments?: { filename: string; content: Buffer }[];
}

async function sendEmail({ to, subject, html, attachments }: SendEmailParams): Promise<void> {
  if (!resend) {
    // Dev mode — log to console instead of sending
    console.log(`[DEV EMAIL] To: ${to} | Subject: ${subject}`);
    if (attachments?.length) {
      console.log(
        `[DEV EMAIL] attachments: ${attachments
          .map((a) => `${a.filename} (${(a.content.length / 1024).toFixed(0)} KB)`)
          .join(", ")}`,
      );
    }
    console.log(html);
    return;
  }

  // Strip HTML tags to create a plain-text fallback
  const text = html
    .replace(/<style[^>]*>.*?<\/style>/gs, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const { data, error } = await resend.emails.send({
    from: `${env.APP_NAME} <${env.EMAIL_FROM}>`,
    replyTo: env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    ...(attachments?.length ? { attachments } : {}),
    headers: {
      "List-Unsubscribe": `<mailto:${env.EMAIL_FROM}?subject=unsubscribe>`,
    },
  });

  // Resend SDK v4 returns { data, error } instead of throwing. If we don't
  // check here, send failures (invalid API key, unverified `from` domain,
  // rate limits) get silently swallowed — callers think the email went out.
  if (error) {
    console.error(`[EMAIL] send to=${to} subject="${subject}" failed:`, error);
    throw new Error(`Email send failed: ${error.message || error.name}`);
  }

  if (data?.id) {
    console.log(`[EMAIL] sent to=${to} subject="${subject}" id=${data.id}`);
  }
}

/**
 * Every receipt goes through here, and only receipts do.
 *
 * Sign-in codes, password and PIN resets and wallet export codes call
 * sendEmail directly, so switching this off cannot lock anybody out of their
 * own account. That separation is what makes it safe to put a button on.
 *
 * The switch is a row now, readable from the console, with the environment
 * flag still winning over it. A failed read leaves receipts sending, which is
 * the right way for this one to fail.
 */
async function sendTransactionalEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  if (await isPaused("emails")) {
    console.log(`[EMAIL] transaction emails are off — skipped to=${to} subject="${subject}"`);
    return;
  }
  await sendEmail({ to, subject, html });
}

/* ═══════════════════════════════════════════════════════════
   THE SHELL
   ═══════════════════════════════════════════════════════════

   One white card for every email we send, built on four rules:

   1. The amount is the headline. A figure in ink at 42px, not a status in a
      coloured banner — "Withdrawal Successful" tells nobody anything they
      could not read in the subject line.
   2. Green once, in the mark. Links take a deep green that holds on white;
      lime is a screen colour and washes out on paper.
   3. Ledger, then stub. Hairline rows for what happened, then the reference
      and timestamp below them — that stub is the part people quote to support.
   4. Say it in the subject. "0.2 USDC sent to 0xdcac4b…" reads on a lock
      screen; prefixing every subject with the app name spends the first three
      words repeating the sender field.

   Everything is inline-styled tables because that is the only thing every
   mail client agrees on. No webfonts (Gmail strips them), no background
   images, no CSS that matters.
   ═══════════════════════════════════════════════════════════ */

const PAPER = "#EFEFEB";
const CARD = "#FFFFFF";
const INK = "#0B0D0A";
const BODY = "#5F6557";
const DIM = "#8A8F82";
const FAINT = "#A3A89C";
const RULE = "#EDEEE8";
const RULE_STRONG = "#D8DBD1";
const LINK = "#33600C";
const AMBER = "#C9781C";

const SANS = "-apple-system,'Segoe UI',system-ui,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,monospace";

// Hosted alongside the web app. Gmail hides images until the reader allows
// them, which is why the alt text has to carry the name on its own.
const MARK = "https://app.usemoneymoves.xyz/images/logo.png";
const SUPPORT = "support@usemoneymoves.xyz";

/** Anything interpolated from user data goes through this. */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chainName(chain: string): string {
  switch (chain) {
    case "MOVE": return "Movement";
    case "BASE": return "Base";
    case "BEP20": return "BNB Smart Chain";
    case "SOL": return "Solana";
    case "ARB": return "Arbitrum";
    case "STELLAR": return "Stellar";
    case "ARC": return "Arc";
    case "TON": return "TON";
    case "MONAD": return "Monad";
    default: return chain;
  }
}

function explorerUrl(hash: string, chain: string): string | null {
  if (!hash) return null;
  switch (chain) {
    case "MOVE": return `https://explorer.movementnetwork.xyz/txn/${hash}`;
    case "BASE": return `https://basescan.org/tx/${hash}`;
    case "BEP20": return `https://bscscan.com/tx/${hash}`;
    case "ARB": return `https://arbiscan.io/tx/${hash}`;
    case "ARC": return `https://explorer.arc.io/tx/${hash}`;
    case "SOL": return `https://solscan.io/tx/${hash}`;
    // The event id rather than a transaction hash - a jetton transfer is
    // several transactions and tonviewer is the thing that groups them.
    case "TON": return `https://tonviewer.com/transaction/${hash}`;
    case "STELLAR": return `https://stellar.expert/explorer/public/tx/${hash}`;
    case "MONAD": return `https://monadscan.com/tx/${hash}`;
    default: return null;
  }
}

/** Addresses and hashes, shortened the way the app shortens them. */
function short(v: string, head = 8, tail = 6): string {
  if (!v) return "";
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

function naira(n: number, kobo = true): string {
  return `₦${n.toLocaleString("en-NG", {
    minimumFractionDigits: kobo ? 2 : 0,
    maximumFractionDigits: kobo ? 2 : 0,
  })}`;
}

/**
 * The card. `label` is the mono word top-right that says which kind of email
 * this is; `preheader` is the line the inbox shows after the subject, which is
 * otherwise scraped from whatever text comes first.
 */
function shell(opts: { label: string; preheader: string; body: string }): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${CARD};border-radius:14px;">
        <tr><td style="padding:26px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="34" style="padding:0;"><img src="${MARK}" width="30" height="30" alt="${esc(env.APP_NAME)}" style="display:block;width:30px;height:30px;border-radius:8px;border:0;"></td>
            <td style="padding-left:10px;font-size:14.5px;font-weight:600;letter-spacing:-0.2px;color:${INK};">money moves</td>
            <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.8px;color:${FAINT};">${esc(opts.label)}</td>
          </tr></table>
        </td></tr>
        ${opts.body}
      </table>
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
        <tr><td style="padding:16px 28px 0;text-align:center;font-size:11px;color:${FAINT};">
          © ${new Date().getFullYear()} ${esc(env.APP_NAME)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** A figure with its unit dropped back a shade. `credit` puts a green plus on it. */
function figure(value: string, unit?: string, credit = false): string {
  const plus = credit ? `<span style="color:${LINK};">+</span>` : "";
  const tail = unit ? ` <span style="font-weight:500;color:${DIM};">${esc(unit)}</span>` : "";
  return `${plus}${esc(value)}${tail}`;
}

/** The opening block of a receipt: what happened, in one figure. */
function hero(o: { eyebrow: string; figure: string; sub?: string }): string {
  return `<tr><td style="padding:32px 28px 0;">
    <p style="margin:0;font-size:13px;letter-spacing:0.2px;color:${DIM};">${esc(o.eyebrow)}</p>
    <p style="margin:8px 0 0;font-size:42px;font-weight:700;letter-spacing:-1.6px;line-height:1.05;color:${INK};">${o.figure}</p>
    ${o.sub ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.55;color:${BODY};">${o.sub}</p>` : ""}
  </td></tr>`;
}

/** The opening block when there is no figure to lead with. */
function heading(title: string, sub?: string): string {
  return `<tr><td style="padding:32px 28px 0;">
    <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.9px;line-height:1.15;color:${INK};">${title}</p>
    ${sub ? `<p style="margin:10px 0 0;font-size:14px;line-height:1.6;color:${BODY};">${sub}</p>` : ""}
  </td></tr>`;
}

interface LedgerRow {
  k: string;
  /** Already-escaped HTML when `raw`, plain text otherwise. */
  v: string;
  mono?: boolean;
  strong?: boolean;
  raw?: boolean;
}

/** Hairline rows. The last one closes with a rule so the stub reads as separate. */
function ledger(rows: LedgerRow[]): string {
  const cells = rows
    .map((r, i) => {
      const last = i === rows.length - 1;
      const edge = `border-top:1px solid ${RULE};${last ? `border-bottom:1px solid ${RULE};` : ""}`;
      const topEdge = r.strong ? edge.replace(RULE, RULE_STRONG) : edge;
      return `<tr>
        <td style="padding:11px 0;color:${r.strong ? INK : BODY};${r.strong ? "font-weight:600;" : ""}${topEdge}">${esc(r.k)}</td>
        <td align="right" style="padding:11px 0;color:${INK};${r.strong ? "font-weight:700;" : ""}${r.mono ? `font-family:${MONO};` : ""}${topEdge}">${r.raw ? r.v : esc(r.v)}</td>
      </tr>`;
    })
    .join("");
  return `<tr><td style="padding:26px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">${cells}</table>
  </td></tr>`;
}

/** Reference on the left, timestamp on the right, in the format support asks for. */
function stub(reference: string, date: string): string {
  return `<tr><td style="padding:18px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${MONO};font-size:10.5px;letter-spacing:0.6px;color:#9AA091;">
      <tr>
        <td>${esc(reference).toUpperCase()}</td>
        <td align="right">${esc(date).toUpperCase()}</td>
      </tr>
    </table>
  </td></tr>`;
}

/** Closing fine print. Takes HTML so it can carry the support link. */
function fine(html: string): string {
  return `<tr><td style="padding:18px 28px 26px;">
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">${html}</p>
  </td></tr>`;
}

/** A warning behind a thin amber rule, rather than inside a red box. */
function caution(html: string): string {
  return `<tr><td style="padding:22px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="3" style="background:${AMBER};font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:2px 0 2px 14px;">
        <p style="margin:0;font-size:13px;line-height:1.65;color:${BODY};">${html}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

function divider(): string {
  return `<tr><td style="padding:28px 28px 0;">
    <div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>`;
}

/**
 * One shell for every code we email: sign-in, PIN reset, wallet export, admin.
 * Mono at 46px with 12px tracking, because a code gets read off a lock screen
 * and typed, and the tracking is what chunks six digits into threes.
 */
function codeBlock(label: string, code: string, expiry: string): string {
  return `<tr><td style="padding:34px 28px 0;">
    <p style="margin:0;font-size:13px;letter-spacing:0.2px;color:${DIM};">${esc(label)}</p>
    <div style="font-family:${MONO};font-size:46px;font-weight:500;letter-spacing:12px;color:${INK};padding:18px 0 10px;">${esc(code)}</div>
    <p style="margin:0;font-size:13px;color:${DIM};">${esc(expiry)} · works once</p>
  </td></tr>`;
}

function codeEmail(opts: {
  label: string;
  subject: string;
  preheader: string;
  lead: string;
  code: string;
  expiry: string;
  reassure: string;
}): string {
  return shell({
    label: opts.label,
    preheader: opts.preheader,
    body: `
      ${codeBlock(opts.lead, opts.code, opts.expiry)}
      ${divider()}
      <tr><td style="padding:18px 28px 28px;">
        <p style="margin:0 0 10px;font-size:13px;line-height:1.65;color:${BODY};">${opts.reassure}</p>
        <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">Nobody at ${esc(env.APP_NAME)} will ever ask you for it. Not support, not on a call. <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a></p>
      </td></tr>
    `,
  });
}

/** A transaction row that links to the explorer when we can build the URL. */
function hashRow(txHash: string | null, chain: string): LedgerRow {
  if (!txHash) return { k: "Transaction", v: "Processing" };
  const url = explorerUrl(txHash, chain);
  if (!url) return { k: "Transaction", v: short(txHash), mono: true };
  return {
    k: "Transaction",
    mono: true,
    raw: true,
    v: `<a href="${esc(url)}" style="color:${LINK};text-decoration:none;border-bottom:1px solid #C3DDA0;">${esc(short(txHash))}</a>`,
  };
}

/* ═══════════════════════════════════════════════════════════
   CODES
   ═══════════════════════════════════════════════════════════ */

export async function sendVerificationEmail(to: string, code: string, _name?: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${code} is your sign-in code`,
    html: codeEmail({
      label: "SECURITY",
      subject: "",
      preheader: "Good for 10 minutes, for one sign-in.",
      lead: "Your sign-in code",
      code,
      expiry: "Expires in 10 minutes",
      reassure:
        "Didn't try to sign in? Nothing has happened and nothing will. The code is useless outside your inbox, so you can ignore this.",
    }),
  });
}

export async function sendPinResetEmail(to: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${code} is your code to reset your PIN`,
    html: codeEmail({
      label: "SECURITY",
      subject: "",
      preheader: "Good for 10 minutes. Your current PIN works until you change it.",
      lead: "Code to reset your PIN",
      code,
      expiry: "Expires in 10 minutes",
      reassure:
        "Didn't ask for this? Your PIN hasn't changed and nothing has moved. The code is useless outside your inbox, so you can ignore this.",
    }),
  });
}

export async function sendAdminLoginCode(to: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${code} is your admin login code`,
    html: codeEmail({
      label: "ADMIN",
      subject: "",
      preheader: "Good for 10 minutes, for one sign-in to the admin panel.",
      lead: "Code for the admin panel",
      code,
      expiry: "Expires in 10 minutes",
      reassure:
        "If this wasn't you, someone has your admin email and password. Say so now, before the code expires.",
    }),
  });
}

/**
 * Kept working, but nothing should be calling it: v2 signs in with an emailed
 * code and has no passwords to reset.
 */
export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${code} is your password reset code`,
    html: codeEmail({
      label: "SECURITY",
      subject: "",
      preheader: "Good for 10 minutes.",
      lead: "Code to reset your password",
      code,
      expiry: "Expires in 10 minutes",
      reassure: "Didn't ask for this? Nothing has changed. You can ignore this email.",
    }),
  });
}

export async function sendWalletExportCode(to: string, code: string): Promise<void> {
  await sendEmail({
    to,
    subject: `${code} is your wallet export code`,
    html: shell({
      label: "WALLET EXPORT",
      preheader: "Good for 5 minutes. Only enter it if you started the export yourself.",
      body: `
        ${codeBlock("Code to reveal your private keys", code, "Expires in 5 minutes")}
        ${caution(
          `<strong style="color:${INK};">Didn't start this?</strong> Someone with access to your account is trying to take your keys out. Change your PIN in Account, then Security, and email us now.`
        )}
        ${fine(
          `Your recovery phrase and private keys are yours alone. Nobody at ${esc(env.APP_NAME)} will ever ask for them, and neither will support. <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>`
        )}
      `,
    }),
  });
}

/* ═══════════════════════════════════════════════════════════
   ACCOUNT
   ═══════════════════════════════════════════════════════════ */

export async function sendWelcomeEmail(to: string, _name: string): Promise<void> {
  const step = (n: string, title: string, body: string, last = false) => `
    <tr>
      <td width="30" valign="top" style="font-family:${MONO};font-size:11px;letter-spacing:1px;color:${FAINT};padding:0 0 ${last ? 6 : 18}px;">${n}</td>
      <td style="padding:0 0 ${last ? 6 : 18}px;">
        <p style="margin:0;font-size:15px;font-weight:600;color:${INK};">${title}</p>
        <p style="margin:4px 0 0;font-size:13.5px;line-height:1.6;color:${BODY};">${body}</p>
      </td>
    </tr>`;

  await sendEmail({
    to,
    subject: `Welcome to ${env.APP_NAME}`,
    html: shell({
      label: `MEMBER SINCE ${new Date()
        .toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" })
        .toUpperCase()}`,
      preheader: "Your account is ready. Three things worth doing first.",
      body: `
        <tr><td style="padding:34px 28px 0;">
          <p style="margin:0;font-size:40px;font-weight:700;letter-spacing:-1.5px;line-height:1.05;color:${INK};">Welcome.</p>
          <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${BODY};">Your account is open and ready to use. Three things are worth doing first. Each takes a couple of minutes, and you only do them once.</p>
        </td></tr>
        ${divider()}
        <tr><td style="padding:20px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${step("01", "Verify your ID", "A NIN slip or Nigerian passport and a selfie to match it. It lifts every limit on your account.")}
            ${step("02", "Set your PIN and turn on Face ID", "Four digits to unlock the app and approve anything that moves money. Account, then Security.")}
            ${step("03", "Take your username", "People send to @you instead of a long address. No limit on those, and no verification needed.", true)}
          </table>
        </td></tr>
        ${divider()}
        <tr><td style="padding:16px 28px 26px;">
          <p style="margin:0 0 9px;font-size:13px;line-height:1.65;color:${BODY};">The wallet in your account is self-custodial. The key is split so nobody, us included, ever holds a whole one, and you can export it whenever you want.</p>
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">Questions reach a person, not a bot. <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a></p>
        </td></tr>
      `,
    }),
  });
}

export async function sendLoginAlertEmail(to: string, device: string, ip: string): Promise<void> {
  const time = new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const deviceName = device || "a new device";

  await sendEmail({
    to,
    subject: `New sign-in on ${deviceName}`,
    html: shell({
      label: "SECURITY",
      preheader: `${time} WAT. If that was you, there's nothing to do.`,
      body: `
        ${heading(
          `New sign-in on ${esc(deviceName)}`,
          "Someone signed in with a code sent to this inbox. If that was you, there's nothing to do."
        )}
        ${ledger([
          { k: "When", v: `${time} WAT` },
          { k: "Device", v: device || "Unknown" },
          { k: "IP address", v: ip || "Unknown", mono: true },
        ])}
        ${caution(
          `<strong style="color:${INK};">Wasn't you?</strong> Change your PIN in Account, then Security, and tell us. Your crypto sits in a wallet only your device can sign for, but don't wait on that.`
        )}
        ${fine(`${esc(env.APP_NAME)} · <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>`)}
      `,
    }),
  });
}

/**
 * The request to close is received; nothing has closed yet.
 *
 * Its real job is the warning. The wallet is self-custodial, so once the
 * account is closed and sign-in is gone, crypto left in it is far harder to
 * reach. The moment to say "move it first" is now, while the app still opens.
 * Sent through sendEmail, not the receipt path: switching receipts off must
 * not silence an account notice.
 */
export async function sendClosureRequestedEmail(to: string, requestedAt: Date): Promise<void> {
  const time = requestedAt.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });

  await sendEmail({
    to,
    subject: "We've received your request to close your account",
    html: shell({
      label: "ACCOUNT",
      preheader: "Move your crypto out first. You can still cancel.",
      body: `
        ${heading(
          "Closure requested",
          "We've received your request to close your account. A person on our team reviews every closure, and nothing changes until they do. Your account keeps working in the meantime."
        )}
        ${ledger([
          { k: "Requested", v: `${time} WAT` },
          { k: "Status", v: "Under review" },
        ])}
        ${caution(
          `<strong style="color:${INK};">Move your money out first.</strong> Send any crypto to another wallet, or export your wallet in Account, then Security, then Export wallet. Once the account is closed, you can no longer sign in to the app.`
        )}
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:${BODY};">Changed your mind? Open the app and go to Account, then My profile, and tap Cancel request. You can do this any time before we close the account.</p>
        </td></tr>
        ${fine(`Didn't ask for this? Email <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a> right away.`)}
      `,
    }),
  });
}

/**
 * The request to close was withdrawn; the account stays open.
 *
 * The person who asked already knows. This is for the case where it was not
 * them: a cancelled closure is what someone with access to the phone would do
 * to keep using an account its owner wanted shut.
 */
export async function sendClosureCancelledEmail(to: string, cancelledAt: Date): Promise<void> {
  const time = cancelledAt.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });

  await sendEmail({
    to,
    subject: "Your account closure request was cancelled",
    html: shell({
      label: "ACCOUNT",
      preheader: "Your account stays open. Nothing has changed.",
      body: `
        ${heading(
          "Closure request cancelled",
          "Your request to close your account has been cancelled. Your account stays open, and everything works as before."
        )}
        ${ledger([
          { k: "Cancelled", v: `${time} WAT` },
          { k: "Status", v: "Account open" },
        ])}
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:${BODY};">If you want to close your account later, go to Account, then My profile, and tap Request account deletion.</p>
        </td></tr>
        ${caution(
          `<strong style="color:${INK};">Didn't cancel this yourself?</strong> Someone may have access to your phone. Email <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a> right away.`
        )}
        ${fine(`${esc(env.APP_NAME)} · <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>`)}
      `,
    }),
  });
}

/**
 * The account is closed: sign-in, PIN and sessions are gone.
 *
 * Says what was removed and what had to be kept, because "closed" with no
 * detail reads as "deleted", and the law says the records stay. Ends with the
 * one thing a person can still do here, which is reach support.
 */
export async function sendAccountClosedEmail(to: string, closedAt: Date): Promise<void> {
  const time = closedAt.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "medium",
    timeStyle: "short",
  });

  await sendEmail({
    to,
    subject: `Your ${env.APP_NAME} account is closed`,
    html: shell({
      label: "ACCOUNT",
      preheader: "You can no longer sign in. Records are kept as the law requires.",
      body: `
        ${heading(
          "Your account is closed",
          "You can no longer sign in. Your PIN, sessions, username and saved details have been removed."
        )}
        ${ledger([{ k: "Closed", v: `${time} WAT` }])}
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13.5px;line-height:1.65;color:${BODY};">We keep your transaction history and identity records for five years, as anti-money-laundering rules require.</p>
        </td></tr>
        ${caution(
          `<strong style="color:${INK};">Wasn't you, or is there still crypto in your wallet?</strong> Email <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a> and we'll help.`
        )}
        ${fine(`Thank you for using ${esc(env.APP_NAME)}.`)}
      `,
    }),
  });
}

/* ═══════════════════════════════════════════════════════════
   RECEIPTS
   ═══════════════════════════════════════════════════════════ */

export async function sendFundingSuccessEmail(
  to: string,
  params: {
    amountNaira: number;
    cryptoAmount: string;
    asset: string;
    chain: string;
    fee: number;
    txHash: string | null;
    reference: string;
    date: string;
  }
): Promise<void> {
  const { amountNaira, cryptoAmount, asset, chain, fee, txHash, reference, date } = params;

  await sendTransactionalEmail({
    to,
    subject: `${cryptoAmount} ${asset} is in your wallet`,
    html: shell({
      label: "RECEIPT · BOUGHT",
      preheader: `Paid ${naira(amountNaira, false)}. Delivered on ${chainName(chain)}.`,
      body: `
        ${hero({
          eyebrow: "You bought",
          figure: figure(cryptoAmount, asset, true),
          sub: `Paid ${esc(naira(amountNaira, false))}, delivered to your ${esc(chainName(chain))} wallet`,
        })}
        ${ledger([
          { k: "You paid", v: naira(amountNaira), mono: true },
          { k: "Fee", v: fee > 0 ? naira(fee) : "None", mono: fee > 0 },
          { k: "Network", v: chainName(chain) },
          hashRow(txHash, chain),
        ])}
        ${stub(reference, date)}
        ${fine(
          `Keep this for your records. Something look wrong? Quote the reference above to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

export async function sendWithdrawalSuccessEmail(
  to: string,
  params: {
    amount: string;
    asset: string;
    chain: string;
    address: string;
    txHash: string | null;
    reference: string;
    date: string;
  }
): Promise<void> {
  const { amount, asset, chain, address, txHash, reference, date } = params;
  const addr = short(address);

  /**
   * Who actually paid to move it.
   *
   * On most chains the fee is a different asset and the treasury sponsors it,
   * so "gas on us" is true. On Arc the fee is the USDC being sent, and on TON
   * a relay takes its cut from the USDT being sent - the user pays, out of
   * the very thing they moved. Telling them otherwise on a receipt is the
   * sort of small untruth that makes somebody distrust the rest of it.
   *
   * The row is dropped rather than reworded: it is a fraction of a cent,
   * which does not earn a line on a receipt, and saying nothing is honest
   * where "gas on us" would not be.
   */
  const paysOwnFee = chain === "ARC" || chain === "TON";

  await sendTransactionalEmail({
    to,
    subject: `${amount} ${asset} sent to ${addr}`,
    html: shell({
      label: "RECEIPT · SENT",
      preheader: paysOwnFee
        ? `On ${chainName(chain)}.`
        : `On ${chainName(chain)}. Gas was on us.`,
      body: `
        ${hero({
          eyebrow: "You sent",
          figure: figure(amount, asset),
          sub: `to ${esc(addr)} on ${esc(chainName(chain))}`,
        })}
        ${ledger([
          { k: "Network", v: chainName(chain) },
          { k: "To", v: addr, mono: true },
          // Dropped on the chains that take their fee out of the asset
          // itself. It is a fraction of a cent, not worth a line, and "gas
          // on us" would be untrue there.
          ...(paysOwnFee ? [] : [{ k: "Network fee", v: "None, gas on us" }]),
          hashRow(txHash, chain),
        ])}
        ${stub(reference, date)}
        ${fine(
          `Didn't make this transfer? Reply with that reference, or write to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

/** Paying a business's checkout from the wallet: who was paid, for what, and the proof. */
export async function sendBusinessPaymentEmail(
  to: string,
  p: {
    payee: string;
    amount: string;
    asset: string;
    chain: string;
    txHash: string | null;
    reference: string;
    checkoutRef?: string | null;
    payFor?: string | null;
    priceLabel?: string | null;
    date: string;
  }
): Promise<void> {
  // Arc and TON take their fee out of what's sent - see the withdrawal receipt.
  const paysOwnFee = p.chain === "ARC" || p.chain === "TON";
  await sendTransactionalEmail({
    to,
    subject: `You paid ${p.payee} ${p.amount} ${p.asset}`,
    html: shell({
      label: "RECEIPT · PAID",
      preheader: `${p.payee} has your payment, on ${chainName(p.chain)}.`,
      body: `
        ${hero({
          eyebrow: `You paid ${p.payee}`,
          figure: figure(p.amount, p.asset),
          sub: p.payFor ? esc(p.payFor) : `on ${esc(chainName(p.chain))}`,
        })}
        ${ledger([
          { k: "Paid to", v: p.payee },
          ...(p.payFor ? [{ k: "For", v: p.payFor }] : []),
          ...(p.priceLabel ? [{ k: "Priced at", v: p.priceLabel }] : []),
          { k: "Network", v: chainName(p.chain) },
          ...(p.checkoutRef ? [{ k: "Checkout reference", v: p.checkoutRef, mono: true }] : []),
          ...(paysOwnFee ? [] : [{ k: "Network fee", v: "None, gas on us" }]),
          hashRow(p.txHash, p.chain),
        ])}
        ${stub(p.reference, p.date)}
        ${fine(
          `Questions about the order go to ${esc(p.payee)}. Didn't make this payment? Reply with that reference, or write to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

export async function sendTransferOutEmail(
  to: string,
  params: {
    amount: string;
    asset: string;
    chain: string;
    recipientUsername: string;
    reference: string;
    date: string;
  }
): Promise<void> {
  const { amount, asset, chain, recipientUsername, reference, date } = params;

  await sendTransactionalEmail({
    to,
    subject: `You sent @${recipientUsername} ${amount} ${asset}`,
    html: shell({
      label: "RECEIPT · SENT",
      preheader: `Straight to their wallet on ${chainName(chain)}. No fee.`,
      body: `
        ${hero({
          eyebrow: "You sent",
          figure: figure(amount, asset),
          sub: `to @${esc(recipientUsername)}, straight into their wallet`,
        })}
        ${ledger([
          { k: "To", v: `@${recipientUsername}`, strong: false },
          { k: "Network", v: chainName(chain) },
          { k: "Fee", v: "None" },
        ])}
        ${stub(reference, date)}
        ${fine(
          // No offer to trace it. The transfer is already on chain and named
          // in this receipt, so "we can tell you where it went" promised a
          // service that adds nothing and invites a mail we cannot act on.
          `A transfer on chain cannot be reversed.`
        )}
      `,
    }),
  });
}

export async function sendTransferInEmail(
  to: string,
  params: {
    amount: string;
    asset: string;
    chain: string;
    senderUsername: string;
    reference: string;
    date: string;
  }
): Promise<void> {
  const { amount, asset, chain, senderUsername, reference, date } = params;

  await sendTransactionalEmail({
    to,
    subject: `@${senderUsername} sent you ${amount} ${asset}`,
    html: shell({
      label: "RECEIPT · RECEIVED",
      preheader: "Already in your balance. Nothing to accept.",
      body: `
        ${hero({
          eyebrow: `@${esc(senderUsername)} sent you`,
          figure: figure(amount, asset, true),
          sub: "It is in your balance already. Nothing to accept, nothing to claim.",
        })}
        ${ledger([
          { k: "From", v: `@${senderUsername}` },
          { k: "Network", v: chainName(chain) },
          { k: "Fee", v: "None" },
        ])}
        ${stub(reference, date)}
        ${fine(
          `Don't know @${esc(senderUsername)}? You can leave it. Money arriving cannot take anything out, and support can trace the sender from that reference.`
        )}
      `,
    }),
  });
}

export async function sendSellSuccessEmail(
  to: string,
  params: {
    cryptoAmount: string;
    asset: string;
    chain: string;
    ngnNet: number;
    ngnFee: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reference: string;
    date: string;
  }
): Promise<void> {
  const { cryptoAmount, asset, chain, ngnNet, ngnFee, bankName, accountNumber, accountName, reference, date } = params;
  const gross = ngnNet + ngnFee;
  const [whole, kobo] = naira(ngnNet).split(".");

  await sendTransactionalEmail({
    to,
    subject: `${naira(ngnNet, false)} paid to ${bankName} ${accountNumber}`,
    html: shell({
      label: "RECEIPT · PAID OUT",
      preheader: `From ${cryptoAmount} ${asset}. Most banks credit within minutes.`,
      body: `
        ${hero({
          // Not "your bank". A sell pays out to whatever account was
          // entered, which is frequently somebody else's - the same wording
          // was corrected in the push notifications and missed here. The line
          // underneath names the bank, the number and the account holder,
          // which reads correctly either way.
          eyebrow: "Sent to bank",
          figure: `${esc(whole)}<span style="font-weight:500;color:${DIM};">.${esc(kobo)}</span>`,
          sub: `${esc(bankName)} · ${esc(accountNumber)} · ${esc(accountName)}`,
        })}
        ${ledger([
          { k: "You sold", v: `${cryptoAmount} ${asset}`, mono: true },
          { k: "Network", v: chainName(chain) },
          { k: "Gross", v: naira(gross), mono: true },
          { k: "Fee", v: `−${naira(ngnFee)}`, mono: true },
          { k: "Paid out", v: naira(ngnNet), mono: true, strong: true },
        ])}
        ${stub(reference, date)}
        ${fine(
          `Banks post at their own pace. Nothing after an hour? Quote the reference above to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

/* ═══════════════════════════════════════════════════════════
   SAVINGS
   ═══════════════════════════════════════════════════════════ */

export async function sendSavingsLockEmail(
  to: string,
  params: {
    amount: string;
    asset: string;
    chain: string;
    fee: string;
    duration: string;
    unlockDate: string;
    txHash: string;
    date: string;
  }
): Promise<void> {
  const { amount, asset, chain, fee, duration, unlockDate, txHash, date } = params;

  await sendTransactionalEmail({
    to,
    subject: `${amount} ${asset} locked for ${duration}`,
    html: shell({
      label: "RECEIPT · LOCKED",
      preheader: `Unlocks ${unlockDate}. Nothing can move it before then, including us.`,
      body: `
        ${hero({
          eyebrow: "Locked in savings",
          figure: figure(amount, asset),
          sub: `Unlocks ${esc(unlockDate)}. Until then it stays put on chain, and no one can move it early.`,
        })}
        ${ledger([
          { k: "Locked for", v: duration },
          { k: "Unlocks", v: unlockDate },
          { k: "Network", v: chainName(chain) },
          { k: "Fee", v: fee },
          hashRow(txHash, chain),
        ])}
        ${stub(short(txHash), date)}
        ${fine(
          `We'll email you the day it unlocks. Questions before then: <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

export async function sendSavingsWithdrawEmail(
  to: string,
  params: {
    amount: string;
    asset: string;
    chain: string;
    txHash: string;
    date: string;
  }
): Promise<void> {
  const { amount, asset, chain, txHash, date } = params;

  await sendTransactionalEmail({
    to,
    subject: `${amount} ${asset} is back in your wallet`,
    html: shell({
      label: "RECEIPT · UNLOCKED",
      preheader: "Out of savings and back in your balance.",
      body: `
        ${hero({
          eyebrow: "Back in your wallet",
          figure: figure(amount, asset, true),
          sub: "Out of savings and spendable again.",
        })}
        ${ledger([{ k: "Network", v: chainName(chain) }, hashRow(txHash, chain)])}
        ${stub(short(txHash), date)}
        ${fine(
          `Something look wrong? Write to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

/* ═══════════════════════════════════════════════════════════
   BILLS
   ═══════════════════════════════════════════════════════════ */

export async function sendBillSuccessEmail(
  to: string,
  params: {
    billType: "airtime" | "data" | "electricity" | "cable" | "betting";
    amountNaira: number;
    cryptoAmount: string;
    asset: string;
    chain: string;
    phone: string;
    network: string;
    planLabel?: string;
    disco?: string;
    meterType?: string;
    customerName?: string;
    electricityToken?: string;
    electricityUnits?: string;
    reference: string;
    date: string;
  }
): Promise<void> {
  const {
    billType, amountNaira, cryptoAmount, asset, chain, phone, network,
    planLabel, disco, meterType, customerName, electricityToken, electricityUnits,
    reference, date,
  } = params;

  const isElectricity = billType === "electricity";
  const provider = isElectricity ? disco || network : network;

  // TV and betting fell through to airtime's wording here, so a SportyBet
  // top-up was a receipt for "airtime sent to" an account ID.
  const isCable = billType === "cable";
  const isBetting = billType === "betting";

  const subject = isElectricity
    ? `${naira(amountNaira, false)} ${provider} token for meter ${phone}`
    : isCable
    ? `${[provider, planLabel].filter(Boolean).join(" ")} paid for smartcard ${phone}`
    : isBetting
    ? `${naira(amountNaira, false)} sent to your ${provider} account`
    : billType === "data"
    ? `${planLabel || "Data"} sent to ${phone}`
    : `${naira(amountNaira, false)} airtime sent to ${phone}`;

  const rows: LedgerRow[] = isElectricity
    ? [
        { k: "Disco", v: provider },
        { k: "Meter", v: phone, mono: true },
        { k: "Meter type", v: meterType || "Prepaid" },
        ...(customerName ? [{ k: "Customer", v: customerName }] : []),
        ...(electricityUnits ? [{ k: "Units", v: `${electricityUnits} kWh` }] : []),
        { k: "Paid with", v: `${cryptoAmount} ${asset} on ${chainName(chain)}`, mono: true },
      ]
    : [
        { k: isCable ? "Provider" : isBetting ? "Bookmaker" : "Network", v: provider },
        { k: isCable ? "Smartcard" : isBetting ? "Account ID" : "Number", v: phone, mono: true },
        ...(planLabel ? [{ k: isCable ? "Package" : "Plan", v: planLabel }] : []),
        { k: "Paid with", v: `${cryptoAmount} ${asset} on ${chainName(chain)}`, mono: true },
      ];

  // The token is the whole point of an electricity receipt: it gets typed into
  // a meter, so it is set like a code rather than buried in a table row.
  const tokenBlock =
    isElectricity && electricityToken
      ? `<tr><td style="padding:24px 28px 0;">
          <p style="margin:0;font-size:13px;letter-spacing:0.2px;color:${DIM};">Your token</p>
          <div style="font-family:${MONO};font-size:26px;font-weight:500;letter-spacing:3px;color:${INK};padding:12px 0 0;word-break:break-all;">${esc(electricityToken)}</div>
        </td></tr>`
      : "";

  await sendTransactionalEmail({
    to,
    subject,
    html: shell({
      label: isElectricity ? "RECEIPT · ELECTRICITY" : isCable ? "RECEIPT · TV" : `RECEIPT · ${billType.toUpperCase()}`,
      preheader: isElectricity
        ? `Token below. ${electricityUnits ? `${electricityUnits} kWh on meter ${phone}.` : `Meter ${phone}.`}`
        : `${provider} · ${phone}. Paid with ${cryptoAmount} ${asset}.`,
      body: `
        ${hero({
          eyebrow: isElectricity
            ? "Electricity bought"
            : isCable
            ? "TV subscription paid"
            : isBetting
            ? "Betting wallet funded"
            : billType === "data"
            ? "Data sent"
            : "Airtime sent",
          figure: figure(naira(amountNaira, false)),
          sub: isElectricity
            ? `${esc(provider)} ${esc(meterType || "prepaid")} · meter ${esc(phone)}`
            : `${esc(planLabel || provider)} · ${esc(phone)}`,
        })}
        ${tokenBlock}
        ${ledger(rows)}
        ${stub(reference, date)}
        ${fine(
          isElectricity
            ? `Token not loading on the meter? Quote the reference above to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a> and we'll re-issue it.`
            : `Didn't arrive? Quote the reference above to <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.`
        )}
      `,
    }),
  });
}

/* ═══════════════════════════════════════════════════════════
   INTERNAL
   ═══════════════════════════════════════════════════════════ */

export async function sendHumanAgentRequestEmail(
  adminEmails: string[],
  params: {
    userEmail: string;
    userName: string;
    username: string | null;
    conversationId: string;
    date: string;
  }
): Promise<void> {
  const { userEmail, userName, username, conversationId, date } = params;

  const html = shell({
    label: "SUPPORT",
    preheader: `${userName || userEmail} is waiting in Live Chat.`,
    body: `
      ${heading("Someone is waiting on a person", "A user asked to leave the bot and talk to an agent in Live Chat.")}
      ${ledger([
        { k: "Name", v: userName || "Not set" },
        { k: "Username", v: username ? `@${username}` : "Not set" },
        { k: "Email", v: userEmail, mono: true },
        { k: "Conversation", v: conversationId, mono: true },
      ])}
      ${stub(conversationId, date)}
      ${fine("Open the admin panel, then Live Chat, to pick it up.")}
    `,
  });

  for (const to of adminEmails) {
    await sendEmail({ to, subject: `Support request from ${userName || userEmail}`, html });
  }
}

/**
 * The statement, attached.
 *
 * The body is deliberately thin. Everything worth reading is in the PDF, and
 * an email that restates the totals gives somebody two documents to reconcile
 * when one of them is the record.
 */
export async function sendStatementEmail(
  to: string,
  opts: {
    from: Date;
    to: Date;
    number: string;
    rows: number;
    filename: string;
    pdf: Buffer;
  },
): Promise<void> {
  const day = (d: Date) =>
    d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  const period = `${day(opts.from)} \u2013 ${day(opts.to)}`;

  await sendEmail({
    to,
    subject: `Your statement \u00b7 ${period}`,
    attachments: [{ filename: opts.filename, content: opts.pdf }],
    html: shell({
      label: `STATEMENT ${esc(opts.number)}`,
      preheader: `${opts.rows} transactions, ${period}. The PDF is attached.`,
      body: `
        <tr><td style="padding:34px 28px 0;">
          <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:-1.2px;line-height:1.1;color:${INK};">Your statement</p>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:${BODY};">${esc(period)} \u00b7 ${opts.rows} transaction${opts.rows === 1 ? "" : "s"}. It is attached as a PDF.</p>
        </td></tr>
        ${divider()}
        <tr><td style="padding:16px 28px 26px;">
          <p style="margin:0 0 9px;font-size:13px;line-height:1.65;color:${BODY};">You asked for this from the app. If you did not, tell us \u2014 it was sent to the address on the account and nowhere else.</p>
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">Questions reach a person, not a bot. <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a></p>
        </td></tr>
      `,
    }),
  });
}

/**
 * A voucher landed.
 *
 * Short. The money is already in their wallet and the app has told them; this
 * is the copy they can find again in three months when they are trying to
 * remember where 5 USDC came from.
 */
export async function sendVoucherEmail(
  to: string,
  opts: { amount: number; txHash: string; name?: string | null },
): Promise<void> {
  const explorer = `https://explorer.movementnetwork.xyz/txn/${opts.txHash}`;
  const figure = `${opts.amount} USDC`;

  await sendEmail({
    to,
    // No code anywhere in here. A voucher given out as a printed QR is only
    // un-shareable while nothing returns the code in readable form, and an
    // email is the most forwardable thing we send.
    subject: `${figure} claimed`,
    html: shell({
      label: "VOUCHER CLAIMED",
      preheader: `${figure} is in your wallet.`,
      body: `
        <tr><td style="padding:34px 28px 0;">
          <p style="margin:0;font-size:13px;line-height:1.5;color:${DIM};">Voucher claimed</p>
          <p style="margin:10px 0 0;font-size:40px;font-weight:700;letter-spacing:-1.5px;line-height:1.05;color:${LINK};">${esc(String(opts.amount))} <span style="color:${INK};font-size:20px;font-weight:600;">USDC</span></p>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:${BODY};">It is in your wallet on Movement. Nothing else to do.</p>
        </td></tr>
        ${divider()}
        <tr><td style="padding:18px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:13px;color:${DIM};padding:0 0 8px;">Sent in</td>
              <td align="right" style="font-family:${MONO};font-size:13px;padding:0 0 8px;"><a href="${esc(explorer)}" style="color:${LINK};text-decoration:none;">${esc(opts.txHash.slice(0, 10))}&hellip;${esc(opts.txHash.slice(-6))}</a></td>
            </tr>
          </table>
        </td></tr>
        ${divider()}
        <tr><td style="padding:16px 28px 26px;">
          <p style="margin:0;font-size:12.5px;line-height:1.6;color:${DIM};">Did not claim this? Tell us at <a href="mailto:${SUPPORT}" style="color:${LINK};text-decoration:none;">${SUPPORT}</a>.</p>
        </td></tr>
      `,
    }),
  });
}

/**
 * A large deposit coming in, for the team.
 *
 * Sent at the first sighting - the chain transfer for a wallet deposit, the
 * moment a converting deposit is seen - so somebody can look before it lands
 * rather than after.
 */
export async function sendLargeDepositAlert(
  to: string[],
  params: {
    usd: number;
    amount: string;
    symbol: string;
    network: string;
    kind: string;
    userEmail: string;
    username: string | null;
    userId: string;
    txHash?: string | null;
    reference: string;
    date: string;
  },
): Promise<void> {
  const usd = `$${params.usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const who = params.username ? `@${params.username}` : params.userEmail;
  const html = shell({
    label: "DEPOSIT",
    preheader: `${usd} in ${params.symbol} on ${params.network} for ${who}.`,
    body: `
      ${heading(`${usd} deposit coming in`, `${params.amount} ${params.symbol} on ${params.network}, ${params.kind}.`)}
      ${ledger([
        { k: "Value", v: usd, strong: true },
        { k: "Amount", v: `${params.amount} ${params.symbol}` },
        { k: "Network", v: params.network },
        { k: "Kind", v: params.kind },
        { k: "Account", v: who },
        { k: "Email", v: params.userEmail, mono: true },
        { k: "User id", v: params.userId, mono: true },
        ...(params.txHash ? [{ k: "Transaction", v: params.txHash, mono: true }] : []),
      ])}
      ${stub(params.reference, params.date)}
      ${fine("Open the admin console, then People, to look at this account.")}
    `,
  });
  for (const address of to) {
    await sendEmail({ to: address, subject: `${usd} deposit coming in for ${who}`, html });
  }
}
