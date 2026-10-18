/**
 * The team's activity: who did what, newest first, by day. Invites and roles,
 * refunds and dispute replies, payout places and settings, links and invoices,
 * keys and webhooks. For the owner and admins; the wallet's entries show to
 * the owner only.
 */
import { useEffect, useState } from 'react'
import { Avatar } from '@/components/brand'
import { Button, Empty, PageHeader, Segmented, Select } from '@/components/ui'
import { ApiError, LIVE, api } from '@/lib/api'
import { useSession } from '@/state/session'
import { useCan, useRole } from '@/state/roles'

type Group = 'team' | 'money' | 'collect' | 'settings' | 'developers' | 'wallet' | 'verification'
type Entry = { id: string; at: string; text: string; group: Group; who: { id: string; name: string | null; email: string } | null }

const GROUPS: [Group | 'all', string][] = [
  ['all', 'All'],
  ['team', 'Team'],
  ['money', 'Refunds and disputes'],
  ['collect', 'Links and invoices'],
  ['settings', 'Settings'],
  ['developers', 'Developers'],
  ['verification', 'Verification'],
  ['wallet', 'Wallet'],
]

const day = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function Activity() {
  const { business } = useSession()
  const can = useCan()
  const owner = useRole() === 'OWNER'
  const [group, setGroup] = useState<Group | 'all'>('all')
  const [who, setWho] = useState('')
  const [rows, setRows] = useState<Entry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [people, setPeople] = useState<{ id: string; label: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const base = business ? `/businesses/${business.id}/team/activity` : null

  const load = async (more: boolean) => {
    if (!base) return
    setBusy(true)
    setError('')
    try {
      const q = new URLSearchParams()
      if (group !== 'all') q.set('group', group)
      if (who) q.set('who', who)
      if (more && next) q.set('before', next)
      const r = await api<{ activity: Entry[]; next: string | null }>('GET', `${base}?${q}`)
      setRows((x) => (more ? [...(x ?? []), ...r.activity] : r.activity))
      setNext(r.next)
      // The people to filter by: whoever shows up in the log.
      setPeople((p) => {
        const seen = new Map(p.map((x) => [x.id, x]))
        for (const e of r.activity) if (e.who && !seen.has(e.who.id)) seen.set(e.who.id, { id: e.who.id, label: e.who.name ?? e.who.email })
        return [...seen.values()]
      })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The activity didn't load. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (LIVE && can('team')) void load(false)
  }, [base, group, who]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!LIVE || !can('team')) {
    return (
      <>
        <PageHeader title="Activity" sub="Who on the team did what, and when." />
        <Empty title={LIVE ? 'Activity is for the owner and admins.' : 'Activity shows here once you’re live.'} sub="Invites and roles, refunds and dispute replies, payout places and settings, links and invoices, keys and webhooks." />
      </>
    )
  }

  // By day, newest first.
  const days: [string, Entry[]][] = []
  for (const e of rows ?? []) {
    const d = day(e.at)
    const last = days[days.length - 1]
    if (last && last[0] === d) last[1].push(e)
    else days.push([d, [e]])
  }

  return (
    <>
      <PageHeader title="Activity" sub={`Who on the team did what, and when.${owner ? '' : ' The business wallet’s activity shows to the owner only.'}`} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented value={group} onChange={(g: Group | 'all') => setGroup(g)} options={GROUPS.filter(([g]) => owner || g !== 'wallet').map(([id, label]) => ({ id, label }))} />
        {people.length > 1 && (
          <Select value={who} onChange={(e) => setWho(e.target.value)} className="h-9 w-auto min-w-[180px] text-[13px]">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      {error && <p className="mb-4 text-[13px] text-red">{error}</p>}
      {rows === null ? (
        <div className="h-48 animate-pulse rounded-[12px] bg-raise" />
      ) : rows.length === 0 ? (
        <Empty title="Nothing here yet." sub="As the team invites people, refunds payments, replies to disputes or changes settings, it shows here." />
      ) : (
        <div className="space-y-7">
          {days.map(([d, list]) => (
            <section key={d}>
              <h2 className="mb-2 text-[12.5px] font-medium text-dim">{d}</h2>
              <ol className="divide-y divide-soft overflow-hidden rounded-[12px] border border-line bg-card">
                {list.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={e.who?.name ?? e.who?.email ?? 'Money Moves'} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] text-fg">
                        <span className="font-semibold">{e.who ? (e.who.name ?? e.who.email.split('@')[0]) : 'Through the API'}</span> <span className="text-muted">{e.text.charAt(0).toLowerCase() + e.text.slice(1)}</span>
                      </div>
                      {e.who?.name && <div className="truncate text-[12px] text-dim">{e.who.email}</div>}
                    </div>
                    <span className="tabular shrink-0 text-[12px] text-dim">{time(e.at)}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {next && (
            <div className="flex justify-center">
              <Button disabled={busy} onClick={() => void load(true)}>
                {busy ? 'Loading…' : 'Show older'}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

