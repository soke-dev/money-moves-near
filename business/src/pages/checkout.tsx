/**
 * The customer's side: what someone sees when they open a payment link, an
 * invoice, a store QR or a business's checkout.
 *
 * The order sits on the business's own colour - its name, the amount, and a
 * switch to see it in naira or dollars. Paying is two steps on white: who is
 * paying (and how much, when they choose), then how - the ways to pay as an
 * accordion, each opening right there with what it needs and a Pay button.
 * An invoice already knows who it's for, so it starts at the second.
 *
 * After that, one screen per method that says exactly what to send and where,
 * then the page keeps saying where the payment is - waiting, confirming, paid
 * or expired - so nobody pays twice because they couldn't tell.
 *  - Money Moves app: sent to the customer's username or scanned in the app, then approved there;
 *  - crypto: coin and network, then the exact amount to a one-time address;
 *  - naira: the exact amount to a one-time account number.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Bitcoin, Check, ChevronDown, Clock, ClockCountdown, Copy, Download, ExternalLink, FlaskConical, Landmark, Loader2, ShieldCheck, Smartphone } from '@/components/icons'
import { ACCEPTED, INVOICES, NGN_RATE, OUTLETS, PAYMENT_LINKS, type Asset, type Chain, type Currency, type Invoice, type Method } from '@/data/mock'
import { useSession } from '@/state/session'
import { DEFAULT_BRANDING, onColor, useBranding, type Branding } from '@/state/branding'
import { ALL_ACCEPT, useAccept, useMethods, type Accept } from '@/state/accept'
import { AppIcon, AppLine, Avatar, ChainIcon, Flag, Logo, TokenIcon } from '@/components/brand'
import { cx } from '@/components/ui'
import Qr from '@/components/Qr'
import { copy, date, ngn, usd } from '@/lib/format'
import { APP_STORE, PLAY_STORE } from '@/lib/links'
import { useInvoices } from '@/state/invoices'
import { ApiError, LIVE, api, type PublicLink, type PublicPayment } from '@/lib/api'
import { METHOD_FROM_API } from '@/state/live'
import type { PreviewPayload } from '@/components/Builder'
import { downloadReceipt } from '@/components/Receipt'

type Stage = 'details' | 'choose' | 'pay' | 'confirming' | 'done' | 'expired' | 'short'

/** One-time addresses for this checkout - samples, nobody's real wallet. */
const ADDRESS: Partial<Record<Chain, string>> = {
  Movement: '0x5d8a0c41e7b3f92d6a14c08e35f7b2a91d4c6e08f3b7a2d915c4e60b8f3a7d21',
  Solana: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
  Base: '0x9A7c3E51d2B84f06C1e9a2D7b5F3048e6C1dA2B7',
  'BNB Chain': '0x9A7c3E51d2B84f06C1e9a2D7b5F3048e6C1dA2B7',
  Arc: '0x9A7c3E51d2B84f06C1e9a2D7b5F3048e6C1dA2B7',
  Monad: '0x9A7c3E51d2B84f06C1e9a2D7b5F3048e6C1dA2B7',
  TON: 'UQBfAt3kL2Q9x8hN1vP4rYcMzE6wJ7sKd0uG5aTiHqRb3k2L',
  Stellar: 'GDQ7XKZ2M5NWUAHTR6YVD4SEBGC7OLIPF3JKQXA2WZ9RTNPL4VBM',
}

/** The network's full name, as a wallet shows it - so the customer picks the same one. */
const NETWORK_NAME: Partial<Record<Chain, string>> = {
  Movement: 'Movement',
  Solana: 'Solana',
  Base: 'Base (Coinbase L2)',
  'BNB Chain': 'BNB Smart Chain (BEP-20)',
  Arc: 'Arc',
  Monad: 'Monad',
  TON: 'TON',
  Stellar: 'Stellar',
  Arbitrum: 'Arbitrum One',
  Ethereum: 'Ethereum (mainnet, ERC-20)',
  Optimism: 'OP Mainnet',
}

/** The coin picker's "Another coin" entry. */
const OTHER = 'OTHER'

/** How far a swap has got, as the step it's on: sent, received, changed to USDC, paid. */
const INTENT_STEP: Record<string, number> = { PENDING_DEPOSIT: 0, INCOMPLETE_DEPOSIT: 0, REFUNDED: 0, FAILED: 0, KNOWN_DEPOSIT_TX: 1, PROCESSING: 2, SUCCESS: 3 }

/** A coin we have no artwork for: its symbol on a plain disc. Bitcoin gets its own mark. */
function CoinMark({ symbol, size = 22 }: { symbol: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-card font-semibold text-fg"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * (symbol.length > 3 ? 0.3 : 0.36))) }}
    >
      {symbol === 'BTC' ? <Bitcoin style={{ width: size * 0.62, height: size * 0.62 }} /> : symbol}
    </span>
  )
}

/** Every network we offer lands quickly. */
const speedOf = (_c: Chain) => '~fast'

/** The order networks are offered in: ours first, then the busiest elsewhere. */
const NETWORK_ORDER: Chain[] = ['Movement', 'Monad', 'Arc', 'Solana', 'Stellar', 'Base', 'BNB Chain', 'TON', 'Arbitrum', 'Optimism', 'Ethereum']
/** The order ways to pay are shown in. */
const METHOD_ORDER: Method[] = ['crypto', 'app', 'naira']
const byNetworkOrder = (a: Chain, b: Chain) => (NETWORK_ORDER.indexOf(a) + 1 || 99) - (NETWORK_ORDER.indexOf(b) + 1 || 99)

/** Ways to pay, each with a plain line icon - no tiles, no colour; the business's colour marks the one picked. */
const METHOD: Record<Method, { label: string; icon: (n: number) => ReactNode }> = {
  app: { label: 'Money Moves app', icon: (n) => <AppLine size={n} /> },
  crypto: { label: 'Cryptocurrency', icon: (n) => <Bitcoin style={{ width: n, height: n }} /> },
  naira: { label: 'Bank transfer', icon: (n) => <Landmark style={{ width: n, height: n }} /> },
}

const REF = 'MMB-48211'

/** The most one payment can be when the customer types the amount (live, the API says). */
const MAX_NGN = 1_000_000

const CURRENCY_NAME: Record<Currency, string> = { NGN: 'Naira', USD: 'US dollar' }

function useCountdown(seconds: number, running: boolean) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [running])
  return { left, reset: () => setLeft(seconds), label: `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')}` }
}

/**
 * A real payment link: what it is, from the API, and the one payment the
 * customer opens on it. While that payment is waiting, the page keeps asking
 * how it's doing - the transfer can land while they're still in their bank app.
 */
function useLiveCheckout(base: string | null) {
  const [info, setInfo] = useState<PublicLink | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [payment, setPayment] = useState<PublicPayment | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    if (!base) return
    api<PublicLink>('GET', base)
      .then((r) => {
        setInfo(r)
        // An account already opened for it: carry on with that one.
        if (r.payment) setPayment(r.payment)
      })
      .catch((e) => setMissing(e instanceof ApiError ? e.message : "This checkout can't load right now. Try again in a moment."))
  }, [base])

  const token = payment?.token
  const status = payment?.status
  useEffect(() => {
    if (!token || status !== 'OPEN') return
    const t = setInterval(() => {
      api<{ payment: PublicPayment }>('GET', `/pay/p/${token}`)
        .then((r) => setPayment(r.payment))
        .catch(() => {})
    }, 3_000)
    return () => clearInterval(t)
  }, [token, status])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setProblem('')
    try {
      await fn()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) => run(async () => setPayment((await api<{ payment: PublicPayment }>(method, path, body)).payment))

  return {
    info,
    missing,
    payment,
    busy,
    problem,
    start: (method: 'naira' | 'app' | 'crypto', body: { email?: string; name?: string; phone?: string; amount?: number; currency?: Currency; coin?: string; network?: string; intent?: string }) => call('POST', `${base}/${method}`, body),
    /** Paid with another coin: the customer's transaction, so the swap starts on it at once. */
    giveTx: (tx: string) => (token ? call('POST', `/pay/p/${token}/intent-tx`, { tx }) : Promise.resolve()),
    /** "I've sent the money": ask the bank rail now rather than at the next round. */
    check: () => (token ? call('POST', `/pay/p/${token}/check`) : Promise.resolve()),
    /** Test mode: pretend the customer's transfer arrived. */
    simulate: (outcome: 'full' | 'short') => (token ? call('POST', `/pay/p/${token}/simulate`, { outcome }) : Promise.resolve()),
    reset: () => {
      setPayment(null)
      setProblem('')
    },
  }
}

type LiveCheckout = ReturnType<typeof useLiveCheckout>

export function Checkout({ outlet, invoice }: { outlet?: boolean; invoice?: boolean }) {
  const { slug = 'demo' } = useParams()
  // Live, every checkout is real: a payment link, an invoice or an outlet. In preview, samples.
  const base = !LIVE ? null : invoice ? `/pay/i/${encodeURIComponent(slug)}` : outlet ? `/pay/o/${encodeURIComponent(slug)}` : `/pay/${encodeURIComponent(slug)}`
  const live = useLiveCheckout(base)
  if (base && !live.info) return <CheckoutGate missing={live.missing} />
  return <CheckoutPage outlet={outlet} invoice={invoice} live={base ? live : null} />
}

/**
 * The builders' preview, inside a frame: it draws whatever the builder sends -
 * nothing is saved, nothing can be paid.
 */
export function CheckoutPreviewFrame() {
  const [data, setData] = useState<PreviewPayload | null>(null)
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent || e.data?.type !== 'mmb-preview') return
      setData(e.data.payload as PreviewPayload)
    }
    window.addEventListener('message', on)
    window.parent.postMessage({ type: 'mmb-preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', on)
  }, [])
  if (!data) return <div className="min-h-full bg-card" />
  const live: LiveCheckout = {
    info: data.info,
    missing: null,
    payment: null,
    busy: false,
    problem: '',
    start: async () => {},
    check: async () => {},
    simulate: async () => {},
    giveTx: async () => {},
    reset: () => {},
  }
  return <CheckoutPage key={data.key} outlet={data.kind === 'outlet'} invoice={data.kind === 'invoice'} live={live} preview={{ brand: data.brand }} />
}

