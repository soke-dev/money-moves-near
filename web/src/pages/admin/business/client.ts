/**
 * The admin console's line to the business API, and the shapes it sends back.
 *
 * Calls go to /business-api/admin on this site, which Netlify passes to the
 * business API (public/_redirects). The admin's token travels with them; the
 * business API asks the app's backend whether it's a live admin session, so
 * there is one sign-in for both sides. The actions that cost the most if
 * abused take the action password too, checked by the business API.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const BASE = import.meta.env.VITE_BUSINESS_API_URL || '/business-api'

export class BizError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

const token = () => localStorage.getItem('mm_admin_token')

export async function biz<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    const t = token()
    res = await fetch(`${BASE}/admin${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new BizError("Can't reach the business API. Check the connection and try again.", 'offline')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new BizError(data.error || `That didn't work (${res.status}).`, data.code)
  return data as T
}

/** A stored document, decrypted by the API, as a local address this page can show. Revoke it when done. */
export async function bizFile(path: string): Promise<{ url: string; type: string }> {
  let res: Response
  try {
    const t = token()
    res = await fetch(`${BASE}/admin${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
  } catch {
    throw new BizError("Can't reach the business API. Check the connection and try again.", 'offline')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new BizError(data.error || `That didn't open (${res.status}).`, data.code)
  }
  const blob = await res.blob()
  return { url: URL.createObjectURL(blob), type: blob.type }
}

/** A last word as the page goes away - sent even while the tab closes. */
export function bizBeacon(path: string, body?: unknown) {
  const t = token()
  void fetch(`${BASE}/admin${path}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {})
}

/** A file sent to the API: the body is the file, its name (and any note) in headers. */
export async function bizUpload<T>(path: string, file: File, note?: string): Promise<T> {
  let res: Response
  try {
    const t = token()
    res = await fetch(`${BASE}/admin${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name), ...(note ? { 'X-Text': encodeURIComponent(note) } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: file,
    })
  } catch {
    throw new BizError("Can't reach the business API. Check the connection and try again.", 'offline')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new BizError(data.error || `That didn't send (${res.status}).`, data.code)
  return data as T
}

/**
 * Listens to one of the API's live streams (server-sent events, read with
 * fetch so the admin token goes with it). Reconnects after a drop, a little
 * slower each time; stops when the session has ended. Returns the way to stop.
 */
export function bizListen(path: string, onEvent: (e: { type: string; [k: string]: unknown }) => void, onUp?: (up: boolean) => void) {
  let stopped = false
  let ctrl: AbortController | null = null
  let wait = 1000
  void (async () => {
    while (!stopped) {
      ctrl = new AbortController()
      try {
        const t = token()
        const r = await fetch(`${BASE}/admin${path}`, { signal: ctrl.signal, headers: { Accept: 'text/event-stream', ...(t ? { Authorization: `Bearer ${t}` } : {}) } })
        if (r.status === 401 || r.status === 403) return
        if (!r.ok || !r.body) throw new Error(String(r.status))
        onUp?.(true)
        wait = 1000
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let cut: number
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const data = buf
              .slice(0, cut)
              .split('\n')
              .filter((l) => l.startsWith('data: '))
              .map((l) => l.slice(6))
              .join('\n')
            buf = buf.slice(cut + 2)
            if (!data) continue
            try {
              onEvent(JSON.parse(data))
            } catch {
              /* not ours */
            }
          }
        }
      } catch {
        if (stopped) return
      }
      onUp?.(false)
      if (stopped) return
      await new Promise((r) => setTimeout(r, wait))
      wait = Math.min(wait * 2, 15_000)
    }
  })()
  return () => {
    stopped = true
    ctrl?.abort()
  }
}

/** A help-chat message, as the console sees it - who on the team sent it included. */
export type ChatMessage = {
  id: string
  threadId: string
  from: 'USER' | 'TEAM'
  author: string
  text: string | null
  file: { name: string; mime: string | null; size: number | null } | null
  at: string
  /** When the team corrected it - the business never sees that it changed. */
  editedAt?: string | null
}

/** A help-chat conversation, as the inbox lists it. */
export type ChatThread = {
  id: string
  status: 'OPEN' | 'CLOSED'
  person: { email: string; name: string | null }
  business: { id: string; name: string; merchantId: string; status: string } | null
  lastAt: string
  last: ChatMessage | null
  unread: number
  userReadAt: string | null
  closedAt: string | null
  closedBy: string | null
}

