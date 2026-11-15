/**
 * Card balance back to the person's own wallet: Nuvion converts the card's
 * dollars to USDC at a locked rate and sends it on Solana (its on-ramp).
 *
 * Only to the person's own upgraded wallet address, sized from the card's live
 * balance at Nuvion. Nuvion charges its fee on top, to the card account; "Max"
 * tries a few cents less when that fee wouldn't fit. A refused transfer is
 * never created, so trying again with a smaller amount can't send twice.
 */
import type { Card } from "@prisma/client";
import { prisma } from "./prisma";
import * as nuvion from "./nuvion";
import { moneyOf, ensureUserAccount } from "./card-accounts";
import { recordCardEvent, settleCardEvent } from "./card-ledger";
import { sendNotification } from "./push";

class Refused extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function startWithdrawal(args: { userId: string; card: Card; cents: number | null }) {
  const { userId, card } = args;
  const money = await moneyOf(card);
  const balance = await nuvion.accountAvailableCents(money.accountId);
  const cents = args.cents ?? balance;
  if (cents < 1) throw new Refused("There's nothing on this card to move.");
  if (cents > balance) throw new Refused(`This card has ${usd(balance)}.`);

  // Their own Solana address, on their upgraded wallet.
  const wallet = await prisma.wallet.findFirst({ where: { userId, chain: "SOL", address: { not: null } }, select: { address: true } });
  if (!wallet?.address) throw new Refused("Your Solana wallet isn't set up yet. Open the app's wallet once, then try again.");
  const address = wallet.address;

  // The wallet as a Nuvion destination, registered once and kept.
  const acct = await ensureUserAccount(userId);
  let detailId = acct.walletAddress === address ? acct.walletDetailId : null;
  if (!detailId) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true, username: true } });
    detailId = await nuvion.addSolanaWalletDetail(address, [u.firstName, u.lastName].filter(Boolean).join(" ") || `@${u.username}`);
    await prisma.cardAccount.update({ where: { userId }, data: { walletAddress: address, walletDetailId: detailId } });
  }

  const row = await prisma.cardWithdrawal.create({ data: { userId, cardId: card.id, amountCents: cents, address } });

  // Max: if Nuvion's fee doesn't fit on top, a few cents less each time.
  const tries = args.cents === null ? [cents, cents - 5, cents - 25, cents - 100].filter((c) => c > 0) : [cents];
  let lastError = "";
  for (let i = 0; i < tries.length; i++) {
    const amount = tries[i];
    try {
      const quote = await nuvion.createFxQuote("USD", "USC", amount, money.accountId);
      const t = await nuvion.sendToWallet({
        fromAccountId: money.accountId,
        cents: amount,
        paymentDetailId: detailId,
        fxQuoteId: quote.id,
        reference: `mm-card-out-${row.id}-${i}`,
      });
      const status = t.status === "successful" ? "SENT" : t.status === "failed" ? "FAILED" : "PENDING";
      await prisma.cardWithdrawal.update({
        where: { id: row.id },
        data: { amountCents: amount, feeCents: t.applicable_fee || 0, nuvionTransferId: t.id, status, reason: t.status === "failed" ? t.status_reason || null : null },
      });
      if (status === "FAILED") throw new Refused(`The withdrawal was refused${t.status_reason ? `: ${t.status_reason}` : ""}. Nothing left your card.`);
      await recordCardEvent({
        userId,
        event: "toWallet",
        amountUsd: amount / 100,
        cardId: card.id,
        cardName: card.name,
        reference: `out-${row.id}`,
        note: "USDC on Solana",
        status: status === "SENT" ? "COMPLETED" : "PROCESSING",
      });
      console.log(`[CARD-OUT] ${userId} moved ${amount} cents from card ${card.id} to ${address}: ${t.id} ${t.status}`);
      return { status: status === "SENT" ? "sent" : "pending", amount: amount / 100, fee: (t.applicable_fee || 0) / 100, to: address };
    } catch (err: any) {
      if (err instanceof Refused) throw err;
      lastError = err?.message || String(err);
      const short = err instanceof nuvion.NuvionError && (err.type === "error_transfer_insufficient_funds" || /enough|insufficient/i.test(err.message));
      if (short && i < tries.length - 1) continue; // Max only: a little less
      await prisma.cardWithdrawal.update({ where: { id: row.id }, data: { status: "FAILED", reason: lastError.slice(0, 300) } });
      if (short) throw new Refused("The withdrawal fee needs a little left on the card. Try a slightly smaller amount.");
      throw err;
    }
  }
  throw new Error(lastError || "Couldn't withdraw the money");
}

async function finish(id: string, status: "SENT" | "FAILED", reason?: string | null) {
  const w = await prisma.cardWithdrawal.findUnique({ where: { id } });
  if (!w || w.status !== "PENDING") return;
  await prisma.cardWithdrawal.update({ where: { id }, data: { status, reason: reason ?? null } });
  await settleCardEvent(`out-${id}`, status === "SENT" ? "COMPLETED" : "FAILED");
  await sendNotification({
    userId: w.userId,
    type: "transaction",
    title: status === "SENT" ? "Withdrawn to your wallet" : "Couldn't withdraw your card money",
    body:
      status === "SENT"
        ? `${usd(w.amountCents)} is on its way to your wallet as USDC on Solana.`
        : `${usd(w.amountCents)} stayed on your card. Try again, or contact support.`,
  }).catch(() => undefined);
}

/** From the webhook: a stablecoin send of ours finished. */
export async function withdrawalTransferDone(transferId: string, ok: boolean, reason?: string | null) {
  const w = await prisma.cardWithdrawal.findUnique({ where: { nuvionTransferId: transferId } });
  if (w) await finish(w.id, ok ? "SENT" : "FAILED", reason);
}

/** Asks Nuvion about this person's sends still on their way. */
export async function syncWithdrawals(userId: string) {
  const open = await prisma.cardWithdrawal.findMany({ where: { userId, status: "PENDING", nuvionTransferId: { not: null } }, take: 10 });
  for (const w of open) {
    const t = await nuvion.getTransfer(w.nuvionTransferId!).catch(() => null);
    if (t?.status === "successful") await finish(w.id, "SENT");
    else if (t?.status === "failed") await finish(w.id, "FAILED", t.status_reason);
  }
}
