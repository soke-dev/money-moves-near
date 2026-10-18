import fs from "fs";
import path from "path";
import type { Statement, StatementRow } from "./statement";

/**
 * The statement, as the page Chromium prints.
 *
 * Laid out as ONE flowing document rather than a series of fixed pages,
 * because a statement is as long as the period is. Chromium paginates it, and
 * a real <thead> repeats the column labels on every sheet by itself - which is
 * the whole reason this is rendered by a browser and not drawn by hand.
 *
 * Page numbers and the line identifying the account live in the PDF footer
 * (statement-pdf.ts), so every loose sheet says whose it is.
 *
 * Print decisions, not screen ones: the type is set in points, nothing is
 * lighter than #5F6557 (grey any paler disappears on paper), rules are at
 * least 0.5pt, and money in is green while money out is plain ink with a
 * minus - a statement gets printed in black and white, and red against green
 * is the first thing to die there. The sign has to carry it.
 */

const INK = "#0B0D0A";
const BODY = "#5F6557";
const PAPER = "#EFEFEB";
const RULE = "#EDEEE8";
const RULE_STRONG = "#D8DBD1";
const GREEN = "#33600C";
const AMBER = "#C9781C";

/**
 * Inlined, not linked.
 *
 * A statement rendered six months from now must not depend on the web app
 * still serving an image at the same path - a broken letterhead is the kind of
 * thing nobody notices until a customer forwards one to their bank.
 */
