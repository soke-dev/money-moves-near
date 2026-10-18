/**
 * Webhooks: telling a business's server the moment something happens.
 *
 * Something happens (a payment succeeds, a settlement lands) and it becomes an
 * event - one row, with the object as it was at that moment. Every endpoint of
 * that business, in that mode, that hears that type gets a delivery: the event
 * as JSON, POSTed to its URL, signed with the business's secret for the mode:
 *
 *   mm-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *
 * A 2xx within 10 seconds is delivered. Anything else is tried again - 5
 * minutes, 30 minutes, 2 hours, 6 hours, then 16 hours later - unless the
 * business switched retries off. Nothing that happens to money ever waits on a
 * webhook, and a webhook that fails never undoes anything.
 *
 * Endpoints are on the open internet only: an address that resolves to a
 * private, loopback or internal network is refused, at the moment of sending
 * as well as when it's saved - so nobody can point us at our own services.
 */
import crypto from "crypto";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import type { Mode, WebhookDelivery, WebhookEndpoint } from "@prisma/client";
import { prisma } from "./prisma";
import { log } from "./log";
import { HttpError } from "./http";
import { open, seal } from "./vault";
import { dashboardUrl, sendEmail } from "./email";

/** The events we send, grouped as the dashboard shows them. Only what really happens is here. */
export const EVENT_GROUPS: [string, string[]][] = [
  ["Payments", ["payment.successful", "payment.underpaid", "payment.expired"]],
  ["Invoices", ["invoice.paid"]],
  ["Settlements", ["settlement.completed"]],
  ["Refunds", ["refund.created", "refund.completed"]],
  ["Disputes", ["dispute.created", "dispute.updated", "dispute.closed"]],
  ["Payouts", ["payout.completed", "payout.failed"]],
];
export const EVENT_TYPES = EVENT_GROUPS.flatMap(([, e]) => e);

/** After the first try fails: how long until each next one. Five more, over about a day. */
const RETRY_AFTER_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 16 * 3_600_000];
const TIMEOUT_MS = 10_000;

// ─── The signing secret ───────────────────────────────────────────────────

const newSecret = () => `whsec_${crypto.randomBytes(24).toString("base64url")}`;
/** Sealed, as the database stores bytes. */
const sealed = (secret: string): Uint8Array<ArrayBuffer> => new Uint8Array(seal(Buffer.from(secret)));

/** A business's signing secret for a mode, with its other developer settings - made the first time it's asked for. */
export async function signingSecret(businessId: string, mode: Mode): Promise<{ secret: string; retries: boolean; rolledAt: Date; enforceIps: boolean }> {
  let row = await prisma.developerSetting.findUnique({ where: { businessId_mode: { businessId, mode } } });
  if (!row) {
    try {
      row = await prisma.developerSetting.create({ data: { businessId, mode, secret: sealed(newSecret()) } });
    } catch {
      // Two at once: the other one made it.
      row = await prisma.developerSetting.findUniqueOrThrow({ where: { businessId_mode: { businessId, mode } } });
    }
  }
  return { secret: open(Buffer.from(row.secret)).toString(), retries: row.retries, rolledAt: row.rolledAt, enforceIps: row.enforceIps };
}

/** A new secret: from now on every event is signed with it. */
export async function rollSecret(businessId: string, mode: Mode): Promise<string> {
  const secret = newSecret();
  await prisma.developerSetting.upsert({
    where: { businessId_mode: { businessId, mode } },
    create: { businessId, mode, secret: sealed(secret) },
    update: { secret: sealed(secret), rolledAt: new Date() },
  });
  return secret;
}

export async function setRetries(businessId: string, mode: Mode, retries: boolean) {
  await signingSecret(businessId, mode);
  await prisma.developerSetting.update({ where: { businessId_mode: { businessId, mode } }, data: { retries } });
}

/** The IP whitelist on or off: on, a refund by API only from an allowed address. */
export async function setEnforceIps(businessId: string, mode: Mode, enforceIps: boolean) {
  await signingSecret(businessId, mode);
  await prisma.developerSetting.update({ where: { businessId_mode: { businessId, mode } }, data: { enforceIps } });
}

