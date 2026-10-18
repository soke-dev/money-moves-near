/**
 * The admin console's shared parts.
 *
 * One palette, taken from the app itself: a green-biased black, hairlines
 * instead of boxes, and lime spent only on the current thing and the one
 * action that matters. One voice too, the Business side's: Host Grotesk,
 * labels in sentence case, figures in tabular numerals, and only trouble
 * coloured, so good news stays quiet.
 *
 * Everything here is built for 380px first. The desktop layout is the same
 * markup with more columns switched on, which is why there are no tables -
 * a table with ten columns cannot be read on a phone, and this console gets
 * opened on one.
 */
import { useEffect, useState, type ReactNode } from 'react'

export const C = {
  bg: '#0A0C08',
  card: '#12150F',
  raise: '#181C14',
  line: '#1E2318',
  lineSoft: '#171B12',
  text: '#ECEFE7',
  muted: '#8B9580',
  dim: '#5C6650',
  lime: '#81FB02',
  limeDim: '#4C7A17',
  amber: '#E0A063',
  red: '#F87171',
  blue: '#7FB3E8',
}

/** References, hashes and IDs only: everything else is in the console's sans. */
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"

/* ─── Type ─────────────────────────────────────────────────────────── */

export function H1({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.025em] leading-tight" style={{ color: C.text }}>
      {children}
    </h1>
  )
}

/** A card's heading: what this part of the page is about. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="text-[14px] font-semibold tracking-[-0.01em]" style={{ color: C.text }}>
      {children}
    </div>
  )
}

/** A figure: tabular numerals, so a column of them lines up. */
export function Mono({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ color: color ?? C.text, fontVariantNumeric: 'tabular-nums' }}>
      {children}
    </span>
  )
}

/* ─── Surfaces ─────────────────────────────────────────────────────── */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl min-w-0 ${className}`}
      style={{ background: C.card, border: `1px solid ${C.line}` }}
    >
      {children}
    </div>
  )
}

/**
 * A record in a list. `lead` is what identifies it, `trail` is the figure or
 * the state; `meta` rows appear underneath on a phone and inline on a wide
 * screen. `flag` paints a 2px edge for anything that needs a person.
 */
export function Row({
  lead,
  sub,
  trail,
  trailSub,
  meta,
  flag,
  dense,
  onClick,
}: {
  lead: ReactNode
  sub?: ReactNode
  trail?: ReactNode
  trailSub?: ReactNode
  meta?: ReactNode
  flag?: string
  /** Everything on one line. For long lists that are scanned, not read. */
  dense?: boolean
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'

  /**
   * One line, wrapping rather than truncating.
   *
   * A transaction is four short facts - what, whose, how it went, how much -
   * and stacking them cost three lines each, so a screenful held six rows of a
   * list whose whole job is to be scanned. Laid out in a row they fit across a
   * desk screen and wrap by themselves on a narrow one, which keeps the
   * phone-first layout this console was built for without a breakpoint.
   */
  if (dense) {
    return (
      <Tag
        onClick={onClick}
        className={`w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors ${onClick ? 'hover:bg-white/[0.025]' : ''}`}
        style={{ borderBottom: `1px solid ${C.lineSoft}`, boxShadow: flag ? `inset 2px 0 0 ${flag}` : undefined }}
      >
        <span className="text-[13.5px] font-medium truncate max-w-full" style={{ color: C.text }}>
          {lead}
        </span>
        {sub && (
          <span className="text-[12.5px] truncate max-w-full" style={{ color: C.muted }}>
            {sub}
          </span>
        )}
        {meta}
        <span className="ml-auto flex items-baseline gap-2.5 shrink-0">
          {trail && <span className="text-[13.5px] font-medium tabular-nums" style={{ color: C.text }}>{trail}</span>}
          {trailSub && <span className="text-[11.5px]" style={{ color: C.dim }}>{trailSub}</span>}
        </span>
      </Tag>
    )
  }

  return (
    <Tag
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 px-4 py-3.5 transition-colors ${onClick ? 'hover:bg-white/[0.025]' : ''}`}
      style={{ borderBottom: `1px solid ${C.lineSoft}`, boxShadow: flag ? `inset 2px 0 0 ${flag}` : undefined }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium leading-snug truncate" style={{ color: C.text }}>
          {lead}
        </div>
        {sub && (
          <div className="text-[12.5px] leading-snug truncate mt-0.5" style={{ color: C.muted }}>
            {sub}
          </div>
        )}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">{meta}</div>}
      </div>
      {(trail || trailSub) && (
        <div className="text-right shrink-0">
          {trail && <div className="text-[14px] font-medium tabular-nums" style={{ color: C.text }}>{trail}</div>}
          {trailSub && <div className="text-[11.5px] mt-0.5" style={{ color: C.dim }}>{trailSub}</div>}
        </div>
      )}
    </Tag>
  )
}