/**
 * Something changed. Every list and page on screen reads itself again,
 * quietly - so a business deactivated on its own page is already right in the list
 * when you go back to it.
 */
const listeners = new Set<() => Promise<void>>()
/** Resolves once every page on screen has read itself again - the Refresh button waits on it. */
export const bizChanged = () => Promise.allSettled([...listeners].map((read) => read())).then(() => undefined)

/**
 * What each address last said. Going back to a page shows it at once, then
 * reads it again behind the scenes - and the page is tall enough straight away
 * for the scroll position to come back with it.
 */
const seen = new Map<string, unknown>()

/**
 * `every` says how soon to read it again, given what came back - for a page
 * whose money is still moving, so it shows the payout landing without a
 * refresh. Null stops.
 */
export function useLoad<T>(path: string | null, opts?: { every?: (data: T) => number | null }) {
  const everyRef = useRef(opts?.every)
  everyRef.current = opts?.every
  const [data, setData] = useState<T | null>(() => (path != null ? ((seen.get(path) as T | undefined) ?? null) : null))
  const [error, setError] = useState<BizError | null>(null)
  const [loading, setLoading] = useState(path != null && !seen.has(path))
  // Only the latest answer counts: typing in a search box sends several.
  const latest = useRef(0)
  const reload = useCallback(
    async (quiet = false) => {
      if (path == null) return
      const n = ++latest.current
      if (!quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        const next = await biz<T>(path)
        seen.set(path, next)
        if (n === latest.current) {
          setData(next)
          setError(null)
        }
      } catch (e) {
        if (n === latest.current && !quiet) setError(e instanceof BizError ? e : new BizError(String(e)))
      } finally {
        if (n === latest.current) setLoading(false)
      }
    },
    [path],
  )
  useEffect(() => {
    if (path == null) return
    const known = seen.get(path) as T | undefined
    if (known !== undefined) setData(known)
    void reload(known !== undefined)
  }, [path, reload])
  useEffect(() => {
    const on = () => reload(true)
    listeners.add(on)
    return () => {
      listeners.delete(on)
    }
  }, [reload])
  // Each answer schedules the next read, for as long as `every` asks for one.
  useEffect(() => {
    const ms = data != null ? everyRef.current?.(data) : null
    if (!ms) return
    const t = setTimeout(() => void reload(true), ms)
    return () => clearTimeout(t)
  }, [data, reload])
  return { data, error, loading, reload }
}

/* ─── Shapes ───────────────────────────────────────────────────────── */

export type Mode = 'TEST' | 'LIVE'
export type BizStatus = 'UNVERIFIED' | 'IN_REVIEW' | 'VERIFIED' | 'SUSPENDED'
export type BizKind = 'REGISTERED' | 'INDIVIDUAL'
export type Destination = 'BANK' | 'MONEY_MOVES' | 'WALLET'

export type Totals = { payments: number; volumeNgn: number; lastPaidAt: string | null }

export type BusinessRow = {
  id: string
  name: string
  kind: BizKind
  merchantId: string
  status: BizStatus
  country: string
  statusReason: string | null
  statusChangedAt: string | null
  createdAt: string
  owner: { email: string; name: string | null } | null
  members: number
  links: number
  banks: { total: number; checked: number; waiting: number }
  live: Totals
  test: Totals
}

export type Bank = {
  id: string
  bankName: string
  bankCode?: string
  accountNumber: string
  accountName: string
  nameMatches: boolean
  isDefault: boolean
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  removedAt: string | null
}

export type SettleEvent = { id: string; kind: string; detail: Record<string, unknown> | null; by: string; at: string }

export type Settle = {
  id: string
  ref: string
  mode: Mode
  status: 'QUEUED' | 'SENDING' | 'SENT' | 'SETTLED' | 'FAILED' | 'HELD' | 'REVIEW'
  stuck: boolean
  /** Queued on a chain switched off on Services (the detail page only). */
  paused?: boolean
  /** A USDC payout: the chain it goes on. */
  chain?: string | null
  destination: Destination
  amountNgn: number
  feeNgn: number
  bankAccountId: string | null
  bankName: string | null
  accountNumber: string | null
  accountName: string | null
  /** Who it went to: the bank account name, @username for Money Moves, or the business for its wallet. */
  toName?: string | null
  failureReason: string | null
  sentAt: string | null
  settledAt: string | null
  createdAt: string
  updatedAt?: string
  business?: { id: string; name: string }
  payment?: { id: string; ref: string }
  events?: SettleEvent[]
}

