// Writes the dashboard's dark theme into index.css: dark values for the theme's colours, then a dark version of every
// hard-coded colour class the dashboard uses. Everything is scoped to html[data-theme="dark"], so light mode is untouched.
// usage: npm run dark-theme   (or: node scripts/dark-theme.cjs src) - run again after adding a hard-coded colour class.
const fs = require("fs");
const path = require("path");
const root = process.argv[2];

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(root);

// Every class with a hard-coded colour, with whatever variants sit in front of it (hover:, active:, before: ...).
const TOKEN = /(?<![\w-])((?:[a-z0-9-]+:)*)(bg|text|border|border-[trblxy]|decoration|fill|stroke|divide|placeholder|outline|ring|shadow)-\[([^\]\s'"`]*#[0-9A-Fa-f]{3,8}[^\]\s'"`]*)\](\/\d{1,3})?/g;
const found = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(TOKEN)) found.set(m[0], { variants: m[1], util: m[2], value: m[3], alpha: m[4] });
}

const hex = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
/** Which family a colour belongs to: neutral, or a status hue. */
function family([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (sat < 0.14) return "neutral";
  if (r >= g && g > b && r - b > 40) return r - g > 55 && g < 150 ? (r > 180 && g < 120 ? "red" : "amber") : "amber";
  if (r > g && r > b) return "red";
  if (b > r && b >= g) return "blue";
  if (g >= r && g >= b) return r > 150 && g > 200 ? "lime" : "green";
  return "neutral";
}
const TINT = { amber: "224,160,99", red: "240,122,114", blue: "127,179,232", green: "91,194,127", lime: "129,251,2" };
const TEXT = { amber: "#E8B27A", red: "#F4A09A", blue: "#A9CBF0", green: "#8FD6A5", lime: "#B6F07A", neutral: "#E8EAE3" };

/** The dark value for a hard-coded colour, by what it's used for. null leaves it as it is. */
function darkFor(util, color) {
  const rgb = hex(color);
  const L = lum(rgb);
  const fam = family(rgb);
  const isBg = util === "bg";
  const isText = util === "text" || util === "placeholder" || util === "fill" || util === "stroke";
  const isLine = util.startsWith("border") || util === "divide" || util === "outline" || util === "ring" || util === "decoration";
  if (isBg) {
    if (L < 0.45) return null; // already dark: forest panels, the wallet card
    if (fam === "neutral") return L >= 0.975 ? "#1B1D18" : L >= 0.93 ? "#22251F" : L >= 0.86 ? "#2A2D26" : "#353930";
    if (L < 0.8 && fam !== "lime") return null; // a strong accent fill (amber, the test stripe): keep
    if (fam === "lime" && L < 0.88) return null; // the brand lime and its brighter cousins
    return `rgba(${TINT[fam]},${fam === "lime" ? 0.09 : 0.13})`;
  }
  if (isLine) {
    if (L < 0.45) return null;
    if (fam === "neutral") return L >= 0.85 ? "#30342B" : "#3B4036";
    return `rgba(${TINT[fam]},0.35)`;
  }
  if (isText) {
    if (L > 0.78) return null; // light text sitting on a dark surface already
    if (L < 0.4) return TEXT[fam];
    if (fam === "neutral") return L < 0.6 ? "#9EA196" : null;
    return TEXT[fam];
  }
  return null;
}

const esc = (cls) => cls.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c).replace(/^(\d)/, "\\3$1 ");
const PSEUDO = { hover: ":hover", focus: ":focus", "focus-visible": ":focus-visible", active: ":active", disabled: ":disabled", checked: ":checked", "focus-within": ":focus-within", first: ":first-child", last: ":last-child" };
const ELEMENT = { before: "::before", after: "::after", placeholder: "::placeholder" };
const SCOPE = 'html[data-theme="dark"]';
const OUTSIDE_LIGHT = ":not(.keep-light, .keep-light *)";

