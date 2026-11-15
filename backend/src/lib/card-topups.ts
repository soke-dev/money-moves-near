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
import * as nuvion from "./nuvion";
import { cardSettings } from "./card-settings";

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
    select: { id: true, asset: true, amount: true },
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
  for (const s of sends) {
    if (taken.has(s.id)) continue;
    const amount = Number(s.amount);
    await prisma.cardTopup
      .create({
        data: {
          userId,
          transactionId: s.id,
          asset: s.asset,
          amount,
          creditCents: creditCentsFor(amount, topupFeeBps),
        },
      })
      .catch(() => undefined); // claimed by a sync running alongside
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

    // Live, at Nuvion: the float has to hold the money now.
    const float = await nuvion.accountAvailableCents(env.NUVION_FLOAT_ACCOUNT_ID!);
    if (float < t.creditCents) {
      console.error(`[CARD-TOPUP] float too low: has ${float} cents, top up ${t.id} needs ${t.creditCents}`);
      return void (await wait("float too low"));
    }

    const transfer = await nuvion.bookTransfer({
      paymentDetailId: account.paymentDetailId,
      cents: t.creditCents,
      reference,
      narration: "Card top up",
    });
    if (transfer.status === "successful") {
      await prisma.cardTopup.update({ where: { id: t.id }, data: { status: "CREDITED", nuvionTransferId: transfer.id, reason: null } });
      await sendNotification({
        userId: t.userId,
        type: "transaction",
        title: "Card topped up",
        body: `$${(t.creditCents / 100).toFixed(2)} is on your card.`,
      }).catch(() => undefined);
    } else if (transfer.status === "failed") {
      await fail(`transfer failed: ${transfer.status_reason || "no reason"}`);
    } else {
      // Book transfers settle at once; anything else is checked on the next sync.
      await prisma.cardTopup.update({ where: { id: t.id }, data: { nuvionTransferId: transfer.id } });
    }
  } catch (err: any) {
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
  const users = new Set([...recent, ...open].map((r) => r.userId));
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
