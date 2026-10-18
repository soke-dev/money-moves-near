/**
 * Which coins, on which networks, a business takes as crypto deposits.
 *
 * Everything is on by default. The business can narrow it for the whole
 * account (Settings → Payment methods), and again on any one payment link,
 * invoice or outlet - the checkout then offers only those. An API checkout
 * can pass its own list too.
 */
import { ACCEPTED, type Asset, type Chain, type Method } from '@/data/mock'
import { createStore } from './store'

export type Accept = Partial<Record<Asset, Chain[]>>

export const ALL_ACCEPT: Accept = Object.fromEntries(ACCEPTED.map((a) => [a.asset, [...a.chains]]))

export const acceptStore = createStore<Accept>('mmb_accept_v1', () => ALL_ACCEPT)

export const useAccept = (businessId: string | undefined) => acceptStore.use(businessId)

/** Which ways to pay a business offers by default - all three until it says otherwise. */
export const methodsStore = createStore<Method[]>('mmb_methods_v1', () => ['app', 'crypto', 'naira'])

export const useMethods = (businessId: string | undefined) => methodsStore.use(businessId)

/** How many coin-and-network pairs are switched on. */
export const acceptCount = (a: Accept) => ACCEPTED.reduce((n, x) => n + (a[x.asset]?.length ?? 0), 0)

export const acceptsAll = (a: Accept) => ACCEPTED.every((x) => (a[x.asset]?.length ?? 0) === x.chains.length)

/** "All coins and networks", or "USDC on 2 networks · USDT on TON". */
export function acceptSummary(a: Accept) {
  if (acceptsAll(a)) return 'All coins and networks'
  const parts = ACCEPTED.filter((x) => (a[x.asset]?.length ?? 0) > 0).map((x) => {
    const on = a[x.asset]!
    return on.length === x.chains.length ? `${x.asset} on every network` : on.length === 1 ? `${x.asset} on ${on[0]}` : `${x.asset} on ${on.length} networks`
  })
  return parts.length ? parts.join(' · ') : 'No crypto'
}
