/**
 * Direct account checkouts: businesses paid straight into an account of their
 * own, told apart by the exact amount. Nothing settles by itself, so this is
 * where our team sees what each business is owed, marks what it has paid it
 * by hand, and sorts out transfers that matched no payment.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, useLoad } from './client'
import { ActionPanel, Button, Copy, Facts, Field, Input, ListLoading, naira, Notice, Panel, PasswordInput, Problem, Said, Segmented, Table, Tag, TextButton, useAction, When, type Column } from './kit'
import { useRecord } from './nav'

type Totals = { receivedNgn: number; settledNgn: number; owedNgn: number; paidCount: number; unmatchedDeposits: number; todayNgn: number }
type DirectBusiness = {
  id: string
  name: string
  status: string
  allowed: boolean
  allowedAt: string | null
  allowedBy: string | null
  account: { number: string; bank: string | null; name: string | null; reference: string | null } | null
  limits: { minNgn: number | null; maxNgn: number | null; dailyNgn: number | null }
  totals: Totals
  balanceNgn: number | null
  checkedAt: string | null
}
type DirectPayment = {
  id: string
  ref: string
  status: string
  amountNgn: number
  receivedNgn: number | null
  payer: string | null
  payerBank: string | null
  email: string | null
  createdAt: string
  paidAt: string | null
  settledAt: string | null
  settledBy: string | null
  settleNote: string | null
}
type Deposit = {
  id: string
  reference: string
  amountNgn: number
  sender: string | null
  senderBank: string | null
  senderAccount: string | null
  receivedAt: string
  status: 'UNMATCHED' | 'MATCHED' | 'RESOLVED'
  note: string | null
  resolvedBy: string | null
}

const listColumns: Column<DirectBusiness>[] = [
  { key: 'name', head: 'Business', width: 'minmax(0,1.2fr)', cell: (b) => <span className="font-medium">{b.name}</span>, phone: 'title' },
  { key: 'account', head: 'Account', width: '150px', cell: (b) => (b.account ? <span className="tabular-nums">{b.account.number}</span> : <span style={{ color: C.dim }}>None yet</span>), phone: 'sub' },
  { key: 'owed', head: 'Owed', width: '130px', align: 'right', cell: (b) => <span className="tabular-nums" style={{ color: b.totals.owedNgn > 0 ? C.amber : C.muted }}>{naira(b.totals.owedNgn)}</span> },
  { key: 'unmatched', head: 'Unmatched', width: '100px', align: 'right', cell: (b) => (b.totals.unmatchedDeposits ? <Tag tone="warn">{b.totals.unmatchedDeposits}</Tag> : <span style={{ color: C.dim }}>0</span>), phone: 'hide' },
  { key: 'state', head: 'State', width: '90px', align: 'right', cell: (b) => <Tag tone={b.allowed ? 'good' : undefined}>{b.allowed ? 'On' : 'Off'}</Tag>, phone: 'meta' },
]

export function Direct() {
  const [picked, setPicked] = useState<string | null>(null)
  const { data, error, loading, reload } = useLoad<{ ready: boolean; businesses: DirectBusiness[] }>('/direct')
  return (
    <div className="space-y-5">
      {data && !data.ready && (
        <Notice tone="warn" title="Direct accounts aren't set up">
          Set FLW_V3_SECRET_KEY on the Business API. Until then no business can be given one, and nothing that comes in is read.
        </Notice>
      )}
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.businesses ?? []}
            columns={listColumns}
            rowKey={(b) => b.id}
            flag={(b) => (b.totals.unmatchedDeposits ? 'warn' : undefined)}
            onRow={(b) => setPicked(b.id === picked ? null : b.id)}
            empty="No business has a direct account. Switch one on from the business's own page."
          />
        )}
      </Panel>
      {picked && <DirectDetail key={picked} id={picked} onClose={() => setPicked(null)} />}
    </div>
  )
}

function DirectDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { open } = useRecord()
  const { data, error, loading, reload } = useLoad<{ ready: boolean; business: DirectBusiness; payments: DirectPayment[]; deposits: Deposit[] }>(`/direct/${id}`)
  if (loading && !data) return <ListLoading />
  if (error) return <Problem error={error} onRetry={() => void reload()} />
  if (!data) return null
  const b = data.business
  const t = b.totals
  return (
    <div className="space-y-5">
      <ActionPanel title={b.name} sub={b.allowed ? <>Switched on <When at={b.allowedAt} />{b.allowedBy ? ` by ${b.allowedBy}` : ''}.</> : 'Switched off. Its account, payments and keys are kept for when it comes back on.'}>
        <div className="grid gap-5 md:grid-cols-2">
          <Facts
            rows={[
              ['Account number', b.account ? <Copy text={b.account.number} /> : <span style={{ color: C.dim }}>None yet</span>],
              !!b.account?.bank && ['Bank', b.account.bank],
              !!b.account?.name && ['Name on it', b.account.name],
              ['Holds now', b.balanceNgn == null ? <span style={{ color: C.dim }}>Unreadable</span> : naira(b.balanceNgn)],
              ['Last read', b.checkedAt ? <When at={b.checkedAt} /> : <span style={{ color: C.dim }}>Never</span>],
            ]}
          />
          <Facts
            rows={[
              ['Received', `${naira(t.receivedNgn)} from ${t.paidCount.toLocaleString()} paid`],
              ['Settled by us', naira(t.settledNgn)],
              ['Still owed', <span style={{ color: t.owedNgn > 0 ? C.amber : C.text }}>{naira(t.owedNgn)}</span>],
              ['Taken today', naira(t.todayNgn)],
            ]}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => open('business', b.id, { from: 'Direct' })}>Open the business</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </ActionPanel>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="space-y-5 min-w-0">
          {data.deposits.length > 0 && <Deposits deposits={data.deposits} onDone={() => void reload()} />}
          <Payments businessId={b.id} payments={data.payments} onDone={() => void reload()} />
        </div>
        <aside className="min-w-0">
          <Limits b={b} onDone={() => void reload()} />
        </aside>
      </div>
    </div>
  )
}

const PAY_STATE: Record<string, [string, 'good' | 'warn' | 'bad' | undefined]> = {
  OPEN: ['Waiting', undefined],
  PAID: ['Paid', 'good'],
  UNDERPAID: ['Paid short', 'warn'],
  EXPIRED: ['Expired', undefined],
  CANCELLED: ['Cancelled', undefined],
  FAILED: ['Failed', 'bad'],
}
const owed = (p: DirectPayment) => p.status === 'PAID' && !p.settledAt

/** Direct payments, with the ones still owed picked by a click and marked settled together. */
function Payments({ businessId, payments, onDone }: { businessId: string; payments: DirectPayment[]; onDone: () => void }) {
  const [view, setView] = useState<'owed' | 'all'>('owed')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const rows = view === 'owed' ? payments.filter(owed) : payments
  const chosen = payments.filter((p) => picked.has(p.id) && owed(p))
  const total = chosen.reduce((s, p) => s + (p.receivedNgn ?? p.amountNgn), 0)
  const toggle = (p: DirectPayment) => {
    if (!owed(p)) return
    const next = new Set(picked)
    if (next.has(p.id)) next.delete(p.id)
    else next.add(p.id)
    setPicked(next)
  }
  const settle = async () => {
    const ok = await run(() => biz(`/direct/${businessId}/settle`, { method: 'POST', body: { paymentIds: chosen.map((p) => p.id), note: note.trim() || null, password } }), `Marked ${chosen.length === 1 ? 'one payment' : `${chosen.length} payments`} settled.`)
    if (ok) {
      setPicked(new Set())
      setNote('')
      onDone()
    }
  }
  const columns: Column<DirectPayment>[] = [
    { key: 'pick', head: '', width: '28px', cell: (p) => (owed(p) ? <span aria-hidden style={{ color: picked.has(p.id) ? C.lime : C.dim }}>{picked.has(p.id) ? '●' : '○'}</span> : null), phone: 'hide' },
    { key: 'ref', head: 'Payment', width: 'minmax(0,1fr)', cell: (p) => <span className="font-medium">{p.ref}</span>, phone: 'title' },
    { key: 'payer', head: 'Paid by', cell: (p) => <span style={{ color: C.muted }}>{p.payer ?? p.email ?? 'Not known'}</span>, phone: 'sub' },
    { key: 'amount', head: 'Amount', width: '120px', align: 'right', cell: (p) => <span className="tabular-nums">{naira(p.receivedNgn ?? p.amountNgn)}</span> },
    { key: 'state', head: 'State', width: '120px', cell: (p) => (p.settledAt ? <Tag tone="info">Settled</Tag> : <Tag tone={PAY_STATE[p.status]?.[1]}>{PAY_STATE[p.status]?.[0] ?? p.status}</Tag>) },
    { key: 'when', head: 'Paid', width: '100px', align: 'right', cell: (p) => <When at={p.paidAt ?? p.createdAt} />, phone: 'meta' },
  ]
  return (
    <Panel
      title="Payments"
      sub={view === 'owed' ? 'Paid and not yet settled. Pick the ones you have paid the business for.' : 'Every direct payment, latest first.'}
      action={
        <>
          {view === 'owed' && rows.length > 0 && <TextButton onClick={() => setPicked(new Set(rows.map((p) => p.id)))}>Pick all</TextButton>}
          <Segmented value={view} onChange={setView} items={[['owed', 'Owed', payments.filter(owed).length], ['all', 'All']]} />
        </>
      }
      flush
    >
      <Table rows={rows} columns={columns} rowKey={(p) => p.id} onRow={toggle} empty={view === 'owed' ? 'Nothing owed. Every paid payment is settled.' : 'No direct payments yet.'} />
      {chosen.length > 0 && (
        <div className="space-y-3 border-t px-4 py-4" style={{ borderColor: C.line }}>
          <div className="text-[13px]">
            <span className="font-medium">{chosen.length === 1 ? 'One payment' : `${chosen.length} payments`}</span>, {naira(total)} in all
          </div>
          <Field label="Note" hint="The reference of the transfer you sent the business, say.">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password} onClick={() => void settle()}>
              {busy ? 'Saving…' : 'Mark settled'}
            </Button>
            <Button onClick={() => setPicked(new Set())} disabled={busy}>
              Clear
            </Button>
          </div>
        </div>
      )}
      {said && <div className="px-4 pb-4"><Said {...said} /></div>}
    </Panel>
  )
}

