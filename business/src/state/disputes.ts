/**
 * Disputes: someone questioning a payment. Two kinds, and they're not alike.
 *
 * A customer dispute is raised from the receipt - didn't get it, charged
 * twice, not as described. App and stablecoin payments can't be pulled back,
 * so it's a conversation: the business replies or refunds, and we close it.
 *
 * A bank claim only happens on a naira transfer: the sender's bank says the
 * transfer wasn't authorised and asks for it back. The business sends proof of
 * the sale; the bank decides. If the bank keeps its claim, the money goes back
 * to the sender, and the business funds it the way it funds a refund.
 *
 * Live, they come from the API; the preview keeps samples in this browser.
 */
import { useMemo } from 'react'
import { PAYMENTS, type Payment } from '@/data/mock'
import { createStore } from './store'
import { LIVE, type ApiPayment } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from './session'
import { toPayment } from './live'

export type DisputeKind = 'customer' | 'bank'
export type DisputeReason = 'not_received' | 'duplicate' | 'not_as_described' | 'unrecognised' | 'unauthorised'
export type DisputeStatus = 'needs_reply' | 'under_review' | 'won' | 'refunded' | 'lost'

export const REASONS: Record<DisputeReason, string> = {
  not_received: "Didn't receive it",
  duplicate: 'Charged twice',
  not_as_described: 'Not as described',
  unrecognised: "Doesn't recognise the payment",
  unauthorised: 'Transfer not authorised',
}

export const DISPUTE_STATUS: Record<DisputeStatus, string> = {
  needs_reply: 'Needs reply',
  under_review: 'Under review',
  won: 'Won',
  refunded: 'Refunded',
  lost: 'Lost',
}

/** How long the business has to reply. Banks give less room than customers do. */
export const REPLY_DAYS: Record<DisputeKind, number> = { customer: 3, bank: 5 }

export interface DisputeMessage {
  from: 'customer' | 'you' | 'bank' | 'us'
  body: string
  at: string
  /** Live files have an id, to open them. */
  files?: { name: string; id?: string }[]
}

export interface Dispute {
  id: string
  /** "MMBD-7K2Q9XHD", live. */
  ref?: string
  /** Live: the refund that settled it, or funded a lost bank claim. */
  refundId?: string | null
  payment: Payment
  kind: DisputeKind
  reason: DisputeReason
  status: DisputeStatus
  openedAt: string
  replyBy: string
  closedAt?: string
  outcome?: string
  messages: DisputeMessage[]
}

export const isOpen = (d: Dispute) => d.status === 'needs_reply' || d.status === 'under_review'

