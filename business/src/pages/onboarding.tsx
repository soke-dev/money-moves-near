/**
 * Adding another business to the same login. It gets its own balances, team,
 * keys and settlement, starts in test mode, and is activated on its own -
 * see activate.tsx.
 */
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { X } from '@/components/icons'
import { Button, Checkbox, Field, Input, Modal, OtpInput, cx } from '@/components/ui'
import { useSession } from '@/state/session'
import { ApiError } from '@/lib/api'

/* ─── Create another business ──────────────────────────────────────── */

export function CreateBusiness() {
  const { live, user, createBusiness, confirmOtp, addBusiness } = useSession()
  const navigate = useNavigate()
  // Whether it is "Just me" or a registered business is asked when it is activated.
  const [f, setF] = useState({ name: '', email: user?.email ?? '', type: '' })
  const [same, setSame] = useState(true)
  const [terms, setTerms] = useState(false)
  const [otpOpen, setOtpOpen] = useState(false)
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<'REGISTERED' | 'INDIVIDUAL'>('REGISTERED')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!user) return <Navigate to="/login" replace />

  // Live: the code came with signing in, so the new business opens straight away.
  const create = async () => {
    if (!live) {
      createBusiness(f)
      setOtpOpen(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      navigate(await addBusiness({ name: f.name.trim(), kind, email: f.email }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the business just now. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5 sm:px-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="rounded-lg p-1.5 text-muted hover:text-fg" aria-label="Close">
            <X className="size-5" />
          </button>
          <span className="text-[15px] font-semibold text-fg">Create a new business</span>
        </div>
        <Button variant="ghost" onClick={() => navigate(-1)}>Cancel</Button>
      </header>
      <main className="mx-auto w-full max-w-[520px] px-5 py-12">
        <h1 className="text-[26px] font-semibold display text-fg">Business information</h1>
        <p className="mt-1.5 text-[14px] text-muted">
          Run another business from the same login. It gets its own balances, team, keys and settlement, and starts in
          test mode until it is verified.
        </p>
        <div className="mt-8 space-y-4">
          <Field label="Business or brand name" hint="Selling as yourself? Your own name works.">
            <Input value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="Sotechy Tech" />
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
          <Field label="Business email">
            <Input type="email" value={f.email} onChange={(e) => setF((p) => ({ ...p, email: e.target.value }))} />
          </Field>
          <div className="space-y-3 pt-1">
            <Checkbox checked={same} onChange={setSame}>
              Copy settings from my current business (team, notifications and accepted payment methods)
            </Checkbox>
            <Checkbox checked={terms} onChange={setTerms}>
              I accept the <a href="/legal/terms" target="_blank" rel="noreferrer" className="text-accent">Terms of service</a> (our merchant agreement),{' '}
              <a href="/legal/prohibited" target="_blank" rel="noreferrer" className="text-accent">Prohibited businesses</a> and{' '}
              <a href="/legal/privacy" target="_blank" rel="noreferrer" className="text-accent">Privacy policy</a>.
            </Checkbox>
          </div>
        </div>
        {error && <div className="mt-5 rounded-lg border border-[#EFC4C0] bg-[#FBEAE8] px-3.5 py-2.5 text-[13.5px] text-[#7D1F19]">{error}</div>}
        <div className="mt-8 flex justify-end gap-2">
          <Button onClick={() => navigate(-1)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={f.name.trim().length < 2 || !f.email || !terms || busy}
            onClick={() => void create()}
          >
            {busy ? 'Creating…' : 'Create business'}
          </Button>
        </div>
      </main>

      <Modal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        title="Enter the code"
        sub={
          <>
            We sent a confirmation code to <span className="text-fg">{user.email}</span>
            {user.phone && (
              <>
                {' '}and <span className="text-fg">{user.phone}</span>
              </>
            )}
            . Enter it to switch to {f.name || 'the new business'}.
          </>
        }
        footer={
          <>
            <Button onClick={() => setOtpOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={code.length < 6}
              onClick={() => {
                confirmOtp()
                navigate('/onboarding')
              }}
            >
              Switch business
            </Button>
          </>
        }
      >
        <OtpInput value={code} onChange={setCode} />
        <button className="mt-4 text-[13px] font-medium text-accent">Resend code</button>
      </Modal>
    </div>
  )
}

