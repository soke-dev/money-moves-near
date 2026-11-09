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

/** The order ways to pay appear in at checkout when the business hasn't chosen one. */
export const DEFAULT_ORDER: PayMethod[] = ["CRYPTO", "APP", "NAIRA"];

/** The business's full order: what it chose, then anything it left out, in the default order. */
export function methodOrder(order: PayMethod[] | null | undefined): PayMethod[] {
  const chosen = (order ?? []).filter((m, i, a) => METHODS.includes(m) && a.indexOf(m) === i);
  return [...chosen, ...DEFAULT_ORDER.filter((m) => !chosen.includes(m))];
}

export type LandRule = { to: "BANK" | "MONEY_MOVES" | "WALLET"; bankAccountId?: string | null };
const DESTS = ["BANK", "MONEY_MOVES", "WALLET"];

/** Where each way to pay lands for this business; a way to pay left out lands where its checkout says. */
export function landRules(raw: unknown): Partial<Record<PayMethod, LandRule>> {
  const out: Partial<Record<PayMethod, LandRule>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const m of METHODS) {
    const r = (raw as Record<string, unknown>)[m] as { to?: unknown; bankAccountId?: unknown } | undefined;
    if (r && typeof r.to === "string" && DESTS.includes(r.to)) out[m] = { to: r.to as LandRule["to"], bankAccountId: typeof r.bankAccountId === "string" ? r.bankAccountId : null };
  }
  return out;
}

/** These ways to pay, in the business's order. */
export function inOrder(methods: PayMethod[], order: PayMethod[] | null | undefined): PayMethod[] {
  const o = methodOrder(order);
  return [...methods].sort((a, b) => o.indexOf(a) - o.indexOf(b));
}

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
