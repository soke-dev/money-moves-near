/**
 * Direct account: shown only while our team has it switched on for the
 * business. Customers pay into the business's own account by bank transfer,
 * each checkout told apart by its exact amount. Nothing settles by itself:
 * our team pays the business by hand, and this page shows what came in,
 * what has been settled, and the keys that make direct checkouts.
 */
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Badge, Button, CopyField, Empty, Input, Modal, PageHeader, cx } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { ago, date, dateTime, ngn } from '@/lib/format'

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