const rules = [];
for (const [cls, t] of found) {
  const variants = t.variants.split(":").filter(Boolean);
  // Responsive and state-of-parent variants are left as they are; the plain and hover forms cover the dashboard.
  if (variants.some((v) => !(v in PSEUDO) && !(v in ELEMENT) && !/^(sm|md|lg|xl|max-sm|max-md|max-lg)$/.test(v))) continue;
  let pseudo = "";
  let element = "";
  for (const v of variants) {
    if (PSEUDO[v]) pseudo += PSEUDO[v];
    if (ELEMENT[v]) element = ELEMENT[v];
  }
  const selector = `${SCOPE} .${esc(cls)}${OUTSIDE_LIGHT}${pseudo}${element}`;
  if (t.util === "shadow") {
    // Only the hairline rings drawn as shadows ("0 0 0 1px #E6E4DE, ..."): the rest are soft black shadows that work on dark too.
    if (/^0_0_0_1px_#/.test(t.value)) rules.push(`${selector} { box-shadow: 0 0 0 1px #30342B, 0 1px 2px rgba(0,0,0,0.4); }`);
    continue;
  }
  const color = t.value.match(/#[0-9A-Fa-f]{3,8}/)[0];
  if (color.length !== 4 && color.length !== 7) continue;
  const dark = darkFor(t.util, color);
  if (!dark) continue;
  const value = t.alpha ? `color-mix(in srgb, ${dark} ${t.alpha.slice(1)}%, transparent)` : dark;
  const prop =
    t.util === "bg" ? "background-color"
    : t.util === "text" || t.util === "placeholder" ? "color"
    : t.util === "decoration" ? "text-decoration-color"
    : t.util === "fill" ? "fill"
    : t.util === "stroke" ? "stroke"
    : t.util === "outline" ? "outline-color"
    : t.util === "ring" ? "--tw-ring-color"
    : t.util === "divide" ? null
    : t.util.startsWith("border-") ? `border-${{ t: "top", r: "right", b: "bottom", l: "left", x: "inline", y: "block" }[t.util.slice(-1)]}-color`
    : "border-color";
  if (t.util === "divide") rules.push(`${SCOPE} .${esc(cls)}${OUTSIDE_LIGHT} > :not(:last-child) { border-color: ${value}; }`);
  else rules.push(`${selector} { ${prop}: ${value}; }`);
}
rules.sort();

const css = `
/* ─── Dark mode (the dashboard only) ──────────────────────────────────────
 * Switched on from the sidebar, remembered in this browser, and set on the
 * page only while the dashboard is open, so checkouts, receipts and sign-in
 * stay light. Nothing below applies in light mode. The hard-coded colours
 * further down are generated from the classes the screens use (npm run dark-theme).
 */
html[data-theme="dark"] {
  --color-bg: #0F100D;
  --color-side: #131410;
  --color-card: #171914;
  --color-raise: #20231C;
  --color-line: #2B2E26;
  --color-soft: #22251E;
  --color-fg: #EDEEE8;
  --color-muted: #A6A99E;
  --color-dim: #72766A;
  --color-lime-calm: #3D5A12;
  --color-ink-green: #E3ECDD;
  --color-accent: #9BE05A;
  --color-lime-deep: #9BE05A;
  --color-amber: #E3A86C;
  --color-red: #F08A82;
  --color-blue: #8DBDEE;
  --color-good: #6BCB8C;
  color-scheme: dark;
}
html[data-theme="dark"] body {
  color-scheme: dark;
}
html[data-theme="dark"] * {
  scrollbar-color: #3A3E35 transparent;
}
html[data-theme="dark"] ::selection {
  color: #0A0C08;
}

/* What must stay dark on light even here: QR codes, so every camera reads them. */
html[data-theme="dark"] .keep-light {
  --color-bg: #FFFFFF;
  --color-card: #FFFFFF;
  --color-fg: #121210;
  --color-line: #E6E4DE;
  color: #121210;
}

/* The ink flips light, so things filled with it take dark text: primary buttons, ticked boxes, chosen options. */
html[data-theme="dark"] .bg-fg.text-white:not(.keep-light *),
html[data-theme="dark"] .bg-fg .text-white:not(.keep-light *) {
  color: var(--color-bg);
}
html[data-theme="dark"] .bg-fg .bg-white:not(.keep-light *) {
  background-color: var(--color-bg);
}
html[data-theme="dark"] .bg-white:not(.keep-light, .keep-light *, .shadow-sm, .bg-fg *) {
  background-color: var(--color-card);
}
/* A switch's knob stays light on a dark track. */
html[data-theme="dark"] .bg-white.shadow-sm:not(.keep-light *) {
  background-color: #D9DBD2;
}
/* The bank and wallet glyphs are dark drawings: lightened to read on dark. */
html[data-theme="dark"] img[src="/brand/bank.png"]:not(.keep-light *),
html[data-theme="dark"] img[src="/brand/wallet.png"]:not(.keep-light *) {
  filter: invert(0.9);
}
/* Lime fills always carry dark ink: ticks, counts, a switch's knob - in light mode they already do. */
html[data-theme="dark"] .bg-lime:not(.keep-light *) {
  --color-fg: #0A0C08;
  color: #0A0C08;
}
/* The page icons' lime layer, softer, so a light outline over it still reads. */
html[data-theme="dark"] .icon-lit path[opacity] {
  opacity: 0.42;
}
/* The app, bank and crypto coins are near black: a soft light rim keeps them off the card. */
html[data-theme="dark"] .mark-tile:not(.keep-light *) {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 0 0 1px rgba(255, 255, 255, 0.07) !important;
}
/* Dimmed backdrops behind sheets and menus go darker, not lighter. */
html[data-theme="dark"] .bg-fg\\/15,
html[data-theme="dark"] .bg-fg\\/20,
html[data-theme="dark"] .bg-fg\\/30,
html[data-theme="dark"] .bg-fg\\/40 {
  background-color: rgba(0, 0, 0, 0.55);
}
/* The primary button's darker hover, lighter here. */
html[data-theme="dark"] .hover\\:bg-\\[\\#2A2A27\\]:hover {
  background-color: #D6D8CE;
}

${rules.join("\n")}
/* ─── end of dark mode ─── */
`;

const cssPath = path.join(root, "index.css");
let current = fs.readFileSync(cssPath, "utf8");
const start = current.indexOf("\n/* ─── Dark mode (the dashboard only)");
if (start >= 0) current = current.slice(0, start) + current.slice(current.indexOf("/* ─── end of dark mode ─── */", start) + "/* ─── end of dark mode ─── */".length);
fs.writeFileSync(cssPath, current.replace(/\s*$/, "\n") + css);
console.log(`${found.size} hard-coded colour classes, ${rules.length} dark rules written`);
