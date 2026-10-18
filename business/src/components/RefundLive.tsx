/**
 * Refunding a payment, live: the same steps as the preview, kept by the API.
 *
 * The business picks a payment and how much, sees our fee on that share come
 * back, and sends us the rest. In test mode its side - the wallet, the app or
 * a transfer - is pretended, and the refund reaches the customer by itself a
 * few seconds later. Live, it sends USDC from its business wallet, approves a
 * request in its linked Money Moves app, or pays into a one-time account; our
 * team sends the refund on, and the business follows it to the end.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { FlaskConical, Loader2, ShieldCheck, Smartphone } from '@/components/icons'
import type { Payment } from '@/data/mock'
import { Button, Field, Input, Modal, OptionCard, SearchBox, Segmented, StepBar, Textarea, cx } from '@/components/ui'
import { PayIcon } from '@/components/brand'
import { TestModeHint, useTestMode } from '@/components/TestMode'
import { ago, dateTime, ngn, usd } from '@/lib/format'
import { ApiError, api, type ApiRefund } from '@/lib/api'
import { reload } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { useApiRefunds, usePayments } from '@/state/live'
import type { RefundTo } from '@/state/refunds'
import { CopyValue, Destination, Rows, toLabel, useBusinessRefunds } from './Refund'
import Qr from './Qr'

type Phase = 'pick' | 'amount' | 'fund' | 'send' | 'checking' | 'done'
type Funding = 'WALLET' | 'APP' | 'BANK'

const cents = (n: number) => Math.round(n * 100) / 100
const firstName = (name: string) => name.split(' ')[0]!.replace(/^\w/, (c) => c.toUpperCase())

/** Where a live payment's refund goes: the way the customer paid. */
export function liveTo(p: Payment): RefundTo {
  if (p.method === 'app') return { kind: 'app', handle: p.payer?.account || 'their Money Moves account' }
  if (p.method === 'crypto') return { kind: 'wallet', address: p.from || 'the wallet it came from', asset: p.asset, chain: p.chain }
  return { kind: 'bank', name: p.payer?.name || p.customer.name, bank: p.payer?.bank || 'their bank', account: p.payer?.account || '' }
}

