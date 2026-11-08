import { useMemo, useState } from 'react'
import { ListSkeleton } from '@/components/table'
import { AlertTriangle, Check, Copy, Download, ExternalLink, Filter, Landmark, RotateCcw, ShieldAlert, UserX } from '@/components/icons'
import { CUSTOMERS, DESTINATIONS, METHODS, PAYMENTS, nairaFee, type Customer, type Method, type Payment } from '@/data/mock'
import {
  Badge,
  Button,
  DetailRow,
  Drawer,
  Empty,
  Field,
  Input,
  Modal,
  PageHeader,
  Pager,
  SearchBox,
  Segmented,
  Select,
  Status,
  Table,
  Tabs,
  cx,
} from '@/components/ui'
import { AppIcon, Avatar, PayIcon, TokenIcon } from '@/components/brand'
import { ago, amount, copy, date, dateTime, ngn, short, usd } from '@/lib/format'
import { settleTarget } from '@/pages/balances'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { Timeline, type Step } from '@/components/Timeline'
import { RefundModal, RefundPanel, statusWithRefund, toLabel, useBusinessRefunds } from '@/components/Refund'
import { refundBy, refundStage } from '@/state/refunds'
import { DISPUTE_STATUS, REASONS, isOpen, useBusinessDisputes } from '@/state/disputes'
import { Link, useSearchParams } from 'react-router-dom'
import { LIVE } from '@/lib/api'
import { usePayments } from '@/state/live'
import { downloadCsv, today } from '@/lib/csv'
import { SUPPORT_EMAIL } from '@/lib/links'
import { downloadTablePdf } from '@/lib/export'
import { bareTx, explorerTxUrl } from '@/lib/explorer'

/* ─── Payments ─────────────────────────────────────────────────────── */

