/**
 * The business API, from the dashboard.
 *
 * Calls go to /api on the dashboard's own address - the host passes them to
 * the API - so the session cookie stays first-party and is never readable by
 * script here. Nothing here stores a token: the browser holds the cookie.
 *
 * The dashboard runs two ways:
 *  - live: the real API - everywhere by default, local `npm run dev` included
 *    (Vite passes /api to the business API on localhost:4100);
 *  - preview: sample data in this browser, for designing - a page opened with
 *    `?demo=`, or a build made with VITE_API_MODE=preview.
 */

/** Real API, unless this is a preview build or the page was opened with ?demo=. */
export const LIVE = import.meta.env.VITE_API_MODE !== 'preview' && !new URLSearchParams(window.location.search).has('demo')

/**
 * Google's client id for the sign-in button. Public by design - it ships in
 * every page that shows the button - so the project's own is the default;
 * VITE_GOOGLE_CLIENT_ID overrides it.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '29922474601-mb1uvqmh8an31h91vth68r30ivnk77f7.apps.googleusercontent.com'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, "Can't reach Money Moves right now. Check your connection and try again.", 'offline')
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!r.ok) throw new ApiError(r.status, data.error ?? 'Something went wrong. Try again in a moment.', data.code)
  return data as T
}

/* ─── What the API sends back ──────────────────────────────────────── */

export type SettleChain = 'MOVEMENT' | 'ARC' | 'MONAD' | 'SOLANA' | 'STELLAR'

/** Coins and the networks each is taken on, by name: { USDC: ['Base', 'Solana'] }. */
export type ApiAccept = Partial<Record<'USDC' | 'USDT', string[]>>

/** What the platform has switched on - what the screens show as available. */
export interface ApiPlatform {
  methods: { naira: boolean; app: boolean; crypto: boolean }
  settleChains: Record<SettleChain, boolean>
  coins: { USDC: boolean; USDT: boolean }
  networks: Record<string, boolean>
}

/** What a live checkout can take today; each needs switching on by us, and the app and crypto need their side ready. */
/** A way to pay, for this business: on once it has somewhere to settle, unless the business switched it off. */
export interface ApiMethodState {
  on: boolean
  off: boolean
  ready: boolean
  /** What to link first, while it has nowhere to settle. */
  why: string | null
}
/** The business's payment settings: its checkout methods, and where API payments settle. */
export interface ApiPaymentSettings {
  methods: Record<'NAIRA' | 'APP' | 'CRYPTO', ApiMethodState>
  api: { settleTo: ApiDestination | null; bankAccountId: string | null; now: ApiDestination; nowBankAccountId: string | null; justMe: boolean }
}

export interface ApiLiveMethods {
  naira: boolean
  app: boolean
  crypto: boolean
  /** Where live crypto can be paid from today. */
  cryptoNetworks: string[]
}

export interface ApiUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  phone: string | null
  twoStep: 'EMAIL' | 'APP'
  /** Recovery codes left, with the authenticator app on. */
  recoveryLeft?: number | null
  hasPassword: boolean
  google: boolean
  passwordChangedAt: string | null
  /** Their photo's address, or null for initials. */
  avatar?: string | null
}

export interface ApiBusiness {
  id: string
  name: string
  kind: 'REGISTERED' | 'INDIVIDUAL'
  merchantId: string
  status: 'UNVERIFIED' | 'IN_REVIEW' | 'VERIFIED' | 'SUSPENDED'
  settleChain: SettleChain
  role: string
  /** When our team approved it; null until then. */
  verifiedAt?: string | null
  /** Whether you've closed the "you're approved" notice. */
  liveNoticeClosed?: boolean
  /** Its logo's address, or null for initials. */
  logo?: string | null
  /** Who pays the processing fee. */
  feePayer?: "BUSINESS" | "CUSTOMER"
}

