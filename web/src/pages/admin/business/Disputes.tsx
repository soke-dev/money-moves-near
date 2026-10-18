/**
 * Disputes: customers questioning a payment from their receipt, and bank
 * claims on naira transfers. A customer dispute runs itself - the business
 * replies, the customer accepts or answers, deadlines close it - and we sit
 * in: write in, hand the turn back, or decide it. A bank claim is ours to
 * record from the rail's notice, pass the business's proof on, and close with
 * what the bank decided.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, BizError, bizFile, useLoad, type Paged } from './client'
import {
  ActionPanel,
  Button,
  Confirm,
  Copy,
  Facts,
  Field,
  IdLine,
  Input,
  LinkText,
  ListLoading,
  naira,
  Notice,
  PageHead,
  PageLoading,
  Panel,
  Pager,
  PasswordInput,
  Problem,
  Ref,
  Said,
  Segmented,
  Select,
  Table,
  Tag,
  Textarea,
  useAction,
  When,
  type Column,
} from './kit'
import { useRecord } from './nav'

type Status = 'NEEDS_REPLY' | 'UNDER_REVIEW' | 'WON' | 'REFUNDED' | 'LOST'
export type DisputeRow = {
  id: string
  ref: string
  mode: 'TEST' | 'LIVE'
  kind: 'CUSTOMER' | 'BANK'
  reason: string
  reasonWords: string
  status: Status
  amountNgn: number
  replyBy: string
  overdue: boolean
  waitUntil: string | null
  outcome: string | null
  refundId: string | null
  customer: { name: string | null; email: string | null }
  business: { id: string; name: string }
  payment: { id: string; ref: string; method: 'NAIRA' | 'APP' | 'CRYPTO'; currency: 'NGN' | 'USD'; amountNgn: number; amountUsd: number; receivedNgn: number | null; payerName: string | null; payerBank: string | null; payerAccount: string | null }
  openedBy: string
  openedAt: string
  closedAt: string | null
  closedBy: string | null
  messages?: { from: 'CUSTOMER' | 'BUSINESS' | 'BANK' | 'US'; body: string; at: string; by: string | null; files: { id: string; name: string }[] }[]
}

const STATE: Record<Status, [string, 'good' | 'warn' | 'bad' | undefined]> = {
  NEEDS_REPLY: ["Business's turn", 'warn'],
  UNDER_REVIEW: ['Under review', undefined],
  WON: ['Closed for the business', 'good'],
  REFUNDED: ['Refunded', 'good'],
  LOST: ['Closed against the business', 'bad'],
}
const open = (s: Status) => s === 'NEEDS_REPLY' || s === 'UNDER_REVIEW'

const columns: Column<DisputeRow>[] = [
  { key: 'business', head: 'Business', width: 'minmax(0,1.1fr)', cell: (d) => <span className="font-medium">{d.business.name}</span>, phone: 'title' },
  {
    key: 'ref',
    head: 'Dispute',
    width: '180px',
    cell: (d) => (
      <span className="inline-flex items-center gap-2">
        <Ref>{d.ref}</Ref>
        {d.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
      </span>
    ),
  },
  { key: 'kind', head: 'From', width: '120px', cell: (d) => (d.kind === 'BANK' ? <Tag tone="bad">Bank claim</Tag> : <span style={{ color: C.muted }}>Customer</span>) },
  { key: 'reason', head: 'Why', cell: (d) => <span style={{ color: C.muted }}>{d.reasonWords}</span>, phone: 'sub' },
  {
    key: 'state',
    head: 'State',
    width: '190px',
    cell: (d) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Tag tone={STATE[d.status][1]}>{STATE[d.status][0]}</Tag>
        {d.overdue && <Tag tone="bad">Overdue</Tag>}
      </span>
    ),
  },
  { key: 'amount', head: 'Amount', width: '120px', align: 'right', cell: (d) => <span className="tabular-nums font-medium">{naira(d.amountNgn)}</span>, phone: 'figure' },
  { key: 'when', head: 'Opened', width: '110px', align: 'right', cell: (d) => <When at={d.openedAt} />, phone: 'meta' },
]

const VIEWS = [
  ['open', 'Open'],
  ['bank', 'Bank claims'],
  ['closed', 'Closed'],
  ['all', 'All'],
] as const

export function Disputes({ initial }: { initial?: string }) {
  const { open: openRecord } = useRecord()
  const [view, setView] = useState<string>(VIEWS.some(([v]) => v === initial) ? initial! : 'open')
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad<Paged & { disputes: DisputeRow[] }>(`/disputes?view=${view}&mode=${mode}&page=${page}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={(v) => { setView(v); setPage(1) }} items={VIEWS} />
        <Segmented value={mode} onChange={(v) => { setMode(v); setPage(1) }} items={[['live', 'Live'], ['test', 'Test']]} />
      </div>
      <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
        Customer disputes run themselves on their deadlines; step in when you need to. A bank claim starts from the payment: open it and record what the bank sent.
      </p>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.disputes ?? []}
            columns={columns}
            rowKey={(d) => d.id}
            flag={(d) => (d.overdue || (d.kind === 'BANK' && d.status === 'UNDER_REVIEW') ? 'warn' : undefined)}
            onRow={(d) => openRecord('dispute', d.id, { from: 'Disputes' })}
            empty={view === 'open' ? 'No open disputes.' : 'None of those.'}
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="dispute" onPage={setPage} />}
      </Panel>
    </div>
  )
}

const SENDER: Record<string, string> = { CUSTOMER: 'Customer', BUSINESS: 'Business', BANK: "Sender's bank", US: 'Money Moves' }

export function DisputePage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<{ dispute: DisputeRow }>(`/disputes/${id}`)
  const { open: openRecord } = useRecord()
  const [acting, setActing] = useState<'message' | 'decide' | null>(null)
  if (loading && !data) return <PageLoading />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />
  const d = data.dispute
  const here = `Dispute ${d.ref}`
  const isOpen = open(d.status)
  const who = d.kind === 'BANK' ? "the sender's bank" : (d.customer.name ?? d.customer.email ?? 'the customer')

  return (
    <div>
      <PageHead
        title={
          <>
            {d.reasonWords} <span style={{ color: C.muted }}>from {who}</span>
          </>
        }
        meta={[
          <Tag tone={STATE[d.status][1]}>{STATE[d.status][0]}</Tag>,
          d.kind === 'BANK' && <Tag tone="bad">Bank claim</Tag>,
          d.mode === 'TEST' && <Tag tone="warn">Test</Tag>,
          d.overdue && <Tag tone="bad">Past the business's deadline</Tag>,
          <>
            Opened <When at={d.openedAt} />
          </>,
        ]}
        actions={
          isOpen && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setActing((a) => (a === 'message' ? null : 'message'))}>Write in</Button>
              <Button tone="primary" onClick={() => setActing((a) => (a === 'decide' ? null : 'decide'))}>
                {d.kind === 'BANK' ? "Record the bank's decision" : 'Decide it'}
              </Button>
            </div>
          )
        }
      >
        <IdLine
          items={[
            ['Reference', <Copy text={d.ref} />],
            ['Business', <LinkText onClick={() => openRecord('business', d.business.id, { from: here })}>{d.business.name}</LinkText>],
            ['Payment', <LinkText onClick={() => openRecord('payment', d.payment.id, { from: here })}>{d.payment.ref}</LinkText>],
            !!d.refundId && ['Refund', <LinkText onClick={() => openRecord('refund', d.refundId!, { from: here })}>Open it</LinkText>],
          ]}
        />
      </PageHead>

      {d.kind === 'BANK' && d.status === 'UNDER_REVIEW' && acting === null && (
        <div className="mb-5">
          <Notice tone="warn" title="Waiting on the bank">
            The business has sent its proof. Pass it to the bank through the rail, then record the bank's decision here.
          </Notice>
        </div>
      )}
      {acting === 'message' && <WriteIn d={d} onClose={() => setActing(null)} onDone={() => void reload()} />}
      {acting === 'decide' && <Decide d={d} onClose={() => setActing(null)} onDone={() => void reload()} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <Panel title="Conversation" sub={d.kind === 'BANK' ? 'The business sees all of it.' : 'The customer sees everything but bank messages; the business sees all of it.'}>
          <ol className="space-y-3">
            {(d.messages ?? []).map((m, i) => (
              <li key={i} className="rounded-lg px-3.5 py-3" style={{ background: m.from === 'US' ? 'rgba(255,255,255,0.04)' : 'transparent', border: m.from === 'US' ? 'none' : `1px solid ${C.line}` }}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12.5px] font-medium" style={{ color: m.from === 'BANK' ? '#F87171' : C.text }}>
                    {SENDER[m.from] ?? m.from}
                    {m.by && m.from !== 'CUSTOMER' && <span style={{ color: C.dim }}> · {m.by}</span>}
                  </span>
                  <span className="shrink-0 text-[11.5px]" style={{ color: C.dim }}>
                    <When at={m.at} full />
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: m.from === 'US' ? C.muted : C.text }}>
                  {m.body}
                </p>
                {m.files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.files.map((f) => (
                      <FileChip key={f.id} id={f.id} name={f.name} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Panel>
        <aside className="space-y-5 min-w-0">
          <Panel title="The dispute">
            <Facts
              rows={[
                ['Amount', naira(d.amountNgn)],
                ['Paid', d.payment.currency === 'USD' ? `$${d.payment.amountUsd.toLocaleString()}` : naira(d.payment.receivedNgn ?? d.payment.amountNgn)],
                d.kind === 'CUSTOMER' && ['Customer', d.customer.name ?? '—'],
                d.kind === 'CUSTOMER' && !!d.customer.email && ['Email', <Copy text={d.customer.email} />],
                d.kind === 'BANK' && !!d.payment.payerName && ['Sender', d.payment.payerName],
                d.kind === 'BANK' && !!d.payment.payerBank && ['Their bank', [d.payment.payerBank, d.payment.payerAccount].filter(Boolean).join(' · ')],
                isOpen && d.status === 'NEEDS_REPLY' && ['Business replies by', <When at={d.replyBy} full />],
                isOpen && !!d.waitUntil && ['Customer answers by', <When at={d.waitUntil} full />],
                ['Opened by', d.openedBy === 'customer' ? 'The customer' : d.openedBy],
                !!d.closedAt && ['Closed', <When at={d.closedAt} full />],
                !!d.closedBy && ['By', d.closedBy === 'system' ? 'Its deadline' : d.closedBy],
                !!d.outcome && ['Outcome', d.outcome],
              ]}
            />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

/** A file the business attached: opened through the API, decrypted, in a new tab. */
function FileChip({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const f = await bizFile(`/documents/${id}`)
          window.open(f.url, '_blank', 'noopener')
          setTimeout(() => URL.revokeObjectURL(f.url), 60_000)
        } catch (e) {
          alert(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]"
      style={{ border: `1px solid ${C.line}`, color: C.muted }}
    >
      {busy ? 'Opening…' : name} ↗
    </button>
  )
}

