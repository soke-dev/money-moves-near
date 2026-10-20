/**
 * Settlement: where a business's money is delivered.
 *
 * There is no one default. Each store QR, payment link and invoice says where
 * its payments go, chosen when it is made - the business's bank as naira, its
 * Money Moves account, or its business wallet. API
 * payments, from the business's own app or website, go where the business
 * chose in the Developer portal, or a bank account, then Money Moves, then the
 * wallet. Settings only holds the details of each place, and a place can't be
 * picked until it exists and checks out (see state/targets).
 *
 * Every payment comes into an address we control for that one checkout -
 * never the business wallet itself, because we can only convert what we hold
 * - and leaves for its destination as soon as it confirms. We convert what
 * the customer paid with into what the destination needs, and never keep a
 * balance for the business.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, FlaskConical, Landmark, Lock, ShieldCheck, Smartphone } from '@/components/icons'
import { DESTINATIONS, type Business, type Destination } from '@/data/mock'
import { useSession } from '@/state/session'
import { TEST_READINESS, bankLabel, banksOf, defaultBankOf, defaultMmOf, mmsOf, readiness, resolveSettlement, useTargets, type Readiness } from '@/state/targets'
import { Field, Input, cx } from './ui'

export const DEST_ORDER: Destination[] = ['bank', 'wallet', 'onchain']

export const DEST_ICON: Record<Destination, typeof Landmark> = { bank: Landmark, wallet: Smartphone, onchain: ShieldCheck }

/** Only a registered business picks where links, invoices and store QR settle; a "Just me" account uses its business wallet. */
export const canChoose = (b: Pick<Business, 'type'> | null | undefined) => !!b && b.type !== 'Individual'

/** Where something set to `d` really settles, for this business. */
export const effectiveDest = (b: Pick<Business, 'type'> | null | undefined, d: Destination | undefined): Destination => (canChoose(b) && d ? d : 'onchain')

/**
 * Which destinations this business can use right now, and why not the
 * others. In test mode every place is a sandbox account - ready, and plainly
 * marked as a test - unless the real details are asked for (Settings).
 */
export function useReadiness(opts?: { real?: boolean }): Record<Destination, Readiness> | null {
  const { business, mode } = useSession()
  const [targets] = useTargets(business?.id)
  if (!business || !targets) return null
  if (mode === 'test' && !opts?.real) return TEST_READINESS
  return readiness(business, targets)
}

/**
 * Where this one outlet, link or invoice settles. Places that aren't set up
 * can't be picked - except in test mode, where nothing settles anyway.
 */
