/**
 * Swaps, and the two deposits that arrive as USDC on Solana (Bitcoin and USDT
 * on Tron): the levers, and what has happened lately.
 *
 * Every value is read by the API on each request, so a change here takes
 * effect within seconds and needs no deploy. The API refuses anything outside
 * its limits, so a typo cannot set a 90% fee.
 */
import { useCallback, useEffect, useState } from 'react'
import { C, MONO } from './ui'
import { Button, Field, Input, Notice, Panel, Segmented, Tag, When } from './business/kit'

const API = import.meta.env.VITE_API_URL || ''

type DepositState = 'visible' | 'unavailable' | 'hidden'
type Settings = {
  /** Each network that converts to USDC on Solana. rail: which converter carries it (Bitcoin and Tron are always Aurora). */
  deposits: Partial<Record<DepKind, { state: DepositState; minUsd: number; rail?: 'aurora' | 'stableyard' }>>
  swap: {
    enabled: boolean
    feeBps: number
    solanaFlatUsd: number
    minUsd: number
    slippageBps: number
    perDay: number
    sweepMaxUsd?: number
    maxUsd?: number
    provider?: 'oneclick' | 'aurora'
    /** Swaps out of Movement through our own wallets. Off: only swaps NEAR Intents quotes run. */
    movementRoute?: boolean
  }
}
type Wiring = {
  providers?: { oneclick: boolean; aurora: boolean }
  movementRoute?: { configured: boolean; movementAddress: string | null; baseAddress: string | null; baseUsdc: number | null }
}
type RecentSwap = {
  id: string
  user: string
  status: string
  swapStatus: string | null
  from: string | null
  to: string | null
  fee: { amount: number; symbol: string; collected: boolean; error: string | null } | null
  originTxHash: string | null
  createdAt: string
}

type DepKind = 'btc' | 'tron' | 'eth' | 'bsc' | 'sol' | 'arb' | 'pol'
const DEPOSITS: { key: DepKind; name: string; coins: string; railChoice: boolean }[] = [
  { key: 'btc', name: 'Bitcoin', coins: 'BTC', railChoice: false },
  { key: 'tron', name: 'Tron', coins: 'USDT', railChoice: false },
  { key: 'eth', name: 'Ethereum', coins: 'USDC, USDT, ETH', railChoice: true },
  { key: 'bsc', name: 'BNB Chain', coins: 'BNB', railChoice: true },
  { key: 'sol', name: 'Solana', coins: 'SOL', railChoice: true },
  { key: 'arb', name: 'Arbitrum', coins: 'USDC, USDT, ETH', railChoice: true },
  { key: 'pol', name: 'Polygon', coins: 'USDC, USDT, POL', railChoice: true },
]

const RAILS = [
  ['aurora', 'Aurora'],
  ['stableyard', 'Stableyard'],
] as const

const STATES = [
  ['visible', 'On'],
  ['unavailable', 'Paused'],
  ['hidden', 'Hidden'],
] as const

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } }
}

