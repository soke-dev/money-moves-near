/**
 * Reports, for the business's books: exports of payments, settlements,
 * refunds and disputes for any dates, and a statement for each month. In the
 * mode you're in: test mode reports test money.
 */
import { useState } from 'react'
import { Download, FileText } from '@/components/icons'
import { Button, Card, Empty, Field, Input, PageHeader, Segmented, cx } from '@/components/ui'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { ApiError, LIVE, api } from '@/lib/api'
import { downloadCsv } from '@/lib/csv'
import { statementPdf, type Statement } from '@/lib/statement'
import { useSession } from '@/state/session'

type Kind = 'payments' | 'settlements' | 'refunds' | 'disputes'
type Preset = 'this_month' | 'last_month' | '30d' | 'this_year' | 'custom'

const KINDS: { id: Kind; label: string; sub: string }[] = [
  { id: 'payments', label: 'Payments', sub: 'Every payment that came in: who, how, the fee, and where it settled.' },
  { id: 'settlements', label: 'Settlements', sub: 'What was sent where: bank, business wallet or Money Moves.' },
  { id: 'refunds', label: 'Refunds', sub: 'Refunds asked for, funded and completed.' },
  { id: 'disputes', label: 'Disputes', sub: 'Disputes and bank claims, and how they closed.' },
]

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
  if (p === 'this_year') return { from: lagosMidnight(t.y, 0, 1), to: lagosMidnight(t.y, t.m, t.d + 1) }
  if (!from || !to) return null
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number]
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number]
  return { from: lagosMidnight(fy, fm - 1, fd), to: lagosMidnight(ty, tm - 1, td + 1) }
}

const stamp = (d: Date) => new Date(d.getTime() + LAGOS).toISOString().slice(0, 10)
const label = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const when = (v: string) => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })

export function Reports() {
  const { business, mode } = useSession()
  const { test } = useTestMode()
  const [kind, setKind] = useState<Kind>('payments')
  const [preset, setPreset] = useState<Preset>('last_month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  if (!LIVE || !business) {
    return (
      <>
        <PageHeader title="Reports" sub="Exports and monthly statements for your books." />
        <Empty title="Reports show here once you're live." sub="Payments, settlements, refunds and disputes for any dates, and a statement for each month." />
      </>
    )
  }
  const base = `/businesses/${business.id}/reports`
  const range = rangeOf(preset, from, to)

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

  // The last twelve months, this one first.
  const t = lagosToday()
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(t.y, t.m - i, 15))
    const id = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    return { id, name: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), current: i === 0 }
  })

  return (
    <>
      <PageHeader title="Reports" sub="Exports and monthly statements for your books, in Lagos time." />
      {test && (
        <div className="mb-5">
          <TestModeHint>Test mode: these are your test payments. Switch to live mode for real ones.</TestModeHint>
        </div>
      )}
      {error && <p className="mb-4 text-[13px] text-red">{error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Card className="p-5 sm:p-6">
          <div className="text-[15px] font-semibold text-fg">Export</div>
          <p className="mt-1 text-[13px] text-muted">A CSV that opens in Excel, Google Sheets or your accounting software.</p>
          <div className="mt-4 space-y-2">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className={cx('flex w-full items-start gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition', kind === k.id ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
              >
                <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', kind === k.id ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>{kind === k.id && <span className="size-1.5 rounded-full bg-white" />}</span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-fg">{k.label}</span>
                  <span className="block text-[12.5px] text-dim">{k.sub}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            <div className="mb-2 text-[13px] font-medium text-fg">Dates</div>
            <Segmented
              value={preset}
              onChange={(p: Preset) => setPreset(p)}
              options={[
                { id: 'this_month', label: 'This month' },
                { id: 'last_month', label: 'Last month' },
                { id: '30d', label: 'Last 30 days' },
                { id: 'this_year', label: 'This year' },
                { id: 'custom', label: 'Pick dates' },
              ]}
            />
            {preset === 'custom' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="From">
                  <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="To">
                  <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" icon={<Download className="size-4" />} disabled={!range || !!busy} onClick={() => void exportCsv()}>
              {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
            </Button>
            {note && <span className="text-[13px] text-muted">{note}</span>}
          </div>
        </Card>

        <Card className="p-5 sm:p-6">
          <div className="text-[15px] font-semibold text-fg">Monthly statements</div>
          <p className="mt-1 text-[13px] text-muted">A PDF for each month: money in, our fees, refunds and what settled where, with every payment listed.</p>
          <ol className="mt-4 divide-y divide-soft overflow-hidden rounded-[10px] border border-line">
            {months.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <FileText className="size-4 shrink-0 text-dim" />
                <span className="min-w-0 flex-1 text-[13.5px] text-fg">
                  {m.name}
                  {m.current && <span className="ml-1.5 text-[12px] text-dim">so far</span>}
                </span>
                <Button size="sm" disabled={!!busy} onClick={() => void statement(m.id)}>
                  {busy === m.id ? 'Making…' : 'PDF'}
                </Button>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  )
}
