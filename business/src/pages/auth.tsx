/**
 * Getting in: sign up, log in, pick the business, prove it is you.
 *
 * Live, every step talks to the API: a six-digit code confirms the email at
 * sign-up and follows the password at every sign-in (2-step, always on), or
 * Google stands in for both. In preview (`?demo=` and design work) the same
 * screens run on sample data and any six digits work.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { inviteFrom, keepReferral, referralCode } from '@/state/referral'
import { ArrowLeft, ArrowRight, Check, Mail, Plus, Smartphone } from '@/components/icons'
import AuthLayout, { Scribble } from '@/layouts/AuthLayout'
import { useSession } from '@/state/session'
import { Avatar, Logo } from '@/components/brand'
import { Button, Checkbox, Field, Input, OtpInput, PasswordInput, SearchBox, Select, cx } from '@/components/ui'
import { GoogleSignIn } from '@/components/GoogleSignIn'
import { ApiError, api, type Challenge, type Me, isChallenge } from '@/lib/api'

/* ─── Shared pieces ────────────────────────────────────────────────── */

const RULES: [string, (p: string) => boolean][] = [
  ['10+ characters', (p) => p.length >= 10],
  ['A capital', (p) => /[A-Z]/.test(p)],
  ['A number', (p) => /\d/.test(p)],
  ['A symbol', (p) => /[^A-Za-z0-9]/.test(p)],
]

/** What to show when a call fails: the API's own words, or a calm fallback. */
const problem = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')

function CardTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">{title}</h1>
      {sub && <p className="mt-1.5 text-[14.5px] leading-relaxed text-muted">{sub}</p>}
    </div>
  )
}