/** A business's look on its checkouts. */
export interface ApiBrand {
  logo: string | null
  surface: string
  accent: string
  success: string
}

export interface Me {
  user: ApiUser
  businesses: ApiBusiness[]
}

/** A sign-in that needs a code next: the challenge to send back with it. */
export interface Challenge {
  challenge: string
  step?: 'two_step' | 'verify_email'
  /** Where the code comes from: an email, or the person's authenticator app. */
  method?: 'email' | 'app'
}

/** Google's answer: signed in, or (with an authenticator app on) one more step. */
export const isChallenge = (r: unknown): r is Challenge => !!r && typeof r === 'object' && 'challenge' in r

/* ─── Money: payout places, links, payments, settlements ──────────── */

export type ApiMode = 'TEST' | 'LIVE'
export type ApiDestination = 'BANK' | 'MONEY_MOVES' | 'WALLET'
export type ApiMethod = 'APP' | 'CRYPTO' | 'NAIRA'

export interface ApiBank {
  code: string
  name: string
}

export interface ApiBankAccount {
  id: string
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  /** The bank's name for it matched the business (or the person) when it was added. */
  nameMatches: boolean
  /** Our team looked at it by hand and turned it down. */
  declined: boolean
  isDefault: boolean
  createdAt: string
}

export interface ApiLink {
  id: string
  mode: ApiMode
  slug: string
  name: string
  description: string | null
  currency: 'NGN' | 'USD'
  /** In the link's currency. Null: the customer types the amount. */
  amount: number | null
  min: number | null
  methods: ApiMethod[]
  /** Coins and networks for crypto; null is every one switched on. */
  accept?: ApiAccept | null
  destination: ApiDestination
  bankAccountId: string | null
  redirectUrl: string | null
  askPhone: boolean
  /** Ask a bank or crypto customer their name; their email is always asked. */
  askName?: boolean
  /** Who pays the fee here; null follows the business. In a public checkout, already resolved. */
  feePayer?: 'BUSINESS' | 'CUSTOMER' | null
  active: boolean
  createdAt: string
  paid: number
  collectedUsd: number
}

export interface ApiPayment {
  id: string
  ref: string
  mode: ApiMode
  status: 'pending' | 'successful' | 'underpaid' | 'expired'
  method: ApiMethod
  link: { id: string; name: string; slug: string } | null
  /** Or the invoice, or the outlet, it was paid through. */
  invoice: { id: string; number: string } | null
  outlet: { id: string; name: string } | null
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  ngnPerUsd: number
  receivedNgn: number | null
  feeNgn: number | null
  customer: { email: string | null; name: string | null; phone: string | null }
  payer: { name: string | null; bank: string | null; account: string | null; session: string | null } | null
  /** Crypto: the coin and the network it came on. */
  coin?: string | null
  network?: string | null
  createdAt: string
  paidAt: string | null
  settlement: ApiSettlementBrief | null
}

/** A refund, as the business sees it - in what the customer paid with: naira, or coins (a dollar each). */
export interface ApiRefund {
  id: string
  ref: string
  mode: ApiMode
  status: 'AWAITING_FUNDS' | 'SENDING' | 'REFUNDED' | 'CANCELLED'
  funding: 'WALLET' | 'APP' | 'BANK' | 'HELD'
  currency: 'NGN' | 'USD'
  amount: number
  feeBack: number
  /** What the business sends: naira by bank transfer, dollars from the app or its wallet. */
  fund: {
    amountNgn: number
    amountUsd: number
    account: { bank: string | null; number: string; name: string | null; expiresAt: string | null } | null
    /** From the app: the request the owner scans, or opens on the phone the app is on. */
    app?: { link: string; expiresAt: string | null } | null
    /** The transaction that funded it, from the app or the wallet. */
    tx?: string | null
  }
  to: { kind: 'BANK' | 'APP' | 'WALLET'; name: string | null; bank: string | null; account: string | null; coin: string | null; network: string | null }
  reason: string | null
  requestedAt: string
  fundedAt: string | null
  doneAt: string | null
  dueBy: string | null
  /** The test "pretend the money arrived" works for this one. */
  simulator: boolean
  payment: ApiPayment
}

