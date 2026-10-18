import { api } from "./api";

/**
 * These endpoints do chain work - prepare reads live nonce, fee and gas
 * estimates over RPC, submit funds gas and broadcasts - and public RPCs vary
 * enormously. BSC alone answers in about a second per call against Base's
 * fraction of one, which was enough to blow the 30s default and surface as a
 * bare "timeout of 30000ms exceeded" on the summary screen.
 */
const CHAIN_TIMEOUT_MS = 90_000;

// ─── Types ──────────────────────────────────────────────────
export interface Transaction {
  id: string;
  type: string;
  asset: string;
  chain: string | null;
  amount: number | string;
  fee: number | string | null;
  status: string;
  reference: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt?: string;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// ─── Endpoints ──────────────────────────────────────────────
export async function getTransactions(params?: {
  page?: number;
  limit?: number;
  type?: string;
  asset?: string;
  status?: string;
}): Promise<TransactionListResponse> {
  const res = await api.get("/transactions", { params });
  return res.data;
}

export async function getTransaction(id: string): Promise<{ transaction: Transaction }> {
  const res = await api.get(`/transactions/${id}`);
  return res.data;
}

export async function getDailyUsage(): Promise<{ usage: Record<string, number> }> {
  const res = await api.get("/transactions/usage/today");
  return res.data;
}

export async function createWithdrawal(data: {
  asset: string;
  chain: string;
  amount: number;
  address: string;
}): Promise<{ transaction: Transaction }> {
  const res = await api.post("/transactions/withdraw", data);
  return res.data;
}

// ─── Gasless user-signed withdrawal (2-phase) ───────────────
export async function prepareWithdrawal(data: {
  asset: string;
  chain: string;
  amount: number;
  address: string;
  senderAddress?: string;
  /** Stellar only: the memo an exchange asks for. */
  memo?: string;
  /** Paying a business's checkout: the server holds the send to what it asked for. */
  payRequestId?: string;
}): Promise<{ withdrawalId: string; signingMessage: string; chain: string }> {
  const res = await api.post("/transactions/withdraw/prepare", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

export async function submitWithdrawal(data: {
  withdrawalId: string;
  signature: string;
  publicKey: string;
  /**
   * Set instead of signature/publicKey when an MPC wallet signed the whole
   * transaction: it cannot sign a bare hash, so it returns the raw signed
   * bytes and the backend validates them against what it prepared.
   */
  signedRaw?: string;
}): Promise<{ transaction: Transaction }> {
  const res = await api.post("/transactions/withdraw/submit", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

// ─── Username transfer (on-chain, 2-phase) ─────────────────
export async function prepareUsernameTransfer(data: {
  recipientUsername: string;
  asset: string;
  chain: string;
  amount: number;
  /** The sender's memo. Stored on both sides' transactions for the receipt. */
  narration?: string;
  senderAddress?: string;
}): Promise<{
  transferId: string;
  signingMessage: string;
  chain: string;
  // EVM chains only, and only MPC wallets use it: they sign the whole
  // transaction rather than a hash.
  txRequest?: Record<string, string | number>;
}> {
  const res = await api.post("/transactions/transfer/username/prepare", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

export async function submitUsernameTransfer(data: {
  transferId: string;
  signature: string;
  publicKey: string;
  /**
   * Set instead of signature/publicKey when an MPC wallet signed the whole
   * transaction: it cannot sign a bare hash, so it returns the raw signed
   * bytes and the backend validates them against what it prepared.
   */
  signedRaw?: string;
}): Promise<{ status: string; transaction: Transaction }> {
  const res = await api.post("/transactions/transfer/username/submit", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

export async function createBankTransfer(data: {
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  narration?: string;
  saveBeneficiary?: boolean;
}): Promise<{ transaction: Transaction }> {
  const res = await api.post("/transactions/bank-transfer", data);
  return res.data;
}

// ─── Sell / Offramp (crypto → NGN bank transfer, 2-phase) ──

// A signed quote minted by the backend. Pass it back to /sell/prepare so the
// bank payout matches what the user saw on the summary screen.
export type SellQuote = {
  v: number;
  userId: string;
  asset: string;
  chain: string;
  amount: number;
  ngnRate: number;
  ngnGross: number;
  ngnFee: number;
  ngnNet: number;
  expiresAt: number;
};

export async function getSellQuote(data: {
  asset: string;
  chain: string;
  desiredNetNgn: number;
}): Promise<{ quote: SellQuote; signature: string }> {
  const res = await api.post("/transactions/sell/quote", data);
  return res.data;
}

export async function prepareSell(data: {
  // Preferred: signed quote
  quote?: SellQuote;
  signature?: string;
  // Legacy: client-computed amount + rate hint (kept for older clients)
  asset?: string;
  chain?: string;
  amount?: number;
  quotedRate?: number;
  // Common
  bankName: string;
  accountNumber: string;
  accountName: string;
  bankCode?: string;
  saveBeneficiary?: boolean;
  /** The sender's own note, stored on the transaction for the receipt. */
  narration?: string;
  senderAddress?: string;
}): Promise<{
  sellId: string;
  signingMessage: string;
  chain: string;
  ngnRate: number;
  ngnGross: number;
  ngnFee: number;
  ngnNet: number;
  sellTreasury: string;
}> {
  const res = await api.post("/transactions/sell/prepare", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

export async function submitSell(data: {
  sellId: string;
  signature: string;
  publicKey: string;
  /**
   * Set instead of signature/publicKey when an MPC wallet signed the whole
   * transaction: it cannot sign a bare hash, so it returns the raw signed
   * bytes and the backend validates them against what it prepared.
   */
  signedRaw?: string;
}): Promise<{
  status: string;
  transaction: Transaction;
  message: string;
}> {
  const res = await api.post("/transactions/sell/submit", data, { timeout: CHAIN_TIMEOUT_MS });
  return res.data;
}

export async function checkSellStatus(id: string): Promise<{ status: string; payoutStatus?: string }> {
  const res = await api.get(`/transactions/sell/status/${id}`);
  return res.data;
}

export async function getSellLimits(): Promise<{
  verified: boolean;
  perTx: number;
  dailyLimit: number;
  spentToday: number;
  remaining: number;
}> {
  const res = await api.get("/transactions/sell/limits");
  return res.data;
}


/**
 * Tell the server a prepared sell never got signed.
 *
 * Best effort and deliberately quiet: this runs inside a catch block that is
 * already showing the person an error, and a failure to report a failure is
 * not worth a second message. Without it the row sits PENDING until a sweeper
 * closes it ten minutes later with no reason recorded.
 */
/** The same report, for a withdrawal that was prepared and never signed. */
export async function abandonWithdraw(
  withdrawalId: string,
  reason: string,
  stage = "sign",
): Promise<void> {
  try {
    await api.post("/transactions/withdraw/abandon", {
      withdrawalId,
      reason: String(reason).slice(0, 300),
      stage,
    });
  } catch {
    // Nothing to do. The sweeper still closes it.
  }
}

/** The same report, for a username send that was prepared and never signed. */
export async function abandonUsernameTransfer(
  transferId: string,
  reason: string,
  stage = "sign",
): Promise<void> {
  try {
    await api.post("/transactions/transfer/username/abandon", {
      transferId,
      reason: String(reason).slice(0, 300),
      stage,
    });
  } catch {
    // Nothing to do. The sweeper still closes it.
  }
}

export async function abandonSell(sellId: string, reason: string, stage = "sign"): Promise<void> {
  try {
    await api.post("/transactions/sell/abandon", { sellId, reason: String(reason).slice(0, 300), stage });
  } catch {
    // Nothing to do. The sweeper still closes it.
  }
}
