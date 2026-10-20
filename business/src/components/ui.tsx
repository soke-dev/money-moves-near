/**
 * The shared parts every screen is built from.
 *
 * Ink on paper: black for the action, hairlines for structure, the brand lime
 * only where something is switched on or chosen. One button, one field, one
 * table, one status - used the same way everywhere, so the product reads as
 * one thing rather than a kit of parts.
 */
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Copy, Eye, EyeOff, Search as SearchIcon, X } from '@/components/icons'
import { copy as copyText } from '@/lib/format'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ─── Buttons ──────────────────────────────────────────────────────── */

type Variant = 'primary' | 'lime' | 'secondary' | 'ghost' | 'danger' | 'quiet'

export function Button({
  variant = 'secondary',
  size = 'md',
  full,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
  icon?: ReactNode
}) {
  const sizes = {
    sm: 'h-[30px] px-2.5 text-[13px] gap-1.5',
    md: 'h-[34px] px-3 text-[13.5px] gap-1.5',
    lg: 'h-11 px-5 text-[14.5px] gap-2',
  }
  const variants: Record<Variant, string> = {
    primary: 'bg-fg text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(18,18,16,0.18)] hover:bg-[#2A2A27] disabled:bg-fg/25 disabled:shadow-none',
    lime: 'bg-lime text-fg font-semibold hover:brightness-95 disabled:bg-lime/40',
    secondary: 'border border-line bg-card text-fg font-medium shadow-[0_1px_2px_rgba(18,18,16,0.05)] hover:border-[#D3D0C7] hover:bg-[#FBFBF9]',
    ghost: 'text-muted font-medium hover:text-fg hover:bg-raise',
    danger: 'border border-red/25 bg-card text-red font-medium hover:bg-red/5',
    quiet: 'bg-raise text-fg font-medium hover:bg-[#E9E7E1]',
  }
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-[7px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        sizes[size],
        variants[variant],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}

/* ─── Fields ───────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  optional,
  required,
  aside,
  children,
}: {
  label?: string
  hint?: ReactNode
  error?: string
  optional?: boolean
  /** Marked with a star: it has to be filled in. */
  required?: boolean
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      {label && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium text-fg">
            {label}
            {required && <span className="ml-0.5 text-red" aria-hidden="true">*</span>}
            {optional && <span className="ml-1 font-normal text-dim">optional</span>}
          </span>
          {aside}
        </div>
      )}
      {children}
      {error ? (
        <div className="mt-1.5 text-[12.5px] text-red">{error}</div>
      ) : hint ? (
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-dim">{hint}</div>
      ) : null}
    </label>
  )
}

