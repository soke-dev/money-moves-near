/**
 * The simulator: a bank rail with no money in it.
 *
 * It answers the way the real rail does - accounts resolve, a one-time account
 * opens, a transfer into it is found by polling, a payout is accepted and
 * confirms a few seconds later - so everything above it is exercised for real.
 * What "arrives" is whatever the test checkout says arrived.
 *
 * Account numbers that behave differently, for trying the edges:
 *  - ending 0000: no such account;
 *  - ending 9999: someone else's name, so it won't match the business.
 * Any other 10 digits resolve to the name the business should have.
 */
import { createHash } from "crypto";
import { prisma } from "../lib/prisma";
import type { Bank, NairaRails } from "./types";

/** How long a simulated payout takes to confirm. */
const PAYOUT_TAKES_MS = 3_000;

const BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank" },
  { code: "050", name: "Ecobank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "011", name: "First Bank" },
  { code: "214", name: "FCMB" },
  { code: "058", name: "GTBank" },
  { code: "030", name: "Heritage Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "50211", name: "Kuda" },
  { code: "50515", name: "Moniepoint" },
  { code: "090645", name: "Nombank MFB" },
  { code: "999992", name: "Opay" },
  { code: "999991", name: "Palmpay" },
  { code: "076", name: "Polaris Bank" },
  { code: "101", name: "Providus Bank" },
  { code: "221", name: "Stanbic IBTC" },
  { code: "232", name: "Sterling Bank" },
  { code: "033", name: "UBA" },
  { code: "032", name: "Union Bank" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
];

export const simulator: NairaRails = {
  name: "simulator",

  async banks() {
    return BANKS;
  },

  async resolve(bankCode, accountNumber, expect) {
    if (!BANKS.some((b) => b.code === bankCode)) return { ok: false, reason: "Choose your bank from the list." };
    if (!/^\d{10}$/.test(accountNumber)) return { ok: false, reason: "An account number is 10 digits." };
    if (accountNumber.endsWith("0000")) return { ok: false, reason: "We couldn't find that account. Check the number and the bank." };
    if (accountNumber.endsWith("9999")) return { ok: true, accountName: "CHIDI EMEKA OKAFOR" };
    return { ok: true, accountName: (expect?.trim() || "ADA OKONKWO").toUpperCase() };
  },

  async openAccount({ reference, merchantName }) {
    // Made up, but the same every time for one payment.
    const n = createHash("sha256").update(reference).digest().readUInt32BE(0) % 100_000_000;
    return { bank: "Test Bank", number: `99${String(n).padStart(8, "0")}`, name: `MMB / ${merchantName}`.slice(0, 60), providerRef: `sim_${reference}` };
  },

  async findArrival(reference) {
    const hit = await prisma.simInbound.findFirst({ where: { ref: reference }, orderBy: { createdAt: "asc" } });
    return hit ? { amountKobo: hit.amountKobo, payerName: hit.payerName, payerBank: hit.payerBank, payerAccount: hit.payerAccount, session: hit.session } : null;
  },

  async sendPayout(p) {
    // Like the real rail's reference check: a repeat is the same payout, not a second one.
    await prisma.simTransfer.upsert({
      where: { ref: p.reference },
      create: { ref: p.reference, amountKobo: p.amountKobo, bankCode: p.bankCode, accountNumber: p.accountNumber, fail: !!p.simulateFailure },
      update: {},
    });
    return { state: "pending" };
  },

  async checkPayout(reference) {
    const t = await prisma.simTransfer.findUnique({ where: { ref: reference } });
    if (!t) return { state: "unknown" };
    if (Date.now() - t.createdAt.getTime() < PAYOUT_TAKES_MS) return { state: "pending" };
    return t.fail ? { state: "failed", reason: "Simulated: the receiving bank declined the transfer." } : { state: "settled" };
  },
};

/**
 * A pretend transfer into a one-time account, for the test checkout's buttons.
 * The payer is made up; the session id looks like a real NIP one.
 */
export async function simulateArrival(reference: string, amountKobo: number) {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  await prisma.simInbound.create({
    data: { ref: reference, amountKobo, payerName: "TEST CUSTOMER", payerBank: "GTBank", payerAccount: `0${digits(2)}****${digits(4)}`, session: `100004${digits(24)}` },
  });
}
