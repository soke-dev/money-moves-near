/**
 * Refunds. We never hold a business's money, so a refund is two legs: the
 * business sends us what it received for that payment (our fee comes back to
 * it, so it never sends more than it got), then we send the customer what they
 * paid, the way they paid it. The second leg reaches the customer within 24 to
 * 48 hours; the screens show it moving on its own.
 *
 * Live, refunds come from the API; these samples are the preview's.
 */
import { NGN_RATE, PAYMENTS, nairaFee, type Method, type Payment } from '@/data/mock'
import { createStore } from './store'

/** How the business sends us the money for a refund. 'held' is money we never settled, like an underpayment. */
export type RefundFunding = 'wallet' | 'app' | 'bank' | 'held'

/** Where the money goes back to - always the way the customer paid. */
export type RefundTo =
  | { kind: 'app'; handle: string }
  | { kind: 'bank'; name: string; bank: string; account: string }
  | { kind: 'wallet'; address: string; asset: string; chain?: string }
  /** It came from an exchange, so we email the customer for a wallet address instead. */
  | { kind: 'ask'; email: string; exchange: string }

export interface Refund {
  paymentId: string
  /** The payment as it was - the API will join it instead. */
  payment: Payment
  ref: string
  customer: { name: string; email: string }
  method: Method
  /** The currency the customer paid in, and so gets back in. */
  currency: 'NGN' | 'USD'
  /** What the customer gets back. */
  amount: number
  /** Our fee on that amount, given back - the business sends the difference. */
  feeBack: number
  to: RefundTo
  fund: RefundFunding
  reason?: string
  requestedAt: string
  fundedAt?: string
  /** When it reached the customer. */
  doneAt?: string
  /** Live: the refund as the API keeps it - its own reference, and exactly what the business sends. */
  live?: { id: string; ref: string; fundNgn: number; fundUsd: number; dueBy: string | null }
}

const cents = (n: number) => Math.round(n * 100) / 100

export function refundTo(p: Payment): RefundTo {
  if (p.method === 'app') return { kind: 'app', handle: `@${p.customer.email.split('@')[0]}` }
  if (p.method === 'naira') return { kind: 'bank', name: p.payer?.name ?? p.customer.name, bank: p.payer?.bank ?? 'their bank', account: p.payer?.account ?? '' }
  if (p.exchange) return { kind: 'ask', email: p.customer.email, exchange: p.exchange }
  return { kind: 'wallet', address: p.from, asset: p.asset, chain: p.chain }
}

/** The most that can go back: what was paid, or for an underpayment, what arrived. */
export const refundable = (p: Payment) => (p.status === 'underpaid' ? (p.received ?? 0) : p.amount)

/** A refund of `amount` (in what the customer paid with) on this payment, before it's funded. */
export function refundOf(p: Payment, amount: number, fund: RefundFunding, reason?: string): Refund {
  const naira = p.method === 'naira'
  const held = p.status === 'underpaid'
  const share = amount / p.amount
  return {
    paymentId: p.id,
    payment: p,
    ref: p.ref,
    customer: p.customer,
    method: p.method,
    currency: naira ? 'NGN' : 'USD',
    // A crypto or app payment's amount is its coin amount, a dollar each.
    amount,
    // Nothing was charged on money that never settled.
    feeBack: held ? 0 : cents((naira ? nairaFee(p.amount) : p.fee) * share),
    to: refundTo(p),
    fund: held ? 'held' : fund,
    reason,
    requestedAt: new Date().toISOString(),
  }
}

/** What the business sends us, in the refund's currency. */
export const toSend = (r: Refund) => (r.fund === 'held' ? 0 : cents(r.amount - r.feeBack))

/** The same, in the currency the chosen funding method moves: naira for a bank transfer, dollars otherwise. */
export function fundingAmount(r: Refund, fund: RefundFunding): { value: number; currency: 'NGN' | 'USD' } {
  // Live, exactly what was asked for - worked out by the API at the payment's own rate.
  if (r.live) return fund === 'bank' ? { value: r.live.fundNgn, currency: 'NGN' } : { value: r.live.fundUsd, currency: 'USD' }
  const v = toSend(r)
  if (fund === 'bank') return { value: r.currency === 'NGN' ? v : Math.round(v * NGN_RATE), currency: 'NGN' }
  return { value: r.currency === 'USD' ? v : cents(v / NGN_RATE), currency: 'USD' }
}

export type RefundStage = 'funding' | 'sending' | 'refunded'

export function refundStage(r: Refund): RefundStage {
  if (r.doneAt) return 'refunded'
  if (!r.fundedAt) return 'funding'
  return 'sending'
}

/** When the customer should have it: 48 hours after we have the money. */
export const refundBy = (r: Refund) => r.live?.dueBy ?? new Date(new Date(r.fundedAt ?? r.requestedAt).getTime() + 48 * 3_600_000).toISOString()

/** Two samples: one that has reached the customer, one on its way. */
function seed(): Record<string, Refund> {
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()
  const done = PAYMENTS[10]!
  const going = PAYMENTS[7]!
  return {
    [done.id]: { ...refundOf(done, done.amount, 'wallet', 'Out of stock'), requestedAt: ago(40), fundedAt: ago(39.8), doneAt: ago(21) },
    [going.id]: { ...refundOf(going, going.amount, 'bank', 'Paid twice by mistake'), requestedAt: ago(6), fundedAt: ago(5.6) },
  }
}

/** The preview's samples. Live, refunds come from the API. */
export const refundsStore = createStore<Record<string, Refund>>('mmb_refunds_v1', seed)

export const useRefunds = (businessId: string | undefined) => refundsStore.use(businessId)
