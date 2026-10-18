import { useMemo } from 'react'
import QRCode from 'qrcode'

/**
 * A QR code, dark on light so every phone camera reads it.
 *
 * Drawn as squares on whole pixels: each module is the same number of pixels
 * wide, so the code stays sharp on any screen. A picture resized to fit put
 * modules between pixels and smeared them on an ordinary PC display.
 */
export default function Qr({ value, size = 180, logo }: { value: string; size?: number; logo?: boolean }) {
  const code = useMemo(() => {
    try {
      const q = QRCode.create(value, { errorCorrectionLevel: logo ? 'H' : 'M' })
      const n = q.modules.size
      const cell = Math.max(1, Math.floor(size / n))
      let d = ''
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) d += `M${c * cell} ${r * cell}h${cell}v${cell}h-${cell}z`
      return { d, side: cell * n }
    } catch {
      return null
    }
  }, [value, size, logo])
  const side = code?.side ?? size
  const badge = Math.round(side * 0.2)
  return (
    <div className="keep-light relative inline-flex items-center justify-center rounded-2xl bg-white p-3" style={{ width: side + 24, height: side + 24 }}>
      {code && (
        <svg width={side} height={side} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
          <path d={code.d} fill="#0A0C08" />
        </svg>
      )}
      {logo && code && (
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] bg-white p-[3px] leading-none">
          <img src="/brand/app-badge.png" alt="" className="rounded-lg" style={{ width: badge, height: badge }} />
        </span>
      )}
    </div>
  )
}
