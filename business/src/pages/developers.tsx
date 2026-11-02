/**
 * The developer portal: API keys, webhooks, the events we've sent, the
 * and the requests your keys made: one page, a tab each.
 * Plain tables, a drawer for the detail, and the full guide on the docs site.
 *
 * Keys follow the mode in the sidebar: test keys in test mode, live keys live.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle, Check, Copy, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCcw, Send, Trash2, X } from '@/components/icons'
import { Logo } from '@/components/brand'
import { FilterMenu, RowCount, Rows } from '@/components/table'
import { Badge, Button, Checkbox, CopyField, Drawer, Input, Modal, Toggle, cx } from '@/components/ui'
import { ApiError, LIVE, api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { createStore } from '@/state/store'
import { bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, resolveApiSettlement, useTargets, type ApiChoice } from '@/state/targets'
import { canChoose } from '@/components/Settlement'
import { ApiSettleHint } from '@/components/ApiSettleTo'
import { ago, copy, date, dateTime } from '@/lib/format'
import { DOCS_URL } from '@/lib/links'

type Env = 'test' | 'live'

const h = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')

/** The old in-app docs address now sends you to the docs site. */
export function DocsRedirect() {
  useEffect(() => {
    window.location.replace(DOCS_URL)
  }, [])
  return null
}

/* ─── The portal around every tab ──────────────────────────────────── */

const TABS = [
  ['API keys', '/settings/api-keys'],
  ['Webhooks', '/settings/webhooks'],
  ['Events', '/settings/events'],
  ['Logs', '/settings/logs'],
] as const

