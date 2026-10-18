/**
 * How money moves, drawn: three ways to pay flow into one checkout, the
 * checkout settles to three places, and your server hears about it. An inline
 * SVG, so it's sharp at any size, follows the theme and uses the page's font.
 * The lines carry moving dots to show direction; they stand still for anyone
 * who prefers reduced motion.
 */
const W = 1000
const H = 600

/** A curve from one point to another, leaving and arriving level. */
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mid = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

const IN = [
  { y: 150, title: 'Bank transfer', sub: 'A one-time account', icon: 'bank' },
  { y: 250, title: 'Money Moves app', sub: 'Approved in one tap', icon: 'app' },
  { y: 350, title: 'USDC or USDT', sub: '10 networks', icon: 'coins' },
] as const

const OUT = [
  { y: 150, title: 'Your bank account', sub: 'Local fiat, in seconds', icon: 'bank' },
  { y: 250, title: 'Money Moves username', sub: 'USDC, self-custodial', icon: 'app' },
  { y: 350, title: 'Your business wallet', sub: 'USDC, self-custody', icon: 'key' },
] as const

function Icon({ kind, x, y }: { kind: 'bank' | 'app' | 'coins' | 'key'; x: number; y: number }) {
  if (kind === 'coins') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <circle cx="-5" cy="0" r="11" fill="#2775CA" />
        <text x="-5" y="4.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">
          $
        </text>
        <circle cx="8" cy="0" r="11" fill="#26A17B" stroke="var(--bg)" strokeWidth="2" />
        <text x="8" y="4.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">
          ₮
        </text>
      </g>
    )
  }
  return (
    <g transform={`translate(${x - 14} ${y - 14})`}>
      <rect width="28" height="28" rx="8" fill="var(--bg)" stroke="var(--line)" />
      {kind === 'bank' && (
        <g fill="none" stroke="var(--fg)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <path d="M7 11.5 14 7l7 4.5Z" />
          <path d="M9 13v6M12.3 13v6M15.7 13v6M19 13v6M7.5 21h13" />
        </g>
      )}
      {kind === 'app' && (
        <g fill="none" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round">
          <rect x="9.5" y="6.5" width="9" height="15" rx="2.2" />
          <path d="M13 18.5h2" />
        </g>
      )}
      {kind === 'key' && (
        <g fill="none" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="14" r="3.6" />
          <path d="M14.6 14H21M18.5 14v2.6M21 14v2" />
        </g>
      )}
    </g>
  )
}

function Card({ x, y, w, title, sub, icon, glow }: { x: number; y: number; w: number; title: string; sub: string; icon: 'bank' | 'app' | 'coins' | 'key'; glow?: boolean }) {
  return (
    <g>
      <rect x={x} y={y - 34} width={w} height="68" rx="14" fill="var(--bg)" stroke={glow ? 'var(--accent)' : 'var(--line)'} strokeOpacity={glow ? 0.55 : 1} />
      <Icon kind={icon} x={x + 30} y={y} />
      <text x={x + 56} y={y - 3} fontSize="15.5" fontWeight="600" fill="var(--fg)">
        {title}
      </text>
      <text x={x + 56} y={y + 17} fontSize="13" fill="var(--muted)">
        {sub}
      </text>
    </g>
  )
}

const LINE = { fill: 'none', stroke: 'var(--dim)', strokeOpacity: 0.55, strokeWidth: 1.6 } as const
const DOT = { fill: 'none', stroke: '#81FB02', strokeWidth: 2.2, strokeLinecap: 'round', strokeDasharray: '2 118' } as const

/** A line with a dot travelling along it. */
function Wire({ d, n = 0 }: { d: string; n?: number }) {
  return (
    <g>
      <path d={d} {...LINE} />
      <path className={`mm-flow-dot d${n % 3}`} d={d} {...DOT} />
    </g>
  )
}

function Label({ x, y, anchor = 'start', children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize="12" fontWeight="600" letterSpacing="1.4" fill="var(--dim)">
      {children}
    </text>
  )
}

/** The checkout card: 236 wide, 316 tall, from its top left corner. */
const CW = 236
const CH = 316
function Checkout({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={CW} height={CH} rx="20" fill="var(--bg)" stroke="var(--muted)" strokeOpacity="0.5" />
      <rect x={x} y={y} width={CW} height="52" rx="20" fill="var(--hover)" />
      <rect x={x} y={y + 32} width={CW} height="20" fill="var(--hover)" />
      <line x1={x} y1={y + 52} x2={x + CW} y2={y + 52} stroke="var(--line)" />
      <image href="/brand/logo-mark.png" x={x + 18} y={y + 17} width="28" height="18" />
      <text x={x + 54} y={y + 31} fontSize="13.5" fontWeight="600" fill="var(--fg)">
        Money Moves checkout
      </text>
      <text x={x + 20} y={y + 86} fontSize="12" fill="var(--muted)">
        Two shirts
      </text>
      <text x={x + 20} y={y + 122} fontSize="32" fontWeight="700" letterSpacing="-1" fill="var(--fg)">
        ₦18,100
      </text>
      <text x={x + 20} y={y + 144} fontSize="12" fill="var(--muted)">
        about $13.33 at today's rate
      </text>
      {['Transfer', 'App', 'Crypto'].map((t, i) => (
        <g key={t}>
          <rect x={x + 20 + i * 66} y={y + 166} width="60" height="28" rx="8" fill={i === 2 ? 'var(--accent-bg)' : 'var(--raise)'} stroke={i === 2 ? 'var(--accent)' : 'var(--line)'} strokeOpacity={i === 2 ? 0.6 : 1} />
          <text x={x + 50 + i * 66} y={y + 184.5} textAnchor="middle" fontSize="11.5" fontWeight="600" fill={i === 2 ? 'var(--accent)' : 'var(--muted)'}>
            {t}
          </text>
        </g>
      ))}
      <rect x={x + 20} y={y + 214} width={CW - 40} height="40" rx="20" fill="#81FB02" />
      <text x={x + CW / 2} y={y + 239} textAnchor="middle" fontSize="13.5" fontWeight="700" fill="#0B0B0C">
        Paid ✓
      </text>
      <circle className="mm-flow-pulse" cx={x + 26} cy={y + 281} r="4" fill="#81FB02" />
      <text x={x + 38} y={y + 285} fontSize="11.5" fill="var(--muted)">
        Confirmed on chain · settling now
      </text>
    </g>
  )
}

