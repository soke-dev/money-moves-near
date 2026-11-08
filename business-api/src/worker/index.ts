/**
 * The background worker: keeps asking the rail about open payments, and moves
 * settlements along.
 *
 * Polling, because the rail's webhooks go to the Money Moves app's backend
 * (one webhook address per rail account). It's safe to run more than one of
 * these: every step that moves money claims its row first, so two workers
 * can't both send the same settlement.
 */
import { prisma } from "../lib/prisma";
import { log } from "../lib/log";
import { checkPayment, followUpSettlement, sendSettlement } from "../services/payments";
import { diditReady, getDecision } from "../lib/didit";
import { applyDecision } from "../services/application";
import { checkLinks } from "../services/money-moves";
import { appLinksReady } from "../lib/app-links";
import { followWalletSends } from "../services/wallet-sends";
import { refreshNetworks, scanCrypto, settleOwnTransfers } from "../services/crypto-in";
import { followIntents } from "../services/intent-in";
import { scanDirectAccounts } from "../services/direct";
import { moveCryptoOut } from "../services/crypto-out";
import { deliverDue, pruneDeveloperRecords, watchFailingEndpoints } from "../lib/webhooks";
import { checkRefundFunding, completeTestRefunds } from "../services/refunds";
import { sweepDisputes } from "../services/disputes";
import { runRecurringInvoices } from "../services/recurring";

const PAYMENTS_EVERY_MS = 5_000;
const SETTLEMENTS_EVERY_MS = 3_000;
/** A settlement "sending" longer than this gets asked about rather than waited on. */
const STUCK_SENDING_MS = 30_000;

async function checkOpenPayments() {
  // Least recently checked first, so a burst of new payments can't starve older ones.
  const open = await prisma.payment.findMany({
    // Bank transfers with an account to ask about; test app and crypto payments only to see them lapse.
    where: { status: "OPEN", OR: [{ accountNumber: { not: null } }, { method: { in: ["APP", "CRYPTO"] } }] },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: 25,
  });
  for (const p of open) {
    await checkPayment(p).catch((e) => log.warn("[worker] payment check failed", { ref: p.ref, reason: String(e?.message ?? e) }));
  }
}

async function moveSettlements() {
  // Payouts switched off on Services: live queued ones wait (sendSettlement checks); test ones carry on. Ones already with the rail are still followed below.
  {
    // Bank payouts, and on-chain ones - those again only a minute after the last try, so a low float isn't asked every few seconds.
    const queued = await prisma.settlement.findMany({
      where: { status: "QUEUED", OR: [{ destination: "BANK", chain: null }, { chain: { not: null }, updatedAt: { lt: new Date(Date.now() - 60_000) } }] },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const s of queued) await sendSettlement(s);
  }

  const waiting = await prisma.settlement.findMany({
    where: { OR: [{ status: "SENT" }, { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) } }] },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });
  for (const s of waiting) {
    await followUpSettlement(s).catch((e) => log.warn("[worker] settlement follow-up failed", { ref: s.ref, reason: String(e?.message ?? e) }));
  }
}

/**
 * Identity checks still waiting on Didit. Didit's webhook fires once; a check
 * decided later by hand in Didit's console only shows up if we ask.
 */
const IDENTITY_EVERY_MS = 120_000;
async function recheckIdentities() {
  if (!diditReady()) return;
  const waiting = await prisma.identityCheck.findMany({
    where: { status: { in: ["PENDING", "IN_REVIEW"] }, updatedAt: { lt: new Date(Date.now() - IDENTITY_EVERY_MS) }, createdAt: { gt: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  for (const c of waiting) {
    await getDecision(c.sessionId)
      .then((d) => applyDecision(c, d))
      .catch((e) => log.warn("[worker] identity re-check failed", { checkId: c.id, reason: String(e?.message ?? e) }));
  }
}

/** Runs `fn` every `ms`, never two at once. */
/** Money Moves links waiting for the owner's approval in the app - and, every tenth minute, linked ones (an owner can unlink from the app). */
const LINKS_EVERY_MS = 15_000;
let linkRound = 0;
async function recheckLinks() {
  if (!appLinksReady()) return;
  await checkLinks(linkRound++);
}

/** Refunds waiting for the business's transfer; test refunds that have the money reach the customer by themselves. */
const REFUNDS_EVERY_MS = 5_000;
async function moveInvoices() {
  await runRecurringInvoices();
}

async function moveDisputes() {
  await sweepDisputes();
}

async function moveRefunds() {
  const waiting = await prisma.refund.findMany({
    where: { status: "AWAITING_FUNDS", OR: [{ funding: "BANK", fundAccount: { not: null } }, { funding: "APP", fundProviderRef: { not: null } }] },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    take: 25,
  });
  for (const r of waiting) await checkRefundFunding(r).catch((e) => log.warn("[worker] refund check failed", { ref: r.ref, reason: String(e?.message ?? e) }));
  await completeTestRefunds();
}

function every(ms: number, name: string, fn: () => Promise<void>) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (e) {
      log.error(`[worker] ${name}`, { reason: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }, ms);
  return timer;
}

export function startWorker() {
  const timers = [every(PAYMENTS_EVERY_MS, "payments", checkOpenPayments), every(SETTLEMENTS_EVERY_MS, "settlements", moveSettlements), every(IDENTITY_EVERY_MS, "identity", recheckIdentities), every(LINKS_EVERY_MS, "money-moves", recheckLinks), every(REFUNDS_EVERY_MS, "refunds", moveRefunds), every(60_000, "disputes", moveDisputes), every(5 * 60_000, "recurring-invoices", moveInvoices), every(5_000, "wallet-sends", followWalletSends), every(5_000, "crypto", scanCrypto), every(20_000, "intents", followIntents), every(60_000, "own-transfers", settleOwnTransfers), every(30_000, "direct-accounts", scanDirectAccounts), every(15_000, "crypto-out", moveCryptoOut), every(120_000, "networks", refreshNetworks), every(5_000, "webhooks", deliverDue), every(6 * 3_600_000, "developer-records", pruneDeveloperRecords), every(3_600_000, "failing-endpoints", watchFailingEndpoints)];
  // Stellar and TON are offered once they've been read, so read them now rather than in two minutes.
  void refreshNetworks();
  log.info("[worker] checking payments and settlements");
  return () => timers.forEach(clearInterval);
}
