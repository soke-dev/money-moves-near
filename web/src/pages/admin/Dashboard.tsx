/**
 * Money Moves admin console.
 *
 * Built around the question someone actually opens this thing to answer:
 * is anything stuck. Overview leads with the work queue - payouts that took
 * a user's crypto and did not reach their bank, verifications waiting, people
 * asking for a human, accounts asking to be closed - and every item on it is
 * a link into the section that clears it.
 *
 * Laid out for a phone first. No wide tables: each record is a row that
 * carries its own labels, so the same markup reads at 380px and at 1400px.
 */
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  LayoutDashboard, ArrowLeftRight, BadgeCheck, Banknote, Users, MessageSquare,
  Megaphone, PiggyBank, ToggleLeft, Gift, Radar as RadarIcon, ArrowLeft, ChevronRight, Coins,
} from 'lucide-react'
import { PersonalCrypto } from './PersonalCrypto'
import { SwapSettings } from './SwapSettings'
import {
  C, MONO, H1, Label, Mono, Card, Row, MetaBit, Status, Empty, Loading,
  Btn, Chips, Search, Field, Input, Textarea, Modal, Detail, Pager,
  fmtNgn, fmtUsd, ago, shortHash, explorerUrl, routedExplorerUrl, txNgn,
} from './ui'
import { BUSINESS_SECTIONS, BusinessConsole, RECORD_SECTION, SANS, bizChanged, readRecord, useRecord, type BusinessSectionId } from './business'
import { biz as bizRead } from './business/client'
import { ActionPanel, Facts, Figures, PageHead, Panel, Segmented, Select as KitSelect, Table, Tabs, Tag, When, toneColor, type Column, type Tone } from './business/kit'

const API = import.meta.env.VITE_API_URL || ''

