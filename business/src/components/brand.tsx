import { ASSET_ICON, CHAIN_ICON, type Chain, type Currency, type Method } from '@/data/mock'
import { initials } from '@/lib/format'
import { useId } from 'react'
import { cx } from './ui'
import { Landmark } from './icons'

/**
 * The mark, drawn in whatever colour it sits on: black on paper and on the
 * lime panel. The PNG is used as a mask, so one file serves every ground.
 */
export function Mark({ size = 22, color = '#121210' }: { size?: number; color?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0"
      style={{
        width: size * 1.62,
        height: size,
        background: color,
        WebkitMask: 'url(/brand/logo-mark.png) center / contain no-repeat',
        mask: 'url(/brand/logo-mark.png) center / contain no-repeat',
      }}
    />
  )
}

/** Mark, wordmark and the product name. */
export function Logo({ compact, color = '#121210' }: { compact?: boolean; color?: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" style={{ color }}>
      <Mark size={compact ? 16 : 19} color={color} />
      {!compact && (
        <span className="display text-[17px] font-bold leading-none tracking-[-0.03em]">
          money moves<span className="ml-1.5 font-medium opacity-55">business</span>
        </span>
      )}
    </span>
  )
}

/**
 * Naira as a real coin: Nigerian green with a soft rim, and the ₦ drawn as
 * shapes rather than a font glyph, so it sits dead centre at every size.
 */
export function NairaCoin({ size = 32 }: { size?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" role="img" aria-label="Naira">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22A866" />
          <stop offset="1" stopColor="#0A6A3A" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${id})`} />
      <circle cx="16" cy="16" r="13.4" fill="none" stroke="#fff" strokeOpacity="0.22" />
      <path d="M11.2 22.4V9.6h2l5.6 8.3V9.6h2v12.8h-2l-5.6-8.3v8.3z" fill="#fff" />
      <rect x="8.6" y="13.1" width="14.8" height="1.6" rx="0.8" fill="#fff" />
      <rect x="8.6" y="16.4" width="14.8" height="1.6" rx="0.8" fill="#fff" />
    </svg>
  )
}

/**
 * The Money Moves app: the mark in brand lime on an ink coin with a faint
 * top light, so it reads as an app beside the token coins rather than a flat
 * sticker.
 */
export function AppIcon({ size = 32, rounded = 'rounded-full', mark = 0.38 }: { size?: number; rounded?: string; /** The mark's width as a share of the icon: larger reads better small. */ mark?: number }) {
  return (
    <span
      role="img"
      aria-label="Money Moves app"
      className={cx('mark-tile inline-flex shrink-0 items-center justify-center', rounded)}
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(120% 110% at 30% 15%, #34382F 0%, #121210 58%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)',
      }}
    >
      <Mark size={size * mark} color="#81FB02" />
    </span>
  )
}

/** Money Moves as a place money goes: its mark in ink on a plain circle, like the bank and wallet beside it. */
export function PlaceMark({ size = 24 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full border border-line bg-card" style={{ width: size, height: size }}>
      <Mark size={size * 0.34} color="var(--color-fg)" />
    </span>
  )
}

/** A bank transfer as a way to pay: a bank in the neon lime on black, like the app and crypto marks. */
export function BankMark({ size = 32 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Bank transfer"
      className="mark-tile inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'radial-gradient(120% 110% at 30% 15%, #34382F 0%, #121210 58%)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.09)' }}
    >
      <Landmark weight="fill" style={{ width: size * 0.62, height: size * 0.62, color: '#81FB02' }} />
    </span>
  )
}

/** Crypto as a way to pay - the method, not a coin. A payment that happened shows its own coin instead. */
export function CryptoMark({ size = 32 }: { size?: number }) {
  return <img src="/brand/btc-black.png" alt="" aria-hidden width={size} height={size} className="mark-tile shrink-0 rounded-full" style={{ width: size, height: size }} />
}

/** The app's mark as a plain line icon, in whatever colour the text around it is. */
export function AppLine({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-current"
      style={{ width: size, height: size, WebkitMask: 'url(/brand/logo-mark.png) center / contain no-repeat', mask: 'url(/brand/logo-mark.png) center / contain no-repeat' }}
    />
  )
}

/** The icon for a way to pay: the app, crypto, or naira. */
export function MethodIcon({ method, size = 32 }: { method: Method; size?: number }) {
  if (method === 'app') return <AppIcon size={size} />
  if (method === 'naira') return <BankMark size={size} />
  return <CryptoMark size={size} />
}

export function PayIcon({ method, asset, chain, size = 32 }: { method: Method; asset: string; chain?: Chain; size?: number }) {
  if (method === 'app') return <AppIcon size={size} />
  if (method === 'naira') return <NairaCoin size={size} />
  return <TokenIcon asset={asset} chain={chain} size={size} />
}

export function TokenIcon({ asset, chain, size = 32 }: { asset: string; chain?: Chain; size?: number }) {
  const badge = Math.round(size * 0.48)
  if (asset === 'NGN') return <NairaCoin size={size} />
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <img src={ASSET_ICON[asset] ?? ASSET_ICON.USDC} alt={asset} className="size-full rounded-full object-cover" />
      {chain && (
        <img
          src={CHAIN_ICON[chain]}
          alt={chain}
          className="absolute -bottom-0.5 -right-0.5 rounded-full object-cover ring-2 ring-white"
          style={{ width: badge, height: badge }}
        />
      )}
    </span>
  )
}

export function ChainIcon({ chain, size = 18 }: { chain: Chain; size?: number }) {
  return <img src={CHAIN_ICON[chain]} alt={chain} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
}

/** Initials on a tinted square - paper-friendly tints, ink letters. */
const TINTS = ['#E7E4DA', '#DFE7D6', '#DCE2EA', '#ECE1D5', '#E4DDE7', '#D8E6E1']

export function Avatar({ name, size = 36, square }: { name: string; size?: number; square?: boolean }) {
  const tint = TINTS[name.length % TINTS.length]!
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center font-semibold', square ? 'rounded-[7px]' : 'rounded-full')}
      // Dark ink on the pastel tile in either theme: the tile itself never changes.
      style={{ width: size, height: size, background: tint, color: '#121210', fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  )
}

/** A round flag for the two currencies a customer can see the order in. */
export function Flag({ c, size = 20 }: { c: Currency; size?: number }) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-black/10" style={{ width: size, height: size }}>
      {c === 'NGN' ? (
        <svg viewBox="0 0 3 3" className="size-full" preserveAspectRatio="none" aria-hidden>
          <rect width="1" height="3" fill="#008751" />
          <rect x="1" width="1" height="3" fill="#FFFFFF" />
          <rect x="2" width="1" height="3" fill="#008751" />
        </svg>
      ) : (
        <svg viewBox="0 0 26 26" className="size-full" aria-hidden>
          <rect width="26" height="26" fill="#FFFFFF" />
          {[0, 4, 8, 12, 16, 20, 24].map((y) => (
            <rect key={y} y={y} width="26" height="2" fill="#B22234" />
          ))}
          <rect width="12" height="14" fill="#3C3B6E" />
          {[
            [2.5, 2.5],
            [6, 2.5],
            [9.5, 2.5],
            [4.25, 5.5],
            [7.75, 5.5],
            [2.5, 8.5],
            [6, 8.5],
            [9.5, 8.5],
            [4.25, 11.5],
            [7.75, 11.5],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.85" fill="#FFFFFF" />
          ))}
        </svg>
      )}
    </span>
  )
}
