/**
 * A month's statement as a PDF, for the business's accountant: a header with
 * the business and the month, the summary in boxes (money in, our fees, what's
 * theirs, payments, refunds, disputes), how customers paid and where it
 * settled with their shares, then every payment and every settlement, as many
 * A4 pages as it takes. Built by hand in the standard Helvetica, like the
 * other PDF exports, so nothing has to load; that means "NGN", not the naira
 * sign, which the standard fonts don't have.
 */

export interface Statement {
  business: { name: string; merchantId: string }
  mode: 'live' | 'test'
  month: string
  from?: string
  to?: string
  generatedAt: string
  totals: {
    payments: number
    receivedNgn: number
    feesNgn: number
    netNgn: number
    refunds: number
    refundedNgn: number
    feesReturnedNgn: number
    refundsYouSentNgn: number
    disputesOpened: number
    disputesClosed: Record<string, number>
  }
  byMethod: { method: string; count: number; receivedNgn: number; feesNgn: number }[]
  settledBy: { to: string; count: number; amountNgn: number }[]
  payments: { paidAt: string; ref: string; method: string; channel: string; customer: string | null; receivedNgn: number | null; feeNgn: number | null; partPaid: boolean }[]
  settlements: { settledAt: string; ref: string; payment: string; to: string; detail: string | null; amountNgn: number | null; amountUsdc: number | null }[]
  truncated: boolean
}

const W = 595 // A4 portrait
const H = 842
const M = 40
const INNER = W - 2 * M

// Colours, as PDF reads them: ink, lime, paper and lines from the dashboard.
const INK = '0.071 0.071 0.063'
const LIME = '0.506 0.984 0.008'
const PAPER = '0.961 0.957 0.941'
const STRIPE = '0.984 0.982 0.976'
const LINE = '0.890 0.882 0.859'
const MUTED = '0.420 0.416 0.392'
const STONE = '0.725 0.714 0.675'
const WHITE = '1 1 1'
const SOFT_WHITE = '0.78 0.78 0.76'

// Helvetica and Helvetica-Bold widths for printable ASCII (32 to 126), per 1000 units.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]

/** Plain text the standard fonts can print: accents dropped, a middle dot kept. */
const clean = (s: string) => s.normalize('NFKD').replace(/·/g, '\x01').replace(/[^\x20-\x7e\x01]/g, '')
const widthOf = (s: string, size: number, bold: boolean) => {
  const t = bold ? HELV_B : HELV
  let w = 0
  for (const ch of clean(s)) w += ch === '\x01' ? 278 : (t[ch.charCodeAt(0) - 32] ?? 556)
  return (w / 1000) * size
}
const pdfString = (s: string) => clean(s).replace(/([()\\])/g, '\\$1').replace(/\x01/g, '\\267')
/** Shortened to fit, with a full stop where it was cut. */
const fit = (s: string, max: number, size: number, bold = false) => {
  if (widthOf(s, size, bold) <= max) return s
  let t = s
  while (t.length > 1 && widthOf(`${t}.`, size, bold) > max) t = t.slice(0, -1)
  return `${t.trimEnd()}.`
}

