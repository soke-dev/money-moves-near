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
import { useSearchParams } from 'react-router-dom'
import { UnderlineTabs } from '@/components/table'
import { Avatar } from '@/components/brand'
import { Badge, Button, Card, Field, Input, PageHeader, cx, type Tone } from '@/components/ui'
import Qr from '@/components/Qr'
import { useSession } from '@/state/session'
import { ago, copy, date } from '@/lib/format'
import { ApiError, LIVE, api, type Me } from '@/lib/api'
import { Empty } from '@/components/ui'
import { BusinessMark, PhotoControl } from '@/components/Pictures'
import { useCan } from '@/state/roles'
import { reload, useApi } from '@/lib/useApi'

const problem = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')

function Note({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return (
    <span className={cx('flex items-center gap-1.5 text-[13px]', bad ? 'text-red' : 'text-good')}>
      {!bad && <Check className="size-4" strokeWidth={3} />}
      {children}
    </span>
  )
}

type ProfileTab = 'details' | 'security' | 'referrals'

/**
 * You: your details and businesses, how you sign in, and the businesses this
 * one has invited, each a tab of its own.
 */
export function Profile() {
  const { user } = useSession()
  const allowed = useCan()('referrals')
  const [params, setParams] = useSearchParams()
  const asked = params.get('tab')
  const tab: ProfileTab = asked === 'security' ? 'security' : asked === 'referrals' && allowed ? 'referrals' : 'details'
  if (!user) return null
  const tabs: { id: ProfileTab; label: string }[] = [
    { id: 'details', label: 'Profile' },
    { id: 'security', label: 'Security' },
    ...(allowed ? [{ id: 'referrals' as const, label: 'Referrals' }] : []),
  ]
  return (
    <>
      <PageHeader title="Profile" sub="You, not the business. Your details and how you sign in follow you to every business you're part of." />
      <UnderlineTabs tabs={tabs} value={tab} onChange={(t) => setParams(t === 'details' ? {} : { tab: t }, { replace: true })} />
      <div className="mt-6">
        {tab === 'details' && <ProfileDetails />}
        {tab === 'security' && (
          <div className="max-w-[760px] space-y-5">
            <Password />
            <TwoStep email={user.email} />
            <Sessions />
          </div>
        )}
        {tab === 'referrals' && <Referrals embedded />}
      </div>
    </>
  )
}

/** Your name, email and phone, and the businesses you're part of. */
function ProfileDetails() {
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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
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
              <div className="sm:col-span-2">
                <Field label="Email" hint="You sign in with this. Changing it needs a code sent to both addresses.">
                  <div className="flex h-10 items-center gap-2 rounded-[7px] border border-line bg-raise px-3 text-[14px] text-muted">
                    <Mail className="size-4 shrink-0 text-dim" />
                    <span className="min-w-0 flex-1 truncate">{user.email}</span>
                    <Badge tone="good">Verified</Badge>
                  </div>
                </Field>
              </div>
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

/**
 * The code on top of the password: by email, or from an authenticator app.
 * Turning the app on is scan, then one code to prove it works, then ten
 * recovery codes shown once. Turning it off takes a code from the app.
 */
function TwoStep({ email }: { email: string }) {
  const { live, user, applyMe, business } = useSession()
  const on = live ? user?.twoStep === 'APP' : false
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [action, setAction] = useState<'off' | 'recovery' | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const start = () =>
    run(async () => {
      if (!live) {
        setSetup({ secret: 'JBSWY3DPEHPK3PXP', uri: `otpauth://totp/Money%20Moves:${encodeURIComponent(email)}?secret=JBSWY3DPEHPK3PXP&issuer=Money%20Moves` })
        return
      }
      setSetup(await api<{ secret: string; uri: string }>('POST', '/auth/me/two-step/app/start'))
      setCode('')
    })
  const confirm = () =>
    run(async () => {
      if (!live) return
      const r = await api<Me & { recoveryCodes: string[] }>('POST', '/auth/me/two-step/app/confirm', { code })
      applyMe(r)
      setSetup(null)
      setCode('')
      setCodes(r.recoveryCodes)
      // A team that asks for the app opens again now.
      if (business) void reload(`/businesses/${business.id}`)
    })
  const finish = () =>
    run(async () => {
      if (action === 'off') {
        applyMe(await api<Me>('POST', '/auth/me/two-step/email', { code }))
        setAction(null)
      } else {
        const r = await api<Me & { recoveryCodes: string[] }>('POST', '/auth/me/two-step/recovery', { code })
        applyMe(r)
        setAction(null)
        setCodes(r.recoveryCodes)
      }
      setCode('')
    })
  const save = () => {
    const blob = new Blob([`Money Moves Business recovery codes for ${email}\nEach works once, if you lose your phone.\n\n${(codes ?? []).join('\n')}\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'money-moves-recovery-codes.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-fg">2-step sign-in</div>
          <p className="mt-1 text-[13px] text-muted">A code on top of your password, every time you sign in. It can't be turned off, only moved to an app.</p>
        </div>
        <Badge tone={on ? 'good' : 'neutral'}>{on ? 'Authenticator app' : 'Code by email'}</Badge>
      </div>

      {codes ? (
        <div className="rise mt-4 rounded-[12px] border border-line bg-[#FAFAF8] p-4">
          <div className="text-[14px] font-semibold text-fg">Save your recovery codes</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">If you lose your phone, each of these signs you in once. Keep them somewhere safe, away from your phone. They won't be shown again.</p>
          <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-[10px] bg-white p-3 font-mono text-[13.5px] text-fg ring-1 ring-line sm:grid-cols-5">
            {codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(codes.join('\n'))}>
              Copy
            </Button>
            <Button size="sm" onClick={save}>
              Download
            </Button>
            <Button size="sm" variant="primary" onClick={() => setCodes(null)}>
              I've saved them
            </Button>
          </div>
        </div>
      ) : setup ? (
        <div className="rise mt-4 flex flex-col gap-5 rounded-[12px] border border-line bg-[#FAFAF8] p-4 sm:flex-row sm:items-start">
          <div className="shrink-0 self-center sm:self-start">
            <Qr value={setup.uri} size={148} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-medium text-fg">Scan this with your authenticator app</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Google Authenticator, 1Password, Authy or Microsoft Authenticator. Or type the key in by hand, then enter the 6-digit code it shows.</p>
            <button onClick={() => copy(setup.secret)} className="mt-2 flex max-w-full items-center gap-1.5 break-all rounded-[6px] bg-white px-2 py-1 text-left font-mono text-[12.5px] text-fg ring-1 ring-line">
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()} <Copy className="size-3.5 shrink-0 text-dim" />
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" inputMode="numeric" autoComplete="one-time-code" className="w-32 font-mono tracking-[0.2em]" autoFocus />
              <Button variant="primary" disabled={code.length !== 6 || busy || !live} onClick={() => void confirm()}>
                {busy ? 'Checking…' : 'Turn on'}
              </Button>
              <Button variant="ghost" onClick={() => (setSetup(null), setCode(''), setError(''))}>
                Cancel
              </Button>
            </div>
            {error && <p className="mt-2 text-[12.5px] text-red">{error}</p>}
          </div>
        </div>
      ) : action ? (
        <div className="rise mt-4 rounded-[12px] border border-line bg-[#FAFAF8] p-4">
          <div className="text-[14px] font-medium text-fg">{action === 'off' ? 'Go back to codes by email' : 'Make new recovery codes'}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {action === 'off' ? 'Enter a code from your app, or a recovery code, to confirm it’s you.' : 'Enter a code from your app. Your old recovery codes stop working.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))} placeholder="123456" autoComplete="one-time-code" className="w-36 font-mono tracking-[0.15em]" autoFocus />
            <Button variant="primary" disabled={code.length < 6 || busy} onClick={() => void finish()}>
              {busy ? 'Checking…' : action === 'off' ? 'Turn the app off' : 'Make new codes'}
            </Button>
            <Button variant="ghost" onClick={() => (setAction(null), setCode(''), setError(''))}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-[12.5px] text-red">{error}</p>}
        </div>
      ) : on ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3">
          <div className="min-w-0 text-[13px] text-muted">
            Signing in asks for your app's code. {user?.recoveryLeft != null && <span>{user.recoveryLeft} recovery code{user.recoveryLeft === 1 ? '' : 's'} left.</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAction('recovery')}>
              New recovery codes
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAction('off')}>
              Use email instead
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line px-4 py-3">
          <div className="min-w-0 text-[13px] text-muted">
            Codes go to <span className="font-medium text-fg">{email}</span>. An authenticator app is safer: someone who gets into your email still can't sign in.
          </div>
          <Button size="sm" variant="primary" icon={<Smartphone className="size-3.5" />} disabled={busy} onClick={() => void start()}>
            Use an authenticator app
          </Button>
          {error && <p className="w-full text-[12.5px] text-red">{error}</p>}
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
export function Referrals({ embedded = false }: { embedded?: boolean }) {
  const { business, user } = useSession()
  const allowed = useCan()('referrals')
  const live = useApi<{ code: string; link: string; businesses: { name: string; joinedAt: string; stage: Stage }[] }>(LIVE && business && allowed ? `/businesses/${business.id}/referrals` : null)
  if (LIVE && !allowed) {
    return (
      <>
        {!embedded && <PageHeader title="Referrals" sub="Invite businesses to Money Moves, and see how they're getting on." />}
        <Empty title="Referrals are for the owner and admins." sub="Ask the owner or an admin for this business's referral link." />
      </>
    )
  }
  if (LIVE && !live.data) {
    return (
      <>
        {!embedded && <PageHeader title="Referrals" sub="Invite businesses to Money Moves, and see how they're getting on." />}
        {live.error ? <Empty title="Couldn't load your referrals." sub={live.error.message} /> : <div className="h-40 animate-pulse rounded-[12px] bg-raise" />}
      </>
    )
  }
  const url = LIVE ? live.data!.link : `https://business.usemoneymoves.xyz/signup?ref=${(user?.first ?? 'friend').toUpperCase()}`
  const rows: Referred[] = LIVE ? live.data!.businesses.map((x, i) => ({ id: String(i), name: x.name, joined: x.joinedAt, stage: x.stage })) : REFERRED
  return <ReferralsView url={url} code={LIVE ? live.data!.code : null} rows={rows} embedded={embedded} />
}

/** The stages in order, and how far along each business is. */
const STAGES: Stage[] = ['joined', 'review', 'verified', 'paying']
const reached = (r: Referred, s: Stage) => STAGES.indexOf(r.stage) >= STAGES.indexOf(s)
const FUNNEL: { stage: Stage; label: string; sub: string }[] = [
  { stage: 'joined', label: 'Signed up', sub: 'Opened an account with your link or code' },
  { stage: 'review', label: 'Verifying', sub: 'Sent their verification' },
  { stage: 'verified', label: 'Verified', sub: 'Approved by our review team' },
  { stage: 'paying', label: 'Taking payments', sub: 'Had their first payment' },
]

function ReferralsView({ url, code, rows, embedded }: { url: string; code: string | null; rows: Referred[]; embedded?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [show, setShow] = useState<Stage | 'all'>('all')
  const shown = url.replace(/^https?:\/\//, '')
  const text = encodeURIComponent(`I take payments with Money Moves: bank transfers, crypto and the Money Moves app, in one checkout. Sign up with my link: ${url}`)
  const copyLink = () => {
    copy(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const count = (s: Stage) => rows.filter((r) => reached(r, s)).length
  const list = show === 'all' ? rows : rows.filter((r) => r.stage === show)
  // Sign-ups in each of the last six months, this one last.
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1))
    const key = d.toISOString().slice(0, 7)
    return { key, label: d.toLocaleDateString('en-GB', { month: 'short' }), n: rows.filter((r) => r.joined.slice(0, 7) === key).length }
  })
  const most = Math.max(1, ...months.map((m) => m.n))

  return (
    <>
      {embedded ? (
        <p className="mb-5 max-w-[70ch] text-[13.5px] text-muted">Invite other businesses to Money Moves, and follow each one from sign-up to its first payment.</p>
      ) : (
      <PageHeader
        title="Referrals"
        sub="Invite other businesses to Money Moves, and follow each one from sign-up to its first payment."
        actions={
          <Button variant="primary" icon={copied ? <Check className="size-4" strokeWidth={3} /> : <Copy className="size-4" />} onClick={copyLink}>
            {copied ? 'Copied' : 'Copy your link'}
          </Button>
        }
      />
      )}

      {/* The link, the ways to share it, and a code to scan. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0 p-5 sm:p-6">
            <div className="text-[13px] text-muted">Your link</div>
            <button onClick={copyLink} className="group mt-2 flex h-11 w-full min-w-0 items-center gap-3 rounded-[10px] border border-line bg-raise px-3.5 text-left transition hover:border-[#D3D0C7]">
              <span className="min-w-0 flex-1 truncate font-mono text-[13.5px] text-fg">{shown}</span>
              <span className="shrink-0 text-[12.5px] font-medium text-muted group-hover:text-fg">{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="text-[12.5px] text-dim">Share it</div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
                  <a href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer" className="font-medium text-fg underline-offset-2 hover:underline">
                    WhatsApp
                  </a>
                  <a href={`https://x.com/intent/post?text=${text}`} target="_blank" rel="noreferrer" className="font-medium text-fg underline-offset-2 hover:underline">
                    X
                  </a>
                  <a href={`mailto:?subject=${encodeURIComponent('Take payments with Money Moves')}&body=${text}`} className="font-medium text-fg underline-offset-2 hover:underline">
                    Email
                  </a>
                </div>
              </div>
              {code && (
                <div>
                  <div className="text-[12.5px] text-dim">Or they type your code at sign-up</div>
                  <div className="mt-1 font-mono text-[17px] font-semibold tracking-[0.08em] text-fg">{code}</div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 border-t border-line bg-raise/50 p-5 md:flex-col md:justify-center md:border-l md:border-t-0">
            <div className="rounded-[10px] bg-white p-2 shadow-[0_0_0_1px_#E6E4DE]">
              <Qr value={url} size={128} />
            </div>
            <p className="text-[12.5px] leading-relaxed text-dim md:text-center">Scan to open your sign-up link, at a market, an event or a shop counter.</p>
          </div>
        </div>
      </Card>

      {/* How far your invites have come. */}
      <Card className="mt-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[14px] font-semibold text-fg">How far they've come</div>
          <div className="text-[12.5px] text-dim">{rows.length ? `${Math.round((count('paying') / rows.length) * 100)}% of sign-ups now take payments` : 'Nobody yet'}</div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
          {FUNNEL.map((f, i) => {
            const n = count(f.stage)
            const prev = i === 0 ? n : count(FUNNEL[i - 1]!.stage)
            return (
              <div key={f.stage} className="min-w-0">
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="tabular flex size-5 items-center justify-center rounded-full border border-line text-[11px] font-semibold text-fg">{i + 1}</span>
                  {f.label}
                </div>
                <div className="display tabular mt-2 text-[28px] font-semibold leading-none tracking-[-0.02em] text-fg">{n}</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-raise">
                  <div className={cx('h-full rounded-full', i === FUNNEL.length - 1 ? 'bg-lime' : 'bg-fg')} style={{ width: `${rows.length ? (n / rows.length) * 100 : 0}%` }} />
                </div>
                <div className="mt-2 text-[12px] leading-snug text-dim">{i === 0 ? f.sub : prev ? `${Math.round((n / prev) * 100)}% of the step before` : f.sub}</div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* When they joined. */}
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-[14px] font-semibold text-fg">Sign-ups</div>
            <div className="text-[12px] text-dim">Last 6 months</div>
          </div>
          <div className="mt-4 flex h-[96px] items-end gap-2">
            {months.map((m, i) => (
              <div key={m.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="tabular text-[11px] text-dim">{m.n || ''}</span>
                <div className={cx('w-full rounded-t-[4px]', i === months.length - 1 ? 'bg-lime' : 'bg-fg/80')} style={{ height: `${Math.max(m.n ? 8 : 2, (m.n / most) * 64)}px`, opacity: m.n ? 1 : 0.15 }} />
                <span className="text-[11px] text-dim">{m.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* How it works. */}
        <Card className="p-5">
          <div className="text-[14px] font-semibold text-fg">How it works</div>
          <ol className="relative mt-4 space-y-4 border-l border-line pl-5">
            {[
              ['They sign up with your link', 'Any business, registered or a freelancer. Or they type your code when they sign up.'],
              ['They get verified', 'The same business verification you went through.'],
              ['They take their first payment', 'Each step shows here as it happens.'],
            ].map(([t, s]) => (
              <li key={t} className="relative">
                <span className="absolute -left-[25px] top-1 size-2 rounded-full border-2 border-card bg-fg shadow-[0_0_0_1px_var(--color-line)]" />
                <span className="block text-[13.5px] font-medium text-fg">{t}</span>
                <span className="block text-[12.5px] leading-relaxed text-muted">{s}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* Each business, and where it is. */}
      <Card className="mt-5 min-w-0 overflow-hidden">
        <div className="px-5 pt-5 sm:px-6">
          <div className="text-[14px] font-semibold text-fg">Businesses you invited</div>
        </div>
        <div className="no-scrollbar mt-3 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line px-5 sm:px-6">
          {([['all', 'All', rows.length], ...FUNNEL.map((f) => [f.stage, f.label, rows.filter((r) => r.stage === f.stage).length])] as [Stage | 'all', string, number][]).map(([id, label, n]) => (
            <button key={id} onClick={() => setShow(id)} className={cx('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 text-[13.5px] transition', show === id ? 'border-fg font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}>
              {label}
              <span className="tabular text-[12px] font-normal text-dim">{n}</span>
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="text-[14px] font-medium text-fg">{rows.length ? 'None at this step.' : 'Nobody yet.'}</div>
            <p className="mx-auto mt-1 max-w-[44ch] text-[13px] text-muted">
              {rows.length ? 'Pick another step to see the rest.' : 'Share your link. Each business that signs up with it shows here, and moves along as it gets verified and starts taking payments.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-soft">
            {list.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_180px_130px] sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={r.name} size={30} square />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{r.name}</span>
                    <span className="block text-[12px] text-dim">Joined {date(r.joined)}</span>
                  </span>
                </div>
                <div className="col-span-2 flex items-center gap-1 sm:col-span-1" aria-label={`${STAGE[r.stage][0]}, step ${STAGES.indexOf(r.stage) + 1} of 4`}>
                  {STAGES.map((s) => (
                    <span key={s} className={cx('h-1.5 flex-1 rounded-full', reached(r, s) ? (r.stage === 'paying' ? 'bg-lime' : 'bg-fg') : 'bg-raise')} />
                  ))}
                </div>
                <div className="col-start-2 row-start-1 text-right sm:col-start-auto sm:row-start-auto">
                  <Badge tone={STAGE[r.stage][1]}>{STAGE[r.stage][0]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </>
  )
}
