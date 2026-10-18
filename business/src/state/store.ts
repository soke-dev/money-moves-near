/**
 * A value kept per business, in this browser, shared by every screen that
 * reads it - so the banner, the sidebar and the page all change together.
 *
 * The preview keeps its samples here; live screens read the API, with a few
 * per-browser choices (like saved crypto wallets) kept here too.
 */
import { useSyncExternalStore } from 'react'

export function createStore<T>(key: string, seed: (businessId: string) => T) {
  const listeners = new Set<() => void>()
  // useSyncExternalStore needs the same object back until it changes.
  const cache = new Map<string, T>()

  const read = (id: string): T => {
    const hit = cache.get(id)
    if (hit !== undefined) return hit
    let v: T
    try {
      const raw = localStorage.getItem(`${key}:${id}`)
      v = raw ? (JSON.parse(raw) as T) : seed(id)
    } catch {
      v = seed(id)
    }
    cache.set(id, v)
    return v
  }

  const write = (id: string, v: T) => {
    cache.set(id, v)
    try {
      localStorage.setItem(`${key}:${id}`, JSON.stringify(v))
    } catch {
      /* private window or blocked storage: it lasts until the tab closes */
    }
    listeners.forEach((l) => l())
  }

  const clear = (id: string) => {
    cache.delete(id)
    try {
      localStorage.removeItem(`${key}:${id}`)
    } catch {
      /* nothing stored to remove */
    }
    listeners.forEach((l) => l())
  }

  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }

  function use(id: string | undefined) {
    const value = useSyncExternalStore(subscribe, () => (id ? read(id) : undefined))
    const update = (next: T | ((prev: T) => T)) => {
      if (!id) return
      write(id, typeof next === 'function' ? (next as (prev: T) => T)(read(id)) : next)
    }
    return [value, update] as const
  }

  return { use, read, write, clear }
}
