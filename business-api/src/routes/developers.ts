/**
 * The dashboard's developer side: webhook endpoints and their signing secret,
 * the events we sent and what each server said back, every request the keys
 * made, and the IP whitelist. One set per mode, like the keys.
 *
 * For whoever builds with the API, and whoever runs the business.
 */
import { Router } from "express";
import { z } from "zod";
import type { ApiAllowedIp, WebhookDelivery, WebhookEndpoint } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { body, HttpError } from "../lib/http";
import { audit } from "../lib/audit";
import { limited } from "../lib/limits";
import { modeOf } from "../lib/checkouts";
import { requireMember } from "../middleware/auth";
import { cleanIp } from "../lib/allowed-ips";
import { EVENT_GROUPS, EVENT_TYPES, checkEndpointUrl, eventObject, resend, rollSecret, sendTest, setEnforceIps, setRetries, signingSecret } from "../lib/webhooks";

const router = Router({ mergeParams: true });

const DEV = ["OWNER", "ADMIN", "DEVELOPER"] as const;
const MAX_ENDPOINTS = 10;
const MAX_IPS = 50;
const PAGE = 100;

const modeIn = z.enum(["TEST", "LIVE"]);
const eventsIn = z
  .array(z.string())
  .min(1, "Pick at least one event to send.")
  .refine((list) => list.every((e) => EVENT_TYPES.includes(e)), "One of those events doesn't exist.");
/** Every event picked is kept as "all", so an event we add later reaches it too. */
const keptEvents = (list: string[]) => (EVENT_TYPES.every((e) => list.includes(e)) ? [] : [...new Set(list)]);

// ─── Webhooks ─────────────────────────────────────────────────────────────

function endpointShape(e: WebhookEndpoint, stats?: { ok: number; failed: number; lastAt: Date | null }) {
  const tried = (stats?.ok ?? 0) + (stats?.failed ?? 0);
  return {
    id: e.id,
    url: e.url,
    note: e.note,
    events: e.events.length ? e.events : EVENT_TYPES,
    allEvents: e.events.length === 0,
    enabled: e.enabled,
    createdAt: e.createdAt,
    /** Since when every delivery has failed, and when we turned it off for that. */
    failingSince: e.failingSince,
    autoDisabledAt: e.autoDisabledAt,
    /** Delivered on the first try or a retry, of every delivery that's finished, last 30 days. Null with none yet. */
    deliveredPct: tried ? Math.round((stats!.ok / tried) * 1000) / 10 : null,
    lastAt: stats?.lastAt ?? null,
  };
}

async function ownEndpoint(businessId: string, id: string) {
  const e = await prisma.webhookEndpoint.findFirst({ where: { id, businessId, deletedAt: null } });
  if (!e) throw new HttpError(404, "That endpoint isn't here any more.", "not_found");
  return e;
}

router.get("/webhooks", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const mode = modeOf(req.query.mode);
  const [endpoints, settings] = await Promise.all([
    prisma.webhookEndpoint.findMany({ where: { businessId, mode, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    signingSecret(businessId, mode),
  ]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const counts = endpoints.length
    ? await prisma.webhookDelivery.groupBy({ by: ["endpointId", "status"], where: { endpointId: { in: endpoints.map((e) => e.id) }, createdAt: { gte: since } }, _count: true, _max: { createdAt: true } })
    : [];
  const stats = new Map<string, { ok: number; failed: number; lastAt: Date | null }>();
  for (const c of counts) {
    const s = stats.get(c.endpointId) ?? { ok: 0, failed: 0, lastAt: null };
    if (c.status === "SUCCEEDED") s.ok += c._count;
    if (c.status === "FAILED") s.failed += c._count;
    if (c._max.createdAt && (!s.lastAt || c._max.createdAt > s.lastAt)) s.lastAt = c._max.createdAt;
    stats.set(c.endpointId, s);
  }
  res.json({
    endpoints: endpoints.map((e) => endpointShape(e, stats.get(e.id))),
    groups: EVENT_GROUPS,
    retries: settings.retries,
    rolledAt: settings.rolledAt,
  });
});

/** The signing secret, shown when asked for. */
router.get("/webhooks/secret", requireMember(...DEV), limited(60), async (req, res) => {
  const { secret } = await signingSecret(req.member!.businessId, modeOf(req.query.mode));
  res.json({ secret });
});

/** A new signing secret: every event from now on is signed with it, and the old one stops working at once. */
router.post("/webhooks/secret/roll", requireMember(...DEV), limited(20), async (req, res) => {
  const businessId = req.member!.businessId;
  const { mode } = body(z.object({ mode: modeIn }), req);
  const secret = await rollSecret(businessId, mode);
  await audit(req, "webhook_secret_rolled", { businessId, detail: { mode } });
  res.json({ secret });
});

router.put("/webhooks/settings", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ mode: modeIn, retries: z.boolean() }), req);
  await setRetries(businessId, b.mode, b.retries);
  res.json({ retries: b.retries });
});