export interface ApiSettlementBrief {
  id: string
  /** What the business is told: delivered, or on its way. Never "failed". */
  status: 'settled' | 'pending'
  destination: ApiDestination
  bankName: string | null
  accountNumber: string | null
  amountNgn: number | null
  settledAt: string | null
}

export interface ApiSettlement extends ApiSettlementBrief {
  ref: string
  paymentId: string
  paymentRef: string
  mode: ApiMode
  accountName: string | null
  feeNgn: number | null
  amountUsd: number
  createdAt: string
}

/** The customer's checkout: a link as anyone can see it. */
export interface PublicLink {
  link: {
    slug: string
    name: string
    description: string | null
    mode: ApiMode
    active: boolean
    /** An API checkout past the end it was given. */
    expired?: boolean
    expiresAt?: string | null
    /** Who it's for, when the business's server said: filled in for them. */
    customer?: { email: string | null; name: string | null } | null
    currency: 'NGN' | 'USD'
    amount: number | null
    min: number | null
    methods: ApiMethod[]
    /** What crypto it takes, with anything switched off already taken out. */
    accept?: ApiAccept
    redirectUrl: string | null
    askPhone: boolean
  /** Ask a bank or crypto customer their name; their email is always asked. */
  askName?: boolean
  /** Who pays the fee here; null follows the business. In a public checkout, already resolved. */
  feePayer?: 'BUSINESS' | 'CUSTOMER' | null
  }
  business: { name: string; verified: boolean; brand?: ApiBrand; feePayer?: "BUSINESS" | "CUSTOMER" }
  /** Naira per dollar, or null while the rate can't be read. */
  rate: number | null
  limits: { minNgn: number; maxNgn: number }
  simulator: boolean
  /** Our team has paused every checkout for maintenance. */
  maintenance?: boolean
  /** An invoice's checkout: who it's billed to, and what for. */
  invoice?: PublicInvoice
  /** An outlet's checkout. */
  outlet?: { name: string; location: string }
  /** An account already opened for this checkout, still open - the page picks up where the customer left off. */
  payment?: PublicPayment | null
}

export interface PublicInvoice {
  number: string
  customerName: string
  customerEmail: string
  items: { name: string; qty: number; price: number }[]
  dueAt: string
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID'
  paidAt: string | null
  paymentRef: string | null
}

export type InvoiceRepeat = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'

export interface ApiInvoice {
  id: string
  number: string
  /** The customer's link: /pay/i/<token>. */
  token: string
  mode: ApiMode
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
  methods: ApiMethod[]
  /** Coins and networks for crypto; null is every one switched on. */
  accept?: ApiAccept | null
  destination: ApiDestination
  bankAccountId: string | null
  createdAt: string
  /** Sent again on a schedule. */
  repeat?: { every: InvoiceRepeat; until: string | null; next: string | null } | null
  /** Sent from a series: the first invoice's id. */
  repeatOf?: string | null
  payment: { ref: string; method: ApiMethod; paidAt: string | null; receivedNgn: number | null; amountUsd: number } | null
}

export interface ApiOutlet {
  /** Ask a bank or crypto customer their name; their email is always asked. */
  askName?: boolean
  /** Who pays the fee here; null follows the business. */
  feePayer?: 'BUSINESS' | 'CUSTOMER' | null
  id: string
  mode: ApiMode
  slug: string
  name: string
  location: string
  currency: 'NGN' | 'USD'
  methods: ApiMethod[]
  /** Coins and networks for crypto; null is every one switched on. */
  accept?: ApiAccept | null
  destination: ApiDestination
  bankAccountId: string | null
  staffEmail: string | null
  active: boolean
  createdAt: string
  payments: number
  collectedNgn: number
  collectedUsd: number
}

