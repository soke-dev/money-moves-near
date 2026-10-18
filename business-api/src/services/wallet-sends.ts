/**
 * Money leaving a business wallet, after it's signed: following the transaction
 * to the chain, and - for a payout to a bank - paying the naira once the USDC
 * is confirmed in our treasury. A payout bigger than the review limit waits
 * for a person; the business sees it as on its way. Nothing is ever sent twice:
 * the bank payout is keyed by the send's reference.
 */
import type { WalletSend } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { payoutEvent } from "./events";
import { markFunded } from "./refunds";
import { evmTxStatus, type EvmChain } from "../lib/evm-send";
import { floatTxStatus } from "../lib/float";
import { needsReview, payoutsOn, platform } from "../lib/platform";
import { railsFor } from "../rails";
import type { PayoutState } from "../rails/types";
import { env } from "../config/env";

/** Marks a send whose broadcast answer was lost: only such a send is given up on if the chain never shows it. */
export const UNCLEAR_SEND = "Sent without a clear answer from the network.";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function recordBankPayout(id: string, st: PayoutState) {
  if (st.state === "settled") {
    const done = await prisma.walletSend.updateMany({ where: { id, status: "PAYING" }, data: { status: "PAID" } });
    if (done.count) void payoutEvent(id, "payout.completed");
  } else if (st.state === "failed") {
    const done = await prisma.walletSend.updateMany({ where: { id, status: "PAYING" }, data: { status: "FAILED", failureReason: st.reason } });
    if (done.count) log.warn("[wallet-send] bank payout failed, waiting for ops", { sendId: id, reason: st.reason });
    if (done.count) void payoutEvent(id, "payout.failed");
  }
}

/** The USDC is final on-chain. An address send is done; a bank send pays out now - unless it's waiting for review or payouts are off. */
export async function onConfirmed(s: WalletSend): Promise<void> {
  const moved = await prisma.walletSend.updateMany({ where: { id: s.id, status: "SENT" }, data: { status: "CONFIRMED", failureReason: null } });
  // Funding a refund: the USDC is in our treasury, so the refund goes on to the customer. Not a payout, so no payout event.
  if (s.refundId) {
    if (!moved.count) return;
    const r = await prisma.refund.findUnique({ where: { id: s.refundId } });
    if (!r) return;
    if (r.status !== "AWAITING_FUNDS") log.error("[wallet-send] a refund's funding landed after the refund stopped waiting, for ops to send back", { ref: s.ref, refund: r.ref, status: r.status });
    else await markFunded(r, { walletSend: s.ref, chain: s.chain, amountUsdc: Number(s.amountMicros) / 1e6, tx: s.txHash }, "system", s.txHash);
    return;
  }
  // To an address, it's done the moment the chain has it.
  if (moved.count && s.kind !== "BANK") void payoutEvent(s.id, "payout.completed");
  if (!moved.count || s.kind !== "BANK") return;
  await payBank({ ...s, status: "CONFIRMED" });
}

export async function payBank(s: WalletSend): Promise<void> {
  if (s.kind !== "BANK" || s.status !== "CONFIRMED" || !s.payoutKobo || !s.bankCode || !s.accountNumber) return;
  const rules = await platform();
  // Over the limit: a person releases it. The business only ever sees "on its way".
  if (needsReview(rules, { kobo: s.payoutKobo })) return;
  if (!(await payoutsOn())) return;
  const claimed = await prisma.walletSend.updateMany({ where: { id: s.id, status: "CONFIRMED" }, data: { status: "PAYING" } });
  if (!claimed.count) return;
  try {
    const st = await railsFor("LIVE").sendPayout({
      reference: s.ref,
      amountKobo: s.payoutKobo,
      bankCode: s.bankCode,
      accountNumber: s.accountNumber,
      accountName: s.accountName ?? "",
      narration: `From ${env.FLUTTERWAVE_SENDER_NAME}`,
    });
    await recordBankPayout(s.id, st);
  } catch (e) {
    // We can't tell if the rail took it: it stays PAYING and is asked about by reference - never resent.
    log.warn("[wallet-send] bank payout outcome unknown", { ref: s.ref, reason: reason(e) });
  }
}

/** The worker's round: lapse unsigned ones, follow broadcast ones, and ask the rail about bank payouts in flight. */
export async function followWalletSends(): Promise<void> {
  await prisma.walletSend.updateMany({ where: { status: "PREPARED", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });

  const sent = await prisma.walletSend.findMany({ where: { status: "SENT", txHash: { not: null } }, orderBy: { updatedAt: "asc" }, take: 20 });
  for (const s of sent) {
    try {
      // Movement and Solana are asked the way the float's own payouts are; EVM chains by receipt.
      const st = s.chain === "MOVEMENT" || s.chain === "SOLANA" ? await floatTxStatus(s.chain, s.txHash!) : await evmTxStatus(s.chain as EvmChain, s.txHash!);
      if (st === "settled") await onConfirmed(s);
      else if (st === "failed") {
        const done = await prisma.walletSend.updateMany({ where: { id: s.id, status: "SENT" }, data: { status: "FAILED", failureReason: "The transaction failed on-chain. Nothing left the wallet." } });
        if (done.count && !s.refundId) void payoutEvent(s.id, "payout.failed");
      } else if (st === "unknown" && s.failureReason === UNCLEAR_SEND && Date.now() - s.updatedAt.getTime() > 30 * 60_000) {
        // Its answer was lost when it went, and the chain still hasn't seen it half an hour on: it never got there.
        const done = await prisma.walletSend.updateMany({ where: { id: s.id, status: "SENT" }, data: { status: "FAILED", failureReason: "The transaction never reached the chain. Nothing left the wallet." } });
        if (done.count && !s.refundId) void payoutEvent(s.id, "payout.failed");
      }
    } catch (e) {
      log.warn("[wallet-send] follow-up failed", { ref: s.ref, reason: reason(e) });
    }
  }

  // Confirmed bank sends not yet paid (payouts were off, or they were waiting for review and have been released).
  const owed = await prisma.walletSend.findMany({ where: { status: "CONFIRMED", kind: "BANK" }, orderBy: { updatedAt: "asc" }, take: 20 });
  for (const s of owed) await payBank(s);

  const paying = await prisma.walletSend.findMany({ where: { status: "PAYING", updatedAt: { lt: new Date(Date.now() - 30_000) } }, orderBy: { updatedAt: "asc" }, take: 20 });
  for (const s of paying) {
    try {
      const st = await railsFor("LIVE").checkPayout(s.ref);
      if (st.state !== "unknown") await recordBankPayout(s.id, st);
    } catch (e) {
      log.warn("[wallet-send] payout check failed", { ref: s.ref, reason: reason(e) });
    }
  }
}
