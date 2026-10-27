/**
 * Money Moves — landing.
 *
 * A light ground, ink headlines in a grotesk, and monospace for every caption
 * and figure. The app's neon is a fill only (buttons, the lit half of the
 * switch, the marker stroke) because on white it cannot be read; text that
 * carries the brand uses a deeper green. The footer and the closing bands are
 * the one dark ground, so each side ends on the app's own colour.
 *
 * Cards are white, lifted by a soft shadow, and rise a little under the
 * pointer. Sections lift into place as they arrive; the business hero and the
 * fee calculator answer to clicks.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'

/* ─── Tokens ───────────────────────────────────────────────────────── */

const T = {
  paper: '#FFFFFF',
  paperAlt: '#F6F7F2',
  card: '#FFFFFF',
  ink: '#0D1108',
  body: '#3C4336',
  faint: '#6B7364',
  rule: '#E2E5DA',
  // The neon is a fill, never text: on white it cannot be read. Text that
  // carries the brand uses this deeper green instead.
  deep: '#2E6A00',
  deepSoft: 'rgba(129,251,2,0.2)',
  neon: '#81FB02',
  dark: '#0D1108',
  // The one dark ground: the footer and the closing bands.
  night: '#0D1108',
  nightBody: 'rgba(236,239,231,0.62)',
  shadow: '0 1px 2px rgba(13,17,8,0.04), 0 14px 34px -16px rgba(13,17,8,0.16)',
}

const DISPLAY = "'Instrument Sans', system-ui, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace"
// Reading text and controls: rounder and plainer than the display face, so long lines read easily.
const TEXT = "'Figtree', system-ui, sans-serif"

const PLAY_STORE = 'https://play.google.com/store/apps/details?id=xyz.usemoneymoves.app'
const APP_STORE = 'https://apps.apple.com/ng/app/money-moves-own-spend-crypto/id6785696053'
const SUPPORT = 'support@usemoneymoves.xyz'

/* ─── Motion ───────────────────────────────────────────────────────── */

const EASE = [0.22, 1, 0.36, 1] as const