export type Pay = {
  id: string
  ref: string
  mode: Mode
  status: 'OPEN' | 'PAID' | 'UNDERPAID' | 'EXPIRED'
  method?: 'NAIRA' | 'APP' | 'CRYPTO'
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  ngnPerUsd: number
  receivedNgn: number | null
  feeNgn: number | null
  customer: { email: string | null; name: string | null; phone: string | null }
  payer: { name: string | null; bank: string | null; account: string | null; session: string | null } | null
  account: { bank: string | null; number: string; name: string | null } | null
  /** A test crypto payment: the coin, the network and the address it was shown. */
  deposit?: { coin: string | null; network: string | null; address: string } | null
  expiresAt: string
  paidAt: string | null
  createdAt: string
  business?: { id: string; name: string }
  /** The checkout it came through: a payment link, an invoice or an outlet. */
  link: { name: string; slug: string } | null
  invoice: { id: string; number: string } | null
  outlet: { id: string; name: string; slug: string } | null
  settlement: { id: string; ref: string; status: Settle['status']; stuck: boolean } | null
}

/** Which checkout a payment came through, in a few words. */
export const sourceOf = (p: Pick<Pay, 'link' | 'invoice' | 'outlet'>) =>
  p.link ? p.link.name : p.invoice ? `Invoice ${p.invoice.number}` : p.outlet ? p.outlet.name : null

export type PayDetail = { payment: Pay & { providerRef: string | null; lastCheckedAt: string | null; updatedAt: string }; settlement: Settle | null }

export type Paged = { pagination: { page: number; pages: number; total: number } }

export type MoneySummary = {
  paid: { count: number; volumeNgn: number; feesNgn: number; lastPaidAt: string | null }
  short: { count: number; volumeNgn: number }
  open: number
  expired: number
  settled: { count: number; amountNgn: number }
  moving: { count: number; amountNgn: number }
  review: { count: number; amountNgn: number }
  held: { count: number; amountNgn: number }
  failed: { count: number; amountNgn: number }
  stuck: number
  daily: { day: string; count: number; volumeNgn: number }[]
}

export type AppStatus = 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
export type IdStatus = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'DECLINED'

export type Activity = { id: string; action: string; detail: Record<string, unknown> | null; at: string; by: string; ip?: string | null }

export type LinkRow = {
  id: string
  slug: string
  name: string
  description: string | null
  mode: Mode
  active: boolean
  deleted: boolean
  currency: 'NGN' | 'USD'
  amount: number | null
  min: number | null
  methods: string[]
  destination: Destination
  askPhone: boolean
  createdAt: string
  updatedAt: string
  paid: { count: number; volumeNgn: number; lastPaidAt: string | null }
}

export type InvoiceRow = {
  id: string
  number: string
  token: string
  mode: Mode
  customerName: string
  customerEmail: string
  currency: 'NGN' | 'USD'
  items: { name: string; qty: number; price: number }[]
  note: string | null
  amount: number
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID'
  dueAt: string
  sentAt: string | null
  viewedAt: string | null
  remindedAt: string | null
  paidAt: string | null
  voidedAt: string | null
  methods: string[]
  destination: Destination
  bankAccountId: string | null
  createdAt: string
  payment: { ref: string; method: string; paidAt: string | null; receivedNgn: number | null; amountUsd: number } | null
}

export type OutletRow = {
  id: string
  mode: Mode
  slug: string
  name: string
  location: string
  currency: 'NGN' | 'USD'
  methods: string[]
  destination: Destination
  bankAccountId: string | null
  staffEmail: string | null
  active: boolean
  deleted: boolean
  createdAt: string
  payments: number
  collectedNgn: number
  collectedUsd: number
}

export type Member = {
  id: string
  role: string
  email: string
  name: string | null
  addedAt: string
  emailVerified: boolean
  signsInWith: string[]
  twoStep: string
  lastActiveAt: string | null
}

/** Name, phone and support contacts a business asked to change - nothing changes until approved. */
export type DetailFields = { name?: string; phone?: string; supportEmail?: string; supportPhone?: string }
export type DetailChangeView = {
  id: string
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED'
  changes: DetailFields
  before: DetailFields
  current: Required<DetailFields>
  createdAt: string
}

/** The ways to pay, as limits name them. */
export type Way = 'naira' | 'crypto' | 'app'
export type NgnRange = { minNgn: number; maxNgn: number }