export function MetaBit({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span className="text-[12px] tabular-nums" style={{ color: color ?? C.dim }}>
      {children}
    </span>
  )
}

/* ─── State ────────────────────────────────────────────────────────── */

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: C.lime,
  VERIFIED: C.lime,
  RESOLVED: C.lime,
  PROCESSING: C.amber,
  PENDING: C.amber,
  OPEN: C.amber,
  FAILED: C.red,
  REJECTED: C.red,
  CANCELLED: C.dim,
  // Its own colour, not FAILED's red and not COMPLETED's green: the money
  // went back, which is neither a loss nor a delivery.
  REFUNDED: C.amber,
  NONE: C.dim,
  // Money Moves Business: businesses, payments and settlements.
  PAID: C.lime,
  SETTLED: C.lime,
  SUSPENDED: C.red,
  STUCK: C.red,
  HELD: C.amber,
  IN_REVIEW: C.amber,
  UNDERPAID: C.amber,
  QUEUED: C.amber,
  SENDING: C.amber,
  SENT: C.amber,
  UNVERIFIED: C.dim,
  EXPIRED: C.dim,
}

/** What a status is called out loud, where the stored word reads badly. */
const STATUS_WORD: Record<string, string> = {
  IN_REVIEW: 'In review',
  UNDERPAID: 'Arrived short',
  SUSPENDED: 'Deactivated',
  NONE: 'Not started',
}

/** A state: a dot and a word, in sentence case. Only trouble is coloured; good news stays quiet. */
export function Status({ value }: { value: string }) {
  const color = STATUS_COLOR[value] ?? C.muted
  const word = STATUS_WORD[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ')
  const text = color === C.red || color === C.amber ? color : color === C.dim ? C.muted : C.text
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap" style={{ color: text }}>
      <span className="size-[7px] rounded-full shrink-0" style={{ background: color }} />
      {word}
    </span>
  )
}

/** A figure with its label above and its context below. */
export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className="px-4 py-3.5 min-w-0">
      <div className="text-[12.5px]" style={{ color: C.muted }}>
        {label}
      </div>
      <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em] tabular-nums truncate" style={{ color: accent ? C.lime : C.text }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[12px] truncate" style={{ color: C.dim }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-12 text-center text-[13.5px]" style={{ color: C.dim }}>
      {children}
    </div>
  )
}

