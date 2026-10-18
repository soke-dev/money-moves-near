/**
 * Keeping our record of each Money Moves link in step with the app: a request
 * becomes linked when its owner approves it, ends when they decline or unlink,
 * and lapses after a week with no answer.
 */
import type { MoneyMovesLink } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { readLink, readLinks, type AppLink } from "../lib/app-links";

export const PENDING_FOR_MS = 7 * 86_400_000;

/** The first linked account becomes the default; when the default ends, the oldest linked one takes over. */
async function settleDefault(businessId: string) {
  const linked = await prisma.moneyMovesLink.findMany({ where: { businessId, status: "LINKED" }, orderBy: { linkedAt: "asc" } });
  if (linked.length && !linked.some((l) => l.isDefault)) await prisma.moneyMovesLink.update({ where: { id: linked[0]!.id }, data: { isDefault: true } });
}

/** Asks the app where this one stands, and records it. */
export async function syncLink(link: MoneyMovesLink): Promise<MoneyMovesLink> {
  return record(link, await readLink(link.appLinkId));
}

/** What the app said about one link, recorded. A week with no answer, and it lapses. */
async function record(link: MoneyMovesLink, app: AppLink | null): Promise<MoneyMovesLink> {
  const now = new Date();
  if (link.status === "PENDING" && now.getTime() - link.createdAt.getTime() > PENDING_FOR_MS) {
    const done = await prisma.moneyMovesLink.update({ where: { id: link.id }, data: { status: "EXPIRED", endedAt: now, checkedAt: now } });
    return done;
  }
  if (!app) return prisma.moneyMovesLink.update({ where: { id: link.id }, data: { checkedAt: now } });
  let next: MoneyMovesLink;
  if (app.status === "APPROVED" && link.status === "PENDING") {
    next = await prisma.moneyMovesLink.update({ where: { id: link.id }, data: { status: "LINKED", appAccountId: app.accountId, username: app.username ?? link.username, linkedAt: now, checkedAt: now } });
  } else if (app.status === "DECLINED" && link.status === "PENDING") {
    next = await prisma.moneyMovesLink.update({ where: { id: link.id }, data: { status: "DECLINED", endedAt: now, checkedAt: now } });
  } else if (app.status === "REVOKED" && (link.status === "LINKED" || link.status === "PENDING")) {
    next = await prisma.moneyMovesLink.update({ where: { id: link.id }, data: { status: "UNLINKED", isDefault: false, endedAt: now, checkedAt: now } });
  } else {
    // Still waiting, or still linked - the username may have changed in the app.
    next = await prisma.moneyMovesLink.update({ where: { id: link.id }, data: { checkedAt: now, ...(app.username && link.status === "LINKED" ? { username: app.username } : {}) } });
  }
  if (next.status !== link.status) {
    log.info("[money-moves] link changed", { linkId: link.id, from: link.status, to: next.status });
    await settleDefault(link.businessId);
    // Read again: becoming the default happened after the change above.
    return prisma.moneyMovesLink.findUniqueOrThrow({ where: { id: link.id } });
  }
  return next;
}

/** The worker's round: requests still waiting (often), linked ones (now and then, for an unlink from the app). */
export async function checkLinks(round: number) {
  const where = round % 40 === 0 ? { status: { in: ["PENDING" as const, "LINKED" as const] } } : { status: "PENDING" as const };
  const links = await prisma.moneyMovesLink.findMany({ where, take: 100, orderBy: { checkedAt: { sort: "asc", nulls: "first" } } });
  if (!links.length) return;
  // One call for all of them - the app counts requests from one address.
  const answers = new Map((await readLinks(links.map((l) => l.appLinkId))).map((a) => [a.id, a]));
  for (const l of links) await record(l, answers.get(l.appLinkId) ?? null).catch((e) => log.warn("[money-moves] check failed", { linkId: l.id, reason: String(e?.message ?? e) }));
}