/** A live invoice, in the shape the page already draws. */
function liveInvoice(L: PublicLink): Invoice | undefined {
  const i = L.invoice
  if (!i) return undefined
  return {
    id: L.link.slug,
    number: i.number,
    token: L.link.slug,
    customer: i.customerName,
    email: i.customerEmail,
    currency: L.link.currency,
    items: i.items,
    note: L.link.description ?? undefined,
    amountUsd: L.link.currency === 'USD' ? (L.link.amount ?? 0) : 0,
    amountNgn: L.link.currency === 'NGN' ? (L.link.amount ?? undefined) : undefined,
    status: i.status === 'PAID' ? 'paid' : i.status === 'DRAFT' ? 'draft' : 'unpaid',
    destination: 'bank',
    createdAt: i.dueAt,
    due: i.dueAt,
    paid: i.status === 'PAID' ? { at: i.paidAt ?? new Date().toISOString(), method: 'naira', ref: i.paymentRef ?? '' } : undefined,
  }
}

/** Before the checkout can show: loading, or nothing here. */
function CheckoutGate({ missing }: { missing: string | null }) {
  return (
    <div className="checkout-type flex min-h-full flex-col items-center justify-center bg-card px-6 py-16 text-center">
      {missing ? (
        <>
          <span className="flex size-14 items-center justify-center rounded-full bg-raise text-muted">
            <AlertTriangle className="size-7" />
          </span>
          <div className="display mt-5 text-[24px] font-semibold leading-tight text-fg">{missing}</div>
          <p className="mt-2 max-w-[360px] text-[14px] leading-relaxed text-muted">Check the link you were sent, or ask the business for a new one.</p>
        </>
      ) : (
        <Loader2 className="size-6 animate-spin text-muted" />
      )}
      <div className="mt-10 flex items-center gap-1.5 text-[12px] text-dim">
        Powered by <Logo compact />
      </div>
    </div>
  )
}

const storeLink = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? APP_STORE : PLAY_STORE
/** On a phone, the app link can be tapped; elsewhere it's a QR to scan. */
const onPhone = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

const clockText = (left: number) => `${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')}`

/** A checkout drawn for the builder's preview: its look comes with it, and paying does nothing. */
export type CheckoutPreview = { brand?: Branding }

