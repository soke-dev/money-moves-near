/**
 * One payment, on its own page: what was asked for and what arrived, who paid
 * and from where, the one-time account it went into, and where the money went
 * next.
 */
import { C, explorerUrl } from '../ui'
import { BizError, METHOD, placeOf, useLoad, type PayDetail } from './client'
import { Copy, Dim, Facts, IdLine, LinkText, naira, Notice, PageHead, PageLoading, Panel, PayState, Problem, Ref, SettleState, Tag, TextButton, Timeline, When, type Tone } from './kit'
import { useRecord } from './nav'
import { useState } from 'react'
import { BankClaim } from './Disputes'
import { eventDetail, eventTone, EVENT_WORDS } from './tables'

export function PaymentPage({ id }: { id: string }) {
  // Waiting to be paid, or its payout on its way: it reads itself again until that's done.
  const { data, error, loading, reload } = useLoad<PayDetail>(`/payments/${id}`, {
    every: (d) => (d.payment.status === 'OPEN' || (d.settlement && ['QUEUED', 'SENDING', 'SENT'].includes(d.settlement.status)) ? 4000 : null),
  })
  const { open } = useRecord()
  const [claiming, setClaiming] = useState(false)
  if (loading && !data) return <PageLoading />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />

  const p = data.payment
  const s = data.settlement
  const here = `Payment ${p.ref}`
  const short = p.receivedNgn != null && p.receivedNgn < p.amountNgn ? p.amountNgn - p.receivedNgn : 0
  const who = p.payer?.name ?? p.customer.name ?? p.customer.email
  const timeline: { id: string; title: string; detail?: string; by?: string; at: string; tone?: Tone }[] = [
    {
      id: 'opened',
      title: 'Checkout opened',
      at: p.createdAt,
      detail: p.link ? `From the link ${p.link.name}` : p.invoice ? `From invoice ${p.invoice.number}` : p.outlet ? `At the outlet ${p.outlet.name}` : undefined,
    },
  ]
  if (p.paidAt)
    timeline.push({
      id: 'paid',
      title: short ? `Arrived ${naira(short)} short` : 'Paid',
      at: p.paidAt,
      tone: short ? 'warn' : 'good',
      detail: p.payer ? [p.payer.name, p.payer.bank].filter(Boolean).join(' · ') : undefined,
    })
  for (const e of s?.events ?? [])
    timeline.push({ id: e.id, title: `Settlement: ${(EVENT_WORDS[e.kind] ?? e.kind).toLowerCase()}`, at: e.at, tone: eventTone(e.kind), detail: eventDetail(e.kind, e.detail) || undefined, by: e.by === 'system' ? undefined : e.by })
  if (p.status === 'EXPIRED') timeline.push({ id: 'expired', title: 'Expired unpaid', at: p.expiresAt })

  return (
    <div>
      <PageHead
        title={
          <>
            {naira(p.receivedNgn ?? p.amountNgn)}
            {who && <span style={{ color: C.muted }}> from {who}</span>}
          </>
        }
        meta={[
          <PayState status={p.status} />,
          p.mode === 'TEST' && <Tag tone="warn">Test - simulated</Tag>,
          METHOD[p.method ?? 'NAIRA'],
          p.paidAt ? (
            <>
              Paid <When at={p.paidAt} />
            </>
          ) : (
            <>
              Opened <When at={p.createdAt} />
            </>
          ),
        ]}
        actions={
          p.method === 'NAIRA' && (p.status === 'PAID' || p.status === 'UNDERPAID') && <TextButton onClick={() => setClaiming((v) => !v)}>Record a bank claim</TextButton>
        }
      >
        <IdLine
          items={[
            ['Reference', <Copy text={p.ref} />],
            !!p.business && ['Business', <LinkText onClick={() => open('business', p.business!.id, { from: here })}>{p.business.name}</LinkText>],
            !!p.link && [
              'Link',
              <span style={{ color: C.text }}>
                {p.link.name} <Ref dim>/{p.link.slug}</Ref>
              </span>,
            ],
            !!p.invoice && ['Invoice', <Ref>{p.invoice.number}</Ref>],
            !!p.outlet && [
              'Outlet',
              <span style={{ color: C.text }}>
                {p.outlet.name} <Ref dim>/o/{p.outlet.slug}</Ref>
              </span>,
            ],
          ]}
        />
      </PageHead>

      {claiming && <BankClaim paymentId={p.id} receivedNgn={p.receivedNgn ?? p.amountNgn} onClose={() => setClaiming(false)} onDone={(id) => open('dispute', id, { from: here })} />}

      {short > 0 && (
        <div className="mb-5">
          <Notice tone="warn" title={`Arrived ${naira(short)} short`}>
            The customer sent {naira(p.receivedNgn)} of {naira(p.amountNgn)}. A short payment isn't settled by itself - it waits for the team.
          </Notice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="space-y-5 min-w-0">
          <Panel title="Money">
            <Facts
              wide
              rows={[
                ['Asked for', `${naira(p.amountNgn)}${p.currency === 'USD' ? ` - $${p.amountUsd.toLocaleString()} at ₦${p.ngnPerUsd.toLocaleString()} a dollar` : ''}`],
                ['Arrived', p.receivedNgn != null ? naira(p.receivedNgn) : <Dim>Nothing yet</Dim>],
                p.feeNgn != null && ['Our fee', naira(p.feeNgn)],
                p.feeNgn != null && p.receivedNgn != null && ['To the business', naira(p.receivedNgn - p.feeNgn)],
              ]}
            />
          </Panel>
          <Panel title="Customer">
            <Facts wide rows={[['Name', p.customer.name], ['Email', p.customer.email], ['Phone', p.customer.phone]]} />
          </Panel>
          <Panel title="How it was paid">
            <Facts
              wide
              rows={[
                ['Paid from', p.payer ? (p.payer.name ?? p.payer.account ?? '—') : <Dim>Not paid yet</Dim>],
                !!p.payer?.bank && [p.method === 'CRYPTO' ? 'Sent as' : p.method === 'APP' ? 'Through' : 'Their bank', [p.payer.bank, p.method === 'CRYPTO' ? null : p.payer.account].filter(Boolean).join(' · ')],
                !!p.payer?.session && [
                  p.method === 'NAIRA' ? 'Session ID' : 'Transaction',
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Copy text={p.payer.session} />
                    {txUrl(p) && (
                      <a href={txUrl(p)!} target="_blank" rel="noreferrer" style={{ color: C.lime }}>
                        View on explorer ↗
                      </a>
                    )}
                  </span>,
                ],
                !!p.deposit && ['Sent to', <Copy text={p.deposit.address} />],
                !!p.deposit && ['Coin', [p.deposit.coin, p.deposit.network].filter(Boolean).join(' on ')],
                !!p.account && ['Paid into', [p.account.bank, p.account.number].filter(Boolean).join(' · ')],
                !!p.account?.name && ['Account name', p.account.name],
                !!p.providerRef && ['Rail reference', <Copy text={p.providerRef} />],
                ['Open until', <When at={p.expiresAt} full />],
                !!p.lastCheckedAt && ['Last checked', <When at={p.lastCheckedAt} />],
              ]}
            />
          </Panel>
        </div>
        <aside className="space-y-5 min-w-0">
          <Panel title="Settlement" action={s && <TextButton onClick={() => open('settlement', s.id, { from: here })}>Open</TextButton>}>
            {s ? (
              <Facts
                rows={[
                  ['State', <SettleState s={s} />],
                  ['Amount', naira(s.amountNgn)],
                  ['To', placeOf(s)],
                  ['Reference', <Ref>{s.ref}</Ref>],
                  !!s.settledAt && ['Delivered', <When at={s.settledAt} />],
                ]}
              />
            ) : (
              <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
                {p.status === 'UNDERPAID' ? 'None - it arrived short, so nothing is sent until the team decides.' : p.status === 'PAID' ? 'No settlement recorded.' : 'Nothing to settle until it is paid.'}
              </p>
            )}
          </Panel>
          <Panel title="Timeline">
            <Timeline items={timeline} />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

/** The chains an app or crypto payment comes in on, by the name kept with it. */
const CHAIN_TAG: Record<string, string> = { Movement: 'MOVE', Solana: 'SOL', Base: 'BASE', 'BNB Chain': 'BEP20', Arc: 'ARC', Monad: 'MONAD', Arbitrum: 'ARB', Stellar: 'STELLAR', TON: 'TON' }

/** The on-chain transaction of an app or crypto payment, on its chain's explorer. */
function txUrl(p: PayDetail["payment"]): string | null {
  if (!p.payer?.session || (p.method !== 'APP' && p.method !== 'CRYPTO')) return null
  const network = p.deposit?.network ?? p.payer.bank?.match(/ on ([^·]+)/)?.[1]?.trim() ?? p.payer.bank ?? ''
  return explorerUrl(CHAIN_TAG[network] ?? null, p.payer.session)
}
