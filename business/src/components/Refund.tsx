/**
 * Refunding a payment, start to finish: how much, where it goes back to, and
 * how the business sends us the money for it. We then pay the customer -
 * within 24 to 48 hours - and the payment's timeline follows it there.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Landmark, Loader2, Mail, ShieldCheck, Smartphone } from '@/components/icons'
import { BALANCES, METHODS, NGN_RATE, PAYMENTS, type Payment } from '@/data/mock'
import { Button, Field, Input, Modal, OptionCard, SearchBox, Segmented, StepBar, Textarea, cx } from '@/components/ui'
import { PayIcon, TokenIcon } from '@/components/brand'
import Qr from '@/components/Qr'
import { Timeline, type Step } from '@/components/Timeline'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { ago, copy, dateTime, ngn, short, usd } from '@/lib/format'
import { LIVE, type ApiRefund } from '@/lib/api'
import { useSession } from '@/state/session'
import { toPayment, useApiRefunds } from '@/state/live'
import { RefundFlowLive } from './RefundLive'
import {
  fundingAmount,
  refundBy,
  refundOf,
  refundStage,
  refundable,
  toSend,
  useRefunds,
  type Refund,
  type RefundFunding,
  type RefundTo,
} from '@/state/refunds'

/** A refund from the API, in the shape the screens draw. */
export function liveRefund(a: ApiRefund): Refund {
  const payment = toPayment(a.payment)
  const to: RefundTo =
    a.to.kind === 'APP'
      ? { kind: 'app', handle: a.to.account ?? 'their Money Moves account' }
      : a.to.kind === 'WALLET'
        ? { kind: 'wallet', address: a.to.account ?? '', asset: a.to.coin ?? 'USDC', chain: a.to.network ?? undefined }
        : { kind: 'bank', name: a.to.name ?? payment.customer.name, bank: a.to.bank ?? 'their bank', account: a.to.account ?? '' }
  return {
    paymentId: a.payment.id,
    payment,
    ref: a.payment.ref,
    customer: payment.customer,
    method: payment.method,
    currency: a.currency,
    amount: a.amount,
    feeBack: a.feeBack,
    to,
    fund: a.funding.toLowerCase() as RefundFunding,
    reason: a.reason ?? undefined,
    requestedAt: a.requestedAt,
    fundedAt: a.fundedAt ?? undefined,
    doneAt: a.doneAt ?? undefined,
    live: { id: a.id, ref: a.ref, fundNgn: a.fund.amountNgn, fundUsd: a.fund.amountUsd, dueBy: a.dueBy },
  }
}

/**
 * This business's refunds - test ones kept apart from live. Live, they come
 * from the API (the latest per payment); in preview, the sample store.
 */
export function useBusinessRefunds() {
  const { business } = useSession()
  const { test } = useTestMode()
  const store = useRefunds(!LIVE && business ? (test ? `${business.id}:test` : business.id) : undefined)
  const live = useApiRefunds()
  const mapped = useMemo(() => {
    const out: Record<string, Refund> = {}
    // Newest last, so a payment shows its latest refund.
    for (const a of [...(live.refunds ?? [])].reverse()) out[a.payment.id] = liveRefund(a)
    return out
  }, [live.refunds])
  return (LIVE ? [mapped, () => {}] : store) as typeof store
}

const money = (r: Pick<Refund, 'currency'>, n: number) => (r.currency === 'NGN' ? ngn(n) : usd(n))
const inCurrency = (v: { value: number; currency: 'NGN' | 'USD' }) => (v.currency === 'NGN' ? ngn(v.value) : usd(v.value))
const firstName = (name: string) => name.split(' ')[0]!.replace(/^\w/, (c) => c.toUpperCase())

const FUNDED_BY: Record<RefundFunding, string> = {
  wallet: 'your business wallet',
  app: 'the Money Moves app',
  bank: 'a bank transfer',
  held: 'money we still held',
}

