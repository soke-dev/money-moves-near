/**
 * Sample data for the front end. Every screen reads from here until the API
 * exists, so the shapes below are the ones the API should return.
 */
import type { SettleChain } from '@/lib/api'

export type Asset = 'USDC' | 'USDT' | 'cNGN' | 'MOVE' | 'SOL' | 'NGN'
export type Chain = 'Movement' | 'Solana' | 'Base' | 'BNB Chain' | 'Arc' | 'TON' | 'Stellar' | 'Monad' | 'Arbitrum' | 'Ethereum' | 'Optimism'
export type Destination = 'bank' | 'wallet' | 'onchain'

/** Which money a link, outlet or invoice leads with at checkout - the other is shown as the equivalent. */
export type Currency = 'NGN' | 'USD'
export type VerifyState = 'unverified' | 'review' | 'verified'

export const ASSET_ICON: Record<string, string> = {
  USDC: '/tokens/usdc.png',
  USDT: '/tokens/usdt.png',
  cNGN: '/tokens/cngn.png',
  MOVE: '/tokens/move-logo.png',
  SOL: '/tokens/solana.png',
}

export const CHAIN_ICON: Record<Chain, string> = {
  Movement: '/tokens/movement.jpg',
  Solana: '/tokens/solana.png',
  Base: '/tokens/base.png',
  'BNB Chain': '/tokens/bsc.png',
  Arc: '/tokens/arc.jpg',
  TON: '/tokens/toncoin.png',
  Stellar: '/tokens/stellar.jpg',
  Monad: '/tokens/monad.png',
  Arbitrum: '/tokens/arbitrum.png',
  Ethereum: '/tokens/ethereum.png',
  Optimism: '/tokens/optimism.svg',
}

/**
 * The three ways a customer can pay at checkout. A business switches each on
 * or off; whichever is used, the money settles to the business's chosen
 * destination.
 */
export type Method = 'app' | 'crypto' | 'naira'

export const METHODS: Record<Method, { label: string; short: string; sub: string }> = {
  app: {
    label: 'Pay with Money Moves',
    short: 'Money Moves app',
    sub: 'Opens the Money Moves app to confirm, or scan the code with it. One tap, no addresses.',
  },
  crypto: {
    label: 'Pay with crypto',
    short: 'Crypto deposit',
    sub: 'Send USDC or USDT from any wallet or exchange, on any supported network.',
  },
  naira: {
    label: 'Pay with naira',
    short: 'Naira transfer',
    sub: 'Transfer naira to a one-time account number. No crypto needed.',
  },
}

/** Which coin can be paid on which network - mirrors the app's own catalogue. */
export const ACCEPTED: { asset: Asset; chains: Chain[] }[] = [
  { asset: 'USDC', chains: ['Movement', 'Monad', 'Arc', 'Solana', 'Stellar', 'Base', 'BNB Chain', 'Arbitrum', 'Optimism', 'Ethereum'] },
  { asset: 'USDT', chains: ['Movement', 'Monad', 'Solana', 'Stellar', 'Base', 'BNB Chain', 'TON', 'Arbitrum', 'Optimism', 'Ethereum'] },
]

/**
 * Where store QR, payment links and invoices settle - one place at a time,
 * picked by a registered business. API payments settle to the
 * business wallet. We convert whatever the customer paid with into what the
 * business asked for, and never keep a balance for it.
 */
export const DESTINATIONS: Record<Destination, { label: string; short: string; sub: string }> = {
  bank: {
    label: 'Bank account',
    short: 'Bank',
    sub: 'Arrives as naira in seconds, crypto is converted at the live rate.',
  },
  wallet: {
    label: 'Money Moves account',
    short: 'Money Moves',
    sub: 'Lands in your Money Moves app, ready to spend, send or sell.',
  },
  onchain: {
    label: 'Business wallet',
    short: 'Business wallet',
    sub: 'Your self-custody business wallet. API payments land here by default.',
  },
}

