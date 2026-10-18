/**
 * Money Moves — public analytics.
 *
 * The landing page's clothes: near-black with a green bias, Instrument Sans
 * for figures and headings, JetBrains Mono for every caption and label, the
 * accent used sparingly and sections divided by space and a hairline.
 *
 * ── Why the charts look like this ────────────────────────────────────
 *
 * Both are one series, so neither carries a legend and neither needs a second
 * hue. Volume over time is an area on a single accent line; volume by asset is
 * a ranked bar list where length carries the magnitude and a label beside each
 * bar carries the identity. Reaching for five colours to name five assets
 * would fight the rest of the site and say nothing the label does not already.
 *
 * The accent was checked against both surfaces rather than eyeballed: #81FB02
 * clears 3:1 on the page ground and on the card, so the marks are legible to
 * everyone without a second encoding propping them up.
 *
 * ── The numbers ──────────────────────────────────────────────────────
 *
 * The figures are live, from /api/status/analytics (backend lib/public-stats.ts),
 * at most ten minutes old. SNAPSHOT below is the last hand-taken copy, kept as
 * the fallback and as the shape the API fills field for field.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

/* ─── Tokens — the landing page's, unchanged ───────────────────────── */

const T = {
  paper: '#0A0C08',
  paperAlt: '#0F120B',
  card: '#141811',
  ink: '#ECEFE7',
  body: '#8B9580',
  faint: '#5C6650',
  rule: '#1F241A',
  neon: '#81FB02',
  neonSoft: 'rgba(129,251,2,0.12)',
}

const DISPLAY = "'Instrument Sans', system-ui, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace"
const EASE = [0.16, 1, 0.3, 1] as const

/* ─── The shape the API fills ──────────────────────────────────────── */

/**
 * The last hand-taken snapshot. Live figures come from /api/status/analytics;
 * this is only what the page falls back to if that cannot be reached, and the
 * footer says so when it does.
 */
const SNAPSHOT = {
  updatedAt: '2026-09-24T16:30:00Z',
  /** Today's market dollar in naira, for the naira view. 0 = dollars only. */
  usdNgn: 0,
  totalProcessedUsd: 36491,
  rampVolumeUsd: 12138,
  transactions: 2067,
  /**
   * Everyone with an account, which is what the word means to a reader.
   *
   * Not the number who have transacted - that is a different and much smaller
   * question, and a tile labelled People answering it undersold the thing by
   * a factor of three.
   */
  people: 376,
  months: [
    { month: '2026-04', processed: 4772, ramp: 1111, tx: 446 },
    { month: '2026-05', processed: 5490, ramp: 2705, tx: 404 },
    { month: '2026-06', processed: 11105, ramp: 1323, tx: 337 },
    { month: '2026-07', processed: 7138, ramp: 3896, tx: 216 },
    { month: '2026-08', processed: 5586, ramp: 2384, tx: 188 },
    { month: '2026-09', processed: 2400, ramp: 719, tx: 476 },
  ],
  assets: [
    { symbol: 'USDT', usd: 22795, tx: 548 },
    { symbol: 'USDC', usd: 12852, tx: 1256 },
    { symbol: 'MOVE', usd: 832, tx: 232 },
    { symbol: 'SOL', usd: 58, tx: 18 },
    { symbol: 'cNGN', usd: 5, tx: 15 },
  ],
}

/**
 * Assets the chart leaves out.
 *
 * Hidden here rather than dropped from the data, because the API returns
 * everything and what this page shows is a presentation decision: a five
 * dollar bar next to a twenty-three thousand dollar one is a rounding error
 * drawn at the same weight as the business.
 *
 * The heading below reads "by stablecoin", which is true only while this list
 * is exactly the non-stablecoins. Change one and change the other.
 */
const HIDDEN_ASSETS = new Set(['MOVE', 'SOL', 'cNGN', 'ETH'])

type Stats = typeof SNAPSHOT

const API = import.meta.env.VITE_API_URL || ''

/* ─── Formatting ───────────────────────────────────────────────────── */

type Currency = 'usd' | 'ngn'

/** Compact for tiles and axes; the hero prints in full. */
function compactMoney(n: number, sym: string): string {
  if (n >= 1_000_000_000) return `${sym}${trimZero(n / 1_000_000_000)}B`
  if (n >= 1_000_000) return `${sym}${trimZero(n / 1_000_000)}M`
  if (n >= 1_000) return `${sym}${trimZero(n / 1_000)}K`
  return `${sym}${Math.round(n)}`
}