const control =
  'w-full rounded-[7px] border border-line bg-card px-3 text-[14px] text-fg shadow-[0_1px_2px_rgba(18,18,16,0.03)] placeholder:text-dim outline-none transition-[border-color,box-shadow] hover:border-[#D3D0C7] focus:border-fg focus:shadow-[0_0_0_3px_rgba(129,251,2,0.32)] disabled:bg-raise disabled:text-muted disabled:shadow-none'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, 'h-10', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, 'min-h-[96px] py-2.5', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cx(control, 'h-10 appearance-none pr-9', className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
    </div>
  )
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} className="pr-11" {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-dim hover:text-fg"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

/** Six boxes that behave as one field: typing advances, backspace returns, paste fills. */
export function OtpInput({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  const set = (i: number, d: string) => {
    const next = digits.slice()
    next[i] = d
    onChange(next.join('').slice(0, length))
  }
  return (
    <div className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          inputMode="numeric"
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1)
            set(i, v)
            if (v && i < length - 1) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d && i > 0) refs.current[i - 1]?.focus()
          }}
          onPaste={(e) => {
            const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
            if (p) {
              e.preventDefault()
              onChange(p)
              refs.current[Math.min(p.length, length - 1)]?.focus()
            }
          }}
          className={cx(
            'display h-14 w-full min-w-0 rounded-lg border bg-card text-center text-[24px] font-semibold text-fg outline-none transition focus:border-fg focus:shadow-[0_0_0_3px_rgba(18,18,16,0.06)]',
            d ? 'border-fg' : 'border-line',
          )}
        />
      ))}
    </div>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-relaxed text-muted">
      <span
        className={cx(
          'mt-[3px] flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition',
          checked ? 'border-fg bg-fg' : 'border-[#C9C6BC] bg-card',
        )}
      >
        {checked && <Check className="size-3 text-white" strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export function RadioDot({ on }: { on: boolean }) {
  return (
    <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border transition', on ? 'border-fg bg-fg' : 'border-[#C9C6BC] bg-card')}>
      {on && <span className="size-1.5 rounded-full bg-white" />}
    </span>
  )
}

export function Radio({
  checked,
  onChange,
  children,
  sub,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  children: ReactNode
  sub?: ReactNode
  disabled?: boolean
}) {
  return (
    <button type="button" disabled={disabled} onClick={onChange} className="flex w-full items-start gap-3 py-1.5 text-left disabled:opacity-40">
      <span className="mt-[3px]">
        <RadioDot on={checked} />
      </span>
      <span>
        <span className="block text-[14px] text-fg">{children}</span>
        {sub && <span className="mt-0.5 block text-[13px] text-dim">{sub}</span>}
      </span>
    </button>
  )
}

/** A choice that deserves a sentence. Chosen = an ink outline and a lime tick. */
export function OptionCard({
  selected,
  onClick,
  title,
  sub,
  icon,
  multi,
  badge,
  disabled,
}: {
  selected: boolean
  onClick: () => void
  title: string
  sub?: ReactNode
  icon?: ReactNode
  multi?: boolean
  badge?: ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        'relative flex w-full items-start gap-3.5 rounded-[10px] border bg-card p-4 text-left transition',
        disabled ? 'cursor-not-allowed border-line opacity-55' : selected ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#CFCCC3]',
      )}
    >
      {icon && (
        <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-lg transition', selected ? 'bg-lime text-fg' : 'bg-raise text-muted')}>
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-fg">
          {title}
          {badge}
        </span>
        {sub && <span className="mt-1 block text-[13px] leading-relaxed text-muted">{sub}</span>}
      </span>
      <span
        className={cx(
          'mt-0.5 flex size-[18px] shrink-0 items-center justify-center border transition',
          multi ? 'rounded-[5px]' : 'rounded-full',
          selected ? 'border-fg bg-lime' : 'border-[#C9C6BC]',
        )}
      >
        {selected && <Check className="size-3 text-fg" strokeWidth={3.5} />}
      </span>
    </button>
  )
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        'relative h-[22px] w-[38px] shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'border-fg bg-lime' : 'border-[#CFCCC3] bg-[#E7E5DF]',
      )}
    >
      <span className={cx('absolute top-[2px] size-4 rounded-full transition-all', on ? 'left-[18px] bg-fg' : 'left-[2px] bg-white shadow-sm')} />
    </button>
  )
}

export function SearchBox({
  placeholder = 'Search',
  value,
  onChange,
  className,
  kbd,
}: {
  placeholder?: string
  value?: string
  onChange?: (v: string) => void
  className?: string
  kbd?: string
}) {
  return (
    <div className={cx('relative', className)}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-dim" />
      <input value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} className={cx(control, 'h-9 pl-9 text-[13.5px]', kbd && 'pr-12')} />
      {kbd && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-raise px-1.5 font-mono text-[11px] text-dim">
          {kbd}
        </span>
      )}
    </div>
  )
}

/* ─── Type ─────────────────────────────────────────────────────────── */

/** A section label: quiet, sentence case. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[13px] font-medium text-muted', className)}>{children}</div>
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="display text-[24px] font-semibold leading-tight text-fg">{title}</h1>
        {sub && <p className="mt-1 max-w-[70ch] text-[13.5px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ─── Surfaces ─────────────────────────────────────────────────────── */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-[10px] border border-line bg-card', className)}>{children}</div>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="no-scrollbar mb-6 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-2.5 text-[13.5px] transition',
            value === t.id ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="inline-flex rounded-[8px] bg-raise p-0.5 ring-1 ring-inset ring-line">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'rounded-[6px] px-2.5 py-1 text-[12.5px] transition',
            value === o.id ? 'bg-card font-medium text-fg shadow-[0_1px_2px_rgba(18,18,16,0.08)]' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Where you are in a few steps: a bar per step, the current one named in full. */
export function StepBar({ steps, at }: { steps: string[]; at: number }) {
  return (
    <ol className="mb-6 flex gap-1.5">
      {steps.map((s, i) => (
        <li key={s} className="min-w-0 flex-1">
          <div className={i <= at ? 'h-[3px] rounded-full bg-fg' : 'h-[3px] rounded-full bg-raise'} />
          <div className={i === at ? 'mt-1.5 truncate text-[12px] font-medium text-fg' : 'mt-1.5 truncate text-[12px] text-dim'}>{s}</div>
        </li>
      ))}
    </ol>
  )
}

/* ─── Status ───────────────────────────────────────────────────────── */

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral'

const TONES: Record<Tone, string> = {
  good: 'bg-[#E4F2E8] text-good',
  warn: 'bg-[#FAEFDB] text-amber',
  bad: 'bg-[#F9E3E1] text-red',
  info: 'bg-[#E3ECF8] text-blue',
  neutral: 'bg-raise text-muted',
}