export interface Business {
  id: string
  name: string
  merchantId: string
  email: string
  phone: string
  type: string
  verify: VerifyState
  onboarded: boolean
  destination: Destination
  /** Live: where crypto settles, as USDC (Movement, Arc or Monad). */
  settleChain?: SettleChain
  /** Live: your role in this business. */
  role?: string
  /** Live: deactivated by Money Moves - checkouts off, nothing can be changed, until it's reactivated. */
  suspended?: boolean
  /** Live: when our team approved it. */
  verifiedAt?: string | null
  /** Whether you've closed the "you're approved" notice - once closed, it never comes back. */
  liveNoticeClosed?: boolean
  /** Live: its logo's address. */
  logo?: string | null
  /** Live: who pays the processing fee, chosen for each way to pay. */
  feePayer?: "BUSINESS" | "CUSTOMER"
  feePayerCrypto?: "BUSINESS" | "CUSTOMER"
  /** Our team has switched on direct account checkouts for it. */
  directAllowed?: boolean
}

export const BUSINESSES: Business[] = [
  {
    id: 'b_movers',
    name: 'Movers Digital Technologies Ltd',
    merchantId: '100827465',
    email: 'owner@example.com',
    phone: '+234 800 000 0000',
    type: 'Limited liability company',
    verify: 'verified',
    onboarded: true,
    destination: 'bank',
  },
  {
    id: 'b_okotete',
    name: 'Sample Trading Limited',
    merchantId: '100913208',
    email: 'hello@example.com',
    phone: '+234 800 000 0000',
    type: 'Limited liability company',
    verify: 'review',
    onboarded: true,
    destination: 'wallet',
  },
  {
    id: 'b_sotechy',
    name: 'Sotechy Tech',
    merchantId: '101044571',
    email: 'owner@example.com',
    phone: '+234 800 000 0000',
    type: 'Sole proprietorship',
    verify: 'unverified',
    onboarded: false,
    destination: 'onchain',
  },
]

/* ─── Time helpers: every date is relative, so the sample never looks stale ─── */
const H = 3_600_000
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString()

const RATE = 1352.46

/* ─── Pricing ──────────────────────────────────────────────────────── */

/**
 * What a business pays, by how its customer paid. No setup or monthly fee,
 * settling is free, and a refund is free and gives the fee back.
 *
 * These are the defaults. The admin will be able to set any of them per
 * business; the fee helpers below are where a business's own rates go in.
 */
export const PRICING = {
  naira: { rate: 0.02, capNgn: 4_000 },
  crypto: { rate: 0.003, capUsd: 1 },
  /** Money Moves app payments are free for now. */
  app: { rate: 0 },
  /** A bank transfer out of the business wallet, in naira. */
  payoutNgn: 100,
} as const

const cents = (n: number) => Math.round(n * 100) / 100

/** The fee on a naira payment, in naira. */
export const nairaFee = (ngn: number) => Math.min(cents(ngn * PRICING.naira.rate), PRICING.naira.capNgn)

/** The fee on a payment, in dollars. A naira payment is charged in naira, shown here at the rate. */
export function feeUsd(method: Method, usd: number, ngn = usd * RATE): number {
  if (method === 'naira') return cents(nairaFee(ngn) / RATE)
  if (method === 'app') return cents(usd * PRICING.app.rate)
  return Math.min(cents(usd * PRICING.crypto.rate), PRICING.crypto.capUsd)
}

/* ─── Payments ─────────────────────────────────────────────────────── */

export type PayStatus = 'successful' | 'confirming' | 'pending' | 'failed' | 'underpaid'
export type Channel = 'Payment link' | 'Invoice' | 'Checkout' | 'In-store QR' | 'API'

export interface Payment {
  id: string
  ref: string
  customer: { name: string; email: string }
  /** How the customer paid. */
  method: Method
  asset: Asset
  /** Absent for a naira transfer, which moves on no network. */
  chain?: Chain
  amount: number
  usd: number
  fee: number
  status: PayStatus
  channel: Channel
  destination: Destination
  txHash: string
  from: string
  /** For a naira transfer: the account it came from, as the sending bank reports it. */
  payer?: { name: string; bank: string; account: string; session: string }
  /** What actually arrived, when it wasn't the full amount. */
  received?: number
  /** For crypto: the exchange the sending address belongs to, when we can tell. A refund can't go back there. */
  exchange?: string
  createdAt: string
  /** Live: the link it was paid through. */
  linkId?: string
  /** Live: the invoice or outlet it came through. */
  invoiceId?: string
  outletId?: string
  /** Live: when the transfer arrived. */
  paidAt?: string
  /** Live: where its money went, as the business is told - delivered, or on its way. */
  settlement?: { status: 'settled' | 'pending'; target: string; amountNgn: number | null; settledAt: string | null }
  /** Live: the figures a refund is worked out from - our fee and what arrived, in naira, at the payment's own rate. */
  live?: { feeNgn: number | null; receivedNgn: number | null; ngnPerUsd: number }
}

