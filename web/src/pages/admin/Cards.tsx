/**
 * Cards: USD cards issued through Nuvion, topped up with stablecoins.
 *
 * Everything about them in one place: what is happening (figures, the float,
 * anything waiting), every card and who holds it, every top up, payments
 * across cards as they happen, and the limits and fees, which change here.
 * One person's own limits, a block, and freezing or deleting a card are on the
 * person's panel. Every change takes the action password.
 *
 * Card numbers and CVVs never reach the console.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { C, MONO } from './ui'
import { Button, Copy, Field, Figures, Input, Notice, Panel, Segmented, Table, Tabs, Tag, When, type Column, type Tone } from './business/kit'

const API = import.meta.env.VITE_API_URL || ''

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/api/admin/cards${path}`, authed())
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(r.status === 404 && !j?.error ? 'The API doesn’t have this page yet. It arrives with the next deploy.' : j?.error || `Couldn’t load (${r.status}).`)
  return j as T
}

async function send(method: 'PUT' | 'POST', path: string, body: unknown): Promise<any> {
  const r = await fetch(`${API}/api/admin/cards${path}`, authed({ method, body: JSON.stringify(body) }))
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || `That didn’t go through (${r.status}).`)
  return j
}

const usd = (n: number | null | undefined) =>
  n == null ? 'Unreadable' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Person = { id: string; email: string; username: string | null; name: string | null } | null

type Settings = {
  minTopup: number
  maxTopup: number
  dailyTopup: number
  maxCards: number
  topupFeeBps: number
  cardFee: number
  paused: boolean
  updatedBy: string | null
  updatedAt: string | null
}

type Overview = {
  settings: Settings
  ranges: Record<keyof Omit<Settings, 'paused' | 'updatedBy' | 'updatedAt'>, { min: number; max: number }>
  configured: boolean
  depositAddress: string | null
  floatBalance: number | null
  attention: string[]
  figures: {
    people: number
    blockedPeople: number
    cards: { active: number; frozen: number; used: number; deleted: number; fraud: number }
    kinds: { everyday: number; oneTime: number }
    topups: Record<'credited' | 'last24h' | 'last7d' | 'waiting' | 'failed', { count: number; usd: number }>
    earned: { topupFees: number; cardFees: number }
  }
  waitingReasons: { reason: string; count: number }[]
}

type CardRow = {
  id: string
  userId: string
  person: Person
  kind: 'everyday' | 'one-time'
  name: string
  last4: string | null
  status: string
  fee: number
  adminAction: string | null
  createdAt: string
  deletedAt: string | null
}

type Topup = {
  id: string
  userId: string
  person: Person
  asset: string
  amount: number
  credit: number
  fee: number
  status: 'PENDING' | 'PROCESSING' | 'CREDITED' | 'FAILED'
  reason: string | null
  txHash: string | null
  createdAt: string
}

type Payment = {
  id: string
  merchant: string
  place: string | null
  amount: number
  fee: number
  direction: 'in' | 'out'
  kind: 'payment' | 'reversal' | 'recoup'
  status: string
  reason: string | null
  at: number
  cardId?: string
  cardName?: string
  last4?: string | null
  userId?: string
  person?: Person
}

const CARD_STATE: Record<string, [Tone, string]> = {
  active: ['good', 'Active'],
  blocked: ['info', 'Frozen'],
  deactivated: ['idle', 'Used'],
  deleted: ['idle', 'Deleted'],
  fraud: ['bad', 'Fraud'],
}
const TOPUP_STATE: Record<Topup['status'], [Tone, string]> = {
  CREDITED: ['good', 'On the card'],
  PENDING: ['warn', 'Waiting'],
  PROCESSING: ['info', 'Paying'],
  FAILED: ['bad', 'Failed'],
}
const PAY_STATE: Record<string, [Tone, string]> = {
  successful: ['good', 'Done'],
  new: ['info', 'In flight'],
  pending: ['info', 'Pending'],
  flagged: ['warn', 'Flagged'],
  failed: ['bad', 'Declined'],
}

const who = (p: Person) => (p ? p.name || (p.username ? `@${p.username}` : p.email) : 'Unknown')
const whoSub = (p: Person) => (p ? [p.username ? `@${p.username}` : null, p.email].filter(Boolean).join(' · ') : '')

type View = 'overview' | 'cards' | 'topups' | 'payments' | 'settings'

export function CardsAdmin() {
  const [view, setView] = useState<View>('overview')
  const [password, setPassword] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')

  const loadOverview = useCallback(async () => {
    try {
      setError('')
      setOverview(await get<Overview>('/overview'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load cards.')
    }
  }, [])
  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  const f = overview?.figures

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[13px] max-w-[640px]" style={{ color: C.muted }}>
          USD cards topped up with stablecoins. Balances are read live from Nuvion. Every change here takes the action password.
        </p>
        <div className="w-[220px]">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Action password" />
        </div>
      </div>

      {error && <Notice tone="bad" title={error} />}

      <Tabs<View>
        value={view}
        onChange={(v) => {
          setView(v)
          setPersonId(null)
        }}
        items={[
          ['overview', 'Overview'],
          ['cards', 'Cards', f ? f.cards.active + f.cards.frozen : undefined],
          ['topups', 'Top ups', f ? f.topups.waiting.count + f.topups.failed.count || undefined : undefined],
          ['payments', 'Payments'],
          ['settings', 'Limits and fees'],
        ]}
      />

      {personId ? (
        <PersonPanel userId={personId} password={password} onBack={() => setPersonId(null)} onChanged={loadOverview} />
      ) : view === 'overview' ? (
        <OverviewView o={overview} onOpenTopups={() => setView('topups')} />
      ) : view === 'cards' ? (
        <CardsList onPerson={setPersonId} />
      ) : view === 'topups' ? (
        <TopupsList password={password} onPerson={setPersonId} onChanged={loadOverview} />
      ) : view === 'payments' ? (
        <PaymentsList onPerson={setPersonId} />
      ) : (
        <SettingsForm o={overview} password={password} onSaved={loadOverview} />
      )}
    </div>
  )
}

/* ─── Overview ─────────────────────────────────────────────────────── */

