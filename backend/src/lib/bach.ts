/**
 * bach.ts — Bachs payout (off-ramp) integration. Replaces Paystack for paying
 * users out to their Nigerian bank when they sell crypto.
 *
 * Flow: resolve account -> register destination (must be approved/usable) ->
 * create payout (amount is a DECIMAL STRING, e.g. "5000.00") -> track status.
 * Amounts are what the destination receives; Bach charges its fee on top and
 * debits (amount + fee) from your Bach balance (see `total_debited`).
 *
 * Set BACH_API_KEY (+ BACH_BASE_URL). When unset, isBachConfigured() is false.
 */
import { env } from "../config/env";
import { prisma } from "./prisma";
import { sendNotification } from "./push";

const base = () => (env.BACH_BASE_URL || "https://api.bachs.io").replace(/\/$/, "");

/**
 * Always false: Bachs is retired in favour of Flutterwave.
 *
 * The rest of this module is left intact so historical payouts stay readable
 * and the switch is one line to reverse, but nothing may route new money here.
 * Reporting "not configured" rather than deleting the code means every caller
 * already has a handled path for it.
 */
export function isBachConfigured(): boolean {
  return false;
}

async function bach(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.BACH_API_KEY}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, json };
}

interface BachBank { name: string; slug: string; code: string; nibss_bank_code?: string; country?: string }

export async function bachListBanks(): Promise<BachBank[]> {
  const r = await bach("GET", "/v1/payouts/banks?country_code=NG");
  return (r.json?.banks || r.json?.data || []) as BachBank[];
}

/** Map a bank name to a Bach bank code (fuzzy, like the old Paystack resolver). */
export async function bachBankCodeByName(name: string): Promise<string | null> {
  const banks = await bachListBanks();
  const lower = name.trim().toLowerCase();
  const m =
    banks.find((b) => b.name.toLowerCase() === lower || b.slug === lower) ||
    banks.find((b) => b.name.toLowerCase().includes(lower) || lower.includes(b.name.toLowerCase()));
  return m?.code || null;
}

export async function bachResolveAccount(
  bankCode: string,
  accountNumber: string
): Promise<{ ok: boolean; accountName: string | null; bankName: string | null }> {
  const r = await bach("POST", "/v1/payouts/resolve-account", { bank_code: bankCode, account_number: accountNumber });
  const d = r.json?.data || r.json || {};
  return { ok: r.ok && !!d.account_name, accountName: d.account_name || null, bankName: d.bank_name || null };
}

export interface BachDestination { ok: boolean; id?: string; status?: string; isUsable: boolean; accountName?: string; error?: string }

export async function bachCreateDestination(args: {
  accountNumber: string;
  bankCode: string;
  name?: string;
}): Promise<BachDestination> {
  const r = await bach("POST", "/v1/payouts/destinations", {
    name: args.name || "Money Moves payout",
    currency: "NGN",
    account_number: args.accountNumber,
    bank_code: args.bankCode,
  });
  const d = r.json?.destination || r.json || {};
  return { ok: r.ok && !!d.id, id: d.id, status: d.status, isUsable: !!d.is_usable, accountName: d.account_name, error: r.ok ? undefined : (r.json?.detail || `HTTP ${r.status}`) };
}

export async function bachGetDestination(id: string): Promise<{ ok: boolean; status?: string; isUsable: boolean }> {
  const r = await bach("GET", `/v1/payouts/destinations/${id}`);
  const d = r.json?.destination || r.json || {};
  return { ok: r.ok, status: d.status, isUsable: !!d.is_usable };
}

/**
 * Reuse a previously-registered destination for this (bankCode, accountNumber)
 * if it's still usable, otherwise register it once and cache the id. Prevents a
 * new Bach destination being created on every single payout.
 */
