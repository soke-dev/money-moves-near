/**
 * Where live API checkouts settle when the checkout doesn't say: chosen in
 * Settings, Payment methods, and pointed to from the developer portal.
 * Automatic goes to a checked bank account, then a linked Money Moves account,
 * then the business wallet. A chosen place that goes away falls back to
 * automatic. Each settles the moment the payment is made.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from '@/components/icons'
import { Select } from '@/components/ui'
import { ApiError, api, type ApiDestination, type ApiPaymentSettings } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { useCan } from '@/state/roles'
import { useSession } from '@/state/session'
import { bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, useTargets } from '@/state/targets'

const settingsPath = (businessId: string) => `/businesses/${businessId}/payment-settings?mode=live`

/** The places, named the way the business knows them. */
function usePlaces() {
  const { business } = useSession()
  const [targets] = useTargets(business?.id)
  const settings = useApi<ApiPaymentSettings>(business ? settingsPath(business.id) : null)
  const banks = banksOf(targets).filter((b) => b.verified)
  const linked = mmsOf(targets).filter((m) => m.linked)
  const mmName = defaultMmOf(targets)?.username ?? 'Money Moves account'
  const bankName = (id: string | null) => {
    const b = banks.find((x) => x.id === id) ?? defaultBankOf(targets) ?? banks[0]
    return b ? bankLabel(b) : 'Bank account'
  }
  const placeName = (d: ApiDestination, bankId: string | null) => (d === 'BANK' ? bankName(bankId) : d === 'MONEY_MOVES' ? mmName : 'Business wallet')
  const defaultBank = defaultBankOf(targets)?.id ?? banks[0]?.id ?? ''
  return { business, settings, banks, linked, hasWallet: !!targets?.businessWallet, mmName, placeName, defaultBank }
}

/** Settings: a dropdown that saves as soon as it changes. */
export function ApiSettleSetting() {
  const can = useCan()
  const { business, settings, banks, linked, hasWallet, mmName, placeName, defaultBank } = usePlaces()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [saved, setSaved] = useState(false)
  const now = settings.data?.api
  if (!business) return null
  if (settings.error) return <p className="text-[12.5px] text-red">{settings.error.message}</p>
  if (!now) return <div className="h-10 animate-pulse rounded-[10px] bg-raise" />
  if (now.justMe) return <p className="text-[13px] text-muted">A Just me account settles everything to its business wallet, API payments included.</p>

  // What's picked: a bank chosen without naming one is the default bank.
  const value = now.settleTo === 'BANK' ? `BANK:${now.bankAccountId ?? defaultBank}` : (now.settleTo ?? 'AUTO')
  const choose = async (v: string) => {
    setBusy(true)
    setProblem('')
    setSaved(false)
    const [settleTo, bankAccountId] = v === 'AUTO' ? [null, null] : v.startsWith('BANK:') ? ['BANK', v.slice(5) || null] : [v, null]
    try {
      await api('PATCH', `/businesses/${business.id}/api-settlement`, { settleTo, bankAccountId })
      reload(settingsPath(business.id))
      setSaved(true)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "That didn't go through. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }
  const fellBack = !!now.settleTo && now.settleTo !== now.now

  return (
    <div className="max-w-[460px]">
      <Select value={value} disabled={busy || !can('settlement')} onChange={(e) => void choose(e.target.value)} aria-label="Where API payments land">
        <option value="AUTO">Automatic: bank, then Money Moves, then the wallet</option>
        {banks.map((b) => (
          <option key={b.id} value={`BANK:${b.id}`}>
            Bank account: {bankLabel(b)}
          </option>
        ))}
        {banks.length === 0 && (
          <option value="BANK:" disabled>
            Bank account (add one in Payout places first)
          </option>
        )}
        <option value="MONEY_MOVES" disabled={!linked.length}>
          {linked.length ? `Money Moves account: ${mmName}` : 'Money Moves account (link one in Payout places first)'}
        </option>
        <option value="WALLET" disabled={!hasWallet}>
          {hasWallet ? 'Business wallet, as USDC' : 'Business wallet (create it first)'}
        </option>
      </Select>
      <div className="mt-2 text-[12.5px] text-dim">
        {saved ? (
          <span className="inline-flex items-center gap-1.5 text-good">
            <Check className="size-3.5" strokeWidth={3} /> Saved. New API payments go to {placeName(now.now, now.nowBankAccountId)}.
          </span>
        ) : fellBack ? (
          <span className="text-[#8A5A12]">The place you chose can’t take payments right now, so they’re going to {placeName(now.now, now.nowBankAccountId)}.</span>
        ) : (
          <>Now: <span className="text-fg">{placeName(now.now, now.nowBankAccountId)}</span>. A checkout that sets <code className="font-mono text-[12px]">settle_to</code> goes there instead.</>
        )}
      </div>
      {problem && <p className="mt-1.5 text-[12.5px] text-red">{problem}</p>}
      {!can('settlement') && <p className="mt-1.5 text-[12.5px] text-dim">The owner, admins and finance can change this.</p>}
    </div>
  )
}

/** The developer portal: where API payments land now, and where to change it. */
export function ApiSettleHint() {
  const { settings, placeName } = usePlaces()
  const now = settings.data?.api
  if (!now) return null
  return (
    <p className="text-[13px] text-muted">
      Live API payments land in <span className="font-medium text-fg">{placeName(now.now, now.nowBankAccountId)}</span>
      {now.justMe ? '.' : (
        <>
          .{' '}
          <Link to="/settings/business?tab=methods" className="font-medium text-fg underline underline-offset-2">
            Change it in Settings
          </Link>
        </>
      )}
    </p>
  )
}
