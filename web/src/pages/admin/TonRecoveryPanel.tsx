/**
 * One person's older TON wallet: whether their saved address still matches the
 * key they sign with, what is sitting at the old one, and the switch that offers
 * them "Move to my wallet" in the app. Changing the switch takes the action
 * password. It only offers the move: the person's own old key still has to sign.
 */
import { useCallback, useEffect, useState } from 'react'
import { C } from './ui'
import { Button, Notice, Panel, PasswordInput } from './business/kit'
import { SwitchRow } from './business/Services'

const API = import.meta.env.VITE_API_URL || ''

type Answer = {
  enabled: boolean
  stale: boolean
  savedAddress: string | null
  currentAddress: string | null
  balance: number | null
}

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
}

export function TonRecoveryPanel({ userId }: { userId: string }) {
  const [now, setNow] = useState<Answer | null>(null)
  const [draft, setDraft] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/admin/users/${userId}/ton-recovery`, authed())
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) return setSaid({ ok: false, text: j?.error ?? 'Could not load this.' })
    setNow(j)
    setDraft(j.enabled)
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setBusy(true)
    setSaid(null)
    try {
      const r = await fetch(`${API}/api/admin/users/${userId}/ton-recovery`, authed({ method: 'PUT', body: JSON.stringify({ enabled: draft, password }) }))
      const j = await r.json().catch(() => null)
      if (!r.ok) return setSaid({ ok: false, text: j?.error ?? 'Could not save that.' })
      setNow(j)
      setDraft(j.enabled)
      setPassword('')
      setSaid({ ok: true, text: j.enabled ? 'Recovery is on. They see it the next time they open the app.' : 'Recovery is off for this account.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Older TON wallet" sub="Offers Move to my wallet in the app. Their own old key still has to sign.">
      {!now ? (
        <p className="text-[13px]" style={{ color: said ? C.red : C.dim }}>
          {said ? said.text : 'Loading…'}
        </p>
      ) : (
        <div className="space-y-3">
          {now.stale ? (
            <Notice tone="warn" title={now.balance == null ? 'Saved TON address is from an older wallet' : `${now.balance} USDT in an older wallet`}>
              <span className="break-all">{now.savedAddress}</span>
            </Notice>
          ) : (
            <p className="text-[13px]" style={{ color: C.dim }}>
              Their TON address matches the wallet they sign with, so there is nothing to move.
            </p>
          )}
          <div className="-mx-4" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <SwitchRow label="Offer recovery" on={draft} onChange={setDraft} changed={draft !== now.enabled} />
          </div>
          {draft !== now.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <PasswordInput value={password} onChange={setPassword} />
              <Button small tone="primary" disabled={busy || !password} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          )}
          {said && (
            <p className="text-[12.5px]" style={{ color: said.ok ? C.lime : C.red }}>
              {said.text}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
