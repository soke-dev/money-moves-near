/**
 * Card events in the app's own transaction list, so Home shows them beside
 * everything else: a card made, a payment, a decline, a refund, money moved
 * back to the wallet.
 *
 * One CARD row each, in dollars (asset USDC, no chain). `reference` is unique,
 * so a webhook retried by Nuvion can't write the same event twice. These rows
 * are a record only: no wallet balance, limit or payout reads them.
 */
import { prisma } from "./prisma";

export type CardEvent = "created" | "paid" | "declined" | "refund" | "toWallet" | "fee";

export async function recordCardEvent(args: {
  userId: string;
  event: CardEvent;
  amountUsd: number;
  cardId: string;
  cardName: string;
  reference: string;
  merchant?: string | null;
  place?: string | null;
  note?: string | null;
  status?: "COMPLETED" | "FAILED" | "PROCESSING";
}): Promise<void> {
  await prisma.transaction
    .create({
      data: {
        userId: args.userId,
        type: "CARD",
        asset: "USDC",
        amount: Math.abs(args.amountUsd),
        status: args.status ?? (args.event === "declined" ? "FAILED" : "COMPLETED"),
        reference: `card-${args.reference}`,
        metadata: {
          cardEvent: args.event,
          cardId: args.cardId,
          cardName: args.cardName,
          ...(args.merchant ? { merchant: args.merchant } : {}),
          ...(args.place ? { place: args.place } : {}),
          ...(args.note ? { note: args.note } : {}),
        },
      },
    })
    .catch((err) => {
      // A repeat of the same event is expected; anything else is worth a line.
      if (!String(err?.code).includes("P2002")) console.warn(`[CARD-LEDGER] ${args.event} for ${args.userId}: ${err?.message}`);
    });
}

/** Moves a card's row from in-flight to done or failed (money moved to the wallet). */
export async function settleCardEvent(reference: string, status: "COMPLETED" | "FAILED"): Promise<void> {
  await prisma.transaction.updateMany({ where: { reference: `card-${reference}` }, data: { status } }).catch(() => undefined);
}