export function Loading() {
  return (
    <div className="animate-pulse px-4 py-2" aria-label="Loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-10 my-2 rounded-md" style={{ background: C.raise, opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  )
}

/* ─── Controls ─────────────────────────────────────────────────────── */

export function Btn({
  children,
  onClick,
  kind = 'ghost',
  disabled,
  full,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  full?: boolean
  type?: 'button' | 'submit'
}) {
  const look =
    kind === 'primary'
      ? 'bg-[#81FB02] text-[#0A0C08] border-[#81FB02] hover:bg-[#95FF2E]'
      : kind === 'danger'
      ? 'bg-transparent text-[#F87171] border-[#F87171]/35 hover:bg-[#F87171]/[0.07]'
      : 'bg-[#181C14] text-[#ECEFE7] border-[#262C1F] hover:bg-[#1E2319] hover:border-[#323A28]'

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg border text-[13px] font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-40 disabled:pointer-events-none ${full ? 'w-full' : ''} ${look}`}
    >
      {children}
    </button>
  )
}

/** A few choices side by side, as the Business side shows them. Scrolls sideways on a phone rather than wrapping. */
export function Chips({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string; count?: number }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="max-w-full overflow-x-auto no-scrollbar">
      <div className="inline-flex p-[3px] rounded-lg" style={{ background: C.card, border: `1px solid ${C.line}` }}>
        {items.map((it) => {
          const on = it.id === value
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onChange(it.id)}
              className="h-7 px-2.5 rounded-md text-[12.5px] font-medium whitespace-nowrap transition-colors"
              style={{ background: on ? C.raise : 'transparent', color: on ? C.text : C.muted, boxShadow: on ? `0 0 0 1px ${C.line}` : undefined }}
            >
              {it.label}
              {it.count != null && it.count > 0 && (
                <span className="ml-1.5 tabular-nums" style={{ color: on ? C.muted : C.dim }}>
                  {it.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full sm:max-w-[360px] h-9 px-3 text-[13.5px] rounded-lg border border-[#262C1F] bg-[#181C14] text-[#ECEFE7] placeholder:text-[#5C6650] outline-none transition-colors focus:border-[#4C7A17]"
    />
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block min-w-0">
      <div className="mb-1.5 text-[12.5px] font-medium" style={{ color: C.muted }}>
        {label}
      </div>
      {children}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full h-9 px-3 text-[13.5px] rounded-lg border border-[#262C1F] bg-[#181C14] text-[#ECEFE7] placeholder:text-[#5C6650] outline-none transition-colors focus:border-[#4C7A17]"
    />
  )
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full px-3 py-2.5 text-[13.5px] leading-relaxed resize-y rounded-lg border border-[#262C1F] bg-[#181C14] text-[#ECEFE7] placeholder:text-[#5C6650] outline-none transition-colors focus:border-[#4C7A17]"
    />
  )
}

/* ─── Modal ────────────────────────────────────────────────────────── */

/** Full-height sheet on a phone, centred panel on a desktop. */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  /**
   * Sized against the visual viewport, not the layout one.
   *
   * A phone keyboard does not shrink the page. The layout viewport stays the
   * full height of the screen, so `inset-0` and `92vh` still measure down to
   * the bottom edge - which is now underneath the keyboard. The modal is
   * bottom-anchored, so the footer, which is the reply box, was the part that
   * went under it: you could type but not read what you had typed.
   *
   * visualViewport is the part still actually visible. Following its height
   * and offset puts the bottom of the sheet exactly on top of the keyboard,
   * and moves it again when the keyboard goes.
   *
   * Null until measured, and null forever on anything without the API, in
   * which case nothing is applied and the old full-height behaviour stands.
   */
  const [vv, setVv] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const sync = () => setVv({ height: v.height, top: v.offsetTop })
    sync()
    v.addEventListener('resize', sync)
    v.addEventListener('scroll', sync)
    return () => {
      v.removeEventListener('resize', sync)
      v.removeEventListener('scroll', sync)
    }
  }, [])

  return (
    <div
      className="fixed inset-x-0 z-50 flex sm:items-center sm:justify-center"
      style={{
        background: 'rgba(0,0,0,0.7)',
        top: vv ? vv.top : 0,
        height: vv ? vv.height : '100%',
      }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-lg mt-auto sm:mt-0 rounded-t-xl sm:rounded-xl flex flex-col"
        style={{
          background: C.card,
          border: `1px solid ${C.line}`,
          // Of what is visible, not of the screen - the same reason as above.
          maxHeight: vv ? vv.height : '92vh',
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: C.text }}>{title}</div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-[18px] leading-none" style={{ color: C.muted }}>
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-4 flex gap-2 shrink-0" style={{ borderTop: `1px solid ${C.line}` }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Key/value pairs inside a modal, ruled like a statement. */
export function Detail({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
      <span className="text-[13px] shrink-0" style={{ color: C.muted }}>{k}</span>
      <span
        className="text-[13px] text-right break-words min-w-0"
        style={{ color: C.text, fontFamily: mono ? MONO : undefined }}
      >
        {v}
      </span>
    </div>
  )
}

/* ─── Paging ───────────────────────────────────────────────────────── */

export function Pager({ page, pages, total, unit, onPage }: { page: number; pages: number; total: number; unit: string; onPage: (p: number) => void }) {
  const btn = 'inline-flex items-center h-8 px-3 rounded-lg border text-[12.5px] font-medium transition-colors bg-[#181C14] text-[#ECEFE7] border-[#262C1F] hover:bg-[#1E2319] disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12.5px]" style={{ color: C.dim }}>
      <span className="tabular-nums">
        {/* "1 deposit", "0 deposits": the unit as given, made to agree with the number. */}
        {total.toLocaleString()} {total === 1 ? unit.replace(/s$/, '') : /s$|people$/.test(unit) ? unit : `${unit}s`}
        {pages > 1 && `, page ${page} of ${pages}`}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className={btn}>
            Previous
          </button>
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} className={btn}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── Formatting ───────────────────────────────────────────────────── */

export const fmtNgn = (n: number) => `₦${Math.round(n).toLocaleString()}`
/** Dollars, with cents only when there are some, and then both digits. */
export const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function ago(iso: string | Date): string {
  const t = new Date(iso).getTime()
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })
}

export function shortHash(h: string, head = 6, tail = 4): string {
  return h && h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h
}

export function explorerUrl(chain: string | null | undefined, hash: string): string | null {
  if (!hash || !chain) return null
  switch (chain) {
    case 'MOVE': return `https://explorer.movementnetwork.xyz/txn/${hash}`
    case 'BASE': return `https://basescan.org/tx/${hash}`
    case 'BEP20': return `https://bscscan.com/tx/${hash}`
    case 'ARC': return `https://explorer.arc.io/tx/${hash}`
    case 'ARB': return `https://arbiscan.io/tx/${hash}`
    case 'SOL': return `https://solscan.io/tx/${hash}`
    // An event id, not a transaction hash: one jetton transfer is several
    // transactions and tonviewer is what groups them back together.
    case 'TON': return `https://tonviewer.com/transaction/${hash}`
    case 'STELLAR': return `https://stellar.expert/explorer/public/tx/${hash}`
    case 'MONAD': return `https://monadscan.com/tx/${hash}`
    default: return null
  }
}

/**
 * The explorer for a routed deposit's SOURCE chain.
 *
 * Keyed by the provider's chain id rather than by our own Chain enum, because
 * none of these are chains we hold - there is no BEP20-style name for Bitcoin
 * or Tron here, only the number their payload carries.
 */
const ROUTED_EXPLORER: Record<number, (h: string) => string> = {
  1: (h) => `https://etherscan.io/tx/${h}`,
  56: (h) => `https://bscscan.com/tx/${h}`,
  137: (h) => `https://polygonscan.com/tx/${h}`,
  10001: (h) => `https://mempool.space/tx/${h}`,
  10103: (h) => `https://solscan.io/tx/${h}`,
  42161: (h) => `https://arbiscan.io/tx/${h}`,
  728126428: (h) => `https://tronscan.org/#/transaction/${h}`,
}

export function routedExplorerUrl(chainId: unknown, hash: string | null | undefined): string | null {
  if (!hash) return null
  return ROUTED_EXPLORER[Number(chainId)]?.(hash) ?? null
}

/** The naira figure on a transaction, wherever the metadata put it. */
export function txNgn(tx: any): number | null {
  const m = tx?.metadata || {}
  const v = m.ngnNet ?? m.amountNaira ?? m.nairaAmount ?? m.totalNaira ?? null
  return v == null ? null : Number(v)
}
