/**
 * Which networks the app offers on its deposit screen. Each switch saves as it
 * is flipped. This hides the address in the app: it can't stop a chain, so money
 * someone already sends to their address still arrives and is still theirs.
 */
import { useCallback, useEffect, useState } from 'react'
import { C } from './ui'
import { Panel, When } from './business/kit'
import { SwitchRow } from './business/Services'

const API = import.meta.env.VITE_API_URL || ''

type Net = { key: string; label: string; blocks: string; paused: boolean; updatedBy: string | null; updatedAt: string | null }

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
}

export function DepositNetworks() {
  const [nets, setNets] = useState<Net[] | null>(null)
  const [problem, setProblem] = useState('')

  const take = (services: any[]) => setNets(services.filter((s) => s.kind === 'deposit'))

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/admin/services`, authed())
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) return setProblem(j?.error ?? 'Could not load the networks.')
    take(j.services)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const flip = async (key: string, on: boolean) => {
    setProblem('')
    setNets((list) => list?.map((n) => (n.key === key ? { ...n, paused: !on } : n)) ?? null)
    const r = await fetch(`${API}/api/admin/services/${key}`, authed({ method: 'PUT', body: JSON.stringify({ paused: !on }) }))
    const j = await r.json().catch(() => null)
    if (!r.ok) {
      setProblem(j?.error ?? 'Could not save that.')
      return void load()
    }
    if (j?.services) take(j.services)
    else void load()
  }

  const latest = nets?.filter((n) => n.updatedAt).sort((a, b) => (a.updatedAt! < b.updatedAt! ? 1 : -1))[0]

  return (
    <Panel title="Deposit networks" sub="Which networks people can pick on the app's deposit screen. Off hides the address. Money already sent to it still arrives. Tron and Ethereum are under Converted.">
      {!nets ? (
        <p className="text-[13px]" style={{ color: problem ? C.red : C.dim }}>
          {problem || 'Loading…'}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="-mx-4" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            {nets.map((n) => (
              <SwitchRow key={n.key} label={n.label} sub={n.blocks} on={!n.paused} onChange={(on: boolean) => void flip(n.key, on)} />
            ))}
          </div>
          {latest && (
            <p className="text-[12.5px]" style={{ color: C.dim }}>
              Last changed by {latest.updatedBy}, <When at={latest.updatedAt!} />.
            </p>
          )}
          {problem && (
            <p className="text-[12.5px]" style={{ color: C.red }}>
              {problem}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
