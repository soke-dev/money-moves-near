/**
 * Money out: where payments went, and the one wallet that is the business's
 * own.
 *
 * We never hold a business's money, so there is no "balance with us" to show.
 * Settlements is the record of every payment delivered to the destination the
 * business chose. The business wallet is the exception that proves it: an
 * embedded, self-custody wallet (Dynamic) the business owns - we can read its
 * balance on-chain, but only the business can move it.
 */
import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Download, Landmark, Loader2, Plus, RefreshCw, ShieldCheck } from '@/components/icons'
import { BALANCES, DESTINATIONS, METHODS, NGN_RATE, PAYMENTS, PRICING, TEST_WALLET, WALLET_ACTIVITY, type Asset, type Chain, type Destination, type Payment, type Settlement } from '@/data/mock'
import { usePayments, useSettlements } from '@/state/live'
import { Badge, Button, Checkbox, CopyField, DetailRow, Drawer, Field, Input, Modal, PageHeader, Segmented, Select, Status, StepBar, cx } from '@/components/ui'
import { LIVE } from '@/lib/api'
import { downloadCsv, today } from '@/lib/csv'
import Qr from '@/components/Qr'
import { ChainIcon, PayIcon, PlaceMark, TokenIcon } from '@/components/brand'
import { DayHead, Figure, FilterMenu, PillSwitch, RowCount, Rows, Skel, UnderlineTabs } from '@/components/table'
import { Timeline, type Step } from '@/components/Timeline'
import { dateTime, ngn, short, usd } from '@/lib/format'
import { useSession } from '@/state/session'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { TEST_PLACES as SANDBOX, bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, useTargets, type BankAccount, type MmAccount } from '@/state/targets'

/** Where a business's payments are going, in a few words. */
export function settleTarget(d: Destination) {
  return d === 'bank'
    ? BALANCES.bank.account
    : d === 'wallet'
      ? BALANCES.wallet.note.split(' ')[0]!
      : `${short(BALANCES.onchain.address, 6, 4)} · embedded`
}

/* ─── Business wallet ──────────────────────────────────────────────── */

const RECEIVE: { label: string; address: string }[] = [
  { label: 'Base, BNB Chain, Arc and Monad', address: BALANCES.onchain.address },
  { label: 'Solana', address: '9wFFyRfZBsuAha4YcuxcXLKwMxJR43S7fPfQLusDBzvT' },
  { label: 'TON', address: 'UQCx7uR3fWm9Lk2pYv0ZtN8sQhJdE4bGc1aXo6iKr5Tn2PwM' },
  { label: 'Stellar', address: 'GCKF7XQ3ZM5PNWUAHTR6YVD4SEBGC7OLIPF3JKQXA2WZ9RTNHE2A' },
  { label: 'Movement', address: '0x5e21c09ab7f4d3e8a6c1b2d9f04a7e3b8c6d2f19a4e70b3c1d9f8e2a6b5c4d3e' },
]

export type Holding = { asset: Asset; chain: Chain; amount: number }
export type Movement = (typeof WALLET_ACTIVITY)[number] & {
  /** Live: what it was, line by line, for its drawer. */
  details?: { k: string; v: string; mono?: boolean }[]
  /** Live: the transaction on chain, and where to see it. */
  tx?: { hash: string; url: string | null } | null
}

/** The wallet to show: the real one once approved and live, the test wallet otherwise. */
function useWallet() {
  const { business } = useSession()
  const { test } = useTestMode()
  if (test || business?.verify !== 'verified') return { test: true, ...TEST_WALLET }
  return { test: false, usd: BALANCES.onchain.usd, address: BALANCES.onchain.address, holdings: BALANCES.onchain.holdings, receive: RECEIVE, activity: WALLET_ACTIVITY }
}

/** The live wallet, with its sign-in code: its own file, fetched while the dashboard is idle so the page opens without waiting for it. */
const loadLiveWallet = () => import('./wallet-live')
const LiveWallet = lazy(loadLiveWallet)
if (LIVE && typeof window !== 'undefined') {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 2500))
  idle(() => void loadLiveWallet().catch(() => {}))
}

export function BusinessWallet() {
  const { mode } = useSession()
  if (!LIVE) return <SampleWallet />
  // Test mode: a working wallet, simulated. Live: the owner's own.
  if (mode === 'test') return <TestWallet />
  return (
    <Suspense fallback={<WalletLoading />}>
      <LiveWallet />
    </Suspense>
  )
}

function WalletLoading() {
  return (
    <>
      <PageHeader title="Business wallet" />
      <div className="flex items-center gap-2 py-16 text-[13.5px] text-dim">
        <Loader2 className="size-4 animate-spin" /> Opening your wallet…
      </div>
    </>
  )
}

export type WalletSource = {
  base: { test: boolean; usd: number; address: string; holdings: Holding[]; receive: { label: string; address: string }[]; activity: Movement[] }
  onSend: (m: Movement) => void
  /** Test mode: "Add 100 test USDC". */
  onDeposit?: (amount: number) => void
  /** Live: Send opens the real send, signed with the owner's wallet and PIN. */
  openSend?: () => void
  /** Live: only the owner can send. */
  canSend?: boolean
  /** Under the address in Receive: Stellar's opening, when it isn't open yet. */
  receiveFooter?: ReactNode
  /** Live: anything below the activity, like the transfer PIN. */
  after?: ReactNode
  /** Open with Receive showing - arriving from Settings to open Stellar. */
  receiveOnOpen?: boolean
  /** The balances are still being read from the chains: show that, not a zero. */
  loading?: boolean
  /** Live: a note under the buttons - why sending is paused, say. */
  notice?: ReactNode
  /** Live: read the balances and the activity again, now. */
  onRefresh?: () => void
  refreshing?: boolean
}

const SETTLE_CHAIN_NAME: Record<string, Chain> = { MOVEMENT: 'Movement', ARC: 'Arc', MONAD: 'Monad', SOLANA: 'Solana', STELLAR: 'Stellar' }

/** What was pretended in this browser's test wallet: sends out and test deposits in. */
function useTestMoves(businessId: string | undefined) {
  const key = businessId ? `mmb_test_wallet_v1:${businessId}` : null
  const [moves, setMoves] = useState<Movement[]>(() => {
    try {
      return key ? (JSON.parse(localStorage.getItem(key) ?? '[]') as Movement[]) : []
    } catch {
      return []
    }
  })
  const add = (m: Movement) =>
    setMoves((all) => {
      const next = [m, ...all]
      try {
        if (key) localStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* blocked storage: it lasts until the page reloads */
      }
      return next
    })
  return [moves, add] as const
}

/**
 * The test wallet, live: every test payment that settled to the wallet lands
 * here as USDC on the business's settlement chain; sends and test deposits are
 * pretended, in this browser. Nothing real moves, and it says so.
 */
function TestWallet() {
  const { business } = useSession()
  const { settlements } = useSettlements()
  const [moves, addMove] = useTestMoves(business?.id)
  const chain = SETTLE_CHAIN_NAME[business?.settleChain ?? 'MOVEMENT'] ?? 'Movement'
  const settled: Movement[] = settlements
    .filter((x) => x.target === 'Test wallet' && x.status !== 'failed')
    .map((x) => ({
      id: x.id,
      kind: 'in',
      label: `Test payment · ${x.live?.paymentRef ?? 'settled'}`,
      asset: 'USDC' as Asset,
      chain,
      amount: x.amountUsd,
      status: x.status === 'settled' ? 'completed' : 'processing',
      createdAt: x.live?.settledAt ?? x.createdAt,
    }))
  const activity = [...moves, ...settled].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // What's on each coin and network: everything in, less everything out.
  const byPlace = new Map<string, Holding>()
  for (const m of activity) {
    const k = `${m.asset}:${m.chain}`
    const h = byPlace.get(k) ?? { asset: m.asset, chain: m.chain, amount: 0 }
    h.amount = Math.round((h.amount + (m.kind === 'in' ? m.amount : -m.amount)) * 100) / 100
    byPlace.set(k, h)
  }
  const holdings = [...byPlace.values()].filter((h) => h.amount > 0)
  const source: WalletSource = {
    base: { test: true, usd: holdings.reduce((t, h) => t + h.amount, 0), address: TEST_WALLET.address, holdings, receive: TEST_WALLET.receive, activity },
    onSend: addMove,
    onDeposit: (amount) =>
      addMove({ id: `td_${Date.now()}`, kind: 'in', label: 'Test deposit', asset: 'USDC' as Asset, chain, amount, status: 'completed', createdAt: new Date().toISOString() }),
  }
  return <SampleWallet source={source} />
}

/** The business wallet as designed: the sample, the test wallet, and the live one with its own data and sending. */
export function WalletDesign({ source }: { source?: WalletSource }) {
  return <SampleWallet source={source} />
}

