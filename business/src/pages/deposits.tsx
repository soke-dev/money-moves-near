/**
 * Deposit addresses: a customer's own permanent addresses, one per network.
 * Whatever they send, whenever they send it, is credited to them by the
 * business's reference and lands in the business wallet - for apps where
 * customers top up a balance: exchanges, trading and betting apps, games.
 *
 * The addresses are ours, like a store QR: we see each deposit, tell the
 * business whose it is, and settle it straight to the business wallet.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, Plus, Wallet } from '@/components/icons'
import { ACCEPTED, NGN_RATE, PRICING, type Asset, type Chain } from '@/data/mock'
import { Button, CopyField, Drawer, Empty, Field, Input, Modal, PageHeader, Select, cx } from '@/components/ui'
import { Avatar, ChainIcon, TokenIcon } from '@/components/brand'
import Qr from '@/components/Qr'
import { TokenPicker } from '@/components/TokenPicker'
import { ALL_ACCEPT, acceptStore, type Accept } from '@/state/accept'
import { useSession } from '@/state/session'
import { ago, copy, date, dateTime, ngn, short, usd } from '@/lib/format'
import { LIVE } from '@/lib/api'

type Deposit = { id: string; asset: Asset; chain: Chain; amount: number; at: string; tx: string }
type Holder = { id: string; customer: string; email?: string; ref: string; chains: Chain[]; createdAt: string; deposits: Deposit[] }

const EVM: Chain[] = ['Base', 'BNB Chain', 'Arc', 'Monad', 'Arbitrum', 'Ethereum', 'Optimism']
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

/** A made-up but stable address per customer and network, until the API hands out real ones. */
function addressFor(ref: string, chain: Chain) {
  const seed = [...ref].reduce((a, c) => (a * 33 + c.charCodeAt(0)) >>> 0, 5381)
  const hex = (k: number) => ((seed * k) >>> 0).toString(16).padStart(8, '0')
  const b58 = (k: number) => ((seed * k) >>> 0).toString(36).replace(/[0ol]/g, 'x')
  if (EVM.includes(chain)) return `0x${hex(7)}${hex(13)}${hex(31)}${hex(61)}${hex(97)}`
  if (chain === 'Movement') return `0x${hex(3)}${hex(5)}${hex(11)}${hex(17)}${hex(19)}${hex(23)}${hex(29)}${hex(37)}`
  if (chain === 'Solana') return `${b58(3)}${b58(5)}${b58(11)}${b58(17)}${b58(19)}`.slice(0, 44)
  if (chain === 'TON') return `UQ${b58(7)}${b58(13)}${b58(31)}${b58(61)}`.slice(0, 48)
  return `G${(b58(3) + b58(5) + b58(11) + b58(17) + b58(19) + b58(23)).toUpperCase()}`.slice(0, 56)
}

/** Sample deposits shaped to a customer: their networks, adding up to what they've sent. */
function samples(ref: string, chains: Chain[], total: number, n: number, newest: number): Deposit[] {
  const seed = [...ref].reduce((a, c) => a + c.charCodeAt(0), 0)
  const weights = Array.from({ length: n }, (_, i) => 1 + ((seed + i * 7) % 6))
  const all = weights.reduce((a, b) => a + b, 0)
  let left = total
  return weights.map((w, i) => {
    const amount = i === n - 1 ? Math.round(left * 100) / 100 : Math.round(((total * w) / all) * 100) / 100
    left -= amount
    const chain = chains[(seed + i) % chains.length]!
    const asset: Asset = chain === 'TON' ? 'USDT' : chain === 'Arc' ? 'USDC' : (seed + i) % 2 ? 'USDT' : 'USDC'
    return { id: `${ref}-${i}`, asset, chain, amount, at: hoursAgo(newest + i * 31 + (seed % 9)), tx: `0x${(((seed + i * 977) * 2_654_435_761) >>> 0).toString(16).padStart(8, '0')}a91e04c7d2${((seed * 31 + i * 7_919) >>> 0).toString(16).padStart(6, '0')}` }
  })
}

