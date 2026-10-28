/**
 * Limits the app enforces per account, set from the console.
 *
 * For now one number: Solana sends a day (withdrawals and username transfers
 * together). Every Solana send can cost us rent for the recipient's token
 * account, which is why the cap exists at all, so raising it takes the action
 * password and the server keeps it between 1 and 50.
 */
import { useCallback, useEffect, useState } from 'react'
import { C } from './ui'
import { Button, Field, Input, Notice, Panel, When } from './business/kit'

const API = import.meta.env.VITE_API_URL || ''

type Limits = {
  solTransfersPerDay: number
  defaultSolTransfersPerDay: number
  range: { min: number; max: number }
  updatedBy: string | null
  updatedAt: string | null
}

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } }
}

export function LimitsSettings() {
  const [limits, setLimits] = useState<Limits | null>(null)
  const [value, setValue] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/admin/limits`, authed())
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) return setSaid({ ok: false, text: j?.error ?? 'Could not load the limits.' })
    setLimits(j)
    setValue(String(j.solTransfersPerDay))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const n = Number(value)
  const valid = !!limits && Number.isInteger(n) && n >= limits.range.min && n <= limits.range.max
  const changed = !!limits && valid && n !== limits.solTransfersPerDay

  const save = async () => {
    if (!changed || busy) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await fetch(`${API}/api/admin/limits`, authed({ method: 'PUT', body: JSON.stringify({ solTransfersPerDay: n, password }) }))
      const j = await r.json().catch(() => null)
      if (!r.ok) return setSaid({ ok: false, text: j?.error ?? 'Could not save that.' })
      setLimits(j)
      setValue(String(j.solTransfersPerDay))
      setPassword('')
      setSaid({ ok: true, text: `Saved. Each account can now make ${j.solTransfersPerDay} Solana sends a day.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Solana sends a day" sub="How many Solana sends one account can make in 24 hours: withdrawals and username transfers counted together. Every Solana send can cost us rent for the recipient's token account, so keep it low. The app follows a change within seconds.">
      {!limits ? (
        <p className="text-[13px]" style={{ color: C.dim }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[160px]">
              <Field label={`Sends a day (${limits.range.min} to ${limits.range.max})`}>
                <Input value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
              </Field>
            </div>
            <div className="flex gap-1.5 pb-0.5">
              <Button small disabled={!limits || n <= limits.range.min} onClick={() => setValue(String(Math.max(limits.range.min, (Number.isFinite(n) ? n : limits.solTransfersPerDay) - 1)))}>
                −
              </Button>
              <Button small disabled={!limits || n >= limits.range.max} onClick={() => setValue(String(Math.min(limits.range.max, (Number.isFinite(n) ? n : limits.solTransfersPerDay) + 1)))}>
                +
              </Button>
            </div>
          </div>
          <p className="text-[12.5px]" style={{ color: C.dim }}>
            Now {limits.solTransfersPerDay} a day{limits.solTransfersPerDay === limits.defaultSolTransfersPerDay ? ', the default' : `, default ${limits.defaultSolTransfersPerDay}`}.
            {limits.updatedBy && limits.updatedAt && (
              <>
                {' '}Last changed by {limits.updatedBy}, <When at={limits.updatedAt} />.
              </>
            )}
          </p>
          {changed && (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Action password" fit className="w-[220px]" />
              <Button small tone="primary" disabled={busy || !password} onClick={() => void save()}>
                {busy ? 'Saving…' : `Set to ${n}`}
              </Button>
              <Button small disabled={busy} onClick={() => setValue(String(limits.solTransfersPerDay))}>
                Cancel
              </Button>
            </div>
          )}
          {value !== '' && !valid && (
            <p className="text-[12.5px]" style={{ color: C.amber }}>
              Pick a whole number from {limits.range.min} to {limits.range.max}.
            </p>
          )}
        </div>
      )}
      {said && (
        <div className="mt-3">
          <Notice tone={said.ok ? 'good' : 'bad'} title={said.ok ? 'Saved' : 'Not saved'}>
            {said.text}
          </Notice>
        </div>
      )}
    </Panel>
  )
}