export function Payments() {
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState<'all' | 'successful' | 'pending' | 'failed'>('all')
  const [method, setMethod] = useState<'all' | Method>('all')
  const [open, setOpen] = useState<Payment | null>(null)
  const [refund, setRefund] = useState<Payment | null>(null)
  const { test } = useTestMode()
  const [refunds] = useBusinessRefunds()
  const { payments, loading } = usePayments()
  // The open payment as it is now - the list is read again every few seconds, so a settlement landing shows without reopening.
  const shown = open ? (payments.find((p) => p.id === open.id) ?? open) : null

  const rows = useMemo(
    () =>
      payments.filter((p) => {
        if (method !== 'all' && p.method !== method) return false
        if (status === 'successful' && p.status !== 'successful') return false
        if (status === 'pending' && !['pending', 'confirming'].includes(p.status)) return false
        if (status === 'failed' && !['failed', 'underpaid'].includes(p.status)) return false
        const s = q.toLowerCase()
        return !s || p.ref.toLowerCase().includes(s) || p.customer.email.includes(s) || p.customer.name.toLowerCase().includes(s)
      }),
    [q, status, method, payments],
  )

  return (
    <>
      <PageHeader
        title="Payments"
        sub="Every payment your customers have made, however they paid."
        actions={
          <Button
            icon={<Download className="size-4" />}
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `payments-${today()}.csv`,
                ['Reference', 'Date', 'Customer', 'Email', 'Amount', 'Currency', 'In dollars', 'Paid with', 'Channel', 'Status'],
                rows.map((p) => [p.ref, p.createdAt, p.customer.name, p.customer.email, p.amount, p.asset, p.usd, METHODS[p.method].short, p.channel, p.status]),
              )
            }
          >
            Download CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox placeholder="Search by reference, name or email" value={q} onChange={setQ} className="w-full max-w-[340px]" />
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { id: 'all', label: 'All' },
            { id: 'successful', label: 'Successful' },
            { id: 'pending', label: 'Pending' },
            { id: 'failed', label: 'Failed' },
          ]}
        />
        <div className="w-[190px]">
          <Select value={method} onChange={(e) => setMethod(e.target.value as 'all' | Method)} className="h-10 text-[13px]">
            <option value="all">Any payment method</option>
            {(Object.keys(METHODS) as Method[]).map((m) => (
              <option key={m} value={m}>
                {METHODS[m].short}
              </option>
            ))}
          </Select>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-dim">
          <Filter className="size-3.5" /> {rows.length} shown
        </span>
      </div>

      <Table
        rowKey={(r) => r.id}
        rows={rows}
        onRow={setOpen}
        mobile={(p) => (
          <div className="flex items-center gap-3 px-4 py-3">
            <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-fg">{p.customer.name}</div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-dim [&>span:first-child]:text-[12px]">
                <Status value={statusWithRefund(p, refunds?.[p.id])} />
                <span className="truncate">· {ago(p.createdAt)}</span>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="tabular text-[14px] font-medium text-fg">{usd(p.usd)}</div>
              <div className="tabular text-[12px] text-dim">{p.asset === 'NGN' ? ngn(p.amount) : amount(p.amount, p.asset)}</div>
            </div>
          </div>
        )}
        empty={
          LIVE && loading ? (
            <ListSkeleton />
          ) : LIVE && payments.length === 0 ? (
            <Empty
              title="No payments yet."
              sub={test ? 'Create a payment link, open it, and pay it with the test buttons. It lands here.' : 'Share a payment link. Every payment lands here the moment it arrives.'}
            />
          ) : (
            <Empty title="No payments match." sub="Try a different search or clear the filters." />
          )
        }
        columns={[
          {
            key: 'c',
            header: 'Customer',
            render: (p) => (
              <div className="flex items-center gap-3">
                <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={30} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.customer.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-dim">{p.ref}</div>
                </div>
              </div>
            ),
          },
          {
            key: 'a',
            header: 'Amount',
            render: (p) => (
              <div>
                <div className="tabular font-medium">{usd(p.usd)}</div>
                <div className="tabular text-[12px] text-dim">{p.asset === 'NGN' ? ngn(p.amount) : amount(p.amount, p.asset)}</div>
              </div>
            ),
          },
          {
            key: 'm',
            header: 'Paid with',
            render: (p) => (
              <div className="text-muted">
                {METHODS[p.method].short}
                {p.method === 'crypto' && p.chain && <div className="text-[12px] text-dim">{p.chain}</div>}
              </div>
            ),
          },
          { key: 'ch', header: 'Channel', render: (p) => <span className="text-muted">{p.channel}</span> },
          { key: 's', header: 'Status', render: (p) => <Status value={statusWithRefund(p, refunds?.[p.id])} /> },
          { key: 'd', header: 'Date', align: 'right', render: (p) => <span className="text-muted">{ago(p.createdAt)}</span> },
        ]}
      />
      <Pager total={LIVE ? rows.length : rows.length + 212} />

      <Drawer open={!!shown} onClose={() => setOpen(null)} title={shown ? `Payment ${shown.ref}` : ''}>
        {shown && <PaymentDetail p={shown} test={test} onRefund={() => setRefund(shown)} />}
      </Drawer>

      <RefundModal payment={refund} onClose={() => setRefund(null)} />
    </>
  )
}

/* ─── One payment, in full ─────────────────────────────────────────── */

