/**
 * Kòkó Coffee: a demo shop that takes payments with the Money Moves API.
 *
 * What a real integration does, and nothing more:
 *  - makes a checkout on the server for each order (the secret key never reaches a browser or app),
 *  - sends the customer to it,
 *  - hears about the payment by webhook, checking the signature before trusting it,
 *  - and reads the checkout again if a webhook hasn't arrived yet.
 *
 * No dependencies: Node 20+ only. Settings, from the environment:
 *   MONEYMOVES_SECRET_KEY      sk_test_… or sk_live_…      (required)
 *   MONEYMOVES_WEBHOOK_SECRET  whsec_… for the same mode    (required for webhooks)
 *   MONEYMOVES_API_BASE        defaults to https://business.usemoneymoves.xyz/api/v1
 *   PUBLIC_URL                 this shop's own address; worked out from the request when unset
 *   PORT                       defaults to 4300
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = (process.env.MONEYMOVES_API_BASE || "https://business.usemoneymoves.xyz/api/v1").replace(/\/+$/, "");
const KEY = (process.env.MONEYMOVES_SECRET_KEY || "").trim();
const WEBHOOK_SECRET = (process.env.MONEYMOVES_WEBHOOK_SECRET || "").trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 4300);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");
const DATA_FILE = process.env.DATA_FILE || path.join(HERE, "data.json");

/** The menu. Prices in naira. */
const PRODUCTS = [
  { id: "house-blend", name: "House blend", note: "500g · chocolate, toasted nuts", price: 7800, tone: "#5B3A29" },
  { id: "single-origin", name: "Jos Plateau single origin", note: "250g · citrus, honey", price: 4500, tone: "#8A5A3B" },
  { id: "cold-brew", name: "Cold brew pack", note: "4 bottles · smooth, low acid", price: 3200, tone: "#2F2A26" },
  { id: "mug", name: "Kòkó enamel mug", note: "350ml · speckled cream", price: 2500, tone: "#D9CBB4" },
];

// ─── What the shop remembers ──────────────────────────────────────────────

/** Orders by id, and the webhooks we've had, newest first. Kept in a file so a restart forgets nothing. */
const orders = new Map();
let events = [];
const seen = new Set();

async function load() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    for (const o of saved.orders ?? []) orders.set(o.id, o);
    events = saved.events ?? [];
    for (const e of events) seen.add(e.id);
  } catch {
    /* a fresh shop */
  }
}
let saving = null;
function save() {
  clearTimeout(saving);
  saving = setTimeout(() => {
    const recent = [...orders.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 500);
    void fs.writeFile(DATA_FILE, JSON.stringify({ orders: recent, events: events.slice(0, 50) })).catch(() => {});
  }, 200);
}

// ─── Money Moves ──────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** One call to the Money Moves API, with the secret key. Errors carry Money Moves's own message. */
async function mm(method, p, body, idempotencyKey) {
  if (!KEY) throw new ApiError("This shop has no Money Moves key yet. Set MONEYMOVES_SECRET_KEY.", 503, "not_configured");
  const res = await fetch(API + p, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message || `Money Moves answered ${res.status}.`, res.status, json?.error?.code);
  return json;
}

/** Whose key this is, read once: the business's name and the mode, for the page. */
let account = null;
async function accountOf() {
  if (account || !KEY) return account;
  try {
    account = await mm("GET", "/account");
  } catch {
    /* shown as not configured */
  }
  return account;
}