export function RefundFlowLive({ initial, onClose }: { initial: Payment | null; onClose: () => void }) {
  const { business, mode } = useSession()
  const { test } = useTestMode()
  const { payments } = usePayments()
  const { fundings, closedFundings } = useApiRefunds()
  const navigate = useNavigate()
  const [refunds] = useBusinessRefunds()
  const [p, setP] = useState<Payment | null>(initial)
  const [phase, setPhase] = useState<Phase>(initial ? 'amount' : 'pick')
  const [q, setQ] = useState('')
  const [full, setFull] = useState(true)
  const [part, setPart] = useState('')
  const [reason, setReason] = useState('')
  const [fund, setFund] = useState<Funding | null>(null)
  const [made, setMade] = useState<ApiRefund | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const base = business ? `/businesses/${business.id}/refunds` : null
  const listPath = business ? `${base}?mode=${mode}` : null
  const refresh = () => {
    if (listPath) void reload(listPath)
    if (business) void reload(`/businesses/${business.id}/payments?mode=${mode}`)
  }
  // Only the owner can move the business wallet's money, so the wallet is theirs to pick.
  const notOwner = !test && business?.role !== 'OWNER'
  const allowed: Funding[] = ((fundings as Funding[] | undefined) ?? (test ? ['WALLET', 'APP', 'BANK'] : ['BANK'])).filter((x) => x !== 'WALLET' || !notOwner)
  const closedWhy = (x: Funding) => (x === 'WALLET' && notOwner ? 'Only the owner can send from the business wallet' : (closedFundings?.[x] ?? 'Not open right now'))
  // Live, from the wallet or the app: our side is real, so the money is followed rather than pretended.
  const liveWallet = made?.funding === 'WALLET' && !made.simulator
  const liveApp = made?.funding === 'APP' && !made.simulator && !!made.fund.app

  // What can be refunded: what came in, in the customer's money - naira for a transfer, coins (a dollar each) otherwise.
  const usdOut = p ? p.method !== 'naira' : false
  const rate = p ? (p.live?.ngnPerUsd ?? (p.usd ? p.amount / p.usd : 1)) : 1
  const receivedNgn = p ? (p.live?.receivedNgn ?? p.amount) : 0
  const held = p?.status === 'underpaid'
  const max = p ? (usdOut ? cents(receivedNgn / rate) : receivedNgn) : 0
  const value = full ? max : Math.min(Number(part) || 0, max)
  const share = max ? value / max : 0
  // Our fee on that share, given back. The API works out the exact figure; this is what it will be.
  const feeBack = held || !p ? 0 : cents((usdOut ? (p.live?.feeNgn ?? 0) / rate : (p.live?.feeNgn ?? 0)) * share)
  const money = (n: number) => (usdOut ? usd(n) : ngn(n))

  const pickable = useMemo(() => {
    const s = q.trim().toLowerCase()
    return payments
      .filter((x) => (x.status === 'successful' || x.status === 'underpaid') && !refunds?.[x.id])
      .filter((x) => !s || x.ref.toLowerCase().includes(s) || x.customer.name.toLowerCase().includes(s) || x.customer.email.includes(s))
  }, [q, payments, refunds])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setProblem('')
    try {
      await fn()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const create = (funding?: Funding) =>
    run(async () => {
      if (!base || !p) return
      const r = await api<{ refund: ApiRefund }>('POST', base, { paymentId: p.id, amount: full ? undefined : value, funding, reason: reason.trim() || undefined })
      setMade(r.refund)
      refresh()
      setPhase(r.refund.status === 'AWAITING_FUNDS' ? 'send' : 'done')
    })

  const pretend = () =>
    run(async () => {
      if (!base || !made) return
      const r = await api<{ refund: ApiRefund }>('POST', `${base}/${made.id}/simulate`)
      setMade(r.refund)
      refresh()
      setPhase('done')
    })

  const cancel = () =>
    run(async () => {
      if (!base || !made) return
      await api('POST', `${base}/${made.id}/cancel`)
      refresh()
      onClose()
    })

  // Looking for the business's money: the API asks the rail, or the app and the chain, each time. An app request is watched from the moment it shows.
  useEffect(() => {
    if (!(phase === 'checking' || (phase === 'send' && liveApp)) || !base || !made) return
    const t = setInterval(() => {
      api<{ refund: ApiRefund }>('GET', `${base}/${made.id}`)
        .then((r) => {
          setMade(r.refund)
          if (r.refund.status === 'SENDING' || r.refund.status === 'REFUNDED') {
            refresh()
            setPhase('done')
          } else if (r.refund.status === 'CANCELLED') {
            setProblem(
              r.refund.funding === 'APP'
                ? 'The request closed in the app before it was paid, so this refund lapsed. Start it again for a fresh one.'
                : 'The account closed before your transfer arrived, so this refund lapsed. Start it again for a fresh account.',
            )
            setPhase('send')
          }
        })
        .catch(() => {})
    }, 2_500)
    return () => clearInterval(t)
  }, [phase, base, made?.id, liveApp]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = held ? ['Payment', 'Amount', 'Done'] : ['Payment', 'Amount', 'Fund it', 'Done']
  const at = phase === 'pick' ? 0 : phase === 'amount' ? 1 : phase === 'done' ? steps.length - 1 : 2
  const shown = initial ? steps.slice(1) : steps
  const chosen: Funding = fund ?? allowed[0] ?? 'BANK'
  const name = p ? firstName(p.customer.name) : 'The customer'

  const title = phase === 'done' ? (made?.status === 'REFUNDED' ? 'Refunded' : 'Refund on its way') : phase === 'pick' ? 'Create a refund' : p ? `Refund ${p.ref}` : 'Refund'
  const doneSub = made
    ? made.funding === 'HELD'
      ? `${name} gets ${money(made.amount)} back within 24 to 48 hours.`
      : `We have your ${made.funding === 'BANK' ? ngn(made.fund.amountNgn) : usd(made.fund.amountUsd)}. ${name} gets ${money(made.amount)} back within 24 to 48 hours. We'll email them when it lands.`
    : undefined

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
          <Button variant="primary" disabled={value <= 0 || busy} onClick={() => void create()}>
            {busy ? 'Starting…' : `Refund ${money(value)}`}
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
        <Button variant="primary" disabled={busy} onClick={() => void create(chosen)}>
          {busy ? 'Starting…' : 'Continue'}
        </Button>
      </>
    ) : phase === 'send' ? (
      <>
        <Button disabled={busy} onClick={() => void cancel()}>
          Cancel refund
        </Button>
        {liveWallet ? (
          <Button variant="primary" disabled={busy || made?.status !== 'AWAITING_FUNDS'} icon={<ShieldCheck className="size-4" />} onClick={() => navigate(`/balances?refund=${made!.id}`)}>
            Send from your wallet
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || made?.status !== 'AWAITING_FUNDS' || (!made?.fund.account && made?.funding === 'BANK')} onClick={() => setPhase('checking')}>
            {made?.funding === 'WALLET' ? "I've confirmed it" : made?.funding === 'APP' ? "I've approved it" : "I've sent it"}
          </Button>
        )}
      </>
    ) : phase === 'checking' ? (
      <>
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" disabled icon={<Loader2 className="size-4 animate-spin" />}>
          Looking for it
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )

  return (
    <Modal open onClose={onClose} width={560} title={title} sub={phase === 'done' ? doneSub : undefined} footer={footer}>
      {phase !== 'done' && <StepBar steps={shown} at={initial ? at - 1 : at} />}
      {test && phase !== 'done' && (
        <div className="mb-4">
          <TestModeHint>Test mode: a test refund, simulated end to end. Nothing real moves.</TestModeHint>
        </div>
      )}

      {phase === 'pick' && (
        <div className="rise space-y-3">
          <SearchBox placeholder="Search by reference, name or email" value={q} onChange={setQ} className="w-full" />
          <div className="-mx-1 max-h-[340px] overflow-y-auto px-1">
            {pickable.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-5 py-8 text-center text-[13px] text-muted">
                {payments.length === 0 ? `No ${test ? 'test ' : ''}payments to refund yet.` : 'No payments to refund match that.'}
              </div>
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

      {phase === 'amount' && p && (
        <div className="rise space-y-5">
          <div className="flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3">
            <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium text-fg">{p.customer.name}</div>
              <div className="truncate text-[12px] text-dim">
                <span className="font-mono">{p.ref}</span> · {ago(p.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-[13.5px] font-medium text-fg">{usdOut ? usd(p.usd) : ngn(p.amount)}</div>
              {held && <div className="tabular text-[12px] text-dim">{money(max)} arrived</div>}
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
                <Field label="Amount" hint={`Up to ${money(max)}.`}>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-dim">{usdOut ? '$' : '₦'}</span>
                    <Input value={part} onChange={(e) => setPart(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" inputMode="decimal" className="pl-7" autoFocus />
                  </div>
                </Field>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 text-[13px] font-medium text-fg">Goes back to</div>
            <Destination to={liveTo(p)} p={p} />
          </div>

          <Field label="Reason" optional>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="The customer sees this on their receipt" className="min-h-[60px]" />
          </Field>

          {held ? (
            <div className="rounded-[10px] bg-raise px-4 py-3 text-[13px] leading-relaxed text-muted">
              This payment never settled, so we still hold the {money(max)}. There's nothing for you to send. It goes straight back.
            </div>
          ) : (
            <div className="rounded-[10px] bg-raise px-4 py-1 text-[13.5px]">
              <div className="flex justify-between gap-4 py-2">
                <span className="text-muted">{name} gets</span>
                <span className="tabular text-fg">{money(value)}</span>
              </div>
              {feeBack > 0 && (
                <div className="flex justify-between gap-4 py-2">
                  <span className="text-muted">Our fee, given back</span>
                  <span className="tabular text-good">− {money(feeBack)}</span>
                </div>
              )}
              <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
                <span className="text-fg">You send</span>
                <span className="tabular text-fg">{money(cents(value - feeBack))}</span>
              </div>
            </div>
          )}
          <p className="text-[12.5px] text-dim">Refunds are free. Most reach the customer within 24 to 48 hours.</p>
          {problem && <p className="text-[12.5px] text-red">{problem}</p>}
        </div>
      )}

      {phase === 'fund' && p && (
        <div className="rise space-y-2.5">
          <p className="mb-1 text-[13px] text-muted">
            How will you send us the {money(cents(value - feeBack))}? We pass it to {name} the way they paid.
          </p>
          <OptionCard
            selected={chosen === 'WALLET'}
            disabled={!allowed.includes('WALLET')}
            onClick={() => setFund('WALLET')}
            icon={
              <span className="flex size-[30px] items-center justify-center rounded-full bg-fg text-white">
                <ShieldCheck className="size-4" />
              </span>
            }
            title="Business wallet"
            sub={allowed.includes('WALLET') ? (test ? 'Your test wallet, simulated' : 'USDC from your wallet, approved with your PIN') : closedWhy('WALLET')}
          />
          <OptionCard
            selected={chosen === 'APP'}
            disabled={!allowed.includes('APP')}
            onClick={() => setFund('APP')}
            icon={<PayIcon method="app" asset="USDC" size={30} />}
            title="Money Moves app"
            sub={allowed.includes('APP') ? (test ? 'Approved in the app, simulated' : 'Scan a code with your app and approve it') : closedWhy('APP')}
          />
          <OptionCard
            selected={chosen === 'BANK'}
            onClick={() => setFund('BANK')}
            icon={<PayIcon method="naira" asset="NGN" size={30} />}
            title="Bank transfer"
            sub="To a one-time account, made for this refund"
          />
          {problem && <p className="pt-1 text-[12.5px] text-red">{problem}</p>}
        </div>
      )}

      {(phase === 'send' || phase === 'checking') && made && (
        <div className={cx('rise space-y-4', phase === 'checking' && 'opacity-70')}>
          {made.funding === 'BANK' && made.fund.account && (
            <>
              <Rows
                rows={[
                  ['Account number', <CopyValue value={made.fund.account.number} mono big />],
                  ['Bank', made.fund.account.bank ?? 'Bank'],
                  ['Account name', made.fund.account.name ?? `Refund / ${made.ref}`],
                  ['Amount, exactly', <CopyValue value={ngn(made.fund.amountNgn)} />],
                ]}
              />
              <p className="text-[12.5px] leading-relaxed text-muted">
                This account is for this refund only and closes {made.fund.account.expiresAt ? `at ${dateTime(made.fund.account.expiresAt)}` : 'in 30 minutes'}. A different amount slows it down.
              </p>
            </>
          )}
          {made.funding === 'WALLET' && (
            <>
              <Rows
                rows={[
                  ['From', test ? 'Test wallet' : 'Business wallet'],
                  ['Sends', `${made.fund.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`],
                  ['For', `${made.ref} · ${p?.customer.name ?? ''}`],
                ]}
              />
              {liveWallet && (
                <p className="text-[12.5px] leading-relaxed text-muted">
                  Your wallet opens with this refund filled in. Pick the network to send from and approve it with your PIN. The refund moves on by itself once the chain confirms it.
                </p>
              )}
            </>
          )}
          {made.funding === 'APP' && !liveApp && (
            <Rows
              rows={[
                ['Approve', usd(made.fund.amountUsd)],
                ['In', 'The Money Moves app'],
                ['For', `${made.ref} · ${p?.customer.name ?? ''}`],
              ]}
            />
          )}
          {liveApp && made.fund.app && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <Qr value={made.fund.app.link} size={168} logo />
              <div className="min-w-0 flex-1 space-y-3 text-[13px]">
                <div>
                  <div className="text-[12.5px] text-dim">Approve in the app</div>
                  <div className="display tabular text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">{usd(made.fund.amountUsd)}</div>
                  <div className="text-[12.5px] text-dim">USDC or USDT, for {made.ref}</div>
                </div>
                <p className="leading-relaxed text-muted">Scan this with your Money Moves app and approve it. It closes {made.fund.app.expiresAt ? `at ${dateTime(made.fund.app.expiresAt)}` : 'in 30 minutes'}.</p>
                <a href={made.fund.app.link} className="inline-flex items-center gap-1.5 font-medium text-fg underline underline-offset-2">
                  <Smartphone className="size-4" /> On your phone? Open it in the app
                </a>
              </div>
            </div>
          )}
          {made.simulator && phase === 'send' && (
            <div className="rounded-[12px] border border-dashed border-[#E3B85C] bg-[#FDF8EC] p-3.5">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#6E440A]">
                <FlaskConical className="size-4" /> Test mode -{' '}
                {made.funding === 'WALLET' ? 'pretend your wallet confirmed it' : made.funding === 'APP' ? 'pretend you approved it in the app' : 'pretend your transfer arrived'}
              </div>
              <div className="mt-2.5">
                <button disabled={busy} onClick={() => void pretend()} className="rounded-full bg-fg px-3.5 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                  {made.funding === 'BANK' ? `Send ${ngn(made.fund.amountNgn)}` : made.funding === 'APP' ? `Approve ${usd(made.fund.amountUsd)}` : `Confirm ${usd(made.fund.amountUsd)}`}
                </button>
              </div>
            </div>
          )}
          {(phase === 'checking' || (phase === 'send' && liveApp)) && (
            <div className="flex items-center gap-2 text-[13px] text-fg">
              <Loader2 className="size-4 animate-spin" /> Looking for your money. You can close this; the refund carries on once it arrives.
            </div>
          )}
          {problem && <p className="text-[12.5px] text-red">{problem}</p>}
        </div>
      )}

      {phase === 'done' && made && (
        <div className="rise space-y-4">
          <Rows
            rows={[
              [`${name} gets`, <span className="tabular">{money(made.amount)}</span>],
              ['Back to', toLabel(liveTo(p!))],
              ...(made.funding === 'HELD' || made.feeBack === 0 ? [] : ([['Our fee, given back', <span className="tabular text-good">{money(made.feeBack)}</span>]] as [string, ReactNode][])),
              ['Expected by', made.dueBy ? dateTime(made.dueBy) : 'Within 48 hours'],
              ['Reference', <span className="font-mono text-[12.5px]">{made.ref}</span>],
            ]}
          />
          <p className="text-[12.5px] text-dim">You can follow it on the payment and on Refunds.</p>
        </div>
      )}
    </Modal>
  )
}
