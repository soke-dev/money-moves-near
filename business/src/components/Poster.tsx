/**
 * The counter poster: what a shop sticks by the till.
 *
 * Drawn straight onto a canvas, so the preview is the very image that is
 * downloaded or printed - no "looks different on paper". A5 portrait at
 * print resolution, in the business's own colours from Branding: its name
 * and logo up top, "Scan to pay" with the brand highlighter, the QR, the
 * outlet's link for people who'd rather type it, three steps, what's
 * accepted, and the outlet's name in the footer so a chain's posters never
 * get mixed up between branches.
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, Loader2, Printer } from '@/components/icons'
import { Button, Modal } from '@/components/ui'
import { useSession } from '@/state/session'
import { DEFAULT_BRANDING, onColor, useBranding, type Branding } from '@/state/branding'
import { copy, initials } from '@/lib/format'
import type { Method } from '@/data/mock'
import { PAY_HOST, payUrl } from '@/state/live'

export interface PosterOutlet {
  name: string
  location: string
  slug: string
  /** What this till takes - the poster only promises those. All three if not set. */
  methods?: Method[]
  /** A payment link rather than a till: its own address, and its amount where the location would go. */
  kind?: 'outlet' | 'link'
}

/** Where a poster's code points: an outlet lives under /o/, a link at the top. */
const posterPath = (o: PosterOutlet) => `${o.kind === 'link' ? '' : 'o/'}${o.slug}`
/** The address as printed, for people who'd rather type it. */
export const posterUrl = (o: PosterOutlet) => `${PAY_HOST}/${posterPath(o)}`

const W = 1240
const H = 1754
const P = 96
const INK = '#121210'
const MUTED = '#5F5D56'
const LIME = '#81FB02'
const HIGHLIGHT = '#B4F25A'


function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}

