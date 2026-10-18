/**
 * The naira rail, as the rest of the API sees it.
 *
 * Two of these exist: the simulator (test mode everywhere, and all of
 * staging) and Flutterwave (live, rails/flutterwave.ts). Code above this
 * line never knows which one it's talking to - a payment is opened, found and
 * settled the same way on both.
 */

export interface Bank {
  code: string;
  name: string;
}

/** A one-time account for one payment: the customer transfers the exact amount here. */
export interface OneTimeAccount {
  bank: string;
  number: string;
  name: string;
  providerRef: string;
}

/** A transfer that reached a one-time account, as the paying bank reports it. */
export interface Arrival {
  amountKobo: number;
  payerName: string | null;
  payerBank: string | null;
  payerAccount: string | null;
  session: string | null;
}

/**
 * Where a payout stands. "unknown" means the rail has no record of our
 * reference - not the same as failed, and never a reason to send it again.
 */
export type PayoutState = ({ state: "pending" } | { state: "settled" } | { state: "failed"; reason: string } | { state: "unknown" }) & {
  /** The rail's own id for the payout, when it gave one: kept, so the payout can be found again however long ago it went. */
  transferId?: string;
};

export type Resolved = { ok: true; accountName: string } | { ok: false; reason: string };

export interface NairaRails {
  readonly name: "simulator" | "flutterwave";
  banks(): Promise<Bank[]>;
  /** Whose account it is, by the bank's own records. `expect` is only used by the simulator, to answer with a name that matches. */
  resolve(bankCode: string, accountNumber: string, expect?: string | null): Promise<Resolved>;
  /** `businessId` is whose payment it is: the live rail issues the account under that business's identity, or ours. */
  openAccount(p: { reference: string; amountKobo: number; expiresAt: Date; merchantName: string; businessId: string; email?: string | null }): Promise<OneTimeAccount>;
  findArrival(reference: string): Promise<Arrival | null>;
  /**
   * Hands a payout to the rail. The reference is ours and the same on every
   * attempt, so a repeat can't pay twice. Throws when it can't tell whether
   * the rail took it - the caller then asks with `checkPayout`, never resends.
   */
  sendPayout(p: { reference: string; amountKobo: number; bankCode: string; accountNumber: string; accountName: string; narration: string; simulateFailure?: boolean }): Promise<PayoutState>;
  /** `transferId` is the rail's own id from when it was sent, when we have it: asked by that first. */
  checkPayout(reference: string, transferId?: string | null): Promise<PayoutState>;
}
