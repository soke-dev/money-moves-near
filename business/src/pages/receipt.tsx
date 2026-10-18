/**
 * A customer's receipt, on its own page: the link in their receipt email.
 *
 * Who was paid, how much, how, when and the reference, with a PDF to keep,
 * and a way to report a problem with it and follow that here.
 * Reached by the payment's own unguessable token, so only whoever has the
 * link sees it. Nothing here needs signing in.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, ShieldCheck } from '@/components/icons'
import { Avatar, Logo } from '@/components/brand'
import { ApiError, api } from '@/lib/api'
import { ngn, usd } from '@/lib/format'
import { downloadReceipt } from '@/components/Receipt'
import { ReceiptDispute } from '@/components/ReceiptDispute'

interface PublicReceipt {
  business: { name: string; logo: string | null; verified: boolean }
  title: string
  description: string | null
  items: { name: string; qty: number; price: number }[] | null
  currency: 'NGN' | 'USD'
  amountNgn: number
  amountUsd: number
  customerFeeNgn: number | null
  ngnPerUsd: number
  method: 'APP' | 'CRYPTO' | 'NAIRA'
  paidWith: string
  network: string | null
  tx: string | null
  ref: string
  paidAt: string | null
  payerName: string | null
  payerEmail: string | null
  status: 'PAID' | 'UNDERPAID'
  test: boolean
}

const when = (iso: string | null) =>
  new Date(iso ?? Date.now()).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function ReceiptPage() {
  const { token = '' } = useParams()
  const [r, setR] = useState<PublicReceipt | null>(null)
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ receipt: PublicReceipt }>('GET', `/pay/r/${encodeURIComponent(token)}`)
      .then((x) => setR(x.receipt))
      .catch((e) => setProblem(e instanceof ApiError ? e.message : "This receipt can't load right now. Try again in a moment."))
  }, [token])

  if (!r)
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16 text-center">
        {problem ? <p className="max-w-sm text-[14px] text-muted">{problem}</p> : <span className="animate-pulse"><Logo /></span>}
      </div>
    )

  const money = r.currency === 'NGN' ? ngn(r.amountNgn) : usd(r.amountUsd)
  const other = r.currency === 'NGN' ? `About ${usd(r.amountUsd)}` : `About ${ngn(r.amountNgn)}`
  const fee = r.customerFeeNgn ? (r.currency === 'NGN' ? ngn(r.customerFeeNgn) : usd(r.customerFeeNgn / r.ngnPerUsd)) : null
  const rows: [string, string][] = [
    ['Paid to', r.business.name],
    ['For', r.title],
    ...(r.items ?? []).map((it): [string, string] => [`${it.qty > 1 ? `${it.qty} × ` : ''}${it.name}`, r.currency === 'NGN' ? ngn(it.price * it.qty) : usd(it.price * it.qty)]),
    ...(fee ? ([['Processing fee', fee]] as [string, string][]) : []),
    ['Paid with', r.paidWith],
    ['Reference', r.ref],
    ['Date', when(r.paidAt)],
    ...(r.payerName ? ([['Paid by', r.payerName]] as [string, string][]) : []),
    ...(r.payerEmail ? ([['Receipt to', r.payerEmail]] as [string, string][]) : []),
    ...(r.tx ? ([['Transaction', `${r.tx.slice(0, 10)}…${r.tx.slice(-6)}`]] as [string, string][]) : []),
  ]

  const save = async () => {
    setBusy(true)
    try {
      await downloadReceipt({
        merchant: r.business.name,
        logo: r.business.logo,
        title: r.title,
        description: r.description,
        amount: money,
        other,
        paidWith: r.paidWith,
        reference: r.ref,
        paidAt: when(r.paidAt),
        payerName: r.payerName ?? undefined,
        payerEmail: r.payerEmail ?? undefined,
        rate: `₦${r.ngnPerUsd.toLocaleString()} to $1`,
        items: r.items?.map((it) => ({ name: it.name, qty: it.qty, total: r.currency === 'NGN' ? ngn(it.price * it.qty) : usd(it.price * it.qty) })),
        test: r.test,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full bg-[#F5F4F0] px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="flex items-center gap-2.5">
          {r.business.logo ? (
            <span className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-card ring-1 ring-line">
              <img src={r.business.logo} alt="" className="size-full object-contain" />
            </span>
          ) : (
            <Avatar name={r.business.name} size={36} />
          )}
          <span className="text-[15px] font-semibold text-fg">{r.business.name}</span>
          {r.business.verified && <ShieldCheck className="size-4 text-good" weight="fill" />}
        </div>

        <div className="mt-5 rounded-[18px] border border-line bg-card p-6">
          {r.test && <div className="mb-4 rounded-[10px] bg-[#FDF6E7] px-3 py-2 text-[12.5px] font-medium text-[#7A4A0A]">Test payment. No real money moved.</div>}
          <div className="flex flex-col items-center text-center">
            <img src="/brand/checked.png" alt="" className="size-12" />
            <div className="display tabular mt-3 text-[30px] font-semibold leading-none tracking-[-0.03em] text-fg">{money}</div>
            <div className="mt-1.5 text-[13px] text-muted">
              {r.status === 'PAID' ? `Paid to ${r.business.name}` : 'Part paid'} · {other}
            </div>
          </div>
          <dl className="mt-6 divide-y divide-soft border-y border-line text-[13.5px]">
            {rows.map(([k, v], i) => (
              <div key={`${k}-${i}`} className="flex justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-dim">{k}</dt>
                <dd className={`min-w-0 break-words text-right text-fg ${k === 'Reference' || k === 'Transaction' ? 'font-mono text-[12.5px]' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={() => void save()}
            disabled={busy}
            className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-fg text-[14px] font-semibold text-white disabled:opacity-60"
          >
            <Download className="size-4" /> {busy ? 'Making your PDF…' : 'Download receipt'}
          </button>
        </div>

        <ReceiptDispute token={token} business={r.business.name} />

        <p className="mt-5 text-center text-[12px] leading-relaxed text-dim">
          This receipt comes from Money Moves on behalf of {r.business.name}. Questions about your order go to them.
        </p>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-dim">
          Secured by <Logo compact />
        </div>
      </div>
    </div>
  )
}
