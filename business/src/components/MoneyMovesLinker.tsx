/**
 * Linking Money Moves accounts, live: ask by username, and the account's
 * owner approves it in the app - nothing is linked until they do. Waiting
 * requests are checked every few seconds; "I've approved it" asks at once.
 */
import { useState } from 'react'
import { Plus } from '@/components/icons'
import { AppIcon } from '@/components/brand'
import { Badge, Button, Field, Input, cx } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { WEBSITE } from '@/lib/links'
import { reload, useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'

export interface ApiMmLink {
  id: string
  username: string
  status: 'PENDING' | 'LINKED' | 'DECLINED' | 'EXPIRED' | 'UNLINKED'
  isDefault: boolean
  createdAt: string
  linkedAt: string | null
}

export const moneyMovesPath = (businessId: string) => `/businesses/${businessId}/money-moves`

export function MoneyMovesLinker() {
  const { business } = useSession()
  const path = business ? moneyMovesPath(business.id) : null
  const first = useApi<{ accounts: ApiMmLink[]; max: number }>(path)
  const accounts = first.data?.accounts ?? []
  const waiting = accounts.some((a) => a.status === 'PENDING')
  // While a request waits, look again every few seconds - the approval lands on its own.
  useApi<{ accounts: ApiMmLink[] }>(waiting ? path : null, { every: 5_000 })
  const max = first.data?.max ?? 5
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')

  const act = async (key: string, fn: () => Promise<unknown>) => {
    if (!path) return
    setBusy(key)
    setProblem('')
    setNote('')
    try {
      const out = await fn()
      await reload(path)
      return out
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  const send = async () => {
    const done = await act('add', () => api('POST', path!, { username: username.trim() }))
    if (done) {
      setUsername('')
      setAdding(false)
    }
  }
  const check = async (id: string) => {
    const r = (await act(`check:${id}`, () => api<{ account: ApiMmLink }>('POST', `${path}/${id}/check`))) as { account: ApiMmLink } | undefined
    if (r?.account.status === 'PENDING') setNote("Not approved yet. Open Money Moves on that account's phone. The request is in its notifications.")
    if (r?.account.status === 'DECLINED') setNote('That request was declined in the app.')
  }

  if (first.loading) return <p className="text-[13px] text-muted">Loading…</p>

  return (
    <div className="space-y-3">
      {accounts.map((a) => {
        const linked = a.status === 'LINKED'
        return (
          <div key={a.id} className={cx('flex flex-wrap items-center gap-3 rounded-[12px] border bg-card px-3.5 py-3', a.isDefault && linked ? 'border-fg/70' : 'border-line')}>
            <AppIcon size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold text-fg">@{a.username}</span>
                {a.isDefault && linked && <Badge tone="info">Default</Badge>}
                {linked ? <Badge tone="good">Linked</Badge> : <Badge tone="warn">Waiting for approval</Badge>}
              </div>
              <div className="mt-0.5 text-[12.5px] leading-relaxed text-dim">
                {linked ? 'Payments can land in this Money Moves account.' : "Its owner approves the request in the Money Moves app. Nothing is linked until they do."}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {confirming === a.id ? (
                <>
                  <span className="text-[12.5px] text-muted">{linked ? 'Unlink it?' : 'Cancel the request?'}</span>
                  <Button size="sm" variant="danger" disabled={busy === `end:${a.id}`} onClick={() => void act(`end:${a.id}`, () => api('DELETE', `${path}/${a.id}`)).then(() => setConfirming(null))}>
                    {linked ? 'Unlink' : 'Cancel request'}
                  </Button>
                  <Button size="sm" onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </>
              ) : linked ? (
                <>
                  {!a.isDefault && (
                    <Button size="sm" disabled={!!busy} onClick={() => void act(`default:${a.id}`, () => api('POST', `${path}/${a.id}/default`))}>
                      Make default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(a.id)}>
                    Unlink
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" disabled={busy === `check:${a.id}`} onClick={() => void check(a.id)}>
                    {busy === `check:${a.id}` ? 'Checking…' : "I've approved it"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(a.id)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        )
      })}

      {accounts.length < max &&
        (adding || accounts.length === 0 ? (
          <div className="rounded-[12px] border border-line p-4">
            <Field label="Money Moves username" hint="We send a request to that account in the app. Its owner approves it there. You'll see it linked here the moment they do.">
              <div className="flex gap-2">
                <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} placeholder="@username" />
                <Button variant="primary" disabled={username.replace('@', '').length < 2 || busy === 'add'} onClick={() => void send()}>
                  {busy === 'add' ? 'Sending…' : 'Send request'}
                </Button>
              </div>
            </Field>
            <p className="mt-3 text-[12.5px] text-muted">
              Don't have the Money Moves app?{' '}
              <a href={WEBSITE} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2 hover:no-underline">
                Download it
              </a>
            </p>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-[#CFCCC3] text-[13.5px] font-medium text-muted transition hover:border-fg/40 hover:bg-[#FAFAF8] hover:text-fg"
          >
            <Plus className="size-4" /> Link another account
          </button>
        ))}
      {accounts.length >= max && <p className="text-[12.5px] text-dim">That's the most you can link. Unlink one to add another.</p>}
      {note && <p className="text-[12.5px] text-muted">{note}</p>}
      {(problem || first.error) && <p className="text-[12.5px] text-red">{problem || first.error?.message}</p>}
    </div>
  )
}
