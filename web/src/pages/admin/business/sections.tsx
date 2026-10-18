/**
 * The Business side's lists. Each answers one question - is anything stuck,
 * which business, where did the money go - and every row opens its record's
 * page.
 */
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { C } from '../ui'
import { BizError, KIND, useLoad, type BusinessRow, type Paged, type Pay, type Settle } from './client'
import {
  BizState,
  Dim,
  Figures,
  ListLoading,
  naira,
  Pager,
  Panel,
  plural,
  Problem,
  SearchBox,
  Segmented,
  Select,
  Table,
  TextButton,
  toneColor,
  useTyped,
  When,
  type Column,
  type Tone,
} from './kit'
import { useRecord } from './nav'
import { paymentColumns, paymentFlag, settlementColumns, settlementFlag } from './tables'
import type { BizJump } from './index'

/** A page number that goes back to 1 whenever the filters change. */
function usePage(filters: string) {
  const [state, setState] = useState({ filters, page: 1 })
  const page = state.filters === filters ? state.page : 1
  return [page, (p: number) => setState({ filters, page: p })] as const
}

/* ═══ Overview ═════════════════════════════════════════════════════ */

type OverviewData = {
  businesses: { total: number; unverified: number; inReview: number; verified: number; suspended: number; newThisWeek: number }
  attention: { failed: number; held: number; stuck: number; review?: number; refundsToSend?: number; disputesOpen?: number; chatsWaiting?: number; detailChanges?: number; cryptoReturns?: number; inReview: number; applications?: number; waitingBanks: number; testFailed: number; documentsLocked?: boolean }
  today: { live: { payments: number; volumeNgn: number }; test: { payments: number; volumeNgn: number }; settled: { count: number; amountNgn: number } }
  recent: Pay[]
}

export function Overview({ onJump }: { onJump: (j: BizJump) => void }) {
  // Live first: test payments are businesses trying things out, a tab away when wanted.
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const { data, error, loading, reload } = useLoad<OverviewData>(`/overview?mode=${mode}`)
  const { open } = useRecord()
  if (loading && !data) return <Panel flush><ListLoading /></Panel>
  if (error || !data) return <Panel flush><Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} /></Panel>

  const a = data.attention
  const queue: { label: string; sub: string; n: number; tone: Tone; go: BizJump }[] = [
    {
      label: "Stored documents won't open",
      sub: 'DOCS_KEY changed without the old key kept - uploads are paused. Open KYC to check every document.',
      n: a.documentsLocked ? 1 : 0,
      tone: 'bad',
      go: { section: 'b_kyc' },
    },
    { label: "Settlements that didn't land", sub: 'Failed at the rail, or still sending after ten minutes', n: a.failed + a.stuck, tone: 'bad', go: { section: 'b_settlements', filter: 'attention' } },
    { label: 'Payouts to review', sub: 'Bigger than the review limit - waiting for a person to check and send', n: a.review ?? 0, tone: 'warn', go: { section: 'b_settlements', filter: 'review' } },
    { label: 'Chats waiting for a reply', sub: 'Someone wrote in the help chat and nobody on the team has read it yet', n: a.chatsWaiting ?? 0, tone: 'warn', go: { section: 'b_support' } },
    { label: 'Refunds to send', sub: "The business's money is in - pay the customer back and mark it sent", n: a.refundsToSend ?? 0, tone: 'warn', go: { section: 'b_refunds', filter: 'send' } },
    { label: 'Open disputes', sub: 'Customers waiting on a business, or bank claims waiting on the bank', n: a.disputesOpen ?? 0, tone: 'warn', go: { section: 'b_disputes', filter: 'open' } },
    { label: 'Crypto to send back', sub: 'No address to send it to on its own, or a send that failed: the team sends these', n: a.cryptoReturns ?? 0, tone: 'warn', go: { section: 'b_crypto' } },
    { label: 'Held: nowhere to send', sub: 'Paid, but no checked bank account or business wallet to settle to', n: a.held, tone: 'warn', go: { section: 'b_settlements', filter: 'attention' } },
    { label: 'Applications to review', sub: 'Submitted and waiting for a decision', n: a.applications ?? a.inReview, tone: 'warn', go: { section: 'b_kyc', filter: 'queue' } },
    { label: 'Details to check', sub: 'A business asked to change its name, phone or support contacts - nothing changes until you approve', n: a.detailChanges ?? 0, tone: 'warn', go: { section: 'b_businesses', filter: 'changes' } },
    { label: 'Bank accounts to check', sub: "The bank's name didn't match the business", n: a.waitingBanks, tone: 'warn', go: { section: 'b_businesses', filter: 'banks' } },
  ]
  const waiting = queue.filter((q) => q.n > 0)

  return (
    <div className="space-y-5">
      <Panel title="Needs a person" flush>
        {waiting.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13.5px]" style={{ color: C.dim }}>
            Nothing stuck. Every paid settlement has landed or is on its way.
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
        {a.testFailed > 0 && (
          <div className="px-4 py-3 text-[12px]" style={{ color: C.dim, borderTop: `1px solid ${C.lineSoft}` }}>
            Plus {a.testFailed} in test mode - businesses trying the failure path. Nothing real to fix.
          </div>
        )}
      </Panel>

      <Segmented value={mode} onChange={setMode} items={[['live', 'Live'], ['test', 'Test']]} />

      <Panel flush>
        <Figures
          items={[
            { label: 'Paid, last 24 hours', value: naira(data.today[mode].volumeNgn), sub: plural(data.today[mode].payments, `${mode} payment`) },
            { label: 'Settled, last 24 hours', value: naira(data.today.settled.amountNgn), sub: plural(data.today.settled.count, mode === 'test' ? 'test payout' : 'payout') },
            { label: 'Businesses', value: data.businesses.total.toLocaleString(), sub: `${data.businesses.verified} verified · ${data.businesses.suspended} deactivated` },
            { label: 'New this week', value: data.businesses.newThisWeek.toLocaleString(), sub: plural(data.today.test.payments, 'test payment') + ' today' },
          ]}
        />
      </Panel>

      <Panel title="Latest payments" action={<TextButton onClick={() => onJump({ section: 'b_payments' })}>View all</TextButton>} flush>
        <Table rows={data.recent} columns={paymentColumns({ business: true })} rowKey={(p) => p.id} flag={paymentFlag} onRow={(p) => open('payment', p.id, { from: 'Overview' })} empty={mode === 'test' ? 'No test payments yet.' : 'No live payments yet.'} />
      </Panel>
    </div>
  )
}

