/**
 * Reading from the API, shared: every screen asking for the same path gets
 * the same answer, and they all change together when it's reloaded - the
 * sidebar, the page and the drawer never disagree.
 *
 * A path is read when something first needs it, again when the tab comes back
 * into focus, and on a timer for the lists that change by themselves
 * (payments arriving, settlements landing). After a change, `reload(prefix)`
 * reads every path that starts with it.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { ApiError, api } from './api'

interface Entry {
  data?: unknown
  error?: ApiError
  /** When it was last read. */
  at: number
  pending?: Promise<void>
}

const cache = new Map<string, Entry>()
const listeners = new Map<string, Set<() => void>>()
const EMPTY: Entry = { at: 0 }

function tell(path: string) {
  listeners.get(path)?.forEach((l) => l())
}

function read(path: string): Promise<void> {
  const e = cache.get(path) ?? { at: 0 }
  if (e.pending) return e.pending
  const next: Entry = { ...e }
  next.pending = api('GET', path)
    .then((data) => {
      cache.set(path, { data, at: Date.now() })
    })
    .catch((error: unknown) => {
      cache.set(path, { data: e.data, error: error instanceof ApiError ? error : new ApiError(0, 'Something went wrong.'), at: Date.now() })
    })
    .finally(() => tell(path))
  cache.set(path, next)
  return next.pending
}

/** Reads again every cached path that starts with `prefix` - after saving something, say. */
export function reload(prefix: string) {
  return Promise.all([...cache.keys()].filter((k) => k.startsWith(prefix)).map(read))
}

export function useApi<T>(path: string | null, opts: { every?: number } = {}) {
  const entry = useSyncExternalStore(
    (onChange) => {
      if (!path) return () => {}
      const set = listeners.get(path) ?? new Set()
      set.add(onChange)
      listeners.set(path, set)
      return () => set.delete(onChange)
    },
    () => (path ? (cache.get(path) ?? EMPTY) : EMPTY),
  )

  useEffect(() => {
    if (!path) return
    // A few seconds old is fresh enough to show without asking again.
    const e = cache.get(path)
    if (!e || Date.now() - e.at > 4_000) void read(path)
    const onFocus = () => void read(path)
    window.addEventListener('focus', onFocus)
    const timer = opts.every ? setInterval(() => document.visibilityState === 'visible' && void read(path), opts.every) : undefined
    return () => {
      window.removeEventListener('focus', onFocus)
      if (timer) clearInterval(timer)
    }
  }, [path, opts.every])

  return {
    data: entry.data as T | undefined,
    error: entry.error,
    /** Nothing to show yet: still on its way. */
    loading: !!path && entry.data === undefined && !entry.error,
    reload: () => (path ? read(path) : Promise.resolve()),
  }
}
