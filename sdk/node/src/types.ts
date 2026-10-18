/** The objects the Money Moves API returns, exactly as it returns them. */

export type Mode = 'test' | 'live'
export type Currency = 'NGN' | 'USD'
export type Method = 'bank_transfer' | 'app' | 'crypto'
export type Coin = 'USDC' | 'USDT'
export type Network = 'Movement' | 'Monad' | 'Arc' | 'Solana' | 'Stellar' | 'Base' | 'BNB Chain' | 'TON' | 'Arbitrum' | 'Optimism' | 'Ethereum'
export type Metadata = Record<string, string | number | boolean>

export interface List<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next_cursor: string | null
}

export interface Account {
  object: 'account'
  merchant_id: string
  name: string
  mode: Mode
  verified: boolean
  key: { name: string; prefix: string }
}

export interface Payment {
  id: string
  object: 'payment'
  mode: Mode
  status: 'open' | 'successful' | 'underpaid' | 'expired'
  reference: string
  checkout: string | null
  invoice: string | null
  outlet: string | null
  checkout_reference: string | null
  metadata: Metadata | null
  currency: Currency
  amount_ngn: number
  amount_usd: number
  customer_fee_ngn: number | null
  fee_ngn: number | null
  received_ngn: number | null
  rate_ngn_per_usd: number
  method: Method
  crypto: { coin: Coin | null; network: string | null; address: string | null; memo: string | null; transaction: string | null } | null
  customer: { email: string | null; name: string | null; phone: string | null }
  payer: { name: string | null; bank: string | null; account: string | null } | null
  receipt_url: string | null
  created_at: string
  paid_at: string | null
  expires_at: string
}

export interface Checkout {
  id: string
  object: 'checkout'
  mode: Mode
  status: 'open' | 'paid' | 'expired' | 'cancelled'
  url: string
  amount: number | null
  currency: Currency
  description: string | null
  reference: string | null
  metadata: Metadata | null
  methods: Method[]
  customer: { email: string | null; name: string | null }
  fee_payer: 'business' | 'customer' | null
  redirect_url: string | null
  payment: Payment | null
  expires_at: string | null
  created_at: string
}

export interface Settlement {
  id: string
  object: 'settlement'
  mode: Mode
  status: 'pending' | 'completed'
  reference: string
  payment: string
  payment_reference: string | null
  destination: 'bank' | 'money_moves' | 'wallet'
  amount_ngn: number
  fee_ngn: number
  bank: { name: string | null; account_number: string | null; account_name: string | null } | null
  crypto: { network: string; address: string | null; amount_usdc: number | null; transaction: string | null } | null
  created_at: string
  completed_at: string | null
}

export interface Refund {
  id: string
  object: 'refund'
  mode: Mode
  status: 'awaiting_funds' | 'processing' | 'completed' | 'cancelled'
  reference: string
  payment: string
  amount_ngn: number
  amount_usd: number
  funding: {
    method: string
    amount_ngn: number
    fee_returned_ngn: number
    bank: { name: string | null; account_number: string; account_name: string | null; expires_at: string | null } | null
    funded_at: string | null
  }
  to: { kind: string; name: string | null; bank: string | null; account: string | null; coin: string | null; network: string | null }
  reason: string | null
  created_at: string
  completed_at: string | null
}

export interface DisputeMessage {
  from: 'customer' | 'business' | 'bank' | 'money_moves'
  body: string
  /** Files you attached from the dashboard. */
  files: { id: string; name: string }[]
  created_at: string
}

/** A customer, or the sender's bank, questioning a payment. */
export interface Dispute {
  id: string
  object: 'dispute'
  mode: Mode
  kind: 'customer' | 'bank_claim'
  status: 'needs_reply' | 'under_review' | 'won' | 'refunded' | 'lost'
  /** "MMBD-7K2Q9XHD" */
  reference: string
  payment: string
  reason: 'not_received' | 'duplicate' | 'not_as_described' | 'unrecognised' | 'unauthorised'
  amount_ngn: number
  /** Your deadline to reply while it's needs_reply. */
  reply_by: string | null
  /** After you reply to a customer: when they have to answer by, or it closes in your favour. */
  customer_answers_by: string | null
  outcome: string | null
  /** The refund that settled it, or funded a bank claim that was lost. */
  refund: string | null
  created_at: string
  closed_at: string | null
  /** On a single dispute, not in lists. */
  messages?: DisputeMessage[]
}

export interface Balance {
  object: 'balance'
  mode: Mode
  settling: { amount_ngn: number; count: number }
  wallet: { holdings: { coin: string; network: string; amount: number }[]; total_usd: number | null; total_ngn: number | null } | null
  rate_ngn_per_usd: number | null
  as_of: string
}

export interface Rate {
  object: 'rate'
  base: 'USD'
  quote: 'NGN'
  ngn_per_usd: number
  as_of: string
}

export type EventType =
  | 'payment.successful'
  | 'payment.underpaid'
  | 'payment.expired'
  | 'invoice.paid'
  | 'settlement.completed'
  | 'refund.created'
  | 'refund.completed'
  | 'dispute.created'
  | 'dispute.updated'
  | 'dispute.closed'
  | 'payout.completed'
  | 'payout.failed'
  | 'webhook.test'

export interface Event<T = unknown> {
  id: string
  object: 'event'
  type: EventType
  mode: Mode
  created_at: string
  data: { object: T }
}

/* ─── Request parameters ───────────────────────────────────────────── */

export interface Paging {
  limit?: number
  starting_after?: string
  created_after?: string | Date
  created_before?: string | Date
}

export interface CheckoutCreateParams {
  amount: number
  currency: Currency
  description?: string
  reference?: string
  methods?: Method[]
  accept?: Partial<Record<Coin, Network[]>>
  customer?: { email?: string; name?: string }
  metadata?: Metadata
  expires_in?: number
  expires_at?: string
  fee_payer?: 'business' | 'customer'
  settle_to?: 'bank' | 'money_moves' | 'wallet'
  redirect_url?: string
}

export interface CheckoutListParams extends Paging {
  reference?: string
}

export interface PaymentListParams extends Paging {
  status?: Payment['status']
  method?: Method
  checkout?: string
}

export interface SettlementListParams extends Paging {
  status?: Settlement['status']
  payment?: string
}

export interface RefundCreateParams {
  payment: string
  amount?: number
  reason?: string
}

export interface RefundListParams extends Paging {
  status?: Refund['status']
  payment?: string
}

export interface DisputeListParams extends Paging {
  status?: Dispute['status']
  kind?: Dispute['kind']
  payment?: string
}

export interface DisputeReplyParams {
  message: string
}

export interface DisputeCreateParams {
  payment: string
  reason?: 'not_received' | 'duplicate' | 'not_as_described'
  message: string
}

export interface EventListParams extends Paging {
  type?: EventType
}

export interface RequestOptions {
  /** Makes a write safe to retry: the same key and body get the first answer back. */
  idempotencyKey?: string
}
