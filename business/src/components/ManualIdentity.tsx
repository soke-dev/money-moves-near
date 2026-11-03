/**
 * The identity step when checks are manual: carry on on a phone by scanning a
 * code, or use this computer. While the phone is busy this page follows along
 * by itself; once sent it says it's being checked, and if a redo is asked for
 * it lists only what to take again.
 *
 * Wording rule: say that we check it, never how.
 */
import { useEffect, useRef, useState } from 'react'
import Qr from '@/components/Qr'
import { Badge, Button, cx } from '@/components/ui'
import { Check, Lock, Monitor, RefreshCw, Smartphone } from '@/components/icons'
import { ApiError, api, type ApiApplication } from '@/lib/api'

type Identity = NonNullable<ApiApplication['identity']>

export const PART_WORDS: Record<string, string> = { front: 'Photo of your ID, front', back: 'Photo of your ID, back', selfie: 'Selfie', video: 'Smile video' }
export const ID_WORDS: Record<string, string> = { nin: 'NIN slip or card', passport: 'International passport', licence: "Driver's licence" }

/** The panel. `path` is the application's API path; `reload` reads the application again. */
export function ManualIdentity({ path, identity, reload, canManage = true }: { path: string; identity: ApiApplication['identity']; reload: () => Promise<unknown>; canManage?: boolean }) {
  const status = identity?.method === 'manual' ? identity.status : null
  const redo = identity?.method === 'manual' && status === 'PENDING' && (identity.redo?.length ?? 0) > 0

  // While it's being taken, follow along: the phone's progress, and the moment it's sent.
  const following = !status || status === 'PENDING'
  useEffect(() => {
    if (!following) return
    const t = setInterval(() => void reload().catch(() => {}), 4000)
    // A tab left in the background is checked rarely by the browser: catch up the moment it is looked at again.
    const back = () => document.visibilityState === 'visible' && void reload().catch(() => {})
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [following, reload])

  if (status === 'APPROVED') return <Verified />
  if (status === 'IN_REVIEW') return <BeingChecked identity={identity!} />

  return (
    <div className="space-y-5">
      {status === 'DECLINED' && (
        <div className="rounded-xl border border-line p-5">
          <div className="text-[15px] font-semibold text-fg">We couldn't verify you</div>
          {identity?.note && <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{identity.note}</p>}
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Use a valid ID, photographed flat and in good light, and keep your face clear for the selfie. Then start again below.</p>
        </div>
      )}
      {redo && <RedoList identity={identity!} />}
      {canManage ? (
        <Handoff path={path} identity={identity} redo={redo} />
      ) : (
        <p className="rounded-xl border border-line p-5 text-[13.5px] text-muted">The owner or an admin of this business does the identity check.</p>
      )}
    </div>
  )
}

function Verified() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-fg p-5">
      <span className="flex size-9 items-center justify-center rounded-full bg-lime text-fg">
        <Check className="size-4.5" strokeWidth={3} />
      </span>
      <div>
        <div className="text-[15px] font-semibold text-fg">Identity verified</div>
        <div className="text-[13px] text-muted">Nothing more to do here.</div>
      </div>
    </div>
  )
}

function BeingChecked({ identity }: { identity: Identity }) {
  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-fg">Your identity is being checked</div>
          <div className="mt-0.5 text-[13.5px] text-muted">
            {[identity.idType ? ID_WORDS[identity.idType] : null, 'selfie and smile video'].filter(Boolean).join(', ')}. We'll email you when it's checked.
          </div>
        </div>
        <Badge tone="warn" dot>
          Being checked
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[12px] text-dim">
        <Lock className="size-3.5" /> Encrypted, and used only to verify you
      </div>
    </div>
  )
}

function RedoList({ identity }: { identity: Identity }) {
  const parts = identity.redo ?? []
  return (
    <div className="rounded-xl border border-line">
      <div className="px-5 pb-2 pt-5">
        <div className="text-[12.5px] font-semibold text-red">Needs another try</div>
        <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-fg">{parts.length === 1 ? 'One thing to redo' : `${parts.length} things to redo`}</div>
        <p className="mt-1 text-[13.5px] text-muted">Everything else is fine and stays as it is.</p>
      </div>
      <ol className="mt-2">
        {parts.map((p, i) => (
          <li key={p} className="flex gap-4 border-t border-line px-5 py-3.5 text-[14px]">
            <span className="w-4 font-semibold text-dim">{i + 1}</span>
            <span className="font-medium text-fg">{PART_WORDS[p] ?? p}</span>
          </li>
        ))}
      </ol>
      {identity.note && (
        <div className="border-t border-line bg-side px-5 py-3.5 text-[13.5px] text-muted">
          <span className="font-semibold text-fg">Note: </span>
          {identity.note}
        </div>
      )}
    </div>
  )
}

/** The code for the phone, and the way to use this computer instead. */
function Handoff({ path, identity, redo }: { path: string; identity: ApiApplication['identity']; redo: boolean }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const asked = useRef(false)
  const make = async () => {
    setBusy(true)
    setError('')
    try {
      setLink(await api<{ url: string; expiresAt: string }>('POST', `${path}/identity/handoff`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't make a code. Try again.")
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    void make()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A code that ran out is replaced on its own while the page is open.
  useEffect(() => {
    if (!link) return
    const left = new Date(link.expiresAt).getTime() - Date.now() - 15_000
    const t = setTimeout(() => void make(), Math.max(5_000, left))
    return () => clearTimeout(t)
  }, [link]) // eslint-disable-line react-hooks/exhaustive-deps

  const connected = !!identity?.phoneConnected
  const took = identity?.method === 'manual' ? (identity.parts?.length ?? 0) : 0
  const of = identity?.method === 'manual' ? (identity.need?.length ?? 0) : 0

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <section className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center">
        <div className="shrink-0 self-center">
          {link ? (
            <Qr value={link.url} size={168} />
          ) : (
            <div className="flex size-[192px] items-center justify-center rounded-2xl border border-line text-[13px] text-dim">{busy ? 'Making a code…' : 'No code'}</div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Badge tone="good">Recommended</Badge>
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-fg">
            <Smartphone className="size-4.5 shrink-0" /> {redo ? 'Redo on your phone' : 'Continue on your phone'}
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted">Point your phone's camera at the code. Its camera takes sharper photos, and this page follows along on its own.</p>
          <div className="flex items-center gap-2.5 text-[13.5px] font-medium text-fg">
            <span className={cx('size-2 shrink-0 rounded-full', connected ? 'bg-good' : 'bg-lime ring-4 ring-lime/30')} />
            {connected ? (of ? `Phone connected · ${took} of ${of} done` : 'Phone connected') : 'Waiting for your phone'}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-dim">
            <span>The code works for 30 minutes.</span>
            <button type="button" onClick={() => void make()} disabled={busy} className="inline-flex items-center gap-1 font-medium text-muted underline-offset-2 hover:text-fg hover:underline">
              <RefreshCw className="size-3" /> Make a new one
            </button>
          </div>
          {error && <p className="text-[13px] text-red">{error}</p>}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line bg-side px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-fg">
            <Monitor className="size-4 shrink-0" /> Or use this computer
          </div>
          <p className="mt-0.5 text-[13px] text-muted">You'll need a webcam for the selfie and smile video.</p>
        </div>
        <Button disabled={!link} onClick={() => link && window.location.assign(link.url)}>
          Use this computer
        </Button>
      </section>
    </div>
  )
}