/** Whether the whitelist is on, without making a secret nobody asked for. */
export async function enforcingIps(businessId: string, mode: Mode): Promise<boolean> {
  const row = await prisma.developerSetting.findUnique({ where: { businessId_mode: { businessId, mode } }, select: { enforceIps: true } });
  return !!row?.enforceIps;
}

/** The header a delivery carries: "t=…,v1=…". */
export function signatureFor(secret: string, body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${crypto.createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
}

// ─── Only the open internet ───────────────────────────────────────────────

/** Whether an address is somewhere we must never send: private, loopback, link-local, carrier NAT, multicast or reserved. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

/** An endpoint URL worth saving: HTTPS, a real host name, nothing internal. Throws a sentence the dashboard can show. */
export async function checkEndpointUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That isn't a web address. It starts https://", "bad_url");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "Use an https:// address, so events travel encrypted.", "bad_url");
  if (u.username || u.password) throw new HttpError(400, "Leave the user name and password out of the address.", "bad_url");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || net.isIP(host)) {
    throw new HttpError(400, "Use your server's public address, a domain name on the internet. Tunnels like ngrok work for testing.", "bad_url");
  }
  const addresses = await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new HttpError(400, "That address doesn't point anywhere yet. Check the domain.", "bad_url");
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new HttpError(400, "That address points at a private network. Use your server's public address.", "bad_url");
  return u.toString();
}

/** A lookup that refuses private addresses at the moment of connecting - so a domain can't be changed to point inward after it's saved. */
function publicLookup(hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = (addresses as dns.LookupAddress[]).filter((a) => !isPrivateAddress(a.address));
    if (!list.length) return callback(Object.assign(new Error("That address points at a private network."), { code: "EPRIVATE" }), "", 4);
    if ((options as { all?: boolean }).all) return callback(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
}

/** POSTs a body, never following a redirect, with a hard time limit. */
function post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = (u.protocol === "https:" ? https : http).request(
      u,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, lookup: publicLookup as never, timeout: TIMEOUT_MS },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => {
          if (text.length < 2_000) text += c;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text.slice(0, 2_000), ms: Date.now() - started }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("No answer within 10 seconds")));
    req.on("error", reject);
    req.end(body);
  });
}

// ─── Events and deliveries ────────────────────────────────────────────────

const newEventId = () => `evt_${crypto.randomBytes(12).toString("base64url")}`;

/** An event, as the API returns it and every endpoint receives it. */
export const eventObject = (e: { id: string; type: string; mode: Mode; createdAt: Date; data: unknown }) => ({
  id: e.id,
  object: "event",
  type: e.type,
  mode: e.mode === "TEST" ? "test" : "live",
  created_at: e.createdAt.toISOString(),
  data: { object: e.data },
});
export const eventBody = (e: Parameters<typeof eventObject>[0]) => JSON.stringify(eventObject(e));

/**
 * Something happened: the event is recorded, and every endpoint that hears it
 * gets a delivery, tried at once. Never throws - money never waits on this.
 */
export async function emit(businessId: string, mode: Mode, type: string, data: unknown): Promise<void> {
  try {
    const event = await prisma.webhookEvent.create({ data: { id: newEventId(), businessId, mode, type, data: data as object } });
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { businessId, mode, enabled: true, deletedAt: null } });
    const hearing = endpoints.filter((e) => e.events.length === 0 || e.events.includes(type));
    for (const endpoint of hearing) {
      const d = await prisma.webhookDelivery.create({ data: { eventId: event.id, endpointId: endpoint.id, status: "PENDING", nextAt: new Date() } });
      void deliver(d.id).catch(() => {});
    }
  } catch (e) {
    log.warn("[webhooks] couldn't record an event", { businessId, type, reason: e instanceof Error ? e.message : String(e) });
  }
}

/** A test event to one endpoint, sent now: to check the address and the signature check on the other side. */
export async function sendTest(endpoint: WebhookEndpoint): Promise<WebhookDelivery> {
  const event = await prisma.webhookEvent.create({
    data: { id: newEventId(), businessId: endpoint.businessId, mode: endpoint.mode, type: "webhook.test", data: { object: "test", message: "This is a test event from Money Moves. If you can read this, your endpoint works." } },
  });
  const d = await prisma.webhookDelivery.create({ data: { eventId: event.id, endpointId: endpoint.id, status: "PENDING", nextAt: new Date() } });
  await deliver(d.id);
  return prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
}

