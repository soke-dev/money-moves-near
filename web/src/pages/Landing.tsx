/**
 * Money Moves — landing.
 *
 * The app's own ground - near black with a green bias - headlines in a
 * grotesk, and monospace for every caption and figure. That pairing is the
 * whole look: the type does the work and the neon acts alone, on the one
 * button that matters, the section labels and the figures inside the phones.
 *
 * Sections are separated by space and a hairline rather than ornament. No
 * crosshairs, no hatching, no numbering - that apparatus belongs to the page
 * it came from.
 *
 * Motion is on arrival and once: sections lift eighteen pixels into place as
 * they come into view, and the hero runs a short sequence. Nothing loops.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'

/* ─── Tokens ───────────────────────────────────────────────────────── */

const T = {
  paper: '#0A0C08',
  paperAlt: '#0F120B',
  card: '#141811',
  ink: '#ECEFE7',
  body: '#8B9580',
  faint: '#5C6650',
  rule: '#1F241A',
  // On this ground the accent can be the app's own green; there is no
  // contrast problem to design around any more.
  deep: '#81FB02',
  deepSoft: 'rgba(129,251,2,0.12)',
  neon: '#81FB02',
  dark: '#0A0C08',
}

const API = import.meta.env.VITE_API_URL || ''

const DISPLAY = "'Instrument Sans', system-ui, sans-serif"
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace"

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
      className="text-[10.5px] font-medium uppercase tracking-[0.22em]"
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
            style={{ fontFamily: DISPLAY, fontWeight: 600, color: T.ink }}
          >
            {title}
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="max-w-[52ch] text-[13.5px] leading-[1.9]" style={{ fontFamily: MONO, color: T.body }}>
            {sub}
          </p>
        </Reveal>
      </div>
    </div>
  )
}

