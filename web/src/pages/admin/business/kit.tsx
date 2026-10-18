/**
 * The Business side's parts.
 *
 * Same palette as the rest of the console, a different voice: the type of the
 * Business product (Host Grotesk, with IBM Plex Mono only for references and
 * IDs), labels in sentence case, figures in tabular numerals, hairlines
 * instead of boxes, and lime spent on the one action that matters on a page.
 *
 * Records are pages, not windows. Tables are real tables on a desk and fold
 * into rows on a phone - the same column list drives both, so neither drifts.
 */
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { Check, Copy as CopyIcon } from 'lucide-react'
import { C, ago } from '../ui'
import { BizError, bizChanged, type AppStatus, type BizStatus, type IdStatus, type Pay, type Settle } from './client'

export const SANS = "'Host Grotesk', ui-sans-serif, system-ui, sans-serif"
export const PLEX = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"

/* ─── Numbers and dates ────────────────────────────────────────────── */

/** Naira, with kobo only when there are some. */
export const naira = (n: number | null | undefined) =>
  n == null ? '—' : `₦${n.toLocaleString('en-NG', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
export const dayDate = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** A time, as "2h ago" - the full date and time on hover. */
export function When({ at, full }: { at: string | null | undefined; full?: boolean }) {
  if (!at) return <span style={{ color: C.dim }}>—</span>
  return (
    <time dateTime={at} title={stamp(at)} className="whitespace-nowrap">
      {full ? stamp(at) : ago(at)}
    </time>
  )
}

/* ─── Type ─────────────────────────────────────────────────────────── */

export function Ref({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return (
    <span className="text-[12.5px] tracking-[-0.01em]" style={{ fontFamily: PLEX, color: dim ? C.muted : C.text }}>
      {children}
    </span>
  )
}

export function Dim({ children }: { children: ReactNode }) {
  return <span style={{ color: C.dim }}>{children}</span>
}

/** Copies a reference or an ID. Not for use inside a clickable row. */
export function Copy({ text, children }: { text: string; children?: ReactNode }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        })
      }}
      className="group inline-flex items-center gap-1.5 rounded-md -mx-1 px-1 py-0.5 transition-colors hover:bg-white/[0.05]"
      title="Copy"
    >
      <span style={{ fontFamily: PLEX, color: C.text }} className="text-[12.5px]">
        {children ?? text}
      </span>
      {done ? <Check size={12} color={C.lime} /> : <CopyIcon size={12} color={C.dim} className="opacity-60 group-hover:opacity-100" />}
    </button>
  )
}

/* ─── State ────────────────────────────────────────────────────────── */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'idle'
const TONE: Record<Tone, string> = { good: C.lime, warn: C.amber, bad: C.red, info: C.blue, idle: C.dim }
export const toneColor = (t: Tone = 'idle') => TONE[t]

/** A state: a dot and a word. Only trouble is coloured; good news stays quiet. */
export function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  const color = tone === 'bad' ? C.red : tone === 'warn' ? C.amber : tone === 'idle' ? C.muted : C.text
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap" style={{ color }}>
      <span className="size-[7px] rounded-full shrink-0" style={{ background: TONE[tone] }} />
      {children}
    </span>
  )
}

const BIZ: Record<BizStatus, [Tone, string]> = { UNVERIFIED: ['idle', 'Unverified'], IN_REVIEW: ['warn', 'In review'], VERIFIED: ['good', 'Verified'], SUSPENDED: ['bad', 'Deactivated'] }
const PAY: Record<Pay['status'], [Tone, string]> = { OPEN: ['idle', 'Waiting'], PAID: ['good', 'Paid'], UNDERPAID: ['warn', 'Arrived short'], EXPIRED: ['idle', 'Expired'] }
const SETTLE: Record<Settle['status'], [Tone, string]> = {
  QUEUED: ['info', 'Queued'],
  SENDING: ['info', 'Sending'],
  SENT: ['info', 'Sent'],
  SETTLED: ['good', 'Settled'],
  FAILED: ['bad', 'Failed'],
  HELD: ['warn', 'Held'],
  REVIEW: ['warn', 'To review'],
}
const APP: Record<AppStatus, [Tone, string]> = {
  DRAFT: ['idle', 'Not submitted'],
  SUBMITTED: ['warn', 'Waiting for review'],
  IN_REVIEW: ['info', 'In review'],
  CHANGES_REQUESTED: ['warn', 'Changes asked'],
  APPROVED: ['good', 'Approved'],
  REJECTED: ['bad', 'Turned down'],
}
const ID: Record<IdStatus, [Tone, string]> = {
  PENDING: ['idle', 'Started, not finished'],
  IN_REVIEW: ['warn', 'Under review'],
  APPROVED: ['good', 'Identity verified'],
  DECLINED: ['bad', 'Identity declined'],
}

export const BizState = ({ status }: { status: BizStatus }) => <State tone={BIZ[status][0]}>{BIZ[status][1]}</State>
export const PayState = ({ status }: { status: Pay['status'] }) => <State tone={PAY[status][0]}>{PAY[status][1]}</State>
export const settleTone = (s: Pick<Settle, 'status' | 'stuck'>): Tone => (s.stuck ? 'bad' : SETTLE[s.status][0])
export const SettleState = ({ s }: { s: Pick<Settle, 'status' | 'stuck'> }) => <State tone={settleTone(s)}>{s.stuck ? 'Stuck' : SETTLE[s.status][1]}</State>
export const AppState = ({ status }: { status: AppStatus }) => <State tone={APP[status][0]}>{APP[status][1]}</State>
export const IdState = ({ status }: { status: IdStatus }) => <State tone={ID[status][0]}>{ID[status][1]}</State>
export const bizWord = (s: BizStatus) => BIZ[s][1]

/** A small label: "Test", "Default". */
export function Tag({ children, tone }: { children: ReactNode; tone?: Tone }) {
  const color = tone ? toneColor(tone) : C.muted
  return (
    <span
      className="inline-flex items-center h-[19px] px-1.5 rounded-[5px] text-[11px] font-medium whitespace-nowrap"
      style={{ color, background: tone ? `${color}14` : 'rgba(255,255,255,0.05)', border: `1px solid ${tone ? `${color}33` : 'rgba(255,255,255,0.06)'}` }}
    >
      {children}
    </span>
  )
}

/* ─── Controls ─────────────────────────────────────────────────────── */

const LOOK = {
  primary: 'bg-[#81FB02] text-[#0A0C08] border-[#81FB02] hover:bg-[#95FF2E]',
  plain: 'bg-[#181C14] text-[#ECEFE7] border-[#262C1F] hover:bg-[#1E2319] hover:border-[#323A28]',
  danger: 'bg-transparent text-[#F87171] border-[#F87171]/35 hover:bg-[#F87171]/[0.07]',
}

export function Button({
  children,
  onClick,
  tone = 'plain',
  disabled,
  type = 'button',
  full,
  small,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: keyof typeof LOOK
  disabled?: boolean
  type?: 'button' | 'submit'
  full?: boolean
  small?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 disabled:pointer-events-none ${small ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13px]'} ${full ? 'w-full' : ''} ${LOOK[tone]}`}
    >
      {children}
    </button>
  )
}

