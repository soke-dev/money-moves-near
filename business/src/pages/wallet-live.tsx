/**
 * The live business wallet: the owner's own. Admins see it too, but can't send.
 *
 * Loaded only on the Wallet page, so the wallet sign-in code never slows the
 * rest of the dashboard. The owner signs in with the email they use here (a
 * code is sent to it), and the wallet that comes with that sign-in is the
 * business's. They choose a 6-digit transfer PIN as they create it; sending
 * from the wallet takes the PIN as well. The sign-in lasts as long as the
 * wallet's own session allows; the PIN never expires, and a forgotten one is
 * reset with an email code. Everyone else on the team sees the wallet, and
 * can't move it.
 *
 * Nothing on this page is a sample: until the wallet exists, it says so.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { DynamicContextProvider, getAuthToken, useConnectWithOtp, useDynamicContext, useEmbeddedReveal, useIsLoggedIn, useStepUpAuthentication, useUserWallets } from '@dynamic-labs/sdk-react-core'
import { EthereumWalletConnectors, isEthereumWallet } from '@dynamic-labs/ethereum'
import { SolanaWalletConnectors, isSolanaWallet } from '@dynamic-labs/solana'
import { api, ApiError, type ApiRefund } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { PlaceBadge, PlaceGroup, PlaceRow, WalletDesign, type Holding, type Movement, type WalletSource } from './balances'
import { bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, useTargets } from '@/state/targets'
import type { Asset, Chain } from '@/data/mock'
import { ChainIcon, PayIcon, TokenIcon } from '@/components/brand'
import { cx } from '@/components/ui'
import { useSession } from '@/state/session'
import { Button, Checkbox, Empty, Field, Input, Modal, PageHeader, Segmented, Select, StepBar } from '@/components/ui'
import { Check, Loader2, Plus, ShieldCheck } from '@/components/icons'

const ENV_ID: string | undefined = import.meta.env.VITE_DYNAMIC_ENVIRONMENT_ID

export interface ApiWallet {
  email: string
  evmAddress: string | null
  solanaAddress: string | null
  movementAddress: string | null
  pinSet: boolean
  locked: boolean
  createdAt: string
}
interface WalletState {
  wallet: ApiWallet | null
  exists?: boolean
  canCreate: boolean
  verified: boolean
  isOwner: boolean
}
export interface Balance {
  chain: string
  asset: string
  amount: number
}

const SUB = 'Your business’s own wallet. Payments you choose to settle here arrive as USDC, and only the owner can send them on, with their transfer PIN.'

export default function LiveWallet() {
  if (!ENV_ID) {
    return (
      <>
        <PageHeader title="Business wallet" sub={SUB} />
        <Empty title="Business wallets open soon." sub="Until then, every payment settles to your bank account or Money Moves account the moment it’s paid." />
      </>
    )
  }
  return (
    <DynamicContextProvider
      settings={{
        environmentId: ENV_ID,
        walletConnectors: [EthereumWalletConnectors, SolanaWalletConnectors],
        appName: 'Money Moves Business',
        initialAuthenticationMode: 'connect-and-sign',
      }}
    >
      <WalletPage />
    </DynamicContextProvider>
  )
}

function useWalletState(businessId: string | undefined) {
  const [state, setState] = useState<WalletState | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!businessId) return
    try {
      setState(await api<WalletState>('GET', `/businesses/${businessId}/wallet`))
      setError('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t load your wallet.')
    }
  }, [businessId])
  useEffect(() => {
    void load()
  }, [load])
  return { state, error, reload: load }
}

function WalletPage() {
  const { business, user } = useSession()
  const { state, error, reload } = useWalletState(business?.id)
  if (!business) return null
  if (error) return <Shell><Empty title="Couldn’t open your wallet." sub={error} actions={<Button onClick={() => void reload()}>Try again</Button>} /></Shell>
  if (!state) return <Shell><Spinner /></Shell>

  // The owner's wallet: admins see it, with its balance and history, and nobody else on the team does.
  if (!state.isOwner && !state.wallet) {
    return state.exists ? (
      <Shell><Empty title="The business wallet is the owner’s." sub="Only the owner and admins can see the wallet, and only the owner can send from it. Payments still settle where they’re set to, and you can follow them in Settlements." actions={<Link to="/balances/settlements"><Button>Settlements</Button></Link>} /></Shell>
    ) : (
      <Shell><Empty title="No business wallet yet." sub="The owner creates it, once the business is verified. Until then, payments settle to the bank account or Money Moves account they’re set to." actions={<Link to="/balances/settlements"><Button>Settlements</Button></Link>} /></Shell>
    )
  }
  if (!state.isOwner && state.wallet) return <WalletView wallet={state.wallet} owner={false} onChanged={() => void reload()} />
  if (!state.wallet) {
    if (!state.verified) {
      return (
        <Shell>
          <Empty
            title="Your business wallet opens once you’re verified."
            sub="Finish verification first. Then the owner creates the wallet here, in a minute."
            actions={<Link to="/settings/compliance"><Button>Go to verification</Button></Link>}
          />
        </Shell>
      )
    }
    return <Shell><CreateWallet ownerEmail={user?.email ?? ''} onDone={() => void reload()} /></Shell>
  }

  // The owner sees the wallet at once, from our own records and the chain, and signs in to it only for what needs its key.
  return <WalletView wallet={state.wallet} owner onChanged={() => void reload()} />
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Business wallet" sub={SUB} />
      {children}
    </>
  )
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 py-16 text-[13.5px] text-dim">
      <Loader2 className="size-4 animate-spin" /> Opening your wallet…
    </div>
  )
}

/** The wallet sign-in, for the account's own email only. */
function useWalletSignIn(email: string) {
  const { user, handleLogOut, sdkHasLoaded } = useDynamicContext()
  const loggedIn = useIsLoggedIn()
  const wallets = useUserWallets()
  const signedEmail = (user?.email ?? '').toLowerCase()
  const wrongEmail = loggedIn && !!signedEmail && signedEmail !== email.toLowerCase()
  return { ready: sdkHasLoaded, loggedIn: loggedIn && !wrongEmail, wrongEmail, signedEmail, walletsReady: wallets.length > 0, signOut: handleLogOut }
}

/**
 * Signs in to the wallet with the email on the account, and no other: the code
 * goes to that address and is typed here. There's no box to type an email in,
 * so the wallet can only ever be opened by the account's owner.
 */
function SignInCard({ email, title, sub, bare }: { email: string; title: string; sub: string; bare?: boolean }) {
  const s = useWalletSignIn(email)
  const otp = useConnectWithOtp()
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const say = (e: unknown, fallback: string) => setError(e instanceof Error && e.message && !/dynamic/i.test(e.message) ? e.message : fallback)
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await otp.connectWithEmail(email.trim().toLowerCase())
      setSent(true)
      setCode('')
    } catch (e) {
      say(e, 'We couldn’t send the code just now. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await otp.verifyOneTimePassword(code)
    } catch (e) {
      say(e, 'That code isn’t right, or it has expired. Check it, or send a new one.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={bare ? '' : 'max-w-[560px] rounded-[10px] border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,18,16,0.05)]'}>
      {!bare && <h2 className="display text-[19px] font-semibold text-fg">{title}</h2>}
      <p className={cx('text-[13.5px] leading-relaxed text-dim', !bare && 'mt-1.5')}>{sub}</p>
      {s.wrongEmail ? (
        <div className="mt-5 rounded-[8px] bg-[#FBF3E2] px-4 py-3 text-[13px] text-[#7A5A12]">
          This browser is signed in to a wallet for {s.signedEmail}. Your business wallet opens with {email}, the email on your account.
          <div className="mt-3">
            <Button size="sm" onClick={() => void s.signOut()}>Sign out of it</Button>
          </div>
        </div>
      ) : !sent ? (
        <div className="mt-5">
          <Button variant="primary" disabled={!s.ready || busy} onClick={() => void send()} icon={!s.ready || busy ? <Loader2 className="size-4 animate-spin" /> : undefined}>
            Send a code to {email}
          </Button>
          <p className="mt-2.5 text-[12.5px] text-dim">Only the email on your account can open your business wallet.</p>
        </div>
      ) : (
        <div className="mt-5">
          <Field label={`The 6-digit code we sent to ${email}`} required>
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void confirm()}
              placeholder="••••••"
              className="max-w-[200px] tracking-[0.3em]"
            />
          </Field>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={busy || code.length !== 6} onClick={() => void confirm()} icon={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}>
              Continue
            </Button>
            <button type="button" disabled={busy} onClick={() => void send()} className="text-[13px] font-medium text-muted underline underline-offset-2 hover:text-fg">
              Send a new code
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
    </div>
  )
}