export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-px text-[11.5px] font-medium', TONES[tone])}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

const DOT: Record<Tone, string> = { good: 'bg-good', warn: 'bg-[#D98E1F]', bad: 'bg-red', info: 'bg-blue', neutral: 'bg-dim' }

const STATUS_TONE: Record<string, Tone> = {
  successful: 'good',
  completed: 'good',
  settled: 'good',
  paid: 'good',
  active: 'good',
  verified: 'good',
  delivered: 'good',
  pending: 'warn',
  processing: 'warn',
  confirming: 'warn',
  'in review': 'warn',
  draft: 'neutral',
  expired: 'neutral',
  inactive: 'neutral',
  unpaid: 'info',
  overdue: 'bad',
  sent: 'info',
  failed: 'bad',
  underpaid: 'bad',
  refunded: 'info',
  refunding: 'warn',
  'needs reply': 'warn',
  'under review': 'info',
  won: 'good',
  lost: 'bad',
  blocked: 'bad',
}

/** A status is a word and a dot - no pill, nothing competing with the amount beside it. */
export function Status({ value }: { value: string }) {
  const tone = STATUS_TONE[value.toLowerCase()] ?? 'neutral'
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-fg">
      <span className={cx('size-[7px] rounded-full', DOT[tone])} />
      {value[0]!.toUpperCase() + value.slice(1)}
    </span>
  )
}

/* ─── Table ────────────────────────────────────────────────────────── */

export type Column<T> = {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
  /** On a phone: the row's title, its figure on the right, a detail under it, or left out. */
  mobile?: 'main' | 'side' | 'meta' | 'hide'
}