function OverviewView({ o, onOpenTopups }: { o: Overview | null; onOpenTopups: () => void }) {
  if (!o) return <Skeleton />
  const f = o.figures
  return (
    <div className="space-y-5">
      {o.attention.length > 0 && (
        <Notice tone="warn" title={o.attention.length === 1 ? 'One thing needs a look' : `${o.attention.length} things need a look`} action={f.topups.failed.count || f.topups.waiting.count ? <Button small onClick={onOpenTopups}>See top ups</Button> : undefined}>
          <ul className="mt-1 space-y-0.5">
            {o.attention.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Panel title="Money" flush>
        <Figures
          items={[
            { label: 'Float', value: usd(o.floatBalance), sub: 'Pays every top up', tone: o.floatBalance != null && o.floatBalance < f.topups.waiting.usd ? 'bad' : undefined },
            { label: 'Topped up, 24 hours', value: usd(f.topups.last24h.usd), sub: `${f.topups.last24h.count} top ups` },
            { label: 'Topped up, 7 days', value: usd(f.topups.last7d.usd), sub: `${f.topups.last7d.count} top ups` },
            { label: 'Topped up, all time', value: usd(f.topups.credited.usd), sub: `${f.topups.credited.count} top ups` },
            { label: 'Waiting', value: usd(f.topups.waiting.usd), sub: `${f.topups.waiting.count} top ups`, tone: f.topups.waiting.count ? 'warn' : undefined },
            { label: 'Failed', value: usd(f.topups.failed.usd), sub: `${f.topups.failed.count} top ups`, tone: f.topups.failed.count ? 'bad' : undefined },
            { label: 'Earned from top ups', value: usd(f.earned.topupFees) },
            { label: 'Earned from card fees', value: usd(f.earned.cardFees) },
          ]}
        />
      </Panel>

      <Panel title="Cards" flush>
        <Figures
          items={[
            { label: 'People with a card account', value: f.people.toLocaleString(), sub: f.blockedPeople ? `${f.blockedPeople} blocked` : undefined },
            { label: 'Active', value: f.cards.active.toLocaleString(), sub: `${f.kinds.everyday} everyday · ${f.kinds.oneTime} one-time` },
            { label: 'Frozen', value: f.cards.frozen.toLocaleString() },
            { label: 'Used one-time', value: f.cards.used.toLocaleString(), sub: `${f.cards.deleted} deleted${f.cards.fraud ? ` · ${f.cards.fraud} fraud` : ''}`, tone: f.cards.fraud ? 'bad' : undefined },
          ]}
        />
      </Panel>

      {o.waitingReasons.length > 0 && (
        <Panel title="Why top ups are waiting">
          <ul className="space-y-1 text-[13px]" style={{ color: C.text }}>
            {o.waitingReasons.map((r) => (
              <li key={r.reason}>
                <span className="tabular-nums">{r.count}</span> <span style={{ color: C.muted }}>{r.reason}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Set-up">
        <div className="space-y-1.5 text-[13px]" style={{ color: C.muted }}>
          <div>
            Server: {o.configured ? <Tag tone="good">Switched on</Tag> : <Tag tone="bad">Switched off</Tag>} {o.settings.paused && <Tag tone="warn">Paused here</Tag>}
          </div>
          <div>
            Deposit address (USDC and USDT on Solana):{' '}
            {o.depositAddress ? <Copy text={o.depositAddress}><span style={{ fontFamily: MONO }}>{o.depositAddress}</span></Copy> : 'not set'}
          </div>
        </div>
      </Panel>
    </div>
  )
}

/* ─── Cards ────────────────────────────────────────────────────────── */

function CardsList({ onPerson }: { onPerson: (id: string) => void }) {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<CardRow[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setError('')
      const d = await get<{ cards: CardRow[] }>(`/list?status=${status}&q=${encodeURIComponent(q)}`)
      setRows(d.cards)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the cards.')
    } finally {
      setBusy(false)
    }
  }, [status, q])
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, q])

  const columns: Column<CardRow>[] = [
    { key: 'who', head: 'Holder', phone: 'title', cell: (r) => <Two top={who(r.person)} sub={whoSub(r.person)} /> },
    { key: 'card', head: 'Card', phone: 'sub', cell: (r) => <Two top={`${r.name}${r.last4 ? ` ·· ${r.last4}` : ''}`} sub={r.kind === 'one-time' ? 'One-time' : 'Everyday'} /> },
    { key: 'state', head: 'State', width: '140px', cell: (r) => <StateTag map={CARD_STATE} s={r.status} extra={r.adminAction === 'frozen' ? 'by us' : r.adminAction === 'deleted' ? 'by us' : undefined} /> },
    { key: 'when', head: 'Made', width: '130px', phone: 'meta', cell: (r) => <When at={r.createdAt} /> },
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={status}
          onChange={setStatus}
          items={[['', 'All'], ['active', 'Active'], ['blocked', 'Frozen'], ['deactivated', 'Used'], ['deleted', 'Deleted'], ['fraud', 'Fraud']]}
        />
        <div className="w-[260px]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, @username or last 4" />
        </div>
      </div>
      {error && <Notice tone="bad" title={error} />}
      {!rows ? <Skeleton /> : (
        <Panel flush>
          <Table rows={rows} columns={columns} rowKey={(r) => r.id} onRow={(r) => onPerson(r.userId)} busy={busy} empty="No cards here." flag={(r) => (r.status === 'fraud' ? 'bad' : undefined)} />
        </Panel>
      )}
    </div>
  )
}

/* ─── Top ups ──────────────────────────────────────────────────────── */

function TopupsList({ password, onPerson, onChanged }: { password: string; onPerson: (id: string) => void; onChanged: () => void }) {
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<Topup[] | null>(null)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await get<{ topups: Topup[] }>(`/topups?status=${status}`)
      setRows(d.topups)
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : 'Couldn’t load the top ups.' })
    }
  }, [status])
  useEffect(() => {
    void load()
  }, [load])

  const retry = async (t: Topup) => {
    setBusy(t.id)
    setSaid(null)
    try {
      const r = await send('POST', `/topup/${t.id}/retry`, { password })
      setSaid({ ok: true, text: `Tried again: now ${TOPUP_STATE[r.status as Topup['status']]?.[1] ?? r.status}${r.reason ? ` (${r.reason})` : ''}.` })
      await load()
      onChanged()
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : 'Couldn’t retry.' })
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<Topup>[] = [
    { key: 'who', head: 'Who', phone: 'title', cell: (r) => <Two top={who(r.person)} sub={whoSub(r.person)} /> },
    { key: 'sent', head: 'Sent', width: '130px', cell: (r) => <Two top={`${r.amount} ${r.asset}`} sub={r.txHash ? <a href={`https://solscan.io/tx/${r.txHash}`} target="_blank" rel="noreferrer" style={{ color: C.lime }}>On Solscan</a> : 'No hash'} /> },
    { key: 'credit', head: 'On the card', width: '120px', align: 'right', phone: 'figure', cell: (r) => <Two top={usd(r.credit)} sub={r.fee > 0 ? `fee ${usd(r.fee)}` : undefined} /> },
    { key: 'state', head: 'State', width: '220px', phone: 'sub', cell: (r) => <Two top={<StateTag map={TOPUP_STATE} s={r.status} />} sub={r.status === 'CREDITED' ? undefined : r.reason || undefined} /> },
    { key: 'when', head: 'When', width: '120px', phone: 'meta', cell: (r) => <When at={r.createdAt} /> },
    {
      key: 'act',
      head: '',
      width: '110px',
      cell: (r) =>
        r.status === 'FAILED' || r.status === 'PENDING' ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button small disabled={!password || busy === r.id} onClick={() => void retry(r)}>
              {busy === r.id ? 'Trying…' : 'Try again'}
            </Button>
          </span>
        ) : null,
    },
  ]

  return (
    <div className="space-y-3">
      <Segmented value={status} onChange={setStatus} items={[['', 'All'], ['PENDING', 'Waiting'], ['PROCESSING', 'Paying'], ['FAILED', 'Failed'], ['CREDITED', 'On the card']]} />
      {said && <Notice tone={said.ok ? 'good' : 'bad'} title={said.text} />}
      {!password && rows?.some((r) => r.status === 'FAILED' || r.status === 'PENDING') && (
        <p className="text-[12.5px]" style={{ color: C.dim }}>Enter the action password above to try a top up again.</p>
      )}
      {!rows ? <Skeleton /> : (
        <Panel flush>
          <Table rows={rows} columns={columns} rowKey={(r) => r.id} onRow={(r) => onPerson(r.userId)} empty="No top ups here." flag={(r) => (r.status === 'FAILED' ? 'bad' : r.status === 'PENDING' ? 'warn' : undefined)} />
        </Panel>
      )}
    </div>
  )
}

