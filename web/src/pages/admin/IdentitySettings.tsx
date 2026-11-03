/**
 * How app users prove who they are: the identity partner's automatic check,
 * or photos of their ID, a selfie and a smile video that are decided in ID
 * checks. Which IDs are accepted is set here too. Only new checks follow a
 * change; ones under way finish the way they began. Saving takes the action
 * password.
 */
import { useCallback, useEffect, useState } from 'react'
import { C } from './ui'
import { Button, Notice, Panel, PasswordInput, When } from './business/kit'
import { SwitchRow } from './business/Services'

const API = import.meta.env.VITE_API_URL || ''

type Settings = { manual: boolean; nin: boolean; passport: boolean; licence: boolean }
type Answer = { settings: Settings; updatedBy: string | null; updatedAt: string | null; ready: boolean }

function authed(init?: RequestInit): RequestInit {
  const token = localStorage.getItem('mm_admin_token')
  return { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } }
}

const KEYS: (keyof Settings)[] = ['manual', 'nin', 'passport', 'licence']

export function IdentitySettings() {
  const [now, setNow] = useState<Answer | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/admin/identity-settings`, authed())
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) return setSaid({ ok: false, text: j?.error ?? 'Could not load the identity settings.' })
    setNow(j)
    setDraft(j.settings)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const changed = !!now && !!draft && KEYS.some((k) => now.settings[k] !== draft[k])
  const noIds = !!draft && !draft.nin && !draft.passport && !draft.licence

  const save = async () => {
    if (!changed || busy || !draft) return
    setBusy(true)
    setSaid(null)
    try {
      const r = await fetch(`${API}/api/admin/identity-settings`, authed({ method: 'PUT', body: JSON.stringify({ ...draft, password }) }))
      const j = await r.json().catch(() => null)
      if (!r.ok) return setSaid({ ok: false, text: j?.error ?? 'Could not save that.' })
      setNow(j)
      setDraft(j.settings)
      setPassword('')
      setSaid({ ok: true, text: j.settings.manual ? 'New checks are now decided in ID checks.' : 'New checks now go to the automatic check.' })
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof Settings) => (v: boolean) => draft && setDraft({ ...draft, [k]: v })

  return (
    <Panel title="Identity checks" sub="How app users prove who they are. Only new checks follow a change: ones under way finish the way they began, and verified accounts stay verified. Users never see which is in use.">
      {!now || !draft ? (
        <p className="text-[13px]" style={{ color: C.dim }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          {!now.ready && draft.manual && (
            <Notice tone="warn" title="Photos can't be stored yet">
              The app backend has no key to encrypt them with, so checks can't be sent until KYC_FILES_KEY is set.
            </Notice>
          )}
          <div className="-mx-4" style={{ borderBottom: `1px solid ${C.lineSoft}` }}>
            <SwitchRow
              label="Decide checks in ID checks"
              sub="On: they send a photo of their ID (the back too for a driver's licence), a selfie and a 3 second smile video from the app, and you decide them in ID checks. Off: the automatic check by the identity partner."
              on={draft.manual}
              onChange={set('manual')}
              changed={draft.manual !== now.settings.manual}
            />
            <SwitchRow label="Accepts NIN slip or card" sub="The front." on={draft.nin} onChange={set('nin')} changed={draft.nin !== now.settings.nin} />
            <SwitchRow label="Accepts international passport" sub="The photo page." on={draft.passport} onChange={set('passport')} changed={draft.passport !== now.settings.passport} />
            <SwitchRow label="Accepts driver's licence" sub="Front and back. At least one ID has to stay on." on={draft.licence} onChange={set('licence')} changed={draft.licence !== now.settings.licence} />
          </div>
          {now.updatedBy && now.updatedAt && (
            <p className="text-[12.5px]" style={{ color: C.dim }}>
              Last changed by {now.updatedBy}, <When at={now.updatedAt} />.
            </p>
          )}
          {noIds && (
            <p className="text-[12.5px]" style={{ color: C.amber }}>
              Keep at least one ID on.
            </p>
          )}
          {changed && !noIds && (
            <div className="flex flex-wrap items-center gap-2">
              <PasswordInput value={password} onChange={setPassword} />
              <Button small tone="primary" disabled={busy || !password} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
              <Button small disabled={busy} onClick={() => setDraft(now.settings)}>
                Cancel
              </Button>
            </div>
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