/** Transfers into the account that matched no payment, and ones already sorted out by hand. */
function Deposits({ deposits, onDone }: { deposits: Deposit[]; onDone: () => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const d = deposits.find((x) => x.id === picked) ?? null
  const columns: Column<Deposit>[] = [
    { key: 'amount', head: 'Transfer', width: '130px', cell: (x) => <span className="font-medium tabular-nums">{naira(x.amountNgn)}</span>, phone: 'title' },
    { key: 'sender', head: 'From', cell: (x) => <span style={{ color: C.muted }}>{[x.sender, x.senderBank].filter(Boolean).join(', ') || 'Not known'}</span>, phone: 'sub' },
    { key: 'state', head: 'State', width: '120px', cell: (x) => (x.status === 'UNMATCHED' ? <Tag tone="warn">Matched nothing</Tag> : <Tag>Sorted out</Tag>) },
    { key: 'when', head: 'Came in', width: '100px', align: 'right', cell: (x) => <When at={x.receivedAt} />, phone: 'meta' },
  ]
  return (
    <Panel title="Transfers that matched no payment" sub="Nothing fits their amount, or more than one payment does. Put each towards its payment, or say how it was sorted out." flush>
      <Table rows={deposits} columns={columns} rowKey={(x) => x.id} flag={(x) => (x.status === 'UNMATCHED' ? 'warn' : undefined)} onRow={(x) => setPicked(x.id === picked ? null : x.id)} />
      {d && (
        <div className="border-t px-4 py-4" style={{ borderColor: C.line }}>
          <DepositActions key={d.id} d={d} onClose={() => setPicked(null)} onDone={onDone} />
        </div>
      )}
    </Panel>
  )
}

function DepositActions({ d, onClose, onDone }: { d: Deposit; onClose: () => void; onDone: () => void }) {
  const [doing, setDoing] = useState<'assign' | 'resolve' | null>(null)
  const [text, setText] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const act = async (path: string, body: Record<string, unknown>, ok: string) => {
    if (await run(() => biz(`/direct/deposits/${d.id}/${path}`, { method: 'POST', body: { ...body, password } }), ok)) {
      setDoing(null)
      onDone()
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        <div><span style={{ color: C.dim }}>Sender </span>{d.sender ?? 'Not known'}</div>
        {d.senderBank && <div><span style={{ color: C.dim }}>Bank </span>{d.senderBank}</div>}
        {d.senderAccount && <div><span style={{ color: C.dim }}>Account </span><Copy text={d.senderAccount} /></div>}
        <div><span style={{ color: C.dim }}>Reference </span><Copy text={d.reference} /></div>
        {d.note && <div className="sm:col-span-2"><span style={{ color: C.dim }}>Note </span>{d.note}{d.resolvedBy ? `, ${d.resolvedBy}` : ''}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        {d.status === 'UNMATCHED' && <Button tone="primary" onClick={() => { setDoing(doing === 'assign' ? null : 'assign'); setText('') }}>Put towards a payment</Button>}
        {d.status === 'UNMATCHED' && <Button onClick={() => { setDoing(doing === 'resolve' ? null : 'resolve'); setText('') }}>Sorted out by hand</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
      {doing === 'assign' && (
        <div className="space-y-3">
          <Field label="Payment reference" hint="A direct payment of this business that is waiting or expired. It counts like any transfer: short pays it short, more pays it in full.">
            <Input value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="MMB-…" className="font-mono" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !text.trim()} onClick={() => void act('assign', { ref: text.trim() }, 'Put towards the payment.')}>
              {busy ? 'Saving…' : 'Put it towards'}
            </Button>
          </div>
        </div>
      )}
      {doing === 'resolve' && (
        <div className="space-y-3">
          <Field label="What happened">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Sent back to the sender, say" maxLength={300} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !text.trim()} onClick={() => void act('resolve', { note: text.trim() }, 'Marked sorted out.')}>
              {busy ? 'Saving…' : 'Mark sorted out'}
            </Button>
          </div>
        </div>
      )}
      {said && <Said {...said} />}
    </div>
  )
}

const digits = (s: string) => s.replace(/[^0-9]/g, '')
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

/** Its own least, most and daily cap. Empty keeps the platform's naira checkout limits, and no daily cap. */
function Limits({ b, onDone }: { b: DirectBusiness; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [min, setMin] = useState(b.limits.minNgn != null ? String(b.limits.minNgn) : '')
  const [max, setMax] = useState(b.limits.maxNgn != null ? String(b.limits.maxNgn) : '')
  const [daily, setDaily] = useState(b.limits.dailyNgn != null ? String(b.limits.dailyNgn) : '')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const save = async () => {
    const body = { minNgn: numOrNull(min), maxNgn: numOrNull(max), dailyNgn: numOrNull(daily), password }
    if (await run(() => biz(`/direct/${b.id}/limits`, { method: 'PATCH', body }), 'Saved.')) {
      setEditing(false)
      onDone()
    }
  }
  const own = (n: number | null) => (n == null ? <span style={{ color: C.dim }}>Platform's</span> : naira(n))
  return (
    <Panel title="Limits" action={!editing && <TextButton onClick={() => setEditing(true)}>Change</TextButton>}>
      {editing ? (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
            For direct checkouts only. Leave a box empty for the platform's naira checkout limits, or for no daily cap.
          </p>
          <Field label="Least a checkout can be, ₦">
            <Input value={min} onChange={(e) => setMin(digits(e.target.value))} inputMode="numeric" />
          </Field>
          <Field label="Most a checkout can be, ₦">
            <Input value={max} onChange={(e) => setMax(digits(e.target.value))} inputMode="numeric" />
          </Field>
          <Field label="Most in a day, ₦">
            <Input value={daily} onChange={(e) => setDaily(digits(e.target.value))} inputMode="numeric" placeholder="No cap" />
          </Field>
          <PasswordInput full value={password} onChange={setPassword} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button small onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button small tone="primary" disabled={busy || !password} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save limits'}
            </Button>
          </div>
          {said && !said.ok && <Said {...said} />}
        </div>
      ) : (
        <Facts
          rows={[
            ['Least', own(b.limits.minNgn)],
            ['Most', own(b.limits.maxNgn)],
            ['A day', b.limits.dailyNgn == null ? <span style={{ color: C.dim }}>No cap</span> : naira(b.limits.dailyNgn)],
          ]}
        />
      )}
    </Panel>
  )
}