export type BusinessDetail = {
  detailChange: DetailChangeView | null
  business: BusinessRow & {
    settleChain: string
    adminNote: string | null
    risk?: { ownLimitNgn: number | null; limitNgn: number; takenTodayNgn: number }
    /** Where its live money goes: its default now, and how many live checkouts pick each place. */
    settlement?: {
      justMe: boolean
      apiChoice: Destination | null
      now: Destination
      bank: { bankName: string; last4: string; accountName: string } | null
      moneyMoves: { username: string } | null
      walletMade: boolean
      checkouts: Partial<Record<Destination, number>>
    }
    /** One live checkout's least and most per way to pay, and the payout sizes that wait for a person: its own where set, the platform's, and what applies. */
    limits?: {
      own: { checkout: Partial<Record<Way, { minNgn?: number | null; maxNgn?: number | null }>>; reviewNairaAboveNgn: number | null; reviewCryptoAboveUsd: number | null }
      defaults: { checkout: Record<Way, NgnRange>; review: { nairaAboveNgn: number; cryptoAboveUsd: number } }
      checkout: Record<Way, NgnRange>
      review: { nairaAboveNgn: number; cryptoAboveUsd: number }
    }
    referral?: { code: string | null; referredBy: { id: string; name: string } | null; referred: number }
    updatedAt: string
    statusChangedBy: string | null
    nameOnRecord: string | null
    fee: {
      rateBps: number | null
      capNgn: number | null
      defaultRateBps: number
      defaultCapNgn: number
      cryptoRateBps: number | null
      cryptoCapUsd: number | null
      defaultCryptoRateBps: number
      defaultCryptoCapUsd: number
      /** Who pays our fee, as the business chose it, per way to pay. */
      payer?: { naira: 'BUSINESS' | 'CUSTOMER'; crypto: 'BUSINESS' | 'CUSTOMER' }
    }
  }
  money: { live: MoneySummary; test: MoneySummary }
  application: null | {
    status: AppStatus
    structure: string | null
    legalName: string | null
    submittedAt: string | null
    reviewedAt: string | null
    reviewedBy: string | null
    decisionNote: string | null
    documents: { required: number; uploaded: number; accepted: number; rejected: number }
    identity: null | { status: IdStatus; name: string | null; checkedAt: string | null }
  }
  members: Member[]
  bankAccounts: Bank[]
  links: LinkRow[]
  invoices: InvoiceRow[]
  outlets: OutletRow[]
  payments: Pay[]
  settlements: Settle[]
  activity: Activity[]
}

export type ApplicationRow = {
  businessId: string
  businessName: string
  kind: BizKind
  structure: string | null
  legalName: string | null
  status: AppStatus
  submittedAt: string | null
  updatedAt: string
  owner: string | null
  identity: IdStatus | null
  documents: number
  rejectedDocuments: number
}

export type Answers = {
  kind?: 'individual' | 'registered' | null
  structure?: 'BN' | 'LTD' | 'PLC' | 'IT' | null
  legalName?: string
  regDate?: string
  regNumber?: string
  tin?: string
  bizStreet?: string
  bizCity?: string
  bizState?: string
  category?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  social?: string
  repDirector?: boolean
  repOwner?: boolean
  repShare?: string
  people?: {
    id?: string
    first?: string
    last?: string
    email?: string
    phone?: string
    dob?: string
    idCountry?: string
    idType?: string
    street?: string
    city?: string
    state?: string
    country?: string
    postal?: string
    director?: boolean
    owner?: boolean
    share?: string
  }[]
  website?: string
  description?: string
  supportEmail?: string
  supportPhone?: string
  socials?: { instagram?: string; x?: string; tiktok?: string; facebook?: string }
  volume?: string
  /** A Money Moves account to be paid to as well - optional. */
  wallet?: { username?: string }
  attest?: boolean
}

/** Something our team asked a business for, and its answer - a BVN only as its last four digits. */
export type InfoRequestRow = {
  id: string
  kind: 'TEXT' | 'FILE' | 'BVN'
  title: string
  detail: string | null
  status: 'OPEN' | 'ANSWERED' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED'
  askedAt: string
  askedBy: string
  answer: { text: string | null; hint: string | null; file: { id: string; filename: string; mime: string; size: number } | null } | null
  answeredAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  reviewNote: string | null
}