/* ═══ Businesses ═══════════════════════════════════════════════════ */

const BUSINESS_VIEWS = [
  ['', 'All'],
  ['UNVERIFIED', 'Unverified'],
  ['IN_REVIEW', 'In review'],
  ['VERIFIED', 'Verified'],
  ['SUSPENDED', 'Deactivated'],
  ['banks', 'Banks to check'],
  ['changes', 'Details to check'],
] as const

export function Businesses({ initial }: { initial?: string }) {
  const { open } = useRecord()
  const [view, setView] = useState<string>(BUSINESS_VIEWS.some(([v]) => v === initial) ? initial! : '')
  const [typed, setTyped, q] = useTyped()
  const [page, setPage] = usePage(`${view}|${q}`)
  const params = new URLSearchParams({ page: String(page) })
  if (view === 'banks') params.set('needs', 'banks')
  if (view === 'changes') params.set('needs', 'changes')
  else if (view) params.set('status', view)
  if (q) params.set('q', q)
  const { data, error, loading, reload } = useLoad<Paged & { businesses: BusinessRow[] }>(`/businesses?${params}`)
  const columns: Column<BusinessRow>[] = [
    {
      key: 'name',
      head: 'Business',
      width: 'minmax(0,1.7fr)',
      cell: (b) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{b.name}</div>
          <div className="truncate text-[12px]" style={{ color: C.dim }}>
            {b.owner?.email ?? 'No owner'}
          </div>
        </div>
      ),
      phone: 'title',
    },
    {
      key: 'state',
      head: 'State',
      width: '150px',
      cell: (b) => (
        <div>
          <BizState status={b.status} />
          {b.banks.waiting > 0 && (
            <div className="text-[11.5px]" style={{ color: C.amber }}>
              {plural(b.banks.waiting, 'bank')} to check
            </div>
          )}
        </div>
      ),
      phone: 'meta',
    },
    { key: 'kind', head: 'Kind', width: 'minmax(0,1fr)', cell: (b) => KIND[b.kind], phone: 'meta' },
    {
      key: 'live',
      head: 'Taken, live',
      width: '128px',
      align: 'right',
      cell: (b) => (
        <div>
          <div className="font-medium tabular-nums">{b.live.payments ? naira(b.live.volumeNgn) : <Dim>—</Dim>}</div>
          <div className="text-[11.5px]" style={{ color: C.dim }}>
            {b.live.payments ? plural(b.live.payments, 'payment') : `${b.test.payments} test`}
          </div>
        </div>
      ),
    },
    {
      key: 'joined',
      head: 'Joined',
      width: '92px',
      cell: (b) => (
        <span style={{ color: C.muted }}>
          <When at={b.createdAt} />
        </span>
      ),
      phone: 'meta',
    },
  ]
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={typed} onChange={setTyped} placeholder="Business name, owner's email or merchant ID" />
        <Segmented value={view} onChange={setView} items={BUSINESS_VIEWS} />
      </div>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.businesses ?? []}
            columns={columns}
            rowKey={(b) => b.id}
            flag={(b) => (b.status === 'SUSPENDED' ? 'bad' : b.banks.waiting > 0 || b.status === 'IN_REVIEW' ? 'warn' : undefined)}
            onRow={(b) => open('business', b.id, { from: 'Businesses' })}
            empty="No business matches that."
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="business" units="businesses" onPage={setPage} />}
      </Panel>
    </div>
  )
}

