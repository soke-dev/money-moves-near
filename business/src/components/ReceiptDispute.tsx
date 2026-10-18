/**
 * The dispute on a receipt: report a problem with the payment, then follow it
 * here and answer the business. App and stablecoin payments can't be pulled
 * back, so it's a conversation, and Money Moves sits in on it.
 */
import { useEffect, useState } from 'react'
import { Check } from '@/components/icons'
import { ApiError, api } from '@/lib/api'
import { cx } from '@/components/ui'

type Reason = 'NOT_RECEIVED' | 'DUPLICATE' | 'NOT_AS_DESCRIBED'
interface CustomerDispute {
  ref: string
  status: 'NEEDS_REPLY' | 'UNDER_REVIEW' | 'WON' | 'REFUNDED' | 'LOST'
  reason: string
  openedAt: string
  replyBy: string
  waitUntil: string | null
  outcome: string | null
  closedAt: string | null
  messages: { from: 'CUSTOMER' | 'BUSINESS' | 'US'; body: string; at: string }[]
}
type State = { dispute: CustomerDispute | null; canRaise: boolean; emailNeeded?: boolean }

const REASONS: [Reason, string, string][] = [
  ['NOT_RECEIVED', "I didn't receive it", 'What I paid for never arrived, or the service never happened.'],
  ['DUPLICATE', 'I was charged twice', 'I paid for the same thing more than once.'],
  ['NOT_AS_DESCRIBED', "It wasn't as described", 'What arrived was different from what I paid for.'],
]

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const problemOf = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again in a moment.')

export function ReceiptDispute({ token, business }: { token: string; business: string }) {
  const base = `/pay/r/${encodeURIComponent(token)}/dispute`
  const [s, setS] = useState<State | null>(null)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason>('NOT_RECEIVED')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<State>('GET', base)
      .then(setS)
      .catch(() => setS(null))
  }, [base])

  const run = async (fn: () => Promise<State>) => {
    setBusy(true)
    setError('')
    try {
      setS(await fn())
      setReply('')
      setOpen(false)
    } catch (e) {
      setError(problemOf(e))
    } finally {
      setBusy(false)
    }
  }

  if (!s) return null
  const d = s.dispute

  if (!d) {
    if (!s.canRaise) return null
    if (!open)
      return (
        <p className="mt-5 text-center text-[13px] text-muted">
          Something wrong with this payment?{' '}
          <button onClick={() => setOpen(true)} className="font-medium text-fg underline underline-offset-2">
            Report a problem
          </button>
        </p>
      )
    return (
      <div className="mt-5 rounded-[18px] border border-line bg-card p-6">
        <h2 className="text-[17px] font-semibold text-fg">Report a problem</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          We pass it to {business}, and they have 3 days to reply or refund. You follow it here, and we email you as it moves.
        </p>
        <div className="mt-4 space-y-2">
          {REASONS.map(([id, title, sub]) => (
            <button
              key={id}
              type="button"
              onClick={() => setReason(id)}
              className={cx('flex w-full items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left transition', reason === id ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
            >
              <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', reason === id ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>
                {reason === id && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold text-fg">{title}</span>
                <span className="block text-[12.5px] text-dim">{sub}</span>
              </span>
            </button>
          ))}
        </div>
        <label className="mt-4 block">
          <span className="text-[13px] font-medium text-fg">What happened</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Tell them what went wrong, and what you'd like them to do."
            className="mt-1.5 w-full rounded-[10px] border border-line bg-card px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-dim focus:border-fg"
          />
        </label>
        {s.emailNeeded && (
          <label className="mt-3 block">
            <span className="text-[13px] font-medium text-fg">Your email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="So we can tell you how it goes"
              className="mt-1.5 h-11 w-full rounded-[10px] border border-line bg-card px-3 text-[14px] text-fg outline-none placeholder:text-dim focus:border-fg"
            />
          </label>
        )}
        {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={() => setOpen(false)} className="h-11 flex-1 rounded-full border border-line text-[14px] font-medium text-fg">
            Cancel
          </button>
          <button
            disabled={busy || message.trim().length < 10 || (!!s.emailNeeded && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))}
            onClick={() => void run(() => api<State>('POST', base, { reason, message: message.trim(), ...(s.emailNeeded ? { email: email.trim() } : {}) }))}
            className="h-11 flex-1 rounded-full bg-fg text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send it'}
          </button>
        </div>
      </div>
    )
  }

  const closed = d.status === 'WON' || d.status === 'REFUNDED' || d.status === 'LOST'
  const head =
    d.status === 'NEEDS_REPLY'
      ? `Waiting for ${business}. They have until ${when(d.replyBy)} to reply or refund.`
      : d.status === 'UNDER_REVIEW'
        ? `${business} replied. Accept it, or answer${d.waitUntil ? ` by ${when(d.waitUntil)}` : ''}. If you don't answer, it closes.`
        : (d.outcome ?? 'This dispute is closed.')
  const who = (m: CustomerDispute['messages'][number]) => (m.from === 'CUSTOMER' ? 'You' : m.from === 'BUSINESS' ? business : 'Money Moves')

  return (
    <div className="mt-5 rounded-[18px] border border-line bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-fg">Your dispute</h2>
        <span className="font-mono text-[11.5px] text-dim">{d.ref}</span>
      </div>
      <p className={cx('mt-2 rounded-[10px] px-3.5 py-2.5 text-[13px] leading-relaxed', closed ? 'bg-[#F0EFEA] text-muted' : 'bg-[#FDF6E7] text-[#6E440A]')}>{head}</p>
      <ol className="mt-4 space-y-2.5">
        {d.messages.map((m, i) => (
          <li key={i} className={cx('rounded-[12px] px-3.5 py-3', m.from === 'US' ? 'bg-[#F5F4F0]' : 'border border-line')}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12.5px] font-medium text-fg">{who(m)}</span>
              <span className="shrink-0 text-[11.5px] text-dim">{when(m.at)}</span>
            </div>
            <p className={cx('mt-1 whitespace-pre-wrap text-[13px] leading-relaxed', m.from === 'US' ? 'text-muted' : 'text-fg')}>{m.body}</p>
          </li>
        ))}
      </ol>
      {!closed && (
        <div className="mt-4">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder={d.status === 'UNDER_REVIEW' ? `Answer ${business}` : 'Add something for them'}
            className="w-full rounded-[10px] border border-line bg-card px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-dim focus:border-fg"
          />
          {error && <p className="mt-2 text-[13px] text-red">{error}</p>}
          <div className="mt-3 flex gap-2">
            {d.status === 'UNDER_REVIEW' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Accept ${business}'s reply? Your dispute closes.`)) void run(() => api<State>('POST', `${base}/accept`))
                }}
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line text-[14px] font-medium text-fg disabled:opacity-50"
              >
                <Check className="size-4" strokeWidth={3} /> Accept their reply
              </button>
            )}
            <button
              disabled={busy || !reply.trim()}
              onClick={() => void run(() => api<State>('POST', `${base}/reply`, { message: reply.trim() }))}
              className="h-11 flex-1 rounded-full bg-fg text-[14px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