export function SwapSettings() {
  const [configured, setConfigured] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState({ fee: '', solFlat: '', min: '', max: '', slippage: '', perDay: '', sweepMax: '' })
  // Each network's smallest deposit, as typed.
  const [mins, setMins] = useState<Partial<Record<DepKind, string>>>({})
  const [wiring, setWiring] = useState<Wiring>({})
  const [recent, setRecent] = useState<RecentSwap[] | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)

  const take = (s: Settings) => {
    setSettings(s)
    setDraft({
      fee: String(s.swap.feeBps / 100),
      solFlat: String(s.swap.solanaFlatUsd),
      min: String(s.swap.minUsd),
      max: s.swap.maxUsd == null ? '' : String(s.swap.maxUsd),
      slippage: String(s.swap.slippageBps / 100),
      perDay: String(s.swap.perDay),
      // Absent until the API that knows about it is deployed.
      sweepMax: s.swap.sweepMaxUsd == null ? '' : String(s.swap.sweepMaxUsd),
    })
    setMins(Object.fromEntries(DEPOSITS.filter((d) => s.deposits[d.key]).map((d) => [d.key, String(s.deposits[d.key]!.minUsd)])))
  }

  const load = useCallback(async () => {
    setError('')
    try {
      const [a, b] = await Promise.all([
        fetch(`${API}/api/admin/swap/settings`, authed()),
        fetch(`${API}/api/admin/swap/recent`, authed()),
      ])
      if (!a.ok) throw new Error(a.status === 404 ? 'The API doesn’t have this page yet. It arrives with the next deploy.' : `Couldn’t read the settings (${a.status}).`)
      const d = await a.json()
      setConfigured(!!d.configured)
      setWiring({ providers: d.providers, movementRoute: d.movementRoute })
      take(d.settings)
      if (b.ok) setRecent((await b.json()).swaps)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read the settings.')
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const save = async (patch: unknown, label: string) => {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      const r = await fetch(`${API}/api/admin/swap/settings`, authed({ method: 'PUT', body: JSON.stringify(patch) }))
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Couldn’t save (${r.status}).`)
      if (d.providers) setWiring({ providers: d.providers, movementRoute: d.movementRoute })
      take(d.settings)
      setSaved(label)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save.')
    } finally {
      setBusy(false)
    }
  }

  const saveSwap = () =>
    save(
      {
        swap: {
          feeBps: Math.round(Number(draft.fee) * 100),
          solanaFlatUsd: Number(draft.solFlat),
          minUsd: Number(draft.min),
          ...(draft.max.trim() ? { maxUsd: Number(draft.max) } : {}),
          slippageBps: Math.round(Number(draft.slippage) * 100),
          perDay: Math.round(Number(draft.perDay)),
          ...(draft.sweepMax.trim() ? { sweepMaxUsd: Number(draft.sweepMax) } : {}),
        },
      },
      'Swap settings saved',
    )

  return (
    <div className="space-y-5">
      {!configured && (
        <Notice tone="warn" title="Swaps and Bitcoin / Tron deposits are off">
          The server has no key for this service yet. Bitcoin and Tron deposits stay on the old route until it is set.
        </Notice>
      )}
      {error && <Notice tone="bad" title={error} />}
      {saved && <Notice tone="good" title={saved} />}

      {settings && (
        <>
          <Panel
            title="Swaps"
            sub="Any coin to any chain, into the person’s own wallet. The fee comes out of what they send."
            action={
              <Segmented
                value={settings.swap.enabled ? 'on' : 'off'}
                onChange={(v) => save({ swap: { enabled: v === 'on' } }, v === 'on' ? 'Swaps are on' : 'Swaps are paused')}
                items={[
                  ['on', 'On'],
                  ['off', 'Paused'],
                ]}
              />
            }
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Platform fee (%)" hint="Of what is sent. 1 means 1%.">
                <Input inputMode="decimal" value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} />
              </Field>
              <Field label="Extra fee from Solana ($)" hint="Added to swaps paid from Solana, on top of the percentage.">
                <Input inputMode="decimal" value={draft.solFlat} onChange={(e) => setDraft({ ...draft, solFlat: e.target.value })} />
              </Field>
              <Field label="Smallest swap ($)">
                <Input inputMode="decimal" value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} />
              </Field>
              <Field label="Largest swap ($)" hint="Per swap, on every chain and coin.">
                <Input inputMode="decimal" value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} />
              </Field>
              <Field label="Price protection (%)" hint="How far the price may move before it refunds.">
                <Input inputMode="decimal" value={draft.slippage} onChange={(e) => setDraft({ ...draft, slippage: e.target.value })} />
              </Field>
              <Field label="Swaps per person per day">
                <Input inputMode="numeric" value={draft.perDay} onChange={(e) => setDraft({ ...draft, perDay: e.target.value })} />
              </Field>
              <Field label="Largest balance Sweep takes ($)" hint="Balances up to this go to Sweep. Swap takes anything from the smallest swap up.">
                <Input inputMode="decimal" value={draft.sweepMax} onChange={(e) => setDraft({ ...draft, sweepMax: e.target.value })} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button tone="primary" onClick={saveSwap} disabled={busy}>
                Save swap settings
              </Button>
            </div>
          </Panel>

          {settings.swap.provider && (
            <Panel
              title="Who quotes swaps"
              sub="Switching takes effect on the next quote. A swap already under way finishes with the one that quoted it. Bitcoin and Tron deposits stay on Aurora either way."
              action={
                <Segmented
                  value={settings.swap.provider}
                  onChange={(v) => save({ swap: { provider: v } }, v === 'oneclick' ? 'Swaps now quote on 1Click' : 'Swaps now quote on Aurora')}
                  items={[
                    ['oneclick', '1Click'],
                    ['aurora', 'Aurora'],
                  ]}
                />
              }
            >
              <div className="text-[13px]" style={{ color: C.muted }}>
                {wiring.providers
                  ? `Keys set: 1Click ${wiring.providers.oneclick ? 'yes' : 'no'}, Aurora ${wiring.providers.aurora ? 'yes' : 'no'}. If the chosen one has no key, swaps use the other.`
                  : ' '}
              </div>
            </Panel>
          )}

          {wiring.movementRoute && (
            <Panel
              title="Swaps out of Movement"
              sub="USDCx is received in the Movement wallet, and the Base wallet pays out USDC or funds the onward swap. When the Base wallet cannot cover a swap, the app says it is not available right now. Off: Movement isn't offered as a coin to swap from, and only the swaps NEAR Intents quotes and settles run. A swap already under way still finishes."
              action={
                <Segmented
                  value={settings.swap.movementRoute === false ? 'off' : 'on'}
                  onChange={(v) => save({ swap: { movementRoute: v === 'on' } }, v === 'on' ? 'Swaps out of Movement are on' : 'Swaps out of Movement are off')}
                  items={[
                    ['on', 'On'],
                    ['off', 'Off'],
                  ]}
                />
              }
            >
              {wiring.movementRoute.configured ? (
                <div className="grid gap-3 text-[13px] md:grid-cols-3">
                  <div>
                    <div style={{ color: C.muted }}>Receives USDCx (Movement)</div>
                    <div className="break-all" style={{ fontFamily: MONO }}>{wiring.movementRoute.movementAddress}</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted }}>Pays out (Base)</div>
                    <div className="break-all" style={{ fontFamily: MONO }}>{wiring.movementRoute.baseAddress}</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted }}>Base wallet USDC</div>
                    <div style={{ fontFamily: MONO }}>{wiring.movementRoute.baseUsdc == null ? 'Could not read' : wiring.movementRoute.baseUsdc.toFixed(2)}</div>
                  </div>
                </div>
              ) : (
                <div className="text-[13px]" style={{ color: C.muted }}>
                  Off until SWAP_MOVEMENT_ADDRESS and SWAP_EVM_PRIVATE_KEY are both set on the backend. Movement stays out of the app until then.
                </div>
              )}
            </Panel>
          )}

          <Panel
            title="Converted deposits"
            sub="Coins sent from other wallets, converted on arrival. Aurora: a permanent address that lands as USDC in the person's Solana wallet. Stableyard: the older addresses, landing as USDCx on Movement. Paused keeps the row in the app, named and greyed out. Hidden removes it. Which coins show on a network follows the Converted tab, whichever converter carries it. Old Stableyard addresses still credit anything sent to them."
            flush
          >
            <div>
              {DEPOSITS.filter((d) => settings.deposits[d.key]).map((d, i) => {
                const cur = settings.deposits[d.key]!
                const rail = cur.rail ?? 'aurora'
                return (
                  <div
                    key={d.key}
                    className="flex flex-wrap items-end justify-between gap-4 px-4 py-4"
                    style={{ borderTop: i === 0 ? undefined : `1px solid ${C.lineSoft}` }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold" style={{ color: C.text }}>
                          {d.name}
                        </span>
                        <span className="text-[12px]" style={{ color: C.muted }}>
                          {d.coins}
                        </span>
                        <Tag tone={cur.state === 'visible' ? 'good' : cur.state === 'unavailable' ? 'warn' : 'idle'}>
                          {cur.state === 'visible' ? 'On' : cur.state === 'unavailable' ? 'Paused' : 'Hidden'}
                        </Tag>
                        <Tag tone="idle">{rail === 'aurora' ? 'Aurora, USDC on Solana' : 'Stableyard, USDCx on Movement'}</Tag>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Segmented
                          value={cur.state}
                          onChange={(v) => save({ deposits: { [d.key]: { state: v } } }, `${d.name} deposits: ${STATES.find((s) => s[0] === v)?.[1]}`)}
                          items={STATES}
                        />
                        {d.railChoice && (
                          <Segmented
                            value={rail}
                            onChange={(v) => save({ deposits: { [d.key]: { rail: v } } }, `${d.name} deposits now go through ${v === 'aurora' ? 'Aurora' : 'Stableyard'}`)}
                            items={RAILS}
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <Field label="Smallest deposit ($)">
                        <Input
                          fit
                          inputMode="decimal"
                          value={mins[d.key] ?? ''}
                          onChange={(e) => setMins({ ...mins, [d.key]: e.target.value })}
                        />
                      </Field>
                      <Button small onClick={() => save({ deposits: { [d.key]: { minUsd: Number(mins[d.key]) } } }, `${d.name} minimum saved`)} disabled={busy || rail !== 'aurora'}>
                        Save
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel title="Recent swaps" sub="The latest fifty, newest first." flush>
            {!recent?.length ? (
              <div className="px-4 py-5 text-[13px]" style={{ color: C.muted }}>
                No swaps yet.
              </div>
            ) : (
              <div>
                {recent.map((r, i) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                    style={{ borderTop: i === 0 ? undefined : `1px solid ${C.lineSoft}` }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium" style={{ color: C.text }}>
                        {r.from} <span style={{ color: C.dim }}>to</span> {r.to}
                      </div>
                      <div className="mt-0.5 text-[12px]" style={{ color: C.muted }}>
                        {r.user} · <When at={r.createdAt} />
                        {r.originTxHash && (
                          <span style={{ fontFamily: MONO, color: C.dim }}> · {r.originTxHash.slice(0, 10)}…</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.fee && (
                        <Tag tone={r.fee.collected ? 'good' : r.fee.amount > 0 ? 'warn' : 'idle'}>
                          {r.fee.collected ? `Fee ${r.fee.amount} ${r.fee.symbol}` : r.fee.amount > 0 ? 'Fee not collected' : 'No fee'}
                        </Tag>
                      )}
                      <Tag tone={r.status === 'COMPLETED' ? 'good' : r.status === 'PROCESSING' || r.status === 'PENDING' ? 'info' : r.status === 'REFUNDED' ? 'warn' : 'bad'}>
                        {r.status === 'COMPLETED' ? 'Done' : r.status === 'PROCESSING' ? 'Swapping' : r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                      </Tag>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}