export function SettlementChoice({
  value,
  onChange,
  bankId,
  onBank,
  mmId,
  onMm,
}: {
  value: Destination
  onChange: (d: Destination) => void
  bankId?: string
  onBank?: (id: string) => void
  mmId?: string
  onMm?: (id: string) => void
}) {
  const { business, mode } = useSession()
  const ready = useReadiness()
  const [targets] = useTargets(business?.id)
  const test = mode === 'test'
  if (!business || !ready) return null
  const checked = banksOf(targets).filter((b) => b.verified)
  const chosenBank = checked.find((b) => b.id === bankId) ?? defaultBankOf(targets)
  const linkedMm = mmsOf(targets).filter((m) => m.linked)
  const chosenMm = linkedMm.find((m) => m.id === mmId) ?? defaultMmOf(targets)

  if (!canChoose(business)) {
    return (
      <div className="flex gap-3 rounded-[10px] border border-line bg-raise p-4 text-[13px] leading-relaxed text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-fg" />
        <span>
          <span className="font-medium text-fg">Settles to your business wallet.</span> As a Just me account, everything lands there, withdraw to your bank,
          Money Moves or any wallet. Register with CAC to choose per link.
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line" role="radiogroup">
        {DEST_ORDER.map((k) => {
          const r = ready[k]
          const usable = r.ready || test
          const on = value === k
          const Icon = DEST_ICON[k]
          // Not set up: the row takes them where it's set up - the business wallet on its own page, the rest in Payout places.
          if (!usable)
            return (
              <Link key={k} to={k === 'onchain' ? '/balances' : '/settings/settlement'} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#FAFAF8]">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[#C9C6BC]" />
                <Icon className="size-[18px] shrink-0 text-dim" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-dim">{DESTINATIONS[k].label}</span>
                  <span className="block truncate text-[12px] text-dim">{r.why}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium text-fg underline underline-offset-2">{k === 'onchain' ? 'Create it' : 'Set it up'}</span>
              </Link>
            )
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!usable}
              onClick={() => onChange(k)}
              className={cx('flex w-full items-center gap-3 px-4 py-3 text-left transition', on ? 'bg-lime/10' : usable ? 'hover:bg-[#FAFAF8]' : 'cursor-not-allowed')}
            >
              <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>
                {on && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <Icon className={cx('size-[18px] shrink-0', usable ? 'text-fg' : 'text-dim')} />
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[13.5px] font-medium', usable ? 'text-fg' : 'text-dim')}>{DESTINATIONS[k].label}</span>
                <span className="block truncate text-[12px] text-dim">{r.ready ? r.detail : r.why}</span>
              </span>
              <ReadyMark r={r} />
            </button>
          )
        })}
      </div>
      {value === 'bank' && !test && checked.length > 1 && onBank && (
        <AccountPicker title="Which bank account?" options={checked.map((b) => ({ id: b.id, label: bankLabel(b) }))} chosen={chosenBank?.id} defaultId={defaultBankOf(targets)?.id} onPick={onBank} />
      )}
      {value === 'wallet' && !test && linkedMm.length > 1 && onMm && (
        <AccountPicker title="Which Money Moves account?" options={linkedMm.map((m) => ({ id: m.id, label: m.username }))} chosen={chosenMm?.id} defaultId={defaultMmOf(targets)?.id} onPick={onMm} />
      )}
      {test ? (
        <p className="mt-2 text-[12px] text-dim">Test mode: payments go to these sandbox accounts. Nothing real moves. Your real details take over when you go live.</p>
      ) : (
        Object.values(ready).some((r) => !r.ready) && (
          <p className="mt-2 text-[12px] text-dim">
            Greyed out isn't set up yet. Tap one to set it up: the business wallet is made on the{' '}
            <Link to="/balances" className="font-medium text-fg underline underline-offset-2">
              Wallet page
            </Link>
            , banks and Money Moves in{' '}
            <Link to="/settings/settlement" className="font-medium text-fg underline underline-offset-2">
              Payout places
            </Link>
            .
          </p>
        )
      )}
    </div>
  )
}

