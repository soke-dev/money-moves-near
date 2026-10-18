import {
  isFlutterwaveConfigured,
  flwBankCodeByName,
  flwResolveAccount,
  flwCreateTransfer,
  flwGetTransfer,
  mapTransferStatus,
} from "./flutterwave";
import {
  isPaystackConfigured,
  psBankCodeByName,
  psResolveAccount,
  psCreateTransfer,
  psGetTransfer,
  mapPaystackTransferStatus,
} from "./paystack";
import { getEffectiveChoice } from "./service-status";
import { prisma } from "./prisma";
import { sendNotification } from "./push";
import { payoutNotice } from "./payout-notice";
import { env } from "../config/env";

/**
 * One payout rail at a time, chosen from the console.
 *
 * Flutterwave went down and took every sell payout with it. So there are two
 * providers now and an admin switch between them - not a fallback chain. A
 * chain sounds safer and is not: two rails that can both fire on one
 * transaction is how money goes out twice, and a payout that has half
 * succeeded somewhere is far worse than one that plainly failed.
 *
 * ── The rule that keeps this safe ───────────────────────────────────────
 *
 * The provider is decided ONCE, when the payout is created, and stamped on
 * the transaction. Every later read - the verify poll, the retry, the webhook,
 * an admin re-check - uses the stamp, never the live switch. Flipping the
 * switch therefore only affects payouts that have not started; anything in
 * flight finishes on the rail that sent it.
 *
 * Without that, throwing the switch while a transfer is settling either
 * double-pays it or orphans it, and both are discovered days later by the
 * person who did not get their money.
 *
 * Funding is untouched. Naira coming in still arrives on Flutterwave virtual
 * accounts, and nothing here has an opinion about that.
 */

export type PayoutProvider = "flutterwave" | "paystack";

export const PAYOUT_PROVIDERS: PayoutProvider[] = ["flutterwave", "paystack"];

export function isPayoutProvider(v: unknown): v is PayoutProvider {
  return v === "flutterwave" || v === "paystack";
}

/** The label the console and the logs use. */
export const PAYOUT_LABELS: Record<PayoutProvider, string> = {
  flutterwave: "Flutterwave",
  paystack: "Paystack",
};

/**
 * Which rail new payouts go out on.
 *
 * The environment variable wins, as it does for every other switch, so there
 * is still a way to force a rail when the database is the thing that is
 * broken. Otherwise the row, and Flutterwave when nobody has said.
 *
 * A provider that is not configured is never returned: choosing Paystack with
 * no secret key should not silently stop payouts, it should fall back to the
 * rail that can actually pay.
 */
export async function activePayoutProvider(): Promise<PayoutProvider> {
  // Resolved in service-status, alongside the options and their readiness, so
  // the rail the console shows as live and the rail that money leaves by are
  // the same answer rather than two implementations of it.
  const chosen = await getEffectiveChoice("payout");
  return isPayoutProvider(chosen) && configured(chosen) ? chosen : "flutterwave";
}

export function configured(provider: PayoutProvider): boolean {
  return provider === "paystack" ? isPaystackConfigured() : isFlutterwaveConfigured();
}

/**
 * The provider a transaction's payout actually went out on.
 *
 * Anything written before this existed has no stamp and is Flutterwave by
 * definition, because Flutterwave was the only rail.
 */
export function providerOf(meta: any): PayoutProvider {
  const stamped = meta?.payoutProvider;
  return isPayoutProvider(stamped) ? stamped : "flutterwave";
}

// ─── The provider-agnostic surface ────────────────────────────

/**
 * Bank name to code, on the given rail.
 *
 * Always from the name, never from a stored code. Only twenty of the forty
 * banks the app offers share a code between the two providers; every fintech
 * differs, so a code minted by one rail means something else or nothing at
 * all on the other.
 */
export async function bankCodeByName(
  provider: PayoutProvider,
  name: string,
): Promise<string | null> {
  return provider === "paystack" ? psBankCodeByName(name) : flwBankCodeByName(name);
}

export async function resolveAccount(
  provider: PayoutProvider,
  bankCode: string,
  accountNumber: string,
): Promise<{ ok: boolean; accountName: string | null; error?: string }> {
  if (provider === "paystack") return psResolveAccount(bankCode, accountNumber);

  const r = await flwResolveAccount(bankCode, accountNumber);
  return {
    ok: r.ok && !!r.accountName,
    accountName: r.accountName ?? null,
    error: r.ok ? undefined : r.error,
  };
}

export type CreatedPayout = {
  ok: boolean;
  /** The provider's own id for the transfer, for later lookups. */
  transferId: string;
  /** NIBSS session id where the rail gives us one. */
  sessionId: string | null;
  status: "PENDING" | "COMPLETED" | "FAILED";
  error?: string;
};

export async function createPayout(
  provider: PayoutProvider,
  args: {
    amount: number;
    bankCode: string;
    accountNumber: string;
    accountName?: string | null;
    reference: string;
    narration?: string;
    meta?: Record<string, unknown>;
  },
): Promise<CreatedPayout> {
  if (provider === "paystack") {
    const r = await psCreateTransfer(args);
    if (!r.ok || !r.transfer) {
      return { ok: false, transferId: "", sessionId: null, status: "FAILED", error: r.error };
    }
    return {
      ok: true,
      // The reference is the handle Paystack's verify endpoint takes, so it is
      // what gets stored rather than the numeric id.
      transferId: String(r.transfer.transfer_code || r.transfer.reference || args.reference),
      sessionId: null,
      status: mapPaystackTransferStatus(r.transfer.status),
    };
  }

  const r = await flwCreateTransfer(args);
  if (!r.ok || !r.transfer) {
    return { ok: false, transferId: "", sessionId: null, status: "FAILED", error: r.error };
  }
  const t: any = r.transfer;
  return {
    ok: true,
    transferId: String(t.id),
    sessionId:
      t.session_id || t.nibss_session_id || t.meta?.nibss_session_id || t.meta?.session_id || null,
    status: mapTransferStatus(t.status),
  };
}

