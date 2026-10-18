/** A table as a CSV file, downloaded - what the business sees on screen, nothing more. */
export function downloadCsv(name: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [head, ...rows].map((r) => r.map(cell).join(',')).join('\n')
  // The byte-order mark makes Excel read naira signs and names correctly.
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Today, for a file name: 2026-10-11. */
export const today = () => new Date().toISOString().slice(0, 10)