const at = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function Copyable({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        copy(value)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="inline-flex items-center gap-1 rounded-md px-1 text-dim hover:text-fg"
      aria-label={`Copy ${label}`}
    >
      {done ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** A transaction: opens on its explorer where we know one, else shown to copy. */
function TxLink({ network, hash }: { network?: string; hash: string }) {
  const url = explorerTxUrl(network, hash)
  if (url)
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-accent">
        {short(bareTx(hash), 8, 6)} <ExternalLink className="size-3" />
      </a>
    )
  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-fg">
      <span className="truncate">{hash ? short(bareTx(hash), 8, 6) : 'Not recorded'}</span>
      {hash && <Copyable value={bareTx(hash)} label="transaction" />}
    </span>
  )
}

/**
 * Where the money came from, in the terms of how it was sent: the sender's
 * bank account for a transfer, their username for the app, the wallet for
 * crypto. It's what a business needs to match a payment to a person - and to
 * know where a refund goes.
 */
function PaidFrom({ p }: { p: Payment }) {
  if (p.method === 'naira' && !p.payer) return null
  return (
    <section className="mt-6 overflow-hidden rounded-[10px] border border-line">
      <div className="flex items-center justify-between bg-[#FAFAF8] px-4 py-2.5 text-[12px] font-medium text-dim">
        <span>Paid from</span>
        <span>{p.method === 'naira' ? 'Bank transfer' : p.method === 'app' ? 'Money Moves app' : p.paidWith ? `${p.paidWith.coin} on ${p.paidWith.network}` : `${p.asset} on ${p.chain}`}</span>
      </div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {p.method === 'naira' && p.payer ? (
          <>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] border border-line bg-card text-fg">
              <Landmark className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-fg">{p.payer.name}</div>
              <div className="text-[12.5px] text-muted">
                {p.payer.bank} · <span className="font-mono">••{p.payer.account.slice(-4)}</span>
              </div>
            </div>
          </>
        ) : p.method === 'app' ? (
          <>
            <AppIcon size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-fg">@{p.customer.email.split('@')[0]}</div>
              <div className="text-[12.5px] text-muted">{p.customer.name} · Money Moves account</div>
            </div>
          </>
        ) : (
          <>
            <TokenIcon asset={p.paidWith?.coin ?? p.asset} chain={p.paidWith ? undefined : p.chain} size={36} />
            <div className="min-w-0 flex-1">
              {/* Through NEAR Intents the sender we see is the swap, not the customer: their wallet isn't shown. */}
              {!p.paidWith && p.from && (
                <div className="flex items-center gap-1 font-mono text-[13px] text-fg">
                  {p.from}
                  <Copyable value={p.from} label="address" />
                </div>
              )}
              <div className={p.paidWith || !p.from ? 'text-[14px] font-semibold text-fg' : 'text-[12.5px] text-muted'}>
                {p.paidWith ? `Customer's wallet on ${p.paidWith.network}` : `Sending wallet on ${p.chain}`}
              </div>
              {p.paidWith && <div className="text-[12.5px] text-muted">Changed to USDC on the way</div>}
            </div>
          </>
        )}
      </div>
      {(p.method === 'naira' && p.payer) || p.method === 'crypto' ? (
        <div className="flex items-center justify-between gap-3 border-t border-soft px-4 py-2.5 text-[12.5px]">
          <span className="shrink-0 text-dim">{p.method === 'naira' ? 'Transfer reference' : 'Transaction'}</span>
          {p.method === 'naira' && p.payer ? (
            <span className="flex min-w-0 items-center gap-1 font-mono text-fg">
              <span className="truncate">{p.payer.session}</span>
              <Copyable value={p.payer.session} label="reference" />
            </span>
          ) : (
            <TxLink network={p.paidWith ? p.paidWith.network : p.chain} hash={p.paidWith ? (p.paidWith.tx ?? '') : p.txHash} />
          )}
        </div>
      ) : null}
    </section>
  )
}


/** What happened to a payment, in order - and, when it stopped, where and why. */
function steps(p: Payment, settlesTo: string): Step[] {
  const sent =
    p.method === 'naira'
      ? { title: 'Transfer received', detail: p.payer ? `${ngn(p.received ?? p.amount)} from ${p.payer.name} · ${p.payer.bank}` : undefined }
      : p.method === 'app'
        ? { title: 'Approved in the app', detail: `@${p.customer.email.split('@')[0]}` }
        : { title: `Payment seen on ${p.chain}`, detail: `${amount(p.received ?? p.amount, p.asset)} from ${p.from}` }
  // Live payments carry their real times; the samples are spread around when they were made.
  const live = LIVE || p.linkId !== undefined
  const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : undefined)
  const tOpened = live ? clock(p.createdAt) : at(p.createdAt, -3)
  const tSent = live ? clock(p.paidAt) : at(p.createdAt, 0)
  const delivered = !p.settlement || p.settlement.status === 'settled'
  const tSettled = live ? clock(p.settlement?.settledAt) : at(p.createdAt, 1)
  const opened: Step = { title: 'Checkout opened', detail: `Through ${p.channel.toLowerCase()}`, time: tOpened, state: 'done' }
  const settle: Omit<Step, 'state'> = { title: delivered ? 'Settled' : 'On its way', detail: settlesTo }

  switch (p.status) {
    case 'successful':
      return [
        opened,
        { ...sent, time: tSent, state: 'done' },
        { title: 'Confirmed', detail: p.method === 'crypto' ? 'Final on the network' : p.method === 'naira' ? 'Matched to this checkout' : 'Instant', time: live ? tSent : at(p.createdAt, 1), state: 'done' },
        { ...settle, time: delivered ? tSettled : undefined, state: delivered ? 'done' : 'now' },
      ]
    case 'confirming':
      return [
        opened,
        { ...sent, time: at(p.createdAt, 0), state: 'done' },
        { title: p.method === 'crypto' ? `Confirming on ${p.chain}` : 'Confirming', detail: 'Usually a few seconds', state: 'now' },
        { ...settle, state: 'todo' },
      ]
    case 'pending':
      return [opened, { title: 'Waiting for the customer to pay', detail: 'The checkout is open for 30 minutes', state: 'now' }, { ...settle, state: 'todo' }]
    case 'underpaid':
      return [
        opened,
        { ...sent, time: tSent, state: 'done' },
        { title: 'Less than the amount due', detail: 'Accept what arrived, or refund it', state: 'wait' },
        { ...settle, state: 'todo' },
      ]
    case 'failed':
      return p.method === 'naira' && p.payer
        ? [opened, { ...sent, time: at(p.createdAt, 0), state: 'done' }, { title: 'Reversed by the sending bank', detail: 'The money went back to the customer. Nothing settled', time: at(p.createdAt, 4), state: 'failed' }]
        : [opened, { title: 'Expired', detail: 'Nothing arrived within 30 minutes. Nothing settled', time: at(p.createdAt, 27), state: 'failed' }]
  }
}

