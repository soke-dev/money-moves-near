/**
 * Who is signed in, which business they are looking at, and whether it is in
 * test or live mode.
 *
 * Two ways to run (see lib/api):
 *  - live: the API says who you are (`/auth/me`), from a cookie the browser
 *    holds and script can't read. Only the business you last opened and its
 *    mode are remembered here - never a token, never a profile.
 *  - preview: everything lives in this browser's storage, with sample
 *    businesses, so screens can be clicked through without an account.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BUSINESSES, type Business, type Destination, type VerifyState } from '@/data/mock'
import { LIVE, api, type ApiBusiness, type ApiUser, type Me, type SettleChain } from '@/lib/api'
import { Logo } from '@/components/brand'
import { forgetReferral, referralCode } from './referral'

export type Mode = 'test' | 'live'

export interface User {
  first: string
  last: string
  email: string
  phone: string
  /** Live only: the names as entered - empty until they add them or verification does. */
  firstName?: string | null
  lastName?: string | null
  /** Live only: whether they've set a password (not everyone who signs in with Google has). */
  hasPassword?: boolean
  google?: boolean
  passwordChangedAt?: string | null
  /** How the code after the password comes: by email, or from an authenticator app. */
  twoStep?: 'EMAIL' | 'APP'
  recoveryLeft?: number | null
  /** Live only: their photo's address. */
  avatar?: string | null
}

interface State {
  user: User | null
  businesses: Business[]
  currentId: string | null
  /** Preview only: picked on the business screen, waiting for its code before it opens. */
  pendingId: string | null
  mode: Mode
}

interface Session extends State {
  /** True when talking to the real API. */
  live: boolean
  business: Business | null
  /** Sets who's signed in from what the API sent back after a sign-in. */
  applyMe: (me: Me) => void
  /** Opens a business; returns where to go next. */
  openBusiness: (id: string) => string
  /** Adds a business to this login and opens it; returns where to go next. */
  addBusiness: (b: { name: string; kind: 'REGISTERED' | 'INDIVIDUAL'; email?: string; ref?: string }) => Promise<string>
  /** Where this business's crypto settles, as USDC. */
  setSettleChain: (chain: SettleChain) => Promise<void>
  signOut: () => void
  // Preview-only sign-in steps, kept for `?demo=` and design work.
  signIn: (email: string) => void
  signUp: (u: User & { businessName: string }) => void
  choose: (id: string) => void
  confirmOtp: () => void
  createBusiness: (b: { name: string; email: string; type: string }) => void
  updateBusiness: (id: string, patch: Partial<Business>) => void
  setVerify: (id: string, v: VerifyState) => void
  setDestination: (d: Destination) => void
  setMode: (m: Mode) => void
}

const PREVIEW_KEY = 'mmb_session_v1'
/** Live mode keeps only these two. */
const LIVE_KEY = 'mmb_live_v1'

const initial: State = {
  user: null,
  businesses: BUSINESSES,
  currentId: null,
  pendingId: null,
  mode: 'live',
}

const signedOut: State = { user: null, businesses: [], currentId: null, pendingId: null, mode: 'test' }

/* ─── From the API's shapes to the dashboard's ─────────────────────── */

const VERIFY: Record<ApiBusiness['status'], VerifyState> = { UNVERIFIED: 'unverified', IN_REVIEW: 'review', VERIFIED: 'verified', SUSPENDED: 'unverified' }

function toUser(u: ApiUser): User {
  // Until verification fills in the real name, greet them by their email.
  const handle = u.email.split('@')[0] ?? ''
  return {
    first: u.firstName || handle.charAt(0).toUpperCase() + handle.slice(1),
    last: u.lastName ?? '',
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone ?? '',
    hasPassword: u.hasPassword,
    google: u.google,
    passwordChangedAt: u.passwordChangedAt,
    twoStep: u.twoStep,
    recoveryLeft: u.recoveryLeft ?? null,
    avatar: u.avatar ?? null,
  }
}

function toBusiness(b: ApiBusiness, u: ApiUser): Business {
  return {
    id: b.id,
    name: b.name,
    merchantId: b.merchantId,
    email: u.email,
    phone: u.phone ?? '',
    // "Individual" is what decides a "Just me" account elsewhere (see Settlement).
    type: b.kind === 'INDIVIDUAL' ? 'Individual' : 'Registered business',
    verify: VERIFY[b.status],
    onboarded: false,
    // Links start out settling to a bank; a Just me account goes to its business wallet whatever this says.
    destination: 'bank',
    settleChain: b.settleChain,
    role: b.role,
    suspended: b.status === 'SUSPENDED',
    verifiedAt: b.verifiedAt ?? null,
    liveNoticeClosed: !!b.liveNoticeClosed,
    logo: b.logo ?? null,
    feePayer: b.feePayer ?? "BUSINESS",
  }
}

/* ─── Preview start points ─────────────────────────────────────────── */

/**
 * `?demo=<business id>` opens a sample business already signed in - for
 * clicking through the screens without going through sign-up each time.
 * `?demo=new` opens a fresh, unverified one in test mode.
 */