const PAYER_BANKS = ['GTBank', 'Opay', 'Kuda', 'Access Bank', 'Moniepoint', 'Zenith Bank']

const PEOPLE = [
  ['Ada Okafor', 'ada.okafor@example.com'],
  ['Tunde Bello', 'tunde.bello@example.com'],
  ['Ngozi Eze', 'ngozi.eze@example.com'],
  ['Kemi Adeyemi', 'kemi.adeyemi@example.com'],
  ['Chidi Nwosu', 'chidi.nwosu@example.com'],
  ['Ibrahim Sani', 'ibrahim.sani@example.com'],
  ['Femi Johnson', 'femi.johnson@example.com'],
  ['Efe Okoro', 'efe.okoro@example.com'],
  ['Segun Ade', 'segun.ade@example.com'],
  ['Yusuf Lawal', 'yusuf.lawal@example.com'],
  ['Grace Udo', 'grace.udo@example.com'],
  ['Amaka Obi', 'amaka.obi@example.com'],
] as const

const SAMPLE: [number, Asset, Chain, number, PayStatus, Channel, Destination][] = [
  [0.4, 'USDC', 'Movement', 120, 'confirming', 'Checkout', 'bank'],
  [1.2, 'USDT', 'TON', 45.5, 'successful', 'Payment link', 'bank'],
  [3, 'USDC', 'Solana', 250, 'successful', 'Invoice', 'bank'],
  [5, 'USDT', 'BNB Chain', 18, 'successful', 'In-store QR', 'bank'],
  [7, 'USDC', 'Base', 75, 'failed', 'Payment link', 'bank'],
  [12, 'USDC', 'Monad', 300, 'successful', 'API', 'onchain'],
  [12.5, 'USDT', 'Stellar', 14.8, 'successful', 'Checkout', 'bank'],
  [20, 'USDC', 'Base', 14.79, 'successful', 'Payment link', 'bank'],
  [26, 'USDC', 'Arc', 96.2, 'underpaid', 'Invoice', 'bank'],
  [30, 'USDT', 'Solana', 520, 'successful', 'API', 'onchain'],
  [44, 'USDC', 'Movement', 33, 'successful', 'In-store QR', 'bank'],
  [52, 'USDT', 'Movement', 61.4, 'successful', 'Checkout', 'bank'],
  [60, 'USDC', 'Solana', 12, 'pending', 'Payment link', 'bank'],
  [75, 'USDT', 'TON', 205, 'successful', 'Invoice', 'bank'],
  [80, 'USDC', 'Base', 48, 'successful', 'Checkout', 'onchain'],
  [96, 'USDC', 'Stellar', 150, 'successful', 'API', 'onchain'],
  // Added later, so it keeps its own reference: the transfer behind the sample bank claim.
  [50, 'USDC', 'Base', 62.85, 'successful', 'Payment link', 'bank'],
]

/** How each sample was paid, in order: mostly crypto, with app and naira mixed in. */
const PAID_BY: Method[] = ['crypto', 'app', 'crypto', 'crypto', 'naira', 'crypto', 'app', 'naira', 'naira', 'crypto', 'app', 'crypto', 'naira', 'crypto', 'app', 'crypto', 'naira']

/** Samples sent straight from an exchange rather than a wallet of the customer's own. */
const FROM_EXCHANGE: Record<number, string> = { 3: 'Binance', 13: 'Bybit' }