export function Table<T>({
  columns,
  rows,
  onRow,
  empty,
  rowKey,
  mobile,
}: {
  columns: Column<T>[]
  rows: T[]
  onRow?: (row: T) => void
  empty?: ReactNode
  rowKey: (row: T) => string
  /** How one row reads on a phone. Without it, the columns arrange themselves. */
  mobile?: (row: T) => ReactNode
}) {
  if (rows.length === 0 && empty) return <>{empty}</>
  const main = columns.find((c) => c.mobile === 'main') ?? columns[0]!
  const side = columns.find((c) => c.mobile === 'side') ?? [...columns].reverse().find((c) => c.align === 'right' && c !== main && c.mobile !== 'hide')
  const meta = columns.filter((c) => c !== main && c !== side && c.mobile !== 'hide')
  return (
    <>
    <div className="divide-y divide-soft overflow-hidden rounded-[12px] border border-line bg-card md:hidden">
      {rows.map((r) => {
        const body = mobile ? (
          mobile(r)
        ) : (
          <div className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 text-[14px] text-fg">{main.render(r)}</div>
              {side && <div className="shrink-0 text-right text-[14px] text-fg">{side.render(r)}</div>}
            </div>
            {meta.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                {meta.map((c) => (
                  <span key={c.key} className="min-w-0">
                    {c.render(r)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
        return onRow ? (
          <div key={rowKey(r)} role="button" tabIndex={0} onClick={() => onRow(r)} onKeyDown={(e) => e.key === 'Enter' && onRow(r)} className="cursor-pointer transition active:bg-[#FAFAF8]">
            {body}
          </div>
        ) : (
          <div key={rowKey(r)}>{body}</div>
        )
      })}
    </div>
    <div className="hidden overflow-x-auto rounded-[10px] border border-line bg-card md:block">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-[#FAFAF8]">
            {columns.map((c) => (
              <th key={c.key} className={cx('px-4 py-2 text-[12px] font-medium text-dim', c.align === 'right' && 'text-right')}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRow ? () => onRow(r) : undefined}
              className={cx('border-t border-soft first:border-t-0 transition-colors', onRow && 'cursor-pointer hover:bg-[#FAFAF8]')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-4 py-2.5 text-[13.5px] text-fg', c.align === 'right' && 'text-right', c.className)}>
                  {c.render(r)}
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

export function Pager({ total, page = 1, per = 10 }: { total: number; page?: number; per?: number }) {
  const pages = Math.max(1, Math.ceil(total / per))
  return (
    <div className="mt-4 flex items-center justify-between text-[13px] text-dim">
      <span className="tabular">
        {Math.min(total, (page - 1) * per + 1)}–{Math.min(total, page * per)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 1}>Previous</Button>
        <Button size="sm" disabled={page >= pages}>Next</Button>
      </div>
    </div>
  )
}

/* ─── Empty, banners, copy ─────────────────────────────────────────── */

export function Empty({
  title,
  sub,
  actions,
  icon,
  links,
}: {
  title: string
  sub?: string
  actions?: ReactNode
  icon?: ReactNode
  links?: { label: string; href?: string }[]
}) {
  return (
    <div className="rounded-[10px] border border-dashed border-[#D6D3CA] bg-[#FCFCFA] px-6 py-10 sm:px-10">
      {icon && <div className="mb-5 flex size-10 items-center justify-center rounded-[9px] border border-line bg-card text-fg shadow-[0_1px_2px_rgba(18,18,16,0.05)]">{icon}</div>}
      <h2 className="display max-w-[28ch] text-[20px] font-semibold leading-snug text-fg">{title}</h2>
      {sub && <p className="mt-2 max-w-[56ch] text-[14px] leading-relaxed text-muted">{sub}</p>}
      {actions && <div className="mt-6 flex flex-wrap gap-2">{actions}</div>}
      {links && links.length > 0 && (
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-5">
          {links.map((l) => (
            <a key={l.label} href={l.href ?? '#'} className="text-[13.5px] text-muted underline decoration-[#CFCCC3] underline-offset-4 hover:text-fg">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function Banner({
  tone = 'warn',
  children,
  action,
  short,
  onClose,
}: {
  tone?: 'warn' | 'info' | 'bad' | 'good'
  children: ReactNode
  action?: ReactNode
  short?: ReactNode
  /** Draws an X at the end that calls this. */
  onClose?: () => void
}) {
  const styles = {
    warn: 'border-[#EBD3A6] bg-[#FBF2E1] text-[#6E440A]',
    info: 'border-[#C9DAF0] bg-[#EAF1FA] text-[#1D4373]',
    bad: 'border-[#EFC4C0] bg-[#FBEAE8] text-[#7D1F19]',
    good: 'border-[#D3E3A1] bg-[#F3F8E2] text-fg',
  }
  return (
    <div
      className={cx(
        'relative flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-[13px]',
        !!short && 'max-sm:flex-nowrap max-sm:justify-between max-sm:text-left',
        onClose && 'pr-11',
        styles[tone],
      )}
    >
      {short ? (
        <>
          <span className="hidden sm:inline">{children}</span>
          <span className="min-w-0 truncate sm:hidden">{short}</span>
        </>
      ) : (
        <span>{children}</span>
      )}
      <span className="shrink-0">{action}</span>
      {onClose && (
        <button onClick={onClose} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 opacity-60 transition hover:bg-fg/5 hover:opacity-100" aria-label="Close">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export function CopyField({ value, mono = true, secret }: { value: string; mono?: boolean; secret?: boolean }) {
  const [done, setDone] = useState(false)
  const [shown, setShown] = useState(!secret)
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setDone(false), 1400)
    return () => clearTimeout(t)
  }, [done])
  return (
    <div className="flex h-10 items-center overflow-hidden rounded-lg border border-line bg-raise">
      <span className={cx('min-w-0 flex-1 truncate px-3 text-[13px] text-fg', mono && 'font-mono')}>{shown ? value : '•'.repeat(28)}</span>
      {secret && (
        <button onClick={() => setShown((s) => !s)} className="px-2.5 text-dim hover:text-fg" aria-label="Show">
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
      <button
        onClick={() => {
          copyText(value)
          setDone(true)
        }}
        className="flex h-full items-center gap-1.5 border-l border-line bg-card px-3 text-[13px] font-medium text-fg hover:bg-[#FAF9F6]"
      >
        {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/* ─── Overlays ─────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  width = 480,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  sub?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  // Portalled to <body>: an animated ancestor (the page fade-in) would otherwise
  // become the box "fixed" is measured from, and the overlay would stop short.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-fg/30 backdrop-blur-[2px] sm:items-center sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-card shadow-[0_24px_60px_-12px_rgba(18,18,16,0.25)] sm:rounded-xl"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            {title && <h3 className="display text-[20px] font-semibold text-fg">{title}</h3>}
            {sub && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{sub}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-dim hover:bg-raise hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-[#FAF9F6] px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-end bg-fg/20" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="slide-left h-full w-full max-w-[460px] overflow-y-auto border-l border-line bg-card shadow-[-24px_0_60px_-20px_rgba(18,18,16,0.25)]">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-card/95 px-6 py-4 backdrop-blur">
          <div className="text-[15px] font-semibold text-fg">{title}</div>
          <button onClick={onClose} className="rounded-md p-1.5 text-dim hover:bg-raise hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-soft py-3 last:border-0">
      <span className="shrink-0 text-[13px] text-dim">{label}</span>
      <span className="min-w-0 text-right text-[13.5px] text-fg">{children}</span>
    </div>
  )
}

export { cx }