/** A 6-digit PIN, typed twice. */
function PinFields({ pin, again, setPin, setAgain, label = 'Transfer PIN' }: { pin: string; again: string; setPin: (v: string) => void; setAgain: (v: string) => void; label?: string }) {
  const clean = (v: string) => v.replace(/\D/g, '').slice(0, 6)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={label} required hint="6 digits. You’ll type it every time money leaves the wallet.">
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(clean(e.target.value))} placeholder="••••••" />
      </Field>
      <Field label="Type it again" required error={again.length === 6 && again !== pin ? 'The two PINs don’t match.' : undefined}>
        <Input type="password" inputMode="numeric" autoComplete="new-password" value={again} onChange={(e) => setAgain(clean(e.target.value))} placeholder="••••••" />
      </Field>
    </div>
  )
}

function CreateWallet({ ownerEmail, onDone }: { ownerEmail: string; onDone: () => void }) {
  const { business } = useSession()
  const s = useWalletSignIn(ownerEmail)
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!s.ready) return <Spinner />
  if (!s.loggedIn) {
    return <SignInCard email={ownerEmail} title="Create your business wallet" sub="First, confirm it’s you with a code to your email. Then you choose a 6-digit transfer PIN, and the wallet is made. It’s yours: Money Moves never holds its keys, and can’t move what’s in it." />
  }
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const token = getAuthToken()
      if (!token) throw new ApiError(401, 'Your wallet sign-in has expired. Sign in again.')
      await api('POST', `/businesses/${business!.id}/wallet`, { token, pin })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We couldn’t create your wallet. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-[560px] rounded-[10px] border border-line bg-card p-6 shadow-[0_1px_2px_rgba(18,18,16,0.05)]">
      <h2 className="display text-[19px] font-semibold text-fg">Choose your transfer PIN</h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-dim">Signed in as {s.signedEmail}. Your PIN is asked every time money leaves the wallet. You can change it later, or reset it by email if you forget it.</p>
      <div className="mt-5">
        <PinFields pin={pin} again={again} setPin={setPin} setAgain={setAgain} />
      </div>
      {!s.walletsReady && <p className="mt-3 text-[12.5px] text-dim">Your wallet is still being set up. This takes a few seconds.</p>}
      {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
      <div className="mt-5">
        <Button variant="primary" disabled={busy || pin.length !== 6 || pin !== again || !s.walletsReady} onClick={() => void create()} icon={busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}>
          Create wallet
        </Button>
      </div>
    </div>
  )
}

/** A settlement as the wallet's activity reads it: the chain it came on and the USDC it carried. */
interface WalletSettlement {
  id: string
  ref: string
  txHash: string | null
  toAddress: string | null
  destination: string
  status: 'settled' | 'pending'
  chain: string | null
  amountUsdc: number | null
  amountUsd: number
  paymentRef: string
  createdAt: string
}
const SETTLED_ON: Record<string, Chain> = { MOVEMENT: 'Movement', SOLANA: 'Solana', ARC: 'Arc', MONAD: 'Monad', STELLAR: 'Stellar' }
/** Where a transaction can be seen, by chain. */
const EXPLORER: Record<string, string> = {
  MOVEMENT: 'https://explorer.movementnetwork.xyz/txn/{h}?network=mainnet',
  SOLANA: 'https://solscan.io/tx/{h}',
  MONAD: 'https://monadscan.com/tx/{h}',
  ARC: 'https://explorer.arc.io/tx/{h}',
  STELLAR: 'https://stellar.expert/explorer/public/tx/{h}',
}
/** Explorers by the network's name, for deposits read from every chain. */
const EXPLORER_BY_NAME: Record<string, string> = {
  Movement: EXPLORER.MOVEMENT!,
  Solana: EXPLORER.SOLANA!,
  Monad: EXPLORER.MONAD!,
  Arc: EXPLORER.ARC!,
  Stellar: EXPLORER.STELLAR!,
  Base: 'https://basescan.org/tx/{h}',
  'BNB Chain': 'https://bscscan.com/tx/{h}',
  Arbitrum: 'https://arbiscan.io/tx/{h}',
  Optimism: 'https://optimistic.etherscan.io/tx/{h}',
  Ethereum: 'https://etherscan.io/tx/{h}',
}
interface WalletDeposit {
  chain: string
  asset: 'USDC' | 'USDT'
  amount: number
  from: string | null
  tx: string
  at: string
}
const txOf = (chain: string | null, hash: string | null) => (hash ? { hash, url: chain && EXPLORER[chain] ? EXPLORER[chain]!.replace('{h}', hash) : null } : null)
const SEND_WORDS: Record<string, string> = { SENT: 'On its way', CONFIRMED: 'Sent', PAYING: 'On its way to your bank', PAID: 'Paid to your bank' }

/**
 * The live wallet, in the same design as the test wallet: its balance read
 * from each chain, USDC and USDT by network, and every movement - settlements
 * in, sends out. Sending is the real thing (the owner's wallet signs, with the
 * PIN); the rest of the team sees it all and can't move it.
 */