function api(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('mm_admin_token')
  return fetch(`${API}/api/admin${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts?.headers,
    },
  })
}

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await api(path)
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

/* ─── Sections ─────────────────────────────────────────────────────── */

/**
 * The nav, with a mark against each row.
 *
 * Twelve labels in a column are read by position rather than by name once
 * somebody has used the console twice, and a column of text gives the eye
 * nothing to land on. The mark is what makes a row findable at a glance.
 *
 * One weight and one size throughout, tinted with the label rather than
 * against it, so the icon supports the word instead of competing with it -
 * this is a sidebar, not a toolbar.
 */
const SECTIONS = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', Icon: ArrowLeftRight },
  { id: 'kyc', label: 'Verification', Icon: BadgeCheck },
  { id: 'deposits', label: 'Deposits', Icon: Banknote },
  { id: 'crypto', label: 'Crypto', Icon: Coins },
  { id: 'users', label: 'People', Icon: Users },
  { id: 'support', label: 'Support', Icon: MessageSquare },
  { id: 'broadcast', label: 'Broadcast', Icon: Megaphone },
  { id: 'savings', label: 'Savings', Icon: PiggyBank },
  { id: 'services', label: 'Services', Icon: ToggleLeft },
  { id: 'vouchers', label: 'Vouchers', Icon: Gift },
  { id: 'radar', label: 'Radar', Icon: RadarIcon },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** The section a rail item is drawn under, if any. */
const parentOf = (s: { id: string }): string | undefined => (s as { parent?: string }).parent

/** What a section should open showing, when the overview sends you there. */
type Jump = { section: SectionId; filter?: string }

/**
 * Two sides, one console and one sign-in: the Money Moves app's people, and
 * Money Moves Business. The side you were on is remembered, so the console
 * opens where you left it.
 */
type Space = 'personal' | 'business'
type AnySection = SectionId | BusinessSectionId
const SPACE_KEY = 'mm_admin_space'
const savedSpace = (): Space => {
  try {
    return localStorage.getItem(SPACE_KEY) === 'business' ? 'business' : 'personal'
  } catch {
    return 'personal'
  }
}

function SpaceSwitch({ value, onChange }: { value: Space; onChange: (s: Space) => void }) {
  return (
    <div className="flex rounded-xl p-0.5" style={{ background: C.card, border: `1px solid ${C.line}` }} role="tablist" aria-label="Which side">
      {(['personal', 'business'] as const).map((s) => {
        const on = value === s
        return (
          <button
            key={s}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(s)}
            className="flex-1 h-8 rounded-[10px] text-[12.5px] font-semibold transition-colors"
            style={{ background: on ? 'rgba(129,251,2,0.12)' : 'transparent', color: on ? C.lime : C.muted }}
          >
            {s === 'personal' ? 'Personal' : 'Business'}
          </button>
        )
      })}
    </div>
  )
}

/**
 * How many things wait for a person in each section, for the menu.
 *
 * Read for both sides at once, so switching sides shows its numbers straight
 * away. Red where money is stuck; the rest is a queue, not an alarm.
 */
type Counts = Partial<Record<AnySection, { n: number; bad?: boolean }>>

async function readCounts(): Promise<Counts> {
  const [stats, processing, deletions, chats, held, biz] = await Promise.all([
    get<any>('/stats', null),
    get<any>('/transactions?status=PROCESSING&limit=100', { transactions: [] }),
    get<any>('/users?status=deletion_requested&page=1&limit=1', { pagination: { total: 0 } }),
    get<any>('/chat/conversations?status=OPEN', { needsHumanCount: 0 }),
    get<any>('/funding/held?status=HELD&page=1&limit=1', { pagination: { total: 0 } }),
    bizOverview(),
  ])
  const a = biz?.attention
  const counts: Counts = {
    transactions: { n: (processing.transactions || []).filter(isStuckPayout).length, bad: true },
    kyc: { n: Number(stats?.pendingKyc) || 0 },
    deposits: { n: Number(held.pagination?.total) || 0 },
    users: { n: Number(deletions.pagination?.total) || 0 },
    support: { n: Number(chats.needsHumanCount) || 0 },
  }
  if (a) {
    counts.b_settlements = { n: (a.failed ?? 0) + (a.stuck ?? 0) + (a.review ?? 0) + (a.held ?? 0), bad: (a.failed ?? 0) + (a.stuck ?? 0) > 0 }
    counts.b_kyc = { n: a.applications ?? a.inReview ?? 0 }
    counts.b_businesses = { n: (a.detailChanges ?? 0) + (a.waitingBanks ?? 0) }
    counts.b_refunds = { n: a.refundsToSend ?? 0 }
    counts.b_disputes = { n: a.disputesOpen ?? 0 }
    counts.b_support = { n: a.chatsWaiting ?? 0 }
    counts.b_crypto = { n: a.cryptoReturns ?? 0 }
  }
  return counts
}

/** The Business side's overview, for its counts. Nothing at all if it can't be read: the menu just shows no numbers. */
const bizOverview = () => bizRead<{ attention: Record<string, number> }>('/overview?mode=live').catch(() => null)

/** A section's waiting count, in the menu. */
function Count({ c }: { c?: { n: number; bad?: boolean } }) {
  if (!c || c.n <= 0) return null
  return (
    <span
      className="ml-auto min-w-[22px] h-[20px] px-1.5 inline-flex items-center justify-center rounded-full text-[11.5px] font-semibold tabular-nums"
      style={c.bad ? { background: 'rgba(248,113,113,0.14)', color: C.red } : { background: 'rgba(255,255,255,0.07)', color: C.text }}
    >
      {c.n > 99 ? '99+' : c.n}
    </span>
  )
}

/** A Business record (a business, a payment...) named in the address, if one is. */
const recordInUrl = () => readRecord(new URLSearchParams(window.location.search))

export default function Dashboard() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // A record is a page with its own address - opened from a list, or from a link someone pasted.
  const record = readRecord(params)
  const { back, from } = useRecord()
  const [space, setSpace] = useState<Space>(() => (recordInUrl() ? 'business' : savedSpace()))
  const [section, setSection] = useState<AnySection>(() => {
    const r = recordInUrl()
    if (r) return RECORD_SECTION[r.kind]
    return savedSpace() === 'business' ? 'b_overview' : 'overview'
  })
  const [filter, setFilter] = useState<string | undefined>()
  const [nonce, setNonce] = useState(0)
  const [refreshing, setRefreshing] = useState<'busy' | 'done' | null>(null)
  const [counts, setCounts] = useState<Counts>({})

  // Every minute, and again whenever Refresh is pressed.
  useEffect(() => {
    let alive = true
    const read = () => void readCounts().then((c) => alive && setCounts(c))
    read()
    const t = setInterval(read, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [nonce, refreshing === 'done'])

  useEffect(() => {
    if (!localStorage.getItem('mm_admin_token')) navigate('/admin')
  }, [navigate])

  // Records only exist on the Business side: arriving at one (a link, the back button) goes there.
  const recordKind = record?.kind
  useEffect(() => {
    if (!recordKind) return
    if (space !== 'business') setSpace('business')
    if (!BUSINESS_SECTIONS.some((s) => s.id === section)) setSection(RECORD_SECTION[recordKind])
  }, [recordKind, space, section])

  const jump = useCallback(
    ({ section, filter }: { section: AnySection; filter?: string }) => {
      setSection(section)
      setFilter(filter)
      setNonce((n) => n + 1)
      // Picking a section leaves any open record.
      if (recordInUrl()) navigate({ search: '' })
      window.scrollTo({ top: 0 })
    },
    [navigate],
  )

  function switchSpace(s: Space) {
    if (s === space) return
    setSpace(s)
    try {
      localStorage.setItem(SPACE_KEY, s)
    } catch {
      /* the console still switches; it just won't remember */
    }
    jump({ section: s === 'business' ? 'b_overview' : 'overview' })
  }

  function signOut() {
    localStorage.removeItem('mm_admin_token')
    navigate('/admin')
  }

  const sections: readonly { id: AnySection; label: string; Icon: typeof LayoutDashboard }[] = space === 'business' ? BUSINESS_SECTIONS : SECTIONS
  const current = sections.find((s) => s.id === section) ?? sections[0]!

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text, fontFamily: SANS }}>
      <div className="mx-auto flex max-w-[1240px]">
        {/* Rail: desktop only. The mark, the sections, the way out. */}
        <aside
          className="hidden lg:flex flex-col w-[216px] shrink-0 sticky top-0 h-screen px-4 py-6"
          style={{ borderRight: `1px solid ${C.line}` }}
        >
          <div className="flex items-center gap-2.5 px-2 mb-6">
            <img src="/images/logo.png" alt="" className="w-8 h-8 rounded-lg" />
            <div>
              <div className="text-[14px] font-bold tracking-[-0.02em]">money moves</div>
              <div className="text-[12px]" style={{ color: C.dim }}>
                Admin
              </div>
            </div>
          </div>

          <div className="mb-6">
            <SpaceSwitch value={space} onChange={switchSpace} />
          </div>

          <nav className="flex flex-col gap-0.5">
            {sections
              .filter((s) => !parentOf(s))
              .map((s) => {
                const on = s.id === section
                const children = sections.filter((c) => parentOf(c) === s.id)
                return (
                  <div key={s.id} className="flex flex-col gap-0.5">
                    <button
                      onClick={() => jump({ section: s.id })}
                      className="flex items-center gap-2.5 text-left h-9 px-3 rounded-lg text-[13.5px] font-medium transition-colors"
                      style={{
                        background: on ? 'rgba(129,251,2,0.10)' : 'transparent',
                        color: on ? C.lime : C.muted,
                      }}
                    >
                      {/* Inherits the row's colour, so the selected state is one
                          decision rather than two that can drift apart. */}
                      <s.Icon size={16} strokeWidth={2} className="shrink-0" />
                      {s.label}
                      <Count c={counts[s.id]} />
                    </button>
                    {/* Its sub-sections, indented beneath it on a hairline. */}
                    {children.length > 0 && (
                      <div className="ml-[22px] pl-2 flex flex-col gap-0.5" style={{ borderLeft: `1px solid ${C.line}` }}>
                        {children.map((c) => {
                          const cOn = c.id === section
                          return (
                            <button
                              key={c.id}
                              onClick={() => jump({ section: c.id })}
                              className="flex items-center gap-2 text-left h-8 px-2.5 rounded-lg text-[13px] font-medium transition-colors"
                              style={{
                                background: cOn ? 'rgba(129,251,2,0.10)' : 'transparent',
                                color: cOn ? C.lime : C.muted,
                              }}
                            >
                              <c.Icon size={14} strokeWidth={2} className="shrink-0" />
                              {c.label}
                              <Count c={counts[c.id]} />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
          </nav>

          <button
            onClick={signOut}
            className="mt-auto text-left h-10 px-3 rounded-xl text-[13px]"
            style={{ color: C.dim }}
          >
            Sign out
          </button>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          <header
            className="sticky top-0 z-30 px-4 sm:px-6 pt-5 pb-3"
            style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <img src="/images/logo.png" alt="" className="w-7 h-7 rounded-lg lg:hidden" />
                {record ? (
                  // On a record's page, the header is the way back to where it was opened from.
                  <button
                    onClick={back}
                    className="flex items-center gap-1.5 h-9 -ml-1.5 pl-1.5 pr-2.5 rounded-lg text-[14px] font-medium min-w-0 transition-colors hover:bg-white/[0.04]"
                    style={{ color: C.muted }}
                  >
                    <ArrowLeft size={16} className="shrink-0" />
                    <span className="truncate">{from ?? current.label}</span>
                  </button>
                ) : (
                  <h1 className="text-[20px] sm:text-[24px] font-semibold tracking-[-0.025em] truncate">
                    {current.label}
                  </h1>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  // The Business side reads everything on screen again in place, keeping filters and
                  // pages, and says so: a quiet reload that changed nothing looked like a dead button.
                  // Support keeps its own threads, so it is opened afresh instead.
                  onClick={async () => {
                    if (refreshing === 'busy') return
                    setRefreshing('busy')
                    if (space === 'business' && section !== 'support') await bizChanged()
                    else setNonce((n) => n + 1)
                    await new Promise((r) => setTimeout(r, 350))
                    setRefreshing('done')
                    setTimeout(() => setRefreshing((v) => (v === 'done' ? null : v)), 1600)
                  }}
                  disabled={refreshing === 'busy'}
                  className="h-9 px-4 rounded-full text-[12.5px] font-semibold transition-colors hover:bg-white/[0.04]"
                  style={{ border: `1px solid ${C.line}`, color: refreshing === 'done' ? C.lime : C.muted }}
                >
                  {refreshing === 'busy' ? 'Refreshing…' : refreshing === 'done' ? 'Up to date' : 'Refresh'}
                </button>
                <button
                  onClick={signOut}
                  className="lg:hidden h-9 px-3 rounded-xl text-[12.5px]"
                  style={{ border: `1px solid ${C.line}`, color: C.dim }}
                >
                  Out
                </button>
              </div>
            </div>

            {/* Mobile nav: everything reachable, nothing hidden behind a menu. A record's page has its back button instead. */}
            <div className={`lg:hidden mt-3 space-y-3 ${record ? 'hidden' : ''}`}>
              <SpaceSwitch value={space} onChange={switchSpace} />
              <Chips
                items={sections.map((s) => ({ id: s.id, label: s.label, count: counts[s.id]?.n }))}
                value={section}
                onChange={(id) => jump({ section: id as AnySection })}
              />
            </div>
          </header>

          <div className="px-4 sm:px-6 py-5 pb-20">
            {space === 'business' && (
              <BusinessConsole key={`${section}-${nonce}`} section={section as BusinessSectionId} filter={filter} onJump={jump} record={record} />
            )}
            {space === 'personal' && <>
            {section === 'overview' && <Overview key={nonce} onJump={jump} />}
            {section === 'transactions' && <Transactions key={nonce} initial={filter} />}
            {section === 'kyc' && <Kyc key={nonce} initial={filter} />}
            {section === 'deposits' && <Deposits key={nonce} />}
            {section === 'crypto' && <PersonalCrypto key={nonce} />}
            {section === 'users' && <People key={nonce} initial={filter} />}
            {section === 'support' && <Support key={nonce} initial={filter} />}
            {section === 'broadcast' && <BroadcastSection key={nonce} />}
            {section === 'savings' && <Savings key={nonce} />}
            {section === 'services' && <Services key={nonce} />}
            {section === 'vouchers' && <Vouchers key={nonce} />}
            {section === 'radar' && <Radar key={nonce} />}
            </>}
          </div>
        </main>
      </div>
    </div>
  )
}

/* ═══ Services ═════════════════════════════════════════════════════ */

type Service = {
  key: string
  label: string
  blocks: string
  kind: 'service' | 'switch' | 'choice'
  options: { id: string; label: string; ready: boolean }[] | null
  blurb: string | null
  caveat: string | null
  value: string | null
  chosen: string | null
  pinned: boolean
  paused: boolean
  forced: boolean
  note: string | null
  message: string | null
  backBy: string | null
  updatedBy: string | null
  updatedAt: string | null
}

/**
 * The pause switches.
 *
 * Turning a service off used to mean editing an environment variable on
 * Railway, which restarts the backend - the one thing you do not want to do
 * during the incident that made you reach for the switch. These write a row
 * instead, and the app sees it within about a minute.
 *
 * The two text fields are here rather than behind a second screen because
 * what is typed in them is what somebody reads on their phone. Writing the
 * message somewhere you cannot see the switch is how you end up pausing a
 * service with last month's explanation still attached.
 */
/**
 * The naira rates, laid out like the provider switches: funding on the left,
 * selling on the right. A value saved here overrides Railway's; "reset" hands
 * it back. Saving needs the action password, checked by the server, and the
 * box is cleared after each try.
 */
type RateKey = 'fundMarkup' | 'sellMarkup' | 'fundMax' | 'sellMax'

const RATE_FIELDS: { key: RateKey; label: string }[] = [
  { key: 'fundMarkup', label: 'Funding markup' },
  { key: 'sellMarkup', label: 'Selling markup' },
  { key: 'fundMax', label: 'Funding ceiling' },
  { key: 'sellMax', label: 'Selling ceiling' },
]

const RATE_SIDES = [
  { side: 'fund', label: 'FUNDING', fields: [['fundMarkup', 'MARKUP'], ['fundMax', 'CEILING']] },
  { side: 'sell', label: 'SELLING', fields: [['sellMarkup', 'MARKUP'], ['sellMax', 'CEILING']] },
] as const

const naira = (n: number) => `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function RatesPanel() {
  const [d, setD] = useState<any | null>(null)
  const [draft, setDraft] = useState<Record<RateKey, string>>({ fundMarkup: '', sellMarkup: '', fundMax: '', sellMax: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')

  const take = (r: any) => {
    setD(r)
    setDraft(Object.fromEntries(RATE_FIELDS.map((f) => [f.key, String(r.settings[f.key])])) as Record<RateKey, string>)
  }

  const load = useCallback(async () => {
    const r = await get<any>('/rates', null)
    if (r) take(r)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(body: Partial<Record<RateKey, number | null>>) {
    if (!pw) {
      setErr('Enter the action password to save.')
      return
    }
    setBusy(true)
    setErr('')
    const res = await api('/rates', { method: 'PUT', body: JSON.stringify({ ...body, password: pw }) }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {}
      // A rejected password is cleared; a rejected figure keeps it for the retry.
      if (!res || res.status === 403 || res.status === 429) setPw('')
      setErr(b?.error || 'That did not save.')
      return
    }
    setPw('')
    take(await res.json())
  }

  if (!d) return <Panel flush><Loading /></Panel>

  const feed: number = d.live.feed
  const dirty = RATE_FIELDS.filter((f) => draft[f.key] !== String(d.settings[f.key]))
  const invalid = dirty.some((f) => draft[f.key].trim() === '' || !Number.isFinite(Number(draft[f.key])))
  const saveDirty = () => save(Object.fromEntries(dirty.map((f) => [f.key, Number(draft[f.key])])))

  /** What a dollar would be quoted at with the figures as typed. */
  const preview = (side: 'fund' | 'sell') => {
    const markup = Number(draft[side === 'fund' ? 'fundMarkup' : 'sellMarkup'])
    const cap = Number(draft[side === 'fund' ? 'fundMax' : 'sellMax'])
    if (!(feed > 0) || !Number.isFinite(markup)) return null
    const posted = feed + markup
    return Number.isFinite(cap) && cap > 0 && posted > cap ? cap : posted
  }
  const now = { fund: d.live.fund as number, sell: d.live.sell as number }
  const next = { fund: preview('fund'), sell: preview('sell') }
  const moved = (side: 'fund' | 'sell') => dirty.length > 0 && next[side] != null && Math.abs((next[side] as number) - now[side]) > 0.004

  // Who last changed a rate here, as the switches show it.
  const last = RATE_FIELDS.map((f) => d.sources[f.key])
    .filter((x: any) => x.source === 'admin' && x.at)
    .sort((a: any, b: any) => +new Date(b.at) - +new Date(a.at))[0]

  return (
    <Panel
      title="Naira rates"
      sub={[feed > 0 ? `Market ${naira(feed)}` : null, last ? `Changed by ${last.by ?? 'admin'} ${ago(last.at)}` : null].filter(Boolean).join(' · ') || undefined}
      flush
    >
      <div className="grid sm:grid-cols-2" style={{ borderTop: `1px solid ${C.line}` }}>
        {RATE_SIDES.map((sd, i) => (
          <div key={sd.side} className={`px-4 py-4 ${i > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''}`} style={{ borderColor: C.line }}>
            <div className="text-[12.5px]" style={{ color: C.muted }}>
              {sd.side === 'fund' ? 'Buying crypto (people pay)' : 'Selling to a bank (people get)'}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{naira(now[sd.side])}</span>
              {moved(sd.side) && (
                <span className="text-[13px] tabular-nums" style={{ color: C.lime }}>
                  to {naira(next[sd.side] as number)}
                </span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {sd.fields.map(([key]) => {
                const admin = d.sources[key].source === 'admin'
                const word = key.endsWith('Markup') ? 'Markup' : 'Ceiling'
                return (
                  <div key={key}>
                    <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium" style={{ color: C.muted }}>
                      {word}
                      {admin && <Tag tone="good">Set here</Tag>}
                    </div>
                    <Input
                      inputMode="decimal"
                      value={draft[key]}
                      onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value.replace(/[^0-9.\-]/g, '') }))}
                      aria-label={RATE_FIELDS.find((f) => f.key === key)?.label}
                    />
                    {admin && (
                      <button
                        disabled={busy}
                        onClick={() => save({ [key]: null })}
                        className="mt-1 text-[12px] underline-offset-2 hover:underline disabled:opacity-50"
                        style={{ color: C.dim }}
                      >
                        Go back to the server's {d.railway[key]}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderTop: `1px solid ${C.line}` }}>
        <span className="text-[12.5px] tabular-nums" style={{ color: err ? C.red : C.dim }}>
          {err ||
            `Spread ${naira(now.fund - now.sell)}${moved('fund') || moved('sell') ? `, becomes ${naira((next.fund ?? now.fund) - (next.sell ?? now.sell))}` : ''}`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[180px]">
            <Input
              type="password"
              name="action-password"
              autoComplete="new-password"
              placeholder="Action password"
              value={pw}
              onChange={(e) => {
                setPw(e.target.value)
                if (err) setErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy && dirty.length > 0 && !invalid) saveDirty()
              }}
              aria-label="Action password"
            />
          </div>
          {dirty.length > 0 && <Btn disabled={busy} onClick={() => take(d)}>Discard</Btn>}
          <Btn kind="primary" disabled={busy || dirty.length === 0 || invalid} onClick={saveDirty}>
            {busy ? 'Saving…' : 'Save rates'}
          </Btn>
        </div>
      </div>
    </Panel>
  )
}

/** An on/off switch, as the Business side has them: lime when on. */
function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40"
      style={{ background: on ? C.lime : C.raise, border: `1px solid ${on ? C.lime : '#2A3122'}` }}
    >
      <span className="absolute top-[2px] h-4 w-4 rounded-full transition-all" style={{ left: on ? 18 : 2, background: on ? '#0A0C08' : C.muted }} />
    </button>
  )
}

type ServicesTab = 'pause' | 'providers' | 'rates' | 'converted' | 'swap' | 'emails'

function Services() {
  const [tab, setTab] = useState<ServicesTab>('pause')
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const [draft, setDraft] = useState<{ note: string; message: string; backBy: string }>({ note: '', message: '', backBy: '' })

  /**
   * What the SERVER can reach, which is a different question from what a laptop can reach. A provider key can be
   * restricted to an IP allowlist, or set with a stray character, and the symptom three layers up is a person being
   * told their account was not found.
   */
  const [check, setCheck] = useState<any[] | null>(null)
  const [egress, setEgress] = useState<string | null>(null)
  const [bills, setBills] = useState<any | null>(null)
  const [billsBusy, setBillsBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [probe, setProbe] = useState({ bankName: '', accountNumber: '' })

  async function runBillsCheck() {
    setBillsBusy(true)
    try {
      setBills(await get<any>('/bills/preflight', null))
    } finally {
      setBillsBusy(false)
    }
  }

  async function runCheck() {
    setChecking(true)
    setCheck(null)
    try {
      const q = new URLSearchParams()
      if (probe.bankName.trim()) q.set('bankName', probe.bankName.trim())
      if (probe.accountNumber.trim()) q.set('accountNumber', probe.accountNumber.trim())
      const d = await get<any>(`/payout/preflight?${q}`, { rails: [] })
      setCheck(d.rails || [])
      setEgress(d.egressIp || null)
    } finally {
      setChecking(false)
    }
  }

  const load = useCallback(async () => {
    const d = await get<any>('/services', { services: [] })
    setServices(d.services || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function send(key: string, body: Record<string, unknown>) {
    setBusy(key)
    setSaid('')
    try {
      const res = await api(`/services/${key}`, { method: 'PUT', body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (res.ok) setServices(d.services || [])
      else setSaid(d.error || 'That did not save.')
    } finally {
      setBusy(null)
    }
  }

  function edit(svc: Service) {
    if (open === svc.key) {
      setOpen(null)
      return
    }
    setOpen(svc.key)
    setDraft({
      note: svc.note || '',
      message: svc.message || '',
      // datetime-local wants the local wall clock with no zone, which is also how somebody thinks about "back by four".
      backBy: svc.backBy ? toLocalInput(svc.backBy) : '',
    })
  }

  if (loading) return <Panel flush><Loading /></Panel>

  const pausable = services.filter((v) => v.kind === 'service')
  const choices = services.filter((v) => v.kind === 'choice')
  const switches = services.filter((v) => v.kind === 'switch')
  const pausedCount = pausable.filter((v) => v.paused).length

  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['pause', 'Pause switches', pausedCount],
          ['providers', 'Providers'],
          ['rates', 'Naira rates'],
          ['converted', 'Converted'],
          ['swap', 'Swap'],
          ['emails', 'Emails'],
        ]}
      />

      {said && (
        <div className="text-[12.5px] px-3 py-2.5 rounded-lg" style={{ background: `${C.red}14`, border: `1px solid ${C.red}44`, color: C.red }}>
          {said}
        </div>
      )}

      {tab === 'pause' && (
        <Panel title="Pause switches" sub="Turn a service off and the app shows your message on it instead. The app sees a change within a minute." flush>
          {pausable.map((svc) => {
            const editing = open === svc.key
            return (
              <div key={svc.key} style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <div className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-medium" style={{ color: C.text }}>
                        {svc.label}
                      </span>
                      {svc.paused && <Tag tone="warn">Paused</Tag>}
                      {svc.forced && <Tag tone="warn">Held by the server</Tag>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: svc.paused ? C.amber : C.dim }}>
                      {svc.paused ? svc.note || svc.message || 'Paused, with no message for people yet. Add one.' : `Covers ${svc.blocks}`}
                    </div>
                  </div>
                  <button type="button" onClick={() => edit(svc)} className="text-[13px] font-medium transition-colors hover:text-[#ECEFE7]" style={{ color: editing ? C.text : C.muted }}>
                    {editing ? 'Close' : 'Message'}
                  </button>
                  {/* An environment flag is a deliberate override this can't lift - said plainly rather than a switch that does nothing. */}
                  <Toggle
                    on={!svc.paused}
                    label={`${svc.label} on`}
                    disabled={svc.forced || busy === svc.key}
                    onChange={(on) => {
                      void send(svc.key, { paused: !on })
                      // Turning one off is when people need words: the message opens with it.
                      if (!on && !svc.message && open !== svc.key) edit(svc)
                    }}
                  />
                </div>

                {editing && (
                  <div className="px-4 pb-4 pt-1 space-y-3.5" style={{ background: C.bg, borderTop: `1px solid ${C.lineSoft}` }}>
                    <div className="grid gap-3.5 sm:grid-cols-2">
                      <Field label="Short note, on the service's row">
                        <Input value={draft.note} maxLength={80} placeholder="Back around 4 PM" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                        {/* Past about thirty-four characters it wraps and the row grows taller than the two beside it. */}
                        <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: draft.note.length > 34 ? C.amber : C.dim }}>
                          {draft.note.length}/34 before it wraps on a phone
                        </div>
                      </Field>
                      <Field label="Back by (optional)">
                        <Input type="datetime-local" value={draft.backBy} onChange={(e) => setDraft({ ...draft, backBy: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="Message, when someone taps it">
                      <Textarea
                        rows={3}
                        maxLength={400}
                        value={draft.message}
                        placeholder="A sentence in your own words. It's what somebody reads when they tap the service."
                        onChange={(e) => setDraft({ ...draft, message: e.target.value })}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[12px]" style={{ color: C.dim }}>
                        {svc.updatedBy && svc.updatedAt ? `Last changed by ${svc.updatedBy} ${ago(svc.updatedAt)}` : ''}
                      </span>
                      <Btn
                        kind="primary"
                        disabled={busy === svc.key}
                        onClick={() =>
                          send(svc.key, {
                            note: draft.note,
                            message: draft.message,
                            backBy: draft.backBy ? new Date(draft.backBy).toISOString() : '',
                          })
                        }
                      >
                        {busy === svc.key ? 'Saving…' : 'Save message'}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </Panel>
      )}

      {tab === 'providers' &&
        choices.map((svc) => (
          <Panel
            key={svc.key}
            title={svc.label}
            sub={[svc.blocks ? `Covers ${svc.blocks}` : null, svc.updatedBy && svc.updatedAt ? `Changed by ${svc.updatedBy} ${ago(svc.updatedAt)}` : null].filter(Boolean).join(' · ')}
            action={svc.pinned ? <Tag tone="warn">Pinned by the server</Tag> : undefined}
            flush
          >
            {(svc.options || []).map((o) => {
              const on = svc.value === o.id
              return (
                <div key={o.id} className="flex items-center gap-4 px-4 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                  <span className="size-[9px] rounded-full shrink-0" style={{ background: on ? C.lime : 'transparent', border: `1.5px solid ${on ? C.lime : C.dim}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium" style={{ color: o.ready ? C.text : C.dim }}>
                      {o.label}
                    </div>
                    <div className="mt-0.5 text-[12.5px]" style={{ color: on ? C.muted : o.ready ? C.dim : C.amber }}>
                      {on ? 'Live now' : o.ready ? 'Ready to take over' : 'No secret key on the server'}
                    </div>
                  </div>
                  {on ? (
                    <Tag tone="good">Live</Tag>
                  ) : (
                    <Btn disabled={!o.ready || svc.pinned || busy === svc.key} onClick={() => send(svc.key, { value: o.id })}>
                      {busy === svc.key ? 'Switching…' : 'Make live'}
                    </Btn>
                  )}
                </div>
              )
            })}

            {svc.chosen && svc.chosen !== svc.value && (
              <div className="px-4 py-3 text-[12.5px]" style={{ color: C.amber, borderTop: `1px solid ${C.lineSoft}` }}>
                {svc.chosen} was chosen but can't run right now, so this is on {svc.value}.
              </div>
            )}

            {/* The bills check draws the line that matters: the catalogue answers without a key or an allowlist, so a
                healthy plan list proves nothing. Only the account-scoped read says a purchase would go through. */}
            {svc.key === 'bills' && (
              <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <div className="flex flex-wrap items-center gap-3">
                  <Btn onClick={runBillsCheck} disabled={billsBusy}>{billsBusy ? 'Checking…' : 'Check bills from the server'}</Btn>
                  {bills?.egressIp && <span className="text-[12px]" style={{ color: C.dim }}>Calls leave from <span style={{ fontFamily: MONO, color: C.text }}>{bills.egressIp}</span></span>}
                </div>
                {bills?.providers?.map((p: any) => {
                  const bad = p.configured && !p.account
                  return (
                    <div key={p.id} className="text-[12.5px] leading-relaxed">
                      <Status value={!p.configured ? 'NONE' : p.account ? 'COMPLETED' : 'FAILED'} />{' '}
                      <span className="font-medium" style={{ color: bad ? C.amber : C.text }}>{p.label}</span>
                      <span style={{ color: C.dim }}>
                        {!p.configured
                          ? ': no key on the server'
                          : p.account
                          ? ': can buy from here'
                          : p.catalogue
                          ? `: can read the menu but not buy. This server's address isn't on the bills allowlist${p.error ? `. ${p.error}` : ''}`
                          : ': can\'t reach it'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Only under the payout switch, because that's what it checks: it resolves a bank account on a payout rail. */}
            {svc.key === 'payout' && (
              <div className="px-4 py-3 space-y-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <div className="text-[12.5px] leading-relaxed" style={{ color: C.dim }}>
                  Check each rail answers from the server. Name a bank and account to also look one up, the same call the app makes when someone adds a bank.
                </div>
                <div className="flex flex-wrap items-end gap-2.5">
                  <div className="min-w-[150px] flex-1">
                    <Input value={probe.bankName} placeholder="Bank, like Opay" onChange={(e) => setProbe({ ...probe, bankName: e.target.value })} />
                  </div>
                  <div className="min-w-[140px] flex-1">
                    <Input value={probe.accountNumber} placeholder="Account number" onChange={(e) => setProbe({ ...probe, accountNumber: e.target.value })} />
                  </div>
                  <Btn onClick={runCheck} disabled={checking}>{checking ? 'Checking…' : 'Check both rails'}</Btn>
                </div>
                {egress && (
                  <div className="text-[12px]" style={{ color: C.dim }}>
                    Calls leave this server from <span style={{ fontFamily: MONO, color: C.text }}>{egress}</span>. Whitelist it wherever a provider asks.
                  </div>
                )}
                {check?.map((r: any) => {
                  const bad = !r.configured || r.banks === false || r.resolved === false
                  return (
                    <div key={r.id} className="text-[12.5px] leading-relaxed">
                      <Status value={bad ? 'FAILED' : 'COMPLETED'} />{' '}
                      <span className="font-medium" style={{ color: bad ? C.amber : C.text }}>{r.label}</span>
                      <span style={{ color: C.dim }}>
                        {!r.configured
                          ? ': no secret key on the server'
                          : r.banks === false
                          ? `: can't read the bank list${r.banksError ? `. ${r.banksError}` : ''}`
                          : `: banks fine${r.sampleCode ? ` (code ${r.sampleCode})` : ''}${r.balance !== undefined && r.balance !== null ? `, balance ${fmtNgn(r.balance)}` : ''}${
                              r.resolved === true ? `, found ${r.accountName}` : r.resolved === false ? `, didn't find the account${r.resolveError ? `. ${r.resolveError}` : ''}` : ''
                            }`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        ))}

      {tab === 'rates' && <RatesPanel />}

      {/* Deposits that arrive converted, and swaps between chains: services the app offers, kept beside the rest. */}
      {tab === 'converted' && <Routed />}

      {tab === 'swap' && <SwapSettings />}

      {tab === 'emails' && (
        <Panel
          title="Emails"
          sub="Receipts for money arriving and leaving. Sign-in codes, password and PIN resets and wallet export codes always go, whatever this says, so turning it off can't lock anyone out."
          flush
        >
          {switches.map((svc) => (
            <div key={svc.key} className="flex items-center gap-4 px-4 py-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium" style={{ color: C.text }}>
                    {svc.label}
                  </span>
                  {svc.forced && <Tag tone="warn">Held by the server</Tag>}
                </div>
                {svc.updatedBy && svc.updatedAt && (
                  <div className="mt-0.5 text-[12.5px]" style={{ color: C.dim }}>
                    Changed by {svc.updatedBy} {ago(svc.updatedAt)}
                  </div>
                )}
              </div>
              <Toggle on={!svc.paused} label={svc.label} disabled={svc.forced || busy === svc.key} onChange={(on) => void send(svc.key, { paused: !on })} />
            </div>
          ))}
        </Panel>
      )}
    </div>
  )
}

/** ISO to the value a datetime-local input wants: local wall clock, no zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ═══ Overview ═════════════════════════════════════════════════════ */

/** A sell that took the crypto and has not reached the bank yet. */
function isStuckPayout(tx: any): boolean {
  if (tx.type !== 'SELL' || tx.status !== 'PROCESSING') return false
  const failed = tx.metadata?.payoutStatus === 'payout_failed'
  const old = Date.now() - new Date(tx.createdAt).getTime() > 60 * 60 * 1000
  return failed || old
}

function Overview({ onJump }: { onJump: (j: Jump) => void }) {
  const [stats, setStats] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [stuck, setStuck] = useState<any[]>([])
  const [deletions, setDeletions] = useState(0)
  const [needsHuman, setNeedsHuman] = useState(0)
  const [loading, setLoading] = useState(true)
  const [ccy, setCcy] = useState<'usd' | 'ngn'>('usd')

  /**
   * Every figure here is stored in dollars, because that is the only unit the
   * six sources have in common. But the business is run in naira, so reading
   * the day's volume means doing the multiplication in your head against a
   * rate printed at the bottom of one card.
   *
   * The rate is the same one the app posts against, carried on the stats
   * payload. When it has not arrived there is nothing to convert with, so the
   * switch is not offered rather than quietly showing dollars under a naira
   * label.
   */
  const usdNgn = Number(detail?.usdNgnRate) || 0
  const inNgn = ccy === 'ngn' && usdNgn > 0
  const money = (usd: number) => (inNgn ? fmtNgn((Number(usd) || 0) * usdNgn) : fmtUsd(Number(usd) || 0))

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, d, txs, users, chats] = await Promise.all([
        get<any>('/stats', null),
        get<any>('/stats/detailed', null),
        get<any>('/transactions?status=PROCESSING&limit=100', { transactions: [] }),
        get<any>('/users?status=deletion_requested&page=1&limit=1', { pagination: { total: 0 } }),
        get<any>('/chat/conversations?status=OPEN', { needsHumanCount: 0 }),
      ])
      if (!alive) return
      setStats(s)
      setDetail(d)
      setStuck((txs.transactions || []).filter(isStuckPayout))
      setDeletions(users.pagination?.total || 0)
      setNeedsHuman(chats.needsHumanCount || 0)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <Panel flush><Loading /></Panel>

  const queue: { label: string; sub: string; n: number; tone: Tone; go: Jump }[] = [
    {
      label: 'Sales stuck before the bank',
      sub: "Crypto taken, and the naira not confirmed sent after an hour, or the payout failed",
      n: stuck.length,
      tone: 'bad',
      go: { section: 'transactions', filter: 'PROCESSING' },
    },
    { label: 'Verifications to review', sub: 'Submitted and waiting for a decision', n: stats?.pendingKyc ?? 0, tone: 'warn', go: { section: 'kyc', filter: 'PENDING' } },
    { label: 'Chats waiting for a person', sub: 'The assistant handed these over and nobody has replied yet', n: needsHuman, tone: 'warn', go: { section: 'support', filter: 'OPEN' } },
    { label: 'Accounts asking to be closed', sub: 'Deletion requests waiting for a decision', n: deletions, tone: 'warn', go: { section: 'users', filter: 'deletion_requested' } },
  ]
  const waiting = queue.filter((q) => q.n > 0)

  return (
    <div className="space-y-5">
      <Panel title="Needs a person" flush>
        {waiting.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px]" style={{ color: C.dim }}>
            Nothing stuck. Every sale has reached its bank or is on its way.
          </div>
        ) : (
          <div className="divide-y divide-[#171B12]">
            {waiting.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => onJump(q.go)}
                className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.025]"
                style={{ boxShadow: `inset 2px 0 0 ${toneColor(q.tone)}` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium" style={{ color: C.text }}>
                    {q.label}
                  </div>
                  <div className="mt-0.5 text-[12.5px]" style={{ color: C.muted }}>
                    {q.sub}
                  </div>
                </div>
                <span className="text-[18px] font-semibold tabular-nums" style={{ color: toneColor(q.tone) }}>
                  {q.n}
                </span>
                <ChevronRight size={16} color={C.dim} />
              </button>
            ))}
          </div>
        )}
      </Panel>

      {usdNgn > 0 && (
        <Segmented
          value={ccy}
          onChange={setCcy}
          items={[
            ['usd', 'In dollars'],
            ['ngn', 'In naira'],
          ]}
        />
      )}

      {/* Active, not verified: verified counts who finished a form, active counts who used the thing.
          The definition matches the analytics page, so the two never disagree. */}
      <Panel flush>
        <Figures
          items={[
            { label: 'People', value: (stats?.totalUsers ?? 0).toLocaleString(), sub: `${(stats?.activeUsers ?? 0).toLocaleString()} active` },
            { label: 'Transactions', value: (stats?.totalTransactions ?? 0).toLocaleString(), sub: `${(stats?.processingTxns ?? 0).toLocaleString()} in flight` },
            { label: 'Volume, all time', value: money(detail?.totalVolumeUsd ?? 0), sub: 'Completed transactions only' },
            { label: 'Fees, all time', value: money(detail?.totalFeesUsd ?? 0), sub: `About ${money(detail?.estGasUsd ?? 0)} spent on gas` },
          ]}
        />
      </Panel>

      {detail && (
        <div className="grid lg:grid-cols-2 gap-5">
          <Panel
            title="Where the volume came from"
            sub={inNgn ? `Converted at ₦${Math.round(usdNgn).toLocaleString()} to the dollar` : `Bills paid in naira: ${fmtNgn(detail.billsVolumeNgn || 0)}. Rate ₦${Math.round(usdNgn).toLocaleString()} to the dollar`}
          >
            <Facts
              wide
              rows={[
                ['Bought crypto', <Mono>{money(Number(detail.buyVolumeUsd) || 0)}</Mono>],
                ['Sold to a bank', <Mono>{money(Number(detail.sellVolumeUsd) || 0)}</Mono>],
                ['Sent out', <Mono>{money(Number(detail.withdrawVolumeUsd) || 0)}</Mono>],
                ['Username transfers', <Mono>{money(Number(detail.usernameTransferVolumeUsd) || 0)}</Mono>],
                ['Deposits in', <Mono>{money(Number(detail.depositVolumeUsd) || 0)}</Mono>],
                ['Bills', <Mono>{money(Number(detail.billsVolumeUsd) || 0)}</Mono>],
              ]}
            />
          </Panel>

          <Panel title="Last 7 days">
            <Week days={detail.dailyVolume || []} money={money} />
            <div className="mt-4">
              <Facts
                rows={[
                  ['Active people', <span><Mono>{(detail.activeUsers ?? 0).toLocaleString()}</Mono> <span style={{ color: C.dim }}>made at least one transaction</span></span>],
                  ['Completed', <Mono>{(detail.totalCompletedTxns ?? 0).toLocaleString()} transactions</Mono>],
                ]}
              />
            </div>
          </Panel>

          {/* What moved, and where it moved. Biggest first in both, because the question either one answers is
              "what carries this business", and an alphabetical list makes you read all of it to find that out. */}
          <Panel title="By coin" flush>
            <Breakdown rows={detail.volumeByAsset} counts={detail.countByAsset} money={money} />
          </Panel>

          <Panel title="By network" flush>
            <Breakdown rows={detail.volumeByChain} counts={detail.countByChain} money={money} names={CHAIN_NAMES} />
          </Panel>
        </div>
      )}
    </div>
  )
}

/** Tags are what the database stores; these are what people call them. */
const CHAIN_NAMES: Record<string, string> = {
  MOVE: 'Movement',
  BASE: 'Base',
  SOL: 'Solana',
  BEP20: 'BNB Chain',
  ARC: 'Arc',
  ARB: 'Arbitrum',
  TON: 'TON',
  STELLAR: 'Stellar',
  MONAD: 'Monad',
  'OFF-CHAIN': 'No chain (bank, bills)',
}

/**
 * A share of the whole, as a figure and as a bar.
 *
 * Six rows of dollars tell you the order; they do not tell you that one of
 * them is most of the business. The bar is drawn against the largest row
 * rather than the total, so the second-biggest is still readable when the
 * first takes eighty per cent.
 */
function Breakdown({
  rows,
  counts,
  money,
  names,
}: {
  rows?: Record<string, number>
  counts?: Record<string, number>
  money: (usd: number) => string
  names?: Record<string, string>
}) {
  const list = Object.entries(rows || {})
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))

  if (!list.length) return <div className="px-4 py-10 text-center text-[13.5px]" style={{ color: C.dim }}>Nothing yet.</div>

  const top = Number(list[0][1]) || 1
  return (
    <div className="pb-1">
      {list.map(([k, v]) => (
        <div key={k} className="px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
          <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate" style={{ color: C.text }}>
              {names?.[k] || k}
              {counts?.[k] != null && (
                <span className="ml-2 text-[12px] tabular-nums" style={{ color: C.dim }}>
                  {counts[k].toLocaleString()}
                </span>
              )}
            </span>
            <Mono>{money(Number(v) || 0)}</Mono>
          </div>
          <div className="mt-1.5 h-[3px] rounded-full" style={{ background: C.line }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max((Number(v) / top) * 100, 2)}%`, background: 'rgba(129,251,2,0.5)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Seven days of volume, one bar a day, like the Business side's chart. Point at a bar for the day. */
function Week({ days, money }: { days: unknown[]; money: (usd: number) => string }) {
  const [at, setAt] = useState<number | null>(null)
  // The API sends Object.entries output - [date, amount] tuples - and reading it as {date, volumeUsd} threw on
  // the first render, which is what once took the whole dashboard blank. Both shapes are accepted.
  const last = (days || [])
    .map((d: any) =>
      Array.isArray(d)
        ? { date: String(d[0] ?? ''), volumeUsd: Number(d[1]) || 0 }
        : { date: String(d?.date ?? ''), volumeUsd: Number(d?.volumeUsd ?? d?.volume) || 0 },
    )
    .filter((d) => d.date)
    .slice(-7)
  if (last.length === 0) return <div className="py-6 text-center text-[13.5px]" style={{ color: C.dim }}>No volume recorded yet.</div>
  const max = Math.max(...last.map((d) => d.volumeUsd), 0)
  const shown = at != null ? last[at] : null
  const total = last.reduce((a, d) => a + d.volumeUsd, 0)
  const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span style={{ color: C.muted }}>{shown ? dayName(shown.date) : 'This week'}</span>
        <span className="tabular-nums" style={{ color: C.text }}>{money(shown ? shown.volumeUsd : total)}</span>
      </div>
      <div className="mt-3 flex items-end gap-[6px] h-[84px]" onMouseLeave={() => setAt(null)}>
        {last.map((d, i) => (
          <div key={d.date} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setAt(i)} onClick={() => setAt(at === i ? null : i)}>
            <div
              className="w-full rounded-[2px] transition-colors"
              style={{
                height: d.volumeUsd && max ? `${Math.max(6, (d.volumeUsd / max) * 100)}%` : '2px',
                background: d.volumeUsd ? (at === i ? C.lime : 'rgba(129,251,2,0.5)') : at === i ? C.dim : C.line,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px]" style={{ color: C.dim }}>
        <span>{dayName(last[0]!.date)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/* ═══ Transactions ═════════════════════════════════════════════════ */

function Transactions({ initial }: { initial?: string }) {
  const [status, setStatus] = useState(initial ?? '')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ transactions: any[]; pagination: any }>({ transactions: [], pagination: {} })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useOpenPage<any>()
  const [person, setPerson] = useOpenPage<any>()

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (status) params.set('status', status)
    if (kind) params.set('kind', kind)
    if (q) params.set('search', q)
    setData(await get(`/transactions?${params}`, { transactions: [], pagination: {} }))
    setLoading(false)
  }, [status, kind, q, page])

  useEffect(() => {
    load()
  }, [load])

  // A transaction, or the person it belongs to, as a page; the list keeps its filters and place underneath.
  if (person) return <PersonPage user={person} from={open ? txLabel(open) : 'Transactions'} onBack={() => setPerson(null)} onChanged={() => { setPerson(null); void load() }} />
  if (open) return <TxPage tx={open} from="Transactions" onBack={() => setOpen(null)} onDone={() => { setOpen(null); void load() }} onPerson={setPerson} />

  return (
    <div className="space-y-4">
      <Search value={search} onChange={setSearch} placeholder="Reference, email or username" />
      {/* What happened, then how it went. One row asking two questions made
          you choose between them - you could see every failure, or every bank
          payout, but never the failed bank payouts. */}
      <Chips
        items={[
          { id: '', label: 'All' },
          { id: 'bank', label: 'Bank transfers' },
          { id: 'bills', label: 'Bills' },
          { id: 'username', label: 'Username transfers' },
          { id: 'crypto', label: 'Crypto withdrawals' },
          { id: 'deposit', label: 'Deposits' },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k)
          setPage(1)
        }}
      />
      <Chips
        items={[
          { id: '', label: 'Any status' },
          { id: 'COMPLETED', label: 'Successful' },
          { id: 'PROCESSING', label: 'In flight' },
          { id: 'PENDING', label: 'Unsigned' },
          { id: 'FAILED', label: 'Failed' },
          { id: 'REFUNDED', label: 'Refunded' },
        ]}
        value={status}
        onChange={(s) => {
          setStatus(s)
          setPage(1)
        }}
      />

      <Card>
        {loading ? (
          <Loading />
        ) : (
          <Table
            rows={data.transactions}
            columns={TX_COLUMNS}
            rowKey={(tx) => tx.id}
            flag={(tx) => (isStuckPayout(tx) ? 'bad' : undefined)}
            onRow={(tx) => setOpen(tx)}
            empty="Nothing matches that."
          />
        )}
        <Pager
          page={data.pagination?.page || 1}
          pages={data.pagination?.pages || 1}
          total={data.pagination?.total || 0}
          unit="transactions"
          onPage={setPage}
        />
      </Card>

    </div>
  )
}

/** A coin amount: as many decimals as it has, up to six. */
const coins = (n: unknown) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })

const TX_COLUMNS: Column<any>[] = [
  {
    key: 'what',
    head: 'Transaction',
    width: 'minmax(0,1.6fr)',
    cell: (tx) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{txLabel(tx)}</div>
        <div className="truncate text-[12px]" style={{ color: C.dim }}>
          {tx.user?.username ? `@${tx.user.username}` : tx.user?.email || 'No account'}
        </div>
      </div>
    ),
  },
  {
    key: 'status',
    head: 'Status',
    width: '150px',
    phone: 'meta',
    cell: (tx) => (isStuckPayout(tx) ? <span style={{ color: C.red }}><Status value="STUCK" /></span> : <Status value={tx.status} />),
  },
  { key: 'chain', head: 'Network', width: '120px', phone: 'meta', cell: (tx) => <span style={{ color: C.muted }}>{tx.chain ? CHAIN_NAMES[tx.chain] ?? tx.chain : 'No chain'}</span> },
  { key: 'when', head: 'When', width: '96px', phone: 'meta', cell: (tx) => <span style={{ color: C.muted }}><When at={tx.createdAt} /></span> },
  {
    key: 'amount',
    head: 'Amount',
    width: '170px',
    align: 'right',
    cell: (tx) => {
      const ngn = txNgn(tx)
      return (
        <div>
          <div>
            {coins(tx.amount)} <span style={{ color: C.muted }}>{tx.asset}</span>
          </div>
          {ngn != null && (
            <div className="text-[12px]" style={{ color: C.dim }}>
              {fmtNgn(ngn)}
            </div>
          )}
        </div>
      )
    },
  },
]

/**
 * What a transaction was, and who it was with.
 *
 * TRANSFER_OUT and TRANSFER_IN cover two different things: an on-chain send to
 * an address, and a transfer between two Money Moves accounts. They read
 * identically in the list, so a username transfer looked like a withdrawal and
 * the person on the other side was nowhere on the row - while the metadata had
 * carried their username the whole time.
 */
/**
 * Every bill is stored as an AIRTIME transaction - a data bundle, a meter
 * top-up and a TV subscription all go out through the same route, and only
 * metadata.billType says which. The list read AIRTIME for all of them, so a
 * ten-thousand-naira electricity payment and a hundred-naira recharge were
 * the same word on screen.
 */
const BILL_KIND: Record<string, string> = {
  data: 'DATA',
  electricity: 'ELECTRICITY',
  tv: 'TV',
  airtime: 'AIRTIME',
  betting: 'BETTING',
}

/** What each kind of transaction is called out loud. */
const TX_WORD: Record<string, string> = {
  SELL: 'Sold to a bank',
  BUY: 'Bought',
  DEPOSIT: 'Deposit',
  WITHDRAW: 'Sent out',
  TRANSFER: 'Transfer',
  TRANSFER_OUT: 'Sent',
  TRANSFER_IN: 'Received',
  AIRTIME: 'Bill',
  TV: 'TV',
  LOCK: 'Saved',
  UNLOCK: 'Unlocked',
  SAVINGS_LOCK: 'Saved',
  SAVINGS_WITHDRAW: 'Savings withdrawn',
  SWEEP: 'Swept to USDC',
}
const txWord = (type: string) => TX_WORD[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ')

function txLabel(tx: any): string {
  const m = (tx?.metadata || {}) as any
  if (tx?.type === 'AIRTIME' || tx?.type === 'TV') {
    const kind = BILL_KIND[String(m.billType || '').toLowerCase()] || txWord(tx.type)
    // The provider belongs in the name of the thing: MTN and BEDC are what
    // someone scanning this list is actually looking for.
    const who = m.disco || m.network
    return who ? `${kind} \u00b7 ${who}` : `${kind} \u00b7 ${tx.asset}`
  }
  if (m.transferType === 'username') {
    // Both parties, in the direction the money went - and the same sentence on
    // each side of it, so the pair reads as one event rather than two.
    const owner = tx.user?.username
    const from = tx.type === 'TRANSFER_IN' ? m.senderUsername : owner
    const to = tx.type === 'TRANSFER_IN' ? owner : m.recipientUsername
    return from && to
      ? `@${from} to @${to} \u00b7 ${tx.asset}`
      : `Username transfer \u00b7 ${tx.asset}`
  }
  // A converted deposit is named for what was paid in. "DEPOSIT \u00b7 USDC" is
  // true of every deposit in the list and says nothing about the one that
  // arrived as Bitcoin.
  if (m.source === 'routed_deposit' && m.sentSymbol) {
    return `Deposit \u00b7 ${m.sentSymbol} to ${tx.asset}`
  }
  // A business's checkout paid from the wallet, and a business's money settled into it:
  // named for the business, not as a withdrawal or a deposit from nowhere.
  if (tx?.type === 'WITHDRAW' && m.payee) return `Paid a business \u00b7 ${m.payee}`
  if (m.source === 'business_settlement') return `Settlement from ${m.businessName ?? 'a business'}`
  return `${txWord(tx.type)} \u00b7 ${tx.asset}`
}

/* ═══ Verification ═════════════════════════════════════════════════ */

function Kyc({ initial }: { initial?: string }) {
  // The first three tabs are the live queue, which only the provider decides.
  // "Old" is everything the previous system left behind - approved, pending or
  // refused - kept where it can be read but not mistaken for work to do.
  const [tab, setTab] = useState(initial ?? 'PENDING')
  const [oldStatus, setOldStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ submissions: any[]; pagination: any }>({ submissions: [], pagination: {} })
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<any>(null)
  const [revoking, setRevoking] = useState(false)
  const [reason, setReason] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [recheckNote, setRecheckNote] = useState('')

  const isOld = tab === 'OLD'

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  /**
   * Read Didit again for this submission.
   *
   * A reviewer who corrects a name, or types in what the OCR could not read,
   * is editing Didit's copy. Ours was taken when the decision first landed and
   * nothing updates it unless a data.updated webhook is wired up. This asks.
   */
  const recheck = async () => {
    if (!docs) return
    setRechecking(true)
    setRecheckNote('')
    const res = await api(`/kyc/${docs.id}/recheck`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setRechecking(false)
    if (!res.ok) {
      setRecheckNote(body?.error || 'The identity check did not answer.')
      return
    }
    const sub = body?.submission
    /**
     * The whole sheet again, not just the submission row.
     *
     * The response carries what Didit said; the NIN on file comes from the
     * account and is the thing most likely to have just changed. Merging only
     * the submission left the reviewer looking at a stale "none" directly
     * under a message saying the re-read had worked.
     */
    const fresh = await get<any>(`/kyc/${docs.id}/documents`, null)
    setDocs((d: any) => (d ? { ...d, ...sub, ...(fresh ?? {}) } : d))

    const name = [sub?.firstName, sub?.lastName].filter(Boolean).join(' ')
    const found = body?.harvested
      ? ` Found ${body.harvested} more identifier${body.harvested === 1 ? '' : 's'} on their other sessions.`
      : ''
    setRecheckNote(
      (name
        ? `The identity check says ${name}${sub?.documentNumber ? `, ${sub.documentNumber}` : ''}.`
        : 'The identity check still has nothing on file for this one.') + found,
    )
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({
      status: isOld ? oldStatus : tab,
      provider: isOld ? 'legacy' : 'didit',
      page: String(page),
      limit: '20',
    })
    if (q) params.set('search', q)
    setData(await get(`/kyc?${params}`, { submissions: [], pagination: {} }))
    setLoading(false)
  }, [tab, oldStatus, isOld, q, page])

  const loadCounts = useCallback(async () => {
    const [p, v, r, o] = await Promise.all([
      get<any>('/kyc?status=PENDING&provider=didit&page=1&limit=1', {}),
      get<any>('/kyc?status=VERIFIED&provider=didit&page=1&limit=1', {}),
      get<any>('/kyc?status=REJECTED&provider=didit&page=1&limit=1', {}),
      get<any>('/kyc?status=ALL&provider=legacy&page=1&limit=1', {}),
    ])
    setCounts({
      PENDING: p?.pagination?.total || 0,
      VERIFIED: v?.pagination?.total || 0,
      REJECTED: r?.pagination?.total || 0,
      OLD: o?.pagination?.total || 0,
    })
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadCounts() }, [loadCounts])

  /**
   * One row per person, not per attempt.
   *
   * Starting verification opens a session at the provider and writes a row
   * against its id; abandoning it and starting again writes a second. Both are
   * real attempts and both are kept, but the queue is a list of people waiting,
   * so it shows the newest and says how many there were.
   */
  const rows = (() => {
    const seen = new Map<string, any>()
    for (const k of data.submissions) {
      const key = k.user?.id || k.user?.email || k.id
      const prev = seen.get(key)
      if (!prev) seen.set(key, { ...k, attempts: 1 })
      else prev.attempts += 1
    }
    return [...seen.values()]
  })()

  async function openDocs(k: any) {
    setRevoking(false)
    setReason('')
    setDocs({ ...k, loading: true })
    const d = await get<any>(`/kyc/${k.id}/documents`, null)
    setDocs(d ? { ...k, ...d } : { ...k, error: true })
  }

  /**
   * Taking a verification back.
   *
   * The provider decides who passes; this is for the cases it cannot see - an
   * ID that turns out to be someone else's, a document reported stolen. It
   * drops the account to rejected and detaches the session so the next poll
   * cannot quietly restore it.
   */
  /**
    * Ask the provider about everyone still waiting, in one go.
    *
    * A submission goes stale when nobody is looking: somebody passes, taps
    * Verify again, and the abandoned session sits on top of the approved one
    * until they next open the app. Re-reading one at a time only helps if you
    * already know which one to open.
    */
  const [sweeping, setSweeping] = useState(false)
  const [sweepNote, setSweepNote] = useState('')

  async function recheckAll() {
    setSweeping(true)
    setSweepNote('')
    const res = await api('/kyc/recheck-all', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setSweeping(false)
    if (!res.ok) {
      setSweepNote(body?.error || 'The identity check did not answer.')
      return
    }
    const done: { username: string | null; status: string }[] = body?.changed || []
    setSweepNote(
      done.length
        ? `${done.map((d) => `@${d.username} ${d.status.toLowerCase()}`).join(', ')}.`
        : `Asked about ${body?.checked ?? 0}. Nothing has been decided yet.`,
    )
    load()
    loadCounts()
  }

  async function revoke() {
    if (!docs || !reason.trim()) return
    await api(`/kyc/${docs.id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) })
    setDocs(null)
    setRevoking(false)
    setReason('')
    load()
    loadCounts()
  }

  return (
    <div className="space-y-4">
      <Search value={search} onChange={setSearch} placeholder="Name, email or username" />

      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <Chips
            items={[
              { id: 'PENDING', label: 'Waiting', count: counts.PENDING },
              { id: 'VERIFIED', label: 'Verified', count: counts.VERIFIED },
              { id: 'REJECTED', label: 'Rejected', count: counts.REJECTED },
              { id: 'OLD', label: 'Old verifications', count: counts.OLD },
            ]}
            value={tab}
            onChange={(t) => { setTab(t); setPage(1) }}
          />
        </div>
        {/* Not on the old-verifications tab: those predate Didit and there is
            nothing to ask about them. */}
        {!isOld && (
          <Btn onClick={recheckAll} disabled={sweeping}>
            {sweeping ? 'Checking…' : 'Check every result again'}
          </Btn>
        )}
      </div>

      {!!sweepNote && (
        <div className="pl-1"><MetaBit color={C.lime}>{sweepNote}</MetaBit></div>
      )}

      {isOld && (
        <div className="pl-1">
          <div className="mb-2"><Label>From the previous system</Label></div>
          <Chips
            items={[
              { id: 'ALL', label: 'All' },
              { id: 'VERIFIED', label: 'Approved' },
              { id: 'PENDING', label: 'Never decided' },
              { id: 'REJECTED', label: 'Refused' },
            ]}
            value={oldStatus}
            onChange={(s) => { setOldStatus(s); setPage(1) }}
          />
        </div>
      )}

      <Card>
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>{isOld ? 'Nothing from the old system here.' : 'Nothing here.'}</Empty>
        ) : (
          rows.map((k) => (
            <Row
              key={k.id}
              lead={[k.firstName, k.lastName].filter(Boolean).join(' ') || k.user?.username || 'Unnamed'}
              sub={k.user?.email}
              meta={
                <>
                  <Status value={k.status} />
                  <MetaBit>{k.documentType || 'document'}</MetaBit>
                  <MetaBit>{ago(k.createdAt)}</MetaBit>
                  {k.attempts > 1 && <MetaBit color={C.amber}>{k.attempts} attempts</MetaBit>}
                  {k.failureReason && <MetaBit color={C.red}>{k.failureReason}</MetaBit>}
                </>
              }
              trail={<span style={{ color: C.dim, fontSize: 18 }}>›</span>}
              onClick={() => openDocs(k)}
            />
          ))
        )}
        <Pager
          page={data.pagination?.page || 1}
          pages={data.pagination?.pages || 1}
          total={data.pagination?.total || 0}
          unit="submissions"
          onPage={setPage}
        />
      </Card>

      {docs && (
        <Modal
          title="Submission"
          onClose={() => setDocs(null)}
          footer={
            revoking ? (
              <>
                <Btn onClick={() => setRevoking(false)}>Cancel</Btn>
                <Btn kind="danger" onClick={revoke} disabled={!reason.trim()} full>
                  Revoke verification
                </Btn>
              </>
            ) : (
              <>
                <Btn onClick={() => setDocs(null)} full>
                  Close
                </Btn>
                <Btn onClick={recheck} disabled={rechecking}>
                  {rechecking ? 'Checking…' : 'Read the result again'}
                </Btn>
                {docs.status !== 'REJECTED' && (
                  <Btn kind="danger" onClick={() => setRevoking(true)}>
                    Revoke
                  </Btn>
                )}
              </>
            )
          }
        >
          {docs.loading ? (
            <Loading />
          ) : docs.error ? (
            <Empty>Could not load the documents.</Empty>
          ) : (
            <>
              <Detail k="Status" v={<Status value={docs.status} />} />
              <Detail k="Person" v={docs.user?.username ? `@${docs.user.username}` : docs.user?.email || '—'} />
              {docs.failureReason && (
                <Detail k="Provider said" v={<span style={{ color: C.red }}>{docs.failureReason}</span>} />
              )}
              {/* What we hold comes first: it is what the account can actually
                  transact on. The provider's read sits under it as evidence. */}
              <Detail
                k="Name on file"
                v={
                  [docs.onFile?.firstName, docs.onFile?.lastName].filter(Boolean).join(' ') || (
                    <span style={{ color: C.dim }}>none — this account has no name</span>
                  )
                }
              />
              <Detail
                k="NIN on file"
                v={
                  docs.onFile?.nin ? (
                    docs.onFile.nin
                  ) : docs.onFile?.ninUnusable ? (
                    // There IS one, and the bank will not take it. Saying only
                    // "none" sent support looking for a document the person had
                    // already submitted.
                    <span style={{ color: C.amber }}>
                      {docs.onFile.ninUnusable} — not 11 digits, the bank will refuse it
                    </span>
                  ) : (
                    <span style={{ color: C.red }}>none — they cannot open a payment account</span>
                  )
                }
                mono
              />
              <Detail
                k="Name on the ID"
                v={
                  <>
                    {[docs.firstName, docs.lastName].filter(Boolean).join(' ') || '—'}
                    {/* Said plainly, because these came off a different session
                        than the one on screen and a support call turns on
                        knowing that. */}
                    {docs.borrowedFrom && (
                      <span style={{ color: C.dim }}>
                        {'  · from their attempt on '}
                        {new Date(docs.borrowedFrom).toLocaleString('en-NG')}
                      </span>
                    )}
                  </>
                }
              />
              <Detail k="Type" v={docs.documentType || '—'} />
              <Detail k="Number" v={docs.documentNumber || '—'} mono />
              {recheckNote && (
                <p className="text-[12px] mt-2" style={{ color: C.muted }}>{recheckNote}</p>
              )}
              <div className="space-y-3 mt-4">
                {docs.frontImage && <img src={docs.frontImage} alt="Front" className="w-full rounded-xl" style={{ border: `1px solid ${C.line}` }} />}
                {docs.backImage && <img src={docs.backImage} alt="Back" className="w-full rounded-xl" style={{ border: `1px solid ${C.line}` }} />}
                {!docs.frontImage && !docs.backImage && <Empty>The provider holds the images; nothing was stored here.</Empty>}
              </div>

              {revoking && (
                <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${C.line}` }}>
                  <Field label="Why">
                    <Textarea
                      rows={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="The ID belongs to someone else, reported stolen…"
                    />
                  </Field>
                  <p className="text-[12px] mt-3" style={{ color: C.muted }}>
                    The account drops to rejected and loses the limits verification gave it. The person sees this
                    reason in the app and can start again with a new document.
                  </p>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

/* ═══ People ═══════════════════════════════════════════════════════ */


/**
 * Naira deposits stopped because of who sent them.
 *
 * A deposit must come from an account in the buyer's own name. Where it did
 * not, the naira is ours and the crypto is not released until a person decides.
 *
 * Neither button moves money. Both record what was decided, and the doing is
 * by hand: the coin goes out from the treasury, the naira goes back through the
 * charge in the Flutterwave dashboard. A button that looked like it had paid
 * out and had not would be worse than no button at all.
 *
 * The "All checked" tab is what the shadow period is for: nothing reaches Held
 * while the check is only recording, and the verdicts are the whole point.
 */
/**
 * Radar — accounts moving crypto often enough to be worth a look.
 *
 * Counts only the transfers we pay gas for: withdrawals and username
 * transfers. Solana has its own column because that is the chain where a
 * sponsored transfer can cost rent rather than a fraction of a cent - opening
 * a recipient's token account costs about 0.0015 SOL, and that rent is
 * refundable to whoever owns the account. An address can take a withdrawal,
 * close the account we opened, pocket the rent and come back for another. One
 * did, fifty-six times in an afternoon, and emptied the gas wallet.
 *
 * Being on this list is not an accusation. Somebody emptying a wallet across
 * several chains lands here too, which is why the row carries who they are and
 * when they joined rather than just a number - an account that signed up this
 * morning, never verified, and has made forty transfers is a different story
 * from a regular at the same count.
 */
function Radar() {
  const [hours, setHours] = useState('24')
  // Opens on the cap, so the default view is the accounts the gate is refusing.
  const [min, setMin] = useState('5')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setData(await get(`/radar?hours=${hours}&min=${min}`, { rows: [], count: 0 }))
    setLoading(false)
  }, [hours, min])

  useEffect(() => { load() }, [load])

  const rows: any[] = data?.rows ?? []

  return (
    <div className="space-y-4">
      <H1>Radar</H1>

      <Chips
        items={[
          { id: '24', label: 'Last 24 hours' },
          { id: '72', label: 'Last 3 days' },
          { id: '168', label: 'Last week' },
        ]}
        value={hours}
        onChange={setHours}
      />
      <Chips
        items={[
          { id: '5', label: '5+' },
          { id: '10', label: '10+' },
          { id: '25', label: '25+' },
        ]}
        value={min}
        onChange={setMin}
      />

      {loading ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>
          Nobody has made {min} or more sponsored transfers in this window. The Solana
          cap is {data?.solanaDailyCap ?? 5} a day and is enforced, so anything at that
          number is already being refused.
        </Empty>
      ) : (
        <Card>
          {rows.map((r) => {
            /* Amber once it is at the cap, because that account is being
               refused right now and somebody should know why. Red when it is
               past it, which can only mean the transfers predate the cap. */
            const flag =
              r.solana > (data?.solanaDailyCap ?? 5) ? C.red : r.atCap ? C.amber : undefined
            return (
              <Row
                key={r.userId}
                dense
                flag={flag}
                lead={r.username ? `@${r.username}` : r.email || r.userId}
                sub={r.email && r.username ? r.email : undefined}
                meta={
                  <>
                    <MetaBit color={r.solana >= (data?.solanaDailyCap ?? 5) ? C.amber : undefined}>
                      {r.solana} on Solana
                    </MetaBit>
                    <MetaBit>{r.withdrawals} withdrawals</MetaBit>
                    <MetaBit>{r.usernameTransfers} to usernames</MetaBit>
                    <MetaBit color={r.kycStatus === 'VERIFIED' ? undefined : C.amber}>
                      {r.kycStatus === 'VERIFIED' ? 'verified' : 'not verified'}
                    </MetaBit>
                    {r.joined && (
                      <MetaBit>joined {new Date(r.joined).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</MetaBit>
                    )}
                  </>
                }
                trail={r.total}
                trailSub="transfers"
              />
            )
          })}
        </Card>
      )}

      <p className="text-[12px] leading-[18px] px-1" style={{ color: C.dim }}>
        Sponsored transfers only — withdrawals and username transfers, the ones that
        cost us gas. Arc is not counted: the sender pays their own there.
      </p>
    </div>
  )
}

function Deposits() {
  const [tab, setTab] = useState('HELD')
  const [verdict, setVerdict] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ held: any[]; pagination: any }>({ held: [], pagination: {} })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<any>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    // Filtered on the server, which the endpoint already supports. Doing it
     // here would filter the page in front of you and leave the count and the
     // pager describing a different list.
    const q = `status=${tab}&page=${page}&limit=25${verdict ? `&verdict=${verdict}` : ''}`
    setData(await get(`/funding/held?${q}`, { held: [], pagination: {} }))
    setLoading(false)
  }, [tab, page, verdict])

  useEffect(() => { load() }, [load])

  const act = async (what: 'release' | 'reject') => {
    if (!open) return
    setBusy(what)
    setErr('')
    const res = await api(`/funding/${open.id}/${what}`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() }),
    })
    setBusy('')
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body?.error || 'That did not go through.')
      return
    }
    setOpen(null)
    setNote('')
    load()
  }

  const verdictColor = (v: string) =>
    v === 'MATCH' ? C.lime : v === 'MISMATCH' ? C.red : C.amber

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <Chips
          value={tab}
          onChange={(v) => { setTab(v); setPage(1) }}
          items={[
            { id: 'HELD', label: 'Held' },
            { id: 'ALL', label: 'All checked' },
          ]}
        />
        {/* The verdict is what somebody comes to this list to sort by: a
            mismatch is the row that needs a person, a match is the row that
            does not. */}
        <Chips
          value={verdict}
          onChange={(v) => { setVerdict(v); setPage(1) }}
          items={[
            { id: '', label: 'Any verdict' },
            { id: 'MATCH', label: 'Match' },
            { id: 'MISMATCH', label: 'Mismatch' },
          ]}
        />
      </div>

      {loading ? (
        <Loading />
      ) : !data.held.length ? (
        <Empty>
          {tab === 'HELD'
            ? 'No deposit is waiting on a decision.'
            : 'No deposit has been checked yet.'}
          {verdict ? ` None with a ${verdict.toLowerCase()} verdict, at least.` : ''}
        </Empty>
      ) : (
        <Card>
          {data.held.map((d: any) => (
            <Row
              key={d.id}
              dense
              flag={d.nameVerdict === 'MISMATCH' ? C.red : undefined}
              lead={`${fmtNgn(d.amountNaira)} → ${d.token}`}
              sub={`@${d.user?.username ?? '—'}`}
              meta={
                <>
                  <MetaBit color={verdictColor(d.nameVerdict)}>{d.nameVerdict ?? 'NOT CHECKED'}</MetaBit>
                  <MetaBit>{d.senderName ?? 'no sender name'}</MetaBit>
                </>
              }
              trail={<span style={{ color: C.dim, fontSize: 18 }}>›</span>}
              trailSub={ago(d.createdAt)}
              onClick={() => { setOpen(d); setNote(''); setErr('') }}
            />
          ))}
        </Card>
      )}

      <Pager
        page={data.pagination?.page ?? 1}
        pages={data.pagination?.pages ?? 1}
        total={data.pagination?.total ?? 0}
        unit="deposit"
        onPage={setPage}
      />

      {open && (
        <Modal title={`${fmtNgn(open.amountNaira)} → ${open.token}`} onClose={() => setOpen(null)}>
          <div className="flex flex-col gap-3">
            <Detail k="Sent by" v={open.senderName ?? 'The bank named nobody'} />
            <Detail k="From" v={open.senderBank ?? '—'} />
            <Detail k="Name on file" v={open.expectedName ?? '—'} />
            <Detail k="Verdict" v={<span style={{ color: verdictColor(open.nameVerdict) }}>{open.nameVerdict ?? '—'}</span>} />
            <Detail k="Buyer" v={`@${open.user?.username ?? '—'} · ${open.user?.email ?? ''}`} />
            <Detail k="Buying" v={`${open.convertedAmount} ${open.token} on ${open.chain}`} />
            {/* Where it would actually land. Releasing is a decision to move
                somebody else's money, and an account with no wallet on this
                chain looked exactly like one that was ready - right up to the
                moment the payout failed. */}
            <Detail
              k="Paying out to"
              mono
              v={
                open.payoutAddress ?? (
                  <span style={{ color: C.red }}>No wallet on {open.chain}</span>
                )
              }
            />
            <Detail k="Reference" v={open.reference} mono />
            {open.reviewedBy && <Detail k="Reviewed" v={open.reviewedBy} />}

            {open.status === 'HELD' && (
              <>
                <Field label="Note (optional)">
                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why you are releasing or rejecting this"
                  />
                </Field>

                {/* Neither button moves money. Said here rather than
                    discovered later by someone who thought one of them had. */}
                <p style={{ color: C.dim, fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                  Both choices record the decision and notify the buyer. Neither moves money:
                  send the {open.token} from the treasury yourself, or issue the refund against
                  the charge in the payment provider's dashboard.
                </p>

                {err && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{err}</p>}

                <div className="flex gap-2">
                  <Btn kind="primary" onClick={() => act('release')} disabled={!!busy}>
                    {busy === 'release' ? 'Saving…' : 'Approved — mark sent'}
                  </Btn>
                  <Btn kind="danger" onClick={() => act('reject')} disabled={!!busy}>
                    {busy === 'reject' ? 'Saving…' : 'Rejected — mark refunded'}
                  </Btn>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}


function People({ initial }: { initial?: string }) {
  const [status, setStatus] = useState(initial ?? 'active')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ users: any[]; pagination: any }>({ users: [], pagination: {} })
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useOpenPage<any>()

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '20' })
    if (status) params.set('status', status)
    if (q) params.set('search', q)
    setData(await get(`/users?${params}`, { users: [], pagination: {} }))
    setLoading(false)
  }, [status, q, page])

  useEffect(() => { load() }, [load])

  // A person as a page; the list keeps its filters and place underneath.
  if (open) return <PersonPage user={open} from="People" onBack={() => setOpen(null)} onChanged={() => { setOpen(null); void load() }} />

  return (
    <div className="space-y-4">
      <Search value={search} onChange={setSearch} placeholder="Email, username or phone" />
      <Chips
        items={[
          { id: 'active', label: 'Active' },
          { id: 'deletion_requested', label: 'Wants out' },
          { id: 'deleted', label: 'Closed' },
          { id: '', label: 'Everyone' },
        ]}
        value={status}
        onChange={(s) => { setStatus(s); setPage(1) }}
      />

      <Card>
        {loading ? (
          <Loading />
        ) : data.users.length === 0 ? (
          <Empty>Nobody matches that.</Empty>
        ) : (
          data.users.map((u) => (
            <Row
              key={u.id}
              dense
              flag={u.deletionRequestedAt && !u.deletedAt ? C.amber : undefined}
              lead={u.username ? `@${u.username}` : u.email}
              sub={u.username ? u.email : u.phone || ''}
              meta={
                <>
                  <Status value={u.kycStatus || 'NONE'} />
                  <MetaBit>joined {ago(u.createdAt)}</MetaBit>
                  {u.deletionRequestedAt && !u.deletedAt && <MetaBit color={C.amber}>asked to close</MetaBit>}
                  {u.deletedAt && <MetaBit color={C.dim}>closed {ago(u.deletedAt)}</MetaBit>}
                </>
              }
              trail={<span style={{ color: C.dim, fontSize: 18 }}>›</span>}
              onClick={() => setOpen(u)}
            />
          ))
        )}
        <Pager
          page={data.pagination?.page || 1}
          pages={data.pagination?.pages || 1}
          total={data.pagination?.total || 0}
          unit="people"
          onPage={setPage}
        />
      </Card>

    </div>
  )
}

/* ═══ Record pages ═════════════════════════════════════════════════ */

/**
 * A record opened from a list, as a page of its own - the way the Business side opens a payment or a business.
 *
 * The list stays mounted underneath, hidden, so coming back finds it exactly as it was. Opening adds a history
 * entry, so the browser's back button closes the page; a page opened from another (a transaction from a person)
 * only closes itself, because each knows how deep it was opened.
 */
function useOpenPage<T>(): [T | null, (next: T | null) => void] {
  const [value, setValue] = useState<T | null>(null)
  const depth = useRef(0)
  const scroll = useRef(0)
  useEffect(() => {
    const onPop = () => {
      const now = (window.history.state as { mmDepth?: number } | null)?.mmDepth ?? 0
      if (depth.current && now < depth.current) {
        depth.current = 0
        setValue(null)
        requestAnimationFrame(() => window.scrollTo(0, scroll.current))
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const set = useCallback((next: T | null) => {
    if (next) {
      scroll.current = window.scrollY
      depth.current = ((window.history.state as { mmDepth?: number } | null)?.mmDepth ?? 0) + 1
      window.history.pushState({ ...(window.history.state ?? {}), mmDepth: depth.current }, '')
      setValue(next)
      window.scrollTo({ top: 0 })
    } else if (depth.current) {
      window.history.back()
    } else {
      setValue(null)
    }
  }, [])
  return [value, set]
}

/** The way back to where a page was opened from. */
function BackTo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 -ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-lg pl-1.5 pr-2.5 text-[13.5px] font-medium transition-colors hover:bg-white/[0.04]"
      style={{ color: C.muted }}
    >
      <ArrowLeft size={15} /> {label}
    </button>
  )
}

const STATUS_CHOICES = [
  ['COMPLETED', 'Completed'],
  ['FAILED', 'Failed'],
  ['CANCELLED', 'Cancelled'],
  ['REFUNDED', 'Refunded'],
] as const

function TxPage({ tx, from, onBack, onDone, onPerson }: { tx: any; from: string; onBack: () => void; onDone: () => void; onPerson?: (user: any) => void }) {
  const [status, setStatus] = useState<string>(tx.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const meta = tx.metadata || {}
  const hash = meta.txHash as string | undefined
  const url = hash ? explorerUrl(tx.chain, hash) : null
  const ngn = txNgn(tx)

  /**
   * A deposit paid in another token on another chain. Until it settles the USDC leg is zero on a chain the person
   * never touched; what support needs is the half they can check: the asset, the network and the transaction on it.
   */
  const routed = meta.source === 'routed_deposit'
  const settled = tx.status === 'COMPLETED'
  const sourceUrl = routed ? routedExplorerUrl(meta.chainId, meta.sourceTxHash) : null
  const chainName = tx.chain ? CHAIN_NAMES[tx.chain] ?? tx.chain : 'No chain'
  const link = (href: string | null, text: string) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" className="underline decoration-[#5C6650] underline-offset-[3px] hover:decoration-[#ECEFE7]" style={{ fontFamily: MONO }}>
        {text}
      </a>
    ) : (
      <span style={{ fontFamily: MONO }}>{text}</span>
    )

  async function save() {
    setBusy(true)
    setErr('')
    const res = await api(`/transactions/${tx.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, note }) }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {}
      setErr(b?.error || 'That did not save.')
      return
    }
    onDone()
  }

  const amount =
    routed && !settled ? (
      <>
        {meta.sentAmount ?? '?'} <span style={{ color: C.muted, fontWeight: 500 }}>{meta.sentSymbol ?? ''}</span>
      </>
    ) : (
      <>
        {coins(tx.amount)} <span style={{ color: C.muted, fontWeight: 500 }}>{tx.asset}</span>
      </>
    )

  const details: ([ReactNode, ReactNode] | false | null | undefined)[] = [
    ['Kind', txLabel(tx)],
    routed && ['Paid in', `${meta.sentAmount ?? '?'} ${meta.sentSymbol ?? ''}`],
    routed && ['From', CHAIN_NAME[Number(meta.chainId)] ?? String(meta.chainId ?? '')],
    routed && !!meta.sourceTxHash && ['Their transaction', link(sourceUrl, shortHash(String(meta.sourceTxHash), 10, 8))],
    routed && meta.feeAmount != null && ['Conversion fee', `${meta.feeAmount} ${meta.feeSymbol ?? ''}`],
    routed && ['Settles as', settled ? `${coins(tx.amount)} ${tx.asset} on ${chainName}` : `${tx.asset} on ${chainName}, not settled yet`],
    routed && !!meta.depositId && ['Provider deposit', <span style={{ fontFamily: MONO }}>{String(meta.depositId)}</span>],
    routed && !!meta.routedStatus && ['Provider status', String(meta.routedStatus)],
    meta.billType === 'electricity' ? !!(meta.disco || meta.network) && ['Biller', meta.disco || meta.network] : !!meta.network && ['Network', meta.network],
    !!meta.planLabel && ['Plan', meta.planLabel],
    !!meta.customerName && ['Customer', meta.customerName],
    !!meta.meterType && ['Meter type', meta.meterType === 'prepaid' ? 'Prepaid' : 'Postpaid'],
    !!meta.phone && [meta.billType === 'electricity' ? 'Meter number' : 'Number', <span style={{ fontFamily: MONO }}>{meta.phone}</span>],
    !!meta.electricityToken && ['Token', <span style={{ fontFamily: MONO }}>{meta.electricityToken}</span>],
    !!meta.bankName && ['Bank', `${meta.bankName}${meta.accountNumber ? ` · ${meta.accountNumber}` : ''}`],
    !!meta.accountName && ['Account name', meta.accountName],
    // What the sender said it was for: the first question a support conversation about a transfer asks.
    !!meta.narration && ['Narration', meta.narration],
    !!meta.payoutStatus && ['Payout', meta.payoutStatus],
    !!meta.payoutError && ['Payout error', <span style={{ color: C.red }}>{meta.payoutError}</span>],
    !!meta.chainError && ['Chain error', <span style={{ color: C.red }}>{meta.chainError}</span>],
    ['Reference', <span style={{ fontFamily: MONO }}>{tx.reference || ''}</span>],
    ['Created', new Date(tx.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })],
  ]

  return (
    <div>
      <BackTo label={from} onClick={onBack} />
      <PageHead
        title={txLabel(tx)}
        meta={[isStuckPayout(tx) ? <Status value="STUCK" /> : <Status value={tx.status} />, <When at={tx.createdAt} full />, tx.user?.username ? `@${tx.user.username}` : tx.user?.email]}
      >
        <div className="mt-4 text-[30px] font-semibold tracking-[-0.03em] tabular-nums" style={{ color: C.text }}>
          {amount}
          {ngn != null && <span className="ml-3 text-[16px] font-medium" style={{ color: C.muted }}>{fmtNgn(ngn)}</span>}
        </div>
        {routed && (
          <div className="mt-1 text-[13px]" style={{ color: C.muted }}>
            {settled ? `Converted from ${meta.sentAmount ?? '?'} ${meta.sentSymbol ?? ''}` : `Converting to ${tx.asset} on ${CHAIN_NAME[Number(meta.chainId)] ?? meta.chainId}`}
          </div>
        )}
      </PageHead>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Details">
            <Facts wide rows={details} />
          </Panel>

          <ActionPanel title="Change its status" sub="Only once you've checked what really happened. It changes the record and the person's history; it doesn't move any money.">
            <Segmented value={status} onChange={setStatus} items={STATUS_CHOICES} />
            <Field label="Why (kept on the record)">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked, and what you found" />
            </Field>
            {err && <div className="text-[12.5px]" style={{ color: C.red }}>{err}</div>}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <Btn kind="primary" onClick={save} disabled={busy || status === tx.status}>
                {busy ? 'Saving…' : status === tx.status ? 'Pick a new status' : `Mark ${STATUS_CHOICES.find(([s]) => s === status)?.[1].toLowerCase()}`}
              </Btn>
            </div>
          </ActionPanel>
        </div>

        <div className="space-y-5">
          <Panel title="Person">
            <Facts
              rows={[
                ['Username', tx.user?.username ? `@${tx.user.username}` : null],
                ['Email', tx.user?.email ? <span className="break-all">{tx.user.email}</span> : null],
              ]}
            />
            {onPerson && tx.user?.id && (
              <div className="mt-3">
                <Btn onClick={() => onPerson(tx.user)} full>
                  Open their profile
                </Btn>
              </div>
            )}
          </Panel>
          <Panel title="On chain">
            <Facts
              rows={[
                ['Network', chainName],
                ['Coin', tx.asset],
                !!hash && ['Transaction', link(url, shortHash(hash, 8, 6))],
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** One person's history: the same groups the transaction list sorts by, with what they received too. */
const PERSON_KINDS: Record<string, string[]> = {
  bank: ['SELL'],
  bills: ['AIRTIME', 'TV'],
  username: ['TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT'],
  crypto: ['WITHDRAW'],
  deposit: ['DEPOSIT', 'BUY'],
}
const PER_PAGE = 15

function PersonPage({ user, from, onBack, onChanged }: { user: any; from: string; onBack: () => void; onChanged: () => void }) {
  const [wallets, setWallets] = useState<any[]>([])
  const [txs, setTxs] = useState<any[] | null>(null)
  const [tab, setTab] = useState<'about' | 'txs'>('about')
  const [kind, setKind] = useState('')
  const [txPage, setTxPage] = useState(1)
  const [openTx, setOpenTx] = useOpenPage<any>()
  const [copied, setCopied] = useState<string | null>(null)
  const [confirm, setConfirm] = useState('')
  const [closePw, setClosePw] = useState('')
  const [closeErr, setCloseErr] = useState('')
  const [busy, setBusy] = useState(false)

  const loadTxs = useCallback(async () => {
    const t = await get<any>(`/users/${user.id}/transactions?limit=200`, { transactions: [] })
    setTxs(t.transactions || [])
  }, [user.id])

  useEffect(() => {
    ;(async () => {
      const w = await get<any>(`/users/${user.id}/wallets`, { wallets: [] })
      setWallets(w.wallets || w || [])
    })()
    void loadTxs()
  }, [user.id, loadTxs])

  // Filtered and paged here: the history is one request, and paging through it shouldn't cost a round trip each time.
  const all = txs ?? []
  const shown = kind ? all.filter((t: any) => PERSON_KINDS[kind]?.includes(t.type)) : all
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const page = Math.min(txPage, pages)
  const slice = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  /**
   * One row per address, not per asset. A wallet row exists for every asset on every chain, so four tokens on
   * Movement and four on Base read as fifteen wallets when it's three - and the address was the part repeated.
   */
  const addresses = (() => {
    const by = new Map<string, { address: string; chains: Set<string>; assets: Set<string> }>()
    for (const w of wallets) {
      if (!w.address) continue
      const hit = by.get(w.address) ?? { address: w.address, chains: new Set(), assets: new Set() }
      hit.chains.add(w.chain)
      hit.assets.add(w.asset)
      by.set(w.address, hit)
    }
    return [...by.values()]
  })()

  const copy = (a: string) => {
    navigator.clipboard?.writeText(a).then(
      () => {
        setCopied(a)
        setTimeout(() => setCopied((c) => (c === a ? null : c)), 1400)
      },
      () => {},
    )
  }

  async function close() {
    setBusy(true)
    setCloseErr('')
    const res = await api(`/users/${user.id}`, { method: 'DELETE', body: JSON.stringify({ password: closePw }) }).catch(() => null)
    setBusy(false)
    setClosePw('')
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {}
      setCloseErr(b?.error || 'That did not close.')
      return
    }
    onChanged()
  }

  const name = user.username ? `@${user.username}` : user.email
  if (openTx) {
    return <TxPage tx={openTx} from={name} onBack={() => setOpenTx(null)} onDone={() => { setOpenTx(null); void loadTxs() }} />
  }

  const historyColumns = TX_COLUMNS.map((c) =>
    c.key === 'what' ? { ...c, cell: (t: any) => <div className="truncate font-medium">{txLabel({ ...t, user })}</div> } : c,
  )

  return (
    <div>
      <BackTo label={from} onClick={onBack} />
      <PageHead
        title={name}
        meta={[
          <Status value={user.kycStatus || 'NONE'} />,
          user.username ? user.email : null,
          `Joined ${new Date(user.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`,
          user.deletedAt ? <Tag>Closed</Tag> : user.deletionRequestedAt ? <Tag tone="warn">Asked to close</Tag> : null,
        ]}
      />

      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            ['about', 'Details'],
            ['txs', 'Transactions', all.length],
          ]}
        />
      </div>

      {tab === 'txs' ? (
        <div className="space-y-4">
          <Segmented
            value={kind}
            onChange={(k) => {
              setKind(k)
              setTxPage(1)
            }}
            items={[
              ['', 'All', all.length],
              ['bank', 'Bank'],
              ['bills', 'Bills'],
              ['username', 'Username'],
              ['crypto', 'Crypto'],
              ['deposit', 'Deposits'],
            ]}
          />
          <Panel flush>
            {txs == null ? (
              <Loading />
            ) : (
              <Table rows={slice} columns={historyColumns} rowKey={(t) => t.id} flag={(t) => (isStuckPayout(t) ? 'bad' : undefined)} onRow={(t) => setOpenTx({ ...t, user })} empty={all.length === 0 ? 'Nothing yet.' : 'None of those.'} />
            )}
            {shown.length > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-[12.5px]" style={{ color: C.dim }}>
                <span className="tabular-nums">
                  {shown.length.toLocaleString()} transactions{pages > 1 ? `, page ${page} of ${pages}` : ''}
                  {/* Said plainly: the history is one request, and a very long one is cut at its end. */}
                  {all.length >= 200 ? ', newest 200' : ''}
                </span>
                {pages > 1 && (
                  <div className="flex gap-2">
                    <Btn onClick={() => setTxPage(page - 1)} disabled={page <= 1}>Previous</Btn>
                    <Btn onClick={() => setTxPage(page + 1)} disabled={page >= pages}>Next</Btn>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <Panel title="About">
              <Facts
                wide
                rows={[
                  ['Name', [user.firstName, user.lastName].filter(Boolean).join(' ') || null],
                  ['Email', <span className="break-all">{user.email}</span>],
                  !!user.phone && ['Phone', <span style={{ fontFamily: MONO }}>{user.phone}</span>],
                  ['Verification', <Status value={user.kycStatus || 'NONE'} />],
                  ['Joined', new Date(user.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })],
                  !!user.deletionRequestedAt && ['Asked to close', <span style={{ color: C.amber }}>{new Date(user.deletionRequestedAt).toLocaleDateString('en-NG')}</span>],
                  !!user.deletionReason && ['Their reason', user.deletionReason],
                ]}
              />
            </Panel>

            <Panel title="Addresses" sub="Tap one to copy it." flush>
              {addresses.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13.5px]" style={{ color: C.dim }}>None on file.</div>
              ) : (
                addresses.map((a) => (
                  <button
                    key={a.address}
                    onClick={() => copy(a.address)}
                    className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.025]"
                    style={{ borderTop: `1px solid ${C.lineSoft}` }}
                    title="Copy"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium" style={{ color: C.text }}>
                        {[...a.chains].map((c) => CHAIN_NAMES[c] ?? c).join(', ')}
                      </span>
                      <span className="text-[12px]" style={{ color: C.dim }}>{[...a.assets].join(', ')}</span>
                      <span className="ml-auto text-[12px]" style={{ color: copied === a.address ? C.lime : C.dim }}>
                        {copied === a.address ? 'Copied' : 'Copy'}
                      </span>
                    </div>
                    {/* In full, and wrapped: the middle of an address is exactly the part somebody is comparing. */}
                    <div className="mt-1 text-[12px] leading-[1.45] break-all" style={{ fontFamily: MONO, color: C.muted }}>
                      {a.address}
                    </div>
                  </button>
                ))
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title="Activity">
              <Facts
                rows={[
                  ['Transactions', txs == null ? '…' : all.length >= 200 ? '200+' : all.length.toLocaleString()],
                  ['Last one', all[0] ? <When at={all[0].createdAt} /> : null],
                ]}
              />
              <div className="mt-3">
                <Btn onClick={() => setTab('txs')} full>See their transactions</Btn>
              </div>
            </Panel>

            {!user.deletedAt && (
              <ActionPanel danger title="Close this account" sub="Their history stays, as the law needs, and the wallet stops being reachable from the app. Type CLOSE and the action password to confirm.">
                <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="CLOSE" />
                <Input
                  type="password"
                  name="action-password"
                  autoComplete="new-password"
                  placeholder="Action password"
                  value={closePw}
                  onChange={(e) => {
                    setClosePw(e.target.value)
                    if (closeErr) setCloseErr('')
                  }}
                  aria-label="Action password"
                />
                {closeErr && <div className="text-[12.5px]" style={{ color: C.red }}>{closeErr}</div>}
                <Btn kind="danger" onClick={close} disabled={confirm !== 'CLOSE' || !closePw || busy} full>
                  {busy ? 'Closing…' : 'Close account'}
                </Btn>
              </ActionPanel>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══ Support ══════════════════════════════════════════════════════ */

const chatDay = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })
const chatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
const chatWho = (c: any) => (c?.user?.username ? `@${c.user.username}` : c?.user?.email || 'Someone')

/**
 * Support: the app's live chat, answered here.
 *
 * Conversations down the left, the open one on the right, as the Business side has it. New conversations and new
 * lines arrive without reloading: the list every few seconds, the open chat every three, both paused while the tab
 * is in the background so a support tab left open overnight doesn't poll all night.
 */
function Support({ initial }: { initial?: string }) {
  const [status, setStatus] = useState(initial ?? 'OPEN')
  const [list, setList] = useState<any[] | null>(null)
  const [needsHuman, setNeedsHuman] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    const d = await get<any>(`/chat/conversations?status=${status}`, { conversations: [] })
    setList(d.conversations || [])
    setNeedsHuman(d.needsHumanCount || 0)
  }, [status])

  useEffect(() => {
    setList(null)
    void load()
  }, [load])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 8000)
    return () => clearInterval(t)
  }, [load])

  const shown = (list ?? []).filter((c) => {
    const s = q.trim().toLowerCase()
    return !s || `${c.user?.username ?? ''} ${c.user?.email ?? ''} ${c.lastMessage ?? ''}`.toLowerCase().includes(s)
  })
  const selected = (list ?? []).find((c) => c.id === openId) ?? null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ color: C.muted }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: C.lime }} /> Live, new messages show up by themselves
        </span>
        {needsHuman > 0 && <span>· {needsHuman} waiting for a person</span>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={(s) => {
            setStatus(s)
            setOpenId(null)
          }}
          items={[
            ['OPEN', 'Open', needsHuman],
            ['RESOLVED', 'Resolved'],
          ]}
        />
        <Search value={q} onChange={setQ} placeholder="Search by name, email or message" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={openId ? 'max-lg:hidden' : ''}>
          <div className="overflow-hidden rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            {list == null ? (
              <Loading />
            ) : shown.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px]" style={{ color: C.dim }}>
                {status === 'OPEN' ? 'No open conversations. New ones show up here the moment someone writes.' : 'Nothing resolved yet.'}
              </p>
            ) : (
              shown.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => setOpenId(c.id)}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                  style={{ borderTop: i ? `1px solid ${C.line}` : undefined, background: c.id === openId ? C.raise : undefined, boxShadow: c.needsHuman ? `inset 2px 0 0 ${C.lime}` : undefined }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13.5px]" style={{ color: C.text, fontWeight: c.needsHuman ? 600 : 500 }}>
                      {chatWho(c)}
                    </span>
                    <span className="shrink-0 text-[11.5px]" style={{ color: C.dim }}>
                      <When at={c.lastMessageAt || c.createdAt} />
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: c.needsHuman ? C.text : C.muted }}>
                      {c.lastMessage || 'No messages yet'}
                    </span>
                    {c.needsHuman && (
                      <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-[18px]" style={{ background: C.lime, color: '#0A0C08' }}>
                        Wants a person
                      </span>
                    )}
                  </div>
                  {c.user?.username && c.user?.email && (
                    <div className="mt-0.5 truncate text-[11.5px]" style={{ color: C.dim }}>
                      {c.user.email}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className={!openId ? 'max-lg:hidden' : ''}>
          {selected ? (
            <Conversation key={selected.id} convo={selected} onBack={() => setOpenId(null)} onChanged={() => void load()} />
          ) : (
            <div className="flex h-[min(640px,calc(100vh-220px))] items-center justify-center rounded-xl text-[13px]" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.dim }}>
              Pick a conversation to read it and reply.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * A picture sent in chat, from the backend that stored it. Opens full size in a new tab, because a receipt or a bank
 * screen is unreadable as a thumbnail, and says so plainly when the file is gone.
 */
function ChatImage({ path }: { path: string }) {
  const [broken, setBroken] = useState(false)
  const src = /^(https?:|data:)/.test(path) ? path : `${API}${path}`
  if (broken) {
    return (
      <div className="px-3.5 py-2.5 text-[12.5px] italic" style={{ color: C.dim }}>
        Image no longer available. Ask them to send it again.
      </div>
    )
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img src={src} alt="Sent in chat" onError={() => setBroken(true)} className="max-h-72 max-w-full" />
    </a>
  )
}

function Conversation({ convo, onBack, onChanged }: { convo: any; onBack: () => void; onChanged: () => void }) {
  const [messages, setMessages] = useState<any[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const customer = chatWho(convo)

  /** The newest change seen: where the next poll asks from. */
  const cursor = useRef<string | null>(null)
  const noteCursor = (list: any[]) => {
    for (const m of list) {
      const t = m.updatedAt || m.createdAt
      if (t && (!cursor.current || t > cursor.current)) cursor.current = t
    }
  }

  const load = useCallback(async () => {
    const d = await get<any>(`/chat/conversations/${convo.id}`, null)
    const list = d?.conversation?.messages || d?.messages || []
    noteCursor(list)
    setMessages(list)
  }, [convo.id])

  useEffect(() => { void load() }, [load])

  // Live, the way the app is: anything changed since the last thing seen, by change not creation, so edits arrive too.
  useEffect(() => {
    let alive = true
    const t = setInterval(async () => {
      const since = cursor.current || convo.createdAt
      if (document.visibilityState !== 'visible' || !since) return
      const d = await get<any>(`/chat/conversations/${convo.id}/poll?since=${encodeURIComponent(since)}`, null)
      const fresh: any[] = d?.messages || []
      if (!alive || fresh.length === 0) return
      noteCursor(fresh)
      setMessages((prev) => {
        const byId = new Map((prev ?? []).map((m: any) => [m.id, m]))
        for (const m of fresh) byId.set(m.id, { ...byId.get(m.id), ...m })
        return [...byId.values()].sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)))
      })
    }, 3000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [convo.id, convo.createdAt])

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  async function send() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setErr('')
    const res = await api(`/chat/conversations/${convo.id}/reply`, { method: 'POST', body: JSON.stringify({ text: body }) }).catch(() => null)
    setBusy(false)
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {}
      setErr(b?.error || 'That did not send.')
      return
    }
    setText('')
    void load()
  }

  async function resolve() {
    setBusy(true)
    await api(`/chat/conversations/${convo.id}/resolve`, { method: 'POST' }).catch(() => null)
    setBusy(false)
    onChanged()
  }

  /** A correction, not a do-over: the app marks it edited and doesn't buzz their phone again. */
  async function saveEdit() {
    if (!editing || !editing.text.trim()) return
    setBusy(true)
    setErr('')
    const res = await api(`/chat/conversations/${convo.id}/messages/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ text: editing.text.trim() }) })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body?.error || 'Could not edit that message.')
      return
    }
    setEditing(null)
    void load()
  }

  /** Withdraw one. Confirmed, because the words don't come back: the server clears the text rather than hiding it. */
  async function remove(id: string) {
    if (!window.confirm('Delete this reply? The person stops seeing it, and the text is not kept.')) return
    setBusy(true)
    setErr('')
    const res = await api(`/chat/conversations/${convo.id}/messages/${id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body?.error || 'Could not delete that message.')
      return
    }
    void load()
  }

  return (
    <div className="flex h-[min(680px,calc(100vh-200px))] min-h-[420px] flex-col overflow-hidden rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onBack} className="text-[13px] lg:hidden" style={{ color: C.muted }}>
          <ArrowLeft size={14} className="inline -mt-0.5" /> All
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium" style={{ color: C.text }}>
              {customer}
            </span>
            {convo.needsHuman && <Tag tone="warn">Wants a person</Tag>}
            {convo.status === 'RESOLVED' && <Tag tone="good">Resolved</Tag>}
          </div>
          {convo.user?.username && convo.user?.email && (
            <div className="mt-0.5 truncate text-[12.5px]" style={{ color: C.muted }}>
              {convo.user.email}
            </div>
          )}
        </div>
        {convo.status !== 'RESOLVED' && (
          <Btn onClick={resolve} disabled={busy}>
            Mark resolved
          </Btn>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages == null ? (
          <Loading />
        ) : messages.length === 0 ? (
          <div className="py-10 text-center text-[13px]" style={{ color: C.dim }}>No messages yet.</div>
        ) : (
          messages.map((m: any, i: number) => {
            const ours = m.sender === 'ADMIN' || m.sender === 'AGENT'
            const bot = m.sender === 'BOT'
            const right = ours || bot
            const newDay = i === 0 || chatDay(messages[i - 1].createdAt) !== chatDay(m.createdAt)
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 text-center text-[11px]" style={{ color: C.dim }}>
                    {chatDay(m.createdAt)}
                  </div>
                )}
                <div className={`mt-2 flex ${right ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[78%]">
                    {/* Three voices told apart at a glance: the customer on the left, support in green on the right, the
                        assistant's automatic replies outlined and dimmer, so a canned line is never taken for an answer. */}
                    <div
                      className={`overflow-hidden rounded-2xl text-[13.5px] leading-relaxed ${right ? 'rounded-br-md' : 'rounded-bl-md'}`}
                      style={bot ? { border: `1px dashed ${C.dim}`, color: C.muted } : ours ? { background: '#1F3A12', color: C.text, border: '1px solid #2D5218' } : { background: C.raise, color: C.text, border: `1px solid ${C.line}` }}
                    >
                      {m.imageUrl && editing?.id !== m.id && <ChatImage path={m.imageUrl} />}
                      {editing?.id === m.id ? (
                        <div className="p-2">
                          <textarea
                            value={editing?.text ?? ''}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value.slice(0, 4000) })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void saveEdit()
                              }
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            rows={3}
                            autoFocus
                            aria-label="Edit message"
                            className="w-full resize-y rounded-lg px-2.5 py-2 text-[13.5px] outline-none"
                            style={{ background: C.bg, color: C.text, border: `1px solid ${C.line}` }}
                          />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <Btn onClick={() => setEditing(null)} disabled={busy}>Cancel</Btn>
                            <Btn kind="primary" onClick={() => void saveEdit()} disabled={busy || !editing?.text.trim()}>Save</Btn>
                          </div>
                        </div>
                      ) : m.text ? (
                        <div className="whitespace-pre-wrap break-words px-3.5 py-2.5">{m.text}</div>
                      ) : !m.imageUrl ? (
                        <div className="px-3.5 py-2.5 italic" style={{ color: C.dim }}>Deleted</div>
                      ) : null}
                    </div>
                    <div className={`mt-1 px-1 text-[11px] ${right ? 'text-right' : ''}`} style={{ color: C.dim }}>
                      {bot ? 'Automatic reply · ' : ours ? 'You · ' : `${customer} · `}
                      {chatTime(m.createdAt)}
                      {m.editedAt ? ' · edited' : ''}
                      {/* Only our own replies: a customer's words aren't ours to rewrite, and the server refuses it anyway. */}
                      {m.sender === 'ADMIN' && m.text && editing?.id !== m.id && (
                        <>
                          {' · '}
                          <button type="button" onClick={() => setEditing({ id: m.id, text: m.text ?? '' })} className="underline-offset-2 hover:underline" style={{ color: C.muted }}>
                            Edit
                          </button>
                          {' · '}
                          <button type="button" onClick={() => void remove(m.id)} className="underline-offset-2 hover:underline" style={{ color: C.red }}>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      <div className="px-3 py-3" style={{ borderTop: `1px solid ${C.line}` }}>
        {err && <div className="mb-2 px-1 text-[12.5px]" style={{ color: C.red }}>{err}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            rows={1}
            placeholder={`Reply to ${customer}. Enter sends, Shift+Enter for a new line.`}
            aria-label="Reply"
            className="max-h-36 min-h-[38px] flex-1 resize-none rounded-lg border border-[#262C1F] bg-[#181C14] px-3 py-2 text-[13.5px] text-[#ECEFE7] outline-none placeholder:text-[#5C6650] focus:border-[#4C7A17]"
          />
          <Btn kind="primary" onClick={() => void send()} disabled={busy || !text.trim()}>
            {busy ? 'Sending…' : 'Send'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

/* ═══ Converted deposits ═══════════════════════════════════════════ */

type RoutedState = 'visible' | 'unavailable' | 'hidden'

type RoutedBucket = 'pending' | 'settled' | 'aside'

/**
 * Three piles, in the order you reach for them.
 *
 * Failed sits under Pending rather than with the dust. It is not in motion,
 * but it is the one row on this screen that somebody has to do something
 * about, and filing it beside gas top-ups is how a real failure goes a week
 * without being seen.
 */
const BUCKETS: { key: RoutedBucket; label: string; empty: string }[] = [
  { key: 'pending', label: 'Pending', empty: 'in flight' },
  { key: 'settled', label: 'Settled', empty: 'settled yet' },
  { key: 'aside', label: 'Set aside', empty: 'set aside' },
]

function bucketOf(status: string): RoutedBucket {
  if (status === 'settled') return 'settled'
  if (status === 'ignored') return 'aside'
  return 'pending'
}

/** Lit, warned, struck out. */
const ROUTED_LOOK: Record<RoutedState, { fill: string; edge: string; ink: string }> = {
  visible: { fill: 'rgba(129,251,2,0.12)', edge: 'rgba(129,251,2,0.35)', ink: C.lime },
  unavailable: { fill: 'rgba(201,120,28,0.12)', edge: 'rgba(201,120,28,0.40)', ink: C.amber },
  hidden: { fill: 'transparent', edge: C.line, ink: C.dim },
}

const CHAIN_NAME: Record<number, string> = {
  1: 'Ethereum', 56: 'BNB', 137: 'Polygon', 4663: 'Robinhood',
  10001: 'Bitcoin', 10103: 'Solana', 42161: 'Arbitrum', 728126428: 'Tron',
}

/**
 * Their word for it, and ours.
 *
 * requires_intervention is not failed and must never be drawn as though it
 * were. Their own console labels it Failed, which is how a deposit sitting
 * safely at their address came to look like money that had gone.
 */
const ROUTED_STATE: Record<string, { label: string; tone: string }> = {
  detected:   { label: 'Detected',     tone: C.amber },
  converting: { label: 'Converting',   tone: C.amber },
  settled:    { label: 'Settled',      tone: C.lime },
  review:     { label: 'Needs a look', tone: C.amber },
  failed:     { label: 'Failed',       tone: C.red },
  // Dust and gas top-ups the provider set aside. Hidden in the app, where
  // it is not money going anywhere, and shown here, where an unexplained
  // transfer at one of our addresses is worth being able to see.
  ignored:    { label: 'Set aside',    tone: C.dim },
}

function Routed() {
  const [assets, setAssets] = useState<any[]>([])
  const [configured, setConfigured] = useState(true)
  const [deposits, setDeposits] = useState<any[] | null>(null)
  const [bucket, setBucket] = useState<RoutedBucket>('pending')
  const [loadingDeps, setLoadingDeps] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [reachable, setReachable] = useState(true)

  /**
   * A failed request is not an unconfigured server.
   *
   * get() falls back silently, so a 404 - from a console proxied at a backend
   * without these routes - arrived as configured:false and printed "Stableyard
   * is not configured", sending somebody to look at credentials that were
   * fine. The two read differently now.
   */
  const loadAssets = useCallback(async () => {
    const res = await api('/routed/assets')
    if (!res.ok) { setReachable(false); return }
    const d = await res.json()
    setReachable(true)
    setAssets(d.assets || [])
    setConfigured(!!d.configured)
  }, [])

  useEffect(() => { loadAssets() }, [loadAssets])

  /**
   * Asked for rather than loaded.
   *
   * One provider call per enrolled account, so it is slow and it is not what
   * the switches above need. Opening this tab should not wait on it.
   */
  async function loadDeposits() {
    setLoadingDeps(true)
    const d = await get<any>('/routed/deposits', { deposits: [] })
    setDeposits(d.deposits || [])
    setLoadingDeps(false)
  }

  /**
   * All of them, for the day Stableyard is unwell.
   *
   * Applied server-side in one transaction rather than fourteen calls from
   * here: a loop would leave the app reading a half-applied state, and would
   * race anybody else with the console open.
   */
  async function setAll(state: RoutedState) {
    setBusy('all'); setErr('')
    const res = await api('/routed/assets', {
      method: 'PUT',
      body: JSON.stringify({ all: true, state }),
    })
    setBusy('')
    if (!res.ok) { setErr('Could not change those.'); return }
    const d = await res.json()
    setAssets(d.assets || [])
  }

  /**
   * One button, three states, cycled in the order you reach for them.
   *
   * On, then unavailable when it breaks, then hidden when it is not coming
   * back. A dropdown per token would be fourteen dropdowns for a decision that
   * is almost always "turn this off for an hour".
   */
  async function cycle(a: any) {
    const key = `${a.chainId}:${a.symbol}`
    const next: RoutedState =
      a.state === 'visible' ? 'unavailable' : a.state === 'unavailable' ? 'hidden' : 'visible'
    setBusy(key); setErr('')
    const res = await api('/routed/assets', {
      method: 'PUT',
      body: JSON.stringify({ chainId: a.chainId, symbol: a.symbol, state: next }),
    })
    setBusy('')
    if (!res.ok) { setErr('Could not change that.'); return }
    const d = await res.json()
    setAssets(d.assets || [])
  }

  if (!reachable) {
    return (
      <Empty>
        Could not reach this endpoint. If the console is proxied at the live API these routes are
        not deployed yet — run it with VITE_PROXY_TARGET=http://localhost:4000.
      </Empty>
    )
  }
  if (!configured) {
    return <Empty>Stableyard credentials are not set on this server.</Empty>
  }

  const shown = assets.filter((a) => a.state === 'visible').length
  const off = assets.filter((a) => a.state === 'unavailable').length

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <Label>What the app offers</Label>
        {/* One lever. Which one it offers depends on where things stand, so it
            is never a pair of buttons where one of them does nothing. */}
        <button
          onClick={() => setAll(shown === 0 ? 'visible' : 'unavailable')}
          disabled={busy === 'all'}
          className="rounded-md px-2.5 py-[5px] text-[11px] leading-none"
          style={{
            fontFamily: MONO,
            background: shown === 0 ? 'rgba(129,251,2,0.12)' : 'transparent',
            border: `1px solid ${shown === 0 ? 'rgba(129,251,2,0.35)' : C.line}`,
            color: shown === 0 ? C.lime : C.muted,
            opacity: busy === 'all' ? 0.4 : 1,
          }}
        >
          {busy === 'all' ? 'WORKING' : shown === 0 ? 'TURN ALL ON' : 'ALL UNAVAILABLE'}
        </button>
      </div>
      <p className="text-[13px] mb-3 max-w-[660px]" style={{ color: C.muted }}>
        {shown} on{off > 0 ? `, ${off} unavailable` : ''}, of {assets.length}. Everything here
        works whether or not it is on — these decide what the app draws, not what the provider
        does. Click a token to cycle it.
      </p>
      {/* Three words for three states, so nobody has to learn the colours. */}
      <div className="flex items-center gap-4 mb-4 text-[11px]" style={{ fontFamily: MONO }}>
        <span className="flex items-center gap-1.5" style={{ color: C.lime }}>
          <i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: C.lime }} />
          ON &mdash; tappable
        </span>
        <span className="flex items-center gap-1.5" style={{ color: C.amber }}>
          <i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: C.amber }} />
          UNAVAILABLE &mdash; shown, inert
        </span>
        <span className="flex items-center gap-1.5" style={{ color: C.dim }}>
          <i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: C.dim }} />
          HIDDEN &mdash; not in the app
        </span>
      </div>

      {/* Grouped by chain, because that is what an address is.
          Fourteen cards said fourteen things to configure; there are eight
          addresses, and the assets are what each one happens to accept. */}
      <div className="rounded-xl overflow-hidden mb-9" style={{ border: `1px solid ${C.line}` }}>
        {Object.entries(
          assets.reduce((acc: Record<string, any[]>, a) => {
            const k = String(a.chainId)
            ;(acc[k] ||= []).push(a)
            return acc
          }, {})
        ).map(([chainId, list], i) => (
          <div
            key={chainId}
            className="flex items-center gap-3 px-3.5 py-2.5 flex-wrap"
            style={{
              background: C.raise,
              borderTop: i === 0 ? 'none' : `1px solid ${C.line}`,
            }}
          >
            <span className="text-[12px] w-[86px] shrink-0" style={{ color: C.muted }}>
              {CHAIN_NAME[Number(chainId)] ?? chainId}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(list as any[]).map((a) => {
                const key = `${a.chainId}:${a.symbol}`
                const look = ROUTED_LOOK[a.state as RoutedState] ?? ROUTED_LOOK.hidden
                return (
                  <button
                    key={key}
                    onClick={() => cycle(a)}
                    disabled={busy === key}
                    title={`${a.state}${a.overridden ? ' · set here' : ' · following the default'}`}
                    className="rounded-md px-2 py-[3px] text-[11px] leading-none transition-colors"
                    style={{
                      fontFamily: MONO,
                      background: look.fill,
                      border: `1px solid ${look.edge}`,
                      color: look.ink,
                      // Struck through, so hidden is legible as a state and not
                      // just as a duller shade of unavailable.
                      textDecoration: a.state === 'hidden' ? 'line-through' : 'none',
                      opacity: busy === key ? 0.4 : 1,
                    }}
                  >
                    {a.symbol}
                    {/* A dot, not the words "set here". The distinction is
                        worth keeping and not worth a column. */}
                    {a.overridden && <span style={{ opacity: 0.55 }}>&nbsp;•</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {!!err && <p className="text-[12px] -mt-6 mb-6" style={{ color: C.red }}>{err}</p>}

      <div className="flex items-center justify-between mb-1.5">
        <Label>In flight</Label>
        <Btn onClick={loadDeposits} disabled={loadingDeps}>
          {loadingDeps ? 'Reading…' : deposits ? 'Refresh' : 'Load'}
        </Btn>
      </div>
      <p className="text-[13px] mb-4 max-w-[640px]" style={{ color: C.muted }}>
        Read live from Stableyard, one call per enrolled account — which is why it is asked for
        rather than loaded with the page.
      </p>

      {loadingDeps ? (
        <Loading />
      ) : !deposits ? (
        <Empty>Not loaded.</Empty>
      ) : deposits.length === 0 ? (
        <Empty>No converted deposits yet.</Empty>
      ) : (
        <>
          {/* Pending leads because it is the only one anybody opens this for.
              Settled is the archive and set-aside is the dust; both are read
              to answer a question, not to watch. */}
          <div className="flex items-center gap-1 mb-3">
            {BUCKETS.map((b) => {
              const n = deposits.filter((d: any) => bucketOf(d.status) === b.key).length
              const on = bucket === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => setBucket(b.key)}
                  className="rounded-lg px-3 py-[6px] text-[12px] leading-none transition-colors"
                  style={{
                    background: on ? C.raise : 'transparent',
                    border: `1px solid ${on ? C.line : 'transparent'}`,
                    color: on ? C.text : C.dim,
                  }}
                >
                  {b.label}
                  {/* The count is the useful half: an empty Pending is the
                      answer, and you should not have to click to get it. */}
                  <span
                    className="ml-1.5 text-[11px]"
                    style={{ fontFamily: MONO, color: n > 0 ? (on ? C.muted : C.dim) : C.dim }}
                  >
                    {n}
                  </span>
                </button>
              )
            })}
          </div>

        <div className="space-y-2">
          {deposits.filter((d: any) => bucketOf(d.status) === bucket).length === 0 ? (
            <Empty>Nothing {BUCKETS.find((b) => b.key === bucket)?.empty}.</Empty>
          ) : deposits.filter((d: any) => bucketOf(d.status) === bucket).map((d: any) => {
            const st = ROUTED_STATE[d.status] ?? { label: d.status, tone: C.dim }
            return (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl px-3.5 py-3 flex-wrap"
                style={{ background: C.raise, border: `1px solid ${C.line}` }}
              >
                <span className="text-[11px] w-[96px] shrink-0" style={{ color: st.tone, fontFamily: MONO }}>
                  {st.label}
                </span>
                <span className="text-[13px] flex-1 min-w-[220px]" style={{ color: C.text }}>
                  {d.sentAmount} {d.sentSymbol}
                  <span style={{ color: C.dim }}> on {CHAIN_NAME[d.chainId] ?? d.chainId} → </span>
                  {d.receivedAmount
                    ? `${d.receivedAmount} ${d.receivedSymbol}`
                    : <span style={{ color: C.dim }}>pending</span>}
                </span>
                <span className="text-[11.5px]" style={{ color: C.dim }}>
                  {d.user?.username ? `@${d.user.username}` : d.user?.email}
                </span>
                <span className="text-[10.5px]" style={{ color: C.dim, fontFamily: MONO }}>
                  {d.createdAt ? ago(d.createdAt) : ''}
                </span>
              </div>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}


/* ═══ Vouchers ══════════════════════════════════════════════════════ */

type VoucherRule =
  | { kind: 'verified' }
  | { kind: 'accountAgeDays'; days: number }
  | { kind: 'minTransactions'; count: number }

const RULE_LABEL: Record<string, string> = {
  verified: 'Identity verified',
  accountAgeDays: 'Account older than … days',
  minTransactions: 'At least … completed transactions',
}

const V_STATE: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'DRAFT', tone: C.dim },
  ACTIVE: { label: 'ACTIVE', tone: C.lime },
  PAUSED: { label: 'PAUSED', tone: C.amber },
  ENDED: { label: 'ENDED', tone: C.dim },
}

const CLAIM_STATE: Record<string, string> = {
  SENT: C.lime,
  PENDING: C.amber,
  FAILED: C.red,
}

function Vouchers() {
  const [data, setData] = useState<any>(null)
  const [configured, setConfigured] = useState(true)
  const [reachable, setReachable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<any>(null)
  const [making, setMaking] = useState(false)
  const [err, setErr] = useState('')
  /** Marked for a batch action. Emptied on every success, so it never holds an id that is gone. */
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [pile, setPile] = useState<'live' | 'done'>('live')
  /** Ours, or the ones people made with their own money. */
  const [whose, setWhose] = useState<'ours' | 'users'>('ours')

  /**
   * A request that did not arrive is not a server without a wallet.
   *
   * This printed "no voucher treasury" at a console proxied to an API where
   * these routes are simply not deployed yet - sending somebody to check
   * credentials that were never the problem. The same conflation the Converted
   * tab had; the two read differently now.
   */
  const load = useCallback(async () => {
    setLoading(true)
    const res = await api('/vouchers')
    if (!res.ok) { setReachable(false); setLoading(false); return }
    const d = await res.json()
    setReachable(true)
    setConfigured(!!d.configured)
    setData(d)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * End or delete everything marked.
   *
   * Both are confirmed, and the delete confirmation says what the server will
   * do rather than what was asked: a voucher that has paid somebody is ended
   * instead, because its claims are the only record of where that money went.
   * Learning that afterwards, in a line of small text, is too late to be a
   * decision.
   */
  async function batch(action: 'end' | 'delete') {
    const ids = [...picked]
    if (!ids.length) return
    const many = ids.length === 1 ? 'voucher' : 'vouchers'
    const ask =
      action === 'end'
        ? `End ${ids.length} ${many}? They stop paying, and ending cannot be undone.`
        : `Delete ${ids.length} ${many}? Any that have already paid somebody are ended instead — deleting one would take the record of what it paid with it.`
    if (!window.confirm(ask)) return

    setErr(''); setNote(''); setBusy(true)
    const res = await api('/vouchers/batch', { method: 'POST', body: JSON.stringify({ ids, action }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      /**
       * A route that is not there is not an action that failed.
       *
       * The live API answers an unknown path with a flat "Not found", and
       * printing that under a list of vouchers reads as "those vouchers are
       * not found" - which is alarming, wrong, and sends somebody looking at
       * the data instead of the deploy.
       */
      setErr(
        res.status === 404
          ? 'This console is talking to the live API, where batch actions are not deployed yet. Nothing was changed.'
          : d?.error || 'Could not do that.',
      )
      return
    }
    setPicked(new Set())
    setNote(
      action === 'end'
        ? `${d.ended} ended.`
        : [`${d.deleted} deleted.`, d.note].filter(Boolean).join(' '),
    )
    load()
  }

  async function setStatus(v: any, status: string) {
    setErr('')
    const res = await api(`/vouchers/${v.id}`, { method: 'PUT', body: JSON.stringify({ status }) })
    if (!res.ok) { setErr((await res.json())?.error || 'Could not change that.'); return }
    setOpen(null)
    load()
  }

  const whoseTabs = (
    <div className="flex gap-2 mb-5">
      {([['ours', 'Ours'], ['users', 'From users']] as const).map(([id, label]) => (
        <button key={id} onClick={() => setWhose(id)}
                className="h-9 px-4 rounded-xl text-[12.5px] font-semibold transition-colors"
                style={{
                  background: whose === id ? C.lime : 'transparent',
                  color: whose === id ? '#0A0C08' : C.muted,
                  border: `1px solid ${whose === id ? C.lime : C.line}`,
                }}>
          {label}
        </button>
      ))}
    </div>
  )

  if (whose === 'users') return <div>{whoseTabs}<UserVouchers /></div>

  if (loading) return <Loading />
  if (!reachable) {
    return (
      <Empty>
        Could not reach this endpoint. If the console is proxied at the live API these routes are
        not deployed yet — run it with VITE_PROXY_TARGET=http://localhost:4000.
      </Empty>
    )
  }
  if (!configured) {
    return (
      <Empty>
        No voucher treasury on this server. Set VOUCHER_TREASURY_ADDRESS and
        VOUCHER_TREASURY_PRIVATE_KEY, then fund the wallet.
      </Empty>
    )
  }

  const float = data?.float ?? { balance: 0, reserved: 0, free: 0, uncapped: 0, address: '' }
  const all: any[] = data?.vouchers ?? []

  /**
   * Finished, by either of the two ways a voucher finishes.
   *
   * Ended is a decision somebody made; fully claimed is one the last claimer
   * made for them. Neither can pay again, and a list that keeps both among the
   * live ones buries the handful that still can - which is the only question
   * this screen is usually being opened to answer.
   */
  const spent = (v: any) =>
    v.status === 'ENDED' || (v.totalClaims != null && v.claimed >= v.totalClaims)
  const vouchers = all.filter((v) => (pile === 'done' ? spent(v) : !spent(v)))
  const short = (a: string) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

  if (making) {
    return <MakeVoucher float={float} onDone={() => { setMaking(false); load() }} onCancel={() => setMaking(false)} />
  }
  if (open) {
    return <VoucherDetail voucher={open} onBack={() => setOpen(null)} onStatus={setStatus} />
  }

  return (
    <div>
      {whoseTabs}
      <div className="flex items-center justify-between mb-4">
        <Label>The float</Label>
        <Btn kind="primary" onClick={() => setMaking(true)}>New voucher</Btn>
      </div>

      {/* The float leads: every voucher below is a promise against it. */}
      <div className="rounded-xl mb-8 px-5 py-4 flex items-start justify-between flex-wrap gap-4"
           style={{ background: C.card, border: `1px solid ${C.line}` }}>
        <div>
          <div className="text-[28px] font-bold tracking-[-0.03em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {float.balance.toFixed(2)} <span className="text-[14px] font-medium" style={{ color: C.muted }}>USDC</span>
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: C.dim, fontFamily: MONO }}>
            {short(float.address)} · gas is sponsored
          </div>
        </div>
        <div className="flex gap-7 text-right">
          <div>
            <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>RESERVED</div>
            <div className="text-[16px] font-semibold mt-1" style={{ color: C.amber, fontVariantNumeric: 'tabular-nums' }}>
              {float.reserved.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>UNCOMMITTED</div>
            <div className="text-[16px] font-semibold mt-1"
                 style={{ color: float.free > 0 ? C.lime : C.red, fontVariantNumeric: 'tabular-nums' }}>
              {float.free.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {float.uncapped > 0 && (
        <p className="text-[12px] mb-5 -mt-5" style={{ color: C.amber }}>
          {float.uncapped} uncapped voucher{float.uncapped === 1 ? '' : 's'} — those could cost anything, so
          they are not in the reserve.
        </p>
      )}
      {!!err && <p className="text-[12px] mb-4" style={{ color: C.red }}>{err}</p>}
      {!!note && <p className="text-[12px] mb-4" style={{ color: C.muted }}>{note}</p>}

      {/*
        The piles stay visible while marking; the actions appear beside them.
        A toolbar that is always there, greyed out until something is marked,
        is a row of dead buttons most of the time - and one of these deletes.
      */}
      <div className="mb-2 flex items-center justify-between gap-4">
        <Chips
          items={[
            { id: 'live', label: 'Live', count: all.filter((v) => !spent(v)).length },
            { id: 'done', label: 'Ended & claimed out', count: all.filter(spent).length },
          ]}
          value={pile}
          onChange={(id) => { setPile(id as 'live' | 'done'); setPicked(new Set()) }}
        />
        {picked.size > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[12px] font-semibold" style={{ color: C.text }}>
              {picked.size} marked
            </span>
            <button onClick={() => setPicked(new Set())}
                    className="text-[12px] px-2 h-[26px]" style={{ color: C.muted }}>
              Clear
            </button>
            <Quick onClick={() => batch('end')} disabled={busy}>End</Quick>
            <Quick onClick={() => batch('delete')} disabled={busy} danger>Delete</Quick>
          </div>
        )}
      </div>
      {vouchers.length === 0 ? (
        <Empty>{pile === 'done' ? 'Nothing has finished yet.' : 'Nothing live. Every voucher has ended or been claimed out.'}</Empty>
      ) : (
        <div>
          <div className="flex px-1 pb-2 text-[10px] tracking-[0.12em]"
               style={{ color: C.muted, fontFamily: MONO, borderBottom: `1px solid ${C.line}` }}>
            <span className="w-[26px] flex items-center">
              <Tick
                on={vouchers.length > 0 && picked.size === vouchers.length}
                onClick={() =>
                  setPicked(picked.size === vouchers.length ? new Set() : new Set(vouchers.map((v) => v.id)))
                }
                label="Mark every voucher"
              />
            </span>
            <span className="w-[210px]">CODE</span>
            <span className="w-[92px]">REWARD</span>
            <span className="w-[130px]">CLAIMED</span>
            <span className="flex-1">WHO QUALIFIES</span>
            <span className="w-[96px] text-right">PAID OUT</span>
          </div>
          {vouchers.map((v) => {
            const st = V_STATE[v.status] ?? { label: v.status, tone: C.dim }
            const cap = v.totalClaims == null ? '∞' : v.totalClaims
            const pct = v.totalClaims ? Math.min((v.claimed / v.totalClaims) * 100, 100) : 4
            const rules = (v.requirements || []).length
              ? (v.requirements as VoucherRule[]).map((r: any) =>
                  r.kind === 'verified' ? 'Verified'
                  : r.kind === 'accountAgeDays' ? `over ${r.days}d old`
                  : `${r.count}+ transactions`).join(' · ')
              : 'Anyone'
            const marked = picked.has(v.id)
            return (
              // The tick sits beside the row rather than in it: a button inside
              // a button is not markup browsers agree about, and marking one
              // must not open it.
              <div key={v.id} className="flex items-center w-full px-1 py-3.5"
                   style={{ borderBottom: `1px solid ${C.lineSoft}`, background: marked ? C.lineSoft : 'transparent' }}>
                <span className="w-[26px] flex items-center">
                  <Tick on={marked} onClick={() => toggle(v.id)} label={`Mark ${v.code}`} />
                </span>
                <button onClick={() => setOpen(v)} className="flex items-center flex-1 min-w-0 text-left">
                <span className="w-[210px] flex items-center gap-2 min-w-0">
                  <span className="text-[13px] truncate" style={{ fontFamily: MONO }}>{v.code}</span>
                  {v.mode === 'LUCKY' && (
                    <span className="text-[9px] tracking-[0.08em] shrink-0 rounded px-1 py-0.5"
                          style={{ color: C.lime, border: `1px solid ${C.limeDim}`, fontFamily: MONO }}>
                      LUCKY
                    </span>
                  )}
                  <span className="text-[9px] tracking-[0.08em] shrink-0" style={{ color: st.tone, fontFamily: MONO }}>
                    {st.label}
                  </span>
                </span>
                <span className="w-[92px] text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {v.mode === 'LUCKY' ? v.potAmount : v.rewardAmount}{' '}
                  <span className="text-[11px]" style={{ color: C.dim }}>
                    {v.mode === 'LUCKY' ? 'pot' : 'USDC'}
                  </span>
                </span>
                <span className="w-[130px]">
                  <span className="text-[12.5px]" style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {v.claimed} of {cap}
                  </span>
                  <span className="block h-[3px] rounded-sm mt-1.5 w-[104px]" style={{ background: C.line }}>
                    <span className="block h-[3px] rounded-sm"
                          style={{ width: `${pct}%`, background: v.status === 'ACTIVE' ? C.lime : C.limeDim }} />
                  </span>
                </span>
                <span className="flex-1 text-[12px] truncate" style={{ color: C.muted }}>{rules}</span>
                <span className="w-[96px] text-right text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {v.paidOut.toFixed(2)}
                </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}



/**
 * Vouchers people made, and the wallet holding their money.
 *
 * Kept apart from ours because the question is different. For our own
 * vouchers it is "what will this promotion cost"; here it is "does the escrow
 * wallet still hold what we believe we owe" - and that is the only figure on
 * either page we cannot check against ourselves.
 */
function UserVouchers() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const d = await get<any>('/vouchers/from-users', null)
    setData(d)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function sweep() {
    setBusy(true); setNote('')
    const res = await api('/vouchers/refunds/sweep', { method: 'POST' })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    setNote(res.ok ? `${d.sent ?? 0} sent, ${d.failed ?? 0} could not be sent.` : (d?.error || 'Could not run it.'))
    load()
  }

  if (loading) return <Loading />
  if (!data) return <Empty>Could not reach this endpoint.</Empty>
  if (!data.configured) {
    return (
      <Empty>
        No escrow wallet on this server. Set VOUCHER_ESCROW_ADDRESS and
        VOUCHER_ESCROW_PRIVATE_KEY — it must never be the promo treasury.
      </Empty>
    )
  }

  const e = data.escrow ?? { balance: 0, owedToClaimers: 0, refundsDue: 0, unaccounted: 0, address: '' }
  const vouchers: any[] = data.vouchers ?? []
  const drift = Math.abs(e.unaccounted) > 0.005
  const stuck = vouchers.filter((v) => v.refund?.state === 'FAILED')
  const short = (a: string) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Label>User escrow</Label>
        <Btn onClick={sweep} disabled={busy}>{busy ? 'Sending…' : 'Run the refund sweep'}</Btn>
      </div>

      <div className="rounded-xl mb-3 px-5 py-4 flex items-start justify-between flex-wrap gap-6"
           style={{ background: C.card, border: `1px solid ${drift ? C.red + '55' : C.line}` }}>
        <div>
          <div className="text-[28px] font-bold tracking-[-0.03em]" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {e.balance.toFixed(2)} <span className="text-[14px] font-medium" style={{ color: C.muted }}>USDC</span>
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: C.dim, fontFamily: MONO }}>
            {short(e.address)} · a wallet of its own, never your promo float
          </div>
        </div>
        <div className="flex gap-8 text-right">
          {([
            ['OWED TO CLAIMERS', e.owedToClaimers, C.text],
            ['REFUNDS DUE', e.refundsDue, C.amber],
            ['UNACCOUNTED', e.unaccounted, drift ? C.red : C.lime],
          ] as const).map(([label, val, tone]) => (
            <div key={label}>
              <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>{label}</div>
              <div className="text-[16px] font-semibold mt-1" style={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>
                {Number(val).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The one number that is not a total of our own rows. */}
      <p className="text-[11.5px] mb-5" style={{ color: drift ? C.red : C.dim }}>
        {drift
          ? 'The wallet does not hold what we believe we owe. Every other figure here is a total we calculated, so this is the only one that can catch us being wrong — find it before creating more.'
          : 'Balance matches what is owed.'}
      </p>

      {stuck.length > 0 && (
        <div className="rounded-xl px-4 py-3 mb-5"
             style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.3)' }}>
          <div className="text-[12.5px] font-semibold" style={{ color: C.red }}>
            {stuck.length} refund{stuck.length === 1 ? '' : 's'} could not be sent
          </div>
          <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: C.muted }}>
            A refund that never sends is not a stuck job — it is money we are holding that belongs to
            somebody who put it in.
          </div>
          {stuck.map((v) => (
            <div key={v.id} className="text-[11.5px] mt-2" style={{ color: C.red, fontFamily: MONO }}>
              {v.code} · {v.refund.amount.toFixed(2)} to @{v.by} · {v.refund.attempts} tries · {v.refund.error}
            </div>
          ))}
        </div>
      )}

      {!!note && <p className="text-[12px] mb-4" style={{ color: C.muted }}>{note}</p>}

      <div className="mb-1.5"><Label>Vouchers people made</Label></div>
      {vouchers.length === 0 ? <Empty>Nobody has sent one yet.</Empty> : (
        <div>
          <div className="flex px-1 pb-2 text-[10px] tracking-[0.12em]"
               style={{ color: C.muted, fontFamily: MONO, borderBottom: `1px solid ${C.line}` }}>
            <span className="w-[230px]">CODE</span>
            <span className="w-[130px]">FROM</span>
            <span className="w-[80px]">POT</span>
            <span className="w-[110px]">CLAIMED</span>
            <span className="flex-1">REFUND</span>
            <span className="w-[96px] text-right">PAID OUT</span>
          </div>
          {vouchers.map((v) => {
            const st = V_STATE[v.status] ?? { label: v.status, tone: C.dim }
            const r = v.refund ?? {}
            const refundLabel =
              r.state === 'DUE' ? `${r.amount.toFixed(2)} due`
              : r.state === 'SENT' ? (r.amount > 0 ? `${r.amount.toFixed(2)} sent` : '—')
              : r.state === 'FAILED' ? `${r.amount.toFixed(2)} FAILED`
              : '—'
            const refundTone =
              r.state === 'DUE' ? C.amber : r.state === 'FAILED' ? C.red : C.dim
            return (
              <div key={v.id} className="flex items-center px-1 py-3.5"
                   style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
                <span className="w-[230px] flex items-center gap-2 min-w-0">
                  <span className="text-[13px] truncate" style={{ fontFamily: MONO }}>{v.code}</span>
                  {v.lucky && (
                    <span className="text-[9px] tracking-[0.08em] shrink-0 rounded px-1 py-0.5"
                          style={{ color: C.lime, border: `1px solid ${C.limeDim}`, fontFamily: MONO }}>LUCKY</span>
                  )}
                  <span className="text-[9px] tracking-[0.08em] shrink-0" style={{ color: st.tone, fontFamily: MONO }}>
                    {st.label}
                  </span>
                </span>
                <span className="w-[130px] text-[12.5px] truncate" style={{ color: C.muted }}>@{v.by}</span>
                <span className="w-[80px] text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {v.pot.toFixed(2)}
                </span>
                <span className="w-[110px] text-[12.5px]" style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {v.claimed} of {v.of}
                </span>
                <span className="flex-1 text-[12px]" style={{ color: refundTone, fontVariantNumeric: 'tabular-nums' }}>
                  {refundLabel}
                </span>
                <span className="w-[96px] text-right text-[13px]"
                      style={{ color: C.lime, fontVariantNumeric: 'tabular-nums' }}>
                  {v.paidOut.toFixed(2)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A box that is either ticked or not. Small, because it repeats down a list. */
function Tick({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick}
            className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center text-[10px] font-bold leading-none"
            style={{
              border: `1px solid ${on ? C.lime : C.line}`,
              background: on ? C.lime : 'transparent',
              color: '#0A0C08',
            }}>
      {on ? '✓' : ''}
    </button>
  )
}

/** Shorter than Btn, for a toolbar sharing a line with a label above a list. */
function Quick({ children, onClick, disabled, danger }:
               { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
            className="h-[26px] px-3 rounded-lg text-[12px] font-semibold transition-opacity disabled:opacity-40"
            style={{
              background: 'transparent',
              color: danger ? C.red : C.text,
              border: `1px solid ${danger ? C.red + '44' : C.line}`,
            }}>
      {children}
    </button>
  )
}

/**
 * The voucher's QR, drawn from its code.
 *
 * Generated here rather than stored: the code IS the payload, so a picture of
 * it is derived data. Keeping one in a table would be a second thing to keep
 * true, and a stale one is a QR that pays out somebody else's voucher.
 *
 * Rendered white-on-white-ground whatever the console's theme, because this
 * gets printed and photographed. A dark QR on a dark card scans on a screen
 * and not on paper.
 */
function VoucherQr({ code }: { code: string }) {
  const [png, setPng] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    // Prefixed so a scanner knows this is a voucher and not a username - a
    // custom code like SOKEVOUCHER is both. The code alone is what gets
    // copied and typed; only the picture carries the marker.
    QRCode.toDataURL(`mmv:${code}`, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url: string) => { if (alive) setPng(url) })
      .catch(() => { if (alive) setPng('') })
    return () => { alive = false }
  }, [code])

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }

  return (
    <div className="rounded-xl px-4 py-4 flex flex-col items-center"
         style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {png ? (
        <img src={png} alt={`QR code for ${code}`} width={160} height={160}
             style={{ borderRadius: 8, display: 'block' }} />
      ) : (
        <div style={{ width: 160, height: 160, background: C.raise, borderRadius: 8 }} />
      )}

      <div className="text-[13px] mt-3" style={{ fontFamily: MONO }}>{code}</div>
      <div className="text-[11px] mt-1 text-center leading-relaxed" style={{ color: C.dim }}>
        Scannable in the app.<br />Prints on a flyer.
      </div>

      <div className="flex gap-2 w-full mt-3.5">
        <button onClick={copy}
                className="flex-1 rounded-lg py-2 text-[12px]"
                style={{ background: C.raise, border: `1px solid ${C.line}`, color: copied ? C.lime : C.text }}>
          {copied ? 'Copied' : 'Copy code'}
        </button>
        <a href={png || '#'} download={`${code}.png`}
           className="flex-1 rounded-lg py-2 text-[12px] text-center"
           style={{ background: C.raise, border: `1px solid ${C.line}`, color: C.text, textDecoration: 'none',
                    pointerEvents: png ? 'auto' : 'none', opacity: png ? 1 : 0.4 }}>
          Download PNG
        </a>
      </div>
    </div>
  )
}

/** One voucher, and every claim against it. */
function VoucherDetail({ voucher, onBack, onStatus }: { voucher: any; onBack: () => void; onStatus: (v: any, s: string) => void }) {
  const [claims, setClaims] = useState<any[] | null>(null)
  const [cut, setCut] = useState<any>(null)
  const lucky = voucher.mode === 'LUCKY'

  useEffect(() => {
    get<any>(`/vouchers/${voucher.id}/claims`, { claims: [] }).then((d) => setClaims(d.claims || []))
    if (lucky) get<any>(`/vouchers/${voucher.id}/slices`, null).then(setCut)
  }, [voucher.id, lucky])

  const cap = voucher.totalClaims == null ? '∞' : voucher.totalClaims
  /**
   * A lucky voucher knows exactly what it still owes: the slices nobody has
   * taken. Everything else has to multiply a reward by a cap and hope.
   */
  const owed = lucky
    ? cut?.owed ?? null
    : voucher.totalClaims == null
      ? null
      : Math.max(voucher.totalClaims - voucher.claimed, 0) * voucher.rewardAmount

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <button onClick={onBack} className="text-[13px]" style={{ color: C.muted }}>Vouchers</button>
          <span style={{ color: C.dim }}>/</span>
          <span className="text-[19px] font-bold" style={{ fontFamily: MONO }}>{voucher.code}</span>
          <span className="text-[10px] tracking-[0.1em]" style={{ color: (V_STATE[voucher.status] ?? {}).tone, fontFamily: MONO }}>
            {voucher.status}
          </span>
        </div>
        <div className="flex gap-2">
          {voucher.status === 'DRAFT' && <Btn kind="primary" onClick={() => onStatus(voucher, 'ACTIVE')}>Activate</Btn>}
          {voucher.status === 'ACTIVE' && <Btn onClick={() => onStatus(voucher, 'PAUSED')}>Pause</Btn>}
          {voucher.status === 'PAUSED' && <Btn onClick={() => onStatus(voucher, 'ACTIVE')}>Resume</Btn>}
          {voucher.status !== 'ENDED' && <Btn onClick={() => onStatus(voucher, 'ENDED')}>End it</Btn>}
        </div>
      </div>

      <div className="flex gap-6 mb-6 flex-wrap items-start">
      <div className="grid gap-3 flex-1 min-w-[420px]" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
        {[
          lucky
            ? ['THE POT', `${voucher.potAmount}`, `${cap} slices, ${voucher.rewardAmount} average`, C.text]
            : ['REWARD', `${voucher.rewardAmount}`, 'USDC each', C.text],
          ['CLAIMED', `${voucher.claimed}`, `of ${cap}`, C.text],
          ['PAID OUT', voucher.paidOut.toFixed(2), 'USDC, on chain', C.lime],
          ['STILL OWED', owed == null ? '—' : owed.toFixed(2),
            owed == null ? 'uncapped' : lucky ? 'slices still unclaimed' : 'if all claimed', C.amber],
        ].map(([label, value, note, tone]) => (
          <div key={label as string} className="rounded-xl px-4 py-3.5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>{label}</div>
            <div className="text-[21px] font-bold tracking-[-0.02em] mt-1.5"
                 style={{ color: tone as string, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            <div className="text-[11px] mt-0.5" style={{ color: C.dim }}>{note}</div>
          </div>
        ))}
      </div>

        {/* Here rather than only on the create form: this is the screen
            somebody opens when they need the code again, which is every time
            after the first. */}
        <div className="w-[230px] shrink-0"><VoucherQr code={voucher.code} /></div>
      </div>

      {lucky && (
        <>
          <div className="mb-1.5 flex items-baseline gap-3">
            <Label>The spread</Label>
            {!!cut && (
              <span className="text-[11.5px]" style={{ color: C.dim }}>
                {cut.slices.length - cut.left} taken, {cut.left} still out there
              </span>
            )}
          </div>
          {!cut ? <Loading /> : (
            <div className="rounded-xl px-4 py-4 mb-7" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              {/* Biggest first, and a taken slice reads as spent rather than
                  hidden - the question after it goes live is whether the big
                  one has gone yet. */}
              <div className="flex flex-wrap gap-1.5">
                {cut.slices.map((sl: any) => (
                  <span key={sl.id} title={sl.taken ? `taken by @${sl.by ?? 'someone'}` : 'still unclaimed'}
                        className="rounded-md px-2 py-1 text-[12px]"
                        style={{
                          background: sl.taken ? 'transparent' : 'rgba(129,251,2,0.10)',
                          border: `1px solid ${sl.taken ? C.line : C.limeDim}`,
                          color: sl.taken ? C.dim : C.lime,
                          textDecoration: sl.taken ? 'line-through' : 'none',
                          fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                        }}>
                    {sl.amount.toFixed(2)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="mb-1.5"><Label>Claims</Label></div>
      {!claims ? <Loading /> : claims.length === 0 ? <Empty>Nobody has claimed this yet.</Empty> : (
        <div>
          {claims.map((c) => (
            <div key={c.id} className="flex items-center px-1 py-3 gap-3 flex-wrap"
                 style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
              <span className="w-[86px] text-[11px]" style={{ color: C.dim, fontFamily: MONO }}>{ago(c.createdAt)}</span>
              <span className="w-[170px] text-[13px] truncate">{c.who}</span>
              <span className="w-[100px] text-[13px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {c.amount} <span className="text-[11px]" style={{ color: C.dim }}>USDC</span>
              </span>
              <span className="w-[86px] text-[11px] tracking-[0.06em]" style={{ color: CLAIM_STATE[c.status] ?? C.dim, fontFamily: MONO }}>
                {c.status}
              </span>
              <span className="flex-1 text-[11.5px] min-w-[180px]" style={{ fontFamily: MONO }}>
                {c.txHash ? (
                  <a href={`https://explorer.movementnetwork.xyz/txn/${c.txHash}`} target="_blank" rel="noreferrer"
                     style={{ color: C.lime }}>{shortHash(c.txHash, 8, 6)}</a>
                ) : (
                  <span style={{ color: c.error ? C.red : C.dim }}>{c.error || '—'}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The form. What it costs sits beside it and does the arithmetic. */
function MakeVoucher({ float, onDone, onCancel }: { float: any; onDone: () => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'FIXED' | 'LUCKY'>('FIXED')
  const [kind, setKind] = useState<'PUBLIC' | 'UNIQUE'>('PUBLIC')
  const [code, setCode] = useState('')
  const [amount, setAmount] = useState('5')
  const [total, setTotal] = useState('100')
  const [perUser, setPerUser] = useState('1')
  const [endsAt, setEndsAt] = useState('')
  const [rules, setRules] = useState<Record<string, string | boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // The lucky half
  const [pot, setPot] = useState('20')
  const [winners, setWinners] = useState('20')
  const [spread, setSpread] = useState<'even' | 'mixed' | 'wild'>('mixed')
  const [minAmt, setMinAmt] = useState('')
  const [maxAmt, setMaxAmt] = useState('')
  const [byHand, setByHand] = useState(false)
  const [amounts, setAmounts] = useState('')
  const [cut, setCut] = useState<any>(null)
  const [cutting, setCutting] = useState(false)

  const lucky = mode === 'LUCKY'
  const reward = Number(amount) || 0
  const cap = lucky ? Number(winners) || 0 : kind === 'UNIQUE' ? 1 : Number(total) || 0
  // A lucky voucher costs its pot, exactly. Nothing to multiply and nothing to
  // estimate - the slices already add up to it.
  const cost = lucky ? Number(pot) || 0 : reward * cap
  const short = Math.max(cost - float.free, 0)
  const affordable = reward > 0 ? Math.floor(float.free / reward) : 0

  /** What the server would cut, without keeping it. Reshuffle is the same call. */
  async function preview() {
    setCutting(true); setErr('')
    const res = await api('/vouchers/preview', {
      method: 'POST',
      body: JSON.stringify({
        potAmount: Number(pot) || 0,
        winners: Number(winners) || 0,
        spread,
        minAmount: minAmt || undefined,
        maxAmount: maxAmt || undefined,
        amounts: byHand ? amounts : undefined,
      }),
    })
    const d = await res.json().catch(() => ({}))
    setCutting(false)
    if (!res.ok) { setCut(null); setErr(d?.error || 'Could not cut that pot.'); return }
    setCut(d)
  }

  function requirements() {
    const out: any[] = []
    if (rules.verified) out.push({ kind: 'verified' })
    if (rules.ageDays) out.push({ kind: 'accountAgeDays', days: Number(rules.ageDaysValue) || 30 })
    if (rules.minTx) out.push({ kind: 'minTransactions', count: Number(rules.minTxValue) || 1 })
    return out
  }

  async function save(activate: boolean) {
    setBusy(true); setErr('')
    const res = await api('/vouchers', {
      method: 'POST',
      body: JSON.stringify({
        code: code.trim() || undefined,
        kind,
        mode,
        // Sent as the inputs, never as the previewed amounts: the server cuts
        // its own. A list of slices posted by a browser is a list a compromised
        // console could make one slice long.
        ...(lucky
          ? {
              potAmount: Number(pot) || 0,
              winners: Number(winners) || 0,
              spread,
              minAmount: minAmt || undefined,
              maxAmount: maxAmt || undefined,
              amounts: byHand ? amounts : undefined,
            }
          : {}),
        rewardAmount: reward,
        totalClaims: lucky ? undefined : kind === 'UNIQUE' ? 1 : cap,
        perUserClaims: Number(perUser) || 1,
        requirements: requirements(),
        endsAt: endsAt || undefined,
        activate,
      }),
    })
    setBusy(false)
    if (!res.ok) { setErr((await res.json())?.error || 'Could not create that.'); return }
    onDone()
  }

  const field = { background: C.card, border: `1px solid ${C.line}`, color: C.text }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <button onClick={onCancel} className="text-[13px]" style={{ color: C.muted }}>Vouchers</button>
          <span style={{ color: C.dim }}>/</span>
          <span className="text-[19px] font-bold">New voucher</span>
        </div>
        <div className="flex gap-2">
          <Btn onClick={() => save(false)} disabled={busy}>Save as draft</Btn>
          <Btn kind="primary" onClick={() => save(true)} disabled={busy}>{busy ? 'Working…' : 'Activate'}</Btn>
        </div>
      </div>

      <div className="flex gap-7 flex-wrap">
        <div className="w-[560px]">
          <div className="text-[10px] tracking-[0.13em] mb-2.5" style={{ color: C.muted, fontFamily: MONO }}>
            WHAT IT PAYS
          </div>
          <div className="flex gap-2.5 mb-6">
            {([
              ['FIXED', 'Same for everyone', 'One reward, repeated until the cap.'],
              ['LUCKY', 'Lucky dip', 'One pot cut into unequal slices. Most get a little, one gets a lot.'],
            ] as const).map(([m, title, note]) => (
              <button key={m} onClick={() => { setMode(m); setCut(null); setErr('') }}
                      className="flex-1 rounded-xl px-3.5 py-3 text-left"
                      style={{
                        background: mode === m ? 'rgba(129,251,2,0.06)' : C.card,
                        border: `1px solid ${mode === m ? C.limeDim : C.line}`,
                      }}>
                <div className="text-[13.5px] font-semibold">{title}</div>
                <div className="text-[11.5px] mt-1" style={{ color: C.muted }}>{note}</div>
              </button>
            ))}
          </div>

          {/* A lucky voucher has to be a shared code: a pot cut twenty ways
              needs twenty claims, and a one-use code can only ever take one. */}
          <div className="text-[10px] tracking-[0.13em] mb-2.5" style={{ color: C.muted, fontFamily: MONO }}>
            HOW IT IS HANDED OUT
          </div>
          <div className="flex gap-2.5">
            {(lucky
              ? ([['PUBLIC', 'One shared code', 'Everyone who has it claims a slice, until the pot is gone.']] as const)
              : ([
              ['PUBLIC', 'One shared code', 'Anyone who has it can claim, up to the cap.'],
              ['UNIQUE', 'A unique code', 'Good once. A leaked one costs a single reward.'],
            ] as const)).map(([k, title, note]) => (
              <button key={k} onClick={() => setKind(k)} className="flex-1 rounded-xl px-3.5 py-3 text-left"
                      style={{
                        background: kind === k ? 'rgba(129,251,2,0.06)' : C.card,
                        border: `1px solid ${kind === k ? C.limeDim : C.line}`,
                      }}>
                <div className="text-[13.5px] font-semibold">{title}</div>
                <div className="text-[11.5px] mt-1" style={{ color: C.muted }}>{note}</div>
              </button>
            ))}
          </div>

          <div className="flex gap-4 mt-5">
            <div className="flex-1">
              <label htmlFor="v-code" className="block text-[10px] tracking-[0.13em] mb-2" style={{ color: C.muted, fontFamily: MONO }}>CODE</label>
              <input id="v-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                     placeholder="leave blank to generate one"
                     className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={{ ...field, fontFamily: MONO }} />
            </div>
            <div className="w-[150px]">
              <label htmlFor="v-amt" className="block text-[10px] tracking-[0.13em] mb-2" style={{ color: C.muted, fontFamily: MONO }}>
                {lucky ? 'THE POT' : 'REWARD'}
              </label>
              <input id="v-amt" value={lucky ? pot : amount}
                     onChange={(e) => { lucky ? setPot(e.target.value) : setAmount(e.target.value); if (lucky) setCut(null) }}
                     className="w-full rounded-lg px-3 py-2.5 text-[14px]" style={{ ...field, fontFamily: MONO }} />
            </div>
          </div>

          <div className="text-[10px] tracking-[0.13em] mt-5 mb-2" style={{ color: C.muted, fontFamily: MONO }}>LIMITS</div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="v-tot" className="block text-[11.5px] mb-1.5" style={{ color: C.muted }}>
                {lucky ? 'Winners' : 'Total claims'}
              </label>
              <input id="v-tot"
                     value={lucky ? winners : kind === 'UNIQUE' ? '1' : total}
                     disabled={!lucky && kind === 'UNIQUE'}
                     onChange={(e) => { lucky ? (setWinners(e.target.value), setCut(null)) : setTotal(e.target.value) }}
                     className="w-full rounded-lg px-3 py-2 text-[13.5px]"
                     style={{ ...field, fontFamily: MONO, opacity: !lucky && kind === 'UNIQUE' ? 0.5 : 1 }} />
            </div>
            <div className="flex-1">
              <label htmlFor="v-per" className="block text-[11.5px] mb-1.5" style={{ color: C.muted }}>Per person</label>
              <input id="v-per" value={perUser} onChange={(e) => setPerUser(e.target.value)}
                     className="w-full rounded-lg px-3 py-2 text-[13.5px]" style={{ ...field, fontFamily: MONO }} />
            </div>
            <div className="flex-1">
              <label htmlFor="v-end" className="block text-[11.5px] mb-1.5" style={{ color: C.muted }}>Ends (optional)</label>
              <input id="v-end" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
                     className="w-full rounded-lg px-3 py-2 text-[13.5px]" style={field} />
            </div>
          </div>

          {lucky && (
            <>
              <div className="text-[10px] tracking-[0.13em] mt-5 mb-2" style={{ color: C.muted, fontFamily: MONO }}>THE SPREAD</div>
              <div className="rounded-xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <div className="flex gap-2 mb-4">
                  {([
                    ['even', 'Even', 'everyone close'],
                    ['mixed', 'Mixed', 'a few stand out'],
                    ['wild', 'Wild', 'one big winner'],
                  ] as const).map(([sp, label, note]) => (
                    <button key={sp} onClick={() => { setSpread(sp); setByHand(false); setCut(null) }}
                            disabled={byHand}
                            className="flex-1 rounded-lg px-3 py-2 text-left disabled:opacity-40"
                            style={{
                              background: !byHand && spread === sp ? 'rgba(129,251,2,0.06)' : C.bg,
                              border: `1px solid ${!byHand && spread === sp ? C.limeDim : C.line}`,
                            }}>
                      <div className="text-[12.5px] font-semibold">{label}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: C.muted }}>{note}</div>
                    </button>
                  ))}
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label htmlFor="v-min" className="block text-[11.5px] mb-1.5" style={{ color: C.muted }}>Least (optional)</label>
                    <input id="v-min" value={minAmt} placeholder="auto" disabled={byHand}
                           onChange={(e) => { setMinAmt(e.target.value); setCut(null) }}
                           className="w-full rounded-lg px-3 py-2 text-[13.5px] disabled:opacity-40"
                           style={{ ...field, fontFamily: MONO }} />
                  </div>
                  <div className="flex-1">
                    <label htmlFor="v-max" className="block text-[11.5px] mb-1.5" style={{ color: C.muted }}>Most (optional)</label>
                    <input id="v-max" value={maxAmt} placeholder="none" disabled={byHand}
                           onChange={(e) => { setMaxAmt(e.target.value); setCut(null) }}
                           className="w-full rounded-lg px-3 py-2 text-[13.5px] disabled:opacity-40"
                           style={{ ...field, fontFamily: MONO }} />
                  </div>
                </div>

                <label className="flex items-center gap-2.5 mt-4 cursor-pointer">
                  <input type="checkbox" checked={byHand} style={{ accentColor: C.lime }}
                         onChange={(e) => { setByHand(e.target.checked); setCut(null) }} />
                  <span className="text-[12.5px]">Type the amounts myself</span>
                </label>

                {byHand && (
                  <>
                    <textarea value={amounts} onChange={(e) => { setAmounts(e.target.value); setCut(null) }}
                              rows={4} placeholder="0.1, 0.25, 0.5, 1, 5 …"
                              className="w-full rounded-lg px-3 py-2.5 text-[13px] mt-3"
                              style={{ ...field, fontFamily: MONO }} />
                    <p className="text-[11.5px] mt-1.5" style={{ color: C.dim }}>
                      Commas, spaces or one per line. They have to total the pot exactly, and they
                      get shuffled — a list in order would hand the big one to whoever claims first.
                    </p>
                  </>
                )}

                <div className="flex items-center gap-2.5 mt-4">
                  <Btn onClick={preview} disabled={cutting}>
                    {cutting ? 'Cutting…' : cut ? 'Reshuffle' : 'Preview the split'}
                  </Btn>
                  {!!cut && (
                    <span className="text-[11.5px]" style={{ color: C.dim }}>
                      Activating cuts a fresh one — this is the shape, not the slices.
                    </span>
                  )}
                </div>

                {!!cut && (
                  <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                    <div className="flex gap-6 mb-3">
                      {([
                        ['SMALLEST', cut.summary.min],
                        ['AVERAGE', cut.summary.average],
                        ['BIGGEST', cut.summary.max],
                      ] as const).map(([k, v]) => (
                        <div key={k}>
                          <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>{k}</div>
                          <div className="text-[15px] font-semibold mt-1"
                               style={{ color: k === 'BIGGEST' ? C.lime : C.text, fontVariantNumeric: 'tabular-nums' }}>
                            {Number(v).toFixed(2)}
                          </div>
                        </div>
                      ))}
                      <div>
                        <div className="text-[10px] tracking-[0.12em]" style={{ color: C.muted, fontFamily: MONO }}>DIFFERENT</div>
                        <div className="text-[15px] font-semibold mt-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {cut.summary.distinct} of {cut.summary.count}
                        </div>
                      </div>
                    </div>

                    {/* Biggest first: the question anybody actually has is what
                        the top prize is. */}
                    <div className="flex flex-wrap gap-1.5">
                      {cut.amounts.map((a: number, i: number) => (
                        <span key={i} className="rounded-md px-2 py-1 text-[12px]"
                              style={{
                                background: i === 0 ? 'rgba(129,251,2,0.12)' : C.bg,
                                border: `1px solid ${i === 0 ? C.limeDim : C.line}`,
                                color: i === 0 ? C.lime : C.text,
                                fontFamily: MONO, fontVariantNumeric: 'tabular-nums',
                              }}>
                          {a.toFixed(2)}
                        </span>
                      ))}
                    </div>

                    {!!cut.warning && (
                      <p className="text-[11.5px] mt-3 leading-relaxed" style={{ color: C.amber }}>{cut.warning}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="text-[10px] tracking-[0.13em] mt-5 mb-2" style={{ color: C.muted, fontFamily: MONO }}>WHO QUALIFIES</div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
            {([
              ['verified', RULE_LABEL.verified, null, null],
              ['ageDays', RULE_LABEL.accountAgeDays, 'ageDaysValue', '30'],
              ['minTx', RULE_LABEL.minTransactions, 'minTxValue', '1'],
            ] as const).map(([key, label, valueKey, placeholder]) => (
              <label key={key} className="flex items-center gap-3 px-3.5 py-3 cursor-pointer"
                     style={{ background: C.card, borderBottom: `1px solid ${C.lineSoft}` }}>
                <input type="checkbox" checked={!!rules[key]} style={{ accentColor: C.lime }}
                       onChange={(e) => setRules({ ...rules, [key]: e.target.checked })} />
                <span className="flex-1 text-[13px]">{label}</span>
                {valueKey && (
                  <input value={(rules[valueKey] as string) ?? ''} placeholder={placeholder!}
                         onChange={(e) => setRules({ ...rules, [valueKey]: e.target.value })}
                         className="w-[70px] rounded-md px-2 py-1 text-[12px]"
                         style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text, fontFamily: MONO }} />
                )}
              </label>
            ))}
            <div className="px-3.5 py-2.5 text-[11.5px]" style={{ background: C.card, color: C.dim }}>
              Nothing ticked means anyone can claim it.
            </div>
          </div>

          {!!err && <p className="text-[12px] mt-4" style={{ color: C.red }}>{err}</p>}
        </div>

        <div className="flex-1 min-w-[260px]">
          {/* Only once there is something to encode. A QR of an empty string
              is a picture of nothing that looks like a working code. */}
          {code.trim().length >= 4 && (
            <>
              <div className="text-[10px] tracking-[0.13em] mb-2.5" style={{ color: C.muted, fontFamily: MONO }}>THE QR</div>
              <div className="mb-6"><VoucherQr code={code.trim().toUpperCase()} /></div>
            </>
          )}
          <div className="text-[10px] tracking-[0.13em] mb-2.5" style={{ color: C.muted, fontFamily: MONO }}>WHAT IT COSTS</div>
          <div className="rounded-xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div className="flex justify-between py-1.5">
              <span className="text-[12.5px]" style={{ color: C.muted }}>
                {lucky ? `a pot of ${Number(pot) || 0}, ${cap} ways` : `${cap} × ${reward || 0}`}
              </span>
              <span className="text-[13.5px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{cost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1.5 mt-1.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
              <span className="text-[12.5px]" style={{ color: C.muted }}>Uncommitted float</span>
              <span className="text-[13.5px]" style={{ color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{float.free.toFixed(2)}</span>
            </div>

            {/* The line that has to be there before Activate does anything. */}
            {short > 0 && (
              <div className="rounded-lg px-3 py-2.5 mt-3 text-[11.5px] leading-relaxed"
                   style={{ background: 'rgba(224,160,99,0.08)', border: '1px solid rgba(224,160,99,0.28)', color: C.amber }}>
                {lucky ? (
                  <>
                    {short.toFixed(2)} USDC short of this pot. The slices are cut to the pot whatever the
                    float holds, so the last ones would fail. Top the float up, or use a smaller pot.
                  </>
                ) : (
                  <>
                    {short.toFixed(2)} USDC short. It will pay {affordable} claim{affordable === 1 ? '' : 's'} and then
                    start failing. Top the float up, or cap this at {affordable}.
                  </>
                )}
              </div>
            )}
            {short === 0 && cost > 0 && (
              <div className="rounded-lg px-3 py-2.5 mt-3 text-[11.5px]"
                   style={{ background: 'rgba(129,251,2,0.06)', border: `1px solid ${C.limeDim}`, color: C.lime }}>
                The float covers every claim.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══ Broadcast ════════════════════════════════════════════════════ */

const KINDS: { id: string; label: string; sub: string }[] = [
  { id: 'system', label: 'News', sub: 'Product news and updates. Reaches everyone with notifications on.' },
  { id: 'promotion', label: 'Offer', sub: 'Offers and campaigns. People who turned offers off still see it in the app, without a push.' },
  { id: 'security', label: 'Security', sub: 'Keeping accounts safe. Use it only for that, so people keep trusting it.' },
]

const AUDIENCES: { id: string; label: string }[] = [
  { id: 'everyone', label: 'Everyone' },
  { id: 'verified', label: 'Verified' },
  { id: 'unverified', label: 'Not verified' },
  { id: 'active', label: 'Active, last 30 days' },
  { id: 'inactive', label: 'Quiet for 30 days' },
]

const TAP_TO: { id: string; label: string }[] = [
  { id: 'notifications', label: 'Their notifications' },
  { id: 'home', label: 'Home' },
  { id: 'add_money', label: 'Add money' },
  { id: 'sell', label: 'Sell to a bank' },
  { id: 'bills', label: 'Bills' },
  { id: 'vouchers', label: 'Vouchers' },
  { id: 'referrals', label: 'Invite friends' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'savings', label: 'Savings' },
  { id: 'rates', label: 'Rates' },
  { id: 'transactions', label: 'Their transactions' },
  { id: 'kyc', label: 'Verify identity' },
  { id: 'security', label: 'Security settings' },
]

/** What it looks like where people meet it: on the lock screen, then in the app's notifications. */
function PhonePreview({ title, body, kind }: { title: string; body: string; kind: string }) {
  const t = title.trim() || 'Your title'
  const b = body.trim() || 'Your message shows here, in the words people will read.'
  const label = KINDS.find((k) => k.id === kind)?.label ?? 'News'
  return (
    <div className="mx-auto w-full max-w-[300px]">
      <div className="rounded-[34px] p-3" style={{ background: '#050604', border: '1px solid #20251A', boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)' }}>
        <div className="rounded-[26px] px-3 pb-5 pt-4" style={{ background: 'linear-gradient(180deg, #1B2414 0%, #0E120B 70%)' }}>
          <div className="text-center text-[11px]" style={{ color: 'rgba(236,239,231,0.7)' }}>
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <div className="text-center text-[44px] font-semibold leading-none tracking-[-0.03em] mt-1" style={{ color: '#ECEFE7' }}>
            {new Date().toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', hour12: false })}
          </div>

          {/* The push, as it lands. */}
          <div className="mt-6 rounded-2xl px-3 py-2.5" style={{ background: 'rgba(236,239,231,0.12)', backdropFilter: 'blur(8px)' }}>
            <div className="flex items-center gap-2">
              <img src="/images/logo.png" alt="" className="size-5 rounded-[5px]" />
              <span className="text-[10.5px] font-medium uppercase tracking-[0.04em]" style={{ color: 'rgba(236,239,231,0.7)' }}>
                Money Moves
              </span>
              <span className="ml-auto text-[10.5px]" style={{ color: 'rgba(236,239,231,0.55)' }}>
                now
              </span>
            </div>
            <div className="mt-1.5 text-[13px] font-semibold leading-snug" style={{ color: '#ECEFE7' }}>
              {t}
            </div>
            <div className="mt-0.5 text-[12.5px] leading-snug line-clamp-2" style={{ color: 'rgba(236,239,231,0.85)' }}>
              {b}
            </div>
          </div>

          {/* And where it stays: the app's notifications. */}
          <div className="mt-5 text-[10.5px] px-1" style={{ color: 'rgba(236,239,231,0.5)' }}>
            In the app
          </div>
          <div className="mt-1.5 rounded-2xl px-3 py-2.5" style={{ background: '#151A10', border: '1px solid #232A1B' }}>
            <div className="flex items-start gap-2.5">
              <span className="mt-1 size-2 rounded-full shrink-0" style={{ background: C.lime }} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold" style={{ color: '#ECEFE7' }}>
                  {t}
                </div>
                <div className="mt-0.5 text-[12px] leading-snug" style={{ color: 'rgba(236,239,231,0.7)' }}>
                  {b}
                </div>
                <div className="mt-1 text-[10.5px]" style={{ color: 'rgba(236,239,231,0.45)' }}>
                  {label} · just now
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A count against where text starts to get cut off: quiet until it's close, amber past it. */
function Counter({ n, soft, max }: { n: number; soft: number; max: number }) {
  return (
    <span className="text-[12px] tabular-nums" style={{ color: n > soft ? C.amber : C.dim }}>
      {n > soft ? `${n}/${max} · may be cut off on a lock screen` : `${n}/${max}`}
    </span>
  )
}

function BroadcastSection() {
  const [type, setType] = useState('system')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [audience, setAudience] = useState('everyone')
  const [link, setLink] = useState('notifications')
  const [reach, setReach] = useState<number | null>(null)
  const [testTo, setTestTo] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sent, setSent] = useState<any[] | null>(null)
  const [busy, setBusy] = useState<'' | 'send' | 'test'>('')
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const d = await get<any>('/broadcasts', { broadcasts: [] })
    setSent(d.broadcasts || [])
  }, [])
  useEffect(() => { load() }, [load])

  // How many it would reach, as the audience is picked.
  useEffect(() => {
    let alive = true
    setReach(null)
    get<any>(`/broadcasts/audience?audience=${audience}`, { count: null }).then((d) => alive && setReach(d.count))
    return () => {
      alive = false
    }
  }, [audience])

  const ready = !!title.trim() && !!body.trim()

  /**
   * Says what happened, and keeps what you wrote when nothing did. A rejected send once looked identical to a
   * delivered one - the form emptied and the words were gone - and promotional broadcasts failed that way for months.
   */
  async function send(test: boolean) {
    if (!ready) return
    setBusy(test ? 'test' : 'send')
    setSaid(null)
    try {
      const res = await api('/notifications/broadcast', {
        method: 'POST',
        body: JSON.stringify({ type, title: title.trim(), body: body.trim(), link, audience: test ? 'one' : audience, ...(test ? { to: testTo.trim() } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaid({ ok: false, text: data?.error || `That did not send (${res.status}). Nothing has gone out.` })
        return
      }
      if (test) {
        setSaid({ ok: true, text: `Test sent to ${testTo.trim()}. Check their phone, then send it for real.` })
        return
      }
      setSaid({ ok: true, text: `Sent to ${(data?.count ?? 0).toLocaleString()} ${data?.count === 1 ? 'person' : 'people'}.` })
      setTitle('')
      setBody('')
      setConfirming(false)
      load()
    } finally {
      setBusy('')
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'message',
      head: 'Message',
      width: 'minmax(0,2fr)',
      cell: (b) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{b.title}</div>
          <div className="truncate text-[12px]" style={{ color: C.dim }}>
            {b.body}
          </div>
        </div>
      ),
    },
    { key: 'kind', head: 'Kind', width: '90px', phone: 'meta', cell: (b) => <span style={{ color: C.muted }}>{KINDS.find((k) => k.id === b.type)?.label ?? b.type}</span> },
    { key: 'when', head: 'Sent', width: '96px', phone: 'meta', cell: (b) => <span style={{ color: C.muted }}><When at={b.createdAt} /></span> },
    { key: 'reach', head: 'Reached', width: '90px', align: 'right', phone: 'meta', cell: (b) => (b.recipientCount || 0).toLocaleString() },
    {
      key: 'read',
      head: 'Read in the app',
      width: '130px',
      align: 'right',
      cell: (b) => {
        const pct = b.recipientCount ? Math.round(((b.readCount || 0) / b.recipientCount) * 100) : 0
        return (
          <span>
            {(b.readCount || 0).toLocaleString()} <span style={{ color: C.dim }}>· {pct}%</span>
          </span>
        )
      },
    },
    {
      key: 'remove',
      head: '',
      width: '76px',
      align: 'right',
      phone: 'meta',
      cell: (b) => (
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation()
            if (!window.confirm('Remove this broadcast? It also disappears from everyone\'s notifications in the app.')) return
            await api(`/broadcasts/${b.id}`, { method: 'DELETE' })
            load()
          }}
          className="text-[12.5px] transition-colors hover:text-[#F87171]"
          style={{ color: C.dim }}
        >
          Remove
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="New broadcast" sub="A push to people's phones, kept in their notifications in the app.">
          <div className="space-y-4">
            <Field label="Kind">
              <Segmented value={type} onChange={setType} items={KINDS.map((k) => [k.id, k.label] as const)} />
              <div className="mt-1.5 text-[12px]" style={{ color: C.dim }}>
                {KINDS.find((k) => k.id === type)?.sub}
              </div>
            </Field>

            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Short. It's the bold line on the lock screen." />
              <div className="mt-1.5"><Counter n={title.length} soft={40} max={60} /></div>
            </Field>

            <Field label="Message">
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={180} placeholder="One sentence someone can act on." />
              <div className="mt-1.5"><Counter n={body.length} soft={110} max={180} /></div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Goes to">
                <KitSelect value={audience} onChange={(e) => { setAudience(e.target.value); setConfirming(false) }}>
                  {AUDIENCES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </KitSelect>
                <div className="mt-1.5 text-[12px] tabular-nums" style={{ color: C.dim }}>
                  {reach == null ? 'Counting…' : `${reach.toLocaleString()} ${reach === 1 ? 'person' : 'people'}`}
                </div>
              </Field>
              <Field label="When they tap it, open">
                <KitSelect value={link} onChange={(e) => setLink(e.target.value)}>
                  {TAP_TO.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </KitSelect>
                <div className="mt-1.5 text-[12px]" style={{ color: C.dim }}>
                  Older app versions open their notifications.
                </div>
              </Field>
            </div>

            {said && (
              <div
                className="text-[12.5px] leading-relaxed px-3 py-2.5 rounded-lg"
                style={said.ok ? { background: 'rgba(129,251,2,0.07)', border: '1px solid rgba(129,251,2,0.25)', color: C.text } : { background: `${C.red}14`, border: `1px solid ${C.red}44`, color: C.red }}
              >
                {said.text}
              </div>
            )}

            {/* A test first: one person, by email or username, and nothing kept in the list. */}
            <div className="rounded-lg p-3" style={{ background: C.bg, border: `1px solid ${C.line}` }}>
              <div className="text-[12.5px] font-medium" style={{ color: C.muted }}>
                Send a test first
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="min-w-[200px] flex-1">
                  <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Your email or @username" />
                </div>
                <Btn onClick={() => send(true)} disabled={!ready || !testTo.trim() || busy !== ''}>
                  {busy === 'test' ? 'Sending…' : 'Send test'}
                </Btn>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {confirming ? (
                <>
                  <span className="mr-auto text-[13px]" style={{ color: C.text }}>
                    This goes to {reach?.toLocaleString() ?? '…'} people now. It can't be unsent.
                  </span>
                  <Btn onClick={() => setConfirming(false)} disabled={busy !== ''}>
                    Cancel
                  </Btn>
                  <Btn kind="primary" onClick={() => send(false)} disabled={busy !== ''}>
                    {busy === 'send' ? 'Sending…' : 'Yes, send it'}
                  </Btn>
                </>
              ) : (
                <Btn kind="primary" onClick={() => setConfirming(true)} disabled={!ready || !reach || busy !== ''}>
                  Send to {reach == null ? '…' : reach.toLocaleString()} {reach === 1 ? 'person' : 'people'}
                </Btn>
              )}
            </div>
          </div>
        </Panel>

        <div className="lg:sticky lg:top-24 self-start">
          <div className="mb-3 text-[12.5px]" style={{ color: C.muted }}>
            What people see
          </div>
          <PhonePreview title={title} body={body} kind={type} />
        </div>
      </div>

      <Panel title="Already sent" flush>
        {sent == null ? <Loading /> : <Table rows={sent} columns={columns} rowKey={(b) => b.id} empty="Nothing has been broadcast yet." />}
      </Panel>
    </div>
  )
}

/* ═══ Savings ══════════════════════════════════════════════════════ */

function Savings() {
  const [status, setStatus] = useState('ACTIVE')
  const [data, setData] = useState<{ locks: any[]; counts: any; pagination: any }>({ locks: [], counts: {}, pagination: {} })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [cfg, setCfg] = useState<any>(null)
  const [feeWallet, setFeeWallet] = useState('')
  const [feePercent, setFeePercent] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setData(await get(`/savings-locks?status=${status}&page=${page}&limit=20`, { locks: [], counts: {}, pagination: {} }))
    setLoading(false)
  }, [status, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    ;(async () => {
      const c = await get<any>('/vault-config', null)
      if (c) {
        setCfg(c)
        setFeeWallet(c.feeWallet || '')
        setFeePercent(c.feePercent || '')
      }
    })()
  }, [])

  async function saveCfg() {
    const pct = Number(feePercent)
    if (!feeWallet.trim() || Number.isNaN(pct)) return
    setSaving(true)
    setMsg('')
    const res = await api('/vault-config/update', {
      method: 'POST',
      body: JSON.stringify({ feeWallet: feeWallet.trim(), feeBps: Math.round(pct * 100) }),
    })
    setSaving(false)
    setMsg(res.ok ? 'Saved on chain.' : 'The chain refused that. Check the address and try again.')
  }

  return (
    <div className="space-y-5">
      <Chips
        items={[
          { id: 'ACTIVE', label: 'Locked', count: data.counts?.ACTIVE },
          { id: 'UNLOCKED', label: 'Released', count: data.counts?.UNLOCKED },
          { id: '', label: 'All' },
        ]}
        value={status}
        onChange={(s) => { setStatus(s); setPage(1) }}
      />

      <Card>
        {loading ? (
          <Loading />
        ) : data.locks.length === 0 ? (
          <Empty>No locks in this state.</Empty>
        ) : (
          data.locks.map((l) => (
            <Row
              key={l.id}
              lead={`${Number(l.amount).toFixed(4)} ${l.asset}`}
              sub={l.user?.username ? `@${l.user.username}` : l.user?.email}
              meta={
                <>
                  <Status value={l.status} />
                  <MetaBit>{l.durationDays}d</MetaBit>
                  <MetaBit>unlocks {new Date(l.unlocksAt).toLocaleDateString('en-NG', { day: '2-digit', month: 'short' })}</MetaBit>
                  <MetaBit>{l.chain}</MetaBit>
                </>
              }
            />
          ))
        )}
        <Pager
          page={data.pagination?.page || 1}
          pages={data.pagination?.pages || 1}
          total={data.pagination?.total || 0}
          unit="locks"
          onPage={setPage}
        />
      </Card>

      <Card>
        <div className="px-4 pt-4 pb-3"><Label>Vault contract</Label></div>
        <div className="px-4 pb-4 space-y-4">
          {!cfg ? (
            <Loading />
          ) : (
            <>
              <Detail k="Vault" v={shortHash(cfg.vaultAddress || '', 10, 8)} mono />
              <Detail k="Admin" v={shortHash(cfg.admin || '', 10, 8)} mono />
              <Field label="Fee wallet">
                <Input value={feeWallet} onChange={(e) => setFeeWallet(e.target.value)} placeholder="0x…" />
              </Field>
              <Field label="Fee percent (max 5)">
                <Input value={feePercent} onChange={(e) => setFeePercent(e.target.value)} inputMode="decimal" placeholder="0.50" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px]" style={{ color: msg.startsWith('Saved') ? C.lime : C.muted }}>
                  {msg || 'Writes to the contract on Movement.'}
                </span>
                <Btn kind="primary" onClick={saveCfg} disabled={saving}>
                  {saving ? 'Writing…' : 'Save'}
                </Btn>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
