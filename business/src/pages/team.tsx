/**
 * The team: who can sign in to this business, who's been invited, and what
 * each role can do. The owner and admins invite people by email; an admin
 * can't add, change or remove another admin. Anyone but the owner can leave.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus } from '@/components/icons'
import { Avatar } from '@/components/brand'
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Table, Toggle, cx } from '@/components/ui'
import { ApiError, LIVE, api } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { date } from '@/lib/format'
import { useSession } from '@/state/session'
import { INVITABLE, PERMISSIONS, ROLE_INFO, useCan, useRole, type RoleId } from '@/state/roles'
import { TEAM } from '@/data/mock'

type LiveMember = { id: string; role: RoleId; addedAt: string; name: string | null; email: string; you: boolean; twoStep?: 'EMAIL' | 'APP' }
type LiveInvite = { id: string; email: string; role: RoleId; invitedAt: string; expiresAt: string; status: 'pending' | 'expired' }

const problem = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')

function useTeam() {
  const { business } = useSession()
  const path = LIVE && business ? `/businesses/${business.id}/team` : null
  const r = useApi<{ members: LiveMember[]; invites: LiveInvite[]; requireAppTwoStep?: boolean }>(path)
  return { ...r, path, refresh: () => path && reload(path) }
}

export function Team() {
  const { business } = useSession()
  const role = useRole()
  const can = useCan()
  const navigate = useNavigate()
  const team = useTeam()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<LiveMember | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const manage = can('team')
  /** An admin manages everyone under it; only the owner touches admins. */
  const canTouch = (r: RoleId) => manage && r !== 'OWNER' && (role === 'OWNER' || r !== 'ADMIN')
  const base = business ? `/businesses/${business.id}/team` : ''

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      await team.refresh()
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy('')
    }
  }

  const members: LiveMember[] = LIVE
    ? (team.data?.members ?? [])
    : TEAM.map((m, i) => ({ id: m.id, role: i === 0 ? 'OWNER' : 'FINANCE', addedAt: m.addedAt, name: m.name, email: m.email, you: i === 0 }))
  const invites = team.data?.invites ?? []

  return (
    <>
      <PageHeader
        title="Team"
        sub="Everyone who can sign in to this business. Only the owner can send from the business wallet, add bank accounts or link Money Moves; admins can see the wallet."
        actions={
          manage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setInviting(true)}>
              Invite someone
            </Button>
          )
        }
      />
      {error && <p className="-mt-2 mb-4 text-[13px] text-red">{error}</p>}

      <Table
        rowKey={(m) => m.id}
        rows={members}
        columns={[
          {
            key: 'n',
            header: 'Name',
            mobile: 'main',
            render: (m) => (
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name ?? m.email} size={30} />
                <div className="min-w-0">
                  <div className="truncate font-medium">
                    {m.name ?? m.email.split('@')[0]}
                    {m.you && <span className="ml-1.5 text-[12px] font-normal text-dim">You</span>}
                  </div>
                  <div className="truncate text-[12px] text-dim">{m.email}</div>
                </div>
              </div>
            ),
          },
          { key: 'r', header: 'Role', render: (m) => <Badge tone={m.role === 'OWNER' ? 'good' : 'neutral'}>{ROLE_INFO[m.role]?.name ?? m.role}</Badge> },
          { key: 's', header: 'Signs in with', mobile: 'hide', render: (m) => (m.twoStep ? <span className={m.twoStep === 'APP' ? 'text-fg' : 'text-muted'}>{m.twoStep === 'APP' ? 'Authenticator app' : 'Code by email'}</span> : null) },
          { key: 'd', header: 'Joined', mobile: 'hide', render: (m) => <span className="text-muted">{date(m.addedAt)}</span> },
          {
            key: 'a',
            header: '',
            align: 'right',
            render: (m) =>
              m.you && m.role !== 'OWNER' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!LIVE || busy === m.id}
                  onClick={() =>
                    void act(m.id, async () => {
                      if (!window.confirm(`Leave ${business?.name ?? 'this business'}? You'll need a new invite to come back.`)) return
                      await api('DELETE', `${base}/members/${m.id}`)
                      navigate('/select-business')
                    })
                  }
                >
                  Leave
                </Button>
              ) : canTouch(m.role) ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>
                  Manage
                </Button>
              ) : null,
          },
        ]}
      />

      {LIVE && team.data && (
        <section className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-line bg-card px-4 py-4">
          <div className="min-w-0 max-w-[60ch]">
            <div className="text-[14px] font-semibold text-fg">Everyone signs in with an authenticator app</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
              {team.data.requireAppTwoStep
                ? 'On. Anyone on the team still using email codes is asked to set up an app before they can open the business.'
                : role === 'OWNER'
                  ? 'Safer than codes by email: someone who gets into a teammate’s email still can’t sign in. Turn on your own app in your profile first.'
                  : 'The owner can ask everyone on the team to use an authenticator app.'}
            </p>
          </div>
          <Toggle
            on={!!team.data.requireAppTwoStep}
            disabled={role !== 'OWNER' || busy === 'security'}
            label="Everyone signs in with an authenticator app"
            onChange={(v) => void act('security', () => api('PATCH', `${base}/security`, { requireAppTwoStep: v }))}
          />
        </section>
      )}

      {LIVE && invites.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[14px] font-semibold text-fg">Invited</h2>
          <div className="divide-y divide-soft overflow-hidden rounded-[10px] border border-line bg-card">
            {invites.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-fg">{i.email}</div>
                  <div className="text-[12px] text-dim">
                    {ROLE_INFO[i.role].name} · {i.status === 'expired' ? 'Link expired' : `Invited ${date(i.invitedAt)}, link works until ${date(i.expiresAt)}`}
                  </div>
                </div>
                {canTouch(i.role) && (
                  <div className="flex gap-1.5">
                    <Button size="sm" disabled={busy === i.id} onClick={() => void act(i.id, () => api('POST', `${base}/invites/${i.id}/resend`))}>
                      {i.status === 'expired' ? 'Send a new link' : 'Resend'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy === i.id} onClick={() => void act(i.id, () => api('POST', `${base}/invites/${i.id}/cancel`))}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <InviteModal open={inviting} owner={role === 'OWNER'} onClose={() => setInviting(false)} onDone={() => void team.refresh()} base={base} />
      <ManageModal
        member={editing}
        owner={role === 'OWNER'}
        onClose={() => setEditing(null)}
        onSave={(m, r) => act(m.id, () => api('PATCH', `${base}/members/${m.id}`, { role: r })).then(() => setEditing(null))}
        onRemove={(m) => act(m.id, () => api('DELETE', `${base}/members/${m.id}`)).then(() => setEditing(null))}
      />
    </>
  )
}

function RolePicker({ value, onChange, owner }: { value: RoleId; onChange: (r: RoleId) => void; owner: boolean }) {
  const roles = INVITABLE.filter((r) => owner || r !== 'ADMIN')
  return (
    <div className="space-y-1.5">
      {roles.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={cx('flex w-full items-start gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition', value === r ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
        >
          <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', value === r ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>
            {value === r && <span className="size-1.5 rounded-full bg-white" />}
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-semibold text-fg">{ROLE_INFO[r].name}</span>
            <span className="block text-[12.5px] leading-relaxed text-dim">{ROLE_INFO[r].about}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function InviteModal({ open, owner, onClose, onDone, base }: { open: boolean; owner: boolean; onClose: () => void; onDone: () => void; base: string }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleId>('FINANCE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState('')
  const close = () => {
    setEmail('')
    setError('')
    setSent('')
    onClose()
  }
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      if (LIVE) await api('POST', `${base}/invites`, { email: email.trim(), role })
      setSent(email.trim())
      onDone()
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={close}
      width={520}
      title={sent ? 'Invite sent' : 'Invite someone'}
      sub={sent ? undefined : "They get an email with a link. They accept it signed in with that email, and make an account first if they don't have one."}
      footer={
        sent ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send invite'}
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="flex items-start gap-3 rounded-[10px] bg-raise px-4 py-3.5 text-[13.5px] leading-relaxed text-muted">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-lime">
            <Check className="size-3 text-fg" strokeWidth={3} />
          </span>
          <span>
            We emailed <span className="font-medium text-fg">{sent}</span> a link to join as {ROLE_INFO[role].name.toLowerCase()}. It works for 7 days.
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Their email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" autoFocus />
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">Role</div>
            <RolePicker value={role} onChange={setRole} owner={owner} />
          </div>
          {error && <p className="text-[13px] text-red">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

function ManageModal({
  member,
  owner,
  onClose,
  onSave,
  onRemove,
}: {
  member: LiveMember | null
  owner: boolean
  onClose: () => void
  onSave: (m: LiveMember, r: RoleId) => Promise<void>
  onRemove: (m: LiveMember) => Promise<void>
}) {
  const [role, setRole] = useState<RoleId | null>(null)
  const [busy, setBusy] = useState(false)
  if (!member) return null
  const picked = role ?? member.role
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      setRole(null)
    }
  }
  const who = member.name ?? member.email
  return (
    <Modal
      open
      onClose={() => {
        setRole(null)
        onClose()
      }}
      width={520}
      title={who}
      sub={member.email}
      footer={
        <>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove ${who} from the team? They can't sign in to this business after.`)) void run(() => onRemove(member))
            }}
          >
            Remove from team
          </Button>
          <Button variant="primary" disabled={busy || picked === member.role} onClick={() => void run(() => onSave(member, picked))}>
            {busy ? 'Saving…' : 'Save role'}
          </Button>
        </>
      }
    >
      <RolePicker value={picked} onChange={setRole} owner={owner} />
    </Modal>
  )
}

export function Roles() {
  const [open, setOpen] = useState<RoleId | null>(null)
  const team = useTeam()
  const roles = Object.keys(ROLE_INFO) as RoleId[]
  const count = (r: RoleId) => (LIVE ? (team.data?.members ?? []).filter((m) => m.role === r).length : r === 'OWNER' ? 1 : 0)
  return (
    <>
      <PageHeader title="Roles" sub="What each person on the team can do. Pick a role when you invite someone, or change it on Team." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <Card key={r} className="flex flex-col p-5">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold">{ROLE_INFO[r].name}</div>
              <span className="text-[12px] text-dim">
                {count(r)} {count(r) === 1 ? 'person' : 'people'}
              </span>
            </div>
            <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted">{ROLE_INFO[r].about}</p>
            <button onClick={() => setOpen(r)} className="mt-4 self-start text-[13px] font-medium text-fg underline underline-offset-2">
              See what it can do
            </button>
          </Card>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? ROLE_INFO[open].name : ''} sub={open ? ROLE_INFO[open].about : undefined}>
        {PERMISSIONS.map((p) => {
          const allowed = !!open && p.roles.includes(open)
          return (
            <div key={p.id} className="flex items-center justify-between gap-4 border-b border-soft py-3 last:border-0">
              <span className="text-[13.5px]">{p.label}</span>
              {allowed ? <Check className="size-4 shrink-0 text-good" strokeWidth={3} /> : <span className="shrink-0 text-[12px] text-dim">No</span>}
            </div>
          )
        })}
      </Modal>
    </>
  )
}