/** 7.5 stays 7.5; 15.0 becomes 15. Axis ticks should not carry a dead decimal. */
function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '')
}

/**
 * A ceiling the axis can be divided into round numbers.
 *
 * Rounding the maximum up to any old step gives ticks like $13K and $6.3K -
 * true, and unreadable. Stepping to 1, 2 or 5 times a power of ten means the
 * top and its midpoint are both figures somebody can hold in their head.
 */
function niceTop(max: number): number {
  if (max <= 0) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(max)))
  // A fine ladder on purpose. Jumping 1 -> 2 sent a peak of 11.1K to a 20K
  // ceiling and left the line sitting in the bottom half of its own chart;
  // every step here also halves into a round midpoint.
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    const top = step * mag
    if (top >= max) return top
  }
  return 10 * mag
}

function fullMoney(n: number, sym: string): string {
  return `${sym}${Math.round(n).toLocaleString('en-US')}`
}

const CURRENCY_KEY = 'mm_analytics_currency'

function monthLabel(m: string): string {
  const [y, mm] = m.split('-')
  // Sliced to three: en-GB renders September as "Sept", which is one letter
  // wider than every other tick and reads as a mistake in a row of them.
  return new Date(Number(y), Number(mm) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'short' })
    .slice(0, 3)
}

/* ─── Motion ───────────────────────────────────────────────────────── */

function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.62, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* ─── Parts ────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10.5px] font-medium uppercase tracking-[0.22em]"
      style={{ fontFamily: MONO, color: T.neon }}
    >
      {children}
    </span>
  )
}

/**
 * A figure and what it is.
 *
 * Proportional figures, not tabular: these are standalone display numbers, and
 * tabular-nums gives every digit the width of a zero, which reads loose at
 * this size. Tabular is for columns that have to line up, which is the table
 * further down.
 */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-t pt-5" style={{ borderColor: T.rule }}>
      <div
        className="text-[32px] leading-none tracking-[-0.035em] sm:text-[38px]"
        style={{ fontFamily: DISPLAY, fontWeight: 500, color: T.ink }}
      >
        {value}
      </div>
      <div
        className="mt-3 text-[10.5px] font-medium uppercase tracking-[0.16em]"
        style={{ fontFamily: MONO, color: T.neon }}
      >
        {label}
      </div>
      {note && (
        <p className="mt-2 text-[12px] leading-[1.7]" style={{ fontFamily: MONO, color: T.body }}>
          {note}
        </p>
      )}
    </div>
  )
}

/* ─── Volume over time ─────────────────────────────────────────────── */

/**
 * One series, so no legend and no second hue - the heading names it.
 *
 * A crosshair and a tooltip rather than a number on every point: labelling all
 * six would be six figures competing with the shape they are drawn on, and the
 * shape is the thing this chart is for.
 *
 * The hit areas are full-height columns, not the points themselves. An 8px
 * marker is a poor target on a phone, and the reader is pointing at a month
 * rather than at a dot.
 */
