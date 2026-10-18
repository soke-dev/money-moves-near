/**
 * Payments out of the dashboard, for the business to keep: a CSV for a
 * spreadsheet, or a plain PDF table to file or print. Both are made here in
 * the browser from what the API sends - nothing extra is stored anywhere.
 */

export interface ExportRow {
  paidAt: string
  ref: string
  name: string | null
  email: string | null
  phone: string | null
  method: 'APP' | 'CRYPTO' | 'NAIRA'
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  receivedNgn: number | null
  status: string
}

const METHOD: Record<ExportRow['method'], string> = { APP: 'Money Moves app', CRYPTO: 'Crypto', NAIRA: 'Bank transfer' }

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' })

const columns = ['Date', 'Reference', 'Name', 'Email', 'Phone', 'Paid with', 'Amount (NGN)', 'Amount (USD)', 'Status'] as const

function cells(r: ExportRow): string[] {
  return [
    when(r.paidAt),
    r.ref,
    r.name ?? '',
    r.email ?? '',
    r.phone ?? '',
    METHOD[r.method] ?? r.method,
    (r.receivedNgn ?? r.amountNgn).toFixed(2),
    r.amountUsd.toFixed(2),
    r.status === 'PAID' ? 'Paid' : r.status === 'UNDERPAID' ? 'Part paid' : r.status,
  ]
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const fileName = (title: string, ext: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'payments'}-payments.${ext}`

/** A CSV a spreadsheet opens as it is - quoted where it has to be, and safe from formulas. */
export function downloadCsv(title: string, rows: ExportRow[]) {
  const quote = (v: string) => {
    // A cell starting with = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const text = [columns.join(','), ...rows.map((r) => cells(r).map(quote).join(','))].join('\r\n')
  save(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), fileName(title, 'csv'))
}

/**
 * A plain PDF table: the title, the totals, then the payments, as many pages
 * as it takes. Built by hand in the standard Helvetica, so it needs nothing
 * to load - which means plain ASCII ("NGN", not the naira sign).
 */
export function downloadPdf(title: string, business: string, rows: ExportRow[]) {
  const W = 842 // A4 landscape
  const H = 595
  const M = 36
  const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1')
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
  // Column x positions and widths in characters, to keep each column inside its lane.
  const lanes: [number, number][] = [
    [M, 18],
    [M + 108, 14],
    [M + 196, 22],
    [M + 330, 30],
    [M + 506, 15],
    [M + 594, 16],
    [M + 686, 12],
    [M + 754, 10],
  ]
  const totalNgn = rows.reduce((t, r) => t + (r.receivedNgn ?? r.amountNgn), 0)
  const totalUsd = rows.reduce((t, r) => t + r.amountUsd, 0)
  const head = ['Date', 'Reference', 'Name', 'Email', 'Paid with', 'Amount (NGN)', 'Amount (USD)', 'Status']
  const line = (r: ExportRow) => {
    const c = cells(r)
    return [c[0], c[1], c[2], c[3], c[5], c[6], c[7], c[8]]
  }

  const perPage = 26
  const pages: string[] = []
  const total = Math.max(1, Math.ceil(rows.length / perPage))
  for (let p = 0; p < total; p++) {
    const ops: string[] = []
    const text = (x: number, y: number, size: number, s: string, bold = false) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${ascii(s)}) Tj ET`)
    let y = H - M
    if (p === 0) {
      text(M, y, 16, title, true)
      y -= 18
      text(M, y, 10, `${business}: ${rows.length} payment${rows.length === 1 ? '' : 's'}, NGN ${totalNgn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (USD ${totalUsd.toFixed(2)})`)
      y -= 12
      text(M, y, 8, `Exported ${when(new Date().toISOString())} from Money Moves Business`)
      y -= 22
    }
    head.forEach((h, i) => text(lanes[i]![0], y, 8.5, h, true))
    y -= 6
    ops.push(`0.85 G ${M} ${y} m ${W - M} ${y} l S`)
    y -= 13
    for (const r of rows.slice(p * perPage, (p + 1) * perPage)) {
      line(r).forEach((v, i) => text(lanes[i]![0], y, 8.5, cut(v, lanes[i]![1])))
      y -= 17
    }
    text(W - M - 60, M - 12, 8, `Page ${p + 1} of ${total}`)
    pages.push(ops.join('\n'))
  }

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page and its contents for each page.
  const objs: string[] = []
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((content, i) => {
    const page = 5 + i * 2
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${page + 1} 0 R >>`
    objs[page + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
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
  save(new Blob([out], { type: 'application/pdf' }), fileName(title, 'pdf'))
}

/**
 * Any table as a plain PDF - a title, a line under it, then the rows, as many
 * pages as it takes. Columns share the width by the weights given.
 */
export function downloadTablePdf(o: { title: string; sub?: string; head: string[]; rows: (string | number)[][]; weights?: number[]; filename: string }) {
  const W = 842
  const H = 595
  const M = 36
  const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1')
  const weights = o.weights ?? o.head.map(() => 1)
  const sum = weights.reduce((a, b) => a + b, 0)
  const lanes: [number, number][] = []
  let x = M
  for (const w of weights) {
    const width = ((W - 2 * M) * w) / sum
    lanes.push([x, Math.max(4, Math.floor(width / 4.6))])
    x += width
  }
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
  const perPage = 26
  const total = Math.max(1, Math.ceil(o.rows.length / perPage))
  const pages: string[] = []
  for (let p = 0; p < total; p++) {
    const ops: string[] = []
    const text = (tx: number, ty: number, size: number, s: string, bold = false) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(1)} ${ty} Td (${ascii(s)}) Tj ET`)
    let y = H - M
    if (p === 0) {
      text(M, y, 16, o.title, true)
      y -= 16
      if (o.sub) {
        text(M, y, 9, o.sub)
        y -= 12
      }
      text(M, y, 8, `Exported ${when(new Date().toISOString())} from Money Moves Business`)
      y -= 22
    }
    o.head.forEach((h, i) => text(lanes[i]![0], y, 8.5, h, true))
    y -= 6
    ops.push(`0.85 G ${M} ${y} m ${W - M} ${y} l S`)
    y -= 13
    for (const r of o.rows.slice(p * perPage, (p + 1) * perPage)) {
      r.forEach((v, i) => lanes[i] && text(lanes[i]![0], y, 8.5, cut(String(v ?? ''), lanes[i]![1])))
      y -= 17
    }
    text(W - M - 60, M - 12, 8, `Page ${p + 1} of ${total}`)
    pages.push(ops.join('\n'))
  }
  const objs: string[] = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((content, i) => {
    const page = 5 + i * 2
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${page + 1} 0 R >>`
    objs[page + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let n = 1; n < objs.length; n++) {
    offsets[n] = out.length
    out += `${n} 0 obj\n${objs[n]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((v) => `${String(v).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  save(new Blob([out], { type: 'application/pdf' }), o.filename)
}