function WriteIn({ d, onClose, onDone }: { d: DisputeRow; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState<'US' | 'BANK'>('US')
  const [text, setText] = useState('')
  const [needsReply, setNeedsReply] = useState(false)
  const { busy, said, run } = useAction()
  return (
    <div className="mb-5">
      <ActionPanel title="Write in" sub="The business is emailed. Hand the turn back to it when you need more from it: it gets a fresh deadline.">
        {d.kind === 'BANK' && (
          <Field label="As">
            <Select fit value={from} onChange={(e) => setFrom(e.target.value as 'US' | 'BANK')}>
              <option value="US">Money Moves</option>
              <option value="BANK">The sender's bank (what it said)</option>
            </Select>
          </Field>
        )}
        <Field label="Message">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: C.text }}>
          <input type="checkbox" checked={needsReply} onChange={(e) => setNeedsReply(e.target.checked)} /> Ask the business to reply
        </label>
        <Confirm>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !text.trim()}
            onClick={async () => {
              if (await run(() => biz(`/disputes/${d.id}/message`, { method: 'POST', body: { from, body: text.trim(), needsReply } }), 'Sent. The business is emailed.')) {
                onClose()
                onDone()
              }
            }}
          >
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

function Decide({ d, onClose, onDone }: { d: DisputeRow; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<'WON' | 'LOST'>('WON')
  const [outcome, setOutcome] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const bank = d.kind === 'BANK'
  return (
    <div className="mb-5">
      <ActionPanel
        title={bank ? "The bank's decision" : 'Decide it'}
        sub={
          bank
            ? 'Dropped: the business keeps the payment. Kept: the business funds it like a refund, and we send it back to the sender.'
            : "For the business closes it. For the customer closes it and asks the business to refund. Both are emailed."
        }
      >
        <Segmented
          value={status}
          onChange={setStatus}
          items={bank ? [['WON', 'Bank dropped it'], ['LOST', 'Bank kept it']] : [['WON', 'For the business'], ['LOST', 'For the customer']]}
        />
        <Field label="What to tell them" hint="Optional. Left empty, they get a plain line saying what happened.">
          <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={600} />
        </Field>
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password}
            onClick={async () => {
              if (await run(() => biz(`/disputes/${d.id}/decision`, { method: 'POST', body: { status, outcome: outcome.trim() || undefined, password } }), 'Closed. Everyone is emailed.')) {
                onClose()
                onDone()
              }
            }}
          >
            {busy ? 'Saving…' : 'Close it'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

/** On a naira payment's page: the bank's claim, recorded from the rail's notice. */
export function BankClaim({ paymentId, receivedNgn, onClose, onDone }: { paymentId: string; receivedNgn: number; onClose: () => void; onDone: (disputeId: string) => void }) {
  const [reason, setReason] = useState<'UNAUTHORISED' | 'UNRECOGNISED' | 'DUPLICATE' | 'NOT_RECEIVED'>('UNAUTHORISED')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const n = Number(amount.replace(/[^0-9.]/g, '')) || 0
  return (
    <div className="mb-5">
      <ActionPanel title="Record a bank claim" sub="The business is emailed and has 5 days to send proof of the sale. Nothing moves until you record the bank's decision." danger>
        <Field label="The bank says">
          <Select fit value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="UNAUTHORISED">The transfer wasn't authorised</option>
            <option value="UNRECOGNISED">The sender doesn't recognise it</option>
            <option value="DUPLICATE">It was sent twice</option>
            <option value="NOT_RECEIVED">The sender didn't get what they paid for</option>
          </Select>
        </Field>
        <Field label="Amount claimed" hint={`Leave empty for the whole ${naira(receivedNgn)}.`}>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={String(receivedNgn)} />
        </Field>
        <Field label="What the bank sent" hint="The business sees this, so keep it to the claim.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={4000} />
        </Field>
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password || note.trim().length < 5 || n > receivedNgn}
            onClick={async () => {
              let made: { dispute: { id: string } } | null = null
              if (await run(async () => (made = await biz(`/payments/${paymentId}/bank-claim`, { method: 'POST', body: { reason, note: note.trim(), password, ...(n > 0 ? { amountNgn: n } : {}) } })), 'Recorded. The business is emailed.')) {
                onClose()
                if (made) onDone((made as { dispute: { id: string } }).dispute.id)
              }
            }}
          >
            {busy ? 'Recording…' : 'Record the claim'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}
