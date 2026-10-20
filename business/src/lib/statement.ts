/**
 * A month's statement as a PDF, for the business's accountant: the summary
 * first (money in, our fees, what went back, what settled where), then every
 * payment and every settlement, as many A4 pages as it takes. Built by hand
 * in the standard Helvetica, like the other PDF exports, so nothing has to
 * load; that means plain ASCII ("NGN", not the naira sign).
 */

export interface Statement {
  business: { name: string; merchantId: string }
  mode: 'live' | 'test'
  month: string
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
const M = 44
const ngn = (n: number | null | undefined) => (n == null ? '' : `NGN ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const day = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1')
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)

export function statementPdf(s: Statement): Blob {
  const pages: string[][] = [[]]
  let y = H - M
  const ops = () => pages[pages.length - 1]!
  const newPage = () => {
    pages.push([])
    y = H - M
  }
  const room = (need: number) => {
    if (y - need < M + 20) newPage()
  }
  const text = (x: number, size: number, str: string, bold = false, gray = false) =>
    ops().push(`BT ${gray ? '0.42 g ' : '0 g '}/${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${ascii(str)}) Tj ET`)
  const right = (xRight: number, size: number, str: string, bold = false) => text(xRight - ascii(str).length * size * 0.5, size, str, bold)
  const rule = (shade = 0.85) => ops().push(`${shade} G 0.6 w ${M} ${y.toFixed(1)} m ${W - M} ${y.toFixed(1)} l S`)

  // ─── Header ───
  text(M, 18, 'Monthly statement', true)
  y -= 20
  text(M, 11, `${s.business.name}, ${monthName(s.month)}${s.mode === 'test' ? ' (test mode)' : ''}`)
  y -= 13
  text(M, 8.5, `Merchant ID ${s.business.merchantId}. Times in Lagos time. Made ${day(s.generatedAt)} from Money Moves Business.`, false, true)
  y -= 26

  // ─── Summary ───
  const kv = (k: string, v: string, bold = false) => {
    room(16)
    text(M, 10, k, bold)
    right(W - M, 10, v, bold)
    y -= 16
  }
  text(M, 12, 'Summary', true)
  y -= 8
  rule()
  y -= 16
  kv(`Payments received (${s.totals.payments})`, ngn(s.totals.receivedNgn))
  kv('Our fees', ngn(-s.totals.feesNgn))
  kv('Yours after fees', ngn(s.totals.netNgn), true)
  y -= 6
  kv(`Refunds completed (${s.totals.refunds})`, ngn(s.totals.refundedNgn))
  kv('Fees we gave back on them', ngn(s.totals.feesReturnedNgn))
  kv('You sent for them', ngn(s.totals.refundsYouSentNgn))
  y -= 6
  const closed = s.totals.disputesClosed
  kv('Disputes opened', String(s.totals.disputesOpened))
  kv('Disputes closed', `${closed.won ?? 0} won, ${closed.refunded ?? 0} refunded, ${closed.lost ?? 0} lost`)
  y -= 14

  // ─── By method, and where it settled ───
  const table = (title: string, head: [string, number, 'l' | 'r'][], rows: string[][]) => {
    room(60)
    text(M, 12, title, true)
    y -= 8
    rule()
    y -= 14
    head.forEach(([h, x, a]) => (a === 'r' ? right(x, 8.5, h, true) : text(x, 8.5, h, true)))
    y -= 14
    if (!rows.length) {
      text(M, 9, 'Nothing this month.', false, true)
      y -= 14
    }
    for (const r of rows) {
      room(14)
      r.forEach((v, i) => {
        const [, x, a] = head[i]!
        if (a === 'r') right(x, 9, v)
        else text(x, 9, v)
      })
      y -= 14
    }
    y -= 12
  }
  table(
    'By how customers paid',
    [
      ['Method', M, 'l'],
      ['Payments', M + 250, 'r'],
      ['Received', M + 380, 'r'],
      ['Fees', W - M, 'r'],
    ],
    s.byMethod.map((x) => [x.method, String(x.count), ngn(x.receivedNgn), ngn(x.feesNgn)]),
  )
  table(
    'Settled this month',
    [
      ['To', M, 'l'],
      ['Settlements', M + 250, 'r'],
      ['Amount', W - M, 'r'],
    ],
    s.settledBy.map((x) => [x.to, String(x.count), ngn(x.amountNgn)]),
  )

  // ─── Every payment ───
  newPage()
  const list = (title: string, head: [string, number, 'l' | 'r', number][], rows: string[][]) => {
    text(M, 12, title, true)
    y -= 8
    rule()
    y -= 14
    const header = () => {
      head.forEach(([h, x, a]) => (a === 'r' ? right(x, 8, h, true) : text(x, 8, h, true)))
      y -= 13
    }
    header()
    if (!rows.length) {
      text(M, 9, 'None this month.', false, true)
      y -= 14
    }
    for (const r of rows) {
      if (y - 13 < M + 20) {
        newPage()
        header()
      }
      r.forEach((v, i) => {
        const [, x, a, chars] = head[i]!
        const t = cut(v, chars)
        if (a === 'r') right(x, 8, t)
        else text(x, 8, t)
      })
      y -= 13
    }
    y -= 14
  }
  list(
    `Payments (${s.payments.length})`,
    [
      ['Paid', M, 'l', 16],
      ['Reference', M + 80, 'l', 14],
      ['Customer', M + 160, 'l', 24],
      ['Method', M + 290, 'l', 16],
      ['Received', M + 445, 'r', 18],
      ['Fee', W - M, 'r', 14],
    ],
    s.payments.map((p) => [day(p.paidAt), p.ref, `${p.customer ?? ''}${p.partPaid ? ' (part paid)' : ''}`, p.method, ngn(p.receivedNgn), ngn(p.feeNgn)]),
  )
  room(80)
  list(
    `Settlements (${s.settlements.length})`,
    [
      ['Settled', M, 'l', 16],
      ['Reference', M + 80, 'l', 18],
      ['Payment', M + 185, 'l', 14],
      ['To', M + 265, 'l', 26],
      ['Amount', W - M, 'r', 26],
    ],
    s.settlements.map((x) => [day(x.settledAt), x.ref, x.payment, [x.to, x.detail].filter(Boolean).join(', '), x.amountUsdc != null ? `${x.amountUsdc.toFixed(2)} USDC` : ngn(x.amountNgn)]),
  )
  if (s.truncated) {
    room(16)
    text(M, 8.5, 'This month has more than 5,000 payments or settlements: the lists stop there. Export the full list as a CSV from Reports.', false, true)
  }

  // ─── Page numbers, then the file ───
  pages.forEach((p, i) => p.push(`BT 0.42 g /F1 8 Tf ${(W - M - 60).toFixed(1)} ${(M - 14).toFixed(1)} Td (Page ${i + 1} of ${pages.length}) Tj ET`))
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