function Reveal({
  children,
  delay = 0,
  y = 18,
  className = '',
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-70px' }}
      transition={{ duration: 0.62, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  )
}

/* ─── Parts ────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[10.5px] font-semibold uppercase tracking-[0.22em]"
      style={{ fontFamily: MONO, color: T.deep }}
    >
      {children}
    </span>
  )
}

function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string
  title: ReactNode
  sub: string
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-14 pt-24">
      <Reveal>
        <Eyebrow>{eyebrow}</Eyebrow>
      </Reveal>
      <div className="mt-5 grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <Reveal delay={0.05}>
          <h2
            className="text-[34px] leading-[1.06] tracking-[-0.035em] sm:text-[46px]"
            style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}
          >
            {title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="max-w-[52ch] text-[16px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
            {sub}
          </p>
        </Reveal>
      </div>
    </div>
  )
}

/**
 * The store buttons: black on the light page, white on the dark closing band.
 */
/**
 * The two store badges.
 *
 * Sized off the viewport rather than off a breakpoint. They were a fixed 188px
 * at 58px tall on desktop and stretched edge to edge on a phone, which made
 * them the loudest thing in the hero on the screen where the hero has least
 * room. Every dimension here is a clamp between a floor and a ceiling, so they
 * shrink with the page instead of snapping at 640px, and they take the width of
 * their own text rather than whatever is going spare.
 */
function StoreButtons({ className = '', tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const dark = tone === 'dark'
  const stores = [
    { href: PLAY_STORE, icon: '/images/playstore singlr.png', top: 'Get it on', name: 'Google Play' },
    { href: APP_STORE, icon: dark ? '/images/applesingle.png' : '/images/applesingleblack.png', top: 'Download on the', name: 'App Store' },
  ]

  return (
    <div className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      {stores.map((s) => (
        <a
          key={s.name}
          href={s.href}
          target="_blank"
          rel="noreferrer"
          className="group inline-flex shrink-0 items-center rounded-[11px] transition-transform duration-200 hover:-translate-y-0.5"
          style={{
            background: dark ? T.night : '#FFFFFF',
            boxShadow: dark ? '0 10px 22px -12px rgba(13,17,8,0.55)' : 'none',
            height: 'clamp(40px, 10.5vw, 50px)',
            paddingInline: 'clamp(10px, 2.8vw, 15px)',
            gap: 'clamp(7px, 1.9vw, 10px)',
          }}
        >
          <img
            src={s.icon}
            alt=""
            className="shrink-0 object-contain"
            style={{ height: 'clamp(17px, 4.4vw, 22px)', width: 'clamp(17px, 4.4vw, 22px)' }}
          />
          <span className="flex min-w-0 flex-col items-start leading-none">
            <span
              style={{
                fontFamily: MONO,
                color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(13,17,8,0.55)',
                fontSize: 'clamp(6.5px, 1.65vw, 8.5px)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 3,
              }}
            >
              {s.top}
            </span>
            <span
              className="truncate"
              style={{
                fontFamily: DISPLAY,
                fontWeight: 600,
                color: dark ? '#FFFFFF' : T.night,
                fontSize: 'clamp(11.5px, 3.1vw, 14.5px)',
                letterSpacing: '-0.01em',
              }}
            >
              {s.name}
            </span>
          </span>
        </a>
      ))}
    </div>
  )
}

/* ─── Device drawings ──────────────────────────────────────────────── */

const maskStyle = (src: string, color: string) => ({
  backgroundColor: color,
  WebkitMaskImage: `url(${src})`,
  maskImage: `url(${src})`,
  WebkitMaskRepeat: 'no-repeat' as const,
  maskRepeat: 'no-repeat' as const,
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
})

/* ─── Content ──────────────────────────────────────────────────────── */

const STATS = [
  { big: '<60s', label: 'Bank cashout', body: 'Convert crypto to cash and land it in a local bank account, no third party.' },
  { big: 'Free', label: 'Network fees', body: 'We sponsor the cost on every transaction. You never buy a token to move your own money.' },
  { big: '100%', label: 'Self-custodial', body: 'Your keys are yours. We cannot move your crypto and we cannot freeze it.' },
  { big: '24/7', label: 'Always on', body: 'No cut-off time and no working days. Move money at 3am on a Sunday if that is when you need it.' },
]

/**
 * Third entry is the mark. Every one is masked to a single brand colour
 * rather than drawn, so a row reads as one of a set instead of as whatever
 * palette its PNG happened to ship with.
 */
const CAPABILITIES = [
  ['Send by @username', 'a name, not 42 characters of hex.', '/images/people.png'],
  ['Scan & pay', 'point at a code, confirm, done.', '/images/qr-code.png'],
  ['Cash out to your bank', 'local banks across Africa, with a reference on every payout.', '/images/bank.png'],
  ['Buy airtime and data', 'MTN, Airtel, Glo and 9mobile, straight from your balance.', '/images/telephone-call.png'],
]

const MONEY_JOBS = [
  ['Electricity', 'prepaid or postpaid, with the token in the app and in your inbox.', '/images/flash.png'],
  ['Savings', 'put money away for a fixed run, or keep it flexible.', '/images/piggy-bank.png'],
  ['Loyalty', 'every naira moved earns points, and points climb the board.', '/images/logo-mark.png'],
]

const SECURITY = [
  { icon: '/images/lock.png', t: 'Self-custodial', b: 'Your balance sits in a wallet only your device can sign for. We cannot move it and we cannot freeze it.' },
  { icon: '/images/user.png', t: 'No password', b: 'Sign in with a code we email you. Nothing to leak, nothing to reuse, nothing to forget.' },
  { icon: '/images/face-id.png', t: 'PIN and Face ID', b: 'Four digits or your face on anything that moves money, set on the device itself.' },
  { icon: '/images/send.png', t: 'Exportable, always', b: 'Take your keys out to MetaMask, Phantom or anywhere else. Account, then Security.' },
]

const FAQ = [
  {
    q: 'What is Money Moves?',
    a: 'A finance app where you hold the money yourself. You keep a balance in stablecoins and spend it on ordinary things: cashing out to a bank, buying airtime and data, or sending to someone by their username.',
  },
  {
    q: 'What does self-custodial mean?',
    a: 'You own the keys, not us. The signing key is split so no single party, us included, ever holds a whole one, and only your device can approve a transfer. Export your keys whenever you like from Account, then Security, and move everything to any other wallet.',
  },
  {
    q: 'What can I hold?',
    a: 'Dollars, as USDC and USDT, alongside MOVE and SOL. One wallet holds all of it and you spend straight from it, with no swapping to something else first.',
  },
  {
    q: 'How do I add money?',
    a: 'Two ways. Transfer cash to the account the app opens in your name and it arrives as crypto, or send crypto to your address from any other wallet. The first needs verification because a bank has to open the account; the second does not.',
  },
  {
    q: 'How fast are bank cashouts?',
    a: 'Typically under a minute. Banks post at their own pace, so a slow one can take longer, and every payout carries a reference you can quote to support if it does.',
  },
  {
    q: 'Do I have to verify my identity?',
    a: 'Only to add money from a bank: the bank holding the deposits will not open an account for someone it cannot identify. It takes a government ID and a face scan, once. Sending crypto and sending to a username need no verification and are not capped.',
  },
  {
    q: 'What does it cost?',
    a: 'Network fees are on us on every transaction. Adding money from a bank carries 1%; cashing out carries 0.5% plus a flat 50. Both are shown in full before you confirm and printed on the receipt afterwards.',
  },
  {
    q: 'How do I sign in?',
    a: 'With your email. There is no password: we send a code to your inbox, you enter it, and you are in. A four-digit PIN, or your face if you turn it on, approves anything that moves money.',
  },
]

const VOICES = [
  'I used to dread P2P, the waiting, the scammers. Now I just hit cashout and money lands in my GTBank in seconds.',
  'Sent USDC to my guy using just @tunde_dev. No wallet address, no copy-paste panic. This is how crypto should work.',
  'Bought airtime with MOVE and paid my electricity bill with USDC, all in one morning.',
]

/* ─── Page ─────────────────────────────────────────────────────────── */

export default function Landing() {
  const [audience, setAudienceState] = useState<'personal' | 'business'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('for') === 'business' ? 'business' : 'personal',
  )
  const [menu, setMenu] = useState(false)
  const setAudience = (a: 'personal' | 'business') => {
    setAudienceState(a)
    setMenu(false)
    try {
      const url = new URL(window.location.href)
      if (a === 'business') url.searchParams.set('for', 'business')
      else url.searchParams.delete('for')
      url.hash = ''
      window.history.replaceState(null, '', url.toString())
      window.scrollTo({ top: 0 })
    } catch {
      /* the address just doesn't follow */
    }
  }

  // Clip, not hidden: hidden makes this a scroll box and the sticky bar stops following the page.
  return (
    <div style={{ background: T.paper, color: T.ink, overflowX: 'clip' }} className="min-h-screen">
      <style>{`
        .mm-link { color: rgba(236,239,231,0.74) }
        .mm-link:hover { color: #FFFFFF }
        .mm-lift { transition: transform .28s cubic-bezier(.22,1,.36,1), box-shadow .28s }
        .mm-lift:hover { transform: translateY(-4px); box-shadow: 0 2px 4px rgba(13,17,8,0.04), 0 26px 46px -20px rgba(13,17,8,0.24) }
        input[type=range].mm-range { accent-color: ${T.deep}; cursor: pointer }
      `}</style>

      <Nav audience={audience} setAudience={setAudience} menu={menu} setMenu={setMenu} />

      {audience === 'business' ? <Business /> : <Personal />}

      <Footer audience={audience} />
    </div>
  )
}

/* ─── Nav ──────────────────────────────────────────────────────────── */

function Nav({
  audience,
  setAudience,
  menu,
  setMenu,
}: {
  audience: 'personal' | 'business'
  setAudience: (a: 'personal' | 'business') => void
  menu: boolean
  setMenu: (m: boolean) => void
}) {
  const links =
    audience === 'business'
      ? [
          ['Who it\'s for', '#who'],
          ['Agents', '#agents'],
          ['Developers', '#developers'],
          ['Pricing', '#pricing'],
        ]
      : [
          ['Why', '#why'],
          ['Features', '#features'],
          ['Security', '#security'],
          ['FAQ', '#faq'],
        ]

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      {/* A floating bar of dark glass: the closing band's green-black, translucent and blurred, with a sheen along the top edge. */}
      <div
        className="relative mx-auto max-w-[1200px] rounded-2xl"
        style={{
          background: 'linear-gradient(120deg, rgba(11,15,7,0.95) 0%, rgba(14,21,9,0.92) 55%, rgba(24,42,8,0.9) 100%)',
          backdropFilter: 'blur(18px) saturate(170%)',
          WebkitBackdropFilter: 'blur(18px) saturate(170%)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.3), 0 18px 40px -18px rgba(13,17,8,0.55)',
        }}
      >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div className="absolute -right-10 -top-24 h-56 w-80 rounded-full blur-3xl" style={{ background: `radial-gradient(circle, ${T.neon}, transparent 65%)`, opacity: 0.2 }} />
        <div className="absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.09), transparent)' }} />
      </div>
      <div className="relative flex h-[60px] items-center justify-between gap-4 px-4 sm:px-5">
        <Logo />

        <nav className="hidden items-center gap-7 lg:flex" style={{ fontFamily: TEXT }}>
          {links.map(([label, href]) => (
            <a key={label} href={href} className="mm-link text-[14.5px] font-medium transition-colors">
              {label}
            </a>
          ))}
        </nav>

        {/* Dead centre on a phone, where it is the only control worth
            reaching for; back in the right-hand cluster from lg up. */}
        <div className="absolute left-1/2 -translate-x-1/2 lg:hidden">
          <Switch audience={audience} onChange={setAudience} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden lg:block">
            <Switch audience={audience} onChange={setAudience} />
          </div>
          <div className="hidden sm:block">{audience === 'business' ? <OpenAccount /> : <GetTheApp />}</div>
          <button
            onClick={() => setMenu(!menu)}
            className="lg:hidden text-[14px] font-semibold"
            style={{ fontFamily: TEXT, color: '#FFFFFF' }}
          >
            {menu ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {menu && (
        <div className="relative border-t px-5 py-4 lg:hidden" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
          <div className="flex flex-col gap-3" style={{ fontFamily: TEXT }}>
            {links.map(([label, href]) => (
              <a key={label} href={href} onClick={() => setMenu(false)} className="text-[15px] font-medium" style={{ color: 'rgba(236,239,231,0.74)' }}>
                {label}
              </a>
            ))}
            {audience === 'business' && (
              <>
                <a href={`${BIZ_APP}/signup`} target="_blank" rel="noreferrer" className="text-[15px] font-semibold" style={{ color: T.neon }}>
                  Open an account
                </a>
                <a href={`${BIZ_APP}/login`} target="_blank" rel="noreferrer" className="text-[15px] font-medium" style={{ color: 'rgba(236,239,231,0.74)' }}>
                  Sign in
                </a>
              </>
            )}
            <a href={`mailto:${SUPPORT}`} className="text-[15px] font-medium" style={{ color: 'rgba(236,239,231,0.74)' }}>
              Support
            </a>
          </div>
        </div>
      )}
      </div>
    </header>
  )
}

/**
 * One button, both stores.
 *
 * A single CTA that opens rather than a pair of badges: the bar has room for
 * one control, and the choice between platforms is the reader's, not ours.
 */
function GetTheApp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-opacity hover:opacity-90"
        style={{ fontFamily: TEXT, background: T.neon, color: T.dark }}
      >
        Get the app
        <span className="text-[8px] transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[216px] overflow-hidden rounded-2xl"
          style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}
        >
          {[
            { href: PLAY_STORE, icon: '/images/playstore singlr.png', top: 'Get it on', name: 'Google Play', ruled: false },
            { href: APP_STORE, icon: '/images/applesingleblack.png', top: 'Download on the', name: 'App Store', ruled: true },
          ].map((s) => (
            <a
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-black/[0.03]"
              style={{ borderTop: s.ruled ? `1px solid ${T.rule}` : undefined }}
            >
              <img
                src={s.icon}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
              />
              <span className="flex flex-col leading-none">
                <span className="mb-1 text-[8px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: T.faint }}>
                  {s.top}
                </span>
                <span className="text-[13px]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                  {s.name}
                </span>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

/** The lockup with light lettering for the dark bar; on a phone the mark says it alone. */
function Logo() {
  return (
    <a href="/" aria-label="Money Moves" className="flex shrink-0 items-center">
      <img src="/images/logo-mark.png" alt="" className="h-[26px] w-auto sm:hidden" />
      <img src="/images/logo-lockup.png" alt="" className="hidden h-[22px] w-auto sm:block" />
    </a>
  )
}

/** The business bar's one button: straight into the dashboard's sign-up. */
function OpenAccount() {
  return (
    <a
      href={`${BIZ_APP}/signup`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 items-center rounded-xl px-4 text-[14px] font-semibold transition-opacity hover:opacity-90"
      style={{ fontFamily: TEXT, background: T.neon, color: T.dark }}
    >
      Open account
    </a>
  )
}

/** Personal / Business, one lit half sliding between them. */
function Switch({
  audience,
  onChange,
}: {
  audience: 'personal' | 'business'
  onChange: (a: 'personal' | 'business') => void
}) {
  return (
    <div
      className="relative grid grid-cols-2 rounded-full p-1"
      style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
      role="tablist"
    >
      <motion.span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-full"
        style={{ width: 'calc(50% - 0.25rem)', background: T.neon }}
        animate={{ x: audience === 'business' ? '100%' : '0%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      />
      {(['personal', 'business'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={audience === m}
          onClick={() => onChange(m)}
          className="relative z-10 h-8 whitespace-nowrap px-4 text-[13px] font-semibold capitalize transition-colors"
          style={{ fontFamily: TEXT, color: audience === m ? T.dark : 'rgba(236,239,231,0.74)' }}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

/* ─── Personal ─────────────────────────────────────────────────────── */

function Personal() {
  return (
    <>
      {/* ── Hero: set left, with the ledger of what just happened beside it,
             rather than a centred column over a row of phones. ── */}
      <section className="mx-auto max-w-[1200px] px-5 pb-20 pt-16 sm:pt-24">
        <div className="grid gap-14 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-20">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
              className="leading-[1.0] tracking-[-0.04em]"
              // Three rows on every phone: each line stays whole, and the size
              // follows the screen so the longest one fits inside the 20px gutters.
              style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 'clamp(28px, calc((100vw - 40px) / 7.9), 64px)' }}
            >
              <span className="whitespace-nowrap">Own Your Wallet,</span>
              <br />
              <span className="whitespace-nowrap">Spend Anywhere</span>
              <br />
              <span className="whitespace-nowrap">Across Africa.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18, ease: EASE }}
              className="mt-7 max-w-[46ch] text-[17px] leading-[1.6]"
              style={{ fontFamily: TEXT, color: T.body }}
            >
              Money Moves is a self-custodial finance app that lets you spend crypto like cash. Keep your money
              in stablecoins and spend it on bills, bank transfers and airtime, from one balance only you control.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.26, ease: EASE }}
              className="mt-10"
            >
              <StoreButtons />
            </motion.div>
          </div>

          {/* What the app does, a tab at a time, on a wash of the brand colours. */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.22, ease: EASE }} className="relative">
            <Wash />
            <div className="relative">
              <FlowCard ways={APP_WAYS} id="app" head="Today" state="done" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── What it does ── */}
      <section id="features">
        <SectionHead
          eyebrow="What's inside"
          title="Everything You Need, One App"
          sub="Hold your own keys, cash out to your bank, and handle everyday payments without ever leaving the app."
        />

        <div className="mx-auto grid max-w-[1200px] gap-4 px-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              t: 'Hold stablecoins',
              b: 'Keep a balance in USDC and USDT, and spend it straight from the app.',
              art: <BalanceArt />,
            },
            {
              t: 'Pay businesses',
              b: 'Scan a shop’s code or open a payment link, and pay from your balance. No fee, and no account number to type.',
              art: <BizPayArt />,
            },
            {
              t: 'Cash out at home',
              b: 'Sell your balance and send it to a local bank account. A reference on every payout, in case one drags.',
              art: <CashoutArt />,
            },
          ].map((c, i) => (
            <Reveal key={c.t} delay={i * 0.08}>
              <div className="mm-lift h-full rounded-3xl p-7" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
                <div className="rounded-2xl p-4" style={{ background: T.paperAlt, border: `1px solid ${T.rule}` }}>
                  {c.art}
                </div>
                <h3 className="mt-6 text-[19px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
                  {c.t}
                </h3>
                <p className="mt-2.5 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                  {c.b}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── The two lists, side by side, no artwork between them ── */}
      <section id="why" className="mt-24" style={{ background: T.paperAlt }}>
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <Reveal>
            <Eyebrow>How it moves</Eyebrow>
            <h2
              className="mt-5 max-w-[20ch] text-[34px] leading-[1.06] tracking-[-0.035em] sm:text-[44px]"
              style={{ fontFamily: DISPLAY, fontWeight: 700 }}
            >
              Send it, spend it, cash it out
            </h2>
          </Reveal>

          <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-2">
            {[
              { head: 'Send money', rows: CAPABILITIES },
              { head: 'Pay the bills', rows: MONEY_JOBS },
            ].map((col, ci) => (
              <div key={col.head}>
                <Reveal delay={ci * 0.06}>
                  <h3 className="text-[20px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
                    {col.head}
                  </h3>
                </Reveal>
                <div className="mt-5">
                  {col.rows.map(([t, b, icon], i) => (
                    <Reveal key={t} delay={ci * 0.06 + i * 0.05}>
                      <div className="flex items-start gap-3.5 border-t py-4" style={{ borderColor: T.rule }}>
                        <span
                          className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px]"
                          style={{ background: T.deepSoft }}
                        >
                          <span className="h-[13px] w-[13px]" style={maskStyle(icon, T.deep)} />
                        </span>
                        <div className="min-w-0">
                          {/* Name on its own line, detail under it. A dash mid
                              sentence broke badly once the column narrowed. */}
                          <div className="text-[14px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                            {t}
                          </div>
                          <p className="mt-1 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                            {b}
                          </p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── The numbers, as a band rather than a grid of cards ── */}
      <section>
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_2fr] lg:items-start">
            <Reveal>
              <Eyebrow>The numbers</Eyebrow>
              <h2
                className="mt-5 text-[30px] leading-[1.08] tracking-[-0.035em] sm:text-[38px]"
                style={{ fontFamily: DISPLAY, fontWeight: 700 }}
              >
                Fast. Free.
                <br />
                And yours.
              </h2>
            </Reveal>

            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {STATS.map((s, i) => (
                <Reveal key={s.label} delay={i * 0.06}>
                  <div className="border-t pt-5" style={{ borderColor: T.rule }}>
                    <div className="text-[40px] leading-none tracking-[-0.04em]" style={{ fontFamily: DISPLAY, fontWeight: 500 }}>
                      {s.big}
                    </div>
                    <div
                      className="mt-3 text-[10.5px] font-medium uppercase tracking-[0.16em]"
                      style={{ fontFamily: MONO, color: T.deep }}
                    >
                      {s.label}
                    </div>
                    <p className="mt-2.5 max-w-[34ch] text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                      {s.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Security ── */}
      <section id="security" style={{ background: T.paperAlt }}>
        <SectionHead
          eyebrow="Custody"
          title="Your keys, your coins"
          sub="Your private keys never leave your control. Export, back up and move your wallet whenever you want."
        />

        <div className="mx-auto max-w-[1200px] px-5 pb-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.07}>
                <div className="mm-lift h-full rounded-3xl px-6 py-9" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ background: T.deepSoft }}
                  >
                    <div className="h-[15px] w-[15px]" style={maskStyle(s.icon, T.deep)} />
                  </div>
                  <h3 className="mt-5 text-[17px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
                    {s.t}
                  </h3>
                  <p className="mt-2.5 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                    {s.b}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Voices ── */}
      <section>
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <Reveal>
            <Eyebrow>Reviews</Eyebrow>
            <h2
              className="mt-5 max-w-[22ch] text-[30px] leading-[1.08] tracking-[-0.035em] sm:text-[38px]"
              style={{ fontFamily: DISPLAY, fontWeight: 700 }}
            >
              Trusted by Money Movers across Africa
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-8 lg:grid-cols-3">
            {VOICES.map((v, i) => (
              <Reveal key={v} delay={i * 0.08}>
                <figure className="border-t pt-6" style={{ borderColor: T.rule }}>
                  <div className="text-[11px] tracking-[0.3em]" style={{ color: T.deep }}>
                    ★★★★★
                  </div>
                  <blockquote className="mt-4 text-[15.5px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                    {v}
                  </blockquote>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ background: T.paperAlt }}>
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Reveal>
              <Eyebrow>Questions</Eyebrow>
              <h2
                className="mt-5 text-[34px] leading-[1.06] tracking-[-0.035em] sm:text-[42px]"
                style={{ fontFamily: DISPLAY, fontWeight: 700 }}
              >
                Frequently
                <br />
                Asked Questions
              </h2>
              <p className="mt-5 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                Not answered here? Email{' '}
                <a href={`mailto:${SUPPORT}`} className="underline underline-offset-4" style={{ color: T.deep }}>
                  support
                </a>{' '}
                and a person replies, not a bot.
              </p>
            </Reveal>
          </div>

          <div>
            <FaqList items={FAQ} />
          </div>
        </div>
      </section>

      {/* ── Close: the one dark band, the app's own ground. ── */}
      <section className="px-5 py-20">
        <Reveal>
          <div className="relative mx-auto max-w-[1160px] overflow-hidden rounded-[28px] px-6 py-20 text-center" style={{ background: T.night }}>
            <Glow />
            <div className="relative mx-auto max-w-[900px]">
              <h2 className="text-[38px] leading-[1.04] tracking-[-0.04em] sm:text-[52px]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: '#FFFFFF' }}>
                The smarter way
                <br />
                to move money.
              </h2>
              <p className="mx-auto mt-6 max-w-[48ch] text-[15.5px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.nightBody }}>
                Download it free, verify once, and start moving money the way you always wanted to.
              </p>
              <div className="mt-10 flex justify-center">
                <StoreButtons className="justify-center" tone="light" />
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  )
}

/* ─── Card artwork ─────────────────────────────────────────────────── */

function BalanceArt() {
  const holdings = [
    ['/images/usdc-logo.png', 'USDC', '3.25'],
    ['/images/usdt.png', 'USDT', '2.54'],
    ['/images/move-logo.png', 'MOVE', '214.90'],
  ]
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em]" style={{ fontFamily: MONO, color: T.faint }}>
        Total balance
      </div>
      <div className="mt-1 text-[26px] leading-none tracking-[-0.03em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
        ₦106,014<span style={{ color: T.faint }}>.75</span>
      </div>
      <div className="mt-4 space-y-2">
        {holdings.map(([logo, sym, amt]) => (
          <div key={sym} className="flex items-center gap-2.5">
            <img src={logo} alt="" className="h-5 w-5 rounded-full object-contain" />
            <span className="flex-1 text-[11px]" style={{ fontFamily: MONO, color: T.ink }}>
              {sym}
            </span>
            <span className="text-[11px]" style={{ fontFamily: MONO, color: T.body }}>
              {amt}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Paying a Money Moves business from the app: the shop, the item, one tap. Illustrative. */
function BizPayArt() {
  return (
    <div>
      <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold" style={{ background: T.ink, color: '#FFFFFF' }}>
          A
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold" style={{ color: T.ink }}>
            Ada Fashion House
          </div>
          <div className="text-[9px]" style={{ fontFamily: MONO, color: T.body }}>
            Ankara gown · payment link
          </div>
        </div>
        <div className="text-[13px] font-semibold" style={{ fontFamily: MONO, color: T.ink }}>
          ₦45,000
        </div>
      </div>
      <div className="mt-3 text-[9.5px]" style={{ fontFamily: MONO, color: T.body }}>
        ✓ No fee for you or the shop
      </div>
      <div className="mt-3 flex h-9 items-center justify-center rounded-xl" style={{ background: T.neon }}>
        <span className="text-[11px] font-semibold" style={{ fontFamily: TEXT, color: T.dark }}>
          Pay ₦45,000
        </span>
      </div>
      <div className="mt-2 text-center text-[9px]" style={{ fontFamily: MONO, color: T.faint }}>
        Approved with your PIN or Face ID
      </div>
    </div>
  )
}

function CashoutArt() {
  // Illustrative: the shape of a payout list, with the markets the app is
  // built to serve rather than the single one it settles in today.
  const banks = [
    ['GTBank', 'Nigeria', '~ 40s'],
    ['Ecobank', 'Ghana', '~ 45s'],
    ['Equity', 'Kenya', '~ 50s'],
  ]
  return (
    <div className="space-y-2">
      {banks.map(([b, where, t]) => (
        <div
          key={b}
          className="flex items-center justify-between rounded-lg px-3 py-2.5"
          style={{ border: `1px solid ${T.rule}` }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="h-4 w-4 shrink-0" style={maskStyle('/images/bank.png', T.deep)} />
            <span className="truncate text-[11px]" style={{ fontFamily: MONO, color: T.ink }}>
              {b}
            </span>
            <span className="truncate text-[9.5px]" style={{ fontFamily: MONO, color: T.faint }}>
              {where}
            </span>
          </div>
          <span className="shrink-0 text-[10px]" style={{ fontFamily: MONO, color: T.body }}>
            {t}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ─── Business ─────────────────────────────────────────────────────── */

const BIZ_APP = 'https://business.usemoneymoves.xyz'
const BIZ_DOCS = 'https://docs.usemoneymoves.xyz'

/**
 * What a business pays, as Services has it today. Shown here rather than read
 * live because the marketing site and the business API sit on different
 * origins; change both together. Stablecoins lead everywhere on this page and
 * bank transfer comes last.
 */
const BIZ_FEES = [
  { what: 'Stablecoins', how: 'USDC or USDT on any supported network', fee: '0.25%', note: 'capped at $1 a payment' },
  { what: 'Money Moves app', how: 'Approved in the app, or scanned', fee: 'Free', note: 'no fee on either side' },
  { what: 'Bank transfer', how: 'Local fiat to a one-time account', fee: '0.25%', note: 'capped at ₦1,000 a payment' },
  { what: 'Bank payout', how: 'From your business wallet to your bank', fee: '₦100', note: 'flat, per transfer' },
]

const BIZ_NETWORKS = ['Movement', 'Solana', 'Base', 'BNB Chain', 'Arbitrum', 'Optimism', 'Monad', 'Arc', 'Stellar', 'TON']
const SETTLE_CHAINS = ['Solana', 'Stellar', 'Movement', 'Arc', 'Monad']

const BIZ_WHO: { t: string; b: string; uses: string[] }[] = [
  { t: 'Online stores', b: 'Accept payments through your online store and receive settlement as soon as each order is paid.', uses: ['WooCommerce', 'Payment links', 'API'] },
  { t: 'SaaS and apps', b: 'Integrate payments into your product with flexible checkout options and real-time payment updates.', uses: ['API and SDKs', 'Webhooks', 'Invoices'] },
  { t: 'Freelancers and creators', b: 'Send professional payment links or invoices and receive payments from clients locally or internationally.', uses: ['Payment links', 'Invoices', 'API'] },
  { t: 'Agencies and B2B', b: 'Simplify client billing with itemised invoices, recurring payments, and the right tools for your team.', uses: ['Invoices', 'Team roles', 'Statements'] },
  { t: 'Shops and restaurants', b: 'Accept in-person payments with a simple QR code and keep track of completed transactions at the counter.', uses: ['Store QR', 'Money Moves app'] },
  { t: 'Paid from abroad', b: 'Receive international payments in stablecoins and choose whether to hold your funds or transfer them to your bank.', uses: ['Stablecoins', 'Self custody wallet'] },
]

const BIZ_CHANNELS: [string, string][] = [
  ['Payment links', 'One link for a product or an amount. Share it anywhere, and every payment lands against it.'],
  ['Invoices', 'Itemised, emailed, and paid from the invoice itself. Weekly, monthly or yearly ones send themselves.'],
  ['Store QR', 'A code per till or branch. Customers scan, pay their way, and the counter sees it arrive.'],
  ['API and SDKs', 'Create checkouts from your own site or app, with signed webhooks and SDKs for Node.js and PHP.'],
  ['WooCommerce', 'A plugin for your store’s checkout. Orders mark themselves paid when the money lands.'],
  ['AI agents', 'Let ChatGPT, Claude or your own agent pay a Money Moves business, or run your checkout.'],
]

const BIZ_RUN: [string, string][] = [
  ['Team and roles', 'Invite admins, finance, developers and support. Sending money and adding payout places stay with the owner.'],
  ['Authenticator sign in', 'A code from an authenticator app on every sign in, and the owner can require it for the whole team.'],
  ['Refunds and disputes', 'Refund from the payment. Customers raise a dispute from their receipt, and you answer with proof.'],
  ['Reports and statements', 'Exports for any dates and a statement for every month, ready for your accountant.'],
  ['Test mode', 'Every way to pay, simulated end to end, before you verify. Only the key changes when you go live.'],
  ['Activity log', 'Who on the team did what, and when: invites, refunds, settings, keys and webhooks.'],
]

const BIZ_FAQ = [
  {
    q: 'Which coins and networks can customers pay with?',
    a: `USDC and USDT, on ${BIZ_NETWORKS.slice(0, -1).join(', ')} and ${BIZ_NETWORKS[BIZ_NETWORKS.length - 1]}. Whatever they pay with, you receive USDC on the chain you pick, or local fiat in your bank.`,
  },
  {
    q: 'What does self custody mean for my business wallet?',
    a: 'The wallet is yours. Its keys belong to the owner’s sign in, and only the owner can approve money leaving it, with a transfer PIN. We cannot move what is in it, we cannot freeze it, and the owner can export its keys at any time.',
  },
  {
    q: 'How fast does money reach me?',
    a: 'The moment the payment lands. Crypto settles as USDC to your business wallet or Money Moves account, or is paid out in local fiat to your bank. There is no batch at the end of the day and no waiting period.',
  },
  {
    q: 'Can an AI agent pay my business?',
    a: 'Yes. Through PayBox, ChatGPT, Claude or any agent that speaks MCP can look up your link, invoice or store QR and pay it in USDC. A person approves every payment in PayBox, outside the chat; the agent never holds a key.',
  },
  {
    q: 'What happens if a customer pays too little, too much or too late?',
    a: 'The payment tracks what arrived. Part payments add up, and anything over, short or late goes back to the customer, automatically where it can, with a link for them to claim it where it cannot.',
  },
  {
    q: 'Who can open a business account?',
    a: 'Registered businesses and freelancers. Registered businesses verify with their company documents and a director’s identity check; freelancers verify with their own identity. Test mode works from the first minute, before any of that.',
  },
  {
    q: 'What does it cost?',
    a: 'Stablecoin payments are 0.25%, capped at $1 a payment. Payments from the Money Moves app are free. Bank transfers are 0.25%, capped at ₦1,000. Sending from your business wallet to a bank is ₦100. Every fee is shown on the payment and on your statement.',
  },
]

function BizButton({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-11 items-center gap-2 rounded-xl px-5 text-[14px] font-semibold transition-opacity hover:opacity-90"
      style={primary ? { fontFamily: TEXT, background: T.neon, color: T.dark } : { fontFamily: TEXT, color: T.ink, border: `1px solid ${T.rule}`, background: T.card }}
    >
      {children}
    </a>
  )
}

/** A section headline in the page's voice, for the split spotlight rows. */
function SpotTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-5 text-balance text-[34px] leading-[1.06] tracking-[-0.035em] sm:text-[44px]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
      {children}
    </h2>
  )
}
const spotText = 'mt-6 max-w-[46ch] text-[16px] leading-[1.6]'

function Ticks({ items }: { items: string[] }) {
  return (
    <ul className="mt-8 space-y-3 text-[15px]" style={{ fontFamily: TEXT, color: T.body }}>
      {items.map((x) => (
        <li key={x} className="flex gap-3">
          <span style={{ color: T.deep }}>+</span>
          {x}
        </li>
      ))}
    </ul>
  )
}

function Business() {
  return (
    <>
      {/* ── Hero: stablecoins in, settled the moment they land. ── */}
      <section className="mx-auto max-w-[1200px] px-5 pb-20 pt-16 sm:pt-24">
        <div className="grid gap-14 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:gap-20">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
              className="text-balance text-[42px] leading-[1.02] tracking-[-0.04em] sm:text-[58px]"
              style={{ fontFamily: DISPLAY, fontWeight: 700 }}
            >
              Take money{' '}
              <span className="relative inline-block whitespace-nowrap">
                {/* A marker stroke under the words, drawn on as the page opens. */}
                <motion.span
                  aria-hidden
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.55, ease: EASE }}
                  className="absolute -left-[3%] bottom-[6%] h-[36%] w-[106%] origin-left -rotate-[1.5deg]"
                  style={{ background: T.neon, borderRadius: '40% 12% 46% 10% / 60% 30% 70% 40%' }}
                />
                <span className="relative">any way</span>
              </span>{' '}
              it comes.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18, ease: EASE }}
              className="mt-7 max-w-[48ch] text-[17px] leading-[1.6]"
              style={{ fontFamily: TEXT, color: T.body }}
            >
              Make every payment simple. Track what comes in, manage it all in one place, and choose where your money goes, with tools that keep your business moving.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.26, ease: EASE }}
              className="mt-10 flex flex-wrap items-center gap-3"
            >
              <BizButton href={`${BIZ_APP}/signup`} primary>
                Open an account
              </BizButton>
              <BizButton href={BIZ_DOCS}>Read the docs</BizButton>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.22, ease: EASE }} className="relative">
            <Wash />
            <div className="relative">
              <FlowCard ways={HERO_WAYS} id="biz" head="Payment" state="settled" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section id="who" style={{ background: T.paperAlt }}>
        <SectionHead
          eyebrow="Who it's for"
          title="Built for the way you sell"
          sub="Whether you run an online store, build digital products, serve clients, or welcome customers in person, Money Moves adapts to the way you do business."
        />
        <div className="mx-auto max-w-[1200px] px-5 pb-20">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BIZ_WHO.map((w, i) => (
              <Reveal key={w.t} delay={(i % 3) * 0.06}>
                <div className="mm-lift flex h-full flex-col rounded-3xl p-7" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
                  <h3 className="text-[19px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                    {w.t}
                  </h3>
                  <p className="mt-3 flex-1 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                    {w.b}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-1.5">
                    {w.uses.map((u) => (
                      <span key={u} className="rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ fontFamily: TEXT, color: T.body, background: T.paperAlt, border: `1px solid ${T.rule}` }}>
                        {u}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Agentic payments ── */}
      <section id="agents">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[1fr_1fr] lg:items-center">
          <Reveal>
            <Eyebrow>Agentic payments</Eyebrow>
            <SpotTitle>Let AI agents pay you, and run your checkout</SpotTitle>
            <p className={spotText} style={{ fontFamily: TEXT, color: T.body }}>
              With PayBox, ChatGPT, Claude or any agent that speaks MCP can pay a Money Moves business in USDC: a
              payment link, an invoice or a store QR. Your own assistant can make checkouts for customers and tell you when they
              are paid.
            </p>
            <Ticks
              items={[
                'The agent looks up who is being paid and the price first',
                'A person approves every payment in PayBox, outside the chat',
                'The agent never holds a key and cannot approve for you',
                'Checkouts, payment status and balance for your own assistant',
              ]}
            />
            <div className="mt-9">
              <BizButton href={`${BIZ_DOCS}/agents`}>How agents pay</BizButton>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <AgentCard />
          </Reveal>
        </div>
      </section>

      {/* ── Where the money goes ── */}
      <section id="settlement" style={{ background: T.paperAlt }}>
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <Reveal>
              <Eyebrow>Settlement</Eyebrow>
              <SpotTitle>
                No batches.
                <br />
                No waiting days.
              </SpotTitle>
              <p className={spotText} style={{ fontFamily: TEXT, color: T.body }}>
                Every payment settles on its own, the moment it is paid. Choose where each link, invoice or till sends its money,
                and change it whenever you like.
              </p>
            </Reveal>
            <div>
              {[
                ['Your business wallet', 'USDC, in a wallet only the owner controls. On the chain you choose.'],
                ['Your Money Moves account', 'Lands in the app as USDC, ready to spend, send or cash out from your phone.'],
                ['Your bank account', 'Paid out in local fiat, to a checked account in your business’s name. Up to five accounts.'],
              ].map(([t, b], i) => (
                <Reveal key={t} delay={i * 0.06}>
                  <div className="grid gap-2 border-t py-6 sm:grid-cols-[220px_1fr] sm:gap-8" style={{ borderColor: T.rule }}>
                    <div className="text-[16px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                      {t}
                    </div>
                    <p className="text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                      {b}
                    </p>
                  </div>
                </Reveal>
              ))}
              <div className="border-t" style={{ borderColor: T.rule }} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Ways to get paid ── */}
      <section id="channels">
        <SectionHead
          eyebrow="Get paid"
          title="Wherever your customers are"
          sub="Sell in person, by message, by invoice, on your own site or to an agent. Every channel feeds the same payments, refunds and reports."
        />
        <div className="mx-auto max-w-[1200px] px-5 pb-20">
          <div className="grid gap-x-16 lg:grid-cols-2">
            {BIZ_CHANNELS.map(([t, b], i) => (
              <Reveal key={t} delay={(i % 2) * 0.05}>
                <div className="flex gap-5 border-t py-6" style={{ borderColor: T.rule }}>
                  <span className="w-6 shrink-0 pt-[3px] text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[16px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                      {t}
                    </div>
                    <p className="mt-1.5 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                      {b}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stablecoins, first and in full. ── */}
      <section id="stablecoins" style={{ background: T.paperAlt }}>
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[1fr_1fr] lg:items-center">
          <Reveal>
            <Eyebrow>Stablecoins</Eyebrow>
            <SpotTitle>Dollars from any wallet, on the network they already use</SpotTitle>
            <p className={spotText} style={{ fontFamily: TEXT, color: T.body }}>
              Customers pay USDC or USDT from any wallet or exchange, and every transfer finds its payment without anyone
              matching amounts by hand.
            </p>
            <Ticks
              items={[
                'Part payments add up on their own',
                'Too much, too little or too late goes back automatically',
                'Whatever they pay with, you receive USDC or local fiat',
              ]}
            />
          </Reveal>
          <Reveal delay={0.08}>
            <div className="overflow-hidden rounded-2xl" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
              <div className="flex items-center justify-between border-b px-5 py-3.5 text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: T.rule, fontFamily: MONO, color: T.faint }}>
                <span>Customers pay on</span>
                <span style={{ color: T.deep }}>USDC · USDT</span>
              </div>
              <div className="grid grid-cols-2 gap-px" style={{ background: T.rule }}>
                {BIZ_NETWORKS.map((n) => (
                  <div key={n} className="px-5 py-3.5" style={{ background: T.card }}>
                    <span className="text-[14px]" style={{ fontFamily: TEXT, fontWeight: 500, color: T.ink }}>
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── The other two ways, after stablecoins. ── */}
      <section id="payments">
        <SectionHead
          eyebrow="One checkout"
          title="Stablecoins. The app and bank transfer too."
          sub="Your customer picks how they pay. You see one payment, one receipt and one settlement, whichever they chose."
        />
        <div className="mx-auto max-w-[1200px] px-5">
          <div className="grid gap-4 lg:grid-cols-3">
            {[
              {
                t: 'Stablecoins',
                b: 'USDC or USDT from any wallet or exchange, on the network the customer already uses.',
                foot: `${BIZ_NETWORKS.length} networks`,
              },
              {
                t: 'Money Moves app',
                b: 'The customer approves the request in the app, or scans the code with another phone. No account number, no address.',
                foot: 'Free for both sides',
              },
              {
                t: 'Bank transfer',
                b: 'A one-time account for each payment, from any bank app. Matched by the account itself, so nobody types a reference.',
                foot: 'Local fiat',
              },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 0.07}>
                <div className="mm-lift flex h-full flex-col rounded-3xl p-7" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
                  <h3 className="text-[20px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
                    {c.t}
                  </h3>
                  <p className="mt-3 flex-1 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                    {c.b}
                  </p>
                  <div className="mt-6 border-t pt-4 text-[10.5px] uppercase tracking-[0.16em]" style={{ borderColor: T.rule, fontFamily: MONO, color: T.deep }}>
                    {c.foot}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Self custody ── */}
      <section id="custody" className="mt-24" style={{ background: T.paperAlt }}>
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[1fr_1fr] lg:items-center">
          <Reveal className="lg:order-2">
            <Eyebrow>Self custody</Eyebrow>
            <SpotTitle>Your business wallet. Your keys.</SpotTitle>
            <p className={spotText} style={{ fontFamily: TEXT, color: T.body }}>
              Settle to a wallet that belongs to the business owner, not to us. We cannot move what is in it and we cannot freeze
              it. You decide when money leaves, and where it goes.
            </p>
            <Ticks
              items={[
                'Only the owner can send, with a transfer PIN on every send',
                'Keys export whenever you like, to any wallet',
                'Admins can see the balance; nobody else can move it',
                `USDC on ${SETTLE_CHAINS.slice(0, -1).join(', ')} or ${SETTLE_CHAINS[SETTLE_CHAINS.length - 1]}, your pick`,
                'Send to your bank in local fiat for a flat ₦100',
              ]}
            />
          </Reveal>
          <Reveal delay={0.08} className="lg:order-1">
            <WalletCard />
          </Reveal>
        </div>
      </section>

      {/* ── Developers ── */}
      <section id="developers">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <Reveal>
            <Eyebrow>Developers</Eyebrow>
            <SpotTitle>A checkout in one request</SpotTitle>
            <p className={spotText} style={{ fontFamily: TEXT, color: T.body }}>
              Create a checkout on your server, send the customer to it, and hear back by webhook when it is paid. Build against
              test keys, and only the key changes when you go live.
            </p>
            <Ticks items={['Signed webhooks for payments, refunds and disputes', 'Safe retries with an idempotency key', 'SDKs for Node.js and PHP, and a WooCommerce plugin', 'Test mode that simulates every outcome']} />
            <div className="mt-9">
              <BizButton href={BIZ_DOCS}>Developer docs</BizButton>
            </div>
          </Reveal>
          <Reveal delay={0.08} className="min-w-0">
            <div className="overflow-hidden rounded-2xl" style={{ background: T.night, boxShadow: T.shadow }}>
              <div className="flex items-center justify-between border-b px-5 py-3 text-[10.5px]" style={{ borderColor: 'rgba(236,239,231,0.1)', fontFamily: MONO, color: 'rgba(236,239,231,0.45)' }}>
                <span>Node.js</span>
                <span>npm install @moneymoves/sdk</span>
              </div>
              <pre className="overflow-x-auto p-5 text-[12px] leading-[1.85]" style={{ fontFamily: MONO, color: 'rgba(236,239,231,0.72)' }}>
                <code>
                  <span style={{ color: 'rgba(236,239,231,0.42)' }}>{'// Charge an order in dollars; customers pay in stablecoins or their way\n'}</span>
                  <span style={{ color: '#ECEFE7' }}>const</span>
                  {' checkout = '}
                  <span style={{ color: '#ECEFE7' }}>await</span>
                  {' mm.checkouts.'}
                  <span style={{ color: T.neon }}>create</span>
                  {'({\n  amount: '}
                  <span style={{ color: '#ECEFE7' }}>120</span>
                  {',\n  currency: '}
                  <span style={{ color: '#ECEFE7' }}>"USD"</span>
                  {',\n  reference: '}
                  <span style={{ color: '#ECEFE7' }}>"order_1042"</span>
                  {',\n  redirect_url: '}
                  <span style={{ color: '#ECEFE7' }}>"https://yourshop.com/thanks"</span>
                  {',\n})\n\n'}
                  <span style={{ color: 'rgba(236,239,231,0.42)' }}>{'// Send the customer to checkout.url\n// payment.successful arrives at your webhook'}</span>
                </code>
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Running it ── */}
      <section id="operations" style={{ background: T.paperAlt }}>
        <SectionHead
          eyebrow="Operations"
          title="Built to run a business on"
          sub="The parts you need once real money is moving: a team with the right access, a clear record, and a way to put things right."
        />
        <div className="mx-auto max-w-[1200px] px-5 pb-20">
          <div className="grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
            {BIZ_RUN.map(([t, b], i) => (
              <Reveal key={t} delay={(i % 3) * 0.05}>
                <div className="border-t py-6" style={{ borderColor: T.rule }}>
                  <div className="text-[16px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                    {t}
                  </div>
                  <p className="mt-2 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                    {b}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing">
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <Reveal>
              <Eyebrow>Pricing</Eyebrow>
              <SpotTitle>
                Per payment.
                <br />
                Nothing monthly.
              </SpotTitle>
              <p className="mt-6 max-w-[42ch] text-[15.5px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                No setup fee and no subscription. You pay a small share of what comes in, with a ceiling, and nothing on payments
                made from the Money Moves app.
              </p>
              <div className="mt-8">
                <FeeCalc />
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div>
                {BIZ_FEES.map((f) => (
                  <div key={f.what} className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 border-t py-5" style={{ borderColor: T.rule }}>
                    <div className="min-w-0">
                      <div className="text-[16px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                        {f.what}
                      </div>
                      <div className="mt-1 text-[14px]" style={{ fontFamily: TEXT, color: T.faint }}>
                        {f.how}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[26px] leading-none tracking-[-0.03em]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
                        {f.fee}
                      </div>
                      <div className="mt-1.5 text-[13px]" style={{ fontFamily: TEXT, color: T.body }}>
                        {f.note}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="border-t" style={{ borderColor: T.rule }} />
                <p className="mt-5 text-[14px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.faint }}>
                  Choose who pays the fee, you or your customer, for the whole business or one link at a time.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" style={{ background: T.paperAlt }}>
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Reveal>
              <Eyebrow>Questions</Eyebrow>
              <SpotTitle>
                Before you
                <br />
                open an account
              </SpotTitle>
              <p className="mt-5 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                Something else? Email{' '}
                <a href={`mailto:${SUPPORT}`} className="underline underline-offset-4" style={{ color: T.deep }}>
                  support
                </a>{' '}
                and a person replies.
              </p>
            </Reveal>
          </div>
          <div>
            <FaqList items={BIZ_FAQ} />
          </div>
        </div>
      </section>

      {/* ── Close: one band, the way in, and what it costs to start. ── */}
      <section>
        <div className="mx-auto max-w-[1200px] px-5 py-20">
          <Reveal>
            <div className="relative overflow-hidden rounded-[28px] px-7 py-14 sm:px-14 sm:py-20" style={{ background: T.night }}>
              <Glow />
              <div className="relative grid gap-10 lg:grid-cols-[1.2fr_auto] lg:items-end">
                <div>
                  <h2 className="text-balance text-[36px] leading-[1.04] tracking-[-0.04em] sm:text-[50px]" style={{ fontFamily: DISPLAY, fontWeight: 700, color: '#FFFFFF' }}>
                    Start accepting stablecoins today.
                  </h2>
                  <p className="mt-5 max-w-[52ch] text-[15.5px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.nightBody }}>
                    Open an account and build in test mode straight away. Verify your business when you are ready to take real money.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px]" style={{ fontFamily: MONO, color: 'rgba(236,239,231,0.45)' }}>
                    <span>No setup fee</span>
                    <span>Nothing monthly</span>
                    <span>Self custody wallet</span>
                    <span>Test mode included</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <BizButton href={`${BIZ_APP}/signup`} primary>
                    Open an account
                  </BizButton>
                  <BizButton href={`${BIZ_APP}/login`}>Sign in</BizButton>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  )
}

/**
 * The three ways a customer pays, as the hero shows them. Illustrative, like
 * the phone screens on the personal side: the shape of a payment, not anyone's
 * real one.
 */
type Way = { k: string; amount: string; cents: string; unit: string; label: string; steps: string[][]; foot: string; took: string }

const HERO_WAYS: Way[] = [
  {
    k: 'Stablecoins',
    amount: '120',
    cents: '.00',
    unit: 'USDC',
    label: 'Annual plan · checkout from your app',
    steps: [
      ['Customer pays 120 USDC', 'From any wallet or exchange', '14:02:11'],
      ['Confirmed on chain', 'Matched to the payment automatically', '14:02:13'],
      ['Settled to your bank', 'Paid out in local fiat, GTBank ••4421', '14:02:15'],
    ],
    foot: 'Or keep it as USDC in your own wallet',
    took: 'Under 5 seconds',
  },
  {
    k: 'The app',
    amount: '₦45,000',
    cents: '',
    unit: '',
    label: 'Ankara gown · payment link',
    steps: [
      ['Request opens in the app', 'Or the customer scans the code', '09:41:02'],
      ['Approved with their PIN', 'No account number, no address', '09:41:07'],
      ['Settled to your wallet', 'As USDC, in a wallet only you control', '09:41:09'],
    ],
    foot: 'Or settle to your bank in local fiat',
    took: 'Under 5 seconds',
  },
  {
    k: 'Bank',
    amount: '₦45,000',
    cents: '',
    unit: '',
    label: 'Invoice INV-0042 · bank transfer',
    steps: [
      ['One-time account shown', 'Open for this payment only', '16:20:30'],
      ['Transfer received', 'Matched by the account, no reference to type', '16:21:04'],
      ['Settled to your bank', 'Paid out in local fiat, GTBank ••4421', '16:21:08'],
    ],
    foot: 'Or settle as USDC to your own wallet',
    took: 'Under 5 seconds',
  },
]

/** What the app does, as the personal hero shows it. Illustrative, like the business card. */
const APP_WAYS: Way[] = [
  {
    k: 'Cash out',
    amount: '₦12,450',
    cents: '',
    unit: '',
    label: '8.12 USDC sold · to GTBank ••4421',
    steps: [
      ['Sold 8.12 USDC', 'At the rate you saw before confirming', '08:14:02'],
      ['Sent to GTBank', 'In your name, with a reference', '08:14:05'],
      ['Landed in your account', 'Typically under a minute', '08:14:43'],
    ],
    foot: 'Every fee shown before you confirm',
    took: '41 seconds',
  },
  {
    k: 'Send',
    amount: '8',
    cents: '.50',
    unit: 'USDC',
    label: 'To @tobi · by username',
    steps: [
      ['Typed @tobi', 'A name, not a 42 character address', '12:30:10'],
      ['Confirmed with your PIN', 'Or your face, if you turned it on', '12:30:12'],
      ['Arrived in their wallet', 'No gas fee, sponsored by Money Moves', '12:30:13'],
    ],
    foot: 'No address to copy, no gas to cover',
    took: 'Under 5 seconds',
  },
  {
    k: 'Bills',
    amount: '₦9,500',
    cents: '',
    unit: '',
    label: 'Airtime, data and electricity · this week',
    steps: [
      ['MTN airtime, ₦1,000', 'Your own line or anyone else’s', '08:10:12'],
      ['Airtel data, ₦3,500', 'A data bundle, active straight away', '13:42:30'],
      ['Ikeja Electric, ₦5,000', 'Token 0192 8374 5601, in the app and your inbox', '18:02:52'],
    ],
    foot: 'Straight from USDC, no swapping first',
    took: 'Under 5 seconds each',
  },
  {
    k: 'Scan',
    amount: '₦3,500',
    cents: '',
    unit: '',
    label: 'Lunch · paid by QR code',
    steps: [
      ['Scanned the code', 'A shop or a friend', '13:05:20'],
      ['Confirmed with your PIN', 'Paid from your balance', '13:05:22'],
      ['Paid', 'They see it land at once', '13:05:23'],
    ],
    foot: 'No card and no account number',
    took: 'Under 5 seconds',
  },
]

/** A hero card: one flow per tab, turning on its own until someone picks a tab. */
function FlowCard({ ways, id, head, state }: { ways: Way[]; id: string; head: string; state: string }) {
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const t = setInterval(() => setI((x) => (x + 1) % ways.length), 5200)
    return () => clearInterval(t)
  }, [held])
  const w = ways[i]

  return (
    <div className="rounded-3xl p-2" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
      <div role="tablist" className="grid gap-1 rounded-2xl p-1" style={{ background: T.paperAlt, gridTemplateColumns: `repeat(${ways.length}, minmax(0, 1fr))` }}>
        {ways.map((x, j) => (
          <button
            key={x.k}
            type="button"
            role="tab"
            aria-selected={i === j}
            onClick={() => {
              setI(j)
              setHeld(true)
            }}
            className="relative h-9 rounded-xl px-2 text-[13px] font-semibold transition-colors"
            style={{ fontFamily: TEXT, color: i === j ? T.ink : T.faint }}
          >
            {i === j && (
              <motion.span
                layoutId={`${id}-tab`}
                className="absolute inset-0 rounded-xl"
                style={{ background: T.card, boxShadow: T.shadow }}
                transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              />
            )}
            <span className="relative">{x.k}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={w.k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: EASE }}>
          <div className="flex items-center justify-between px-4 pb-1 pt-4 text-[10px] uppercase tracking-[0.18em]" style={{ fontFamily: MONO, color: T.faint }}>
            <span>{head}</span>
            <span style={{ color: T.deep }}>{state}</span>
          </div>
          <div className="px-4 pb-5 pt-1">
            <div className="text-[34px] leading-none tracking-[-0.03em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
              {w.amount}
              {w.cents && <span style={{ color: T.faint }}>{w.cents}</span>}
              {w.unit && (
                <span className="text-[18px]" style={{ color: T.body }}>
                  {' '}
                  {w.unit}
                </span>
              )}
            </div>
            <div className="mt-2 text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
              {w.label}
            </div>
          </div>
          <div className="rounded-2xl px-4 py-1" style={{ background: T.paperAlt, border: `1px solid ${T.rule}` }}>
            {w.steps.map(([t, sub, at], n) => (
              <motion.div
                key={t}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + n * 0.14, ease: EASE }}
                className="flex items-start gap-3.5 py-3.5"
                style={{ borderTop: n === 0 ? 'none' : `1px solid ${T.rule}` }}
              >
                <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: n === w.steps.length - 1 ? T.deep : T.faint }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold" style={{ color: T.ink }}>
                    {t}
                  </span>
                  <span className="block text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
                    {sub}
                  </span>
                </span>
                <span className="shrink-0 text-[10.5px] tabular-nums" style={{ fontFamily: MONO, color: T.body }}>
                  {at}
                </span>
              </motion.div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3.5 text-[11px]" style={{ fontFamily: MONO }}>
            <span style={{ color: T.faint }}>{w.foot}</span>
            <span className="shrink-0" style={{ color: T.ink }}>
              {w.took}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** A soft wash of the brand colours behind a hero card, the way a product shot sits on a gradient panel. */
function Wash() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-3 rounded-[36px] sm:-inset-8"
      style={{
        background:
          'radial-gradient(70% 60% at 12% 8%, rgba(129,251,2,0.34), transparent 70%), radial-gradient(60% 60% at 96% 96%, rgba(255,214,10,0.24), transparent 70%), #F3F5EC',
      }}
    />
  )
}

/** The green glow in a corner of a dark band. */
function Glow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full blur-3xl"
      style={{ background: `radial-gradient(circle, ${T.neon}, transparent 65%)`, opacity: 0.22 }}
    />
  )
}

/** Questions in one bordered box: one open at a time, opening with a height animation rather than a jump. */
function FaqList({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <Reveal>
      <div className="overflow-hidden rounded-2xl" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
        {items.map((f, i) => {
          const on = open === i
          return (
            <div key={f.q} style={{ borderTop: i === 0 ? 'none' : `1px solid ${T.rule}` }}>
              <button type="button" onClick={() => setOpen(on ? null : i)} aria-expanded={on} className="flex w-full items-start gap-5 px-6 py-5 text-left">
                <span className="flex-1 text-[16.5px]" style={{ fontFamily: TEXT, fontWeight: 600, color: T.ink }}>
                  {f.q}
                </span>
                <motion.span
                  animate={{ rotate: on ? 45 : 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[16px] leading-none"
                  style={{ background: on ? T.neon : T.paperAlt, color: T.ink }}
                >
                  +
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {on && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-6 pr-14 text-[15px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.body }}>
                      {f.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </Reveal>
  )
}

/** What a payment costs and what lands, worked out with the same fees as the list beside it. */
function FeeCalc() {
  const [kind, setKind] = useState<'coin' | 'bank'>('coin')
  const [coin, setCoin] = useState(250)
  const [bank, setBank] = useState(150000)
  const isCoin = kind === 'coin'
  const amount = isCoin ? coin : bank
  const cap = isCoin ? 1 : 1000
  const fee = Math.min(amount * 0.0025, cap)
  const fmt = (n: number) =>
    isCoin
      ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `₦${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`

  return (
    <div className="rounded-3xl p-5" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
      <div className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: T.paperAlt }}>
        {(
          [
            ['coin', 'Stablecoins'],
            ['bank', 'Bank transfer'],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className="h-9 rounded-lg text-[13px] font-semibold transition-colors"
            style={{ fontFamily: TEXT, background: kind === k ? T.card : 'transparent', color: kind === k ? T.ink : T.faint, boxShadow: kind === k ? T.shadow : 'none' }}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="mt-6 text-[10.5px] uppercase tracking-[0.18em]" style={{ fontFamily: MONO, color: T.faint }}>
        Customer pays
      </div>
      <div className="mt-1.5 text-[38px] leading-none tracking-[-0.04em] tabular-nums" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
        {fmt(amount)}
      </div>
      <input
        aria-label="Payment amount"
        type="range"
        className="mm-range mt-5 w-full"
        min={isCoin ? 1 : 100}
        max={isCoin ? 2000 : 1000000}
        step={isCoin ? 1 : 100}
        value={amount}
        onChange={(e) => (isCoin ? setCoin : setBank)(Number(e.target.value))}
      />
      <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: T.rule }}>
        <div>
          <div className="text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
            Fee
          </div>
          <div className="mt-1 text-[18px] tabular-nums" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.ink }}>
            {fmt(fee)}
          </div>
        </div>
        <div>
          <div className="text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
            You receive
          </div>
          <div className="mt-1 text-[18px] tabular-nums" style={{ fontFamily: DISPLAY, fontWeight: 700, color: T.deep }}>
            {fmt(amount - fee)}
          </div>
        </div>
      </div>
      <p className="mt-4 text-[13px] leading-[1.6]" style={{ fontFamily: TEXT, color: T.faint }}>
        {fee >= cap ? 'The fee has reached its cap, so it stays here however large the payment.' : 'If your customer pays the fee instead, you receive the full amount.'}
      </p>
    </div>
  )
}

/** The business wallet, as the owner sees it: theirs, and only theirs to send from. Illustrative. */
function WalletCard() {
  return (
    <div className="rounded-3xl p-2" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
      <div className="flex items-center justify-between px-4 py-3 text-[10px] uppercase tracking-[0.18em]" style={{ fontFamily: MONO, color: T.faint }}>
        <span>Business wallet</span>
        <span style={{ color: T.deep }}>self custody</span>
      </div>
      <div className="px-4 pb-5 pt-1">
        <div className="text-[34px] leading-none tracking-[-0.03em]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>
          $4,812<span style={{ color: T.faint }}>.40</span>
        </div>
        <div className="mt-2 text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
          USDC · keys held by the owner, not us
        </div>
      </div>
      <div className="rounded-2xl px-4 py-1" style={{ background: T.paperAlt, border: `1px solid ${T.rule}` }}>
        {[
          ['Who can send', 'The owner, with a transfer PIN'],
          ['Who can see it', 'The owner and admins'],
          ['Freeze or move it', 'Not us. Not anyone else.'],
          ['Keys', 'Export them any time'],
        ].map(([k, v], i) => (
          <div key={k} className="flex items-center justify-between gap-4 py-3.5" style={{ borderTop: i === 0 ? 'none' : `1px solid ${T.rule}` }}>
            <span className="text-[12px]" style={{ fontFamily: MONO, color: T.faint }}>
              {k}
            </span>
            <span className="text-right text-[12.5px] font-semibold" style={{ color: T.ink }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 p-2">
        <div className="flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold" style={{ fontFamily: TEXT, background: T.neon, color: T.dark }}>
          Send
        </div>
        <div className="flex h-10 items-center justify-center rounded-xl text-[13px] font-semibold" style={{ fontFamily: TEXT, color: T.ink, border: `1px solid ${T.rule}` }}>
          To my bank
        </div>
      </div>
    </div>
  )
}

/** An agent paying a business, with the approval outside the chat. Illustrative. */
function AgentCard() {
  return (
    <div className="overflow-hidden rounded-3xl" style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: T.shadow }}>
      <div className="flex items-center justify-between border-b px-5 py-3.5 text-[10px] uppercase tracking-[0.18em]" style={{ borderColor: T.rule, fontFamily: MONO, color: T.faint }}>
        <span>Assistant</span>
        <span>via PayBox</span>
      </div>
      <div className="space-y-3 p-5">
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-[12.5px] leading-[1.7]" style={{ background: T.ink, color: '#FFFFFF' }}>
          Pay this invoice for me: business.usemoneymoves.xyz/i/K7Q2
        </div>
        <div className="max-w-[90%] rounded-2xl rounded-bl-md px-4 py-3 text-[12.5px] leading-[1.75]" style={{ background: T.paperAlt, border: `1px solid ${T.rule}`, color: T.body }}>
          <span style={{ color: T.ink }}>Ada Fashion House</span>, invoice INV-0042, for 3 Ankara gowns. That is{' '}
          <span style={{ color: T.ink }}>₦45,000</span>, about <span style={{ color: T.ink }}>29.20 USDC</span>. I have
          sent it to PayBox for you to approve.
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ border: `1px solid ${T.rule}` }}>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold" style={{ color: T.ink }}>
              Approved in PayBox
            </span>
          </span>
          <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em]" style={{ fontFamily: MONO, background: T.deepSoft, color: T.deep }}>
            paid
          </span>
        </div>
        <div className="text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
          Receipt emailed. Ada Fashion House sees the payment settle at once.
        </div>
      </div>
    </div>
  )
}

/* ─── Footer ───────────────────────────────────────────────────────── */

function Footer({ audience }: { audience: 'personal' | 'business' }) {
  return (
    <footer style={{ background: T.night }} className="pt-20 pb-10">
      <div className="mx-auto max-w-[1200px] px-5">
        <img src="/images/logo-lockup.png" alt="Money Moves" className="mb-16 h-7 w-auto" />

        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4">
          {[
            {
              head: 'Company:',
              items:
                audience === 'business'
                  ? [
                      ['FAQ', '#faq'],
                      ['Terms of service', `${BIZ_APP}/legal/terms`],
                      ['Privacy policy', `${BIZ_APP}/legal/privacy`],
                      ['Prohibited businesses', `${BIZ_APP}/legal/prohibited`],
                    ]
                  : [
                      ['FAQ', '#faq'],
                      ['Legal', '/terms'],
                      ['Privacy Policy', '/terms#privacy-policy'],
                    ],
            },
            audience === 'business'
              ? {
                  head: 'Business:',
                  items: [
                    ['Open an account', `${BIZ_APP}/signup`],
                    ['Sign in', `${BIZ_APP}/login`],
                    ['Developer docs', BIZ_DOCS],
                  ],
                }
              : {
                  head: 'Get the app:',
                  items: [
                    ['Google Play', PLAY_STORE],
                    ['App Store', APP_STORE],
                  ],
                },
          ].map((col) => (
            <div key={col.head}>
              <h4 className="mb-5 text-[16px] font-semibold text-white" style={{ fontFamily: DISPLAY }}>
                {col.head}
              </h4>
              <ul className="space-y-3.5" style={{ fontFamily: TEXT }}>
                {col.items.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('http') || href.startsWith('#') ? (
                      <a
                        href={href}
                        target={href.startsWith('http') ? '_blank' : undefined}
                        rel="noreferrer"
                        className="text-[14.5px] text-white/60 transition-colors hover:text-white"
                      >
                        {label}
                      </a>
                    ) : (
                      <Link to={href} className="text-[14.5px] text-white/60 transition-colors hover:text-white">
                        {label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h4 className="mb-5 text-[16px] font-semibold text-white" style={{ fontFamily: DISPLAY }}>
              Socials:
            </h4>
            <div className="flex items-center gap-4">
              <a href="https://x.com/usemoneymoves" target="_blank" rel="noreferrer" aria-label="X" className="text-white transition-colors hover:opacity-70">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a href="https://discord.com/invite/NTytthPS3d" target="_blank" rel="noreferrer" aria-label="Discord" className="text-white transition-colors hover:opacity-70">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.32.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .31.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h4 className="mb-5 text-[16px] font-semibold text-white" style={{ fontFamily: DISPLAY }}>
              Contact us:
            </h4>
            <a
              href={`mailto:${SUPPORT}`}
              className="break-all text-[14.5px] text-white/60 transition-colors hover:text-white"
              style={{ fontFamily: TEXT }}
            >
              {SUPPORT}
            </a>
          </div>
        </div>

        <div className="mt-16">
          <h4 className="mb-4 text-[16px] font-semibold text-white" style={{ fontFamily: DISPLAY }}>
            Legal:
          </h4>
          {audience === 'business' ? (
            <a
              href={`${BIZ_APP}/legal/terms`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 underline underline-offset-4 transition-colors hover:text-white"
              style={{ fontFamily: MONO }}
            >
              Merchant terms
            </a>
          ) : (
            <Link
              to="/terms"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 underline underline-offset-4 transition-colors hover:text-white"
              style={{ fontFamily: MONO }}
            >
              Terms of Service
            </Link>
          )}
        </div>

        <div
          className="mt-14 space-y-4 border-t pt-10 text-[13.5px] leading-[1.7] text-white/40"
          style={{ borderColor: 'rgba(255,255,255,0.1)', fontFamily: TEXT }}
        >
          {audience === 'business' ? (
            <>
              <p>
                Money Moves Business settles to a self custody wallet held by the business owner. Its keys are split so that
                no single party, us included, ever holds a whole one. We do not hold the business’s crypto and we cannot
                move or freeze it.
              </p>
              <p>
                Local fiat payments and payouts are processed by our licensed payment partners. Business and identity
                verification is carried out by our verification partner, who holds the documents you submit.
              </p>
            </>
          ) : (
            <>
              <p>
                Money Moves is a self-custodial finance app. Keys are generated against your account and split so that no
                single party, us included, ever holds a whole one. We do not hold your crypto and we cannot move it.
              </p>
              <p>
                Naira payments and payouts are processed by our licensed payment partners. Identity verification is carried
                out by our verification partner, who holds the documents you submit.
              </p>
            </>
          )}
        </div>

        <div className="mt-12 text-center text-[13px] text-white/40" style={{ fontFamily: TEXT }}>
          © {new Date().getFullYear()} Money Moves. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