const money = (n: number | null | undefined) => (n == null ? '' : `NGN ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const day = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function statementPdf(s: Statement): Blob {
  const pages: string[][] = []
  let y = 0
  const ops = () => pages[pages.length - 1]!
  const month = monthName(s.month)

  const fill = (rgb: string, x: number, yy: number, w: number, h: number) => ops().push(`${rgb} rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`)
  const hline = (yy: number, rgb = LINE, x1 = M, x2 = W - M, width = 0.6) => ops().push(`${rgb} RG ${width} w ${x1.toFixed(1)} ${yy.toFixed(1)} m ${x2.toFixed(1)} ${yy.toFixed(1)} l S`)
  const txt = (x: number, yy: number, size: number, str: string, o: { bold?: boolean; rgb?: string; align?: 'l' | 'r' } = {}) => {
    const bold = !!o.bold
    const at = o.align === 'r' ? x - widthOf(str, size, bold) : x
    ops().push(`BT ${o.rgb ?? INK} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${at.toFixed(1)} ${yy.toFixed(1)} Td (${pdfString(str)}) Tj ET`)
  }

  // ─── Pages: a full header on the first, a slim one after ───
  const firstPage = () => {
    pages.push([])
    fill(INK, 0, H - 112, W, 112)
    fill(LIME, M, H - 30, 14, 3)
    txt(M + 20, H - 32, 8, 'MONEY MOVES BUSINESS', { bold: true, rgb: LIME })
    txt(M, H - 62, 20, fit(s.business.name, INNER - 190, 20, true), { bold: true, rgb: WHITE })
    txt(M, H - 82, 10.5, `Statement for ${month}`, { rgb: SOFT_WHITE })
    if (s.mode === 'test') {
      const tw = widthOf('TEST MODE', 7.5, true) + 12
      const x = M + widthOf(`Statement for ${month}`, 10.5, false) + 10
      fill(LIME, x, H - 85, tw, 14)
      txt(x + 6, H - 81, 7.5, 'TEST MODE', { bold: true })
    }
    const period = s.from && s.to ? `${date(s.from)} to ${date(new Date(new Date(s.to).getTime() - 1).toISOString())}` : month
    txt(W - M, H - 32, 7.5, 'MERCHANT ID', { rgb: STONE, align: 'r' })
    txt(W - M, H - 45, 10, s.business.merchantId, { bold: true, rgb: WHITE, align: 'r' })
    txt(W - M, H - 66, 7.5, 'PERIOD, LAGOS TIME', { rgb: STONE, align: 'r' })
    txt(W - M, H - 79, 10, period, { rgb: WHITE, align: 'r' })
    y = H - 112 - 30
  }
  const nextPage = () => {
    pages.push([])
    txt(M, H - 40, 9, s.business.name, { bold: true })
    txt(W - M, H - 40, 9, `Statement for ${month}`, { rgb: MUTED, align: 'r' })
    hline(H - 50)
    y = H - 74
  }
  const room = (need: number) => {
    if (y - need < 56) nextPage()
  }
  const heading = (title: string, aside?: string) => {
    room(70)
    txt(M, y, 11.5, title, { bold: true })
    if (aside) txt(W - M, y, 8.5, aside, { rgb: MUTED, align: 'r' })
    y -= 9
    hline(y)
    y -= 18
  }

  firstPage()

  // ─── The summary, in boxes ───
  const gap = 10
  const bw = (INNER - 2 * gap) / 3
  const box = (i: number, h: number, label: string, value: string, sub: string | null, dark = false) => {
    const x = M + i * (bw + gap)
    fill(dark ? INK : PAPER, x, y - h, bw, h)
    if (dark) fill(LIME, x, y - h, 3, h)
    txt(x + 14, y - 18, 8, label.toUpperCase(), { bold: true, rgb: dark ? STONE : MUTED })
    txt(x + 14, y - 40, 15, fit(value, bw - 28, 15, true), { bold: true, rgb: dark ? WHITE : INK })
    if (sub) txt(x + 14, y - 58, 8, fit(sub, bw - 28, 8), { rgb: dark ? SOFT_WHITE : MUTED })
  }
  box(0, 72, 'Received', money(s.totals.receivedNgn), plural(s.totals.payments, 'payment'))
  box(1, 72, 'Our fees', money(s.totals.feesNgn), s.totals.receivedNgn ? `${((s.totals.feesNgn / s.totals.receivedNgn) * 100).toFixed(2)}% of what came in` : null)
  box(2, 72, 'Yours after fees', money(s.totals.netNgn), 'Received, less our fees', true)
  y -= 72 + gap
  const customers = new Set(s.payments.map((p) => (p.customer ?? '').trim().toLowerCase()).filter(Boolean)).size
  const closed = s.totals.disputesClosed
  box(1, 72, 'Refunds', money(s.totals.refundedNgn), s.totals.refunds ? `${plural(s.totals.refunds, 'refund')}, NGN ${s.totals.refundsYouSentNgn.toFixed(2)} sent by you` : 'None this month')
  box(0, 72, 'Customers', customers.toLocaleString(), s.totals.payments ? `Average ${money(s.totals.receivedNgn / s.totals.payments)}` : 'No payments this month')
  box(2, 72, 'Disputes', plural(s.totals.disputesOpened, 'opened', 'opened'), `${closed.won ?? 0} won · ${closed.refunded ?? 0} refunded · ${closed.lost ?? 0} lost`)
  y -= 72 + 30

  // ─── Shares: how customers paid, where it settled ───
  const TONES = [LIME, INK, STONE, LINE]
  const shares = (title: string, cols: { head: string; x: number }[], rows: { name: string; values: string[]; amount: number }[], total: string[]) => {
    heading(title)
    const sum = rows.reduce((t, r) => t + r.amount, 0)
    const barX = M + 150
    const barW = 110
    txt(M, y, 7.5, cols[0]!.head.toUpperCase(), { bold: true, rgb: MUTED })
    txt(barX, y, 7.5, 'SHARE', { bold: true, rgb: MUTED })
    cols.slice(1).forEach((c) => txt(c.x, y, 7.5, c.head.toUpperCase(), { bold: true, rgb: MUTED, align: 'r' }))
    y -= 16
    if (!rows.length) {
      txt(M, y, 9, 'Nothing this month.', { rgb: MUTED })
      y -= 26
      return
    }
    rows.forEach((r, i) => {
      room(20)
      const share = sum ? r.amount / sum : 0
      fill(TONES[i % TONES.length]!, M, y - 1, 8, 8)
      txt(M + 14, y, 9, fit(r.name, 130, 9), {})
      fill(PAPER, barX, y, barW, 6)
      if (share > 0) fill(TONES[i % TONES.length]!, barX, y, Math.max(1.5, barW * share), 6)
      txt(barX + barW + 8, y, 8, `${Math.round(share * 100)}%`, { rgb: MUTED })
      r.values.forEach((v, j) => txt(cols[j + 1]!.x, y, 9, v, { align: 'r' }))
      y -= 8
      hline(y, STRIPE)
      y -= 12
    })
    hline(y + 6, INK, M, W - M, 0.8)
    y -= 8
    txt(M, y, 9, 'Total', { bold: true })
    total.forEach((v, j) => txt(cols[j + 1]!.x, y, 9, v, { bold: true, align: 'r' }))
    y -= 32
  }
  shares(
    'How customers paid',
    [{ head: 'Method', x: M }, { head: 'Payments', x: M + 340 }, { head: 'Received', x: M + 430 }, { head: 'Fees', x: W - M }],
    s.byMethod.map((m) => ({ name: m.method, amount: m.receivedNgn, values: [m.count.toLocaleString(), money(m.receivedNgn), money(m.feesNgn)] })),
    [s.totals.payments.toLocaleString(), money(s.totals.receivedNgn), money(s.totals.feesNgn)],
  )
  shares(
    'Where it settled',
    [{ head: 'To', x: M }, { head: 'Settlements', x: M + 380 }, { head: 'Amount', x: W - M }],
    s.settledBy.map((x) => ({ name: x.to, amount: x.amountNgn, values: [x.count.toLocaleString(), money(x.amountNgn)] })),
    [s.settledBy.reduce((t, x) => t + x.count, 0).toLocaleString(), money(s.settledBy.reduce((t, x) => t + x.amountNgn, 0))],
  )

  // ─── Every payment and every settlement ───
  type Col = { head: string; x: number; w: number; align?: 'r' }
  const list = (title: string, cols: Col[], rows: { cells: string[]; note?: boolean }[]) => {
    heading(title, rows.length ? plural(rows.length, 'row') : undefined)
    const header = () => {
      fill(PAPER, M, y - 5, INNER, 18)
      cols.forEach((c, j) => txt(c.align === 'r' ? c.x - (j === cols.length - 1 ? 6 : 0) : c.x + (j === 0 ? 6 : 0), y, 7.5, c.head.toUpperCase(), { bold: true, rgb: MUTED, align: c.align }))
      y -= 19
    }
    header()
    if (!rows.length) {
      txt(M + 6, y, 9, 'None this month.', { rgb: MUTED })
      y -= 28
      return
    }
    rows.forEach((r, i) => {
      if (y - 15 < 56) {
        nextPage()
        header()
      }
      if (i % 2 === 1) fill(STRIPE, M, y - 4.5, INNER, 15)
      r.cells.forEach((v, j) => {
        const c = cols[j]!
        const x = c.align === 'r' ? c.x - (j === cols.length - 1 ? 6 : 0) : c.x + (j === 0 ? 6 : 0)
        txt(x, y, 8, fit(v, c.w, 8), { align: c.align, rgb: r.note && j === 2 ? MUTED : INK })
      })
      y -= 15
    })
    y -= 26
  }
  list(
    `Payments`,
    [
      { head: 'Paid', x: M, w: 70 },
      { head: 'Reference', x: M + 78, w: 76 },
      { head: 'Customer', x: M + 160, w: 122 },
      { head: 'Method', x: M + 288, w: 76 },
      { head: 'Received', x: M + 448, w: 80, align: 'r' },
      { head: 'Fee', x: W - M, w: 60, align: 'r' },
    ],
    s.payments.map((p) => ({ cells: [day(p.paidAt), p.ref, `${p.customer ?? 'No name given'}${p.partPaid ? ' (part paid)' : ''}`, p.method, money(p.receivedNgn), money(p.feeNgn)], note: !p.customer })),
  )
  list(
    `Settlements`,
    [
      { head: 'Settled', x: M, w: 70 },
      { head: 'Reference', x: M + 78, w: 96 },
      { head: 'Payment', x: M + 180, w: 76 },
      { head: 'To', x: M + 262, w: 150 },
      { head: 'Amount', x: W - M, w: 96, align: 'r' },
    ],
    s.settlements.map((x) => ({ cells: [day(x.settledAt), x.ref, x.payment, [x.to, x.detail].filter(Boolean).join(', '), x.amountUsdc != null ? `${x.amountUsdc.toFixed(2)} USDC` : money(x.amountNgn)] })),
  )
  if (s.truncated) {
    room(20)
    txt(M, y, 8.5, 'This month has more than 5,000 payments or settlements, so the lists stop there. Export the full list as a CSV from Reports.', { rgb: MUTED })
  }

  // ─── A footer on every page, then the file ───
  pages.forEach((p, i) => {
    p.push(`${LINE} RG 0.6 w ${M} 40 m ${W - M} 40 l S`)
    p.push(`BT ${MUTED} rg /F1 7.5 Tf ${M} 27 Td (${pdfString(`${s.business.name} · Statement for ${month} · Made ${day(s.generatedAt)}, Lagos time`)}) Tj ET`)
    const pg = `Page ${i + 1} of ${pages.length}`
    p.push(`BT ${MUTED} rg /F1 7.5 Tf ${(W - M - widthOf(pg, 7.5, false)).toFixed(1)} 27 Td (${pg}) Tj ET`)
  })
  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((p, i) => {
    const n = 5 + i * 2
    const content = p.join('\n')
    objs[n] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${n + 1} 0 R >>`
    objs[n + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([out], { type: 'application/pdf' })
}
