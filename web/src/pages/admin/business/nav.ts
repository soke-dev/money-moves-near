/**
 * Records - a business, a settlement, a payment, an application - are pages
 * with their own address (?business=…&tab=…), not windows over a list. Back
 * goes back, a refresh stays put, and a link to one can be pasted to someone.
 *
 * The list underneath stays mounted while a record is open, so coming back
 * finds it as it was left: same filters, same page, same place on the page.
 */
import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export const RECORDS = ['business', 'settlement', 'payment', 'application', 'refund', 'dispute'] as const
export type RecordKind = (typeof RECORDS)[number]
export type OpenRecord = { kind: RecordKind; id: string }

export function readRecord(params: URLSearchParams): OpenRecord | null {
  for (const kind of RECORDS) {
    const id = params.get(kind)
    if (id) return { kind, id }
  }
  return null
}

/** Where on the page each history entry was left. */
const scrolls = new Map<string, number>()
export const scrollFor = (key: string) => scrolls.get(key)

export function useRecord() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()

  const open = useCallback(
    (kind: RecordKind, id: string, opts?: { tab?: string; from?: string }) => {
      scrolls.set(location.key, window.scrollY)
      const next = new URLSearchParams({ [kind]: id })
      if (opts?.tab) next.set('tab', opts.tab)
      navigate({ search: `?${next}` }, { state: { from: opts?.from ?? null } })
      window.scrollTo({ top: 0 })
    },
    [navigate, location.key],
  )

  /** Back to wherever this record was opened from - or, from a pasted link, to the list. */
  const back = useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate({ search: '' }, { replace: true })
  }, [navigate])

  /** Changes what the record page shows (its tab, a filter) without adding a history entry for it. */
  const setView = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(location.search)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') next.delete(k)
        else next.set(k, v)
      }
      navigate({ search: `?${next}` }, { replace: true, state: location.state })
    },
    [navigate, location.search, location.state],
  )

  return {
    current: readRecord(params),
    params,
    open,
    back,
    setView,
    from: (location.state as { from?: string | null } | null)?.from ?? null,
  }
}
