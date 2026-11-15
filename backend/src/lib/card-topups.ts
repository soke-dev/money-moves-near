/**
 * Card top ups: a person's own USDC or USDT, sent on Solana to our Nuvion
 * deposit address, becomes dollars on their card.
 *
 * The send is an ordinary withdrawal from the app, so nothing new signs or
 * moves crypto. What this adds is the other half:
 *
 *   1. find the person's completed sends to the deposit address that no top
 *      up has claimed yet (one send, one top up: transaction_id is unique);
 *   2. read the send back off the chain, from their own wallet to ours, for
 *      at least what the row says. Our own row is never enough on its own;
 *   3. check the float's live balance at Nuvion covers it;
 *   4. book-transfer the dollars into their card account, under a reference
 *      that can only ever be used once.
 *
 * Anything not yet provable waits as PENDING and is tried again on the next
 * sync. Nothing here falls back to a stored balance.
 */
import { PublicKey } from "@solana/web3.js";
import { prisma } from "./prisma";
import { env } from "../config/env";
import { getSolanaConnection } from "./gas-sponsor";
import { walletUpgraded } from "./upgraded";
import { sendNotification } from "./push";
import { sendCardTopupEmail } from "./email";
import * as nuvion from "./nuvion";
import { cardSettings } from "./card-settings";
import { moneyOf } from "./card-accounts";
import { fulfilPendingCard } from "./card-issue";

