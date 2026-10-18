/**
 * An invite to join a business's team, from the emailed link. Signed in with
 * the invited email, it's one tap to accept; signed out, they sign in or make
 * an account first and come straight back here.
 */
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2 } from '@/components/icons'
import { Button } from '@/components/ui'
import AuthLayout from '@/layouts/AuthLayout'
import { ApiError, api, type Me } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useSession } from '@/state/session'
import { ROLE_INFO, type RoleId } from '@/state/roles'

type Invite = { business: { name: string; logo: string | null }; email: string; role: RoleId; status: 'pending' | 'accepted' | 'expired' }

export function InvitePage() {
  const { token = '' } = useParams()
  const { user, applyMe, openBusiness, signOut } = useSession()
  const navigate = useNavigate()
  const r = useApi<{ invite: Invite }>(`/invites/${encodeURIComponent(token)}`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const invite = r.data?.invite
  const same = !!user && !!invite && user.email.toLowerCase() === invite.email.toLowerCase()
  const q = invite ? `?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invite.email)}` : ''

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      const done = await api<{ businessId: string }>('POST', `/invites/${encodeURIComponent(token)}/accept`)
      applyMe(await api<Me>('GET', '/auth/me'))
      navigate(openBusiness(done.businessId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      {!invite ? (
        r.error ? (
          <div>
            <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">This invite isn't valid</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{r.error.message || 'Check the link in your email, or ask for a new invite.'}</p>
            <Link to="/" className="mt-6 inline-block text-[14px] font-medium text-fg underline underline-offset-2">
              Go to Money Moves Business
            </Link>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-10 text-[14px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Opening your invite…
          </div>
        )
      ) : (
        <div>
          {invite.business.logo && <img src={invite.business.logo} alt="" className="mb-5 size-12 rounded-[10px] border border-line bg-card object-contain" />}
          <h1 className="display text-[28px] font-bold leading-[1.08] text-fg">Join {invite.business.name}</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted">
            You're invited as <span className="font-medium text-fg">{ROLE_INFO[invite.role]?.name.toLowerCase() ?? invite.role}</span>. {ROLE_INFO[invite.role]?.about}
          </p>

          {invite.status === 'expired' ? (
            <p className="mt-6 rounded-[10px] bg-raise px-4 py-3 text-[13.5px] leading-relaxed text-muted">This link has expired. Ask whoever invited you to send a new one.</p>
          ) : invite.status === 'accepted' && !same ? (
            <p className="mt-6 rounded-[10px] bg-raise px-4 py-3 text-[13.5px] leading-relaxed text-muted">This invite has already been used. Sign in as {invite.email} to open the business.</p>
          ) : user && !same ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-[10px] bg-raise px-4 py-3 text-[13.5px] leading-relaxed text-muted">
                This invite is for <span className="font-medium text-fg">{invite.email}</span>, and you're signed in as {user.email}. Sign out, then sign in with the invited email.
              </p>
              <Button
                variant="primary"
                size="lg"
                full
                onClick={() => {
                  signOut()
                  navigate(`/login${q}`)
                }}
              >
                Sign out and switch
              </Button>
            </div>
          ) : user ? (
            <div className="mt-7">
              <Button variant="primary" size="lg" full disabled={busy} onClick={() => void accept()}>
                {busy ? 'Joining…' : `Join ${invite.business.name}`}
              </Button>
              <p className="mt-3 text-center text-[13px] text-dim">Signed in as {user.email}</p>
            </div>
          ) : (
            <div className="mt-7 space-y-3">
              <p className="text-[13.5px] text-muted">
                Accept it with <span className="font-medium text-fg">{invite.email}</span>.
              </p>
              <Link to={`/login${q}`} className="block">
                <Button variant="primary" size="lg" full>
                  Sign in to accept
                </Button>
              </Link>
              <Link to={`/signup${q}`} className="block">
                <Button size="lg" full>
                  I'm new: make an account
                </Button>
              </Link>
            </div>
          )}
          {error && <p className="mt-4 text-[13px] text-red">{error}</p>}
        </div>
      )}
    </AuthLayout>
  )
}
