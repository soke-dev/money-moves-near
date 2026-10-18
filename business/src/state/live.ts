/**
 * The business's own money, live: payments, settlements and payment links
 * from the API, in the shapes the screens already draw. In preview they're
 * the sample data, so a screen reads them one way whichever it's running.
 *
 * Everything is for the mode the dashboard is in: test mode shows test
 * payments (made on the simulator), live mode shows real ones.
 */
import { useMemo } from 'react'
import { LIVE, type ApiDestination, type ApiInvoice, type ApiLink, type ApiOutlet, type ApiPayment, type ApiRefund, type ApiSettlement } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { PAYMENTS, SETTLEMENTS, type Asset, type Chain, type Destination, type Payment, type Settlement } from '@/data/mock'

export const DEST_FROM_API: Record<ApiDestination, Destination> = { BANK: 'bank', MONEY_MOVES: 'wallet', WALLET: 'onchain' }
export const DEST_TO_API: Record<Destination, ApiDestination> = { bank: 'BANK', wallet: 'MONEY_MOVES', onchain: 'WALLET' }
export const METHOD_FROM_API = { APP: 'app', CRYPTO: 'crypto', NAIRA: 'naira' } as const
export const METHOD_TO_API = { app: 'APP', crypto: 'CRYPTO', naira: 'NAIRA' } as const

/** Dashboards whose checkouts have a host of their own - links there are short: pay.usemoneymoves.xyz/slug. */
const PAY_HOSTS: Record<string, string> = { 'business.usemoneymoves.xyz': 'pay.usemoneymoves.xyz' }
const ownHost = LIVE ? PAY_HOSTS[window.location.host] : undefined

/** Where checkout links point: the checkout's own host in production, else this dashboard's /pay pages (the public host in preview). Old /pay links keep working. */
export const PAY_HOST = ownHost ?? (LIVE ? `${window.location.host}/pay` : 'pay.usemoneymoves.xyz')
/** A checkout's full address, for copying and for QR codes. */
export const payUrl = (path: string) => `${LIVE && !ownHost ? window.location.protocol : 'https:'}//${PAY_HOST}/${path}`

/** How often the lists that change by themselves are read again. */
const EVERY = 8_000

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())

/** "GTBank · 0123456789", "Business wallet" - where a settlement went, in the words the screens split on. */
function targetOf(s: { destination: ApiDestination; bankName: string | null; accountNumber: string | null }, mode: 'TEST' | 'LIVE') {
  if (s.destination === 'BANK') return `${s.bankName ?? 'Bank'} · ${s.accountNumber ?? ''}`
  if (s.destination === 'WALLET') return mode === 'TEST' ? 'Test wallet' : 'Business wallet'
  return mode === 'TEST' ? '@test.merchant' : 'Money Moves'
}

export function toPayment(p: ApiPayment): Payment {
  const name = p.customer.name || (p.payer?.name ? titleCase(p.payer.name) : null) || p.customer.email?.split('@')[0] || 'Customer'
  return {
    id: p.id,
    ref: p.ref,
    linkId: p.link?.id,
    invoiceId: p.invoice?.id,
    outletId: p.outlet?.id,
    customer: { name, email: p.customer.email ?? '' },
    method: METHOD_FROM_API[p.method],
    // Crypto: the coin and network it came on, and the wallet it came from.
    asset: ((p.method === 'CRYPTO' && p.coin) || (p.method === 'NAIRA' ? 'NGN' : 'USDC')) as Asset,
    chain: p.method === 'CRYPTO' && p.network ? (p.network as Chain) : undefined,
    // A transfer's amount is naira; the app and crypto are counted in coins, a dollar each.
    amount: p.method === 'NAIRA' ? p.amountNgn : p.amountUsd,
    usd: p.amountUsd,
    fee: p.feeNgn != null ? Math.round((p.feeNgn / p.ngnPerUsd) * 100) / 100 : 0,
    status: p.status === 'expired' ? 'failed' : p.status,
    channel: p.invoice ? 'Invoice' : p.outlet ? 'In-store QR' : 'Payment link',
    destination: DEST_FROM_API[p.settlement?.destination ?? 'BANK'],
    txHash: p.method === 'CRYPTO' ? (p.payer?.session ?? '') : '',
    from: p.method === 'CRYPTO' ? (p.payer?.account ?? '') : '',
    payer: p.payer ? { name: p.payer.name ?? '', bank: p.payer.bank ?? '', account: p.payer.account ?? '', session: p.payer.session ?? '' } : undefined,
    received: p.status === 'underpaid' && p.receivedNgn != null ? (p.method === 'NAIRA' ? p.receivedNgn : Math.round((p.receivedNgn / p.ngnPerUsd) * 100) / 100) : undefined,
    createdAt: p.createdAt,
    paidAt: p.paidAt ?? undefined,
    settlement: p.settlement ? { status: p.settlement.status, target: targetOf(p.settlement, p.mode), amountNgn: p.settlement.amountNgn, settledAt: p.settlement.settledAt } : undefined,
    live: { feeNgn: p.feeNgn, receivedNgn: p.receivedNgn, ngnPerUsd: p.ngnPerUsd },
  }
}