export type DocRow = {
  id: string
  kind: string
  filename: string
  mime: string
  size: number
  verdict: 'ACCEPTED' | 'REJECTED' | null
  verdictNote: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  uploadedBy: string | null
  createdAt: string
  replacedAt: string | null
}

export type IdentityRow = {
  id: string
  status: IdStatus
  providerStatus: string
  firstName: string | null
  lastName: string | null
  dateOfBirth: string | null
  documentLast4: string | null
  warnings: unknown
  sessionId: string
  startedBy: string | null
  checkedAt: string | null
  createdAt: string
}

export type ApplicationDetail = {
  application: { status: AppStatus; answers: Answers; submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; decisionNote: string | null }
  business: { id: string; name: string; kind: BizKind; status: BizStatus; merchantId: string; owner: string | null }
  required: { kind: string; label: string }[]
  documents: DocRow[]
  identity: IdentityRow[]
  identityReady: boolean
  bankAccounts: Bank[]
  gaps: { step: string; label: string }[]
  history: Activity[]
}

export type Platform = {
  payouts: boolean
  newBusinesses: boolean
  maintenance: boolean
  methods: { naira: boolean; app: boolean; crypto: boolean }
  channels: { links: boolean; invoices: boolean; outlets: boolean; api: boolean }
  destinations: { bank: boolean; moneyMoves: boolean; wallet: boolean }
  settleChains: { MOVEMENT: boolean; ARC: boolean; MONAD: boolean; SOLANA: boolean; STELLAR: boolean }
  coins: { USDC: boolean; USDT: boolean }
  networks: Record<string, boolean>
  fees: { nairaRateBps: number; nairaCapNgn: number; cryptoRateBps: number; cryptoCapUsd: number; appRateBps: number; payoutNgn: number }
  /** The plain four are bank transfer; crypto* and app* are stablecoins and the Money Moves app. */
  limits: {
    businessMinNgn: number; businessMaxNgn: number; freelancerMinNgn: number; freelancerMaxNgn: number
    cryptoBusinessMinNgn: number; cryptoBusinessMaxNgn: number; cryptoFreelancerMinNgn: number; cryptoFreelancerMaxNgn: number
    appBusinessMinNgn: number; appBusinessMaxNgn: number; appFreelancerMinNgn: number; appFreelancerMaxNgn: number
  }
  review: { nairaAboveNgn: number; cryptoAboveUsd: number }
  risk: { newDays: number; newDailyNgn: number; dailyNgn: number; spikeTimes: number; spikeMinNgn: number }
}
/** What is actually live: null when it is, else why not. */
export type Live = {
  methods: Record<'naira' | 'app' | 'crypto', string | null>
  destinations: Record<'bank' | 'moneyMoves' | 'wallet', string | null>
  coins: Record<'USDC' | 'USDT', string | null>
  networks: Record<string, string | null>
  settleChains: Record<string, string | null>
}
export type PlatformData = { platform: Platform; defaults: Platform; networks: string[]; live?: Live; updatedBy: string | null; updatedAt: string | null }

/* ─── Words ────────────────────────────────────────────────────────── */

export const KIND: Record<BizKind, string> = { REGISTERED: 'Registered business', INDIVIDUAL: 'Just me' }
export const STRUCTURE: Record<string, string> = { BN: 'Business name', LTD: 'Private limited company', PLC: 'Public limited company', IT: 'Incorporated trustees' }
export const CHAIN: Record<string, string> = { MOVEMENT: 'Movement', ARC: 'Arc', MONAD: 'Monad', SOLANA: 'Solana', STELLAR: 'Stellar' }
export const METHOD: Record<string, string> = { NAIRA: 'Bank transfer', APP: 'Money Moves app', CRYPTO: 'Crypto' }
export const DESTINATION: Record<Destination, string> = { BANK: 'Bank account', MONEY_MOVES: 'Money Moves account', WALLET: 'Business wallet' }
export const ROLE: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', DEVELOPER: 'Developer', FINANCE: 'Finance', SUPPORT: 'Support', VIEWER: 'Viewer' }

/** Where a settlement went, in a few words. */
export function placeOf(s: Pick<Settle, 'destination' | 'bankName' | 'accountNumber' | 'mode'>) {
  if (s.destination === 'BANK') return `${s.bankName ?? 'Bank'} ••${(s.accountNumber ?? '').slice(-4)}`
  if (s.destination === 'WALLET') return s.mode === 'TEST' ? 'Test wallet' : 'Business wallet'
  return 'Money Moves'
}