router.post("/webhooks", requireMember(...DEV), limited(30), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ mode: modeIn, url: z.string().trim().min(1, "Enter your endpoint's address.").max(500), note: z.string().trim().max(60).optional(), events: eventsIn }), req);
  if ((await prisma.webhookEndpoint.count({ where: { businessId, mode: b.mode, deletedAt: null } })) >= MAX_ENDPOINTS) {
    throw new HttpError(400, `You have ${MAX_ENDPOINTS} endpoints already. Remove one you don't use first.`, "too_many_endpoints");
  }
  const url = await checkEndpointUrl(b.url);
  const e = await prisma.webhookEndpoint.create({ data: { businessId, mode: b.mode, url, note: b.note || null, events: keptEvents(b.events), createdById: req.auth!.userId } });
  await audit(req, "webhook_endpoint_added", { businessId, detail: { endpointId: e.id, mode: e.mode, url } });
  res.status(201).json({ endpoint: endpointShape(e) });
});

router.patch("/webhooks/:id", requireMember(...DEV), limited(60), async (req, res) => {
  const businessId = req.member!.businessId;
  const e = await ownEndpoint(businessId, String(req.params.id));
  const b = body(z.object({ url: z.string().trim().min(1).max(500).optional(), note: z.string().trim().max(60).nullable().optional(), events: eventsIn.optional(), enabled: z.boolean().optional() }), req);
  const url = b.url !== undefined && b.url !== e.url ? await checkEndpointUrl(b.url) : undefined;
  const saved = await prisma.webhookEndpoint.update({
    where: { id: e.id },
    data: { ...(url ? { url } : {}), ...(b.note !== undefined ? { note: b.note || null } : {}), ...(b.events ? { events: keptEvents(b.events) } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.enabled === true ? { failingSince: null, warnedAt: null, autoDisabledAt: null } : {}) },
  });
  if (url) await audit(req, "webhook_endpoint_changed", { businessId, detail: { endpointId: e.id, url } });
  res.json({ endpoint: endpointShape(saved) });
});

/** Removed, not deleted: what was sent to it stays readable under Events. */
router.delete("/webhooks/:id", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const e = await ownEndpoint(businessId, String(req.params.id));
  await prisma.webhookEndpoint.update({ where: { id: e.id }, data: { deletedAt: new Date(), enabled: false } });
  // Nothing more goes to it.
  await prisma.webhookDelivery.updateMany({ where: { endpointId: e.id, status: "PENDING" }, data: { status: "FAILED", error: "The endpoint was removed.", nextAt: null } });
  await audit(req, "webhook_endpoint_removed", { businessId, detail: { endpointId: e.id, url: e.url } });
  res.json({ ok: true });
});

router.post("/webhooks/:id/test", requireMember(...DEV), limited(30), async (req, res) => {
  const e = await ownEndpoint(req.member!.businessId, String(req.params.id));
  if (!e.enabled) throw new HttpError(409, "Turn the endpoint on first.", "endpoint_off");
  res.json({ delivery: deliveryShape(await sendTest(e), e) });
});

