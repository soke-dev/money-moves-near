/**
 * Pick the coins and networks to accept. A coin is all-or-nothing with one
 * tap; its networks are a dropdown beside it.
 */
import { useState } from 'react'
import { Check, ChevronDown } from '@/components/icons'
import { ACCEPTED, type Asset, type Chain } from '@/data/mock'
import { ALL_ACCEPT, acceptCount, acceptsAll, type Accept } from '@/state/accept'
import { ChainIcon, TokenIcon } from './brand'
import { cx } from './ui'

export function TokenPicker({ value, onChange }: { value: Accept; onChange: (a: Accept) => void; compact?: boolean }) {
  const [open, setOpen] = useState<Asset | null>(null)
  const set = (asset: Asset, chains: Chain[]) => onChange({ ...value, [asset]: chains })
  const none = acceptCount(value) === 0

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12.5px]">
        <span className={none ? 'text-red' : 'text-dim'}>{none ? 'Pick at least one coin' : acceptsAll(value) ? 'Everything is on' : `${acceptCount(value)} coin-and-network pairs on`}</span>
        <button type="button" onClick={() => onChange(acceptsAll(value) ? {} : ALL_ACCEPT)} className="font-medium text-muted hover:text-fg">
          {acceptsAll(value) ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="divide-y divide-line rounded-[10px] border border-line">
        {ACCEPTED.map((a) => {
          const on = value[a.asset] ?? []
          const state = on.length === 0 ? 'off' : on.length === a.chains.length ? 'all' : 'some'
          return (
            <div key={a.asset}>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={state === 'all' ? true : state === 'off' ? false : 'mixed'}
                aria-label={`Accept ${a.asset}`}
                onClick={() => set(a.asset, state === 'all' ? [] : [...a.chains])}
                className={cx('flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition', state === 'off' ? 'border-[#C9C6BC] bg-card' : 'border-fg bg-fg')}
              >
                {state === 'all' && <Check className="size-3 text-white" strokeWidth={3} />}
                {state === 'some' && <span className="h-0.5 w-2 rounded-full bg-white" />}
              </button>
              <TokenIcon asset={a.asset} size={24} />
              <span className={cx('min-w-0 flex-1 text-[13.5px] font-medium', state === 'off' ? 'text-dim' : 'text-fg')}>{a.asset}</span>
              <NetworkButton asset={a.asset} chains={a.chains} on={on} open={open === a.asset} onOpen={(v) => setOpen(v ? a.asset : null)} />
            </div>
            {open === a.asset && <NetworkList asset={a.asset} chains={a.chains} on={on} onChange={(c) => set(a.asset, c)} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A coin's networks, at a glance: the ones on, as icons. Opens the list under the coin. */
function NetworkButton({ asset, chains, on, open, onOpen }: { asset: Asset; chains: Chain[]; on: Chain[]; open: boolean; onOpen: (v: boolean) => void }) {
  const all = on.length === chains.length
  return (
    <button
      type="button"
      onClick={() => onOpen(!open)}
      aria-expanded={open}
      aria-label={`${asset} networks`}
      className={cx('flex h-9 shrink-0 items-center gap-2 rounded-[9px] border bg-card pl-2 pr-2.5 text-[13px] transition', open ? 'border-fg' : 'border-line hover:border-[#D3D0C7]')}
    >
      {on.length > 0 && (
        <span className="flex -space-x-1.5">
          {on.slice(0, 4).map((c) => (
            <span key={c} className="rounded-full ring-2 ring-white">
              <ChainIcon chain={c} size={18} />
            </span>
          ))}
        </span>
      )}
      <span className={on.length ? 'font-medium text-fg' : 'text-dim'}>{all ? 'All networks' : on.length ? `${on.length} of ${chains.length}` : 'No networks'}</span>
      <ChevronDown className={cx('size-3.5 text-dim transition', open && 'rotate-180')} />
    </button>
  )
}

/**
 * The networks to tick, inside the card under their coin - not a floating
 * menu, which the builder's window cut off. Two columns where there's room.
 */
function NetworkList({ asset, chains, on, onChange }: { asset: Asset; chains: Chain[]; on: Chain[]; onChange: (c: Chain[]) => void }) {
  const all = on.length === chains.length
  // Keep the list in the coin's own order, whatever order they were ticked in.
  const toggle = (c: Chain) => onChange(on.includes(c) ? on.filter((x) => x !== c) : chains.filter((x) => on.includes(x) || x === c))
  return (
    <div className="rise border-t border-soft bg-[#FAFAF8] px-3.5 pb-3 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[12px]">
        <span className="text-dim">{asset} networks</span>
        <button type="button" onClick={() => onChange(all ? [] : [...chains])} className="font-medium text-muted hover:text-fg">
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        {chains.map((c) => {
          const yes = on.includes(c)
          return (
            <button key={c} type="button" role="checkbox" aria-checked={yes} onClick={() => toggle(c)} className="flex w-full items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 text-left text-[13.5px] hover:bg-raise">
              <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition', yes ? 'border-fg bg-fg' : 'border-[#C9C6BC] bg-card')}>
                {yes && <Check className="size-2.5 text-white" strokeWidth={3} />}
              </span>
              <ChainIcon chain={c} size={20} />
              <span className="flex-1 text-fg">{c === 'Optimism' ? 'OP Mainnet' : c}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
