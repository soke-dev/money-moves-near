import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, Link2, Plus, QrCode, ShieldCheck } from '@/components/icons'
import { useSession } from '@/state/session'
import { useBranding } from '@/state/branding'
import { BALANCES, DESTINATIONS, METHODS, NGN_RATE, type Method } from '@/data/mock'
import { banksOf, readiness, useTargets } from '@/state/targets'
import { LIVE, applicationPath, type ApiApplication } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { usePayments, useSettlements } from '@/state/live'
import { Button, Card, PageHeader, Status, cx } from '@/components/ui'
import { MethodIcon, PayIcon, PlaceMark } from '@/components/brand'
import { Figure, Skel, FilterMenu, PillSwitch } from '@/components/table'
import { ago, ngn, usd } from '@/lib/format'

/** The steps between a new business and its first live payment. */
export function useChecklist() {
  const { business, mode } = useSession()
  const application = useApi<ApiApplication>(LIVE && business ? applicationPath(business.id) : null)
  const appStatus = application.data?.application.status
  const verified = business?.verify === 'verified'
  const changes = !verified && appStatus === 'CHANGES_REQUESTED'
  const reviewing = !verified && !changes && (business?.verify === 'review' || appStatus === 'SUBMITTED' || appStatus === 'IN_REVIEW')
  const [brand] = useBranding(business?.id)
  const [targets] = useTargets(business?.id)
  const { payments } = usePayments()
  // The business wallet: a step only once the business is verified, and only where it's real.
  const wallet = useApi<{ wallet: unknown; exists?: boolean; isOwner: boolean }>(LIVE && verified && business ? `/businesses/${business.id}/wallet` : null)
  const walletStep =
    LIVE && verified
      ? [
          {
            id: 'wallet',
            title: 'Create your business wallet',
            sub: wallet.data?.isOwner === false && !wallet.data?.exists ? 'The owner creates it. Only they can send from it.' : 'Your own wallet for USDC, with a transfer PIN. Takes a minute.',
            done: !!wallet.data?.wallet || !!wallet.data?.exists,
            to: '/balances',
          },
        ]
      : []
  return [
    { id: 'account', title: 'Create your account', sub: 'Email confirmed.', done: true, to: '' },
    {
      id: 'activate',
      title: 'Verify your business',
      sub: changes
        ? 'Our review team asked for a change. Make it and submit again.'
        : reviewing
          ? 'Submitted. Our review team usually responds within 24 hours.'
          : 'Tell us who you are and what your business does. Takes a few minutes.',
      done: verified,
      // Where it stands while it isn't done: with our team, or back with you.
      waiting: reviewing ? 'In review' : undefined,
      action: changes ? 'Make the change' : undefined,
      to: '/verify',
    },
    { id: 'settle', title: 'Add where you get paid', sub: 'Your bank account, and your Money Moves account if you like.', done: LIVE ? banksOf(targets).length > 0 : !!business?.onboarded, to: '/settings/settlement' },
    ...walletStep,
    { id: 'brand', title: 'Brand your checkout', sub: 'Your logo and colours on every payment page.', done: !!brand?.logo, to: '/settings/branding' },
    LIVE
      ? mode === 'live'
        ? { id: 'first', title: 'Receive your first payment', sub: 'From a link, an invoice, an outlet or the API.', done: payments.some((p) => p.status === 'successful'), to: '/collect/links' }
        : { id: 'first', title: 'Take a test payment', sub: 'Make a payment link and pay it with the test buttons.', done: payments.some((p) => p.status === 'successful'), to: '/collect/links' }
      : { id: 'first', title: 'Take a test payment', sub: 'Open a sample checkout and pay it in test mode.', done: false, to: '/pay/demo' },
    { id: 'live', title: 'Go live', sub: 'Switches on once compliance approves you.', done: business?.verify === 'verified', to: '' },
  ]
}

type Range = '7d' | '30d' | '90d'
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 }
const RANGES: { id: Range; label: string }[] = [
  { id: '30d', label: 'Last 30 days' },
  { id: '7d', label: 'Last 7 days' },
  { id: '90d', label: 'Last 90 days' },
]

