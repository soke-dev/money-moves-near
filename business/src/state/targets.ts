/**
 * The places a business can be paid to, as it has actually set them up -
 * and whether each one is ready to receive money.
 *
 * A destination can only be chosen once it exists and checks out:
 *  - bank accounts: up to five, each checked against the NIN or CAC record;
 *    one is the default;
 *  - Money Moves accounts: up to five, each linked and confirmed in the app;
 *    one is the default;
 *  - business wallet: the owner creates it once the business is verified.
 *
 * Nothing is ever left with nowhere to go. A link, invoice or outlet pointed
 * at a place that has gone settles to the business wallet until it's back:
 *  - a Money Moves account that was unlinked: straight to the business wallet;
 *  - a bank account that was removed: the default bank account first, then
 *    the business wallet if no checked account is left.
 */
import { useMemo } from 'react'
import { BALANCES, BUSINESSES, type Business, type Chain, type Destination } from '@/data/mock'
import { short } from '@/lib/format'
import type { SettleChain } from '@/lib/api'
import { LIVE, type ApiBankAccount } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { createStore } from './store'

export const MAX_BANKS = 5
export const MAX_MM = 2

export interface MmAccount {
  /** The Money Moves account itself - what links are keyed on. */
  id: string
  /** Its username as last read from the app. The API returns the current one, so a rename shows up on its own. */
  username: string
  linked: boolean
}

export interface BankAccount {
  id: string
  bank: string
  account: string
  name: string
  verified: boolean
  /** Live: our team couldn't confirm it's the business's, so nothing settles to it. */
  declined?: boolean
}

/** Where API payments go: the business wallet (onchain), a linked Money Moves account (wallet), or a bank account as naira. */
export interface ApiChoice {
  dest: 'onchain' | 'wallet' | 'bank'
  mmId?: string
  bankId?: string
}

export interface Targets {
  banks?: BankAccount[]
  /** The bank account links use unless they name another. */
  defaultBank?: string
  /** Before several accounts were allowed: one bank account. Read through banksOf. */
  bank?: Omit<BankAccount, 'id'> | null
  mms?: MmAccount[]
  /** The Money Moves account links use unless they name another. */
  defaultMm?: string
  /** Before several accounts were allowed: one Money Moves account. Read through mmsOf. */
  mm?: { username: string; linked: boolean } | null
  /** Where API checkouts and deposit addresses settle: the business wallet unless a linked Money Moves account is chosen. */
  apiSettle?: ApiChoice
  /** Live: the business wallet, once the owner has created it - its main address, and its address on each settle chain. */
  businessWallet?: { address: string; on?: Partial<Record<SettleChain, string | null>> } | null
  /** The business's own crypto wallets, saved for sending out of the business wallet. Nothing settles to these. */
  wallets?: { label: string; address: string; chain: Chain }[]
}

/** Every bank account, whichever way it was saved. */
export const banksOf = (t: Targets | null | undefined): BankAccount[] => (t ? (t.banks ?? (t.bank ? [{ id: 'bk_1', ...t.bank }] : [])) : [])

/** The default account: the one marked, else the first checked one, else the first. */
export function defaultBankOf(t: Targets | null | undefined): BankAccount | undefined {
  const all = banksOf(t)
  return all.find((b) => b.id === t?.defaultBank) ?? all.find((b) => b.verified) ?? all[0]
}

/** Every Money Moves account, whichever way it was saved. */
export const mmsOf = (t: Targets | null | undefined): MmAccount[] => (t ? (t.mms ?? (t.mm ? [{ id: 'mm_1', ...t.mm }] : [])) : [])

/** The default account: the one marked, else the first linked one, else the first. */
export function defaultMmOf(t: Targets | null | undefined): MmAccount | undefined {
  const all = mmsOf(t)
  return all.find((m) => m.id === t?.defaultMm) ?? all.find((m) => m.linked) ?? all[0]
}

/** The same targets with the Money Moves list written the new way, and the old field dropped. */
export function withMms(t: Targets, mms: MmAccount[], defaultMm = t.defaultMm): Targets {
  const keep = mms.some((m) => m.id === defaultMm) ? defaultMm : (mms.find((m) => m.linked) ?? mms[0])?.id
  const { mm: _old, ...rest } = t
  return { ...rest, mms, defaultMm: keep }
}

export const bankLabel = (b: Pick<BankAccount, 'bank' | 'account'>) => `${b.bank} ••${b.account.slice(-4)}`

