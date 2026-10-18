/**
 * The top right of every page: search (Ctrl K) across pages, payments,
 * customers, links and invoices; an eye that hides amounts; what's happened
 * lately; a way to tell us something; and the signed-in person's menu.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownLeft, ArrowRight, Bell, Eye, EyeOff, FileText, Gift, Link2, LogOut, Search, Settings, Store, UserRound, Users } from '@/components/icons'
import { UserPhoto } from '@/components/Pictures'
import { CUSTOMERS, INVOICES, NGN_RATE, OUTLETS, PAYMENTS, PAYMENT_LINKS, SETTLEMENTS, type Business, type Payment, type Settlement } from '@/data/mock'
import { ApiError, LIVE, api, type ApiInvoice, type ApiOutlet } from '@/lib/api'
import { PAY_HOST, useApiInvoices, useApiLinks, useApiOutlets, usePayments, useSettlements } from '@/state/live'
import { useSession } from '@/state/session'
import { createStore } from '@/state/store'
import { ago, initials, ngn, usd } from '@/lib/format'
import { Button, Modal, Textarea, cx } from './ui'

/** The square, outlined buttons: the eye and the bell. */
const square = 'flex size-9 items-center justify-center rounded-[10px] border border-line bg-card text-muted transition hover:border-[#D3D0C7] hover:text-fg'

/** Closes a popover when the click lands outside it. */
function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

/* ─── Search ───────────────────────────────────────────────────────── */

type Hit = { id: string; group: string; title: string; sub: string; to: string; icon: ReactNode }

const PAGES: [string, string, string][] = [
  ['Home', '/dashboard', 'Overview'],
  ['Payments', '/transactions', 'Every payment'],
  ['Refunds', '/transactions/refunds', 'Money going back'],
  ['Disputes', '/transactions/disputes', 'Questions about payments'],
  ['Customers', '/customers', 'People who pay you'],
  ['Payment links', '/collect/links', 'Links anyone can pay'],
  ['Invoices', '/collect/invoices', 'Bills by email'],
  ['Outlets', '/collect/outlets', 'Store QR codes'],
  ['Deposit addresses', '/collect/addresses', 'Permanent customer addresses'],
  ['Settlements', '/balances/settlements', 'Where payments went'],
  ['Business wallet', '/balances', 'Balance, send money'],
  ['API keys', '/settings/api-keys', 'Developer portal'],
  ['Webhooks', '/settings/webhooks', 'Developer portal'],
  ['Events', '/settings/events', 'Developer portal, webhook deliveries'],
  ['Logs', '/settings/logs', 'Developer portal, API requests'],
  ['IP whitelist', '/settings/ips', 'Developer portal'],
  ['Profile', '/settings/profile', 'Your name and sign-in'],
  ['Referrals', '/settings/referrals', 'Invite businesses'],
  ['Payout places', '/settings/settlement', 'Bank accounts, Money Moves, wallets'],
  ['Fees', '/settings/business?tab=fees', 'Settings'],
  ['Payment methods', '/settings/business?tab=methods', 'Settings'],
  ['Branding', '/settings/branding', 'Settings'],
  ['Compliance', '/settings/compliance', 'Settings'],
  ['Team', '/settings/team', 'Settings'],
]

/** What search looks through: live, the business's own payments and links. */
type Searchable = { payments: Payment[]; links: { id: string; name: string; slug: string }[]; invoices?: ApiInvoice[]; outlets?: ApiOutlet[] }

