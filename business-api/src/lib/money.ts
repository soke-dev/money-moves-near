/**
 * Money in whole minor units, the fee, the limits, and the references that
 * name a payment and a settlement.
 *
 * Every amount is an integer: kobo for naira, cents for dollars. Nothing here
 * rounds money as a float and keeps the result.
 */
import { randomBytes, randomInt } from "crypto";

/**
 * What a business pays on a naira payment: 0.5% of what arrived, never more
 * than ₦1,000. Settling is free. The admin will be able to set this per
 * business; this is the default.
 */
export const NAIRA_FEE = { rate: 0.005, capKobo: 1_000 * 100 } as const;

export const nairaFeeKobo = (receivedKobo: number) => Math.min(Math.round(receivedKobo * NAIRA_FEE.rate), NAIRA_FEE.capKobo);

/**
 * The fee for one business: its own rate (basis points) and cap when our team
 * has set them, else the platform's default (Services in the admin console).
 */
export function nairaFeeFor(
  receivedKobo: number,
  b: { feeRateBps: number | null; feeCapKobo: number | null },
  defaults: { rateBps: number; capKobo: number } = { rateBps: NAIRA_FEE.rate * 10_000, capKobo: NAIRA_FEE.capKobo },
) {
  const rate = (b.feeRateBps ?? defaults.rateBps) / 10_000;
  const cap = b.feeCapKobo ?? defaults.capKobo;
  return Math.min(Math.round(receivedKobo * rate), cap);
}

/**
 * The most a dollar price can be when there's no rate to check it against.
 * Naira limits - the least and most one checkout can be - are set in Services
 * (lib/platform), per kind of business.
 */
export const MAX_FIXED_CENTS = 10_000 * 100;

/** How long a one-time account stays open. */
export const PAY_WINDOW_MS = 30 * 60_000;
/** After it closes, a transfer that was already on its way still gets a few minutes to show up. */
export const LATE_GRACE_MS = 10 * 60_000;

/** Dollars to naira at a rate, rounded up to a whole naira - nobody transfers kobo. */
export const centsToKobo = (cents: number, ngnPerUsd: number) => Math.ceil((cents * ngnPerUsd) / 100) * 100;
/** Naira to its dollar equivalent, for showing. */
export const koboToCents = (kobo: number, ngnPerUsd: number) => Math.round(kobo / ngnPerUsd);

/** Major units (₦ or $) as typed, to minor units. */
export const toMinor = (major: number) => Math.round(major * 100);
export const toMajor = (minor: number) => minor / 100;

/** "₦15,000" or "$12.50", for messages. */
export const formatMinor = (minor: number, currency: "NGN" | "USD") =>
  `${currency === "NGN" ? "₦" : "$"}${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// No look-alike characters: a reference gets read out over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("");

/** A payment's reference, shown on receipts: "MMB-7K2Q9XHD". */
export const newPaymentRef = () => `MMB-${pick(8)}`;
/** A dispute's reference: "MMBD-7K2Q9XHD". */
export const newDisputeRef = () => `MMBD-${pick(8)}`;
/** A business's code for inviting others: "K2Q9XHD7". */
export const newReferralCode = () => pick(8);
/** A refund's reference: "MMBR-7K2Q9XHD" - also what its one-time account is opened under. */
export const newRefundRef = () => `MMBR-${pick(8)}`;
/** A settlement's reference with the bank rail: letters and digits only. */
export const newSettlementRef = () => `MMBS${pick(12)}`;
/** A send out of a business wallet: letters and digits only, as the bank rail takes it. */
export const newWalletSendRef = () => `MMBW${pick(12)}`;
/**
 * Our reference as the bank rail takes it: letters and digits only, at least 12 long - Flutterwave refuses a
 * shorter one ("size must be between 12 and 255"), and MMB-XXXXXXXX is 11 once the dash goes. Padded the same
 * way every time, so the account opened under it and the arrival looked up by it always match.
 */
export const railRef = (paymentRef: string) => paymentRef.replace(/[^A-Z0-9]/gi, "").padEnd(12, "0");

/** The checkout page's handle on a payment: random, so it can't be worked out from anything shown. */
export const newCheckoutToken = () => randomBytes(18).toString("base64url");