const MINTS: Record<string, string> = {
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

/** A send we can't read on chain after this long is failed and handled by hand. */
const GIVE_UP_MS = 2 * 60 * 60 * 1000;

export function creditCentsFor(amount: number, feeBps: number): number {
  const cents = Math.floor(amount * 100 + 1e-6);
  return Math.floor((cents * (10_000 - feeBps)) / 10_000);
}

/**
 * Whether `txHash` moved at least `amount` of `asset` from `from` to the deposit
 * address. Read from the chain at confirmed commitment, by token balance change
 * on each side, so it holds whatever instructions the transaction used.
 */
async function sendProven(txHash: string, asset: string, amount: number, from: string): Promise<boolean | null> {
  const mint = MINTS[asset];
  const deposit = env.NUVION_DEPOSIT_SOL;
  if (!mint || !deposit) return false;
  let parsed: Awaited<ReturnType<ReturnType<typeof getSolanaConnection>["getParsedTransaction"]>> = null;
  for (const fallback of [false, true]) {
    try {
      parsed = await getSolanaConnection(fallback).getParsedTransaction(txHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (parsed) break;
    } catch (err: any) {
      console.warn(`[CARD-TOPUP] chain read failed for ${txHash}: ${err?.message}`);
    }
  }
  if (!parsed) return null; // not readable yet: try again later
  if (parsed.meta?.err) return false;

  const change = (owner: string) => {
    const sum = (list: any[] | null | undefined) =>
      (list || [])
        .filter((b) => b.mint === mint && b.owner === owner)
        .reduce((s, b) => s + Number(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0), 0);
    return sum(parsed!.meta?.postTokenBalances) - sum(parsed!.meta?.preTokenBalances);
  };
  const received = change(deposit);
  const sent = -change(from);
  const tolerance = 1e-6;
  return received + tolerance >= amount && sent + tolerance >= amount;
}

/** Opens a top up for each of this person's sends to the deposit address that none has claimed. */
async function claimNewSends(userId: string): Promise<void> {
  const deposit = env.NUVION_DEPOSIT_SOL;
  if (!deposit) return;
  const sends = await prisma.transaction.findMany({
    where: {
      userId,
      type: "WITHDRAW",
      chain: "SOL",
      status: "COMPLETED",
      asset: { in: ["USDC", "USDT"] },
      metadata: { path: ["address"], equals: deposit },
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: { id: true, asset: true, amount: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  if (!sends.length) return;
  const claimed = await prisma.cardTopup.findMany({
    where: { transactionId: { in: sends.map((s) => s.id) } },
    select: { transactionId: true },
  });
  const taken = new Set(claimed.map((c) => c.transactionId));
  // The fee in force when the send is first seen is the one it pays.
  const { topupFeeBps } = await cardSettings();
  const acct = await prisma.cardAccount.findUnique({
    where: { userId },
    select: { topupTarget: true, topupTargetAt: true, pendingCard: true },
  });
  for (const s of sends) {
    if (taken.has(s.id)) continue;
    const amount = Number(s.amount);
    // The card they were topping up when this send was made (set when they started, good for an hour).
    const at = acct?.topupTargetAt?.getTime() ?? 0;
    const sentAt = s.createdAt.getTime();
    const target = acct?.topupTarget && sentAt >= at - 60_000 && sentAt - at < 60 * 60 * 1000 ? acct.topupTarget : null;
    const made = await prisma.cardTopup
      .create({
        data: {
          userId,
          transactionId: s.id,
          asset: s.asset,
          amount,
          creditCents: creditCentsFor(amount, topupFeeBps),
          target,
        },
      })
      .then(() => true)
      .catch(() => false); // claimed by a sync running alongside
    if (!made) continue;
    // The send shows in the app as a card top up, not a withdrawal.
    const cardName =
      target === "new"
        ? (acct?.pendingCard as { name?: string } | null)?.name ?? null
        : target
          ? (await prisma.card.findUnique({ where: { id: target }, select: { name: true } }))?.name ?? null
          : null;
    await prisma.transaction
      .update({
        where: { id: s.id },
        data: { metadata: { ...((s.metadata as object) || {}), cardTopup: { cardName, newCard: target === "new" } } },
      })
      .catch(() => undefined);
  }
}

async function settle(topupId: string): Promise<void> {
  // Taken by exactly one sync.
  const took = await prisma.cardTopup.updateMany({
    where: { id: topupId, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (took.count === 0) return;
  const t = await prisma.cardTopup.findUniqueOrThrow({ where: { id: topupId } });
  const wait = (reason: string) =>
    prisma.cardTopup.update({ where: { id: t.id }, data: { status: "PENDING", reason } });
  const fail = async (reason: string) => {
    await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "FAILED", reason } });
    console.error(`[CARD-TOPUP] ${t.id} failed for user ${t.userId}: ${reason}`);
  };

  try {
    const reference = `mm-card-topup-${t.id}`;

    // Already paid by an earlier attempt that lost its answer.
    const earlier = await nuvion.findTransferByReference(reference).catch(() => null);
    if (earlier) {
      if (earlier.status === "successful") {
        await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", nuvionTransferId: earlier.id, reason: null } });
        return;
      }
      if (earlier.status === "failed") return void (await fail(`transfer failed: ${earlier.status_reason || "no reason"}`));
      await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "PROCESSING", nuvionTransferId: earlier.id } });
      return;
    }

    if (!(await walletUpgraded(t.userId))) return void (await wait("wallet not upgraded"));
    const account = await prisma.cardAccount.findUnique({ where: { userId: t.userId } });
    if (!account) return void (await wait("no card account yet"));
    // Blocked from the console: the send is real, so it waits for a person rather than failing.
    if (account.blockedAt) return void (await wait("person blocked from cards"));

    const tx = await prisma.transaction.findUnique({ where: { id: t.transactionId } });
    const meta = (tx?.metadata || {}) as any;
    const hash: string | undefined = meta.txHash;
    const from: string | undefined = meta.senderAddress;
    if (!tx || tx.userId !== t.userId || !hash || !from) return void (await fail("send has no hash or sender"));

    const proven = await sendProven(hash, t.asset, Number(t.amount), from);
    if (proven === false) return void (await fail("send not found on chain as recorded"));
    if (proven === null) {
      if (Date.now() - t.createdAt.getTime() > GIVE_UP_MS) return void (await fail("send unreadable on chain"));
      return void (await wait("waiting for the chain"));
    }

    if (t.creditCents < 1) return void (await fail("too small to credit"));

    /**
     * A new card waiting on this money: its creation fee is kept back here, so
     * it simply stays in the float. Taking it later as a second transfer out of
     * the card account would cost a Nuvion transfer fee on top, which a balance
     * of exactly the fee can't pay. Decided once and written down before any
     * money moves, so a retry keeps back the same amount.
     */
    let keep = t.cardFeeCents;
    const pending = account.pendingCard as { kind: string; name: string; feeTopupId?: string; accountId?: string; paymentDetailId?: string } | null;
    // Which account this money goes to: the card it was for, the card being made, or the first account.
    let paymentDetailId = account.paymentDetailId;
    let accountId = account.nuvionAccountId;
    // Which card the receipt names: the one topped up, or the one being made.
    let cardRef: { name: string; last4: string | null; oneTime?: boolean } | null = null;
    const forNewCard = t.target === "new" || (!t.target && !!pending);
    if (forNewCard && pending?.paymentDetailId) {
      paymentDetailId = pending.paymentDetailId;
      accountId = pending.accountId || accountId;
      cardRef = { name: pending.name, last4: null, oneTime: pending.kind === "one-time" };
    } else if (t.target && t.target !== "new") {
      const card = await prisma.card.findUnique({ where: { id: t.target } });
      if (card && !card.deletedAt) {
        const m = await moneyOf(card);
        paymentDetailId = m.paymentDetailId;
        accountId = m.accountId;
        cardRef = { name: card.name, last4: card.last4, oneTime: card.kind === "DISPOSABLE" };
      }
    }
    if (!keep && forNewCard && pending && !pending.feeTopupId) {
      const ours = Math.round((await cardSettings()).cardFee * 100);
      if (ours > 0 && t.creditCents >= ours) {
        keep = ours;
        await prisma.cardTopup.update({ where: { id: t.id }, data: { cardFeeCents: ours } });
        await prisma.cardAccount.update({
          where: { userId: t.userId },
          data: { pendingCard: { ...pending, feeTopupId: t.id, feeCents: ours } },
        });
      }
    }
    const pay = t.creditCents - keep;

    // All of it was the card fee: nothing to move.
    if (pay <= 0) {
      await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", reason: null } });
      return;
    }

    // Live, at Nuvion: the float has to hold the money now.
    const float = await nuvion.accountAvailableCents(env.NUVION_FLOAT_ACCOUNT_ID!);
    if (float < pay) {
      console.error(`[CARD-TOPUP] float too low: has ${float} cents, top up ${t.id} needs ${pay}`);
      return void (await wait("float too low"));
    }

    const transfer = await nuvion.bookTransfer({
      paymentDetailId,
      cents: pay,
      reference,
      narration: "Card top up",
    });
    if (transfer.status === "successful") {
      await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", nuvionTransferId: transfer.id, reason: null } });
      // A top up for a new card is followed by "Your card is ready", so it doesn't get its own push.
      if (!keep) {
        await sendNotification({
          userId: t.userId,
          type: "transaction",
          title: "Card topped up",
          body: `$${(pay / 100).toFixed(2)} is on your card.`,
        }).catch(() => undefined);
      }
      // The receipt goes either way: it says where every cent of the send went.
      const who = await prisma.user.findUnique({ where: { id: t.userId }, select: { email: true } });
      if (who?.email) {
        const sent = Number(t.amount);
        // A new card's balance is told in "Your card is ready", once it exists.
        const balance = forNewCard ? null : await nuvion.accountAvailableCents(accountId).then((c) => c / 100).catch(() => null);
        sendCardTopupEmail(who.email, {
          card: cardRef,
          balance,
          sent,
          asset: t.asset,
          topupFee: Math.max(0, Math.round(sent * 100) - t.creditCents) / 100,
          cardFee: keep / 100,
          added: pay / 100,
          reference: t.id.slice(-10),
          date: new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
        }).catch((e) => console.warn(`[CARD-TOPUP] email for ${t.id} failed: ${e?.message}`));
      }
    } else if (transfer.status === "failed") {
      await fail(`transfer failed: ${transfer.status_reason || "no reason"}`);
    } else {
      // Book transfers settle at once; anything else is checked on the next sync.
      await prisma.cardTopup.update({ where: { id: t.id }, data: { nuvionTransferId: transfer.id } });
    }
  } catch (err: any) {
    /**
     * Nuvion refuses a reference it has already seen (409). The look-up at the
     * top should have found that transfer; if it still can't, retrying would
     * only be refused again every two minutes, so it waits for a person.
     */
    if (err instanceof nuvion.NuvionError && err.status === 409) {
      const found = await nuvion.findTransferByReference(`mm-card-topup-${t.id}`).catch(() => null);
      if (found?.status === "successful") {
        await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", nuvionTransferId: found.id, reason: null } });
      } else {
        await fail("reference already used at Nuvion but the transfer can't be found: check by hand before retrying");
      }
      return;
    }
    // Unknown whether a transfer went: the reference check above settles it next time.
    await wait(`error: ${String(err?.message || err).slice(0, 200)}`);
  }
}

/** Follows up a top up whose transfer was sent but not yet settled. */
async function followUp(topupId: string): Promise<void> {
  const t = await prisma.cardTopup.findUnique({ where: { id: topupId } });
  if (!t?.nuvionTransferId || t.status !== "PROCESSING") return;
  const tr = await nuvion.getTransfer(t.nuvionTransferId).catch(() => null);
  if (!tr) return;
  if (tr.status === "successful") {
    await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", reason: null } });
  } else if (tr.status === "failed") {
    await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "FAILED", reason: `transfer failed: ${tr.status_reason || ""}` } });
  }
}