function searchAll(q: string, data: Searchable): Hit[] {
  const s = q.trim().toLowerCase()
  const has = (...xs: (string | undefined)[]) => xs.some((x) => x?.toLowerCase().includes(s))
  if (!s) return PAGES.slice(0, 7).map(([t, to, sub]) => ({ id: `p_${to}`, group: 'Go to', title: t, sub, to, icon: <ArrowRight className="size-4" /> }))
  const hits: Hit[] = []
  for (const [t, to, sub] of PAGES) if (has(t, sub)) hits.push({ id: `p_${to}`, group: 'Pages', title: t, sub, to, icon: <ArrowRight className="size-4" /> })
  for (const p of data.payments)
    if (has(p.ref, p.customer.name, p.customer.email))
      hits.push({ id: p.id, group: 'Payments', title: `${p.customer.name} · ${usd(p.usd)}`, sub: `${p.ref} · ${p.status} · ${ago(p.createdAt)}`, to: `/transactions?q=${encodeURIComponent(p.ref)}`, icon: <ArrowDownLeft className="size-4" /> })
  for (const l of data.links) if (has(l.name, l.slug)) hits.push({ id: l.id, group: 'Payment links', title: l.name, sub: `${PAY_HOST}/${l.slug}`, to: '/collect/links', icon: <Link2 className="size-4" /> })
  for (const i of data.invoices ?? [])
    if (has(i.number, i.customerName, i.customerEmail))
      hits.push({ id: i.id, group: 'Invoices', title: `${i.number} · ${i.customerName}`, sub: `${i.currency === 'NGN' ? ngn(i.amount) : usd(i.amount)} · ${i.status.toLowerCase()}`, to: '/collect/invoices', icon: <FileText className="size-4" /> })
  for (const o of data.outlets ?? []) if (has(o.name, o.location, o.slug)) hits.push({ id: o.id, group: 'Outlets', title: o.name, sub: o.location, to: '/collect/outlets', icon: <Store className="size-4" /> })
  // Preview's samples - live, the business's own come from the API above.
  if (!LIVE) {
    for (const c of CUSTOMERS) if (has(c.name, c.email)) hits.push({ id: c.id, group: 'Customers', title: c.name, sub: c.email, to: `/customers?q=${encodeURIComponent(c.email)}`, icon: <Users className="size-4" /> })
    for (const i of INVOICES) if (has(i.number, i.customer, i.email)) hits.push({ id: i.id, group: 'Invoices', title: `${i.number} · ${i.customer}`, sub: `${usd(i.amountUsd)} · ${i.status}`, to: '/collect/invoices', icon: <FileText className="size-4" /> })
    for (const o of OUTLETS) if (has(o.name, o.location)) hits.push({ id: o.id, group: 'Outlets', title: o.name, sub: o.location, to: '/collect/outlets', icon: <Store className="size-4" /> })
  }
  return hits.slice(0, 30)
}