/* ═══ Settlements ══════════════════════════════════════════════════ */

const SETTLE_VIEWS = [
  ['attention', 'Needs a person'],
  ['review', 'To review'],
  ['moving', 'On the way'],
  ['settled', 'Settled'],
  ['all', 'All'],
] as const

export function Settlements({ initial }: { initial?: string }) {
  const { open } = useRecord()
  const [view, setView] = useState<string>(SETTLE_VIEWS.some(([v]) => v === initial) ? initial! : 'attention')
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [page, setPage] = usePage(`${view}|${mode}`)
  const { data, error, loading, reload } = useLoad<Paged & { settlements: Settle[] }>(`/settlements?view=${view}&mode=${mode}&page=${page}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} items={SETTLE_VIEWS} />
        <Segmented value={mode} onChange={setMode} items={[['live', 'Live'], ['test', 'Test']]} />
      </div>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.settlements ?? []}
            columns={settlementColumns({ business: true })}
            rowKey={(s) => s.id}
            flag={settlementFlag}
            onRow={(s) => open('settlement', s.id, { from: 'Settlements' })}
            empty={view === 'attention' ? 'Nothing needs a person. Every payout has landed or is on its way.' : view === 'review' ? 'Nothing to review.' : 'None of those.'}
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="settlement" onPage={setPage} />}
      </Panel>
    </div>
  )
}

/* ═══ Payments ═════════════════════════════════════════════════════ */

export function Payments() {
  const { open } = useRecord()
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [status, setStatus] = useState('')
  const [typed, setTyped, q] = useTyped()
  const [page, setPage] = usePage(`${mode}|${status}|${q}`)
  const params = new URLSearchParams({ mode, page: String(page) })
  if (status) params.set('status', status)
  if (q) params.set('q', q)
  const { data, error, loading, reload } = useLoad<Paged & { payments: Pay[] }>(`/payments?${params}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={typed} onChange={setTyped} placeholder="Reference, customer email, payer or business" />
        <Segmented value={mode} onChange={setMode} items={[['live', 'Live'], ['test', 'Test']]} />
        <Select fit value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status but expired</option>
          <option value="PAID">Paid</option>
          <option value="UNDERPAID">Arrived short</option>
          <option value="OPEN">Waiting</option>
          <option value="EXPIRED">Expired</option>
        </Select>
      </div>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.payments ?? []}
            columns={paymentColumns({ business: true })}
            rowKey={(p) => p.id}
            flag={paymentFlag}
            onRow={(p) => open('payment', p.id, { from: 'Payments' })}
            empty="No payments match that."
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="payment" onPage={setPage} />}
      </Panel>
    </div>
  )
}
