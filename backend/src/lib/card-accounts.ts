/**
 * Where each card's money lives.
 *
 * Every card has its own USD account at Nuvion, so its balance is its own. A
 * person's first account (card_accounts) belongs to their first card; every
 * card after that gets a fresh account, opened when the card is funded. Cards
 * from before this (no account of their own) spend from that first account.
 */
import { randomBytes } from "crypto";
import type { Card } from "@prisma/client";
import { prisma } from "./prisma";
import * as nuvion from "./nuvion";

export interface CardMoney {
  accountId: string;
  /** Book-transfer destination: how the float pays this account. */
  paymentDetailId: string;
}

async function person(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { firstName: true, lastName: true, username: true } });
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  const handle = u.username ? `@${u.username}` : userId;
  return { full: name || handle, label: name ? `${name} · ${handle}` : `Card · ${handle}` };
}

/** Opens an account at Nuvion under `name`, finding one already made under it first (a create can lose its answer). */
async function openAccount(name: string, userId: string, holder: string): Promise<CardMoney & { ban: string }> {
  let account = await nuvion.findAccountByName(name);
  if (!account) {
    try {
      account = await nuvion.createUsdAccount(name, { user_id: userId, purpose: "card" });
    } catch (err) {
      // The name is taken by something else of theirs: make it unique and try once more.
      if (err instanceof nuvion.NuvionError && err.status === 409) {
        name = `${name} · ${randomBytes(2).toString("hex")}`;
        account = await nuvion.createUsdAccount(name, { user_id: userId, purpose: "card" });
      } else throw err;
    }
  }
  const ban = account.nuvion_ban || (await nuvion.getAccount(account.id)).nuvion_ban;
  if (!ban) throw new Error("Card account has no account number yet");
  const paymentDetailId = await nuvion.addBookDetail(ban, holder);
  return { accountId: account.id, paymentDetailId, ban };
}

/** The person's first account, opened on first use. */
export async function ensureUserAccount(userId: string) {
  const existing = await prisma.cardAccount.findUnique({ where: { userId } });
  if (existing) return existing;
  const who = await person(userId);
  // The old name too, for an account opened before names were used.
  const old = await nuvion.findAccountByName(`MM card ${userId}`);
  const opened = old
    ? { accountId: old.id, ban: old.nuvion_ban || (await nuvion.getAccount(old.id)).nuvion_ban!, paymentDetailId: await nuvion.addBookDetail(old.nuvion_ban || (await nuvion.getAccount(old.id)).nuvion_ban!, who.full) }
    : await openAccount(who.label, userId, who.full);
  return prisma.cardAccount.upsert({
    where: { userId },
    create: { userId, nuvionAccountId: opened.accountId, nuvionBan: opened.ban, paymentDetailId: opened.paymentDetailId },
    update: {},
  });
}

/** Where a card's money is: its own account, or the first account for an older card. */
export async function moneyOf(card: Pick<Card, "userId" | "nuvionAccountId" | "paymentDetailId">): Promise<CardMoney> {
  if (card.nuvionAccountId && card.paymentDetailId) return { accountId: card.nuvionAccountId, paymentDetailId: card.paymentDetailId };
  const first = await ensureUserAccount(card.userId);
  return { accountId: first.nuvionAccountId, paymentDetailId: first.paymentDetailId };
}

/** Is the first account free, i.e. no live card spends from it? */
async function firstAccountFree(userId: string, firstAccountId: string): Promise<boolean> {
  const using = await prisma.card.count({
    where: {
      userId,
      deletedAt: null,
      status: { in: ["active", "blocked"] },
      OR: [{ nuvionAccountId: null }, { nuvionAccountId: firstAccountId }],
    },
  });
  return using === 0;
}

/**
 * The account a new card will spend from: the first account if no card is
 * using it, otherwise a fresh one named after the person and the card.
 */
export async function accountForNewCard(userId: string, cardName: string): Promise<CardMoney> {
  const first = await ensureUserAccount(userId);
  if (await firstAccountFree(userId, first.nuvionAccountId)) {
    return { accountId: first.nuvionAccountId, paymentDetailId: first.paymentDetailId };
  }
  const who = await person(userId);
  const opened = await openAccount(`${who.label} · ${cardName}`, userId, who.full);
  return { accountId: opened.accountId, paymentDetailId: opened.paymentDetailId };
}

/** A card's balance in cents, read live. */
export async function cardBalanceCents(card: Pick<Card, "userId" | "nuvionAccountId" | "paymentDetailId">): Promise<number> {
  return nuvion.accountAvailableCents((await moneyOf(card)).accountId);
}