function fromDemo(): State | null {
  const id = new URLSearchParams(window.location.search).get('demo')
  if (!id) return null
  const user = { first: 'Okotete', last: 'Chris', email: 'owner@example.com', phone: '+234 800 000 0000' }
  const b = BUSINESSES.find((x) => x.id === id) ?? BUSINESSES.find((x) => x.verify === 'unverified')!
  return { user, businesses: BUSINESSES, currentId: b.id, pendingId: null, mode: b.verify === 'verified' ? 'live' : 'test' }
}

function loadPreview(): State {
  const demo = fromDemo()
  if (demo) return demo
  try {
    const raw = localStorage.getItem(PREVIEW_KEY)
    return raw ? { ...initial, ...JSON.parse(raw) } : initial
  } catch {
    return initial
  }
}

/**
 * Test or live, per business - kept through signing out, so coming back to a
 * business opens it the way it was left. Not a secret: only which mode it was in.
 */
const MODE_KEY = 'mmb_mode_v1'
function rememberedMode(businessId: string | null | undefined): Mode | null {
  if (!businessId) return null
  try {
    const v = JSON.parse(localStorage.getItem(MODE_KEY) ?? '{}') as Record<string, unknown>
    return v[businessId] === 'live' ? 'live' : v[businessId] === 'test' ? 'test' : null
  } catch {
    return null
  }
}
function rememberMode(businessId: string, mode: Mode) {
  try {
    const v = JSON.parse(localStorage.getItem(MODE_KEY) ?? '{}') as Record<string, unknown>
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...v, [businessId]: mode }))
  } catch {
    /* blocked storage: it simply isn't remembered */
  }
}