function VolumeChart({ months, sym }: { months: Stats['months']; sym: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  /**
   * The viewBox is measured, not fixed, so one unit is always one pixel.
   *
   * A fixed 720-wide box scaled into a 350px phone shrinks everything in it by
   * the same half - including the type, which lands at about five pixels and
   * cannot be read. Matching the box to the element keeps ten-pixel text ten
   * pixels wide at every width, and the chart reflows instead of shrinking.
   */
  const [W, setW] = useState(720)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = e.contentRect.width
      if (w > 0) setW(Math.max(w, 280))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 260
  // Room for the widest tick the axis will print, and no more.
  const PAD = { top: 18, right: 14, bottom: 34, left: W < 420 ? 40 : 52 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const max = Math.max(...months.map((m) => m.processed))
  const top = niceTop(max)
  const x = (i: number) => PAD.left + (plotW * i) / Math.max(months.length - 1, 1)
  const y = (v: number) => PAD.top + plotH - (plotH * v) / top

  const line = months.map((m, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(m.processed)}`).join(' ')
  const area = `${line} L ${x(months.length - 1)} ${PAD.top + plotH} L ${x(0)} ${PAD.top + plotH} Z`
  const ticks = [0, top / 2, top]

  return (
    <div ref={wrap} className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block w-full"
        style={{ overflow: 'visible' }}
        role="img"
        aria-label="Total processed volume by month"
      >
        <defs>
          <linearGradient id="mmArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={T.neon} stopOpacity="0.22" />
            <stop offset="100%" stopColor={T.neon} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid: present enough to read a value against, quiet
            enough that the line is what you see. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={T.rule} strokeWidth="1" />
            <text
              x={PAD.left - 10}
              y={y(t) + 4}
              textAnchor="end"
              style={{ fontFamily: MONO, fontSize: 10, fill: T.faint, fontVariantNumeric: 'tabular-nums' }}
            >
              {compactMoney(t, sym)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#mmArea)" />
        <path d={line} fill="none" stroke={T.neon} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {months.map((m, i) => (
          <g key={m.month}>
            {/* Every other label once the chart is narrow. Six ticks in 300
                pixels overlap, and half of them is still enough to read the
                axis by. */}
            {(W >= 420 || i % 2 === 0) && (
              <text
                x={x(i)}
                y={H - 12}
                textAnchor="middle"
                style={{ fontFamily: MONO, fontSize: 10, fill: T.faint }}
              >
                {monthLabel(m.month)}
              </text>
            )}

            {hover === i && (
              <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + plotH} stroke={T.neon} strokeWidth="1" strokeOpacity="0.45" />
            )}

            {/* The 2px ring is the page ground, so the marker reads as sitting
                on the line rather than punched through it. */}
            <circle
              cx={x(i)}
              cy={y(m.processed)}
              r={hover === i ? 5.5 : 4}
              fill={T.neon}
              stroke={T.paper}
              strokeWidth="2"
            />

            <rect
              x={x(i) - plotW / (months.length * 2)}
              y={PAD.top}
              width={plotW / months.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'crosshair' }}
            />
          </g>
        ))}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl px-3 py-2"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -104%)',
            background: T.card,
            border: `1px solid ${T.rule}`,
            fontFamily: MONO,
            whiteSpace: 'nowrap',
          }}
        >
          <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: T.faint }}>
            {new Date(months[hover].month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </div>
          <div className="mt-1 text-[13px]" style={{ color: T.ink, fontVariantNumeric: 'tabular-nums' }}>
            {fullMoney(months[hover].processed, sym)} processed
          </div>
          <div className="text-[11px]" style={{ color: T.body, fontVariantNumeric: 'tabular-nums' }}>
            {months[hover].tx.toLocaleString('en-US')} transactions
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Volume by asset ──────────────────────────────────────────────── */

/**
 * Ranked bars, one hue, labelled directly.
 *
 * The job is comparing magnitude, and length already does that - so colour has
 * nothing left to encode and giving each asset its own would be decoration
 * that costs legibility. The name sits beside its bar, which is what tells
 * them apart.
 *
 * Bars carry a 4px rounded end and a minimum width, so cNGN at five dollars is
 * still a visible mark rather than a gap where a row should be.
 */
function AssetBars({ assets, sym }: { assets: Stats['assets']; sym: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const max = Math.max(...assets.map((a) => a.usd))

  return (
    <div className="flex flex-col gap-3.5">
      {assets.map((a) => {
        const pct = Math.max((a.usd / max) * 100, 1.2)
        const on = hover === a.symbol
        return (
          <div
            key={a.symbol}
            onMouseEnter={() => setHover(a.symbol)}
            onMouseLeave={() => setHover(null)}
            className="grid items-center gap-3"
            style={{ gridTemplateColumns: '58px 1fr auto' }}
          >
            <div
              className="text-[12px] font-semibold"
              style={{ fontFamily: MONO, color: on ? T.ink : T.body }}
            >
              {a.symbol}
            </div>

            <div className="relative h-[22px] rounded-[6px]" style={{ background: T.paperAlt }}>
              <div
                className="absolute inset-y-0 left-0 rounded-[6px] transition-[width,opacity] duration-300"
                style={{
                  width: `${pct}%`,
                  background: T.neon,
                  opacity: hover && !on ? 0.45 : 1,
                }}
              />
            </div>

            <div
              className="text-right text-[12px]"
              style={{ fontFamily: MONO, color: on ? T.ink : T.body, fontVariantNumeric: 'tabular-nums' }}
            >
              {compactMoney(a.usd, sym)}
              <span className="ml-2 text-[11px]" style={{ color: T.faint }}>
                {a.tx} tx
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────────────────── */

export default function Analytics() {
  const [tableOpen, setTableOpen] = useState(false)
  /** Null while loading; the snapshot, with live false, if the API cannot be reached. */
  const [data, setData] = useState<Stats | null>(null)
  const [live, setLive] = useState(true)
  const [currency, setCurrencyState] = useState<Currency>(() => {
    try {
      return localStorage.getItem(CURRENCY_KEY) === 'ngn' ? 'ngn' : 'usd'
    } catch {
      return 'usd'
    }
  })
  const setCurrency = (c: Currency) => {
    setCurrencyState(c)
    try {
      localStorage.setItem(CURRENCY_KEY, c)
    } catch {
      /* a remembered choice is a convenience, not a requirement */
    }
  }

  useEffect(() => {
    let alive = true
    fetch(`${API}/api/status/analytics`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Stats) => {
        if (alive) setData(d)
      })
      .catch(() => {
        if (!alive) return
        setData(SNAPSHOT)
        setLive(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const updated = useMemo(
    () =>
      data
        ? new Date(data.updatedAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '',
    [data],
  )

  useEffect(() => {
    document.title = 'Money Moves — Analytics'
  }, [])

  if (!data) {
    return (
      <div className="flex items-center justify-center" style={{ background: T.paper, minHeight: '100vh' }}>
        <span className="text-[11px] uppercase tracking-[0.18em]" style={{ fontFamily: MONO, color: T.faint }}>
          Loading figures…
        </span>
      </div>
    )
  }

  /**
   * Naira is every dollar figure at today's market rate - one rate for all of
   * it, so the shape of the page is the same in either currency. Without a
   * rate (the snapshot, or a feed that could not be read) it stays in dollars.
   */
  const rate = data.usdNgn > 0 ? data.usdNgn : 0
  const ngn = currency === 'ngn' && rate > 0
  const k = ngn ? rate : 1
  const sym = ngn ? '₦' : '$'
  const months = data.months.map((m) => ({ ...m, processed: m.processed * k }))
  const assets = data.assets.map((a) => ({ ...a, usd: a.usd * k }))

  return (
    <div style={{ background: T.paper, color: T.ink, minHeight: '100vh' }}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{ borderColor: T.rule, background: 'rgba(10,12,8,0.82)' }}
      >
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5">
          <Link
            to="/"
            className="text-[13px] font-semibold tracking-[-0.01em]"
            style={{ fontFamily: DISPLAY, color: T.ink }}
          >
            Money&nbsp;Moves
          </Link>
          <div className="flex items-center gap-4">
            {rate > 0 && (
              <div
                className="flex rounded-full border p-0.5"
                style={{ borderColor: T.rule }}
                role="group"
                aria-label="Currency"
              >
                {(['usd', 'ngn'] as const).map((c) => {
                  const on = (c === 'ngn') === ngn
                  return (
                    <button
                      key={c}
                      onClick={() => setCurrency(c)}
                      aria-pressed={on}
                      className="rounded-full px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] transition-colors"
                      style={{
                        fontFamily: MONO,
                        color: on ? T.neon : T.faint,
                        background: on ? T.neonSoft : 'transparent',
                      }}
                    >
                      {c === 'usd' ? '$ USD' : '₦ NGN'}
                    </button>
                  )
                })}
              </div>
            )}
            <span
              className="hidden text-[10.5px] uppercase tracking-[0.18em] sm:inline"
              style={{ fontFamily: MONO, color: T.faint }}
            >
              Analytics
            </span>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-20">
        <Reveal>
          <Eyebrow>Figures to date</Eyebrow>
        </Reveal>

        <Reveal delay={0.06}>
          <h1
            className="mt-5 max-w-[16ch] text-[40px] leading-[1.06] tracking-[-0.04em] sm:text-[56px]"
            style={{ fontFamily: DISPLAY, fontWeight: 500 }}
          >
            What has moved through Money Moves.
          </h1>
        </Reveal>

        {/* Exactly one hero figure on the page. Everything else is a tile. */}
        <Reveal delay={0.12}>
          <div className="mt-12 border-t pt-7" style={{ borderColor: T.rule }}>
            <div
              className={`${ngn ? 'text-[44px]' : 'text-[64px]'} leading-none tracking-[-0.045em] sm:text-[84px]`}
              style={{ fontFamily: DISPLAY, fontWeight: 500, color: T.neon }}
            >
              {fullMoney(data.totalProcessedUsd * k, sym)}
            </div>
            <div
              className="mt-4 text-[10.5px] font-medium uppercase tracking-[0.18em]"
              style={{ fontFamily: MONO, color: T.body }}
            >
              Total processed, all time{ngn && ` · at ${fullMoney(rate, '₦')} / $`}
            </div>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-x-10 gap-y-9 sm:grid-cols-2">
          <Reveal delay={0.04}>
            <Stat label="Transactions" value={data.transactions.toLocaleString('en-US')} />
          </Reveal>
          <Reveal delay={0.1}>
            <Stat label="Mobile downloads" value={data.people.toLocaleString('en-US')} />
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] px-5">
        <div className="h-px w-full" style={{ background: T.rule }} />
      </div>

      {/* ── Over time ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-20">
        <Reveal>
          <Eyebrow>Month by month</Eyebrow>
        </Reveal>
        <Reveal delay={0.06}>
          <h2
            className="mt-5 max-w-[22ch] text-[30px] leading-[1.08] tracking-[-0.035em] sm:text-[38px]"
            style={{ fontFamily: DISPLAY, fontWeight: 500 }}
          >
            Total processed, by month.
          </h2>
        </Reveal>

        <Reveal delay={0.12}>
          <div
            className="mt-10 rounded-[20px] border p-5 sm:p-7"
            style={{ background: T.card, borderColor: T.rule }}
          >
            <VolumeChart months={months} sym={sym} />
          </div>
        </Reveal>

        {/* The table is the accessibility backstop and the honest one: hover
            is not available to every reader or every device. */}
        <Reveal delay={0.16}>
          <button
            onClick={() => setTableOpen((v) => !v)}
            className="mt-5 text-[11px] uppercase tracking-[0.16em] transition-opacity hover:opacity-70"
            style={{ fontFamily: MONO, color: T.neon }}
          >
            {tableOpen ? 'Hide the figures' : 'Show the figures'}
          </button>

          {tableOpen && (
            <div className="mt-5 overflow-x-auto rounded-[16px] border" style={{ borderColor: T.rule }}>
              <table className="w-full" style={{ fontFamily: MONO, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Month', 'Processed', 'Transactions'].map((h, i) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-[10px] uppercase tracking-[0.14em]"
                        style={{
                          color: T.faint,
                          textAlign: i === 0 ? 'left' : 'right',
                          borderBottom: `1px solid ${T.rule}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <tr key={m.month}>
                      <td
                        className="px-4 py-3 text-[12px]"
                        style={{ color: T.body, borderBottom: `1px solid ${T.rule}` }}
                      >
                        {new Date(m.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                      </td>
                      {[fullMoney(m.processed, sym), m.tx.toLocaleString('en-US')].map((v, i) => (
                        <td
                          key={i}
                          className="px-4 py-3 text-right text-[12px]"
                          style={{
                            color: T.ink,
                            borderBottom: `1px solid ${T.rule}`,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Reveal>
      </section>

      <div className="mx-auto max-w-[1200px] px-5">
        <div className="h-px w-full" style={{ background: T.rule }} />
      </div>

      {/* ── By asset ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1200px] px-5 pb-20 pt-20">
        <Reveal>
          <Eyebrow>Where the volume is</Eyebrow>
        </Reveal>

        <div className="mt-5 grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <Reveal delay={0.06}>
            <h2
              className="max-w-[18ch] text-[30px] leading-[1.08] tracking-[-0.035em] sm:text-[38px]"
              style={{ fontFamily: DISPLAY, fontWeight: 500 }}
            >
              Volume by stablecoin.
            </h2>
            <p
              className="mt-5 max-w-[40ch] text-[12.5px] leading-[1.75]"
              style={{ fontFamily: MONO, color: T.body }}
            >
              The two dollars almost everything moves in.
            </p>
          </Reveal>

          <Reveal delay={0.12}>
            <div
              className="rounded-[20px] border p-5 sm:p-7"
              style={{ background: T.card, borderColor: T.rule }}
            >
              <AssetBars assets={assets.filter((a) => !HIDDEN_ASSETS.has(a.symbol))} sym={sym} />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t" style={{ borderColor: T.rule }}>
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] leading-[1.7]" style={{ fontFamily: MONO, color: T.faint }}>
            {live
              ? `Figures to ${updated}, read live from completed transactions and refreshed every few minutes.`
              : `Live figures could not be loaded, so these are from ${updated}.`}
          </p>
          <Link
            to="/"
            className="text-[11px] uppercase tracking-[0.16em] transition-opacity hover:opacity-70"
            style={{ fontFamily: MONO, color: T.neon }}
          >
            Back to Money Moves
          </Link>
        </div>
      </footer>
    </div>
  )
}