const SEED: Holder[] = [
  { id: 'da_3', customer: 'Yusuf Lawal', ref: 'CUST-0118', chains: ['Solana', 'Base', 'BNB Chain'], createdAt: hoursAgo(190), deposits: samples('CUST-0118', ['Solana', 'Base', 'BNB Chain'], 2_980, 7, 2) },
  { id: 'da_1', customer: 'Ada Okafor', ref: 'CUST-0091', chains: ['Movement', 'Solana', 'Base'], createdAt: hoursAgo(430), deposits: samples('CUST-0091', ['Movement', 'Solana', 'Base'], 1_240, 6, 26) },
  { id: 'da_2', customer: 'Amaka Obi', ref: 'CUST-0104', chains: ['TON', 'Monad'], createdAt: hoursAgo(250), deposits: samples('CUST-0104', ['TON', 'Monad'], 310.5, 3, 70) },
]

const received = (h: Holder) => h.deposits.reduce((a, d) => a + d.amount, 0)
const last = (h: Holder) => h.deposits[0]?.at

export function DepositAddresses() {
  return LIVE ? <AddressesNotYet /> : <SampleAddresses />
}

/** Live: deposit addresses are coming soon - nothing made up meanwhile. */
function AddressesNotYet() {
  return (
    <>
      <PageHeader title="Deposit addresses" sub="Give a customer their own permanent addresses. Whatever they send is credited to them." />
      <Empty
        title="Deposit addresses are coming soon."
        sub="Each customer will get addresses of their own to send USDC or USDT to whenever they like, with no checkout. Until then, customers can pay by bank transfer, the Money Moves app or crypto through your links, invoices and outlets."
        actions={
          <Link to="/collect/links">
            <Button>Payment links</Button>
          </Link>
        }
      />
    </>
  )
}

