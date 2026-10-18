/**
 * Crypto that came in, for the cases a person decides: a transfer that
 * matched no payment, money going back that waits for an address, a return
 * that failed, or one that's ours to send by hand. Plus the sweeping side:
 * whether payments get addresses of their own, the gas sponsor's balance on
 * each chain, and what's waiting to be swept into the treasury.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, useLoad } from './client'
import { ActionPanel, Button, Copy, Field, Input, ListLoading, Notice, Panel, PasswordInput, Problem, Said, Segmented, Table, Tag, useAction, When, type Column } from './kit'
import { useRecord } from './nav'

type Arrival = {
  id: string
  network: string
  coin: string
  amount: number
  used: number
  from: string | null
  to: string
  memo: string | null
  tx: string
  kind: 'PAYMENT' | 'EXTRA' | 'UNMATCHED'
  swept: boolean
  sweepTx: string | null
  back: number | null
  status: string | null
  why: string | null
  whyWords: string | null
  returnTo: string | null
  returnMemo: string | null
  returnTx: string | null
  returnError: string | null
  returnBy: string | null
  canSend: boolean
  payment: { id: string; ref: string; status: string; business: string; businessId: string; email: string | null } | null
  at: string
}
type State = {
  sponsor: string | null
  gas: { network: string; coin: string; balance: number | null }[]
  waiting: { network: string; count: number; amount: number }[]
  ownAddresses: boolean
  stellar: { address: string | null; open: boolean; xlm: number; why: string | null }
  floats: { chain: string; address: string | null; usdc: number | null; feeCoin: string | null; fee: number | null }[]
  receive: { stellar: string | null; ton: string | null }
  networks: Record<string, string | null>
}
const FLOAT_NAME: Record<string, string> = { MOVEMENT: 'Movement', SOLANA: 'Solana', ARC: 'Arc', MONAD: 'Monad', STELLAR: 'Stellar' }

const STATUS: Record<string, [string, 'good' | 'warn' | 'bad' | undefined]> = {
  ASK: ['Asked the customer', undefined],
  QUEUED: ['Going back', undefined],
  SENDING: ['Sending', undefined],
  CONFIRMING: ['Sent, confirming', 'warn'],
  RETURNED: ['Sent back', 'good'],
  MANUAL: ['Ours to send', 'warn'],
  FAILED: ['Failed', 'bad'],
  KEPT: ['Kept', undefined],
}
const coins = (n: number, coin: string) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${coin}`
const short = (a: string | null) => (!a ? '' : a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

const columns: Column<Arrival>[] = [
  { key: 'what', head: 'Transfer', width: 'minmax(0,1.1fr)', cell: (x) => <span className="font-medium">{coins(x.back ?? x.amount, x.coin)} <span style={{ color: C.muted }}>on {x.network}</span></span>, phone: 'title' },
  { key: 'why', head: 'Why', cell: (x) => <span style={{ color: C.muted }}>{x.kind === 'UNMATCHED' ? 'Matched no payment' : x.whyWords ?? 'Paid a payment'}</span>, phone: 'sub' },
  { key: 'payment', head: 'Payment', width: '170px', cell: (x) => (x.payment ? <span>{x.payment.ref}</span> : <span style={{ color: C.dim }}>None</span>) },
  { key: 'state', head: 'State', width: '150px', cell: (x) => (x.status ? <Tag tone={STATUS[x.status]?.[1]}>{STATUS[x.status]?.[0] ?? x.status}</Tag> : <Tag tone="good">{x.swept ? 'Swept' : 'Paid'}</Tag>) },
  { key: 'when', head: 'Came in', width: '110px', align: 'right', cell: (x) => <When at={x.at} />, phone: 'meta' },
]

const VIEWS = [
  ['attention', 'Needs a person'],
  ['returns', 'Going back'],
  ['all', 'Everything'],
] as const

export function Crypto() {
  const [view, setView] = useState<string>('attention')
  const [picked, setPicked] = useState<string | null>(null)
  const { data, error, loading, reload } = useLoad<{ arrivals: Arrival[] }>(`/crypto?view=${view}`)
  const state = useLoad<State>('/crypto/state')
  const x = data?.arrivals.find((a) => a.id === picked) ?? null
  return (
    <div className="space-y-5">
      <SweepState s={state.data} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={(v) => { setView(v); setPicked(null) }} items={VIEWS} />
      </div>
      {x && <ArrivalActions key={x.id} x={x} onClose={() => setPicked(null)} onDone={() => void reload()} />}
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.arrivals ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            flag={(r) => (r.status === 'FAILED' ? 'bad' : r.status === 'MANUAL' || r.kind === 'UNMATCHED' ? 'warn' : undefined)}
            onRow={(r) => setPicked(r.id === picked ? null : r.id)}
            empty={view === 'attention' ? 'Nothing needs a person. Every transfer matched, and everything going back has gone.' : 'None of those.'}
          />
        )}
      </Panel>
    </div>
  )
}

function SweepState({ s }: { s: State | null }) {
  if (!s) return null
  const off = Object.entries(s.networks).filter(([, why]) => why)
  return (
    <div className="space-y-3">
      {!s.ownAddresses && (
        <Notice tone="warn" title="Payments don't have addresses of their own yet">
          Set DEPOSIT_SEED on the API (32 random bytes, hex) and back it up. Until then every crypto payment is told apart by its exact amount on the treasury.
        </Notice>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Panel title="Gas for sweeps" sub={s.sponsor ? <>Sponsor <Copy text={s.sponsor}>{short(s.sponsor)}</Copy>. Each sweep tops a payment's address up with just enough.</> : 'No gas sponsor is set.'}>
          <div className="space-y-1.5 text-[13px]">
            {s.gas.map((g) => (
              <div key={g.network} className="flex justify-between gap-3">
                <span style={{ color: C.muted }}>{g.network}</span>
                <span className="tabular-nums" style={{ color: g.balance === 0 ? C.amber : C.text }}>
                  {g.balance == null ? 'Unreadable' : `${g.balance.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${g.coin}`}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Waiting to be swept" sub="Paid payments' coins still on their own address.">
          {s.waiting.length === 0 ? (
            <div className="text-[13px]" style={{ color: C.dim }}>Nothing. Everything paid is in the treasury.</div>
          ) : (
            <div className="space-y-1.5 text-[13px]">
              {s.waiting.map((w) => (
                <div key={w.network} className="flex justify-between gap-3">
                  <span style={{ color: C.muted }}>{w.network}</span>
                  <span className="tabular-nums">{w.count} · ${w.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Floats" sub="Where settlements and money sent back are paid from, on each chain. Top them up here: USDC to pay out, and the chain's own coin for fees. Stellar uses the Solana float's key, so it has no key of its own.">
        <div className="space-y-3 text-[13px]">
          {(s.floats ?? []).map((f) => (
            <div key={f.chain} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="w-20 font-medium">{FLOAT_NAME[f.chain] ?? f.chain}</span>
              <span className="min-w-0 flex-1">{f.address ? <Copy text={f.address}>{short(f.address)}</Copy> : <span style={{ color: C.amber }}>No key set</span>}</span>
              <span className="tabular-nums" style={{ color: C.muted }}>
                {f.usdc == null ? 'Unreadable' : `${f.usdc.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`}
                {f.fee != null && f.feeCoin ? ` · ${f.fee.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${f.feeCoin}` : ''}
              </span>
            </div>
          ))}
        </div>
        {(s.receive?.stellar || s.receive?.ton) && (
          <div className="mt-4 space-y-1.5 border-t pt-3 text-[13px]" style={{ borderColor: C.lineSoft }}>
            <div style={{ color: C.dim }}>Where customers pay with a memo</div>
            {s.receive.stellar && <div>Stellar <Copy text={s.receive.stellar}>{short(s.receive.stellar)}</Copy></div>}
            {s.receive.ton && <div>TON <Copy text={s.receive.ton}>{short(s.receive.ton)}</Copy></div>}
          </div>
        )}
      </Panel>
      {off.length > 0 && (
        <Panel title="Networks not taking live payments">
          <div className="space-y-1.5 text-[13px]">
            {off.map(([n, why]) => (
              <div key={n} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
                <span className="font-medium">{n}</span>
                <span className="break-all" style={{ color: C.amber }}>{why}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function ArrivalActions({ x, onClose, onDone }: { x: Arrival; onClose: () => void; onDone: () => void }) {
  const [doing, setDoing] = useState<'send' | 'returned' | 'keep' | 'match' | null>(null)
  const [address, setAddress] = useState(x.returnTo ?? x.from ?? '')
  const [memo, setMemo] = useState(x.returnMemo ?? '')
  const [text, setText] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const { open } = useRecord()
  const decidable = ['ASK', 'MANUAL', 'FAILED'].includes(x.status ?? '')
  const act = async (path: string, body: Record<string, unknown>, ok: string) => {
    if (await run(() => biz(`/crypto/${x.id}/${path}`, { method: 'POST', body: { ...body, password } }), ok)) {
      setDoing(null)
      onDone()
    }
  }
  return (
    <ActionPanel title={`${coins(x.back ?? x.amount, x.coin)} on ${x.network}`} sub={x.kind === 'UNMATCHED' ? 'Reached our treasury and matched no payment.' : `Arrived ${x.whyWords ?? 'for its payment'}.`}>
      <div className="grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
        <div><span style={{ color: C.dim }}>From </span>{x.from ? <Copy text={x.from}>{short(x.from)}</Copy> : 'Unknown'}</div>
        <div><span style={{ color: C.dim }}>To </span><Copy text={x.to}>{short(x.to)}</Copy></div>
        <div><span style={{ color: C.dim }}>Transaction </span>{x.tx === 'unknown' ? 'Not found' : <Copy text={x.tx}>{short(x.tx)}</Copy>}</div>
        {x.memo && <div><span style={{ color: C.dim }}>Memo </span>{x.memo}</div>}
        {x.payment && (
          <div>
            <span style={{ color: C.dim }}>Payment </span>
            <button className="underline underline-offset-2" onClick={() => open('payment', x.payment!.id, { from: 'Crypto' })}>{x.payment.ref}</button> · {x.payment.business}
          </div>
        )}
        {x.payment?.email && <div><span style={{ color: C.dim }}>Customer </span>{x.payment.email}</div>}
        {x.returnTo && <div><span style={{ color: C.dim }}>Goes back to </span><Copy text={x.returnTo}>{short(x.returnTo)}</Copy></div>}
        {x.returnTx && <div><span style={{ color: C.dim }}>Sent in </span><Copy text={x.returnTx}>{short(x.returnTx)}</Copy></div>}
        {x.returnError && <div className="sm:col-span-2" style={{ color: C.amber }}>{x.returnError}</div>}
      </div>
      {!x.canSend && decidable && <p className="mt-3 text-[12.5px]" style={{ color: C.dim }}>This one can't go back by itself on {x.network}: send it from the treasury by hand, then mark it sent back.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {decidable && <Button tone="primary" onClick={() => setDoing(doing === 'send' ? null : 'send')}>{x.canSend ? 'Send it back' : 'Set where it goes'}</Button>}
        {(decidable || x.status === 'CONFIRMING') && <Button onClick={() => setDoing(doing === 'returned' ? null : 'returned')}>Sent back by hand</Button>}
        {x.kind === 'UNMATCHED' && x.status === 'MANUAL' && <Button onClick={() => setDoing(doing === 'match' ? null : 'match')}>Match to a payment</Button>}
        {decidable && <Button onClick={() => setDoing(doing === 'keep' ? null : 'keep')}>Keep it</Button>}
        <Button onClick={onClose}>Close</Button>
      </div>
      {doing === 'send' && (
        <div className="mt-4 space-y-3">
          <Field label={`Address on ${x.network}`}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} className="font-mono" />
          </Field>
          {(x.network === 'Stellar' || x.network === 'TON') && (
            <Field label="Memo, if the address needs one">
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={28} />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !address.trim()} onClick={() => void act('send', { address: address.trim(), memo: memo.trim() || undefined }, x.canSend ? 'Going back now.' : 'Saved. Send it by hand.')}>
              {busy ? 'Saving…' : x.canSend ? 'Send it back' : 'Save the address'}
            </Button>
          </div>
        </div>
      )}
      {doing === 'returned' && (
        <div className="mt-4 space-y-3">
          <Field label="Transaction">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="The hash of the transfer you sent" className="font-mono" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !text.trim()} onClick={() => void act('returned', { tx: text.trim() }, 'Marked sent back.')}>
              {busy ? 'Saving…' : 'Mark sent back'}
            </Button>
          </div>
        </div>
      )}
      {doing === 'keep' && (
        <div className="mt-4 space-y-3">
          <Field label="Why it stays">
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Too small to send, or sorted out with the customer" maxLength={300} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !text.trim()} onClick={() => void act('keep', { note: text.trim() }, 'Kept.')}>
              {busy ? 'Saving…' : 'Keep it'}
            </Button>
          </div>
        </div>
      )}
      {doing === 'match' && (
        <div className="mt-4 space-y-3">
          <Field label="Payment reference" hint={`A live ${x.coin} payment on ${x.network}. It counts towards it like any transfer: it may pay it, open it again if it lapsed, or go back.`}>
            <Input value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="MMB-…" className="font-mono" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <PasswordInput value={password} onChange={setPassword} />
            <Button tone="primary" disabled={busy || !password || !text.trim()} onClick={() => void act('match', { ref: text.trim() }, 'Matched.')}>
              {busy ? 'Saving…' : 'Match it'}
            </Button>
          </div>
        </div>
      )}
      {said && <div className="mt-3"><Said {...said} /></div>}
    </ActionPanel>
  )
}