function SampleWallet({ source }: { source?: WalletSource } = {}) {
  const { business } = useSession()
  const sample = useWallet()
  const base = source?.base ?? sample
  const [sending, setSending] = useState(false)
  const [receiving, setReceiving] = useState<Asset | 'any' | null>(source?.receiveOnOpen ? 'any' : null)
  const [sent, setSent] = useState<Movement[]>([])
  const [openCoin, setOpenCoin] = useState<Asset | null>(null)
  const [coin, setCoin] = useState<'all' | Asset>('all')
  const [tab, setTab] = useState<'all' | 'in' | 'out'>('all')
  const [range, setRange] = useState<Range>('30d')
  const [about, setAbout] = useState(false)
  // A movement opened into its details.
  const [opened, setOpened] = useState<Movement | null>(null)
  // Show the wallet in dollars (coin units) or in naira, the coins at today's rate.
  const [cur, setCur] = useState<'USD' | 'NGN'>('USD')
  if (!business) return null
  // What was sent here comes off the balance and the coin it left from.
  const out = (m: { asset: string; chain: string }) => sent.filter((x) => x.asset === m.asset && x.chain === m.chain).reduce((a, x) => a + x.amount, 0)
  const w = {
    ...base,
    usd: base.usd - sent.reduce((a, x) => a + x.amount, 0),
    holdings: base.holdings.map((h: Holding) => ({ ...h, amount: Math.round((h.amount - out(h)) * 100) / 100 })),
    // Newest first, so each day groups once.
    activity: [...sent, ...base.activity].sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
  }
  const days = RANGE_DAYS[range]
  const inRange = (iso: string) => Date.now() - new Date(iso).getTime() <= days * 86_400_000
  const fig = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const inNgn = cur === 'NGN'
  // A coin amount as shown: the coins themselves, or their naira; and the other side for the "≈" line.
  const shown = (n: number) => (inNgn ? ngn(n * NGN_RATE) : fig(n))
  const aside = (n: number, asset?: Asset) => (inNgn ? `${fig(n)}${asset ? ` ${asset}` : ''}` : `≈ ${ngn(n * NGN_RATE)}`)
  const signed = (n: number, sign: '+' | '−') => `${n ? sign : ''}${shown(n)}`

  // Each coin: what's on each network (a network with nothing on it isn't listed), and what came in and went out.
  const coins = (['USDC', 'USDT'] as Asset[]).map((asset) => {
    const chains = w.holdings.filter((h: Holding) => h.asset === asset && h.amount > 0).sort((x: Holding, y: Holding) => y.amount - x.amount)
    const moves = w.activity.filter((a) => a.asset === asset && inRange(a.createdAt))
    return {
      asset,
      chains,
      total: chains.reduce((t: number, h: Holding) => t + h.amount, 0),
      in: moves.filter((a) => a.kind === 'in').reduce((t, a) => t + a.amount, 0),
      out: moves.filter((a) => a.kind === 'out').reduce((t, a) => t + a.amount, 0),
    }
  })

  // A running balance down the list, for the coin in view - then the tab and the range narrow it.
  const scope = coin === 'all' ? w.activity : w.activity.filter((a) => a.asset === coin)
  let bal = coin === 'all' ? w.usd : (coins.find((c) => c.asset === coin)?.total ?? 0)
  const ledger = scope.map((a) => {
    const row = { ...a, after: bal }
    bal -= a.kind === 'in' ? a.amount : -a.amount
    return row
  })
  const rows = ledger.filter((a) => (tab === 'all' || a.kind === tab) && inRange(a.createdAt))

  const pill = 'flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition'
  // Live, Send is the real one; only the owner has it.
  // The sample send only for the sample and test wallets: a live wallet that can't send hides the button instead.
  const startSend = () => (source?.openSend ? source.openSend() : setSending(true))
  const canSend = source ? source.canSend !== false && (!!source.openSend || !!source.onDeposit) : true

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="display text-[30px] font-semibold leading-tight tracking-[-0.03em] text-fg max-md:text-[24px]">Business wallet</h1>
        <div className="relative">
          <button
            onClick={() => setAbout((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full bg-[#E4F2E8] px-2 py-0.5 text-[12px] font-medium text-good transition hover:bg-[#D6EBDD]"
            aria-expanded={about}
          >
            <ShieldCheck className="size-3.5" weight="fill" /> Self-custodial
          </button>
          {about && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setAbout(false)} />
              <div className="rise absolute left-0 top-full z-20 mt-2 w-[300px] rounded-[12px] border border-line bg-card p-4 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.25)]">
                <p className="text-[13px] leading-relaxed text-muted">
                  This wallet belongs to your business, not to us. It's a self-custody wallet tied to your sign-in. Money Moves can see the balance but can't move, freeze or spend it.
                </p>
                <div className="mt-3 space-y-1.5 border-t border-soft pt-3 text-[12.5px]">
                  {[
                    ['Custody', 'Yours alone'],
                    ['Who can move it', 'Only the owner, with their PIN'],
                    ['To your bank', `${ngn(PRICING.payoutNgn).replace('.00', '')} per transfer`],
                    ['To Money Moves', 'Free'],
                    ['To a crypto wallet', 'Network fee only'],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between gap-3">
                      <span className="text-dim">{l}</span>
                      <span className={v === 'Free' ? 'text-good' : 'text-fg'}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {w.test && <Badge tone="warn">Test</Badge>}
      </div>

      <div className="mt-4">
        {source?.loading ? (
          <span className="block h-[44px] w-[180px] animate-pulse rounded-[10px] bg-raise max-md:h-[38px]" aria-label="Reading your balance" />
        ) : (
          <Figure text={inNgn ? ngn(w.usd * NGN_RATE) : usd(w.usd)} className="display block text-[44px] font-semibold leading-none tracking-[-0.035em] text-fg max-md:text-[38px]" />
        )}
        {/* A phone: the other currency and the switch on one line. */}
        <div className="mt-2.5 flex items-center justify-between gap-3 md:hidden">
          <span className="tabular min-w-0 truncate text-[13px] text-dim">≈ {inNgn ? usd(w.usd) : ngn(w.usd * NGN_RATE)}</span>
          <PillSwitch
            value={cur}
            onChange={setCur}
            options={[
              { id: 'USD', label: '$' },
              { id: 'NGN', label: '₦' },
            ]}
          />
        </div>
        <div className="tabular mt-2 hidden text-[13px] text-dim md:block">
          {inNgn ? `≈ ${usd(w.usd)} · at ₦${NGN_RATE.toLocaleString()} to $1` : `≈ ${ngn(w.usd * NGN_RATE)}`} · USDC and USDT, {w.test ? 'simulated for test mode' : 'read from the chain'}
        </div>
      </div>

      {source?.onDeposit && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] border border-dashed border-[#E3B85C] bg-[#FDF8EC] px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[#6E440A]">
            Test wallet, simulated, nothing real moves. Test payments that settle to your wallet land here as USDC on {SETTLE_CHAIN_NAME[business.settleChain ?? 'MOVEMENT'] ?? 'Movement'}.
          </p>
          <button onClick={() => source.onDeposit!(100)} className="rounded-full bg-fg px-3.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#2A2A26]">
            Add 100 test USDC
          </button>
        </div>
      )}

      {/* A phone: send and receive share the row; payout places is the small one. */}
      <div className={cx('mt-5 grid gap-2 md:hidden', canSend ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-[1fr_auto]')}>
        {canSend && (
          <button onClick={startSend} className={cx(pill, 'justify-center bg-fg text-white')}>
            <ArrowUpRight className="size-4" /> Send money
          </button>
        )}
        <button onClick={() => setReceiving('any')} className={cx(pill, 'justify-center bg-raise text-fg')}>
          <ArrowDownLeft className="size-4" /> Receive
        </button>
        <Link to="/settings/settlement" aria-label="Payout places" className="flex size-9 items-center justify-center rounded-full bg-raise text-fg">
          <Landmark className="size-4" />
        </Link>
      </div>
      {source?.onRefresh && (
        <button type="button" onClick={source.onRefresh} disabled={source.refreshing} className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-muted md:hidden">
          <RefreshCw className={cx('size-3.5', source.refreshing && 'animate-spin')} /> {source.refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      )}

      <div className="mt-5 hidden flex-wrap items-center gap-2 md:flex">
        {canSend && (
          <button onClick={startSend} className={cx(pill, 'bg-fg text-white hover:bg-[#2A2A26]')}>
            <ArrowUpRight className="size-4" /> Send money
          </button>
        )}
        <button onClick={() => setReceiving('any')} className={cx(pill, 'bg-raise text-fg hover:bg-[#EAE8E2]')}>
          <ArrowDownLeft className="size-4" /> Receive
        </button>
        <Link to="/settings/settlement" className={cx(pill, 'bg-raise text-fg hover:bg-[#EAE8E2]')}>
          <Landmark className="size-4" /> Payout places
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {source?.onRefresh && (
            <button
              type="button"
              onClick={source.onRefresh}
              disabled={source.refreshing}
              aria-label="Refresh"
              title="Read the balance and activity again"
              className="flex size-9 items-center justify-center rounded-full border border-line bg-card text-muted transition hover:border-[#D3D0C7] hover:text-fg disabled:opacity-60"
            >
              <RefreshCw className={cx('size-4', source.refreshing && 'animate-spin')} />
            </button>
          )}
          <PillSwitch
            value={cur}
            onChange={setCur}
            options={[
              { id: 'USD', label: '$ Dollars' },
              { id: 'NGN', label: '₦ Naira' },
            ]}
          />
        </div>
      </div>

      {source?.notice}

      {/* A phone: both coins in one list - tap one for its networks, in and out, and receive. */}
      <div className="mt-6 divide-y divide-soft overflow-hidden rounded-[14px] border border-line bg-card md:hidden">
        {coins.map((c) => {
          const open = openCoin === c.asset
          return (
            <div key={c.asset}>
              <button onClick={() => setOpenCoin(open ? null : c.asset)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <TokenIcon asset={c.asset} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-fg">{c.asset}</span>
                  <span className="block truncate text-[12px] text-dim">{c.chains.length ? `On ${c.chains.length} network${c.chains.length === 1 ? '' : 's'}` : 'Nothing here yet'}</span>
                </span>
                <span className="text-right">
                  <Figure text={shown(c.total)} className="block text-[16px] font-semibold text-fg" />
                  <span className="tabular block text-[12px] text-dim">{aside(c.total, c.asset)}</span>
                </span>
                <ChevronDown className={cx('size-4 shrink-0 text-dim transition', open && 'rotate-180')} />
              </button>
              {open && (
                <div className="rise border-t border-soft bg-[#FAFAF8] px-4 pb-3 pt-3">
                  <div className="grid grid-cols-2 gap-3 border-b border-soft pb-3">
                    <div>
                      <div className="text-[12px] text-muted">In · {days} days</div>
                      <Figure text={signed(c.in, '+')} className={cx('mt-0.5 block text-[14px] font-medium', c.in ? 'text-good' : 'text-dim')} />
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">Out · {days} days</div>
                      <Figure text={signed(c.out, '−')} className={cx('mt-0.5 block text-[14px] font-medium', c.out ? 'text-fg' : 'text-dim')} />
                    </div>
                  </div>
                  {c.chains.map((h) => (
                    <div key={h.chain} className="flex items-center gap-2.5 border-b border-soft py-2.5">
                      <ChainIcon chain={h.chain} size={20} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{h.chain}</span>
                      <Figure text={shown(h.amount)} className="text-[13.5px] font-medium text-fg" />
                    </div>
                  ))}
                  <button onClick={() => setReceiving(c.asset)} className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-line bg-card text-[13.5px] font-medium text-fg">
                    <ArrowDownLeft className="size-4" /> Receive {c.asset}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-8 hidden grid-cols-1 items-start gap-4 md:grid md:grid-cols-2">
        {coins.map((c) => {
          const open = openCoin === c.asset
          return (
            <div key={c.asset} className="rounded-[14px] border border-line bg-card">
              <div className="p-5">
                <div className="flex items-center gap-2 text-[14px] font-medium text-fg">
                  <TokenIcon asset={c.asset} size={22} /> {c.asset}
                </div>
                <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
                  <div className="min-w-0">
                    {source?.loading ? (
                      <span className="block h-8 w-24 animate-pulse rounded-[8px] bg-raise" />
                    ) : (
                      <Figure text={shown(c.total)} className={cx('display block font-semibold leading-none tracking-[-0.03em] text-fg', inNgn ? 'text-[28px]' : 'text-[32px]')} />
                    )}
                    <div className="tabular mt-1.5 text-[12.5px] text-dim">{aside(c.total, c.asset)}</div>
                  </div>
                  <div className="flex gap-6 sm:text-right">
                    <div>
                      <div className="text-[12px] text-muted">In · {days} days</div>
                      <Figure text={signed(c.in, '+')} className={cx('mt-1 block text-[15px] font-medium', c.in ? 'text-good' : 'text-dim')} />
                    </div>
                    <div>
                      <div className="text-[12px] text-muted">Out · {days} days</div>
                      <Figure text={signed(c.out, '−')} className={cx('mt-1 block text-[15px] font-medium', c.out ? 'text-fg' : 'text-dim')} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                <button
                  onClick={() => setOpenCoin(open ? null : c.asset)}
                  disabled={!c.chains.length}
                  className="flex min-w-0 items-center gap-2 text-[13px] text-muted transition hover:text-fg disabled:hover:text-muted"
                >
                  {c.chains.length > 0 && (
                    <span className="flex -space-x-1.5">
                      {c.chains.map((h) => (
                        <span key={h.chain} className="rounded-full ring-2 ring-white">
                          <ChainIcon chain={h.chain} size={18} />
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="truncate">{c.chains.length ? `On ${c.chains.length} network${c.chains.length === 1 ? '' : 's'}` : 'Nothing here yet'}</span>
                  {c.chains.length > 0 && <ChevronDown className={cx('size-3.5 shrink-0 transition', open && 'rotate-180')} />}
                </button>
                <button onClick={() => setReceiving(c.asset)} className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                  <ArrowDownLeft className="size-3.5" /> Receive {c.asset}
                </button>
              </div>
              {open && (
                <div className="rise border-t border-line px-5 py-1.5">
                  {c.chains.map((h) => (
                    <div key={h.chain} className="flex items-center gap-2.5 border-b border-soft py-2.5 last:border-b-0">
                      <ChainIcon chain={h.chain} size={20} />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{h.chain}</span>
                      <span className="text-[12px] text-dim">{c.total ? Math.round((h.amount / c.total) * 100) : 0}%</span>
                      <Figure text={fig(h.amount)} className="w-[88px] text-right text-[13.5px] font-medium text-fg" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <section className="mt-12 max-md:mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Activity</h2>
            <span className="text-[13px] text-dim">
              {rows.length} movement{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PillSwitch
              value={coin}
              onChange={setCoin}
              options={[
                { id: 'all', label: 'All' },
                { id: 'USDC', label: 'USDC' },
                { id: 'USDT', label: 'USDT' },
              ]}
            />
            <FilterMenu
              label="Last 30 days"
              value={range}
              onChange={setRange}
              align="right"
              options={[
                { id: '30d', label: 'Last 30 days' },
                { id: '7d', label: 'Last 7 days' },
                { id: '90d', label: 'Last 90 days' },
              ]}
            />
          </div>
        </div>
        <div className="mt-4">
          <UnderlineTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'all', label: 'All activity' },
              { id: 'in', label: 'Money in' },
              { id: 'out', label: 'Money out' },
            ]}
          />
        </div>
        <Rows
          rows={rows}
          keyOf={(a) => a.id}
          onRow={(a) => setOpened(a)}
          min={720}
          mobile={(a, i) => (
            <>
              {(i === 0 || dayOf(rows[i - 1]!.createdAt) !== dayOf(a.createdAt)) && <DayHead>{dayOf(a.createdAt)}</DayHead>}
              <div className="flex items-center gap-3 px-4 py-3">
                <TokenIcon asset={a.asset} chain={a.chain} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-fg">{a.label}</div>
                  <div className="truncate text-[12px] text-dim">
                    {a.status !== 'completed' && <span className="font-medium text-amber">On its way · </span>}
                    {typeOf(a)} · {timeOf(a.createdAt)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Figure text={`${a.kind === 'in' ? '+' : '−'}${shown(a.amount)}`} className={cx('block text-[14px] font-medium', a.kind === 'in' ? 'text-good' : 'text-fg')} />
                  <span className="block text-[11.5px] text-dim">{inNgn ? `${fig(a.amount)} ${a.asset}` : a.asset}</span>
                </div>
              </div>
            </>
          )}
          empty={<div className="py-14 text-center text-[13.5px] text-muted">Nothing moved in the last {days} days.</div>}
          cols={[
            { head: 'Date', className: 'w-[120px] whitespace-nowrap', cell: (a, i) => (i === 0 || dayOf(rows[i - 1]!.createdAt) !== dayOf(a.createdAt) ? <span className="text-[13.5px] text-fg">{dayOf(a.createdAt)}</span> : null) },
            {
              head: 'Description',
              cell: (a) => (
                <span className="flex min-w-0 items-center gap-3">
                  <TokenIcon asset={a.asset} chain={a.chain} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-fg">{a.label}</span>
                    <span className="block truncate text-[12px] text-dim">
                      {a.status !== 'completed' && <span className="font-medium text-amber">On its way · </span>}
                      {a.asset} on {a.chain} · {timeOf(a.createdAt)}
                    </span>
                  </span>
                </span>
              ),
            },
            { head: 'Type', cell: (a) => <span className="whitespace-nowrap text-[13.5px] text-muted">{typeOf(a)}</span> },
            {
              head: 'Amount',
              right: true,
              cell: (a) => (
                <span className="block whitespace-nowrap">
                  <Figure text={`${a.kind === 'in' ? '+' : '−'}${shown(a.amount)}`} className={cx('text-[14px] font-medium', a.kind === 'in' ? 'text-good' : 'text-fg')} />
                  {!inNgn && <span className="ml-1 text-[12px] text-dim">{a.asset}</span>}
                  <span className="tabular block text-[12px] text-dim">{aside(a.amount, a.asset)}</span>
                </span>
              ),
            },
            { head: 'Balance', right: true, cell: (a) => <Figure text={shown(a.after)} className="whitespace-nowrap text-[13.5px] text-muted" /> },
          ]}
        />
        {rows.length > 0 && <RowCount total={rows.length} noun="movements" />}
      </section>

      {source?.after}

      <Drawer open={!!opened} onClose={() => setOpened(null)} title={opened ? `${opened.kind === 'in' ? 'Money in' : 'Money out'} · ${opened.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${opened.asset}` : ''}>
        {opened && (
          <div>
            <DetailRow label="What">{opened.label}</DetailRow>
            <DetailRow label="Amount">
              {opened.kind === 'in' ? '+' : '−'}
              {opened.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })} {opened.asset}
            </DetailRow>
            <DetailRow label="Network">{opened.chain}</DetailRow>
            <DetailRow label="Status">{opened.status === 'completed' ? (opened.kind === 'in' ? 'Arrived' : 'Sent') : 'On its way'}</DetailRow>
            <DetailRow label="Date">{dateTime(opened.createdAt)}</DetailRow>
            {(opened.details ?? []).map((d) => (
              <DetailRow key={d.k} label={d.k}>
                <span className={d.mono ? 'break-all font-mono text-[12.5px]' : ''}>{d.v}</span>
              </DetailRow>
            ))}
            {opened.tx && (
              <DetailRow label="Transaction">
                <span className="inline-flex items-center gap-2">
                  {opened.tx.url ? (
                    <a href={opened.tx.url} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] underline underline-offset-2">
                      {short(opened.tx.hash, 8, 6)}
                    </a>
                  ) : (
                    <span className="font-mono text-[12.5px]">{short(opened.tx.hash, 8, 6)}</span>
                  )}
                  <CopyChipSmall value={opened.tx.hash} />
                </span>
              </DetailRow>
            )}
            {!opened.tx && !w.test && <p className="pt-3 text-[12.5px] text-dim">The transaction shows here once it's on chain.</p>}
          </div>
        )}
      </Drawer>

      {!source?.openSend && <SendMoney open={sending} holdings={w.holdings} onClose={() => setSending(false)} onSent={(m) => (source ? source.onSend(m) : setSent((all) => [m, ...all]))} />}
      <Receive open={receiving !== null} asset={receiving === 'any' ? null : receiving} places={w.receive} footer={source?.receiveFooter} onClose={() => setReceiving(null)} />
    </>
  )
}

/** Copies a transaction hash: a small button that says it worked. */
function CopyChipSmall({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1400)
          },
          () => undefined,
        )
      }}
      className="rounded-full border border-line px-2 py-0.5 text-[11.5px] font-medium text-muted hover:text-fg"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

/** What kind of movement this is, in a word or two. */
function typeOf(a: Movement) {
  if (a.label.startsWith('Settlement')) return 'Settlement'
  if (a.label.startsWith('Test payment') || a.label.startsWith('Payment')) return 'Payment'
  if (a.label.startsWith('Bank transfer')) return 'Bank transfer'
  if (a.label.startsWith('Refund')) return 'Refund'
  if (a.label.includes('@')) return 'To Money Moves'
  return a.kind === 'in' ? 'Received' : 'To a wallet'
}

/** Receive: a network, its address as a code, and a copy button. */
function Receive({ open, asset, places, footer, onClose }: { open: boolean; asset: Asset | null; places: { label: string; address: string }[]; footer?: ReactNode; onClose: () => void }) {
  const [net, setNet] = useState(0)
  const here = places[net] ?? places[0] ?? { label: '', address: '' }
  return (
    <Modal open={open} onClose={onClose} width={440} title={asset ? `Receive ${asset}` : 'Receive USDC or USDT'} sub="Send only USDC or USDT, on the network you pick here. Anything else can't be recovered. To get naira, send money to your bank.">
      <div className="space-y-4">
        <Select value={String(net)} onChange={(e) => setNet(Number(e.target.value))} aria-label="Network">
          {places.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </Select>
        <div className="flex justify-center rounded-[12px] border border-line py-5">
          <Qr value={here.address} size={180} />
        </div>
        <CopyField value={here.address} />
        {footer}
      </div>
    </Modal>
  )
}

/* ─── Settlements ──────────────────────────────────────────────────── */

/** Where one settlement went, in a few words: the place, then the account or address. */
function placeOf(s: Settlement) {
  if (s.destination === 'bank') {
    const [bank, account = ''] = s.target.split(' · ')
    return { title: `${bank} ••${account.slice(-4)}`, sub: 'Bank account' }
  }
  if (s.destination === 'wallet') return { title: s.target, sub: 'Money Moves account' }
  if (s.live) return { title: s.target, sub: s.target === 'Test wallet' ? 'Test mode. Nothing real moved' : 'Self-custodial' }
  const [address, chain] = s.target.split(' · ')
  return { title: 'Business wallet', sub: `${address} on ${chain}` }
}

/** The naira a settlement came to: exact for a bank one, at today's rate for the rest. */
const naira = (s: Settlement) => s.ngn ?? Math.round(s.amountUsd * NGN_RATE * 100) / 100
/** Its amount as delivered - naira to a bank, dollars to a wallet - and the other side as "≈". */
const delivered = (s: Settlement) => (s.ngn ? ngn(s.ngn) : usd(s.amountUsd))
const other = (s: Settlement) => (s.ngn ? usd(s.amountUsd) : ngn(naira(s)))

/**
 * What the business sees. A payment that succeeded is theirs; if we then fail
 * to deliver it, that's ours to sort out by hand - to them it's still on its
 * way until our team updates it.
 */
const seen = (s: Settlement): 'settled' | 'pending' => (s.status === 'settled' ? 'settled' : 'pending')

const settlementNo = (s: Settlement) => Number(s.id.replace(/\D/g, ''))
const settlementRef = (s: Settlement) => s.live?.ref ?? `STL-${40_100 + settlementNo(s) * 37}`

function dayOf(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const PLACES: Destination[] = ['bank', 'wallet', 'onchain']

type Range = '7d' | '30d' | '90d'
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 }

export function Settlements() {
  const { business, mode } = useSession()
  const [targets] = useTargets(business?.id)
  const [range, setRange] = useState<Range>('30d')
  const [dest, setDest] = useState<'all' | Destination>('all')
  const [status, setStatus] = useState<'all' | 'settled' | 'pending'>('all')
  const [open, setOpen] = useState<Settlement | null>(null)
  const { settlements, loading: settling } = useSettlements()
  // Still on its way: placeholders, not zeros.
  const wait = LIVE && settling
  if (!business) return null

  const days = RANGE_DAYS[range]
  const within = settlements.filter((s) => Date.now() - new Date(s.createdAt).getTime() <= days * 86_400_000)
  const rows = within.filter((s) => (dest === 'all' || s.destination === dest) && (status === 'all' || seen(s) === status))
  const settled = within.filter((s) => s.status === 'settled')
  const sumUsd = (xs: Settlement[]) => xs.reduce((a, s) => a + s.amountUsd, 0)
  const sumNgn = (xs: Settlement[]) => xs.reduce((a, s) => a + naira(s), 0)

  // One card a place: what reached it, what's still moving, and which account.
  const banks = banksOf(targets).filter((b) => b.verified)
  const mainBank = defaultBankOf(targets)
  // Test money goes to sandbox accounts, whatever real ones are set up.
  const where: Record<Destination, string> =
    mode === 'test'
      ? SANDBOX
      : {
          bank: banks.length ? `${bankLabel(mainBank?.verified ? mainBank : banks[0]!)}${banks.length > 1 ? ` +${banks.length - 1}` : ''}` : 'No bank account yet',
          wallet: defaultMmOf(targets)?.username ?? mmsOf(targets)[0]?.username ?? 'No account linked',
          // Live: the owner creates it on the Wallet page; until then, say so. Nothing while it's still loading.
          onchain: !LIVE || targets?.businessWallet ? 'Self-custodial' : targets ? 'Not created yet' : '',
        }
  const cards = PLACES.map((d) => {
    const xs = within.filter((s) => s.destination === d)
    return { d, done: xs.filter((s) => seen(s) === 'settled'), moving: xs.filter((s) => seen(s) === 'pending'), count: xs.length }
  })
  // A bank is paid in naira; the wallets in dollars.
  const money = (d: Destination, xs: Settlement[]) => (d === 'bank' ? ngn(sumNgn(xs)) : usd(sumUsd(xs)))

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-[30px] font-semibold leading-tight tracking-[-0.03em] text-fg max-md:text-[24px]">Settlements</h1>
          <p className="mt-1 text-[13.5px] text-muted max-sm:hidden">Every payment, delivered the moment it confirms. We never keep a balance for you.</p>
        </div>
        <button
          aria-label="Download"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              `settlements-${today()}.csv`,
              ['Date', 'Reference', 'Payment', 'Naira', 'Dollars', 'To', 'Status'],
              rows.map((s) => [s.createdAt, s.live?.ref ?? s.id, s.live?.paymentRef ?? '', s.ngn ?? '', s.amountUsd, s.target, seen(s)]),
            )
          }
          className="flex h-9 items-center gap-1.5 rounded-full bg-raise px-4 text-[14px] font-medium text-fg transition hover:bg-[#EAE8E2] disabled:opacity-45 max-sm:px-2.5"
        >
          <Download className="size-4" /> <span className="max-sm:hidden">Download</span>
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-muted">Settled in the last {days} days</div>
          <Figure loading={wait} text={usd(sumUsd(settled))} className="display mt-2 block text-[44px] font-semibold leading-none tracking-[-0.035em] text-fg max-md:text-[38px]" />
          <div className="tabular mt-2 text-[13px] text-dim">
            {wait ? <Skel w="12em" /> : <>≈ {ngn(sumNgn(settled))} · {settled.length} settlement{settled.length === 1 ? '' : 's'} · no fees</>}
          </div>
        </div>
        <PillSwitch
          value={range}
          onChange={setRange}
          options={[
            { id: '7d', label: '7 days' },
            { id: '30d', label: '30 days' },
            { id: '90d', label: '90 days' },
          ]}
        />
      </div>

      {/* A phone: the three places as one list - tap one to see only its settlements. */}
      <div className="mt-6 divide-y divide-soft overflow-hidden rounded-[14px] border border-line bg-card md:hidden">
        {cards.map((c) => {
          const on = dest === c.d
          return (
            <button key={c.d} onClick={() => setDest(on ? 'all' : c.d)} className={cx('flex w-full items-center gap-3 px-4 py-3.5 text-left transition', on && 'bg-[#F6F8EF]')}>
              <PlaceIcon d={c.d} size={34} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14.5px] font-medium text-fg">
                  {c.d === 'bank' ? 'Bank accounts' : c.d === 'wallet' ? 'Money Moves' : 'Business wallet'}
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="block truncate text-[12px] text-dim">{where[c.d]}</span>
              </span>
              <span className="shrink-0 text-right">
                <Figure loading={wait} text={money(c.d, c.done)} className="block text-[15px] font-semibold text-fg" />
                <span className="block text-[12px]">
                  {c.moving.length ? (
                    <span className="text-amber">{money(c.d, c.moving)} on the way</span>
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-7 hidden grid-cols-1 gap-4 md:grid md:grid-cols-3">
        {cards.map((c) => {
          const on = dest === c.d
          return (
            <button
              key={c.d}
              onClick={() => setDest(on ? 'all' : c.d)}
              className={cx('flex flex-col rounded-[14px] border bg-card p-5 text-left transition', on ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
            >
              {/* Three lines: the place and its account, the amount and what's still moving, then the other currency and the count. */}
              <div className="flex items-center gap-2">
                <PlaceIcon d={c.d} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] text-fg">
                  <span className="font-medium">{c.d === 'bank' ? 'Bank' : c.d === 'wallet' ? 'Money Moves' : 'Business wallet'}</span>
                  {where[c.d] && <span className="text-dim"> · {where[c.d]}</span>}
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <Figure loading={wait} text={money(c.d, c.done)} className="display block text-[28px] font-semibold leading-none tracking-[-0.03em] text-fg" />
                </div>
                {c.moving.length > 0 && (
                  <div className="shrink-0 text-right">
                    <div className="text-[11.5px] text-amber">On the way</div>
                    <Figure text={money(c.d, c.moving)} className="block text-[14px] font-medium text-amber" />
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <section className="mt-12 max-md:mt-9">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">History</h2>
            <span className="text-[13px] text-dim">
              {rows.length} settlement{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <FilterMenu
            label="Status"
            value={status}
            onChange={setStatus}
            align="right"
            options={[
              { id: 'all', label: 'All statuses' },
              { id: 'settled', label: 'Settled' },
              { id: 'pending', label: 'On its way' },
            ]}
          />
        </div>
        <div className="mt-4">
          <UnderlineTabs
            value={dest}
            onChange={setDest}
            tabs={[{ id: 'all' as const, label: 'All', count: within.length }, ...cards.map((c) => ({ id: c.d, label: DESTINATIONS[c.d].short, count: c.count }))]}
          />
        </div>
        <Rows
          rows={rows}
          keyOf={(s) => s.id}
          onRow={setOpen}
          loading={wait}
          min={720}
          mobile={(s, i) => (
            <>
              {(i === 0 || dayOf(rows[i - 1]!.createdAt) !== dayOf(s.createdAt)) && <DayHead>{dayOf(s.createdAt)}</DayHead>}
              <div className="flex items-center gap-3 px-4 py-3">
                <PlaceIcon d={s.destination} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] text-fg">{placeOf(s).title}</div>
                  <div className="truncate text-[12px] text-dim">
                    <span className={cx('font-medium', seen(s) === 'settled' ? 'text-good' : 'text-amber')}>{seen(s) === 'settled' ? 'Settled' : 'On its way'}</span>{' '}
                    · {s.payments} payment{s.payments === 1 ? '' : 's'} · {timeOf(s.createdAt)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Figure text={delivered(s)} className="block text-[14px] font-medium text-fg" />
                  <span className="tabular block text-[11.5px] text-dim">≈ {other(s)}</span>
                </div>
              </div>
            </>
          )}
          empty={<div className="py-14 text-center text-[13.5px] text-muted">No settlements like that in the last {days} days.</div>}
          cols={[
            { head: 'Date', className: 'w-[120px] whitespace-nowrap', cell: (s, i) => (i === 0 || dayOf(rows[i - 1]!.createdAt) !== dayOf(s.createdAt) ? <span className="text-[13.5px] text-fg">{dayOf(s.createdAt)}</span> : null) },
            {
              head: 'Delivered to',
              cell: (s) => (
                <span className="flex min-w-0 items-center gap-3">
                  <PlaceIcon d={s.destination} size={30} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] text-fg">{placeOf(s).title}</span>
                    <span className="block truncate text-[12px] text-dim">
                      {placeOf(s).sub} · {timeOf(s.createdAt)}
                    </span>
                  </span>
                </span>
              ),
            },
            { head: 'Payments', cell: (s) => <span className="text-[13.5px] text-muted">{s.payments}</span> },
            { head: 'Status', cell: (s) => <SettleStatus s={seen(s)} /> },
            {
              head: 'Amount',
              right: true,
              cell: (s) => (
                <span className="block whitespace-nowrap">
                  <Figure text={delivered(s)} className="text-[14px] font-medium text-fg" />
                  <span className="tabular block text-[12px] text-dim">≈ {other(s)}</span>
                </span>
              ),
            },
          ]}
        />
        {rows.length > 0 && <RowCount total={rows.length} noun="settlements" />}
      </section>

      <SettlementDrawer s={open ? (settlements.find((x) => x.id === open.id) ?? open) : null} onClose={() => setOpen(null)} />
    </>
  )
}

/** Where a settlement went, as a mark: a bank, the Money Moves app, or the business wallet. */
function PlaceIcon({ d, size = 32 }: { d: Destination; size?: number }) {
  if (d === 'wallet') return <PlaceMark size={size} />
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border border-line bg-card" style={{ width: size, height: size }}>
      <img src={d === 'bank' ? '/brand/bank.png' : '/brand/wallet.png'} alt="" aria-hidden className="object-contain" style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  )
}

function SettleStatus({ s }: { s: 'settled' | 'pending' }) {
  const [label, tone] = s === 'settled' ? ['Settled', 'bg-[#E4F2E8] text-good'] : ['On its way', 'bg-[#FDF3E3] text-amber']
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium', tone)}>{label}</span>
}

/** The payments a settlement carried - drawn from the samples and shared out to its amount until the API returns them. */
function paymentsIn(s: Settlement) {
  const pool = PAYMENTS.filter((p) => p.status === 'successful')
  const n = settlementNo(s)
  const picks = Array.from({ length: s.payments }, (_, i) => pool[(n * 3 + i * 5) % pool.length]!)
  const weights = picks.map((_, i) => 1 + ((n + i * 7) % 5))
  const all = weights.reduce((a, b) => a + b, 0)
  const share = (whole: number, i: number) => Math.round(((whole * weights[i]!) / all) * 100) / 100
  const usdParts = picks.map((_, i) => share(s.amountUsd, i))
  const ngnParts = picks.map((_, i) => share(naira(s), i))
  // The last one takes the rounding, so the parts add up to the whole.
  usdParts[usdParts.length - 1] = Math.round((s.amountUsd - usdParts.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100
  ngnParts[ngnParts.length - 1] = Math.round((naira(s) - ngnParts.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100
  return picks.map((p, i) => ({ p, usd: usdParts[i]!, ngn: ngnParts[i]! }))
}

function SettlementDrawer({ s, onClose }: { s: Settlement | null; onClose: () => void }) {
  const { payments } = usePayments()
  if (!s) return null
  if (s.live) return <LiveSettlementDrawer s={s} payment={payments.find((p) => p.id === s.live!.paymentId)} onClose={onClose} />
  const place = placeOf(s)
  const bank = s.destination === 'bank'
  const n = settlementNo(s)
  const parts = paymentsIn(s)
  const at = (minutes: number) => timeOf(new Date(new Date(s.createdAt).getTime() + minutes * 60_000).toISOString())
  const ref = bank
    ? `1000042610${String(25_100 + n * 311).padStart(8, '0')}${String(904_211 + n * 7_919).padStart(12, '0')}`.slice(0, 30)
    : s.destination === 'onchain'
      ? `0x${(0x7c41ab90 + n * 0x2f3d).toString(16)}e19d0c7a42f68e5d1c9a0b7e3f2d41${n}`.slice(0, 66)
      : `MM-${(782_400 + n * 913).toString(36).toUpperCase()}`
  const steps: Step[] = [
    { title: s.payments === 1 ? 'Payment confirmed' : `${s.payments} payments confirmed`, detail: usd(s.amountUsd), time: at(-1), state: 'done' },
    ...(bank ? [{ title: 'Converted to naira', detail: `${usd(s.amountUsd)} → ${ngn(naira(s))} at ₦${NGN_RATE.toLocaleString()}`, time: at(0), state: 'done' } as Step] : []),
    s.status === 'failed'
      ? { title: `Sending to ${place.title}`, detail: "Taking a little longer than usual. We're on it, and we'll email you the moment it lands.", state: 'now' }
      : s.status === 'pending'
        ? { title: `Sending to ${place.title}`, detail: bank ? 'Bank transfers usually land in seconds.' : 'Usually a few seconds.', state: 'now' }
        : { title: `Delivered to ${place.title}`, detail: place.sub, time: at(1), state: 'done' },
  ]

  return (
    <Drawer open onClose={onClose} title={`Settlement ${settlementRef(s)}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="display tabular text-[30px] font-semibold leading-none text-fg">{delivered(s)}</div>
          <div className="tabular mt-2 text-[12.5px] text-dim">
            ≈ {other(s)} at ₦{NGN_RATE.toLocaleString()}
          </div>
        </div>
        <Status value={seen(s)} />
      </div>

      <div className="mt-6">
        <DetailRow label={seen(s) === 'settled' ? 'Delivered to' : 'Going to'}>
          {place.title}
          <div className="text-[12px] text-dim">{place.sub}</div>
        </DetailRow>
        <DetailRow label="Payments">{s.payments}</DetailRow>
        {bank && <DetailRow label="Rate">₦{NGN_RATE.toLocaleString()} per dollar</DetailRow>}
        <DetailRow label="Fee">None, settling is free</DetailRow>
        <DetailRow label={bank ? 'Session ID' : s.destination === 'onchain' ? 'Transaction' : 'Reference'}>
          <span className="break-all font-mono text-[12px]">{s.destination === 'onchain' ? short(ref, 10, 8) : ref}</span>
        </DetailRow>
        <DetailRow label="Date">{dateTime(s.createdAt)}</DetailRow>
      </div>

      <div className="mt-7 border-t border-line pt-5">
        <div className="mb-3 text-[13px] font-semibold text-fg">{s.payments === 1 ? 'The payment in it' : `The ${s.payments} payments in it`}</div>
        <div className="divide-y divide-soft rounded-[10px] border border-line">
          {parts.map(({ p, usd: u, ngn: g }, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
              <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-fg">{p.customer.name}</div>
                <div className="truncate text-[12px] text-dim">
                  <span className="font-mono">{p.ref}</span> · {METHODS[p.method].short}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular text-[13px] text-fg">{bank ? ngn(g) : usd(u)}</div>
                <div className="tabular text-[11.5px] text-dim">≈ {bank ? usd(u) : ngn(g)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-7 border-t border-line pt-5">
        <div className="mb-4 text-[13px] font-semibold text-fg">Timeline</div>
        <Timeline items={steps} />
      </div>
    </Drawer>
  )
}

/** A real settlement: one payment, sent the moment it confirmed. */
function LiveSettlementDrawer({ s, payment, onClose }: { s: Settlement; payment?: Payment; onClose: () => void }) {
  const live = s.live!
  const place = placeOf(s)
  const done = seen(s) === 'settled'
  const steps: Step[] = [
    { title: 'Payment confirmed', detail: payment ? `${ngn(payment.received ?? payment.amount)} from ${payment.customer.name}` : live.paymentRef, time: timeOf(s.createdAt), state: 'done' },
    done
      ? { title: `Delivered to ${place.title}`, detail: place.sub, time: live.settledAt ? timeOf(live.settledAt) : undefined, state: 'done' }
      : { title: `Sending to ${place.title}`, detail: s.destination === 'bank' ? 'Bank transfers usually land in seconds.' : 'Usually a few seconds.', state: 'now' },
  ]
  return (
    <Drawer open onClose={onClose} title={`Settlement ${live.ref}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="display tabular text-[30px] font-semibold leading-none text-fg">{delivered(s)}</div>
          <div className="tabular mt-2 text-[12.5px] text-dim">≈ {other(s)}</div>
        </div>
        <Status value={seen(s)} />
      </div>

      <div className="mt-6">
        <DetailRow label={done ? 'Delivered to' : 'Going to'}>
          {place.title}
          <div className="text-[12px] text-dim">{live.accountName ?? place.sub}</div>
        </DetailRow>
        <DetailRow label="Payment">
          <span className="font-mono text-[12.5px]">{live.paymentRef}</span>
        </DetailRow>
        {live.feeNgn != null && <DetailRow label="Our fee">{ngn(live.feeNgn)}, taken from the payment</DetailRow>}
        <DetailRow label="Settling">Free</DetailRow>
        <DetailRow label="Reference">
          <span className="break-all font-mono text-[12px]">{live.ref}</span>
        </DetailRow>
        <DetailRow label="Date">{dateTime(s.createdAt)}</DetailRow>
      </div>

      {payment && (
        <div className="mt-7 border-t border-line pt-5">
          <div className="mb-3 text-[13px] font-semibold text-fg">The payment in it</div>
          <div className="flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-2.5">
            <PayIcon method={payment.method} asset={payment.asset} chain={payment.chain} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg">{payment.customer.name}</div>
              <div className="truncate text-[12px] text-dim">
                <span className="font-mono">{payment.ref}</span> · {METHODS[payment.method].short}
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-[13px] text-fg">{ngn(payment.received ?? payment.amount)}</div>
              <div className="tabular text-[11.5px] text-dim">≈ {usd(payment.usd)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-7 border-t border-line pt-5">
        <div className="mb-4 text-[13px] font-semibold text-fg">Timeline</div>
        <Timeline items={steps} />
      </div>
    </Drawer>
  )
}

/* ─── Moving money out of the business wallet ──────────────────────── */

// Payouts are the business wallet's own sends: to the business's bank as
// naira, to its Money Moves account, or to any crypto wallet. Paying other
// people's accounts switches on later.

type PayTo = 'bank' | 'mm' | 'crypto'
type SavedWallet = { label: string; address: string; chain: Chain }

/** Test mode sends to sandbox places: always ready, never real. */
const TEST_PLACES = {
  banks: [{ id: 'bk_test', bank: 'Test Bank', account: '0000000001', name: 'TEST MERCHANT', verified: true }] as BankAccount[],
  mms: [{ id: 'mm_test', username: '@test.merchant', linked: true }] as MmAccount[],
  wallets: [{ label: 'Test wallet', address: '0x7E57000000000000000000000000000000000001', chain: 'Base' as Chain }],
}

function SendMoney({ open, holdings, onClose, onSent }: { open: boolean; holdings: Holding[]; onClose: () => void; onSent: (m: Movement) => void }) {
  if (!open) return null
  return <SendFlow holdings={holdings} onClose={onClose} onSent={onSent} />
}

/** A bank or wallet mark in a small round badge - with the network in the corner for a crypto wallet. */
export function PlaceBadge({ src, chain }: { src: string; chain?: Chain }) {
  return (
    <span className="relative flex size-8 items-center justify-center rounded-full border border-line bg-card">
      <img src={src} alt="" aria-hidden className="size-4 object-contain" />
      {chain && (
        <span className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-card">
          <ChainIcon chain={chain} size={14} />
        </span>
      )}
    </span>
  )
}

/** A place you can send to, as one row of a list: tap to pick it. */
export function PlaceRow({ selected, disabled, icon, title, sub, onClick }: { selected: boolean; disabled?: boolean; icon: ReactNode; title: string; sub: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx('flex w-full items-center gap-3 px-3.5 py-3 text-left transition', selected ? 'bg-[#FAFAF8]' : 'hover:bg-[#FAFAF8]', disabled && 'cursor-not-allowed opacity-55')}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-fg">{title}</span>
        <span className="block truncate text-[12px] text-dim">{sub}</span>
      </span>
      <span className={cx('flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition', selected ? 'border-fg' : 'border-[#CFCCC3]')}>
        {selected && <span className="size-2 rounded-full bg-fg" />}
      </span>
    </button>
  )
}

export function PlaceGroup({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-[12.5px] font-medium text-fg">{title}</span>
        <span className="text-[12px] text-dim">{note}</span>
      </div>
      <div className="divide-y divide-soft overflow-hidden rounded-[10px] border border-line">{children}</div>
    </div>
  )
}

function SendFlow({ holdings, onClose, onSent }: { holdings: Holding[]; onClose: () => void; onSent: (m: Movement) => void }) {
  const { business } = useSession()
  const { test } = useTestMode()
  const [stored, setTargets] = useTargets(business?.id)
  const [testWallets, setTestWallets] = useState<SavedWallet[]>(TEST_PLACES.wallets)
  const places = test ? { ...TEST_PLACES, wallets: testWallets } : { banks: banksOf(stored), mms: mmsOf(stored), wallets: stored?.wallets ?? [] }
  const mainBank = test ? TEST_PLACES.banks[0] : defaultBankOf(stored)
  const mainMm = test ? TEST_PLACES.mms[0] : defaultMmOf(stored)
  const chains = [...new Set(holdings.map((h) => h.chain))]

  const [step, setStep] = useState<'method' | 'to' | 'amount' | 'signing' | 'done'>('method')
  const [kind, setKind] = useState<PayTo>(places.banks.some((b) => b.verified) ? 'bank' : places.mms.some((m) => m.linked) ? 'mm' : 'crypto')
  // 'bank', 'mm', 'w:<index>' for a saved wallet, or 'new' for one typed in now.
  const [pick, setPick] = useState('bank')
  const [fresh, setFresh] = useState<SavedWallet & { save: boolean }>({ label: '', address: '', chain: chains[0] ?? 'Base', save: true })
  const wallet: SavedWallet | null = kind !== 'crypto' ? null : pick.startsWith('w:') ? (places.wallets[Number(pick.slice(2))] ?? null) : pick === 'new' ? { ...fresh, address: fresh.address.trim() } : null
  // 'b:<id>' picks one of the bank accounts.
  const bank = kind === 'bank' ? places.banks.find((b) => `b:${b.id}` === pick) : undefined
  const mmPick = kind === 'mm' ? places.mms.find((m) => `m:${m.id}` === pick) : undefined
  const toOk = kind === 'bank' ? !!bank?.verified : kind === 'mm' ? !!mmPick?.linked : !!wallet && wallet.address.length >= 24
  const toLabel = kind === 'bank' ? (bank ? bankLabel(bank) : '') : kind === 'mm' ? (mmPick?.username ?? '') : wallet ? wallet.label || short(wallet.address) : ''

  // What it's typed in: naira or dollars, either way round.
  const [cur, setCur] = useState<'NGN' | 'USD'>('NGN')
  const [amt, setAmt] = useState('')
  // A crypto wallet can only take coins on its own network.
  const eligible = holdings.filter((h) => h.amount > 0 && (kind !== 'crypto' || !wallet || h.chain === wallet.chain))
  const multi = kind !== 'crypto'
  const keyOf = (h: Holding) => h.asset + h.chain
  const [picked, setPicked] = useState<string[] | null>(null)
  const byBiggest = [...eligible].sort((a, b) => b.amount - a.amount)
  // Every coin by default for a bank or Money Moves send; the biggest one for a crypto wallet.
  const chosen = picked ? byBiggest.filter((h) => picked.includes(keyOf(h))) : multi ? byBiggest : byBiggest.slice(0, 1)
  const from = chosen[0]
  const available = Math.round(chosen.reduce((a, h) => a + h.amount, 0) * 100) / 100
  const toggle = (h: Holding) => {
    if (!multi) return setPicked([keyOf(h)])
    const now = chosen.map(keyOf)
    const next = now.includes(keyOf(h)) ? now.filter((k) => k !== keyOf(h)) : [...now, keyOf(h)]
    if (next.length) setPicked(next)
  }
  const allPicked = chosen.length === eligible.length
  const fee = PRICING.payoutNgn
  const typed = Number(amt) || 0
  // Shown with thousands separators; kept as plain digits.
  const shown = amt ? `${Number(amt.split('.')[0] || 0).toLocaleString('en-US')}${amt.includes('.') ? `.${amt.split('.')[1]}` : ''}` : ''
  // A bank payout typed in naira lands as exactly that; the fee comes on top.
  const sendUsd = Math.round((kind === 'bank' ? (cur === 'NGN' ? (typed ? (typed + fee) / NGN_RATE : 0) : typed) : cur === 'NGN' ? typed / NGN_RATE : typed) * 100) / 100
  const bankGets = cur === 'NGN' ? typed : Math.max(0, Math.round((typed * NGN_RATE - fee) * 100) / 100)
  const over = !from || sendUsd > available
  // What comes out of each coin: the biggest first, until the amount is covered.
  const legs: { asset: Asset; chain: Chain; amount: number }[] = []
  {
    let left = sendUsd
    for (const h of chosen) {
      if (left <= 0) break
      const take = Math.round(Math.min(h.amount, left) * 100) / 100
      if (take > 0) legs.push({ asset: h.asset, chain: h.chain, amount: take })
      left = Math.round((left - take) * 100) / 100
    }
  }
  const amountOk = typed > 0 && !over && (kind !== 'bank' || bankGets > 0)
  const by = new Date(Date.now() + 86_400_000).toISOString()
  const [sent, setSent] = useState<Movement[] | null>(null)
  const sentTotal = Math.round((sent ?? []).reduce((a, m) => a + m.amount, 0) * 100) / 100
  // A reference for the receipt, fixed when it's sent.
  const [receiptRef] = useState(() => `PO-${Date.now().toString(36).toUpperCase().slice(-7)}`)

  // The wallet asks the business to confirm; a moment later it's signed.
  useEffect(() => {
    if (step !== 'signing' || !from) return
    const t = setTimeout(() => {
      if (pick === 'new' && fresh.save && wallet) {
        const w = { label: fresh.label.trim() || short(wallet.address), address: wallet.address, chain: wallet.chain }
        if (test) setTestWallets((all) => [...all, w])
        else setTargets((tg) => ({ ...tg, wallets: [...(tg.wallets ?? []), w] }))
      }
      // One movement per coin it was drawn from, so each balance goes down by its own share.
      const ms: Movement[] = legs.map((l, i) => ({
        id: `out_${Date.now()}_${i}`,
        kind: 'out',
        label: kind === 'bank' ? `Bank transfer to ${toLabel}` : `Sent to ${toLabel}`,
        asset: l.asset,
        chain: l.chain,
        amount: l.amount,
        status: kind === 'bank' ? 'processing' : 'completed',
        createdAt: new Date().toISOString(),
      }))
      ms.forEach(onSent)
      setSent(ms)
      setStep('done')
    }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const footer =
    step === 'method' ? (
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            const firstBank = mainBank?.verified ? mainBank : places.banks.find((b) => b.verified)
            const firstMm = mainMm?.linked ? mainMm : places.mms.find((m) => m.linked)
            setPick(kind === 'bank' ? `b:${firstBank?.id ?? ''}` : kind === 'mm' ? `m:${firstMm?.id ?? ''}` : places.wallets.length ? 'w:0' : 'new')
            setStep('to')
          }}
        >
          Continue
        </Button>
      </>
    ) : step === 'to' ? (
      <>
        <Button onClick={() => setStep('method')}>Back</Button>
        <Button
          variant="primary"
          disabled={!toOk}
          onClick={() => {
            setCur(kind === 'bank' ? 'NGN' : 'USD')
            setAmt('')
            setPicked(null)
            setStep('amount')
          }}
        >
          Continue
        </Button>
      </>
    ) : step === 'amount' ? (
      <>
        <Button onClick={() => setStep('to')}>Back</Button>
        <Button variant="primary" disabled={!amountOk} icon={<ShieldCheck className="size-4" />} onClick={() => setStep('signing')}>
          Confirm in wallet
        </Button>
      </>
    ) : step === 'signing' ? (
      <Button variant="primary" disabled icon={<Loader2 className="size-4 animate-spin" />}>
        Waiting for your wallet
      </Button>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )

  return (
    <Modal open onClose={onClose} width={520} title={step === 'done' ? 'Receipt' : 'Send money'} footer={footer}>
      {step !== 'done' && <StepBar steps={['Method', 'To', 'Amount', 'Done']} at={step === 'method' ? 0 : step === 'to' ? 1 : 2} />}
      {test && step !== 'done' && (
        <div className="mb-4">
          <TestModeHint>Test wallet: try it. Nothing real moves.</TestModeHint>
        </div>
      )}

      {step === 'method' && (
        <div className="rise">
          <div className="mb-2 text-[13px] text-muted">How do you want to send it?</div>
          <div className="divide-y divide-soft overflow-hidden rounded-[10px] border border-line">
            <PlaceRow
              selected={kind === 'bank'}
              onClick={() => setKind('bank')}
              icon={<PlaceBadge src="/brand/bank.png" />}
              title="Bank transfer"
              sub={`Naira to your bank, within 24 hours · ${ngn(fee).replace('.00', '')} fee`}
            />
            <PlaceRow selected={kind === 'mm'} onClick={() => setKind('mm')} icon={<PayIcon method="app" asset="USDC" size={32} />} title="Money Moves" sub="To your Money Moves account, in seconds · free" />
            <PlaceRow selected={kind === 'crypto'} onClick={() => setKind('crypto')} icon={<PlaceBadge src="/brand/wallet.png" />} title="Crypto wallet" sub="USDC or USDT to a wallet, in seconds · network fee only" />
          </div>
        </div>
      )}

      {step === 'to' && (
        <div className="rise space-y-4">
          {kind === 'bank' && (
          <PlaceGroup title={places.banks.length > 1 ? 'Your bank accounts' : 'Your bank account'} note={`${ngn(fee).replace('.00', '')} per transfer · within 24 hours`}>
            {places.banks.length ? (
              places.banks.map((b) => (
                <PlaceRow
                  key={b.id}
                  selected={pick === `b:${b.id}`}
                  disabled={!b.verified}
                  onClick={() => setPick(`b:${b.id}`)}
                  icon={<PlaceBadge src="/brand/bank.png" />}
                  title={bankLabel(b)}
                  sub={b.verified ? `${b.name}${b.id === mainBank?.id && places.banks.length > 1 ? ' · default' : ''}` : 'We are still checking the name on it'}
                />
              ))
            ) : (
              <Link to="/settings/settlement" className="flex items-center gap-3 px-3.5 py-3 text-[13px] text-muted hover:bg-[#FAFAF8] hover:text-fg">
                <Plus className="size-4" /> Add a bank account in Payout places
              </Link>
            )}
          </PlaceGroup>

          )}
          {kind === 'mm' && (
          <PlaceGroup title={places.mms.length > 1 ? 'Your Money Moves accounts' : 'Your Money Moves account'} note="Free · in seconds">
            {places.mms.length ? (
              places.mms.map((m) => (
                <PlaceRow
                  key={m.id}
                  selected={pick === `m:${m.id}`}
                  disabled={!m.linked}
                  onClick={() => setPick(`m:${m.id}`)}
                  icon={<PayIcon method="app" asset="USDC" size={32} />}
                  title={m.username}
                  sub={m.linked ? `Your Money Moves account${m.id === mainMm?.id && places.mms.length > 1 ? ' · default' : ''}` : 'Approve the link in the app first'}
                />
              ))
            ) : (
              <Link to="/settings/settlement" className="flex items-center gap-3 px-3.5 py-3 text-[13px] text-muted hover:bg-[#FAFAF8] hover:text-fg">
                <Plus className="size-4" /> Link your Money Moves account in Payout places
              </Link>
            )}
          </PlaceGroup>

          )}
          {kind === 'crypto' && (
          <PlaceGroup title="Your crypto wallets" note="Network fee only · in seconds">
            {places.wallets.map((w, i) => (
              <PlaceRow
                key={w.address}
                selected={pick === `w:${i}`}
                onClick={() => setPick(`w:${i}`)}
                icon={<PlaceBadge src="/brand/wallet.png" chain={w.chain} />}
                title={w.label}
                sub={`${short(w.address, 8, 6)} · ${w.chain}`}
              />
            ))}
            <PlaceRow
              selected={pick === 'new'}
              onClick={() => setPick('new')}
              icon={<span className="flex size-8 items-center justify-center rounded-full border border-dashed border-[#CFCCC3] text-muted"><Plus className="size-4" /></span>}
              title="Another address"
              sub="Paste a wallet address"
            />
            {pick === 'new' && (
              <div className="space-y-3 bg-[#FAFAF8] px-3.5 pb-3.5 pt-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_1fr]">
                  <Field label="Network">
                    <Select value={fresh.chain} onChange={(e) => setFresh((f) => ({ ...f, chain: e.target.value as Chain }))}>
                      {chains.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Address">
                    <Input value={fresh.address} onChange={(e) => setFresh((f) => ({ ...f, address: e.target.value }))} placeholder={fresh.chain === 'Solana' ? 'Solana address' : fresh.chain === 'TON' ? 'UQ…' : fresh.chain === 'Stellar' ? 'G…' : '0x…'} className="font-mono text-[13px]" autoFocus />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Checkbox checked={fresh.save} onChange={(v) => setFresh((f) => ({ ...f, save: v }))}>
                    Save it to Payout places
                  </Checkbox>
                  {fresh.save && (
                    <Input value={fresh.label} onChange={(e) => setFresh((f) => ({ ...f, label: e.target.value }))} placeholder="Name it, e.g. Treasury" className="h-9 max-w-[220px] text-[13px]" />
                  )}
                </div>
              </div>
            )}
          </PlaceGroup>
          )}
          <p className="text-[12.5px] text-dim">
            Only your own accounts for now. Manage them in{' '}
            <Link to="/settings/settlement" className="text-muted underline underline-offset-2 hover:text-fg">
              Payout places
            </Link>
            .
          </p>
        </div>
      )}

      {(step === 'amount' || step === 'signing') && (
        <div className={cx('rise', step === 'signing' && 'pointer-events-none opacity-60')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-muted">
              To <span className="font-medium text-fg">{toLabel}</span>
            </span>
            <Segmented
              value={cur}
              onChange={(c: 'NGN' | 'USD') => {
                // Keep what's typed meaning the same money in the other currency.
                if (typed) setAmt(c === 'USD' ? String(Math.round((typed / NGN_RATE) * 100) / 100) : String(Math.round(typed * NGN_RATE)))
                setCur(c)
              }}
              options={[
                { id: 'NGN', label: '₦ Naira' },
                { id: 'USD', label: '$ Dollars' },
              ]}
            />
          </div>

          <label className="mt-6 flex cursor-text items-baseline justify-center gap-1">
            <span className="display text-[30px] font-semibold text-dim">{cur === 'NGN' ? '₦' : '$'}</span>
            <input
              value={shown}
              onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
              placeholder="0"
              inputMode="decimal"
              autoFocus
              style={{ width: `${Math.max(1, shown.length || 1) + 0.6}ch` }}
              className={cx('display tabular min-w-0 max-w-full bg-transparent text-[46px] font-semibold leading-none tracking-[-0.03em] outline-none placeholder:text-[#CFCCC3]', over && typed ? 'text-red' : 'text-fg')}
            />
          </label>
          <div className="mt-2 text-center text-[13px] text-dim">
            {over && typed && from
              ? `More than the ${usd(available)} in the coins you picked`
              : kind === 'bank'
                ? cur === 'NGN'
                  ? `You send ${usd(sendUsd)}, fee included`
                  : `≈ ${ngn(bankGets)} after the fee`
                : cur === 'NGN'
                  ? `≈ ${usd(sendUsd)}`
                  : `≈ ${ngn(typed * NGN_RATE)}`}
          </div>

          <div className="mt-6">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-fg">{multi ? 'Sell from' : 'Send from'}</span>
              <div className="flex items-center gap-2">
                {multi && eligible.length > 1 && (
                  <button
                    onClick={() => setPicked(allPicked ? [keyOf(byBiggest[0]!)] : byBiggest.map(keyOf))}
                    className={cx(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition',
                      allPicked ? 'border-fg bg-fg text-white' : 'border-line bg-card text-muted hover:border-[#D3D0C7] hover:text-fg',
                    )}
                  >
                    {allPicked && <Check className="size-3.5" strokeWidth={3} />}
                    {allPicked ? 'All selected' : 'Select all'}
                  </button>
                )}
                <button
                  onClick={() => {
                    // Every coin, and every bit of it.
                    const pool = multi ? byBiggest : chosen
                    const total = Math.round(pool.reduce((a, h) => a + h.amount, 0) * 100) / 100
                    if (multi) setPicked(byBiggest.map(keyOf))
                    setAmt(cur === 'USD' ? String(total) : String(Math.floor(total * NGN_RATE - (kind === 'bank' ? fee : 0))))
                  }}
                  className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-[12.5px] font-medium text-muted transition hover:border-[#D3D0C7] hover:text-fg"
                >
                  Send all
                </button>
              </div>
            </div>
            {eligible.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-4 py-3 text-[13px] text-muted">Nothing in your wallet on {wallet?.chain} to send there.</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5 pt-1.5">
                  {byBiggest.map((h) => {
                    const on = chosen.some((c) => keyOf(c) === keyOf(h))
                    const leg = legs.find((l) => l.asset === h.asset && l.chain === h.chain)
                    return (
                      <button
                        key={keyOf(h)}
                        onClick={() => toggle(h)}
                        className={cx(
                          'relative flex min-w-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition',
                          on ? 'border-fg bg-card shadow-[0_0_0_1px_#121210]' : 'border-line bg-[#FAFAF8] hover:border-[#D3D0C7] hover:bg-card',
                        )}
                      >
                        {/* The tick sits on the corner, so both lines keep their room. */}
                        <span
                          className={cx(
                            'absolute -right-1.5 -top-1.5 flex size-[18px] items-center justify-center border-2 border-card transition',
                            multi ? 'rounded-[5px]' : 'rounded-full',
                            on ? 'bg-fg' : 'bg-[#D6D3CA]',
                          )}
                        >
                          {on && <Check className="size-2.5 text-white" strokeWidth={4} />}
                        </span>
                        <span className={cx('shrink-0', !on && 'opacity-60')}>
                          <TokenIcon asset={h.asset} chain={h.chain} size={30} />
                        </span>
                        <span className={cx('min-w-0 flex-1', !on && 'opacity-60')}>
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold text-fg">{h.asset}</span>
                            <span className="tabular shrink-0 text-[13px] text-fg">{h.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                          </span>
                          <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px]">
                            <span className="truncate text-dim">
                              {h.chain}
                              <span className="hidden sm:inline"> · ≈ ₦{Math.round(h.amount * NGN_RATE).toLocaleString('en-NG')}</span>
                            </span>
                            {leg ? (
                              <span className="tabular shrink-0 font-medium text-fg">−{leg.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                            ) : on && typed ? (
                              <span className="shrink-0 text-dim">unused</span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 rounded-[10px] bg-raise px-3.5 py-2 text-[12.5px]">
                  <span className="text-muted">{legs.length ? `Selling ${usd(sendUsd)} from ${legs.length} coin${legs.length === 1 ? '' : 's'}` : 'Type an amount above'}</span>
                  <span className="tabular text-muted">
                    <span className={cx('font-medium', over && typed ? 'text-red' : 'text-fg')}>{usd(available)}</span> available
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="mt-5 rounded-[10px] bg-raise px-4 py-1 text-[13.5px]">
            {kind === 'bank' ? (
              <>
                <div className="flex justify-between gap-4 py-2">
                  <span className="text-muted">Rate</span>
                  <span className="tabular text-fg">₦{NGN_RATE.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-4 py-2">
                  <span className="text-muted">Transfer fee</span>
                  <span className="tabular text-fg">{ngn(fee)}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
                  <span className="text-fg">{toLabel} gets</span>
                  <span className="tabular text-fg">{ngn(typed ? bankGets : 0)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-4 py-2">
                  <span className="text-muted">{kind === 'mm' ? 'Fee' : 'Network fee'}</span>
                  <span className={kind === 'mm' ? 'text-good' : 'text-fg'}>{kind === 'mm' ? 'Free' : 'Paid from your wallet, usually under $0.05'}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
                  <span className="truncate text-fg">{toLabel} gets</span>
                  <span className="tabular text-right text-fg">{legs.length ? usd(sendUsd) : '-'}</span>
                </div>
              </>
            )}
          </div>
          {step === 'signing' && (
            <div className="mt-3 flex items-center gap-2 text-[13px] text-fg">
              <Loader2 className="size-4 animate-spin" /> Confirm it in your wallet…
            </div>
          )}
        </div>
      )}

      {step === 'done' && sent && (
        <div className="rise">
          <div className="overflow-hidden rounded-[14px] border border-line">
            <div className="px-5 pb-5 pt-6 text-center">
              <span className="pop mx-auto flex size-11 items-center justify-center rounded-full bg-lime">
                <Check className="size-5 text-fg" strokeWidth={3} />
              </span>
              <div className="mt-3 text-[13px] text-muted">
                {kind === 'bank' ? 'On its way to' : 'Sent to'} <span className="font-medium text-fg">{toLabel}</span>
              </div>
              <div className="display tabular mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.03em] text-fg">{kind === 'bank' ? ngn(bankGets) : usd(sentTotal)}</div>
              <div className="tabular mt-2 text-[12.5px] text-dim">{kind === 'bank' ? `≈ ${usd(sentTotal)} · arrives by ${dateTime(by)}` : `≈ ${ngn(sentTotal * NGN_RATE)} · ${dateTime(sent[0]!.createdAt)}`}</div>
            </div>

            <div className="border-t border-dashed border-[#D6D3CA] bg-[#FAFAF8] px-5 py-4 text-[13px]">
              <div className="flex items-start justify-between gap-4">
                <span className="text-dim">To</span>
                <span className="min-w-0 text-right">
                  <span className="block font-medium text-fg">{toLabel}</span>
                  <span className="block truncate text-[12px] text-dim">
                    {kind === 'bank' ? bank?.name : kind === 'mm' ? 'Money Moves account' : wallet ? `${short(wallet.address, 8, 6)} · ${wallet.chain}` : ''}
                  </span>
                </span>
              </div>

              <div className="mt-3.5 border-t border-line pt-3.5">
                <div className="mb-2 text-dim">{kind === 'bank' ? 'Sold from your wallet' : 'Sent from your wallet'}</div>
                <div className="space-y-2">
                  {sent.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5">
                      <TokenIcon asset={m.asset} chain={m.chain} size={20} />
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {m.asset} <span className="text-dim">on {m.chain}</span>
                      </span>
                      <span className="tabular text-fg">{m.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3.5 space-y-2 border-t border-line pt-3.5">
                {kind === 'bank' && (
                  <div className="flex justify-between gap-4">
                    <span className="text-dim">Rate</span>
                    <span className="tabular text-fg">₦{NGN_RATE.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-dim">Fee</span>
                  <span className={cx('tabular', kind === 'mm' ? 'text-good' : 'text-fg')}>{kind === 'bank' ? ngn(fee) : kind === 'mm' ? 'Free' : 'Network fee only'}</span>
                </div>
                <div className="flex justify-between gap-4 text-[13.5px] font-semibold">
                  <span className="text-fg">{kind === 'bank' ? 'Bank receives' : 'They receive'}</span>
                  <span className="tabular text-fg">{kind === 'bank' ? ngn(bankGets) : usd(sentTotal)}</span>
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-between gap-4 border-t border-line pt-3.5">
                <span className="text-dim">Reference</span>
                <span className="font-mono text-[12.5px] text-fg">{receiptRef}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}>
              Download receipt
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