/** Claims and settles everything this person has waiting. Safe to run as often as wanted. */
export async function syncTopups(userId: string): Promise<void> {
  if (!nuvion.cardsConfigured()) return;
  await claimNewSends(userId);
  const open = await prisma.cardTopup.findMany({
    where: { userId, status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const t of open) {
    if (t.status === "PENDING") await settle(t.id);
    else if (t.nuvionTransferId) await followUp(t.id);
    else if (Date.now() - t.updatedAt.getTime() > 10 * 60 * 1000) {
      // A sync that died between taking it and sending: put it back.
      await prisma.cardTopup.updateMany({ where: { id: t.id, status: "PROCESSING", nuvionTransferId: null }, data: { status: "PENDING" } });
    }
  }
  // A card asked for with a top up is made as soon as the money is there.
  await fulfilPendingCard(userId).catch((err) => console.warn(`[CARDS] pending card for ${userId}: ${err?.message}`));
}

/** Every person with a top up waiting, for the background sweep. */
export async function syncAllTopups(): Promise<void> {
  if (!nuvion.cardsConfigured()) return;
  const deposit = env.NUVION_DEPOSIT_SOL!;
  // People with a recent send to the deposit address, or a top up still open.
  const recent = await prisma.transaction.findMany({
    where: {
      type: "WITHDRAW",
      chain: "SOL",
      status: "COMPLETED",
      metadata: { path: ["address"], equals: deposit },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { userId: true },
    distinct: ["userId"],
    take: 200,
  });
  const open = await prisma.cardTopup.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    select: { userId: true },
    distinct: ["userId"],
    take: 200,
  });
  // And anyone with a card asked for and not yet made.
  const waitingCards = await prisma.cardAccount.findMany({
    where: { pendingCardAt: { not: null } },
    select: { userId: true },
    take: 200,
  });
  const users = new Set([...recent, ...open, ...waitingCards].map((r) => r.userId));
  for (const u of users) {
    await syncTopups(u).catch((err) => console.warn(`[CARD-TOPUP] sync for ${u} failed: ${err?.message}`));
  }
}

export function isDepositAddress(address: string): boolean {
  try {
    return !!env.NUVION_DEPOSIT_SOL && new PublicKey(address).toBase58() === env.NUVION_DEPOSIT_SOL;
  } catch {
    return false;
  }
}