/** The same event to the same endpoint again, now - after the server was fixed, say. */
export async function resend(deliveryId: string): Promise<WebhookDelivery> {
  const was = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  const d = await prisma.webhookDelivery.create({ data: { eventId: was.eventId, endpointId: was.endpointId, status: "PENDING", nextAt: new Date() } });
  await deliver(d.id);
  return prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
}

/** One try of one delivery: claimed first, so two workers never both send it. */
export async function deliver(deliveryId: string): Promise<void> {
  const claimed = await prisma.webhookDelivery.updateMany({ where: { id: deliveryId, status: "PENDING", nextAt: { lte: new Date() } }, data: { status: "SENDING" } });
  if (!claimed.count) return;
  const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { event: true, endpoint: true } });
  const attempts = d.attempts + 1;
  // An endpoint switched off or removed since: nothing more is sent to it.
  if (!d.endpoint.enabled || d.endpoint.deletedAt) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", error: "The endpoint was switched off.", nextAt: null } });
    return;
  }
  const body = eventBody(d.event);
  let result: { status: number; body: string; ms: number } | null = null;
  let error: string | null = null;
  try {
    const { secret } = await signingSecret(d.event.businessId, d.event.mode);
    result = await post(d.endpoint.url, body, {
      "content-type": "application/json",
      "user-agent": "MoneyMoves-Webhooks/1.0",
      "mm-event": d.event.type,
      "mm-event-id": d.event.id,
      "mm-signature": signatureFor(secret, body),
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const real = d.event.type !== "webhook.test";
  if (result && result.status >= 200 && result.status < 300) {
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCEEDED", attempts, responseCode: result.status, responseBody: result.body, durationMs: result.ms, error: null, deliveredAt: new Date(), nextAt: null } });
    // One delivery that lands is enough: the endpoint isn't failing any more.
    if (real && d.endpoint.failingSince) await prisma.webhookEndpoint.updateMany({ where: { id: d.endpoint.id }, data: { failingSince: null, warnedAt: null } });
    return;
  }
  // Failing from now, unless it already was. Test events never count either way.
  if (real && !d.endpoint.failingSince) await prisma.webhookEndpoint.updateMany({ where: { id: d.endpoint.id, failingSince: null }, data: { failingSince: new Date() } });
  const { retries } = await signingSecret(d.event.businessId, d.event.mode).catch(() => ({ retries: true }));
  const wait = retries && d.event.type !== "webhook.test" ? RETRY_AFTER_MS[attempts - 1] : undefined;
  await prisma.webhookDelivery.update({
    where: { id: d.id },
    data: {
      status: wait ? "PENDING" : "FAILED",
      attempts,
      responseCode: result?.status ?? null,
      responseBody: result?.body ?? null,
      durationMs: result?.ms ?? null,
      error: error ?? (result ? `Answered ${result.status}` : null),
      nextAt: wait ? new Date(Date.now() + wait) : null,
    },
  });
}

/** The worker's round: deliveries that are due, oldest first - and any left mid-send by a restart. */
export async function deliverDue(): Promise<void> {
  // A delivery stuck SENDING (the process stopped mid-try) goes back to waiting after a few minutes.
  await prisma.webhookDelivery.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: "PENDING", nextAt: new Date() } });
  const due = await prisma.webhookDelivery.findMany({ where: { status: "PENDING", nextAt: { lte: new Date() } }, orderBy: { nextAt: "asc" }, take: 25, select: { id: true } });
  await Promise.all(due.map((d) => deliver(d.id).catch((e) => log.warn("[webhooks] delivery failed", { id: d.id, reason: e instanceof Error ? e.message : String(e) }))));
}

// ─── Endpoints that keep failing ──────────────────────────────────────────

const HOUR = 3_600_000;
const WARN_AFTER = 24 * HOUR;
const OFF_AFTER = 72 * HOUR;
const OFF_NOT_BEFORE_WARNING = 48 * HOUR;
const day = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

/** The business's owner and admins: who hears that an endpoint is failing. */
async function toldAboutEndpoints(businessId: string): Promise<string[]> {
  const members = await prisma.member.findMany({ where: { businessId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: { select: { email: true } } } });
  return [...new Set(members.map((m) => m.user.email))];
}