/** The same targets with the bank list written the new way, and the old field dropped. */
export function withBanks(t: Targets, banks: BankAccount[], defaultBank = t.defaultBank): Targets {
  const keep = banks.some((b) => b.id === defaultBank) ? defaultBank : banks[0]?.id
  const { bank: _old, ...rest } = t
  return { ...rest, banks, defaultBank: keep }
}

function seed(businessId: string): Targets {
  const b = BUSINESSES.find((x) => x.id === businessId)
  if (b?.verify === 'verified') {
    return {
      banks: [
        { id: 'bk_1', bank: 'Nombank MFB', account: '2651124878', name: 'MOVERS DIGITAL TECHNOLOGIES LTD', verified: true },
        { id: 'bk_2', bank: 'GTBank', account: '0123984471', name: 'MOVERS DIGITAL TECHNOLOGIES LTD', verified: true },
      ],
      defaultBank: 'bk_1',
      mms: [
        { id: 'mm_1', username: '@movers', linked: true },
        { id: 'mm_2', username: '@movers.events', linked: true },
      ],
      defaultMm: 'mm_1',
      wallets: [{ label: 'Treasury', address: '0x3f9a7b1c2d4e5f60718293a4b5c6d7e8f901c21b', chain: 'Base' }],
    }
  }
  if (b?.verify === 'review') {
    return { banks: [{ id: 'bk_1', bank: 'Opay', account: '0123456789', name: 'SAMPLE TRADING LIMITED', verified: false }], defaultBank: 'bk_1', mms: [] }
  }
  return { banks: [], mms: [] }
}

export const targetsStore = createStore<Targets>('mmb_targets_v1', seed)

/** Live: the bank accounts the API holds for this business. */
export const bankAccountsPath = (businessId: string) => `/businesses/${businessId}/bank-accounts`

/**
 * The business's payout places. Live, the bank accounts are the real ones
 * from the API (nothing until they've loaded), and there are no Money Moves
 * accounts yet - linking arrives with the app's next update. The rest (saved
 * crypto wallets, the API choice) is still kept in this browser.
 */
export function useTargets(businessId: string | undefined) {
  const [local, update] = targetsStore.use(businessId)
  const live = useApi<{ bankAccounts: ApiBankAccount[] }>(LIVE && businessId ? bankAccountsPath(businessId) : null)
  // Money Moves accounts: linked only once their owner approves in the app.
  const mm = useApi<{ accounts: { id: string; username: string; status: string; isDefault: boolean }[] }>(LIVE && businessId ? `/businesses/${businessId}/money-moves` : null)
  // The business wallet, once the owner has created it.
  const bw = useApi<{ wallet: { movementAddress: string | null; solanaAddress: string | null; evmAddress: string | null; stellarAddress?: string | null } | null }>(LIVE && businessId ? `/businesses/${businessId}/wallet` : null)
  const value = useMemo((): Targets | undefined => {
    if (!LIVE || !local) return local
    if (!live.data) return live.error ? { ...local, bank: undefined, banks: [], mm: undefined, mms: [] } : undefined
    const banks = live.data.bankAccounts.map((b) => ({ id: b.id, bank: b.bankName, account: b.accountNumber, name: b.accountName, verified: b.nameMatches, declined: b.declined }))
    const mms = (mm.data?.accounts ?? []).map((a) => ({ id: a.id, username: `@${a.username}`, linked: a.status === 'LINKED' }))
    const w = bw.data?.wallet
    const businessWallet = w
      ? {
          address: w.movementAddress ?? w.solanaAddress ?? w.evmAddress ?? '',
          on: { MOVEMENT: w.movementAddress, SOLANA: w.solanaAddress, ARC: w.evmAddress, MONAD: w.evmAddress, STELLAR: w.stellarAddress ?? null },
        }
      : null
    return { ...local, bank: undefined, banks, defaultBank: live.data.bankAccounts.find((b) => b.isDefault)?.id, mm: undefined, mms, defaultMm: mm.data?.accounts.find((a) => a.isDefault)?.id, businessWallet }
  }, [local, live.data, live.error, mm.data, bw.data])
  return [value, update] as const
}

/** The business wallet's address on the chain crypto settles on - where USDC actually lands. */
export function walletAddressOn(t: Pick<Targets, 'businessWallet'>, chain: SettleChain | undefined): string {
  const w = t.businessWallet
  if (!w) return ''
  return (chain && w.on?.[chain]) || w.address
}

