/**
 * What every way of being paid shares - a payment link, an invoice, an
 * outlet's counter QR: its public address, its price inside the business's
 * checkout limits, and where its money settles.
 */
import { randomBytes } from "crypto";
import { appPayReady } from "./app-pay";
import type { Destination, Mode } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./http";
import { MAX_FIXED_CENTS, centsToKobo, formatMinor, koboToCents, toMinor } from "./money";
import { ngnPerUsd } from "./rates";
import { forMode, platform } from "./platform";

export const modeOf = (q: unknown): Mode => (String(q).toLowerCase() === "live" ? "LIVE" : "TEST");

/** A public address: lower-case letters, numbers and dashes, 3 to 48 of them. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
/** Addresses that mean something else on the checkout host. */
export const RESERVED = new Set(["p", "o", "i", "api", "admin", "pay", "new", "edit", "settings", "login", "signup", "help", "support", "checkout", "test", "live", "www", "app", "docs", "invoice", "store"]);

/** An address from a name: "Ikeja store - till 2" → "ikeja-store-till-2". Too short or reserved: a random one. */
export function slugFrom(name: string, prefix = "pay") {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s.length >= 3 && !RESERVED.has(s) ? s : `${prefix}-${randomBytes(3).toString("hex")}`;
}

export type Limits = { minKobo: number; maxKobo: number };

/**
 * A price in minor units, inside the checkout limits for this kind of
 * business. A dollar price is checked at today's rate when there is one; the
 * checkout checks it again at the rate of the moment.
 */
export async function minorFor(amount: number, currency: "NGN" | "USD", what: string, l: Limits) {
  const minor = toMinor(amount);
  const range = `${formatMinor(l.minKobo, "NGN")} and ${formatMinor(l.maxKobo, "NGN")}`;
  if (currency === "NGN") {
    if (minor < l.minKobo || minor > l.maxKobo) throw new HttpError(400, `${what} has to be between ${range}.`, "bad_amount");
    return minor;
  }
  if (minor < 100) throw new HttpError(400, `${what} has to be at least $1.`, "bad_amount");
  const rate = await ngnPerUsd().catch(() => null);
  if (rate) {
    const kobo = centsToKobo(minor, rate);
    if (kobo < l.minKobo || kobo > l.maxKobo) {
      throw new HttpError(400, `${what} has to come to between ${range}, about ${formatMinor(koboToCents(l.minKobo, rate), "USD")} to ${formatMinor(koboToCents(l.maxKobo, rate), "USD")} today.`, "bad_amount");
    }
  } else if (minor > MAX_FIXED_CENTS) throw new HttpError(400, `${what} has to be $10,000 or less.`, "bad_amount");
  return minor;
}

/**
 * Checks how something takes payments and where they settle, for one business
 * in one mode. Returns the columns to save.
 */
export async function placesFor(businessId: string, mode: Mode, v: { methods: string[]; destination: Destination; bankAccountId?: string | null }) {
  const owner = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { methodsKeptOn: true } });
  const p = forMode(await platform(), mode, owner);
  // Live app payments need the app's side switched on. Test mode simulates all three.
  if (mode === "LIVE" && v.methods.includes("APP") && !appPayReady()) {
    throw new HttpError(400, "Paying with the Money Moves app isn't switched on for live payments yet. All three work in test mode.", "method_unavailable");
  }
  if (v.methods.includes("NAIRA") && !p.methods.naira) throw new HttpError(400, "Bank transfers are paused by Money Moves right now, so this can't take them.", "method_paused");
  if (v.methods.includes("APP") && !p.methods.app) throw new HttpError(400, "Money Moves app payments are paused by Money Moves right now, so this can't take them.", "method_paused");
  if (v.methods.includes("CRYPTO") && !p.methods.crypto) throw new HttpError(400, "Crypto payments are paused by Money Moves right now, so this can't take them.", "method_paused");
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  // A "Just me" account settles everything to its business wallet.
  const destination: Destination = business.kind === "INDIVIDUAL" ? "WALLET" : v.destination;
  const placeOn = destination === "BANK" ? p.destinations.bank : destination === "MONEY_MOVES" ? p.destinations.moneyMoves : p.destinations.wallet;
  if (!placeOn) throw new HttpError(400, "Settling there is paused by Money Moves right now. Pick another place.", "destination_paused");
  let bankAccountId: string | null = null;
  if (destination === "BANK" && v.bankAccountId) {
    const bank = await prisma.bankAccount.findFirst({ where: { id: v.bankAccountId, businessId, removedAt: null } });
    if (!bank) throw new HttpError(400, "That bank account isn't in Payout places any more.", "bad_bank");
    if (mode === "LIVE" && !bank.nameMatches) throw new HttpError(400, "That bank account is still being checked. Pick another, or wait for it.", "bank_unchecked");
    bankAccountId = bank.id;
  }
  // Live, a Money Moves account only once its owner has approved the link in the app.
  if (mode === "LIVE" && destination === "MONEY_MOVES" && !(await prisma.moneyMovesLink.count({ where: { businessId, status: "LINKED" } }))) {
    throw new HttpError(400, "Link a Money Moves account in Payout places first. Its owner approves it in the app.", "no_money_moves");
  }
  // Live, the business wallet only once the owner has created it (after verification).
  if (mode === "LIVE" && destination === "WALLET" && !(await prisma.businessWallet.count({ where: { businessId } }))) {
    throw new HttpError(409, "Create your business wallet first. The owner sets it up on the Wallet page once the business is verified.", "wallet_not_created");
  }
  if (mode === "LIVE" && destination === "BANK" && !bankAccountId) {
    const any = await prisma.bankAccount.count({ where: { businessId, removedAt: null, nameMatches: true } });
    if (!any) throw new HttpError(400, "Add a bank account in Payout places first. It has to be checked before money can go there.", "no_bank");
  }
  return { destination, bankAccountId, business };
}
