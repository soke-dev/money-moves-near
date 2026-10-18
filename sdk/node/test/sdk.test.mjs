// Runs against the built package, with fetch stubbed: no network, no key that works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { MoneyMoves, MoneyMovesConnectionError, MoneyMovesError, MoneyMovesSignatureError, webhooks } from "../dist/esm/index.js";

const KEY = "sk_test_" + "x".repeat(40);

/** A fetch that answers from a list, and remembers what it was asked. */
function fake(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: { "content-type": "application/json", ...(a.headers ?? {}) } });
  };
  return { f, calls };
}

test("refuses a missing or malformed key", () => {
  const was = process.env.MONEYMOVES_SECRET_KEY;
  delete process.env.MONEYMOVES_SECRET_KEY;
  assert.throws(() => new MoneyMoves(), /secret key/);
  assert.throws(() => new MoneyMoves("pk_nope"), /secret key/);
  if (was) process.env.MONEYMOVES_SECRET_KEY = was;
});

test("creates a checkout with the key, the body and the idempotency key", async () => {
  const { f, calls } = fake([{ status: 201, body: { id: "co_1", object: "checkout", status: "open" } }]);
  const mm = new MoneyMoves(KEY, { fetch: f, baseUrl: "https://api.example/v1" });
  const c = await mm.checkouts.create({ amount: 5000, currency: "NGN", reference: "order_1" }, { idempotencyKey: "order_1" });
  assert.equal(c.id, "co_1");
  assert.equal(calls[0].url, "https://api.example/v1/checkouts");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.headers["idempotency-key"], "order_1");
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 5000, currency: "NGN", reference: "order_1" });
});

test("turns API errors into MoneyMovesError with the code and request id", async () => {
  const { f } = fake([{ status: 400, body: { error: { code: "bad_amount", message: "Too small.", request_id: "req_1" } } }]);
  const mm = new MoneyMoves(KEY, { fetch: f });
  await assert.rejects(mm.checkouts.create({ amount: 1, currency: "NGN" }), (e) => e instanceof MoneyMovesError && e.code === "bad_amount" && e.status === 400 && e.requestId === "req_1");
});

test("retries a read after a 5xx, then succeeds", async () => {
  const { f, calls } = fake([{ status: 503, body: { error: { code: "server_error", message: "x" } } }, { body: { object: "rate", ngn_per_usd: 1358 } }]);
  const mm = new MoneyMoves(KEY, { fetch: f });
  const r = await mm.rates.retrieve();
  assert.equal(r.ngn_per_usd, 1358);
  assert.equal(calls.length, 2);
});

test("never retries a write without an idempotency key, and says the outcome is unknown", async () => {
  const { f, calls } = fake([new TypeError("socket hang up"), { body: {} }]);
  const mm = new MoneyMoves(KEY, { fetch: f });
  await assert.rejects(mm.refunds.create({ payment: "MMB-1" }), (e) => e instanceof MoneyMovesConnectionError && e.outcomeUnknown === true);
  assert.equal(calls.length, 1);
});

test("retries a write that has an idempotency key", async () => {
  const { f, calls } = fake([new TypeError("socket hang up"), { status: 201, body: { id: "rf_1" } }]);
  const mm = new MoneyMoves(KEY, { fetch: f });
  const r = await mm.refunds.create({ payment: "MMB-1" }, { idempotencyKey: "refund-1" });
  assert.equal(r.id, "rf_1");
  assert.equal(calls.length, 2);
});

test("each() walks every page", async () => {
  const { f, calls } = fake([
    { body: { object: "list", data: [{ id: "p1" }, { id: "p2" }], has_more: true, next_cursor: "p2" } },
    { body: { object: "list", data: [{ id: "p3" }], has_more: false, next_cursor: null } },
  ]);
  const mm = new MoneyMoves(KEY, { fetch: f });
  const seen = [];
  for await (const p of mm.payments.each({ status: "successful", limit: 2 })) seen.push(p.id);
  assert.deepEqual(seen, ["p1", "p2", "p3"]);
  assert.match(calls[0].url, /status=successful/);
  assert.match(calls[1].url, /starting_after=p2/);
});

test("constructEvent accepts a good signature and refuses a bad or old one", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", object: "event", type: "payment.successful", data: { object: { id: "pay_1" } } });
  const header = webhooks.sign(body, secret);
  assert.equal(webhooks.constructEvent(body, header, secret).id, "evt_1");
  assert.equal(webhooks.constructEvent(Buffer.from(body), header, secret).type, "payment.successful");
  assert.throws(() => webhooks.constructEvent(body + " ", header, secret), MoneyMovesSignatureError);
  assert.throws(() => webhooks.constructEvent(body, header, "whsec_other"), MoneyMovesSignatureError);
  assert.throws(() => webhooks.constructEvent(body, webhooks.sign(body, secret, Math.floor(Date.now() / 1000) - 600), secret), /too long ago/);
  assert.throws(() => webhooks.constructEvent(body, undefined, secret), /No mm-signature/);
});

test("works with require too", () => {
  const require = createRequire(import.meta.url);
  const cjs = require("../dist/cjs/index.js");
  assert.equal(typeof cjs.MoneyMoves, "function");
  assert.equal(typeof cjs.webhooks.constructEvent, "function");
});

test("reads and replies to disputes", async () => {
  const { f, calls } = fake([
    { body: { object: "list", data: [{ id: "dsp_1", object: "dispute", status: "needs_reply" }], has_more: false, next_cursor: null } },
    { body: { id: "dsp_1", object: "dispute", status: "under_review", messages: [] } },
  ]);
  const mm = new MoneyMoves(KEY, { fetch: f, baseUrl: "https://api.example/v1" });
  const list = await mm.disputes.list({ status: "needs_reply", kind: "customer" });
  assert.equal(list.data[0].id, "dsp_1");
  assert.equal(calls[0].url, "https://api.example/v1/disputes?status=needs_reply&kind=customer");
  const d = await mm.disputes.reply("MMBD-7K2Q9XHD", { message: "Delivered on Monday." });
  assert.equal(d.status, "under_review");
  assert.equal(calls[1].url, "https://api.example/v1/disputes/MMBD-7K2Q9XHD/reply");
  assert.deepEqual(JSON.parse(calls[1].init.body), { message: "Delivered on Monday." });
});
