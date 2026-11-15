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
import { sendCardCreatedEmail } from "./email";
import type { CardMoney } from "./card-accounts";
import { recordCardEvent } from "./card-ledger";
import { env } from "../config/env";

/**
 * The email the card issuer gets for a cardholder: ours, tagged with the
 * person (cards+<id>@usemoneymoves.xyz), so whatever the issuer sends lands
 * with us and never in their inbox.
 */
function cardholderEmail(userId: string, _theirs: string): string {
  const [local, domain] = env.NUVION_CARDHOLDER_EMAIL.split("@");
  return `${local}+${userId.slice(-10)}@${domain}`;
}

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

/**
 * Makes a card on `money`, the account its own top up was paid into. Each card
 * has its own account, so a new card never spends another card's balance.
 */
export async function issueCard(
  userId: string,
  kind: CardKindIn,
  name: string,
  opts: { feePaidCents?: number; money: CardMoney },
) {
  const limits = await limitsFor(userId);
  if ((await liveCardCount(userId)) >= limits.maxCards) {
    throw new IssueError("MAX_CARDS", `You can hold up to ${limits.maxCards} card${limits.maxCards === 1 ? "" : "s"}. Delete one to add another.`, 400);
  }
  const account = { nuvionAccountId: opts.money.accountId, paymentDetailId: opts.money.paymentDetailId };

  const [cost, balance] = await Promise.all([
    cardCostCents(userId, account.nuvionAccountId),
    nuvion.accountAvailableCents(account.nuvionAccountId),
  ]);
  // Our fee already kept back from the top up that paid for this card: only Nuvion's is left to cover.
  const feePaid = opts.feePaidCents ?? 0;
  const ours = feePaid > 0 ? 0 : cost.ours;
  const needed = cost.issuer + ours;
  if (balance < needed) {
    throw new IssueError("FEE_REQUIRED", `Top up at least $${((needed - balance) / 100).toFixed(2)} to cover the card creation fee first.`, 402, {
      fee: needed / 100,
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
  if (ours > 0) feeTransferId = await chargeCardFee(account.nuvionAccountId, ours, feeRef);

  // Create is not idempotent at Nuvion: one attempt per call, never retried here.
  const made = await nuvion
    .createCard({
      kind: kind === "one-time" ? "disposable" : "virtual",
      accountId: account.nuvionAccountId,
      name,
      // Our own address, never theirs: the issuer emails its cardholders, and the
      // emails our people get about their cards come from us.
      holder: { first_name: user.firstName, last_name: user.lastName, email: cardholderEmail(userId, user.email), phone_number: phone },
    })
    .catch(async (err) => {
      if (feeTransferId) {
        await refundCardFee(account.paymentDetailId, ours, feeRef).catch((e) =>
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
      feeCents: feePaid > 0 ? feePaid : ours,
      feeTransferId,
      nuvionAccountId: account.nuvionAccountId,
      paymentDetailId: account.paymentDetailId,
    },
  });
  console.log(`[CARDS] ${userId} got a ${kind} card ${card.id}`);
  await recordCardEvent({
    userId,
    event: "created",
    amountUsd: (feePaid > 0 ? feePaid : ours) / 100,
    cardId: card.id,
    cardName: name,
    reference: `created-${card.id}`,
    note: (feePaid > 0 ? feePaid : ours) > 0 ? "Card creation fee" : null,
  });
  nuvion
    .accountAvailableCents(account.nuvionAccountId)
    .then((c) => c / 100)
    .catch(() => null)
    .then((balance) =>
      sendCardCreatedEmail(user.email, {
        card: { name, last4, oneTime: kind === "one-time" },
        holder: `${user.firstName} ${user.lastName}`,
        fee: (feePaid > 0 ? feePaid : ours) / 100,
        balance,
        date: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
      }),
    )
    .catch((e) => console.warn(`[CARDS] card email to ${userId} failed: ${e?.message}`));
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
const MAX_TRIES = 5;

export async function fulfilPendingCard(userId: string): Promise<void> {
  const account = await prisma.cardAccount.findUnique({ where: { userId } });
  if (!account?.pendingCard || !account.pendingCardAt || account.blockedAt) return;
  const want = account.pendingCard as {
    kind: CardKindIn;
    name: string;
    feeTopupId?: string;
    feeCents?: number;
    /** Refused attempts so far; after MAX_TRIES it stops and waits for a person. */
    tries?: number;
    /** The account opened for this card when its funding started. Older requests have none: the first account. */
    accountId?: string;
    paymentDetailId?: string;
  };
  const money: CardMoney =
    want.accountId && want.paymentDetailId
      ? { accountId: want.accountId, paymentDetailId: want.paymentDetailId }
      : { accountId: account.nuvionAccountId, paymentDetailId: account.paymentDetailId };

  // Was the fee kept back from a top up? Only counts once that top up has landed.
  let feePaid = 0;
  if (want.feeTopupId) {
    const t = await prisma.cardTopup.findUnique({ where: { id: want.feeTopupId } });
    if (t?.status === "CREDITED") feePaid = t.cardFeeCents;
    else if (!t || t.status === "FAILED") {
      // That top up never landed, so no fee was taken; the next one can pay it.
      const { feeTopupId, feeCents, ...rest } = want;
      await prisma.cardAccount.update({ where: { userId }, data: { pendingCard: rest } });
      return;
    } else return; // still on its way
  }

  // Asked for, but the send never came: let it go after two hours.
  if (!feePaid && Date.now() - account.pendingCardAt.getTime() > 2 * 60 * 60 * 1000) {
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
    cardCostCents(userId, money.accountId).catch(() => null),
    nuvion.accountAvailableCents(money.accountId).catch(() => null),
  ]);
  if (!cost || balance === null) return;
  const needed = cost.issuer + (feePaid ? 0 : cost.ours);
  if (balance < needed) return; // not yet

  const took = await prisma.cardAccount.updateMany({
    where: { userId, pendingCardAt: account.pendingCardAt },
    data: { pendingCardAt: null },
  });
  if (took.count === 0) return;

  /**
   * Try again on the next sync, but not forever: a refusal that keeps coming
   * back (a holder detail the issuer won't take) would otherwise be retried
   * every two minutes for good. After MAX_TRIES it stops and waits for a person.
   */
  const putBack = async (why: string) => {
    const tries = (want.tries ?? 0) + 1;
    if (tries >= MAX_TRIES) return stuck(`gave up after ${tries} tries: ${why}`);
    await prisma.cardAccount.update({
      where: { userId },
      data: { pendingCard: { ...want, tries }, pendingCardAt: new Date(), pendingCardError: why },
    });
  };
  /**
   * Stops trying and leaves the request in place, marked for a person. It is
   * kept rather than cleared because its top up has already landed in the
   * account opened for it: cleared, that money would sit in an account no card
   * uses, where neither the person nor the console could see it.
   */
  const stuck = async (why: string) => {
    console.error(`[CARDS] pending card for ${userId} needs a person: ${why}`);
    await prisma.cardAccount.update({ where: { userId }, data: { pendingCardAt: null, pendingCardError: why.slice(0, 300) } });
  };

  /** The card can never be made: give back a fee that was kept back for it. */
  const giveBackFee = async () => {
    if (!feePaid) return;
    await refundCardFee(money.paymentDetailId, feePaid, `pending-${want.feeTopupId}`).catch((e) =>
      console.error(`[CARDS] kept-back card fee for ${userId} not returned: ${e?.message}`),
    );
  };

  try {
    const card = await issueCard(userId, want.kind, want.name, { feePaidCents: feePaid, money });
    await prisma.cardAccount.update({ where: { userId }, data: { pendingCard: null as any, pendingCardError: null } });
    // The top ups that paid for it belong to it from now on.
    await prisma.cardTopup.updateMany({ where: { userId, target: "new" }, data: { target: card.id } });
    await sendNotification({
      userId,
      type: "transaction",
      title: "Your card is ready",
      body: `${card.name} is ready to use.`,
    }).catch(() => undefined);
  } catch (err: any) {
    if (err instanceof IssueError) {
      if (err.code === "MAX_CARDS" || err.code === "NO_HOLDER") {
        // The fee goes back into the card's account, beside the rest of the top up, for a person to settle.
        await giveBackFee();
        if (feePaid) await prisma.cardAccount.update({ where: { userId }, data: { pendingCard: { ...want, feeTopupId: undefined, feeCents: undefined } as any } });
        await stuck(err.message);
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