/** One of several accounts of the same kind, for this one link. */
function AccountPicker({ title, options, chosen, defaultId, onPick }: { title: string; options: { id: string; label: string }[]; chosen?: string; defaultId?: string; onPick: (id: string) => void }) {
  return (
    <div className="mt-2.5 rounded-[10px] border border-line bg-[#FAFAF8] p-3">
      <div className="mb-2 text-[12.5px] font-medium text-fg">{title}</div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {options.map((o) => {
          const on = chosen === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
              className={cx('flex items-center gap-2.5 rounded-[8px] border px-3 py-2 text-left transition', on ? 'border-fg bg-card shadow-[0_0_0_1px_#121210]' : 'border-line bg-card hover:border-[#D3D0C7]')}
            >
              <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-fg bg-fg' : 'border-[#C9C6BC]')}>{on && <span className="size-1.5 rounded-full bg-white" />}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-fg">{o.label}</span>
                {o.id === defaultId && <span className="block text-[11.5px] text-dim">Default</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ReadyMark({ r }: { r: Readiness }) {
  if (r.test) return <TestTag />
  return r.ready ? (
    <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-good">
      <Check className="size-3.5" strokeWidth={3} /> Ready
    </span>
  ) : (
    <span className="flex shrink-0 items-center gap-1 text-[12px] text-dim">
      <Lock className="size-3.5" /> {r.detail.startsWith('No ') || r.detail.startsWith('Not ') ? 'Not set up' : 'Pending'}
    </span>
  )
}

/** A sandbox account, marked so nobody mistakes it for the real one. */
function TestTag() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] bg-[#FAEFDB] px-1.5 py-px text-[11px] font-medium text-amber">
      <FlaskConical className="size-3" /> Test
    </span>
  )
}

/** The short version of a choice, for a card or a table: "Bank account · Nombank ••4878". */
export function DestLine({ d, bankId, mmId }: { d: Destination; bankId?: string; mmId?: string }) {
  const { business } = useSession()
  const [targets] = useTargets(business?.id)
  const ready = useReadiness()
  const test = !!ready?.[d]?.test
  // Outside test mode, a place that has gone hands over to the business wallet.
  const where = test ? { dest: d } : resolveSettlement(targets, d, bankId, mmId)
  const shown = where.dest
  const Icon = DEST_ICON[shown]
  const r = ready?.[shown]
  const label =
    shown === 'bank' && where.bank && banksOf(targets).length > 1 ? bankLabel(where.bank) : shown === 'wallet' && where.mm && mmsOf(targets).length > 1 ? where.mm.username : DESTINATIONS[shown].label
  const why = where.fellBack === 'mm' ? "That Money Moves account isn't linked, so these payments go to your business wallet." : where.fellBack === 'bank' ? 'No checked bank account, so these payments go to your business wallet.' : undefined
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle" title={why}>
      <Icon className={cx('size-3.5 shrink-0', where.fellBack || r?.ready === false ? 'text-amber' : 'text-dim')} />
      {/* The name gives way first; the tag never gets cut off. */}
      <span className="min-w-0 truncate">{label}</span>
      {test ? (
        <TestTag />
      ) : where.fellBack ? (
        <span className="shrink-0 whitespace-nowrap rounded-[4px] bg-[#FAEFDB] px-1.5 py-px text-[11px] font-medium text-amber">Fallback</span>
      ) : (
        r &&
        !r.ready && <span className="shrink-0 whitespace-nowrap rounded-[4px] bg-[#FAEFDB] px-1.5 py-px text-[11px] font-medium text-amber">Not set up</span>
      )}
    </span>
  )
}

/** How each way of getting paid settles. */
export function ChannelSettlement({ individual }: { individual?: boolean }) {
  const wallet = DESTINATIONS.onchain.label
  const rows: [string, string, boolean?][] = [
    ['Store QR', individual ? wallet : 'Chosen for each outlet'],
    ['Payment links', individual ? wallet : 'Chosen for each link'],
    ['Invoices', individual ? wallet : 'Chosen for each invoice'],
    ['API: your app or website', wallet, true],
  ]
  return (
    <div className="overflow-hidden rounded-[10px] border border-line">
      <div className="grid grid-cols-[1.3fr_1fr_auto] gap-3 bg-[#FAFAF8] px-4 py-2.5 text-[12px] font-medium text-dim">
        <span>Paid through</span>
        <span>Settles to</span>
        <span>When</span>
      </div>
      {rows.map(([channel, to, fixed]) => (
        <div key={channel} className="grid grid-cols-[1.3fr_1fr_auto] items-center gap-3 border-t border-line px-4 py-3 text-[13px]">
          <span className="font-medium text-fg">{channel}</span>
          <span className={cx('flex items-center gap-1.5', fixed ? 'text-fg' : 'text-muted')}>
            {to}
            {fixed && <span className="rounded-[4px] bg-raise px-1 text-[10.5px] font-medium text-dim">Always</span>}
          </span>
          <span className="text-muted">Instantly</span>
        </div>
      ))}
      <div className="border-t border-line bg-[#FAFAF8] px-4 py-3 text-[12.5px] leading-relaxed text-muted">
        From your business wallet you move money when you like: a bank transfer as naira (within 24 hours), or to your Money Moves account or any
        crypto wallet (seconds).
      </div>
    </div>
  )
}

export interface WalletTarget {
  username: string
}

export const BLANK_WALLET: WalletTarget = { username: '' }

/** The Money Moves account to link, by username. */
export function WalletTargetForm({ value, onChange, hint }: { value: WalletTarget; onChange: (w: WalletTarget) => void; hint?: ReactNode }) {
  return (
    <Field label="Money Moves username" optional hint={hint ?? 'We send a request to the app. Confirm it there and the account is linked.'}>
      <Input value={value.username} onChange={(e) => onChange({ username: e.target.value.replace(/\s/g, '') })} placeholder="@username" />
    </Field>
  )
}