export interface Readiness {
  ready: boolean
  /** What it is, when it exists: "Nombank MFB ••4878". */
  detail: string
  /** Why it can't be used yet, and where to fix it. */
  why?: string
  /** A sandbox account, shown in test mode - nothing real lands there. */
  test?: boolean
}

/** Where test payments "settle": always ready, never real. */
/** Where test money goes - sandbox accounts, never real ones. */
export const TEST_PLACES: Record<Destination, string> = { bank: 'Test Bank ••0001', wallet: '@test.merchant', onchain: 'Test wallet' }

export const TEST_READINESS: Record<Destination, Readiness> = {
  bank: { ready: true, test: true, detail: 'Test Bank ••0001 · sandbox account' },
  wallet: { ready: true, test: true, detail: '@test.merchant · sandbox account' },
  onchain: { ready: true, test: true, detail: '0xTE57…0000 · test wallet' },
}

export function readiness(b: Pick<Business, 'verify'> & { settleChain?: SettleChain }, t: Targets): Record<Destination, Readiness> {
  const banks = banksOf(t)
  const checked = banks.filter((x) => x.verified)
  const main = defaultBankOf(t)
  const mms = mmsOf(t)
  const linkedMm = mms.filter((m) => m.linked)
  const mainMm = defaultMmOf(t)
  return {
    bank: checked.length
      ? { ready: true, detail: `${bankLabel(main?.verified ? main : checked[0]!)}${checked.length > 1 ? ` · +${checked.length - 1} more` : ''}` }
      : banks.length
        ? { ready: false, detail: bankLabel(banks[0]!), why: 'Our team is still checking the name on it' }
        : { ready: false, detail: 'No bank account yet', why: 'Add one in Payout places' },
    wallet: linkedMm.length
      ? { ready: true, detail: `${(mainMm?.linked ? mainMm : linkedMm[0]!).username}${linkedMm.length > 1 ? ` · +${linkedMm.length - 1} more` : ''}` }
      : mms.length
        ? { ready: false, detail: mms[0]!.username, why: 'Approve the link in the Money Moves app' }
        : { ready: false, detail: 'Not linked yet', why: 'Link your account in Payout places' },
    // Live, the owner creates the wallet once the business is verified.
    onchain: LIVE
      ? t.businessWallet
        ? { ready: true, detail: `${short(walletAddressOn(t, b.settleChain), 6, 4)} · your wallet` }
        : { ready: false, detail: 'Not created yet', why: b.verify === 'verified' ? 'Create your business wallet first, on the Wallet page' : 'Created once your business is verified' }
      : b.verify === 'verified'
        ? { ready: true, detail: `${short(BALANCES.onchain.address, 6, 4)} · embedded` }
        : { ready: false, detail: 'Not created yet', why: "It's created when you're approved" },
  }
}

/**
 * Where a link, invoice or outlet really settles today, given what's set up:
 * its own bank account if that's still there and checked, else the default
 * one, else - like a Money Moves account that's been unlinked - the business
 * wallet.
 */
export function resolveSettlement(
  t: Targets | null | undefined,
  d: Destination,
  bankId?: string,
  mmId?: string,
): { dest: Destination; bank?: BankAccount; mm?: MmAccount; fellBack?: 'mm' | 'bank' } {
  if (d === 'wallet') {
    const linked = mmsOf(t).filter((m) => m.linked)
    // A link that named its account goes there or, once it's unlinked, to the business wallet.
    const main = defaultMmOf(t)
    const pick = mmId ? linked.find((m) => m.id === mmId) : main?.linked ? main : linked[0]
    return pick ? { dest: 'wallet', mm: pick } : { dest: 'onchain', fellBack: 'mm' }
  }
  if (d === 'bank') {
    const checked = banksOf(t).filter((b) => b.verified)
    const own = checked.find((b) => b.id === bankId)
    const main = defaultBankOf(t)
    const pick = own ?? (main?.verified ? main : checked[0])
    return pick ? { dest: 'bank', bank: pick } : { dest: 'onchain', fellBack: 'bank' }
  }
  return { dest: d }
}

/**
 * Where API payments land today. A chosen Money Moves account that's been
 * unlinked hands back to the business wallet; a removed bank account hands to
 * the default bank, then the business wallet.
 */
export function resolveApiSettlement(t: Targets | null | undefined): ReturnType<typeof resolveSettlement> {
  const c = t?.apiSettle
  if (!c || c.dest === 'onchain') return { dest: 'onchain' }
  if (c.dest === 'bank') return resolveSettlement(t, 'bank', c.bankId)
  return resolveSettlement(t, 'wallet', undefined, c.mmId)
}