/**
 * The store buttons.
 *
 * White, because the official badges we hold are the black-background variant
 * and black on a near-black page is a hole. White is the variant that belongs
 * on a dark ground, and it also makes the two buttons the loudest thing below
 * the headline, which is what they are for.
 *
 * Both are set to one width so they read as a pair rather than two sizes, the
 * glyphs are optically centred rather than boxed, and the lift on hover is the
 * only movement.
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
function StoreButtons({ className = '' }: { className?: string }) {
  const stores = [
    { href: PLAY_STORE, icon: '/images/playstore singlr.png', top: 'Get it on', name: 'Google Play' },
    { href: APP_STORE, icon: '/images/applesingleblack.png', top: 'Download on the', name: 'App Store' },
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
            background: '#FFFFFF',
            boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset',
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
                color: 'rgba(10,12,8,0.55)',
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
                color: '#0A0C08',
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
  const [audience, setAudience] = useState<'personal' | 'business'>('personal')
  const [menu, setMenu] = useState(false)

  return (
    <div style={{ background: T.paper, color: T.ink }} className="min-h-screen overflow-x-hidden">
      <style>{`
        details > summary { list-style: none; cursor: pointer }
        details > summary::-webkit-details-marker { display: none }
      `}</style>

      <Nav audience={audience} setAudience={setAudience} menu={menu} setMenu={setMenu} />

      {audience === 'business' ? <Business /> : <Personal />}

      <Footer />
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
  const links = [
    ['Why', '#why'],
    ['Features', '#features'],
    ['Security', '#security'],
    ['FAQ', '#faq'],
  ]

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{ borderColor: T.rule, background: 'rgba(10,12,8,0.9)' }}
    >
      <div className="relative mx-auto flex h-[68px] max-w-[1200px] items-center justify-between gap-4 px-5">
        {/* The lockup needs room to read; on a phone the mark says it alone -
            cut from the lockup itself, so it is the green glyph on nothing
            rather than the badge, whose black tile would sit as a square hole
            in a black bar. */}
        <img src="/images/logo-mark.png" alt="Money Moves" className="h-[26px] w-auto sm:hidden" />
        <img src="/images/logo-lockup.png" alt="Money Moves" className="hidden h-[22px] w-auto sm:block" />

        <nav className="hidden items-center gap-8 lg:flex" style={{ fontFamily: MONO }}>
          {links.map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="text-[12px] transition-colors hover:opacity-100"
              style={{ color: T.body }}
            >
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
          <div className="hidden sm:block">
            <GetTheApp />
          </div>
          <button
            onClick={() => setMenu(!menu)}
            className="lg:hidden text-[11px] uppercase tracking-[0.14em]"
            style={{ fontFamily: MONO, color: T.ink }}
          >
            {menu ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      {menu && (
        <div className="border-t px-5 py-4 lg:hidden" style={{ borderColor: T.rule }}>
          <div className="flex flex-col gap-3" style={{ fontFamily: MONO }}>
            {links.map(([label, href]) => (
              <a key={label} href={href} onClick={() => setMenu(false)} className="text-[13px]" style={{ color: T.body }}>
                {label}
              </a>
            ))}
            <a href={`mailto:${SUPPORT}`} className="text-[13px]" style={{ color: T.body }}>
              Support
            </a>
          </div>
        </div>
      )}
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
        className="inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[11.5px] font-semibold uppercase tracking-[0.12em] transition-opacity hover:opacity-90"
        style={{ fontFamily: MONO, background: T.deep, color: T.dark }}
      >
        Get the app
        <span className="text-[8px] transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }}>
          ▼
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[216px] overflow-hidden rounded-2xl"
          style={{ background: T.card, border: `1px solid ${T.rule}`, boxShadow: '0 20px 40px -12px rgba(0,0,0,0.7)' }}
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
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.04]"
              style={{ borderTop: s.ruled ? `1px solid ${T.rule}` : undefined }}
            >
              <img
                src={s.icon}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
                style={s.ruled ? { filter: 'invert(1)' } : undefined}
              />
              <span className="flex flex-col leading-none">
                <span className="mb-1 text-[8px] uppercase tracking-[0.1em]" style={{ fontFamily: MONO, color: T.faint }}>
                  {s.top}
                </span>
                <span className="text-[13px]" style={{ fontFamily: DISPLAY, fontWeight: 600, color: T.ink }}>
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
      style={{ background: T.card, border: `1px solid ${T.rule}` }}
      role="tablist"
    >
      <motion.span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-full"
        style={{ width: 'calc(50% - 0.25rem)', background: T.deep }}
        animate={{ x: audience === 'business' ? '100%' : '0%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      />
      {(['personal', 'business'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={audience === m}
          onClick={() => onChange(m)}
          className="relative z-10 h-8 whitespace-nowrap px-4 text-[10.5px] font-semibold uppercase tracking-[0.12em] transition-colors"
          style={{ fontFamily: MONO, color: audience === m ? T.dark : T.body }}
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
      <section className="mx-auto max-w-[1200px] px-5 pb-16 pt-20 sm:pt-28">
        <div className="grid gap-14 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-20">
          <div>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
              className="text-[46px] leading-[1.0] tracking-[-0.04em] sm:text-[64px]"
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
            >
              Own Your Wallet,
              <br />
              Spend Anywhere
              <br />
              Across Africa.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.18, ease: EASE }}
              className="mt-7 max-w-[52ch] text-[13.5px] leading-[1.9]"
              style={{ fontFamily: MONO, color: T.body }}
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

          {/* Four things the app did this morning. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.22, ease: EASE }}
            className="rounded-3xl p-2"
            style={{ background: T.card, border: `1px solid ${T.rule}` }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 text-[10px] uppercase tracking-[0.18em]"
              style={{ fontFamily: MONO, color: T.faint }}
            >
              <span>Today</span>
              <span style={{ color: T.deep }}>live</span>
            </div>

            {[
              { icon: '/images/bank.png', t: '₦12,450 to GTBank', s: 'sold 8.12 USDC · 41s' },
              // usdc-black is the mark drawn inside a filled disc, and a mask only sees
              // alpha - so the whole disc came through as one green blob. usdc-mark
              // is the same mark as a silhouette, like every other icon here.
              { icon: '/images/usdc-mark.png', t: '+8.50 USDC', s: 'from @tobi · no gas' },
              { icon: '/images/flash.png', t: '₦5,000 Ikeja Electric', s: 'token 0192 8374 5601' },
            ].map((r, i) => (
              <div
                key={r.t}
                className="flex items-center gap-3.5 px-4 py-4"
                style={{ borderTop: i === 0 ? 'none' : `1px solid ${T.rule}` }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: T.deepSoft }}
                >
                  <span className="h-4 w-4" style={maskStyle(r.icon, T.deep)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold" style={{ color: T.ink }}>
                    {r.t}
                  </span>
                  <span className="block truncate text-[11px]" style={{ fontFamily: MONO, color: T.faint }}>
                    {r.s}
                  </span>
                </span>
              </div>
            ))}
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

        <div className="mx-auto grid max-w-[1200px] gap-px px-5 sm:grid-cols-2 lg:grid-cols-3" style={{ background: T.rule }}>
          {[
            {
              t: 'Hold dollars',
              b: 'Keep a balance in USDC and USDT that does not move with the naira, and spend it straight from the app.',
              art: <BalanceArt />,
            },
            {
              t: 'Send to a name',
              b: 'Pay anyone on Money Moves by their @username. No 42-character address, and no gas to cover.',
              art: <SendArt />,
            },
            {
              t: 'Cash out at home',
              b: 'Sell your balance and send it to a local bank account. A reference on every payout, in case one drags.',
              art: <CashoutArt />,
            },
          ].map((c, i) => (
            <Reveal key={c.t} delay={i * 0.08}>
              <div className="h-full p-7" style={{ background: T.paper }}>
                <div className="rounded-2xl p-4" style={{ background: T.card, border: `1px solid ${T.rule}` }}>
                  {c.art}
                </div>
                <h3 className="mt-6 text-[19px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
                  {c.t}
                </h3>
                <p className="mt-2.5 text-[12.5px] leading-[1.8]" style={{ fontFamily: MONO, color: T.body }}>
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
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
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
                  <h3 className="text-[20px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
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
                          <div className="text-[14px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 600, color: T.ink }}>
                            {t}
                          </div>
                          <p className="mt-1 text-[12.5px] leading-[1.7]" style={{ fontFamily: MONO, color: T.body }}>
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
                style={{ fontFamily: DISPLAY, fontWeight: 600 }}
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
                    <p className="mt-2.5 max-w-[34ch] text-[12.5px] leading-[1.75]" style={{ fontFamily: MONO, color: T.body }}>
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
          <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-4" style={{ background: T.rule }}>
            {SECURITY.map((s, i) => (
              <Reveal key={s.t} delay={i * 0.07}>
                <div className="h-full px-6 py-9" style={{ background: T.paperAlt }}>
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ background: T.deepSoft }}
                  >
                    <div className="h-[15px] w-[15px]" style={maskStyle(s.icon, T.deep)} />
                  </div>
                  <h3 className="mt-5 text-[17px] tracking-[-0.02em]" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
                    {s.t}
                  </h3>
                  <p className="mt-2.5 text-[12.5px] leading-[1.8]" style={{ fontFamily: MONO, color: T.body }}>
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
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
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
                  <blockquote className="mt-4 text-[13px] leading-[1.85]" style={{ fontFamily: MONO, color: T.body }}>
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
                style={{ fontFamily: DISPLAY, fontWeight: 600 }}
              >
                Frequently
                <br />
                Asked Questions
              </h2>
              <p className="mt-5 text-[12.5px] leading-[1.8]" style={{ fontFamily: MONO, color: T.body }}>
                Not answered here? Email{' '}
                <a href={`mailto:${SUPPORT}`} className="underline underline-offset-4" style={{ color: T.deep }}>
                  support
                </a>{' '}
                and a person replies, not a bot.
              </p>
            </Reveal>
          </div>

          <div>
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={i * 0.04}>
                <details className="group border-t" style={{ borderColor: T.rule }}>
                  <summary className="flex items-start gap-5 py-5">
                    <span className="flex-1 text-[16px] tracking-[-0.01em]" style={{ fontFamily: DISPLAY, fontWeight: 500 }}>
                      {f.q}
                    </span>
                    <span
                      className="shrink-0 text-[20px] leading-none transition-transform group-open:rotate-45"
                      style={{ color: T.deep }}
                    >
                      +
                    </span>
                  </summary>
                  <p className="pb-6 pr-10 text-[12.5px] leading-[1.9]" style={{ fontFamily: MONO, color: T.body }}>
                    {f.a}
                  </p>
                </details>
              </Reveal>
            ))}
            <div className="border-t" style={{ borderColor: T.rule }} />
          </div>
        </div>
      </section>

      {/* ── Close ── */}
      <section>
        <div className="mx-auto max-w-[900px] px-5 py-24 text-center">
          <Reveal>
            <h2
              className="text-[38px] leading-[1.04] tracking-[-0.04em] sm:text-[52px]"
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
            >
              The smarter way
              <br />
              to move money.
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="mx-auto mt-6 max-w-[48ch] text-[13px] leading-[1.9]" style={{ fontFamily: MONO, color: T.body }}>
              Download it free, verify once, and start moving money the way you always wanted to.
            </p>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-10 flex justify-center">
              <StoreButtons className="justify-center" />
            </div>
          </Reveal>
        </div>
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
      <div className="mt-1 text-[26px] leading-none tracking-[-0.03em]" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
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

function SendArt() {
  return (
    <div>
      <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: T.deepSoft }}>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-semibold"
          style={{ background: T.deep, color: T.dark }}
        >
          T
        </span>
        <div className="flex-1">
          <div className="text-[12px] font-semibold" style={{ color: T.ink }}>
            @tobi
          </div>
          <div className="text-[9px]" style={{ fontFamily: MONO, color: T.body }}>
            USDC · 12 sends
          </div>
        </div>
        <div className="text-[13px] font-semibold" style={{ fontFamily: MONO, color: T.ink }}>
          8.50
        </div>
      </div>
      <div className="mt-3 text-[9.5px]" style={{ fontFamily: MONO, color: T.body }}>
        ✓ No gas fee, sponsored by Money Moves
      </div>
      {/* The app confirms with a PIN, not a slider. */}
      <div
        className="mt-3 flex h-9 items-center justify-center rounded-xl"
        style={{ background: T.deep }}
      >
        <span className="text-[11px] font-semibold" style={{ fontFamily: DISPLAY, color: T.dark }}>
          Send 8.50 USDC
        </span>
      </div>
      <div className="mt-2 text-center text-[9px]" style={{ fontFamily: MONO, color: T.faint }}>
        Confirmed with your PIN or Face ID
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

function Business() {
  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-24 pt-20 sm:pt-28">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative overflow-hidden rounded-[28px] px-8 py-24 sm:px-16 sm:py-32"
        style={{ background: T.dark }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full blur-3xl"
          style={{ background: `radial-gradient(circle, ${T.neon}, transparent 65%)`, opacity: 0.22 }}
        />
        {/* Two columns where there is room, stacked where there is not.
            The headline holds the left and the one thing you can do holds
            the right, which is also where the glow already draws the eye.
            Below the breakpoint it falls under the copy, because side by
            side at phone width would leave the field about eight characters
            wide. Ends aligned rather than tops: the form should sit on the
            same line as the sentence it answers, not float beside a 84px
            headline. */}
        <div className="relative grid items-end gap-12 md:grid-cols-[1fr_auto] md:gap-16">
          <div>
            <h1
              className="text-[52px] leading-[0.95] tracking-[-0.04em] text-white sm:text-[84px]"
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
            >
              Coming
              <br />
              soon<span style={{ color: T.neon }}>.</span>
            </h1>
            <p className="mt-8 max-w-[40ch] text-[13px] leading-[1.9] text-white/50" style={{ fontFamily: MONO }}>
              Same rails. Built for businesses, payroll, suppliers and settlement.
            </p>
          </div>
          <BusinessWaitlist />
        </div>
      </motion.div>
    </section>
  )
}

/**
 * The business waitlist.
 *
 * One field and one button, on a page where everything else is read rather
 * than used - so it has to look like the one thing you can do without
 * shouting about it. The field is a rule rather than a box: a bordered input
 * on this ground reads as a form, and a form on a "coming soon" panel reads
 * as work.
 *
 * Three states, and the third is the point. Somebody who signs up twice is
 * told so plainly instead of being thanked again, which is both honest and
 * the only visible difference between a list that remembers and one that
 * does not. No mail is sent either way: they asked to be told when there is
 * something, not to be written to today.
 */
function BusinessWaitlist() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'added' | 'already' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const settled = state === 'added' || state === 'already'
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || state === 'sending') return
    setState('sending')
    try {
      const res = await fetch(`${API}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState('error')
        setMessage(data?.error || 'That did not go through. Try again.')
        return
      }
      setState(data?.status === 'already' ? 'already' : 'added')
    } catch {
      setState('error')
      setMessage('That did not go through. Try again.')
    }
  }

  return (
    <div className="w-full max-w-[380px] md:mt-0 md:w-[380px]">
      <AnimatePresence mode="wait" initial={false}>
        {settled ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-start gap-3 rounded-xl px-4 py-4"
            style={{
              background: state === 'added' ? T.deepSoft : 'rgba(255,255,255,0.04)',
              border: `1px solid ${state === 'added' ? 'rgba(129,251,2,0.28)' : T.rule}`,
            }}
          >
            {/* Drawn rather than a glyph, so it can arrive the way a tick is
                actually made: one stroke, left to right. */}
            <motion.svg
              width="18" height="18" viewBox="0 0 18 18" fill="none"
              className="mt-[1px] shrink-0"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.06, type: 'spring', stiffness: 380, damping: 18 }}
            >
              <circle cx="9" cy="9" r="9" fill={state === 'added' ? T.neon : T.faint} />
              {state === 'added' ? (
                <motion.path
                  d="M5 9.2l2.6 2.6L13 6.4"
                  stroke={T.dark} strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 0.16, duration: 0.3, ease: 'easeOut' }}
                />
              ) : (
                <path d="M9 4.6v5.2M9 12.6v.9" stroke={T.dark} strokeWidth="2" strokeLinecap="round" />
              )}
            </motion.svg>
            <div>
              <p className="text-[13.5px] leading-[1.5] text-white" style={{ fontFamily: DISPLAY, fontWeight: 600 }}>
                {state === 'added' ? "You're on the list." : "You're already on the list."}
              </p>
              <p className="mt-1 text-[12px] leading-[1.7]" style={{ fontFamily: MONO, color: T.body }}>
                {state === 'added'
                  ? 'We will write once, when it opens. Nothing before that.'
                  : 'That address was added earlier. Nothing more to do.'}
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={submit}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24 }}
          >
            {/* Inside the form rather than above it, so it leaves with the
                form. A heading reading "Join the waitlist" sitting over a
                card that says you already have would be talking past the
                person who just did. */}
            <h3
              className="text-[19px] leading-[1.25] tracking-[-0.02em] text-white"
              style={{ fontFamily: DISPLAY, fontWeight: 600 }}
            >
              {/* The noun carries the colour, not a full stop. The headline
                  a few inches away already ends in a neon dot, and using the
                  same device twice within one panel reads as a tic rather
                  than a system. */}
              Join the <span style={{ color: T.neon }}>waitlist</span>
            </h3>
            <p className="mt-2 mb-7 text-[12px] leading-[1.7]" style={{ fontFamily: MONO, color: T.body }}>
              Be the first to know when it goes live.
            </p>

            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <input
                  id="waitlist-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (state === 'error') setState('idle')
                  }}
                  placeholder="you@company.com"
                  autoComplete="email"
                  spellCheck={false}
                  className="w-full bg-transparent pb-3 text-[14px] outline-none placeholder:text-white/22"
                  style={{ fontFamily: MONO, color: T.ink }}
                />
                {/* A rule that lights along its length on focus, rather than
                    a box that changes colour. */}
                <div className="absolute inset-x-0 bottom-0 h-px" style={{ background: T.rule }} />
                <motion.div
                  className="absolute inset-x-0 bottom-0 h-px origin-left"
                  style={{ background: T.neon }}
                  initial={false}
                  animate={{ scaleX: valid ? 1 : 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>

              <button
                type="submit"
                disabled={!valid || state === 'sending'}
                className="shrink-0 rounded-full px-5 py-[11px] text-[11px] uppercase tracking-[0.14em] transition-opacity disabled:cursor-not-allowed"
                style={{
                  fontFamily: MONO,
                  fontWeight: 700,
                  background: valid ? T.neon : 'rgba(255,255,255,0.07)',
                  color: valid ? T.dark : T.faint,
                  opacity: state === 'sending' ? 0.65 : 1,
                }}
              >
                {state === 'sending' ? 'Joining' : 'Join'}
              </button>
            </div>

            {/* Nothing sits here until something goes wrong. The reassurance
                that used to live on this line was answering a question
                nobody had yet asked; it is on the card that follows instead,
                where it is the answer to one. */}
            <AnimatePresence initial={false}>
              {state === 'error' && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 text-[11.5px]"
                  style={{ fontFamily: MONO, color: '#E0685F' }}
                >
                  {message}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Footer ───────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer style={{ background: T.paperAlt, borderTop: `1px solid ${T.rule}` }} className="pt-20 pb-10">
      <div className="mx-auto max-w-[1200px] px-5">
        <img src="/images/logo-lockup.png" alt="Money Moves" className="mb-16 h-7 w-auto" />

        <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-4">
          {[
            {
              head: 'Company:',
              items: [
                ['FAQ', '#faq'],
                ['Legal', '/terms'],
                ['Privacy Policy', '/terms#privacy-policy'],
              ],
            },
            {
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
              <ul className="space-y-3.5" style={{ fontFamily: MONO }}>
                {col.items.map(([label, href]) => (
                  <li key={label}>
                    {href.startsWith('http') || href.startsWith('#') ? (
                      <a
                        href={href}
                        target={href.startsWith('http') ? '_blank' : undefined}
                        rel="noreferrer"
                        className="text-[12.5px] text-white/60 transition-colors hover:text-white"
                      >
                        {label}
                      </a>
                    ) : (
                      <Link to={href} className="text-[12.5px] text-white/60 transition-colors hover:text-white">
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
              className="break-all text-[12.5px] text-white/60 transition-colors hover:text-white"
              style={{ fontFamily: MONO }}
            >
              {SUPPORT}
            </a>
          </div>
        </div>

        <div className="mt-16">
          <h4 className="mb-4 text-[16px] font-semibold text-white" style={{ fontFamily: DISPLAY }}>
            Legal:
          </h4>
          <Link
            to="/terms"
            className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80 underline underline-offset-4 transition-colors hover:text-white"
            style={{ fontFamily: MONO }}
          >
            Terms of Service
          </Link>
        </div>

        <div
          className="mt-14 space-y-4 border-t pt-10 text-[12px] leading-[1.85] text-white/35"
          style={{ borderColor: 'rgba(255,255,255,0.1)', fontFamily: MONO }}
        >
          <p>
            Money Moves is a self-custodial finance app. Keys are generated against your account and split so that no
            single party, us included, ever holds a whole one. We do not hold your crypto and we cannot move it.
          </p>
          <p>
            Naira payments and payouts are processed by our licensed payment partners. Identity verification is carried
            out by our verification partner, who holds the documents you submit.
          </p>
        </div>

        <div className="mt-12 text-center text-[12px] text-white/35" style={{ fontFamily: MONO }}>
          © {new Date().getFullYear()} Money Moves. All rights reserved.
        </div>
      </div>
    </footer>
  )
}