function loadLiveChoice(): { currentId: string | null; mode: Mode } {
  try {
    const raw = localStorage.getItem(LIVE_KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return { currentId: typeof v.currentId === 'string' ? v.currentId : null, mode: v.mode === 'live' ? 'live' : 'test' }
    }
  } catch {
    /* blocked storage: start with nothing open */
  }
  return { currentId: null, mode: 'test' }
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [s, set] = useState<State>(() => (LIVE ? signedOut : loadPreview()))
  // Live mode waits for the API to say who's here before drawing anything that depends on it.
  const [ready, setReady] = useState(!LIVE)

  const applyMe = useCallback((me: Me) => {
    set((p) => {
      const businesses = me.businesses.map((b) => toBusiness(b, me.user))
      const saved = p.user ? { currentId: p.currentId, mode: p.mode } : loadLiveChoice()
      const current = businesses.find((b) => b.id === saved.currentId) ?? null
      return {
        user: toUser(me.user),
        businesses,
        currentId: current?.id ?? null,
        pendingId: null,
        // A business that isn't verified can only run in test mode; a verified one opens as it was left.
        mode: current?.verify === 'verified' ? (rememberedMode(current.id) ?? saved.mode) : 'test',
      }
    })
  }, [])

  // Live: who's signed in? A 401 just means nobody.
  useEffect(() => {
    if (!LIVE) return
    api<Me>('GET', '/auth/me')
      .then(applyMe)
      .catch(() => set(signedOut))
      .finally(() => setReady(true))
  }, [applyMe])

  // Remember where they were: everything in preview, only the open business and its mode live.
  // Live waits for the API's answer first - saving the empty start state would forget the business.
  useEffect(() => {
    if (LIVE && !ready) return
    try {
      if (LIVE) localStorage.setItem(LIVE_KEY, JSON.stringify({ currentId: s.currentId, mode: s.mode }))
      if (LIVE && s.currentId && s.user) rememberMode(s.currentId, s.mode)
      else localStorage.setItem(PREVIEW_KEY, JSON.stringify(s))
    } catch {
      /* private window or blocked storage: it simply isn't remembered */
    }
  }, [s, ready])

  const business = s.businesses.find((b) => b.id === s.currentId) ?? null

  const openBusiness = useCallback((id: string) => {
    if (!LIVE) {
      set((p) => ({ ...p, pendingId: id }))
      return '/otp?next=/dashboard&reason=switch'
    }
    set((p) => {
      const b = p.businesses.find((x) => x.id === id)
      return { ...p, currentId: id, pendingId: null, mode: b?.verify === 'verified' ? (rememberedMode(id) ?? p.mode) : 'test' }
    })
    return '/dashboard'
  }, [])

  const addBusiness = useCallback(async (input: { name: string; kind: 'REGISTERED' | 'INDIVIDUAL'; email?: string; ref?: string }) => {
    if (!LIVE) {
      const id = `b_${Date.now().toString(36)}`
      set((p) => ({
        ...p,
        businesses: [
          ...p.businesses,
          {
            id,
            name: input.name,
            email: input.email ?? p.user?.email ?? '',
            type: input.kind === 'INDIVIDUAL' ? 'Individual' : 'Registered business',
            phone: p.user?.phone ?? '',
            merchantId: String(100_000_000 + Math.floor(Math.random() * 9_000_000)),
            verify: 'unverified',
            onboarded: false,
            destination: 'wallet',
          },
        ],
        currentId: id,
        pendingId: null,
        mode: 'test',
      }))
      return '/onboarding'
    }
    const ref = input.ref?.trim() || referralCode() || undefined
    const { business: b } = await api<{ business: ApiBusiness }>('POST', '/businesses', { name: input.name, kind: input.kind, ref })
    forgetReferral()
    set((p) => {
      const u: ApiUser = { id: '', email: p.user?.email ?? '', firstName: null, lastName: null, phone: p.user?.phone ?? null, twoStep: 'EMAIL', hasPassword: !!p.user?.hasPassword, google: !!p.user?.google, passwordChangedAt: null }
      return { ...p, businesses: [...p.businesses, toBusiness(b, u)], currentId: b.id, pendingId: null, mode: 'test' }
    })
    return '/onboarding'
  }, [])

  const setSettleChain = useCallback(
    async (chain: SettleChain) => {
      if (!s.currentId) return
      if (LIVE) await api('PATCH', `/businesses/${s.currentId}/settlement`, { settleChain: chain })
      set((p) => ({ ...p, businesses: p.businesses.map((b) => (b.id === p.currentId ? { ...b, settleChain: chain } : b)) }))
    },
    [s.currentId],
  )

  const signOut = useCallback(() => {
    if (LIVE) {
      void api('POST', '/auth/logout').catch(() => {})
      set(signedOut)
      try {
        localStorage.removeItem(LIVE_KEY)
      } catch {
        /* nothing stored */
      }
      return
    }
    set({ ...initial })
  }, [])

  /* Preview-only steps */

  const signIn = useCallback((email: string) => {
    set((p) => ({
      ...p,
      user: p.user ?? { first: 'Okotete', last: 'Chris', email, phone: '+234 800 000 0000' },
      currentId: null,
      pendingId: null,
    }))
  }, [])

  const signUp = useCallback((u: User & { businessName: string }) => {
    const id = `b_${Date.now().toString(36)}`
    const fresh: Business = {
      id,
      name: u.businessName || `${u.first} ${u.last}`,
      merchantId: String(100_000_000 + Math.floor(Math.random() * 9_000_000)),
      email: u.email,
      phone: u.phone,
      type: 'Sole proprietorship',
      verify: 'unverified',
      onboarded: false,
      destination: 'wallet',
    }
    set((p) => ({
      ...p,
      user: { first: u.first, last: u.last, email: u.email, phone: u.phone },
      businesses: [fresh, ...p.businesses],
      currentId: null,
      pendingId: id,
      mode: 'test',
    }))
  }, [])

  const choose = useCallback((id: string) => set((p) => ({ ...p, pendingId: id })), [])

  const confirmOtp = useCallback(() => {
    set((p) => {
      const id = p.pendingId ?? p.currentId
      const b = p.businesses.find((x) => x.id === id)
      // A business that is not verified can only run in test mode.
      return { ...p, currentId: id, pendingId: null, mode: b?.verify === 'verified' ? p.mode : 'test' }
    })
  }, [])

  const createBusiness = useCallback((b: { name: string; email: string; type: string }) => {
    const id = `b_${Date.now().toString(36)}`
    set((p) => ({
      ...p,
      businesses: [
        ...p.businesses,
        {
          id,
          name: b.name,
          email: b.email,
          type: b.type,
          phone: p.user?.phone ?? '',
          merchantId: String(100_000_000 + Math.floor(Math.random() * 9_000_000)),
          verify: 'unverified',
          onboarded: false,
          destination: 'wallet',
        },
      ],
      pendingId: id,
    }))
  }, [])

  const updateBusiness = useCallback((id: string, patch: Partial<Business>) => {
    set((p) => ({ ...p, businesses: p.businesses.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  }, [])

  const setVerify = useCallback((id: string, v: VerifyState) => {
    set((p) => ({ ...p, businesses: p.businesses.map((b) => (b.id === id ? { ...b, verify: v } : b)) }))
  }, [])

  const setDestination = useCallback((d: Destination) => {
    set((p) => ({
      ...p,
      businesses: p.businesses.map((b) => (b.id === p.currentId ? { ...b, destination: d } : b)),
    }))
  }, [])

  const setMode = useCallback((m: Mode) => set((p) => ({ ...p, mode: m })), [])

  const value = useMemo<Session>(
    () => ({
      ...s,
      live: LIVE,
      business,
      applyMe,
      openBusiness,
      addBusiness,
      setSettleChain,
      signOut,
      signIn,
      signUp,
      choose,
      confirmOtp,
      createBusiness,
      updateBusiness,
      setVerify,
      setDestination,
      setMode,
    }),
    [s, business, applyMe, openBusiness, addBusiness, setSettleChain, signOut, signIn, signUp, choose, confirmOtp, createBusiness, updateBusiness, setVerify, setDestination, setMode],
  )

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <span className="animate-pulse">
          <Logo />
        </span>
      </div>
    )
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): Session {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