function WalletView({ wallet, owner, onChanged }: { wallet: ApiWallet; owner: boolean; onChanged: () => void }) {
  const { business } = useSession()
  // From Settings, after picking Stellar: Receive opens straight away, with Stellar's setup in it.
  const [params, setParams] = useSearchParams()
  const [openReceive] = useState(() => params.get('receive') === 'stellar')
  // From a refund: Send opens with the refund filled in, once the owner is signed in to the wallet.
  const [refundId] = useState(() => params.get('refund'))
  useEffect(() => {
    if (params.has('receive') || params.has('refund')) setParams((x) => { x.delete('receive'); x.delete('refund'); return x }, { replace: true })
  }, [params, setParams])
  const [refundSend, setRefundSend] = useState<RefundSend | null>(null)
  const [refundNote, setRefundNote] = useState('')
  const [balances, setBalances] = useState<Balance[] | null>(null)
  const [rate, setRate] = useState(0)
  const platformNow = useApi<{ platform: { maintenance: boolean; fees: { payoutNgn: number } } }>('/config').data?.platform
  const feeNgn = platformNow?.fees.payoutNgn ?? 100
  // Maintenance on our side: nothing can be sent from the wallet until it's over.
  const paused = !!platformNow?.maintenance
  const [pinModal, setPinModal] = useState<'change' | 'reset' | null>(null)
  const [sending, setSending] = useState(false)
  const [sends, setSends] = useState<ApiSend[]>([])
  const [settled, setSettled] = useState<WalletSettlement[]>([])
  const [stellar, setStellar] = useState<{ address: string; open: boolean } | null>(null)
  const [deposits, setDeposits] = useState<WalletDeposit[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  // What the owner asked for, held while they sign in to the wallet; it carries on once they're in.
  const signIn = useWalletSignIn(wallet.email)
  const [waiting, setWaiting] = useState<null | (() => void)>(null)
  const needWallet = useCallback((fn: () => void) => (signIn.loggedIn ? fn() : setWaiting(() => fn)), [signIn.loggedIn])
  useEffect(() => {
    if (!signIn.loggedIn || !waiting) return
    const fn = waiting
    setWaiting(null)
    fn()
  }, [signIn.loggedIn, waiting])
  const refresh = useCallback((fresh = false) => {
    if (!business) return Promise.resolve()
    const base = `/businesses/${business.id}`
    // Deposits from anywhere: read from the chains, a little slower, so they arrive on their own.
    const reading = api<{ deposits: WalletDeposit[] }>('GET', `${base}/wallet/deposits${fresh ? '?fresh=1' : ''}`)
      .then((r) => setDeposits(r.deposits))
      .catch(() => undefined)
    api<{ balances: Balance[]; ngnPerUsd?: number | null }>('GET', `${base}/wallet/balances`)
      .then((r) => {
        setBalances(r.balances)
        if (r.ngnPerUsd) setRate(r.ngnPerUsd)
      })
      .catch(() => setBalances([]))
    api<{ sends: ApiSend[] }>('GET', `${base}/wallet/sends`)
      .then((r) => setSends(r.sends))
      .catch(() => undefined)
    api<{ settlements: WalletSettlement[] }>('GET', `${base}/settlements?mode=live`)
      .then((r) => setSettled(r.settlements.filter((x) => x.destination === 'WALLET')))
      .catch(() => undefined)
    const opened = api<{ stellar: { address: string; open: boolean } | null }>('GET', `${base}/wallet/stellar`)
      .then((r) => setStellar(r.stellar))
      .catch(() => undefined)
    return Promise.all([reading, opened]).then(() => undefined)
  }, [business])
  const refreshNow = () => {
    setRefreshing(true)
    void refresh(true).finally(() => setRefreshing(false))
  }
  useEffect(() => {
    refresh()
  }, [refresh])
  useEffect(() => {
    if (!refundId || !business || !owner) return
    api<{ refund: ApiRefund }>('GET', `/businesses/${business.id}/refunds/${refundId}`)
      .then(({ refund: r }) => {
        if (r.status !== 'AWAITING_FUNDS' || r.funding !== 'WALLET') return setRefundNote(`Refund ${r.ref} isn't waiting for your wallet any more.`)
        if (wallet.locked || paused) return
        needWallet(() => setRefundSend({ id: r.id, ref: r.ref, amountUsdc: r.fund.amountUsd }))
      })
      .catch(() => setRefundNote("We couldn't open that refund. Start it again from the payment."))
    // Once, for the refund it was opened with.
  }, [refundId, business?.id, owner]) // eslint-disable-line react-hooks/exhaustive-deps
  // While something is on its way, look again every few seconds.
  useEffect(() => {
    if (!sends.some((x) => x.status === 'SENT' || x.status === 'PAYING')) return
    const t = setInterval(refresh, 5000)
    return () => clearInterval(t)
  }, [sends, refresh])

  const holdings: Holding[] = (balances ?? []).filter((b) => b.amount > 0).map((b) => ({ asset: b.asset as Asset, chain: b.chain as Chain, amount: b.amount }))
  const activity: Movement[] = [
    ...settled.map((x) => ({
      id: x.id,
      kind: 'in',
      label: `Settlement · ${x.paymentRef}`,
      asset: 'USDC' as Asset,
      chain: SETTLED_ON[x.chain ?? ''] ?? ('Movement' as Chain),
      amount: x.amountUsdc ?? x.amountUsd,
      status: x.status === 'settled' ? 'completed' : 'processing',
      createdAt: x.createdAt,
      details: [
        { k: 'Settlement', v: x.ref, mono: true },
        { k: 'For payment', v: x.paymentRef, mono: true },
        ...(x.toAddress ? [{ k: 'To', v: x.toAddress, mono: true }] : []),
      ],
      tx: txOf(x.chain, x.txHash),
    })),
    // Only what moved: a send never signed, or one that failed, left nothing.
    ...sends
      .filter((x) => x.status !== 'PREPARED' && x.status !== 'EXPIRED' && x.status !== 'FAILED')
      .map((x) => ({
        id: x.id,
        kind: 'out',
        label: x.bank ? `Bank transfer to ${x.bank.name ?? 'your bank'} ••${(x.bank.account ?? '').slice(-4)}` : x.refundId ? (x.label ?? 'Refund') : `Sent to ${x.label ?? short(x.toAddress ?? '')}`,
        asset: 'USDC' as Asset,
        chain: (CHAIN_NAME[x.chain] ?? x.chain) as Chain,
        amount: x.amountUsdc,
        status: x.status === 'CONFIRMED' || x.status === 'PAID' ? 'completed' : 'processing',
        createdAt: x.createdAt,
        details: [
          { k: 'Reference', v: x.ref, mono: true },
          ...(x.bank
            ? [
                { k: 'To', v: `${x.bank.name ?? 'Bank'} ••${(x.bank.account ?? '').slice(-4)}${x.bank.accountName ? ` · ${x.bank.accountName}` : ''}` },
                ...(x.payoutNgn != null ? [{ k: 'Arrives in the bank', v: naira(x.payoutNgn) }] : []),
                ...(x.feeNgn != null ? [{ k: 'Payout fee', v: naira(x.feeNgn) }] : []),
                { k: 'Where it is', v: SEND_WORDS[x.status] ?? 'On its way' },
              ]
            : x.refundId
              ? [{ k: 'For', v: 'A refund to your customer, sent on by us' }]
              : [{ k: 'To', v: x.toAddress ?? '', mono: true }]),
        ],
        tx: txOf(x.chain, x.txHash),
      })),
    // Money in from anywhere else: the owner's own wallet, a customer, an exchange.
    ...deposits
      .filter((d) => !settled.some((x) => x.txHash && x.txHash.toLowerCase() === d.tx.toLowerCase()))
      .map((d) => ({
      id: `dep:${d.tx}:${d.asset}`,
      kind: 'in',
      label: d.from ? `Received from ${short(d.from)}` : 'Received',
      asset: d.asset as Asset,
      chain: d.chain as Chain,
      amount: d.amount,
      status: 'completed',
      createdAt: d.at,
      details: [...(d.from ? [{ k: 'From', v: d.from, mono: true }] : []), { k: 'To', v: 'This wallet' }],
      tx: { hash: d.tx, url: EXPLORER_BY_NAME[d.chain] ? EXPLORER_BY_NAME[d.chain]!.replace('{h}', d.tx) : null },
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const receive = [
    ...(wallet.evmAddress ? [{ label: 'Base, BNB Chain, Arc, Monad and other EVM networks', address: wallet.evmAddress }] : []),
    ...(wallet.solanaAddress ? [{ label: 'Solana', address: wallet.solanaAddress }] : []),
    ...(wallet.movementAddress ? [{ label: 'Movement', address: wallet.movementAddress }] : []),
    ...(stellar?.open ? [{ label: 'Stellar', address: stellar.address }] : []),
  ]
  const source: WalletSource = {
    base: { test: false, usd: holdings.reduce((t, h) => t + h.amount, 0), address: wallet.evmAddress ?? '', holdings, receive, activity },
    loading: balances === null,
    onRefresh: refreshNow,
    refreshing,
    onSend: () => undefined,
    openSend: owner && !wallet.locked && !paused ? () => needWallet(() => setSending(true)) : undefined,
    notice: refundNote ? (
        <div className="mt-4 rounded-[12px] border border-line bg-raise px-4 py-3 text-[13px] leading-relaxed text-muted">{refundNote}</div>
      ) : owner && (paused || wallet.locked) ? (
        <div className="mt-4 rounded-[12px] border border-[#F2D3A6] bg-[#FDF6E7] px-4 py-3 text-[13px] leading-relaxed text-[#7A4A0A]">
          {paused
            ? 'Sending from your wallet is paused for a short while for maintenance. Your money is safe here, and you can still receive.'
            : 'Sending is paused after too many wrong PINs. Reset your PIN by email, at the bottom of this page, to carry on.'}
        </div>
      ) : null,
    canSend: owner,
    receiveFooter: wallet.solanaAddress && stellar && !stellar.open ? <StellarStrip owner={owner} onOpened={refresh} guard={needWallet} /> : null,
    receiveOnOpen: openReceive,
    after: owner ? (
      <section className="mt-10 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-card px-5 py-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">Transfer PIN and keys</div>
          <div className="text-[12.5px] text-dim">{wallet.locked ? 'Sending and export are paused after too many wrong PINs. Reset your PIN by email to carry on.' : 'Your PIN is asked every time money leaves the wallet, and before its keys are shown.'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setPinModal('change')}>Change PIN</Button>
          <Button size="sm" disabled={wallet.locked} onClick={() => needWallet(() => setExporting(true))}>Export wallet</Button>
          <Button size="sm" variant="ghost" onClick={() => setPinModal('reset')}>Forgot your PIN?</Button>
        </div>
      </section>
    ) : null,
  }
  return (
    <>
      <WalletDesign source={source} />
      <PinModal mode={pinModal} onClose={() => setPinModal(null)} onDone={() => { setPinModal(null); onChanged() }} />
      <ExportModal open={exporting} onClose={() => setExporting(false)} />
      <Modal open={!!waiting} onClose={() => setWaiting(null)} width={440} title="Sign in to your wallet" sub="Your wallet's key stays with your own sign-in, so it opens with a code to your email.">
        {signIn.ready ? (
          <SignInCard bare email={wallet.email} title="" sub="Once you're in, this carries on by itself. You stay signed in on this browser for a while." />
        ) : (
          <div className="flex items-center gap-2 py-6 text-[13.5px] text-dim">
            <Loader2 className="size-4 animate-spin" /> Getting your wallet ready…
          </div>
        )}
      </Modal>
      {sending && <LiveSend balances={balances ?? []} rate={rate} feeNgn={feeNgn} onClose={() => setSending(false)} onSent={() => void refresh()} />}
      {refundSend && balances && <LiveSend refund={refundSend} balances={balances} rate={rate} feeNgn={feeNgn} onClose={() => setRefundSend(null)} onSent={() => void refresh()} />}
    </>
  )
}

function PinModal({ mode, onClose, onDone }: { mode: 'change' | 'reset' | null; onClose: () => void; onDone: () => void }) {
  const { business } = useSession()
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [challenge, setChallenge] = useState<{ id: string; email: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setCurrent('')
    setPin('')
    setAgain('')
    setChallenge(null)
    setCode('')
    setError('')
  }, [mode])
  if (!mode || !business) return null
  const base = `/businesses/${business.id}/wallet/pin`
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const ready = pin.length === 6 && pin === again
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'change' ? 'Change your transfer PIN' : 'Reset your transfer PIN'}
      sub={mode === 'reset' ? (challenge ? `We sent a code to ${challenge.email}.` : 'We’ll email a code to the owner’s address.') : undefined}
      footer={
        mode === 'change' ? (
          <Button variant="primary" disabled={busy || current.length !== 6 || !ready} onClick={() => void run(async () => { await api('POST', `${base}/change`, { currentPin: current, newPin: pin }); onDone() })}>Save new PIN</Button>
        ) : challenge ? (
          <Button variant="primary" disabled={busy || code.length !== 6 || !ready} onClick={() => void run(async () => { await api('POST', `${base}/reset/finish`, { challenge: challenge.id, code, newPin: pin }); onDone() })}>Save new PIN</Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={() => void run(async () => { const r = await api<{ challenge: string; email: string }>('POST', `${base}/reset`); setChallenge({ id: r.challenge, email: r.email }) })}>Email me a code</Button>
        )
      }
    >
      <div className="grid gap-4">
        {mode === 'change' && (
          <Field label="Current PIN" required>
            <Input type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" />
          </Field>
        )}
        {mode === 'reset' && challenge && (
          <Field label="Code from your email" required>
            <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 digits" />
          </Field>
        )}
        {(mode === 'change' || challenge) && <PinFields pin={pin} again={again} setPin={setPin} setAgain={setAgain} label="New PIN" />}
        {error && <p className="text-[13px] text-red">{error}</p>}
      </div>
    </Modal>
  )
}

// ─── Sending ──────────────────────────────────────────────────────────────

interface ApiSend {
  id: string
  ref: string
  kind: 'ADDRESS' | 'BANK'
  status: 'PREPARED' | 'SENT' | 'CONFIRMED' | 'PAYING' | 'PAID' | 'FAILED' | 'EXPIRED'
  chain: string
  toAddress: string | null
  amountUsdc: number
  bank: { name: string | null; account: string | null; accountName: string | null } | null
  ngnPerUsd: number | null
  feeNgn: number | null
  payoutNgn: number | null
  txHash: string | null
  failureReason: string | null
  createdAt: string
  /** To a Money Moves account: its @username. Funding a refund: "Refund MMBR-…". */
  label?: string | null
  refundId?: string | null
}
/** A refund funded from the wallet: a fixed amount to us, which we send on to the customer. */
interface RefundSend {
  id: string
  ref: string
  amountUsdc: number
}
interface UnsignedTx {
  chainId: number
  to: string
  data: string
  value: string
  nonce: number
  gasLimit: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
}

const CHAIN_NAME: Record<string, string> = { ARC: 'Arc', MONAD: 'Monad', MOVEMENT: 'Movement', SOLANA: 'Solana' }
type SendChain = 'ARC' | 'MONAD' | 'MOVEMENT' | 'SOLANA'
/** Movement and Solana: the owner's Ed25519 key signs the transaction's bytes, which we build as they approve. */
const signsBytes = (c: string) => c === 'MOVEMENT' || c === 'SOLANA'
const short = (a: string) => (a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a)
const naira = (n: number | null) => '₦' + (n ?? 0).toLocaleString()

/**
 * Signs the prepared transaction with the owner's own wallet - the key never
 * leaves their sign-in. Through the wallet's account directly where it can:
 * the wallet's signing client looks the network up in its own list first, and
 * a chain missing from it (Monad, Arc) stops it before it signs.
 */
function useSignEvm() {
  const wallets = useUserWallets()
  return async (tx: UnsignedTx) => {
    const w = wallets.find((x) => isEthereumWallet(x))
    if (!w || !isEthereumWallet(w)) throw new ApiError(0, 'Your wallet isn’t ready on this browser. Sign in to it again.')
    const connector = w.connector as unknown as { getViemAccount?: (o: { accountAddress: string }) => Promise<{ signTransaction?: (t: Record<string, unknown>) => Promise<string> }> }
    const account = connector.getViemAccount ? await connector.getViemAccount({ accountAddress: w.address }) : null
    if (account?.signTransaction) {
      return (await account.signTransaction({
        type: 'eip1559',
        chainId: tx.chainId,
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value),
        nonce: tx.nonce,
        gas: BigInt(tx.gasLimit),
        maxFeePerGas: BigInt(tx.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
      })) as `0x${string}`
    }
    const client = await w.getWalletClient(String(tx.chainId))
    return client.signTransaction({
      account: client.account,
      chain: client.chain,
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value),
      nonce: tx.nonce,
      gas: BigInt(tx.gasLimit),
      maxFeePerGas: BigInt(tx.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
      type: 'eip1559',
    })
  }
}

/**
 * Signs a 32-byte hash with the owner's Solana key - Stellar signs with the
 * same Ed25519 key. Handed over as hex, the way the app does it: the wallet
 * signs the bytes the hex stands for. (Handed raw bytes, the wallet's signer
 * turns them into text first, which spoils a hash.) Returns the signature in
 * base58, as the wallet gives it.
 */
function useSignSolanaHash() {
  const wallets = useUserWallets()
  return async (hashHex: string) => {
    const w = wallets.find((x) => isSolanaWallet(x))
    if (!w || !isSolanaWallet(w)) throw new ApiError(0, 'Your wallet isn’t ready on this browser. Sign in to it again.')
    const signature = await w.signMessage(hashHex)
    if (!signature) throw new ApiError(0, 'Your wallet didn’t sign. Try again.')
    return signature
  }
}

/**
 * Stellar: the wallet's Solana key, in Stellar's form. It has to be opened for
 * USDC once before it can receive; we cover the reserve and the fee, and the
 * owner approves it with their wallet.
 */
function useStellarOpening(onOpened: () => void) {
  const { business } = useSession()
  const sign = useSignSolanaHash()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const open = async () => {
    if (!business) return
    setBusy(true)
    setError('')
    try {
      const r = await api<{ hash?: string; open?: boolean }>('POST', `/businesses/${business.id}/wallet/stellar/prepare`)
      if (r.hash) {
        const signature = await sign(r.hash)
        await api('POST', `/businesses/${business.id}/wallet/stellar/submit`, { signature, encoding: 'base58' })
      }
      onOpened()
    } catch (e) {
      const said = e instanceof Error && e.message ? e.message.replace(/dynamic/gi, 'wallet') : ''
      setError(e instanceof ApiError ? e.message : said ? `Couldn’t open it: ${said}` : 'Couldn’t open it just now. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return { open, busy, error }
}

/** Under the address in Receive: Stellar, waiting to be opened. */
function StellarStrip({ owner, onOpened, guard }: { owner: boolean; onOpened: () => void; guard: (fn: () => void) => void }) {
  const o = useStellarOpening(onOpened)
  return (
    <div className="rounded-[12px] border border-line bg-[#FAFAF8] px-3.5 py-3">
      <div className="flex items-start gap-3">
        <ChainIcon chain="Stellar" size={28} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-fg">Open your wallet on Stellar</div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-dim">
            {owner ? 'Once, before it can receive USDC there. We cover the cost, and you approve it with your wallet.' : 'The owner opens it once, before it can receive USDC there.'}
          </div>
        </div>
      </div>
      {o.error && <div className="mt-2 text-[12.5px] text-red">{o.error}</div>}
      {owner && (
        <Button size="sm" className="mt-3 w-full justify-center" disabled={o.busy} onClick={() => guard(() => void o.open())} icon={o.busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined}>
          {o.busy ? 'Opening…' : 'Open on Stellar'}
        </Button>
      )}
    </div>
  )
}

/**
 * Exporting the wallet: its private key, shown by the wallet itself in the
 * owner's browser - never through us. Four steps first: which wallet, what
 * it means, the transfer PIN (checked, counted and recorded by the API, which
 * emails the owner), and a fresh code to the owner's email, which is what the
 * wallet itself asks before it will show a key. Then the wallet's export opens.
 */
function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { business } = useSession()
  const wallets = useUserWallets()
  const { initExportProcess } = useEmbeddedReveal()
  const stepUp = useStepUpAuthentication()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [code, setCode] = useState('')
  const [which, setWhich] = useState<'evm' | 'solana'>('evm')
  const [private1, setPrivate1] = useState(false)
  const [private2, setPrivate2] = useState(false)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setStep(1)
    setPrivate1(false)
    setPrivate2(false)
    setPin('')
    setCode('')
    setError('')
  }, [open])
  if (!open || !business) return null
  const say = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : e instanceof Error && e.message ? e.message.replace(/dynamic/gi, 'wallet') : fallback)
  const wallet = () => wallets.find((x) => (which === 'evm' ? isEthereumWallet(x) : isSolanaWallet(x)))
  // The PIN, checked by us; then a code to their email, which the wallet asks for before it shows a key.
  const checkPin = async () => {
    setBusy(true)
    setError('')
    try {
      if (!wallet()) throw new ApiError(0, 'Your wallet isn’t ready on this browser. Sign in to it again.')
      await api('POST', `/businesses/${business.id}/wallet/export`, { pin, which })
      // Nothing back means the wallet wants a captcha first, which this window can't show.
      if (!(await stepUp.sendOtp())) throw new ApiError(0, 'The wallet needs an extra check it can’t do here. Try again in a few minutes.')
      setStep(4)
    } catch (e) {
      say(e, 'That didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const reveal = async () => {
    setBusy(true)
    setError('')
    try {
      const w = wallet()
      if (!w) throw new ApiError(0, 'Your wallet isn’t ready on this browser. Sign in to it again.')
      await stepUp.verifyOtp({ verificationToken: code, requestedScopes: ['wallet:export'] as never })
      onClose()
      await initExportProcess(false, false, w.id)
    } catch (e) {
      say(e, 'That code isn’t right, or it has expired. Check it, or start again.')
    } finally {
      setBusy(false)
    }
  }
  const choice = (id: 'evm' | 'solana', title: string, sub: string) => (
    <label className={cx('flex cursor-pointer gap-3 rounded-[12px] border px-3.5 py-3', which === id ? 'border-fg' : 'border-line')}>
      <input type="radio" name="which" checked={which === id} onChange={() => setWhich(id)} className="mt-1 accent-[#111]" />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-fg">{title}</span>
        <span className="block text-[12.5px] leading-relaxed text-muted">{sub}</span>
      </span>
    </label>
  )
  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      title="Export your wallet"
      sub={step === 1 ? 'Step 1 of 4: which wallet' : step === 2 ? 'Step 2 of 4: before you go on' : step === 3 ? 'Step 3 of 4: your transfer PIN' : 'Step 4 of 4: the code in your email'}
      footer={
        step === 1 ? (
          <Button variant="primary" onClick={() => setStep(2)}>Continue</Button>
        ) : step === 2 ? (
          <Button variant="primary" disabled={!private1 || !private2} onClick={() => setStep(3)}>I understand</Button>
        ) : step === 3 ? (
          <Button variant="primary" disabled={busy || pin.length !== 6} onClick={() => void checkPin()} icon={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || code.length !== 6} onClick={() => void reveal()} icon={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}>
            Show my private key
          </Button>
        )
      }
    >
      {step === 1 && (
        <div className="space-y-2.5">
          {choice('evm', 'EVM networks', 'Base, BNB Chain, Arc, Monad, Arbitrum, Optimism and Ethereum share this key.')}
          {choice('solana', 'Movement, Solana and Stellar', 'One key controls the wallet on all three. It shows in Solana’s form: wallets for Movement and Stellar take the same key in their own format.')}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-3">
          <div className="rounded-[12px] border border-[#F2D3A6] bg-[#FDF6E7] px-3.5 py-3 text-[13px] leading-relaxed text-[#7A4A0A]">
            Your private key is the wallet. Anyone who sees it can take everything in it, on every network it covers, and no one can undo that. Money Moves will never ask you for it.
          </div>
          <label className="flex gap-2.5 text-[13.5px] text-fg">
            <input type="checkbox" checked={private1} onChange={(e) => setPrivate1(e.target.checked)} className="mt-0.5 accent-[#111]" />
            I'm somewhere private, and no one can see my screen.
          </label>
          <label className="flex gap-2.5 text-[13.5px] text-fg">
            <input type="checkbox" checked={private2} onChange={(e) => setPrivate2(e.target.checked)} className="mt-0.5 accent-[#111]" />
            I'll keep it offline and never share it, paste it into a website, or send it to anyone.
          </label>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3">
          <Field label="Transfer PIN" required hint="We email you when a wallet's keys are opened.">
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && pin.length === 6 && void checkPin()}
              placeholder="••••••"
            />
          </Field>
          {error && <p className="text-[13px] text-red">{error}</p>}
        </div>
      )}
      {step === 4 && (
        <div className="space-y-3">
          <Field label="The 6-digit code we just sent to your email" required hint="One more check, asked by the wallet itself before it shows a key.">
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void reveal()}
              placeholder="••••••"
              className="tracking-[0.3em]"
            />
          </Field>
          <button type="button" disabled={busy} onClick={() => void stepUp.sendOtp().catch((e) => say(e, 'Couldn’t send a new code. Try again.'))} className="text-[13px] font-medium text-muted underline underline-offset-2 hover:text-fg">
            Send a new code
          </button>
          {error && <p className="text-[13px] text-red">{error}</p>}
        </div>
      )}
    </Modal>
  )
}

