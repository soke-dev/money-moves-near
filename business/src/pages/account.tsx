/**
 * The signed-in person, not the business: their own details, how they sign
 * in, and the businesses they've invited to Money Moves.
 *
 * A password and 2-step belong to the person - one person can be on the team
 * of several businesses - so they live here, not in a business's settings.
 * Live, every change goes through the API; in preview it stays on the page.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, KeyRound, Mail, Monitor, Smartphone } from '@/components/icons'
import { Avatar } from '@/components/brand'
import { Badge, Button, Card, Field, Input, PageHeader, Table, cx, type Tone } from '@/components/ui'
import Qr from '@/components/Qr'
import { useSession } from '@/state/session'
import { ago, copy, date } from '@/lib/format'
import { ApiError, LIVE, api, type Me } from '@/lib/api'
import { Empty } from '@/components/ui'
import { BusinessMark, PhotoControl } from '@/components/Pictures'
import { useCan } from '@/state/roles'
import { useApi } from '@/lib/useApi'

const problem = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')

function Note({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return (
    <span className={cx('flex items-center gap-1.5 text-[13px]', bad ? 'text-red' : 'text-good')}>
      {!bad && <Check className="size-4" strokeWidth={3} />}
      {children}
    </span>
  )
}

export function Profile() {
  const { live, user, businesses, business, applyMe } = useSession()
  // Live, the boxes start from the real names - not the email-based greeting used until verification.
  const startFirst = (live ? user?.firstName : user?.first) ?? ''
  const startLast = (live ? user?.lastName : user?.last) ?? ''
  const [first, setFirst] = useState(startFirst)
  const [last, setLast] = useState(startLast)
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user) return null
  const dirty = first !== startFirst || last !== startLast || phone !== user.phone
  const save = async () => {
    setError('')
    if (!live) return setSaved(true)
    setBusy(true)
    try {
      applyMe(await api<Me>('PATCH', '/auth/me', { firstName: first.trim() || undefined, lastName: last.trim() || undefined, phone: phone.trim() }))
      setSaved(true)
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }
  const shownName = `${first || user.first} ${last || user.last}`.trim()
  return (
    <>
      <PageHeader title="Profile" sub="You, not the business. Your details and how you sign in follow you to every business you're part of." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5 sm:p-6">
            <div className="border-b border-line pb-5">
              <PhotoControl name={shownName} />
            </div>
            <div className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-2">
              <Field label="First name">
                <Input value={first} onChange={(e) => (setFirst(e.target.value), setSaved(false))} />
              </Field>
              <Field label="Last name">
                <Input value={last} onChange={(e) => (setLast(e.target.value), setSaved(false))} />
              </Field>
              <Field label="Email" hint="You sign in with this. Changing it needs a code sent to both addresses.">
                <div className="flex h-10 items-center gap-2 rounded-[7px] border border-line bg-raise px-3 text-[14px] text-muted">
                  <Mail className="size-4 shrink-0 text-dim" />
                  <span className="min-w-0 flex-1 truncate">{user.email}</span>
                  <Badge tone="good">Verified</Badge>
                </div>
              </Field>
              <Field label="Phone">
                <Input value={phone} onChange={(e) => (setPhone(e.target.value), setSaved(false))} inputMode="tel" />
              </Field>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-line pt-4">
              {error ? <Note bad>{error}</Note> : saved && <Note>Saved</Note>}
              <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </Card>

          <Password />
          <TwoStep email={user.email} />
          <Sessions />
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="text-[14.5px] font-semibold text-fg">Your businesses</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">One sign-in for all of them. Switch from the menu at the top of the sidebar.</p>
            <ul className="mt-3 divide-y divide-soft">
              {businesses.map((b) => (
                <li key={b.id} className="flex items-center gap-3 py-2.5">
                  <BusinessMark business={b} size={30} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{b.name}</span>
                  {b.id === business?.id ? <Badge tone="good">Here now</Badge> : <span className="text-[12px] capitalize text-dim">{(b.role ?? 'Owner').toLowerCase()}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}

/** Change the password - or, for someone who only signs in with Google, set one. */
function Password() {
  const { live, user, applyMe } = useSession()
  const hasPassword = live ? !!user?.hasPassword : true
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const short = next.length > 0 && next.length < 10
  const mismatch = again.length > 0 && again !== next
  const can = (!hasPassword || !!current) && next.length >= 10 && again === next
  const reset = () => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setAgain('')
    setError('')
  }
  const submit = async () => {
    setError('')
    if (!live) {
      reset()
      return setDone(true)
    }
    setBusy(true)
    try {
      await api('POST', '/auth/password/change', { current: hasPassword ? current : undefined, next })
      reset()
      setDone(true)
      // Picks up "has a password" for someone who just set their first one.
      void api<Me>('GET', '/auth/me').then(applyMe).catch(() => {})
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }
  const status = done
    ? 'Changed just now. Your other devices were signed out.'
    : !hasPassword
      ? 'No password yet. You sign in with Google. Set one to sign in with your email too.'
      : user?.passwordChangedAt
        ? `Last changed ${ago(user.passwordChangedAt)}.`
        : live
          ? 'Set when you signed up.'
          : 'Last changed 3 months ago.'
  return (
    <Card className="p-5 sm:p-6">
      <div id="security" className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-fg">Password</div>
          <p className="mt-1 text-[13px] text-muted">{status}</p>
        </div>
        {!open && (
          <Button icon={<KeyRound className="size-4" />} onClick={() => (setOpen(true), setDone(false))}>
            {hasPassword ? 'Change password' : 'Set a password'}
          </Button>
        )}
      </div>
      {open && (
        <div className="rise mt-5 border-t border-line pt-5">
          <div className={cx('grid grid-cols-1 gap-4', hasPassword ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
            {hasPassword && (
              <Field label="Current password">
                <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
              </Field>
            )}
            <Field label="New password" error={short ? 'At least 10 characters' : undefined} hint="At least 10 characters.">
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus={!hasPassword} />
            </Field>
            <Field label="Confirm new password" error={mismatch ? "Doesn't match" : undefined}>
              <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
            {error && <Note bad>{error}</Note>}
            <Button onClick={reset}>Cancel</Button>
            <Button variant="primary" disabled={!can || busy} onClick={() => void submit()}>
              {busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** The code on top of the password: by email, or from an authenticator app. */
function TwoStep({ email }: { email: string }) {
  const { live } = useSession()
  const [how, setHow] = useState<'email' | 'app'>('email')
  const [pending, setPending] = useState(false)
  const [code, setCode] = useState('')
  const secret = 'JBSWY3DPEHPK3PXP'
  const option = (id: 'email' | 'app', title: string, sub: string, disabled?: boolean) => {
    const on = pending ? id === 'app' : how === id
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (id === how) return
          if (id === 'app') setPending(true)
          else {
            setHow('email')
            setPending(false)
          }
        }}
        className={cx('flex w-full items-start gap-3 rounded-[12px] border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60', on ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
      >
        <span className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>{on && <span className="size-1.5 rounded-full bg-white" />}</span>
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-fg">{title}</span>
          <span className="block truncate text-[12.5px] text-muted">{sub}</span>
        </span>
      </button>
    )
  }
  return (
    <Card className="p-5 sm:p-6">
      <div className="text-[15px] font-semibold text-fg">2-step sign-in</div>
      <p className="mt-1 text-[13px] text-muted">A code on top of your password, every time you sign in. It can't be turned off.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {option('email', 'Code by email', email)}
        {live ? option('app', 'Authenticator app', 'Next: Google Authenticator, 1Password, Authy', true) : option('app', 'Authenticator app', how === 'app' ? 'Set up and on' : 'Google Authenticator, 1Password, Authy')}
      </div>
      {pending && !live && (
        <div className="rise mt-4 flex flex-col gap-5 rounded-[12px] border border-line bg-[#FAFAF8] p-4 sm:flex-row sm:items-start">
          <div className="shrink-0 self-center rounded-[10px] bg-white p-2 sm:self-start">
            <Qr value={`otpauth://totp/Money%20Moves:${encodeURIComponent(email)}?secret=${secret}&issuer=Money%20Moves`} size={132} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-fg">Scan this with your app</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Or type the key in by hand, then enter the 6-digit code it shows.</p>
            <button onClick={() => copy(secret)} className="mt-2 flex items-center gap-1.5 rounded-[6px] bg-white px-2 py-1 font-mono text-[12.5px] text-fg ring-1 ring-line">
              {secret} <Copy className="size-3.5 text-dim" />
            </button>
            <div className="mt-3 flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" inputMode="numeric" className="w-32 font-mono tracking-[0.2em]" />
              <Button
                variant="primary"
                disabled={code.length !== 6}
                onClick={() => {
                  setHow('app')
                  setPending(false)
                  setCode('')
                }}
              >
                Turn on
              </Button>
              <Button variant="ghost" onClick={() => (setPending(false), setCode(''))}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

type Device = { id: string; device: string; where: string; when: string; mobile: boolean; here: boolean; google?: boolean }

/** "Chrome on Windows" from a browser's user-agent string - enough to recognise a device, nothing more. */
function describe(ua: string | null) {
  const s = ua ?? ''
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'A browser'
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'a device'
  return { device: `${browser} on ${os}`, mobile: /iPhone|Android|Mobile/.test(s) }
}

const SAMPLE_DEVICES: Device[] = [
  { id: 's1', device: 'Chrome on Windows', where: 'Lagos', when: 'Active now', mobile: false, here: true },
  { id: 's2', device: 'Safari on iPhone', where: 'Lagos', when: '2 days ago', mobile: true, here: false },
  { id: 's3', device: 'Chrome on Mac', where: 'Abuja', when: '9 days ago', mobile: false, here: false },
]

/** The devices signed in as this person - any one can be signed out. */
function Sessions() {
  const { live } = useSession()
  const [list, setList] = useState<Device[]>(live ? [] : SAMPLE_DEVICES)
  const [loading, setLoading] = useState(live)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!live) return
    api<{ sessions: { id: string; userAgent: string | null; ip: string | null; method: string; lastSeenAt: string; current: boolean }[] }>('GET', '/auth/sessions')
      .then((r) =>
        setList(
          r.sessions.map((s) => ({
            id: s.id,
            ...describe(s.userAgent),
            where: s.ip ?? 'Unknown address',
            when: s.current ? 'Active now' : `Last active ${ago(s.lastSeenAt)}`,
            here: s.current,
            google: s.method === 'google',
          })),
        ),
      )
      .catch((e) => setError(problem(e)))
      .finally(() => setLoading(false))
  }, [live])

  const signOutOne = async (id: string) => {
    setError('')
    try {
      if (live) await api('DELETE', `/auth/sessions/${id}`)
      setList((l) => l.filter((x) => x.id !== id))
    } catch (e) {
      setError(problem(e))
    }
  }
  const signOutOthers = async () => {
    setError('')
    try {
      if (live) await api('POST', '/auth/sessions/sign-out-others')
      setList((l) => l.filter((s) => s.here))
    } catch (e) {
      setError(problem(e))
    }
  }
  const others = list.filter((s) => !s.here)
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold text-fg">Where you're signed in</div>
          <p className="mt-1 text-[13px] text-muted">Don't recognise one? Sign it out and change your password.</p>
        </div>
        {others.length > 0 && (
          <Button size="sm" onClick={() => void signOutOthers()}>
            Sign out the others
          </Button>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Note bad>{error}</Note>
        </div>
      )}
      <ul className="mt-4 divide-y divide-soft border-t border-line">
        {loading && <li className="py-4 text-[13px] text-dim">Loading your devices…</li>}
        {list.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-muted">{s.mobile ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-[14px] text-fg">
                {s.device} {s.here && <Badge tone="good">This device</Badge>} {s.google && <Badge>Google</Badge>}
              </span>
              <span className="block text-[12.5px] text-dim">
                {s.where} · {s.when}
              </span>
            </span>
            {!s.here && (
              <button onClick={() => void signOutOne(s.id)} className="text-[13px] font-medium text-muted hover:text-red">
                Sign out
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ─── Referrals ────────────────────────────────────────────────────── */

type Stage = 'joined' | 'review' | 'verified' | 'paying'
type Referred = { id: string; name: string; joined: string; stage: Stage }

const REFERRED: Referred[] = [
  { id: 'r1', name: 'Lagos Prints Co.', joined: '2026-09-02', stage: 'paying' },
  { id: 'r2', name: 'Kola Logistics', joined: '2026-09-18', stage: 'verified' },
  { id: 'r3', name: 'Ada’s Kitchen', joined: '2026-10-04', stage: 'joined' },
]

const STAGE: Record<Stage, [string, Tone]> = {
  joined: ['Signed up', 'neutral'],
  review: ['Verifying', 'warn'],
  verified: ['Verified', 'info'],
  paying: ['Taking payments', 'good'],
}

/** Your link, and each business that signed up with it. Live from the API; in preview, samples. */
export function Referrals() {
  const { business, user } = useSession()
  const allowed = useCan()('referrals')
  const live = useApi<{ code: string; link: string; businesses: { name: string; joinedAt: string; stage: Stage }[] }>(LIVE && business && allowed ? `/businesses/${business.id}/referrals` : null)
  if (LIVE && !allowed) {
    return (
      <>
        <PageHeader title="Referrals" sub="Invite businesses to Money Moves, and see how they're getting on." />
        <Empty title="Referrals are for the owner and admins." sub="Ask the owner or an admin for this business's referral link." />
      </>
    )
  }
  if (LIVE && !live.data) {
    return (
      <>
        <PageHeader title="Referrals" sub="Invite businesses to Money Moves, and see how they're getting on." />
        {live.error ? <Empty title="Couldn't load your referrals." sub={live.error.message} /> : <div className="h-40 animate-pulse rounded-[12px] bg-raise" />}
      </>
    )
  }
  const url = LIVE ? live.data!.link : `https://business.usemoneymoves.xyz/signup?ref=${(user?.first ?? 'friend').toUpperCase()}`
  const rows: Referred[] = LIVE ? live.data!.businesses.map((x, i) => ({ id: String(i), name: x.name, joined: x.joinedAt, stage: x.stage })) : REFERRED
  return <ReferralsView url={url} code={LIVE ? live.data!.code : null} rows={rows} />
}

function ReferralsView({ url, code, rows }: { url: string; code: string | null; rows: Referred[] }) {
  const [copied, setCopied] = useState(false)
  const shown = url.replace(/^https?:\/\//, '')
  const text = encodeURIComponent(`I take payments with Money Moves: bank transfers, crypto and the Money Moves app, in one checkout. Sign up with my link: ${url}`)
  return (
    <>
      <PageHeader title="Referrals" sub="Invite businesses to Money Moves, and see how they're getting on." />

      <Card className="p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">Your link</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <div className="flex h-11 min-w-0 flex-1 items-center rounded-[10px] border border-line bg-[#FAFAF8] px-3.5 font-mono text-[13.5px] text-fg">
                <span className="truncate">{shown}</span>
              </div>
              <Button
                variant="primary"
                className="h-11 px-4"
                icon={copied ? <Check className="size-4" strokeWidth={3} /> : <Copy className="size-4" />}
                onClick={() => {
                  copy(url)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <span className="text-dim">Share on</span>
              <a href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                WhatsApp
              </a>
              <a href={`https://x.com/intent/post?text=${text}`} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                X
              </a>
              <a href={`mailto:?subject=${encodeURIComponent('Take payments with Money Moves')}&body=${text}`} className="font-medium text-accent hover:underline">
                Email
              </a>
              {code && (
                <span className="text-dim">
                  Code <span className="font-mono font-medium text-fg">{code}</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-8 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            {[
              ['Invited', rows.length],
              ['Verified', rows.filter((r) => r.stage === 'verified' || r.stage === 'paying').length],
              ['Taking payments', rows.filter((r) => r.stage === 'paying').length],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-[12.5px] text-muted">{l}</div>
                <div className="display tabular mt-1 text-[24px] font-semibold leading-none text-fg">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[300px_1fr]">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">How it works</h2>
          <ol className="mt-3 space-y-4">
            {[
              ['They sign up with your link', 'Any business, registered or a freelancer. Or they type your code when they sign up.'],
              ['They get verified', 'Business verification, the same as you did.'],
              ['They start taking payments', 'You see each step here as it happens.'],
            ].map(([t, s], i) => (
              <li key={t} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-[12px] font-semibold text-fg">{i + 1}</span>
                <span>
                  <span className="block text-[13.5px] font-medium text-fg">{t}</span>
                  <span className="block text-[12.5px] leading-relaxed text-muted">{s}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0">
          <h2 className="mb-3 text-[15px] font-semibold text-fg">Businesses you invited</h2>
          <Table
            rowKey={(r) => r.id}
            rows={rows}
            empty={<Empty title="Nobody yet." sub="Share your link. Each business that signs up with it shows here, and moves along as it gets verified and starts taking payments." />}
            columns={[
              {
                key: 'n',
                header: 'Business',
                render: (r) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} size={28} square />
                    <span className="font-medium">{r.name}</span>
                  </div>
                ),
              },
              { key: 'j', header: 'Joined', render: (r) => <span className="text-muted">{date(r.joined)}</span> },
              { key: 's', header: 'Status', align: 'right', render: (r) => <Badge tone={STAGE[r.stage][1]}>{STAGE[r.stage][0]}</Badge> },
            ]}
          />
        </div>
      </div>
    </>
  )
}
