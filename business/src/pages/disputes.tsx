/**
 * Disputes: the open ones first, each with its deadline, and inside each the
 * whole conversation - the customer or bank, the business, and us - with a
 * reply box and a refund button where it's still the business's turn.
 */
import { useRef, useState } from 'react'
import { ApiError, LIVE, api, uploadFile } from '@/lib/api'
import { reload } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { useCan } from '@/state/roles'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Landmark, Paperclip, RotateCcw, Send, ShieldAlert, X } from '@/components/icons'
import { Badge, Button, Drawer, Empty, Modal, PageHeader, Segmented, Status, Table, Textarea, cx } from '@/components/ui'
import { PayIcon } from '@/components/brand'
import { Timeline, type Step } from '@/components/Timeline'
import { RefundModal, useBusinessRefunds } from '@/components/Refund'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { METHODS, type Payment } from '@/data/mock'
import { ago, date, dateTime, ngn, usd } from '@/lib/format'
import { PaymentDetail } from '@/pages/transactions'
import { DISPUTE_STATUS, REASONS, REPLY_DAYS, disputesPath, isOpen, useBusinessDisputes, type Dispute } from '@/state/disputes'

const paid = (p: Payment) => (p.method === 'naira' ? ngn(p.amount) : usd(p.usd))
const firstName = (name: string) => name.split(' ')[0]!
const bankOf = (d: Dispute) => d.payment.payer?.bank ?? "The sender's bank"

