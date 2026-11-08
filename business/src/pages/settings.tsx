import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, KeyRound, Plus, Trash2, Upload } from '@/components/icons'
import { useSession } from '@/state/session'
import {
  PAYMENT_LINKS,
  OUTLETS,
  ACCEPTED,
  BALANCES,
  METHODS,
  TEAM,
  type Chain,
  type Method,
} from '@/data/mock'
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  PageHeader,
  Radio,
  Segmented,
  Select,
  Tabs,
  Toggle,
  cx,
} from '@/components/ui'
import { AppIcon, Avatar, ChainIcon, MethodIcon } from '@/components/brand'
import { date, ngn, short, usd } from '@/lib/format'
import { useReadiness } from '@/components/Settlement'
import { APP_STORE, PLAY_STORE } from '@/lib/links'
import { TEST_PLACES, MAX_BANKS, MAX_MM, bankAccountsPath, bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, useTargets, walletAddressOn, withBanks, withMms, type BankAccount } from '@/state/targets'
import { useInvoices } from '@/state/invoices'
import { MoneyMovesLinker } from '@/components/MoneyMovesLinker'
import { ALL_ACCEPT, useAccept, useMethods } from '@/state/accept'
import { TokenPicker } from '@/components/TokenPicker'
import { Loader2 } from '@/components/icons'
import { ApiError, LIVE, api, applicationPath, type ApiApplication, type ApiBank, type ApiLiveMethods, type ApiPaymentSettings, type ApiPlatform, type SettleChain } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { feeOn, pct, useFees, type Fees, type Payers } from '@/state/fees'
import { LogoControl } from '@/components/Pictures'
import { useCan } from '@/state/roles'
import { ApiSettleSetting } from '@/components/ApiSettleTo'