function Problem({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="mt-5 rounded-lg border border-[#EFC4C0] bg-[#FBEAE8] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#7D1F19]">{children}</div>
}

const STEP_NAMES = ['You', 'Confirm email', 'Your business']

function Steps({ step, skipped }: { step: 1 | 2 | 3; skipped?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[12.5px] font-medium text-dim">
      {STEP_NAMES.map((name, i) => {
        const n = i + 1
        const done = n < step || n === skipped
        const now = n === step
        return (
          <span key={name} className="flex items-center gap-2.5">
            {i > 0 && <span className="h-px w-5 bg-line" />}
            <span className={cx('flex items-center gap-2', (now || done) && 'text-fg')}>
              <span
                className={cx(
                  'flex size-5 items-center justify-center rounded-full text-[11px]',
                  done ? 'bg-lime text-fg' : now ? 'bg-fg text-white' : 'bg-raise text-dim',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : n}
              </span>
              {name}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** Google's own mark, in its own colours - it is their button, not ours. */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px] shrink-0" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

/** Preview stand-in for Google's button. Live, Google draws its own (GoogleSignIn). */
function PreviewGoogleButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-card text-[14.5px] font-medium text-fg shadow-[0_1px_0_rgba(18,18,16,0.04)] transition hover:border-[#CFCCC3] hover:bg-[#FAF9F6]"
    >
      <GoogleG />
      {label}
    </button>
  )
}

function Or({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-[12.5px] text-dim">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function HaveAccount() {
  return (
    <p className="mt-5 text-center text-[13.5px] text-muted">
      Already have an account?{' '}
      <Link to="/login" className="font-semibold text-fg underline underline-offset-4">
        Log in
      </Link>
    </p>
  )
}

function BackLink({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
      <ArrowLeft className="size-3.5" /> {label}
    </button>
  )
}

/** A countdown before "send a new code" is offered again. */
function useResendClock(running: boolean) {
  const [left, setLeft] = useState(59)
  useEffect(() => {
    if (!running || left <= 0) return
    const t = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [running, left])
  return { left, restart: () => setLeft(59) }
}

function ResendLine({ left, onResend, busy }: { left: number; onResend: () => void; busy?: boolean }) {
  return (
    <p className="mt-5 text-center text-[13.5px] text-muted">
      {left > 0 ? (
        <>
          Didn't get it? Send a new code in <span className="tabular font-medium text-fg">0:{left.toString().padStart(2, '0')}</span>
        </>
      ) : (
        <button type="button" disabled={busy} className="font-semibold text-fg underline underline-offset-4 disabled:opacity-50" onClick={onResend}>
          Send a new code
        </button>
      )}
    </p>
  )
}

/** After any sign-in: no business yet, one, or several to pick from. */
function useAfterSignIn() {
  const { openBusiness } = useSession()
  return (me: Me) => (me.businesses.length === 0 ? '/business/new' : me.businesses.length === 1 ? openBusiness(me.businesses[0]!.id) : '/select-business')
}

/* ─── Sign up: you, confirm your email, your business ─────────────── */

export function SignUp() {
  const { live, user, applyMe, addBusiness, signUp, confirmOtp } = useSession()
  const navigate = useNavigate()
  const afterSignIn = useAfterSignIn()
  /** Sent over from log in, when that email had no account. */
  const fromLogin = (useLocation().state as { email?: string } | null)?.email ?? ''
  const [params] = useSearchParams()
  // Joining a team: they don't make a business of their own, the invite takes them in.
  const invite = inviteFrom(params)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [f, setF] = useState(() => {
    const ref = params.get('ref')
    if (ref) keepReferral(ref)
    return { country: 'NG', first: '', last: '', email: params.get('email') ?? fromLogin, password: '', confirm: '', business: '', referral: ref?.toUpperCase() ?? referralCode() ?? '' }
  })
  const [kind, setKind] = useState<'REGISTERED' | 'INDIVIDUAL'>('REGISTERED')
  /** Signed up through Google: the email is already confirmed, and there is no password to set. */
  const [viaGoogle, setViaGoogle] = useState(false)
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [terms, setTerms] = useState(false)
  const [news, setNews] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clock = useResendClock(step === 2)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  const passed = RULES.filter(([, t]) => t(f.password)).length
  const mismatch = f.confirm.length > 0 && f.confirm !== f.password
  // No name here: it is read off their ID during verification, so asking now
  // would only be asking twice.
  const stepOk = /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && passed >= 3 && f.confirm === f.password
  // No phone either: onboarding asks for it, next to the business address.
  const ready = f.business.trim().length >= 2 && terms

  // Already signed in (live) and just landing here: nothing to sign up for.
  if (live && user && step === 1 && !busy) return <Navigate to={invite ? `/invite/${invite}` : '/'} replace />

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      if (live) setChallenge((await api<Challenge>('POST', '/auth/signup', { email: f.email, password: f.password })).challenge)
      setCode('')
      clock.restart()
      setStep(2)
    })

  const confirmEmail = () =>
    run(async () => {
      if (live) {
        const me = await api<Me>('POST', '/auth/signup/verify', { challenge, code })
        applyMe(me)
        if (invite) return navigate(`/invite/${invite}`)
        // Someone finishing an old sign-up who already has a business goes straight to it.
        if (me.businesses.length) return navigate(afterSignIn(me))
      }
      setStep(3)
    })

  const google = (idToken: string) =>
    run(async () => {
      const r = await api<Me | Challenge>('POST', '/auth/google', { idToken })
      if (isChallenge(r)) return navigate(`/login${invite ? `?invite=${invite}` : ''}`, { state: { appChallenge: r.challenge } })
      const me = r
      applyMe(me)
      if (invite) return navigate(`/invite/${invite}`)
      if (me.businesses.length) return navigate(afterSignIn(me))
      setF((p) => ({ ...p, email: me.user.email }))
      setViaGoogle(true)
      setStep(3)
    })

  const finish = () =>
    run(async () => {
      if (live) return navigate(await addBusiness({ name: f.business.trim(), kind, ref: f.referral.trim() || undefined }))
      // Preview: until verification fills in the real name, greet them by their email.
      const handle = f.email.split('@')[0] ?? ''
      signUp({ first: f.first || handle.charAt(0).toUpperCase() + handle.slice(1), last: f.last, email: f.email, phone: '', businessName: f.business })
      // The email is already confirmed, so the new business opens straight away.
      confirmOtp()
      navigate('/onboarding')
    })

  const useEmailInstead = () => {
    setViaGoogle(false)
    setF((p) => ({ ...p, first: '', last: '', email: '' }))
  }

  return (
    <AuthLayout
      headline={<>Take money <Scribble>any way</Scribble> it comes.</>}
      aside={
        <>
          <span className="hidden sm:inline">Already have an account? </span>
          <Link to="/login" className="font-semibold text-fg underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <Steps step={step} skipped={viaGoogle && step === 3 ? 2 : undefined} />

      {/* ─ 1. You ─ */}
      {step === 1 &&
        (viaGoogle ? (
          <div>
            <CardTitle title="Create your account" sub="You're signing up with Google." />
            <div className="mt-7 flex items-center gap-3 rounded-lg border border-line px-4 py-3.5">
              <GoogleG />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-fg">{f.email}</div>
                <div className="text-[12.5px] text-dim">Confirmed by Google. No password needed</div>
              </div>
            </div>
            <Button variant="primary" size="lg" full className="mt-7" onClick={() => setStep(3)} icon={<ArrowRight className="size-4" />}>
              Continue
            </Button>
            <button type="button" onClick={useEmailInstead} className="mt-4 w-full text-center text-[13.5px] font-medium text-muted underline underline-offset-4 hover:text-fg">
              Use an email and password instead
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (stepOk && !busy) void sendCode()
            }}
          >
            <CardTitle title="Create your account" sub="Let's get started. It's free to open." />
            <div className="mt-7">
              {live ? (
                <GoogleSignIn text="signup_with" onCredential={(t) => void google(t)} onError={setError} />
              ) : (
                <PreviewGoogleButton
                  label="Sign up with Google"
                  onClick={() => {
                    // Preview: stands in for Google's consent screen.
                    setF((p) => ({ ...p, first: 'Chris', last: 'Okotete', email: 'owner@example.com' }))
                    setViaGoogle(true)
                    setStep(3)
                  }}
                />
              )}
            </div>
            <Or label="or sign up with your email" />
            <div className="space-y-4">
              <Field
                label="Country"
                hint="Other countries are coming."
              >
                <Select value={f.country} onChange={set('country')}>
                  <option value="NG">Nigeria</option>
                </Select>
              </Field>
              <Field label="Email address">
                <Input type="email" value={f.email} onChange={set('email')} placeholder="name@email.com" autoComplete="email" autoFocus />
              </Field>
              <Field label="Choose a password">
                <PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" />
              </Field>
              <div className="-mt-1 flex flex-wrap gap-1.5">
                {RULES.map(([label, test]) => (
                  <span
                    key={label}
                    className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition', test(f.password) ? 'bg-lime text-fg' : 'bg-raise text-dim')}
                  >
                    {test(f.password) && <Check className="size-3" strokeWidth={3} />}
                    {label}
                  </span>
                ))}
              </div>
              <Field label="Confirm password" error={mismatch ? "The passwords don't match." : undefined}>
                <PasswordInput value={f.confirm} onChange={set('confirm')} autoComplete="new-password" />
              </Field>
            </div>
            <Problem>{error}</Problem>
            <Button type="submit" variant="primary" size="lg" full className="mt-7" disabled={!stepOk || busy} icon={<ArrowRight className="size-4" />}>
              {busy ? 'Sending your code…' : 'Continue'}
            </Button>
            <HaveAccount />
          </form>
        ))}

      {/* ─ 2. Confirm email ─ */}
      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length === 6 && !busy) void confirmEmail()
          }}
        >
          <BackLink onClick={() => setStep(1)} label="Change email" />
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-lime text-fg">
              <Mail className="size-5" />
            </span>
            <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">Check your email</h1>
          </div>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">
            We sent a six-digit code to <span className="font-medium text-fg">{f.email}</span>. Enter it to confirm the address is yours.
          </p>
          <div className="mt-7">
            <OtpInput value={code} onChange={setCode} />
          </div>
          <Problem>{error}</Problem>
          <Button type="submit" variant="primary" size="lg" full className="mt-6" disabled={code.length < 6 || busy}>
            {busy ? 'Checking…' : 'Confirm email'}
          </Button>
          <ResendLine left={clock.left} busy={busy} onResend={() => void sendCode()} />
          <p className="mt-6 text-center text-[12.5px] text-dim">
            Check your spam folder if it isn't there. The code works for 10 minutes.{!live && ' Preview: any six digits work.'}
          </p>
        </form>
      )}

      {/* ─ 3. Your business ─ */}
      {step === 3 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (ready && !busy) void finish()
          }}
        >
          {!live && <BackLink onClick={() => setStep(viaGoogle ? 1 : 2)} />}
          <CardTitle title="About your business" sub="You can add more businesses to this login later." />
          <div className="mt-5 flex items-center gap-2.5 rounded-lg bg-raise px-3.5 py-2.5 text-[13px] text-muted">
            {viaGoogle ? <GoogleG /> : <Check className="size-4 text-good" strokeWidth={3} />}
            <span className="min-w-0 truncate">
              <span className="font-medium text-fg">{f.email || user?.email}</span> {viaGoogle ? 'via Google' : 'confirmed'}
            </span>
          </div>
          <div className="mt-6 space-y-4">
            <Field label="Business or brand name" hint="Selling as yourself? Your own name works. You can add CAC details later.">
              <Input value={f.business} onChange={set('business')} placeholder="Movers Digital" autoFocus />
            </Field>
            <div>
              <div className="mb-1.5 text-[13px] font-medium text-fg">This business is</div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['REGISTERED', 'Registered', 'A company with CAC papers'],
                    ['INDIVIDUAL', 'Just me', 'A freelancer or sole trader'],
                  ] as const
                ).map(([id, label, sub]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={cx('rounded-lg border px-3 py-2.5 text-left transition', kind === id ? 'border-fg shadow-[0_0_0_1px_#121210]' : 'border-line hover:border-[#D3D0C7]')}
                  >
                    <span className="block text-[13.5px] font-semibold text-fg">{label}</span>
                    <span className="block text-[12px] text-dim">{sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Referral code" optional>
              <Input value={f.referral} onChange={set('referral')} placeholder="Enter a referral code" />
            </Field>
            <div className="space-y-2.5 pt-1">
              <Checkbox checked={news} onChange={setNews}>
                Send me news, offers and product updates. I can opt out any time.
              </Checkbox>
              <Checkbox checked={terms} onChange={setTerms}>
                I agree to the <a href="/legal/terms" target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">terms of service</a> (our merchant agreement),{' '}
                <a href="/legal/prohibited" target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">prohibited businesses</a> and{' '}
                <a href="/legal/privacy" target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">privacy policy</a>.
              </Checkbox>
            </div>
          </div>
          <Problem>{error}</Problem>
          <Button type="submit" variant="primary" size="lg" full className="mt-7" disabled={!ready || busy}>
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          {!live && <HaveAccount />}
        </form>
      )}
    </AuthLayout>
  )
}