/** "in 2 days", "in 5 hours", "overdue" */
function until(iso: string) {
  const hours = (new Date(iso).getTime() - Date.now()) / 3_600_000
  if (hours <= 0) return 'overdue'
  if (hours < 24) return `in ${Math.ceil(hours)} hour${Math.ceil(hours) === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `in ${days} day${days === 1 ? '' : 's'}`
}
const soon = (iso: string) => new Date(iso).getTime() - Date.now() < 24 * 3_600_000

export function Disputes() {
  const [stored, setDisputes] = useBusinessDisputes()
  const list = stored ?? []
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'open' | 'closed' | 'all'>('open')
  const [how, setHow] = useState(false)
  const viewing = list.find((d) => d.id === params.get('d')) ?? null
  const view = (id: string | null) => setParams(id ? { d: id } : {}, { replace: true })
  const update = (d: Dispute) => setDisputes((all) => all.map((x) => (x.id === d.id ? d : x)))

  // Waiting on you first, soonest deadline first; then the rest, newest first.
  const rank = (d: Dispute) => (d.status === 'needs_reply' ? 0 : d.status === 'under_review' ? 1 : 2)
  const rows = list
    .filter((d) => tab === 'all' || (tab === 'open' ? isOpen(d) : !isOpen(d)))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.replyBy.localeCompare(b.replyBy) : b.openedAt.localeCompare(a.openedAt)))
  const needs = list.filter((d) => d.status === 'needs_reply')
  const review = list.filter((d) => d.status === 'under_review')

  return (
    <>
      <PageHeader
        title="Disputes"
        sub="When a customer or their bank questions a payment. Reply before the deadline, most end with a reply or a refund."
        actions={
          <Button icon={<BookOpen className="size-4" />} onClick={() => setHow(true)}>
            How disputes work
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'open', label: `Open ${list.filter(isOpen).length}` },
            { id: 'closed', label: `Closed ${list.filter((d) => !isOpen(d)).length}` },
            { id: 'all', label: `All ${list.length}` },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
          {needs.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-amber">
              <AlertTriangle className="size-4" /> <span className="tabular font-medium">{needs.length}</span> need{needs.length === 1 ? 's' : ''} your reply
            </span>
          )}
          <span>
            <span className="tabular font-medium text-fg">{review.length}</span> under review
          </span>
        </div>
      </div>

      <Table
        rowKey={(d) => d.id}
        rows={rows}
        onRow={(d) => view(d.id)}
        empty={
          <Empty
            icon={<ShieldAlert className="size-6" />}
            title={tab === 'closed' ? 'Nothing closed yet.' : 'No disputes to deal with.'}
            sub="A customer can raise one from their receipt if a payment went wrong. App and stablecoin payments can't be pulled back, so these are conversations, not reversals."
          />
        }
        columns={[
          {
            key: 'r',
            header: 'Dispute',
            render: (d) => (
              <div>
                <div className="font-medium">{REASONS[d.reason]}</div>
                <div className="font-mono text-[11.5px] text-dim">{d.ref ?? d.id}</div>
              </div>
            ),
          },
          {
            key: 'c',
            header: 'Customer',
            render: (d) => (
              <div className="flex items-center gap-3">
                <PayIcon method={d.payment.method} asset={d.payment.asset} chain={d.payment.chain} size={28} />
                <div className="min-w-0">
                  <div className="truncate">{d.payment.customer.name}</div>
                  <div className="truncate font-mono text-[11.5px] text-dim">{d.payment.ref}</div>
                </div>
              </div>
            ),
          },
          { key: 'a', header: 'Amount', render: (d) => <span className="tabular font-medium">{paid(d.payment)}</span> },
          { key: 'k', header: 'From', render: (d) => (d.kind === 'bank' ? <Badge tone="bad">Bank claim</Badge> : <span className="text-muted">Customer</span>) },
          {
            key: 's',
            header: 'Status',
            render: (d) => (
              <div>
                <Status value={DISPUTE_STATUS[d.status]} />
                <div className={cx('text-[12px]', d.status === 'needs_reply' && soon(d.replyBy) ? 'text-red' : 'text-dim')}>
                  {d.status === 'needs_reply'
                    ? `Reply by ${date(d.replyBy)}`
                    : d.status === 'under_review'
                      ? d.kind === 'bank'
                        ? 'With the bank'
                        : 'With the customer'
                      : `Closed ${ago(d.closedAt ?? d.openedAt)}`}
                </div>
              </div>
            ),
          },
          { key: 'o', header: 'Opened', align: 'right', render: (d) => <span className="text-muted">{ago(d.openedAt)}</span> },
        ]}
      />

      <DisputeDrawer d={viewing} onClose={() => view(null)} onUpdate={update} />
      <HowDisputesWork open={how} onClose={() => setHow(false)} />
    </>
  )
}

/** What has happened, and what's next - opened, your reply, the decision. */
function disputeSteps(d: Dispute): Step[] {
  const reply = d.messages.find((m) => m.from === 'you')
  const closed = !isOpen(d)
  return [
    { title: d.kind === 'bank' ? `${bankOf(d)} raised a claim` : `${firstName(d.payment.customer.name)} opened it`, detail: REASONS[d.reason], time: dateTime(d.openedAt), state: 'done' },
    reply
      ? { title: 'You replied', time: dateTime(reply.at), state: 'done' }
      : closed
        ? { title: 'No reply', state: 'todo' }
        : { title: 'Your reply', detail: `By ${dateTime(d.replyBy)} to ${until(d.replyBy)}`, state: soon(d.replyBy) ? 'wait' : 'now' },
    closed
      ? {
          title: d.outcome ?? (d.status === 'won' ? 'Closed in your favour' : d.status === 'refunded' ? 'Closed with a refund' : 'Closed against you'),
          time: d.closedAt && dateTime(d.closedAt),
          state: d.status === 'lost' ? 'failed' : 'done',
        }
      : d.status === 'under_review'
        ? {
            title: d.kind === 'bank' ? `${bankOf(d)} decides` : `${firstName(d.payment.customer.name)} accepts or replies`,
            detail: d.kind === 'bank' ? 'Banks usually take up to 10 working days.' : 'They have 3 days. If they accept, or say nothing, it closes in your favour.',
            state: 'now',
          }
        : { title: 'Decision', state: 'todo' },
  ]
}

function DisputeDrawer({ d, onClose, onUpdate }: { d: Dispute | null; onClose: () => void; onUpdate: (d: Dispute) => void }) {
  const { test } = useTestMode()
  const { business, mode } = useSession()
  const can = useCan()
  const [refunds] = useBusinessRefunds()
  const [reply, setReply] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refunding, setRefunding] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const pickFiles = useRef<HTMLInputElement>(null)
  if (!d) return null

  const p = d.payment
  const open = isOpen(d)
  const refunded = LIVE ? !!d.refundId : !!refunds?.[p.id]
  const who = firstName(p.customer.name)
  const answer = can('disputes')
  const ref = d.ref ?? d.id
  const fileUrl = (id: string) => (business ? `/api/businesses/${business.id}/disputes/${d.id}/files/${id}` : '#')
  const close = () => {
    setShowPayment(false)
    setReply('')
    setFiles([])
    setError('')
    onClose()
  }
  const refresh = () => business && reload(disputesPath(business.id, mode))
  const send = async () => {
    if (LIVE) {
      if (!business) return
      setBusy(true)
      setError('')
      try {
        const base = `/businesses/${business.id}/disputes/${d.id}`
        const ids: string[] = []
        for (const f of files) ids.push((await uploadFile<{ file: { id: string } }>(`${base}/files`, f)).file.id)
        await api('POST', `${base}/reply`, { message: reply.trim(), files: ids })
        setReply('')
        setFiles([])
        await refresh()
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Your reply didn’t send. Try again in a moment.')
      } finally {
        setBusy(false)
      }
      return
    }
    const now = new Date().toISOString()
    const back = new Date(Date.now() + 3 * 86_400_000).toISOString()
    onUpdate({
      ...d,
      status: 'under_review',
      messages: [
        ...d.messages,
        { from: 'you', body: reply.trim(), at: now, files: files.length ? files.map((f) => ({ name: f.name })) : undefined },
        {
          from: 'us',
          at: now,
          body:
            d.kind === 'bank'
              ? `We've sent your reply and files to ${bankOf(d)}. Banks usually decide within 10 working days. We'll tell you the moment they do.`
              : `We passed your reply on. ${who} has until ${date(back)} to accept it or reply.`,
        },
      ],
    })
    setReply('')
    setFiles([])
  }
  const sender = (m: Dispute['messages'][number]) =>
    m.from === 'you' ? 'You' : m.from === 'us' ? 'Money Moves' : m.from === 'bank' ? `${bankOf(d)} · sender's bank` : `${p.customer.name} · customer`

  return (
    <>
      <Drawer open onClose={close} title={showPayment ? `Payment ${p.ref}` : `Dispute ${ref}`}>
        {showPayment ? (
          <>
            <button onClick={() => setShowPayment(false)} className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-fg">
              <ArrowLeft className="size-3.5" /> Dispute {ref}
            </button>
            <PaymentDetail p={p} test={test} onRefund={() => setRefunding(true)} />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Status value={DISPUTE_STATUS[d.status]} />
              {d.status === 'needs_reply' && (
                <span className={cx('text-[12.5px]', soon(d.replyBy) ? 'text-red' : 'text-dim')}>
                  Reply by {dateTime(d.replyBy)} · {until(d.replyBy)}
                </span>
              )}
            </div>
            <div className="display mt-3 text-[24px] font-semibold leading-tight text-fg">{REASONS[d.reason]}</div>
            <div className="mt-1 text-[13px] text-muted">
              {paid(p)} · {d.kind === 'bank' ? `Claim from ${bankOf(d)}` : `Raised by ${p.customer.name}`} · {ago(d.openedAt)}
            </div>

            {d.kind === 'bank' && open && (
              <div className="mt-5 flex gap-2.5 rounded-[10px] border border-[#EFC4C0] bg-[#FBEAE8] p-3.5 text-[13px] leading-relaxed text-[#7D1F19]">
                <Landmark className="mt-0.5 size-4 shrink-0" />
                <span>
                  This one can cost you the payment. If {bankOf(d)} keeps its claim, the {paid(p)} goes back to the sender, and you fund it like a refund. Proof of a real sale is what wins it.
                </span>
              </div>
            )}
            {!open && d.outcome && (
              <div
                className={cx(
                  'mt-5 rounded-[10px] px-4 py-3 text-[13px] leading-relaxed',
                  d.status === 'won' ? 'bg-[#E4F2E8] text-[#1F5A33]' : d.status === 'lost' ? 'bg-[#F9E3E1] text-[#7D1F19]' : 'bg-raise text-muted',
                )}
              >
                {d.outcome}
                {d.kind === 'bank' && d.status === 'lost' && !refunded && can('refund') && (
                  <div className="mt-3">
                    <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => setRefunding(true)}>
                      Send it back
                    </Button>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => setShowPayment(true)}
              className="mt-5 flex w-full items-center gap-3 rounded-[10px] border border-line px-3.5 py-3 text-left transition hover:border-[#D3D0C7] hover:bg-[#FAFAF8]"
            >
              <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-fg">
                  {p.customer.name} · {METHODS[p.method].short}
                </div>
                <div className="truncate text-[12px] text-dim">
                  <span className="font-mono">{p.ref}</span> · {p.channel} · {dateTime(p.createdAt)}
                </div>
              </div>
              <span className="tabular text-[13.5px] font-medium text-fg">{paid(p)}</span>
              <ArrowRight className="size-4 text-dim" />
            </button>

            <div className="mt-7 border-t border-line pt-5">
              <div className="mb-3 text-[13px] font-semibold text-fg">Conversation</div>
              <ol className="space-y-3">
                {d.messages.map((m, i) => (
                  <li key={i} className={cx('rounded-[10px] px-3.5 py-3', m.from === 'us' ? 'bg-raise' : m.from === 'you' ? 'border border-fg/15 bg-card' : 'border border-line bg-card')}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={cx('truncate text-[12.5px] font-medium', m.from === 'bank' ? 'text-red' : 'text-fg')}>{sender(m)}</span>
                      <span className="tabular shrink-0 text-[11.5px] text-dim">{dateTime(m.at)}</span>
                    </div>
                    <p className={cx('mt-1 text-[13px] leading-relaxed', m.from === 'us' ? 'text-muted' : 'text-fg')}>{m.body}</p>
                    {m.files && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.files.map((f, fi) =>
                          f.id ? (
                            <a key={f.id} href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[6px] border border-line bg-[#FAFAF8] px-2 py-1 text-[12px] text-muted hover:text-fg hover:underline">
                              <Paperclip className="size-3.5" /> {f.name}
                            </a>
                          ) : (
                            <span key={f.name + fi} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line bg-[#FAFAF8] px-2 py-1 text-[12px] text-muted">
                              <Paperclip className="size-3.5" /> {f.name}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>

              {open && !refunded && answer && (
                <div className="mt-4 rounded-[10px] border border-line p-3">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={d.kind === 'bank' ? 'What was the sale? When was it delivered? Attach your proof.' : `Tell ${who} what happened`}
                    className="min-h-[84px] border-0 p-1 shadow-none focus:ring-0"
                  />
                  {files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {files.map((f) => (
                        <span key={f.name} className="inline-flex items-center gap-1.5 rounded-[6px] border border-line bg-[#FAFAF8] py-1 pl-2 pr-1 text-[12px] text-muted">
                          <Paperclip className="size-3.5" /> {f.name}
                          <button onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="rounded p-0.5 hover:bg-raise hover:text-fg" aria-label={`Remove ${f.name}`}>
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <input
                    ref={pickFiles}
                    type="file"
                    multiple
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const picked = [...(e.target.files ?? [])]
                      // Up to five at a time, each named once.
                      setFiles((x) => [...x, ...picked.filter((f) => !x.some((y) => y.name === f.name))].slice(0, 5))
                      e.target.value = ''
                    }}
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-soft pt-3">
                    <Button size="sm" icon={<Paperclip className="size-3.5" />} disabled={busy || files.length >= 5} onClick={() => pickFiles.current?.click()}>
                      Add files
                    </Button>
                    <div className="flex gap-2">
                      {can('refund') && (
                        <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={busy} onClick={() => setRefunding(true)}>
                          Refund instead
                        </Button>
                      )}
                      <Button size="sm" variant="primary" icon={busy ? undefined : <Send className="size-3.5" />} disabled={!reply.trim() || busy} onClick={() => void send()}>
                        {busy ? 'Sending…' : 'Send reply'}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11.5px] text-dim">PDF, JPEG or PNG, up to 10 MB each.</p>
                </div>
              )}
              {error && <p className="mt-2 text-[12.5px] text-red">{error}</p>}
              {open && !answer && <p className="mt-4 text-[12.5px] text-dim">Your role can see disputes but not reply to them. The owner, admins, finance and support can.</p>}
              {test && open && (
                <div className="mt-3">
                  <TestModeHint>Test mode: a test dispute. Nothing real moves.</TestModeHint>
                </div>
              )}
            </div>

            <div className="mt-7 border-t border-line pt-5">
              <div className="mb-4 text-[13px] font-semibold text-fg">How it's going</div>
              <Timeline items={disputeSteps(d)} />
            </div>
          </>
        )}
      </Drawer>
      <RefundModal
        payment={refunding ? p : null}
        onClose={() => setRefunding(false)}
        onRefunded={(r) => {
          // Live, the refund closes the dispute on our side: read it again.
          if (LIVE) {
            setTimeout(() => void refresh(), 600)
            return
          }
          const amount = r.currency === 'NGN' ? ngn(r.amount) : usd(r.amount)
          const now = new Date().toISOString()
          onUpdate({
            ...d,
            status: 'refunded',
            closedAt: now,
            outcome: `Closed with a refund of ${amount}.`,
            messages: [...d.messages, { from: 'us', at: now, body: `You refunded ${amount}. ${who} gets it within 24 to 48 hours, and the dispute is closed.` }],
          })
        }}
      />
    </>
  )
}

function HowDisputesWork({ open, onClose }: { open: boolean; onClose: () => void }) {
  const block = (title: string, body: string) => (
    <div className="border-b border-soft py-3.5 last:border-0">
      <div className="text-[14px] font-semibold text-fg">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  )
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title="How disputes work"
      sub="Someone questions a payment, you answer, and it closes. Who raised it decides what's at stake."
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="-mt-1">
        {block(
          'From a customer',
          `Raised from their receipt: didn't get it, charged twice, not as described. App and stablecoin payments can't be pulled back, so nothing leaves your account. It's a conversation, and we sit in on it. You have ${REPLY_DAYS.customer} days to reply.`,
        )}
        {block(
          'From a bank',
          `Naira transfers only. The sender's bank says the transfer wasn't authorised and asks for it back. Send proof of a real sale, an invoice, a delivery note, messages, within ${REPLY_DAYS.bank} days. We pass it to the bank and it decides.`,
        )}
        {block(
          'Reply, or refund',
          'Reply with what happened and attach anything that shows it. Or refund, full or part, and the dispute closes. A refund costs you nothing extra. We return the fee we charged on the payment.',
        )}
        {block(
          'How it ends',
          "A customer accepts your reply, or says nothing for 3 days, and it closes in your favour. A bank decides, usually within 10 working days. If it keeps its claim, the money goes back to the sender and you fund it the way you'd fund a refund.",
        )}
        {block(
          "If you don't reply in time",
          "A customer dispute closes in the customer's favour and we ask you to refund. A bank claim stands. Disputes left past their deadline count against your account.",
        )}
      </div>
    </Modal>
  )
}