/* ─── Payments ─────────────────────────────────────────────────────── */

function PaymentsList({ onPerson }: { onPerson: (id: string) => void }) {
  const [rows, setRows] = useState<Payment[] | null>(null)
  const [read, setRead] = useState(0)
  const [filter, setFilter] = useState<'' | 'failed' | 'in'>('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setError('')
      const d = await get<{ payments: Payment[]; cardsRead: number }>('/payments')
      setRows(d.payments)
      setRead(d.cardsRead)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load payments.')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(
    () => (rows ?? []).filter((p) => (filter === 'failed' ? p.status === 'failed' : filter === 'in' ? p.direction === 'in' : true)),
    [rows, filter],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={filter} onChange={setFilter} items={[['', 'All'], ['failed', 'Declined'], ['in', 'Refunds and reversals']]} />
        <div className="flex items-center gap-3">
          <span className="text-[12.5px]" style={{ color: C.dim }}>Read live from Nuvion across the {read} newest cards.</span>
          <Button small onClick={() => void load()} disabled={busy}>{busy ? 'Reading…' : 'Read again'}</Button>
        </div>
      </div>
      {error && <Notice tone="bad" title={error} />}
      {!rows ? <Skeleton /> : (
        <Panel flush>
          <Table
            rows={shown}
            columns={paymentColumns(true)}
            rowKey={(r) => r.id}
            onRow={(r) => r.userId && onPerson(r.userId)}
            busy={busy}
            empty="No card payments yet."
            flag={(r) => (r.status === 'failed' ? 'warn' : undefined)}
          />
        </Panel>
      )}
    </div>
  )
}