export interface PublicPayment {
  token: string
  ref: string
  mode: ApiMode
  method: ApiMethod
  status: 'OPEN' | 'PAID' | 'UNDERPAID' | 'EXPIRED'
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  ngnPerUsd: number
  account: { bank: string; number: string; name: string } | null
  /** Live, by the app: the link that opens the payment in Money Moves (tapped, or as a QR). */
  app?: { link: string } | null
  /**
   * Crypto: the coin, the network, the address and the amount. Live, the address is the payment's own
   * (any amount there counts), or our treasury with a memo (Stellar, TON) or an exact amount.
   */
  deposit: {
    coin: string
    network: string
    address: string
    amount?: string | null
    memo?: string | null
    own?: boolean
    /** Part paid: what's arrived, and what's still to send. */
    received?: string | null
    left?: string | null
  } | null
  /** Live crypto that came in and goes back: over, short, late, another coin. */
  returns?: { token: string | null; amount: string; coin: string; status: string | null; why: string | null }[]
  /** Live crypto, while open: the transfer once it lands on chain, and its confirmations so far. */
  seen?: { tx: string; confirmations: number; needed: number } | null
  /** The processing fee added on top for the customer, when the business has them pay it. */
  customerFeeNgn?: number | null
  /** Paid by the app or crypto: the transaction on chain. */
  tx?: string | null
  expiresAt: string
  receivedNgn: number | null
  paidAt: string | null
  email: string | null
  /** The test checkout's "pretend it arrived" buttons work for this one. */
  simulator: boolean
}

/* ─── Going live: the application ─────────────────────────────────── */

export interface ApiApplication {
  application: {
    status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED'
    answers: Record<string, unknown>
    submittedAt: string | null
    reviewedAt: string | null
    /** What our team told the business: why it was turned down, or what to change. */
    decisionNote: string | null
  }
  documents: { id: string; kind: string; filename: string; mime: string; size: number; verdict: 'ACCEPTED' | 'REJECTED' | null; verdictNote: string | null; createdAt: string }[]
  /** The account representative's check, by Didit - its real decision, never a stand-in. */
  identity: {
    status: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'DECLINED'
    providerStatus: string
    firstName: string | null
    lastName: string | null
    dateOfBirth: string | null
    documentLast4: string | null
    startedBy: string | null
    checkedAt: string | null
  } | null
  /** Whether identity checks are switched on on this server at all. */
  identityReady: boolean
  gaps: { step: string; label: string }[]
}

export const applicationPath = (businessId: string) => `/businesses/${businessId}/application`

/** Something our review team asked for after (or alongside) the application. */
export interface ApiInfoRequest {
  id: string
  kind: 'TEXT' | 'FILE' | 'BVN'
  title: string
  detail: string | null
  status: 'OPEN' | 'ANSWERED' | 'ACCEPTED' | 'REJECTED'
  askedAt: string
  /** What was sent - a BVN only as its last four digits. */
  answer: { text: string | null; hint: string | null; file: { id: string; filename: string; mime: string; size: number } | null } | null
  answeredAt: string | null
  reviewedAt: string | null
  /** Why it was turned down, when it was. */
  reviewNote: string | null
}

export const requestsPath = (businessId: string) => `/businesses/${businessId}/requests`

/** A file to the API: the request body is the file itself, its name in a header. */
export async function uploadFile<T = unknown>(path: string, file: File): Promise<T> {
  let r: Response
  try {
    r = await fetch(`/api${path}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
      body: file,
    })
  } catch {
    throw new ApiError(0, "Can't reach Money Moves right now. Check your connection and try again.", 'offline')
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string }
  if (!r.ok) throw new ApiError(r.status, data.error ?? "That file didn't upload. Try again.", data.code)
  return data as T
}