/** A day's volume, made up until the API returns real ones - and nothing at all before a business is verified. */
function sampleDay(i: number, fresh: boolean) {
  return fresh ? 0 : Math.max(20, Math.round(210 + 95 * Math.sin(i / 3.1) + 55 * Math.sin(i / 1.4 + 2) - i * 1.2))
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function Home() {
  const { business, user, mode } = useSession()
  const navigate = useNavigate()
  const steps = useChecklist()
  const [range, setRange] = useState<Range>('30d')
  const [view, setView] = useState<Range>('30d')
  const [cur, setCur] = useState<'USD' | 'NGN'>('USD')
  const { payments, loading: paying } = usePayments()
  const { settlements, loading: settling } = useSettlements()
  const [targets] = useTargets(business?.id)
  // Live, still on their way: placeholders, never zeros that aren't true.
  const waitPay = LIVE && paying
  const waitSettle = LIVE && settling
  // The business wallet's balance, read from the chains, once it exists.
  const walletBalances = useApi<{ balances: { amount: number }[] }>(LIVE && targets?.businessWallet ? `/businesses/${business?.id}/wallet/balances` : null)
  const walletUsd = (walletBalances.data?.balances ?? []).reduce((t, b) => t + b.amount, 0)

  // Preview: an unverified business has taken no real money, so it starts at zero. Live, it's only ever real payments.
  const fresh = !LIVE && business?.verify === 'unverified'
  const source = fresh ? [] : payments
  const ok = source.filter((p) => p.status === 'successful')
  const sum = (xs: typeof source) => xs.reduce((a, p) => a + p.usd, 0)

  // One series a day for the range: what came in, how many paid, and new customers.
  const series = (r: Range) => {
    const n = RANGE_DAYS[r]
    const step = r === '90d' ? 3 : 1
    const out: { label: string; v: number; count: number; people: number }[] = []
    for (let i = n - 1; i >= 0; i -= step) {
      const d = new Date(Date.now() - i * 86_400_000)
      const that = ok.filter((p) => new Date(p.createdAt).toDateString() === d.toDateString())
      const real = that.reduce((a, p) => a + p.usd, 0)
      // Live, nothing is made up: the day's own payments and the people who made them.
      const v = real + (LIVE ? 0 : sampleDay(i, fresh))
      const count = LIVE ? that.length : Math.round(v / 72)
      const people = LIVE ? new Set(that.map((p) => p.customer.email || p.customer.name)).size : Math.round(v / 190)
      out.push({ label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), v, count, people })
    }
    return out
  }
  const days = useMemo(() => series(range), [range, fresh, payments])
  const over = useMemo(() => series(view), [view, fresh, payments])
  const volume = days.reduce((a, d) => a + d.v, 0)
  const paidCount = days.reduce((a, d) => a + d.count, 0)
  const inNgn = cur === 'NGN'
  // Live, the rate the latest payment was priced at; the sample rate in preview.
  const rate = LIVE && ok[0] ? (ok[0].live?.ngnPerUsd ?? (ok[0].usd > 0 ? ok[0].amount / ok[0].usd : NGN_RATE)) : NGN_RATE
  const money = (n: number) => (inNgn ? ngn(n * rate) : usd(n))
  const otherMoney = (n: number) => (inNgn ? usd(n) : ngn(n * rate))

  if (!business) return null
  const left = steps.filter((s) => !s.done)
  // What's next is what the business can do now - not something waiting on our team.
  const next = left.find((s) => !('waiting' in s && s.waiting))

  // How they paid, from the sample payments.
  const byMethod = (Object.keys(METHODS) as Method[]).map((m) => {
    const v = sum(ok.filter((p) => p.method === m))
    return { m, v, pct: sum(ok) ? Math.round((v / sum(ok)) * 100) : 0 }
  })
  // Where payments stand.
  const groups: { label: string; tone: string; xs: typeof source }[] = [
    { label: 'Successful', tone: 'bg-good', xs: source.filter((p) => p.status === 'successful') },
    { label: 'In progress', tone: 'bg-amber', xs: source.filter((p) => p.status === 'confirming' || p.status === 'pending') },
    { label: 'Underpaid', tone: 'bg-[#C9A227]', xs: source.filter((p) => p.status === 'underpaid') },
    { label: 'Failed', tone: 'bg-red', xs: source.filter((p) => p.status === 'failed') },
  ]
  const allPaid = sum(source) || 1
  // Where the money went - we never keep it.
  const within = fresh ? [] : settlements.filter((s) => Date.now() - new Date(s.createdAt).getTime() <= RANGE_DAYS[view] * 86_400_000)
  const placed = (['bank', 'wallet', 'onchain'] as const).map((d) => {
    const xs = within.filter((s) => s.destination === d && s.status === 'settled')
    return { d, usd: xs.reduce((a, s) => a + s.amountUsd, 0), n: xs.length }
  })
  const settledUsd = placed.reduce((a, p) => a + p.usd, 0)
  const moving = within.filter((s) => s.status !== 'settled')
  const ready = readiness(business, targets ?? {})
  const readyCount = Object.values(ready).filter((r) => r.ready).length
  // The last three months, month by month.
  const months = [2, 1, 0].map((back) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - back)
    const start = new Date(d)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    let v = 0
    if (LIVE) v = ok.filter((p) => new Date(p.createdAt) >= start && new Date(p.createdAt) < end).reduce((a, p) => a + p.usd, 0)
    else
      for (let i = 0; i < 120; i++) {
        const day = new Date(Date.now() - i * 86_400_000)
        if (day >= start && day < end) v += sampleDay(i, fresh)
      }
    return { label: d.toLocaleDateString('en-GB', { month: 'long' }), v }
  })
  const topMonth = Math.max(...months.map((m) => m.v), 1)
  // Live, the business wallet doesn't exist yet.
  const wallet = fresh || LIVE ? 0 : BALANCES.onchain.usd
  const usdcShare = fresh || LIVE ? 0 : Math.round((BALANCES.onchain.holdings.filter((h) => h.asset === 'USDC').reduce((a, h) => a + h.amount, 0) / BALANCES.onchain.usd) * 100)
  const rangeText = `${over[0]?.label} to ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  const card = 'rounded-[14px] border border-line bg-card'

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display text-[28px] font-semibold leading-tight tracking-[-0.03em] text-fg max-md:text-[24px]">
            {greeting()}, {user?.first ?? 'there'}
          </h1>
          <p className="mt-1 truncate text-[13.5px] text-muted">Here's how {business.name} is doing.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/collect/outlets')} icon={<QrCode className="size-4" />}>
            Store QR
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/collect/links')}>
            Payment link
          </Button>
        </div>
      </div>

      {next && business.verify !== 'verified' && (
        <Link to={next.to || '/getting-started'} className={cx(card, 'mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 transition hover:border-[#D3D0C7]')}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              Setting up · {steps.length - left.length} of {steps.length}
            </div>
            <div className="mt-0.5 text-[15px] font-semibold text-fg">Next: {next.title}</div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-raise sm:w-40">
            <div className="h-full bg-lime" style={{ width: `${((steps.length - left.length) / steps.length) * 100}%` }} />
          </div>
          <span className="flex items-center gap-1 text-[13.5px] font-medium text-fg">
            Continue <ArrowRight className="size-4" />
          </span>
        </Link>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {/* What came in - the number people open the dashboard for */}
        <section className={cx(card, 'p-5')}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13.5px] text-muted">Collected</span>
            <PillSwitch
              value={cur}
              onChange={setCur}
              options={[
                { id: 'USD', label: '$ USD' },
                { id: 'NGN', label: '₦ NGN' },
              ]}
            />
          </div>
          <Figure loading={waitPay} text={money(volume)} className="display mt-2 block text-[40px] font-semibold leading-none tracking-[-0.035em] text-fg max-md:text-[34px]" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <FilterMenu label="Last 30 days" value={range} onChange={setRange} options={RANGES} />
            <span className="tabular text-[12.5px] text-dim">
              {waitPay ? <Skel w="9em" /> : <>≈ {otherMoney(volume)} · {paidCount.toLocaleString()} payments</>}
            </span>
          </div>
          <VolumeChart days={days} cur={cur} rate={rate} />
        </section>

        <div className="flex flex-col gap-4">
          {LIVE ? (
            targets?.businessWallet ? (
              <section className={cx(card, 'p-5')}>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[13.5px] text-muted">
                    Business wallet <ShieldCheck className="size-3.5 text-good" weight="fill" />
                  </span>
                  <Link to="/balances" className="text-[13px] font-medium text-muted hover:text-fg">
                    Open
                  </Link>
                </div>
                <Figure loading={walletBalances.loading} text={money(walletUsd)} className="display mt-2 block text-[28px] font-semibold leading-none tracking-[-0.03em] text-fg" />
                <p className="mt-1.5 text-[12.5px] text-dim">USDC and USDT, read from the chain</p>
              </section>
            ) : (
              <section className={cx(card, 'p-5')}>
                <span className="text-[13.5px] text-muted">Business wallet</span>
                <div className="mt-2 text-[17px] font-semibold text-fg">{business.verify === 'verified' ? 'Ready to create' : 'Opens once you’re approved'}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">A self-custody wallet for keeping payments as USDC or USDT. Until it opens, payments settle to your bank account.</p>
                {business.verify === 'verified' && (
                  <Link to="/balances" className="mt-3 inline-block text-[13px] font-medium text-fg underline underline-offset-2">
                    Create it
                  </Link>
                )}
              </section>
            )
          ) : (
          <section className={cx(card, 'p-5')}>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[13.5px] text-muted">
                Business wallet <ShieldCheck className="size-3.5 text-good" weight="fill" />
              </span>
              <Link to="/balances" className="text-[13px] font-medium text-muted hover:text-fg">
                Open
              </Link>
            </div>
            <Figure text={money(wallet)} className="display mt-2 block text-[28px] font-semibold leading-none tracking-[-0.03em] text-fg" />
            <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-raise">
              {wallet > 0 && (
                <>
                  <div className="bg-fg" style={{ width: `${usdcShare}%` }} />
                  <div className="bg-lime" style={{ width: `${100 - usdcShare}%` }} />
                </>
              )}
            </div>
            <div className="mt-2 flex items-center gap-4 text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-fg" /> USDC {wallet ? `${usdcShare}%` : ''}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-lime ring-1 ring-fg/20" /> USDT {wallet ? `${100 - usdcShare}%` : ''}
              </span>
              <span className="ml-auto text-dim">{wallet ? 'Yours alone' : 'Opens when approved'}</span>
            </div>
            <div className="mt-4 flex gap-2 border-t border-line pt-4">
              <Link to="/balances" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-fg text-[13.5px] font-medium text-white">
                <ArrowUpRight className="size-4" /> Send money
              </Link>
              <Link to="/balances" className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-raise text-[13.5px] font-medium text-fg">
                <ArrowDownLeft className="size-4" /> Receive
              </Link>
            </div>
          </section>
          )}

          <section className={cx(card, 'flex-1 p-5')}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] text-muted">Recent payments</span>
              <Link to="/transactions" className="group flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
                All <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
              </Link>
            </div>
            {source.length === 0 ? (
              <div className="mt-4 text-[13.5px] leading-relaxed text-muted">
                Nothing yet.{' '}
                <Link to={LIVE ? '/collect/links' : '/pay/demo'} className="font-medium text-fg underline underline-offset-2">
                  {LIVE ? 'Make a payment link' : 'Open a test checkout'}
                </Link>{' '}
                and pay it to see one land here.
              </div>
            ) : (
              <div className="mt-2 divide-y divide-soft">
                {source.slice(0, 4).map((p) => (
                  <Link key={p.id} to={`/transactions?q=${p.ref}`} className="flex items-center gap-3 py-2.5">
                    <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-fg">{p.customer.name}</span>
                      <span className="flex items-center gap-1.5 text-[12px] text-dim [&>span:first-child]:text-[12px]">
                        <Status value={p.status} />
                        <span>· {ago(p.createdAt)}</span>
                      </span>
                    </span>
                    <span className={cx('tabular text-[13.5px] font-medium', p.status === 'successful' ? 'text-good' : 'text-fg')}>{money(p.usd)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* The detail, for when there's time */}
      <div className="mt-12 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-fg">Overview</h2>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-dim max-sm:hidden">{rangeText}</span>
          <FilterMenu label="Last 30 days" value={view} onChange={setView} options={RANGES} align="right" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section className={cx(card, 'p-5')}>
          <div className="text-[13.5px] text-muted">Successful payments</div>
          <div className="display tabular mt-2 text-[28px] font-semibold leading-none text-fg">{over.reduce((a, d) => a + d.count, 0).toLocaleString()}</div>
          <Spark values={over.map((d) => d.count)} first={over[0]?.label} />
        </section>

        <section className={cx(card, 'p-5')}>
          <div className="text-[13.5px] text-muted">How customers paid</div>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-raise">
            {byMethod.map(({ m, pct }, i) => (pct > 0 ? <div key={m} style={{ width: `${pct}%` }} className={i === 0 ? 'bg-lime' : i === 1 ? 'bg-fg' : 'bg-[#B9B6AC]'} /> : null))}
          </div>
          <div className="mt-3 divide-y divide-soft">
            {byMethod.map(({ m, v, pct }) => (
              <div key={m} className="flex items-center gap-3 py-2.5">
                <MethodIcon method={m} size={22} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{METHODS[m].short}</span>
                <span className="w-9 text-right text-[12.5px] text-dim">{pct}%</span>
                <span className="tabular text-right text-[13.5px] font-medium text-fg">{money(v)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={cx(card, 'p-5')}>
          <div className="text-[13.5px] text-muted">Payment status</div>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-raise">
            {groups.map((g) => (g.xs.length ? <div key={g.label} className={g.tone} style={{ width: `${(sum(g.xs) / allPaid) * 100}%` }} /> : null))}
          </div>
          <div className="mt-3 divide-y divide-soft">
            {groups.map((g) => (
              <div key={g.label} className="flex items-center gap-3 py-2.5">
                <span className={cx('h-2 w-3.5 rounded-full', g.tone)} />
                <span className="min-w-0 flex-1 text-[13.5px] text-fg">{g.label}</span>
                <span className="text-right">
                  <span className="tabular block text-[13.5px] font-medium text-fg">
                    {money(sum(g.xs))} <span className="font-normal text-dim">({Math.round((sum(g.xs) / allPaid) * 100)}%)</span>
                  </span>
                  <span className="block text-[11.5px] text-dim">
                    {g.xs.length} payment{g.xs.length === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={cx(card, 'flex flex-col p-5')}>
          <div className="text-[13.5px] text-muted">Settled</div>
          <Figure loading={waitSettle} text={money(settledUsd)} className="display mt-2 block text-[28px] font-semibold leading-none text-fg" />
          <div className="mt-1.5 text-[12.5px] text-dim">
            {moving.length ? <span className="text-amber">{money(moving.reduce((a, s) => a + s.amountUsd, 0))} on the way · </span> : null}
            no fees
          </div>
          <div className="mt-3 divide-y divide-soft">
            {placed.map((p) => (
              <Link key={p.d} to="/balances/settlements" className="flex items-center gap-3 py-2.5">
                {p.d === 'wallet' ? (
                  <PlaceMark size={24} />
                ) : (
                  <span className="flex size-6 items-center justify-center rounded-full border border-line">
                    <img src={p.d === 'bank' ? '/brand/bank.png' : '/brand/wallet.png'} alt="" className="size-3" />
                  </span>
                )}
                <span className="min-w-0 flex-1 text-[13.5px] text-fg">{DESTINATIONS[p.d].short}</span>
                <span className="text-[12px] text-dim">{p.n}</span>
                <span className="tabular w-[96px] text-right text-[13.5px] font-medium text-fg">{waitSettle ? <Skel w="4em" /> : money(p.usd)}</span>
              </Link>
            ))}
          </div>
          {mode === 'test' ? (
            <Link to="/balances/settlements" className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-[12.5px]">
              <span className="text-muted">Test payments settle to sandbox accounts</span>
              <span className="font-medium text-good">Ready</span>
            </Link>
          ) : (
            <Link to="/settings/settlement" className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-[12.5px]">
              <span className="text-muted">Payout places ready</span>
              <span className={cx('font-medium', readyCount === Object.keys(ready).length ? 'text-good' : 'text-amber')}>
                {readyCount} of {Object.keys(ready).length}
              </span>
            </Link>
          )}
        </section>

        <section className={cx(card, 'p-5')}>
          <div className="text-[13.5px] text-muted">New customers</div>
          <div className="display tabular mt-2 text-[28px] font-semibold leading-none text-fg">{waitPay ? <Skel w="1.6em" /> : over.reduce((a, d) => a + d.people, 0).toLocaleString()}</div>
          <Spark values={over.map((d) => d.people)} first={over[0]?.label} />
        </section>

        <section className={cx(card, 'p-5')}>
          <div className="text-[13.5px] text-muted">Collected by month</div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {months.map((m, i) => (
              <div key={m.label}>
                <div className="relative h-[120px] overflow-hidden rounded-[10px]" style={m.v ? undefined : { background: 'repeating-linear-gradient(135deg, #EFEEE9 0 6px, transparent 6px 12px)' }}>
                  {m.v > 0 && (
                    <div className={cx('absolute inset-x-0 bottom-0 rounded-[10px]', i === 2 ? 'bg-fg' : 'bg-[#D9D6CC]')} style={{ height: `${Math.max(8, (m.v / topMonth) * 100)}%` }}>
                      {i === 2 && <div className="absolute inset-x-0 top-0 h-1 rounded-t-[10px] bg-lime" />}
                    </div>
                  )}
                </div>
                <div className="mt-2 text-[13px] text-fg">{m.label}</div>
                <Figure loading={waitPay} text={money(m.v)} className="block text-[12px] text-dim" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

/** A small line for a card: ink over a faint lime wash, the range's ends underneath. */
function Spark({ values, first }: { values: number[]; first?: string }) {
  const n = values.length
  const top = Math.max(...values, 1)
  if (values.every((v) => v === 0)) return <div className="mt-4 flex h-[84px] items-center justify-center rounded-[10px] border border-dashed border-[#D6D3CA] text-[12.5px] text-dim">Nothing yet</div>
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  const y = (v: number) => 96 - (v / top) * 88
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')
  return (
    <div className="mt-4">
      <div className="relative h-[84px]">
        {[0, 0.5, 1].map((t) => (
          <div key={t} className={cx('absolute inset-x-0 border-t', t === 1 ? 'border-line' : 'border-dashed border-soft')} style={{ top: `${t * 100}%` }} />
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={`${line} L100,100 L0,100 Z`} fill="#81FB02" fillOpacity={0.12} />
          <path d={line} fill="none" style={{ stroke: 'var(--color-fg)' }} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] text-dim">
        <span>{first}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/** Round a chart's top up to 1, 2 or 5 of something, so the axis reads cleanly. */
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)))
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

const compact = (v: number, sign = '$') =>
  v >= 1_000_000 ? `${sign}${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m` : v >= 1000 ? `${sign}${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `${sign}${Math.round(v)}`

/**
 * Volume as a line, not a wall of bars: an ink stroke over a faint lime wash,
 * with the day under the pointer called out - today until you hover.
 */
function VolumeChart({ days: raw, cur = 'USD', rate = NGN_RATE }: { days: { label: string; v: number }[]; cur?: 'USD' | 'NGN'; rate?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const k = cur === 'NGN' ? rate : 1
  const sign = cur === 'NGN' ? '₦' : '$'
  const days = raw.map((d) => ({ ...d, v: d.v * k }))
  const n = days.length
  if (n === 0) return null
  if (days.every((d) => d.v === 0)) {
    return (
      <div className="mt-6 flex h-[200px] items-center justify-center rounded-[10px] border border-dashed border-[#D6D3CA] text-[13px] text-dim">
        No volume yet. Your first payment draws the line.
      </div>
    )
  }
  const top = niceMax(Math.max(...days.map((d) => d.v), 1))
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  const y = (v: number) => 100 - (v / top) * 100
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.v)}`).join(' ')
  const at = hover ?? n - 1
  const point = days[at]!

  return (
    <div className="mt-6">
      <div className="flex gap-3">
        <div
          className="relative h-[200px] flex-1 cursor-crosshair lg:h-[250px]"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setHover(Math.min(n - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (n - 1)))))
          }}
          onMouseLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((t) => (
            <div key={t} className={cx('absolute inset-x-0 border-t', t === 1 ? 'border-line' : 'border-dashed border-soft')} style={{ top: `${t * 100}%` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <path d={`${line} L100,100 L0,100 Z`} fill="#81FB02" fillOpacity={0.14} />
            <path d={line} fill="none" style={{ stroke: 'var(--color-fg)' }} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-fg/15" style={{ left: `${x(at)}%` }} />
          <span
            className="pointer-events-none absolute size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-lime"
            style={{ left: `${x(at)}%`, top: `${y(point.v)}%` }}
          />
          <div
            className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-fg px-2 py-1 text-[11.5px] text-white shadow-[0_6px_16px_-6px_rgba(18,18,16,0.4)]"
            style={{ left: `clamp(48px, ${x(at)}%, calc(100% - 48px))`, top: `calc(${y(point.v)}% - 34px)` }}
          >
            <span className="tabular font-semibold">{cur === 'NGN' ? ngn(point.v) : usd(point.v)}</span> <span className="text-white/55">{hover === null ? 'today' : point.label}</span>
          </div>
        </div>
        <div className="flex h-[200px] w-10 flex-col justify-between text-right text-[11px] text-dim tabular lg:h-[250px]">
          <span className="-translate-y-1/2">{compact(top, sign)}</span>
          <span>{compact(top / 2, sign)}</span>
          <span className="translate-y-1/2">{sign}0</span>
        </div>
      </div>
      <div className="mr-12 mt-2.5 flex justify-between text-[11.5px] text-dim">
        <span>{days[0]?.label}</span>
        <span>{days[Math.floor((n - 1) / 2)]?.label}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

export function GettingStarted() {
  const { business } = useSession()
  const steps = useChecklist()
  const doneCount = steps.filter((s) => s.done).length
  const nextIdx = steps.findIndex((x) => !x.done && !('waiting' in x && x.waiting))
  if (!business) return null

  return (
    <>
      <PageHeader
        title="Get started"
        sub={`${doneCount} of ${steps.length} done for ${business.name}`}
        actions={
          // Live, a checkout is one of your own links - there's no demo one.
          !LIVE && (
            <Link to="/pay/demo">
              <Button icon={<QrCode className="size-4" />}>Preview checkout</Button>
            </Link>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          {steps.map((s, i) => (
            <div key={s.id} className={cx('flex items-center gap-4 px-5 py-4', i > 0 && 'border-t border-soft', i === nextIdx && 'bg-[#FAFDF5]')}>
              <span
                className={cx(
                  'display flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                  s.done ? 'bg-lime text-fg' : i === nextIdx ? 'bg-fg text-white' : 'border border-line text-dim',
                )}
              >
                {s.done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cx('text-[14.5px] font-medium', s.done ? 'text-dim line-through' : 'text-fg')}>{s.title}</div>
                <div className="mt-0.5 text-[13px] text-dim">{s.sub}</div>
              </div>
              {s.done ? (
                <span className="text-[13px] text-dim">Done</span>
              ) : 'waiting' in s && s.waiting ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#EBD3A6] bg-[#FDF6E7] px-2.5 py-1 text-[12px] font-medium text-[#6E440A]">
                  <span className="size-1.5 rounded-full bg-[#D98E1F]" /> {s.waiting}
                </span>
              ) : s.to ? (
                <Link to={s.to}>
                  <Button size="sm" variant={i === nextIdx ? 'primary' : 'secondary'}>
                    {'action' in s && s.action ? s.action : s.id === 'activate' ? 'Verify' : 'Start'}
                  </Button>
                </Link>
              ) : (
                <span className="text-[13px] text-dim">Waiting</span>
              )}
            </div>
          ))}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-[13px] font-medium text-muted">No code</div>
            <div className="display mt-2 text-[18px] font-semibold text-fg">Share a payment link</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              Make one in a minute and send it on WhatsApp or Instagram. Customers pay by bank transfer, the Money Moves app or crypto.
            </p>
            <Link to="/collect/links">
              <Button className="mt-4" icon={<Link2 className="size-4" />}>Create a link</Button>
            </Link>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] font-medium text-muted">Developers</div>
            <div className="display mt-2 text-[18px] font-semibold text-fg">Add checkout to your site</div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Create checkouts from your own site with your API keys, and get a webhook when each is paid.</p>
            <div className="mt-4 flex gap-2">
              <Link to="/settings/api-keys">
                <Button>API keys</Button>
              </Link>
              <Link to="/settings/webhooks">
                <Button variant="ghost">Webhooks</Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
