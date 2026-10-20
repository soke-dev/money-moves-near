/**
 * The frame around every settings page: the same menu beside each one, so
 * moving from Payout places to Team or your profile never loses the rest. On
 * a phone the menu is a row you can scroll; on a computer, a column that
 * stays put.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { cx } from '@/components/ui'
import { LIVE } from '@/lib/api'
import { useCan } from '@/state/roles'

type Entry = { label: string; to: string; tab?: string; show?: boolean }

export function SettingsFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const can = useCan()
  // On a phone the menu is a row: bring the page you are on into view.
  const nav = useRef<HTMLElement>(null)
  // Items that depend on your role arrive a moment later, so it looks again once they have.
  const roleItems = [can('team'), can('referrals')].join()
  useEffect(() => {
    let id = 0
    const centre = () => {
      cancelAnimationFrame(id)
      id = requestAnimationFrame(() => {
        const n = nav.current
        const el = n?.querySelector<HTMLElement>('[aria-current="page"]')
        if (n && el && n.scrollWidth > n.clientWidth) n.scrollLeft = el.offsetLeft - n.clientWidth / 2 + el.offsetWidth / 2
      })
    }
    centre()
    // A phone turned on its side, or a window made narrow: the row appears, so centre it then too.
    const wide = window.matchMedia('(min-width: 1024px)')
    wide.addEventListener('change', centre)
    return () => {
      cancelAnimationFrame(id)
      wide.removeEventListener('change', centre)
    }
  }, [pathname, params, roleItems])
  const groups: { title: string; items: Entry[] }[] = [
    {
      title: 'Business',
      items: [
        { label: 'Business', to: '/settings/business' },
        { label: 'Payment methods', to: '/settings/business?tab=methods', tab: 'methods' },
        { label: 'Fees', to: '/settings/business?tab=fees', tab: 'fees' },
        { label: 'Notifications', to: '/settings/business?tab=notifications', tab: 'notifications', show: !LIVE },
        { label: 'Transfers', to: '/settings/business?tab=security', tab: 'security', show: !LIVE },
        { label: 'Payout places', to: '/settings/settlement' },
        { label: 'Branding', to: '/settings/branding' },
        { label: 'Compliance', to: '/settings/compliance' },
      ],
    },
    {
      title: 'Team',
      items: [
        { label: 'Team', to: '/settings/team' },
        { label: 'Roles', to: '/settings/roles' },
        { label: 'Activity', to: '/settings/activity', show: can('team') },
      ],
    },
    {
      title: 'You',
      items: [
        { label: 'Profile', to: '/settings/profile' },
      ],
    },
  ]
  const tab = params.get('tab')
  const on = (e: Entry) => {
    const path = e.to.split('?')[0]
    if (pathname !== path) return false
    return path === '/settings/business' ? (e.tab ?? null) === (tab && tab !== 'about' ? tab : null) : true
  }
  const item = (active: boolean) =>
    cx(
      'block shrink-0 whitespace-nowrap rounded-[8px] px-3 py-2 text-[13.5px] transition lg:w-full',
      active ? 'bg-card font-medium text-fg shadow-[0_0_0_1px_#E6E4DE,0_1px_2px_rgba(18,18,16,0.05)]' : 'text-muted hover:bg-raise hover:text-fg',
    )
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-10">
      <nav ref={nav} aria-label="Settings" className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 no-scrollbar lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:self-start lg:overflow-visible lg:px-0">
        {groups.map((g, gi) => (
          <div key={g.title} className="contents lg:block">
            <div className={cx('hidden px-3 pb-1.5 text-[11.5px] font-medium text-dim lg:block', gi > 0 && 'mt-4 border-t border-line pt-4')}>{g.title}</div>
            {g.items
              .filter((e) => e.show !== false)
              .map((e) => (
                <Link key={e.to} to={e.to} replace={e.to.startsWith('/settings/business') && pathname === '/settings/business'} className={item(on(e))} aria-current={on(e) ? 'page' : undefined}>
                  {e.label}
                </Link>
              ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
