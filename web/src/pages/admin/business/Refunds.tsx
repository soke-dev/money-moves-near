/**
 * Refunds: the ones we send. A business asks and funds a refund in its
 * dashboard; once its money is in, the refund is ours to pay out by hand -
 * back the way the customer paid - and mark as sent. The business only ever
 * sees it on its way, then refunded. Test refunds finish by themselves.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, BizError, useLoad, type Paged } from './client'
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
  Table,
  Tag,
  Timeline,
  useAction,
  When,
  type Column,
} from './kit'
import { useRecord } from './nav'

export type RefundRow = {
  id: string
  ref: string
  mode: 'TEST' | 'LIVE'
  status: 'AWAITING_FUNDS' | 'SENDING' | 'REFUNDED' | 'CANCELLED'
  funding: 'WALLET' | 'APP' | 'BANK' | 'HELD'
  businessId: string
  business: string | null
  payment: { id: string; ref: string; method: 'NAIRA' | 'APP' | 'CRYPTO'; customerName: string | null; customerEmail: string | null } | null
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  feeBackNgn: number
  fundNgn: number
  fundUsd: number
  fundAccount: { bank: string | null; number: string; name: string | null; expiresAt: string | null } | null
  to: { kind: 'BANK' | 'APP' | 'WALLET'; name: string | null; bank: string | null; account: string | null; coin: string | null; network: string | null }
  reason: string | null
  requestedAt: string
  fundedAt: string | null
  dueBy: string | null
  doneAt: string | null
  sentBy: string | null
  sendNote: string | null
  events?: { kind: string; detail: Record<string, unknown> | null; by: string; at: string }[]
}

const STATE: Record<RefundRow['status'], [string, 'good' | 'warn' | 'bad' | undefined]> = {
  AWAITING_FUNDS: ['Waiting for the business', undefined],
  SENDING: ['To send', 'warn'],
  REFUNDED: ['Refunded', 'good'],
  CANCELLED: ['Cancelled', undefined],
}
const FUNDED_BY: Record<RefundRow['funding'], string> = { WALLET: 'Business wallet', APP: 'Money Moves app', BANK: 'Bank transfer', HELD: 'Money we held' }

/** What the customer gets, in what they paid with. */
export const refundAmount = (r: RefundRow) => (r.currency === 'USD' ? `${r.amountUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.to.coin ?? 'USDC'}` : naira(r.amountNgn))

/** Where it goes, in a few words. */
export function refundTo(r: RefundRow) {
  if (r.to.kind === 'APP') return `${r.to.account ?? 'Their account'} on Money Moves`
  if (r.to.kind === 'WALLET') return `${r.to.coin ?? 'USDC'} on ${r.to.network ?? '?'}`
  return [r.to.bank, r.to.account].filter(Boolean).join(' · ') || 'Their bank account'
}