export function TextButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="text-[13px] font-medium text-[#8B9580] hover:text-[#ECEFE7] transition-colors disabled:opacity-40">
      {children}
    </button>
  )
}

const FIELD = 'rounded-lg border border-[#262C1F] bg-[#181C14] text-[#ECEFE7] placeholder:text-[#5C6650] outline-none transition-colors focus:border-[#4C7A17]'

/** `fit` sizes it to its content (or its className) instead of the full width. */
export function Input({ fit, className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement> & { fit?: boolean }) {
  return <input {...props} className={`h-9 px-3 text-[13.5px] ${fit ? '' : 'w-full'} ${FIELD} ${className}`} />
}

export function Textarea({ className = '', ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full px-3 py-2.5 text-[13.5px] leading-relaxed resize-y ${FIELD} ${className}`} />
}

export function Select({ fit, className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { fit?: boolean }) {
  return (
    <select {...props} className={`h-9 px-2.5 text-[13.5px] ${fit ? '' : 'w-full'} ${FIELD} ${className}`}>
      {children}
    </select>
  )
}

/** A record named inside text - a business, a payment - that opens it. */
export function LinkText({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-[#ECEFE7] underline decoration-[#5C6650] underline-offset-[3px] transition-colors hover:decoration-[#ECEFE7]">
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-1.5 text-[12.5px] font-medium" style={{ color: C.muted }}>
        {label}
      </div>
      {children}
      {hint && (
        <div className="mt-1.5 text-[12px]" style={{ color: C.dim }}>
          {hint}
        </div>
      )}
    </label>
  )
}

/** The action password, the same everywhere it's asked for. `full` for a narrow column. */
export function PasswordInput({ value, onChange, full }: { value: string; onChange: (v: string) => void; full?: boolean }) {
  return (
    <Input
      type="password"
      name="action-password"
      autoComplete="new-password"
      placeholder="Action password"
      aria-label="Action password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      fit={!full}
      className={full ? '' : 'w-full sm:w-[220px]'}
    />
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <Input fit type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full min-w-0 flex-1 sm:max-w-[360px]" />
}

/** A few choices side by side. Scrolls sideways on a phone rather than wrapping. */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string, number?])[] }) {
  return (
    <div className="max-w-full overflow-x-auto no-scrollbar">
      <div className="inline-flex p-[3px] rounded-lg" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        {items.map(([id, label, count]) => {
          const on = id === value
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className="h-7 px-2.5 rounded-md text-[12.5px] font-medium whitespace-nowrap transition-colors"
              style={{ background: on ? C.raise : 'transparent', color: on ? C.text : C.muted, boxShadow: on ? `0 0 0 1px ${C.line}` : undefined }}
            >
              {label}
              {count != null && count > 0 && (
                <span className="ml-1.5 tabular-nums" style={{ color: on ? C.muted : C.dim }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A record page's sections. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: readonly (readonly [T, string, number?])[] }) {
  return (
    <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto overflow-y-hidden no-scrollbar" style={{ borderBottom: `1px solid ${C.line}` }}>
      <div className="flex gap-6" role="tablist">
        {items.map(([id, label, count]) => {
          const on = id === value
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(id)}
              className="relative shrink-0 h-11 text-[13.5px] font-medium transition-colors"
              style={{ color: on ? C.text : C.muted }}
            >
              {label}
              {count != null && count > 0 && (
                <span className="ml-1.5 text-[12px] tabular-nums" style={{ color: C.dim }}>
                  {count.toLocaleString()}
                </span>
              )}
              {on && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full" style={{ background: C.lime }} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Surfaces ─────────────────────────────────────────────────────── */

export function Panel({ title, sub, action, children, flush }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  const head = title != null || action != null
  return (
    <section className="rounded-xl min-w-0" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {head && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3" style={{ borderBottom: flush ? `1px solid ${C.line}` : undefined }}>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold tracking-[-0.01em]" style={{ color: C.text }}>
              {title}
            </h3>
            {sub && (
              <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
                {sub}
              </p>
            )}
          </div>
          {action && <div className="shrink-0 flex items-center gap-3 pt-px">{action}</div>}
        </header>
      )}
      <div className={flush ? '' : head ? 'px-4 pb-4' : 'p-4'}>{children}</div>
    </section>
  )
}

/** Labels and values, ruled like a statement. */
export function Facts({ rows, wide }: { rows: ([ReactNode, ReactNode] | null | false | undefined)[]; wide?: boolean }) {
  const shown = rows.filter((r): r is [ReactNode, ReactNode] => !!r)
  return (
    <dl>
      {shown.map(([k, v], i) => (
        <div
          key={i}
          className={`grid gap-x-4 gap-y-0.5 py-2.5 text-[13px] ${wide ? 'sm:grid-cols-[190px_minmax(0,1fr)]' : 'grid-cols-[108px_minmax(0,1fr)]'}`}
          style={{ borderTop: i ? `1px solid ${C.lineSoft}` : undefined }}
        >
          <dt style={{ color: C.muted }}>{k}</dt>
          <dd className="min-w-0 break-words" style={{ color: C.text }}>
            {v == null || v === '' ? <span style={{ color: C.dim }}>—</span> : v}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const FIG_COLS: Record<number, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }

/** A row of figures, ruled apart. */
export function Figures({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }[] }) {
  return (
    <div className={`grid grid-cols-2 gap-px ${FIG_COLS[items.length] ?? 'lg:grid-cols-4'}`} style={{ background: C.line }}>
      {items.map((it) => (
        <div key={it.label} className="px-4 py-3.5 min-w-0" style={{ background: C.card }}>
          <div className="text-[12.5px]" style={{ color: C.muted }}>
            {it.label}
          </div>
          <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] tabular-nums truncate" style={{ color: it.tone && it.tone !== 'good' ? toneColor(it.tone) : C.text }}>
            {it.value}
          </div>
          {it.sub && (
            <div className="mt-0.5 text-[12px] truncate" style={{ color: C.dim }}>
              {it.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })

/** Thirty days of takings, one bar a day. Point at a bar for the day's figures. */
export function Bars({ days, unit = 'paid' }: { days: { day: string; count: number; volumeNgn: number }[]; unit?: string }) {
  const [at, setAt] = useState<number | null>(null)
  const max = Math.max(0, ...days.map((d) => d.volumeNgn))
  const shown = at != null ? days[at] : null
  const total = days.reduce((a, d) => a + d.volumeNgn, 0)
  const count = days.reduce((a, d) => a + d.count, 0)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span style={{ color: C.muted }}>{shown ? shortDay(shown.day) : 'Last 30 days'}</span>
        <span className="tabular-nums" style={{ color: C.text }}>
          {shown ? `${naira(shown.volumeNgn)} · ${shown.count} ${unit}` : `${naira(total)} · ${count} ${unit}`}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-[3px] h-[84px]" onMouseLeave={() => setAt(null)}>
        {days.map((d, i) => (
          <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setAt(i)} onClick={() => setAt(at === i ? null : i)}>
            <div
              className="w-full rounded-[2px] transition-colors"
              style={{
                height: d.volumeNgn && max ? `${Math.max(6, (d.volumeNgn / max) * 100)}%` : '2px',
                background: d.volumeNgn ? (at === i ? C.lime : 'rgba(129,251,2,0.5)') : at === i ? C.dim : C.line,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px]" style={{ color: C.dim }}>
        <span>{days[0] ? shortDay(days[0].day) : ''}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/** Something that wants a person, with the way to it. */
export function Notice({ tone, title, children, action }: { tone: Tone; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl pl-4 pr-3 py-3"
      style={{ background: C.card, border: `1px solid ${C.line}`, boxShadow: `inset 3px 0 0 ${toneColor(tone)}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium" style={{ color: C.text }}>
          {title}
        </div>
        {children && (
          <div className="mt-0.5 text-[12.5px] leading-relaxed break-words" style={{ color: C.muted }}>
            {children}
          </div>
        )}
      </div>
      {action}
    </div>
  )
}

/** A change being made, right where it's asked for: what happens, what it needs, confirm. */
export function ActionPanel({ title, sub, danger, children }: { title: ReactNode; sub?: ReactNode; danger?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-xl p-4 sm:p-5" style={{ background: C.card, border: `1px solid ${danger ? 'rgba(248,113,113,0.35)' : '#2A3122'}` }}>
      <div className="text-[14.5px] font-semibold tracking-[-0.01em]" style={{ color: C.text }}>
        {title}
      </div>
      {sub && (
        <p className="mt-1 text-[13px] leading-relaxed max-w-[68ch]" style={{ color: C.muted }}>
          {sub}
        </p>
      )}
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

/** Where the confirm button goes: password (when it's asked), then the buttons, right-aligned on a desk. */
export function Confirm({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2 pt-1">{children}</div>
}

export function Timeline({ items }: { items: { id: string; title: ReactNode; detail?: ReactNode; by?: ReactNode; at: string; tone?: Tone }[] }) {
  return (
    <ol>
      {items.map((it, i) => (
        <li key={it.id} className="relative pl-6 pb-4 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[4.5px] top-[14px] bottom-0 w-px" style={{ background: C.line }} />}
          <span className="absolute left-0 top-[5px] size-[10px] rounded-full" style={{ background: C.card, border: `2px solid ${it.tone ? toneColor(it.tone) : C.dim}` }} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[13.5px] font-medium" style={{ color: it.tone === 'bad' ? C.red : C.text }}>
              {it.title}
            </span>
            <span className="text-[12px]" style={{ color: C.dim }}>
              <When at={it.at} />
            </span>
          </div>
          {it.detail && (
            <div className="mt-0.5 text-[12.5px] leading-relaxed break-words" style={{ color: C.muted }}>
              {it.detail}
            </div>
          )}
          {it.by && (
            <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
              {it.by}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

/* ─── Tables ───────────────────────────────────────────────────────── */

export type Column<T> = {
  key: string
  head: string
  cell: (row: T) => ReactNode
  /** A CSS grid track. Default: minmax(0,1fr). */
  width?: string
  align?: 'right'
  /** On a phone: the row's title, the line under it, the figure on the right, the small print, or not at all. */
  phone?: 'title' | 'sub' | 'figure' | 'meta' | 'hide'
}

export function Table<T>({
  rows,
  columns,
  rowKey,
  onRow,
  flag,
  empty,
  busy,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRow?: (row: T) => void
  /** Paints the row's edge for anything that needs a person. */
  flag?: (row: T) => Tone | undefined
  empty?: ReactNode
  /** Dims the rows while a new page or filter loads. */
  busy?: boolean
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-[13.5px]" style={{ color: C.dim }}>
        {empty ?? 'Nothing here.'}
      </div>
    )
  }
  const template = columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ')
  const role = (c: Column<T>, i: number) => c.phone ?? (i === 0 ? 'title' : c.align === 'right' ? 'figure' : 'meta')
  const Row = onRow ? 'button' : 'div'
  return (
    <div className="transition-opacity" style={{ opacity: busy ? 0.55 : 1 }}>
      <div className="hidden md:grid items-center gap-x-3 px-4 h-9 text-[12px] font-medium" style={{ gridTemplateColumns: template, color: C.dim, borderBottom: `1px solid ${C.line}` }}>
        {columns.map((c) => (
          <div key={c.key} className={`truncate ${c.align === 'right' ? 'text-right' : ''}`}>
            {c.head}
          </div>
        ))}
      </div>
      {rows.map((r) => {
        const f = flag?.(r)
        const by = (want: string) => columns.filter((c, i) => role(c, i) === want)
        return (
          <Row
            key={rowKey(r)}
            {...(onRow ? { type: 'button' as const, onClick: () => onRow(r) } : {})}
            className={`block w-full text-left ${onRow ? 'transition-colors hover:bg-white/[0.025] cursor-pointer' : ''}`}
            style={{ borderBottom: `1px solid ${C.lineSoft}`, boxShadow: f ? `inset 2px 0 0 ${toneColor(f)}` : undefined }}
          >
            <div className="hidden md:grid items-center gap-x-3 px-4 py-2.5 min-h-[48px] text-[13.5px]" style={{ gridTemplateColumns: template, color: C.text }}>
              {columns.map((c) => (
                <div key={c.key} className={`min-w-0 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.cell(r)}
                </div>
              ))}
            </div>
            <div className="md:hidden px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate" style={{ color: C.text }}>
                    {by('title').map((c) => (
                      <Fragment key={c.key}>{c.cell(r)}</Fragment>
                    ))}
                  </div>
                  {by('sub').length > 0 && (
                    <div className="mt-0.5 text-[12.5px] truncate" style={{ color: C.muted }}>
                      {by('sub').map((c) => (
                        <Fragment key={c.key}>{c.cell(r)}</Fragment>
                      ))}
                    </div>
                  )}
                </div>
                {by('figure').length > 0 && (
                  <div className="shrink-0 text-right text-[14px] font-medium tabular-nums" style={{ color: C.text }}>
                    {by('figure').map((c) => (
                      <div key={c.key}>{c.cell(r)}</div>
                    ))}
                  </div>
                )}
              </div>
              {by('meta').length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: C.dim }}>
                  {by('meta').map((c) => (
                    <span key={c.key} className="min-w-0">
                      {c.cell(r)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </Row>
        )
      })}
    </div>
  )
}

export function Pager({
  page,
  pages,
  total,
  per = 20,
  unit,
  units = `${unit}s`,
  onPage,
}: {
  page: number
  pages: number
  total: number
  per?: number
  unit: string
  units?: string
  onPage: (p: number) => void
}) {
  const from = total ? (page - 1) * per + 1 : 0
  const to = Math.min(total, page * per)
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12.5px]" style={{ color: C.dim }}>
      <span className="tabular-nums">{total ? `${from.toLocaleString()}–${to.toLocaleString()} of ${plural(total, unit, units)}` : `No ${units}`}</span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button small disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button small disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

/* ─── Pages ────────────────────────────────────────────────────────── */

/** A record page's head: what it is, its state and facts, and what can be done to it. */
export function PageHead({ title, meta, actions, children }: { title: ReactNode; meta?: ReactNode[]; actions?: ReactNode; children?: ReactNode }) {
  const shown = (meta ?? []).filter((m) => m != null && m !== false && m !== '')
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1 basis-[320px]">
          <h2 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-[1.15] break-words" style={{ color: C.text }}>
            {title}
          </h2>
          {shown.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]" style={{ color: C.muted }}>
              {shown.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && <span style={{ color: C.dim }}>·</span>}
                  {m}
                </Fragment>
              ))}
            </div>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

/** The IDs under a page's head: label, then the value you can copy. */
export function IdLine({ items }: { items: ([string, ReactNode] | null | false)[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12.5px]">
      {items
        .filter((x): x is [string, ReactNode] => !!x)
        .map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-2 min-w-0">
            <span style={{ color: C.dim }}>{k}</span>
            {v}
          </span>
        ))}
    </div>
  )
}

export function PageLoading() {
  return (
    <div className="animate-pulse" aria-label="Loading">
      <div className="h-8 w-72 max-w-full rounded-lg" style={{ background: C.raise }} />
      <div className="mt-3 h-4 w-96 max-w-full rounded" style={{ background: C.card }} />
      <div className="mt-8 h-11 rounded-lg" style={{ background: C.card }} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-72 rounded-xl" style={{ background: C.card }} />
        <div className="h-72 rounded-xl" style={{ background: C.card }} />
      </div>
    </div>
  )
}

export function ListLoading() {
  return (
    <div className="animate-pulse px-4 py-2" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 my-2 rounded-md" style={{ background: C.raise, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}

/** A failed load, said plainly - with the way back in when the session has ended. */
export function Problem({ error, onRetry }: { error: BizError; onRetry: () => void }) {
  const signedOut = error.code === 'admin_signed_out'
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-[13.5px]" style={{ color: C.red }}>
        {error.message}
      </p>
      <div className="mt-4 flex justify-center">
        {signedOut ? (
          <Button
            tone="primary"
            onClick={() => {
              localStorage.removeItem('mm_admin_token')
              window.location.assign('/admin')
            }}
          >
            Sign in again
          </Button>
        ) : (
          <Button onClick={onRetry}>Try again</Button>
        )}
      </div>
    </div>
  )
}

/** What an action said back: done, or why not. */
export function Said({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className="text-[12.5px]" style={{ color: ok ? C.lime : C.red }}>
      {text}
    </p>
  )
}

/** Runs one change: busy while it goes, what it said after, and everything on screen reads itself again. */
export function useAction(onDone?: () => void) {
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    setSaid(null)
    try {
      await fn()
      setSaid({ ok: true, text: okText })
      onDone?.()
      bizChanged()
      return true
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : String(e) })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, said, run, clear: () => setSaid(null) }
}

/** Debounces a search box: what's typed, and what's been settled on. */
export function useTyped(delay = 300) {
  const [typed, setTyped] = useState('')
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSettled(typed.trim()), delay)
    return () => clearTimeout(t)
  }, [typed, delay])
  return [typed, setTyped, settled] as const
}
