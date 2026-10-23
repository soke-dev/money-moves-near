/**
 * The app side's own crypto: each treasury, gas payer, voucher wallet and
 * address people send to when they sell, with what it holds on every chain,
 * read live from the chains. The same idea as Business, Crypto: is anything
 * about to run dry, and is each wallet where we think it is. After a key is
 * replaced, this is where the new address shows.
 *
 * Read-only: nothing here sends.
 */
import { useCallback, useEffect, useState } from 'react'
import { C } from './ui'
import { Button, Copy, Notice, Panel, Tag, When } from './business/kit'

const API = import.meta.env.VITE_API_URL || ''

type Holding = { chain: string; asset: string; amount: number | null }
type Wallet = {
  id: string
  group: 'treasury' | 'gas' | 'vouchers' | 'sell'
  name: string
  does: string
  address: string | null
  missing: string | null
  holdings: Holding[]
}

const GROUPS: { id: Wallet['group']; title: string; sub: string }[] = [
  { id: 'treasury', title: 'Treasuries', sub: 'Where the app pays crypto out from. Keep USDC and USDT here, and each chain’s own coin for fees.' },
  { id: 'gas', title: 'Gas', sub: 'Pays network fees, so people can send without holding each chain’s coin.' },
  { id: 'vouchers', title: 'Vouchers', sub: 'Voucher rewards, and money held in vouchers until it’s claimed.' },
  { id: 'sell', title: 'Where people send to sell', sub: 'Crypto people sell to a bank arrives here.' },
]

/** The coin each chain charges fees in: none of it, and that wallet can't send there. */
const GAS_COINS = new Set(['ETH', 'BNB', 'MON', 'SOL', 'MOVE', 'XLM', 'TON'])
/** Stellar keeps a reserve, and opening an account for someone costs some too. */
const LOW_XLM = 5

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1 ? 2 : 6 })

/** What needs a person on one wallet: no key, a fee coin at nothing, or Stellar running low. */
function warnings(w: Wallet): string[] {
  if (w.missing) return [w.missing]
  if (w.group === 'sell' || w.group === 'vouchers') return []
  const out: string[] = []
  for (const h of w.holdings) {
    if (!GAS_COINS.has(h.asset) || h.amount == null) continue
    if (h.amount === 0) out.push(`No ${h.asset} on ${h.chain}`)
    else if (h.asset === 'XLM' && h.amount < LOW_XLM) out.push(`Low XLM (${fmt(h.amount)})`)
  }
  return out
}

export function PersonalCrypto() {
  const [wallets, setWallets] = useState<Wallet[] | null>(null)
  const [readAt, setReadAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (fresh = false) => {
    setBusy(true)
    setError('')
    try {
      const token = localStorage.getItem('mm_admin_token')
      const res = await fetch(`${API}/api/admin/crypto/wallets${fresh ? '?fresh=1' : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(res.status === 404 ? 'The API doesn’t have this page yet. It arrives with the next deploy.' : `Couldn’t read the wallets (${res.status}).`)
      const d = (await res.json()) as { wallets: Wallet[]; readAt: string }
      setWallets(d.wallets)
      setReadAt(d.readAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read the wallets.')
    } finally {
      setBusy(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const attention = (wallets ?? []).flatMap((w) => warnings(w).map((x) => `${w.name}: ${x}`))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px]" style={{ color: C.muted }}>
          What each of our wallets holds, read live from the chains{readAt ? <>, <When at={readAt} /></> : null}.
        </p>
        <Button small onClick={() => void load(true)} disabled={busy}>
          {busy ? 'Reading…' : 'Read again'}
        </Button>
      </div>

      {error && <Notice tone="bad" title={error} />}
      {attention.length > 0 && (
        <Notice tone="warn" title={attention.length === 1 ? 'One wallet needs a look' : `${attention.length} things need a look`}>
          <ul className="mt-1 space-y-0.5">
            {attention.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Notice>
      )}

      {!wallets && !error ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl" style={{ background: C.lineSoft }} />
          ))}
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = (wallets ?? []).filter((w) => w.group === g.id)
          if (!list.length) return null
          return (
            <Panel key={g.id} title={g.title} sub={g.sub} flush>
              <div>
                {list.map((w, i) => (
                  <WalletRow key={w.id} w={w} first={i === 0} />
                ))}
              </div>
            </Panel>
          )
        })
      )}
    </div>
  )
}

function WalletRow({ w, first }: { w: Wallet; first: boolean }) {
  const warn = warnings(w)
  // Every fee coin shows, empty or not: an empty one is the thing to see. Tokens only when there's some.
  const shown = w.holdings.filter((h) => h.amount == null || h.amount > 0 || GAS_COINS.has(h.asset))
  return (
    <div className="px-4 py-3.5" style={{ borderTop: first ? undefined : `1px solid ${C.lineSoft}` }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold" style={{ color: C.text }}>{w.name}</span>
            {warn.length > 0 && <Tag tone="warn">{warn.length === 1 ? 'Needs a look' : `${warn.length} to look at`}</Tag>}
          </div>
          <div className="mt-0.5 text-[12.5px]" style={{ color: C.muted }}>{w.does}</div>
        </div>
        <div className="text-[12.5px]">
          {w.address ? <Copy text={w.address}>{short(w.address)}</Copy> : <span style={{ color: C.amber }}>{w.missing}</span>}
        </div>
      </div>
      {w.address && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {shown.length === 0 ? (
            <span className="text-[12.5px]" style={{ color: C.dim }}>Empty on every chain it uses.</span>
          ) : (
            shown.map((h) => {
              const empty = h.amount === 0 && GAS_COINS.has(h.asset) && w.group !== 'sell' && w.group !== 'vouchers'
              const low = h.asset === 'XLM' && h.amount != null && h.amount > 0 && h.amount < LOW_XLM
              return (
                <span
                  key={`${h.asset}-${h.chain}`}
                  className="inline-flex items-baseline gap-1 rounded-md px-2 py-1 text-[12.5px] tabular-nums"
                  style={{ border: `1px solid ${empty || low ? C.amber : C.line}`, color: C.text }}
                >
                  <span className="font-medium">{h.amount == null ? 'Unreadable' : fmt(h.amount)}</span>
                  <span>{h.asset}</span>
                  <span style={{ color: C.dim }}>{h.chain}</span>
                </span>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