export const PAYMENTS: Payment[] = SAMPLE.map(([h, asset0, chain0, amt0, status, channel, destination], i) => {
  const [name, email] = PEOPLE[i % PEOPLE.length]!
  const method = PAID_BY[i] ?? 'crypto'
  const usd = asset0 === 'cNGN' ? amt0 / RATE : amt0
  // An app payment moves USDC on Movement; a naira one is naira, on no chain.
  const asset: Asset = method === 'naira' ? 'NGN' : method === 'app' ? 'USDC' : asset0
  const chain: Chain | undefined = method === 'naira' ? undefined : method === 'app' ? 'Movement' : chain0
  const amt = method === 'naira' ? Math.round(usd * RATE) : amt0
  return {
    id: `pay_${(9_812_400 + i * 137).toString(36)}`,
    ref: `MMB-${(48_211 + i * 7).toString()}`,
    customer: { name, email },
    method,
    asset,
    chain,
    amount: amt,
    usd: Math.round(usd * 100) / 100,
    fee: feeUsd(method, usd, method === 'naira' ? amt : undefined),
    status,
    channel,
    destination,
    txHash: `0x${(0x9f3ab21c + i * 0x1d3f).toString(16)}${'e7c4a19b82d06f5a3c'.slice(i % 6)}${i}`,
    from: `0x${(0x4b17c9 + i * 0x2af).toString(16)}…${(0xa3f0 + i * 31).toString(16)}`,
    payer:
      method === 'naira'
        ? {
            name: name.toUpperCase(),
            bank: PAYER_BANKS[i % PAYER_BANKS.length]!,
            account: String(2_000_000_000 + ((i * 7_919_311) % 7_000_000_000)).slice(0, 10),
            // A NIP session ID: 30 digits, the reference both banks can trace.
            session: `1000042610${String(48_211 + i * 7).padStart(8, '0')}${String(123_456 + i * 98_765).padStart(12, '0')}`.slice(0, 30),
          }
        : undefined,
    received: status === 'underpaid' ? Math.round(amt * 0.92 * 100) / 100 : undefined,
    exchange: method === 'crypto' ? FROM_EXCHANGE[i] : undefined,
    createdAt: at(h),
  }
}).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

export const NGN_RATE = RATE

/* ─── Customers ────────────────────────────────────────────────────── */

export interface Customer {
  id: string
  name: string
  email: string
  phone?: string
  payments: number
  spentUsd: number
  createdAt: string
  blocked?: boolean
}

export const CUSTOMERS: Customer[] = PEOPLE.map(([name, email], i) => ({
  id: `cus_${(5_120 + i * 41).toString(36)}`,
  name,
  email,
  phone: i % 3 === 0 ? `+234 80${(31_456_782 + i * 9_173).toString().slice(0, 8)}` : undefined,
  payments: 1 + ((i * 7) % 9),
  spentUsd: Math.round((40 + ((i * 173) % 900)) * 100) / 100,
  createdAt: at(30 + i * 22),
  blocked: i === 10,
}))

/* ─── Refunds and disputes ─────────────────────────────────────────── */

/* ─── Balances, settlements, history ───────────────────────────────── */

export const BALANCES = {
  wallet: { usd: 1_284.4, note: '@movers on the Money Moves app' },
  onchain: {
    usd: 3_912.18,
    holdings: [
      { asset: 'USDC' as Asset, chain: 'Monad' as Chain, amount: 1_820.5 },
      { asset: 'USDT' as Asset, chain: 'Solana' as Chain, amount: 1_640.0 },
      { asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 451.68 },
    ],
    address: '0x5E21c09aB7F4d3E8a6C1b2D9f04A7e3B8c6D2F19',
  },
  bank: { ngn: 993_145.7, pendingNgn: 158_710, storeTodayNgn: 71_320, account: 'Nombank MFB · 2651124878' },
}

export interface Settlement {
  id: string
  amountUsd: number
  ngn?: number
  destination: Destination
  target: string
  status: 'settled' | 'pending' | 'failed'
  createdAt: string
  payments: number
  /** Live: the real record behind it - one payment, its reference, and when it landed. */
  live?: { ref: string; paymentId: string; paymentRef: string; feeNgn: number | null; settledAt: string | null; accountName: string | null }
}

