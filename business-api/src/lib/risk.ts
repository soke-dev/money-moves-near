/**
 * How much a business can take in live in a day before our team looks. Past
 * it, payments still come in, but their settlements wait for a person, so a
 * fraudulent business or a stolen account can't move a lot of money before
 * anyone notices. New businesses start lower; our team can set any business's
 * own limit. The business is never told: it sees the settlement on its way.
 *
 * Also what counts as unusual: a business taking in far more today than it
 * usually does.
 */
import type { Business, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Platform } from "./platform";

const DAY = 86_400_000;
const LAGOS_MS = 3_600_000;

/** Midnight today in Lagos, as a moment. */
export function lagosMidnight(now = Date.now()) {
  const t = new Date(now + LAGOS_MS);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - LAGOS_MS);
}

/** Its daily limit in naira: its own, or the platform's for a business its age. */
export function dailyLimitNgn(b: Pick<Business, "dailyLimitNgn" | "createdAt">, rules: Platform) {
  if (b.dailyLimitNgn != null) return b.dailyLimitNgn;
  const young = Date.now() - b.createdAt.getTime() < rules.risk.newDays * DAY;
  return young ? rules.risk.newDailyNgn : rules.risk.dailyNgn;
}

/** What it has taken in live today, in kobo: payments that arrived since midnight in Lagos. */
export async function takenTodayKobo(db: Prisma.TransactionClient | typeof prisma, businessId: string) {
  const r = await db.payment.aggregate({ where: { businessId, mode: "LIVE", status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: lagosMidnight() } }, _sum: { receivedKobo: true } });
  return r._sum.receivedKobo ?? 0;
}

/** Whether today's takings are past its limit: if they are, the limit, for the settlement's timeline. */
export async function overDailyLimit(db: Prisma.TransactionClient | typeof prisma, b: Business, rules: Platform): Promise<{ dailyLimitNgn: number; takenTodayNgn: number } | null> {
  const limit = dailyLimitNgn(b, rules);
  const taken = await takenTodayKobo(db, b.id);
  return taken > limit * 100 ? { dailyLimitNgn: limit, takenTodayNgn: taken / 100 } : null;
}

export type Unusual = { businessId: string; name: string; todayNgn: number; usualNgn: number; limitNgn: number; overLimit: boolean; spike: boolean; ageDays: number };

/**
 * Live businesses worth a look today: past their daily limit, or taking in
 * many times their usual day (and more than a floor, so a quiet business's
 * first sale isn't a spike).
 */
export async function unusualToday(rules: Platform): Promise<Unusual[]> {
  const midnight = lagosMidnight();
  const monthAgo = new Date(midnight.getTime() - 30 * DAY);
  const today = await prisma.payment.groupBy({ by: ["businessId"], where: { mode: "LIVE", status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: midnight } }, _sum: { receivedKobo: true } });
  if (!today.length) return [];
  const ids = today.map((t) => t.businessId);
  const [before, businesses] = await Promise.all([
    prisma.payment.groupBy({ by: ["businessId"], where: { businessId: { in: ids }, mode: "LIVE", status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: monthAgo, lt: midnight } }, _sum: { receivedKobo: true } }),
    prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, dailyLimitNgn: true, createdAt: true } }),
  ]);
  const out: Unusual[] = [];
  for (const t of today) {
    const b = businesses.find((x) => x.id === t.businessId);
    if (!b) continue;
    const todayNgn = (t._sum.receivedKobo ?? 0) / 100;
    const ageDays = Math.max(1, Math.min(30, Math.floor((midnight.getTime() - b.createdAt.getTime()) / DAY)));
    const usualNgn = ((before.find((x) => x.businessId === b.id)?._sum.receivedKobo ?? 0) / 100) / ageDays;
    const limitNgn = dailyLimitNgn(b, rules);
    const overLimit = todayNgn > limitNgn;
    const spike = todayNgn >= rules.risk.spikeMinNgn && todayNgn > usualNgn * rules.risk.spikeTimes;
    if (overLimit || spike) out.push({ businessId: b.id, name: b.name, todayNgn, usualNgn: Math.round(usualNgn), limitNgn, overLimit, spike, ageDays });
  }
  return out.sort((a, b) => b.todayNgn - a.todayNgn);
}