/** "Opay ••5177", "@ada on Money Moves" - where a refund lands, in a few words. */
export function toLabel(t: RefundTo): string {
  if (t.kind === 'app') return `${t.handle} on Money Moves`
  if (t.kind === 'bank') return `${t.bank} ••${t.account.slice(-4)}`
  if (t.kind === 'wallet') return `${short(t.address)} · ${t.asset}${t.chain ? ` on ${t.chain}` : ''}`
  return `A wallet ${t.email} gives us`
}

/** Where it goes back, in full, with why. */
export function Destination({ to, p }: { to: RefundTo; p: Payment }) {
  const [icon, title, sub]: [ReactNode, string, string] =
    to.kind === 'app'
      ? [<PayIcon method="app" asset="USDC" size={32} />, to.handle, 'Their Money Moves account. It lands straight in the app.']
      : to.kind === 'bank'
        ? [
            <span className="flex size-8 items-center justify-center rounded-full border border-line text-muted"><Landmark className="size-4" /></span>,
            to.name,
            `${to.bank} ••${to.account.slice(-4)}. The account the transfer came from.`,
          ]
        : to.kind === 'wallet'
          ? [<TokenIcon asset={to.asset} chain={p.chain} size={32} />, short(to.address, 8, 6), `${to.asset} on ${to.chain}. The wallet it came from.`]
          : [
              <span className="flex size-8 items-center justify-center rounded-full border border-line text-muted"><Mail className="size-4" /></span>,
              `We'll email ${to.email}`,
              `This came from a ${to.exchange} account, and coins sent back to an exchange can be lost. We ask the customer for a wallet address first.`,
            ]
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-line px-3.5 py-3">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className={cx('truncate text-[13.5px] font-medium text-fg', to.kind === 'wallet' && 'font-mono text-[13px]')}>{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{sub}</div>
      </div>
    </div>
  )
}

export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="divide-y divide-soft rounded-[10px] border border-line px-4 text-[13.5px]">
      {rows.map(([l, v]) => (
        <div key={l} className="flex items-center justify-between gap-4 py-2.5">
          <span className="shrink-0 text-dim">{l}</span>
          <span className="min-w-0 text-right text-fg">{v}</span>
        </div>
      ))}
    </div>
  )
}

