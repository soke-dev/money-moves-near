/**
 * Admin sign-in: password, then a code emailed to the same address.
 *
 * Same palette as the console it opens, and no chrome beyond what the two
 * steps need - this screen is looked at for eight seconds a day.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { C, MONO, Label, Btn, Input, Field } from './ui'

const API = import.meta.env.VITE_API_URL || ''

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function post(path: string, body: unknown) {
    const res = await fetch(`${API}/api/admin${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'That did not work. Try again.')
    return data
  }

  async function requestCode(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await post('/login', { email, password })
      setStep('code')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await post('/verify', { email, code })
      localStorage.setItem('mm_admin_token', data.token)
      navigate('/admin/dashboard')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: C.bg }}>
      <div className="w-full max-w-[380px]">
        <div className="flex items-center gap-2.5 mb-8">
          <img src="/images/logo.png" alt="" className="w-9 h-9 rounded-xl" />
          <div>
            <div className="text-[15px] font-bold tracking-[-0.02em]" style={{ color: C.text }}>
              money moves
            </div>
            <div className="text-[10px] tracking-[0.14em] uppercase" style={{ color: C.dim, fontFamily: MONO }}>
              admin
            </div>
          </div>
        </div>

        {step === 'password' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <h1 className="text-[26px] font-bold tracking-[-0.03em] leading-tight mb-1" style={{ color: C.text }}>
              Sign in
            </h1>
            <p className="text-[13.5px] mb-5" style={{ color: C.muted }}>
              We email a code to the address you use here.
            </p>

            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@usemoneymoves.xyz"
                required
                autoComplete="username"
              />
            </Field>
            <Field label="Admin password">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </Field>

            <Btn type="submit" kind="primary" full disabled={loading || !email || !password}>
              {loading ? 'Sending…' : 'Send the code'}
            </Btn>
            {error && (
              <p className="text-[13px] text-center" style={{ color: C.red }}>
                {error}
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <h1 className="text-[26px] font-bold tracking-[-0.03em] leading-tight mb-1" style={{ color: C.text }}>
              Enter the code
            </h1>
            <p className="text-[13.5px] mb-5" style={{ color: C.muted }}>
              Sent to <span style={{ color: C.text }}>{email}</span>. It lasts ten minutes.
            </p>

            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoFocus
              placeholder="000000"
              className="w-full h-14 rounded-xl text-center text-[24px] outline-none"
              style={{
                background: C.raise,
                border: `1px solid ${C.line}`,
                color: C.text,
                fontFamily: MONO,
                letterSpacing: '0.4em',
                textIndent: '0.4em',
              }}
            />

            <Btn type="submit" kind="primary" full disabled={loading || code.length < 6}>
              {loading ? 'Checking…' : 'Sign in'}
            </Btn>
            <button
              type="button"
              onClick={() => {
                setStep('password')
                setCode('')
                setError('')
              }}
              className="w-full h-10 text-[13px]"
              style={{ color: C.dim }}
            >
              Use a different email
            </button>
            {error && (
              <p className="text-[13px] text-center" style={{ color: C.red }}>
                {error}
              </p>
            )}
          </form>
        )}

        <div className="mt-8 text-center">
          <Label>Money Moves · internal</Label>
        </div>
      </div>
    </div>
  )
}