function Section({ title, sub, children, aside }: { title: string; sub?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-line py-7 first:pt-0 last:border-0">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
          {sub && <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-muted">{sub}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SaveBar() {
  return (
    <div className="mt-6 flex justify-end">
      <Button variant="primary">Save changes</Button>
    </div>
  )
}

/* ─── Business preferences ─────────────────────────────────────────── */

type Pref = 'about' | 'methods' | 'fees' | 'notifications' | 'security'

const PREFS: { id: Pref; label: string }[] = [
  { id: 'about', label: 'Business' },
  { id: 'methods', label: 'Payment methods' },
  { id: 'fees', label: 'Fees' },
  ...(LIVE
    ? []
    : ([
        { id: 'notifications', label: 'Notifications' },
        { id: 'security', label: 'Transfers' },
      ] as const)),
]

export function BusinessPreferences() {
  const { business } = useSession()
  const [params] = useSearchParams()
  const asked = params.get('tab') as Pref | null
  const tab: Pref = asked && PREFS.some((p) => p.id === asked) ? asked : 'about'
  if (!business) return null
  return (
    <div className="max-w-[820px]">
      <PageHeader title={PREFS.find((p) => p.id === tab)!.label} sub={business.name} />
      {tab === 'about' && (LIVE ? <AboutLive /> : <About />)}
      {tab === 'methods' && (LIVE ? <MethodsLive /> : <PaymentMethods />)}
      {tab === 'fees' && <Fees />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'security' && <Security />}
    </div>
  )
}

/** "8012345678" as a person reads it. */
const phoneText = (p: string) => (/^\d{10}$/.test(p) ? `+234 ${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}` : p)

/** Live: what the business told us when it activated, as it is. Changes go through us, so they're checked like the first time. */
type Details = { name: string; phone: string; supportEmail: string; supportPhone: string }
type DetailChange = { id: string; status: 'PENDING' | 'APPROVED' | 'DECLINED'; changes: Partial<Details>; note: string | null; createdAt: string; decidedAt: string | null }
const DETAIL_LABEL: Record<keyof Details, string> = { name: 'Business name', phone: 'Business phone', supportEmail: 'Support email', supportPhone: 'Support phone' }

function AboutLive() {
  const { business } = useSession()
  const app = useApi<ApiApplication>(business ? applicationPath(business.id) : null)
  const detailsPath = business ? `/businesses/${business.id}/details` : null
  const details = useApi<{ current: Details; change: DetailChange | null }>(detailsPath)
  const [editing, setEditing] = useState(false)
  if (!business) return null
  const a = (app.data?.application.answers ?? {}) as Record<string, string | undefined>
  const now = details.data?.current
  const change = details.data?.change ?? null
  const pending = change?.status === 'PENDING' ? change : null
  const owner = business.role === 'OWNER'
  const address = [a.bizStreet || a.street, a.bizCity || a.city, a.bizState || a.state].filter(Boolean).join(', ')
  const rows: [string, string][] = [
    ['Business name', now?.name ?? business.name],
    ['Country', 'Nigeria'],
    ['Phone', (now?.phone ?? a.phone) ? phoneText(now?.phone ?? a.phone ?? '') : ''],
    ['Address', address],
    ['Website or social page', a.website || a.social || ''],
    ['Support email', now?.supportEmail ?? a.supportEmail ?? ''],
    ['Support phone', (now?.supportPhone ?? a.supportPhone) ? phoneText(now?.supportPhone ?? a.supportPhone ?? '') : ''],
  ]
  const cancel = async () => {
    if (!pending || !business) return
    await api('POST', `/businesses/${business.id}/details/${pending.id}/cancel`).catch(() => {})
    reload(detailsPath!)
  }
  return (
    <Section title="Business details" sub="What your customers see on checkouts and receipts.">
      <div className="mb-4 rounded-[10px] border border-line bg-card p-4">
        <div className="mb-3 text-[13.5px] text-dim">Logo</div>
        <LogoControl />
      </div>
      {app.loading && !app.data ? (
        <p className="text-[13.5px] text-muted">Loading…</p>
      ) : (
        <div className="divide-y divide-soft rounded-[10px] border border-line bg-card px-4">
          {rows.map(([l, v]) => (
            <div key={l} className="flex justify-between gap-4 py-3 text-[13.5px]">
              <span className="shrink-0 text-dim">{l}</span>
              <span className="min-w-0 break-words text-right text-fg">{v || <span className="text-dim">Not given yet</span>}</span>
            </div>
          ))}
        </div>
      )}

      {/* A change waiting, or the last one we turned down - said plainly, with what was asked for. */}
      {pending && (
        <div className="mt-4 rounded-[10px] border border-line bg-raise p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[13.5px] font-semibold text-fg">Waiting for us to check</div>
            {owner && (
              <button onClick={() => void cancel()} className="text-[12.5px] font-medium text-muted underline underline-offset-2 hover:text-fg">
                Cancel it
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-[13px] text-muted">
            {(Object.keys(DETAIL_LABEL) as (keyof Details)[])
              .filter((k) => pending.changes[k] !== undefined)
              .map((k) => (
                <li key={k}>
                  {DETAIL_LABEL[k]}: <span className="text-fg">{pending.changes[k]}</span>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-[12.5px] text-dim">Asked {date(pending.createdAt)}. Nothing changes for your customers until we approve it. We'll email you either way.</p>
        </div>
      )}
      {change?.status === 'DECLINED' && !pending && (
        <p className="mt-4 rounded-[10px] border border-line bg-raise p-4 text-[13px] text-muted">
          We couldn't make your last change{change.note ? `: ${change.note}` : '.'}
        </p>
      )}

      {owner && !pending && !editing && now && (
        <div className="mt-4">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Ask to change these
          </Button>
        </div>
      )}
      {!owner && !pending && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-dim">Only the business owner can ask to change these.</p>
      )}
      {editing && now && (
        <DetailChangeForm
          businessId={business.id}
          now={now}
          onClose={() => setEditing(false)}
          onSent={() => {
            setEditing(false)
            reload(detailsPath!)
          }}
        />
      )}
    </Section>
  )
}

/** The four details, as they are now; whatever is changed goes to us to check. */
function DetailChangeForm({ businessId, now, onClose, onSent }: { businessId: string; now: Details; onClose: () => void; onSent: () => void }) {
  const [f, setF] = useState<Details>(now)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const changed = (Object.keys(DETAIL_LABEL) as (keyof Details)[]).filter((k) => f[k].trim() !== now[k].trim())
  const send = async () => {
    setBusy(true)
    setProblem('')
    try {
      await api('POST', `/businesses/${businessId}/details`, Object.fromEntries(changed.map((k) => [k, f[k].trim()])))
      onSent()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That didn't go through. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 rounded-[10px] border border-line bg-card p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(Object.keys(DETAIL_LABEL) as (keyof Details)[]).map((k) => (
          <Field key={k} label={DETAIL_LABEL[k]} hint={k === 'name' ? 'Must match your registration, if you\'re a registered business.' : undefined}>
            <Input value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} inputMode={k === 'phone' || k === 'supportPhone' ? 'tel' : k === 'supportEmail' ? 'email' : undefined} />
          </Field>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-dim">We check changes the same way we checked them when you activated. Until we approve, your customers keep seeing what they see now.</p>
      {problem && <p className="mt-2 text-[12.5px] text-red">{problem}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void send()} disabled={busy || changed.length === 0}>
          {busy ? 'Sending…' : 'Send for approval'}
        </Button>
      </div>
    </div>
  )
}

const METHOD_KEY = { naira: 'NAIRA', app: 'APP', crypto: 'CRYPTO' } as const

/**
 * Live: the business's own switches for each way to pay, on every payment
 * link, invoice, outlet and API checkout. Each is on once there's somewhere
 * for its money to go; until then it says what to link first.
 */
function MethodsLive() {
  const { business, mode } = useSession()
  const can = useCan()
  const config = useApi<{ live?: ApiLiveMethods }>('/config')
  const live = config.data?.live
  const networks = live?.cryptoNetworks ?? []
  const path = business ? `/businesses/${business.id}/payment-settings?mode=${mode}` : null
  const settings = useApi<ApiPaymentSettings>(path)
  const [busy, setBusy] = useState<Method | null>(null)
  const [problem, setProblem] = useState('')
  const note = (m: Method) => (m === 'crypto' && live?.crypto ? `${METHODS[m].sub} Live on ${networks.join(', ')}.` : METHODS[m].sub)
  const flip = async (m: Method, on: boolean) => {
    if (!business) return
    setBusy(m)
    setProblem('')
    try {
      await api('PATCH', `/businesses/${business.id}/methods?mode=${mode}`, { method: METHOD_KEY[m], on })
      reload(path!)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That didn't go through. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
    <Section title="Checkout methods" sub="How customers can pay you, on every payment link, invoice, outlet and API checkout. Each one turns on once there’s somewhere for its money to go.">
      <div className="grid gap-3">
        {(['naira', 'app', 'crypto'] as Method[]).map((m) => {
          const s = settings.data?.methods[METHOD_KEY[m]]
          const paused = live && !live[m]
          return (
            <div key={m} className="flex items-center gap-4 rounded-[10px] border border-line bg-card p-4">
              <MethodIcon method={m} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold text-fg">{METHODS[m].label}</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{note(m)}</div>
                {s && !s.ready && s.why && (
                  <div className="mt-1.5 text-[12.5px] text-fg">
                    {s.why}.{' '}
                    {can('payout_places') ? (
                      <Link to={m === 'naira' && settings.data?.api.justMe ? '/balances' : '/settings/settlement'} className="font-semibold underline underline-offset-2">
                        {m === 'naira' && settings.data?.api.justMe ? 'Open Business wallet' : 'Open Payout places'}
                      </Link>
                    ) : (
                      <span className="text-muted">Ask the owner to do it.</span>
                    )}
                  </div>
                )}
                {paused && s?.ready && <div className="mt-1.5 text-[12.5px] text-muted">Paused on our side for a while. Customers can’t use it until it’s back, whatever the switch says.</div>}
              </div>
              {!s ? (
                <Badge>…</Badge>
              ) : busy === m ? (
                <Loader2 className="size-4 animate-spin text-dim" />
              ) : (
                <Toggle on={s.on} disabled={!s.ready || !can('settlement')} label={`${METHODS[m].label} at checkout`} onChange={(v) => void flip(m, v)} />
              )}
            </div>
          )
        })}
      </div>
      {settings.error && <p className="mt-3 text-[12.5px] text-red">{settings.error.message}</p>}
      {problem && <p className="mt-3 text-[12.5px] text-red">{problem}</p>}
      {!can('settlement') && <p className="mt-3 text-[12.5px] text-dim">The owner, admins and finance can turn these on and off.</p>}
    </Section>
    <Section title="API payments" sub="Where live checkouts you make with the API, from your website or app, settle. Each one settles the moment it's paid.">
      <ApiSettleSetting />
    </Section>
    </>
  )
}

function About() {
  const { business } = useSession()
  if (!business) return null
  return (
    <>
      <Section title="Logo" sub="Shown at checkout, on invoices and on receipts. Square, at least 256 pixels.">
        <div className="flex items-center gap-4">
          <Avatar name={business.name} size={64} square />
          <div className="flex gap-2">
            <Button size="sm" icon={<Upload className="size-3.5" />}>
              Upload logo
            </Button>
            <Link to="/settings/branding">
              <Button size="sm" variant="ghost">
                Checkout colours
              </Button>
            </Link>
          </div>
        </div>
      </Section>
      <Section title="Business details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Business name" hint="Matches your registration. Contact us to change it.">
            <Input defaultValue={business.name} disabled />
          </Field>
          <Field label="Country">
            <Select disabled>
              <option>Nigeria</option>
            </Select>
          </Field>
          <Field label="Business email">
            <Input defaultValue={business.email} />
          </Field>
          <Field label="Business phone">
            <Input defaultValue={business.phone} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Business address">
              <Input defaultValue="No 20A Etete Road, GRA, Benin City" />
            </Field>
          </div>
        </div>
      </Section>
      <Section title="Support contacts" sub="What customers see on receipts and at checkout when they need help.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Support email">
            <Input defaultValue="info@moverstech.xyz" />
          </Field>
          <Field label="Support phone">
            <Input defaultValue="+234" />
          </Field>
          <Field label="Dispute email" optional hint="Where we send dispute notices, if not the business email.">
            <Input placeholder="disputes@business.com" />
          </Field>
        </div>
      </Section>
      <SaveBar />
    </>
  )
}

function Notifications() {
  const { business } = useSession()
  const [who, setWho] = useState('all')
  const rows: [string, string, boolean][] = [
    ['Payment received', 'An email for every successful payment.', true],
    ['Customer receipts', 'Email the customer a receipt when they pay.', true],
    ['Settlement sent', 'When money lands in your bank, wallet or app.', true],
    ['Payout made', 'Every send or withdrawal from your business wallet.', true],
    ['Underpaid or failed payment', 'So you can follow up with the customer.', true],
    ['Product news', 'New networks, features and fee changes.', false],
  ]
  const [on, setOn] = useState(rows.map((r) => r[2]))
  return (
    <>
      <Section title="Email notifications">
        {rows.map(([t, s], i) => (
          <div key={t} className="flex items-center justify-between gap-4 border-b border-soft py-3.5 last:border-0">
            <div>
              <div className="text-[14px] text-fg">{t}</div>
              <div className="mt-0.5 text-[12.5px] text-dim">{s}</div>
            </div>
            <Toggle on={on[i]!} onChange={(v) => setOn((x) => x.map((y, j) => (j === i ? v : y)))} label={t} />
          </div>
        ))}
      </Section>
      <Section title="Who gets them">
        <Radio checked={who === 'business'} onChange={() => setWho('business')} sub={business?.email || 'The email on file'}>The business email only</Radio>
        <Radio checked={who === 'all'} onChange={() => setWho('all')} sub={`${TEAM.length} people`}>Everyone on the team</Radio>
        <Radio checked={who === 'some'} onChange={() => setWho('some')} sub="Choose people">Specific people only</Radio>
        <Radio checked={who === 'none'} onChange={() => setWho('none')} sub="You will still see everything in the dashboard">No emails</Radio>
      </Section>
      <SaveBar />
    </>
  )
}

function Security() {
  const { business } = useSession()
  const [approve, setApprove] = useState('otp')
  const [channel, setChannel] = useState('both')
  const [pin, setPin] = useState(false)
  return (
    <>
      <p className="mb-6 rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
        Your password and 2-step sign-in are yours, not the business's. They're in your{' '}
        <Link to="/settings/profile?tab=security" className="font-medium text-fg underline underline-offset-2">
          Profile, Security
        </Link>
        . These settings are for money leaving {business?.name ?? 'this business'}.
      </p>
      <Section title="Approving transfers" sub="What it takes to move money out of your business wallet.">
        <Radio checked={approve === 'otp'} onChange={() => setApprove('otp')}>One-time code</Radio>
        <Radio checked={approve === 'pin'} onChange={() => setApprove('pin')}>Transfer PIN</Radio>
        <Radio checked={approve === 'both'} onChange={() => setApprove('both')}>Transfer PIN and one-time code</Radio>
        <Button size="sm" className="mt-3" icon={<KeyRound className="size-3.5" />} onClick={() => setPin(true)}>Change transfer PIN</Button>
      </Section>
      <Section title="Where transfers can come from">
        <Radio checked={channel === 'api'} onChange={() => setChannel('api')}>API only</Radio>
        <Radio checked={channel === 'dashboard'} onChange={() => setChannel('dashboard')}>Dashboard only</Radio>
        <Radio checked={channel === 'both'} onChange={() => setChannel('both')}>API and dashboard</Radio>
        <Radio checked={channel === 'off'} onChange={() => setChannel('off')} sub="Payments still come in; nothing goes out.">Turn off all transfers</Radio>
      </Section>
      <SaveBar />
      <Modal
        open={pin}
        onClose={() => setPin(false)}
        title="Change transfer PIN"
        footer={<><Button onClick={() => setPin(false)}>Cancel</Button><Button variant="primary" onClick={() => setPin(false)}>Save PIN</Button></>}
      >
        <div className="space-y-4">
          <Field label="Current PIN"><Input type="password" inputMode="numeric" maxLength={4} /></Field>
          <Field label="New PIN"><Input type="password" inputMode="numeric" maxLength={4} /></Field>
        </div>
      </Modal>
    </>
  )
}

function PaymentMethods() {
  const PR = useFees()
  const { business } = useSession()
  const [on = ['app', 'crypto', 'naira'], setOn] = useMethods(business?.id)
  const [accept, setAccept] = useAccept(business?.id)
  const [tolerance, setTolerance] = useState('0')
  /** The most short a payment can be and still settle on its own - past this it's a real underpayment. */
  const MAX_SHORT = 1
  return (
    <>
      <Section title="Checkout methods" sub="Your default for new payment links, invoices, outlets and API checkouts. You can narrow it on any one of them.">
        <div className="grid gap-3">
          {(Object.keys(METHODS) as Method[]).map((m) => (
            <div key={m} className="flex items-center gap-4 rounded-[10px] border border-line bg-card p-4">
              <MethodIcon method={m} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[14.5px] font-semibold text-fg">
                  {METHODS[m].label}
                  {m === 'app' && (
                    <>
                      <Badge tone="good">Fastest</Badge>
                      {PR.app.rate === 0 && <Badge tone="good">No fees</Badge>}
                    </>
                  )}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{METHODS[m].sub}</div>
              </div>
              <Toggle
                on={on.includes(m)}
                // At least one way to pay has to stay on.
                disabled={on.includes(m) && on.length === 1}
                onChange={(v) => setOn(v ? (['app', 'crypto', 'naira'] as Method[]).filter((x) => x === m || on.includes(x)) : on.filter((x) => x !== m))}
                label={METHODS[m].short}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Coins and networks" sub="Your default for crypto deposits, new payment links, invoices, outlets and API checkouts start with this. You can narrow it on any one of them.">
        <TokenPicker value={accept ?? ALL_ACCEPT} onChange={setAccept} />
      </Section>

      <Section title="Underpayments" sub="A customer sending a few cents short is usually a wallet rounding, not an attempt to cheat.">
        <div className="grid grid-cols-1 max-w-[520px] gap-4 sm:grid-cols-2">
          <Field label="Accept if short by up to" hint={`0 to ${MAX_SHORT}%. Off at 0: anything short waits for you to accept or refund.`}>
            <div className="relative">
              <Input
                value={tolerance}
                onChange={(e) => {
                  // Digits and one decimal point, never past the cap.
                  const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
                  setTolerance(Number(v) > MAX_SHORT ? String(MAX_SHORT) : v)
                }}
                inputMode="decimal"
                className="pr-8"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-dim">%</span>
            </div>
          </Field>
          <Field label="Checkout expires after">
            <Select defaultValue="30">
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
            </Select>
          </Field>
        </div>
      </Section>
      <SaveBar />
    </>
  )
}

/**
 * Who pays our fee on one way to pay. Naira and stablecoins are picked apart
 * because they cost a customer differently: a shop can absorb the naira fee
 * and still pass on the stablecoin one, or the other way round.
 */
function PayerChoice({
  method,
  title,
  sub,
  rate,
  value,
  onChange,
  disabled,
}: {
  method: Method
  title: string
  sub: string
  rate: string
  value: 'BUSINESS' | 'CUSTOMER'
  onChange: (v: 'BUSINESS' | 'CUSTOMER') => void
  disabled?: boolean
}) {
  const options = [
    { id: 'BUSINESS' as const, label: 'I pay it', sub: 'Taken from what you receive' },
    { id: 'CUSTOMER' as const, label: 'My customer pays it', sub: 'Added on top at checkout' },
  ]
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-card">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <MethodIcon method={method} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-fg">{title}</p>
          <p className="text-[12.5px] text-muted">{sub}</p>
        </div>
        <span className="tabular shrink-0 rounded-full bg-raise px-2.5 py-1 text-[12px] font-medium text-muted">{rate}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        {options.map((o, i) => {
          const on = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(o.id)}
              className={cx(
                'flex items-start gap-3 px-4 py-3.5 text-left transition',
                i === 0 && 'sm:border-r sm:border-line',
                i > 0 && 'border-t border-line sm:border-t-0',
                disabled ? 'cursor-not-allowed opacity-55' : on ? 'bg-lime/10' : 'hover:bg-raise',
              )}
            >
              <span className={cx('mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border transition', on ? 'border-fg bg-lime' : 'border-[#C9C6BC]')}>
                {on && <Check className="size-3 text-fg" strokeWidth={3.5} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-fg">{o.label}</span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{o.sub}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Fees() {
  const PR = useFees()
  const { business, updateBusiness } = useSession()
  const [payers, setPayers] = useState<Payers>({ naira: business?.feePayer ?? 'BUSINESS', crypto: business?.feePayerCrypto ?? business?.feePayer ?? 'BUSINESS' })
  const [feeBusy, setFeeBusy] = useState(false)
  const [feeProblem, setFeeProblem] = useState("")
  const canSetFee = !LIVE || ["OWNER", "ADMIN", "FINANCE"].includes(business?.role ?? "")
  // Live, saved the moment it's picked - it applies from the next payment.
  const setPayer = async (way: keyof Payers, next: 'BUSINESS' | 'CUSTOMER') => {
    if (next === payers[way] || feeBusy) return
    const before = payers
    setPayers({ ...payers, [way]: next })
    if (!LIVE || !business) return
    setFeeBusy(true)
    setFeeProblem("")
    try {
      await api("PATCH", `/businesses/${business.id}/fees`, { [way]: next })
      updateBusiness(business.id, way === 'naira' ? { feePayer: next } : { feePayerCrypto: next })
    } catch (e) {
      setPayers(before)
      setFeeProblem(e instanceof ApiError ? e.message : "Couldn't save that just now. Try again.")
    } finally {
      setFeeBusy(false)
    }
  }
  // Where each cap starts doing the work: past these, the fee stops growing.
  const capFrom = PR.naira.capNgn / PR.naira.rate
  const cryptoCapFrom = PR.crypto.capUsd / PR.crypto.rate
  return (
    <>
      <Section title="Who pays the processing fee" sub="Choose for each way your customers pay. This is your default for every payment link, invoice and store code, from the next payment on, and a link can still choose its own.">
        <div className="grid max-w-[720px] grid-cols-1 gap-3">
          <PayerChoice
            method="naira"
            title="Naira transfer"
            sub="From any bank app, to a one-time account"
            rate={`${pct(PR.naira.rate)} up to ${ngn(PR.naira.capNgn).replace('.00', '')}`}
            value={payers.naira}
            onChange={(v) => void setPayer('naira', v)}
            disabled={!canSetFee}
          />
          <PayerChoice
            method="crypto"
            title="Stablecoins"
            sub="USDC or USDT, on any network you accept"
            rate={`${pct(PR.crypto.rate)} up to ${usd(PR.crypto.capUsd).replace('.00', '')}`}
            value={payers.crypto}
            onChange={(v) => void setPayer('crypto', v)}
            disabled={!canSetFee}
          />
          {PR.app.rate === 0 && (
            <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-line px-4 py-3">
              <MethodIcon method="app" size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-fg">Money Moves app</p>
                <p className="text-[12.5px] text-muted">Free for you and for your customer, so there is nothing to choose.</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#E4F2E8] px-2.5 py-1 text-[12px] font-semibold text-good">Free</span>
            </div>
          )}
        </div>
        {feeProblem ? <p className="mt-2 text-[12.5px] text-red">{feeProblem}</p> : !canSetFee ? <p className="mt-2 text-[12.5px] text-dim">The owner, an admin or finance can change this.</p> : LIVE && !feeBusy ? <p className="mt-2 text-[12.5px] text-dim">Saved as soon as you pick.</p> : null}
      </Section>

      <Section
        title="What a payment works out to"
        sub={`Put in an amount. The fee stops growing at ${ngn(capFrom).replace('.00', '')} for naira and ${usd(cryptoCapFrom).replace('.00', '')} for stablecoins, so big sales cost less.`}
      >
        <FeeCalculator payers={payers} fees={PR} />
      </Section>
      {!LIVE && <SaveBar />}

      <Section title="Your fees" sub="No setup fee and no monthly fee. You pay only when you're paid.">
        <div className="max-w-[720px] overflow-hidden rounded-[10px] border border-line bg-card">
          <FeeGroup>Taking payments</FeeGroup>
          <FeeRow title="Crypto" sub="USDC or USDT, on any network you accept. The customer pays the network fee." rate={`${PR.crypto.rate * 100}%`} note={`capped at ${usd(PR.crypto.capUsd).replace('.00', '')}`} />
          <FeeRow title="Money Moves app" sub="Approved in the app. No addresses, no network fees, and no fee from us." rate={PR.app.rate ? `${PR.app.rate * 100}%` : 'Free'} />
          <FeeRow title="Naira transfer" sub="From any bank app, to a one-time account." rate={`${PR.naira.rate * 100}%`} note={`capped at ${ngn(PR.naira.capNgn).replace('.00', '')}`} />
          <FeeGroup>Moving money</FeeGroup>
          <FeeRow title="Settlement" sub="To your bank, Money Moves account or business wallet, the moment a payment confirms." rate="Free" />
          <FeeRow title="Payout to a bank" sub="Naira from your business wallet to your bank, within 24 hours." rate={ngn(PR.payoutNgn).replace('.00', '')} note="per transfer" />
          <FeeRow title="Refunds" sub="We return the fee we charged on that payment, so a refund never costs you more than you received." rate="Free" />
        </div>
      </Section>
    </>
  )
}

function FeeGroup({ children }: { children: ReactNode }) {
  return <div className="border-b border-line bg-[#FAFAF8] px-4 py-2 text-[12px] font-medium text-dim">{children}</div>
}

function FeeRow({ title, sub, rate, note }: { title: string; sub: string; rate: string; note?: string }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-soft px-4 py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-fg">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{sub}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="display tabular text-[20px] font-semibold leading-tight text-fg">{rate}</div>
        {note && <div className="text-[12px] text-dim">{note}</div>}
      </div>
    </div>
  )
}

const PRESETS: Record<Method, number[]> = { naira: [5_000, 100_000, 2_000_000], crypto: [20, 150, 5_000], app: [20, 250, 5_000] }

/** Pick how the customer pays and an amount: the fee, what you keep, and what that works out to. */
function FeeCalculator({ payers, fees: PR }: { payers: Payers; fees: Fees }) {
  const [method, setMethod] = useState<Method>('crypto')
  const onCustomer = method === 'naira' ? payers.naira === 'CUSTOMER' : method === 'crypto' ? payers.crypto === 'CUSTOMER' : false
  const [amt, setAmt] = useState('150')
  const naira = method === 'naira'
  const n = Number(amt) || 0
  const fee = feeOn(PR, method, n)
  const money = (x: number) => (naira ? ngn(x) : usd(x))
  const capped = naira ? fee >= PR.naira.capNgn : method === 'crypto' && fee >= PR.crypto.capUsd
  return (
    <div className="grid max-w-[720px] grid-cols-1 overflow-hidden rounded-[10px] border border-line bg-card sm:grid-cols-2">
      <div className="space-y-4 p-4 sm:border-r sm:border-line">
        <Field label="Your customer pays with">
          <Segmented
            value={method}
            onChange={(m: Method) => {
              setMethod(m)
              setAmt(String(PRESETS[m][1]))
            }}
            options={[
              { id: 'crypto', label: 'Crypto' },
              { id: 'app', label: 'Money Moves app' },
              { id: 'naira', label: 'Naira transfer' },
            ]}
          />
        </Field>
        <Field label="Amount">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-dim">{naira ? '₦' : '$'}</span>
            <Input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="tabular pl-7" />
          </div>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS[method].map((v) => (
            <button
              key={v}
              onClick={() => setAmt(String(v))}
              className={cx('rounded-full border px-2.5 py-1 text-[12px] tabular transition', n === v ? 'border-fg text-fg' : 'border-line text-muted hover:border-[#D3D0C7] hover:text-fg')}
            >
              {money(v).replace('.00', '')}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col bg-[#FAFAF8] p-4 text-[13.5px]">
        <div className="flex justify-between gap-4 py-1.5">
          <span className="text-muted">Fee{capped && ' (capped)'}</span>
          <span className={cx('tabular', fee === 0 ? 'text-good' : 'text-fg')}>{fee === 0 ? 'Free' : money(fee)}</span>
        </div>
        {onCustomer && (
          <div className="flex justify-between gap-4 py-1.5">
            <span className="text-muted">Customer pays</span>
            <span className="tabular text-fg">{money(n + fee)}</span>
          </div>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <span className="font-semibold text-fg">You keep</span>
          <span className="display tabular text-[22px] font-semibold text-fg">{money(onCustomer ? n : Math.max(0, n - fee))}</span>
        </div>
        <div className="flex justify-between gap-4 py-1.5 text-[12.5px]">
          <span className="text-dim">Works out to</span>
          <span className="tabular text-dim">{n ? `${((fee / n) * 100).toFixed(2).replace(/\.?0+$/, '')}%` : '-'}</span>
        </div>
        <p className="mt-auto pt-4 text-[12.5px] leading-relaxed text-muted">
          {naira
            ? capped
              ? `The cap is doing the work: the fee stays at ${ngn(PR.naira.capNgn).replace('.00', '')} however big the sale.`
              : 'Settled to your bank in seconds, nights and weekends included.'
            : method === 'crypto'
              ? capped
                ? `The cap is doing the work: the fee stays at ${usd(PR.crypto.capUsd).replace('.00', '')} however big the sale.`
                : 'The customer covers the network fee, so it never comes out of this.'
              : 'No fee from us, and no addresses or network fees for the customer.'}
        </p>
      </div>
    </div>
  )
}


/** For a business without a Money Moves account yet: where to get the app. */
function GetTheApp({ compact }: { compact?: boolean }) {
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-3', compact ? 'rounded-[10px] bg-raise px-3.5 py-3' : 'mt-3 rounded-[12px] border border-dashed border-[#D6D3CA] px-4 py-3.5')}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-fg">No Money Moves account yet?</div>
        <div className="text-[12.5px] text-muted">Get the app, sign up in a minute, then link your username here.</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a href={APP_STORE} target="_blank" rel="noreferrer" aria-label="Download on the App Store">
          <img src="/brand/app-store.svg" alt="Download on the App Store" className="h-9 w-auto" />
        </a>
        <a href={PLAY_STORE} target="_blank" rel="noreferrer" aria-label="Get it on Google Play">
          <img src="/brand/google-play.svg" alt="Get it on Google Play" className="h-9 w-auto" />
        </a>
      </div>
    </div>
  )
}

/** A bank or wallet mark in a round badge, the size of the app icon beside it. */
function PlaceMark({ src }: { src: string }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-card">
      <img src={src} alt="" aria-hidden className="size-[18px] object-contain" />
    </span>
  )
}

function Place({ icon, title, detail, note, status, action }: { icon: ReactNode; title: string; detail: string; note: string; status: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-soft px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-fg">{title}</span>
            {status}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-muted">{detail}</div>
          <div className="text-[12px] text-dim">{note}</div>
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 pl-[50px] sm:pl-0">{action}</div>}
    </div>
  )
}

/** The business's own crypto wallets: add, name, remove. */
function SavedWallets() {
  const { business } = useSession()
  const [targets, setTargets] = useTargets(business?.id)
  const [adding, setAdding] = useState(false)
  const [w, setW] = useState<{ label: string; address: string; chain: Chain }>({ label: '', address: '', chain: 'Base' })
  const chains = [...new Set(ACCEPTED.flatMap((a) => a.chains))]
  const list = targets?.wallets ?? []
  return (
    <div className="space-y-3">
      {list.length > 0 && (
        <div className="divide-y divide-soft rounded-[10px] border border-line">
          {list.map((x) => (
            <div key={x.address} className="flex items-center gap-3 px-4 py-3">
              <span className="relative shrink-0">
                <PlaceMark src="/brand/wallet.png" />
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card">
                  <ChainIcon chain={x.chain} size={14} />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-fg">{x.label}</div>
                <div className="truncate font-mono text-[12px] text-dim">
                  {short(x.address, 10, 8)} · {x.chain}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setTargets((t) => ({ ...t, wallets: (t.wallets ?? []).filter((y) => y.address !== x.address) }))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}
      {adding ? (
        <div className="space-y-3 rounded-[10px] border border-line p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
            <Field label="Name">
              <Input value={w.label} onChange={(e) => setW((p) => ({ ...p, label: e.target.value }))} placeholder="Treasury" autoFocus />
            </Field>
            <Field label="Network">
              <Select value={w.chain} onChange={(e) => setW((p) => ({ ...p, chain: e.target.value as Chain }))}>
                {chains.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Address" hint="Check it twice, crypto sent to a wrong address can't be recovered.">
            <Input value={w.address} onChange={(e) => setW((p) => ({ ...p, address: e.target.value.trim() }))} placeholder="0x…" className="font-mono text-[13px]" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={w.address.length < 24}
              onClick={() => {
                setTargets((t) => ({ ...t, wallets: [...(t.wallets ?? []), { ...w, label: w.label.trim() || short(w.address) }] }))
                setW({ label: '', address: '', chain: 'Base' })
                setAdding(false)
              }}
            >
              Save wallet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setAdding(true)}>
            Add a wallet
          </Button>
          {list.length === 0 && <span className="text-[12.5px] text-dim">None saved yet. You can also save one while sending.</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Settlement ───────────────────────────────────────────────────── */

const SETTLE_CHAINS: [SettleChain, Chain][] = [
  ['MOVEMENT', 'Movement'],
  ['ARC', 'Arc'],
  ['MONAD', 'Monad'],
  ['SOLANA', 'Solana'],
  ['STELLAR', 'Stellar'],
]

/**
 * Where crypto settles. Customers pay with any coin on any chain we take; the
 * payment lands in our treasury and the business gets USDC on the one chain
 * picked here - in its business wallet or a linked Money Moves account.
 *
 * Only chains switched on are offered. One switched off is gone from here, and
 * a business that was on it is moved to Movement by the API at that moment.
 */
function SettleChainCard() {
  const { business, setSettleChain } = useSession()
  const config = useApi<{ platform: ApiPlatform }>(LIVE ? '/config' : null)
  const on = (c: SettleChain) => c === 'MOVEMENT' || !config.data || config.data.platform.settleChains[c] !== false
  // Until we know which chains are on, only the one in use: offering them all, then taking some away, reads as a glitch.
  const known = !LIVE || !!config.data
  const offered = SETTLE_CHAINS.filter(([id]) => (known ? on(id) : id === (business?.settleChain ?? 'MOVEMENT')))
  const [busy, setBusy] = useState<SettleChain | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  // A chain switched off since the page loaded counts as Movement, as the API now has it.
  const current = business?.settleChain && on(business.settleChain) ? business.settleChain : 'MOVEMENT'
  // Owners, admins and finance decide where money goes; the API checks this too.
  const canChange = !business?.role || ['OWNER', 'ADMIN', 'FINANCE'].includes(business.role)
  const name = (c: SettleChain) => SETTLE_CHAINS.find(([id]) => id === c)?.[1] ?? 'Movement'
  const pick = async (c: SettleChain) => {
    if (c === current || busy) return
    setBusy(c)
    setError('')
    setSaved(false)
    try {
      await setSettleChain(c)
      setSaved(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change it just now. Try again.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mb-6 max-w-[820px] rounded-[12px] border border-line bg-card px-4 py-4">
      <div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">Crypto settles as USDC on</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">Whatever coin or chain a customer pays with, you get USDC on this chain, in your business wallet or Money Moves account.</div>
        </div>
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          {offered.map(([id, chain]) => (
            <button
              key={id}
              type="button"
              disabled={!canChange || !!busy}
              onClick={() => void pick(id)}
              className={cx(
                'flex min-w-0 items-center justify-center gap-1 rounded-full border px-1.5 py-2 text-[12.5px] transition disabled:cursor-not-allowed sm:gap-1.5 sm:px-2.5 sm:text-[13px]',
                current === id ? 'border-fg bg-card font-medium text-fg shadow-[0_0_0_1px_var(--color-fg)]' : 'border-line bg-card text-muted hover:border-[#D3D0C7] hover:text-fg',
              )}
            >
              {busy === id ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ChainIcon chain={chain} size={16} />} <span className="truncate">{chain}</span>
            </button>
          ))}
        </div>
      </div>
      {LIVE && (current === 'ARC' || current === 'MOVEMENT' || current === 'STELLAR') && (
        <div className="mt-2 text-[12.5px] leading-relaxed text-muted">
          For now, payouts for {name(current)} arrive as USDC on Monad, in the same business wallet or Money Moves account.
          {canChange && offered.some(([id]) => id === 'MONAD') && (
            <>
              {' '}
              <button type="button" disabled={!!busy} onClick={() => void pick('MONAD')} className="font-medium text-fg underline underline-offset-2">
                Switch to Monad
              </button>
            </>
          )}
        </div>
      )}
      {/* Settling on Solana, a payment that comes through a swap lands at a new Solana address, and opening its account costs the customer about $0.24. Monad has no such cost. */}
      {LIVE && current === 'SOLANA' && (config.data?.platform.intents?.on || config.data?.platform.intents?.stablecoins) && (
        <div className="mt-2 text-[12.5px] leading-relaxed text-muted">
          On Solana, your customers pay a network fee of about $0.24 on each crypto payment, to open the account it lands in. On Monad they don't.
          {canChange && offered.some(([id]) => id === 'MONAD') && (
            <>
              {' '}
              <button type="button" disabled={!!busy} onClick={() => void pick('MONAD')} className="font-medium text-fg underline underline-offset-2">
                Settle on Monad instead
              </button>
            </>
          )}
        </div>
      )}
      {(error || saved || !canChange) && (
        <div className={cx('mt-2 text-[12.5px]', error ? 'text-red' : saved ? 'text-good' : 'text-dim')}>
          {error || (saved ? `Saved. New crypto payments settle as USDC on ${name(current)}.` : 'Only owners, admins and finance can change this.')}
        </div>
      )}
    </div>
  )
}

export function SettlementSettings() {
  const { business, user, mode } = useSession()
  const [targets, setTargets] = useTargets(business?.id)
  // The real details - this is where they are added and checked, test mode or not.
  const ready = useReadiness({ real: true })
  const [bankOpen, setBankOpen] = useState(false)
  const [bankError, setBankError] = useState('')
  const [mm, setMm] = useState('')
  const [mmOpen, setMmOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [tab, setTab] = useState<'bank' | 'mm' | 'wallets'>('bank')
  const [invoices] = useInvoices(business?.id)
  // Bank accounts, Money Moves links and the wallet are the owner's alone; the rest of the team sees where money lands.
  const placesOwner = useCan()('payout_places')
  if (!business || !targets || !ready) return null
  const banks = banksOf(targets)
  const mainBank = defaultBankOf(targets)
  const toRemove = banks.find((b) => b.id === removing)
  const mms = mmsOf(targets)
  const mainMm = defaultMmOf(targets)
  const toUnlink = mms.find((m) => m.id === unlinking)
  // Points at this account: named it, or named none and it's the default.
  const usesMm = (item: { destination: string; mmId?: string }) => item.destination === 'wallet' && (item.mmId ? item.mmId === unlinking : unlinking === mainMm?.id)
  // What still points at Money Moves - it carries on, to the business wallet, while unlinked.
  const onMm = {
    links: PAYMENT_LINKS.filter(usesMm).length,
    outlets: OUTLETS.filter(usesMm).length,
    invoices: (invoices ?? []).filter((i) => usesMm(i) && i.status !== 'paid').length,
  }
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  const mmUses = [onMm.links && plural(onMm.links, 'payment link'), onMm.outlets && plural(onMm.outlets, 'outlet'), onMm.invoices && plural(onMm.invoices, 'unpaid invoice')].filter(Boolean) as string[]
  // A "Just me" account is paid in the person's own name; a registered one in the business's.
  const individual = business.type === 'Individual'
  const person = LIVE ? [user?.firstName, user?.lastName].filter(Boolean).join(' ') : `${user?.first ?? ''} ${user?.last ?? ''}`.trim() || 'Ada Okonkwo'
  const owner = individual
    ? { label: person ? `your own name: ${person.toUpperCase()}` : 'your own name, as it is on your ID', name: person || null }
    : { label: `the business's registered name: ${business.name.toUpperCase()}`, name: business.name }

  // Live, every change goes through the API and the list is read again; in preview it's this browser's copy.
  const changeBank = async (id: string, how: 'default' | 'remove') => {
    setBankError('')
    if (!LIVE) {
      setTargets((t) => (how === 'default' ? withBanks(t, banksOf(t), id) : withBanks(t, banksOf(t).filter((b) => b.id !== id))))
      return
    }
    try {
      await api(how === 'default' ? 'POST' : 'DELETE', `${bankAccountsPath(business.id)}/${id}${how === 'default' ? '/default' : ''}`)
      await reload(bankAccountsPath(business.id))
    } catch (e) {
      setBankError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    }
  }

  return (
    <>
      <PageHeader
        title="Payout places"
        sub={
          LIVE
            ? 'Where your money can land. Each payment link, invoice and outlet settles to one of these.'
            : 'Where your money can land. Each payment link, invoice and outlet settles to one of these. API payments go to a bank account first, then Money Moves, then the wallet, unless you choose one in the Developer portal.'
        }
      />
      {mode === 'test' && (
        <p className="-mt-2 mb-6 max-w-[80ch] rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          <span className="font-medium text-fg">You're in test mode.</span> Test payments settle to sandbox accounts, {TEST_PLACES.bank} and {TEST_PLACES.wallet}. So nothing real
          moves. The accounts below are your real ones, used only for live payments.
        </p>
      )}

      <SettleChainCard />

      {!placesOwner && (
        <p className="mb-6 max-w-[820px] rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          Only the owner can add or change bank accounts and Money Moves accounts. The owner and admins can see the business wallet.
        </p>
      )}

      <div className="mb-6 max-w-[820px]">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'bank', label: 'Bank accounts', badge: <span className="tabular text-[12px] text-dim">{banks.length}</span> },
            { id: 'mm', label: 'Money Moves', badge: <span className="tabular text-[12px] text-dim">{mms.length}</span> },
            // The business wallet, once it exists, plus the crypto wallets saved for sending. The owner's alone.
            ...(placesOwner ? [{ id: 'wallets' as const, label: 'Wallets', badge: <span className="tabular text-[12px] text-dim">{(ready.onchain.ready ? 1 : 0) + (targets.wallets?.length ?? 0)}</span> }] : []),
          ]}
        />
      </div>

      {tab === 'bank' && (
        <div className="max-w-[820px]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] text-muted">Up to {MAX_BANKS}, {individual ? 'in your own name' : "in the business's registered name"}. Arrives as naira, in seconds.</p>
            <span className="tabular text-[12.5px] text-dim">
              {banks.length} of {MAX_BANKS}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {banks.map((b) => {
              const isDefault = b.id === mainBank?.id
              return (
                <div key={b.id} className={cx('flex items-center gap-3 rounded-[12px] border bg-card px-3.5 py-3', isDefault ? 'border-fg/70' : 'border-line')}>
                  <PlaceMark src="/brand/bank.png" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-fg">{b.bank}</span>
                      {isDefault && <Badge tone="info">Default</Badge>}
                      {b.verified ? <Badge tone="good">Verified</Badge> : b.declined ? <Badge tone="bad">Not approved</Badge> : <Badge tone="warn">Checking</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-dim">
                      <span className="font-mono text-muted">{b.account.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}</span> · {b.name}
                    </div>
                  </div>
                  {placesOwner && <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <button onClick={() => setRemoving(b.id)} className="flex size-7 items-center justify-center rounded-[6px] text-dim hover:bg-raise hover:text-red" aria-label={`Remove ${bankLabel(b)}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                    {!isDefault && b.verified && (
                      <button onClick={() => void changeBank(b.id, 'default')} className="whitespace-nowrap text-[12px] font-medium text-muted hover:text-fg hover:underline">
                        Make default
                      </button>
                    )}
                  </div>}
                </div>
              )
            })}
            {placesOwner && banks.length < MAX_BANKS && (
              <button
                onClick={() => setBankOpen(true)}
                className="flex min-h-[66px] items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#CFCCC3] text-[13.5px] font-medium text-muted transition hover:border-fg/40 hover:bg-[#FAFAF8] hover:text-fg"
              >
                <Plus className="size-4" />
                {banks.length ? 'Add another bank account' : 'Add a bank account'}
              </button>
            )}
          </div>
          {banks.length >= MAX_BANKS && <p className="mt-3 text-[12.5px] text-dim">That's the most you can add. Remove one to add another.</p>}
          {banks.some((b) => !b.verified && !b.declined) && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-dim">An account marked Checking is saved, but nothing settles to it until our team confirms it's {individual ? 'yours' : "the business's"}.</p>
          )}
          {banks.some((b) => b.declined) && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-dim">
              Not approved means our team couldn't confirm the account is {individual ? 'yours' : "the business's"}. Remove it and add one in {individual ? 'your own name' : "the business's registered name"}.
            </p>
          )}
          {bankError && <p className="mt-3 text-[12.5px] text-red">{bankError}</p>}
        </div>
      )}

      {tab === 'mm' && (
        <div className="max-w-[820px]">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] text-muted">Up to {MAX_MM}, linked from the app. Lands in the app, ready to spend or send.</p>
            <span className="tabular text-[12.5px] text-dim">
              {mms.length} of {MAX_MM}
            </span>
          </div>
          {LIVE && !placesOwner ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {mms.length === 0 && <p className="text-[13px] text-dim">No Money Moves account is linked yet.</p>}
              {mms.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-[12px] border border-line bg-card px-3.5 py-3">
                  <AppIcon size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-fg">{m.username}</span>
                      {m.id === mainMm?.id && m.linked && <Badge tone="info">Default</Badge>}
                      {m.linked ? <Badge tone="good">Linked</Badge> : <Badge tone="warn">Waiting</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-dim">Money Moves account</div>
                  </div>
                </div>
              ))}
            </div>
          ) : LIVE ? (
            <MoneyMovesLinker />
          ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mms.map((m) => {
              const isDefault = m.id === mainMm?.id
              return (
                <div key={m.id} className={cx('flex items-center gap-3 rounded-[12px] border bg-card px-3.5 py-3', isDefault && m.linked ? 'border-fg/70' : 'border-line')}>
                  <AppIcon size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-fg">{m.username}</span>
                      {isDefault && m.linked && <Badge tone="info">Default</Badge>}
                      {m.linked ? <Badge tone="good">Linked</Badge> : <Badge tone="warn">Waiting</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[12.5px] text-dim">{m.linked ? 'Money Moves account' : 'Approve the request in the app'}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    {m.linked ? (
                      <>
                        <button onClick={() => setUnlinking(m.id)} className="whitespace-nowrap text-[12px] font-medium text-muted hover:text-red hover:underline">
                          Unlink
                        </button>
                        {!isDefault && (
                          <button onClick={() => setTargets((t) => withMms(t, mmsOf(t), m.id))} className="whitespace-nowrap text-[12px] font-medium text-muted hover:text-fg hover:underline">
                            Make default
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setTargets((t) => withMms(t, mmsOf(t).map((x) => (x.id === m.id ? { ...x, linked: true } : x))))}
                          className="whitespace-nowrap text-[12px] font-medium text-fg hover:underline"
                        >
                          I've approved it
                        </button>
                        <button onClick={() => setTargets((t) => withMms(t, mmsOf(t).filter((x) => x.id !== m.id)))} className="whitespace-nowrap text-[12px] font-medium text-muted hover:text-fg hover:underline">
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {mms.length < MAX_MM && (
              <button
                onClick={() => setMmOpen(true)}
                className="flex min-h-[66px] items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#CFCCC3] text-[13.5px] font-medium text-muted transition hover:border-fg/40 hover:bg-[#FAFAF8] hover:text-fg"
              >
                <Plus className="size-4" />
                {mms.length ? 'Link another account' : 'Link a Money Moves account'}
              </button>
            )}
          </div>
          )}
          {/* Live, the linker says both itself - the limit, and where to get the app. */}
          {!LIVE && mms.length >= MAX_MM && <p className="mt-3 text-[12.5px] text-dim">That's the most you can link. Unlink one to add another.</p>}
          {!LIVE && <GetTheApp />}
        </div>
      )}

      {tab === 'wallets' && placesOwner && (
        <div className="max-w-[820px] space-y-9">
          <section>
            <div className="text-[15px] font-semibold text-fg">Business wallet</div>
            <p className="mb-3 mt-1 text-[13px] text-muted">Self-custodial and embedded. Payment links, invoices, outlets and API payments can all settle here.</p>
            <div className="overflow-hidden rounded-[12px] border border-line bg-card">
              <Place
                icon={<PlaceMark src="/brand/wallet.png" />}
                title="Business wallet"
                detail={
                  ready.onchain.ready
                    ? LIVE
                      ? targets.businessWallet?.address
                        ? `${short(walletAddressOn(targets, business.settleChain), 6, 4)} · on ${SETTLE_CHAINS.find(([id]) => id === (business.settleChain ?? 'MOVEMENT'))?.[1] ?? 'Movement'}`
                        : 'Self-custody wallet'
                      : `${short(BALANCES.onchain.address, 6, 4)} · self-custody wallet`
                    : "A self-custody wallet, created for you the moment you're approved"
                }
                note="Only you can move what's in it · arrives as USDC or USDT"
                status={ready.onchain.ready ? <Badge tone="good">Ready</Badge> : <Badge>Not yet</Badge>}
                action={
                  ready.onchain.ready ? (
                    <Link to="/balances">
                      <Button size="sm">Open</Button>
                    </Link>
                  ) : null
                }
              />
            </div>
          </section>
          <section>
            <div className="text-[15px] font-semibold text-fg">Crypto wallets</div>
            <p className="mb-3 mt-1 text-[13px] text-muted">Your own wallets, saved so you can send to them from your business wallet. Payments never settle to these.</p>
            <SavedWallets />
          </section>
        </div>
      )}

      <Modal
        open={mmOpen}
        onClose={() => setMmOpen(false)}
        title={mms.length ? 'Link another Money Moves account' : 'Link your Money Moves account'}
        sub="We'll send a request to the app. Open Money Moves and approve it to finish."
        footer={
          <>
            <Button onClick={() => setMmOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={mm.replace('@', '').length < 3}
              onClick={() => {
                setTargets((t) => withMms(t, [...mmsOf(t), { id: `mm_${Date.now()}`, username: mm.startsWith('@') ? mm : `@${mm}`, linked: false }]))
                setMm('')
                setMmOpen(false)
              }}
            >
              Send request
            </Button>
          </>
        }
      >
        <Field label="Money Moves username">
          <Input value={mm} onChange={(e) => setMm(e.target.value.replace(/\s/g, ''))} placeholder="@username" autoFocus />
        </Field>
        <div className="mt-4">
          <GetTheApp compact />
        </div>
      </Modal>

      <AddBankModal
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        first={!banks.length}
        owner={owner}
        onAdded={(bank) => setTargets((t) => withBanks(t, [...banksOf(t), bank]))}
      />

      <Modal
        open={!!toRemove}
        onClose={() => setRemoving(null)}
        title={toRemove ? `Remove ${bankLabel(toRemove)}?` : ''}
        sub={
          banks.filter((b) => b.verified && b.id !== removing).length
            ? 'Links, invoices and outlets set to this account will settle to your default account instead. Payments already made are not affected.'
            : "It's your only checked bank account. Anything set to settle to a bank will go to your business wallet until you add another."
        }
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) void changeBank(removing, 'remove')
                setRemoving(null)
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        {toRemove && (
          <div className="rounded-[10px] border border-line px-4 py-3 text-[13px]">
            <div className="font-medium text-fg">{toRemove.name}</div>
            <div className="font-mono text-[12.5px] text-dim">
              {toRemove.bank} · {toRemove.account}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!toUnlink}
        onClose={() => setUnlinking(null)}
        title={`Unlink ${toUnlink?.username ?? 'this account'}?`}
        sub="You can link an account again any time."
        footer={
          <>
            <Button onClick={() => setUnlinking(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                setTargets((t) => withMms(t, mmsOf(t).filter((m) => m.id !== unlinking)))
                setUnlinking(null)
              }}
            >
              Unlink
            </Button>
          </>
        }
      >
        <div className="flex gap-3 rounded-[10px] border border-line bg-[#FAFAF8] p-4 text-[13px] leading-relaxed text-muted">
          <PlaceMark src="/brand/wallet.png" />
          <span>
            {mmUses.length ? (
              <>
                <span className="font-medium text-fg">{mmUses.join(', ')}</span> {mmUses.length === 1 && /^1 /.test(mmUses[0]!) ? 'settles' : 'settle'} to this account.{' '}
              </>
            ) : null}
            Nothing stops: once it's unlinked, payments set to this account go to your <span className="font-medium text-fg">business wallet</span> instead.
          </span>
        </div>
      </Modal>
    </>
  )
}

const PREVIEW_BANKS = ['Access Bank', 'First Bank', 'GTBank', 'Kuda', 'Moniepoint', 'Nombank MFB', 'Opay', 'Palmpay', 'UBA', 'Zenith Bank']

/**
 * Adding a bank account. The bank tells us whose it is as soon as there's a
 * bank and ten digits; it has to be the business's own (or, for "Just me",
 * the person's). One that doesn't match can still be saved - it waits for our
 * team to confirm it, and nothing settles to it until then.
 */
export function AddBankModal({ open, onClose, first, owner, onAdded }: { open: boolean; onClose: () => void; first: boolean; owner: { label: string; name: string | null }; onAdded: (b: BankAccount) => void }) {
  const { business } = useSession()
  const list = useApi<{ banks: ApiBank[] }>(LIVE && open ? '/banks' : null)
  const [bank, setBank] = useState('')
  const [account, setAccount] = useState('')
  const [found, setFound] = useState<{ name: string; matches: boolean } | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const close = () => {
    onClose()
    setTimeout(() => {
      setBank('')
      setAccount('')
      setFound(null)
      setError('')
    }, 150)
  }

  useEffect(() => {
    setFound(null)
    setError('')
    if (!business || !bank || account.length !== 10) return
    let gone = false
    setChecking(true)
    const look = LIVE
      ? api<{ accountName: string; nameMatches: boolean }>('POST', `${bankAccountsPath(business.id)}/resolve`, { bankCode: bank, accountNumber: account }).then((r) => ({ name: r.accountName, matches: r.nameMatches }))
      : new Promise<{ name: string; matches: boolean }>((done) => setTimeout(() => done({ name: (owner.name ?? 'Ada Okonkwo').toUpperCase(), matches: true }), 700))
    look
      .then((r) => !gone && setFound(r))
      .catch((e) => !gone && setError(e instanceof ApiError ? e.message : "We couldn't check that account just now."))
      .finally(() => !gone && setChecking(false))
    return () => {
      gone = true
    }
  }, [bank, account, business])

  const save = async () => {
    if (!business || !found) return
    if (!LIVE) {
      onAdded({ id: `bk_${Date.now()}`, bank, account, name: found.name, verified: true })
      close()
      return
    }
    setSaving(true)
    setError('')
    try {
      await api('POST', bankAccountsPath(business.id), { bankCode: bank, accountNumber: account })
      await reload(bankAccountsPath(business.id))
      close()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setSaving(false)
    }
  }

  const options = LIVE ? (list.data?.banks ?? []).map((b) => ({ value: b.code, label: b.name })) : PREVIEW_BANKS.map((b) => ({ value: b, label: b }))
  return (
    <Modal
      open={open}
      onClose={close}
      title={first ? 'Add a bank account' : 'Add another bank account'}
      sub={owner.name ? `Best in ${owner.name.toUpperCase()}'s name. Any other account is checked by our team first.` : 'Any account works, one not in your name is checked by our team first.'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!found || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save account'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Bank">
          <Select value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">{LIVE && list.loading ? 'Loading banks…' : LIVE && list.error ? "The banks didn't load" : 'Choose your bank'}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {LIVE && list.error && <p className="-mt-2 text-[12.5px] text-red">{list.error.message}</p>}
        <Field label="Account number">
          <Input value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="0123456789" inputMode="numeric" />
        </Field>
        <div
          className={cx(
            'flex min-h-10 items-center gap-2 rounded-[7px] border px-3 py-2 text-[14px]',
            found?.matches ? 'border-fg bg-[#F3FBE6] text-fg' : found ? 'border-[#EBD3A6] bg-[#FDF6E7] text-fg' : error ? 'border-[#EFC4C0] bg-[#FBEAE8] text-[#7D1F19]' : 'border-line bg-raise text-dim',
          )}
        >
          {checking ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Checking the account…
            </>
          ) : found ? (
            <>
              {found.matches && <Check className="size-4 text-accent" strokeWidth={3} />}
              <span className="min-w-0 flex-1 truncate font-medium">{found.name}</span>
              <span className={cx('shrink-0 text-[12px]', found.matches ? 'text-accent' : 'text-amber')}>{found.matches ? 'Name matches' : "Doesn't match"}</span>
            </>
          ) : error ? (
            <span className="text-[13px]">{error}</span>
          ) : (
            'The account name appears here'
          )}
        </div>
        {found && !found.matches && (
          <p className="text-[12.5px] leading-relaxed text-muted">
            You can still save it. Nothing settles to it until our team confirms it's yours
            {owner.name ? `. We expected ${owner.name.toUpperCase()}` : '. We check it against your ID when you verify'}.
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ─── IPs, keys, webhooks ──────────────────────────────────────────── */
