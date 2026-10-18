/**
 * The frame around every page: a header with search, the theme switch and the
 * four tabs, the sidebar for the current tab, the page itself, and "On this
 * page" on wide screens. On a phone the sidebar folds into a menu.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon, CaretRightIcon, DotsThreeVerticalIcon, ListIcon, MagnifyingGlassIcon, MoonIcon, SunIcon, XIcon } from '@phosphor-icons/react'
import { ALL_PAGES, DASHBOARD_URL, NAV, TABS, findPage, type PageMeta } from '@/nav'
import { Method, cx } from './docs'

function Mark({ size = 17 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-fg"
      style={{ width: size * 1.62, height: size, WebkitMask: 'url(/brand/logo-mark.png) center / contain no-repeat', mask: 'url(/brand/logo-mark.png) center / contain no-repeat' }}
    />
  )
}

/* ─── Theme ────────────────────────────────────────────────────────── */

type Theme = 'dark' | 'light'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'))
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#FFFFFF' : '#0B0B0C')
    try {
      localStorage.setItem('mm-docs-theme', next)
    } catch {
      /* private window: it just won't be remembered */
    }
    setTheme(next)
  }
  return [theme, toggle]
}

/* ─── Sidebar ──────────────────────────────────────────────────────── */

const itemClass = (active: boolean) =>
  cx('plain flex items-center gap-2.5 rounded-[8px] px-3 py-[7px] text-[14px] leading-snug transition-colors', active ? 'bg-accent-bg font-medium text-accent' : 'text-muted hover:bg-hover hover:text-fg')

function PageItems({ page, onPick }: { page: PageMeta; onPick?: () => void }) {
  const { pathname, hash } = useLocation()
  const here = pathname === page.slug
  return (
    <>
      {page.items!.map((it, i) => {
        const active = here && (hash ? hash === `#${it.id}` : i === 0)
        return (
          <Link key={it.id} to={`${page.slug}#${it.id}`} onClick={onPick} className={itemClass(active)}>
            {it.method && <Method m={it.method} small />}
            <span className="min-w-0 flex-1">{it.title}</span>
          </Link>
        )
      })}
    </>
  )
}

function Sidebar({ onPick }: { onPick?: () => void }) {
  const { pathname } = useLocation()
  const tab = findPage(pathname)?.tab ?? 'guides'
  return (
    <nav className="space-y-7 px-4 pb-10 pt-7">
      {NAV.filter((g) => g.tab === tab).map((g) => (
        <div key={g.title}>
          <div className="mb-2 px-3 text-[13.5px] font-semibold text-fg">{g.title}</div>
          <div className="space-y-0.5">
            {g.pages.map((p) =>
              p.items && g.pages.length === 1 ? (
                <PageItems key={p.slug} page={p} onPick={onPick} />
              ) : p.items ? (
                <div key={p.slug} className="space-y-0.5">
                  <div className="px-3 pb-0.5 pt-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-dim">{p.title}</div>
                  <PageItems page={p} onPick={onPick} />
                </div>
              ) : (
                <Link key={p.slug} to={p.slug} onClick={onPick} className={itemClass(pathname === p.slug)}>
                  {p.method && <Method m={p.method} small />}
                  <span className="min-w-0 flex-1">{p.title}</span>
                </Link>
              ),
            )}
          </div>
        </div>
      ))}
    </nav>
  )
}

/* ─── On this page ─────────────────────────────────────────────────── */

function OnThisPage() {
  const { pathname } = useLocation()
  const [items, setItems] = useState<{ id: string; text: string; level: number }[]>([])
  const [active, setActive] = useState('')

  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>('article h2[id], article h3[id]')].map((h) => ({ id: h.id, text: h.textContent?.replace(/#$/, '').trim() ?? '', level: h.tagName === 'H3' ? 3 : 2 }))
    setItems(found)
    setActive(found[0]?.id ?? '')
    const seen = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id)
      },
      { rootMargin: '-120px 0px -65% 0px' },
    )
    found.forEach((f) => {
      const el = document.getElementById(f.id)
      if (el) seen.observe(el)
    })
    return () => seen.disconnect()
  }, [pathname])

  if (items.length < 2) return null
  return (
    <div className="text-[13px]">
      <div className="mb-3 flex items-center gap-2 font-medium text-fg">
        <ListIcon size={15} className="text-dim" /> On this page
      </div>
      <div className="space-y-0.5">
        {items.map((i) => (
          <a key={i.id} href={`#${i.id}`} className={cx('plain block py-1 leading-snug transition-colors', i.level === 3 ? 'pl-4' : '', active === i.id ? 'font-medium text-accent' : 'text-muted hover:text-fg')}>
            {i.text}
          </a>
        ))}
      </div>
    </div>
  )
}

/* ─── Search ───────────────────────────────────────────────────────── */

