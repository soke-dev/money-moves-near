/**
 * How a business's checkout looks to its customers: its logo, a surface
 * colour for the order summary, an accent for the pay button, and a line to
 * say after a payment. The Money Moves "secured by" mark always stays.
 */
import { useEffect } from 'react'
import { createStore } from './store'
import { LIVE, api, type ApiBrand } from '@/lib/api'

export interface Branding {
  /** Live: the logo's address on our side. In preview, a data URL kept in this browser. */
  logo: string | null
  surface: string
  accent: string
  success: string
}

export const DEFAULT_BRANDING: Branding = { logo: null, surface: '#F5F4F0', accent: '#121210', success: '' }

export const PALETTES: { name: string; surface: string; accent: string }[] = [
  { name: 'Ink', surface: '#F5F4F0', accent: '#121210' },
  { name: 'Forest', surface: '#E8F0EA', accent: '#143021' },
  { name: 'Leaf', surface: '#EFF7E3', accent: '#2B6A00' },
  { name: 'Ocean', surface: '#E8EFF8', accent: '#1D4ED8' },
  { name: 'Clay', surface: '#F7ECE4', accent: '#B4532A' },
  { name: 'Plum', surface: '#F1EBF6', accent: '#6D28D9' },
]

export const brandingStore = createStore<Branding>('mmb_branding_v1', () => DEFAULT_BRANDING)

export const useBranding = (businessId: string | undefined) => brandingStore.use(businessId)

/** Live: reads the business's saved look from our side, so every screen shows what customers see. */
export function useBrandingSync(businessId: string | undefined) {
  useEffect(() => {
    if (!LIVE || !businessId) return
    let gone = false
    api<{ brand: ApiBrand }>('GET', `/businesses/${businessId}/branding`)
      .then((r) => !gone && brandingStore.write(businessId, r.brand))
      .catch(() => {})
    return () => {
      gone = true
    }
  }, [businessId])
}

export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s)

/** Black or white, whichever reads better on the colour - so any accent stays legible. */
export function onColor(hex: string): string {
  if (!isHex(hex)) return '#FFFFFF'
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  return lum > 0.45 ? '#121210' : '#FFFFFF'
}
