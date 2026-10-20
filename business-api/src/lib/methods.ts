/**
 * Which ways to pay a business takes, on every checkout.
 *
 * Each is on by default once there's somewhere for its money to go, and the
 * business can switch any of them off:
 *  - a bank transfer needs a checked bank account (a "Just me" account
 *    settles to its business wallet, so for it, the wallet);
 *  - the Money Moves app needs a linked Money Moves account;
 *  - crypto needs the business wallet or a linked Money Moves account.
 * Without its place, a way to pay stays off and says what to link first. In
 * test mode nothing real settles, so only the switch counts.
 */
import type { Business, Mode, PayMethod } from "@prisma/client";
import { prisma } from "./prisma";

export const METHODS: PayMethod[] = ["NAIRA", "APP", "CRYPTO"];

export type MethodState = { on: boolean; off: boolean; ready: boolean; why: string | null };

export async function methodStates(b: Pick<Business, "id" | "kind" | "methodsOff">, mode: Mode): Promise<Record<PayMethod, MethodState>> {
  const off = new Set(b.methodsOff ?? []);
  if (mode === "TEST") {
    return Object.fromEntries(METHODS.map((m) => [m, { on: !off.has(m), off: off.has(m), ready: true, why: null }])) as Record<PayMethod, MethodState>;
  }
  const [banks, linked, wallet] = await Promise.all([
    prisma.bankAccount.count({ where: { businessId: b.id, removedAt: null, nameMatches: true } }),
    prisma.moneyMovesLink.count({ where: { businessId: b.id, status: "LINKED" } }),
    prisma.businessWallet.count({ where: { businessId: b.id } }),
  ]);
  const naira = b.kind === "INDIVIDUAL" ? (wallet ? null : "Create your business wallet first, in Business wallet") : banks ? null : "Add a bank account in Payout places first";
  const app = linked ? null : "Link your Money Moves account in Payout places first";
  const crypto = wallet || linked ? null : "Create your business wallet or link a Money Moves account first";
  const state = (m: PayMethod, why: string | null): MethodState => ({ on: !why && !off.has(m), off: off.has(m), ready: !why, why });
  return { NAIRA: state("NAIRA", naira), APP: state("APP", app), CRYPTO: state("CRYPTO", crypto) };
}

/** The ways to pay that are on for this business right now. */
export async function methodsOpen(b: Pick<Business, "id" | "kind" | "methodsOff">, mode: Mode): Promise<Set<PayMethod>> {
  const s = await methodStates(b, mode);
  return new Set(METHODS.filter((m) => s[m].on));
}