export const SETTLEMENTS: Settlement[] = [
  { id: 'st_1', amountUsd: 43.4, ngn: 58_710, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'pending', createdAt: at(0.02), payments: 1 },
  { id: 'st_2', amountUsd: 2.17, ngn: 2_935.5, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'settled', createdAt: at(26), payments: 1 },
  { id: 'st_3', amountUsd: 300, destination: 'onchain', target: '0x5E21…2F19 · Monad', status: 'settled', createdAt: at(30), payments: 1 },
  { id: 'st_4', amountUsd: 28.14, ngn: 38_063.65, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'settled', createdAt: at(50), payments: 4 },
  { id: 'st_5', amountUsd: 18, destination: 'wallet', target: '@movers', status: 'settled', createdAt: at(52), payments: 1 },
  { id: 'st_6', amountUsd: 20.61, ngn: 27_876.5, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'settled', createdAt: at(54), payments: 2 },
  { id: 'st_7', amountUsd: 520, destination: 'onchain', target: '0x5E21…2F19 · Solana', status: 'settled', createdAt: at(80), payments: 1 },
  { id: 'st_8', amountUsd: 41.6, ngn: 56_263.75, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'settled', createdAt: at(120), payments: 5 },
  { id: 'st_9', amountUsd: 14.83, ngn: 20_059.25, destination: 'bank', target: 'Nombank MFB · 2651124878', status: 'failed', createdAt: at(144), payments: 1 },
  { id: 'st_10', amountUsd: 33, destination: 'wallet', target: '@movers', status: 'settled', createdAt: at(170), payments: 1 },
]

/** The business wallet's own movements: settlements in, sends and withdrawals out. */
export const WALLET_ACTIVITY = [
  { id: 'wa_1', kind: 'in', label: 'Settlement · 1 payment', asset: 'USDC' as Asset, chain: 'Monad' as Chain, amount: 300, status: 'completed', createdAt: at(30) },
  { id: 'wa_2', kind: 'out', label: 'Bank transfer to Nombank MFB ••4878', asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 300, status: 'processing', createdAt: at(3) },
  { id: 'wa_3', kind: 'out', label: 'Sent to 0x3f9a…c21b', asset: 'USDT' as Asset, chain: 'Solana' as Chain, amount: 120, status: 'completed', createdAt: at(41) },
  { id: 'wa_4', kind: 'in', label: 'Settlement · 1 payment', asset: 'USDT' as Asset, chain: 'Solana' as Chain, amount: 520, status: 'completed', createdAt: at(80) },
  { id: 'wa_5', kind: 'out', label: 'Sent to @movers', asset: 'USDC' as Asset, chain: 'Movement' as Chain, amount: 40, status: 'completed', createdAt: at(96) },
]

/**
 * The test wallet: sample money in a sandbox wallet, shown in test mode and
 * before approval - so the page can be seen, and tried, before the real
 * wallet exists.
 */
export const TEST_WALLET = {
  usd: 445.5,
  address: '0x7E57000000000000000000000000000000000000',
  holdings: [
    { asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 250 },
    { asset: 'USDT' as Asset, chain: 'Solana' as Chain, amount: 120.5 },
    { asset: 'USDC' as Asset, chain: 'Monad' as Chain, amount: 75 },
  ],
  receive: [
    { label: 'Base, BNB Chain, Arc and Monad', address: '0x7E57000000000000000000000000000000000000' },
    { label: 'Solana', address: 'TestSo1anaWa11et1111111111111111111111111' },
    { label: 'TON', address: 'UQTest_TonWallet0000000000000000000000000000' },
    { label: 'Stellar', address: 'GTESTSTELLARWALLET000000000000000000000000000000000000' },
    { label: 'Movement', address: '0x7e57000000000000000000000000000000000000000000000000000000000001' },
  ],
  activity: [
    { id: 'tw_1', kind: 'in', label: 'Test payment · MMB-T0042', asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 75, status: 'completed', createdAt: at(1.5) },
    { id: 'tw_2', kind: 'out', label: 'Bank transfer to Test Bank ••0001', asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 50, status: 'processing', createdAt: at(3) },
    { id: 'tw_3', kind: 'in', label: 'Test payment · MMB-T0039', asset: 'USDT' as Asset, chain: 'Solana' as Chain, amount: 120.5, status: 'completed', createdAt: at(26) },
    { id: 'tw_4', kind: 'out', label: 'Refund to a customer · MMB-T0031', asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 20, status: 'completed', createdAt: at(30) },
    { id: 'tw_5', kind: 'in', label: 'Test payment · MMB-T0030', asset: 'USDC' as Asset, chain: 'Monad' as Chain, amount: 75, status: 'completed', createdAt: at(52) },
    { id: 'tw_6', kind: 'in', label: 'Test payment · MMB-T0027', asset: 'USDC' as Asset, chain: 'Base' as Chain, amount: 245, status: 'completed', createdAt: at(75) },
  ],
}

