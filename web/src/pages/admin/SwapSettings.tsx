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
  deposits: Record<'btc' | 'tron', { state: DepositState; minUsd: number }>
  swap: { enabled: boolean; feeBps: number; solanaFlatUsd: number; minUsd: number; slippageBps: number; perDay: number; sweepMaxUsd?: number }
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

const DEPOSITS: { key: 'btc' | 'tron'; name: string }[] = [
  { key: 'btc', name: 'Bitcoin' },
  { key: 'tron', name: 'USDT on Tron' },
]

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
  const [draft, setDraft] = useState({ fee: '', solFlat: '', min: '', slippage: '', perDay: '', sweepMax: '', btcMin: '', tronMin: '' })
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
      slippage: String(s.swap.slippageBps / 100),
      perDay: String(s.swap.perDay),
      // Absent until the API that knows about it is deployed.
      sweepMax: s.swap.sweepMaxUsd == null ? '' : String(s.swap.sweepMaxUsd),
      btcMin: String(s.deposits.btc.minUsd),
      tronMin: String(s.deposits.tron.minUsd),
    })
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

          <Panel title="Deposits that arrive as USDC on Solana" sub="Paused keeps the row in the app, named and greyed out. Hidden removes it." flush>
            <div>
              {DEPOSITS.map((d, i) => {
                const cur = settings.deposits[d.key]
                const minKey = d.key === 'btc' ? 'btcMin' : 'tronMin'
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
                        <Tag tone={cur.state === 'visible' ? 'good' : cur.state === 'unavailable' ? 'warn' : 'idle'}>
                          {cur.state === 'visible' ? 'On' : cur.state === 'unavailable' ? 'Paused' : 'Hidden'}
                        </Tag>
                      </div>
                      <div className="mt-2">
                        <Segmented
                          value={cur.state}
                          onChange={(v) => save({ deposits: { [d.key]: { state: v } } }, `${d.name} deposits: ${STATES.find((s) => s[0] === v)?.[1]}`)}
                          items={STATES}
                        />
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <Field label="Smallest deposit ($)">
                        <Input
                          fit
                          inputMode="decimal"
                          value={draft[minKey]}
                          onChange={(e) => setDraft({ ...draft, [minKey]: e.target.value })}
                        />
                      </Field>
                      <Button small onClick={() => save({ deposits: { [d.key]: { minUsd: Number(draft[minKey]) } } }, `${d.name} minimum saved`)} disabled={busy}>
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