/** A webhook's signature, checked: HMAC-SHA256 of "t.body" with our secret, signed in the last 5 minutes. */
function verified(raw, header) {
  if (!WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${parts.t}.${raw}`).digest("hex");
  return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

// ─── Orders ───────────────────────────────────────────────────────────────

const newOrderId = () => `ord_${crypto.randomBytes(5).toString("hex")}`;

/** What the browser and the app see of an order. */
const shown = (o) => ({ id: o.id, status: o.status, items: o.items, total: o.total, url: o.url, mode: o.mode, payment: o.payment, paid_by: o.paid_by, created_at: o.created_at });

function paidWith(o, payment, by) {
  if (o.status === "paid") return;
  o.status = payment.status === "underpaid" ? "underpaid" : "paid";
  o.paid_by = by;
  o.payment = {
    reference: payment.reference,
    method: payment.method,
    amount_ngn: payment.received_ngn ?? payment.amount_ngn,
    receipt_url: payment.receipt_url,
    paid_at: payment.paid_at,
    coin: payment.crypto?.coin ?? null,
    network: payment.crypto?.network ?? null,
  };
  save();
}

async function createOrder(req, body) {
  const lines = Array.isArray(body.items) ? body.items : [];
  const items = [];
  for (const l of lines) {
    const p = PRODUCTS.find((x) => x.id === l?.id);
    const qty = Math.floor(Number(l?.qty));
    if (!p || !(qty >= 1 && qty <= 10)) continue;
    items.push({ id: p.id, name: p.name, qty, price: p.price });
  }
  if (!items.length) throw new ApiError("Your basket is empty.", 400, "empty");
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const email = typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ? body.email.trim() : null;
  const name = typeof body.name === "string" && body.name.trim().length >= 2 ? body.name.trim().slice(0, 100) : null;
  const id = newOrderId();
  const summary = items.map((i) => `${i.qty} × ${i.name}`).join(", ");
  const origin = PUBLIC_URL || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
  // The order id is the idempotency key: a double tap never makes two checkouts.
  const checkout = await mm(
    "POST",
    "/checkouts",
    {
      amount: total,
      currency: "NGN",
      description: `Kòkó Coffee: ${summary}`.slice(0, 200),
      reference: id,
      metadata: { order_id: id, items: summary.slice(0, 500) },
      ...(email || name ? { customer: { ...(email ? { email } : {}), ...(name ? { name } : {}) } } : {}),
      expires_in: 3600,
      redirect_url: `${origin}/order/${id}`,
    },
    id,
  );
  const order = { id, items, total, email, checkout: checkout.id, url: checkout.url, mode: checkout.mode, status: "pending", payment: null, paid_by: null, created_at: new Date().toISOString() };
  orders.set(id, order);
  save();
  return order;
}

/** An order, brought up to date: if no webhook has said it's paid, ask Money Moves. */
async function freshOrder(id) {
  let o = orders.get(id);
  if (!o) {
    // Forgotten (a new server): the checkout still knows it, by our reference.
    const found = await mm("GET", `/checkouts?reference=${encodeURIComponent(id)}&limit=1`).catch(() => null);
    const c = found?.data?.[0];
    if (!c) return null;
    o = { id, items: [], total: c.amount, email: c.customer?.email ?? null, checkout: c.id, url: c.url, mode: c.mode, status: "pending", payment: null, paid_by: null, created_at: c.created_at };
    orders.set(id, o);
  }
  if (o.status === "pending") {
    const c = await mm("GET", `/checkouts/${o.checkout}`).catch(() => null);
    if (c?.status === "paid" && c.payment) paidWith(o, c.payment, "api");
    else if (c && (c.status === "expired" || c.status === "cancelled")) {
      o.status = c.status;
      save();
    }
  }
  return o;
}

function onEvent(event) {
  const obj = event.data?.object ?? {};
  const orderId = obj.checkout_reference || obj.metadata?.order_id || null;
  events.unshift({ id: event.id, type: event.type, mode: event.mode, order: orderId, reference: obj.reference ?? null, at: new Date().toISOString() });
  events = events.slice(0, 50);
  const o = orderId ? orders.get(orderId) : null;
  if (o && (event.type === "payment.successful" || event.type === "payment.underpaid")) paidWith(o, obj, "webhook");
  save();
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function send(res, status, body, headers = {}) {
  const json = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers });
  res.end(json);
}

async function readBody(req, limit = 100_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new ApiError("That's too big.", 413, "too_large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveFile(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, { error: "Nothing here." });
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(full)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=300",
    });
    res.end(data);
  } catch {
    send(res, 404, { error: "Nothing here." });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://shop");
  const p = url.pathname;
  try {
    if (req.method === "GET" && p === "/api/config") {
      const a = await accountOf();
      return send(res, 200, { configured: !!a, webhooks: !!WEBHOOK_SECRET, mode: a?.mode ?? null, business: a?.name ?? null });
    }
    if (req.method === "GET" && p === "/api/products") return send(res, 200, { products: PRODUCTS });
    if (req.method === "GET" && p === "/api/events") return send(res, 200, { events: events.slice(0, 20) });
    if (req.method === "POST" && p === "/api/orders") {
      let body = {};
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        throw new ApiError("That request isn't quite right.", 400, "bad_json");
      }
      const o = await createOrder(req, body);
      return send(res, 201, { order: shown(o) });
    }
    const m = p.match(/^\/api\/orders\/(ord_[a-f0-9]{10})$/);
    if (req.method === "GET" && m) {
      const o = await freshOrder(m[1]);
      return o ? send(res, 200, { order: shown(o) }) : send(res, 404, { error: "No order with that number." });
    }
    if (req.method === "POST" && p === "/webhooks/money-moves") {
      const raw = await readBody(req, 1_000_000);
      if (!WEBHOOK_SECRET) return send(res, 503, { error: "Set MONEYMOVES_WEBHOOK_SECRET first." });
      if (!verified(raw, req.headers["mm-signature"])) return send(res, 400, { error: "Bad signature." });
      const event = JSON.parse(raw);
      // Answer first; an event we've had already is still a success.
      send(res, 200, { received: true });
      if (!seen.has(event.id)) {
        seen.add(event.id);
        onEvent(event);
      }
      return;
    }
    if (req.method === "GET" && (p === "/" || p === "/index.html")) return serveFile(res, "index.html");
    if (req.method === "GET" && /^\/order\/ord_[a-f0-9]{10}$/.test(p)) return serveFile(res, "order.html");
    if (req.method === "GET" && p === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && /^\/[a-z0-9._-]+$/i.test(p)) return serveFile(res, p.slice(1));
    send(res, 404, { error: "Nothing here." });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (!(e instanceof ApiError)) console.error("[shop]", e);
    if (!res.headersSent) send(res, status >= 400 && status < 600 ? status : 500, { error: e instanceof ApiError ? e.message : "Something went wrong. Try again." });
  }
});

await load();
server.listen(PORT, () => console.log(`[shop] Kòkó Coffee on :${PORT} · key ${KEY ? KEY.slice(0, 8) + "…" : "missing"} · webhooks ${WEBHOOK_SECRET ? "on" : "off"}`));
