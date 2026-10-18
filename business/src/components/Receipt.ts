/**
 * The customer's receipt, as a PDF they can keep: who they paid, how much,
 * when, how, and the reference that traces it - drawn plainly, like a good
 * printed slip, in the checkout's own type.
 *
 * It's drawn on a canvas and wrapped in a one-page PDF by hand, so nothing is
 * sent anywhere and no library is needed.
 */

export interface ReceiptData {
  merchant: string
  logo?: string | null
  /** What it was for: the link's name, "Invoice INV-0004", the outlet's name. */
  title: string
  description?: string | null
  /** The amount as the customer saw it, and its equivalent. */
  amount: string
  other?: string
  paidWith: string
  reference: string
  paidAt: string
  payerName?: string
  payerEmail?: string
  rate?: string
  items?: { name: string; qty: number; total: string }[]
  /** A test payment: said on the receipt, so it can't pass for a real one. */
  test?: boolean
}

const INK = '#121210'
const MUTED = '#6B6A64'
const DIM = '#9C9A92'
const LINE = '#E6E4DE'
const SANS = 'Inter, "Host Grotesk", ui-sans-serif, system-ui, sans-serif'
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'

const W = 1240
const P = 96

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = src
  })
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Text cut to fit, with an ellipsis. */
function fitText(x: CanvasRenderingContext2D, text: string, max: number) {
  if (x.measureText(text).width <= max) return text
  let t = text
  while (t.length > 1 && x.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t}…`
}

/** Words wrapped to lines no wider than `max`. */
function wrap(x: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (x.measureText(next).width > max && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

async function draw(d: ReceiptData) {
  await Promise.all(
    ['400 28px Inter', '500 28px Inter', '600 28px Inter', '600 96px Inter', `500 26px "IBM Plex Mono"`].map((f) => document.fonts.load(f).catch(() => null)),
  )
  const [logo, mark] = await Promise.all([d.logo ? loadImg(d.logo).catch(() => null) : Promise.resolve(null), loadImg('/brand/logo-mark.png').catch(() => null)])

  const rows: [string, string, boolean?][] = [
    ['Paid to', d.merchant],
    ...(d.payerName ? ([['Paid by', d.payerName]] as [string, string][]) : []),
    ['Paid with', d.paidWith],
    ['Date', d.paidAt],
    ['Reference', d.reference, true],
    ...(d.payerEmail ? ([['Sent to', d.payerEmail]] as [string, string][]) : []),
    ...(d.rate ? ([['Rate', d.rate]] as [string, string][]) : []),
  ]
  const items = d.items ?? []

  // Height first: header, amount, what it was for, items, the rows, the footer.
  const ROW = 78
  const descLines = d.description ? 2 : 0
  const H = 330 + 270 + (items.length ? 90 + items.length * 64 + 30 : 0) + 120 + descLines * 40 + rows.length * ROW + 300 + (d.test ? 90 : 0)

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.fillStyle = '#FFFFFF'
  x.fillRect(0, 0, W, H)
  x.textBaseline = 'alphabetic'

  // ─ The business, and what this is ─
  let y = 120
  const size = 84
  if (logo) {
    x.save()
    x.beginPath()
    x.arc(P + size / 2, y + size / 2 - 30, size / 2, 0, Math.PI * 2)
    x.clip()
    x.drawImage(logo, P, y - 30, size, size)
    x.restore()
  } else {
    x.fillStyle = '#EFEDE7'
    x.beginPath()
    x.arc(P + size / 2, y + size / 2 - 30, size / 2, 0, Math.PI * 2)
    x.fill()
    x.fillStyle = INK
    x.font = `600 30px ${SANS}`
    x.textAlign = 'center'
    x.fillText(initials(d.merchant), P + size / 2, y + 22)
    x.textAlign = 'left'
  }
  x.fillStyle = INK
  x.font = `600 34px ${SANS}`
  x.fillText(fitText(x, d.merchant, W - P * 2 - size - 280), P + size + 26, y + 24)

  x.textAlign = 'right'
  x.fillStyle = MUTED
  x.font = `500 26px ${SANS}`
  x.fillText('Receipt', W - P, y + 2)
  x.fillStyle = INK
  x.font = `500 24px ${MONO}`
  x.fillText(d.reference, W - P, y + 40)
  x.textAlign = 'left'

  // ─ The amount, and that it's paid ─
  y = 300
  x.fillStyle = MUTED
  x.font = `400 28px ${SANS}`
  x.fillText('Amount paid', P, y)
  x.fillStyle = INK
  let big = 104
  x.font = `600 ${big}px ${SANS}`
  while (big > 60 && x.measureText(d.amount).width > W - P * 2) x.font = `600 ${--big}px ${SANS}`
  x.fillText(d.amount, P, y + 118)
  y += 118
  if (d.other) {
    x.fillStyle = DIM
    x.font = `400 28px ${SANS}`
    x.fillText(`≈ ${d.other}`, P, y + 54)
  }
  // "Paid" with a dot, then when.
  const pillY = y + 92
  x.font = `600 24px ${SANS}`
  const pillW = x.measureText('Paid').width + 62
  x.fillStyle = '#E8F4EC'
  x.beginPath()
  x.roundRect(P, pillY, pillW, 46, 23)
  x.fill()
  x.fillStyle = '#1E7A3E'
  x.beginPath()
  x.arc(P + 24, pillY + 23, 6, 0, Math.PI * 2)
  x.fill()
  x.fillText('Paid', P + 40, pillY + 31)
  x.fillStyle = MUTED
  x.font = `400 26px ${SANS}`
  x.fillText(d.paidAt, P + pillW + 20, pillY + 32)

  // ─ What it was for ─
  y = 600
  x.strokeStyle = LINE
  x.lineWidth = 2
  x.beginPath()
  x.moveTo(P, y)
  x.lineTo(W - P, y)
  x.stroke()
  y += 70
  x.fillStyle = INK
  x.font = `600 32px ${SANS}`
  x.fillText(fitText(x, d.title, W - P * 2), P, y)
  if (d.description) {
    x.fillStyle = MUTED
    x.font = `400 26px ${SANS}`
    wrap(x, d.description, W - P * 2)
      .slice(0, 2)
      .forEach((l, i) => x.fillText(l, P, y + 46 + i * 38))
    y += descLines * 40
  }
  y += 50

  if (items.length) {
    y += 30
    x.fillStyle = DIM
    x.font = `500 22px ${SANS}`
    x.fillText('ITEM', P, y)
    x.textAlign = 'right'
    x.fillText('AMOUNT', W - P, y)
    x.textAlign = 'left'
    y += 20
    for (const it of items) {
      y += 64
      x.fillStyle = INK
      x.font = `400 27px ${SANS}`
      x.fillText(fitText(x, `${it.qty > 1 ? `${it.qty} × ` : ''}${it.name}`, W - P * 2 - 280), P, y)
      x.textAlign = 'right'
      x.fillText(it.total, W - P, y)
      x.textAlign = 'left'
    }
    y += 40
  }

  // ─ The details, a row each ─
  x.strokeStyle = LINE
  x.beginPath()
  x.moveTo(P, y)
  x.lineTo(W - P, y)
  x.stroke()
  for (const [label, value, mono] of rows) {
    y += ROW
    x.fillStyle = MUTED
    x.font = `400 27px ${SANS}`
    x.fillText(label, P, y - 28)
    x.fillStyle = INK
    x.font = mono ? `500 25px ${MONO}` : `500 27px ${SANS}`
    x.textAlign = 'right'
    x.fillText(fitText(x, value, W - P * 2 - 260), W - P, y - 28)
    x.textAlign = 'left'
    x.strokeStyle = '#F0EEE9'
    x.beginPath()
    x.moveTo(P, y)
    x.lineTo(W - P, y)
    x.stroke()
  }
  // The total, heavier.
  y += ROW + 10
  x.fillStyle = INK
  x.font = `600 32px ${SANS}`
  x.fillText('Total', P, y - 26)
  x.textAlign = 'right'
  x.fillText(d.amount, W - P, y - 26)
  x.textAlign = 'left'

  if (d.test) {
    y += 30
    x.fillStyle = '#FDF6E7'
    x.beginPath()
    x.roundRect(P, y, W - P * 2, 64, 14)
    x.fill()
    x.fillStyle = '#6E440A'
    x.font = `500 24px ${SANS}`
    x.fillText('Test payment. No real money moved.', P + 24, y + 41)
    y += 64
  }

  // ─ The small print ─
  const foot = H - 150
  x.strokeStyle = LINE
  x.beginPath()
  x.moveTo(P, foot - 40)
  x.lineTo(W - P, foot - 40)
  x.stroke()
  x.fillStyle = DIM
  x.font = `400 22px ${SANS}`
  x.fillText(fitText(x, `Questions about this payment? Contact ${d.merchant} with the reference above.`, W - P * 2), P, foot + 6)
  if (mark) {
    const mw = 44
    const mh = mw / 1.62
    x.drawImage(mark, P, foot + 44, mw, mh)
  }
  x.fillStyle = MUTED
  x.font = `500 22px ${SANS}`
  x.fillText('Powered by Money Moves', P + (mark ? 58 : 0), foot + 68)

  return c
}

/** A one-page PDF around a JPEG - all a receipt needs. */
function pdfOf(jpeg: Uint8Array, wPx: number, hPx: number) {
  const pw = 420
  const ph = Math.round((pw * hPx) / wPx)
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let len = 0
  const push = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b
    parts.push(u)
    len += u.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = len
    push(`${n} 0 obj\n`)
    body()
    push('\nendobj\n')
  }
  push('%PDF-1.4\n')
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'))
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`))
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
    push(jpeg)
    push('\nendstream')
  })
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
  const xref = len
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

/** Draws the receipt and saves it as a PDF named after its reference. */
export async function downloadReceipt(d: ReceiptData) {
  const c = await draw(d)
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', 0.94))
  const pdf = pdfOf(new Uint8Array(await blob.arrayBuffer()), c.width, c.height)
  const url = URL.createObjectURL(pdf)
  const a = document.createElement('a')
  a.href = url
  a.download = `receipt-${(d.reference || 'payment').toLowerCase()}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