function paymentColumns(withHolder: boolean): Column<Payment>[] {
  return [
    ...(withHolder ? [{ key: 'who', head: 'Holder', phone: 'title' as const, cell: (r: Payment) => <Two top={who(r.person ?? null)} sub={`${r.cardName ?? ''}${r.last4 ? ` ·· ${r.last4}` : ''}`} /> }] : []),
    {
      key: 'merchant',
      head: 'Merchant',
      phone: withHolder ? 'sub' : 'title',
      cell: (r) => <Two top={r.kind === 'reversal' ? `Refund: ${r.merchant}` : r.kind === 'recoup' ? `Recoup: ${r.merchant}` : r.merchant} sub={r.place || undefined} />,
    },
    {
      key: 'amount',
      head: 'Amount',
      width: '120px',
      align: 'right',
      phone: 'figure',
      cell: (r) => (
        <Two
          top={<span style={{ color: r.direction === 'in' ? C.lime : C.text }}>{`${r.direction === 'in' ? '+' : '−'}${usd(r.amount)}`}</span>}
          sub={r.fee ? `fee ${usd(r.fee)}` : undefined}
        />
      ),
    },
    { key: 'state', head: 'State', width: '200px', cell: (r) => <Two top={<StateTag map={PAY_STATE} s={r.status} />} sub={r.status === 'successful' ? undefined : r.reason || undefined} /> },
    { key: 'when', head: 'When', width: '130px', phone: 'meta', cell: (r) => <When at={new Date(r.at).toISOString()} /> },
  ]
}