/* ─── Log in ───────────────────────────────────────────────────────── */

export function Login() {
  const { live, user, applyMe, signIn } = useSession()
  const navigate = useNavigate()
  const signedIn = useAfterSignIn()
  const [params] = useSearchParams()
  const invite = inviteFrom(params)
  const afterSignIn = (me: Me) => (invite ? `/invite/${invite}` : signedIn(me))
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  /** Set once the password is right: the code step that follows. */
  // Arriving from sign up with Google, with the authenticator app on: straight to its code.
  const fromGoogle = (useLocation().state as { appChallenge?: string } | null)?.appChallenge
  const [pending, setPending] = useState<{ challenge: string; step: 'two_step' | 'verify_email'; method?: 'email' | 'app' } | null>(fromGoogle ? { challenge: fromGoogle, step: 'two_step', method: 'app' } : null)
  /** With the app: a recovery code instead, for a lost phone. */
  const [recovery, setRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReactNode>('')
  const clock = useResendClock(!!pending)

  if (live && user && !busy) return <Navigate to={invite ? `/invite/${invite}` : '/'} replace />

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'no_account' ? (
          <>
            {e.message}{' '}
            <Link to="/signup" state={{ email }} className="font-semibold underline underline-offset-4">
              Create an account
            </Link>
          </>
        ) : (
          problem(e)
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const start = () =>
    run(async () => {
      if (!live) {
        signIn(email)
        navigate('/select-business')
        return
      }
      const r = await api<Challenge>('POST', '/auth/login', { email, password })
      setPending({ challenge: r.challenge, step: r.step ?? 'two_step', method: r.method })
      setRecovery(false)
      setCode('')
      clock.restart()
    })

  const verify = () =>
    run(async () => {
      if (!pending) return
      const path = pending.step === 'verify_email' ? '/auth/signup/verify' : '/auth/login/verify'
      const me = await api<Me>('POST', path, { challenge: pending.challenge, code })
      applyMe(me)
      navigate(afterSignIn(me))
    })

  const google = (idToken: string) =>
    run(async () => {
      const r = await api<Me | Challenge>('POST', '/auth/google', { idToken })
      if (isChallenge(r)) {
        setPending({ challenge: r.challenge, step: 'two_step', method: 'app' })
        setCode('')
        setRecovery(false)
        return
      }
      applyMe(r)
      navigate(afterSignIn(r))
    })
  const app = pending?.method === 'app'
  const codeReady = recovery ? code.replace(/[^A-Za-z0-9]/g, '').length === 8 : code.length === 6

  return (
    <AuthLayout
      headline={<>Money's been <Scribble>moving</Scribble>. Come see.</>}
      sub="Your payments, balances and settlements. Every business you run, in one place."
      aside={
        <>
          <span className="hidden sm:inline">New here? </span>
          <Link to="/signup" className="font-semibold text-fg underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      {pending ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (codeReady && !busy) void verify()
          }}
        >
          <BackLink onClick={() => (setPending(null), setError(''))} label="Use a different account" />
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-lime text-fg">{app ? <Smartphone className="size-5" /> : <Mail className="size-5" />}</span>
            <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">{pending.step === 'verify_email' ? 'Confirm your email' : app ? (recovery ? 'Use a recovery code' : 'Enter your app code') : 'Enter your code'}</h1>
          </div>
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">
            {app ? (
              recovery ? (
                'One of the ten codes you saved when you turned on the authenticator app. Each works once.'
              ) : (
                'Open your authenticator app and enter the six-digit code for Money Moves Business.'
              )
            ) : (
              <>
                We sent a six-digit code to <span className="font-medium text-fg">{email}</span>.{' '}
                {pending.step === 'verify_email' ? 'Confirm the address to finish setting up.' : 'It keeps your account yours, even if your password gets out.'}
              </>
            )}
          </p>
          <div className="mt-7">
            {recovery ? (
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))} placeholder="K7Q2-9XHD" autoFocus autoComplete="one-time-code" className="h-12 text-center font-mono text-[18px] tracking-[0.2em]" />
            ) : (
              <OtpInput value={code} onChange={setCode} />
            )}
          </div>
          <Problem>{error}</Problem>
          <Button type="submit" variant="primary" size="lg" full className="mt-6" disabled={!codeReady || busy}>
            {busy ? 'Checking…' : 'Log in'}
          </Button>
          {app ? (
            <p className="mt-5 text-center text-[13.5px] text-muted">
              <button
                type="button"
                onClick={() => {
                  setRecovery((r) => !r)
                  setCode('')
                  setError('')
                }}
                className="font-medium text-fg underline underline-offset-4"
              >
                {recovery ? 'Use the app instead' : 'Lost your phone? Use a recovery code'}
              </button>
            </p>
          ) : (
            <ResendLine left={clock.left} busy={busy} onResend={() => void start()} />
          )}
        </form>
      ) : (
        <>
          <CardTitle title="Welcome back" sub="Log in to your Money Moves Business account." />
          <div className="mt-7">
            {live ? (
              <GoogleSignIn text="signin_with" onCredential={(t) => void google(t)} onError={setError} />
            ) : (
              <PreviewGoogleButton
                label="Log in with Google"
                onClick={() => {
                  signIn('owner@example.com')
                  navigate('/select-business')
                }}
              />
            )}
          </div>
          <Or label="or log in with email" />
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (email && password && !busy) void start()
            }}
          >
            <Field label="Email address">
              <Input type="email" placeholder="name@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </Field>
            <Field
              label="Password"
              aside={
                <Link to="/forgot-password" className="text-[13px] font-medium text-muted hover:text-fg">
                  Forgot password?
                </Link>
              }
            >
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <Problem>{error}</Problem>
            <Button type="submit" variant="primary" size="lg" full className="!mt-7" disabled={!email || !password || busy}>
              {busy ? 'Checking…' : 'Log in'}
            </Button>
          </form>
          <p className="mt-5 text-center text-[13.5px] text-muted">
            New to Money Moves Business?{' '}
            <Link to="/signup" className="font-semibold text-fg underline underline-offset-4">
              Create an account
            </Link>
          </p>
          <div className="mt-7 rounded-lg bg-raise px-4 py-3 text-[13px] leading-relaxed text-muted">
            Paying a business, not running one? You don't need an account. Just open the link or invoice they sent you.
          </div>
        </>
      )}
    </AuthLayout>
  )
}