/**
 * The worker's hourly look at endpoints that keep failing. After a day of
 * nothing but failures, the owner and admins get an email saying which
 * endpoint, since when, and when we'll turn it off. After three days, and at
 * least two days after that email, we turn it off and say so. One delivery
 * that succeeds resets all of it.
 */
export async function watchFailingEndpoints(): Promise<void> {
  const now = Date.now();
  const toWarn = await prisma.webhookEndpoint.findMany({
    where: { enabled: true, deletedAt: null, warnedAt: null, failingSince: { lte: new Date(now - WARN_AFTER) } },
    include: { business: { select: { name: true } } },
    take: 50,
  });
  for (const e of toWarn) {
    const claimed = await prisma.webhookEndpoint.updateMany({ where: { id: e.id, warnedAt: null }, data: { warnedAt: new Date() } });
    if (!claimed.count || !e.failingSince) continue;
    const offOn = new Date(Math.max(e.failingSince.getTime() + OFF_AFTER, now + OFF_NOT_BEFORE_WARNING));
    const mode = e.mode === "LIVE" ? "live" : "test";
    for (const to of await toldAboutEndpoints(e.businessId)) {
      void sendEmail(
        to,
        `A ${mode} webhook endpoint for ${e.business.name} keeps failing`,
        `Every event we've sent to this ${mode} endpoint since ${day(e.failingSince)} has failed:\n\n${e.url}${e.note ? ` (${e.note})` : ""}\n\nYour server either didn't answer, or didn't answer with a 2xx within 10 seconds. We're still trying, but if nothing gets through by ${day(offOn)}, we'll turn the endpoint off.\n\nWhat your server said back to each event is in the dashboard, under Developer portal, Events. Once it's fixed, one successful delivery is enough to stop this.\n\nMoney Moves`,
        { label: "Webhooks", cta: { label: "See what failed", url: dashboardUrl("/settings/events") } },
      ).catch(() => {});
    }
    log.warn("[webhooks] endpoint keeps failing, owner told", { endpointId: e.id, since: e.failingSince.toISOString() });
  }

  const toTurnOff = await prisma.webhookEndpoint.findMany({
    where: { enabled: true, deletedAt: null, failingSince: { lte: new Date(now - OFF_AFTER) }, warnedAt: { lte: new Date(now - OFF_NOT_BEFORE_WARNING) } },
    include: { business: { select: { name: true } } },
    take: 50,
  });
  for (const e of toTurnOff) {
    const off = await prisma.webhookEndpoint.updateMany({ where: { id: e.id, enabled: true }, data: { enabled: false, autoDisabledAt: new Date() } });
    if (!off.count) continue;
    await prisma.webhookDelivery.updateMany({ where: { endpointId: e.id, status: "PENDING" }, data: { status: "FAILED", error: "The endpoint was turned off after failing for three days.", nextAt: null } });
    const mode = e.mode === "LIVE" ? "live" : "test";
    for (const to of await toldAboutEndpoints(e.businessId)) {
      void sendEmail(
        to,
        `We turned off a ${mode} webhook endpoint for ${e.business.name}`,
        `Every event we've sent to this ${mode} endpoint has failed since ${day(e.failingSince!)}, so we've turned it off:\n\n${e.url}${e.note ? ` (${e.note})` : ""}\n\nNothing about your payments has changed: they still settle as usual, and every event is still recorded. When your server is fixed, turn the endpoint back on under Developer portal, Webhooks. Events from while it was off aren't sent on their own, so send again the ones you need from the Events tab, or read them with the Events API.\n\nMoney Moves`,
        { label: "Webhooks", cta: { label: "Turn it back on", url: dashboardUrl("/settings/webhooks") } },
      ).catch(() => {});
    }
    log.warn("[webhooks] endpoint turned off for failing", { endpointId: e.id });
  }
}

/** Old records go: requests and events after 30 days, idempotency answers after a day. */
export async function pruneDeveloperRecords(): Promise<void> {
  const month = new Date(Date.now() - 30 * 86_400_000);
  await prisma.apiRequest.deleteMany({ where: { createdAt: { lt: month } } });
  await prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 86_400_000) } } });
  await prisma.webhookEvent.deleteMany({ where: { createdAt: { lt: month } } });
}