function Portal({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { mode } = useSession()
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="display text-[30px] font-semibold leading-tight tracking-[-0.03em] text-fg">Developer portal</h1>
        {mode === 'test' && <Badge tone="warn">Test mode</Badge>}
      </div>
      <nav className="-mx-1 mt-5 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-line px-1 no-scrollbar">
        {TABS.map(([label, to]) => (
          <Link
            key={to}
            to={to}
            className={cx('-mb-px shrink-0 border-b-2 pb-2.5 text-[14px] transition', pathname === to ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="pt-8">
        {children}
      </div>
    </>
  )
}

function Section({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-fg">{title}</h2>
          {sub && <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function PillButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fg px-4 text-[14px] font-medium text-white transition hover:bg-[#2A2A26] active:scale-[0.99]">
      <Plus className="size-4" /> {children}
    </button>
  )
}

const docsLink = (path: string, label = 'Read the docs') => (
  <a href={`${DOCS_URL}${path}`} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">
    {label}
  </a>
)

function Empty({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[#D6D3CA] px-6 py-10 text-center">
      <div className="text-[14.5px] font-medium text-fg">{title}</div>
      <p className="mx-auto mt-1 max-w-[46ch] text-[13px] text-muted">{sub}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/** "Today", "Yesterday", "8 October" - shown on the first row of each day only. */
function dayOf(iso: string) {
  const d = new Date(iso).toDateString()
  if (d === new Date().toDateString()) return 'Today'
  if (d === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
const dayCell = <T extends { at: string }>(rows: T[]) => (r: T, i: number) => (i === 0 || dayOf(rows[i - 1]!.at) !== dayOf(r.at) ? <span className="text-fg">{dayOf(r.at)}</span> : null)

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        copy(value)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1 text-[12.5px] font-medium text-muted hover:text-fg"
    >
      {done ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
      {done ? 'Copied' : label}
    </button>
  )
}

/* ─── API keys, live ───────────────────────────────────────────────── */

type LiveKey = { id: string; name: string; mode: 'TEST' | 'LIVE'; prefix: string; lastUsedAt: string | null; createdAt: string; revokedAt: string | null }

/** Where the API answers: this dashboard's own address. */
const liveApiBase = () => `${window.location.origin}/api/v1`

/**
 * Real keys: test keys in test mode, made and revoked here. The secret is shown
 * once. Live keys open with the live API - until then this says so plainly.
 */
function LiveApiKeys() {
  const { business, mode } = useSession()
  const path = business ? `/businesses/${business.id}/api-keys?mode=${mode === 'live' ? 'live' : 'test'}` : null
  const { data, reload } = useApi<{ keys: LiveKey[] }>(path)
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<LiveKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  if (!business) return null

  const live = mode === 'live'
  if (live && business.verify !== 'verified')
    return (
      <Section title="Live keys" sub="Live keys take real payments from your server.">
        <Empty title="Live keys open once your business is verified." sub="Build and test with test keys now, switch to test mode in the sidebar. Only the key changes when you go live." />
      </Section>
    )
  const word = live ? 'live' : 'test'

  const keys = data?.keys ?? []
  const create = async () => {
    setBusy(true)
    setProblem('')
    try {
      const r = await api<{ key: LiveKey; secret: string }>('POST', `/businesses/${business.id}/api-keys`, { name: name.trim(), mode: live ? 'LIVE' : 'TEST' })
      setSecret(r.secret)
      setName('')
      await reload()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't make the key. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (k: LiveKey) => {
    setBusy(true)
    try {
      await api('POST', `/businesses/${business.id}/api-keys/${k.id}/revoke`)
      setRevoking(null)
      await reload()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't revoke it. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const base = liveApiBase()
  const example = `curl -X POST ${base}/checkouts \\
  -H "Authorization: Bearer sk_${word}_…" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": 5000, "currency": "NGN", "reference": "order_1042"}'`

  return (
    <div className="space-y-10">
      <Section
        title={live ? 'Live keys' : 'Test keys'}
        sub={live ? 'Use a secret key on your server to make checkouts. Live keys take real payments, settled to your business.' : "Use a secret key on your server to make checkouts. Test keys make test checkouts only. They can't take a real payment or move real money."}
        action={
          <PillButton
            onClick={() => {
              setMaking(true)
              setSecret(null)
              setProblem('')
            }}
          >
            Create {word} key
          </PillButton>
        }
      >
        {keys.length === 0 ? (
          <Empty title={`No ${word} keys yet`} sub={live ? 'Create one, then call the API from your server. Every checkout it makes takes real money.' : 'Create one, then call the API from your server. Every checkout it makes is a test checkout.'} />
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-line">
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
      </Section>

      <section className="min-w-0 rounded-[12px] border border-line bg-card p-4 sm:p-5">
        <div className="text-[15px] font-semibold text-fg">Start building</div>
        <div className="mt-3 flex min-w-0 items-center gap-2 rounded-[8px] bg-raise px-3 py-2">
          <span className="shrink-0 text-[12.5px] text-dim">API</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{base}</span>
          <CopyButton value={base} />
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          Call it from your server, never a website or app, and keep keys secret.{!live && ' Test checkouts are paid with the test buttons on the page.'}
        </p>
        <div className="mt-2">
          <ApiSettleHint />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {docsLink('/quickstart', 'Quickstart')}
          {docsLink('/api/checkouts', 'Checkouts API')}
          {docsLink('/sdk', 'SDKs')}
        </div>
        <details className="group mt-4">
          <summary className="cursor-pointer list-none text-[13px] font-medium text-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show an example request</span>
            <span className="hidden group-open:inline">Hide the example</span>
          </summary>
          <div className="mt-3 min-w-0 overflow-hidden rounded-[10px] bg-[#121210]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="font-mono text-[11.5px] text-[#9A988F]">curl</span>
              <CopyButton value={example} />
            </div>
            <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[12px] leading-relaxed text-[#E8E6DF]">{example}</pre>
          </div>
        </details>
      </section>


      <Modal open={making} onClose={() => setMaking(false)} title={secret ? 'Copy your key now' : `Create a ${word} key`} width={480}
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

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revoke this key?" width={440}
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

/* ─── API keys ─────────────────────────────────────────────────────── */

type Access = 'none' | 'read' | 'write'

/** What a key can be allowed to touch. Some things can only be read. */
const RESOURCES: { id: string; label: string; write: boolean }[] = [
  { id: 'balance', label: 'Balance', write: false },
  { id: 'checkouts', label: 'Checkouts', write: true },
  { id: 'payments', label: 'Payments', write: false },
  { id: 'customers', label: 'Customers', write: true },
  { id: 'payment_links', label: 'Payment links', write: true },
  { id: 'invoices', label: 'Invoices', write: true },
  { id: 'deposit_addresses', label: 'Deposit addresses', write: true },
  { id: 'refunds', label: 'Refunds', write: true },
  { id: 'disputes', label: 'Disputes', write: true },
  { id: 'settlements', label: 'Settlements', write: false },
  { id: 'payouts', label: 'Payouts', write: true },
  { id: 'rates', label: 'Rates', write: false },
  { id: 'webhooks', label: 'Webhooks', write: true },
  { id: 'events', label: 'Events', write: false },
]

type ApiKey = { id: string; name: string; tail: string; full: boolean; scopes: Record<string, Access>; created: string; lastUsed?: string; ok: number[]; failed: number[] }

const NONE = [0, 0, 0, 0, 0, 0, 0]

function seedKeys(id: string): ApiKey[] {
  const [biz, env] = id.split(':')
  const used = biz === 'b_movers'
  if (used && env === 'live')
    return [
      { id: 'key_1', name: 'production-server', tail: '77e0', full: true, scopes: {}, created: '2026-09-21T10:12:00Z', lastUsed: h(0.07), ok: [212, 240, 198, 260, 301, 277, 158], failed: [2, 0, 4, 1, 0, 3, 1] },
      {
        id: 'key_2',
        name: 'payout-worker',
        tail: 'b41c',
        full: false,
        scopes: { balance: 'read', payouts: 'write', refunds: 'write', settlements: 'read' },
        created: '2026-09-22T08:10:00Z',
        lastUsed: h(1.1),
        ok: [14, 9, 22, 18, 11, 25, 6],
        failed: [0, 1, 0, 0, 0, 2, 1],
      },
    ]
  return [
    {
      id: 'key_t1',
      name: env === 'live' ? 'live-key' : 'test-key',
      tail: '9a3d',
      full: true,
      scopes: {},
      created: used ? '2026-09-19T14:02:00Z' : new Date().toISOString(),
      lastUsed: used ? h(2) : undefined,
      ok: used ? [40, 62, 18, 77, 51, 90, 33] : NONE,
      failed: used ? [3, 5, 1, 8, 2, 6, 1] : NONE,
    },
  ]
}

const keysStore = createStore<ApiKey[]>('mmb_api_keys_v1', seedKeys)

function useEnv(): Env {
  const { mode } = useSession()
  return mode === 'live' ? 'live' : 'test'
}

function scopeNames(full: boolean, scopes: Record<string, Access>) {
  if (full) return ['Full access']
  return RESOURCES.flatMap((r) => {
    const a = scopes[r.id]
    const name = r.label.toLowerCase()
    return a === 'write' ? [`Read ${name}`, `Write ${name}`] : a === 'read' ? [`Read ${name}`] : []
  })
}

const WORDS: [string[], string[]] = [
  ['quiet', 'amber', 'swift', 'silver', 'north', 'early', 'calm', 'bright', 'green', 'still'],
  ['harbour', 'river', 'lagoon', 'market', 'bridge', 'meadow', 'delta', 'signal', 'ledger', 'canopy'],
]
const randomName = () => `${WORDS[0][Math.floor(Math.random() * 10)]}-${WORDS[1][Math.floor(Math.random() * 10)]}`

const masked = (env: Env, tail: string) => `mmb_${env}_sk_••••${tail}`

export function ApiKeys() {
  return LIVE ? (
    <Portal>
      <LiveApiKeys />
    </Portal>
  ) : (
    <SampleApiKeys />
  )
}

function SampleApiKeys() {
  const { business } = useSession()
  const env = useEnv()
  const [keys = [], setKeys] = keysStore.use(business ? `${business.id}:${env}` : undefined)
  const [sheet, setSheet] = useState<ApiKey | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [rotating, setRotating] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  if (!business) return null
  const open = keys.find((k) => k.id === openId) ?? null
  const pk = `mmb_${env}_pk_${business.merchantId}c7a19e4b`
  const unverified = business.verify !== 'verified'

  return (
    <Portal>
      <Section
        title="API keys"
        sub={<>Authenticate your API requests. Secret keys stay on your server, never in a website or app. {docsLink('/authentication')}</>}
        action={<PillButton onClick={() => setSheet('new')}>Create secret key</PillButton>}
      >
        {unverified && env === 'test' && (
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-[#EBD3A6] bg-[#FDF6E7] px-3.5 py-2.5 text-[13px] text-[#6E440A]">
            <AlertTriangle className="size-4 shrink-0" /> Live keys unlock when your business is verified. Build with test keys now. Only the key changes when you go live.
            <Link to={business.verify === 'review' ? '/settings/compliance' : '/verify'} className="font-medium text-[#5A3808] underline underline-offset-2">
              {business.verify === 'review' ? 'See review status' : 'Verify your business'}
            </Link>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-line px-4 py-3">
          <span className="text-[14px] font-medium text-fg">Publishable key</span>
          <span className="min-w-0 truncate rounded-[6px] bg-raise px-2 py-1 font-mono text-[12.5px] text-muted">{`${pk.slice(0, 18)}…${pk.slice(-6)}`}</span>
          <CopyButton value={pk} />
          <span className="text-[12.5px] text-dim sm:ml-auto">Safe in your website or app. It can only start a checkout.</span>
        </div>

        <Rows
          rows={keys}
          keyOf={(k) => k.id}
          onRow={(k) => setOpenId(k.id)}
          empty={<Empty title="No secret keys" sub="Create one to call the API from your server." action={<PillButton onClick={() => setSheet('new')}>Create secret key</PillButton>} />}
          cols={[
            { head: 'Name', cell: (k) => <span className="font-medium">{k.name}</span> },
            { head: 'Key', cell: (k) => <span className="font-mono text-[13px] text-muted">{masked(env, k.tail)}</span> },
            {
              head: 'Scopes',
              className: 'max-w-[260px]',
              cell: (k) => <span className="block truncate text-muted">{scopeNames(k.full, k.scopes).join(', ')}</span>,
            },
            { head: 'Last used', cell: (k) => <span className="text-muted">{k.lastUsed ? ago(k.lastUsed) : 'Never'}</span> },
            { head: 'Created', right: true, cell: (k) => <span className="whitespace-nowrap text-muted">{dateTime(k.created)}</span> },
          ]}
        />
      </Section>

      <ApiSettlement />

      {sheet && (
        <KeySheet
          env={env}
          editing={sheet === 'new' ? null : sheet}
          onClose={() => setSheet(null)}
          onCreate={(k) => setKeys((all) => [k, ...all])}
          onSave={(k) => setKeys((all) => all.map((x) => (x.id === k.id ? k : x)))}
        />
      )}

      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name ?? ''}>
        {open && (
          <div className="space-y-6">
            <div className="text-[13px] text-muted">
              Created {dateTime(open.created)} · {open.lastUsed ? `last used ${ago(open.lastUsed)}` : 'never used'}
            </div>
            <div className="rounded-[12px] bg-raise px-3.5 py-3">
              <span className="block break-all font-mono text-[13px] text-fg">{masked(env, open.tail)}</span>
              <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
              <button onClick={() => setRotating(open)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-medium text-fg hover:bg-card">
                <RefreshCw className="size-3.5" /> Rotate key
              </button>
              <button onClick={() => setRevoking(open)} className="flex items-center gap-1.5 rounded-full border border-[#EFC4C0] bg-card px-3 py-1.5 text-[13px] font-medium text-red hover:bg-[#FBEAE8]">
                <X className="size-3.5" /> Revoke key
              </button>
              </div>
            </div>
            <div className="border-t border-line pt-5">
              <div className="mb-3 text-[15px] font-semibold text-fg">Scopes</div>
              <div className="flex flex-wrap gap-2">
                {scopeNames(open.full, open.scopes).map((s) => (
                  <span key={s} className="rounded-full bg-raise px-3 py-1.5 text-[13px] text-fg">
                    {s}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex justify-end">
                <Button variant="primary" icon={<Pencil className="size-3.5" />} onClick={() => setSheet(open)}>
                  Edit scopes
                </Button>
              </div>
            </div>
            <div className="border-t border-line pt-5">
              <RequestsChart ok={open.ok} failed={open.failed} />
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!rotating}
        onClose={() => setRotating(null)}
        title={`Rotate ${rotating?.name ?? 'this key'}?`}
        sub="The current key stops working straight away. Anything still using it fails until you swap in the new one. Its name and scopes stay the same."
        footer={
          <>
            <Button onClick={() => setRotating(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const s = `mmb_${env}_sk_${hex(28)}`
                setKeys((all) => all.map((x) => (x.id === rotating!.id ? { ...x, tail: s.slice(-4), lastUsed: undefined } : x)))
                setRotating(null)
                setFresh(s)
              }}
            >
              Rotate key
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">You'll see the new key once, right after this. Have your server's settings open.</p>
      </Modal>

      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking?.name ?? 'this key'}?`}
        sub="It stops working straight away and can't be brought back. Requests made with it are refused with a 401."
        footer={
          <>
            <Button onClick={() => setRevoking(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setKeys((all) => all.filter((x) => x.id !== revoking!.id))
                setRevoking(null)
                setOpenId(null)
              }}
            >
              Revoke key
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">
          Key <span className="font-mono text-fg">{revoking ? masked(env, revoking.tail) : ''}</span>
        </p>
      </Modal>

      {fresh && <FreshKey secret={fresh} onDone={() => setFresh(null)} />}
    </Portal>
  )
}

/** The one time a secret is shown in full. */
function FreshKey({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [stored, setStored] = useState(false)
  return (
    <Modal
      open
      onClose={() => stored && onDone()}
      title="Your new secret key"
      sub="Copy it now and put it on your server. This is the only time you'll see it, after this we only show the last four characters."
      footer={
        <Button variant="primary" disabled={!stored} onClick={onDone}>
          Done
        </Button>
      }
    >
      <SecretBox secret={secret} stored={stored} setStored={setStored} />
    </Modal>
  )
}

function SecretBox({ secret, stored, setStored }: { secret: string; stored: boolean; setStored: (v: boolean) => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-line bg-raise p-3.5">
        <div className="break-all font-mono text-[13px] leading-relaxed text-fg">{secret}</div>
        <Button
          size="sm"
          className="mt-3"
          icon={copied ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
          onClick={() => {
            copy(secret)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy key'}
        </Button>
      </div>
      <Checkbox checked={stored} onChange={setStored}>
        I've saved it somewhere safe
      </Checkbox>
    </div>
  )
}

/** No access / Read / Write - Read only, for things that can't be changed by API. */
function AccessSwitch({ value, write, disabled, onChange }: { value: Access; write: boolean; disabled?: boolean; onChange: (a: Access) => void }) {
  const opts: Access[] = write ? ['none', 'read', 'write'] : ['none', 'read']
  return (
    <div className={cx('inline-flex shrink-0 rounded-[10px] border border-line bg-[#FAFAF8] p-0.5', disabled && 'opacity-50')}>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cx(
            'rounded-[8px] px-3 py-1.5 text-[13px] transition disabled:cursor-not-allowed',
            value === o ? 'bg-card font-medium text-fg shadow-[0_1px_2px_rgba(18,18,16,0.08)] ring-1 ring-line' : 'text-dim hover:text-fg',
          )}
        >
          {o === 'none' ? 'No access' : o === 'read' ? 'Read' : 'Write'}
        </button>
      ))}
    </div>
  )
}

/** Create a key, or change what one can do: a full page that comes up from below. */
function KeySheet({ env, editing, onClose, onCreate, onSave }: { env: Env; editing: ApiKey | null; onClose: () => void; onCreate: (k: ApiKey) => void; onSave: (k: ApiKey) => void }) {
  const [name, setName] = useState(editing?.name ?? randomName)
  const [full, setFull] = useState(editing?.full ?? false)
  const [scopes, setScopes] = useState<Record<string, Access>>(editing?.scopes ?? {})
  const [secret, setSecret] = useState<string | null>(null)
  const [stored, setStored] = useState(false)
  const names = scopeNames(full, scopes)
  const can = !!name.trim() && names.length > 0
  // While the secret is on screen, it can't be closed until it's saved.
  const close = () => {
    if (secret && !stored) return
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const submit = () => {
    const clean = name.trim().replace(/\s+/g, '-')
    if (editing) {
      onSave({ ...editing, name: clean, full, scopes })
      onClose()
      return
    }
    const s = `mmb_${env}_sk_${hex(28)}`
    onCreate({ id: `key_${Date.now()}`, name: clean, tail: s.slice(-4), full, scopes, created: new Date().toISOString(), ok: NONE, failed: NONE })
    setSecret(s)
  }
  const chips = names.length ? (
    <div className="flex flex-wrap gap-1.5">
      {names.map((s) => (
        <span key={s} className="rounded-full bg-raise px-2.5 py-1 text-[12.5px] text-fg">
          {s}
        </span>
      ))}
    </div>
  ) : (
    <div className="text-[13.5px] text-dim">No scopes selected</div>
  )

  return createPortal(
    <div className="sheet-up fixed inset-0 z-[80] grid bg-card lg:grid-cols-2">
      <div className="flex min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[460px] px-5 pb-10 pt-7 sm:pt-9">
            <div className="flex items-center justify-between">
              <Logo />
              <button onClick={close} className="rounded-md p-1.5 text-dim hover:bg-raise hover:text-fg lg:hidden" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>

            {secret ? (
              <div className="mt-12">
                <span className="pop flex size-11 items-center justify-center rounded-full bg-lime text-fg">
                  <Check className="size-5" strokeWidth={3} />
                </span>
                <h1 className="display mt-5 text-[24px] font-semibold tracking-[-0.02em] text-fg">{name.trim()} is ready</h1>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Copy the secret now and put it on your server. This is the only time you'll see it in full.</p>
                <div className="mt-6">
                  <SecretBox secret={secret} stored={stored} setStored={setStored} />
                </div>
              </div>
            ) : (
              <>
                <h1 className="display mt-12 text-[24px] font-semibold tracking-[-0.02em] text-fg">{editing ? `Edit ${editing.name}` : 'Create API key'}</h1>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                  Authenticate requests from your server. Choose what this key can do. No more than it needs. {docsLink('/authentication', 'Learn more')}
                </p>
                <label className="mt-7 block">
                  <span className="mb-1.5 block text-[13px] font-medium text-fg">Name</span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
                </label>
                <div className="mt-5 flex items-center justify-between gap-4 border-b border-line pb-4">
                  <span>
                    <span className="block text-[14px] font-medium text-fg">Full access</span>
                    <span className="block text-[12.5px] text-dim">Everything below, read and write.</span>
                  </span>
                  <Toggle on={full} onChange={setFull} label="Full access" />
                </div>
                <div className="divide-y divide-soft">
                  {RESOURCES.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-4 py-3">
                      <span className="text-[14px] text-fg">{r.label}</span>
                      <AccessSwitch value={full ? (r.write ? 'write' : 'read') : (scopes[r.id] ?? 'none')} write={r.write} disabled={full} onChange={(a) => setScopes((s) => ({ ...s, [r.id]: a }))} />
                    </div>
                  ))}
                </div>
                <div className="mt-6 lg:hidden">
                  <div className="mb-2 text-[13px] font-medium text-fg">Selected scopes</div>
                  {chips}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="border-t border-line px-5 py-4">
          <div className="mx-auto flex max-w-[460px] justify-end gap-2">
            {secret ? (
              <Button variant="primary" size="lg" disabled={!stored} onClick={onClose}>
                Done
              </Button>
            ) : (
              <>
                <Button size="lg" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" size="lg" disabled={!can} onClick={submit}>
                  {editing ? 'Save scopes' : 'Create key'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="relative hidden overflow-y-auto bg-[#F3F2EE] lg:block">
        <button onClick={close} className="absolute right-6 top-6 rounded-md p-1.5 text-muted hover:bg-card hover:text-fg" aria-label="Close">
          <X className="size-5" />
        </button>
        <div className="mx-auto max-w-[420px] space-y-4 px-6 pt-28">
          <div className="rounded-[14px] border border-line bg-card p-6">
            <div className="text-[17px] font-semibold text-fg">Configuration</div>
            <div className="mt-3 divide-y divide-soft text-[14px]">
              {[
                ['Name', name.trim() || '-'],
                ['Mode', env === 'live' ? 'Live' : 'Test'],
                ['Access', full ? 'Full' : `${names.length} ${names.length === 1 ? 'scope' : 'scopes'}`],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-4 py-2.5">
                  <span className="text-muted">{l}</span>
                  <span className="truncate font-medium text-fg">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[14px] border border-line bg-card p-6">
            <div className="mb-3 text-[17px] font-semibold text-fg">Selected scopes</div>
            {chips}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Requests over the last seven days: successful in ink, failed in red. */
function RequestsChart({ ok, failed }: { ok: number[]; failed: number[] }) {
  const total = ok.reduce((a, b) => a + b, 0) + failed.reduce((a, b) => a + b, 0)
  const max = Math.max(1, ...ok.map((v, i) => v + (failed[i] ?? 0)))
  const day = (i: number) => new Date(Date.now() - (ok.length - 1 - i) * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-muted">API requests · 7 days</div>
          <div className="display tabular mt-1 text-[28px] font-semibold leading-none text-fg">{total.toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-3 pt-0.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-fg" /> Successful
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-red" /> Failed
          </span>
        </div>
      </div>
      <div className="relative mt-5 h-[120px]">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: `${(i / 3) * 100}%` }} />
        ))}
        {total === 0 && <span className="absolute inset-0 flex items-center justify-center text-[12.5px] text-dim">No requests yet</span>}
        <div className="relative flex h-full items-end gap-2">
          {ok.map((v, i) => {
            const f = failed[i] ?? 0
            return (
              <div key={i} className="flex h-full flex-1 flex-col justify-end" title={`${day(i)}: ${v} successful, ${f} failed`}>
                {f > 0 && <span className="w-full rounded-t-[3px] bg-red" style={{ height: `${Math.max(2, (f / max) * 100)}%` }} />}
                {v > 0 && <span className={cx('w-full bg-fg', f === 0 && 'rounded-t-[3px]')} style={{ height: `${(v / max) * 100}%` }} />}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] text-dim">
        <span>{day(0)}</span>
        <span>Today</span>
      </div>
    </div>
  )
}

/** Where payments made through the API land: the business wallet by default, or one of the linked Money Moves accounts, or a bank account as naira. */
function ApiSettlement() {
  const { business, mode } = useSession()
  const [targets, setTargets] = useTargets(business?.id)
  const test = mode === 'test'
  // A "Just me" account keeps API payments in its business wallet, like everything else.
  const choose = canChoose(business)
  const linked = mmsOf(targets).filter((m) => m.linked)
  const banks = banksOf(targets).filter((b) => b.verified)
  const saved: ApiChoice = targets?.apiSettle ?? { dest: 'onchain' }
  // Picking only changes the draft; nothing moves until Save.
  const [draft, setDraft] = useState<ApiChoice | null>(null)
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const choice = draft ?? saved
  const where = resolveApiSettlement(targets)
  const same = (a: ApiChoice, b: ApiChoice) => a.dest === b.dest && (a.dest !== 'wallet' || a.mmId === b.mmId) && (a.dest !== 'bank' || a.bankId === b.bankId)
  const dirty = !!draft && !same(draft, saved)
  const pick = (next: ApiChoice) => {
    setDraft(next)
    setJustSaved(null)
  }
  const chosenMm = choice.mmId ?? defaultMmOf(targets)?.id
  const chosenBank = choice.bankId ?? defaultBankOf(targets)?.id
  const bankOf = (id?: string) => banks.find((b) => b.id === (id ?? defaultBankOf(targets)?.id)) ?? banks[0]
  const labelOf = (c: ApiChoice) => {
    if (c.dest === 'onchain') return 'your business wallet'
    if (c.dest === 'bank') {
      const b = bankOf(c.bankId)
      return b ? bankLabel(b) : 'your bank account'
    }
    return linked.find((m) => m.id === c.mmId)?.username ?? defaultMmOf(targets)?.username ?? 'your Money Moves account'
  }
  const now = where.dest === 'onchain' ? 'Business wallet' : where.dest === 'bank' ? (where.bank ? bankLabel(where.bank) : 'Bank account') : (where.mm?.username ?? 'Money Moves')
  const mmOk = choose && (linked.length > 0 || test)
  const bankOk = choose && banks.length > 0
  // The bank they picked was removed, but another checked bank took over.
  const movedBank = saved.dest === 'bank' && !!saved.bankId && where.dest === 'bank' && where.bank?.id !== saved.bankId

  const card = (on: boolean, disabled?: boolean) =>
    cx(
      'flex w-full min-w-0 items-start gap-3 rounded-[12px] border px-3.5 py-3 text-left transition',
      on ? 'border-fg bg-card shadow-[0_0_0_1px_#121210]' : disabled ? 'cursor-not-allowed border-line bg-[#FAFAF8] opacity-70' : 'border-line bg-card hover:border-[#D3D0C7]',
    )
  const dot = (on: boolean) => (
    <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>{on && <span className="size-1.5 rounded-full bg-white" />}</span>
  )
  const chip = (on: boolean) => cx('rounded-full border px-3 py-1 text-[12.5px] font-medium transition', on ? 'border-fg bg-fg text-white' : 'border-line bg-card text-muted hover:text-fg')
  const why = !choose ? 'Registered businesses only' : undefined

  return (
    <section className="mt-12 border-t border-line pt-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[17px] font-semibold text-fg">Where API payments land</span>
        <span className="text-[12.5px] text-dim">
          Now: <span className="font-medium text-fg">{now}</span>
        </span>
      </div>
      <p className="mb-4 text-[13px] text-muted">Every checkout and deposit address you make with the API settles here, the moment it's paid.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button type="button" onClick={() => pick({ dest: 'onchain' })} className={card(choice.dest === 'onchain')}>
          {dot(choice.dest === 'onchain')}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold text-fg">
              Business wallet
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted">Self-custodial, yours alone</span>
          </span>
        </button>
        <button type="button" disabled={!mmOk} onClick={() => pick({ dest: 'wallet', mmId: chosenMm })} className={card(choice.dest === 'wallet', !mmOk)}>
          {dot(choice.dest === 'wallet')}
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[14px] font-semibold text-fg">Money Moves account</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted">{why ?? (mmOk ? 'Lands in the app, ready to spend' : 'Link an account first')}</span>
          </span>
        </button>
        <button type="button" disabled={!bankOk} onClick={() => pick({ dest: 'bank', bankId: chosenBank })} className={card(choice.dest === 'bank', !bankOk)}>
          {dot(choice.dest === 'bank')}
          <span className="min-w-0">
            <span className="block whitespace-nowrap text-[14px] font-semibold text-fg">Bank account</span>
            <span className="mt-0.5 block truncate text-[12.5px] text-muted">{why ?? (bankOk ? 'As naira, the moment it’s paid' : 'Add a bank account first')}</span>
          </span>
        </button>
      </div>

      {choice.dest === 'wallet' && linked.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-muted">Which account?</span>
          {linked.map((m) => (
            <button key={m.id} onClick={() => pick({ dest: 'wallet', mmId: m.id })} className={chip(chosenMm === m.id)}>
              {m.username}
            </button>
          ))}
        </div>
      )}

      {choice.dest === 'bank' && banks.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-muted">Which account?</span>
          {banks.map((b) => (
            <button key={b.id} onClick={() => pick({ dest: 'bank', bankId: b.id })} className={chip(chosenBank === b.id)}>
              {bankLabel(b)}
            </button>
          ))}
        </div>
      )}

      {dirty ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 py-2.5">
          <span className="text-[13px] text-muted">
            API payments will go to <span className="font-medium text-fg">{labelOf(draft!)}</span> once you save.
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setTargets((t) => ({ ...t, apiSettle: draft! }))
                setJustSaved(labelOf(draft!))
                setDraft(null)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : justSaved ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-good">
          <Check className="size-4" strokeWidth={3} /> Saved. New API payments go to {justSaved}.
        </div>
      ) : null}

      {!dirty && (where.fellBack || movedBank) && (
        <div className="mt-3 rounded-[10px] border border-[#EBD3A6] bg-[#FDF6E7] px-3.5 py-2.5 text-[12.5px] text-[#6E440A]">
          {where.fellBack === 'mm'
            ? "The Money Moves account you chose isn't linked any more. It was unlinked here or closed in the app. So API payments are going to your business wallet. Pick another account, or link it again."
            : where.fellBack === 'bank'
              ? 'None of your bank accounts can take payments right now, so API payments are going to your business wallet. Add or check a bank account in Payout places.'
              : `The bank account you chose was removed, so API payments are going to ${now}, your default. Pick another one to change that.`}
        </div>
      )}

      {choice.dest === 'wallet' && (
        <p className="mt-3 text-[12px] leading-relaxed text-dim">
          Linked by the account, not the username. If it changes in the app, payments still arrive and the new name shows here. If the account is closed or unlinked, API payments go back to your business wallet and we email you.
        </p>
      )}
      {choice.dest === 'bank' && (
        <p className="mt-3 text-[12px] leading-relaxed text-dim">
          Each payment is paid out to this account as naira the moment it’s paid. If the account is removed, API payments go to your default bank account, then your business wallet.
        </p>
      )}
    </section>
  )
}

/* ─── Webhooks ─────────────────────────────────────────────────────── */

const EVENT_GROUPS: [string, string[]][] = [
  ['Payments', ['payment.confirming', 'payment.successful', 'payment.underpaid', 'payment.failed']],
  ['Settlements', ['settlement.completed']],
  ['Deposits', ['deposit.received']],
  ['Invoices', ['invoice.paid']],
  ['Refunds', ['refund.created', 'refund.completed']],
  ['Disputes', ['dispute.opened', 'dispute.closed']],
  ['Payouts', ['payout.completed', 'payout.failed']],
]
const ALL_EVENTS = EVENT_GROUPS.flatMap(([, e]) => e)

type Endpoint = { id: string; url: string; note?: string; events: string[]; on: boolean; rate: number; last?: string }

function seedEndpoints(id: string): Endpoint[] {
  const [biz, env] = id.split(':')
  if (biz !== 'b_movers') return []
  return env === 'live'
    ? [{ id: 'we_1', url: 'https://api.moverstech.xyz/webhooks/money-moves', note: 'Production', events: ALL_EVENTS.slice(0, 9), on: true, rate: 99.2, last: h(0.07) }]
    : [{ id: 'we_t1', url: 'https://staging.moverstech.xyz/webhooks/money-moves', note: 'Staging', events: ALL_EVENTS, on: true, rate: 100, last: h(2) }]
}

const endpointsStore = createStore<Endpoint[]>('mmb_endpoints_v1', seedEndpoints)

function EventPicker({ value, onChange, groups = EVENT_GROUPS }: { value: string[]; onChange: (v: string[]) => void; groups?: [string, string[]][] }) {
  return (
    <div className="max-h-[300px] space-y-3 overflow-y-auto rounded-[10px] border border-line p-3.5">
      {groups.map(([group, events]) => {
        const all = events.every((e) => value.includes(e))
        return (
          <div key={group}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-fg">{group}</span>
              <button onClick={() => onChange(all ? value.filter((e) => !events.includes(e)) : [...new Set([...value, ...events])])} className="text-[12px] text-muted hover:text-fg">
                {all ? 'None' : 'All'}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {events.map((e) => (
                <Checkbox key={e} checked={value.includes(e)} onChange={(v) => onChange(v ? [...value, e] : value.filter((x) => x !== e))}>
                  <span className="font-mono text-[12.5px] text-fg">{e}</span>
                </Checkbox>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * A row's "more" menu, drawn over the page rather than inside the table: the
 * table scrolls sideways on narrow screens, and a box that scrolls clips
 * whatever spills out of it, so with one row the menu was cut off under its
 * button. Opens upwards when there isn't room below.
 */
function RowMenu({ items }: { items: { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [at, setAt] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const close = () => setAt(null)
  const toggle = () => {
    if (at) return close()
    const r = button.current?.getBoundingClientRect()
    if (!r) return
    const tall = items.length * 36 + 12
    const right = window.innerWidth - r.right
    setAt(window.innerHeight - r.bottom < tall + 8 && r.top > tall + 8 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right })
  }
  useEffect(() => {
    if (!at) return
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [at])
  return (
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <button ref={button} onClick={toggle} className="flex size-8 items-center justify-center rounded-[7px] text-dim hover:bg-raise hover:text-fg" aria-label="More">
        <MoreHorizontal className="size-4" />
      </button>
      {at &&
        createPortal(
        <div onClick={(e) => e.stopPropagation()}>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div style={{ top: at.top, bottom: at.bottom, right: at.right }} className="fixed z-50 w-48 overflow-hidden rounded-[10px] border border-line bg-card py-1 text-left shadow-[0_12px_32px_-12px_rgba(18,18,16,0.25)]">
            {items.map((it) => (
              <button
                key={it.label}
                onClick={() => {
                  close()
                  it.onClick()
                }}
                className={cx('flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-raise', it.danger ? 'text-red' : 'text-fg')}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </div>,
          document.body,
        )}
    </div>
  )
}

export const Webhooks = () => (LIVE ? <Portal><LiveWebhooks /></Portal> : <SampleWebhooks />)

function SampleWebhooks() {
  const { business } = useSession()
  const env = useEnv()
  const [list = [], setList] = endpointsStore.use(business ? `${business.id}:${env}` : undefined)
  const [editing, setEditing] = useState<Endpoint | 'new' | null>(null)
  const [draft, setDraft] = useState<{ url: string; note: string; events: string[] }>({ url: '', note: '', events: ALL_EVENTS })
  const [pinged, setPinged] = useState<string | null>(null)
  const [retries, setRetries] = useState(true)
  if (!business) return null
  const startEdit = (e: Endpoint | 'new') => {
    setDraft(e === 'new' ? { url: '', note: '', events: ALL_EVENTS } : { url: e.url, note: e.note ?? '', events: e.events })
    setEditing(e)
  }

  return (
    <Portal>
      <Section
        title="Webhooks"
        sub={<>We send an event to your server the moment something happens, a payment confirms, a settlement lands, a dispute opens. {docsLink('/webhooks')}</>}
        action={<PillButton onClick={() => startEdit('new')}>Add endpoint</PillButton>}
      >
        <Rows
          rows={list}
          keyOf={(e) => e.id}
          onRow={(e) => startEdit(e)}
          empty={<Empty title={`No ${env} endpoint yet`} sub="Add the address on your server that should hear about payments." action={<PillButton onClick={() => startEdit('new')}>Add endpoint</PillButton>} />}
          cols={[
            {
              head: 'Endpoint',
              className: 'max-w-[360px]',
              cell: (e) => (
                <span className="block min-w-0">
                  <span className="block truncate font-mono text-[13px] text-fg">{e.url}</span>
                  {pinged === e.id ? <span className="block text-[12px] text-good">Test event sent, 200 OK in 182 ms</span> : e.note && <span className="block text-[12px] text-dim">{e.note}</span>}
                </span>
              ),
            },
            { head: 'Events', cell: (e) => <span className="text-muted">{e.events.length === ALL_EVENTS.length ? 'All events' : `${e.events.length} events`}</span> },
            { head: 'Delivered', cell: (e) => <span className="tabular text-muted">{e.rate}%</span> },
            {
              head: 'Status',
              cell: (e) => (
                <span className="flex items-center gap-2 text-muted">
                  <span className={cx('size-2 rounded-full', e.on ? 'bg-good' : 'bg-dim')} /> {e.on ? 'Active' : 'Off'}
                </span>
              ),
            },
            {
              head: '',
              right: true,
              cell: (e) => (
                <RowMenu
                  items={[
                    { label: 'Send a test event', icon: <Send className="size-3.5 text-dim" />, onClick: () => setPinged(e.id) },
                    { label: 'Edit', icon: <Pencil className="size-3.5 text-dim" />, onClick: () => startEdit(e) },
                    { label: e.on ? 'Turn off' : 'Turn on', icon: <RotateCcw className="size-3.5 text-dim" />, onClick: () => setList((all) => all.map((x) => (x.id === e.id ? { ...x, on: !x.on } : x))) },
                    { label: 'Delete', icon: <Trash2 className="size-3.5" />, onClick: () => setList((all) => all.filter((x) => x.id !== e.id)), danger: true },
                  ]}
                />
              ),
            },
          ]}
        />
        {list.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            What we sent, and what your server said back, is under{' '}
            <Link to="/settings/events" className="font-medium text-fg underline underline-offset-2">
              Events
            </Link>
            .
          </p>
        )}
      </Section>

      <div className="mt-12 grid grid-cols-1 gap-8 border-t border-line pt-8 lg:grid-cols-2">
        <div>
          <div className="text-[15px] font-semibold text-fg">Signing secret</div>
          <p className="mb-3 mt-1 text-[13px] leading-relaxed text-muted">
            Every event carries an <span className="font-mono text-[12px] text-fg">mm-signature</span> header: an HMAC-SHA256 of the timestamp and raw body, made with this secret. Check it before you trust an event.
          </p>
          <CopyField value={`whsec_${env}_${business.merchantId}9d3e1f`} secret />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold text-fg">Retry failed deliveries</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">If your server doesn't answer with a 2xx, we try up to 5 more times over 24 hours, further apart each time.</p>
          </div>
          <Toggle on={retries} onChange={setRetries} label="Retries" />
        </div>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={600}
        title={editing === 'new' ? `Add a ${env} endpoint` : 'Edit endpoint'}
        sub="An HTTPS address on your server. We expect a 2xx back within 10 seconds."
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!/^https:\/\/\S+\.\S+/.test(draft.url) || draft.events.length === 0}
              onClick={() => {
                if (editing === 'new') setList((all) => [...all, { id: `we_${Date.now()}`, url: draft.url, note: draft.note || undefined, events: draft.events, on: true, rate: 100 }])
                else if (editing) setList((all) => all.map((x) => (x.id === editing.id ? { ...x, url: draft.url, note: draft.note || undefined, events: draft.events } : x)))
                setEditing(null)
              }}
            >
              {editing === 'new' ? 'Add endpoint' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">URL</span>
              <Input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value.trim() }))} placeholder="https://yourserver.com/webhooks/money-moves" className="font-mono text-[13px]" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">
                Name <span className="font-normal text-dim">optional</span>
              </span>
              <Input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="Production" />
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">Events to send</div>
            <EventPicker value={draft.events} onChange={(events) => setDraft((d) => ({ ...d, events }))} />
          </div>
        </div>
      </Modal>
    </Portal>
  )
}

/* ─── Events ───────────────────────────────────────────────────────── */

type Delivery = { id: string; endpoint: string; type: string; ref: string; code: number | null; ms: number; at: string }

/** What we've sent lately: [event, reference, your server's answer (null = no answer), ms, hours ago]. */
const SENT: [string, string, number | null, number, number][] = [
  ['payment.successful', 'MMB-48218', 200, 182, 0.2],
  ['payment.confirming', 'MMB-48218', 200, 240, 0.25],
  ['settlement.completed', 'st_8812', 200, 96, 1.4],
  ['payment.failed', 'MMB-48239', 500, 1210, 3],
  ['refund.completed', 'rf_2041', 200, 151, 5],
  ['payment.successful', 'MMB-48246', 200, 133, 7.5],
  ['dispute.opened', 'dp_118', null, 10_000, 9],
  ['invoice.paid', 'INV-0042', 200, 201, 26],
  ['deposit.received', 'MMB-48190', 200, 88, 28],
  ['payout.completed', 'po_5531', 200, 175, 31],
  ['payment.underpaid', 'MMB-48177', 200, 164, 33],
]

function payloadFor(d: Delivery) {
  return JSON.stringify(
    {
      id: d.id,
      type: d.type,
      created_at: d.at,
      data: d.type.startsWith('payment')
        ? { id: `pay_${d.ref.slice(4)}`, reference: d.ref, amount: 120.0, currency: 'USD', method: 'crypto', network: 'Solana', status: d.type.split('.')[1] }
        : { id: d.ref, status: d.type.split('.')[1] },
    },
    null,
    2,
  )
}

function DeliveryStatus({ code }: { code: number | null }) {
  const ok = code !== null && code < 300
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', ok ? 'bg-[#E4F2E8] text-good' : 'bg-[#F9E3E1] text-red')}>
      {ok ? 'Delivered' : code === null ? 'Timed out' : `Failed · ${code}`}
    </span>
  )
}

export const Events = () => (LIVE ? <Portal><LiveEvents /></Portal> : <SampleEvents />)

function SampleEvents() {
  const { business } = useSession()
  const env = useEnv()
  const [endpoints = []] = endpointsStore.use(business ? `${business.id}:${env}` : undefined)
  const [which, setWhich] = useState('all')
  const [open, setOpen] = useState<Delivery | null>(null)
  const [refreshed, setRefreshed] = useState<number | null>(null)
  const [resent, setResent] = useState<string | null>(null)
  const all = useMemo<Delivery[]>(
    () => (endpoints.length ? SENT.map(([type, ref, code, ms, hours], i) => ({ id: `evt_${(0x7b6fd9 + i * 7919).toString(16)}${'9c3c307b3e1a'.slice(0, 8)}`, endpoint: endpoints[0]!.id, type, ref, code, ms, at: h(hours) })) : []),
    [endpoints],
  )
  const rows = which === 'all' ? all : all.filter((d) => d.endpoint === which)
  const host = (u: string) => u.replace(/^https:\/\//, '')

  return (
    <Portal>
      <Section title="Events" sub="Every event we sent to your endpoints, and what your server said back. Open one to see the body or send it again.">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <FilterMenu label="All endpoints" value={which} onChange={setWhich} options={[{ id: 'all', label: 'All endpoints' }, ...endpoints.map((e) => ({ id: e.id, label: e.note ?? host(e.url) }))]} />
          <button onClick={() => setRefreshed(Date.now())} className="flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
            <RefreshCw className="size-4" /> {refreshed ? 'Updated just now' : 'Refresh'}
          </button>
        </div>
        <div className="mb-2 text-[15px] font-semibold text-fg">Delivery attempts</div>
        <Rows
          rows={rows}
          keyOf={(d) => d.id}
          onRow={setOpen}
          empty={<Empty title="Nothing sent yet" sub="Add a webhook endpoint and we'll list every event we send it here." action={<Link to="/settings/webhooks"><Button variant="primary">Add an endpoint</Button></Link>} />}
          cols={[
            { head: 'Date', className: 'w-[130px]', cell: dayCell(rows) },
            { head: 'Status', cell: (d) => <DeliveryStatus code={d.code} /> },
            { head: 'Event', cell: (d) => <span className="font-mono text-[13px]">{d.type}</span> },
            { head: 'Event ID', cell: (d) => <span className="font-mono text-[12.5px] text-muted">{d.id}</span> },
            { head: 'Time', right: true, cell: (d) => <span className="whitespace-nowrap text-muted">{timeOf(d.at)}</span> },
          ]}
        />
        {rows.length > 0 && <RowCount total={rows.length} noun="events" />}
      </Section>

      <Drawer open={!!open} onClose={() => (setOpen(null), setResent(null))} title={open?.type ?? ''}>
        {open && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <DeliveryStatus code={open.code} />
              <span className="text-[13px] text-muted">
                {open.code === null ? 'No answer within 10 seconds' : `Answered in ${open.ms} ms`} · {dateTime(open.at)}
              </span>
            </div>
            {(open.code === null || open.code >= 300) && (
              <div className="rounded-[10px] border border-[#EFC4C0] bg-[#FBEAE8] px-3.5 py-3 text-[13px] leading-relaxed text-[#7D1F19]">Your server didn't answer with a 2xx. We'll try again, or send it now once it's fixed.</div>
            )}
            <div className="text-[13px]">
              <div className="flex justify-between gap-4 border-b border-soft py-2.5">
                <span className="text-dim">Event ID</span>
                <span className="font-mono text-[12.5px] text-fg">{open.id}</span>
              </div>
              <div className="flex justify-between gap-4 border-b border-soft py-2.5">
                <span className="text-dim">Endpoint</span>
                <span className="truncate font-mono text-[12.5px] text-fg">{host(endpoints.find((e) => e.id === open.endpoint)?.url ?? '')}</span>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Headers</div>
              <pre className="overflow-x-auto rounded-[10px] bg-raise p-3.5 font-mono text-[12px] leading-relaxed text-fg">{`content-type: application/json
mm-event: ${open.type}
mm-signature: t=1760000000,v1=5f2c9e1b…a04d`}</pre>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Body</div>
              <pre className="overflow-x-auto rounded-[10px] bg-[#16160F] p-3.5 font-mono text-[12px] leading-relaxed text-[#E8E6DE]">{payloadFor(open)}</pre>
            </div>
            <div className="flex items-center gap-3">
              <Button icon={<Send className="size-4" />} onClick={() => setResent(open.id)}>
                Send again
              </Button>
              {resent === open.id && <span className="text-[13px] text-good">Sent, 200 OK in 164 ms</span>}
            </div>
          </div>
        )}
      </Drawer>
    </Portal>
  )
}

/* ─── Logs ─────────────────────────────────────────────────────────── */

type Method = 'GET' | 'POST' | 'DELETE'
type LogLine = { id: string; method: Method; path: string; code: number; ms: number; at: string; key: string; ip: string }

/** Requests your keys made: [method, path, status, ms, hours ago, which key (0 = first, 1 = second)]. */
const CALLS: [Method, string, number, number, number, number][] = [
  ['POST', '/v1/checkouts', 201, 212, 0.1, 0],
  ['GET', '/v1/checkouts/chk_9Qe2', 200, 64, 0.12, 0],
  ['GET', '/v1/rates', 200, 41, 0.5, 0],
  ['POST', '/v1/payouts/resolve-account', 200, 388, 1.1, 1],
  ['GET', '/v1/payouts/banks', 200, 52, 1.1, 1],
  ['POST', '/v1/payouts/resolve-account', 422, 301, 1.2, 1],
  ['POST', '/v1/payouts', 201, 640, 1.3, 1],
  ['GET', '/v1/balance', 200, 38, 2, 1],
  ['POST', '/v1/refunds', 201, 277, 4, 0],
  ['POST', '/v1/deposit-addresses', 201, 190, 6, 0],
  ['GET', '/v1/payments?status=successful', 200, 120, 25, 0],
  ['DELETE', '/v1/webhooks/we_7', 204, 80, 27, 0],
  ['POST', '/v1/checkouts', 401, 22, 29, 0],
  ['POST', '/v1/payouts', 403, 31, 30, 1],
]

function exchangeFor(l: LogLine): { req?: object; res: object } {
  if (l.code === 401) return { req: { amount: 5000, currency: 'NGN' }, res: { error: { code: 'invalid_key', message: 'This key was rotated or revoked.' } } }
  if (l.code === 403) return { req: { amount: 250000, currency: 'NGN', bank_account: 'bk_1' }, res: { error: { code: 'ip_not_allowed', message: 'This address is not on your IP whitelist.' } } }
  if (l.code === 422) return { req: { bank_code: '058', account_number: '0123984470' }, res: { error: { code: 'account_not_found', message: 'No account with that number at this bank.' } } }
  if (l.path.startsWith('/v1/payouts/resolve')) return { req: { bank_code: '090565', account_number: '2651124878' }, res: { account_name: 'MOVERS DIGITAL TECHNOLOGIES LTD' } }
  if (l.path === '/v1/checkouts' && l.method === 'POST')
    return { req: { amount: 5000, currency: 'NGN', reference: 'order_1042' }, res: { id: 'chk_9Qe2', checkout_url: 'https://pay.usemoneymoves.xyz/c/chk_9Qe2', status: 'open' } }
  if (l.path === '/v1/payouts') return { req: { amount: 250000, currency: 'NGN', bank_account: 'bk_1' }, res: { id: 'po_5531', status: 'processing', fee: 100 } }
  if (l.path === '/v1/balance') return { res: { available: { USDC: 3120.4, USDT: 791.78 }, currency: 'USD' } }
  if (l.method === 'DELETE') return { res: {} }
  if (l.method === 'POST') return { req: { reference: 'order_1043' }, res: { id: `${l.path.split('/')[2]?.slice(0, 3)}_${hex(6)}`, status: 'created' } }
  return { res: { object: 'list', has_more: false, data: ['…'] } }
}

function StatusPill({ code }: { code: number }) {
  const ok = code < 300
  return <span className={cx('inline-flex w-[64px] justify-center rounded-full py-0.5 font-mono text-[11.5px] font-medium', ok ? 'bg-[#E4F2E8] text-good' : 'bg-[#F9E3E1] text-red')}>{`${code} ${ok ? 'OK' : 'ERR'}`}</span>
}

const METHOD_COLOR: Record<Method, string> = { GET: 'text-blue', POST: 'text-accent', DELETE: 'text-red' }

export const Logs = () => (LIVE ? <Portal><LiveLogs /></Portal> : <SampleLogs />)

function SampleLogs() {
  const { business } = useSession()
  const env = useEnv()
  const [keys = []] = keysStore.use(business ? `${business.id}:${env}` : undefined)
  const [status, setStatus] = useState<'all' | 'ok' | 'failed'>('all')
  const [method, setMethod] = useState<'all' | Method>('all')
  const [range, setRange] = useState<'30d' | '7d' | 'today'>('30d')
  const [open, setOpen] = useState<LogLine | null>(null)
  // Requests come from keys that have been used - a key made a minute ago has none.
  const usedKeys = keys.filter((k) => k.lastUsed)
  const used = usedKeys.length > 0
  const all = useMemo<LogLine[]>(
    () =>
      used
        ? CALLS.map(([m, path, code, ms, hours, k], i) => ({
            id: `req_${(0x51a9 + i * 131).toString(16)}`,
            method: m,
            path,
            code,
            ms,
            at: h(hours),
            key: code === 401 ? 'A revoked key' : (usedKeys[k]?.name ?? usedKeys[0]?.name ?? 'key'),
            ip: code === 403 ? '41.58.112.9' : k === 1 ? '152.55.184.240' : '129.222.206.137',
          }))
        : [],
    [used, usedKeys],
  )
  const rows = all.filter(
    (l) =>
      (status === 'all' || (status === 'ok' ? l.code < 300 : l.code >= 300)) &&
      (method === 'all' || l.method === method) &&
      (range === '30d' || (range === 'today' ? dayOf(l.at) === 'Today' : Date.now() - +new Date(l.at) < 7 * 86_400_000)),
  )
  const x = open ? exchangeFor(open) : null

  return (
    <Portal>
      <Section title="Logs" sub="Every request your keys made in the last 30 days. Open one to see what was sent and what came back.">
        <div className="mb-5 flex flex-wrap gap-2">
          <FilterMenu
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'all', label: 'All statuses' },
              { id: 'ok', label: 'Succeeded' },
              { id: 'failed', label: 'Failed' },
            ]}
          />
          <FilterMenu
            label="Method"
            value={method}
            onChange={setMethod}
            options={[
              { id: 'all', label: 'All methods' },
              { id: 'GET', label: 'GET' },
              { id: 'POST', label: 'POST' },
              { id: 'DELETE', label: 'DELETE' },
            ]}
          />
          <FilterMenu
            label="Date"
            value={range}
            onChange={setRange}
            options={[
              { id: '30d', label: 'Last 30 days' },
              { id: '7d', label: 'Last 7 days' },
              { id: 'today', label: 'Today' },
            ]}
          />
        </div>
        <Rows
          rows={rows}
          keyOf={(l) => l.id}
          onRow={setOpen}
          empty={
            used ? (
              <Empty title="No requests match" sub="Try another status, method or date." />
            ) : (
              <Empty title="No requests yet" sub="When your server calls the API with one of your keys, every request shows up here." action={<Link to="/settings/api-keys"><Button variant="primary">See your keys</Button></Link>} />
            )
          }
          cols={[
            { head: 'Date', className: 'w-[130px]', cell: dayCell(rows) },
            {
              head: 'Request',
              cell: (l) => (
                <span className="flex min-w-0 items-center gap-3">
                  <StatusPill code={l.code} />
                  <span className={cx('w-[52px] shrink-0 font-mono text-[12.5px] font-semibold', METHOD_COLOR[l.method])}>{l.method}</span>
                  <span className="truncate font-mono text-[13px] text-fg">{l.path}</span>
                </span>
              ),
            },
            { head: 'Key', cell: (l) => <span className="text-muted">{l.key}</span> },
            { head: 'Time', right: true, cell: (l) => <span className="whitespace-nowrap text-muted">{timeOf(l.at)}</span> },
          ]}
        />
        {rows.length > 0 && <RowCount total={rows.length} noun="requests" />}
      </Section>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${open.method} ${open.path.split('?')[0]}` : ''}>
        {open && x && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill code={open.code} />
              <span className="text-[13px] text-muted">
                {open.ms} ms · {dateTime(open.at)}
              </span>
            </div>
            <div className="text-[13px]">
              {[
                ['Request ID', open.id, true],
                ['Key', open.key, false],
                ['From', open.ip, true],
              ].map(([l, v, mono]) => (
                <div key={String(l)} className="flex justify-between gap-4 border-b border-soft py-2.5">
                  <span className="text-dim">{l}</span>
                  <span className={cx('text-fg', mono && 'font-mono text-[12.5px]')}>{v}</span>
                </div>
              ))}
            </div>
            {x.req && (
              <div>
                <div className="mb-2 text-[13px] font-semibold text-fg">Request body</div>
                <pre className="overflow-x-auto rounded-[10px] bg-raise p-3.5 font-mono text-[12px] leading-relaxed text-fg">{JSON.stringify(x.req, null, 2)}</pre>
              </div>
            )}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Response</div>
              <pre className="overflow-x-auto rounded-[10px] bg-[#16160F] p-3.5 font-mono text-[12px] leading-relaxed text-[#E8E6DE]">{JSON.stringify(x.res, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </Portal>
  )
}

/* ─── Webhooks, Events and Logs, live ──────────────────────────────── */

type LiveEndpoint = { id: string; url: string; note: string | null; events: string[]; allEvents: boolean; enabled: boolean; createdAt: string; deliveredPct: number | null; lastAt: string | null; failingSince: string | null; autoDisabledAt: string | null }
type LiveDelivery = {
  id: string
  eventId: string
  type: string | null
  endpointId: string
  endpointUrl: string | null
  endpointNote: string | null
  status: 'PENDING' | 'SENDING' | 'SUCCEEDED' | 'FAILED'
  attempts: number
  responseCode: number | null
  durationMs: number | null
  error: string | null
  nextAt: string | null
  createdAt: string
  deliveredAt: string | null
}
type LiveLog = { id: string; method: string; path: string; status: number; durationMs: number; ip: string | null; key: string | null; createdAt: string }
type LiveLogDetail = LiveLog & { idempotencyKey: string | null; requestBody: unknown; responseBody: unknown }
type WebhooksData = { endpoints: LiveEndpoint[]; groups: [string, string[]][]; retries: boolean; rolledAt: string }

const devBase = (businessId: string) => `/businesses/${businessId}/developers`
const problemOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
const hostOf = (u: string | null) => (u ?? '').replace(/^https:\/\//, '')
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2))

/** What became of one delivery, in a few words. */
function deliveryLine(d: LiveDelivery) {
  if (d.status === 'SUCCEEDED') return `Delivered, ${d.responseCode} in ${d.durationMs} ms`
  if (d.status === 'PENDING' || d.status === 'SENDING') return d.attempts && d.nextAt ? `Trying again at ${timeOf(d.nextAt)}` : 'Sending'
  return d.responseCode ? `Failed, your server answered ${d.responseCode}` : d.error || 'No answer within 10 seconds'
}

function LiveDeliveryStatus({ d }: { d: Pick<LiveDelivery, 'status' | 'responseCode' | 'attempts'> }) {
  const ok = d.status === 'SUCCEEDED'
  const waiting = d.status === 'PENDING' || d.status === 'SENDING'
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', ok ? 'bg-[#E4F2E8] text-good' : waiting ? 'bg-raise text-muted' : 'bg-[#F9E3E1] text-red')}>
      {ok ? 'Delivered' : waiting ? (d.attempts ? 'Retrying' : 'Sending') : d.responseCode ? `Failed · ${d.responseCode}` : 'No answer'}
    </span>
  )
}

function DetailRows({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <div className="text-[13px]">
      {rows.map(([l, v, mono]) => (
        <div key={l} className="flex justify-between gap-4 border-b border-soft py-2.5">
          <span className="shrink-0 text-dim">{l}</span>
          <span className={cx('min-w-0 truncate text-right text-fg', mono && 'font-mono text-[12.5px]')}>{v}</span>
        </div>
      ))}
    </div>
  )
}

/** A list that carries on past its first page. Starts again whenever its address changes. */
function usePaged<T>(path: string | null, key: string) {
  const { data, loading, reload } = useApi<Record<string, unknown> & { next: string | null }>(path)
  const [more, setMore] = useState<T[]>([])
  const [next, setNext] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setMore([])
    setNext(undefined)
  }, [path])
  const first = ((data?.[key] as T[] | undefined) ?? []) as T[]
  const cursor = next === undefined ? (data?.next ?? null) : next
  const loadMore = async () => {
    if (!cursor || !path) return
    setBusy(true)
    try {
      const r = await api<Record<string, unknown> & { next: string | null }>('GET', `${path}&after=${cursor}`)
      setMore((m) => [...m, ...((r[key] as T[]) ?? [])])
      setNext(r.next)
    } finally {
      setBusy(false)
    }
  }
  const refresh = () => {
    setMore([])
    setNext(undefined)
    return reload()
  }
  return { rows: [...first, ...more], loading, cursor, busy, loadMore, refresh }
}

function LiveWebhooks() {
  const { business } = useSession()
  const env = useEnv()
  const base = business ? devBase(business.id) : null
  const { data, loading, reload } = useApi<WebhooksData>(base && `${base}/webhooks?mode=${env}`)
  const [editing, setEditing] = useState<LiveEndpoint | 'new' | null>(null)
  const [draft, setDraft] = useState<{ url: string; note: string; events: string[] }>({ url: '', note: '', events: [] })
  const [pinged, setPinged] = useState<{ id: string; ok: boolean; text: string } | null>(null)
  const [removing, setRemoving] = useState<LiveEndpoint | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [rolling, setRolling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // Each mode has its own secret: never leave the other mode's on screen.
  useEffect(() => setSecret(null), [env])
  if (!business || !base) return null
  const mode = env === 'live' ? 'LIVE' : 'TEST'
  const groups = data?.groups ?? []
  const all = groups.flatMap(([, e]) => e)
  const list = data?.endpoints ?? []

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setProblem('')
    try {
      await fn()
      return true
    } catch (e) {
      setProblem(problemOf(e, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }
  const startEdit = (e: LiveEndpoint | 'new') => {
    setProblem('')
    setDraft(e === 'new' ? { url: '', note: '', events: all } : { url: e.url, note: e.note ?? '', events: e.events })
    setEditing(e)
  }
  const save = async () => {
    const ok = await run(async () => {
      if (editing === 'new') await api('POST', `${base}/webhooks`, { mode, url: draft.url, note: draft.note.trim() || undefined, events: draft.events })
      else if (editing) await api('PATCH', `${base}/webhooks/${editing.id}`, { url: draft.url, note: draft.note.trim() || null, events: draft.events })
      await reload()
    }, "Couldn't save the endpoint. Try again.")
    if (ok) setEditing(null)
  }
  const test = async (e: LiveEndpoint) => {
    setPinged({ id: e.id, ok: true, text: 'Sending a test event…' })
    try {
      const r = await api<{ delivery: LiveDelivery }>('POST', `${base}/webhooks/${e.id}/test`)
      setPinged({ id: e.id, ok: r.delivery.status === 'SUCCEEDED', text: deliveryLine(r.delivery) })
      void reload()
    } catch (err) {
      setPinged({ id: e.id, ok: false, text: problemOf(err, "Couldn't send the test event.") })
    }
  }
  const toggle = (e: LiveEndpoint) =>
    run(async () => {
      await api('PATCH', `${base}/webhooks/${e.id}`, { enabled: !e.enabled })
      await reload()
    }, "Couldn't change it. Try again.")
  const remove = async (e: LiveEndpoint) => {
    const ok = await run(async () => {
      await api('DELETE', `${base}/webhooks/${e.id}`)
      await reload()
    }, "Couldn't remove it. Try again.")
    if (ok) setRemoving(null)
  }
  const reveal = () =>
    run(async () => {
      const r = await api<{ secret: string }>('GET', `${base}/webhooks/secret?mode=${env}`)
      setSecret(r.secret)
    }, "Couldn't show the secret. Try again.")
  const roll = async () => {
    const ok = await run(async () => {
      const r = await api<{ secret: string }>('POST', `${base}/webhooks/secret/roll`, { mode })
      setSecret(r.secret)
      await reload()
    }, "Couldn't make a new secret. Try again.")
    if (ok) setRolling(false)
  }
  const setRetries = (on: boolean) =>
    run(async () => {
      await api('PUT', `${base}/webhooks/settings`, { mode, retries: on })
      await reload()
    }, "Couldn't change retries. Try again.")

  return (
    <>
      <Section
        title="Webhooks"
        sub={<>We send an event to your server the moment something happens: a payment succeeds, a settlement lands, a refund completes. {docsLink('/webhooks')}</>}
        action={<PillButton onClick={() => startEdit('new')}>Add endpoint</PillButton>}
      >
        <Rows
          rows={list}
          loading={loading}
          keyOf={(e) => e.id}
          onRow={(e) => startEdit(e)}
          empty={<Empty title={`No ${env} endpoint yet`} sub="Add the address on your server that should hear about payments." action={<PillButton onClick={() => startEdit('new')}>Add endpoint</PillButton>} />}
          cols={[
            {
              head: 'Endpoint',
              className: 'max-w-[360px]',
              cell: (e) => (
                <span className="block min-w-0">
                  <span className="block truncate font-mono text-[13px] text-fg">{e.url}</span>
                  {pinged?.id === e.id ? <span className={cx('block text-[12px]', pinged.ok ? 'text-good' : 'text-red')}>{pinged.text}</span> : e.note && <span className="block text-[12px] text-dim">{e.note}</span>}
                </span>
              ),
            },
            { head: 'Events', cell: (e) => <span className="text-muted">{e.allEvents ? 'All events' : `${e.events.length} event${e.events.length === 1 ? '' : 's'}`}</span> },
            { head: 'Delivered', cell: (e) => <span className="tabular text-muted">{e.deliveredPct == null ? 'None yet' : `${e.deliveredPct}%`}</span> },
            {
              head: 'Status',
              cell: (e) => (
                <span className="block">
                  <span className="flex items-center gap-2 text-muted">
                    <span className={cx('size-2 rounded-full', !e.enabled ? (e.autoDisabledAt ? 'bg-red' : 'bg-dim') : e.failingSince ? 'bg-amber' : 'bg-good')} />
                    {!e.enabled ? (e.autoDisabledAt ? 'Turned off' : 'Off') : e.failingSince ? 'Failing' : 'Active'}
                  </span>
                  {e.enabled && e.failingSince && <span className="block text-[12px] text-dim">Since {ago(e.failingSince)}</span>}
                  {!e.enabled && e.autoDisabledAt && <span className="block text-[12px] text-dim">Kept failing for 3 days</span>}
                </span>
              ),
            },
            {
              head: '',
              right: true,
              cell: (e) => (
                <RowMenu
                  items={[
                    ...(e.enabled ? [{ label: 'Send a test event', icon: <Send className="size-3.5 text-dim" />, onClick: () => void test(e) }] : []),
                    { label: 'Edit', icon: <Pencil className="size-3.5 text-dim" />, onClick: () => startEdit(e) },
                    { label: e.enabled ? 'Turn off' : 'Turn on', icon: <RotateCcw className="size-3.5 text-dim" />, onClick: () => void toggle(e) },
                    { label: 'Remove', icon: <Trash2 className="size-3.5" />, onClick: () => setRemoving(e), danger: true },
                  ]}
                />
              ),
            },
          ]}
        />
        {problem && !editing && !removing && !rolling && <p className="mt-3 text-[13px] text-red">{problem}</p>}
        {list.length > 0 && (
          <p className="mt-3 text-[13px] text-muted">
            What we sent, and what your server said back, is under{' '}
            <Link to="/settings/events" className="font-medium text-fg underline underline-offset-2">
              Events
            </Link>
            .
          </p>
        )}
      </Section>

      <div className="mt-12 grid grid-cols-1 gap-8 border-t border-line pt-8 lg:grid-cols-2">
        <div>
          <div className="text-[15px] font-semibold text-fg">Signing secret</div>
          <p className="mb-3 mt-1 text-[13px] leading-relaxed text-muted">
            Every event carries an <span className="font-mono text-[12px] text-fg">mm-signature</span> header: an HMAC-SHA256 of the timestamp and raw body, made with this secret. Check it before you trust an event.
          </p>
          {secret ? (
            <CopyField value={secret} />
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void reveal()}>
              Show {env} secret
            </Button>
          )}
          <button onClick={() => (setProblem(''), setRolling(true))} className="mt-2.5 block text-[13px] font-medium text-muted underline underline-offset-2 hover:text-fg">
            Make a new secret
          </button>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold text-fg">Retry failed deliveries</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">If your server doesn't answer with a 2xx, we try up to 5 more times over about a day, further apart each time.</p>
          </div>
          <Toggle on={data?.retries ?? true} disabled={busy || !data} onChange={(on) => void setRetries(on)} label="Retries" />
        </div>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        width={600}
        title={editing === 'new' ? `Add a ${env} endpoint` : 'Edit endpoint'}
        sub="An HTTPS address on your server. We expect a 2xx back within 10 seconds."
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" disabled={busy || !/^https:\/\/\S+\.\S+/.test(draft.url) || draft.events.length === 0} onClick={() => void save()}>
              {busy ? 'Saving…' : editing === 'new' ? 'Add endpoint' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">URL</span>
              <Input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value.trim() }))} placeholder="https://yourserver.com/webhooks/money-moves" className="font-mono text-[13px]" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-fg">
                Name <span className="font-normal text-dim">optional</span>
              </span>
              <Input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value.slice(0, 60) }))} placeholder="Production" />
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">Events to send</div>
            <EventPicker groups={groups} value={draft.events} onChange={(events) => setDraft((d) => ({ ...d, events }))} />
          </div>
          {problem && <p className="text-[13px] text-red">{problem}</p>}
        </div>
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove this endpoint?"
        width={440}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => removing && void remove(removing)}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-muted">
          <span className="break-all font-mono text-[12.5px] text-fg">{removing?.url}</span> stops hearing about events straight away. What we already sent it stays under Events.
        </p>
        {problem && <p className="mt-2 text-[13px] text-red">{problem}</p>}
      </Modal>

      <Modal
        open={rolling}
        onClose={() => setRolling(false)}
        title={`Make a new ${env} secret?`}
        width={460}
        footer={
          <>
            <Button onClick={() => setRolling(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={() => void roll()}>
              Make a new secret
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-muted">Every event from now on is signed with the new secret, and the old one stops working at once. Put the new one on your server straight after.</p>
        {problem && <p className="mt-2 text-[13px] text-red">{problem}</p>}
      </Modal>
    </>
  )
}

function LiveEvents() {
  const { business } = useSession()
  const env = useEnv()
  const base = business ? devBase(business.id) : null
  const { data: hooks } = useApi<WebhooksData>(base && `${base}/webhooks?mode=${env}`)
  const [which, setWhich] = useState('all')
  const list = usePaged<LiveDelivery>(base ? `${base}/deliveries?mode=${env}&endpoint=${which}` : null, 'deliveries')
  const [refreshed, setRefreshed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: detail, reload: reloadDetail } = useApi<{ delivery: LiveDelivery & { responseBody: string | null }; event: unknown; tries: LiveDelivery[] }>(base && openId ? `${base}/deliveries/${openId}` : null)
  const [resent, setResent] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  if (!business || !base) return null
  const endpoints = hooks?.endpoints ?? []
  const rows = list.rows.map((d) => ({ ...d, at: d.createdAt }))
  const resend = async (id: string) => {
    setBusy(true)
    setResent(null)
    try {
      const r = await api<{ delivery: LiveDelivery }>('POST', `${base}/deliveries/${id}/resend`)
      setResent({ ok: r.delivery.status === 'SUCCEEDED', text: deliveryLine(r.delivery) })
      void list.refresh()
      void reloadDetail()
    } catch (e) {
      setResent({ ok: false, text: problemOf(e, "Couldn't send it again.") })
    } finally {
      setBusy(false)
    }
  }
  const d = detail?.delivery
  const failed = d && (d.status === 'FAILED' || (d.status === 'PENDING' && d.attempts > 0))

  return (
    <>
      <Section title="Events" sub="Every event we sent to your endpoints, and what your server said back. Open one to see the body or send it again.">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <FilterMenu label="All endpoints" value={which} onChange={setWhich} options={[{ id: 'all', label: 'All endpoints' }, ...endpoints.map((e) => ({ id: e.id, label: e.note || hostOf(e.url) }))]} />
          <button onClick={() => void list.refresh().then(() => setRefreshed(true))} className="flex items-center gap-1.5 text-[13.5px] font-medium text-accent hover:underline">
            <RefreshCw className="size-4" /> {refreshed ? 'Updated just now' : 'Refresh'}
          </button>
        </div>
        <div className="mb-2 text-[15px] font-semibold text-fg">Delivery attempts</div>
        <Rows
          rows={rows}
          loading={list.loading}
          keyOf={(r) => r.id}
          onRow={(r) => {
            setResent(null)
            setOpenId(r.id)
          }}
          empty={
            <Empty
              title="Nothing sent yet"
              sub={endpoints.length ? 'Events show up here the moment something happens, or send a test event from Webhooks.' : "Add a webhook endpoint and we'll list every event we send it here."}
              action={
                <Link to="/settings/webhooks">
                  <Button variant="primary">{endpoints.length ? 'Go to Webhooks' : 'Add an endpoint'}</Button>
                </Link>
              }
            />
          }
          cols={[
            { head: 'Date', className: 'w-[130px]', cell: dayCell(rows) },
            { head: 'Status', cell: (r) => <LiveDeliveryStatus d={r} /> },
            { head: 'Event', cell: (r) => <span className="font-mono text-[13px]">{r.type}</span> },
            { head: 'Endpoint', cell: (r) => <span className="block max-w-[220px] truncate text-muted">{r.endpointNote || hostOf(r.endpointUrl)}</span> },
            { head: 'Time', right: true, cell: (r) => <span className="whitespace-nowrap text-muted">{timeOf(r.at)}</span> },
          ]}
        />
        {rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <RowCount total={rows.length} noun="deliveries" />
            {list.cursor && (
              <Button size="sm" disabled={list.busy} onClick={() => void list.loadMore()}>
                Load more
              </Button>
            )}
          </div>
        )}
      </Section>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={d?.type ?? ''}>
        {d && detail && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <LiveDeliveryStatus d={d} />
              <span className="text-[13px] text-muted">
                {deliveryLine(d)} · {dateTime(d.createdAt)}
              </span>
            </div>
            {failed && (
              <div className="rounded-[10px] border border-[#EFC4C0] bg-[#FBEAE8] px-3.5 py-3 text-[13px] leading-relaxed text-[#7D1F19]">
                Your server didn't answer with a 2xx. {d.status === 'PENDING' ? "We'll try again, or send it now once it's fixed." : 'Send it again once your server is fixed.'}
              </div>
            )}
            <DetailRows
              rows={[
                ['Event ID', d.eventId, true],
                ['Endpoint', hostOf(d.endpointUrl), true],
                ['Tries', String(detail.tries.reduce((n, t) => n + t.attempts, 0))],
                ...(d.status === 'PENDING' && d.nextAt ? ([['Next try', dateTime(d.nextAt)]] as [string, ReactNode][]) : []),
              ]}
            />
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Headers</div>
              <pre className="overflow-x-auto rounded-[10px] bg-raise p-3.5 font-mono text-[12px] leading-relaxed text-fg">{`content-type: application/json
mm-event: ${d.type}
mm-event-id: ${d.eventId}
mm-signature: t=…,v1=…   (signed with your ${env} secret)`}</pre>
            </div>
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Body</div>
              <pre className="max-h-[360px] overflow-auto rounded-[10px] bg-[#16160F] p-3.5 font-mono text-[12px] leading-relaxed text-[#E8E6DE]">{pretty(detail.event)}</pre>
            </div>
            {d.responseBody && (
              <div>
                <div className="mb-2 text-[13px] font-semibold text-fg">Your server said</div>
                <pre className="max-h-[200px] overflow-auto rounded-[10px] bg-raise p-3.5 font-mono text-[12px] leading-relaxed text-fg">{d.responseBody}</pre>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button icon={<Send className="size-4" />} disabled={busy} onClick={() => void resend(d.id)}>
                Send again
              </Button>
              {resent && <span className={cx('text-[13px]', resent.ok ? 'text-good' : 'text-red')}>{resent.text}</span>}
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}

function LiveLogs() {
  const { business } = useSession()
  const env = useEnv()
  const base = business ? devBase(business.id) : null
  const [status, setStatus] = useState<'all' | 'ok' | 'failed'>('all')
  const [method, setMethod] = useState<'all' | Method>('all')
  const [range, setRange] = useState<'30d' | '7d' | 'today'>('30d')
  const list = usePaged<LiveLog>(base ? `${base}/logs?mode=${env}&range=${range}${status === 'all' ? '' : `&status=${status}`}${method === 'all' ? '' : `&method=${method}`}` : null, 'logs')
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: detail } = useApi<{ log: LiveLogDetail }>(base && openId ? `${base}/logs/${openId}` : null)
  if (!business || !base) return null
  const rows = list.rows.map((l) => ({ ...l, at: l.createdAt }))
  const filtered = status !== 'all' || method !== 'all' || range !== '30d'
  const l = detail?.log

  return (
    <>
      <Section title="Logs" sub="Every request your keys made in the last 30 days. Open one to see what was sent and what came back.">
        <div className="mb-5 flex flex-wrap gap-2">
          <FilterMenu
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { id: 'all', label: 'All statuses' },
              { id: 'ok', label: 'Succeeded' },
              { id: 'failed', label: 'Failed' },
            ]}
          />
          <FilterMenu
            label="Method"
            value={method}
            onChange={setMethod}
            options={[
              { id: 'all', label: 'All methods' },
              { id: 'GET', label: 'GET' },
              { id: 'POST', label: 'POST' },
              { id: 'DELETE', label: 'DELETE' },
            ]}
          />
          <FilterMenu
            label="Date"
            value={range}
            onChange={setRange}
            options={[
              { id: '30d', label: 'Last 30 days' },
              { id: '7d', label: 'Last 7 days' },
              { id: 'today', label: 'Today' },
            ]}
          />
        </div>
        <Rows
          rows={rows}
          loading={list.loading}
          keyOf={(r) => r.id}
          onRow={(r) => setOpenId(r.id)}
          empty={
            filtered ? (
              <Empty title="No requests match" sub="Try another status, method or date." />
            ) : (
              <Empty
                title="No requests yet"
                sub="When your server calls the API with one of your keys, every request shows up here."
                action={
                  <Link to="/settings/api-keys">
                    <Button variant="primary">See your keys</Button>
                  </Link>
                }
              />
            )
          }
          cols={[
            { head: 'Date', className: 'w-[130px]', cell: dayCell(rows) },
            {
              head: 'Request',
              cell: (r) => (
                <span className="flex min-w-0 items-center gap-3">
                  <StatusPill code={r.status} />
                  <span className={cx('w-[52px] shrink-0 font-mono text-[12.5px] font-semibold', METHOD_COLOR[r.method as Method] ?? 'text-fg')}>{r.method}</span>
                  <span className="truncate font-mono text-[13px] text-fg">{r.path}</span>
                </span>
              ),
            },
            { head: 'Key', cell: (r) => <span className="text-muted">{r.key ?? 'Unknown'}</span> },
            { head: 'Time', right: true, cell: (r) => <span className="whitespace-nowrap text-muted">{timeOf(r.at)}</span> },
          ]}
        />
        {rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <RowCount total={rows.length} noun="requests" />
            {list.cursor && (
              <Button size="sm" disabled={list.busy} onClick={() => void list.loadMore()}>
                Load more
              </Button>
            )}
          </div>
        )}
      </Section>

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={l ? `${l.method} ${l.path.split('?')[0]}` : ''}>
        {l && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill code={l.status} />
              <span className="text-[13px] text-muted">
                {l.durationMs} ms · {dateTime(l.createdAt)}
              </span>
            </div>
            <DetailRows
              rows={[
                ['Request ID', l.id, true],
                ['Key', l.key ?? 'Unknown'],
                ['From', l.ip ?? 'Unknown', true],
                ...(l.idempotencyKey ? ([['Idempotency key', l.idempotencyKey, true]] as [string, ReactNode, boolean][]) : []),
              ]}
            />
            {l.requestBody != null && (
              <div>
                <div className="mb-2 text-[13px] font-semibold text-fg">Request body</div>
                <pre className="max-h-[300px] overflow-auto rounded-[10px] bg-raise p-3.5 font-mono text-[12px] leading-relaxed text-fg">{pretty(l.requestBody)}</pre>
              </div>
            )}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-fg">Response</div>
              <pre className="max-h-[420px] overflow-auto rounded-[10px] bg-[#16160F] p-3.5 font-mono text-[12px] leading-relaxed text-[#E8E6DE]">{l.responseBody == null ? 'No body' : pretty(l.responseBody)}</pre>
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