/**
 * Read a payout back.
 *
 * `provider` is the stamp from the transaction, never the current switch -
 * asking the wrong rail about a transfer it never sent returns "not found",
 * which reads exactly like a failure and is not one.
 */
export async function getPayout(
  provider: PayoutProvider,
  idOrReference: string,
): Promise<{ ok: boolean; status: "PENDING" | "COMPLETED" | "FAILED"; raw: any }> {
  if (provider === "paystack") {
    const r = await psGetTransfer(idOrReference);
    return {
      ok: r.ok && !!r.transfer,
      status: mapPaystackTransferStatus(r.transfer?.status),
      raw: r.transfer,
    };
  }

  const r = await flwGetTransfer(idOrReference);
  return {
    ok: r.ok && !!r.transfer,
    status: mapTransferStatus((r.transfer as any)?.status),
    raw: r.transfer,
  };
}

// ─── Settlement ───────────────────────────────────────────────

/**
 * A payout webhook, from whichever rail sent it.
 *
 * Both providers post here through their own route, and the provider is passed
 * in rather than inferred, because the one thing this must never do is let one
 * rail settle the other's transfer.
 *
 * That is not hypothetical. Both use our reference as their idempotency key,
 * so the same string identifies a transfer at both providers - and if a payout
 * were retried onto the second rail after failing on the first, a late webhook
 * from the first would arrive carrying a reference that now belongs to a live
 * transfer somewhere else. Checking the stamp is what stops a stale FAILED
 * from one provider marking a transfer the other is still settling.
 */
/**
 * The NIBSS session id, wherever the rail decided to put it.
 *
 * Flutterwave's dashboard calls it "Proof", and a Nigerian bank will accept it
 * as evidence the money moved - which makes it the single most useful thing we
 * can hand somebody chasing a transfer that has not arrived.
 *
 * It is NOT in the v4 transfer object. Ten settled transfers were checked and
 * payment_information and extra_information came back empty on every one, and
 * there is no /proof or /receipt endpoint - both 404. So the webhook is the
 * only place left, and the field name there is documented nowhere we could
 * find.
 *
 * Hence two ways of recognising it. A key that says what it is, or failing
 * that the shape: a NIP session id is a long unbroken run of digits - thirty
 * on the ones we have seen - and nothing else in these payloads looks remotely
 * like that. Amounts carry decimals, ids carry letters and underscores.
 */
export function sessionIdFrom(payload: unknown): string | null {
  let byName: string | null = null;
  let byShape: string | null = null;

  const walk = (node: any, path: string) => {
    if (node == null || byName) return;
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      return;
    }
    const value = String(node);
    if (/session|proof|nip|nibss/i.test(path) && /^\d{10,40}$/.test(value)) {
      byName = value;
      return;
    }
    if (!byShape && /^\d{20,40}$/.test(value)) byShape = value;
  };

  walk(payload, "");
  return byName ?? byShape;
}

export async function settlePayoutWebhook(args: {
  provider: PayoutProvider;
  reference: string;
  status: "PENDING" | "COMPLETED" | "FAILED";
  reason?: string | null;
  /** The proof, if the settlement payload carried one. */
  sessionId?: string | null;
}): Promise<void> {
  if (args.status === "PENDING") return;

  // Flutterwave echoes the reference with non-alphanumerics stripped
  // ("SELL-abc" -> "SELLabc"), so an exact match on tx.reference usually
  // misses; the stripped form is stored as metadata.payoutReference for this.
  const tx =
    (await prisma.transaction.findUnique({ where: { reference: args.reference } })) ??
    (await prisma.transaction.findFirst({
      where: { metadata: { path: ["payoutReference"], equals: args.reference } },
    }));

  if (!tx || tx.type !== "SELL") return;

  const meta = (tx.metadata ?? {}) as any;
  const sentOn = providerOf(meta);
  if (sentOn !== args.provider) {
    console.warn(
      `[SELL] ${PAYOUT_LABELS[args.provider]} webhook for ${args.reference}, but it was sent on ${PAYOUT_LABELS[sentOn]} — ignoring`,
    );
    return;
  }

  const want = args.status === "COMPLETED" ? "COMPLETED" : "FAILED";
  if (tx.status === want) return;

  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      status: want,
      metadata: {
        ...meta,
        payoutStatus: want === "COMPLETED" ? "success" : "failed",
        // Only ever added, never cleared: a later webhook without one must not
        // take away a proof an earlier one gave us.
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
        ...(want === "COMPLETED" ? { completedAt: new Date().toISOString() } : {}),
        ...(want === "FAILED" ? { failReason: args.reason || "Payout failed" } : {}),
      },
    },
  });

  sendNotification({
    userId: tx.userId,
    type: "transaction",
    ...payoutNotice(tx.metadata, want === "COMPLETED" ? "sent" : "failed"),
  }).catch(() => {});

  console.log(
    `[SELL] ${want === "COMPLETED" ? "✅" : "❌"} ${PAYOUT_LABELS[args.provider]} payout ${want}: ${args.reference}`,
  );
}
