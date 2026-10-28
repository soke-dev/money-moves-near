/**
 * Direct account: shown only while our team has it switched on for the
 * business. Customers pay into the business's own account by bank transfer,
 * each checkout told apart by its exact amount. Nothing settles by itself:
 * our team pays the business by hand, and this page shows what came in,
 * what has been settled, and the keys that make direct checkouts.
 */
import { useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Check, Copy } from '@/components/icons'
import { Badge, Button, CopyField, Empty, Input, Modal, PageHeader, cx } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { ago, copy, date, dateTime, ngn } from '@/lib/format'

type DirectKey = { id: string; name: string; mode: 'TEST' | 'LIVE'; prefix: string; lastUsedAt: string | null; createdAt: string; revokedAt: string | null }
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
}
type DirectState = {
  account: { number: string; bank: string | null; name: string | null } | null
  limits: { minNgn: number; maxNgn: number; dailyNgn: number | null }
  totals: { receivedNgn: number; settledNgn: number; owedNgn: number; paidCount: number; todayNgn: number }
  payments: DirectPayment[]
  keys: DirectKey[]
}

const STATE: Record<string, [string, 'good' | 'warn' | 'bad' | 'neutral']> = {
  PAID: ['Paid', 'good'],
  UNDERPAID: ['Paid short', 'warn'],
  EXPIRED: ['Expired', 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
  FAILED: ['Failed', 'bad'],
}

export function DirectAccount() {
  const { business } = useSession()
  const path = business?.directAllowed ? `/businesses/${business.id}/direct` : null
  const { data, error, reload } = useApi<DirectState>(path)
  if (!business) return null
  if (!business.directAllowed) return <Navigate to="/dashboard" replace />
  if (error && !data) return <Empty title="This page didn't open." sub={error instanceof ApiError ? error.message : 'Check your connection and try again.'} actions={<Button onClick={() => void reload()}>Try again</Button>} />
  if (!data) return <PageHeader title="Direct account" />
  const t = data.totals
  return (
    <>
      <PageHeader title="Direct account" sub="Customers pay into your own account by bank transfer, for the exact amount of each checkout. We settle what comes in to you, with no fee." />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="rounded-[12px] border border-line bg-card p-4 sm:p-5">
          <div className="text-[13px] text-muted">Your account</div>
          {data.account ? (
            <div className="mt-3 space-y-3">
              <CopyField value={data.account.number} />
              <div className="text-[13.5px] text-fg">
                {[data.account.bank, data.account.name].filter(Boolean).join(', ')}
              </div>
              <p className="text-[12.5px] leading-relaxed text-dim">
                Your checkout shows this to customers with the exact amount to send. A transfer of any other amount can't be matched to a checkout.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">Your account is being opened. It shows here once it's ready.</p>
          )}
        </section>
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line">
          {[
            ['Received', ngn(t.receivedNgn), `${t.paidCount.toLocaleString()} paid`],
            ['Settled to you', ngn(t.settledNgn), null],
            ['On its way to you', ngn(t.owedNgn), null],
            ['Today', ngn(t.todayNgn), data.limits.dailyNgn != null ? `of ${ngn(data.limits.dailyNgn)} a day` : null],
          ].map(([label, value, sub]) => (
            <div key={label} className="bg-card p-4">
              <div className="text-[12.5px] text-muted">{label}</div>
              <div className="tabular mt-1 text-[18px] font-semibold tracking-[-0.02em] text-fg">{value}</div>
              {sub && <div className="mt-0.5 text-[12px] text-dim">{sub}</div>}
            </div>
          ))}
        </section>
      </div>
      <p className="mt-3 text-[12.5px] text-dim">
        Each checkout can be {ngn(data.limits.minNgn)} to {ngn(data.limits.maxNgn)}.
      </p>

      <div className="mt-10">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Payments</h2>
        {data.payments.length === 0 ? (
          <p className="mt-3 text-[13.5px] text-muted">No direct payments yet. Make a checkout with a direct key, then send your customer to its page.</p>
        ) : (
          <div className="mt-3 overflow-hidden rounded-[10px] border border-line bg-card">
            {data.payments.map((p) => {
              const [word, tone] = STATE[p.status] ?? [p.status, 'neutral' as const]
              return (
                <div key={p.id} className="flex items-center gap-3 border-b border-soft px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-fg">{p.payer ?? p.email ?? p.ref}</div>
                    <div className="truncate text-[12px] text-dim">
                      <span className="font-mono">{p.ref}</span> · {dateTime(p.paidAt ?? p.createdAt)}
                    </div>
                  </div>
                  <div className="hidden shrink-0 sm:block">
                    {p.settledAt ? <Badge tone="info">Settled</Badge> : p.status === 'PAID' ? <Badge tone="warn">On its way</Badge> : <Badge tone={tone}>{word}</Badge>}
                  </div>
                  <div className="tabular w-[110px] shrink-0 text-right text-[13.5px] font-medium text-fg">{ngn(p.receivedNgn ?? p.amountNgn)}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <DirectKeys businessId={business.id} keys={data.keys} onChange={() => void reload()} />
      <HowTo minNgn={data.limits.minNgn} maxNgn={data.limits.maxNgn} />
    </>
  )
}

/** Live keys that make direct checkouts only. There's no test mode for these. */
function DirectKeys({ businessId, keys, onChange }: { businessId: string; keys: DirectKey[]; onChange: () => void }) {
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<DirectKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const create = async () => {
    setBusy(true)
    setProblem('')
    try {
      const r = await api<{ key: DirectKey; secret: string }>('POST', `/businesses/${businessId}/direct/keys`, { name: name.trim() })
      setSecret(r.secret)
      setName('')
      onChange()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't make the key. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (k: DirectKey) => {
    setBusy(true)
    try {
      await api('POST', `/businesses/${businessId}/direct/keys/${k.id}/revoke`)
      setRevoking(null)
      onChange()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't revoke it. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Direct keys</h2>
          <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">
            A direct key makes checkouts paid into this account, and reads them and their payments. Nothing else. Your other API keys keep working as they do.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setMaking(true)
            setSecret(null)
            setProblem('')
          }}
        >
          Create direct key
        </Button>
      </div>
      {keys.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-muted">No direct keys yet.</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-[12px] border border-line">
          {keys.map((k, i) => (
            <div key={k.id} className={cx('flex items-start gap-4 px-4 py-3.5 sm:items-center sm:px-5', i > 0 && 'border-t border-line')}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-fg">{k.name}</div>
                <div className="mt-0.5 truncate font-mono text-[12.5px] text-dim">{k.prefix}••••••••</div>
                <div className="mt-1 text-[12px] text-dim">
                  {k.lastUsedAt ? `Used ${ago(k.lastUsedAt)}` : 'Never used'} · Made {date(k.createdAt)}
                </div>
              </div>
              <button onClick={() => setRevoking(k)} className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-muted transition hover:bg-raise hover:text-red">
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {problem && !making && <p className="mt-2 text-[13px] text-red">{problem}</p>}

      <Modal
        open={making}
        onClose={() => setMaking(false)}
        title={secret ? 'Copy your key now' : 'Create a direct key'}
        width={480}
        footer={
          secret ? (
            <Button variant="primary" onClick={() => setMaking(false)}>
              I've copied it
            </Button>
          ) : (
            <>
              <Button onClick={() => setMaking(false)}>Cancel</Button>
              <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void create()}>
                {busy ? 'Making…' : 'Create key'}
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className="space-y-3">
            <p className="text-[13.5px] leading-relaxed text-muted">This is the only time you'll see it. Put it on your server, never in a website or an app.</p>
            <CopyField value={secret} />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-fg">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="My shop's server" autoFocus />
            <p className="text-[12.5px] text-dim">Where it's used, so you know which one to revoke later.</p>
            {problem && <p className="text-[13px] text-red">{problem}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke this key?"
        width={440}
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => revoking && void revoke(revoking)}>
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-muted">
          <span className="font-medium text-fg">{revoking?.name}</span> stops working straight away. Anything still using it will be refused.
        </p>
      </Modal>
    </div>
  )
}

/* ─── Taking payments with a direct key ────────────────────────────── */

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        copy(value)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[12px] font-medium text-[#C9C7BF] hover:text-white"
    >
      {done ? <Check className="size-3.5" strokeWidth={3} /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Code({ label, code }: { label: string; code: string }) {
  return (
    <div className="mt-3 min-w-0 overflow-hidden rounded-[10px] bg-[#121210]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[11.5px] text-[#9A988F]">{label}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-[#E8E6DF]">{code}</pre>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 border-t border-line py-6 first:border-t-0 first:pt-0">
      <span className="tabular flex size-7 items-center justify-center rounded-full border border-line text-[12.5px] font-medium text-fg">{n}</span>
      <div className="min-w-0">
        <h3 className="pt-0.5 text-[15px] font-semibold text-fg">{title}</h3>
        <div className="mt-1.5 space-y-2 text-[13.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  )
}

const Mono = ({ children }: { children: ReactNode }) => <code className="rounded bg-raise px-1 py-px font-mono text-[12.5px] text-fg">{children}</code>

const ERRORS: [string, string][] = [
  ['direct_off', 'Direct payments are switched off for your business right now.'],
  ['direct_daily_limit', "Today's total for direct payments is reached. Try again tomorrow."],
  ['direct_busy', 'Too many open payments share this amount. Try again in a few minutes.'],
  ['direct_key_only', "A direct key was used for something it can't do. Use one of your other API keys for that."],
  ['invalid_request', "Something in the body isn't allowed for direct checkouts, like methods other than bank transfer, accept, settle_to or fee_payer."],
]

/** How to make direct checkouts from a server, start to finish. */
function HowTo({ minNgn, maxNgn }: { minNgn: number; maxNgn: number }) {
  const base = `${window.location.origin}/api/v1`
  const create = `curl -X POST ${base}/checkouts \\
  -H "Authorization: Bearer YOUR_DIRECT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 15000,
    "currency": "NGN",
    "reference": "order_1042",
    "description": "Order 1042",
    "customer": { "email": "ada@example.com", "name": "Ada Obi" },
    "redirect_url": "https://yourshop.com/orders/1042",
    "expires_in": 3600
  }'`
  const reply = `{
  "id": "cm…",
  "object": "checkout",
  "status": "open",
  "url": "${window.location.origin}/pay/dc-…",
  "amount": 15000,
  "currency": "NGN",
  "reference": "order_1042",
  "methods": ["bank_transfer"],
  "payment": null,
  "expires_at": "…"
}`
  const check = `curl ${base}/checkouts/CHECKOUT_ID \\
  -H "Authorization: Bearer YOUR_DIRECT_KEY"`
  return (
    <div className="mt-12">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Take payments with your direct key</h2>
      <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">
        From your server, never a website or an app. Calls go to the same API as your other keys, with your direct key in their place.
      </p>
      <div className="mt-3 flex min-w-0 max-w-[560px] items-center gap-2 rounded-[8px] bg-raise px-3 py-2">
        <span className="shrink-0 text-[12.5px] text-dim">API</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{base}</span>
        <button onClick={() => copy(base)} className="shrink-0 text-[12.5px] font-medium text-muted hover:text-fg">
          Copy
        </button>
      </div>

      <ol className="mt-8">
        <Step n={1} title="Create a direct key">
          <p>Create one above and put it on your server. It's shown once. It makes direct checkouts and reads them and their payments, nothing else.</p>
        </Step>
        <Step n={2} title="Make a checkout for each order">
          <p>
            Send the price in naira, from {ngn(minNgn)} to {ngn(maxNgn)}, with <Mono>"currency": "NGN"</Mono>. Add your own <Mono>reference</Mono> so you can find it again. <Mono>description</Mono>, <Mono>customer</Mono>, <Mono>metadata</Mono>,{' '}
            <Mono>redirect_url</Mono>, and <Mono>expires_in</Mono> (seconds, 300 or more) or <Mono>expires_at</Mono> are optional.
          </p>
          <p>
            Leave out <Mono>methods</Mono>, <Mono>accept</Mono>, <Mono>settle_to</Mono> and <Mono>fee_payer</Mono>. Direct checkouts are bank transfer only, with no fee, so those are refused.
          </p>
          <Code label="Make a checkout" code={create} />
          <details className="group">
            <summary className="mt-3 cursor-pointer list-none text-[13px] font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Show what comes back</span>
              <span className="hidden group-open:inline">Hide it</span>
            </summary>
            <Code label="201 Created" code={reply} />
          </details>
        </Step>
        <Step n={3} title="Send your customer to its url">
          <p>
            The page shows your account number and the exact amount to send. Customers pay from any bank app. Tell them to send exactly the amount shown, to the kobo: that amount is how the transfer is matched to their order.
          </p>
          <p>
            The amount can be a few kobo more than your price, never more than 99 kobo. That happens when another customer has an open payment for the same amount at the same time. Use <Mono>received_ngn</Mono> on the payment for what was actually paid.
          </p>
        </Step>
        <Step n={4} title="Know when it's paid">
          <p>
            A transfer is matched within about a minute of reaching your account. We then send a <Mono>payment.successful</Mono> webhook, the same as for any payment. Add an endpoint in{' '}
            <Link to="/settings/webhooks" className="font-medium text-fg underline underline-offset-2">
              Webhooks
            </Link>{' '}
            and check the <Mono>mm-signature</Mono> header on each one. A short transfer sends <Mono>payment.underpaid</Mono>.
          </p>
          <p>
            You can also ask for the checkout. Its <Mono>status</Mono> turns <Mono>paid</Mono> and its <Mono>payment</Mono> fills in, with <Mono>checkout_reference</Mono> holding your reference.
          </p>
          <Code label="Check a checkout" code={check} />
          <p>Ship the order once it's paid, not when the customer says they've sent it.</p>
        </Step>
        <Step n={5} title="Get settled">
          <p>We pay what comes in to you by hand, with no fee. Each payment shows here as On its way, then Settled.</p>
        </Step>
      </ol>

      <div className="mt-4 rounded-[12px] border border-line bg-card p-4 sm:p-5">
        <div className="text-[14px] font-semibold text-fg">If a call is refused</div>
        <p className="mt-1 text-[13px] text-muted">
          The reply has an <Mono>error</Mono> to show and a <Mono>code</Mono> to act on.
        </p>
        <dl className="mt-3 space-y-2">
          {ERRORS.map(([code, what]) => (
            <div key={code} className="grid gap-x-4 gap-y-0.5 text-[13px] sm:grid-cols-[170px_minmax(0,1fr)]">
              <dt className="font-mono text-[12.5px] text-fg">{code}</dt>
              <dd className="text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
