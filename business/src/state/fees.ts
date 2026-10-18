/**
 * The fees a business pays, as our team set them in admin - the platform's
 * rates, with this business's own naira rate when it has one. Preview shows
 * the sample pricing.
 */
import { useSession } from './session'
import { LIVE } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { PRICING } from '@/data/mock'

export interface Fees {
  naira: { rate: number; capNgn: number }
  crypto: { rate: number; capUsd: number }
  app: { rate: number }
  payoutNgn: number
}

type ApiFees = { fees: { naira: { rateBps: number; capNgn: number }; crypto: { rateBps: number; capUsd: number }; app: { rateBps: number }; payoutNgn: number } }

export function useFees(): Fees {
  const { business } = useSession()
  const r = useApi<ApiFees>(LIVE && business ? `/businesses/${business.id}/fees` : null)
  const f = r.data?.fees
  if (!f) return { naira: { ...PRICING.naira }, crypto: { ...PRICING.crypto }, app: { ...PRICING.app }, payoutNgn: PRICING.payoutNgn }
  return {
    naira: { rate: f.naira.rateBps / 10_000, capNgn: f.naira.capNgn },
    crypto: { rate: f.crypto.rateBps / 10_000, capUsd: f.crypto.capUsd },
    app: { rate: f.app.rateBps / 10_000 },
    payoutNgn: f.payoutNgn,
  }
}

const cents = (n: number) => Math.round(n * 100) / 100
export const pct = (rate: number) => `${+(rate * 100).toFixed(2)}%`

/** The fee on an amount, by how it's paid - in naira for a naira transfer, in dollars otherwise. */
export function feeOn(fees: Fees, method: 'naira' | 'crypto' | 'app', amount: number): number {
  if (method === 'naira') return Math.min(cents(amount * fees.naira.rate), fees.naira.capNgn)
  if (method === 'app') return cents(amount * fees.app.rate)
  return Math.min(cents(amount * fees.crypto.rate), fees.crypto.capUsd)
}