/* ─── Forgot password ──────────────────────────────────────────────── */

export function ForgotPassword() {
  const { live } = useSession()
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clock = useResendClock(step === 'reset')
  const passed = RULES.filter(([, t]) => t(password)).length
  const okPassword = password.length >= 10 && passed >= 3 && confirm === password

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(problem(e))
    } finally {
      setBusy(false)
    }
  }

  const send = () =>
    run(async () => {
      if (live) setChallenge((await api<Challenge>('POST', '/auth/password/forgot', { email })).challenge)
      setCode('')
      clock.restart()
      setStep('reset')
    })

  const reset = () =>
    run(async () => {
      if (live) await api('POST', '/auth/password/reset', { challenge, code, password })
      setStep('done')
    })

  return (
    <AuthLayout
      headline={<>It happens. Let's get you <Scribble>back in</Scribble>.</>}
      sub="We'll email a code to set a new password. Your payments keep moving meanwhile."
      aside={
        <Link to="/login" className="font-semibold text-fg underline underline-offset-4">
          Back to log in
        </Link>
      }
    >
      {step === 'done' ? (
        <div>
          <span className="flex size-11 items-center justify-center rounded-lg bg-lime text-fg">
            <Check className="size-5" strokeWidth={3} />
          </span>
          <div className="mt-6">
            <CardTitle title="Password changed" />
          </div>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">Every device was signed out. Log in with your new password. We'll send a code as usual.</p>
          <Link to="/login">
            <Button variant="primary" size="lg" full className="mt-7">
              Log in
            </Button>
          </Link>
        </div>
      ) : step === 'reset' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length === 6 && okPassword && !busy) void reset()
          }}
        >
          <BackLink onClick={() => setStep('email')} label="Change email" />
          <CardTitle title="Set a new password" sub={<>If <span className="font-medium text-fg">{email}</span> has an account, a six-digit code is on its way. It works for 10 minutes.</>} />
          <div className="mt-7 space-y-4">
            <Field label="Code from the email">
              <OtpInput value={code} onChange={setCode} />
            </Field>
            <Field label="New password">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <div className="-mt-1 flex flex-wrap gap-1.5">
              {RULES.map(([label, test]) => (
                <span key={label} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition', test(password) ? 'bg-lime text-fg' : 'bg-raise text-dim')}>
                  {test(password) && <Check className="size-3" strokeWidth={3} />}
                  {label}
                </span>
              ))}
            </div>
            <Field label="Confirm new password" error={confirm && confirm !== password ? "The passwords don't match." : undefined}>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <Problem>{error}</Problem>
          <Button type="submit" variant="primary" size="lg" full className="mt-7" disabled={code.length < 6 || !okPassword || busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </Button>
          <ResendLine left={clock.left} busy={busy} onResend={() => void send()} />
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (email && !busy) void send()
          }}
        >
          <CardTitle title="Reset your password" sub="Enter the email you signed up with." />
          <div className="mt-7 space-y-4">
            <Field label="Email address">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" autoComplete="email" autoFocus />
            </Field>
            <Problem>{error}</Problem>
            <Button type="submit" variant="primary" size="lg" full disabled={!email || busy}>
              {busy ? 'Sending…' : 'Send a code'}
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  )
}