export function CheckoutPage({ outlet: isOutlet, invoice: isInvoice, live, preview }: { outlet?: boolean; invoice?: boolean; live: LiveCheckout | null; preview?: CheckoutPreview }) {
  const { slug = 'demo' } = useParams()
  const { business, mode } = useSession()
  const [params] = useSearchParams()
  const L = live?.info ?? null
  const P = live?.payment ?? null
  const link = isOutlet || isInvoice || L ? undefined : PAYMENT_LINKS.find((l) => l.slug === slug)
  // An invoice: one bill, one person, a set amount - opened from the link in its email.
  const [stored] = useInvoices(business?.id)
  const invoice = isInvoice ? (L ? liveInvoice(L) : (stored ?? INVOICES).find((i) => i.number.toLowerCase() === slug)) : undefined
  // A store's link or QR: no set amount - the customer (or the cashier) types it.
  const outlet = isOutlet && !L ? OUTLETS.find((o) => o.slug === slug) : undefined
  const merchant = L ? L.business.name : (business?.name ?? 'Movers Digital Technologies Ltd')
  const verified = L ? L.business.verified : !business || business.verify === 'verified'
  const test = L ? L.link.mode === 'TEST' : business ? mode === 'test' : false
  // The business's own look: its logo, summary colour and accent - sent with a live checkout.
  const [saved = DEFAULT_BRANDING] = useBranding(L ? undefined : business?.id)
  const brand = preview?.brand ?? (L ? (L.business.brand ?? DEFAULT_BRANDING) : saved)
  // Naira per dollar: the payment's own once it's open, else today's.
  const RATE = P?.ngnPerUsd ?? L?.rate ?? NGN_RATE
  const accent = brand.accent
  const ink = onColor(accent)
  const solid = { background: accent, color: ink }

  const fixed = L ? L.link.amount != null : outlet ? false : link ? link.fixed : true
  // The money the business leads with; the customer can switch what they see.
  const lead: Currency = L?.link.currency || invoice?.currency || (link && 'currency' in link && link.currency) || (outlet && 'currency' in outlet && outlet.currency) || 'USD'
  const [payIn, setPayIn] = useState<Currency>(lead)
  const [custom, setCustom] = useState('')
  const typed = Number(custom) || 0
  const fixedNgn = L ? (L.link.currency === 'NGN' && L.link.amount != null ? L.link.amount : undefined) : invoice ? invoice.amountNgn : link && 'amountNgn' in link ? link.amountNgn : undefined
  const fixedUsd = L && L.link.currency === 'USD' && L.link.amount != null ? L.link.amount : undefined
  // A naira price is exact naira and a dollar price exact dollars; the other side is the equivalent.
  const quotedUsd = !fixed ? (payIn === 'NGN' ? typed / RATE : typed) : fixedNgn != null ? fixedNgn / RATE : (fixedUsd ?? (invoice ? invoice.amountUsd : link ? link.amountUsd : 120))
  // Once the payment is open, its own figures - the naira the customer was actually given.
  const amountUsd = P ? P.amountUsd : quotedUsd
  const nairaAmount = P ? P.amountNgn : !fixed && payIn === 'NGN' ? Math.round(typed * 100) / 100 : (fixedNgn ?? (L ? Math.ceil(quotedUsd * RATE) : Math.round(quotedUsd * RATE)))
  const money = payIn === 'NGN' ? ngn(nairaAmount) : usd(amountUsd)
  const other = payIn === 'NGN' ? usd(amountUsd) : ngn(nairaAmount)
  const ref = P?.ref ?? invoice?.paid?.ref ?? (L ? '' : REF)
  const title = L ? L.link.name : outlet ? outlet.name : invoice ? `Invoice ${invoice.number}` : (link?.name ?? 'Payment')

  // Coins and networks: the link's or outlet's own list, else the business default.
  const [fallback] = useAccept(business?.id)
  const accept: Accept = L ? ((L.link.accept as Accept | undefined) ?? {}) : invoice?.accept || (link && 'accept' in link && link.accept) || (outlet && 'accept' in outlet && outlet.accept) || fallback || ALL_ACCEPT
  const coins = ACCEPTED.map((a) => ({ asset: a.asset, chains: a.chains.filter((c) => accept[a.asset]?.includes(c)) })).filter((a) => a.chains.length > 0)
  // Other coins, swapped to USDC on the way: BTC, ETH, SOL and the rest. Live checkouts only.
  const others = L?.link.intents ?? []
  // Ways to pay: the link's or outlet's own, else the business default. Crypto needs at least one coin.
  const [defaultMethods] = useMethods(business?.id)
  const allowed: Method[] = L
    ? L.link.methods.map((m) => METHOD_FROM_API[m])
    : invoice?.methods || (link && 'methods' in link && link.methods) || (outlet && 'methods' in outlet && outlet.methods) || defaultMethods || ['app', 'crypto', 'naira']
  // Always stablecoins, then the app, then bank transfer, whatever order the link stored them in.
  const offered = allowed.filter((m) => m !== 'crypto' || coins.length > 0).sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b))
  // Each way to pay has its own range: the amount box takes the widest of the ways offered here.
  const W = L?.wayLimits
  const maxNgn = W && offered.length ? Math.max(...offered.map((m) => W[m].maxNgn)) : (L?.limits.maxNgn ?? MAX_NGN)
  const MAX_PAY: Record<Currency, number> = { NGN: maxNgn, USD: Math.floor(maxNgn / RATE / 100) * 100 }
  /** Whether this amount can be paid this way, and if not, what that way takes. */
  const fits = (m: Method) => !W || !nairaAmount || (nairaAmount >= W[m].minNgn && nairaAmount <= W[m].maxNgn)
  const rangeNote = (m: Method) => (W ? (nairaAmount > W[m].maxNgn ? `Up to ${ngn(W[m].maxNgn).replace('.00', '')} here` : `From ${ngn(W[m].minNgn).replace('.00', '')} here`) : '')

  const start = params.get('method')
  const [method, setMethod] = useState<Method>(() => invoice?.paid?.method ?? ((start === 'crypto' || start === 'naira') && offered.includes(start) ? start : (offered[0] ?? 'app')))
  // An invoice knows who it's for, and so does a checkout whose business said: straight to paying. Anything else asks who's paying first.
  const known = L?.link.customer
  const knownEnough = !!known?.email && (L?.link.askName === false || (known.name ?? '').trim().length >= 2) && !L?.link.askPhone
  const [stage, setStage] = useState<Stage>(invoice?.status === 'paid' ? 'done' : invoice || knownEnough ? 'choose' : 'details')
  const [name, setName] = useState(invoice?.customer ?? known?.name ?? '')
  const [email, setEmail] = useState(invoice?.email ?? known?.email ?? '')
  const [phone, setPhone] = useState('')
  const [tried, setTried] = useState(false)
  const [exited, setExited] = useState(false)
  const askPhone = !!L?.link.askPhone
  // Live: the business can ask for the email only. Preview and the builder ask for both.
  const askName = !L || L.link.askName !== false
  const [asset, setAsset] = useState<Asset | null>(coins.length === 1 ? coins[0]!.asset : null)
  const [chain, setChain] = useState<Chain | null>(null)
  // "Another coin" picked instead of a stablecoin, and which one.
  const [pickOther, setPickOther] = useState(false)
  const [otherKey, setOther] = useState<string | null>(null)
  const [showTx, setShowTx] = useState(false)
  const [txInput, setTxInput] = useState('')
  const [found, setFound] = useState(0)
  const [details, setDetails] = useState(false)

  const chains = useMemo(() => [...(coins.find((a) => a.asset === asset)?.chains ?? [])].sort(byNetworkOrder), [coins, asset])
  // A payment already open - an invoice picked up again - shows the way it was started.
  useEffect(() => {
    if (!P) return
    setMethod(METHOD_FROM_API[P.method])
    if (P.intent && !P.intent.stable) {
      setPickOther(true)
      setOther(P.intent.coin)
    }
    if (P.deposit) {
      setAsset(P.deposit.coin as Asset)
      setChain(P.deposit.network as Chain)
    }
    // A stablecoin sent through NEAR Intents: still the coin and network the customer picked.
    if (P.intent?.stable) {
      setPickOther(false)
      setAsset(P.intent.symbol as Asset)
      setChain(P.intent.chain as Chain)
    }
  }, [P?.token]) // eslint-disable-line react-hooks/exhaustive-deps
  // ?ttl=10 shortens the window, to see what expiry looks like.
  const timer = useCountdown(Number(params.get('ttl')) || 30 * 60, !live && (stage === 'choose' || stage === 'pay'))
  // Live, the clock is the open account's own, and only once there is one.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!P || P.status !== 'OPEN') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [P?.token, P?.status])
  const left = P ? Math.max(0, Math.floor((Date.parse(P.expiresAt) - now) / 1000)) : timer.left

  useEffect(() => {
    if ((stage === 'choose' || stage === 'pay') && left === 0) setStage('expired')
  }, [stage, left])

  // Preview: a pretend network - found, confirmed, paid out - then done.
  useEffect(() => {
    if (live || stage !== 'confirming') return
    setFound(0)
    const a = setTimeout(() => setFound(1), 1100)
    const b = setTimeout(() => setFound(2), 2200)
    const c = setTimeout(() => setStage('done'), 3100)
    return () => [a, b, c].forEach(clearTimeout)
  }, [stage, live])

  // Live: the page follows the payment. A transfer that lands after the clock ran out still counts.
  useEffect(() => {
    if (!P) return
    if (P.status === 'PAID') {
      setStage('confirming')
      setFound(0)
      const a = setTimeout(() => setFound(1), 500)
      const b = setTimeout(() => setFound(2), 1100)
      const c = setTimeout(() => setStage('done'), 1800)
      return () => [a, b, c].forEach(clearTimeout)
    }
    if (P.status === 'UNDERPAID') setStage('short')
    else if (P.status === 'EXPIRED') setStage('expired')
    else setStage((s) => (s === 'choose' || s === 'details' ? 'pay' : s))
  }, [P?.token, P?.status])

  // The way picked can't take this amount (it changed, or the page opened on it): move to one that can.
  useEffect(() => {
    if (P || fits(method)) return
    const m = offered.find(fits)
    if (m) setMethod(m)
  }, [nairaAmount, stage]) // eslint-disable-line react-hooks/exhaustive-deps

  const otherCoin = others.find((o) => o.key === otherKey) ?? null
  const how = method === 'app' ? 'Money Moves app' : method === 'naira' ? `Bank transfer · ${ngn(nairaAmount)}` : pickOther && otherCoin ? `${otherCoin.symbol} on ${otherCoin.chain}` : `${asset} on ${chain}`
  const over = !fixed && typed > MAX_PAY[payIn]
  // A typed amount can't go under the link's own least, in whichever money it's typed.
  const minLead = !fixed ? (L?.link.min ?? null) : null
  const minUsd = minLead == null ? 0 : lead === 'NGN' ? minLead / RATE : minLead
  const under = minLead != null && typed > 0 && quotedUsd < minUsd - 0.005
  const minLabel = payIn === 'NGN' ? ngn(Math.ceil(minUsd * RATE)) : usd(Math.ceil(minUsd * 100) / 100)
  const closedLink = !!L && !L.link.active
  /** Live: ask for the one-time account. Preview: straight to the pay screen. The builder's preview: nothing. */
  const startBody = () => ({
    email: email.trim() || undefined,
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(askPhone && phone.trim() ? { phone: phone.trim() } : {}),
    amount: fixed ? undefined : typed,
    currency: fixed ? undefined : payIn,
  })
  const go = () => {
    if (preview) return
    if (!live) return setStage('pay')
    void live.start(method, { ...startBody(), ...(method === 'crypto' && pickOther && otherKey ? { intent: otherKey } : method === 'crypto' && asset && chain ? { coin: asset, network: chain } : {}) })
  }
  const maxLabel = payIn === 'NGN' ? ngn(MAX_PAY.NGN).replace('.00', '') : usd(MAX_PAY.USD).replace('.00', '')
  const canPay = !!amountUsd && !over && !under && !closedLink && !live?.busy && fits(method) && (method !== 'crypto' || (pickOther ? !!otherKey : !!asset && !!chain))
  // The typed amount, with thousands separators as it's typed.
  const shownCustom = custom.replace(/^(\d+)/, (m) => Number(m).toLocaleString('en-US'))
  const open = stage === 'choose' || stage === 'pay'

  // Who's paying: a name and an email for the receipt (and a phone, when the business asks).
  const nameOk = !askName || name.trim().length >= 2
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const phoneOk = !askPhone || phone.replace(/\D/g, '').length >= 7
  const detailsOk = nameOk && emailOk && phoneOk && !!amountUsd && !over && !under
  // The business's colour as text on white - or ink, when it's too pale to read.
  const accentText = onColor(accent) === '#FFFFFF' ? accent : '#121210'

  /* ─── The order ─── */

  const brandRow = (
    <div className="flex min-w-0 items-center gap-2.5">
      {brand.logo ? (
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card">
          <img src={brand.logo} alt="" className="size-full object-contain" />
        </span>
      ) : (
        <Avatar name={merchant} size={36} />
      )}
      <span className="min-w-0 truncate text-[16px] font-semibold text-fg">{merchant}</span>
      {verified && (
        <span title="Verified by Money Moves" className="shrink-0 text-good">
          <ShieldCheck className="size-4" weight="fill" />
        </span>
      )}
    </div>
  )

  const currencySwitch = <CurrencySwitch value={payIn} onChange={setPayIn} />
  const shown = fixed || amountUsd

  const rows = (
    <div className="space-y-2.5 text-[13.5px]">
      {invoice && (
        <>
          <Row l="Billed to" v={invoice.customer} />
          <Row l="Due" v={date(invoice.due)} />
          {L &&
            invoice.items.map((it, n) => (
              <Row key={n} l={`${it.qty > 1 ? `${it.qty} × ` : ''}${it.name}`} v={invoice.currency === 'NGN' ? ngn(it.price * it.qty) : usd(it.price * it.qty)} />
            ))}
        </>
      )}
      <Row l="Subtotal" v={money} />
      <Row
        l="Processing fee"
        v={
          P?.customerFeeNgn
            ? P.currency === "USD"
              ? usd(P.customerFeeNgn / P.ngnPerUsd)
              : ngn(P.customerFeeNgn)
            : (L?.link.feePayer ?? L?.business.feePayers?.[method] ?? (method === 'naira' ? L?.business.feePayer : 'BUSINESS')) === "CUSTOMER" && !P
              ? "Added on top when you pay"
              : "None"
        }
      />
      <Row l="Rate" v={`₦${RATE.toLocaleString()} to $1`} />
      {ref && <Row l="Reference" v={ref} />}
      {L?.link.description && <p className="pt-1 leading-relaxed text-muted">{L.link.description}</p>}
    </div>
  )

  /** On a phone: the order in a card that opens for the details. */
  const summary = (
    <div className="rounded-[16px] px-4 pb-3 pt-4" style={{ background: brand.surface }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-semibold text-fg">{title}</div>
          <div className="tabular mt-1 text-[14px] text-muted">≈ {other}</div>
        </div>
        {currencySwitch}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-fg/10 pt-3">
        <span className="text-[14px] text-muted">{invoice?.status === 'paid' ? 'Paid' : 'Total'}</span>
        <span className={cx('tabular text-[18px] font-semibold', shown ? 'text-fg' : 'text-dim')}>{money}</span>
      </div>
      {details && <div className="rise mt-3 border-t border-fg/10 pt-3">{rows}</div>}
      <button onClick={() => setDetails((v) => !v)} className="mt-2.5 w-full text-center text-[13px] font-semibold underline underline-offset-4" style={{ color: accentText }}>
        {details ? 'Hide details' : 'View details'}
      </button>
    </div>
  )

  /** On a computer: the order down the business's own panel. */
  const big = (shown ? money : '₦0.00').length
  const amountBlock = (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[14px] text-muted">{title}</span>
        {currencySwitch}
      </div>
      <div className={cx('display tabular mt-3 break-all font-semibold leading-none text-fg', big > 15 ? 'text-[30px]' : big > 12 ? 'text-[36px]' : 'text-[44px]')}>
        {/* The customer's figure as they type it - nought until then. */}
        <span className={shown ? '' : 'text-dim'}>{money}</span>
      </div>
      <div className="tabular mt-2.5 text-[13px] text-muted">≈ {other}</div>
    </div>
  )

  /* ─── Paying ─── */

  const expires = open && (!live || P) && (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[#F2D3A6] bg-[#FDF3E3] px-2.5 py-1 text-[12.5px] font-medium text-[#A4600B]">
      <ClockCountdown className="size-4" /> {method === 'crypto' && stage === 'pay' ? 'Address held for' : 'Expires in'} <span className="tabular font-semibold">{clockText(left)}</span>
    </span>
  )

  const payButton = (label: string, onClick: () => void, disabled?: boolean, type: 'button' | 'submit' = 'button') => (
    <button
      type={type}
      onClick={type === 'button' ? onClick : undefined}
      disabled={disabled}
      className="flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold transition hover:opacity-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
      style={solid}
    >
      {label}
    </button>
  )

  const note = (children: ReactNode) => <div className="rounded-[10px] border border-line px-4 py-3 text-[14px] leading-relaxed text-muted">{children}</div>

  const closedNote = (
    <div className="rounded-[16px] border border-line bg-[#FAFAF8] px-5 py-6 text-center">
      <div className="text-[16px] font-semibold text-fg">
        {isInvoice ? (L?.invoice?.status === 'VOID' ? 'This invoice was cancelled' : "This invoice isn't taking payments right now") : isOutlet ? "This store isn't taking payments right now" : L?.link.expired ? 'This checkout has expired' : "This link isn't taking payments right now"}
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Ask {merchant} for another way to pay.</p>
    </div>
  )

  const input = (bad: boolean) =>
    cx('h-12 w-full rounded-[10px] border bg-card px-3.5 text-[15px] text-fg outline-none transition placeholder:text-[#A3A199]', bad ? 'border-red' : 'border-line focus:border-fg')
  const field = (label: string, control: ReactNode, error?: string, hint?: ReactNode) => (
    <label className="block">
      <span className="mb-1.5 block text-[13.5px] font-medium text-fg">{label}</span>
      {control}
      {error ? <span className="mt-1.5 block text-[12.5px] text-red">{error}</span> : hint ? <span className="mt-1.5 block text-[12.5px] text-dim">{hint}</span> : null}
    </label>
  )

  /** Step one: who's paying - and how much, when it's theirs to say. */
  const detailsForm = closedLink ? (
    closedNote
  ) : (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (detailsOk) setStage('choose')
      }}
      className="space-y-4"
    >
      <h2 className="text-[17px] font-semibold text-fg">Contact information</h2>
      {askName &&
        field(
          'Full name',
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} placeholder="Jane Smith" autoComplete="name" className={input(tried && !nameOk)} />,
          tried && !nameOk ? 'Enter your name.' : undefined,
        )}
      {field(
        'Email address',
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value.slice(0, 254))} placeholder="you@example.com" autoComplete="email" inputMode="email" className={input(tried && !emailOk)} />,
        tried && !emailOk ? (email.trim() ? "That email doesn't look right." : 'Enter your email. Your receipt goes there.') : undefined,
      )}
      {askPhone &&
        field(
          'Phone number',
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, '').slice(0, 20))} placeholder="0803 123 4567" autoComplete="tel" inputMode="tel" className={input(tried && !phoneOk)} />,
          tried && !phoneOk ? 'Enter your phone number.' : undefined,
        )}
      {!fixed &&
        field(
          `Amount (${payIn})`,
          <span className={cx('flex h-12 items-center gap-2 rounded-[10px] border bg-card px-3.5 transition', over || under || (tried && !amountUsd) ? 'border-red' : 'border-line focus-within:border-fg')}>
            <span className="text-[15px] text-muted">{payIn === 'NGN' ? '₦' : '$'}</span>
            <input
              value={shownCustom}
              onChange={(e) =>
                setCustom(
                  e.target.value
                    .replace(/[^0-9.]/g, '')
                    .replace(/(\..*)\./g, '$1')
                    .replace(/(\.\d{2}).+/, '$1'),
                )
              }
              placeholder="0.00"
              inputMode="decimal"
              aria-label="Amount"
              className="tabular h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium text-fg outline-none placeholder:font-normal placeholder:text-[#A3A199]"
            />
            {typed > 0 && <span className="tabular shrink-0 text-[12.5px] text-dim">≈ {other}</span>}
          </span>,
          over ? `The most one payment can be is ${maxLabel}` : under ? `The least you can pay is ${minLabel}` : tried && !amountUsd ? 'Enter an amount.' : undefined,
          // Test mode has no limit worth mentioning.
          test ? undefined : `Up to ${maxLabel} per payment`,
        )}
      <div className="pt-2">{payButton(shown ? `Pay ${money}` : 'Pay', () => {}, false, 'submit')}</div>
    </form>
  )

  /** Step two: how - pick one and it opens right there, with what it needs and its own button. */
  const choose = closedLink ? (
    closedNote
  ) : (
    <div className="space-y-4">
      {!isInvoice && (
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-raise px-3.5 py-2.5 text-[13px]">
          <span className="min-w-0 truncate text-muted">
            Paying as <span className="text-fg">{name.trim() || email.trim()}</span>{name.trim() ? ` · ${email.trim()}` : null}
          </span>
          <button onClick={() => setStage('details')} className="shrink-0 font-medium text-fg underline underline-offset-4">
            Edit
          </button>
        </div>
      )}
      <div className="rounded-[12px] border border-line bg-card" role="radiogroup">
        {offered.map((m, i) => {
          const on = method === m
          const ok = fits(m)
          return (
            <div key={m} className={cx(i > 0 && !on && 'border-t border-line')}>
              <div className={cx('transition', on && 'relative z-10 m-[3px] rounded-[10px] border-2')} style={on ? { borderColor: accent } : undefined}>
                <button role="radio" aria-checked={on} disabled={!ok} onClick={() => setMethod(m)} className={cx('flex w-full items-center gap-3 text-left', on ? 'px-[13px] py-[13px]' : 'px-4 py-4', !ok && 'cursor-not-allowed opacity-50')}>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? accent : '#C9C6BC' }}>
                    {on && <span className="size-2.5 rounded-full" style={{ background: accent }} />}
                  </span>
                  <span className="text-[#6B6A64]">{METHOD[m].icon(20)}</span>
                  <span className="min-w-0 flex-1 text-[15px] text-fg">
                    {METHOD[m].label}
                    {!ok && <span className="block text-[12.5px] text-muted">{rangeNote(m)}</span>}
                  </span>
                  {ok && m === 'app' && <span className="rounded-full bg-[#E4F2E8] px-2 py-0.5 text-[11px] font-semibold text-good">No fees</span>}
                  {ok && m === 'crypto' && (
                    <span className="flex -space-x-1.5 [&>*]:rounded-full [&>*]:ring-2 [&>*]:ring-white">
                      {coins.map((c) => (
                        <TokenIcon key={c.asset} asset={c.asset} size={22} />
                      ))}
                      {others.length > 0 && <CoinMark symbol="BTC" size={22} />}
                    </span>
                  )}
                </button>

                {on && (
                  <div className="rise space-y-3 border-t border-line px-[13px] pb-[13px] pt-3.5">
                    {m === 'app' && note('Pay from your Money Moves wallet: send it to your username and approve it on your phone, or scan a code in the app. No addresses, no fees.')}
                    {m === 'app' && (
                      <div className="flex items-center justify-between gap-3 px-1 text-[13px]">
                        <span className="text-muted">Don't have the app?</span>
                        <a href={storeLink} target="_blank" rel="noreferrer" className="font-semibold text-fg underline underline-offset-4">
                          Download Money Moves
                        </a>
                      </div>
                    )}
                    {m === 'naira' && note(L?.link.direct ? "You'll get the business's account number and the exact amount to send after you continue. Transfer from any bank app." : 'A one-time bank account is made for you after you continue. Transfer from any bank app.')}
                    {m === 'crypto' && (
                      <>
                        <Picker
                          label="Choose currency"
                          placeholder="Select a coin"
                          value={pickOther ? OTHER : asset}
                          options={[
                            ...coins.map((c) => ({ id: c.asset, title: c.asset, sub: c.asset === 'USDC' ? 'USD Coin' : 'Tether USD', icon: <TokenIcon asset={c.asset} size={22} /> })),
                            ...(others.length ? [{ id: OTHER, title: 'Another coin', sub: 'BTC, ETH, SOL and more', icon: <CoinMark symbol="+" size={22} /> }] : []),
                          ]}
                          onChange={(a) => {
                            if (a === OTHER) {
                              setPickOther(true)
                              return
                            }
                            setPickOther(false)
                            setAsset(a as Asset)
                            setChain(null)
                          }}
                        />
                        {pickOther && (
                          <>
                            <Picker
                              label="Choose coin"
                              placeholder="Select what you're paying with"
                              value={otherKey}
                              options={others.map((o) => ({ id: o.key, title: o.symbol, sub: `on ${o.chain}`, icon: <CoinMark symbol={o.symbol} size={22} /> }))}
                              onChange={setOther}
                            />
                            {note(`You send ${otherCoin?.symbol ?? 'your coin'}, and it's changed to the exact price in USDC on the way. ${merchant} receives the full amount.`)}
                          </>
                        )}
                        {asset && !pickOther && (
                          <Picker
                            label="Choose network"
                            placeholder="Select a network"
                            value={chain}
                            options={chains.map((c) => ({ id: c, title: NETWORK_NAME[c] ?? c, sub: speedOf(c), icon: <ChainIcon chain={c} size={22} /> }))}
                            onChange={(c) => setChain(c as Chain)}
                          />
                        )}
                      </>
                    )}
                    {payButton(live?.busy ? (m === 'naira' ? 'Opening an account…' : 'Starting…') : 'Pay now', go, !canPay)}
                    {live?.problem && <div className="text-center text-[13px] text-red">{live.problem}</div>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const backTo = (
    <button
      onClick={() => {
        // Live, going back lets this account lapse; paying again opens a fresh one.
        live?.reset()
        setStage('choose')
      }}
      className="mb-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-muted hover:text-fg"
    >
      <ArrowLeft className="size-4" /> Back
    </button>
  )

  const waiting = (label: string, of?: number) => (
    <div className="flex items-center gap-3 rounded-[12px] bg-raise px-3.5 py-3 text-[13.5px] text-fg">
      <Loader2 className="size-4 shrink-0 animate-spin text-muted" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {of !== undefined && (
        <span className="flex items-center gap-1.5 text-[12px] text-dim">
          <span className="flex gap-1">
            {Array.from({ length: of }, (_, i) => (
              <span key={i} className="h-1 w-4 rounded-full bg-[#D6D3CA]" />
            ))}
          </span>
          <span className="tabular font-mono">0 of {of}</span>
        </span>
      )}
    </div>
  )

  // Crypto: what to send and where - live, the payment's own address (or our treasury with a memo or exact amount); the sample in preview.
  const dep = P?.deposit ?? null
  const sendTo = dep?.address ?? (chain ? ADDRESS[chain] : '') ?? ''
  const sendAmount = dep?.left ?? dep?.amount ?? amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })
  const memoWord = chain === 'TON' ? 'comment' : 'memo'
  const sendLabel = dep?.left ? 'Still to send' : dep?.own || dep?.memo ? 'Send' : 'Send exactly'
  const sendHint = dep?.left
    ? `${dep.received} ${asset} arrived. Send the rest to the same address${dep.memo ? `, with the same ${memoWord}` : ''}.`
    : dep?.own
      ? 'This address is for this payment alone. If your wallet or exchange takes a fee, add it on top, so this much arrives.'
      : dep?.memo
        ? `Send it with the ${memoWord} below, or we can't tell it's yours. If your exchange takes a fee, add it on top.`
        : dep?.amount
          ? "To the last digit: it's how we know the payment is yours. The network fee goes on top."
          : 'The network fee goes on top.'

  // Crypto that came in and goes back to the customer: over, short, late, another coin.
  const backBase = window.location.pathname.startsWith('/pay/') ? '/pay' : ''
  const WHY_SHORT: Record<string, string> = {
    overpaid: 'came in on top of the price',
    short: 'came in, short of the full amount, before the payment closed',
    late: 'arrived after the payment closed',
    extra: 'arrived after the payment was paid',
    wrong_coin: 'came in another coin or on another network',
  }
  const STATUS_LINE: Record<string, string> = {
    ASK: 'It goes back to you.',
    QUEUED: 'It\u2019s on its way back to the wallet it came from.',
    SENDING: 'It\u2019s on its way back to the wallet it came from.',
    CONFIRMING: 'It\u2019s on its way back to you.',
    RETURNED: 'It\u2019s been sent back to you.',
    MANUAL: 'Our team sends it back to you.',
  }
  const returnsNote = (P?.returns ?? []).length > 0 && (
    <div className="mt-4 space-y-2">
      {(P?.returns ?? []).map((r, i) => (
        <div key={i} className="rounded-[12px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-fg">
            {r.amount} {r.coin}
          </span>{' '}
          {WHY_SHORT[r.why ?? ''] ?? 'came in that wasn\u2019t needed'}. {STATUS_LINE[r.status ?? ''] ?? ''}
          {r.status === 'ASK' && r.token && (
            <>
              {' '}
              <a href={`${backBase}/x/${r.token}`} className="font-medium text-fg underline underline-offset-2">
                Tell us where to send it
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  )
  const netName = chain ? (NETWORK_NAME[chain] ?? chain) : ''
  const seen = P?.seen ?? null
  const txLink = seen && chain ? explorerTx(chain, seen.tx) : null
  const cryptoSteps: { title: string; sub?: ReactNode; side?: string; state: 'done' | 'now' | 'todo'; bars?: { done: number; of: number } }[] = !seen
    ? [
        { title: 'Send from your wallet', sub: `We're watching ${netName} for it.`, state: 'now' },
        { title: `Seen on ${netName}`, state: 'todo' },
        { title: 'Confirmed', state: 'todo' },
        { title: `Paid to ${merchant}`, state: 'todo' },
      ]
    : [
        { title: 'Sent', state: 'done' },
        {
          title: `Seen on ${netName}`,
          sub: txLink ? (
            <a href={txLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-fg">
              Transaction {shortTx(seen.tx)} <ExternalLink className="size-3" />
            </a>
          ) : (
            `Transaction ${shortTx(seen.tx)}`
          ),
          state: 'done',
        },
        { title: 'Confirming', state: 'now', side: `${seen.confirmations} of ${seen.needed}`, bars: { done: seen.confirmations, of: seen.needed } },
        { title: `Paid to ${merchant}`, state: 'todo' },
      ]
  /** Another coin or network from the pay screen. Live, the open payment lapses and a fresh one starts. */
  const switchTo = (a: Asset, c: Chain) => {
    if (a === asset && c === chain) return
    setAsset(a)
    setChain(c)
    if (!live) return
    live.reset()
    void live.start('crypto', { ...startBody(), coin: a, network: c })
  }

  const card = (children: ReactNode) => <div className="rise rounded-[18px] border border-line bg-card p-5 shadow-[0_1px_2px_rgba(18,18,16,0.04)]">{children}</div>

  // Another coin: what to send on the customer's own chain, and where the swap has got to.
  const it = P?.intent ?? null
  // A USDC or USDT payment the platform sends through NEAR Intents: viaCoin as that stablecoin, not as another coin.
  const stableVia = !pickOther && !!it?.stable
  const viaCoin = pickOther ? otherCoin : stableVia && it ? { key: it.coin, symbol: it.symbol, name: it.name, chain: it.chain, slow: false } : null
  const swapAt = it ? INTENT_STEP[it.status] ?? 0 : 0
  const swapSteps = viaCoin
    ? [
        { title: `Send ${viaCoin.symbol} from your wallet`, sub: it?.timeEstimate ? `Usually done in about ${Math.max(1, Math.round(it.timeEstimate / 60))} min once it's sent.` : undefined },
        { title: `Received on ${NETWORK_NAME[viaCoin.chain as Chain] ?? viaCoin.chain}`, sub: it?.originTx ? `Transaction ${shortTx(it.originTx)}` : undefined },
        { title: stableVia ? 'Delivered as USDC' : 'Changed to USDC' },
        { title: `Paid to ${merchant}` },
      ].map((st, i) => ({ ...st, state: (i < swapAt ? 'done' : i === swapAt ? 'now' : 'todo') as 'done' | 'now' | 'todo' }))
    : []
  const intentScreen = viaCoin && (
    <>
      {backTo}
      {card(
        <>
          <div className="flex flex-wrap gap-2">
            {stableVia && asset && chain ? (
              <>
                <ChipMenu
                  label={asset}
                  icon={<TokenIcon asset={asset} size={22} />}
                  options={coins.map((c) => ({ id: c.asset, title: c.asset, sub: c.asset === 'USDC' ? 'USD Coin' : 'Tether USD', icon: <TokenIcon asset={c.asset} size={22} /> }))}
                  onPick={(a) => {
                    const next = coins.find((c) => c.asset === a)
                    const c = next && (next.chains.includes(chain) ? chain : [...next.chains].sort(byNetworkOrder)[0])
                    if (c) switchTo(a as Asset, c)
                  }}
                  disabled={live?.busy || (!!it && it.status !== 'PENDING_DEPOSIT')}
                />
                <ChipMenu
                  label={NETWORK_NAME[chain] ?? chain}
                  icon={<ChainIcon chain={chain} size={22} />}
                  options={chains.map((c) => ({ id: c, title: NETWORK_NAME[c] ?? c, sub: speedOf(c), icon: <ChainIcon chain={c} size={22} /> }))}
                  onPick={(c) => switchTo(asset, c as Chain)}
                  disabled={live?.busy || (!!it && it.status !== 'PENDING_DEPOSIT')}
                />
              </>
            ) : (
            <ChipMenu
              label={`${viaCoin.symbol} on ${viaCoin.chain}`}
              icon={<CoinMark symbol={viaCoin.symbol} size={22} />}
              options={others.map((o) => ({ id: o.key, title: o.symbol, sub: `on ${o.chain}`, icon: <CoinMark symbol={o.symbol} size={22} /> }))}
              onPick={(k) => {
                if (k === otherKey) return
                setOther(k)
                if (!live) return
                live.reset()
                void live.start('crypto', { ...startBody(), intent: k })
              }}
              disabled={live?.busy || (!!it && it.status !== 'PENDING_DEPOSIT')}
            />
            )}
          </div>

          {!it ? (
            <div className="mt-5">{live?.problem ? <div className="text-[13px] text-red">{live.problem}</div> : waiting(`Getting your ${viaCoin.symbol} price`)}</div>
          ) : (
            <>
              <div className="mt-5 text-[13px] text-muted">Send</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="display tabular min-w-0 break-all text-[30px] font-semibold leading-none tracking-[-0.03em] text-fg">
                  {it.amount}
                  <span className="ml-1.5 text-[17px] font-medium tracking-normal text-muted">{it.symbol}</span>
                </span>
                <CopyChip value={it.amount} />
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                {stableVia ? (
                  it.amountUsd && Number(it.amountUsd) > amountUsd ? <>About {usd(Number(it.amountUsd) - amountUsd)} of that covers moving it across networks. </> : null
                ) : it.amountUsd && Number(it.amountUsd) > 0 ? (
                  <>About {usd(Number(it.amountUsd))} at today's price, the swap included. </>
                ) : null}
                It pays {merchant} {usd(amountUsd)} in USDC. If your wallet or exchange takes a fee, add it on top, so this much arrives.
              </p>

              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line pt-4 sm:gap-4">
                <div className="min-w-0">
                  <div className="text-[12px] text-dim">To this {NETWORK_NAME[it.chain as Chain] ?? it.chain} address</div>
                  <div className="mt-1 break-all font-mono text-[13px] leading-relaxed tracking-[0.02em] text-fg sm:text-[14px]">
                    {groups(it.address).map((g, i) => (
                      <span key={i} className="mr-[0.45em] inline-block">
                        {g}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2.5">
                    <CopyChip value={it.address} label="Copy address" />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-[11.5px] text-dim">
                  <span className="rounded-[14px] ring-1 ring-line sm:hidden">
                    <Qr value={it.address} size={88} />
                  </span>
                  <span className="rounded-[14px] ring-1 ring-line max-sm:hidden">
                    <Qr value={it.address} size={104} />
                  </span>
                  Scan address
                </div>
              </div>
              {it.memo && (
                <div className="mt-4 border-t border-line pt-4">
                  <div className="text-[12px] text-dim">Memo (destination tag), needed</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="tabular font-mono text-[22px] font-semibold tracking-[0.08em] text-fg">{it.memo}</span>
                    <CopyChip value={it.memo} label="Copy memo" />
                  </div>
                </div>
              )}

              <div className="mt-4 flex gap-2.5 rounded-[12px] border border-[#F2D3A6] bg-[#FDF6E7] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#7A4A0A]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Only <b className="font-semibold">{it.symbol} on {it.chain}</b>
                  {it.memo ? <>, with the memo</> : null}, in one transfer, before the time runs out.
                </span>
              </div>

              {it.status === 'INCOMPLETE_DEPOSIT' && (
                <div className="mt-4 rounded-[12px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
                  Less than {it.amount} {it.symbol} arrived. Send the rest to the same address before the time runs out. If it doesn't arrive, what you sent is returned.
                </div>
              )}
              {(it.status === 'REFUNDED' || it.status === 'FAILED') && (
                <div className="mt-4 rounded-[12px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
                  This couldn't be changed to USDC, so nothing was paid and what you sent is held for you. Write to{' '}
                  <a href="mailto:support@usemoneymoves.xyz" className="font-medium text-fg underline underline-offset-2">
                    support@usemoneymoves.xyz
                  </a>{' '}
                  with your reference <span className="font-mono text-fg">{ref}</span> and the address to send it back to.
                </div>
              )}

              <ol className="mt-5">
                {swapSteps.map((st, i) => (
                  <li key={st.title} className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                    {i < swapSteps.length - 1 && <span className={cx('absolute left-[11px] top-[26px] h-[calc(100%-26px)] w-0.5', st.state === 'done' ? 'bg-fg' : 'bg-line')} />}
                    <span className={cx('z-[1] flex size-6 items-center justify-center rounded-full border-2 bg-card', st.state === 'done' ? 'border-fg bg-fg text-white' : st.state === 'now' ? 'border-fg' : 'border-line')}>
                      {st.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : st.state === 'now' ? <span className="size-2 animate-pulse rounded-full bg-fg" /> : null}
                    </span>
                    <div className="min-w-0">
                      <div className={cx('text-[14px]', st.state === 'todo' ? 'text-dim' : 'font-semibold text-fg')}>{st.title}</div>
                      {st.sub && <div className="mt-0.5 truncate text-[12.5px] text-muted">{st.sub}</div>}
                    </div>
                  </li>
                ))}
              </ol>

              {it.status === 'PENDING_DEPOSIT' && !it.test && (
                <div className="mt-4">
                  {!showTx ? (
                    <button onClick={() => setShowTx(true)} className="w-full text-center text-[13px] font-medium text-muted underline underline-offset-4 hover:text-fg">
                      I've sent it
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[12.5px] leading-relaxed text-muted">It's picked up by itself. Pasting your transaction ID starts it sooner.</div>
                      <div className="flex gap-2">
                        <input
                          value={txInput}
                          onChange={(e) => setTxInput(e.target.value)}
                          placeholder="Transaction ID (optional)"
                          className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-card px-3 font-mono text-[13px] text-fg outline-none focus:border-fg"
                        />
                        <button
                          disabled={live?.busy || txInput.trim().length < 16}
                          onClick={() => void live?.giveTx(txInput.trim())}
                          className="h-10 shrink-0 rounded-[10px] border border-line px-3.5 text-[13px] font-semibold text-fg hover:border-fg disabled:opacity-50"
                        >
                          {live?.busy ? 'Sending…' : 'Add'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {live?.problem && <div className="mt-3 text-center text-[13px] text-red">{live.problem}</div>}
            </>
          )}

          {P?.simulator && it && (
            <TestBox title="Test mode, pretend the coins arrived" note="This address is made up for testing, and no wallet will send to it. Nothing real can be lost.">
              <TestButton primary busy={live?.busy} onClick={() => void live?.simulate('full')}>
                Send {it.amount} {it.symbol}
              </TestButton>
            </TestBox>
          )}
        </>,
      )}
    </>
  )

  const payScreens = (
    <>
      {method === 'crypto' && viaCoin && intentScreen}

      {method === 'crypto' && !pickOther && !stableVia && asset && chain && (
        <>
          {backTo}
          {card(
            <>
              {/* Coin and network, changeable here - live, a change opens a fresh payment with its own exact amount. */}
              <div className="flex flex-wrap gap-2">
                <ChipMenu
                  label={asset}
                  icon={<TokenIcon asset={asset} size={22} />}
                  options={coins.map((c) => ({ id: c.asset, title: c.asset, sub: c.asset === 'USDC' ? 'USD Coin' : 'Tether USD', icon: <TokenIcon asset={c.asset} size={22} /> }))}
                  onPick={(a) => {
                    const next = coins.find((c) => c.asset === a)
                    const c = next && (next.chains.includes(chain) ? chain : [...next.chains].sort(byNetworkOrder)[0])
                    if (c) switchTo(a as Asset, c)
                  }}
                  disabled={live?.busy}
                />
                <ChipMenu
                  label={NETWORK_NAME[chain] ?? chain}
                  icon={<ChainIcon chain={chain} size={22} />}
                  options={chains.map((c) => ({ id: c, title: NETWORK_NAME[c] ?? c, sub: speedOf(c), icon: <ChainIcon chain={c} size={22} /> }))}
                  onPick={(c) => switchTo(asset, c as Chain)}
                  disabled={live?.busy}
                />
              </div>

              {live && !P ? (
                <div className="mt-5">{waiting('Getting your address ready')}</div>
              ) : (
                <>
                  <div className="mt-5 text-[13px] text-muted">{sendLabel}</div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="display tabular text-[32px] font-semibold leading-none tracking-[-0.03em] text-fg">
                      {sendAmount}
                      <span className="ml-1.5 text-[17px] font-medium tracking-normal text-muted">{asset}</span>
                    </span>
                    <CopyChip value={sendAmount} />
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{sendHint}</p>

                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line pt-4 sm:gap-4">
                    <div className="min-w-0">
                      <div className="text-[12px] text-dim">To this {NETWORK_NAME[chain] ?? chain} address</div>
                      <div className="mt-1 break-all font-mono text-[13px] leading-relaxed tracking-[0.02em] text-fg sm:text-[14px]">
                        {groups(sendTo).map((g, i) => (
                          <span key={i} className="mr-[0.45em] inline-block">
                            {g}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2.5">
                        <CopyChip value={sendTo} label="Copy address" />
                      </div>
                    </div>
                    {/* The code sits beside the address on every screen: smaller on a phone, so the address keeps its width. */}
                    <div className="flex flex-col items-center gap-1.5 text-[11.5px] text-dim">
                      <span className="rounded-[14px] ring-1 ring-line sm:hidden">
                        <Qr value={sendTo} size={88} />
                      </span>
                      <span className="rounded-[14px] ring-1 ring-line max-sm:hidden">
                        <Qr value={sendTo} size={104} />
                      </span>
                      Scan address
                    </div>
                  </div>
                  {dep?.memo && (
                    <div className="mt-4 border-t border-line pt-4">
                      <div className="text-[12px] text-dim">{memoWord === 'comment' ? 'Comment' : 'Memo'}, needed</div>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <span className="tabular font-mono text-[22px] font-semibold tracking-[0.08em] text-fg">{dep.memo}</span>
                        <CopyChip value={dep.memo} label={`Copy ${memoWord}`} />
                      </div>
                    </div>
                  )}

                  <div className="mt-4 flex gap-2.5 rounded-[12px] border border-[#F2D3A6] bg-[#FDF6E7] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#7A4A0A]">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Only <b className="font-semibold">{asset} on {NETWORK_NAME[chain] ?? chain}</b>
                      {dep?.memo ? <>, with the {memoWord}</> : null}. Another coin or network can't be recovered.
                    </span>
                  </div>

                  {/* Where the transfer has got to - from the chain itself, live. */}
                  <ol className="mt-5">
                    {cryptoSteps.map((st, i) => (
                      <li key={st.title} className="relative grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 pb-4 last:pb-0">
                        {i < cryptoSteps.length - 1 && <span className={cx('absolute left-[11px] top-[26px] h-[calc(100%-26px)] w-0.5', st.state === 'done' ? 'bg-fg' : 'bg-line')} />}
                        <span
                          className={cx('z-[1] flex size-6 items-center justify-center rounded-full border-2 bg-card', st.state === 'done' ? 'border-fg bg-fg text-white' : st.state === 'now' ? 'border-fg' : 'border-line')}
                        >
                          {st.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : st.state === 'now' ? <span className="size-2 animate-pulse rounded-full bg-fg" /> : null}
                        </span>
                        <div className="min-w-0">
                          <div className={cx('text-[14px]', st.state === 'todo' ? 'text-dim' : 'font-semibold text-fg')}>{st.title}</div>
                          {st.sub && <div className="mt-0.5 truncate text-[12.5px] text-muted">{st.sub}</div>}
                          {st.bars && (
                            <div className="mt-1.5 flex gap-[3px]">
                              {Array.from({ length: st.bars.of }, (_, b) => (
                                <span key={b} className={cx('h-1 w-6 rounded-full', b < st.bars!.done ? 'bg-fg' : 'bg-line')} />
                              ))}
                            </div>
                          )}
                        </div>
                        {st.side && <span className="pt-0.5 font-mono text-[12px] text-muted">{st.side}</span>}
                      </li>
                    ))}
                  </ol>

                  {!P?.seen && (
                    <button
                      onClick={() => {
                        if (!live) return setStage('confirming')
                        void live.check()
                      }}
                      disabled={live?.busy}
                      className="mt-4 w-full text-center text-[13px] font-medium text-muted underline underline-offset-4 hover:text-fg disabled:opacity-60"
                    >
                      {live?.busy ? 'Looking for it…' : "I've sent it"}
                    </button>
                  )}
                  {returnsNote}
                  <p className="mt-3 text-center text-[12px] leading-relaxed text-dim">
                    {dep?.own ? (
                      <>Sent too little? Send the rest to the same address. Sent too much? The extra comes back to you.</>
                    ) : dep?.memo ? (
                      <>
                        Left out the {memoWord}? Write to{' '}
                        <a href="mailto:support@usemoneymoves.xyz" className="underline underline-offset-2">
                          support@usemoneymoves.xyz
                        </a>{' '}
                        with your transaction.
                      </>
                    ) : (
                      <>
                        Sent a different amount, or on another network? It can't be matched by itself. Write to{' '}
                        <a href="mailto:support@usemoneymoves.xyz" className="underline underline-offset-2">
                          support@usemoneymoves.xyz
                        </a>{' '}
                        with your transaction.
                      </>
                    )}
                  </p>
                </>
              )}

              {P?.simulator && (
                <TestBox title="Test mode, pretend the deposit arrived" note="This address is made up for testing, and no wallet will send to it. Nothing real can be lost.">
                  <TestButton primary busy={live?.busy} onClick={() => void live?.simulate('full')}>
                    Send {amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} {asset}
                  </TestButton>
                  <TestButton busy={live?.busy} onClick={() => void live?.simulate('short')}>
                    Send $1 less
                  </TestButton>
                  {live?.problem && <div className="mt-2 w-full text-[12.5px] text-red">{live.problem}</div>}
                </TestBox>
              )}
              {!P?.simulator && live?.problem && <div className="mt-3 text-center text-[13px] text-red">{live.problem}</div>}
            </>,
          )}
        </>
      )}

      {method === 'naira' && (!live || P?.account) && (
        <>
          {backTo}
          {card(
            <>
              <div className="text-[13.5px] font-medium text-muted">Transfer exactly</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="display tabular text-[32px] font-semibold leading-none tracking-[-0.03em] text-fg">{ngn(nairaAmount)}</span>
                <CopyChip value={String(nairaAmount)} />
              </div>
              {P?.direct ? (
                <div className="mt-2.5 flex gap-2.5 rounded-[12px] border border-[#F2D3A6] bg-[#FDF6E7] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#7A4A0A]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Send <b className="font-semibold">exactly {ngn(nairaAmount)}</b>, kobo included, in one transfer. The exact amount is how your payment is recognised.
                  </span>
                </div>
              ) : (
                <div className="mt-1.5 text-[13px] text-muted">To this account, in one transfer</div>
              )}
              <div className="mt-4 divide-y divide-soft border-t border-line">
                <div className="flex items-center justify-between gap-3 py-3.5">
                  <div>
                    <div className="text-[12px] text-dim">Bank</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[15px] font-semibold text-fg">
                      <Landmark className="size-4 text-muted" /> {P?.account?.bank ?? 'Nombank MFB'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 py-3.5">
                  <div>
                    <div className="text-[12px] text-dim">Account number</div>
                    <div className="tabular mt-0.5 font-mono text-[20px] font-semibold tracking-wide text-fg">{P?.account?.number ?? '9973355054'}</div>
                  </div>
                  <CopyChip value={P?.account?.number ?? '9973355054'} />
                </div>
                <div className="py-3.5">
                  <div className="text-[12px] text-dim">Account name</div>
                  <div className="mt-0.5 text-[15px] font-semibold text-fg">{P?.account?.name ?? `MMB / ${merchant}`}</div>
                </div>
              </div>
              <div className="mt-1 flex gap-2.5 rounded-[12px] border border-[#F2C9A6] bg-[#FDF0E6] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#9A4A10]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Don't save or reuse this account. It's for this payment only and closes when the timer runs out.
              </div>
              <div className="mt-4">{waiting('Waiting for your transfer')}</div>
              <div className="mt-3">
                {payButton("I've sent the money", () => {
                  void live?.check()
                  setStage('confirming')
                })}
              </div>
              {P?.simulator && (
                <div className="mt-4 rounded-[12px] border border-dashed border-[#E3B85C] bg-[#FDF8EC] p-3.5">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#6E440A]">
                    <FlaskConical className="size-4" /> Test mode, pretend the transfer arrived
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      disabled={live?.busy}
                      onClick={() => void live?.simulate('full')}
                      className="rounded-full bg-fg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                    >
                      Send {ngn(nairaAmount)}
                    </button>
                    <button
                      disabled={live?.busy}
                      onClick={() => void live?.simulate('short')}
                      className="rounded-full border border-[#E3B85C] bg-card px-3.5 py-1.5 text-[12.5px] font-semibold text-fg disabled:opacity-50"
                    >
                      Send ₦100 less
                    </button>
                  </div>
                  {live?.problem && <div className="mt-2 text-[12.5px] text-red">{live.problem}</div>}
                </div>
              )}
            </>,
          )}
        </>
      )}

      {method === 'app' && (
        <>
          {backTo}
          {card(
            <>
              <div className="flex items-center gap-3">
                <AppIcon size={36} />
                <div>
                  <div className="text-[16px] font-semibold text-fg">Approve {money} in the app</div>
                  <div className="text-[12.5px] text-muted">No addresses, no network fees.</div>
                </div>
              </div>
              {P?.simulator ? (
                <TestBox title="Test mode, pretend it was approved in the app" note="A test payment never reaches the Money Moves app. Live, the customer approves it there with one tap, or by scanning a code.">
                  <TestButton primary busy={live?.busy} onClick={() => void live?.simulate('full')}>
                    Approve {money}
                  </TestButton>
                  {live?.problem && <div className="mt-2 w-full text-[12.5px] text-red">{live.problem}</div>}
                </TestBox>
              ) : P?.app ? (
                <div className="mt-4">
                  {/* One link. Tapped on this phone it opens the payment in Money Moves; from a
                      computer it's the QR to scan. Never by typing a username - a payment somebody
                      didn't start themselves is one they might approve without knowing what it is. */}
                  {onPhone && (
                    <>
                      <a href={P.app.link} className="flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold" style={solid}>
                        <Smartphone className="size-4" /> Open Money Moves
                      </a>
                      <p className="mt-2 text-center text-[12.5px] text-dim">It opens in the app. Check it's {merchant} and {money}, then approve with your PIN.</p>
                      <div className="my-4 flex items-center gap-3 text-[12px] text-dim">
                        <span className="h-px flex-1 bg-line" /> or scan it from another phone <span className="h-px flex-1 bg-line" />
                      </div>
                    </>
                  )}
                  <div className="flex flex-col items-center gap-4 rounded-[14px] border border-line px-4 pb-4 pt-5">
                    <span className="shrink-0 rounded-2xl ring-1 ring-line">
                      <Qr value={P.app.link} size={168} logo />
                    </span>
                    <ol className="w-full min-w-0 space-y-2.5 border-t border-line pt-4 text-[13.5px] text-muted">
                      {[
                        <>Open <b className="font-semibold text-fg">Money Moves</b> and tap <b className="font-semibold text-fg">Scan</b></>,
                        <>Point it at this code</>,
                        <>Check it's <b className="font-semibold text-fg">{merchant}</b>, then approve with your PIN</>,
                      ].map((t, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-raise text-[11.5px] font-semibold text-fg">{i + 1}</span>
                          <span className="min-w-0 pt-px">{t}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {!onPhone && <p className="mt-3 text-center text-[12.5px] text-dim">A phone's own camera works too. It opens the payment in Money Moves.</p>}
                </div>
              ) : (
                <div className="mt-4 flex justify-center">
                  <Loader2 className="size-5 animate-spin text-muted" />
                </div>
              )}
              <div className="mt-4">{waiting('Waiting for your approval')}</div>
              <button
                onClick={() => {
                  void live?.check()
                  setStage('confirming')
                }}
                className="mt-3 w-full text-center text-[13px] font-medium text-muted underline underline-offset-4 hover:text-fg"
              >
                I've approved it
              </button>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t border-line pt-4">
                <span className="text-[12px] text-dim">No app yet?</span>
                <a href={APP_STORE} target="_blank" rel="noreferrer">
                  <img src="/brand/app-store.svg" alt="Download on the App Store" className="h-8 w-auto" />
                </a>
                <a href={PLAY_STORE} target="_blank" rel="noreferrer">
                  <img src="/brand/google-play.svg" alt="Get it on Google Play" className="h-8 w-auto" />
                </a>
              </div>
            </>,
          )}
        </>
      )}
    </>
  )

  const confirming = card(
    <>
      <div className="text-[16px] font-semibold text-fg">Confirming your payment</div>
      <p className="mt-1 text-[13px] text-muted">Usually a few seconds. You can close this page. Your receipt is on its way either way.</p>
      <ol className="mt-5">
        {[
          method === 'app' ? 'Approved in the app' : method === 'naira' ? 'Transfer received' : `Payment found on ${chain}`,
          method === 'crypto' ? `Confirmed on ${chain}` : method === 'naira' ? 'Checked with the bank' : 'Secured',
          `Paid to ${merchant}`,
        ].map((t, i) => {
          const done = found > i
          const now = found === i
          return (
            <li key={t} className="relative flex gap-3.5 pb-6 last:pb-0">
              {i < 2 && <span className={cx('absolute left-[13px] top-8 h-[calc(100%-30px)] w-px', done ? 'bg-fg/40' : 'bg-line')} />}
              <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full border transition', done ? 'border-transparent' : now ? 'border-fg' : 'border-line')} style={done ? solid : undefined}>
                {done ? <Check className="size-4" strokeWidth={3} /> : now ? <Loader2 className="size-4 animate-spin text-fg" /> : null}
              </span>
              <span className={cx('pt-1 text-[14.5px]', done ? 'text-fg' : now ? 'font-semibold text-fg' : 'text-dim')}>{t}</span>
            </li>
          )
        })}
      </ol>
      {P?.status === 'OPEN' && (
        <div className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
          Nothing has arrived yet. Transfers usually land within a minute. This page updates by itself.
          <button onClick={() => setStage('pay')} className="mt-2 block font-medium text-fg underline underline-offset-4">
            Show the account details again
          </button>
        </div>
      )}
    </>,
  )

  const done = card(
    <>
      <div className="flex flex-col items-center pt-2 text-center">
        <img src="/brand/checked.png" alt="" className="pop size-16" />
        <div className="display mt-4 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-fg">{money} paid</div>
        <p className="mt-1 text-[14px] text-muted">We've received your payment.</p>
      </div>
      {brand.success && (
        <p className="mt-4 rounded-[12px] px-4 py-3 text-[13.5px] leading-relaxed text-fg" style={{ background: brand.surface }}>
          {brand.success}
        </p>
      )}
      <div className="mt-5 divide-y divide-soft border-y border-line text-[13.5px]">
        {[
          ['Amount', `${money} · ≈ ${other}`],
          ['Paid with', how],
          ['Reference', ref],
          ['Date', new Date(P?.paidAt ?? invoice?.paid?.at ?? Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })],
          ['Receipt', email || 'No email given'],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between gap-4 py-3">
            <span className="text-dim">{l}</span>
            <span className={cx('min-w-0 truncate text-right text-fg', l === 'Reference' && 'font-mono text-[12.5px]')}>{v}</span>
          </div>
        ))}
      </div>
      {returnsNote}
      <div className="mt-5 space-y-2">
        {(!L || L.link.redirectUrl) && (
          <button onClick={() => L?.link.redirectUrl && window.location.assign(L.link.redirectUrl)} className="flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold" style={solid}>
            Return to {merchant.split(' ')[0]}
          </button>
        )}
        <button
          onClick={() =>
            void downloadReceipt({
              merchant,
              logo: brand.logo,
              title,
              description: L?.link.description ?? invoice?.note ?? null,
              amount: money,
              other,
              paidWith: method === 'naira' ? 'Bank transfer' : how,
              reference: ref,
              paidAt: new Date(P?.paidAt ?? invoice?.paid?.at ?? Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
              payerName: name.trim() || invoice?.customer,
              payerEmail: email.trim() || undefined,
              rate: `₦${RATE.toLocaleString()} to $1`,
              items: invoice?.items.map((it) => ({ name: it.name, qty: it.qty, total: invoice.currency === 'NGN' ? ngn(it.price * it.qty) : usd(it.price * it.qty) })),
              test,
            })
          }
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line text-[14px] font-semibold text-fg hover:bg-[#FAFAF8]"
        >
          <Download className="size-4" /> Download receipt
        </button>
      </div>
    </>,
  )

  const expired = card(
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-raise text-muted">
        <Clock className="size-7" />
      </span>
      <div className="display mt-5 text-[24px] font-semibold leading-tight text-fg">This payment window closed</div>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Start again for a fresh {method === 'naira' ? 'account number' : method === 'crypto' ? 'address' : 'request'}. If you sent money after it closed, it isn't lost.{' '}
        {method === 'crypto' ? 'It comes back to you' : `${merchant} can refund it`}, with reference <span className="font-mono text-[13px] text-fg">{ref}</span>.
      </p>
      {returnsNote}
      <div className="mt-5">
        {payButton('Start again', () => {
          timer.reset()
          live?.reset()
          setChain(null)
          setStage('choose')
        })}
      </div>
    </>,
  )

  const shortBy = P?.receivedNgn != null ? P.amountNgn - P.receivedNgn : 0
  // Crypto is counted in the coin (a dollar each); the rest in naira.
  const inCoin = (naira: number) => `${(naira / (P?.ngnPerUsd || RATE)).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${P?.deposit?.coin ?? 'USDC'}`
  const shortMoney = (naira: number) => (P?.method === 'CRYPTO' ? inCoin(naira) : ngn(naira))
  const short = card(
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-[#FDF3E3] text-[#A4600B]">
        <AlertTriangle className="size-7" />
      </span>
      <div className="display mt-5 text-[24px] font-semibold leading-tight text-fg">
        {shortMoney(P?.receivedNgn ?? 0)} arrived, {shortMoney(shortBy)} short
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        Your money isn't lost. {merchant} can accept what arrived or refund it to the {P?.method === 'CRYPTO' ? 'wallet' : 'account'} it came from. Keep your reference:{' '}
        <span className="font-mono text-[13px] text-fg">{ref}</span>.
      </p>
    </>,
  )

  const footer = (
    <div className="mt-10 space-y-2 text-center text-[13px]">
      <div className="flex items-center justify-center gap-1.5 text-muted">
        <ShieldCheck className="size-4" style={{ color: accentText }} /> Secure payment
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-dim">
        <span className="inline-flex items-center gap-1.5">
          Powered by <Logo compact />
        </span>
        <span className="h-3.5 w-px bg-line" />
        <a href="/legal/terms" target="_blank" rel="noreferrer" className="hover:text-fg">
          Terms
        </a>
        <span>·</span>
        <a href="/legal/privacy" target="_blank" rel="noreferrer" className="hover:text-fg">
          Privacy
        </a>
      </div>
    </div>
  )

  const first = stage === 'details' || (stage === 'choose' && !!isInvoice)
  const exit = () => {
    if (window.history.length > 1) return window.history.back()
    if (L?.link.redirectUrl) return window.location.assign(L.link.redirectUrl)
    setExited(true)
  }

  // Left with nowhere to go back to: say so, with a way back in.
  if (exited)
    return (
      <div className="checkout-type flex min-h-full flex-col items-center justify-center bg-card px-6 py-16 text-center">
        <div className="text-[20px] font-semibold text-fg">You've left the checkout</div>
        <p className="mt-2 max-w-[340px] text-[14px] leading-relaxed text-muted">Nothing was paid. You can close this tab.</p>
        <button onClick={() => setExited(false)} className="mt-6 rounded-full border border-line px-5 py-2.5 text-[14px] font-semibold text-fg hover:bg-[#FAFAF8]">
          Back to the checkout
        </button>
      </div>
    )

  return (
    <div className="checkout-type flex min-h-full flex-col bg-card">
      {test && (
        <div className="stripes relative h-1.5 shrink-0">
          <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-b-md bg-[#F2B544] px-2.5 pb-0.5 text-[11px] font-semibold text-fg">
            Test mode · no real money moves
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col md:grid md:grid-cols-[1fr_1.05fr]">
        {/* ─ The order: a full panel on a computer ─ */}
        <aside className="hidden md:flex md:justify-end" style={{ background: brand.surface }}>
          <div className="flex w-full max-w-[480px] flex-col px-12 py-16">
            {brandRow}
            <div className="mt-14">{amountBlock}</div>
            <div className="mt-8 border-t border-fg/10 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[14px] text-muted">{invoice?.status === 'paid' ? 'Paid' : 'Total'}</span>
                <span className={cx('tabular text-[16px] font-semibold', viaCoin ? 'text-fg' : 'text-dim')}>{money}</span>
              </div>
            </div>
            <div className="mt-6 border-t border-fg/10 pt-5">{rows}</div>
          </div>
        </aside>

        {/* ─ The order on a phone: a card that opens ─ */}
        <div className="px-4 pt-4 md:hidden">
          <div className="flex items-center justify-between gap-3">
            {brandRow}
            {expires}
          </div>
          <div className="mt-4">{summary}</div>
        </div>

        {/* ─ Paying ─ */}
        <main className="md:flex md:justify-start">
          <div className="flex w-full flex-col px-4 py-5 md:max-w-[480px] md:px-12 md:py-16">
            <div className="mb-5 hidden justify-end md:flex">{expires || <span className="h-[30px]" />}</div>
            {/* Paused by our team: nothing can start, and nothing has been charged. */}
            {L?.maintenance && stage !== 'done' && stage !== 'confirming' ? (
              <div className="rounded-[16px] border border-line bg-[#FAFAF8] px-5 py-7 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#FDF3E3] text-[#A4600B]">
                  <Clock className="size-6" />
                </span>
                <div className="mt-4 text-[17px] font-semibold text-fg">Payments are paused for a moment</div>
                <p className="mx-auto mt-1.5 max-w-[320px] text-[14px] leading-relaxed text-muted">We're doing some quick maintenance. Try again in a little while. Nothing has been charged.</p>
              </div>
            ) : (
            <div key={stage}>
              {stage === 'details' && detailsForm}
              {stage === 'choose' && choose}
              {stage === 'pay' && payScreens}
              {stage === 'confirming' && confirming}
              {stage === 'done' && done}
              {stage === 'expired' && expired}
              {stage === 'short' && short}
            </div>
            )}
            {first && !preview && (
              <button onClick={exit} className="mt-5 inline-flex items-center gap-1.5 self-start text-[14px] text-muted hover:text-fg">
                <ArrowLeft className="size-4" /> Exit checkout
              </button>
            )}
            {footer}
          </div>
        </main>
      </div>
    </div>
  )
}

/* ─── Pieces ───────────────────────────────────────────────────────── */

/** Test mode only: where the checkout pretends the customer paid. Never drawn for a live payment. */
function TestBox({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-[12px] border border-dashed border-[#E3B85C] bg-[#FDF8EC] p-3.5">
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#6E440A]">
        <FlaskConical className="size-4" /> {title}
      </div>
      {note && <p className="mt-1.5 text-[12px] leading-relaxed text-[#6E440A]/80">{note}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

function TestButton({ primary, busy, onClick, children }: { primary?: boolean; busy?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className={cx(
        'rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold disabled:opacity-50',
        primary ? 'bg-fg text-white' : 'border border-[#E3B85C] bg-card text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{l}</span>
      <span className="tabular truncate text-fg">{v}</span>
    </div>
  )
}

/** "Pay in NGN" - the customer sees the order in naira or dollars. */
function CurrencySwitch({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Currency"
        className={cx(
          'flex items-center gap-1.5 rounded-full border bg-card py-1 pl-1 pr-2.5 text-[13px] font-semibold text-fg shadow-[0_1px_2px_rgba(18,18,16,0.06)] transition',
          open ? 'border-fg' : 'border-fg/10 hover:border-fg/25',
        )}
      >
        <Flag c={value} size={20} /> Pay in {value}
        <ChevronDown className={cx('size-3.5 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="rise absolute right-0 top-full z-20 mt-1.5 w-[230px] overflow-hidden rounded-[12px] border border-line bg-card py-1 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.25)]">
          {(['NGN', 'USD'] as Currency[]).map((c) => (
            <button
              key={c}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13.5px] hover:bg-raise"
            >
              <Flag c={c} size={20} />
              <span className="flex-1 text-fg">
                {c} · {CURRENCY_NAME[c]}
              </span>
              {value === c && <Check className="size-4 text-fg" strokeWidth={3} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A dropdown with icons - the coin, then the network. Its label sits above, like any other field. */
function Picker({
  label,
  placeholder,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  placeholder: string
  value: string | null
  options: { id: string; title: string; sub?: string; icon: ReactNode }[]
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const pick = options.find((o) => o.id === value)
  return (
    <div ref={ref} className="relative">
      <div className="mb-1.5 text-[13.5px] text-muted">{label}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex h-12 w-full items-center gap-2.5 rounded-[10px] border bg-card px-3.5 text-left transition disabled:cursor-not-allowed disabled:bg-[#FAFAF8]', open ? 'border-fg' : 'border-line hover:border-[#D3D0C7]')}
      >
        {pick ? (
          <>
            {pick.icon}
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">{pick.title}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-[15px] text-[#A3A199]">{placeholder}</span>
        )}
        <ChevronDown className={cx('size-4 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="rise absolute inset-x-0 top-full z-20 mt-1.5 max-h-[280px] overflow-y-auto rounded-[10px] border border-line bg-[#FCFCFB] py-1 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.25)]">
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
              className={cx('flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-raise', o.id === value && 'bg-raise')}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-fg">{o.title}</span>
              {o.sub && <span className="shrink-0 text-[12px] text-dim">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CopyChip({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        copy(value)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-muted hover:text-fg"
      aria-label="Copy"
    >
      {done ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : label}
    </button>
  )
}

/** An address in fours, so it can be checked against a wallet a few characters at a time. */
function groups(address: string): string[] {
  const head = address.startsWith('0x') ? '0x' : ''
  const rest = address.slice(head.length)
  const out = rest.match(/.{1,4}/g) ?? []
  return head ? [head + (out[0] ?? ''), ...out.slice(1)] : out
}

const shortTx = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h)

/** A transaction on its network's explorer. */
function explorerTx(chain: Chain, hash: string): string | null {
  const at: Partial<Record<Chain, string>> = {
    Monad: 'https://monadscan.com/tx/',
    Base: 'https://basescan.org/tx/',
    'BNB Chain': 'https://bscscan.com/tx/',
    Arbitrum: 'https://arbiscan.io/tx/',
    Optimism: 'https://optimistic.etherscan.io/tx/',
    Ethereum: 'https://etherscan.io/tx/',
    Solana: 'https://solscan.io/tx/',
    Movement: 'https://explorer.movementnetwork.xyz/txn/',
    Arc: 'https://explorer.arc.io/tx/',
  }
  return at[chain] ? at[chain] + hash : null
}

/** A chip that opens a short list - the coin or the network, changed in place. */
function ChipMenu({ label, icon, options, onPick, disabled }: { label: string; icon: ReactNode; options: { id: string; title: string; sub?: string; icon: ReactNode }[]; onPick: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const many = options.length > 1
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || !many}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex items-center gap-2 rounded-full border border-line bg-card py-1 pl-1 pr-3 text-[13px] font-semibold text-fg transition', many && 'hover:border-[#D3D0C7]', disabled && 'opacity-60')}
        aria-haspopup={many ? 'listbox' : undefined}
        aria-expanded={many ? open : undefined}
      >
        {icon}
        {label}
        {many && <ChevronDown className={cx('size-3.5 text-dim transition', open && 'rotate-180')} />}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" aria-label="Close" onClick={() => setOpen(false)} />
          <div role="listbox" className="rise absolute left-0 top-full z-20 mt-1.5 w-60 overflow-hidden rounded-[12px] border border-line bg-card p-1 shadow-[0_18px_40px_-14px_rgba(18,18,16,0.3)]">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.title === label}
                onClick={() => {
                  setOpen(false)
                  onPick(o.id)
                }}
                className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left hover:bg-raise"
              >
                {o.icon}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-fg">{o.title}</span>
                  {o.sub && <span className="block text-[11.5px] text-dim">{o.sub}</span>}
                </span>
                {o.title === label && <Check className="size-4 text-fg" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