/* ─── Limits and fees ──────────────────────────────────────────────── */

const SETTING_FIELDS: { key: keyof Overview['ranges']; label: string; hint: string; unit: string }[] = [
  { key: 'minTopup', label: 'Smallest top up', hint: 'Dollars.', unit: '$' },
  { key: 'maxTopup', label: 'Largest single top up', hint: 'Dollars, per top up.', unit: '$' },
  { key: 'dailyTopup', label: 'Top up limit a day', hint: 'Dollars one person can top up in 24 hours.', unit: '$' },
  { key: 'maxCards', label: 'Cards per person', hint: 'Live cards one person can hold.', unit: '' },
  { key: 'topupFeeBps', label: 'Top up fee', hint: 'Basis points: 100 is 1%. Comes off what lands on the card.', unit: 'bps' },
  { key: 'cardFee', label: 'Card fee', hint: 'Dollars per new card, ours, on top of the issuer’s. Taken from the card balance and not refundable.', unit: '$' },
]

function SettingsForm({ o, password, onSaved }: { o: Overview | null; password: string; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!o) return
    setValues(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(o.settings[f.key])])))
  }, [o])

  if (!o) return <Skeleton />
  const s = o.settings
  const changed = SETTING_FIELDS.filter((f) => values[f.key] !== undefined && Number(values[f.key]) !== s[f.key])

  const save = async (extra: Record<string, unknown> = {}) => {
    setBusy(true)
    setSaid(null)
    try {
      const body: Record<string, unknown> = { password, ...extra }
      for (const f of changed) body[f.key] = Number(values[f.key])
      await send('PUT', '/settings', body)
      setSaid({ ok: true, text: 'Saved. The app follows within 15 seconds.' })
      onSaved()
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : 'Not saved.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Limits and fees"
        sub={
          <>
            For everyone, unless a person has their own limits on their panel.
            {s.updatedBy && s.updatedAt && (
              <>
                {' '}Last changed by {s.updatedBy}, <When at={s.updatedAt} />.
              </>
            )}
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SETTING_FIELDS.map((f) => {
            const r = o.ranges[f.key]
            return (
              <Field key={f.key} label={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} hint={`${f.hint} ${r.min} to ${r.max.toLocaleString()}.`}>
                <Input value={values[f.key] ?? ''} inputMode="decimal" onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value.replace(/[^0-9.]/g, '') }))} />
              </Field>
            )
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button tone="primary" small disabled={!changed.length || !password || busy} onClick={() => void save()}>
            {busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length === 1 ? '' : 's'}` : 'No changes'}
          </Button>
          {changed.length > 0 && (
            <Button small disabled={busy} onClick={() => setValues(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(s[f.key])])))}>
              Cancel
            </Button>
          )}
          {!password && changed.length > 0 && <span className="text-[12.5px]" style={{ color: C.dim }}>Enter the action password above.</span>}
        </div>
      </Panel>

      <Panel title="Pause cards" sub="Stops new top ups and new cards for everyone. Cards already out keep working, and sends already made still land.">
        <div className="flex flex-wrap items-center gap-3">
          {s.paused ? <Tag tone="warn">Paused</Tag> : <Tag tone="good">Open</Tag>}
          <Button small tone={s.paused ? 'primary' : 'danger'} disabled={!password || busy} onClick={() => void save({ paused: !s.paused })}>
            {s.paused ? 'Open cards again' : 'Pause cards'}
          </Button>
        </div>
      </Panel>

      {said && <Notice tone={said.ok ? 'good' : 'bad'} title={said.ok ? 'Saved' : 'Not saved'}>{said.text}</Notice>}
    </div>
  )
}

/* ─── One person ───────────────────────────────────────────────────── */

type PersonData = {
  person: Person
  account: { nuvionAccountId: string; accountNumber: string; balance: number | null; blockedAt: string | null; blockedBy: string | null; openedAt: string } | null
  limits: { effective: { maxTopup: number; dailyTopup: number; maxCards: number }; own: { maxTopup?: number; dailyTopup?: number; maxCards?: number } }
  cards: { id: string; kind: string; name: string; last4: string | null; status: string; adminAction: string | null; createdAt: string }[]
  topups: { id: string; amount: number; asset: string; credit: number; status: Topup['status']; reason: string | null; createdAt: string }[]
}

function PersonPanel({ userId, password, onBack, onChanged }: { userId: string; password: string; onBack: () => void; onChanged: () => void }) {
  const [d, setD] = useState<PersonData | null>(null)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [own, setOwn] = useState<Record<string, string>>({})
  const [activity, setActivity] = useState<{ cardId: string; rows: Payment[] | null; note?: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setError('')
      const x = await get<PersonData>(`/person/${userId}`)
      setD(x)
      setOwn({
        maxTopup: x.limits.own.maxTopup != null ? String(x.limits.own.maxTopup) : '',
        dailyTopup: x.limits.own.dailyTopup != null ? String(x.limits.own.dailyTopup) : '',
        maxCards: x.limits.own.maxCards != null ? String(x.limits.own.maxCards) : '',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load this person.')
    }
  }, [userId])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    setSaid(null)
    try {
      await fn()
      setSaid({ ok: true, text: ok })
      await load()
      onChanged()
    } catch (e) {
      setSaid({ ok: false, text: e instanceof Error ? e.message : 'That didn’t go through.' })
    } finally {
      setBusy(null)
    }
  }

  const openActivity = async (cardId: string) => {
    setActivity({ cardId, rows: null })
    try {
      const x = await get<{ payments: Payment[]; note?: string }>(`/card/${cardId}/activity`)
      setActivity({ cardId, rows: x.payments, note: x.note })
    } catch (e) {
      setActivity({ cardId, rows: [], note: e instanceof Error ? e.message : 'Couldn’t read the payments.' })
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button small onClick={onBack}>Back</Button>
        {d && (
          <div>
            <div className="text-[15px] font-semibold" style={{ color: C.text }}>{who(d.person)}</div>
            <div className="text-[12.5px]" style={{ color: C.muted }}>{whoSub(d.person)}</div>
          </div>
        )}
      </div>
      {error && <Notice tone="bad" title={error} />}
      {said && <Notice tone={said.ok ? 'good' : 'bad'} title={said.text} />}
      {!d ? <Skeleton /> : (
        <>
          <Panel title="Card account" flush>
            {d.account ? (
              <Figures
                items={[
                  { label: 'Card balance', value: usd(d.account.balance), sub: 'Live from Nuvion' },
                  { label: 'Account number', value: <span style={{ fontFamily: MONO, fontSize: 16 }}>{d.account.accountNumber}</span> },
                  { label: 'Opened', value: <When at={d.account.openedAt} /> },
                  { label: 'Cards', value: d.account.blockedAt ? 'Blocked' : 'Allowed', sub: d.account.blockedAt ? `by ${d.account.blockedBy ?? 'admin'}` : undefined, tone: d.account.blockedAt ? 'bad' : undefined },
                ]}
              />
            ) : (
              <p className="px-4 py-4 text-[13px]" style={{ color: C.dim }}>No card account yet. One opens on their first top up.</p>
            )}
          </Panel>

          {d.account && (
            <Panel title="Their own limits" sub={`Blank uses everyone's. Now: $${d.limits.effective.maxTopup.toLocaleString()} a top up, $${d.limits.effective.dailyTopup.toLocaleString()} a day, ${d.limits.effective.maxCards} cards.`}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Largest single top up ($)"><Input value={own.maxTopup ?? ''} onChange={(e) => setOwn((v) => ({ ...v, maxTopup: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="Everyone's" /></Field>
                <Field label="Top up limit a day ($)"><Input value={own.dailyTopup ?? ''} onChange={(e) => setOwn((v) => ({ ...v, dailyTopup: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder="Everyone's" /></Field>
                <Field label="Cards"><Input value={own.maxCards ?? ''} onChange={(e) => setOwn((v) => ({ ...v, maxCards: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Everyone's" /></Field>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button small tone="primary" disabled={!password || !!busy} onClick={() => void act('limits', () => send('PUT', `/person/${userId}`, { password, limits: own }), 'Their limits are saved.')}>
                  {busy === 'limits' ? 'Saving…' : 'Save their limits'}
                </Button>
                <Button
                  small
                  tone={d.account.blockedAt ? 'primary' : 'danger'}
                  disabled={!password || !!busy}
                  onClick={() => void act('block', () => send('PUT', `/person/${userId}`, { password, blocked: !d.account!.blockedAt }), d.account!.blockedAt ? 'Unblocked.' : 'Blocked from new cards and top ups.')}
                >
                  {d.account.blockedAt ? 'Unblock' : 'Block from cards'}
                </Button>
              </div>
            </Panel>
          )}

          <Panel title="Cards" flush>
            {d.cards.length === 0 ? (
              <p className="px-4 py-4 text-[13px]" style={{ color: C.dim }}>No cards.</p>
            ) : (
              d.cards.map((c, i) => (
                <div key={c.id} className="px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : undefined }}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-medium" style={{ color: C.text }}>
                        {c.name} {c.last4 && <span style={{ fontFamily: MONO, color: C.muted }}>·· {c.last4}</span>}
                        <StateTag map={CARD_STATE} s={c.status} extra={c.adminAction ? 'by us' : undefined} />
                      </div>
                      <div className="text-[12.5px]" style={{ color: C.dim }}>
                        {c.kind === 'one-time' ? 'One-time' : 'Everyday'} · made <When at={c.createdAt} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button small onClick={() => void openActivity(c.id)}>Payments</Button>
                      {c.status === 'active' && (
                        <Button small disabled={!password || !!busy} onClick={() => void act(c.id, () => send('POST', `/card/${c.id}/freeze`, { password }), 'Frozen. They can’t unfreeze it themselves.')}>Freeze</Button>
                      )}
                      {c.status === 'blocked' && (
                        <Button small disabled={!password || !!busy} onClick={() => void act(c.id, () => send('POST', `/card/${c.id}/unfreeze`, { password }), 'Unfrozen.')}>Unfreeze</Button>
                      )}
                      {c.status !== 'deleted' && (
                        <Button
                          small
                          tone="danger"
                          disabled={!password || !!busy}
                          onClick={() => {
                            if (window.confirm('Delete this card? It stops at once and can’t be brought back. The balance stays on their card account.')) {
                              void act(c.id, () => send('POST', `/card/${c.id}/delete`, { password }), 'Deleted.')
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {activity?.cardId === c.id && (
                    <div className="mt-3 rounded-lg" style={{ border: `1px solid ${C.line}` }}>
                      {activity.rows === null ? (
                        <p className="px-4 py-3 text-[13px]" style={{ color: C.dim }}>Reading from Nuvion…</p>
                      ) : (
                        <>
                          {activity.note && <p className="px-4 py-3 text-[12.5px]" style={{ color: C.dim }}>{activity.note}</p>}
                          <Table rows={activity.rows} columns={paymentColumns(false)} rowKey={(r) => r.id} empty="No payments on this card yet." />
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </Panel>

          <Panel title="Top ups" flush>
            <Table
              rows={d.topups}
              columns={[
                { key: 'sent', head: 'Sent', cell: (r) => `${r.amount} ${r.asset}` },
                { key: 'credit', head: 'On the card', width: '120px', align: 'right', cell: (r) => usd(r.credit) },
                { key: 'state', head: 'State', width: '240px', cell: (r) => <Two top={<StateTag map={TOPUP_STATE} s={r.status} />} sub={r.status === 'CREDITED' ? undefined : r.reason || undefined} /> },
                { key: 'when', head: 'When', width: '130px', cell: (r) => <When at={r.createdAt} /> },
              ]}
              rowKey={(r) => r.id}
              empty="No top ups."
            />
          </Panel>
        </>
      )}
    </div>
  )
}

/* ─── Bits ─────────────────────────────────────────────────────────── */

function Two({ top, sub }: { top: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[13.5px]" style={{ color: C.text }}>{top}</div>
      {sub && <div className="truncate text-[12px]" style={{ color: C.dim }}>{sub}</div>}
    </div>
  )
}

function StateTag({ map, s, extra }: { map: Record<string, [Tone, string]>; s: string; extra?: string }) {
  const [tone, label] = map[s] ?? (['idle', s] as [Tone, string])
  return <Tag tone={tone}>{extra ? `${label} ${extra}` : label}</Tag>
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl" style={{ background: C.lineSoft }} />
      ))}
    </div>
  )
}
