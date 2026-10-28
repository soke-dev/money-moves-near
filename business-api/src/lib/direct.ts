/**
 * Direct account checkouts: the rules every part shares.
 *
 * A direct checkout is API-only, naira only, and paid into the business's own
 * Flutterwave subaccount (its direct account). A permanent number carries no
 * reference, so each payment is told apart by its exact amount: two open
 * direct payments of one business never share an amount (a few kobo are
 * added when they would). Nothing is settled automatically; our team pays the
 * business by hand and marks it settled. There is no fee.
 */
import type { Business } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./http";
import { kindLimitsNgn, TEST_LIMITS, type Platform } from "./platform";
import { lagosMidnight } from "./risk";
import { psaReady } from "./flutterwave-psa";

type DirectBits = Pick<Business, "directAllowed" | "psaReference" | "psaAccountNumber">;

/** Whether the business can take direct payments right now. */
export const directOn = (b: DirectBits) => b.directAllowed && !!b.psaReference && !!b.psaAccountNumber && psaReady();

/** One direct checkout's least and most, in kobo: the business's own, else the platform's naira checkout limits. */
export function directLimits(p: Platform, b: Pick<Business, "kind" | "directMinNgn" | "directMaxNgn">) {
  const d = kindLimitsNgn(p, b.kind, "naira");
  const max = Math.min(b.directMaxNgn ?? d.maxNgn, TEST_LIMITS.maxKobo / 100);
  let min = b.directMinNgn ?? d.minNgn;
  if (min >= max) min = Math.min(d.minNgn, max - 1);
  return { minKobo: Math.round(min * 100), maxKobo: Math.round(max * 100) };
}

/** Direct money paid in today (since midnight in Lagos), in kobo. */
export async function directTakenTodayKobo(businessId: string) {
  const r = await prisma.payment.aggregate({ where: { businessId, direct: true, status: { in: ["PAID", "UNDERPAID"] }, paidAt: { gte: lagosMidnight() } }, _sum: { receivedKobo: true } });
  return r._sum.receivedKobo ?? 0;
}

/** Refuses an amount that would take the business past its own daily cap for direct payments. */
export async function checkDirectDaily(b: Pick<Business, "id" | "directDailyNgn">, amountKobo: number) {
  if (b.directDailyNgn == null) return;
  const taken = await directTakenTodayKobo(b.id);
  if (taken + amountKobo > b.directDailyNgn * 100) {
    throw new HttpError(403, "This business can't take more direct payments today. Try again tomorrow.", "direct_daily_limit");
  }
}

/**
 * An amount no other open direct payment of this business has: the price as
 * it is, or a few kobo more when it would clash. The customer pays at most 99
 * kobo extra, and every deposit has one payment it can be.
 */
export async function uniqueDirectAmount(businessId: string, amountKobo: number): Promise<number> {
  const open = await prisma.payment.findMany({ where: { businessId, direct: true, status: "OPEN", amountKobo: { gte: amountKobo, lt: amountKobo + 100 } }, select: { amountKobo: true } });
  const taken = new Set(open.map((p) => p.amountKobo));
  if (!taken.has(amountKobo)) return amountKobo;
  for (let k = 1; k < 100; k++) if (!taken.has(amountKobo + k)) return amountKobo + k;
  throw new HttpError(409, "Too many payments of this amount are open at once. Try again in a few minutes.", "direct_busy");
}
