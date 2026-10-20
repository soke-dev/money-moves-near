/**
 * The quiet list pieces the ledger pages share: a plain table, a row count,
 * a filter that opens a short list, tabs underlined, a pill switch, and a
 * money figure with its cents set back.
 */
import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from '@/components/icons'
import { cx } from './ui'

/** A plain table: quiet headings, a line between rows, the whole row clickable. */
export type Col<T> = { head: string; cell: (r: T, i: number) => ReactNode; className?: string; right?: boolean }

export function Rows<T>({
  cols,
  rows,
  keyOf,
  onRow,
  empty,
  min = 640,
  mobile,
  loading,
}: {
  cols: Col<T>[]
  rows: T[]
  keyOf: (r: T) => string
  onRow?: (r: T) => void
  empty?: ReactNode
  min?: number
  /** How one row reads on a phone - a list instead of a table that scrolls sideways. */
  mobile?: (r: T, i: number) => ReactNode
  /** Still on its way: the shape of the list rather than "nothing here". */
  loading?: boolean
}) {
  if (rows.length === 0 && loading) return <ListSkeleton />
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    <>
    {mobile && (
      <div className="mt-3 divide-y divide-soft overflow-hidden rounded-[12px] border border-line bg-card md:hidden">
        {rows.map((r, i) =>
          onRow ? (
            <div key={keyOf(r)} role="button" tabIndex={0} onClick={() => onRow(r)} onKeyDown={(e) => e.key === 'Enter' && onRow(r)} className="cursor-pointer transition active:bg-[#FAFAF8]">
              {mobile(r, i)}
            </div>
          ) : (
            <div key={keyOf(r)}>{mobile(r, i)}</div>
          ),
        )}
      </div>
    )}
    <div className={cx('overflow-x-auto', mobile && 'hidden md:block')}>
      <table className="w-full border-collapse text-left" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line">
            {cols.map((c, i) => (
              <th key={i} className={cx('px-4 pb-2.5 text-[12.5px] font-normal text-dim', c.right && 'text-right', c.className)}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={keyOf(r)} onClick={onRow ? () => onRow(r) : undefined} className={cx('border-b border-soft', onRow && 'cursor-pointer transition hover:bg-[#FAFAF8]')}>
              {cols.map((c, i) => (
                <td key={i} className={cx('px-4 py-3.5 align-middle text-[14px] text-fg', c.right && 'text-right', c.className)}>
                  {c.cell(r, ri)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

/** A day's heading inside a phone list. */
export function DayHead({ children }: { children: ReactNode }) {
  return <div className="border-b border-soft bg-[#FAFAF8] px-4 py-2 text-[12px] font-medium text-dim">{children}</div>
}

/** "1–6 of 6 movements", with the arrows for when there's more than a page. */
export function RowCount({ total, noun }: { total: number; noun: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 text-[13.5px] text-muted">
      <span>{total ? `1–${total} of ${total} ${noun}` : `No ${noun}`}</span>
      <span className="flex gap-0.5">
        <button disabled className="rounded-md p-1 text-[#CFCCC3]" aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </button>
        <button disabled className="rounded-md p-1 text-[#CFCCC3]" aria-label="Next page">
          <ChevronRight className="size-4" />
        </button>
      </span>
    </div>
  )
}

/** A filter as a quiet button that opens a short list. */
export function FilterMenu<T extends string>({ label, value, options, onChange, align = 'left' }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const all = value === options[0]!.id
  const current = options.find((o) => o.id === value)
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cx('flex h-9 items-center gap-2 rounded-[10px] border bg-card px-3 text-[13.5px] text-fg transition', all ? 'border-line hover:border-[#D3D0C7]' : 'border-fg')}>
        {all ? (
          label
        ) : (
          <>
            <span className="text-dim">{label}</span> {current?.label}
          </>
        )}
        <ChevronDown className={cx('size-3.5 text-dim transition', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={cx('rise absolute top-full z-20 mt-1.5 min-w-[200px] overflow-hidden rounded-[10px] border border-line bg-card py-1 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.25)]', align === 'right' ? 'right-0' : 'left-0')}>
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

/** Tabs as words with a line under the one you're on. */
export function UnderlineTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar -mx-1 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 text-[14px] transition', value === t.id ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.label}
          {t.count !== undefined && <span className="text-[12px] font-normal text-dim">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A short choice in a rounded pill: All · USDC · USDT. */
export function PillSwitch<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-card p-0.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-full px-3 py-1 text-[13px] transition', value === o.id ? 'bg-raise font-medium text-fg' : 'text-muted hover:text-fg')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A money figure with its cents set back, the way a statement prints it. */
/** A number still on its way: a bar the figure's own size, gently pulsing. Never a zero that isn't true. */
export function Skel({ w = '4em', className }: { w?: string; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-[0.8em] animate-pulse rounded-[0.25em] bg-raise align-[-0.08em]', className)} style={{ width: w }} />
}

/** Rows still on their way: the shape of a list, before there's anything in it. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-3 divide-y divide-soft overflow-hidden rounded-[12px] border border-line bg-card" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <span className="size-8 shrink-0 animate-pulse rounded-full bg-raise" />
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 animate-pulse rounded bg-raise" style={{ width: `${46 - i * 4}%` }} />
            <span className="block h-2.5 animate-pulse rounded bg-soft" style={{ width: `${28 + i * 3}%` }} />
          </span>
          <span className="h-3 w-16 shrink-0 animate-pulse rounded bg-raise" />
        </div>
      ))}
    </div>
  )
}

export function Figure({ text, className, loading }: { text: string; className?: string; loading?: boolean }) {
  if (loading)
    return (
      <span className={cx('tabular', className)}>
        <Skel w={`${Math.max(3, text.length * 0.55)}em`} />
      </span>
    )
  const i = text.lastIndexOf('.')
  return (
    <span className={cx('tabular', className)}>
      {i < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, i)}
          <span className="opacity-40">{text.slice(i)}</span>
        </>
      )}
    </span>
  )
}
