/**
 * Crypto going back to a customer: the link in their email.
 *
 * Money that came in when it wasn't needed (more than the price, after the
 * payment closed, another coin) goes back. When we can't tell whether the
 * wallet it came from is the customer's own (an exchange sends from its own
 * wallets, and money sent back there may not reach them), they say where it
 * goes here. Reached by its own unguessable token; nothing needs signing in.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Logo } from '@/components/brand'
import { ApiError, api } from '@/lib/api'

interface GiveBack {
  amount: string
  coin: string
  network: string
  why: string
  from: string | null
  status: string | null
  to: string | null
  tx: string | null
  ref: string | null
  business: string | null
  memo: boolean
}

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

export function GiveBackPage() {
  const { token = '' } = useParams()
  const [g, setG] = useState<GiveBack | null>(null)
  const [problem, setProblem] = useState('')
  const [where, setWhere] = useState<'from' | 'other'>('from')
  const [address, setAddress] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ return: GiveBack }>('GET', `/pay/x/${encodeURIComponent(token)}`)
      .then((x) => {
        setG(x.return)
        if (!x.return.from) setWhere('other')
      })
      .catch((e) => setProblem(e instanceof ApiError ? e.message : "This can't load right now. Try again in a moment."))
  }, [token])

  if (!g)
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16 text-center">
        {problem ? <p className="max-w-sm text-[14px] text-muted">{problem}</p> : <span className="animate-pulse"><Logo /></span>}
      </div>
    )

  const send = async () => {
    const to = where === 'from' ? g.from ?? '' : address.trim()
    if (!to) return setError('Paste the address it should go to.')
    setBusy(true)
    setError('')
    try {
      const r = await api<{ return: GiveBack }>('POST', `/pay/x/${encodeURIComponent(token)}`, { address: to, memo: where === 'other' && memo.trim() ? memo.trim() : undefined })
      setG(r.return)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const waiting = g.status === 'ASK'
  const going = g.status === 'QUEUED' || g.status === 'SENDING' || g.status === 'CONFIRMING'
  const radio = (id: 'from' | 'other', title: string, sub: string) => (
    <label className={`flex cursor-pointer gap-3 rounded-[12px] border px-3.5 py-3 ${where === id ? 'border-fg' : 'border-line'}`}>
      <input type="radio" name="where" checked={where === id} onChange={() => setWhere(id)} className="mt-1 accent-[#111]" />
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-fg">{title}</span>
        <span className="block break-all text-[12.5px] leading-relaxed text-muted">{sub}</span>
      </span>
    </label>
  )

  return (
    <div className="min-h-full bg-[#F5F4F0] px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[440px]">
        <Logo />
        <div className="mt-5 rounded-[18px] border border-line bg-card p-6">
          <div className="text-[13px] text-muted">Going back to you</div>
          <div className="display tabular mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] text-fg">
            {g.amount} <span className="text-[17px] font-medium tracking-normal text-muted">{g.coin}</span>
          </div>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            On {g.network}. It arrived{g.business ? ` for your payment to ${g.business}` : ''}, {g.why}.
          </p>

          {waiting && (
            <div className="mt-5 space-y-2.5">
              <div className="text-[13px] font-medium text-fg">Where should it go?</div>
              {g.from && radio('from', 'Back to the wallet it came from', `${short(g.from)}. Choose this if it's your own wallet.`)}
              {radio('other', 'To another address', `If you paid from an exchange, use your own ${g.coin} deposit address on ${g.network}.`)}
              {where === 'other' && (
                <div className="space-y-2 pt-1">
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={`Your ${g.network} address`}
                    className="h-11 w-full rounded-[10px] border border-line bg-card px-3 font-mono text-[16px] outline-none focus:border-fg sm:text-[14px]"
                  />
                  {g.memo && (
                    <input
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="Memo, if your exchange gave you one"
                      className="h-11 w-full rounded-[10px] border border-line bg-card px-3 text-[16px] outline-none focus:border-fg sm:text-[14px]"
                    />
                  )}
                </div>
              )}
              <p className="text-[12px] leading-relaxed text-dim">Only an address for {g.coin} on {g.network}. Anywhere else, it can't be recovered.</p>
              {error && <div className="text-[13px] text-red">{error}</div>}
              <button onClick={() => void send()} disabled={busy} className="mt-1 flex h-11 w-full items-center justify-center rounded-full bg-fg text-[14px] font-semibold text-white disabled:opacity-60">
                {busy ? 'Sending…' : 'Send it back'}
              </button>
            </div>
          )}
          {going && <p className="mt-5 rounded-[12px] bg-[#F4F8EE] px-3.5 py-3 text-[13.5px] text-fg">It's on its way{g.to ? ` to ${short(g.to)}` : ''}. This takes a minute or two.</p>}
          {g.status === 'RETURNED' && (
            <p className="mt-5 rounded-[12px] bg-[#F4F8EE] px-3.5 py-3 text-[13.5px] text-fg">
              Sent back{g.to ? ` to ${short(g.to)}` : ''}.{g.tx ? ` Transaction ${short(g.tx)}.` : ''}
            </p>
          )}
          {(g.status === 'MANUAL' || g.status === 'FAILED') && (
            <p className="mt-5 rounded-[12px] bg-[#FAFAF8] px-3.5 py-3 text-[13.5px] text-muted">
              Our team is sending it{g.to ? ` to ${short(g.to)}` : ''}, usually within a day. Questions: support@usemoneymoves.xyz
            </p>
          )}
          {g.status === 'KEPT' && <p className="mt-5 text-[13.5px] text-muted">This has been sorted out. Questions: support@usemoneymoves.xyz</p>}
          {g.ref && <p className="mt-5 text-[12px] text-dim">Payment <span className="font-mono">{g.ref}</span></p>}
        </div>
        <div className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-dim">
          Secured by <Logo compact />
        </div>
      </div>
    </div>
  )
}
