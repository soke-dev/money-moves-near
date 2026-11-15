/**
 * What happens around a card's payments besides the payment itself: the
 * decline fee, freezing a card after too many declines, and the monthly fee.
 *
 * All three are set from the console (card-settings). The fees start at $0,
 * which leaves them off: nothing is taken and nothing is asked of Nuvion.
 * Fees only ever come out of the card's own balance, and only what it has;
 * a card that can't cover a fee is left alone rather than pushed below zero.
 */
import type { Card } from "@prisma/client";
import { prisma } from "./prisma";
import * as nuvion from "./nuvion";
import { cardSettings } from "./card-settings";
import { moneyOf } from "./card-accounts";
import { chargeCardFee } from "./card-fees";
import { recordCardEvent } from "./card-ledger";

const DAY = 24 * 60 * 60 * 1000;

/** A declined payment's fee, when one is set and the card can pay it. Safe to call twice for one decline. */
async function chargeDeclineFee(card: Card, declineId: string): Promise<void> {
  const fee = Math.round((await cardSettings()).declineFee * 100);
  // A frozen or closed card is declined because of that; it never pays for it.
  if (fee <= 0 || card.status !== "active") return;
  const money = await moneyOf(card);
  const balance = await nuvion.accountAvailableCents(money.accountId).catch(() => 0);
  if (balance < fee) return;
  try {
    await chargeCardFee(money.accountId, fee, `decline-${declineId}`);
    await recordCardEvent({
      userId: card.userId,
      event: "fee",
      amountUsd: fee / 100,
      cardId: card.id,
      cardName: card.name,
      reference: `fee-decline-${declineId}`,
      note: "Decline fee",
    });
  } catch (err: any) {
    console.warn(`[CARD-GUARD] decline fee for ${card.id} not taken: ${err?.message}`);
  }
}

export interface DeclineOutcome {
  /** True when this decline froze the card. */
  frozen: boolean;
  /** The declines that did it, oldest first, for the email. */
  declines: { merchant: string; amount: number; at: Date }[];
  hours: number;
}

/**
 * After a decline is written to the ledger: takes the decline fee, then
 * freezes the card if it has now been declined too many times. Declines from
 * before an earlier auto freeze don't count again, so unfreezing gives the
 * person a fresh count. A card already frozen, by them or by us, is left alone.
 */
export async function afterDecline(card: Card, declineId: string): Promise<DeclineOutcome> {
  const s = await cardSettings();
  await chargeDeclineFee(card, declineId);

  const none: DeclineOutcome = { frozen: false, declines: [], hours: s.autoFreezeHours };
  if (s.autoFreezeDeclines < 1 || card.status !== "active" || card.kind !== "VIRTUAL") return none;

  const windowStart = new Date(Date.now() - s.autoFreezeHours * 60 * 60 * 1000);
  const since = card.autoFrozenAt && card.autoFrozenAt > windowStart ? card.autoFrozenAt : windowStart;
  const rows = await prisma.transaction.findMany({
    where: {
      userId: card.userId,
      type: "CARD",
      createdAt: { gt: since },
      AND: [{ metadata: { path: ["cardEvent"], equals: "declined" } }, { metadata: { path: ["cardId"], equals: card.id } }],
    },
    orderBy: { createdAt: "asc" },
    select: { amount: true, createdAt: true, metadata: true },
  });
  if (rows.length < s.autoFreezeDeclines) return none;

  // One freeze per run of declines: whoever writes autoFrozenAt first does it.
  const claimed = await prisma.card.updateMany({
    where: { id: card.id, status: "active", OR: [{ autoFrozenAt: null }, { autoFrozenAt: { lte: since } }] },
    data: { autoFrozenAt: new Date() },
  });
  if (claimed.count === 0) return none;
  try {
    await nuvion.freezeCard(card.nuvionCardId);
  } catch (err: any) {
    // Not frozen after all: put the claim back so the next decline tries again.
    await prisma.card.update({ where: { id: card.id }, data: { autoFrozenAt: card.autoFrozenAt } });
    console.error(`[CARD-GUARD] couldn't freeze ${card.id} after ${rows.length} declines: ${err?.message}`);
    return none;
  }
  await prisma.card.update({ where: { id: card.id }, data: { status: "blocked" } });
  console.log(`[CARD-GUARD] froze ${card.id} (${card.userId}) after ${rows.length} declines in ${s.autoFreezeHours}h`);
  return {
    frozen: true,
    hours: s.autoFreezeHours,
    declines: rows.map((r) => ({
      merchant: String((r.metadata as any)?.merchant || "A merchant"),
      amount: Number(r.amount),
      at: r.createdAt,
    })),
  };
}

/**
 * The monthly fee on everyday cards, every 30 days from the day each was
 * made (or last charged). Run on a timer; does nothing while the fee is $0.
 * Never charges back months it missed: one fee, then 30 days from then. A card
 * that can't cover it is tried again on the next run. The reference holds each period to
 * one charge, so a run that dies halfway can't take it twice.
 */
export async function chargeMonthlyFees(): Promise<void> {
  const fee = Math.round((await cardSettings()).monthlyFee * 100);
  if (fee <= 0) return;
  const due = new Date(Date.now() - 30 * DAY);
  const cards = await prisma.card.findMany({
    where: {
      deletedAt: null,
      kind: "VIRTUAL",
      status: { in: ["active", "blocked"] },
      OR: [{ monthlyFeeAt: { lte: due } }, { monthlyFeeAt: null, createdAt: { lte: due } }],
    },
    take: 100,
  });
  for (const card of cards) {
    try {
      const from = card.monthlyFeeAt ?? card.createdAt;
      const period = from.toISOString().slice(0, 10);
      const money = await moneyOf(card);
      if ((await nuvion.accountAvailableCents(money.accountId)) < fee) continue;
      await chargeCardFee(money.accountId, fee, `month-${card.id}-${period}`);
      await prisma.card.update({ where: { id: card.id }, data: { monthlyFeeAt: new Date() } });
      await recordCardEvent({
        userId: card.userId,
        event: "fee",
        amountUsd: fee / 100,
        cardId: card.id,
        cardName: card.name,
        reference: `fee-month-${card.id}-${period}`,
        note: "Monthly card fee",
      });
    } catch (err: any) {
      console.warn(`[CARD-GUARD] monthly fee for ${card.id} not taken: ${err?.message}`);
    }
  }
}
