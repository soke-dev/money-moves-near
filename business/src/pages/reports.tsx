/**
 * Reports, for the business's books. One set of dates drives the page: what
 * came in, our fees, what went back and what settled, each against the same
 * stretch just before; each day's takings; how customers paid; where it
 * settled; the biggest customers. Then a CSV of any record for those dates,
 * and a PDF statement for each of the last twelve months. In the mode you're
 * in: test mode reports test money.
 */
import { useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Download } from '@/components/icons'
import { Button, Card, Empty, Field, Input, PageHeader, cx } from '@/components/ui'
import { Skel } from '@/components/table'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { ApiError, LIVE, api } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { ngn } from '@/lib/format'
import { useApi } from '@/lib/useApi'
import { statementPdf, type Statement } from '@/lib/statement'
import { useSession } from '@/state/session'

type Kind = 'payments' | 'settlements' | 'refunds' | 'disputes'
type Preset = 'this_month' | 'last_month' | '30d' | '90d' | 'this_year' | 'custom'

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: 'payments', label: 'Payments', sub: 'Who paid, how, the fee, and where it settled.' },
  { id: 'settlements', label: 'Settlements', sub: 'What was sent where: bank, business wallet or Money Moves.' },
  { id: 'refunds', label: 'Refunds', sub: 'Refunds asked for, funded and completed.' },
  { id: 'disputes', label: 'Disputes', sub: 'Disputes and bank claims, and how they closed.' },
]

const PRESETS: { id: Preset; label: string; before: string }[] = [
  { id: 'this_month', label: 'This month', before: 'the month before' },
  { id: 'last_month', label: 'Last month', before: 'the month before' },
  { id: '30d', label: 'Last 30 days', before: 'the 30 days before' },
  { id: '90d', label: 'Last 90 days', before: 'the 90 days before' },
  { id: 'this_year', label: 'This year', before: 'the same stretch before' },
  { id: 'custom', label: 'Pick dates', before: 'the same stretch before' },
]

type Overview = {
  totals: { payments: number; receivedNgn: number; feesNgn: number; netNgn: number; refunds: number; refundedNgn: number; settledNgn: number; customers: number; averageNgn: number }
  previous: { payments: number; receivedNgn: number; feesNgn: number; netNgn: number; refundedNgn: number; settledNgn: number }
  days: { day: string; receivedNgn: number; payments: number }[]
  byMethod: { method: string; payments: number; receivedNgn: number }[]
  settledBy: { to: string; settlements: number; amountNgn: number }[]
  topCustomers: { name: string | null; payments: number; receivedNgn: number }[]
  months: { month: string; payments: number; receivedNgn: number; netNgn: number }[]
  truncated: boolean
}

const LAGOS = 3_600_000
/** Midnight in Lagos, as a moment: the start of a day there. */
const lagosMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - LAGOS)
const lagosToday = () => {
  const t = new Date(Date.now() + LAGOS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }
}

function rangeOf(p: Preset, from: string, to: string): { from: Date; to: Date } | null {
  const t = lagosToday()
  if (p === 'this_month') return { from: lagosMidnight(t.y, t.m, 1), to: lagosMidnight(t.y, t.m, t.d + 1) }
  if (p === 'last_month') return { from: lagosMidnight(t.y, t.m - 1, 1), to: lagosMidnight(t.y, t.m, 1) }
  if (p === '30d') return { from: lagosMidnight(t.y, t.m, t.d - 29), to: lagosMidnight(t.y, t.m, t.d + 1) }
  if (p === '90d') return { from: lagosMidnight(t.y, t.m, t.d - 89), to: lagosMidnight(t.y, t.m, t.d + 1) }
  if (p === 'this_year') return { from: lagosMidnight(t.y, 0, 1), to: lagosMidnight(t.y, t.m, t.d + 1) }
  if (!from || !to || to < from) return null
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return { from: lagosMidnight(fy, fm - 1, fd), to: lagosMidnight(ty, tm - 1, td + 1) }
}