/* ─── Collect ──────────────────────────────────────────────────────── */

export const PAYMENT_LINKS = [
  { id: 'lnk_1', name: 'Coding bootcamp deposit', slug: 'bootcamp-deposit', currency: 'USD' as Currency, destination: 'bank' as Destination, amountUsd: 150, fixed: true, paid: 14, collectedUsd: 2_100, active: true, createdAt: at(300) },
  { id: 'lnk_2', name: 'Store tips', slug: 'tips', currency: 'NGN' as Currency, destination: 'wallet' as Destination, accept: { USDC: ['Solana', 'Base'] } as Partial<Record<Asset, Chain[]>>, amountUsd: 0, fixed: false, paid: 38, collectedUsd: 412.6, active: true, createdAt: at(600) },
  { id: 'lnk_3', name: 'Consulting, 1 hour', slug: 'consult-1h', currency: 'USD' as Currency, destination: 'onchain' as Destination, methods: ['app', 'naira'] as Method[], amountUsd: 80, fixed: true, paid: 6, collectedUsd: 480, active: true, createdAt: at(900) },
  { id: 'lnk_4', name: 'Event ticket, Lagos meetup', slug: 'lagos-meetup', currency: 'NGN' as Currency, amountNgn: 13_500, destination: 'bank' as Destination, amountUsd: 9.98, fixed: true, paid: 122, collectedUsd: 1_220, active: false, createdAt: at(1600) },
]

export type InvoiceStatus = 'draft' | 'unpaid' | 'paid'

export interface InvoiceItem {
  name: string
  qty: number
  /** In the invoice's own currency. */
  price: number
}

export interface Invoice {
  id: string
  number: string
  /** Live: the customer's link is /pay/i/<token>, not the number. */
  token?: string
  customer: string
  email: string
  /** What the customer is billed in; the checkout shows the other as "≈". */
  currency: Currency
  items: InvoiceItem[]
  note?: string
  amountUsd: number
  /** The exact naira total, for an invoice billed in naira. */
  amountNgn?: number
  status: InvoiceStatus
  destination: Destination
  bankId?: string
  mmId?: string
  methods?: Method[]
  accept?: Partial<Record<Asset, Chain[]>>
  createdAt: string
  due: string
  sentAt?: string
  /** When the customer first opened it. */
  viewedAt?: string
  remindedAt?: string
  /** Live: sent again on a schedule, and when the next goes. */
  repeat?: { every: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; until: string | null; next: string | null }
  /** Live: sent from a series. */
  repeatOf?: string
  paid?: { at: string; method: Method; ref: string; asset?: Asset; chain?: Chain }
}