/* ─── Choose a business ────────────────────────────────────────────── */

const STATE_LABEL = {
  verified: { text: 'Live', dot: 'bg-good' },
  review: { text: 'In review', dot: 'bg-blue' },
  unverified: { text: 'Test mode', dot: 'bg-[#D98E1F]' },
} as const

export function SelectBusiness() {
  const { user, businesses, openBusiness, signOut } = useSession()
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!user) navigate('/login', { replace: true })
  }, [user, navigate])

  const list = useMemo(() => businesses.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())), [businesses, q])

  const open = (id: string) => navigate(openBusiness(id))

  // 1-9 opens the matching business - quicker than the mouse for people with several.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const n = Number(e.key)
      if (n >= 1 && n <= list.length) open(list[n - 1]!.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 items-center justify-between border-b border-line bg-card px-6 sm:px-10">
        <Logo />
        <div className="flex items-center gap-4 text-[13.5px]">
          <span className="hidden text-muted sm:inline">{user?.email}</span>
          <button
            className="font-medium text-fg hover:underline"
            onClick={() => {
              signOut()
              navigate('/login')
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[600px] flex-1 px-6 py-14">
        <h1 className="display text-[36px] font-bold leading-[1.05] text-fg">Which business?</h1>
        <p className="mt-2 text-[14.5px] text-muted">Each one has its own balances, team and keys. Press a number to jump in.</p>

        {businesses.length > 5 && <SearchBox placeholder="Find a business" value={q} onChange={setQ} className="mt-6" />}

        {list.length > 0 && (
          <div className="mt-8 overflow-hidden rounded-[10px] border border-line bg-card">
            {list.map((b, i) => (
              <button
                key={b.id}
                onClick={() => open(b.id)}
                className="group flex w-full items-center gap-4 border-b border-soft px-4 py-3.5 text-left transition last:border-0 hover:bg-[#FAF9F6]"
              >
                <Avatar name={b.name} size={40} square />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-fg">{b.name}</span>
                  <span className="mt-0.5 flex items-center gap-3 text-[12.5px] text-dim">
                    <span className="font-mono">{b.merchantId}</span>
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <span className={cx('size-[7px] rounded-full', STATE_LABEL[b.verify].dot)} />
                      {STATE_LABEL[b.verify].text}
                    </span>
                  </span>
                </span>
                <span className="hidden rounded border border-line bg-raise px-1.5 py-0.5 font-mono text-[11px] text-dim sm:inline">{i + 1}</span>
                <ArrowRight className="size-4 text-dim transition group-hover:translate-x-0.5 group-hover:text-fg" />
              </button>
            ))}
          </div>
        )}

        <Link
          to="/business/new"
          className="mt-3 flex items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#CFCCC3] px-4 py-3.5 text-[14px] font-medium text-muted transition hover:border-fg hover:text-fg"
        >
          <Plus className="size-4" /> New business
        </Link>
      </main>
    </div>
  )
}

/* ─── One-time code (preview: opening a business) ──────────────────── */

export function Otp() {
  const { live, business, user, businesses, pendingId, confirmOtp } = useSession()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const reason = params.get('reason') ?? 'switch'
  const next = params.get('next') ?? '/dashboard'
  const [code, setCode] = useState('')
  const clock = useResendClock(true)

  // Live, the code comes with signing in - opening a business needs no second one.
  if (live) return <Navigate to={business ? '/dashboard' : '/select-business'} replace />

  const target = businesses.find((b) => b.id === pendingId)
  const submit = () => {
    if (code.length < 6) return
    confirmOtp()
    navigate(reason === 'signup' || reason === 'new' ? '/onboarding' : next)
  }

  return (
    <AuthLayout
      headline={<>One code. Then you're <Scribble>in</Scribble>.</>}
      sub="Every business you open, and every switch between them, takes a fresh code. Each one is its own money."
      aside={
        reason === 'switch' ? (
          <Link to="/select-business" className="font-semibold text-fg underline underline-offset-4">
            Other businesses
          </Link>
        ) : null
      }
    >
      <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">{reason === 'signup' ? 'Confirm your email' : 'Enter your code'}</h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
        Sent to <span className="font-medium text-fg">{user?.email ?? 'your email'}</span>
        {user?.phone ? (
          <>
            {' '}and <span className="font-medium text-fg">{user.phone}</span>
          </>
        ) : null}
        .{target && reason !== 'signup' && <> It opens <span className="font-medium text-fg">{target.name}</span>.</>}
      </p>
      <form
        className="mt-9"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <OtpInput value={code} onChange={setCode} />
        <Button type="submit" variant="primary" size="lg" full className="mt-6" disabled={code.length < 6}>
          Continue
        </Button>
      </form>
      <ResendLine left={clock.left} onResend={clock.restart} />
      <p className="mt-10 text-[12.5px] text-dim">Preview: any six digits work.</p>
    </AuthLayout>
  )
}
