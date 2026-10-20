/**
 * The frame around every signed-in screen.
 *
 * A tinted sidebar grouped the way money moves - in, out, and the developer
 * tools - with a page's sub-pages opening beneath it only while you are
 * there. The page you are on is a white sheet lifted off the sidebar, its
 * icon filled in lime; the work area itself is plain white. Test mode is a hazard
 * stripe across the top that cannot be mistaken for anything else.
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { DOCS_URL } from '@/lib/links'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronsUpDown,
  Code2,
  Copy,
  FileText,
  House,
  Landmark,
  LifeBuoy,
  Link2,
  LogOut,
  Menu,
  Plus,
  QrCode,
  Rocket,
  Settings,
  ShieldAlert,
  Smartphone,
  Store,
  Users,
  Wallet,
  X,
  type IconWeight,
  Sun,
  Moon,
} from '@/components/icons'
import { useSession } from '@/state/session'
import { useBrandingSync } from '@/state/branding'
import { useApplyTheme, useTheme } from '@/state/theme'
import { BusinessMark } from '@/components/Pictures'
import { Banner, cx } from '@/components/ui'
import { LIVE, api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { copy } from '@/lib/format'
import { FeedbackButton, HideAmountsButton, NotificationsButton, ProfileButton, SearchButton } from '@/components/TopBar'
import { useChecklist } from '@/pages/home'
import { useTasksDue } from '@/pages/compliance'
import { useRole } from '@/state/roles'

type Icon = ComponentType<{ className?: string; weight?: IconWeight }>
interface Item {
  label: string
  to: string
  icon: Icon
  children?: { label: string; to: string }[]
  /** Opens another site in a new tab instead. */
  external?: string
  /** Other pages that count as this one - the portal's tabs. */
  also?: { label: string; to: string }[]
  /** The owner and admins only: hidden from the rest of the team. */
  ownerOnly?: boolean
}

const GROUPS: { label?: string; items: Item[] }[] = [
  {
    items: [
      { label: 'Home', to: '/dashboard', icon: House },
      { label: 'Get started', to: '/getting-started', icon: Rocket },
    ],
  },
  {
    label: 'Money in',
    items: [
      {
        label: 'Payments',
        to: '/transactions',
        icon: ArrowDownLeft,
        children: [
          { label: 'Refunds', to: '/transactions/refunds' },
          { label: 'Disputes', to: '/transactions/disputes' },
        ],
      },
      { label: 'Customers', to: '/customers', icon: Users },
      { label: 'Payment links', to: '/collect/links', icon: Link2 },
      { label: 'Invoices', to: '/collect/invoices', icon: FileText },
      { label: 'Outlets', to: '/collect/outlets', icon: Store },
      { label: 'Deposit addresses', to: '/collect/addresses', icon: QrCode },
    ],
  },
  {
    label: 'Money out',
    items: [
      { label: 'Settlements', to: '/balances/settlements', icon: Landmark },
      { label: 'Business wallet', to: '/balances', icon: Wallet, ownerOnly: true },
      { label: 'Reports', to: '/reports', icon: FileText },
    ],
  },
  {
    label: 'Developers',
    items: [
      {
        label: 'Developer portal',
        to: '/settings/api-keys',
        icon: Code2,
        also: [
          { label: 'API keys', to: '/settings/api-keys' },
          { label: 'Webhooks', to: '/settings/webhooks' },
          { label: 'Events', to: '/settings/events' },
          { label: 'Logs', to: '/settings/logs' },
        ],
      },
      { label: 'Developer docs', to: '/developers/docs', icon: BookOpen, external: DOCS_URL },
    ],
  },
]

const SETTINGS: Item = {
  label: 'Settings',
  to: '/settings/business',
  icon: Settings,
  children: [
    { label: 'Payout places', to: '/settings/settlement' },
    { label: 'Compliance', to: '/settings/compliance' },
    { label: 'Branding', to: '/settings/branding' },
    { label: 'Team', to: '/settings/team' },
    { label: 'Roles', to: '/settings/roles' },
    { label: 'Activity', to: '/settings/activity' },
  ],
}

function owns(item: Item, path: string) {
  return path === item.to || !!item.children?.some((c) => path === c.to) || !!item.also?.some((c) => path === c.to)
}

