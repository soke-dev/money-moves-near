import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppIcon, Logo, NairaCoin } from '@/components/brand'

/**
 * Warm cream ground, forest-green ink, the form on a white card.
 *
 * The left side acts the product out in one deep-green panel: a coin - the
 * app, USDC, naira, USDT - drops into a receipt printer, the slip for that
 * payment feeds out, gets stamped PAID, and slides away for the next. Money in
 * any form, settled where you chose. Lime is kept for the highlights: the
 * word that matters in the headline, the printer's light, the stamp.
 */
export default function AuthLayout({
  children,
  aside,
  headline,
  sub,
}: {
  children: ReactNode
  aside?: ReactNode
  headline?: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="funnel relative flex min-h-full flex-col bg-cream text-ink-green">
      <header className="relative z-10 flex h-16 items-center justify-between gap-4 px-5 sm:px-10">
        <Link to="/login" className="shrink-0">
          <Logo color="#0F2419" />
        </Link>
        <div className="whitespace-nowrap text-[13.5px] text-ink-green/70">{aside}</div>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1200px] flex-1 items-start gap-12 px-5 pb-12 pt-4 sm:px-10 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-16 lg:pt-10">
        <div className="hidden lg:block lg:pt-4">
          <h1 className="display max-w-[12ch] text-[56px] font-bold leading-[1] text-ink-green xl:text-[64px]">
            {headline ?? (
              <>
                Take money <Scribble>any way</Scribble> it comes.
              </>
            )}
          </h1>
          <p className="mt-5 max-w-[42ch] text-[17px] leading-relaxed text-ink-green/70">
            {sub ?? 'Let customers pay with the Money Moves app, stablecoins or a naira transfer, and settle every payment exactly where you want it.'}
          </p>
          <Printer />
        </div>

        <div className="w-full rounded-2xl border border-[#E6E1D4] bg-card p-6 shadow-[0_30px_70px_-40px_rgba(15,36,25,0.45)] sm:p-9">{children}</div>
      </main>

      <footer className="display relative z-10 flex flex-wrap justify-between gap-3 px-5 py-6 text-[14px] font-bold tracking-[-0.01em] text-ink-green sm:px-10">
        <span>© Movers Digital Technologies Ltd</span>
        <span className="flex gap-5">
          <Link to="/legal/privacy" className="underline-offset-4 hover:underline">Privacy</Link>
          <Link to="/legal/terms" className="underline-offset-4 hover:underline">Terms</Link>
          <a href="mailto:support@usemoneymoves.xyz" className="underline-offset-4 hover:underline">Help</a>
        </span>
      </footer>
    </div>
  )
}

/**
 * A highlighter swiped behind a word: a rough-edged lime band, a touch
 * crooked, wiped in left to right the way a marker goes on.
 */
export function Scribble({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <svg
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
        className="anim-wipe absolute -left-[0.08em] top-[0.42em] h-[0.62em] w-[calc(100%+0.16em)] -rotate-1"
        aria-hidden
      >
        <path
          d="M6 14 C 52 6, 118 9, 168 7 S 262 4, 296 11 L 293 24 L 298 35 C 250 46, 160 52, 96 50 S 22 52, 4 46 L 9 32 Z"
          fill="#B4F25A"
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  )
}

const SLIPS = [
  { head: 'Money Moves app', amount: '₦45,000.00', who: '@ada.okafor', to: 'GTBank ••0123', coin: 'app' },
  { head: 'USDC on Solana', amount: '120.00 USDC', who: '7xKX…sgAsU', to: 'Business wallet', coin: 'usdc' },
  { head: 'Naira transfer', amount: '₦18,500.00', who: 'Opay ••8975', to: '@movers', coin: 'naira' },
  { head: 'USDT on Movement', amount: '45.50 USDT', who: '0x7a3f…c91e', to: 'GTBank ••0123', coin: 'usdt' },
] as const

function Coin({ kind, size = 40 }: { kind: (typeof SLIPS)[number]['coin']; size?: number }) {
  // A circle like the coins beside it, with its mark large enough to read at the strip's small size.
  if (kind === 'app') return <AppIcon size={size} mark={size < 30 ? 0.52 : 0.42} />
  if (kind === 'naira') return <NairaCoin size={size} />
  return <img src={`/tokens/${kind}.png`} alt="" className="rounded-full" style={{ width: size, height: size }} />
}

/** The scene: a coin drops in, a slip prints out, PAID, gone, next. */
function Printer() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 4600)
    return () => clearInterval(t)
  }, [])
  const at = n % SLIPS.length
  const slip = SLIPS[at]!

  return (
    <div className="relative mt-10 h-[350px] max-w-[480px] overflow-hidden rounded-[22px] bg-forest">
      {/* What it takes, waiting their turn along the top. */}
      <div className="absolute left-5 top-5 flex items-center gap-2">
        {SLIPS.map((s, i) => (
          <span key={s.coin} className={`transition-opacity duration-300 ${i === at ? 'opacity-100' : 'opacity-35'}`}>
            <Coin kind={s.coin} size={22} />
          </span>
        ))}
      </div>
      <div className="absolute right-5 top-[22px] flex items-center gap-1.5 text-[12px] text-cream/60">
        <span className="anim-blink size-1.5 rounded-full bg-highlight" /> Taking payments
      </div>

      {/* The coin for this beat, dropping into the slot. */}
      <div key={`coin-${n}`} className="anim-coin absolute left-1/2 top-[70px] z-10">
        <Coin kind={slip.coin} />
      </div>

      {/* Printer body: cream, with the slot the paper comes out of. */}
      <div className="absolute left-1/2 top-[118px] w-[300px] -translate-x-1/2">
        <div className="relative z-20 h-[52px] rounded-[14px] bg-cream shadow-[0_14px_24px_-12px_rgba(0,0,0,0.55)]">
          <span className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-forest/25" />
          <span className="absolute inset-x-6 bottom-2.5 h-[5px] rounded-full bg-ink-green/80" />
        </div>

        {/* Paper, clipped at the slot so it appears to feed out of it. */}
        <div className="relative -mt-3 mx-[16px] h-[170px] overflow-hidden pt-3">
          <div key={`slip-${n}`} className="anim-print relative bg-card px-4 pb-3.5 pt-4">
            <div className="flex items-center justify-between font-mono text-[10.5px] text-dim">
              <span>{slip.head}</span>
              <span>{new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="display mt-1.5 text-[25px] font-bold text-ink-green">{slip.amount}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted">from {slip.who}</div>
            <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-line pt-2 font-mono text-[10.5px] text-muted">
              <span>settled to</span>
              <span className="font-medium text-ink-green">{slip.to}</span>
            </div>
            <span className="anim-stamp absolute right-4 top-8 rounded-md border-[2.5px] border-[#2B6A00] bg-highlight/30 px-2 py-0.5 font-mono text-[13px] font-bold tracking-wider text-[#2B6A00]">
              PAID
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