export function SearchButton() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-9 w-[220px] items-center gap-2 rounded-[10px] border border-line bg-card px-3 text-left text-[13.5px] text-dim transition hover:border-[#D3D0C7] md:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate">Search</span>
        <span className="text-[12px]">{mac ? '⌘ K' : 'Ctrl K'}</span>
      </button>
      <button onClick={() => setOpen(true)} className={cx(square, 'md:hidden')} aria-label="Search">
        <Search className="size-[18px]" />
      </button>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const { payments } = usePayments()
  const { links } = useApiLinks()
  const { invoices } = useApiInvoices()
  const { outlets } = useApiOutlets()
  const hits = useMemo(() => searchAll(q, { payments, links: LIVE ? (links ?? []) : PAYMENT_LINKS, invoices, outlets }), [q, payments, links, invoices, outlets])
  const go = (h: Hit) => {
    navigate(h.to)
    onClose()
  }
  let last = ''
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-fg/25 px-4 pt-[12vh]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rise w-full max-w-[580px] overflow-hidden rounded-[14px] border border-line bg-card shadow-[0_30px_80px_-20px_rgba(18,18,16,0.4)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="size-[18px] text-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAt((a) => Math.min(hits.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAt((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && hits[at]) go(hits[at]!)
              else if (e.key === 'Escape') onClose()
            }}
            placeholder="Search payments, customers, links, invoices or pages"
            className="h-12 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-dim"
          />
          <kbd className="rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim">Esc</kbd>
        </div>
        <div className="max-h-[56vh] overflow-y-auto p-2">
          {hits.length === 0 ? (
            <div className="px-3 py-10 text-center text-[13.5px] text-muted">Nothing for "{q}". Try a name, an email, or a reference like MMB-48211.</div>
          ) : (
            hits.map((h, i) => {
              const head = h.group !== last
              last = h.group
              return (
                <div key={h.id}>
                  {head && <div className="px-3 pb-1 pt-2.5 text-[11.5px] font-medium text-dim">{h.group}</div>}
                  <button onMouseEnter={() => setAt(i)} onClick={() => go(h)} className={cx('flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left', i === at ? 'bg-raise' : '')}>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line text-muted">{h.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-fg">{h.title}</span>
                      <span className="block truncate text-[12px] text-dim">{h.sub}</span>
                    </span>
                    {i === at && <ArrowRight className="size-4 text-dim" />}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ─── Hide amounts ─────────────────────────────────────────────────── */

const hideStore = createStore<boolean>('mmb_hide_amounts_v1', () => false)

/** The eye: blurs every figure on the page, for screen-sharing or a café. */
export function HideAmountsButton() {
  const { business } = useSession()
  const [hidden = false, setHidden] = hideStore.use(business?.id)
  useEffect(() => {
    const root = document.documentElement
    if (hidden) root.dataset.hideAmounts = ''
    else delete root.dataset.hideAmounts
    return () => {
      delete root.dataset.hideAmounts
    }
  }, [hidden])
  return (
    <button onClick={() => setHidden(!hidden)} className={cx(square, hidden && 'border-fg/70 text-fg')} aria-label={hidden ? 'Show amounts' : 'Hide amounts'} title={hidden ? 'Show amounts' : 'Hide amounts'}>
      {hidden ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
    </button>
  )
}

/** The same switch as the eye, as a row in your menu - for a phone, where the eye isn't shown. */
function HideAmountsItem({ className }: { className: string }) {
  const { business } = useSession()
  const [hidden = false, setHidden] = hideStore.use(business?.id)
  return (
    <button onClick={() => setHidden(!hidden)} className={className}>
      {hidden ? <Eye className="size-[18px] text-muted" /> : <EyeOff className="size-[18px] text-muted" />} {hidden ? 'Show amounts' : 'Hide amounts'}
    </button>
  )
}

/* ─── Notifications ────────────────────────────────────────────────── */

type Note = { id: string; title: string; body: string; at: string; to: string }

function notesFor(): Note[] {
  const h = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString()
  const pay = PAYMENTS.find((p) => p.status === 'successful')!
  const stl = SETTLEMENTS.find((s) => s.status === 'settled')!
  return [
    { id: 'n1', title: 'Payment received', body: `${pay.customer.name} paid ${usd(pay.usd)} by ${pay.channel.toLowerCase()}.`, at: h(0.3), to: `/transactions?q=${pay.ref}` },
    { id: 'n2', title: 'A bank claim needs a reply', body: 'A customer’s bank says a transfer wasn’t authorised. Reply by Monday to keep the payment.', at: h(2), to: '/transactions/disputes' },
    { id: 'n3', title: 'Settlement sent', body: `${stl.ngn ? ngn(stl.ngn) : usd(stl.amountUsd)} went to ${stl.target}.`, at: h(5), to: '/balances/settlements' },
    { id: 'n4', title: 'Refund delivered', body: `${ngn(Math.round(14.79 * NGN_RATE))} reached the customer’s bank account.`, at: h(21), to: '/transactions/refunds' },
    { id: 'n5', title: 'Compliance task due', body: 'Add the BVN of a director to keep your account in good standing.', at: h(30), to: '/settings/compliance' },
    { id: 'n6', title: 'New sign-in', body: 'Chrome on Windows, from Lagos. Not you? Change your password.', at: h(52), to: '/settings/profile' },
  ]
}

/** Live: only what really happened - the approval, payments that arrived and settlements that landed. */
function liveNotes(payments: Payment[], settlements: Settlement[], business: Business | null): Note[] {
  const approved: Note[] =
    business?.verify === 'verified' && business.verifiedAt
      ? [{ id: `approved_${business.id}`, title: 'Your business is approved', body: `Congratulations, ${business.name} can take live payments. Switch to production to start.`, at: business.verifiedAt, to: '/dashboard' }]
      : []
  const paid = payments
    .filter((p) => p.status === 'successful')
    .slice(0, 6)
    .map((p) => ({ id: `pay_${p.id}`, title: 'Payment received', body: `${p.customer.name} paid ${ngn(p.amount)} by bank transfer.`, at: p.paidAt ?? p.createdAt, to: `/transactions?q=${p.ref}` }))
  const sent = settlements
    .filter((s) => s.status === 'settled')
    .slice(0, 6)
    .map((s) => ({ id: `stl_${s.id}`, title: 'Settlement sent', body: `${s.ngn != null ? ngn(s.ngn) : usd(s.amountUsd)} went to ${s.target}.`, at: s.live?.settledAt ?? s.createdAt, to: '/balances/settlements' }))
  return [...approved, ...paid, ...sent].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
}

const readStore = createStore<string[]>('mmb_notes_read_v1', () => [])

export function NotificationsButton() {
  const { business } = useSession()
  const [read = [], setRead] = readStore.use(business?.id)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'unread' | 'all'>('all')
  const ref = useOutside(open, () => setOpen(false))
  const { payments } = usePayments()
  const { settlements } = useSettlements()
  const notes = useMemo(() => (LIVE ? liveNotes(payments, settlements, business) : notesFor()), [payments, settlements, business])
  const unread = notes.filter((n) => !read.includes(n.id))
  const shown = tab === 'unread' ? unread : notes
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={cx(square, 'relative', open && 'border-fg/70 text-fg')} aria-label="Notifications">
        <Bell className="size-[18px]" />
        {unread.length > 0 && (
          <span className="tabular absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-fg px-1 text-[10px] font-semibold leading-none text-white">
            {unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="rise absolute right-0 top-full z-[96] mt-2 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[14px] border border-line bg-card shadow-[0_24px_60px_-16px_rgba(18,18,16,0.28)]">
          <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
            <span className="text-[17px] font-semibold text-fg">Notifications</span>
            {!LIVE && (
              <Link to="/settings/business?tab=notifications" onClick={() => setOpen(false)} className="rounded-[9px] border border-line px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-raise">
                View preferences
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 pb-3">
            {(
              [
                ['unread', 'Unread', unread.length],
                ['all', 'All', notes.length],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cx('rounded-[10px] border px-3 py-2 text-left transition', tab === id ? 'border-fg bg-[#F6F8EF]' : 'border-line hover:border-[#D3D0C7]')}
              >
                <span className={cx('block text-[13px]', tab === id ? 'text-fg' : 'text-muted')}>{label}</span>
                <span className="tabular block text-[18px] font-semibold leading-tight text-fg">{n}</span>
              </button>
            ))}
          </div>
          <div className="max-h-[min(400px,calc(100vh-300px))] overflow-y-auto border-t border-line">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13.5px] text-muted">You’re all caught up.</div>
            ) : (
              shown.map((n) => {
                const isNew = !read.includes(n.id)
                return (
                  <Link
                    key={n.id}
                    to={n.to}
                    onClick={() => {
                      setRead((r) => [...new Set([...r, n.id])])
                      setOpen(false)
                    }}
                    className="relative block border-b border-soft px-4 py-3.5 last:border-b-0 hover:bg-[#FAFAF8]"
                  >
                    {isNew && <span className="absolute inset-y-0 left-0 w-[3px] bg-fg" />}
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-semibold text-fg">{n.title}</span>
                      <span className="shrink-0 text-[12px] text-dim">{ago(n.at)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted">{n.body}</span>
                  </Link>
                )
              })
            )}
          </div>
          <div className="flex justify-end border-t border-line px-4 py-3">
            <button onClick={() => setRead(notes.map((n) => n.id))} disabled={!unread.length} className="text-[13.5px] font-semibold text-accent hover:underline disabled:text-dim disabled:no-underline">
              Mark all as read
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Feedback ─────────────────────────────────────────────────────── */

export function FeedbackButton() {
  const { business } = useSession()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'idea' | 'problem' | 'question'>('idea')
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const close = () => {
    setOpen(false)
    setTimeout(() => {
      setSent(false)
      setText('')
      setProblem('')
    }, 200)
  }
  /** Live: emailed to the team, who reply by email. */
  const submit = async () => {
    if (!LIVE) return setSent(true)
    setBusy(true)
    setProblem('')
    try {
      await api('POST', '/support', { kind, text: text.trim(), businessId: business?.id, page: window.location.pathname })
      setSent(true)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That didn't send. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button onClick={() => setOpen(true)} className="hidden h-9 rounded-full bg-raise px-4 text-[13.5px] font-medium text-fg transition hover:bg-[#EAE8E2] sm:block">
        Feedback
      </button>
      <Modal
        open={open}
        onClose={close}
        title={sent ? 'Thanks. It’s with the team' : 'Send feedback'}
        sub={sent ? 'We read every message. If you asked something, we’ll reply by email.' : 'What’s broken, confusing or missing? A sentence is enough.'}
        footer={
          sent ? (
            <Button variant="primary" onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!text.trim() || busy} onClick={() => void submit()}>
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p className="rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 py-3 text-[13.5px] leading-relaxed text-muted">“{text.trim()}”</p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-1.5">
              {(
                [
                  ['idea', 'An idea'],
                  ['problem', 'A problem'],
                  ['question', 'A question'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setKind(id)}
                  className={cx('rounded-full border px-3 py-1.5 text-[13px] font-medium transition', kind === id ? 'border-fg bg-fg text-white' : 'border-line text-muted hover:text-fg')}
                >
                  {label}
                </button>
              ))}
            </div>
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'problem' ? 'What happened, and what did you expect?' : kind === 'question' ? 'Ask away.' : 'What would make Money Moves better for you?'}
              className="min-h-[120px]"
            />
            <p className="text-[12px] text-dim">We attach the page you’re on, so you don’t have to explain where.</p>
            {problem && <p className="text-[13px] text-red">{problem}</p>}
          </div>
        )}
      </Modal>
    </>
  )
}

/* ─── The person ───────────────────────────────────────────────────── */

export function ProfileButton() {
  const { user, signOut } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  if (!user) return null
  const name = `${user.first} ${user.last}`
  const item = 'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[14px] text-fg hover:bg-raise'
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx('flex size-9 items-center justify-center rounded-full bg-fg text-[12px] font-semibold text-white transition', open && 'ring-2 ring-fg/20 ring-offset-2 ring-offset-card')}
        aria-label="Your account"
        title={name}
      >
        {user.avatar ? <img src={user.avatar} alt="" className="size-full rounded-full object-cover" /> : initials(name)}
      </button>
      {open && (
        <div className="rise absolute right-0 top-full z-[96] mt-2 w-[280px] overflow-hidden rounded-[14px] border border-line bg-card shadow-[0_24px_60px_-16px_rgba(18,18,16,0.28)]">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <UserPhoto name={name} src={user.avatar} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-fg">{name}</span>
              <span className="block truncate text-[12.5px] text-dim">{user.email}</span>
            </span>
          </div>
          <div className="p-1.5">
            <Link to="/settings/profile" onClick={() => setOpen(false)} className={item}>
              <UserRound className="size-[18px] text-muted" /> Profile
            </Link>
            <Link to="/settings/business" onClick={() => setOpen(false)} className={item}>
              <Settings className="size-[18px] text-muted" /> All settings
            </Link>
            <Link to="/settings/referrals" onClick={() => setOpen(false)} className={item}>
              <Gift className="size-[18px] text-muted" /> Referrals
            </Link>
            <HideAmountsItem className={cx(item, 'sm:hidden')} />
          </div>
          <div className="border-t border-line p-1.5">
            <button
              onClick={() => {
                signOut()
                navigate('/login')
              }}
              className={cx(item, 'text-red hover:bg-[#FBEAE8]')}
            >
              <LogOut className="size-[18px]" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