const columns: Column<RefundRow>[] = [
  { key: 'business', head: 'Business', width: 'minmax(0,1.2fr)', cell: (r) => <span className="font-medium">{r.business ?? '—'}</span>, phone: 'title' },
  {
    key: 'ref',
    head: 'Refund',
    width: '170px',
    cell: (r) => (
      <span className="inline-flex items-center gap-2">
        <Ref>{r.ref}</Ref>
        {r.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
      </span>
    ),
  },
  { key: 'to', head: 'Goes back to', cell: (r) => <span style={{ color: C.muted }}>{refundTo(r)}</span>, phone: 'sub' },
  { key: 'state', head: 'State', width: '150px', cell: (r) => <Tag tone={STATE[r.status][1]}>{STATE[r.status][0]}</Tag> },
  { key: 'amount', head: 'Amount', width: '130px', align: 'right', cell: (r) => <span className="tabular-nums font-medium">{refundAmount(r)}</span>, phone: 'figure' },
  { key: 'when', head: 'Funded', width: '110px', align: 'right', cell: (r) => (r.fundedAt ? <When at={r.fundedAt} /> : <span style={{ color: C.dim }}>—</span>), phone: 'meta' },
]

const VIEWS = [
  ['send', 'To send'],
  ['waiting', 'Waiting for money'],
  ['done', 'Refunded'],
  ['all', 'All'],
] as const

export function Refunds({ initial }: { initial?: string }) {
  const { open } = useRecord()
  const [view, setView] = useState<string>(VIEWS.some(([v]) => v === initial) ? initial! : 'send')
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useLoad<Paged & { refunds: RefundRow[] }>(`/refunds?view=${view}&mode=${view === 'send' ? 'live' : mode}&page=${page}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={(v) => { setView(v); setPage(1) }} items={VIEWS} />
        {view !== 'send' && <Segmented value={mode} onChange={(v) => { setMode(v); setPage(1) }} items={[['live', 'Live'], ['test', 'Test']]} />}
      </div>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.refunds ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            flag={(r) => (r.status === 'SENDING' && r.mode === 'LIVE' ? 'warn' : undefined)}
            onRow={(r) => open('refund', r.id, { from: 'Refunds' })}
            empty={view === 'send' ? 'Nothing to send. Every funded refund has gone out.' : 'None of those.'}
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="refund" onPage={setPage} />}
      </Panel>
    </div>
  )
}

const EVENT: Record<string, string> = {
  requested: 'Refund asked for',
  account_opened: 'One-time account opened for the business',
  account_failed: "Couldn't open an account",
  funded: "The business's money arrived",
  lapsed: 'The account closed with nothing in it - lapsed',
  cancelled: 'Cancelled by the business',
  refunded: 'Sent to the customer',
}

export function RefundPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad<{ refund: RefundRow }>(`/refunds/${id}`)
  const { open } = useRecord()
  const [marking, setMarking] = useState(false)
  if (loading && !data) return <PageLoading />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />
  const r = data.refund
  const here = `Refund ${r.ref}`
  const toSend = r.status === 'SENDING' && r.mode === 'LIVE'

  return (
    <div>
      <PageHead
        title={
          <>
            {refundAmount(r)} <span style={{ color: C.muted }}>back to {r.payment?.customerName ?? r.payment?.customerEmail ?? 'the customer'}</span>
          </>
        }
        meta={[
          <Tag tone={STATE[r.status][1]}>{STATE[r.status][0]}</Tag>,
          r.mode === 'TEST' && <Tag tone="warn">Test - nothing real moves</Tag>,
          <>
            Asked <When at={r.requestedAt} />
          </>,
          r.dueBy && r.status === 'SENDING' && (
            <>
              Due by <When at={r.dueBy} full />
            </>
          ),
        ]}
        actions={toSend && <Button tone="primary" onClick={() => setMarking((v) => !v)}>Mark as sent</Button>}
      >
        <IdLine
          items={[
            ['Reference', <Copy text={r.ref} />],
            !!r.business && ['Business', <LinkText onClick={() => open('business', r.businessId, { from: here })}>{r.business}</LinkText>],
            !!r.payment && ['Payment', <LinkText onClick={() => open('payment', r.payment!.id, { from: here })}>{r.payment.ref}</LinkText>],
          ]}
        />
      </PageHead>

      {toSend && !marking && (
        <div className="mb-5">
          <Notice tone="warn" title="Ours to send">
            The business's money is in. Pay {refundAmount(r)} to {refundTo(r)} by hand, then mark it sent - the customer is emailed and the business sees it refunded.
          </Notice>
        </div>
      )}
      {marking && <MarkSent r={r} onClose={() => setMarking(false)} onDone={() => void reload()} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <Panel title="Send it to" sub="Back the way the customer paid.">
          <Facts
            rows={[
              ['How', r.to.kind === 'APP' ? 'Money Moves account' : r.to.kind === 'WALLET' ? 'Crypto wallet' : 'Bank account'],
              !!r.to.name && ['Name', r.to.name],
              !!r.to.bank && ['Bank', r.to.bank],
              !!r.to.account && [r.to.kind === 'APP' ? 'Username' : r.to.kind === 'WALLET' ? 'Address' : 'Account', <Copy text={r.to.account} />],
              r.to.kind === 'WALLET' && ['Coin', `${r.to.coin ?? 'USDC'} on ${r.to.network ?? '?'}`],
              ['Amount', refundAmount(r)],
              !!r.reason && ['Why', r.reason],
            ]}
          />
          <div className="mt-5">
            <Timeline
              items={(r.events ?? []).map((e, i) => ({
                id: `${i}`,
                title: EVENT[e.kind] ?? e.kind,
                detail: e.kind === 'refunded' && typeof e.detail?.note === 'string' ? e.detail.note : undefined,
                by: e.by === 'system' || e.by.length > 30 ? undefined : e.by,
                at: e.at,
                tone: e.kind === 'refunded' ? 'good' : e.kind === 'lapsed' || e.kind === 'account_failed' ? 'bad' : undefined,
              }))}
            />
          </div>
        </Panel>
        <aside className="space-y-5 min-w-0">
          <Panel title="The business's side">
            <Facts
              rows={[
                ['Funded by', FUNDED_BY[r.funding]],
                r.funding !== 'HELD' && ['It sent', r.funding === 'BANK' ? naira(r.fundNgn) : `$${r.fundUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`],
                r.feeBackNgn > 0 && ['Our fee, given back', naira(r.feeBackNgn)],
                !!r.fundAccount && ['Into', `${r.fundAccount.bank ?? ''} ${r.fundAccount.number}`],
                ['Funded', r.fundedAt ? <When at={r.fundedAt} full /> : 'Not yet'],
                !!r.doneAt && ['Sent', <When at={r.doneAt} full />],
                !!r.sentBy && ['By', r.sentBy],
                !!r.sendNote && ['Reference', r.sendNote],
              ]}
            />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function MarkSent({ r, onClose, onDone }: { r: RefundRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  return (
    <div className="mb-5">
      <ActionPanel title="Mark it sent" sub={`For ${refundAmount(r)} you've paid to ${refundTo(r)} yourself. Say how, so the next person can trace it.`}>
        <Field label="Transfer reference">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Session ID, transaction hash or transfer ID" maxLength={280} />
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
              if (await run(() => biz(`/refunds/${r.id}/sent`, { method: 'POST', body: { password, note: note.trim() || undefined } }), 'Marked sent - the customer is emailed.')) {
                onClose()
                onDone()
              }
            }}
          >
            {busy ? 'Saving…' : 'Mark sent'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}
