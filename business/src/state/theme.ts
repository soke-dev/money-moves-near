import { useEffect, useState } from 'react'

/**
 * Light or dark, for the dashboard only.
 *
 * Remembered in this browser. The page root carries `data-theme="dark"` only
 * while the dashboard is on screen: the customer's checkout, receipts and the
 * sign-in pages open in the same app and stay light whatever this says.
 */
export type Theme = 'light' | 'dark'

const KEY = 'mmb_theme'
const listeners = new Set<(t: Theme) => void>()

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored)
  useEffect(() => {
    listeners.add(setTheme)
    return () => {
      listeners.delete(setTheme)
    }
  }, [])
  const set = (t: Theme) => {
    try {
      localStorage.setItem(KEY, t)
    } catch {
      // Not remembered, but it still switches for now.
    }
    listeners.forEach((l) => l(t))
  }
  return [theme, set]
}

/** Puts the dashboard's theme on the page while it's mounted, and takes it off when it isn't. */
export function useApplyTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    return () => {
      delete root.dataset.theme
    }
  }, [theme])
}