/** "Money in / Payments / Refunds" - where you are, in words. */
function crumbs(path: string): string[] {
  for (const g of GROUPS) {
    for (const it of g.items) {
      const tab = it.also?.find((x) => x.to === path)
      if (tab) return [g.label ?? it.label, tab.label]
      if (path === it.to) return g.label ? [g.label, it.label] : [it.label]
      const c = it.children?.find((x) => x.to === path)
      if (c) return g.label ? [g.label, it.label, c.label] : [it.label, c.label]
    }
  }
  if (path === SETTINGS.to) return ['Settings', 'Business']
  if (path === '/settings/profile') return ['You', 'Profile']
  if (path === '/settings/referrals') return ['You', 'Referrals']
  const c = SETTINGS.children!.find((x) => x.to === path)
  return c ? ['Settings', c.label] : ['Overview']
}

export default function AppShell() {
  const { user, business, mode, setMode } = useSession()
  const role = useRole()
  const owner = role === 'OWNER'
  const location = useLocation()
  const [mobileNav, setMobileNav] = useState(false)
  useEffect(() => setMobileNav(false), [location.pathname])
  useBrandingSync(business?.id)
  // The owner asked the team to sign in with an authenticator app, and this person hasn't yet: only their profile opens.
  const gate = useApi<unknown>(LIVE && business ? `/businesses/${business.id}` : null)
  const appRequired = gate.error?.code === 'two_step_required' && location.pathname !== '/settings/profile'
  const [theme, setTheme] = useTheme()
  useApplyTheme(theme)

  if (!user) return <Navigate to="/login" replace />
  if (!business) return <Navigate to="/select-business" replace />

  const test = mode === 'test'
  const canLive = business.verify === 'verified'
  const trail = crumbs(location.pathname)

  return (
    <div className="flex h-full flex-col">
      {test && (
        <div className="stripes relative h-1.5 shrink-0">
          <span className="absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded-b-md bg-[#F2B544] px-2.5 pb-0.5 text-[11px] font-semibold text-fg">
            Test mode
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={cx('fixed inset-0 z-40 bg-fg/20 lg:hidden', mobileNav ? 'block' : 'hidden')} onClick={() => setMobileNav(false)} />
        <aside
          className={cx(
            'fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col border-r border-line bg-side transition-transform lg:static lg:translate-x-0',
            mobileNav ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <BusinessSwitcher />
            <button className="rounded-md p-1.5 text-dim hover:text-fg lg:hidden" onClick={() => setMobileNav(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {GROUPS.map((g, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-5' : 'mt-1'}>
                {g.label && <div className="mb-1 px-2 text-[11.5px] font-medium text-dim">{g.label}</div>}
                {g.items
                  .filter((it) => owner || role === 'ADMIN' || !it.ownerOnly)
                  .map((it) => (
                    <NavItem key={it.to} item={it} path={location.pathname} />
                  ))}
              </div>
            ))}
            <div className="mt-5">
              <NavItem item={owner || role === 'ADMIN' ? SETTINGS : { ...SETTINGS, children: SETTINGS.children!.filter((c) => c.to !== '/settings/activity') }} path={location.pathname} />
            </div>
          </nav>

          <div className="border-t border-line px-3 py-3">
            <ModeSwitch test={test} canLive={canLive} onChange={(live) => setMode(live ? 'live' : 'test')} />
            <ThemeSwitch dark={theme === 'dark'} onChange={(dark) => setTheme(dark ? 'dark' : 'light')} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line bg-card px-4 sm:px-6">
            <button className="rounded-md p-1.5 text-muted hover:text-fg lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu">
              <Menu className="size-5" />
            </button>
            <span className="min-w-0 truncate text-[15px] font-semibold text-fg md:hidden">{trail[trail.length - 1]}</span>
            <div className="hidden min-w-0 items-center gap-2 text-[13.5px] md:flex">
              {trail.map((t, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span className="text-[#CFCCC3]">/</span>}
                  <span className={i === trail.length - 1 ? 'font-medium text-fg' : 'text-dim'}>{t}</span>
                </span>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <SearchButton />
              <div className="hidden sm:block">
                <HideAmountsButton />
              </div>
              <NotificationsButton />
              <FeedbackButton />
              <ProfileButton />
            </div>
          </header>

          <ApprovedBanner />
          <VerificationBanner />

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div key={location.pathname} className="rise mx-auto w-full max-w-[1120px] px-4 py-7 max-sm:pt-5 max-lg:pb-28 sm:px-8 sm:py-9">
              {appRequired ? (
                <div className="mx-auto max-w-[520px] rounded-[14px] border border-line bg-card p-6 text-center sm:p-8">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-raise text-fg">
                    <Smartphone className="size-5" />
                  </span>
                  <h1 className="display mt-4 text-[22px] font-semibold text-fg">Set up an authenticator app</h1>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{business?.name ?? 'This business'} asks everyone on its team to sign in with an authenticator app, like Google Authenticator. It takes a minute, from your profile.</p>
                  <Link to="/settings/profile" className="mt-5 inline-flex h-10 items-center justify-center rounded-[10px] bg-fg px-5 text-[14px] font-semibold text-white">
                    Set it up
                  </Link>
                </div>
              ) : (
                <Outlet />
              )}
            </div>
          </main>
        </div>
      </div>

      <TabBar path={location.pathname} onMore={() => setMobileNav(true)} />
    </div>
  )
}

/** The places you go most, along the bottom on a phone - the rest are under More. */
const TABS: { label: string; to: string; icon: Icon; match: string[]; ownerOnly?: boolean }[] = [
  { label: 'Home', to: '/dashboard', icon: House, match: ['/dashboard', '/getting-started'] },
  { label: 'Payments', to: '/transactions', icon: ArrowDownLeft, match: ['/transactions', '/transactions/refunds'] },
  { label: 'Wallet', to: '/balances', icon: Wallet, match: ['/balances'], ownerOnly: true },
  { label: 'Disputes', to: '/transactions/disputes', icon: ShieldAlert, match: ['/transactions/disputes'] },
  { label: 'Settlements', to: '/balances/settlements', icon: Landmark, match: ['/balances/settlements'] },
]

function TabBar({ path, onMore }: { path: string; onMore: () => void }) {
  // Four places and More: the owner and admins get the wallet, everyone else disputes.
  const r = useRole()
  const owner = r === 'OWNER' || r === 'ADMIN'
  const tabs = TABS.filter((t) => (owner ? t.to !== '/transactions/disputes' : !t.ownerOnly))
  const elsewhere = !tabs.some((t) => t.match.includes(path))
  const tab = (on: boolean) => cx('flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] transition', on ? 'font-medium text-fg' : 'text-dim')
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto grid max-w-[560px] grid-cols-5">
        {tabs.map((t) => {
          const on = t.match.includes(path)
          const I = t.icon
          return (
            <Link key={t.to} to={t.to} className={tab(on)} aria-current={on ? 'page' : undefined}>
              <I className={cx('size-[22px]', on && 'icon-lit')} weight={on ? 'duotone' : 'regular'} />
              {t.label}
            </Link>
          )
        })}
        <button onClick={onMore} className={tab(elsewhere)}>
          <Menu className="size-[22px]" />
          More
        </button>
      </div>
    </nav>
  )
}

function NavItem({ item, path }: { item: Item; path: string }) {
  const active = owns(item, path)
  const exact = path === item.to || !!item.also?.some((c) => path === c.to)
  const Icon = item.icon
  const checklist = useChecklist()
  const left = item.to === '/getting-started' ? checklist.filter((s) => !s.done).length : 0
  if (item.external)
    return (
      <a href={item.external} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-[7px] px-2 py-[6px] text-[13.5px] font-semibold text-fg transition-colors hover:bg-[#EFEEE9]">
        <Icon className="icon-lit size-[18px] shrink-0 text-fg" weight="duotone" />
        <span className="flex-1">{item.label}</span>
        <ArrowUpRight className="size-3.5 text-dim" />
      </a>
    )
  return (
    <div>
      <Link
        to={item.to}
        // Every item in the brand's own voice - lime-lit icon, bold name. The page you're on sits on a card, marked in lime.
        className={cx(
          'relative flex items-center gap-2.5 rounded-[7px] px-2 py-[6px] text-[13.5px] font-semibold text-fg transition-colors',
          exact
            ? 'bg-card shadow-[0_0_0_1px_#E6E4DE,0_1px_2px_rgba(18,18,16,0.05)] before:absolute before:inset-y-[7px] before:left-0 before:w-[3px] before:rounded-r-full before:bg-lime'
            : 'hover:bg-[#EFEEE9]',
        )}
      >
        <Icon className="icon-lit size-[18px] shrink-0 text-fg" weight="duotone" />
        <span className="flex-1">{item.label}</span>
        {left > 0 && <span className="min-w-[18px] rounded-full bg-lime px-1.5 text-center text-[11px] font-semibold leading-[18px] text-fg">{left}</span>}
      </Link>
      {item.children && (
        <div className={cx('relative my-0.5 ml-[17px] border-l border-line pl-2.5', !active && 'lg:hidden')}>
          {item.children.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className={cx(
                'relative flex rounded-[7px] px-2.5 py-[5px] text-[13px] font-semibold transition-colors',
                path === c.to
                  ? 'bg-card text-fg shadow-[0_0_0_1px_#E6E4DE,0_1px_2px_rgba(18,18,16,0.05)] before:absolute before:inset-y-[6px] before:left-0 before:w-[3px] before:rounded-r-full before:bg-lime'
                  : 'text-muted hover:bg-[#EFEEE9] hover:text-fg',
              )}
            >
              {c.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** The business you are acting for, and the menu that switches it. */
function BusinessSwitcher() {
  const { business, businesses, signOut, openBusiness } = useSession()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (!business) return null

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2.5 rounded-lg border border-transparent p-1.5 text-left transition hover:border-line hover:bg-card">
        <BusinessMark business={business} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-fg">{business.name}</span>
          <span className="flex items-center gap-1.5 truncate text-[12px] text-dim">
            <span className={cx('size-1.5 rounded-full', business.verify === 'verified' ? 'bg-good' : business.verify === 'review' ? 'bg-[#D98E1F]' : 'bg-dim')} />
            {business.verify === 'verified' ? 'Live' : business.verify === 'review' ? 'In review' : 'Not activated'}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-dim" />
      </button>

      {open && (
        <div className="rise absolute left-0 top-full z-50 mt-1.5 w-[272px] overflow-hidden rounded-xl border border-line bg-card shadow-[0_20px_50px_-12px_rgba(18,18,16,0.25)]">
          <div className="px-3 pb-1 pt-3 text-[12px] font-medium text-dim">Businesses</div>
          <div className="px-1.5 pb-1.5">
            {businesses.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setOpen(false)
                  if (b.id === business.id) return
                  navigate(openBusiness(b.id))
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-raise"
              >
                <BusinessMark business={b} size={26} />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{b.name}</span>
                {b.id === business.id && <Check className="size-4 text-fg" />}
              </button>
            ))}
            <Link to="/business/new" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] font-medium text-fg hover:bg-raise">
              <span className="flex size-[26px] items-center justify-center rounded-lg border border-dashed border-[#CFCCC3]">
                <Plus className="size-3.5" />
              </span>
              New business
            </Link>
          </div>
          <div className="border-t border-line px-1.5 py-1.5">
            <button onClick={() => copy(business.merchantId)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-fg hover:bg-raise">
              <Copy className="size-4 text-dim" /> Merchant ID <span className="ml-auto font-mono text-[12px] text-dim">{business.merchantId}</span>
            </button>
            <a href={DOCS_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-fg hover:bg-raise">
              <BookOpen className="size-4 text-dim" /> Documentation
            </a>
            <a href="mailto:support@usemoneymoves.xyz" className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-fg hover:bg-raise">
              <LifeBuoy className="size-4 text-dim" /> Support
            </a>
            <button
              onClick={() => {
                signOut()
                navigate('/login')
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] text-red hover:bg-[#FBEAE8]"
            >
              <LogOut className="size-4" /> Log out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Light or dark, for this dashboard in this browser: a sun and a moon side by
 * side, so it never reads as a second on/off switch next to Production. The
 * checkout your customers see stays light.
 */
function ThemeSwitch({ dark, onChange }: { dark: boolean; onChange: (dark: boolean) => void }) {
  const seg = (on: boolean) =>
    cx('flex h-[24px] w-[30px] items-center justify-center rounded-full transition', on ? 'bg-card text-fg shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgba(18,18,16,0.08)]' : 'text-dim hover:text-fg')
  return (
    <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5">
      <span className="text-[13px] text-muted">Theme</span>
      <div role="radiogroup" aria-label="Theme" className="flex rounded-full border border-line bg-raise p-[2px]">
        <button type="button" role="radio" aria-checked={!dark} aria-label="Light" title="Light" onClick={() => onChange(false)} className={seg(!dark)}>
          <Sun className="size-3.5" />
        </button>
        <button type="button" role="radio" aria-checked={dark} aria-label="Dark" title="Dark" onClick={() => onChange(true)} className={seg(dark)}>
          <Moon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/**
 * Test or production, said by the switch itself: amber like the test stripe in
 * test, lime in production. Production stays shut until the business is approved.
 */
function ModeSwitch({ test, canLive, onChange }: { test: boolean; canLive: boolean; onChange: (live: boolean) => void }) {
  const locked = test && !canLive
  return (
    <div className="flex items-center justify-between rounded-lg px-2.5 py-1.5" title={locked ? 'Production opens once your business is approved' : undefined}>
      <span className={cx('text-[13px]', test ? 'text-muted' : 'font-medium text-fg')}>{test ? 'Test mode' : 'Production'}</span>
      <button
        type="button"
        role="switch"
        aria-checked={!test}
        aria-label="Production"
        disabled={locked}
        onClick={() => onChange(test)}
        className={cx(
          'relative h-[22px] w-[38px] shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50',
          test ? 'border-[#D98E1F] bg-[#F2B544]' : 'border-fg bg-lime',
        )}
      >
        <span className={cx('absolute top-[2px] size-4 rounded-full transition-all', test ? 'left-[2px] bg-white shadow-sm' : 'left-[18px] bg-fg')} />
      </button>
    </div>
  )
}

/** Once, when our team approves the business: congratulations, and the way into production. Closed, it never comes back. */
function ApprovedBanner() {
  const { business, mode, setMode, updateBusiness, live } = useSession()
  if (!business || business.suspended || business.verify !== 'verified' || business.liveNoticeClosed) return null
  const close = () => {
    updateBusiness(business.id, { liveNoticeClosed: true })
    if (live) void api('POST', `/businesses/${business.id}/live-notice/close`).catch(() => {})
  }
  const test = mode === 'test'
  return (
    <Banner
      tone="good"
      onClose={close}
      short={test ? "You're approved, switch to production" : "You're approved and in production"}
      action={
        test ? (
          <button onClick={() => setMode('live')} className="font-semibold underline underline-offset-2">
            Switch to production
          </button>
        ) : undefined
      }
    >
      {test
        ? `Congratulations, ${business.name} is approved. Switch to production to start taking live payments.`
        : `Congratulations, ${business.name} is approved. You're in production, so payments are real from here.`}
    </Banner>
  )
}

function VerificationBanner() {
  const { business } = useSession()
  const due = useTasksDue()
  const location = useLocation()
  if (!business) return null
  // Deactivated by our team: nothing else on this banner matters until that's sorted out.
  if (business.suspended) {
    return (
      <Banner
        tone="bad"
        short="Deactivated by Money Moves"
        action={
          <a href="mailto:support@usemoneymoves.xyz" className="font-semibold underline underline-offset-2">
            Contact support
          </a>
        }
      >
        Money Moves has deactivated {business.name}: its checkouts are off and nothing can be changed. Everything that happened is still here to see.
      </Banner>
    )
  }
  if (business.verify === 'verified') {
    if (!due || location.pathname === '/settings/compliance') return null
    return (
      <Banner
        tone="warn"
        short={`${due === 1 ? '1 task needs' : `${due} tasks need`} your attention`}
        action={
          <Link to="/settings/compliance" className="font-semibold underline underline-offset-2">
            View tasks
          </Link>
        }
      >
        You're live. {due === 1 ? '1 task needs' : `${due} tasks need`} your attention to keep the account in good standing.
      </Banner>
    )
  }
  // In review, but our team is waiting on the business - a change, a BVN, a document: that comes first.
  if (business.verify === 'review' && due > 0) {
    const things = due === 1 ? '1 thing needs' : `${due} things need`
    return (
      <Banner
        tone="warn"
        short={`Review paused, ${things} you`}
        action={
          location.pathname === '/settings/compliance' ? undefined : (
            <Link to="/settings/compliance" className="font-semibold underline underline-offset-2">
              View tasks
            </Link>
          )
        }
      >
        Our review team needs something from you, {things} your attention before we can finish reviewing {business.name}.
      </Banner>
    )
  }
  if (business.verify === 'review') {
    return (
      <Banner
        tone="info"
        short="In review, usually within 24 hours"
        action={
          <Link to="/settings/compliance" className="font-semibold underline underline-offset-2">
            See status
          </Link>
        }
      >
        We're reviewing {business.name}, usually within 24 hours. Keep building in test mode meanwhile.
      </Banner>
    )
  }
  return (
    <Banner
      tone="warn"
      short="Test mode, activate to take real payments"
      action={
        <Link to="/verify" className="font-semibold underline underline-offset-2">
          Activate now
        </Link>
      }
    >
      You're in test mode. Activate your account to take real payments.
    </Banner>
  )
}