export function PaymentDetail({ p, test, onRefund }: { p: Payment; test: boolean; onRefund: () => void }) {
  const [refunds] = useBusinessRefunds()
  const r = refunds?.[p.id]
  const [disputes] = useBusinessDisputes()
  const dispute = disputes?.find((d) => d.payment.id === p.id)
  const failed = p.status === 'failed'
  const dest = p.channel === 'API' ? 'onchain' : p.destination
  // Live: where it really went, and whether it's there yet.
  const st = p.settlement
  const place = st ? (dest === 'bank' ? `${st.target.split(' · ')[0]} ••${(st.target.split(' · ')[1] ?? '').slice(-4)}` : st.target) : null
  const settlesTo = st
    ? `${st.status === 'settled' ? (dest === 'bank' ? 'Paid' : 'Sent') : 'On its way'} to ${place}`
    : LIVE
      ? `To your ${DESTINATIONS[dest].label.toLowerCase()}, the moment it's paid`
      : dest === 'bank'
      ? `${p.method === 'naira' ? 'Paid' : 'Converted to naira and paid'} to ${settleTarget('bank')}`
      : dest === 'wallet'
        ? `Sent to ${settleTarget('wallet')} on Money Moves`
        : `Sent to your business wallet (${settleTarget('onchain')})`
  const short = p.received !== undefined ? (p.method === 'naira' ? ngn(p.amount - p.received) : amount(p.amount - p.received, p.asset)) : ''

  return (
    <>
      <div className="flex items-center gap-3.5">
        <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={44} />
        <div>
          <div className="tabular text-[26px] font-semibold display">{usd(p.usd)}</div>
          <div className="tabular text-[13px] text-muted">{p.asset === 'NGN' ? ngn(p.amount) : amount(p.amount, p.asset)}</div>
        </div>
        <div className="ml-auto">
          <Status value={statusWithRefund(p, r)} />
        </div>
      </div>

      {failed && (
        <div className="mt-5 flex gap-2.5 rounded-[10px] border border-[#EFC4C0] bg-[#FBEAE8] p-3.5 text-[13px] leading-relaxed text-[#7D1F19]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {p.method === 'naira' && p.payer
              ? "The sender's bank reversed this transfer, so the money went back to them. Nothing was settled and no fee was charged."
              : 'The checkout expired before anything arrived. Nothing was settled and no fee was charged.'}
          </span>
        </div>
      )}
      {p.status === 'underpaid' && !r && (
        <div className="mt-5 rounded-[10px] border border-[#EBD3A6] bg-[#FDF6E7] p-3.5 text-[13px] leading-relaxed text-[#6E440A]">
          <div className="font-semibold text-[#5A3808]">{short} short</div>
          {LIVE ? (
            <>
              The customer sent less than was due, so it hasn't settled. Write to{' '}
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Short payment ${p.ref}`)}`} className="font-medium underline underline-offset-2">
                {SUPPORT_EMAIL}
              </a>{' '}
              to settle what arrived or send it back.
            </>
          ) : (
            <>
              The customer sent less than was due. Accept what arrived and it settles now, or refund it to them.
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" disabled={test}>
                  Accept {p.method === 'naira' ? ngn(p.received ?? 0) : amount(p.received ?? 0, p.asset)}
                </Button>
                <Button size="sm" onClick={onRefund}>
                  Refund
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {r && <RefundPanel r={r} />}
      {dispute && (
        <Link
          to={`/transactions/disputes?d=${dispute.id}`}
          className={cx(
            'mt-5 flex items-center gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] transition',
            isOpen(dispute) ? 'border-[#EBD3A6] bg-[#FDF6E7] text-[#6E440A] hover:border-[#D9B877]' : 'border-line bg-[#FAFAF8] text-muted hover:border-[#D3D0C7]',
          )}
        >
          <ShieldAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{isOpen(dispute) ? 'Disputed' : `Dispute ${DISPUTE_STATUS[dispute.status].toLowerCase()}`}</span> · {REASONS[dispute.reason]}
            {dispute.status === 'needs_reply' && <> · reply by {date(dispute.replyBy)}</>}
          </span>
          <span className="shrink-0 font-medium">View</span>
        </Link>
      )}

      <PaidFrom p={p} />

      <div className="mt-6">
        <DetailRow label="Reference">
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-[13px]">{p.ref}</span>
            <Copyable value={p.ref} label="reference" />
          </span>
        </DetailRow>
        <DetailRow label="Customer">
          {p.customer.name}
          <div className="text-[12px] text-dim">{p.customer.email}</div>
        </DetailRow>
        <DetailRow label="Paid with">{METHODS[p.method].short}</DetailRow>
        <DetailRow label="Channel">{p.channel}</DetailRow>
        <DetailRow label="Fee">{failed ? 'None' : p.method === 'naira' ? ngn(p.live?.feeNgn ?? nairaFee(p.amount)) : p.fee === 0 ? <span className="text-good">Free</span> : usd(p.fee)}</DetailRow>
        <DetailRow label="You receive">{failed ? '—' : st?.amountNgn != null ? ngn(st.amountNgn) : p.method === 'naira' ? ngn(p.amount - nairaFee(p.amount)) : usd(p.usd - p.fee)}</DetailRow>
        <DetailRow label="Settles to">
          {failed ? 'Nothing to settle' : (place ?? DESTINATIONS[dest].label)}
          {st && <div className={cx('text-[12px]', st.status === 'settled' ? 'text-good' : 'text-amber')}>{st.status === 'settled' ? 'Delivered' : 'On its way'}</div>}
        </DetailRow>
        <DetailRow label="Date">{dateTime(p.createdAt)}</DetailRow>
      </div>

      {!failed && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button icon={<RotateCcw className="size-4" />} onClick={onRefund} disabled={p.status !== 'successful' || !!r}>
            {r ? 'Refund requested' : 'Refund'}
          </Button>
          {!LIVE && (
            <Button icon={<Download className="size-4" />} disabled={p.status !== 'successful'}>
              Receipt
            </Button>
          )}
        </div>
      )}
      {!LIVE && test && !failed && (
        <div className="mt-3">
          <TestModeHint>Test mode: a refund here is a test. Nothing real moves.</TestModeHint>
        </div>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <div className="mb-4 text-[13px] font-semibold text-fg">Timeline</div>
        <Timeline items={steps(p, settlesTo)} />
      </div>
    </>
  )
}

/* ─── Refunds ──────────────────────────────────────────────────────── */

export function Refunds() {
  const { test } = useTestMode()
  const [refunds] = useBusinessRefunds()
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Payment | null>(null)
  const rows = Object.values(refunds ?? {}).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  const money = (r: (typeof rows)[number], n: number) => (r.currency === 'NGN' ? ngn(n) : usd(n))

  return (
    <>
      <PageHeader
        title="Refunds"
        sub="Money going back to customers. Refunds are free. We return the fee we charged on the payment."
        actions={
          <>
            {!LIVE && <Button icon={<Download className="size-4" />}>Download</Button>}
            <Button variant="primary" icon={<RotateCcw className="size-4" />} onClick={() => setCreating(true)}>
              {LIVE ? 'Refund a payment' : 'Create refund'}
            </Button>
          </>
        }
      />
      <Table
        rowKey={(r) => r.paymentId}
        rows={rows}
        onRow={(r) => setOpen(r.payment)}
        empty={
          <Empty
            icon={<RotateCcw className="size-6" />}
            title="No refunds yet."
            sub={
              test
                ? 'Refund a test payment from its details, or start one here. Test refunds are simulated and finish by themselves.'
                : 'Refund a payment from its details, or start one here. It reaches the customer within 24 to 48 hours.'
            }
          />
        }
        columns={[
          {
            key: 'c',
            header: 'Customer',
            render: (r) => (
              <div className="flex items-center gap-3">
                <PayIcon method={r.method} asset={r.payment.asset} chain={r.payment.chain} size={28} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.customer.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-dim">{r.ref}</div>
                </div>
              </div>
            ),
          },
          { key: 'a', header: 'Amount', render: (r) => <span className="tabular font-medium">{money(r, r.amount)}</span> },
          { key: 't', header: 'Back to', render: (r) => <span className="text-muted">{toLabel(r.to)}</span> },
          {
            key: 's',
            header: 'Status',
            render: (r) => {
              const stage = refundStage(r)
              return (
                <div>
                  <Status value={stage === 'refunded' ? 'refunded' : stage === 'funding' ? 'pending' : 'refunding'} />
                  {stage !== 'refunded' && <div className="text-[12px] text-dim">{stage === 'funding' ? 'Waiting for your money' : `By ${date(refundBy(r))}`}</div>}
                </div>
              )
            },
          },
          { key: 'd', header: 'Requested', align: 'right', render: (r) => <span className="text-muted">{ago(r.requestedAt)}</span> },
        ]}
      />

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `Payment ${open.ref}` : ''}>
        {open && <PaymentDetail p={open} test={test} onRefund={() => undefined} />}
      </Drawer>
      <RefundModal payment={null} pick={creating} onClose={() => setCreating(false)} />
    </>
  )
}

/* ─── Customers ────────────────────────────────────────────────────── */

/** Live: everyone who has paid, from the payments themselves - one row per email (or name, when there's no email). */
function customersFrom(payments: Payment[]): Customer[] {
  const by = new Map<string, Customer>()
  for (const p of payments) {
    if (p.status !== 'successful' && p.status !== 'underpaid') continue
    const key = (p.customer.email || p.customer.name).toLowerCase()
    if (!key) continue
    const c = by.get(key)
    if (c) {
      c.payments += 1
      c.spentUsd = Math.round((c.spentUsd + p.usd) * 100) / 100
      if (p.createdAt < c.createdAt) c.createdAt = p.createdAt
    } else by.set(key, { id: key, name: p.customer.name, email: p.customer.email, payments: 1, spentUsd: p.usd, createdAt: p.createdAt })
  }
  return [...by.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function Customers() {
  const [tab, setTab] = useState<'all' | 'blocked'>('all')
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [open, setOpen] = useState<Customer | null>(null)
  const [adding, setAdding] = useState(false)
  const { test } = useTestMode()
  const { payments, loading } = usePayments()
  const all = useMemo(() => (LIVE ? customersFrom(payments) : CUSTOMERS), [payments])
  const rows = all.filter(
    (c) => (tab === 'blocked' ? c.blocked : !c.blocked) && (c.name.toLowerCase().includes(q.toLowerCase()) || c.email.includes(q.toLowerCase())),
  )
  const theirs = (c: Customer) => (LIVE ? payments : PAYMENTS).filter((p) => (LIVE ? (p.customer.email || p.customer.name).toLowerCase() === c.id : p.customer.email === c.email))

  return (
    <>
      <PageHeader
        title="Customers"
        sub="Everyone who has paid you, and what they have spent."
        actions={
          <>
            <Button
              icon={<Download className="size-4" />}
              disabled={rows.length === 0}
              onClick={() => downloadCsv(`customers-${today()}.csv`, ['Name', 'Email', 'Payments', 'Spent (USD)', 'First paid'], rows.map((c) => [c.name, c.email, c.payments, c.spentUsd, c.createdAt]))}
            >
              CSV
            </Button>
            <Button
              icon={<Download className="size-4" />}
              disabled={rows.length === 0}
              onClick={() =>
                downloadTablePdf({
                  title: "Customers",
                  sub: `${rows.length} customer${rows.length === 1 ? "" : "s"}, USD ${rows.reduce((t, c) => t + c.spentUsd, 0).toFixed(2)} spent`,
                  head: ["Name", "Email", "Payments", "Spent (USD)", "First paid"],
                  weights: [2.2, 3, 1, 1.2, 1.6],
                  rows: rows.map((c) => [c.name, c.email, c.payments, c.spentUsd.toFixed(2), new Date(c.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })]),
                  filename: `customers-${today()}.pdf`,
                })
              }
            >
              PDF
            </Button>
            {!LIVE && <Button variant="primary" onClick={() => setAdding(true)}>New customer</Button>}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All customers', badge: <Badge>{all.filter((c) => !c.blocked).length}</Badge> },
          ...(LIVE ? [] : [{ id: 'blocked' as const, label: 'Blocked' }]),
        ]}
      />
      <SearchBox placeholder="Search customer names, emails or phone numbers" value={q} onChange={setQ} className="mb-4 max-w-[420px]" />
      <Table
        rowKey={(r) => r.id}
        rows={rows}
        onRow={setOpen}
        empty={
          LIVE && loading ? (
            <ListSkeleton />
          ) : LIVE && all.length === 0 ? (
            <Empty
              icon={<UserX className="size-6" />}
              title="No customers yet."
              sub={test ? 'Pay a test payment link and its customer shows here.' : 'Everyone who pays you shows here, with what they have spent.'}
            />
          ) : (
            <Empty
              icon={<UserX className="size-6" />}
              title={tab === 'blocked' ? 'Nobody is blocked.' : 'No customers match.'}
              sub={tab === 'blocked' ? 'Block a customer to stop them paying you through any link, invoice or checkout.' : undefined}
            />
          )
        }
        columns={[
          {
            key: 'n',
            header: 'Name',
            render: (c) => (
              <div className="flex items-center gap-3">
                <Avatar name={c.name} size={30} />
                <span className="font-medium">{c.name}</span>
              </div>
            ),
          },
          { key: 'e', header: 'Email', render: (c) => <span className="text-muted">{c.email}</span> },
          { key: 'p', header: 'Payments', render: (c) => <span className="tabular">{c.payments}</span> },
          { key: 's', header: 'Spent', render: (c) => <span className="tabular font-medium">{usd(c.spentUsd)}</span> },
          { key: 'd', header: LIVE ? 'First paid' : 'Added', align: 'right', render: (c) => <span className="text-muted">{ago(c.createdAt)}</span> },
        ]}
      />
      <Pager total={LIVE ? rows.length : rows.length + 32} />

      <Drawer open={!!open} onClose={() => setOpen(null)} title="Customer">
        {open && (
          <>
            <div className="flex items-center gap-3.5">
              <Avatar name={open.name} size={48} />
              <div>
                <div className="text-[17px] font-semibold">{open.name}</div>
                <div className="text-[13px] text-muted">{open.email}</div>
              </div>
            </div>
            <div className="mt-6">
              <DetailRow label="Total spent">{usd(open.spentUsd)}</DetailRow>
              <DetailRow label="Payments">{open.payments}</DetailRow>
              {open.phone && <DetailRow label="Phone">{open.phone}</DetailRow>}
              <DetailRow label="Customer since">{date(open.createdAt)}</DetailRow>
            </div>
            <div className="mt-6 mb-3 text-[12.5px] font-medium text-dim">Recent payments</div>
            {theirs(open).slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-b border-soft py-3 last:border-0">
                <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={26} />
                <span className="flex-1 font-mono text-[12.5px] text-muted">{p.ref}</span>
                <span className="tabular text-[13.5px]">{usd(p.usd)}</span>
                <Status value={p.status} />
              </div>
            ))}
            {!LIVE && (
              <Button variant="danger" className="mt-6" icon={<UserX className="size-4" />}>
                {open.blocked ? 'Unblock customer' : 'Block customer'}
              </Button>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="New customer"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setAdding(false)}>Add customer</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Full name"><Input placeholder="Ada Okafor" /></Field>
          <Field label="Email"><Input type="email" placeholder="ada@example.com" /></Field>
          <Field label="Phone" optional><Input placeholder="+234" /></Field>
        </div>
      </Modal>
    </>
  )
}