function KeysBadge({ cx, y }: { cx: number; y: number }) {
  return (
    <g>
      <rect x={cx - 65} y={y} width="130" height="24" rx="12" fill="var(--accent-bg)" stroke="var(--accent)" strokeOpacity="0.5" />
      <text x={cx} y={y + 16} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent)">
        You hold the keys
      </text>
    </g>
  )
}

/** Your server, hearing about it: 92 tall. */
function Server({ x, y, w }: { x: number; y: number; w: number }) {
  const mono = "'JetBrains Mono', ui-monospace, monospace"
  return (
    <g>
      <rect x={x} y={y} width={w} height="92" rx="16" fill="var(--code)" stroke="var(--code-line)" />
      <circle cx={x + 24} cy={y + 22} r="4" fill="#F29A92" />
      <circle cx={x + 38} cy={y + 22} r="4" fill="#F2C17D" />
      <circle cx={x + 52} cy={y + 22} r="4" fill="#8EDB9F" />
      <text x={x + 72} y={y + 26} fontSize="11.5" fontWeight="600" fill="#9C9C97">
        Your server
      </text>
      <text x={x + 24} y={y + 54} fontSize="13" fill="#E8E6DE" fontFamily={mono}>
        <tspan fill="#9CC4F2">POST</tspan> /webhooks/money-moves
      </text>
      <text x={x + 24} y={y + 77} fontSize="13" fill="#E8E6DE" fontFamily={mono}>
        <tspan fill="#C3EE8E">payment.successful</tspan>
        <tspan fill="#6F6E68"> · </tspan>
        <tspan fill="#8EDB9F">✓ signature checked</tspan>
      </text>
    </g>
  )
}

function Backdrop({ id, w, h, glow }: { id: string; w: number; h: number; glow: [number, number] }) {
  return (
    <>
      <defs>
        <pattern id={`${id}-dots`} width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="var(--line)" />
        </pattern>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#81FB02" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#81FB02" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} rx="18" fill={`url(#${id}-dots)`} />
      <ellipse cx={glow[0]} cy={glow[1]} rx="260" ry="220" fill={`url(#${id}-glow)`} />
    </>
  )
}

const LABEL = 'Customers pay by bank transfer, the Money Moves app or USDC and USDT. The Money Moves checkout confirms each payment and settles it instantly to your bank account, your Money Moves username or your self-custody business wallet, and sends a signed webhook to your server.'
const SVG_CLASS = 'h-auto w-full overflow-visible rounded-[18px] border border-line bg-raise'

/** Wide screens: left to right. */
function Wide() {
  const cx = 382
  const cy = 92
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={LABEL} className={`block ${SVG_CLASS}`}>
      <Backdrop id="mm-wide" w={W} h={H} glow={[cx + CW / 2, cy + 150]} />
      <Label x={40} y={74}>CUSTOMERS PAY WITH</Label>
      <Label x={cx + CW / 2} y={74} anchor="middle">ONE CHECKOUT</Label>
      <Label x={960} y={74} anchor="end">SETTLES INSTANTLY TO</Label>
      {IN.map((r, i) => (
        <Wire key={`in-${r.title}`} d={curve(282, r.y, cx, cy + 92 + i * 56)} n={i} />
      ))}
      {OUT.map((r, i) => (
        <Wire key={`out-${r.title}`} d={curve(cx + CW, cy + 92 + i * 56, 718, r.y)} n={i + 1} />
      ))}
      {IN.map((r) => (
        <Card key={r.title} x={40} y={r.y} w={242} title={r.title} sub={r.sub} icon={r.icon} />
      ))}
      <Checkout x={cx} y={cy} />
      {OUT.map((r) => (
        <Card key={r.title} x={718} y={r.y} w={242} title={r.title} sub={r.sub} icon={r.icon} glow={r.icon === 'key'} />
      ))}
      <KeysBadge cx={855} y={396} />
      <Wire d={`M ${cx + CW / 2} ${cy + CH} L ${cx + CW / 2} 468`} n={1} />
      <Server x={250} y={468} w={500} />
    </svg>
  )
}

export function FlowArt() {
  return (
    <figure data-skip className="my-9">
      <style>{`
        .mm-flow-dot { animation: mm-flow 2.6s linear infinite; }
        .mm-flow-dot.d1 { animation-delay: -0.9s; }
        .mm-flow-dot.d2 { animation-delay: -1.7s; }
        .mm-flow-pulse { animation: mm-pulse 2.6s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        @keyframes mm-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -120; } }
        @keyframes mm-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .mm-flow-dot, .mm-flow-pulse { animation: none; } }
      `}</style>
      <Wide />
    </figure>
  )
}