function SampleAddresses() {
  const [holders, setHolders] = useState<Holder[]>(SEED)
  const [creating, setCreating] = useState(false)
  const [how, setHow] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = holders.find((h) => h.id === openId) ?? null
  const total = holders.reduce((a, h) => a + received(h), 0)
  const latest = holders.map(last).filter(Boolean).sort().reverse()[0]

  return (
    <>
      <PageHeader
        title="Deposit addresses"
        sub="Give a customer their own permanent addresses. Whatever they send is credited to them and lands where your API payments go. Your business wallet by default."
        actions={
          <>
            <Button icon={<BookOpen className="size-4" />} onClick={() => setHow(true)}>
              How it works
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New address
            </Button>
          </>
        }
      />
      {holders.length === 0 ? (
        <Empty
          icon={<Wallet className="size-6" />}
          title="Give regular customers their own address."
          sub="They send USDC or USDT whenever they like, with no checkout. You get a webhook with their reference, and the money lands where your API payments go."
          actions={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New address
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-muted">
            <span className="tabular font-medium text-fg">{usd(total)}</span>
            <span>received</span>
            <span className="tabular text-dim">≈ {ngn(total * NGN_RATE)}</span>
            <span className="text-dim">·</span>
            <span>
              {holders.length} customer{holders.length === 1 ? '' : 's'}
            </span>
            {latest && (
              <>
                <span className="text-dim">·</span>
                <span>last deposit {ago(latest)}</span>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-[10px] border border-line bg-card">
            {holders.map((h) => (
              <button
                key={h.id}
                onClick={() => setOpenId(h.id)}
                className="group flex w-full items-center gap-3 border-b border-soft px-4 py-3.5 text-left transition last:border-b-0 hover:bg-[#FAFAF8]"
              >
                <Avatar name={h.customer} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium text-fg">{h.customer}</div>
                  <div className="truncate text-[12px] text-dim">
                    <span className="font-mono">{h.ref}</span> · {h.deposits.length ? `last deposit ${ago(last(h)!)}` : 'no deposits yet'}
                  </div>
                </div>
                <span className="hidden shrink-0 -space-x-1 sm:flex [&>*]:rounded-full [&>*]:ring-2 [&>*]:ring-card">
                  {h.chains.map((c) => (
                    <ChainIcon key={c} chain={c} size={20} />
                  ))}
                </span>
                <div className="w-[120px] shrink-0 text-right">
                  <div className="tabular text-[13.5px] font-medium text-fg">{usd(received(h))}</div>
                  <div className="tabular text-[12px] text-dim">≈ {ngn(received(h) * NGN_RATE)}</div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-dim opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-dim">
            New addresses use the coins and networks in{' '}
            <Link to="/settings/business?tab=methods" className="text-muted underline underline-offset-2 hover:text-fg">
              Payment methods
            </Link>
            . Our fee is {PRICING.crypto.rate * 100}%, never more than {usd(PRICING.crypto.capUsd).replace('.00', '')}, per deposit.
          </p>
        </>
      )}

      <HolderDrawer h={open} onClose={() => setOpenId(null)} />
      {creating && (
        <NewAddress
          next={`CUST-${String(120 + holders.length).padStart(4, '0')}`}
          onClose={() => setCreating(false)}
          onCreate={(h) => setHolders((all) => [h, ...all])}
        />
      )}
      <HowItWorks open={how} onClose={() => setHow(false)} />
    </>
  )
}

/** One customer's addresses, what they've sent, and what your app hears about it. */
function HolderDrawer({ h, onClose }: { h: Holder | null; onClose: () => void }) {
  const [chain, setChain] = useState<Chain | null>(null)
  if (!h) return null
  const on = chain && h.chains.includes(chain) ? chain : h.chains[0]!
  const address = addressFor(h.ref, on)
  const evm = h.chains.filter((c) => EVM.includes(c))
  const assets = ACCEPTED.filter((a) => a.chains.includes(on)).map((a) => a.asset)
  const close = () => {
    setChain(null)
    onClose()
  }
  const section = 'mt-7 border-t border-line pt-5'
  const heading = 'mb-3 text-[13px] font-semibold text-fg'

  return (
    <Drawer open onClose={close} title={h.customer}>
      <div className="flex items-center gap-3">
        <Avatar name={h.customer} size={40} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] text-fg">{h.ref}</div>
          <div className="text-[12px] text-dim">
            {h.email ? `${h.email} · ` : ''}Created {date(h.createdAt)}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-[10px] border border-line">
        {[
          ['Received', usd(received(h))],
          ['Deposits', String(h.deposits.length)],
          ['Last one', h.deposits.length ? ago(last(h)!) : '-'],
        ].map(([l, v], i) => (
          <div key={l} className={cx('px-3.5 py-3', i > 0 && 'border-l border-line')}>
            <div className="text-[11.5px] text-dim">{l}</div>
            <div className="display tabular mt-0.5 truncate text-[16px] font-semibold text-fg">{v}</div>
          </div>
        ))}
      </div>

      <div className={section}>
        <div className={heading}>Their addresses</div>
        <Select value={on} onChange={(e) => setChain(e.target.value as Chain)}>
          {h.chains.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className="mt-4 flex justify-center">
          <Qr value={address} size={156} />
        </div>
        <div className="mt-4">
          <CopyField value={address} />
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-dim">
          {assets.join(' or ')} on {on}, any amount, any time. It never expires.
          {EVM.includes(on) && evm.length > 1 && ` The same address works on ${evm.join(', ')}.`}
        </p>
      </div>

      <div className={section}>
        <div className={heading}>Deposits</div>
        {h.deposits.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-5 py-6 text-center text-[13px] text-muted">Nothing yet. You'll see each one here the moment it confirms.</div>
        ) : (
          <div className="divide-y divide-soft rounded-[10px] border border-line">
            {h.deposits.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <TokenIcon asset={d.asset} chain={d.chain} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-fg">
                    {d.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} {d.asset}
                  </div>
                  <div className="truncate text-[12px] text-dim">
                    {d.chain} · <span className="font-mono">{short(d.tx, 6, 4)}</span> · {dateTime(d.at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-1 text-[12px] text-good">
                    <Check className="size-3.5" strokeWidth={3} /> Credited
                  </div>
                  <div className="tabular text-[11.5px] text-dim">≈ {ngn(d.amount * NGN_RATE)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2.5 text-[12px] text-dim">Each one lands where your API payments go. Your business wallet unless you changed it on API keys. The moment it confirms, less our {PRICING.crypto.rate * 100}% fee (never more than {usd(PRICING.crypto.capUsd).replace('.00', '')}).</p>
      </div>

      <div className={section}>
        <div className={heading}>What your app hears</div>
        <p className="mb-2.5 text-[12.5px] leading-relaxed text-muted">
          Every deposit sends a <span className="font-mono text-[12px] text-fg">deposit.received</span> webhook with this customer's reference, so your app can top up their balance.
        </p>
        <pre className="overflow-x-auto rounded-[10px] bg-[#16160F] p-3.5 font-mono text-[11.5px] leading-relaxed text-[#E8E6DE]">
          {JSON.stringify(
            {
              type: 'deposit.received',
              data: {
                reference: h.ref,
                amount: (h.deposits[0]?.amount ?? 0).toFixed(2),
                asset: h.deposits[0]?.asset ?? 'USDC',
                chain: h.deposits[0]?.chain ?? h.chains[0],
                settled_to: 'business_wallet',
              },
            },
            null,
            2,
          )}
        </pre>
      </div>
    </Drawer>
  )
}

function NewAddress({ next, onClose, onCreate }: { next: string; onClose: () => void; onCreate: (h: Holder) => void }) {
  const { business } = useSession()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [ref, setRef] = useState('')
  const [accept, setAccept] = useState<Accept>(() => (business ? acceptStore.read(business.id) : ALL_ACCEPT))
  const [made, setMade] = useState<Holder | null>(null)
  const chains = useMemo(() => [...new Set(ACCEPTED.flatMap((a) => accept[a.asset] ?? []))] as Chain[], [accept])
  const ok = !!name.trim() && chains.length > 0

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={made ? 'Addresses ready' : 'New deposit address'}
      sub={made ? `${made.customer} can send to any of these, any time. Show them in your app or send them over.` : 'One set of permanent addresses for one customer, one per network.'}
      footer={
        made ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!ok}
              onClick={() => {
                const h: Holder = {
                  id: `da_${Date.now()}`,
                  customer: name.trim(),
                  email: email.trim() || undefined,
                  ref: ref.trim() || next,
                  chains,
                  createdAt: new Date().toISOString(),
                  deposits: [],
                }
                onCreate(h)
                setMade(h)
              }}
            >
              Create addresses
            </Button>
          </>
        )
      }
    >
      {made ? (
        <div className="rise divide-y divide-soft rounded-[10px] border border-line">
          {made.chains.map((c) => (
            <div key={c} className="flex items-center gap-3 px-3.5 py-2.5">
              <ChainIcon chain={c} size={22} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-fg">{c}</div>
                <div className="truncate font-mono text-[12px] text-dim">{short(addressFor(made.ref, c), 10, 8)}</div>
              </div>
              <CopyChip value={addressFor(made.ref, c)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Okafor" autoFocus />
            </Field>
            <Field label="Email" optional>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ada@example.com" />
            </Field>
          </div>
          <Field label="Your reference" optional hint={`The customer's ID in your system. It comes back on every deposit. Leave it blank and we use ${next}.`}>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={next} className="font-mono" />
          </Field>
          <Field label="Coins and networks">
            <TokenPicker value={accept} onChange={setAccept} compact />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function CopyChip({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        copy(value)
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
      className="shrink-0 rounded-[6px] border border-line px-2 py-1 text-[12px] font-medium text-muted transition hover:text-fg"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const steps: [string, string][] = [
    ['One set per customer', 'Make them here or with the API: one permanent address per network you accept. They never expire, and they belong to that customer only.'],
    ['They send any time', 'USDC or USDT, any amount, as often as they like. No checkout, no timer. Straight from a wallet or an exchange.'],
    ['We credit it to them', "We see every deposit and send you a deposit.received webhook with the customer's reference, so your app can top up their balance."],
    ['It lands where your API payments go', `Your business wallet by default, or a Money Moves account you choose on API keys. The moment it confirms, less our ${PRICING.crypto.rate * 100}% fee, never more than ${usd(PRICING.crypto.capUsd).replace('.00', '')}.`],
  ]
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title="How deposit addresses work"
      sub="For apps where customers keep a balance, exchanges, trading or betting apps, games and wallets."
      footer={
        <Button variant="primary" onClick={onClose}>
          Got it
        </Button>
      }
    >
      <ol className="-mt-1">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3.5 border-b border-soft py-3.5 last:border-0">
            <span className="display flex size-6 shrink-0 items-center justify-center rounded-full bg-raise text-[12px] font-semibold text-fg">{i + 1}</span>
            <div>
              <div className="text-[14px] font-semibold text-fg">{title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