/** Live only: the business's refunds in this mode, and how it can fund one. */
export function useApiRefunds() {
  const r = useApi<{ refunds: ApiRefund[]; fundings: ApiRefund['funding'][]; closedFundings?: Partial<Record<ApiRefund['funding'], string>> }>(usePath('refunds'), { every: EVERY })
  return { refunds: r.data?.refunds, fundings: r.data?.fundings, closedFundings: r.data?.closedFundings, loading: r.loading, error: r.error }
}

export function toSettlement(s: ApiSettlement): Settlement {
  return {
    id: s.id,
    amountUsd: s.amountUsd,
    ngn: s.destination === 'BANK' && s.amountNgn != null ? s.amountNgn : undefined,
    destination: DEST_FROM_API[s.destination],
    target: targetOf(s, s.mode),
    status: s.status,
    createdAt: s.createdAt,
    payments: 1,
    live: { ref: s.ref, paymentId: s.paymentId, paymentRef: s.paymentRef, feeNgn: s.feeNgn, settledAt: s.settledAt, accountName: s.accountName },
  }
}

/** The path for one of the business's lists, in the mode the dashboard is in - or nothing in preview. */
function usePath(what: string) {
  const { business, mode } = useSession()
  return LIVE && business ? `/businesses/${business.id}/${what}?mode=${mode}` : null
}

export function usePayments() {
  const r = useApi<{ payments: ApiPayment[] }>(usePath('payments'), { every: EVERY })
  const payments = useMemo(() => (LIVE ? (r.data?.payments ?? []).map(toPayment) : PAYMENTS), [r.data])
  return { payments, loading: r.loading }
}

export function useSettlements() {
  const r = useApi<{ settlements: ApiSettlement[] }>(usePath('settlements'), { every: EVERY })
  const settlements = useMemo(() => (LIVE ? (r.data?.settlements ?? []).map(toSettlement) : SETTLEMENTS), [r.data])
  return { settlements, loading: r.loading }
}

/** Live only: the business's invoices in this mode. */
export function useApiInvoices() {
  const r = useApi<{ invoices: ApiInvoice[]; next: string }>(usePath('invoices'), { every: EVERY })
  return { invoices: r.data?.invoices, next: r.data?.next, loading: r.loading, error: r.error }
}

/** Live only: the business's outlets in this mode. */
export function useApiOutlets() {
  const r = useApi<{ outlets: ApiOutlet[] }>(usePath('outlets'), { every: EVERY })
  return { outlets: r.data?.outlets, loading: r.loading, error: r.error }
}

/** Live only: the business's payment links in this mode. */
export function useApiLinks() {
  const r = useApi<{ links: ApiLink[] }>(usePath('links'), { every: EVERY })
  return { links: r.data?.links, loading: r.loading, error: r.error, reload: r.reload }
}