export const INVOICES: Invoice[] = [
  {
    id: 'inv_0', number: 'INV-0040', customer: 'Tobi Adewale', email: 'tobi@example.com', currency: 'NGN',
    items: [{ name: 'Logo design', qty: 1, price: 150_000 }, { name: 'Brand guide', qty: 1, price: 85_000 }],
    amountNgn: 235_000, amountUsd: Math.round((235_000 / RATE) * 100) / 100, status: 'paid', destination: 'bank',
    createdAt: at(220), sentAt: at(220), viewedAt: at(200), due: at(60), paid: { at: at(150), method: 'naira', ref: 'MMB-47302' },
  },
  {
    id: 'inv_5', number: 'INV-0041', customer: 'Kelechi Nwosu', email: 'kelechi@example.com', currency: 'USD',
    items: [{ name: 'Social media management, September', qty: 1, price: 300 }, { name: 'Ad spend top-up', qty: 1, price: 40 }],
    amountUsd: 340, status: 'unpaid', destination: 'wallet',
    createdAt: at(330), sentAt: at(330), viewedAt: at(300), due: at(30),
  },
  {
    id: 'inv_1', number: 'INV-0042', customer: 'Ada Okafor', email: 'ada.okafor@example.com', currency: 'USD',
    items: [{ name: 'Website maintenance, October', qty: 1, price: 200 }, { name: 'Hosting renewal', qty: 1, price: 50 }],
    amountUsd: 250, status: 'paid', destination: 'bank',
    createdAt: at(72), sentAt: at(72), viewedAt: at(50), due: at(-48), paid: { at: at(20), method: 'app', ref: 'MMB-48211' },
  },
  {
    id: 'inv_2', number: 'INV-0043', customer: 'Chidi Nwosu', email: 'chidi.nwosu@example.com', currency: 'USD',
    items: [{ name: 'Product photography, half day', qty: 1, price: 80 }, { name: 'Retouched photos', qty: 12, price: 1.35 }],
    note: 'Thanks for the shoot. The full gallery is in your inbox.',
    amountUsd: 96.2, status: 'unpaid', destination: 'onchain',
    createdAt: at(26), sentAt: at(26), due: at(-120),
  },
  {
    id: 'inv_3', number: 'INV-0044', customer: 'Ibrahim Sani', email: 'ibrahim.sani@example.com', currency: 'USD',
    items: [{ name: 'Consulting, per hour', qty: 2, price: 90 }, { name: 'Travel', qty: 1, price: 25 }],
    amountUsd: 205, status: 'paid', destination: 'bank',
    createdAt: at(75), sentAt: at(75), viewedAt: at(40), due: at(-24), paid: { at: at(30), method: 'crypto', ref: 'MMB-46518', asset: 'USDT', chain: 'TON' },
  },
  {
    id: 'inv_4', number: 'INV-0045', customer: 'Femi Johnson', email: 'femi.johnson@example.com', currency: 'USD',
    items: [{ name: 'Mobile app design, phase 1', qty: 1, price: 1_200 }],
    amountUsd: 1_200, status: 'draft', destination: 'wallet',
    createdAt: at(4), due: at(-240),
  },
]

export const OUTLETS = [
  { id: 'out_1', currency: 'NGN' as Currency, slug: 'warri-effurun', name: 'Warri, Effurun store', location: 'Effurun, Delta', destination: 'bank' as Destination, payments: 64, collectedUsd: 1_842.3, active: true },
  { id: 'out_2', currency: 'NGN' as Currency, slug: 'lekki-popup', name: 'Lekki pop-up', location: 'Lekki Phase 1, Lagos', destination: 'wallet' as Destination, methods: ['app', 'crypto'] as Method[], accept: { USDT: ['TON', 'Solana'], USDC: ['Solana'] } as Partial<Record<Asset, Chain[]>>, payments: 18, collectedUsd: 512, active: true },
  { id: 'out_3', currency: 'USD' as Currency, slug: 'events-counter', name: 'Events counter', location: 'Mobile', destination: 'onchain' as Destination, payments: 0, collectedUsd: 0, active: false },
]

/* ─── Payouts and conversions ──────────────────────────────────────── */

/** Payouts go to the business's own accounts only, for now. */
/* ─── Settings ─────────────────────────────────────────────────────── */

export const TEAM = [
  { id: 'tm_1', name: 'Okotete Chris', email: 'owner@example.com', role: 'Owner', status: 'active', addedAt: '2026-08-13T07:19:00Z' },
  { id: 'tm_2', name: 'Ngozi Eze', email: 'ngozi.eze@example.com', role: 'Operations', status: 'active', addedAt: '2026-09-02T10:02:00Z' },
  { id: 'tm_3', name: 'Damian Victor', email: 'damian@moverstech.xyz', role: 'Developer', status: 'pending', addedAt: '2026-10-05T15:40:00Z' },
]

export const INDUSTRIES = [
  'E-commerce and retail',
  'Education',
  'Events and ticketing',
  'Food and hospitality',
  'Freelance and creative services',
  'Gaming',
  'Logistics',
  'Professional services',
  'Software and SaaS',
  'Travel',
  'Other',
]

export const NG_STATES = [
  'Abia', 'Abuja (FCT)', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 'Kaduna',
  'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo',
  'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
]