function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  // Pages, and every endpoint on the API pages, so "refund" finds "Create a refund".
  const entries = useMemo(
    () => ALL_PAGES.flatMap((p) => [{ to: p.slug, title: p.title, sub: `${TABS.find((t) => t.id === p.tab)?.label} · ${p.summary}` }, ...(p.items ?? []).filter((i) => i.method).map((i) => ({ to: `${p.slug}#${i.id}`, title: i.title, sub: `API reference · ${p.title}` }))]),
    [],
  )
  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return entries.slice(0, 8)
    return entries.filter((e) => `${e.title} ${e.sub}`.toLowerCase().includes(s)).slice(0, 12)
  }, [q, entries])

  useEffect(() => {
    if (open) {
      setQ('')
      setAt(0)
      setTimeout(() => input.current?.focus(), 10)
    }
  }, [open])

  if (!open) return null
  const go = (to: string) => {
    navigate(to)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="rise w-full max-w-[600px] overflow-hidden rounded-[14px] border border-line bg-raise shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <MagnifyingGlassIcon size={18} className="text-dim" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setAt((a) => Math.min(results.length - 1, a + 1))
              else if (e.key === 'ArrowUp') setAt((a) => Math.max(0, a - 1))
              else if (e.key === 'Enter' && results[at]) go(results[at]!.to)
              else if (e.key === 'Escape') onClose()
            }}
            placeholder="Search the docs"
            className="h-13 flex-1 bg-transparent py-4 text-[15px] text-fg outline-none placeholder:text-dim"
          />
          <kbd className="rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-dim">Esc</kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-[14px] text-muted">Nothing for "{q}". Try "refund", "webhook" or "rate".</div>
          ) : (
            results.map((r, i) => (
              <button key={r.to} onMouseEnter={() => setAt(i)} onClick={() => go(r.to)} className={cx('flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left', i === at ? 'bg-hover' : '')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-fg">{r.title}</span>
                  <span className="block truncate text-[12.5px] text-muted">{r.sub}</span>
                </span>
                {i === at && <ArrowRightIcon size={14} className="text-dim" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── A phone's menu: everything the header holds on a wide screen ─── */

function MoreMenu({ theme, toggleTheme }: { theme: Theme; toggleTheme: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const row = 'plain flex w-full items-center justify-between gap-3 rounded-[9px] px-3 py-2.5 text-left text-[14px] text-fg hover:bg-hover'
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex size-9 items-center justify-center rounded-[9px] text-muted hover:bg-hover hover:text-fg" aria-label="More" aria-expanded={open}>
        <DotsThreeVerticalIcon size={20} weight="bold" />
      </button>
      {open && (
        <div className="rise absolute right-0 top-11 z-50 w-[230px] rounded-[12px] border border-line bg-raise p-1.5 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.55)]">
          <a href={`${DASHBOARD_URL}/settings/api-keys`} className={row}>
            Get API keys <CaretRightIcon size={13} weight="bold" className="text-dim" />
          </a>
          <a href={DASHBOARD_URL} className={row}>
            Dashboard <ArrowUpRightIcon size={13} className="text-dim" />
          </a>
          <button
            onClick={() => {
              toggleTheme()
              setOpen(false)
            }}
            className={row}
          >
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            {theme === 'dark' ? <SunIcon size={15} className="text-dim" /> : <MoonIcon size={15} className="text-dim" />}
          </button>
        </div>
      )}
    </div>
  )
}

/* ─── The frame ────────────────────────────────────────────────────── */

export function Layout({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation()
  const page = findPage(pathname)
  const tab = page?.tab ?? 'guides'
  const [menu, setMenu] = useState(false)
  const [search, setSearch] = useState(false)
  const [theme, toggleTheme] = useTheme()

  // The pages of this tab in order, for previous and next.
  const order = ALL_PAGES.filter((p) => p.tab === tab)
  const idx = order.findIndex((p) => p.slug === pathname)
  const prev = idx > 0 ? order[idx - 1] : undefined
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : undefined

  useEffect(() => {
    setMenu(false)
    document.title = page ? `${page.title} · Money Moves Docs` : 'Money Moves Docs'
  }, [pathname, page])

  // A link to a heading lands on it; any other link starts at the top.
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    const t = setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' }), 30)
    return () => clearTimeout(t)
  }, [pathname, hash])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch(true)
      } else if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setSearch(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
          <Link to="/introduction" className="plain flex items-center gap-3">
            <Mark />
            <span className="h-4 w-px bg-line" />
            <span className="whitespace-nowrap text-[14px] font-semibold tracking-[0.2em] text-fg">MONEY MOVES</span>
          </Link>
          <button
            onClick={() => setSearch(true)}
            className="ml-auto hidden h-10 w-full max-w-[360px] items-center gap-2.5 rounded-[10px] border border-line bg-raise px-3.5 text-left text-[14px] text-dim transition hover:border-dim lg:mx-auto lg:ml-10 lg:flex"
          >
            <MagnifyingGlassIcon size={16} />
            <span className="flex-1">Search…</span>
            <kbd className="font-mono text-[11.5px] font-medium text-dim">Ctrl K</kbd>
          </button>
          {/* A phone: search and a menu of the rest, as icons. */}
          <div className="ml-auto flex items-center gap-1 lg:hidden">
            <button onClick={() => setSearch(true)} className="flex size-9 items-center justify-center rounded-[9px] text-muted hover:bg-hover hover:text-fg" aria-label="Search">
              <MagnifyingGlassIcon size={19} />
            </button>
            <MoreMenu theme={theme} toggleTheme={toggleTheme} />
          </div>
          <div className="hidden items-center gap-1.5 lg:flex">
            <a href={DASHBOARD_URL} className="plain hidden items-center gap-1 rounded-[8px] px-3 py-2 text-[14px] text-muted hover:text-fg md:flex">
              Dashboard <ArrowUpRightIcon size={13} />
            </a>
            <a href={`${DASHBOARD_URL}/settings/api-keys`} className="plain hidden items-center gap-1 rounded-[10px] bg-lime px-3.5 py-2 text-[14px] font-semibold text-on-lime transition hover:brightness-95 md:flex">
              Get API keys <CaretRightIcon size={13} weight="bold" />
            </a>
            <button onClick={toggleTheme} className="flex size-9 items-center justify-center rounded-[9px] text-muted transition hover:bg-hover hover:text-fg" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              {theme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>
          </div>
        </div>
        {/* A phone: the menu, and where you are. */}
        <div className="flex h-12 items-center gap-2 border-t border-line px-4 lg:hidden">
          <button onClick={() => setMenu(true)} className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-hover hover:text-fg" aria-label="Menu">
            <ListIcon size={20} />
          </button>
          <span className="shrink-0 text-[14px] text-muted">{NAV.find((g) => g.pages.some((p) => p.slug === page?.slug))?.title ?? 'Docs'}</span>
          <CaretRightIcon size={12} weight="bold" className="shrink-0 text-dim" />
          <span className="min-w-0 truncate text-[14px] font-medium text-fg">{page?.title ?? 'Not found'}</span>
        </div>
        <div className="hidden gap-7 overflow-x-auto px-4 lg:flex lg:px-8">
          {TABS.map((t) => (
            <Link key={t.id} to={t.home} className={cx('plain -mb-px shrink-0 border-b-2 pb-3 pt-1 text-[14px] transition', tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {t.label}
            </Link>
          ))}
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-[109px] hidden h-[calc(100vh-109px)] w-[288px] shrink-0 overflow-y-auto border-r border-line bg-side lg:block">
          <Sidebar />
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto flex max-w-[1200px] gap-14 px-5 py-11 sm:px-8 lg:px-14">
            <article className="prose-docs min-w-0 max-w-[780px] flex-1">
              {page && <div className="mb-3 text-[14px] font-medium text-accent">{NAV.find((g) => g.pages.some((p) => p.slug === page.slug))?.title}</div>}
              {children}

              {(prev || next) && (
                <div className="mt-16 flex items-center justify-between gap-4 border-t border-line pt-6">
                  {prev ? (
                    <Link to={prev.slug} className="plain group flex items-center gap-2 text-[14.5px] font-medium text-muted hover:text-fg">
                      <ArrowLeftIcon size={14} className="transition group-hover:-translate-x-0.5" /> {prev.title}
                    </Link>
                  ) : (
                    <span />
                  )}
                  {next && (
                    <Link to={next.slug} className="plain group flex items-center gap-2 text-[14.5px] font-medium text-fg">
                      {next.title} <ArrowRightIcon size={14} className="transition group-hover:translate-x-0.5" />
                    </Link>
                  )}
                </div>
              )}

              <footer className="mt-12 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line pt-6 text-[13px] text-dim">
                <span>© {new Date().getFullYear()} Money Moves</span>
                <span className="flex gap-5">
                  <a href="mailto:developers@usemoneymoves.xyz" className="plain hover:text-fg">
                    developers@usemoneymoves.xyz
                  </a>
                  <a href="https://usemoneymoves.xyz" className="plain hover:text-fg">
                    usemoneymoves.xyz
                  </a>
                </span>
              </footer>
            </article>
            <aside className="sticky top-[150px] hidden h-fit w-[210px] shrink-0 xl:block">
              <OnThisPage />
            </aside>
          </div>
        </main>
      </div>

      {menu && (
        <div className="fixed inset-0 z-50 bg-black/55 lg:hidden" onClick={() => setMenu(false)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full w-[300px] max-w-[86vw] overflow-y-auto border-r border-line bg-side">
            <div className="flex h-16 items-center justify-between border-b border-line px-4">
              <span className="text-[14px] font-semibold tracking-[0.2em] text-fg">MONEY MOVES</span>
              <button onClick={() => setMenu(false)} className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-hover" aria-label="Close">
                <XIcon size={18} />
              </button>
            </div>
            <div className="flex gap-1.5 border-b border-line px-4 py-3">
              {TABS.map((t) => (
                <Link key={t.id} to={t.home} onClick={() => setMenu(false)} className={cx('plain rounded-[8px] px-3 py-1.5 text-[13.5px]', tab === t.id ? 'bg-accent-bg font-medium text-accent' : 'text-muted hover:bg-hover hover:text-fg')}>
                  {t.label}
                </Link>
              ))}
            </div>
            <Sidebar onPick={() => setMenu(false)} />
          </div>
        </div>
      )}
      <Search open={search} onClose={() => setSearch(false)} />
    </div>
  )
}