let logoData = "";
function logo(): string {
  if (logoData) return logoData;
  try {
    const p = path.join(__dirname, "..", "assets", "logo-lockup.png");
    logoData = `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    logoData = "";
  }
  return logoData;
}

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const money = (v: number, dp = 2) =>
  v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const DAY = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Lagos" });
const TIME = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Lagos" });
const LONG = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });

/**
 * Shortened from the front, never through the middle.
 *
 * Cutting the middle out of "INT-muawynqi-OUT" leaves "INT-mu…-OUT", which is
 * the part every one of them shares and none of the part that identifies this
 * one. The tail is what support can search on.
 */
const shortRef = (r: string) =>
  r.length > 17 ? `…${r.slice(-16)}` : r;

function row(r: StatementRow): string {
  const tone = r.pending ? AMBER : r.direction === "in" ? GREEN : INK;
  const mark = r.estimated ? '<span style="color:#8A8F82">*</span>' : "";
  return `
  <tr>
    <td class="c-date">${esc(DAY(r.at))}<br><span class="dim">${esc(TIME(r.at))}</span></td>
    <td class="c-desc"><span class="what">${esc(r.what)}</span><br><span class="dim">${esc(r.where)}</span></td>
    <td class="c-ref">${esc(shortRef(r.reference))}</td>
    <td class="c-amt" style="color:${tone}">${esc(r.amount)}${
      r.pending ? '<br><span class="pending">PROCESSING</span>' : ""
    }</td>
    <td class="c-ngn">${r.ngn === null ? "&mdash;" : money(r.ngn) + mark}</td>
    <td class="c-usd">${r.usd === null ? "&mdash;" : money(r.usd)}</td>
  </tr>`;
}

export function statementHtml(s: Statement): string {
  const mark = s.anyEstimated ? '<span style="color:#8A8F82">*</span>' : "";
  const maxCat = Math.max(...s.categories.map((c) => c.ngn), 1);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Account statement ${esc(s.number)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;family=IBM+Plex+Serif:wght@600&amp;display=swap">
<style>
  @page { size: A4; margin: 14mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #FFFFFF; color: ${INK};
    font-family: 'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif;
    font-size: 9pt; line-height: 1.45;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .mono { font-family: 'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace; }
  .dim { color: ${BODY}; }

  /*
     Inside the margins, not bled past them.
     This pulled itself out to the paper's edge with a negative margin, which
     works on screen and does not print: the page box CLIPS whatever sits in
     the margin rather than bleeding it, so the top of the letterhead - the
     logo included - was simply cut off the PDF. Nothing here may have a
     negative margin for that reason.
  */
  .head {
    padding: 7mm 8mm;
    background: ${INK}; color: #FFFFFF;
    display: flex; align-items: center; justify-content: space-between;
  }
  .head img { height: 8.5mm; }
  .eyebrow { font-size: 6.5pt; letter-spacing: 1.4px; color: #A8AEA0; }
  .period { font-size: 13pt; font-weight: 600; margin-top: 1.5mm; }

  .who { display: flex; gap: 10mm; margin-top: 7mm; }
  .who h1 { font-size: 13pt; font-weight: 600; margin: 2mm 0 0; }
  .meta { width: 68mm; flex-shrink: 0; }
  .meta div { display: flex; justify-content: space-between; padding: 1mm 0; border-bottom: 0.5pt solid ${RULE}; }

  .totals { display: flex; margin-top: 6mm; border: 0.5pt solid ${RULE_STRONG}; }
  .totals > div { flex: 1 1 0; padding: 4mm 5mm; background: ${PAPER}; }
  .totals > div + div { border-left: 0.5pt solid ${RULE_STRONG}; }
  .totals .net { background: ${INK}; color: #FFFFFF; }
  .totals .big { font-size: 14pt; font-weight: 600; margin-top: 1.5mm; }
  .totals .sub { font-size: 8.5pt; color: ${BODY}; margin-top: 0.8mm; }
  .totals .net .sub { color: #A8AEA0; }

  h2 { font-family: 'IBM Plex Serif', Georgia, serif; font-size: 11pt; font-weight: 600; margin: 8mm 0 3mm; }
  .caption { font-size: 8.5pt; color: ${BODY}; }
  .rowline { display: flex; align-items: baseline; justify-content: space-between; }

  table { width: 100%; border-collapse: collapse; }
  /* Repeated by the browser at the top of every sheet - the one thing a
     hand-drawn PDF cannot do without redrawing each page. */
  thead { display: table-header-group; }
  th {
    font-size: 6.5pt; font-weight: 500; letter-spacing: 1.1px; color: ${BODY};
    text-align: left; padding: 0 0 2mm; border-bottom: 1pt solid ${INK};
    font-family: 'IBM Plex Mono', monospace;
  }
  td { padding: 2mm 0; border-bottom: 0.5pt solid ${RULE}; vertical-align: top; }
  .c-date, .c-ref, .c-amt, .c-ngn, .c-usd { font-family: 'IBM Plex Mono', monospace; }
  th:nth-child(1), .c-date { width: 11%; font-size: 8pt; color: ${BODY}; }
  th:nth-child(2), .c-desc { width: 30%; padding-right: 4mm; }
  th:nth-child(3), .c-ref  { width: 16%; font-size: 7pt; color: ${BODY}; }
  th:nth-child(4), .c-amt  { width: 18%; text-align: right; font-weight: 500; }
  th:nth-child(5), .c-ngn  { width: 15%; text-align: right; }
  th:nth-child(6), .c-usd  { width: 10%; text-align: right; color: ${BODY}; }
  .what { font-weight: 500; }
  .pending { font-size: 6.5pt; letter-spacing: 0.8px; color: ${AMBER}; }

  .cats { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  .cats td { padding: 2.2mm 0; border-bottom: 0.5pt solid ${RULE}; vertical-align: middle; }
  .cats .bar { width: 100%; height: 2mm; background: ${PAPER}; }
  .cats .bar span { display: block; height: 2mm; }

  .note { margin-top: 7mm; padding: 4mm 5mm; background: ${PAPER}; border-left: 1mm solid ${INK}; }
  .note p { margin: 2mm 0 0; font-size: 8pt; line-height: 1.6; max-width: 150mm; }
</style></head>
<body>

<div class="head">
  ${logo() ? `<img src="${logo()}" alt="Money Moves">` : '<div style="font-size:14pt;font-weight:600">Money Moves</div>'}
  <div style="text-align:right">
    <div class="eyebrow mono">ACCOUNT STATEMENT</div>
    <div class="period" style="font-family:'IBM Plex Serif',Georgia,serif">${esc(LONG(s.from))} &ndash; ${esc(LONG(s.to))}</div>
  </div>
</div>

<div class="who">
  <div style="flex-grow:1">
    <div class="eyebrow mono" style="color:${BODY}">ACCOUNT HOLDER</div>
    <h1>${esc(s.user.name)}</h1>
    <div class="dim" style="font-size:8.5pt">${
      s.user.username ? `@${esc(s.user.username)} &middot; ` : ""
    }${esc(s.user.email)}</div>
  </div>
  <div class="meta">
    <div><span class="dim">Statement no.</span><span class="mono">${esc(s.number)}</span></div>
    <div><span class="dim">Issued</span><span class="mono">${esc(DAY(s.issuedAt))} ${esc(String(s.issuedAt.getFullYear()))}</span></div>
    <div><span class="dim">Transactions</span><span class="mono">${s.rows.length}</span></div>
    <div><span class="dim">Valued in</span><span class="mono">NGN and USD</span></div>
  </div>
</div>

<div class="totals">
  <div>
    <div class="eyebrow mono" style="color:${BODY}">MONEY IN</div>
    <div class="big mono" style="color:${GREEN}">&#8358;${money(s.totals.inNgn)}</div>
    <div class="sub mono">$${money(s.totals.inUsd)}</div>
  </div>
  <div>
    <div class="eyebrow mono" style="color:${BODY}">MONEY OUT</div>
    <div class="big mono">&#8722;&#8358;${money(s.totals.outNgn)}</div>
    <div class="sub mono">&#8722;$${money(s.totals.outUsd)}</div>
  </div>
  <div class="net">
    <div class="eyebrow mono">NET</div>
    <div class="big mono">${s.totals.inNgn - s.totals.outNgn >= 0 ? "+" : "&#8722;"}&#8358;${money(
      Math.abs(s.totals.inNgn - s.totals.outNgn),
    )}</div>
    <div class="sub mono">${s.totals.inUsd - s.totals.outUsd >= 0 ? "+" : "&#8722;"}$${money(
      Math.abs(s.totals.inUsd - s.totals.outUsd),
    )}</div>
  </div>
</div>

<div class="rowline" style="margin-top:8mm">
  <h2 style="margin:0">Transactions</h2>
  <span class="caption">${s.rows.length} in this period &middot; ${
    s.types && s.types.length ? esc(s.types.map(pretty).join(", ")) : "all types"
  }</span>
</div>

<table style="margin-top:3mm">
  <thead><tr>
    <th>DATE</th><th>DESCRIPTION</th><th>REFERENCE</th>
    <th>AMOUNT</th><th>VALUE (&#8358;)</th><th>VALUE ($)</th>
  </tr></thead>
  <tbody>
    ${s.rows.length ? s.rows.map(row).join("") : `<tr><td colspan="6" style="padding:10mm 0;text-align:center" class="dim">Nothing in this period.</td></tr>`}
  </tbody>
</table>

${
  s.categories.length
    ? `<h2>By category</h2>
<table class="cats">
  <tbody>
  ${s.categories
    .map(
      (c) => `<tr>
    <td style="width:42mm;font-weight:500">${esc(c.label)}</td>
    <td style="width:12mm;font-size:8pt" class="mono dim">${c.count}</td>
    <td><div class="bar"><span style="width:${Math.max(
      (c.ngn / maxCat) * 100,
      1.5,
    ).toFixed(1)}%;background:${c.direction === "in" ? GREEN : INK}"></span></div></td>
    <td style="width:30mm;text-align:right;font-weight:500" class="mono">&#8358;${money(c.ngn)}</td>
    <td style="width:22mm;text-align:right;color:${BODY}" class="mono">$${money(c.usd)}</td>
  </tr>`,
    )
    .join("")}
  </tbody>
</table>`
    : ""
}

<div class="note">
  <div class="eyebrow mono" style="color:${BODY}">ABOUT THIS STATEMENT</div>
  <p>A record of activity on your Money Moves account for the period shown. It is
  not a bank statement and is not a balance: values are what each transaction was
  worth, not what your wallet holds today.</p>
  <p>${
    s.anyEstimated
      ? `Naira figures marked ${mark} are converted at today&rsquo;s rate: bank transfers,
  wallet funding and bills recorded their naira value at the time and are exact,
  while crypto movements recorded only the token amount and no rate was kept for
  the day. `
      : ""
  }Dollar figures are converted at today&rsquo;s rate throughout.</p>
  <p class="dim">Transactions still processing are listed without a value until they
  settle. Something here you do not recognise? Write to support@usemoneymoves.xyz
  with the reference.</p>
</div>

</body></html>`;
}

function pretty(t: string): string {
  switch (t) {
    case "BUY": return "Funding";
    case "SELL": return "Bank transfers";
    case "TRANSFER":
    case "TRANSFER_OUT": return "Crypto sent";
    case "TRANSFER_IN": return "Crypto received";
    case "AIRTIME":
    case "TV": return "Bills";
    case "DEPOSIT": return "Deposits";
    case "WITHDRAW": return "Withdrawals";
    default: return t.charAt(0) + t.slice(1).toLowerCase();
  }
}