export function CopyValue({ value, mono, big }: { value: string; mono?: boolean; big?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={cx('min-w-0 break-all', mono && 'font-mono', big && 'text-[16px] font-semibold tracking-tight')}>{value}</span>
      <button
        onClick={() => {
          copy(value)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        }}
        className="shrink-0 rounded-[6px] p-1 text-dim transition hover:bg-raise hover:text-fg"
        aria-label="Copy"
      >
        {done ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
      </button>
    </span>
  )
}

type Phase = 'pick' | 'amount' | 'fund' | 'send' | 'checking' | 'done'

/** Refund one payment. With no payment, it starts by asking which one. */
function RefundFlow({ initial, onClose, onRefunded }: { initial: Payment | null; onClose: () => void; onRefunded?: (r: Refund) => void }) {
  const { test } = useTestMode()
  const [refunds, setRefunds] = useBusinessRefunds()
  const [p, setP] = useState<Payment | null>(initial)
  const [phase, setPhase] = useState<Phase>(initial ? 'amount' : 'pick')
  const [q, setQ] = useState('')
  const [full, setFull] = useState(true)
  const [part, setPart] = useState('')
  const [reason, setReason] = useState('')
  const [fund, setFund] = useState<RefundFunding | null>(null)
  const [made, setMade] = useState<Refund | null>(null)

  const naira = p?.method === 'naira'
  const held = p?.status === 'underpaid'
  const max = p ? refundable(p) : 0
  const value = full ? max : Math.min(Number(part) || 0, max)
  const draft = p ? refundOf(p, value, fund ?? 'wallet', reason.trim() || undefined) : null
  // The wallet pays from whichever holding covers it.
  const need = (f: RefundFunding) => (draft ? fundingAmount(draft, f) : { value: 0, currency: 'USD' as const })
  const holding = BALANCES.onchain.holdings.find((h) => h.amount >= need('wallet').value)
  const chosen: RefundFunding = fund ?? (holding ? 'wallet' : 'bank')
  const appLink = draft ? `moneymoves://refund?ref=${draft.ref}&amount=${need('app').value}` : ''

  const pickable = useMemo(() => {
    const s = q.trim().toLowerCase()
    return PAYMENTS.filter((x) => (x.status === 'successful' || x.status === 'underpaid') && !refunds?.[x.id]).filter(
      (x) => !s || x.ref.toLowerCase().includes(s) || x.customer.name.toLowerCase().includes(s) || x.customer.email.includes(s),
    )
  }, [q, refunds])

  const finish = (how: RefundFunding) => {
    if (!p) return
    const r: Refund = { ...refundOf(p, value, how, reason.trim() || undefined), fundedAt: new Date().toISOString() }
    setRefunds((all) => ({ ...all, [p.id]: r }))
    setMade(r)
    onRefunded?.(r)
    setPhase('done')
  }

  // Watching for the money: a moment, then it's there.
  useEffect(() => {
    if (phase !== 'checking') return
    const t = setTimeout(() => finish(chosen), 1700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const steps = held ? ['Payment', 'Amount', 'Done'] : ['Payment', 'Amount', 'Fund it', 'Done']
  const at = phase === 'pick' ? 0 : phase === 'amount' ? 1 : phase === 'done' ? steps.length - 1 : 2
  const shown = initial ? steps.slice(1) : steps

  const title = phase === 'done' ? 'Refund on its way' : phase === 'pick' ? 'Create a refund' : p ? `Refund ${p.ref}` : 'Refund'
  const doneSub =
    made &&
    (made.fund === 'held'
      ? `${firstName(made.customer.name)} gets ${money(made, made.amount)} back within 24 to 48 hours.`
      : made.to.kind === 'ask'
        ? `We have your ${inCurrency(fundingAmount(made, made.fund))}. We've emailed ${made.to.email} for a wallet address, and it goes out within 48 hours of their reply.`
        : `We have your ${inCurrency(fundingAmount(made, made.fund))}. ${firstName(made.customer.name)} gets ${money(made, made.amount)} back within 24 to 48 hours. We'll email you both when it lands.`)

  const footer =
    phase === 'pick' ? (
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!p} onClick={() => setPhase('amount')}>
          Continue
        </Button>
      </>
    ) : phase === 'amount' ? (
      <>
        {initial ? <Button onClick={onClose}>Cancel</Button> : <Button onClick={() => setPhase('pick')}>Back</Button>}
        {held ? (
          <Button variant="primary" disabled={value <= 0} onClick={() => finish('held')}>
            Refund {draft && money(draft, value)}
          </Button>
        ) : (
          <Button variant="primary" disabled={value <= 0} onClick={() => setPhase('fund')}>
            Continue
          </Button>
        )}
      </>
    ) : phase === 'fund' ? (
      <>
        <Button onClick={() => setPhase('amount')}>Back</Button>
        <Button variant="primary" onClick={() => { setFund(chosen); setPhase('send') }}>
          Continue
        </Button>
      </>
    ) : phase === 'send' ? (
      <>
        <Button onClick={() => setPhase('fund')}>Back</Button>
        <Button variant="primary" onClick={() => setPhase('checking')}>
          {chosen === 'wallet' ? 'Confirm in wallet' : chosen === 'app' ? "I've approved it" : "I've sent it"}
        </Button>
      </>
    ) : phase === 'checking' ? (
      <Button variant="primary" disabled icon={<Loader2 className="size-4 animate-spin" />}>
        {chosen === 'wallet' ? 'Waiting for your wallet' : 'Looking for it'}
      </Button>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )

  return (
    <Modal open onClose={onClose} width={560} title={title} sub={phase === 'done' ? doneSub ?? undefined : undefined} footer={footer}>
      {phase !== 'done' && <StepBar steps={shown} at={initial ? at - 1 : at} />}
      {test && phase !== 'done' && (
        <div className="mb-4">
          <TestModeHint>Test mode: a test refund. Nothing real moves.</TestModeHint>
        </div>
      )}

      {phase === 'pick' && (
        <div className="rise space-y-3">
          <SearchBox placeholder="Search by reference, name or email" value={q} onChange={setQ} className="w-full" />
          <div className="-mx-1 max-h-[340px] overflow-y-auto px-1">
            {pickable.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-5 py-8 text-center text-[13px] text-muted">No payments to refund match that.</div>
            ) : (
              <div className="space-y-1.5">
                {pickable.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => setP(x)}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition',
                      p?.id === x.id ? 'border-fg bg-card shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7] hover:bg-[#FAFAF8]',
                    )}
                  >
                    <PayIcon method={x.method} asset={x.asset} chain={x.chain} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-fg">{x.customer.name}</div>
                      <div className="truncate text-[12px] text-dim">
                        <span className="font-mono">{x.ref}</span> · {x.channel} · {ago(x.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[13.5px] font-medium text-fg">{x.method === 'naira' ? ngn(x.amount) : usd(x.usd)}</div>
                      {x.status === 'underpaid' && <div className="text-[11.5px] text-red">Underpaid</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'amount' && p && draft && (
        <div className="rise space-y-5">
          <div className="flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3">
            <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-fg">{p.customer.name}</div>
              <div className="truncate text-[12px] text-dim">
                <span className="font-mono">{p.ref}</span> · {METHODS[p.method].short} · {ago(p.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-[13.5px] font-medium text-fg">{money(draft, p.amount)}</div>
              {held && <div className="tabular text-[12px] text-dim">{money(draft, max)} arrived</div>}
            </div>
          </div>

          {!held && (
            <div className="space-y-3">
              <Segmented
                value={full ? 'full' : 'part'}
                onChange={(v) => setFull(v === 'full')}
                options={[
                  { id: 'full', label: 'Full refund' },
                  { id: 'part', label: 'Part of it' },
                ]}
              />
              {!full && (
                <Field label="Amount" hint={`Up to ${money(draft, max)}.`}>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-dim">{naira ? '₦' : '$'}</span>
                    <Input value={part} onChange={(e) => setPart(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" className="pl-7" autoFocus />
                  </div>
                </Field>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 text-[13px] font-medium text-fg">Goes back to</div>
            <Destination to={draft.to} p={p} />
          </div>

          <Field label="Reason" optional>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The customer sees this on their receipt" className="min-h-[60px]" />
          </Field>

          {held ? (
            <div className="rounded-[10px] bg-raise px-4 py-3 text-[13px] leading-relaxed text-muted">
              This payment never settled, so we still hold the {money(draft, max)}. There's nothing for you to send. It goes straight back.
            </div>
          ) : (
            <div className="rounded-[10px] bg-raise px-4 py-1 text-[13.5px]">
              <div className="flex justify-between gap-4 py-2">
                <span className="text-muted">{firstName(p.customer.name)} gets</span>
                <span className="tabular text-fg">{money(draft, value)}</span>
              </div>
              {draft.feeBack > 0 && (
                <div className="flex justify-between gap-4 py-2">
                  <span className="text-muted">Our fee, given back</span>
                  <span className="tabular text-good">− {money(draft, draft.feeBack)}</span>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
                <span className="text-fg">You send</span>
                <span className="tabular text-fg">{money(draft, toSend(draft))}</span>
              </div>
            </div>
          )}
          <p className="text-[12.5px] text-dim">Refunds are free. Most reach the customer within 24 to 48 hours.</p>
        </div>
      )}

      {phase === 'fund' && draft && (
        <div className="rise space-y-2.5">
          <p className="mb-1 text-[13px] text-muted">How will you send us the {money(draft, toSend(draft))}? We pass it to {firstName(draft.customer.name)} the way they paid.</p>
          <OptionCard
            selected={chosen === 'wallet'}
            onClick={() => setFund('wallet')}
            disabled={!holding}
            icon={<span className="flex size-[30px] items-center justify-center rounded-full bg-fg text-white"><ShieldCheck className="size-4" /></span>}
            title="Business wallet"
            sub={holding ? `${usd(need('wallet').value)} in ${holding.asset} · ${usd(BALANCES.onchain.usd)} in your wallet` : `${usd(BALANCES.onchain.usd)} in your wallet, not enough for this one`}
          />
          <OptionCard selected={chosen === 'app'} onClick={() => setFund('app')} icon={<PayIcon method="app" asset="USDC" size={30} />} title="Money Moves app" sub={`Approve ${usd(need('app').value)} in the app`} />
          <OptionCard selected={chosen === 'bank'} onClick={() => setFund('bank')} icon={<PayIcon method="naira" asset="NGN" size={30} />} title="Bank transfer" sub={`${ngn(need('bank').value)} to a one-time account`} />
          {draft.currency === 'NGN' && chosen !== 'bank' && <p className="pt-1 text-[12px] text-dim">At ₦{NGN_RATE.toLocaleString()} to the dollar, held for 30 minutes.</p>}
        </div>
      )}

      {(phase === 'send' || phase === 'checking') && draft && (
        <div className={cx('rise space-y-4', phase === 'checking' && 'pointer-events-none opacity-60')}>
          {chosen === 'wallet' && holding && (
            <>
              <Rows
                rows={[
                  ['From', <span className="font-mono text-[12.5px]">Business wallet · {short(BALANCES.onchain.address)}</span>],
                  ['Sends', `${need('wallet').value.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${holding.asset} on ${holding.chain}`],
                  ['To', 'Money Moves refunds'],
                  ['For', `${draft.ref} · ${draft.customer.name}`],
                ]}
              />
              <p className="text-[12.5px] leading-relaxed text-muted">Your wallet asks you to confirm. It's yours. Nothing leaves it without you.</p>
            </>
          )}
          {chosen === 'app' && (
            // Both: open the app on this phone, or scan the code with it from another.
            <>
              <div className="flex flex-col items-center gap-5 rounded-[10px] border border-line p-5 sm:flex-row sm:gap-6">
                <Qr value={appLink} size={136} logo />
                <ol className="w-full space-y-3 text-[13px] text-muted sm:w-auto">
                  {['Open Money Moves', 'Tap Scan and point it here', `Approve ${usd(need('app').value)}`].map((t, i) => (
                    <li key={t} className="flex items-center gap-2.5">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-raise text-[11px] font-semibold text-fg">{i + 1}</span>
                      {t}
                    </li>
                  ))}
                </ol>
              </div>
              <Button full size="lg" icon={<Smartphone className="size-4" />} onClick={() => (window.location.href = appLink)}>
                Open Money Moves
              </Button>
              <p className="text-center text-[12px] text-dim">On this phone? Open the app and the refund is ready to approve.</p>
            </>
          )}
          {chosen === 'bank' && (
            <>
              <Rows
                rows={[
                  ['Account number', <CopyValue value={test ? '0000000001' : '9973355061'} mono big />],
                  ['Bank', test ? 'Test Bank' : 'Nombank MFB'],
                  ['Account name', `MMB Refund / ${draft.ref}`],
                  ['Amount, exactly', <CopyValue value={ngn(need('bank').value)} />],
                ]}
              />
              <p className="text-[12.5px] leading-relaxed text-muted">This account is for this refund only and closes in 30 minutes. A different amount slows it down.</p>
            </>
          )}
          {phase === 'checking' && (
            <div className="flex items-center gap-2 text-[13px] text-fg">
              <Loader2 className="size-4 animate-spin" /> {chosen === 'wallet' ? 'Waiting for you to confirm in your wallet…' : chosen === 'app' ? 'Waiting for your approval…' : 'Looking for your transfer…'}
            </div>
          )}
        </div>
      )}

      {phase === 'done' && made && (
        <div className="rise space-y-4">
          <Rows
            rows={[
              [`${firstName(made.customer.name)} gets`, <span className="tabular">{money(made, made.amount)}</span>],
              ['Back to', toLabel(made.to)],
              ...(made.fund === 'held' || made.feeBack === 0 ? [] : ([['Our fee, given back', <span className="tabular text-good">{money(made, made.feeBack)}</span>]] as [string, ReactNode][])),
              ['Expected by', dateTime(refundBy(made))],
              ['Reference', <span className="font-mono text-[12.5px]">RF-{made.ref.slice(4)}</span>],
            ]}
          />
          <p className="text-[12.5px] text-dim">You can follow it on the payment and on Refunds.</p>
        </div>
      )}
    </Modal>
  )
}

/** Refund this payment - or, with `pick`, choose which one first. */
export function RefundModal({ payment, pick, onClose, onRefunded }: { payment: Payment | null; pick?: boolean; onClose: () => void; onRefunded?: (r: Refund) => void }) {
  if (!payment && !pick) return null
  if (LIVE) return <RefundFlowLive key={payment?.id ?? 'pick'} initial={payment} onClose={onClose} />
  return <RefundFlow key={payment?.id ?? 'pick'} initial={payment} onClose={onClose} onRefunded={onRefunded} />
}

/** What's happened to a refund, and what's still to come. */
export function refundSteps(r: Refund): Step[] {
  const stage = refundStage(r)
  const name = firstName(r.customer.name)
  const steps: Step[] = [{ title: 'Refund requested', detail: r.reason ? `"${r.reason}"` : `${money(r, r.amount)} back to ${toLabel(r.to)}`, time: dateTime(r.requestedAt), state: 'done' }]
  if (r.fund !== 'held') {
    steps.push(
      r.fundedAt
        ? { title: `${inCurrency(fundingAmount(r, r.fund))} received`, detail: r.feeBack > 0 ? `From ${FUNDED_BY[r.fund]}, with our fee of ${money(r, r.feeBack)} given back` : `From ${FUNDED_BY[r.fund]}`, time: dateTime(r.fundedAt), state: 'done' }
        : { title: 'Waiting for your money', detail: `${inCurrency(fundingAmount(r, r.fund))} by ${FUNDED_BY[r.fund]}`, state: 'now' },
    )
  }
  if (r.to.kind === 'ask') {
    steps.push(
      stage === 'refunded'
        ? { title: 'Wallet address received', detail: `From ${r.to.email}`, state: 'done' }
        : { title: `Waiting for ${name}'s wallet address`, detail: `We emailed ${r.to.email}. The money came from ${r.to.exchange}, so it can't go back there.`, state: r.fundedAt ? 'wait' : 'todo' },
    )
  }
  steps.push(
    stage === 'refunded'
      ? { title: 'Refunded', detail: `${money(r, r.amount)} reached ${toLabel(r.to)}`, time: dateTime(r.doneAt!), state: 'done' }
      : { title: `Sending to ${name}`, detail: `Usually 24 to 48 hours · by ${dateTime(refundBy(r))}`, state: stage === 'sending' && r.to.kind !== 'ask' ? 'now' : 'todo' },
  )
  return steps
}

/** A refund on a payment's own page. */
export function RefundPanel({ r }: { r: Refund }) {
  const done = refundStage(r) === 'refunded'
  return (
    <div className="mt-5 overflow-hidden rounded-[10px] border border-line">
      <div className="border-b border-soft bg-[#FAFAF8] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-fg">{done ? 'Refunded' : 'Refund on its way'}</div>
          <div className="truncate text-[12px] text-dim">
            {money(r, r.amount)} to {toLabel(r.to)}
          </div>
        </div>
      </div>
      <div className="px-4 py-4">
        <Timeline items={refundSteps(r)} />
      </div>
    </div>
  )
}

/** "Refunding" or "Refunded" in place of a payment's own status, once there's a refund. */
export const statusWithRefund = (p: Payment, r?: Refund) => (r ? (refundStage(r) === 'refunded' ? 'refunded' : 'refunding') : p.status)
