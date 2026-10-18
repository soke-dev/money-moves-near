/**
 * Funding service — "buy crypto with Naira" via a Flutterwave virtual account.
 *
 * The user no longer leaves the app to pay. initializeFunding() returns a
 * Nigerian account number to transfer into; verifyFunding() is then polled
 * while we wait for the money to land.
 */
import { api } from "./api";

export interface FundingInitResult {
  reference: string;
  /** Where the user sends their naira. Valid until `expiresAt`. */
  accountNumber: string;
  bankName: string;
  /** Who the account resolves to. Best-effort: not persisted on the intent. */
  accountName?: string;
  /**
   * What to transfer. Equals `purchaseNaira` unless Flutterwave is set to pass
   * its fee to the customer, in which case it is higher — and sending the lower
   * figure would be rejected as a short payment.
   */
  amountNaira: number;
  /** What is being bought, before any Flutterwave fee. */
  purchaseNaira?: number;
  expiresAt: string;
}

export interface FundingVerifyResult {
  /**
   * "success" | "pending" | "expired" | "held" — anything else is an error.
   *
   * "held" is money that arrived and was not released: the transfer came from
   * an account that could not be tied to the buyer. `message` says why, in
   * words written to be shown.
   */
  status: string;
  accountNumber?: string;
  bankName?: string;
  amountNaira?: number;
  expiresAt?: string | null;
  transaction?: {
    id: string;
    type: string;
    asset: string;
    chain: string;
    /**
     * A string, despite what it looks like.
     *
     * It is a Prisma Decimal on the server and Decimal.toJSON() emits a string,
     * so this arrives as "0.36316947". Typing it `number` was a lie the
     * compiler happily believed, right up until .toFixed() threw mid-render.
     * Coerce before doing arithmetic on it.
     */
    amount: string | number;
    status: string;
    reference: string;
    metadata: {
      amountNaira: number;
      txHash: string | null;
      walletAddress: string;
    };
    createdAt: string;
  };
  message?: string;
}

/**
 * Open a one-shot account for this purchase and return where to pay.
 */
export async function initializeFunding(params: {
  amountNaira: number;
  token: string;
  chain: string;
  walletAddress: string;
  convertedAmount: number;
}): Promise<FundingInitResult> {
  const { data } = await api.post("/funding/initialize", {
    amountNaira: params.amountNaira,
    metadata: {
      token: params.token,
      chain: params.chain,
      walletAddress: params.walletAddress,
      convertedAmount: params.convertedAmount,
    },
  });
  return data;
}

/**
 * Give the bank the number the document did not carry.
 *
 * A Nigerian passport does not print the NIN anywhere a scanner can read, so
 * somebody who verified with one is approved and still cannot be given a
 * payment account. Re-verifying never fixes it - the number is not on the
 * document - so this is the only way through for them.
 */
export async function declareNin(nin: string): Promise<void> {
  await api.post("/funding/nin", { nin: nin.replace(/\D/g, "") });
}

/**
 * Ask whether the transfer has landed yet.
 *
 * Polled while the user is paying. The webhook is what actually credits them,
 * so a "pending" here only means we have not seen the money yet - not that
 * anything is wrong. Sends the locally-derived wallet address so the backend
 * can cross-check it against the one on file.
 */
export async function verifyFunding(
  reference: string,
  localAddress?: string,
): Promise<FundingVerifyResult> {
  const params = localAddress ? `?clientAddress=${encodeURIComponent(localAddress)}` : "";
  const { data } = await api.get(`/funding/verify/${encodeURIComponent(reference)}${params}`);
  return data;
}

export interface FundingLimits {
  allowed: boolean;
  perTx: number;
  dailyLimit: number;
  spentToday: number;
  remaining: number;
}

export async function getFundingLimits(): Promise<FundingLimits> {
  const { data } = await api.get("/funding/limits");
  return data;
}