/** The black mark, recoloured - the PNG is only ever a shape. */
function tint(img: HTMLImageElement, color: string, w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')!
  x.drawImage(img, 0, 0, w, h)
  x.globalCompositeOperation = 'source-in'
  x.fillStyle = color
  x.fillRect(0, 0, w, h)
  return c
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > max && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

async function drawPoster(o: PosterOutlet, business: string, brand: Branding, verified: boolean) {
  await Promise.all([
    document.fonts.load('700 132px "Funnel Display"'),
    document.fonts.load('600 38px "Host Grotesk"'),
    document.fonts.load('400 26px "Host Grotesk"'),
    document.fonts.load('500 30px "IBM Plex Mono"'),
  ])
  const link = posterUrl(o)
  const methods = o.methods ?? ['app', 'crypto', 'naira']
  const [mark, logo, qr] = await Promise.all([
    loadImg('/brand/logo-mark.png'),
    brand.logo ? loadImg(brand.logo) : Promise.resolve(null),
    QRCode.toDataURL(payUrl(posterPath(o)), { margin: 0, width: 1200, errorCorrectionLevel: 'H', color: { dark: '#0A0C08', light: '#FFFFFF' } }).then(loadImg),
  ])

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.textBaseline = 'alphabetic'

  // Ground: the business's own surface colour.
  x.fillStyle = brand.surface
  x.fillRect(0, 0, W, H)

  // Who you're paying.
  if (logo) {
    x.save()
    x.beginPath()
    x.roundRect(P, P, 88, 88, 20)
    x.fillStyle = '#FFFFFF'
    x.fill()
    x.clip()
    x.drawImage(logo, P, P, 88, 88)
    x.restore()
  } else {
    x.beginPath()
    x.roundRect(P, P, 88, 88, 20)
    x.fillStyle = brand.accent
    x.fill()
    x.fillStyle = onColor(brand.accent)
    x.font = '600 34px "Host Grotesk"'
    x.textAlign = 'center'
    x.fillText(initials(business), P + 44, P + 56)
    x.textAlign = 'left'
  }
  x.fillStyle = INK
  x.font = '600 38px "Host Grotesk"'
  // Verified, the name sits over the line that says so; otherwise it sits level with the logo.
  x.fillText(business.length > 34 ? `${business.slice(0, 33)}…` : business, P + 112, verified ? P + 40 : P + 58)
  if (verified) {
    x.fillStyle = MUTED
    x.font = '400 26px "Host Grotesk"'
    // A drawn tick - the font's own ✓ varies from machine to machine.
    x.strokeStyle = MUTED
    x.lineWidth = 3
    x.lineCap = 'round'
    x.lineJoin = 'round'
    x.beginPath()
    x.moveTo(P + 113, P + 69)
    x.lineTo(P + 120, P + 76)
    x.lineTo(P + 133, P + 61)
    x.stroke()
    x.fillText('Verified by Money Moves', P + 146, P + 78)
  }

  // The headline, with the highlighter swiped under "pay".
  const hy = 340
  x.font = '700 132px "Funnel Display"'
  const lead = 'Scan to '
  const leadW = x.measureText(lead).width
  const payW = x.measureText('pay').width
  x.save()
  x.fillStyle = HIGHLIGHT
  x.translate(P + leadW - 10, hy - 50)
  x.rotate(-0.025)
  x.beginPath()
  x.roundRect(0, 0, payW + 26, 54, 14)
  x.fill()
  x.restore()
  x.fillStyle = INK
  x.fillText(lead + 'pay', P - 4, hy)
  x.fillStyle = MUTED
  x.font = '400 34px "Host Grotesk"'
  const sub = methods.includes('crypto')
    ? methods.includes('naira')
      ? 'Pay with USDC or USDT from any wallet, or by bank transfer'
      : 'Pay with USDC or USDT from any crypto wallet'
    : methods.includes('naira')
      ? `Pay by bank transfer${methods.includes('app') ? ' or with the Money Moves app' : ''}`
      : 'Pay with the Money Moves app'
  // Never past the margin, whatever the line says.
  let size = 34
  while (size > 24 && x.measureText(sub).width > W - P * 2) x.font = `400 ${--size}px "Host Grotesk"`
  x.fillText(sub, P, hy + 62)

  // The code, on a white card.
  const cw = 740
  const cx = (W - cw) / 2
  const cy = 470
  const ch = 820
  x.save()
  x.shadowColor = 'rgba(18,18,16,0.10)'
  x.shadowBlur = 40
  x.shadowOffsetY = 14
  x.beginPath()
  x.roundRect(cx, cy, cw, ch, 44)
  x.fillStyle = '#FFFFFF'
  x.fill()
  x.restore()
  x.lineWidth = 2
  x.strokeStyle = '#E6E4DE'
  x.beginPath()
  x.roundRect(cx, cy, cw, ch, 44)
  x.stroke()

  const qs = 600
  const qx = (W - qs) / 2
  const qy = cy + 60
  x.drawImage(qr, qx, qy, qs, qs)
  // The app badge in the middle of the code.
  const bs = 132
  x.beginPath()
  x.roundRect(W / 2 - bs / 2 - 10, qy + qs / 2 - bs / 2 - 10, bs + 20, bs + 20, 34)
  x.fillStyle = '#FFFFFF'
  x.fill()
  x.beginPath()
  x.roundRect(W / 2 - bs / 2, qy + qs / 2 - bs / 2, bs, bs, 28)
  x.fillStyle = INK
  x.fill()
  const mw = 84
  const mh = mw / 1.62
  x.drawImage(tint(mark, LIME, mw * 2, mh * 2), W / 2 - mw / 2, qy + qs / 2 - mh / 2, mw, mh)

  // Or type it.
  x.setLineDash([8, 10])
  x.strokeStyle = '#D6D3CA'
  x.beginPath()
  x.moveTo(cx + 48, cy + 700)
  x.lineTo(cx + cw - 48, cy + 700)
  x.stroke()
  x.setLineDash([])
  x.textAlign = 'center'
  x.fillStyle = '#918F86'
  x.font = '400 24px "Host Grotesk"'
  x.fillText('or open', W / 2, cy + 744)
  x.fillStyle = INK
  // Inside the card whatever the address: smaller first, then the address on one line and its path on the next.
  const room = cw - 96
  const fit = (text: string, from: number, least: number) => {
    let s = from
    x.font = `500 ${s}px "IBM Plex Mono"`
    while (s > least && x.measureText(text).width > room) x.font = `500 ${--s}px "IBM Plex Mono"`
    return x.measureText(text).width <= room
  }
  if (fit(link, 30, 22)) x.fillText(link, W / 2, cy + 790)
  else {
    const cut = link.indexOf('/')
    const [host, path] = cut > 0 ? [link.slice(0, cut), link.slice(cut)] : [link, '']
    fit(host.length > path.length ? host : path, 28, 16)
    x.fillText(host, W / 2, cy + 772)
    x.fillText(path, W / 2, cy + 802)
  }
  x.textAlign = 'left'

  // Three steps.
  const steps = ['Scan this code with your phone', 'Pick how you want to pay', 'Type the amount and pay']
  const col = (W - P * 2) / 3
  const sy = 1430
  steps.forEach((s, i) => {
    const sx = P + i * col
    x.beginPath()
    x.arc(sx + 26, sy, 26, 0, Math.PI * 2)
    x.fillStyle = INK
    x.fill()
    x.fillStyle = '#FFFFFF'
    x.font = '600 26px "Host Grotesk"'
    x.textAlign = 'center'
    x.fillText(String(i + 1), sx + 26, sy + 9)
    x.textAlign = 'left'
    x.fillStyle = INK
    x.font = '500 27px "Host Grotesk"'
    wrap(x, s, col - 40).forEach((l, j) => x.fillText(l, sx, sy + 66 + j * 36))
  })

  // Footer: which branch this is, and who runs the checkout.
  const fy = H - 150
  x.fillStyle = INK
  x.fillRect(0, fy, W, 150)
  x.fillStyle = '#FFFFFF'
  x.font = '600 34px "Host Grotesk"'
  x.fillText(o.name, P, fy + 64)
  x.fillStyle = 'rgba(255,255,255,0.6)'
  x.font = '400 24px "Host Grotesk"'
  x.fillText(o.location, P, fy + 104)
  x.textAlign = 'right'
  x.fillStyle = '#FFFFFF'
  x.font = '700 30px "Funnel Display"'
  const word = 'money moves'
  x.fillText(word, W - P, fy + 86)
  const ww = x.measureText(word).width
  x.textAlign = 'left'
  x.drawImage(tint(mark, LIME, 104, 64), W - P - ww - 70, fy + 64, 52, 32)

  return c
}

export function PosterModal({ outlet, onClose }: { outlet: PosterOutlet | null; onClose: () => void }) {
  const { business } = useSession()
  const [brand = DEFAULT_BRANDING] = useBranding(business?.id)
  const [src, setSrc] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!outlet || !business) return
    let alive = true
    setSrc('')
    drawPoster(outlet, business.name, brand, business.verify === 'verified')
      .then((c) => alive && setSrc(c.toDataURL('image/png')))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [outlet, business, brand])

  if (!outlet) return null
  const link = posterUrl(outlet)

  const download = () => {
    const a = document.createElement('a')
    a.href = src
    a.download = `${outlet.slug}-${outlet.kind === 'link' ? 'qr' : 'counter'}-poster.png`
    a.click()
  }

  // Print just the poster, A5, edge to edge.
  const print = () => {
    const f = document.createElement('iframe')
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
    document.body.appendChild(f)
    const d = f.contentDocument!
    d.open()
    d.write(`<!doctype html><html><head><title>${outlet.name}</title><style>@page{size:A5;margin:0}html,body{margin:0}img{width:148mm;height:210mm;display:block}</style></head><body><img src="${src}"></body></html>`)
    d.close()
    const img = d.querySelector('img')!
    const go = () => {
      f.contentWindow?.focus()
      f.contentWindow?.print()
      setTimeout(() => f.remove(), 1000)
    }
    if (img.complete) go()
    else img.onload = go
  }

  return (
    <Modal
      open
      onClose={onClose}
      width={620}
      title={outlet.kind === 'link' ? 'QR poster' : 'Counter poster'}
      sub={`${outlet.name} · A5, ready to print or post. Your logo and colours come from Branding.`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            variant="ghost"
            icon={<Copy className="size-4" />}
            onClick={() => {
              copy(link)
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <div className="flex gap-2">
            <Button icon={<Printer className="size-4" />} disabled={!src} onClick={print}>
              Print
            </Button>
            <Button variant="primary" icon={<Download className="size-4" />} disabled={!src} onClick={download}>
              Download PNG
            </Button>
          </div>
        </div>
      }
    >
      <div
        className="flex items-center justify-center rounded-[10px] border border-line px-4 py-6"
        style={{ background: 'radial-gradient(circle at 1px 1px, #DCD9D0 1px, transparent 0) 0 0 / 16px 16px, #F3F2EE' }}
      >
        {src ? (
          <img src={src} alt={`Poster for ${outlet.name}`} className="h-auto max-h-[62vh] w-auto max-w-full rounded-[6px] shadow-[0_20px_50px_-18px_rgba(18,18,16,0.45)]" />
        ) : (
          <div className="flex h-[420px] items-center justify-center text-[13px] text-dim">
            <Loader2 className="mr-2 size-4 animate-spin" /> Drawing your poster…
          </div>
        )}
      </div>
    </Modal>
  )
}