// ─── Events: what we sent ─────────────────────────────────────────────────

function deliveryShape(d: WebhookDelivery, endpoint?: Pick<WebhookEndpoint, "url" | "note"> | null, type?: string) {
  return {
    id: d.id,
    eventId: d.eventId,
    type: type ?? null,
    endpointId: d.endpointId,
    endpointUrl: endpoint?.url ?? null,
    endpointNote: endpoint?.note ?? null,
    status: d.status,
    attempts: d.attempts,
    responseCode: d.responseCode,
    durationMs: d.durationMs,
    error: d.error,
    nextAt: d.nextAt,
    createdAt: d.createdAt,
    deliveredAt: d.deliveredAt,
  };
}

/** Every delivery, newest first: which event, to which endpoint, and what came back. */
router.get("/deliveries", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const mode = modeOf(req.query.mode);
  const endpointId = typeof req.query.endpoint === "string" && req.query.endpoint !== "all" ? req.query.endpoint : undefined;
  const after = typeof req.query.after === "string" ? req.query.after : undefined;
  const rows = await prisma.webhookDelivery.findMany({
    where: { endpoint: { businessId, mode }, ...(endpointId ? { endpointId } : {}) },
    include: { event: { select: { type: true } }, endpoint: { select: { url: true, note: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  res.json({ deliveries: page.map((d) => deliveryShape(d, d.endpoint, d.event.type)), next: rows.length > PAGE ? page[page.length - 1]!.id : null });
});

/** One delivery, with the event exactly as it was sent, and every other try of it. */
router.get("/deliveries/:id", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const d = await prisma.webhookDelivery.findFirst({ where: { id: String(req.params.id), endpoint: { businessId } }, include: { event: true, endpoint: { select: { url: true, note: true } } } });
  if (!d) throw new HttpError(404, "That delivery isn't here.", "not_found");
  const tries = await prisma.webhookDelivery.findMany({ where: { eventId: d.eventId, endpointId: d.endpointId }, orderBy: { createdAt: "desc" }, take: 20 });
  res.json({
    delivery: { ...deliveryShape(d, d.endpoint, d.event.type), responseBody: d.responseBody },
    event: eventObject(d.event),
    tries: tries.map((t) => deliveryShape(t, d.endpoint, d.event.type)),
  });
});

/** The same event to the same endpoint again, now. */
router.post("/deliveries/:id/resend", requireMember(...DEV), limited(60), async (req, res) => {
  const businessId = req.member!.businessId;
  const d = await prisma.webhookDelivery.findFirst({ where: { id: String(req.params.id), endpoint: { businessId } }, include: { endpoint: true, event: { select: { type: true } } } });
  if (!d) throw new HttpError(404, "That delivery isn't here.", "not_found");
  if (!d.endpoint.enabled || d.endpoint.deletedAt) throw new HttpError(409, "That endpoint is off or removed. Turn it on to send to it.", "endpoint_off");
  res.json({ delivery: deliveryShape(await resend(d.id), d.endpoint, d.event.type) });
});

// ─── Logs: what the keys asked ────────────────────────────────────────────

const RANGE_MS = { today: 0, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;

router.get("/logs", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const mode = modeOf(req.query.mode);
  const q = req.query;
  const range = typeof q.range === "string" && q.range in RANGE_MS ? (q.range as keyof typeof RANGE_MS) : "30d";
  const from = range === "today" ? new Date(new Date().setHours(0, 0, 0, 0)) : new Date(Date.now() - RANGE_MS[range]);
  const method = typeof q.method === "string" && ["GET", "POST", "DELETE"].includes(q.method) ? q.method : undefined;
  const after = typeof q.after === "string" ? q.after : undefined;
  const rows = await prisma.apiRequest.findMany({
    where: { businessId, mode, createdAt: { gte: from }, ...(q.status === "ok" ? { status: { lt: 300 } } : q.status === "failed" ? { status: { gte: 300 } } : {}), ...(method ? { method } : {}) },
    select: { id: true, method: true, path: true, status: true, durationMs: true, ip: true, apiKeyId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  const keyIds = [...new Set(page.map((r) => r.apiKeyId).filter((k): k is string => !!k))];
  const keys = keyIds.length ? await prisma.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, name: true, revokedAt: true } }) : [];
  const keyName = new Map(keys.map((k) => [k.id, k.revokedAt ? `${k.name} (revoked)` : k.name]));
  res.json({
    logs: page.map((r) => ({ ...r, key: r.apiKeyId ? (keyName.get(r.apiKeyId) ?? "A removed key") : null })),
    next: rows.length > PAGE ? page[page.length - 1]!.id : null,
  });
});

router.get("/logs/:id", requireMember(...DEV), async (req, res) => {
  const r = await prisma.apiRequest.findFirst({ where: { id: String(req.params.id), businessId: req.member!.businessId } });
  if (!r) throw new HttpError(404, "That request isn't in the logs. They're kept for 30 days.", "not_found");
  const key = r.apiKeyId ? await prisma.apiKey.findUnique({ where: { id: r.apiKeyId }, select: { name: true, revokedAt: true } }) : null;
  res.json({ log: { ...r, key: key ? (key.revokedAt ? `${key.name} (revoked)` : key.name) : null } });
});

// ─── IP whitelist ─────────────────────────────────────────────────────────

const ipShape = (a: ApiAllowedIp) => ({ id: a.id, ip: a.ip, label: a.label, createdAt: a.createdAt, lastSeenAt: a.lastSeenAt });

router.get("/ips", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const mode = modeOf(req.query.mode);
  const [ips, settings] = await Promise.all([prisma.apiAllowedIp.findMany({ where: { businessId, mode }, orderBy: { createdAt: "asc" } }), signingSecret(businessId, mode)]);
  // The address this dashboard is used from, to add in one tap.
  res.json({ ips: ips.map(ipShape), enforce: settings.enforceIps, yourIp: cleanIp(req.clientIp) });
});

router.post("/ips", requireMember(...DEV), limited(60), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ mode: modeIn, ip: z.string().trim().min(1, "Enter an address.").max(64), label: z.string().trim().max(60).optional() }), req);
  const ip = cleanIp(b.ip);
  if (!ip) throw new HttpError(400, "That isn't an IP address. One IPv4 or IPv6 address, no ranges.", "bad_ip");
  if ((await prisma.apiAllowedIp.count({ where: { businessId, mode: b.mode } })) >= MAX_IPS) throw new HttpError(400, `The whitelist holds ${MAX_IPS} addresses at most.`, "too_many_ips");
  if (await prisma.apiAllowedIp.findUnique({ where: { businessId_mode_ip: { businessId, mode: b.mode, ip } } })) throw new HttpError(409, "That address is on the list already.", "ip_exists");
  const a = await prisma.apiAllowedIp.create({ data: { businessId, mode: b.mode, ip, label: b.label || null, createdById: req.auth!.userId } });
  await audit(req, "api_ip_added", { businessId, detail: { mode: b.mode, ip } });
  res.status(201).json({ ip: ipShape(a) });
});

router.delete("/ips/:id", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const a = await prisma.apiAllowedIp.findFirst({ where: { id: String(req.params.id), businessId } });
  if (!a) throw new HttpError(404, "That address isn't on the list.", "not_found");
  await prisma.apiAllowedIp.delete({ where: { id: a.id } });
  await audit(req, "api_ip_removed", { businessId, detail: { mode: a.mode, ip: a.ip } });
  res.json({ ok: true });
});

router.put("/ips/enforce", requireMember(...DEV), async (req, res) => {
  const businessId = req.member!.businessId;
  const b = body(z.object({ mode: modeIn, enforce: z.boolean() }), req);
  await setEnforceIps(businessId, b.mode, b.enforce);
  await audit(req, b.enforce ? "api_ips_enforced" : "api_ips_relaxed", { businessId, detail: { mode: b.mode } });
  res.json({ enforce: b.enforce });
});

export default router;