// ─── Sending, in the wallet's own design ─────────────────────────────────

type SendKind = 'bank' | 'mm' | 'crypto'
const SEND_ON: Record<SendChain, Chain> = { MOVEMENT: 'Movement', SOLANA: 'Solana', ARC: 'Arc', MONAD: 'Monad' }
const sendKeyOf = (c: string): SendChain | null => (Object.keys(SEND_ON) as SendChain[]).find((k) => SEND_ON[k] === c) ?? null
const floor6 = (n: number) => Math.floor(n * 1e6) / 1e6
const ceil6 = (n: number) => Math.ceil(n * 1e6) / 1e6
const inUsdc = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDC`
const inNgn = (n: number) => `₦${Math.round(n).toLocaleString('en-NG')}`

/**
 * Money out of the wallet, in the same steps as the test wallet: how, to whom,
 * how much - then the owner approves it with their PIN and their wallet, and
 * gets a receipt. A bank payout is typed in naira by default (what lands in
 * the account, the fee on top), or in dollars. One send comes from one coin:
 * the USDC on one network, the fullest first.
 */
function LiveSend({ balances, rate, feeNgn, onClose, onSent, refund }: { balances: Balance[]; rate: number; feeNgn: number; onClose: () => void; onSent: () => void; refund?: RefundSend }) {
  const { business } = useSession()
  const [stored, setTargets] = useTargets(business?.id)
  const signEvm = useSignEvm()
  const signHash = useSignSolanaHash()
  const banks = banksOf(stored)
  const mms = mmsOf(stored)
  const wallets = stored?.wallets ?? []
  const mainBank = defaultBankOf(stored)
  const mainMm = defaultMmOf(stored)
  // What it can send from: USDC on the networks it sends on, the fullest first.
  const coins = balances
    .filter((b) => b.asset === 'USDC' && b.amount > 0 && sendKeyOf(b.chain))
    .map((b) => ({ chain: b.chain as Chain, key: sendKeyOf(b.chain)!, amount: b.amount }))
    .sort((a, b) => b.amount - a.amount)
  const networks = [...new Set([...coins.map((c) => c.chain), ...Object.values(SEND_ON)])]

  // Funding a refund: where and how much are fixed, so it starts at where it's sent from.
  const [step, setStep] = useState<'method' | 'to' | 'amount' | 'approve' | 'done'>(refund ? 'amount' : 'method')
  const [kind, setKind] = useState<SendKind>(refund ? 'crypto' : 'bank')
  // 'b:<id>' a bank account, 'm:<id>' a Money Moves account, 'w:<index>' a saved wallet, 'new' one typed in now.
  const [pick, setPick] = useState('')
  const [fresh, setFresh] = useState<{ label: string; address: string; chain: Chain; save: boolean }>({ label: '', address: '', chain: coins[0]?.chain ?? 'Movement', save: true })
  const wallet = kind !== 'crypto' ? null : pick.startsWith('w:') ? (wallets[Number(pick.slice(2))] ?? null) : pick === 'new' ? { label: fresh.label.trim(), address: fresh.address.trim(), chain: fresh.chain } : null
  const bank = kind === 'bank' ? banks.find((b) => `b:${b.id}` === pick) : undefined
  const mm = kind === 'mm' ? mms.find((m) => `m:${m.id}` === pick) : undefined
  const toOk = kind === 'bank' ? !!bank?.verified : kind === 'mm' ? !!mm?.linked : !!wallet && wallet.address.length >= 24 && !!sendKeyOf(wallet.chain)
  const toLabel = refund ? `Refund ${refund.ref}` : kind === 'bank' ? (bank ? bankLabel(bank) : '') : kind === 'mm' ? (mm?.username ?? '') : wallet ? wallet.label || short(wallet.address) : ''

  // A wallet takes coins on its own network only.
  const eligible = coins.filter((c) => kind !== 'crypto' || !wallet || c.chain === wallet.chain)
  const [fromKey, setFromKey] = useState<SendChain | null>(null)
  const from = eligible.find((c) => c.key === fromKey) ?? (refund ? eligible.find((c) => c.amount >= refund.amountUsdc + (c.key === 'ARC' ? 0.01 : 0)) : undefined) ?? eligible[0]
  const [cur, setCur] = useState<'NGN' | 'USD'>('NGN')
  const [amt, setAmt] = useState('')
  const typed = Number(amt) || 0
  // Shown with thousands separators; kept as plain digits.
  const shown = amt ? `${Number(amt.split('.')[0] || 0).toLocaleString('en-US')}${amt.includes('.') ? `.${amt.split('.')[1]}` : ''}` : ''
  // What leaves the wallet, in USDC. A bank payout typed in naira lands as exactly that; the fee comes on top.
  const sendUsdc = refund ? refund.amountUsdc : kind === 'bank' ? (cur === 'NGN' ? (typed && rate ? ceil6((typed + feeNgn) / rate) : 0) : typed) : cur === 'NGN' ? (rate ? floor6(typed / rate) : 0) : typed
  const bankGets = cur === 'NGN' ? typed : Math.max(0, Math.floor(typed * rate - feeNgn))
  // Arc takes its fee out of the USDC itself, so a little stays behind.
  const available = from ? Math.max(0, floor6(from.amount - (from.key === 'ARC' ? 0.01 : 0))) : 0
  const maxIn = (c: 'NGN' | 'USD') => (kind === 'bank' ? (c === 'NGN' ? Math.max(0, Math.floor(available * rate - feeNgn)) : available) : c === 'NGN' ? Math.floor(available * rate) : available)
  const over = !!from && sendUsdc > available + 1e-9
  const amountOk = refund ? !!from && !over : typed > 0 && !!from && !over && (kind !== 'bank' || bankGets >= 100)

  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<ApiSend | null>(null)

  if (!business) return null
  const base = '/businesses/' + business.id + '/wallet/send'

  // The PIN and the wallet's approval, then it's sent: prepared by us, signed by the owner, checked and broadcast.
  const approve = async () => {
    if (!from) return
    setBusy(true)
    setError('')
    try {
      const to = refund ? { refundId: refund.id } : kind === 'bank' ? { bankAccountId: bank!.id } : kind === 'mm' ? { moneyMovesId: mm!.id } : { address: wallet!.address }
      const prepared = await api<{ send: ApiSend; tx: UnsignedTx | null }>('POST', base + '/prepare', { pin, chain: from.key, amountUsdc: sendUsdc, to })
      let sent: { send: ApiSend }
      if (signsBytes(from.key)) {
        const built = await api<{ message: string }>('POST', `${base}/${prepared.send.id}/build`)
        const signature = await signHash(built.message)
        sent = await api<{ send: ApiSend }>('POST', `${base}/${prepared.send.id}/submit`, { signature, encoding: 'base58' })
      } else {
        const signedTx = await signEvm(prepared.tx!)
        sent = await api<{ send: ApiSend }>('POST', `${base}/${prepared.send.id}/submit`, { signedTx })
      }
      if (!refund && kind === 'crypto' && pick === 'new' && fresh.save && wallet) {
        setTargets((t) => ({ ...t, wallets: [...(t.wallets ?? []), { label: wallet.label || short(wallet.address), address: wallet.address, chain: wallet.chain }] }))
      }
      setDone(sent.send)
      setStep('done')
      onSent()
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/dynamic/gi, 'wallet') : ''
      setError(e instanceof ApiError ? e.message : /reject|denied|cancel/i.test(msg) ? 'You didn’t approve it, so nothing was sent.' : msg ? `Nothing was sent: ${msg.slice(0, 180)}` : 'Something went wrong. Nothing was sent. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const footer =
    step === 'method' ? (
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            const firstBank = mainBank?.verified ? mainBank : banks.find((b) => b.verified)
            const firstMm = mainMm?.linked ? mainMm : mms.find((m) => m.linked)
            setPick(kind === 'bank' ? `b:${firstBank?.id ?? ''}` : kind === 'mm' ? `m:${firstMm?.id ?? ''}` : wallets.length ? 'w:0' : 'new')
            setStep('to')
          }}
        >
          Continue
        </Button>
      </>
    ) : step === 'to' ? (
      <>
        <Button onClick={() => setStep('method')}>Back</Button>
        <Button
          variant="primary"
          disabled={!toOk}
          onClick={() => {
            setCur(kind === 'bank' ? 'NGN' : 'USD')
            setAmt('')
            setFromKey(null)
            setStep('amount')
          }}
        >
          Continue
        </Button>
      </>
    ) : step === 'amount' ? (
      <>
        <Button onClick={() => (refund ? onClose() : setStep('to'))}>{refund ? 'Cancel' : 'Back'}</Button>
        <Button variant="primary" disabled={!amountOk} onClick={() => setStep('approve')}>
          Continue
        </Button>
      </>
    ) : step === 'approve' ? (
      <>
        <Button onClick={() => setStep('amount')} disabled={busy}>
          Back
        </Button>
        <Button variant="primary" disabled={busy || pin.length !== 6} icon={busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} onClick={() => void approve()}>
          {busy ? 'Waiting for your wallet' : 'Approve in wallet'}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    )

  const summary = (
    <div className="rounded-[10px] bg-raise px-4 py-1 text-[13.5px]">
      {kind === 'bank' ? (
        <>
          <div className="flex justify-between gap-4 py-2">
            <span className="text-muted">Rate</span>
            <span className="tabular text-fg">₦{Math.round(rate).toLocaleString()} to $1</span>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <span className="text-muted">Transfer fee</span>
            <span className="tabular text-fg">{inNgn(feeNgn)}</span>
          </div>
          <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
            <span className="truncate text-fg">{toLabel} gets</span>
            <span className="tabular text-fg">{inNgn(typed ? bankGets : 0)}</span>
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between gap-4 py-2">
            <span className="text-muted">{kind === 'mm' ? 'Fee' : 'Network fee'}</span>
            <span className="text-good">{from?.key === 'ARC' ? 'A fraction of a cent, from the USDC' : 'Free, we cover it'}</span>
          </div>
          <div className="flex justify-between gap-4 border-t border-line py-2.5 font-semibold">
            <span className="truncate text-fg">{toLabel} gets</span>
            <span className="tabular text-right text-fg">{sendUsdc ? inUsdc(sendUsdc) : '-'}</span>
          </div>
        </>
      )}
    </div>
  )

  return (
    <Modal open onClose={onClose} width={520} title={step === 'done' ? 'Receipt' : refund ? 'Fund a refund' : 'Send money'} footer={footer}>
      {step !== 'done' && (refund ? <StepBar steps={['From', 'Approve']} at={step === 'approve' ? 1 : 0} /> : <StepBar steps={['Method', 'To', 'Amount', 'Approve']} at={step === 'method' ? 0 : step === 'to' ? 1 : step === 'amount' ? 2 : 3} />)}

      {step === 'method' && (
        <div className="rise">
          <div className="mb-2 text-[13px] text-muted">How do you want to send it?</div>
          <div className="divide-y divide-soft overflow-hidden rounded-[10px] border border-line">
            <PlaceRow selected={kind === 'bank'} onClick={() => setKind('bank')} icon={<PlaceBadge src="/brand/bank.png" />} title="Bank transfer" sub={`Naira to your bank, usually in minutes · ${inNgn(feeNgn)} fee`} />
            <PlaceRow selected={kind === 'mm'} onClick={() => setKind('mm')} icon={<PayIcon method="app" asset="USDC" size={32} />} title="Money Moves" sub="To your Money Moves account, in seconds · free" />
            <PlaceRow selected={kind === 'crypto'} onClick={() => setKind('crypto')} icon={<PlaceBadge src="/brand/wallet.png" />} title="Crypto wallet" sub="USDC to a wallet, in seconds" />
          </div>
        </div>
      )}

      {step === 'to' && (
        <div className="rise space-y-4">
          {kind === 'bank' && (
            <PlaceGroup title={banks.length > 1 ? 'Your bank accounts' : 'Your bank account'} note={`${inNgn(feeNgn)} per transfer`}>
              {banks.length ? (
                banks.map((b) => (
                  <PlaceRow
                    key={b.id}
                    selected={pick === `b:${b.id}`}
                    disabled={!b.verified}
                    onClick={() => setPick(`b:${b.id}`)}
                    icon={<PlaceBadge src="/brand/bank.png" />}
                    title={bankLabel(b)}
                    sub={b.verified ? `${b.name}${b.id === mainBank?.id && banks.length > 1 ? ' · default' : ''}` : 'We are still checking the name on it'}
                  />
                ))
              ) : (
                <Link to="/settings/settlement" className="flex items-center gap-3 px-3.5 py-3 text-[13px] text-muted hover:bg-[#FAFAF8] hover:text-fg">
                  <Plus className="size-4" /> Add a bank account in Payout places
                </Link>
              )}
            </PlaceGroup>
          )}
          {kind === 'mm' && (
            <PlaceGroup title={mms.length > 1 ? 'Your Money Moves accounts' : 'Your Money Moves account'} note="Free · in seconds">
              {mms.length ? (
                mms.map((m) => (
                  <PlaceRow
                    key={m.id}
                    selected={pick === `m:${m.id}`}
                    disabled={!m.linked}
                    onClick={() => setPick(`m:${m.id}`)}
                    icon={<PayIcon method="app" asset="USDC" size={32} />}
                    title={m.username}
                    sub={m.linked ? `Your Money Moves account${m.id === mainMm?.id && mms.length > 1 ? ' · default' : ''}` : 'Approve the link in the app first'}
                  />
                ))
              ) : (
                <Link to="/settings/settlement" className="flex items-center gap-3 px-3.5 py-3 text-[13px] text-muted hover:bg-[#FAFAF8] hover:text-fg">
                  <Plus className="size-4" /> Link your Money Moves account in Payout places
                </Link>
              )}
            </PlaceGroup>
          )}
          {kind === 'crypto' && (
            <PlaceGroup title="Your crypto wallets" note="In seconds">
              {wallets.map((w, i) => (
                <PlaceRow
                  key={w.address + i}
                  selected={pick === `w:${i}`}
                  disabled={!sendKeyOf(w.chain)}
                  onClick={() => setPick(`w:${i}`)}
                  icon={<PlaceBadge src="/brand/wallet.png" chain={w.chain} />}
                  title={w.label}
                  sub={sendKeyOf(w.chain) ? `${short(w.address)} · ${w.chain}` : `Sending on ${w.chain} isn't open yet`}
                />
              ))}
              <PlaceRow
                selected={pick === 'new'}
                onClick={() => setPick('new')}
                icon={
                  <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-[#CFCCC3] text-muted">
                    <Plus className="size-4" />
                  </span>
                }
                title="Another address"
                sub="Paste a wallet address"
              />
              {pick === 'new' && (
                <div className="space-y-3 bg-[#FAFAF8] px-3.5 pb-3.5 pt-1">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[150px_1fr]">
                    <Field label="Network">
                      <Select value={fresh.chain} onChange={(e) => setFresh((f) => ({ ...f, chain: e.target.value as Chain }))}>
                        {networks.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Address">
                      <Input value={fresh.address} onChange={(e) => setFresh((f) => ({ ...f, address: e.target.value }))} placeholder={fresh.chain === 'Solana' ? 'Solana address' : '0x…'} className="font-mono text-[13px]" autoFocus />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Checkbox checked={fresh.save} onChange={(v) => setFresh((f) => ({ ...f, save: v }))}>
                      Save it to Payout places
                    </Checkbox>
                    {fresh.save && <Input value={fresh.label} onChange={(e) => setFresh((f) => ({ ...f, label: e.target.value }))} placeholder="Name it, e.g. Treasury" className="h-9 max-w-[220px] text-[13px]" />}
                  </div>
                </div>
              )}
            </PlaceGroup>
          )}
          <p className="text-[12.5px] text-dim">
            Only your own accounts for now. Manage them in{' '}
            <Link to="/settings/settlement" className="text-muted underline underline-offset-2 hover:text-fg">
              Payout places
            </Link>
            .
          </p>
        </div>
      )}

      {step === 'amount' && (
        <div className="rise">
          {refund ? (
            <div className="text-center">
              <div className="text-[13px] text-muted">
                For <span className="font-medium text-fg">refund {refund.ref}</span>
              </div>
              <div className="display tabular mt-2 text-[40px] font-semibold leading-none tracking-[-0.03em] text-fg">{inUsdc(refund.amountUsdc)}</div>
              <div className={cx('mt-2 text-[13px]', over && from ? 'text-red' : 'text-dim')}>
                {over && from ? `More than the ${inUsdc(available)} on ${from.chain}. Pick another network.` : 'Sent to us, and we send it on to your customer the way they paid.'}
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-muted">
                  To <span className="font-medium text-fg">{toLabel}</span>
                </span>
                <Segmented
                  value={cur}
                  onChange={(c: 'NGN' | 'USD') => {
                    // Keep what's typed meaning the same money in the other currency.
                    if (typed && rate) setAmt(c === 'USD' ? String(floor6(typed / rate)) : String(Math.round(typed * rate)))
                    setCur(c)
                  }}
                  options={[
                    { id: 'NGN', label: '₦ Naira' },
                    { id: 'USD', label: '$ Dollars' },
                  ]}
                />
              </div>

              <label className="mt-6 flex cursor-text items-baseline justify-center gap-1">
                <span className="display text-[30px] font-semibold text-dim">{cur === 'NGN' ? '₦' : '$'}</span>
                <input
                  value={shown}
                  onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                  placeholder="0"
                  inputMode="decimal"
                  autoFocus
                  style={{ width: `${Math.max(1, shown.length || 1) + 0.6}ch` }}
                  className={cx('display tabular min-w-0 max-w-full bg-transparent text-[46px] font-semibold leading-none tracking-[-0.03em] outline-none placeholder:text-[#CFCCC3]', over && typed ? 'text-red' : 'text-fg')}
                />
              </label>
              <div className="mt-2 text-center text-[13px] text-dim">
                {over && typed && from
                  ? `More than the ${inUsdc(available)} on ${from.chain}`
                  : kind === 'bank'
                    ? cur === 'NGN'
                      ? `Takes ${inUsdc(sendUsdc)} from your wallet, fee included`
                      : `≈ ${inNgn(bankGets)} lands, after the fee`
                    : cur === 'NGN'
                      ? `≈ ${inUsdc(sendUsdc)}`
                      : `≈ ${inNgn(typed * rate)}`}
              </div>
              {from && (
                <div className="mt-2.5 flex items-center justify-center gap-2 text-[12.5px] text-muted">
                  <span className="tabular">Up to {cur === 'NGN' ? inNgn(maxIn('NGN')) : inUsdc(maxIn('USD'))}</span>
                  <button type="button" onClick={() => setAmt(String(maxIn(cur)))} className="rounded-full border border-line bg-card px-2.5 py-0.5 font-medium text-fg transition hover:border-[#D3D0C7]">
                    Max
                  </button>
                </div>
              )}
            </>
          )}

          <div className="mt-6">
            <div className="mb-2.5 text-[13px] font-medium text-fg">Send from</div>
            {eligible.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-4 py-3 text-[13px] text-muted">
                {kind === 'crypto' && wallet ? `No USDC on ${wallet.chain} in your wallet to send there.` : 'No USDC on a network you can send from yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 pt-1.5">
                {eligible.map((c) => {
                  const on = from?.key === c.key
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setFromKey(c.key)}
                      className={cx('relative flex min-w-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left transition', on ? 'border-fg bg-card shadow-[0_0_0_1px_#121210]' : 'border-line bg-[#FAFAF8] hover:border-[#D3D0C7] hover:bg-card')}
                    >
                      <span className={cx('absolute -right-1.5 -top-1.5 flex size-[18px] items-center justify-center rounded-full border-2 border-card transition', on ? 'bg-fg' : 'bg-[#D6D3CA]')}>
                        {on && <Check className="size-2.5 text-white" strokeWidth={4} />}
                      </span>
                      <span className={cx('shrink-0', !on && 'opacity-60')}>
                        <TokenIcon asset="USDC" chain={c.chain} size={30} />
                      </span>
                      <span className={cx('min-w-0 flex-1', !on && 'opacity-60')}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-fg">USDC</span>
                          <span className="tabular shrink-0 text-[13px] text-fg">{c.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
                        </span>
                        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px] text-dim">
                          <span className="truncate">{c.chain}</span>
                          {rate > 0 && <span className="tabular shrink-0">≈ {inNgn(c.amount * rate)}</span>}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-5">{summary}</div>
        </div>
      )}

      {step === 'approve' && from && (
        <div className="rise space-y-4">
          <div className="rounded-[12px] border border-line px-4 py-1 text-[13.5px]">
            <div className="flex justify-between gap-4 border-b border-soft py-2.5">
              <span className="text-dim">To</span>
              <span className="min-w-0 truncate text-right font-medium text-fg">{toLabel}</span>
            </div>
            <div className="flex justify-between gap-4 border-b border-soft py-2.5">
              <span className="text-dim">From</span>
              <span className="text-right text-fg">USDC on {from.chain}</span>
            </div>
            <div className="flex justify-between gap-4 py-2.5">
              <span className="text-dim">{kind === 'bank' ? 'Lands in the bank' : 'Amount'}</span>
              <span className="tabular text-right font-semibold text-fg">{kind === 'bank' ? `${inNgn(bankGets)} · ${inUsdc(sendUsdc)}` : inUsdc(sendUsdc)}</span>
            </div>
          </div>
          <Field label="Transfer PIN" required hint="Your wallet then asks you to approve it. It's sent the moment you do, and can't be reversed.">
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && pin.length === 6 && !busy && void approve()}
              placeholder="••••••"
              className="max-w-[200px] tracking-[0.3em]"
            />
          </Field>
          {error && <p className="text-[13px] text-red">{error}</p>}
        </div>
      )}

      {step === 'done' && done && (
        <div className="rise">
          <div className="overflow-hidden rounded-[14px] border border-line">
            <div className="px-5 pb-5 pt-6 text-center">
              <span className="pop mx-auto flex size-11 items-center justify-center rounded-full bg-lime">
                <Check className="size-5 text-fg" strokeWidth={3} />
              </span>
              <div className="mt-3 text-[13px] text-muted">
                {kind === 'bank' ? 'On its way to' : 'Sent to'} <span className="font-medium text-fg">{toLabel}</span>
              </div>
              <div className="display tabular mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.03em] text-fg">{kind === 'bank' ? inNgn(done.payoutNgn ?? bankGets) : inUsdc(done.amountUsdc)}</div>
              <div className="tabular mt-2 text-[12.5px] text-dim">{kind === 'bank' ? `${inUsdc(done.amountUsdc)} from your wallet · lands once it's confirmed on chain` : rate > 0 ? `≈ ${inNgn(done.amountUsdc * rate)}` : ''}</div>
            </div>
            <div className="space-y-2.5 border-t border-dashed border-[#D6D3CA] bg-[#FAFAF8] px-5 py-4 text-[13px]">
              <div className="flex items-start justify-between gap-4">
                <span className="text-dim">To</span>
                <span className="min-w-0 text-right">
                  <span className="block font-medium text-fg">{toLabel}</span>
                  <span className="block truncate text-[12px] text-dim">{refund ? 'We send it on to your customer once it lands' : kind === 'bank' ? bank?.name : kind === 'mm' ? 'Money Moves account' : wallet ? `${short(wallet.address)} · ${wallet.chain}` : ''}</span>
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-dim">From</span>
                <span className="text-fg">USDC on {CHAIN_NAME[done.chain] ?? done.chain}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-dim">Reference</span>
                <span className="font-mono text-[12.5px] text-fg">{done.ref}</span>
              </div>
              {done.txHash && (
                <div className="flex justify-between gap-4">
                  <span className="text-dim">Transaction</span>
                  {txOf(done.chain, done.txHash)?.url ? (
                    <a href={txOf(done.chain, done.txHash)!.url!} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-fg underline underline-offset-2">
                      {short(done.txHash)}
                    </a>
                  ) : (
                    <span className="font-mono text-[12.5px] text-fg">{short(done.txHash)}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