const stamp = (d: Date) => new Date(d.getTime() + LAGOS).toISOString().slice(0, 10)
const label = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const when = (v: string) => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const monthName = (id: string) => new Date(`${id}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const rangeWords = (r: { from: Date; to: Date }) => `${dayName(stamp(r.from))} to ${dayName(stamp(new Date(r.to.getTime() - 1)))}`

export function Reports() {
  const { business, mode } = useSession()
  const { test } = useTestMode()
  const [preset, setPreset] = useState<Preset>('this_month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<Kind>('payments')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [allMonths, setAllMonths] = useState(false)

  const base = business ? `/businesses/${business.id}/reports` : ''
  const range = rangeOf(preset, from, to)
  const overview = useApi<Overview>(LIVE && business && range ? `${base}/overview?${new URLSearchParams({ mode, from: range.from.toISOString(), to: range.to.toISOString() })}` : null)

  if (!LIVE || !business) {
    return (
      <>
        <PageHeader title="Reports" sub="What came in, what went out, and statements for your books." />
        <Empty title="Reports show here once you're live." sub="Payments, settlements, refunds and disputes for any dates, and a statement for each month." />
      </>
    )
  }

  const exportCsv = async () => {
    if (!range) return
    setBusy('csv')
    setError('')
    setNote('')
    try {
      const q = new URLSearchParams({ mode, from: range.from.toISOString(), to: range.to.toISOString() })
      const r = await api<{ rows: Record<string, unknown>[] }>('GET', `${base}/exports/${kind}?${q}`)
      if (!r.rows.length) {
        setNote(`No ${kind} in those dates.`)
        return
      }
      const keys = Object.keys(r.rows[0]!)
      const cell = (v: unknown, k: string) => (v == null ? '' : /_at$/.test(k) && typeof v === 'string' ? when(v) : typeof v === 'number' ? v : String(v))
      downloadCsv(`${kind}-${stamp(range.from)}-to-${stamp(new Date(range.to.getTime() - 1))}${test ? '-test' : ''}.csv`, keys.map(label), r.rows.map((row) => keys.map((k) => cell(row[k], k))))
      setNote(`${r.rows.length.toLocaleString()} ${r.rows.length === 1 ? kind.replace(/s$/, '') : kind} downloaded.`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The export didn't download. Try again in a moment.")
    } finally {
      setBusy('')
    }
  }

  const statement = async (month: string) => {
    setBusy(month)
    setError('')
    try {
      const s = await api<Statement>('GET', `${base}/statements/${month}?mode=${mode}`)
      const url = URL.createObjectURL(statementPdf(s))
      const a = document.createElement('a')
      a.href = url
      a.download = `statement-${business.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${month}${test ? '-test' : ''}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The statement didn't download. Try again in a moment.")
    } finally {
      setBusy('')
    }
  }

  // The last twelve months, this one first, with what each took in.
  const t = lagosToday()
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(t.y, t.m - i, 15))
    const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return { id, current: i === 0, totals: overview.data?.months.find((x) => x.month === id) }
  })

  const o = overview.data
  const loading = !o && !overview.error
  const before = PRESETS.find((p) => p.id === preset)!.before

  return (
    <>
      <PageHeader
        title="Reports"
        sub={range ? `${rangeWords(range)}, in Lagos time.` : 'Pick the dates.'}
        actions={<Menu value={preset} options={PRESETS} onChange={(p) => setPreset(p)} align="right" />}
      />
      {preset === 'custom' && (
        <div className="-mt-2 mb-5 grid max-w-[420px] grid-cols-2 gap-3">
          <Field label="From">
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}
      {test && (
        <div className="mb-5">
          <TestModeHint>Test mode: these are your test payments. Switch to live mode for real ones.</TestModeHint>
        </div>
      )}
      {error && <p className="mb-4 text-[13px] text-red">{error}</p>}
      {overview.error && <p className="mb-4 text-[13px] text-red">{overview.error.message}</p>}

      {/* At a glance: four figures against the stretch before, and the days. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          <Stat label="Received" value={o?.totals.receivedNgn} prev={o?.previous.receivedNgn} before={before} loading={loading} className="border-b border-r border-soft lg:border-b-0" />
          <Stat label="Our fees" value={o?.totals.feesNgn} prev={o?.previous.feesNgn} before={before} loading={loading} upIsBad className="border-b border-soft lg:border-b-0 lg:border-r" />
          <Stat label="Yours after fees" value={o?.totals.netNgn} prev={o?.previous.netNgn} before={before} loading={loading} className="border-r border-soft" />
          <Stat label="Refunded" value={o?.totals.refundedNgn} prev={o?.previous.refundedNgn} before={before} loading={loading} upIsBad />
        </div>
        <div className="border-t border-soft px-5 pb-5 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px] text-muted">
            <span>
              <span className="tabular font-semibold text-fg">{o ? o.totals.payments.toLocaleString() : '…'}</span> payments
            </span>
            <span>
              <span className="tabular font-semibold text-fg">{o ? o.totals.customers.toLocaleString() : '…'}</span> customers
            </span>
            <span>
              <span className="tabular font-semibold text-fg">{o ? ngn(o.totals.averageNgn) : '…'}</span> average payment
            </span>
            <span>
              <span className="tabular font-semibold text-fg">{o ? ngn(o.totals.settledNgn) : '…'}</span> settled
            </span>
          </div>
          {o ? <DayChart days={o.days} /> : <div className="mt-5 h-[200px] animate-pulse rounded-[10px] bg-raise" />}
        </div>
      </Card>

      {/* Where it came from and where it went. */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Breakdown
          title="How customers paid"
          loading={loading}
          rows={(o?.byMethod ?? []).map((m) => ({ name: m.method, count: `${m.payments} ${m.payments === 1 ? 'payment' : 'payments'}`, amount: m.receivedNgn }))}
          empty="No payments in these dates."
        />
        <Breakdown
          title="Where it settled"
          loading={loading}
          rows={(o?.settledBy ?? []).map((s) => ({ name: s.to, count: `${s.settlements} ${s.settlements === 1 ? 'settlement' : 'settlements'}`, amount: s.amountNgn }))}
          empty="Nothing settled in these dates."
        />
        <Card className="p-5">
          <div className="text-[14px] font-semibold text-fg">Top customers</div>
          {loading ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <Skel key={i} w="100%" className="h-5" />
              ))}
            </div>
          ) : !o?.topCustomers.length ? (
            <p className="mt-4 text-[13px] text-dim">No customers in these dates.</p>
          ) : (
            <ol className="mt-3 divide-y divide-soft">
              {o.topCustomers.map((c, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className="tabular w-4 shrink-0 text-[12.5px] text-dim">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-fg">{c.name ?? 'No name given'}</span>
                    <span className="block text-[12px] text-dim">
                      {c.payments} {c.payments === 1 ? 'payment' : 'payments'}
                    </span>
                  </span>
                  <span className="tabular text-[13.5px] font-medium text-fg">{ngn(c.receivedNgn)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* A CSV of any record, for the same dates. */}
      <Card className="mt-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-[52ch]">
            <div className="text-[14px] font-semibold text-fg">Export</div>
            <p className="mt-1 text-[13px] text-muted">
              {KINDS.find((k) => k.id === kind)!.sub} A CSV for {range ? rangeWords(range) : 'the dates you pick'}, for Excel, Google Sheets or your accounting software.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Menu value={kind} options={KINDS} onChange={(k) => { setKind(k); setNote('') }} />
            <Button variant="primary" icon={<Download className="size-4" />} disabled={!range || !!busy} onClick={() => void exportCsv()}>
              {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
            </Button>
          </div>
        </div>
        {note && <p className="mt-3 text-[13px] text-muted">{note}</p>}
      </Card>

      {/* A statement for each month. */}
      <Card className="mt-5 overflow-hidden">
        <div className="px-5 pt-5 sm:px-6">
          <div className="text-[14px] font-semibold text-fg">Monthly statements</div>
          <p className="mt-1 text-[13px] text-muted">A PDF for each month: money in, our fees, refunds and what settled where, with every payment listed.</p>
        </div>
        <div className="mt-4 hidden grid-cols-[1.4fr_1fr_1fr_1fr_88px] gap-3 border-y border-soft bg-raise/60 px-6 py-2 text-[12px] font-medium text-dim sm:grid">
          <span>Month</span>
          <span className="text-right">Payments</span>
          <span className="text-right">Received</span>
          <span className="text-right">After fees</span>
          <span />
        </div>
        <ol className="divide-y divide-soft border-t border-soft sm:border-t-0">
          {months.slice(0, allMonths ? 12 : 6).map((m) => (
            <li key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_88px] sm:px-6">
              <span className="min-w-0">
                <span className="block text-[13.5px] text-fg">
                  {monthName(m.id)}
                  {m.current && <span className="ml-1.5 text-[12px] text-dim">so far</span>}
                </span>
                <span className="block text-[12px] text-dim sm:hidden">
                  {loading ? '…' : m.totals ? `${m.totals.payments} payments · ${ngn(m.totals.receivedNgn)}` : 'No payments'}
                </span>
              </span>
              <span className="tabular hidden text-right text-[13.5px] text-muted sm:block">{loading ? '…' : m.totals ? m.totals.payments.toLocaleString() : ''}</span>
              <span className={cx('tabular hidden text-right text-[13.5px] sm:block', m.totals ? 'text-fg' : 'text-dim')}>{loading ? '…' : m.totals ? ngn(m.totals.receivedNgn) : 'No payments'}</span>
              <span className="tabular hidden text-right text-[13.5px] text-fg sm:block">{loading || !m.totals ? '' : ngn(m.totals.netNgn)}</span>
              <span className="text-right">
                <Button size="sm" icon={busy === m.id ? undefined : <Download className="size-3.5" />} disabled={!!busy} onClick={() => void statement(m.id)}>
                  {busy === m.id ? 'Making…' : 'PDF'}
                </Button>
              </span>
            </li>
          ))}
        </ol>
        {!allMonths && (
          <button onClick={() => setAllMonths(true)} className="w-full border-t border-soft px-5 py-3 text-left text-[13px] font-medium text-muted transition hover:bg-raise hover:text-fg sm:px-6">
            Show all 12 months
          </button>
        )}
      </Card>
    </>
  )
}

/** One figure, and how it moved against the stretch before. */
function Stat({ label, value, prev, before, loading, upIsBad, className }: { label: string; value?: number; prev?: number; before: string; loading: boolean; upIsBad?: boolean; className?: string }) {
  const change = value == null || prev == null ? null : prev === 0 ? (value > 0 ? 'new' : null) : ((value - prev) / prev) * 100
  const up = typeof change === 'number' && change > 0
  const good = upIsBad ? !up : up
  return (
    <div className={cx('min-w-0 px-5 py-4 sm:px-6 sm:py-5', className)}>
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="display tabular mt-1.5 truncate text-[20px] font-semibold tracking-[-0.02em] text-fg sm:text-[24px]">{loading || value == null ? <Skel w="5em" /> : ngn(value)}</div>
      <div className="mt-1 min-h-[18px] text-[12px] text-dim">
        {change === 'new' ? (
          <span>Nothing in {before}</span>
        ) : typeof change === 'number' && Math.abs(change) >= 0.5 ? (
          <span className="inline-flex items-center gap-0.5">
            <span className={cx('inline-flex items-center font-medium', good ? 'text-good' : 'text-red')}>
              {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
              {Math.abs(change) >= 1000 ? '999+' : Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%
            </span>
            <span className="ml-1">vs {before}</span>
          </span>
        ) : typeof change === 'number' ? (
          <span>Same as {before}</span>
        ) : null}
      </div>
    </div>
  )
}

/** A share bar and the rows under it. */
function Breakdown({ title, rows, loading, empty }: { title: string; rows: { name: string; count: string; amount: number }[]; loading: boolean; empty: string }) {
  const total = rows.reduce((t, r) => t + r.amount, 0)
  const TONES = ['bg-lime', 'bg-fg', 'bg-[#B9B6AC]', 'bg-[#DDDAD2]']
  return (
    <Card className="p-5">
      <div className="text-[14px] font-semibold text-fg">{title}</div>
      {loading ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skel key={i} w="100%" className="h-5" />
          ))}
        </div>
      ) : !rows.length || total === 0 ? (
        <p className="mt-4 text-[13px] text-dim">{empty}</p>
      ) : (
        <>
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full bg-raise">
            {rows.map((r, i) => (r.amount > 0 ? <div key={r.name} className={TONES[i % TONES.length]} style={{ width: `${(r.amount / total) * 100}%` }} /> : null))}
          </div>
          <div className="mt-3 divide-y divide-soft">
            {rows.map((r, i) => (
              <div key={r.name} className="flex items-center gap-3 py-2.5">
                <span className={cx('h-2 w-3.5 shrink-0 rounded-full', TONES[i % TONES.length])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-fg">{r.name}</span>
                  <span className="block text-[12px] text-dim">{r.count}</span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-[13.5px] font-medium text-fg">{ngn(r.amount)}</span>
                  <span className="tabular block text-[12px] text-dim">{Math.round((r.amount / total) * 100)}%</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

/** Round a chart's top up to 1, 2 or 5 of something, so the axis reads cleanly. */
function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)))
  return ([1, 2, 5, 10].find((m) => m * p >= v) ?? 10) * p
}
const compact = (v: number) => (v >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m` : v >= 1000 ? `₦${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `₦${Math.round(v)}`)

/** Each day's takings as a line over a faint wash, the day under the pointer called out. */
function DayChart({ days }: { days: Overview['days'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = days.length
  if (n === 0 || days.every((d) => d.receivedNgn === 0)) {
    return <div className="mt-5 flex h-[200px] items-center justify-center rounded-[10px] border border-dashed border-[#D6D3CA] text-[13px] text-dim">No payments in these dates.</div>
  }
  const top = niceMax(Math.max(...days.map((d) => d.receivedNgn), 1))
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100)
  const y = (v: number) => 100 - (v / top) * 100
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.receivedNgn)}`).join(' ')
  const best = days.reduce((b, d, i) => (d.receivedNgn > days[b]!.receivedNgn ? i : b), 0)
  const at = hover ?? best
  const point = days[at]!
  return (
    <div className="mt-5">
      <div className="mb-3 flex min-h-[20px] flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
        <span className="text-dim">{hover === null ? 'Best day' : 'On the day'}</span>
        <span className="text-muted">
          <span className="tabular font-semibold text-fg">{ngn(point.receivedNgn)}</span> · {dayName(point.day)} · {point.payments} {point.payments === 1 ? 'payment' : 'payments'}
        </span>
      </div>
      <div className="flex gap-3">
        <div
          className="relative h-[200px] flex-1 cursor-crosshair touch-pan-y lg:h-[240px]"
          onTouchMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const tx = e.touches[0]!.clientX
            setHover(Math.min(n - 1, Math.max(0, Math.round(((tx - r.left) / r.width) * (n - 1)))))
          }}
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
          <span className="pointer-events-none absolute size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-fg bg-lime" style={{ left: `${x(at)}%`, top: `${y(point.receivedNgn)}%` }} />
        </div>
        <div className="flex h-[200px] w-10 flex-col justify-between text-right text-[11px] text-dim tabular lg:h-[240px]">
          <span className="-translate-y-1/2">{compact(top)}</span>
          <span>{compact(top / 2)}</span>
          <span className="translate-y-1/2">₦0</span>
        </div>
      </div>
      <div className="mr-12 mt-2.5 flex justify-between text-[11.5px] text-dim">
        <span>{dayName(days[0]!.day)}</span>
        {n > 2 && <span>{dayName(days[Math.floor((n - 1) / 2)]!.day)}</span>}
        <span>{dayName(days[n - 1]!.day)}</span>
      </div>
    </div>
  )
}

/** A small menu that always shows what's picked. */
function Menu<T extends string>({ value, options, onChange, align = 'left' }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; align?: 'left' | 'right' }): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((x) => !x)} className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-card px-3 text-[13.5px] font-medium text-fg transition hover:border-[#D3D0C7]">
        {options.find((o) => o.id === value)?.label}
        <ChevronDown className={cx('size-3.5 text-dim transition', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={cx('rise absolute top-full z-20 mt-1.5 min-w-[180px] overflow-hidden rounded-[10px] border border-line bg-card py-1 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.25)]', align === 'right' ? 'right-0' : 'left-0')}>
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id)
                  setOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13.5px] text-fg hover:bg-raise"
              >
                <span className="truncate">{o.label}</span>
                {o.id === value && <Check className="size-4 shrink-0" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
