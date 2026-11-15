/**
 * Making a card, in one place: the button, and the card someone asked for
 * with their first top up, which is made by itself once that money lands.
 *
 * The card creation fee (ours) moves from their card balance into the float
 * first and comes back only if Nuvion then fails to make the card. Nuvion's
 * own fee, when there is one, it takes itself.
 */
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import * as nuvion from "./nuvion";
import { limitsFor } from "./card-settings";
import { chargeCardFee, refundCardFee } from "./card-fees";
import { sendNotification } from "./push";

export type CardKindIn = "everyday" | "one-time";

export class IssueError extends Error {
  constructor(
    readonly code: "MAX_CARDS" | "FEE_REQUIRED" | "NO_ACCOUNT" | "NO_HOLDER",
    message: string,
    readonly status: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A Nigerian number in international form, or null. The card issuer needs one for every holder. */
export function e164(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  if (/^234\d{10}$/.test(d)) return `+${d}`;
  if (/^0\d{10}$/.test(d)) return `+234${d.slice(1)}`;
  return null;
}

/** What a new card costs this person right now, in cents: Nuvion's fee plus ours. */
export async function cardCostCents(userId: string, nuvionAccountId?: string): Promise<{ issuer: number; ours: number; total: number }> {
  const limits = await limitsFor(userId);
  const ours = Math.round(limits.cardFee * 100);
  const issuer = nuvionAccountId ? await nuvion.cardCreationFeeCents(nuvionAccountId) : 0;
  return { issuer, ours, total: issuer + ours };
}

export async function liveCardCount(userId: string): Promise<number> {
  return prisma.card.count({ where: { userId, deletedAt: null, status: { in: ["active", "blocked"] } } });
}

export async function issueCard(userId: string, kind: CardKindIn, name: string) {
  const limits = await limitsFor(userId);
  if ((await liveCardCount(userId)) >= limits.maxCards) {
    throw new IssueError("MAX_CARDS", `You can hold up to ${limits.maxCards} card${limits.maxCards === 1 ? "" : "s"}. Delete one to add another.`, 400);
  }
  const account = await prisma.cardAccount.findUnique({ where: { userId } });
  if (!account) throw new IssueError("NO_ACCOUNT", "Top up your card balance to cover the card creation fee first.", 402);

  const [cost, balance] = await Promise.all([
    cardCostCents(userId, account.nuvionAccountId),
    nuvion.accountAvailableCents(account.nuvionAccountId),
  ]);
  if (balance < cost.total) {
    throw new IssueError("FEE_REQUIRED", `Top up at least $${((cost.total - balance) / 100).toFixed(2)} to cover the card creation fee first.`, 402, {
      fee: cost.total / 100,
    });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { firstName: true, lastName: true, email: true, phone: true },
  });
  const phone = e164(user.phone);
  if (!user.firstName || !user.lastName || !phone) throw new IssueError("NO_HOLDER", "Your name or phone number is missing.", 400);

  const feeRef = randomUUID();
  let feeTransferId: string | null = null;
  if (cost.ours > 0) feeTransferId = await chargeCardFee(account.nuvionAccountId, cost.ours, feeRef);

  // Create is not idempotent at Nuvion: one attempt per call, never retried here.
  const made = await nuvion
    .createCard({
      kind: kind === "one-time" ? "disposable" : "virtual",
      accountId: account.nuvionAccountId,
      name,
      holder: { first_name: user.firstName, last_name: user.lastName, email: user.email, phone_number: phone },
    })
    .catch(async (err) => {
      if (feeTransferId) {
        await refundCardFee(account.paymentDetailId, cost.ours, feeRef).catch((e) =>
          console.error(`[CARDS] card creation fee ${feeRef} for ${userId} not returned after a failed create: ${e?.message}`),
        );
      }
      throw err;
    });

  let last4: string | null = null;
  try {
    last4 = (await nuvion.cardDetails(made.id)).number.slice(-4);
  } catch {
    /* shown as •••• until the next read */
  }
  const card = await prisma.card.create({
    data: {
      userId,
      nuvionCardId: made.id,
      kind: kind === "one-time" ? "DISPOSABLE" : "VIRTUAL",
      name,
      last4,
      status: made.status || "active",
      feeCents: cost.ours,
      feeTransferId,
    },
  });
  console.log(`[CARDS] ${userId} got a ${kind} card ${card.id}`);
  return card;
}

/**
 * Makes the card asked for with a top up, once the balance covers it.
 *
 * Taken by exactly one caller (the asked-at time is the claim). If Nuvion
 * plainly refused, or the balance isn't there yet, the request is put back to
 * try again. If the answer was lost, it is NOT put back: a second create could
 * make a second card, so that one waits for a person (pendingCardError says so).
 */
export async function fulfilPendingCard(userId: string): Promise<void> {
  const account = await prisma.cardAccount.findUnique({ where: { userId } });
  if (!account?.pendingCard || !account.pendingCardAt || account.blockedAt) return;
  const want = account.pendingCard as { kind: CardKindIn; name: string };

  // Asked for, but the send never came: let it go after two hours.
  if (Date.now() - account.pendingCardAt.getTime() > 2 * 60 * 60 * 1000) {
    const sent = await prisma.cardTopup.count({ where: { userId, createdAt: { gte: account.pendingCardAt }, status: { not: "FAILED" } } });
    if (!sent) {
      await prisma.cardAccount.updateMany({
        where: { userId, pendingCardAt: account.pendingCardAt },
        data: { pendingCard: null as any, pendingCardAt: null, pendingCardError: null },
      });
      return;
    }
  }

  const [cost, balance] = await Promise.all([
    cardCostCents(userId, account.nuvionAccountId).catch(() => null),
    nuvion.accountAvailableCents(account.nuvionAccountId).catch(() => null),
  ]);
  if (!cost || balance === null || balance < cost.total) return; // not yet

  const took = await prisma.cardAccount.updateMany({
    where: { userId, pendingCardAt: account.pendingCardAt },
    data: { pendingCardAt: null },
  });
  if (took.count === 0) return;

  const putBack = (why: string) =>
    prisma.cardAccount.update({ where: { userId }, data: { pendingCardAt: new Date(), pendingCardError: why } });

  try {
    const card = await issueCard(userId, want.kind, want.name);
    await prisma.cardAccount.update({ where: { userId }, data: { pendingCard: null as any, pendingCardError: null } });
    await sendNotification({
      userId,
      type: "transaction",
      title: "Your card is ready",
      body: `${card.name} is ready to use.`,
    }).catch(() => undefined);
  } catch (err: any) {
    if (err instanceof IssueError) {
      if (err.code === "MAX_CARDS" || err.code === "NO_HOLDER") {
        await prisma.cardAccount.update({ where: { userId }, data: { pendingCard: null as any, pendingCardError: err.message } });
      } else {
        await putBack(err.message);
      }
      return;
    }
    if (err instanceof nuvion.NuvionError && err.status >= 400 && err.status < 500) {
      await putBack(`refused: ${err.message}`);
      return;
    }
    console.error(`[CARDS] pending card for ${userId} unknown after create: ${err?.message}`);
    await prisma.cardAccount.update({
      where: { userId },
      data: { pendingCardError: `create answer lost, check Nuvion before retrying: ${String(err?.message || err).slice(0, 160)}` },
    });
  }
}