export async function getOrCreateBachDestination(args: {
  bankCode: string;
  accountNumber: string;
  name?: string;
}): Promise<BachDestination> {
  const cached = await prisma.bachDestination
    .findUnique({ where: { bankCode_accountNumber: { bankCode: args.bankCode, accountNumber: args.accountNumber } } })
    .catch(() => null);

  if (cached) {
    const d = await bachGetDestination(cached.destId);
    if (d.isUsable) {
      return { ok: true, id: cached.destId, status: d.status, isUsable: true, accountName: cached.accountName || undefined };
    }
    // Stale / rejected — fall through and register a fresh one.
  }

  const dest = await bachCreateDestination(args);
  if (dest.ok && dest.id) {
    await prisma.bachDestination
      .upsert({
        where: { bankCode_accountNumber: { bankCode: args.bankCode, accountNumber: args.accountNumber } },
        create: { bankCode: args.bankCode, accountNumber: args.accountNumber, destId: dest.id, accountName: dest.accountName ?? null },
        update: { destId: dest.id, accountName: dest.accountName ?? null },
      })
      .catch(() => {});
  }
  return dest;
}

export interface BachPayout { ok: boolean; id?: string; status?: string; fee?: string; totalDebited?: string; error?: string }

export async function bachCreatePayout(args: {
  destination: string;
  amount: string; // decimal string, e.g. "5000.00"
  reference: string; // shown as the recipient's narration
  idempotencyKey: string; // unique per payout — the actual double-pay guard
}): Promise<BachPayout> {
  const r = await bach(
    "POST",
    "/v1/payouts",
    { destination: args.destination, amount: args.amount, reference: args.reference },
    { "Idempotency-Key": args.idempotencyKey }
  );
  const p = r.json?.payout || r.json || {};
  return { ok: r.ok && !!p.id, id: p.id, status: p.status, fee: p.fee, totalDebited: p.total_debited, error: r.ok ? undefined : (r.json?.detail || `HTTP ${r.status}`) };
}

export async function bachGetPayout(
  id: string
): Promise<{ ok: boolean; status?: string; totalDebited?: string; failureReason?: string | null }> {
  const r = await bach("GET", `/v1/payouts/${id}`);
  const p = r.json?.payout || r.json || {};
  return { ok: r.ok, status: p.status, totalDebited: p.total_debited, failureReason: p.failure_reason };
}

/** Format a NGN number as Bach's decimal string (e.g. 5000 -> "5000.00"). */
export function ngnAmount(n: number): string {
  return Number(n).toFixed(2);
}

/**
 * Reconcile PROCESSING sell payouts against Bach — flips them to COMPLETED/FAILED
 * even if the client stopped polling the verify endpoint. Runs on an interval.
 */
export async function reconcilePendingBachPayouts(): Promise<void> {
  if (!isBachConfigured()) return;
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const txs = await prisma.transaction
    .findMany({
      where: { type: "SELL", status: "PROCESSING", createdAt: { gt: since } },
      select: { id: true, reference: true, metadata: true, userId: true },
    })
    .catch(() => [] as any[]);

  for (const tx of txs) {
    try {
      const meta: any = tx.metadata || {};
      let payoutId: string = meta.bachPayoutId || "";

      // Destination was pending at submit — create the payout now if approved.
      if (!payoutId && meta.bachDestId && tx.reference) {
        const d = await bachGetDestination(meta.bachDestId);
        if (d.isUsable) {
          const payout = await bachCreatePayout({ destination: meta.bachDestId, amount: ngnAmount(meta.ngnNet), reference: "Money Moves", idempotencyKey: tx.reference });
          if (payout.ok && payout.id) {
            payoutId = payout.id;
            meta.bachPayoutId = payoutId;
            await prisma.transaction.update({ where: { id: tx.id }, data: { metadata: { ...meta, payoutStatus: payout.status } } });
          }
        }
      }
      if (!payoutId) continue;

      const p = await bachGetPayout(payoutId);
      if (p.status === "completed") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "COMPLETED", metadata: { ...meta, payoutStatus: "completed", completedAt: new Date().toISOString() } },
        });
        await sendNotification({
          userId: tx.userId,
          type: "transaction",
          title: "Sell Completed",
          body: `₦${(meta.ngnNet || 0).toLocaleString()} sent to ${meta.accountName || "your bank"} (${meta.bankName || ""})`,
        }).catch(() => {});
      } else if (p.status === "failed") {
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "FAILED", metadata: { ...meta, payoutStatus: "failed", failReason: p.failureReason || undefined } },
        });
      }
    } catch {}
  }
}