/** Five samples on real sample payments: two waiting on you, one under review, two closed. */
function seed(): Dispute[] {
  const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  const pay = (ref: string) => PAYMENTS.find((p) => p.ref === ref)!
  const claim = pay('MMB-48323')
  const bank = claim.payer?.bank ?? 'The sender’s bank'
  return [
    {
      id: 'DP-1046',
      payment: claim,
      kind: 'bank',
      reason: 'unauthorised',
      status: 'needs_reply',
      openedAt: h(20),
      replyBy: h(20 - 24 * REPLY_DAYS.bank),
      messages: [
        { from: 'bank', at: h(20), body: `The account holder told us they didn't authorise this transfer of ₦${claim.amount.toLocaleString('en-NG')}. We're asking for it back.` },
        {
          from: 'us',
          at: h(20),
          body: `Show this was a real sale, an invoice, a delivery note, messages with the customer. We send it to ${bank} and they decide. If they keep the claim, the money goes back to the sender and you fund it the way you'd fund a refund.`,
        },
      ],
    },
    {
      id: 'DP-1045',
      payment: pay('MMB-48302'),
      kind: 'customer',
      reason: 'not_received',
      status: 'needs_reply',
      openedAt: h(26),
      replyBy: h(26 - 24 * REPLY_DAYS.customer),
      messages: [{ from: 'customer', at: h(26), body: "I paid this invoice for the website work three days ago and nothing has been delivered. I can't reach anyone." }],
    },
    {
      id: 'DP-1043',
      payment: pay('MMB-48288'),
      kind: 'customer',
      reason: 'duplicate',
      status: 'under_review',
      openedAt: h(48),
      replyBy: h(48 - 24 * REPLY_DAYS.customer),
      messages: [
        { from: 'customer', at: h(48), body: 'I was charged twice for the same order. Please refund one of them.' },
        {
          from: 'you',
          at: h(30),
          body: "We checked: there's one payment from you, MMB-48288. Your second try expired before any money arrived. The screenshot shows it. Your wallet history should show one transfer too.",
          files: [{ name: 'checkout-expired.png' }],
        },
        { from: 'us', at: h(30), body: 'We passed your reply on. The customer has 3 days to accept it or reply.' },
      ],
    },
    {
      id: 'DP-1040',
      payment: pay('MMB-48309'),
      kind: 'customer',
      reason: 'not_as_described',
      status: 'refunded',
      openedAt: h(70),
      replyBy: h(70 - 24 * REPLY_DAYS.customer),
      closedAt: h(40),
      outcome: 'Closed with a refund of $20.00.',
      messages: [
        { from: 'customer', at: h(70), body: 'The hoodie came in the wrong size and the print is already fading.' },
        { from: 'you', at: h(60), body: "Sorry about that. We're refunding $20 now. Keep the hoodie, or send it back and we'll swap it for the right size." },
        { from: 'us', at: h(40), body: 'Closed with a refund of $20.00. The customer accepted it.' },
      ],
    },
    {
      id: 'DP-1036',
      payment: pay('MMB-48274'),
      kind: 'customer',
      reason: 'unrecognised',
      status: 'won',
      openedAt: h(28),
      replyBy: h(28 - 24 * REPLY_DAYS.customer),
      closedAt: h(19),
      outcome: 'Closed in your favour. The customer withdrew it.',
      messages: [
        { from: 'customer', at: h(28), body: "I don't recognise this payment of 520 USDT." },
        { from: 'you', at: h(24), body: 'This is the annual Pro plan, bought on our website from your account. The invoice is attached.', files: [{ name: 'invoice-INV-0031.pdf' }] },
        { from: 'customer', at: h(20), body: 'Ah, a colleague bought it on my account. All good, sorry.' },
        { from: 'us', at: h(19), body: 'Closed in your favour. The customer withdrew the dispute.' },
      ],
    },
  ]
}

/** The preview's samples. Live, disputes come from the API. */
export const disputesStore = createStore<Dispute[]>('mmb_disputes_v1', seed)

export interface ApiDispute {
  id: string
  ref: string
  kind: 'CUSTOMER' | 'BANK'
  reason: string
  status: 'NEEDS_REPLY' | 'UNDER_REVIEW' | 'WON' | 'REFUNDED' | 'LOST'
  openedAt: string
  replyBy: string
  waitUntil: string | null
  closedAt: string | null
  outcome: string | null
  refundId: string | null
  customer: { name: string | null; email: string | null }
  messages: { from: 'CUSTOMER' | 'BUSINESS' | 'BANK' | 'US'; body: string; at: string; files: { id: string; name: string }[] }[]
  payment: ApiPayment
}

const FROM = { CUSTOMER: 'customer', BUSINESS: 'you', BANK: 'bank', US: 'us' } as const

export function fromApiDispute(d: ApiDispute): Dispute {
  const payment = toPayment(d.payment)
  // The name the customer gave when they raised it, when the payment has none.
  if (d.customer.name && (!payment.customer.name || payment.customer.name === 'Customer')) payment.customer = { ...payment.customer, name: d.customer.name }
  return {
    id: d.id,
    ref: d.ref,
    refundId: d.refundId,
    payment,
    kind: d.kind === 'BANK' ? 'bank' : 'customer',
    reason: d.reason.toLowerCase() as DisputeReason,
    status: d.status.toLowerCase() as DisputeStatus,
    openedAt: d.openedAt,
    replyBy: d.replyBy,
    closedAt: d.closedAt ?? undefined,
    outcome: d.outcome ?? undefined,
    messages: d.messages.map((m) => ({ from: FROM[m.from], body: m.body, at: m.at, files: m.files.length ? m.files : undefined })),
  }
}

export const disputesPath = (businessId: string, mode: string) => `/businesses/${businessId}/disputes?mode=${mode}`

/** This business's disputes - test ones kept apart from live. */
export function useBusinessDisputes() {
  const { business, mode } = useSession()
  const store = disputesStore.use(!LIVE && business ? (mode === 'test' ? `${business.id}:test` : business.id) : undefined)
  const live = useApi<{ disputes: ApiDispute[] }>(LIVE && business ? disputesPath(business.id, mode) : null, { every: 30_000 })
  const mapped = useMemo(() => live.data?.disputes.map(fromApiDispute), [live.data])
  return (LIVE ? [mapped, () => {}] : store) as typeof store
}
