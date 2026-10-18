/** Dollars, to the cent. Stablecoins are counted as the dollar they track. */
export const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const ngn = (n: number) =>
  `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A crypto amount, as many decimals as it needs and no more than six. */
export const amount = (n: number, asset: string) =>
  `${n.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${asset}`

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 7_200) return 'an hour ago'
  if (s < 86_400) return `${Math.floor(s / 3600)} hours ago`
  if (s < 172_800) return 'a day ago'
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} days ago`
  return date(iso)
}

export const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

export const short = (s: string, head = 6, tail = 4) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export function copy(text: string) {
  try {
    void navigator.clipboard?.writeText(text)
  } catch {
    /* nothing to do: the value is on screen to copy by hand */
  }
}
