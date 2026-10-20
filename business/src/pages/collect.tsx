import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowRight, Bell, Bitcoin, Check, Clock, Copy, Download, ExternalLink, FileText, Landmark, Link2, MapPin, MoreHorizontal, Pause, Pencil, Play, Plus, QrMark, Receipt, Send, Store, Trash2 } from '@/components/icons'
import { ACCEPTED, DESTINATIONS, INVOICES, METHODS, NGN_RATE, OUTLETS, PAYMENT_LINKS, type Destination, type Method, PAYMENTS, feeUsd, type Payment, type Currency, type Invoice } from '@/data/mock'
import {
  Button,
  Card,
  CopyField,
  Field,
  Input,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Status,
  Table,
  Tabs,
  Textarea,
  Drawer,
  DetailRow,
  cx,
  type Column,
} from '@/components/ui'
import { AppLine, Avatar, MethodIcon, PayIcon, TokenIcon } from '@/components/brand'
import { PaymentDetail } from '@/pages/transactions'
import { RefundModal } from '@/components/Refund'
import { Timeline, type Step } from '@/components/Timeline'
import { useInvoices } from '@/state/invoices'
import Qr from '@/components/Qr'
import { PosterModal, type PosterOutlet } from '@/components/Poster'
import { TokenPicker } from '@/components/TokenPicker'
import { ALL_ACCEPT, acceptCount, acceptStore, acceptSummary, methodsStore, type Accept } from '@/state/accept'
import { ago, copy, date, dateTime, ngn, usd } from '@/lib/format'
import { useTestMode } from '@/components/TestMode'
import { useSession } from '@/state/session'
import { DestLine, SettlementChoice, canChoose, effectiveDest, useReadiness } from '@/components/Settlement'
import { ApiError, LIVE, api, type ApiAccept, type ApiInvoice, type ApiLink, type ApiOutlet, type ApiPaymentSettings, type PublicLink } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { BuilderHead, BuilderPage, BuilderSubmit, CheckRow, Choice, Eyebrow, Fold, GroupLabel, SheetField, type PreviewPayload } from '@/components/Builder'
import { useBranding } from '@/state/branding'
import { DEST_FROM_API, DEST_TO_API, METHOD_FROM_API, METHOD_TO_API, PAY_HOST, payUrl, useApiInvoices, useApiLinks, useApiOutlets, usePayments } from '@/state/live'
import { downloadCsv, downloadPdf, type ExportRow } from '@/lib/export'
import { pct, useFees } from '@/state/fees'

/* ─── Payment links ────────────────────────────────────────────────── */

/** A link from the API, in the shape the cards and the builder use. */
function toPayLink(l: ApiLink): PayLink {
  return {
    id: l.id,
    name: l.name,
    slug: l.slug,
    destination: DEST_FROM_API[l.destination],
    bankId: l.bankAccountId ?? undefined,
    methods: l.methods.map((m) => METHOD_FROM_API[m]),
    accept: (l.accept as Accept | null | undefined) ?? undefined,
    currency: l.currency,
    amountNgn: l.currency === 'NGN' && l.amount != null ? l.amount : undefined,
    amountUsd: l.currency === 'USD' && l.amount != null ? l.amount : 0,
    fixed: l.amount != null,
    paid: l.paid,
    collectedUsd: l.collectedUsd,
    active: l.active,
    createdAt: l.createdAt,
    about: l.description,
    redirect: l.redirectUrl,
    min: l.min,
    askPhone: l.askPhone,
    askName: l.askName ?? true,
    feePayer: l.feePayer ?? null,
  }
}

export function PaymentLinks() {
  const { business, mode } = useSession()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [qrFor, setQrFor] = useState<PosterOutlet | null>(null)
  // Live, the API's links for this mode; in preview, the samples, changed in this tab only.
  const live = useApiLinks()
  const [sample, setSample] = useState<PayLink[]>(PAYMENT_LINKS as PayLink[])
  const links = LIVE ? (live.links ?? []).map(toPayLink) : sample
  const [problem, setProblem] = useState('')
  const [editing, setEditing] = useState<PayLink | null>(null)
  const [deleting, setDeleting] = useState<PayLink | null>(null)
  const [viewing, setViewing] = useState<ActivitySubject | null>(null)
  const view = (l: PayLink) =>
    setViewing({ kind: 'link', id: l.id, name: l.name, url: `${PAY_HOST}/${l.slug}`, paid: l.paid, collectedUsd: l.collectedUsd, amountUsd: l.fixed ? l.amountUsd : undefined, methods: l.methods })
  const price = (l: PayLink) => (l.fixed ? (l.currency === 'NGN' && l.amountNgn ? ngn(l.amountNgn) : usd(l.amountUsd)) : l.currency === 'NGN' ? 'Any amount, in naira' : 'Any amount, in dollars')
  const rows = links.filter((l) => filter === 'all' || (filter === 'active' ? l.active : !l.active))
  const collected = links.reduce((a, l) => a + l.collectedUsd, 0)
  const paid = links.reduce((a, l) => a + l.paid, 0)
  const update = (l: PayLink) => setSample((all) => all.map((x) => (x.id === l.id ? l : x)))
  const linksPath = business ? `/businesses/${business.id}/links` : ''
  /** Live: change one link (or, with no body, delete it), then read the list again. */
  const change = async (id: string, body: Record<string, unknown> | null) => {
    setProblem('')
    try {
      await api(body ? 'PATCH' : 'DELETE', `${linksPath}/${id}`, body ?? undefined)
      await reload(linksPath)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    }
  }
  const setActive = (l: PayLink, active: boolean) => (LIVE ? void change(l.id, { active }) : update({ ...l, active }))

  return (
    <>
      <PageHeader
        title="Payment links"
        sub="A link anyone can pay, by the Money Moves app, crypto or naira. No website needed."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Create payment link
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'active', label: `Active ${links.filter((l) => l.active).length}` },
            { id: 'inactive', label: `Paused ${links.filter((l) => !l.active).length}` },
            { id: 'all', label: `All ${links.length}` },
          ]}
        />
        <div className="flex items-center gap-5 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Receipt className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{paid}</span> payment{paid === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownLeft className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{usd(collected)}</span> collected
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((l) => (
          <LinkCard
            key={l.id}
            l={l}
            onQr={() => setQrFor({ name: l.name, location: price(l), slug: l.slug, methods: l.methods, kind: 'link' })}
            onView={() => view(l)}
            menu={[
              { label: 'View payments', icon: <Receipt className="size-4 text-dim" />, onClick: () => view(l) },
              { label: 'Edit', icon: <Pencil className="size-4 text-dim" />, onClick: () => setEditing(l) },
              l.active
                ? { label: 'Pause', icon: <Pause className="size-4 text-dim" />, onClick: () => setActive(l, false) }
                : { label: 'Activate', icon: <Play className="size-4 text-dim" />, onClick: () => setActive(l, true) },
              { label: 'Delete', icon: <Trash2 className="size-4" />, onClick: () => setDeleting(l), danger: true },
            ]}
          />
        ))}
      </div>
      {problem && <p className="mt-4 text-[13px] text-red">{problem}</p>}
      {rows.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-6 py-10 text-center text-[13.5px] text-muted">
          {LIVE && live.loading
            ? 'Loading your links…'
            : LIVE && live.error
              ? live.error.message
              : filter === 'inactive'
                ? 'No paused links.'
                : mode === 'test' && LIVE
                  ? 'No test links yet, create one, open it, and pay it with the test buttons. No real money moves.'
                  : 'No links yet, create one to start taking payments.'}
        </div>
      )}

      <PosterModal outlet={qrFor} onClose={() => setQrFor(null)} />
      <ActivityDrawer subject={viewing} onClose={() => setViewing(null)} />
      <CreateLink open={open} onClose={() => setOpen(false)} />
      {editing && <CreateLink key={editing.id} open initial={editing} onClose={() => setEditing(null)} onSave={update} />}
      <ConfirmDelete
        thing={deleting && { kind: 'link', name: deleting.name }}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && (LIVE ? void change(deleting.id, null) : setSample((all) => all.filter((x) => x.id !== deleting.id)))}
      />
    </>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-dim transition hover:bg-card hover:text-fg hover:shadow-[0_0_0_1px_#E6E4DE]"
    >
      {children}
    </button>
  )
}

/** A few small round marks side by side, slightly overlapping. */
function Marks({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 -space-x-1 [&>*]:rounded-full [&>*]:ring-[1.5px] [&>*]:ring-white">{children}</span>
}

/**
 * One link, in three short lines: what it is and what it costs; how it's
 * doing; what it takes and where the money goes. The link itself sits in the
 * footer with the things you do with it.
 */
function LinkCard({ l, onQr, onView, menu }: { l: PayLink; onQr: () => void; onView: () => void; menu: MenuItem[] }) {
  const { business } = useSession()
  const [copied, setCopied] = useState(false)
  const methods: Method[] = l.methods ?? ['app', 'crypto', 'naira']
  const accept = l.accept ?? null
  const url = `${PAY_HOST}/${l.slug}`
  const coins = ACCEPTED.filter((a) => !accept || (accept[a.asset]?.length ?? 0) > 0)
  const fullUrl = payUrl(l.slug)

  return (
    <Card className="relative flex flex-col overflow-hidden">
      {!l.active && <span className="stripes absolute inset-x-0 top-0 h-1 opacity-50 grayscale" />}
      <div className="px-4 pb-3.5 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <button onClick={onView} className={cx('block max-w-full truncate text-left text-[14.5px] font-semibold hover:underline hover:underline-offset-2', l.active ? 'text-fg' : 'text-muted')}>
              {l.name}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-dim">
              <span className="inline-flex items-center gap-1.5">
                <span className={cx('size-1.5 rounded-full', l.active ? 'bg-good' : 'bg-dim')} />
                <span className={l.active ? 'text-fg' : ''}>{l.active ? 'Active' : 'Paused'}</span>
              </span>
              <span>·</span>
              <span className="tabular">{l.paid} payment{l.paid === 1 ? '' : 's'}</span>
              <span>·</span>
              <span className="tabular">{usd(l.collectedUsd)} collected</span>
            </div>
          </div>
          <div className="text-right">
            {l.fixed ? (
              <div className={cx('display tabular text-[20px] font-semibold leading-none', l.active ? 'text-fg' : 'text-dim')}>
                {l.currency === 'NGN' && l.amountNgn ? ngn(l.amountNgn) : usd(l.amountUsd)}
              </div>
            ) : (
              <div className="text-[13px] font-medium leading-5 text-muted">Any amount {l.currency === 'NGN' ? '· ₦' : '· $'}</div>
            )}
          </div>
          <div className="-mr-1.5 -mt-1">
            <RowMenu items={menu} />
          </div>
        </div>

        {/* What it takes, and where the money goes - marks, not boxes. */}
        <div className="mt-3 space-y-1.5 text-[12px] text-muted">
          <span className="flex items-center gap-1.5" title="How customers can pay">
            <Marks>
              {methods.map((m) => (
                <MethodIcon key={m} method={m} size={16} />
              ))}
            </Marks>
            {methods.length === 3 ? 'All methods' : methods.map((m) => (m === 'app' ? 'Money Moves app' : m === 'crypto' ? 'Crypto' : 'Naira')).join(', ')}
          </span>
          <div className="flex min-w-0 items-center gap-3">
            {methods.includes('crypto') && (
              <span className="inline-flex shrink-0 items-center gap-1.5" title="Coins accepted">
                <Marks>
                  {coins.map((c) => (
                    <TokenIcon key={c.asset} asset={c.asset} size={16} />
                  ))}
                </Marks>
                {accept ? acceptSummary(accept) : 'All coins'}
              </span>
            )}
            <span className="inline-flex min-w-0 items-center truncate" title="Settles to">
              <ArrowRight className="mr-1 size-3 shrink-0 text-dim" />
              <DestLine d={effectiveDest(business, l.destination)} bankId={l.bankId} mmId={l.mmId} />
            </span>
          </div>
        </div>
      </div>

      {/* The link itself, with what you do with it. */}
      <div className="mt-auto flex items-center gap-1 border-t border-line bg-[#FAFAF8] py-1.5 pl-4 pr-2">
        <Link2 className="size-3.5 shrink-0 text-dim" />
        <span className="ml-1 min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{url}</span>
        <IconButton
          label={copied ? 'Copied' : 'Copy link'}
          onClick={() => {
            copy(fullUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
        </IconButton>
        <IconButton label="QR poster" onClick={onQr}>
          <QrMark className="size-4" />
        </IconButton>
        <Link to={`/pay/${l.slug}`} target="_blank" aria-label="Open checkout">
          <IconButton label="Open checkout">
            <ExternalLink className="size-3.5" />
          </IconButton>
        </Link>
      </div>
    </Card>
  )
}

/**
 * One till: its code as a thumbnail you can tap for the poster, then where it
 * is, how it's doing, and what it takes - the same three short lines as a
 * payment link, with the address and its actions in the footer.
 */
function OutletCard({ o, menu, onPoster, onView }: { o: StoreOutlet; menu: MenuItem[]; onPoster: () => void; onView: () => void }) {
  const { business } = useSession()
  const [copied, setCopied] = useState(false)
  const url = `${PAY_HOST}/o/${o.slug}`
  const methods: Method[] = o.methods ?? ['app', 'crypto', 'naira']
  const coins = ACCEPTED.filter((a) => !o.accept || (o.accept[a.asset]?.length ?? 0) > 0)

  return (
    <Card className="relative flex flex-col overflow-hidden">
      {!o.active && <span className="stripes absolute inset-x-0 top-0 h-1 opacity-50 grayscale" />}
      <div className="flex gap-4 px-4 pb-3.5 pt-4">
        <button
          type="button"
          onClick={onPoster}
          title="Counter poster"
          aria-label={`Counter poster for ${o.name}`}
          className={cx('group relative shrink-0 self-start overflow-hidden rounded-[12px] border border-line transition hover:border-[#D3D0C7]', !o.active && 'opacity-50 grayscale')}
        >
          <Qr value={payUrl(`o/${o.slug}`)} size={64} />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-fg/75 text-[11px] font-medium text-white opacity-0 transition group-hover:opacity-100">
            <QrMark className="size-5" /> Poster
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <button onClick={onView} className={cx('block max-w-full truncate text-left text-[14.5px] font-semibold hover:underline hover:underline-offset-2', o.active ? 'text-fg' : 'text-muted')}>
                {o.name}
              </button>
              <div className="mt-0.5 flex items-center gap-1 text-[12px] text-dim">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">{o.location}</span>
              </div>
            </div>
            <div className="-mr-1.5 -mt-1">
              <RowMenu items={menu} />
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className={cx('size-1.5 rounded-full', o.active ? 'bg-good' : 'bg-dim')} />
              <span className={o.active ? 'text-fg' : ''}>{o.active ? 'Active' : 'Paused'}</span>
            </span>
            <span>·</span>
            <span className="tabular">{o.payments} payment{o.payments === 1 ? '' : 's'}</span>
            <span>·</span>
            <span className="tabular">{ngn(o.collectedNgn ?? o.collectedUsd * NGN_RATE)}</span>
          </div>

          {/* How customers pay, then the coins and where the money goes, side by side. */}
          <div className="mt-2.5 space-y-1.5 text-[12px] text-muted">
            <span className="flex items-center gap-1.5" title="How customers can pay">
              <Marks>
                {methods.map((m) => (
                  <MethodIcon key={m} method={m} size={16} />
                ))}
              </Marks>
              {methods.length === 3 ? 'All methods' : methods.map((m) => (m === 'app' ? 'Money Moves app' : m === 'crypto' ? 'Crypto' : 'Naira')).join(', ')}
            </span>
            <div className="flex min-w-0 items-center gap-3">
              {methods.includes('crypto') && (
                <span className="inline-flex shrink-0 items-center gap-1.5" title="Coins accepted">
                  <Marks>
                    {coins.map((c) => (
                      <TokenIcon key={c.asset} asset={c.asset} size={16} />
                    ))}
                  </Marks>
                  {o.accept ? acceptSummary(o.accept) : 'All coins'}
                </span>
              )}
              <span className="inline-flex min-w-0 items-center truncate" title="Settles to">
                <ArrowRight className="mr-1 size-3 shrink-0 text-dim" />
                <DestLine d={effectiveDest(business, o.destination)} bankId={o.bankId} mmId={o.mmId} />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-1 border-t border-line bg-[#FAFAF8] py-1.5 pl-4 pr-2">
        <Link2 className="size-3.5 shrink-0 text-dim" />
        <span className="ml-1 min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{url}</span>
        <IconButton
          label={copied ? 'Copied' : 'Copy link'}
          onClick={() => {
            copy(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
        </IconButton>
        <IconButton label="Counter poster" onClick={onPoster}>
          <QrMark className="size-4" />
        </IconButton>
        <Link to={`/pay/o/${o.slug}`} target="_blank" aria-label="Open checkout">
          <IconButton label="Open checkout">
            <ExternalLink className="size-3.5" />
          </IconButton>
        </Link>
      </div>
    </Card>
  )
}


/* ─── What one link, outlet or invoice has taken ──────────────────── */

type ActivitySubject = {
  kind: 'link' | 'outlet' | 'invoice'
  id: string
  name: string
  url?: string
  paid: number
  collectedUsd: number
  /** A set price: every sample payment is for exactly this. */
  amountUsd?: number
  methods?: Method[]
  /** An invoice is one bill to one person. */
  customer?: { name: string; email: string }
}

const CHANNEL: Record<ActivitySubject['kind'], Payment['channel']> = { link: 'Payment link', outlet: 'In-store QR', invoice: 'Invoice' }

/**
 * Sample payments for one item - drawn from the account's payments, so the
 * people and methods look real, and shaped to the item: its price, its
 * methods, its channel. The API will return the item's own.
 */
function paymentsFor(s: ActivitySubject): Payment[] {
  const seed = [...s.id].reduce((a, c) => a + c.charCodeAt(0), 0)
  const pool = PAYMENTS.filter((p) => !s.methods || s.methods.includes(p.method))
  const n = s.kind === 'invoice' ? Math.min(s.paid, 1) : Math.min(s.paid, 8)
  return Array.from({ length: n }, (_, i) => {
    const base = pool[(seed + i * 3) % pool.length]!
    const usdAmt = s.amountUsd ?? base.usd
    return {
      ...base,
      id: `${base.id}_${s.id}_${i}`,
      ref: `MMB-${50_000 + ((seed * 7 + i * 131) % 9_000)}`,
      customer: s.customer ?? base.customer,
      channel: CHANNEL[s.kind],
      usd: usdAmt,
      amount: base.asset === 'NGN' ? Math.round(usdAmt * NGN_RATE) : usdAmt,
      fee: feeUsd(base.method, usdAmt),
      status: i === 0 && s.kind !== 'invoice' && base.status === 'failed' ? 'successful' : base.status,
      received: base.status === 'underpaid' ? Math.round(usdAmt * 0.92 * 100) / 100 : undefined,
    }
  })
}

/** Every paid payment through this link or outlet, as a CSV or a PDF - who paid, their email, how much and how. */
function ExportButtons({ subject }: { subject: ActivitySubject }) {
  const { business, mode } = useSession()
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null)
  const [problem, setProblem] = useState("")
  const run = async (kind: "csv" | "pdf") => {
    if (!business) return
    setBusy(kind)
    setProblem("")
    try {
      const rows: ExportRow[] = LIVE
        ? (await api<{ rows: ExportRow[] }>("GET", `/businesses/${business.id}/payments/export?${subject.kind === "outlet" ? "outletId" : subject.kind === "invoice" ? "invoiceId" : "linkId"}=${encodeURIComponent(subject.id)}&mode=${mode}`)).rows
        : paymentsFor(subject).map((p) => ({ paidAt: p.paidAt ?? p.createdAt, ref: p.ref, name: p.customer.name, email: p.customer.email, phone: null, method: METHOD_TO_API[p.method], currency: "USD" as const, amountNgn: p.amount, amountUsd: p.usd, receivedNgn: null, status: "PAID" }))
      if (kind === "csv") downloadCsv(subject.name, rows)
      else downloadPdf(subject.name, business.name, rows)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't export just now. Try again in a moment.")
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line px-3.5 py-2.5">
        <span className="text-[12.5px] text-muted">Every payment: name, email, amount and how they paid.</span>
        <span className="flex shrink-0 gap-1.5">
          <Button size="sm" icon={<Download className="size-3.5" />} disabled={!!busy} onClick={() => void run("csv")}>
            {busy === "csv" ? "…" : "CSV"}
          </Button>
          <Button size="sm" icon={<Download className="size-3.5" />} disabled={!!busy} onClick={() => void run("pdf")}>
            {busy === "pdf" ? "…" : "PDF"}
          </Button>
        </span>
      </div>
      {problem && <p className="mt-1.5 text-[12.5px] text-red">{problem}</p>}
    </div>
  )
}

function ActivityDrawer({ subject, onClose }: { subject: ActivitySubject | null; onClose: () => void }) {
  const { test } = useTestMode()
  const [tab, setTab] = useState<'payments' | 'customers'>('payments')
  const [openId, setOpenId] = useState<string | null>(null)
  const [refund, setRefund] = useState<Payment | null>(null)
  const { payments } = usePayments()
  // Live, the link's own payments; in preview, samples shaped to it.
  const list = useMemo(
    () =>
      !subject
        ? []
        : LIVE
          ? payments.filter((p) => (subject.kind === 'outlet' ? p.outletId : subject.kind === 'invoice' ? p.invoiceId : p.linkId) === subject.id).slice(0, 20)
          : paymentsFor(subject),
    [subject, payments],
  )
  if (!subject) return null

  const people = Object.values(
    list.reduce<Record<string, { name: string; email: string; count: number; total: number; last: string }>>((acc, p) => {
      const c = (acc[p.customer.email] ??= { ...p.customer, count: 0, total: 0, last: p.createdAt })
      c.count += 1
      if (p.status === 'successful') c.total += p.usd
      if (p.createdAt > c.last) c.last = p.createdAt
      return acc
    }, {}),
  )
  const open = list.find((p) => p.id === openId) ?? null
  const close = () => {
    setOpenId(null)
    setTab('payments')
    onClose()
  }

  return (
    <>
      <Drawer open onClose={close} title={open ? `Payment ${open.ref}` : subject.name}>
        {open ? (
          <>
            <button onClick={() => setOpenId(null)} className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-fg">
              <ArrowLeft className="size-3.5" /> {subject.name}
            </button>
            <PaymentDetail p={open} test={test} onRefund={() => setRefund(open)} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[12.5px] text-dim">
              {subject.kind === 'link' ? <Link2 className="size-3.5" /> : subject.kind === 'outlet' ? <Store className="size-3.5" /> : <FileText className="size-3.5" />}
              <span>{subject.kind === 'link' ? 'Payment link' : subject.kind === 'outlet' ? 'Outlet' : 'Invoice'}</span>
              {subject.url && (
                <>
                  <span>·</span>
                  <span className="truncate font-mono">{subject.url}</span>
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-[10px] border border-line">
              {[
                ['Payments', String(subject.paid)],
                ['Collected', usd(subject.collectedUsd)],
                ['Customers', String(subject.kind === 'invoice' ? 1 : LIVE ? people.length : Math.max(people.length, Math.round(subject.paid * 0.7)))],
              ].map(([l, v], i) => (
                <div key={l} className={cx('px-3.5 py-3', i > 0 && 'border-l border-line')}>
                  <div className="text-[11.5px] text-dim">{l}</div>
                  <div className="display tabular mt-0.5 truncate text-[17px] font-semibold text-fg">{v}</div>
                </div>
              ))}
            </div>

            {subject.paid > 0 && <ExportButtons subject={subject} />}

            <div className="mt-5">
              <Tabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'payments', label: 'Payments' },
                  { id: 'customers', label: 'Customers' },
                ]}
              />
            </div>

            {list.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-5 py-8 text-center text-[13px] text-muted">
                {subject.kind === 'invoice' ? 'Not paid yet. You will see it here the moment it is.' : 'No payments yet.'}
              </div>
            ) : tab === 'payments' ? (
              <div className="-mx-2">
                {list.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setOpenId(p.id)}
                    className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2.5 text-left transition hover:bg-raise"
                  >
                    <PayIcon method={p.method} asset={p.asset} chain={p.chain} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-fg">{p.customer.name}</div>
                      <div className="truncate text-[12px] text-dim">
                        <span className="font-mono">{p.ref}</span> · {ago(p.createdAt)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[13.5px] font-medium text-fg">{usd(p.usd)}</div>
                      <div className="mt-0.5 flex justify-end">
                        <Status value={p.status} />
                      </div>
                    </div>
                  </button>
                ))}
                {subject.paid > list.length && <div className="px-2 pt-2 text-[12px] text-dim">Showing the latest {list.length} of {subject.paid}.</div>}
              </div>
            ) : (
              <div className="divide-y divide-soft">
                {people.map((c) => (
                  <div key={c.email} className="flex items-center gap-3 py-3">
                    <Avatar name={c.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium text-fg">{c.name}</div>
                      <div className="truncate text-[12px] text-dim">{c.email}</div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[13px] font-medium text-fg">{usd(c.total)}</div>
                      <div className="text-[12px] text-dim">
                        {c.count} payment{c.count === 1 ? '' : 's'} · {ago(c.last)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <Link to="/transactions" className="mt-6 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
              All payments <ArrowRight className="size-3.5" />
            </Link>
          </>
        )}
      </Drawer>
      <RefundModal payment={refund} onClose={() => setRefund(null)} />
    </>
  )
}

/* ─── Managing what's already made ─────────────────────────────────── */

type PayLink = {
  id: string
  name: string
  slug: string
  destination: Destination
  /** Which bank account, when it settles to a bank and there's more than one. */
  bankId?: string
  /** Which Money Moves account, when it settles there and there's more than one. */
  mmId?: string
  methods?: Method[]
  accept?: Accept
  currency?: Currency
  /** A naira price, exactly as set - amountUsd is its equivalent. */
  amountNgn?: number
  amountUsd: number
  fixed: boolean
  paid: number
  collectedUsd: number
  active: boolean
  createdAt: string
  /** Live: what the builder needs to edit it as it is. */
  about?: string | null
  redirect?: string | null
  min?: number | null
  askPhone?: boolean
  askName?: boolean
  feePayer?: FeePick
}

type StoreOutlet = {
  id: string
  slug: string
  name: string
  location: string
  destination: Destination
  methods?: Method[]
  accept?: Accept
  currency?: Currency
  payments: number
  collectedUsd: number
  /** Live: what it took, in naira. */
  collectedNgn?: number
  active: boolean
  bankId?: string
  mmId?: string
  staff?: string
  askName?: boolean
  feePayer?: FeePick
}

/** An outlet from the API, in the shape the cards and the builder use. */
function toOutlet(o: ApiOutlet): StoreOutlet {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    location: o.location,
    destination: DEST_FROM_API[o.destination],
    methods: o.methods.map((m) => METHOD_FROM_API[m]),
    accept: (o.accept as Accept | null | undefined) ?? undefined,
    currency: o.currency,
    payments: o.payments,
    collectedUsd: o.collectedUsd,
    collectedNgn: o.collectedNgn,
    active: o.active,
    bankId: o.bankAccountId ?? undefined,
    staff: o.staffEmail ?? undefined,
    askName: o.askName ?? true,
    feePayer: o.feePayer ?? null,
  }
}

type MenuItem = { label: string; icon: ReactNode; onClick: () => void; danger?: boolean }

/** The ⋯ on a card: edit it, pause it, or delete it. */
function RowMenu({ items }: { items: MenuItem[] }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const open = !!at

  // Laid over the page, not inside the card - a card or a table that clips its
  // own overflow can no longer cut the menu off.
  const show = () => {
    const r = button.current!.getBoundingClientRect()
    const height = items.length * 36 + 8
    const below = r.bottom + 4 + height < window.innerHeight
    setAt({ top: below ? r.bottom + 4 : r.top - 4 - height, left: Math.max(8, r.right - 176) })
  }

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setAt(null)
    }
    const shut = () => setAt(null)
    window.addEventListener('mousedown', away)
    window.addEventListener('resize', shut)
    window.addEventListener('scroll', shut, true)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && shut()
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('resize', shut)
      window.removeEventListener('scroll', shut, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setAt(null) : show())}
        className={cx('flex size-7 items-center justify-center rounded-md transition', open ? 'bg-raise text-fg' : 'text-dim hover:bg-raise hover:text-fg')}
      >
        <MoreHorizontal className="size-5" weight="bold" />
      </button>
      {at &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="rise fixed z-[80] w-44 overflow-hidden rounded-[10px] border border-line bg-card py-1 shadow-[0_16px_40px_-12px_rgba(18,18,16,0.28)]"
            style={{ top: at.top, left: at.left }}
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setAt(null)
                  it.onClick()
                }}
                className={cx('flex h-9 w-full items-center gap-2.5 px-3 text-left text-[13px]', it.danger ? 'text-red hover:bg-[#FBEAE8]' : 'text-fg hover:bg-raise')}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/** Deleting can't be undone - say what happens, and offer pausing instead. */
function ConfirmDelete({ thing, onClose, onConfirm }: { thing: { kind: string; name: string } | null; onClose: () => void; onConfirm: () => void }) {
  if (!thing) return null
  return (
    <Modal
      open
      onClose={onClose}
      width={440}
      title={`Delete this ${thing.kind}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            Delete {thing.kind}
          </Button>
        </>
      }
    >
      {thing.kind === 'invoice' ? (
        <p className="text-[13.5px] leading-relaxed text-muted">
          <span className="font-medium text-fg">{thing.name}</span> is cancelled: its link stops working straight away, so it can't be paid any more. To bill them
          again, send a new invoice.
        </p>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-muted">
          <span className="font-medium text-fg">{thing.name}</span> stops taking payments straight away, and its link and QR code stop working. Payments it already
          took stay in Payments. If you might want it back, pause it instead.
        </p>
      )}
    </Modal>
  )
}

/* ─── What the three builders share ───────────────────────────────── */

/*
 * A payment link, an invoice and an outlet are each made on one page: the
 * form down the left, the checkout as customers will see it on the right.
 * Coins and networks only show once crypto is on, so nobody is asked about
 * networks for a link that only takes naira.
 */

const METHOD_ORDER: Method[] = ['app', 'crypto', 'naira']
const METHOD_TILE: Record<Method, string> = {
  app: 'Approve in the app',
  crypto: 'Any wallet or exchange',
  naira: 'Bank transfer',
}
const METHOD_LINE: Record<Method, ReactNode> = {
  app: <AppLine size={18} />,
  crypto: <Bitcoin className="size-[18px]" />,
  naira: <Landmark className="size-[18px]" />,
}

function MoneyInput({ currency, value, onChange, placeholder }: { currency: Currency; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex h-10 items-center overflow-hidden rounded-[7px] border border-line bg-card focus-within:border-fg focus-within:shadow-[0_0_0_3px_rgba(129,251,2,0.32)]">
      <span className="flex h-full items-center border-r border-line bg-raise px-3 text-[15px] font-medium text-muted">{currency === 'NGN' ? '₦' : '$'}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder ?? (currency === 'NGN' ? '15,000' : '0.00')}
        inputMode="decimal"
        className="tabular h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] text-fg outline-none placeholder:text-dim"
      />
    </div>
  )
}

/**
 * The three ways to pay, one under the other. Any mix, but at least one. Test
 * mode simulates all three, so a business can try each before it's real.
 */
const METHOD_API = { naira: 'NAIRA', app: 'APP', crypto: 'CRYPTO' } as const

function MethodRows({ value, onChange }: { value: Method[]; onChange: (m: Method[]) => void }) {
  const { mode, business } = useSession()
  // The business's own switches, from Settings: one that's off isn't offered to customers, whatever is ticked here.
  const settings = useApi<ApiPaymentSettings>(LIVE && business ? `/businesses/${business.id}/payment-settings?mode=${mode}` : null)
  const shut = (m: Method) => settings.data?.methods[METHOD_API[m]]?.on === false
  return (
    <div>
      <div className="-mx-1.5">
        {METHOD_ORDER.map((m) => {
          const on = value.includes(m)
          const off = shut(m)
          if (off && !on) {
            return (
              <div key={m} className="flex items-center gap-3 rounded-[6px] px-1.5 py-2 opacity-60">
                <span className="size-[18px] shrink-0 rounded-[5px] border border-[#C9C6BC] bg-raise" />
                <span className="text-[#6B6A64]">{METHOD_LINE[m]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-fg">{METHODS[m].short}</span>
                  <span className="block text-[12px] text-dim">
                    Off for your business.{' '}
                    <Link to="/settings/business?tab=methods" className="underline underline-offset-2">Turn it on in Settings</Link>
                  </span>
                </span>
              </div>
            )
          }
          return (
            <label key={m} className="flex cursor-pointer items-center gap-3 rounded-[6px] px-1.5 py-2 hover:bg-raise">
              <span className={cx('flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition', on ? 'border-fg bg-fg' : 'border-[#C9C6BC] bg-card')}>
                {on && <Check className="size-3 text-white" strokeWidth={3} />}
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => onChange(on ? value.filter((x) => x !== m) : METHOD_ORDER.filter((x) => x === m || value.includes(x)))}
              />
              <span className="text-[#6B6A64]">{METHOD_LINE[m]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] text-fg">{METHODS[m].short}</span>
                <span className="block text-[12px] text-dim">{off ? 'Off for your business, so customers won’t see it until it’s on in Settings.' : METHOD_TILE[m]}</span>
              </span>
            </label>
          )
        })}
      </div>
      {value.length === 0 && <div className="mt-1.5 text-[12.5px] text-red">Pick at least one.</div>}
      {LIVE && mode === 'test' && <p className="mt-1.5 text-[12px] leading-relaxed text-dim">In test mode all three are simulated. Nothing real moves.</p>}
    </div>
  )
}

const methodsWord = (m: Method[]) => (m.length === METHOD_ORDER.length ? 'All' : m.length ? METHOD_ORDER.filter((x) => m.includes(x)).map((x) => METHODS[x].short).join(', ') : 'None yet')

/** "Payment methods": the ways to pay in one line that opens - and the coins, once crypto is on. */
function MethodsChoice({ pay }: { pay: ReturnType<typeof usePayOptions> }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <GroupLabel>Payment methods</GroupLabel>
      <Choice value={methodsWord(pay.methods)} open={open} onToggle={() => setOpen((o) => !o)}>
        <MethodRows value={pay.methods} onChange={pay.setMethods} />
        {pay.crypto && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-0.5 text-[13px] font-semibold text-fg">Coins and networks</div>
            <p className="mb-3 text-[12.5px] text-dim">For customers paying from a crypto wallet. It starts from your default in Settings.</p>
            <TokenPicker value={pay.accept} onChange={pay.setAccept} compact />
          </div>
        )}
      </Choice>
    </div>
  )
}

/** "Currency at checkout": what the price is in. The other currency always shows underneath. */
function CurrencySelect({ value, onChange, label = 'Currency at checkout' }: { value: Currency; onChange: (c: Currency) => void; label?: string }) {
  return (
    <div>
      <GroupLabel info="Customers see the other currency underneath at today's rate, and can switch to it.">{label}</GroupLabel>
      <Select value={value} onChange={(e) => onChange(e.target.value as Currency)} className="h-11">
        <option value="NGN">Naira (NGN)</option>
        <option value="USD">US dollar (USD)</option>
      </Select>
    </div>
  )
}

/** "Settlement": where this one's payments go, folded until it's wanted. */
function SettleFold({ pay }: { pay: ReturnType<typeof usePayOptions> }) {
  const { business } = useSession()
  return (
    <Fold label="Settlement" value={DESTINATIONS[effectiveDest(business, pay.dest)].label}>
      <p className="mb-3 text-[12.5px] leading-relaxed text-dim">Whatever the customer pays with is converted for you and sent here the moment it's paid.</p>
      <SettlementChoice value={pay.dest} onChange={pay.setDest} bankId={pay.bankId} onBank={pay.setBankId} mmId={pay.mmId} onMm={pay.setMmId} />
    </Fold>
  )
}

/** Today's rate and this business's limits, so the preview draws the checkout as customers will see it. */
function usePreviewBasics() {
  const { business, mode } = useSession()
  const r = useApi<{ rate: number | null; limits: { minNgn: number; maxNgn: number }; simulator: boolean }>(
    LIVE && business ? `/businesses/${business.id}/checkout-preview?mode=${mode === 'live' ? 'LIVE' : 'TEST'}` : null,
  )
  const [brand] = useBranding(business?.id)
  return {
    rate: r.data?.rate ?? (LIVE ? null : NGN_RATE),
    limits: r.data?.limits ?? { minNgn: 100, maxNgn: 1_000_000 },
    simulator: r.data?.simulator ?? mode !== 'live',
    brand,
    business: { name: business?.name ?? 'Your business', verified: business?.verify === 'verified' },
    mode: (mode === 'live' ? 'LIVE' : 'TEST') as 'LIVE' | 'TEST',
  }
}

/** The checkout's own fields, as the API would send them, from what the form says now. */
function previewLink(
  basics: ReturnType<typeof usePreviewBasics>,
  pay: ReturnType<typeof usePayOptions>,
  link: { slug: string; name: string; description?: string | null; currency: Currency; amount: number | null; min?: number | null; redirectUrl?: string | null; askPhone?: boolean; askName?: boolean; feePayer?: FeePick },
): PublicLink {
  return {
    link: {
      slug: link.slug,
      name: link.name,
      description: link.description ?? null,
      mode: basics.mode,
      active: true,
      currency: link.currency,
      amount: link.amount,
      min: link.min ?? null,
      methods: pay.methods.map((m) => METHOD_TO_API[m]),
      accept: pay.crypto ? (pay.accept as ApiAccept) : undefined,
      redirectUrl: link.redirectUrl ?? null,
      askPhone: !!link.askPhone,
      askName: link.askName ?? true,
      feePayer: link.feePayer ?? null,
    },
    business: basics.business,
    rate: basics.rate,
    limits: basics.limits,
    simulator: basics.simulator,
  }
}

/** The state every builder keeps: methods, coins and destination, from the business's defaults. */
function usePayOptions(init?: { methods?: Method[]; accept?: Accept; dest?: Destination; bankId?: string; mmId?: string }) {
  const { business, mode } = useSession()
  const ready = useReadiness()
  const start = () => ({
    // All three, live or simulated in test mode.
    methods: init?.methods ?? (LIVE ? METHOD_ORDER : business ? methodsStore.read(business.id) : METHOD_ORDER),
    accept: init?.accept ?? (business ? acceptStore.read(business.id) : ALL_ACCEPT),
    dest: (init?.dest ?? business?.destination ?? 'bank') as Destination,
    bankId: init?.bankId,
    mmId: init?.mmId,
  })
  const [o, setO] = useState(start)
  const destOk = !canChoose(business) || mode === 'test' || !!ready?.[o.dest].ready
  return {
    ...o,
    crypto: o.methods.includes('crypto'),
    setMethods: (methods: Method[]) => setO((p) => ({ ...p, methods })),
    setAccept: (accept: Accept) => setO((p) => ({ ...p, accept })),
    setDest: (dest: Destination) => setO((p) => ({ ...p, dest })),
    setBankId: (bankId: string) => setO((p) => ({ ...p, bankId })),
    /** The bank account to save on the item - only when it settles to a bank. */
    savedBank: o.dest === 'bank' ? o.bankId : undefined,
    setMmId: (mmId: string) => setO((p) => ({ ...p, mmId })),
    savedMm: o.dest === 'wallet' ? o.mmId : undefined,
    methodsOk: o.methods.length > 0,
    coinsOk: acceptCount(o.accept) > 0,
    destOk,
    /** What's still missing about paying, in a sentence - or nothing. */
    missing: () =>
      o.methods.length === 0
        ? 'Pick at least one way to pay.'
        : o.methods.includes('crypto') && acceptCount(o.accept) === 0
          ? 'Pick at least one coin and network, or turn crypto off.'
          : !destOk
            ? "Finish setting up where this settles. It isn't ready yet."
            : '',
    reset: () => setO(start()),
  }
}

/** The finished screen in the builder's column: it's made, here's where it lives. */
function MadeIt({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="mt-12">
      <span className="pop flex size-11 items-center justify-center rounded-full bg-lime text-fg">
        <Check className="size-5" strokeWidth={3} />
      </span>
      <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{sub}</p>
      <div className="mt-7">{children}</div>
    </div>
  )
}

/* ─── Create a payment link ───────────────────────────────────────── */

const BLANK_LINK = { name: '', about: '', fixed: 'fixed', amount: '', min: '', currency: 'NGN', redirect: '', slug: '' }
/** Left-to-right mark: keeps an address's slashes in place inside a box trimmed from its start. */
const LRM = String.fromCharCode(0x200e)
type LinkDraft = typeof BLANK_LINK

/** "Name and price": what it's for and what it costs, just for this link. */
function PriceSheet({ open, draft, onClose, onSave }: { open: boolean; draft: LinkDraft; onClose: () => void; onSave: (d: LinkDraft) => void }) {
  const [d, setD] = useState(draft)
  useEffect(() => {
    if (open) setD(draft)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof LinkDraft) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }))
  const amount = Number(d.amount) || 0
  const cur = d.currency as Currency
  const ok = !!d.name.trim() && (d.fixed === 'any' || amount > 0)
  return (
    <Drawer open={open} onClose={onClose} title="Name and price">
      <p className="-mt-1 mb-5 text-[13px] text-muted">What customers see they're paying for, and how much.</p>
      <div className="space-y-4">
        <Field label="Name" required>
          <Input value={d.name} onChange={set('name')} placeholder="Coding bootcamp deposit" autoFocus />
        </Field>
        <Field label="Description" optional hint="Shown under the name at checkout.">
          <Textarea value={d.about} onChange={set('about')} className="min-h-[64px]" placeholder="A few words about what they get" />
        </Field>
        <Field label="Pricing model">
          <Select value={d.fixed} onChange={set('fixed')} className="h-11">
            <option value="fixed">Fixed price, everyone pays the same</option>
            <option value="any">Customer chooses, tips, donations, top-ups</option>
          </Select>
        </Field>
        <div className="rounded-[10px] border border-line p-4">
          <div className="text-[13.5px] font-semibold text-fg">{d.fixed === 'fixed' ? 'The price' : 'What they can pay'}</div>
          <p className="mt-0.5 text-[12.5px] text-dim">{d.fixed === 'fixed' ? 'In the currency customers see first.' : 'Leave the minimum empty to accept any amount.'}</p>
          <div className="mt-3 grid grid-cols-[120px_1fr] gap-2.5">
            <Select value={d.currency} onChange={set('currency')} className="h-10">
              <option value="NGN">NGN</option>
              <option value="USD">USD</option>
            </Select>
            {d.fixed === 'fixed' ? (
              <MoneyInput currency={cur} value={d.amount} onChange={(v) => setD((p) => ({ ...p, amount: v }))} />
            ) : (
              <MoneyInput currency={cur} value={d.min} onChange={(v) => setD((p) => ({ ...p, min: v }))} placeholder="Minimum" />
            )}
          </div>
          {d.fixed === 'fixed' && amount > 0 && (
            <p className="mt-2 text-[12.5px] text-dim">{cur === 'USD' ? `About ${ngn(amount * NGN_RATE)}` : `About ${usd(amount / NGN_RATE)}`} at today's rate.</p>
          )}
        </div>
      </div>
      <div className="mt-8 flex justify-end gap-2 border-t border-line pt-5">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!ok}
          onClick={() => {
            onSave(d)
            onClose()
          }}
        >
          Save
        </Button>
      </div>
    </Drawer>
  )
}

function CreateLink({ open, onClose, initial, onSave }: { open: boolean; onClose: () => void; initial?: PayLink; onSave?: (l: PayLink) => void }) {
  const { business, mode, setDestination } = useSession()
  const pay = usePayOptions(initial && { methods: initial.methods, accept: initial.accept, dest: initial.destination, bankId: initial.bankId, mmId: initial.mmId })
  const basics = usePreviewBasics()
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [sheet, setSheet] = useState(false)
  const fresh = (): LinkDraft =>
    initial
      ? {
          ...BLANK_LINK,
          name: initial.name,
          about: initial.about ?? '',
          fixed: initial.fixed ? 'fixed' : 'any',
          currency: initial.currency ?? 'USD',
          amount: initial.fixed ? String(initial.currency === 'NGN' && initial.amountNgn ? initial.amountNgn : initial.amountUsd) : '',
          min: initial.min != null ? String(initial.min) : '',
          redirect: initial.redirect ?? '',
          slug: initial.slug,
        }
      : BLANK_LINK
  const [f, setF] = useState(fresh)
  const [phone, setPhone] = useState(initial?.askPhone ?? false)
  const [askName, setAskName] = useState(initial?.askName ?? true)
  const [feePayer, setFeePayer] = useState<FeePick>(initial?.feePayer ?? null)
  // Opening it again starts from what's there now - an edit from the link, a new one from nothing.
  useEffect(() => {
    if (!open) return
    setF(fresh())
    setPhone(initial?.askPhone ?? false)
    setAskName(initial?.askName ?? true)
    setFeePayer(initial?.feePayer ?? null)
  }, [open, initial?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const auto = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-link'
  const slug = f.slug || auto
  const amount = Number(f.amount) || 0
  const currency = f.currency as Currency
  const fixed = f.fixed === 'fixed'
  const priceWord = fixed ? (amount ? (currency === 'NGN' ? ngn(amount) : usd(amount)) : 'No price yet') : 'Customer chooses'

  /** Live: create the link, or save the changes, through the API. */
  const saveLive = async () => {
    if (!business) return
    const path = `/businesses/${business.id}/links`
    const fields = {
      name: f.name.trim(),
      description: f.about.trim() || null,
      currency: f.currency,
      amount: fixed ? amount : null,
      min: !fixed && Number(f.min) > 0 ? Number(f.min) : null,
      methods: pay.methods.map((m) => METHOD_TO_API[m]),
      accept: pay.crypto ? pay.accept : null,
      destination: DEST_TO_API[pay.dest],
      bankAccountId: pay.savedBank ?? null,
      redirectUrl: f.redirect.trim() || null,
      askPhone: phone,
      askName,
      feePayer,
    }
    setBusy(true)
    setProblem('')
    try {
      if (initial) {
        await api('PATCH', `${path}/${initial.id}`, fields)
        await reload(path)
        close()
      } else {
        const r = await api<{ link: ApiLink }>('POST', path, { ...fields, mode: mode === 'live' ? 'LIVE' : 'TEST', slug: f.slug || undefined })
        await reload(path)
        setCreated(r.link.slug)
      }
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    onClose()
    setTimeout(() => {
      setCreated(null)
      setProblem('')
      setF(BLANK_LINK)
      setPhone(false)
      pay.reset()
    }, 150)
  }

  const submit = () => {
    const missing = !f.name.trim() ? 'Set what you are charging for first.' : fixed && !amount ? 'Give it a price, or let the customer choose.' : pay.missing()
    if (missing) return setProblem(missing)
    setProblem('')
    setDestination(pay.dest)
    if (LIVE) return void saveLive()
    if (initial) {
      const ngnPrice = currency === 'NGN' && fixed
      onSave?.({
        ...initial,
        name: f.name.trim(),
        fixed,
        currency,
        amountNgn: ngnPrice ? amount : undefined,
        amountUsd: fixed ? (ngnPrice ? amount / NGN_RATE : amount) : 0,
        methods: pay.methods,
        accept: pay.accept,
        destination: pay.dest,
        bankId: pay.savedBank,
        mmId: pay.savedMm,
      })
      close()
    } else setCreated(slug)
  }

  const preview: PreviewPayload = {
    kind: 'link',
    key: `${f.currency}-${f.fixed}`,
    brand: basics.brand,
    info: previewLink(basics, pay, {
      slug,
      name: f.name.trim() || 'What you are charging for',
      description: f.about.trim() || null,
      currency,
      amount: fixed ? amount : null,
      min: !fixed && Number(f.min) > 0 ? Number(f.min) : null,
      redirectUrl: f.redirect.trim() || null,
      askPhone: phone,
      askName,
      feePayer,
    }),
  }

  return (
    <BuilderPage open={open} onClose={close} back="Payment links" preview={created ? null : preview} previewWhat="link" previewUrl={`${PAY_HOST}/${slug}`}>
      {created ? (
        <MadeIt title={LIVE && mode === 'test' ? 'Your test link is ready' : 'Your link is live'} sub="Share it anywhere. Every payment shows up in Payments.">
          <div className="flex flex-col items-center gap-5 rounded-[12px] border border-line p-6">
            <Qr value={payUrl(created)} size={168} logo />
            <div className="w-full">
              <CopyField value={`${PAY_HOST}/${created}`} />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Link to={`/pay/${created}`} target="_blank">
              <Button icon={<ExternalLink className="size-4" />}>Open checkout</Button>
            </Link>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </MadeIt>
      ) : (
        <>
          <BuilderHead title={initial ? 'Edit payment link' : 'Create a payment link'} sub="A shareable link customers use to pay you. Each payment opens its own checkout." />

          <Eyebrow>What are you charging for</Eyebrow>
          <SheetField value={f.name.trim()} aside={f.name.trim() ? priceWord : undefined} placeholder="Add a name and price" onOpen={() => setSheet(true)} />

          <div className="my-7 h-px bg-line" />

          <MethodsChoice pay={pay} />
          <div className="mt-3 space-y-3">
            <CheckRow checked disabled hint="Every customer gives it, receipts and any refund go there.">
              Ask for email
            </CheckRow>
            <CheckRow checked={askName} onChange={setAskName} hint="For bank and crypto payments. The Money Moves app sends the payer's name itself.">
              Ask for name
            </CheckRow>
            <CheckRow checked={phone} onChange={setPhone}>
              Ask for phone number
            </CheckRow>
          </div>
          <div className="mt-6">
            <FeeChoice value={feePayer} onChange={setFeePayer} />
          </div>

          <div className="mt-6">
            <CurrencySelect value={currency} onChange={(c) => setF((p) => ({ ...p, currency: c }))} />
          </div>

          <div className="mt-6 space-y-3">
            <SettleFold pay={pay} />
            <Fold label="Link address" value={`${PAY_HOST}/${slug}`}>
              <div className={cx('flex h-10 items-center overflow-hidden rounded-[7px] border border-line focus-within:border-fg', initial && 'bg-raise')}>
                {/* The fixed part takes half at most - the part they type gets the rest. Trimmed from its start, so the end that leads into theirs stays readable. */}
                <span className="flex h-full max-w-[50%] shrink-0 items-center overflow-hidden border-r border-line bg-raise px-3 font-mono text-[12px] text-dim">
                  <span className="truncate [direction:rtl]">{LRM + PAY_HOST + '/' + LRM}</span>
                </span>
                <input
                  value={f.slug}
                  onChange={(e) => setF((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                  placeholder={auto}
                  disabled={!!initial}
                  className="h-full min-w-0 flex-1 bg-card px-2.5 font-mono text-[13px] text-fg outline-none placeholder:text-dim disabled:bg-raise disabled:text-muted"
                />
              </div>
              <p className="mt-2 text-[12.5px] text-dim">
                {initial ? "The address can't change, links you've shared and QR codes you've printed keep working." : 'Letters, numbers and dashes. It never changes once the link is made.'}
              </p>
            </Fold>
            <Fold label="Redirects" value={f.redirect.trim() || 'none'}>
              <Field label="Send them here after paying" optional>
                <Input value={f.redirect} onChange={(e) => setF((p) => ({ ...p, redirect: e.target.value }))} placeholder="https://yoursite.com/thanks" />
              </Field>
            </Fold>
          </div>

          <BuilderSubmit problem={problem}>
            <Button variant="primary" size="lg" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Create payment link'}
            </Button>
          </BuilderSubmit>

          <PriceSheet open={sheet} draft={f} onClose={() => setSheet(false)} onSave={(d) => setF(d)} />
        </>
      )}
    </BuilderPage>
  )
}

/* ─── Invoices ─────────────────────────────────────────────────────── */

type InvoiceTab = 'unpaid' | 'paid' | 'draft' | 'all'

const invTotal = (i: Invoice) => i.items.reduce((a, x) => a + x.qty * x.price, 0)
const invMoney = (i: Invoice, n = invTotal(i)) => (i.currency === 'NGN' ? ngn(n) : usd(n))
const invUrl = (i: Invoice) => `${PAY_HOST}/i/${i.token ?? i.number.toLowerCase()}`

/** An invoice from the API, in the shape the list and the drawer use. */
function toInvoice(i: ApiInvoice): Invoice {
  const naira = i.currency === 'NGN'
  return {
    id: i.id,
    number: i.number,
    token: i.token,
    customer: i.customerName,
    email: i.customerEmail,
    currency: i.currency,
    items: i.items,
    note: i.note ?? undefined,
    // The dollar side: what the payment was worth when paid, else roughly at today's rate.
    amountUsd: naira ? (i.payment?.amountUsd ?? Math.round((i.amount / NGN_RATE) * 100) / 100) : i.amount,
    amountNgn: naira ? i.amount : undefined,
    status: i.status === 'DRAFT' ? 'draft' : i.status === 'PAID' ? 'paid' : 'unpaid',
    destination: DEST_FROM_API[i.destination],
    bankId: i.bankAccountId ?? undefined,
    methods: i.methods.map((m) => METHOD_FROM_API[m]),
    accept: (i.accept as Accept | null | undefined) ?? undefined,
    createdAt: i.createdAt,
    due: i.dueAt,
    sentAt: i.sentAt ?? undefined,
    viewedAt: i.viewedAt ?? undefined,
    remindedAt: i.remindedAt ?? undefined,
    repeat: i.repeat ?? undefined,
    repeatOf: i.repeatOf ?? undefined,
    paid: i.payment ? { at: i.payment.paidAt ?? i.paidAt ?? i.createdAt, method: METHOD_FROM_API[i.payment.method], ref: i.payment.ref } : undefined,
  }
}
const isOverdue = (i: Invoice) => i.status === 'unpaid' && new Date(i.due).getTime() < Date.now()

/** "in 3 days", "today" or "2 days overdue" - in calendar days, so due on the 25th is "in 14 days" all day on the 11th. */
function dueWhen(iso: string) {
  const day = (t: Date) => Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())
  const d = Math.round((day(new Date(iso)) - day(new Date())) / 86_400_000)
  if (d === 0) return 'today'
  const n = Math.abs(d)
  const days = `${n} day${n === 1 ? '' : 's'}`
  return d > 0 ? `in ${days}` : `${days} overdue`
}

/** A paid invoice's payment, shaped from a sample one until the API returns the real record. */
function invoicePayment(i: Invoice): Payment {
  const paid = i.paid!
  const base = PAYMENTS.find((p) => p.method === paid.method && p.status === 'successful') ?? PAYMENTS[0]!
  const asset = paid.method === 'naira' ? 'NGN' : paid.method === 'app' ? 'USDC' : (paid.asset ?? base.asset)
  return {
    ...base,
    id: `pay_${i.id}`,
    ref: paid.ref,
    customer: { name: i.customer, email: i.email },
    channel: 'Invoice',
    destination: i.destination,
    asset,
    chain: paid.method === 'naira' ? undefined : paid.method === 'app' ? 'Movement' : (paid.chain ?? base.chain),
    usd: i.amountUsd,
    amount: asset === 'NGN' ? (i.amountNgn ?? Math.round(i.amountUsd * NGN_RATE)) : i.amountUsd,
    fee: feeUsd(paid.method, i.amountUsd, i.amountNgn),
    status: 'successful',
    payer: base.payer && { ...base.payer, name: i.customer },
    received: undefined,
    createdAt: paid.at,
  }
}

export function Invoices() {
  const { business, mode } = useSession()
  const [open, setOpen] = useState(false)
  const [stored, setInvoices] = useInvoices(business?.id)
  // Live, the API's invoices for this mode; in preview, the samples.
  const live = useApiInvoices()
  const invoices = LIVE ? (live.invoices ?? []).map(toInvoice) : (stored ?? INVOICES)
  const [problem, setProblem] = useState('')
  const invPath = business ? `/businesses/${business.id}/invoices` : ''
  /** Live: one change through the API, then the list read again. */
  const act = async (fn: () => Promise<unknown>) => {
    setProblem('')
    try {
      await fn()
      await reload(invPath)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    }
  }
  const [tab, setTab] = useState<InvoiceTab>('unpaid')
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Invoice | null>(null)
  const viewing = invoices.find((i) => i.id === viewingId) ?? null
  const update = (i: Invoice) => setInvoices((all) => all.map((x) => (x.id === i.id ? i : x)))
  const send = (i: Invoice) => (LIVE ? void act(() => api('POST', `${invPath}/${i.id}/send`)) : update({ ...i, status: 'unpaid', sentAt: new Date().toISOString() }))
  const remind = (i: Invoice) => (LIVE ? void act(() => api('POST', `${invPath}/${i.id}/remind`)) : update({ ...i, remindedAt: new Date().toISOString() }))
  const preview = (i: Invoice) => window.open(`/pay/i/${i.token ?? i.number.toLowerCase()}`, '_blank')

  const count = (t: InvoiceTab) => (t === 'all' ? invoices.length : invoices.filter((i) => i.status === t).length)
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0)
  // Unpaid: soonest due first, so the late ones lead. Paid: newest payment first.
  const rows = invoices
    .filter((i) => tab === 'all' || i.status === tab)
    .sort((a, b) => (tab === 'unpaid' ? time(a.due) - time(b.due) : tab === 'paid' ? time(b.paid?.at) - time(a.paid?.at) : time(b.createdAt) - time(a.createdAt)))
  const unpaid = invoices.filter((i) => i.status === 'unpaid')
  const late = unpaid.filter(isOverdue)
  const paidUsd = invoices.reduce((a, i) => a + (i.status === 'paid' ? i.amountUsd : 0), 0)

  const menu = (i: Invoice): MenuItem[] => [
    { label: 'View details', icon: <FileText className="size-4 text-dim" />, onClick: () => setViewingId(i.id) },
    // Live, a draft has no page yet: the customer's link only opens once it's sent.
    ...(LIVE && i.status === 'draft' ? [] : [{ label: i.status === 'draft' ? 'Preview' : 'Open invoice', icon: <ExternalLink className="size-4 text-dim" />, onClick: () => preview(i) }]),
    ...(i.status === 'draft'
      ? [{ label: 'Send invoice', icon: <Send className="size-4 text-dim" />, onClick: () => send(i) }]
      : [{ label: 'Copy link', icon: <Copy className="size-4 text-dim" />, onClick: () => copy(invUrl(i)) }]),
    ...(i.status === 'unpaid' ? [{ label: 'Send reminder', icon: <Bell className="size-4 text-dim" />, onClick: () => remind(i) }] : []),
    ...(i.status === 'paid' ? [] : [{ label: 'Delete', icon: <Trash2 className="size-4" />, onClick: () => setDeleting(i), danger: true }]),
  ]

  const columns: Column<Invoice>[] = [
    { key: 'n', header: 'Invoice', render: (i) => <span className="font-mono text-[12.5px]">{i.number}</span> },
    {
      key: 'c',
      header: 'Customer',
      render: (i) => (
        <div>
          <div className="font-medium">{i.customer}</div>
          <div className="text-[12px] text-dim">{i.email}</div>
        </div>
      ),
    },
    {
      key: 'a',
      header: 'Amount',
      render: (i) => (
        <div>
          <div className="tabular font-medium">{invMoney(i)}</div>
          {i.currency === 'NGN' && <div className="tabular text-[12px] text-dim">≈ {usd(i.amountUsd)}</div>}
        </div>
      ),
    },
    tab === 'paid'
      ? {
          key: 'p',
          header: 'Paid',
          render: (i) =>
            i.paid && (
              <span className="inline-flex items-center gap-2 text-muted">
                <PayIcon method={i.paid.method} asset={i.paid.method === 'naira' ? 'NGN' : (i.paid.asset ?? 'USDC')} chain={i.paid.chain} size={18} />
                {date(i.paid.at)}
              </span>
            ),
        }
      : tab === 'draft'
        ? { key: 'd', header: 'Created', render: (i) => <span className="text-muted">{ago(i.createdAt)}</span> }
        : {
            key: 'd',
            header: 'Due',
            render: (i) => (
              <div>
                <div className="text-muted">{date(i.due)}</div>
                {i.status === 'unpaid' && <div className={cx('text-[12px]', isOverdue(i) ? 'text-red' : 'text-dim')}>{dueWhen(i.due)}</div>}
              </div>
            ),
          },
    { key: 'x', header: 'Settles to', render: (i) => <span className="text-muted"><DestLine d={effectiveDest(business, i.destination)} bankId={i.bankId} mmId={i.mmId} /></span> },
    ...(tab === 'unpaid' || tab === 'all' ? [{ key: 's', header: 'Status', render: (i: Invoice) => <Status value={isOverdue(i) ? 'overdue' : i.status} /> }] : []),
    {
      key: 'm',
      header: '',
      align: 'right',
      render: (i) => (
        // Clicks here are the menu's, not the row's.
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <RowMenu items={menu(i)} />
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Invoices"
        sub="Bill a customer by email. They pay from the invoice with the app, crypto or naira."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Create invoice
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'unpaid', label: `Unpaid ${count('unpaid')}` },
            { id: 'paid', label: `Paid ${count('paid')}` },
            { id: 'draft', label: `Drafts ${count('draft')}` },
            { id: 'all', label: `All ${count('all')}` },
          ]}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{usd(unpaid.reduce((a, i) => a + i.amountUsd, 0))}</span> outstanding
          </span>
          {late.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-red">
              <AlertTriangle className="size-4" /> <span className="tabular font-medium">{late.length}</span> overdue
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownLeft className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{usd(paidUsd)}</span> paid
          </span>
        </div>
      </div>

      <Table
        rowKey={(r) => r.id}
        rows={rows}
        onRow={(i) => setViewingId(i.id)}
        columns={columns}
        empty={
          <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-6 py-10 text-center text-[13.5px] text-muted">
            {LIVE && live.loading
              ? 'Loading your invoices…'
              : LIVE && live.error
                ? live.error.message
                : invoices.length === 0
                  ? LIVE && mode === 'test'
                    ? 'No test invoices yet, create one, open its link, and pay it with the test buttons. No real money moves, and nothing is emailed.'
                    : 'No invoices yet, create one and your customer gets it by email, with a link to pay.'
                  : tab === 'unpaid'
                    ? 'Nothing waiting. Every invoice you sent has been paid.'
                    : tab === 'paid'
                      ? 'No paid invoices yet.'
                      : 'No drafts.'}
          </div>
        }
      />

      <InvoiceDrawer
        inv={viewing}
        problem={problem}
        onClose={() => {
          setViewingId(null)
          setProblem('')
        }}
        onSend={send}
        onRemind={remind}
        onStopRepeat={LIVE ? (i) => void act(() => api('POST', `${invPath}/${i.id}/stop-repeat`)) : undefined}
        onPreview={preview}
        onDelete={(i) => {
          setViewingId(null)
          setDeleting(i)
        }}
      />
      <ConfirmDelete
        thing={deleting && { kind: 'invoice', name: `${deleting.number} to ${deleting.customer}` }}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && (LIVE ? void act(() => api('DELETE', `${invPath}/${deleting.id}`)) : setInvoices((all) => all.filter((x) => x.id !== deleting.id)))}
      />
      {problem && <p className="mt-4 text-[13px] text-red">{problem}</p>}
      <CreateInvoice
        open={open}
        onClose={() => setOpen(false)}
        number={(LIVE && live.next) || `INV-${String(Math.max(0, ...invoices.map((i) => Number(i.number.slice(4)) || 0)) + 1).padStart(4, '0')}`}
        onSave={(i) => {
          setInvoices((all) => [i, ...all])
          setTab('unpaid')
        }}
      />
    </>
  )
}

/** What happened to an invoice so far, and what it's waiting on. */
function invoiceSteps(i: Invoice, test = false): Step[] {
  const done: [string, Step][] = []
  const add = (at: string | undefined, title: string, detail?: string) => at && done.push([at, { title, detail, time: dateTime(at), state: 'done' }])
  // Test invoices are never emailed: the business opens or shares the link itself.
  const emailed = test ? 'A test invoice. Nothing was emailed' : `Emailed to ${i.email}`
  add(i.createdAt, 'Created')
  add(i.sentAt, 'Sent', emailed)
  add(i.viewedAt, 'Opened by the customer')
  add(i.remindedAt, 'Reminder sent', emailed)
  add(i.paid?.at, 'Paid', i.paid && `${METHODS[i.paid.method].short} · ${i.paid.ref}`)
  done.sort((a, b) => a[0].localeCompare(b[0]))

  const next: Step[] =
    i.status === 'draft'
      ? [{ title: 'Not sent yet', detail: test ? "Send it to open its link. Test invoices aren't emailed." : 'Send it and the customer gets the link by email.', state: 'todo' }]
      : i.status === 'unpaid'
        ? [
            isOverdue(i)
              ? { title: 'Overdue', detail: `It was due ${date(i.due)}. A reminder often does it.`, state: 'wait' }
              : { title: 'Waiting for payment', detail: `Due ${date(i.due)}, ${dueWhen(i.due)}`, state: 'now' },
          ]
        : []
  return [...done.map(([, s]) => s), ...next]
}

function InvoiceDrawer({
  inv,
  problem,
  onClose,
  onSend,
  onRemind,
  onPreview,
  onDelete,
  onStopRepeat,
}: {
  inv: Invoice | null
  /** What went wrong with the last thing done to it. */
  problem?: string
  onClose: () => void
  onSend: (i: Invoice) => void
  onRemind: (i: Invoice) => void
  onPreview: (i: Invoice) => void
  onDelete: (i: Invoice) => void
  /** Live: no more from this series. */
  onStopRepeat?: (i: Invoice) => void
}) {
  const { business } = useSession()
  const { test } = useTestMode()
  const [showPayment, setShowPayment] = useState(false)
  const [refund, setRefund] = useState<Payment | null>(null)
  const [copied, setCopied] = useState(false)
  const { payments: livePayments } = usePayments()
  if (!inv) return null

  const payment = inv.paid ? (LIVE ? (livePayments.find((p) => p.invoiceId === inv.id && p.status === 'successful') ?? null) : invoicePayment(inv)) : null
  const late = isOverdue(inv)
  const money = (n: number) => (inv.currency === 'NGN' ? ngn(n) : usd(n))
  const methods: Method[] = inv.methods ?? METHOD_ORDER
  const coins = ACCEPTED.filter((a) => !inv.accept || (inv.accept[a.asset]?.length ?? 0) > 0)
  // Just reminded: the button says so instead of sending again.
  const reminded = !!inv.remindedAt && Date.now() - new Date(inv.remindedAt).getTime() < 86_400_000
  const close = () => {
    setShowPayment(false)
    onClose()
  }
  const section = 'mt-7 border-t border-line pt-5'
  const heading = 'mb-3 text-[13px] font-semibold text-fg'

  return (
    <>
      <Drawer open onClose={close} title={showPayment && payment ? `Payment ${payment.ref}` : `Invoice ${inv.number}`}>
        {showPayment && payment ? (
          <>
            <button onClick={() => setShowPayment(false)} className="mb-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted hover:text-fg">
              <ArrowLeft className="size-3.5" /> Invoice {inv.number}
            </button>
            <PaymentDetail p={payment} test={test} onRefund={() => setRefund(payment)} />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <Status value={late ? 'overdue' : inv.status} />
              <span className={cx('text-[12.5px]', late ? 'text-red' : 'text-dim')}>
                {inv.paid ? `Paid ${date(inv.paid.at)}` : inv.status === 'draft' ? `Created ${ago(inv.createdAt)}` : `Due ${date(inv.due)} · ${dueWhen(inv.due)}`}
              </span>
            </div>
            <div className="display tabular mt-3 text-[34px] font-semibold leading-none text-fg">{invMoney(inv)}</div>
            <div className="tabular mt-2 text-[12.5px] text-dim">≈ {inv.currency === 'NGN' ? usd(inv.amountUsd) : ngn(Math.round(inv.amountUsd * NGN_RATE))}</div>

            {inv.repeat && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[10px] bg-raise px-3.5 py-3 text-[13px]">
                <span className="text-muted">
                  {inv.repeat.next ? (
                    <>
                      Repeats {REPEAT_WORDS[inv.repeat.every]}. Next one goes out <span className="font-medium text-fg">{date(inv.repeat.next)}</span>
                      {inv.repeat.until ? `, until ${date(inv.repeat.until)}` : ''}.
                    </>
                  ) : inv.status === 'draft' ? (
                    <>Repeats {REPEAT_WORDS[inv.repeat.every]} once it's sent.</>
                  ) : (
                    <>Stopped repeating.</>
                  )}
                </span>
                {inv.repeat.next && onStopRepeat && (
                  <Button size="sm" variant="ghost" onClick={() => onStopRepeat(inv)}>
                    Stop repeating
                  </Button>
                )}
              </div>
            )}
            {inv.repeatOf && <div className="mt-5 rounded-[10px] bg-raise px-3.5 py-2.5 text-[13px] text-muted">Sent on schedule, from a repeating invoice.</div>}

            <div className="mt-5 flex items-center gap-3 rounded-[10px] border border-line px-3.5 py-3">
              <Avatar name={inv.customer} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium text-fg">{inv.customer}</div>
                <div className="truncate text-[12px] text-dim">{inv.email}</div>
              </div>
              <span className="text-[12px] text-dim">Billed to</span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {inv.status === 'draft' && (
                <Button variant="primary" size="sm" icon={<Send className="size-3.5" />} onClick={() => onSend(inv)}>
                  Send invoice
                </Button>
              )}
              {inv.status === 'unpaid' && (
                <Button variant="primary" size="sm" icon={reminded ? <Check className="size-3.5" strokeWidth={3} /> : <Bell className="size-3.5" />} disabled={reminded} onClick={() => onRemind(inv)}>
                  {reminded ? 'Reminder sent' : 'Send reminder'}
                </Button>
              )}
              {!(LIVE && inv.status === 'draft') && (
                <Button size="sm" icon={<ExternalLink className="size-3.5" />} onClick={() => onPreview(inv)}>
                  {inv.status === 'draft' ? 'Preview' : 'Open invoice'}
                </Button>
              )}
              {inv.status !== 'paid' && (
                <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(inv)}>
                  Delete
                </Button>
              )}
            </div>
            {problem && <p className="mt-3 text-[12.5px] text-red">{problem}</p>}

            {payment && inv.paid && (
              <div className={section}>
                <div className={heading}>Payment</div>
                <button
                  onClick={() => setShowPayment(true)}
                  className="flex w-full items-center gap-3 rounded-[10px] border border-line px-3.5 py-3 text-left transition hover:border-[#D3D0C7] hover:bg-[#FAFAF8]"
                >
                  <PayIcon method={payment.method} asset={payment.asset} chain={payment.chain} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-fg">
                      {METHODS[payment.method].short}
                      {payment.method === 'crypto' && ` · ${payment.asset} on ${payment.chain}`}
                    </div>
                    <div className="truncate text-[12px] text-dim">
                      <span className="font-mono">{payment.ref}</span> · {dateTime(payment.createdAt)}
                    </div>
                  </div>
                  <span className="tabular text-[13.5px] font-medium text-fg">{usd(payment.usd)}</span>
                  <ArrowRight className="size-4 text-dim" />
                </button>
              </div>
            )}

            <div className={section}>
              <div className={heading}>Items</div>
              <div className="overflow-hidden rounded-[10px] border border-line">
                {inv.items.map((it, n) => (
                  <div key={n} className="flex items-start justify-between gap-4 border-b border-soft px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-fg">{it.name}</div>
                      <div className="tabular text-[12px] text-dim">
                        {it.qty} × {money(it.price)}
                      </div>
                    </div>
                    <div className="tabular shrink-0 text-[13.5px] text-fg">{money(it.qty * it.price)}</div>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-[#FAFAF8] px-3.5 py-2.5 text-[13.5px] font-semibold text-fg">
                  <span>Total</span>
                  <span className="tabular">{invMoney(inv)}</span>
                </div>
              </div>
              {inv.note && (
                <div className="mt-3 text-[12.5px] leading-relaxed text-muted">
                  <span className="text-dim">Note to customer: </span>
                  {inv.note}
                </div>
              )}
            </div>

            <div className={section}>
              <div className={heading}>Activity</div>
              <Timeline items={invoiceSteps(inv, LIVE && test)} />
            </div>

            <div className={section}>
              <div className={heading}>Checkout</div>
              <DetailRow label="Pay with">
                <span className="inline-flex items-center gap-1.5">
                  <Marks>
                    {methods.map((m) => (
                      <MethodIcon key={m} method={m} size={16} />
                    ))}
                  </Marks>
                  {methods.length === 3 ? 'All methods' : methods.map((m) => (m === 'app' ? 'Money Moves app' : m === 'crypto' ? 'Crypto' : 'Naira')).join(', ')}
                </span>
              </DetailRow>
              {methods.includes('crypto') && (
                <DetailRow label="Coins">
                  <span className="inline-flex items-center gap-1.5">
                    <Marks>
                      {coins.map((c) => (
                        <TokenIcon key={c.asset} asset={c.asset} size={16} />
                      ))}
                    </Marks>
                    {inv.accept ? acceptSummary(inv.accept) : 'All coins'}
                  </span>
                </DetailRow>
              )}
              <DetailRow label="Settles to">
                <DestLine d={effectiveDest(business, inv.destination)} bankId={inv.bankId} mmId={inv.mmId} />
              </DetailRow>
              {inv.status !== 'draft' && (
                <div className="mt-3 flex items-center gap-1 rounded-[8px] border border-line bg-[#FAFAF8] py-1 pl-3 pr-1">
                  <Link2 className="size-3.5 shrink-0 text-dim" />
                  <span className="ml-1 min-w-0 flex-1 truncate font-mono text-[12px] text-muted">{invUrl(inv)}</span>
                  <IconButton
                    label={copied ? 'Copied' : 'Copy link'}
                    onClick={() => {
                      copy(invUrl(inv))
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1400)
                    }}
                  >
                    {copied ? <Check className="size-3.5 text-good" strokeWidth={3} /> : <Copy className="size-3.5" />}
                  </IconButton>
                </div>
              )}
            </div>
          </>
        )}
      </Drawer>
      <RefundModal payment={refund} onClose={() => setRefund(null)} />
    </>
  )
}

const BLANK_INVOICE = { customer: '', email: '', due: '', currency: 'USD', note: '', repeat: '', until: '' }

const REPEAT_WORDS: Record<string, string> = { WEEKLY: 'every week', MONTHLY: 'every month', QUARTERLY: 'every 3 months', YEARLY: 'every year' }

function CreateInvoice({ open, onClose, number, onSave }: { open: boolean; onClose: () => void; number: string; onSave: (i: Invoice) => void }) {
  const { business, mode, setDestination } = useSession()
  const pay = usePayOptions()
  const basics = usePreviewBasics()
  const [sent, setSent] = useState(false)
  // Live: what the API made of it - its real number and link, and whether it was emailed.
  const [made, setMade] = useState<{ number: string; token: string; emailed: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [f, setF] = useState(BLANK_INVOICE)
  const [items, setItems] = useState([{ name: '', qty: 1, price: '' }])
  const [feePayer, setFeePayer] = useState<FeePick>(null)
  const total = items.reduce((a, i) => a + (Number(i.price) || 0) * i.qty, 0)
  const currency = f.currency as Currency
  const money = (n: number) => (currency === 'NGN' ? ngn(n) : usd(n))
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const priced = items.filter((i) => Number(i.price) > 0).map((i) => ({ name: i.name.trim() || 'Item', qty: i.qty, price: Number(i.price) }))

  const close = () => {
    onClose()
    setTimeout(() => {
      setSent(false)
      setMade(null)
      setProblem('')
      setF(BLANK_INVOICE)
      setItems([{ name: '', qty: 1, price: '' }])
      pay.reset()
    }, 150)
  }

  /** Live: the API numbers it, saves it and sends it. */
  const sendLive = async () => {
    if (!business) return
    const path = `/businesses/${business.id}/invoices`
    setBusy(true)
    setProblem('')
    try {
      const r = await api<{ invoice: ApiInvoice; emailed: boolean }>('POST', path, {
        mode: mode === 'live' ? 'LIVE' : 'TEST',
        customerName: f.customer.trim(),
        customerEmail: f.email.trim(),
        currency: f.currency,
        items: priced,
        note: f.note.trim() || null,
        dueAt: f.due,
        methods: pay.methods.map((m) => METHOD_TO_API[m]),
        accept: pay.crypto ? pay.accept : null,
        destination: DEST_TO_API[pay.dest],
        bankAccountId: pay.savedBank ?? null,
        feePayer,
        send: true,
        repeat: f.repeat ? { every: f.repeat, until: f.until || null } : null,
      })
      await reload(path)
      setMade({ number: r.invoice.number, token: r.invoice.token, emailed: r.emailed })
      setSent(true)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const shownNumber = made?.number ?? number

  const submit = () => {
    const missing = !f.customer.trim()
      ? "Say who it's for."
      : !/\S+@\S+\.\S+/.test(f.email)
        ? "That email doesn't look right."
        : !f.due
          ? 'Give it a due date.'
          : total <= 0
            ? 'Add at least one item with a price.'
            : pay.missing()
    if (missing) return setProblem(missing)
    setProblem('')
    setDestination(pay.dest)
    if (LIVE) return void sendLive()
    const now = new Date().toISOString()
    const naira = currency === 'NGN'
    onSave({
      id: `inv_${Date.now()}`,
      number,
      customer: f.customer.trim(),
      email: f.email.trim(),
      currency: naira ? 'NGN' : 'USD',
      items: priced,
      note: f.note.trim() || undefined,
      amountUsd: naira ? Math.round((total / NGN_RATE) * 100) / 100 : total,
      amountNgn: naira ? total : undefined,
      status: 'unpaid',
      destination: pay.dest,
      bankId: pay.savedBank,
      mmId: pay.savedMm,
      methods: pay.methods,
      accept: pay.crypto ? pay.accept : undefined,
      createdAt: now,
      sentAt: now,
      due: new Date(f.due).toISOString(),
    })
    setSent(true)
  }

  const token = made?.token ?? number.toLowerCase()
  const preview: PreviewPayload = {
    kind: 'invoice',
    key: f.currency,
    brand: basics.brand,
    info: {
      ...previewLink(basics, pay, { slug: token, name: `Invoice ${shownNumber}`, description: f.note.trim() || null, currency, amount: total || null }),
      invoice: {
        number: shownNumber,
        customerName: f.customer.trim() || 'Your customer',
        customerEmail: f.email.trim() || 'customer@example.com',
        items: priced,
        dueAt: f.due ? new Date(f.due).toISOString() : new Date().toISOString(),
        status: 'OPEN',
        paidAt: null,
        paymentRef: null,
      },
    },
  }

  return (
    <BuilderPage open={open} onClose={close} back="Invoices" preview={sent ? null : preview} previewWhat="invoice" previewUrl={`${PAY_HOST}/i/${token}`}>
      {sent ? (
        <MadeIt
          title="Invoice sent"
          sub={made && !made.emailed ? "Test invoices aren't emailed. Open its link to try paying it." : `${f.customer} has it at ${f.email}. You'll see it here the moment it's paid.`}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-[10px] border border-line px-4 py-3.5">
              <div>
                <div className="font-mono text-[12.5px] text-dim">{shownNumber}</div>
                <div className="mt-0.5 text-[14px] font-semibold text-fg">{f.customer}</div>
              </div>
              <div className="tabular text-[22px] font-semibold text-fg">{money(total)}</div>
            </div>
            <CopyField value={`${PAY_HOST}/i/${token}`} />
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </MadeIt>
      ) : (
        <>
          <BuilderHead title="New invoice" sub="A bill for one customer, with its own link. We email it, and you see it here the moment it's paid." />

          <Eyebrow>Who it's for</Eyebrow>
          <div className="space-y-3">
            <Field label="Customer name" required>
              <Input value={f.customer} onChange={set('customer')} placeholder="Ada Okafor" autoFocus />
            </Field>
            <Field label="Customer email" required hint="The invoice and the receipt go here.">
              <Input type="email" value={f.email} onChange={set('email')} placeholder="ada@example.com" />
            </Field>
            <Field label="Due date" required>
              <Input type="date" value={f.due} onChange={set('due')} />
            </Field>
            {LIVE && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Repeat" hint={f.repeat ? 'A fresh invoice goes out on schedule, due the same time after.' : undefined}>
                  <Select value={f.repeat} onChange={(e) => setF((p) => ({ ...p, repeat: e.target.value }))}>
                    <option value="">Doesn't repeat</option>
                    <option value="WEEKLY">Every week</option>
                    <option value="MONTHLY">Every month</option>
                    <option value="QUARTERLY">Every 3 months</option>
                    <option value="YEARLY">Every year</option>
                  </Select>
                </Field>
                {f.repeat && (
                  <Field label="Until" optional hint="Leave empty to keep going until you stop it.">
                    <Input type="date" value={f.until} min={f.due || undefined} onChange={(e) => setF((p) => ({ ...p, until: e.target.value }))} />
                  </Field>
                )}
              </div>
            )}
          </div>

          <div className="my-7 h-px bg-line" />

          <Eyebrow>What they're paying for</Eyebrow>
          <div className="mb-2 grid grid-cols-[1fr_62px_104px_32px] gap-2 text-[12px] font-medium text-dim">
            <span>Item</span>
            <span>Qty</span>
            <span>Price</span>
            <span />
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_62px_104px_32px] gap-2">
                <Input placeholder="What it is" value={it.name} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <Input value={it.qty} inputMode="numeric" onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, qty: Number(e.target.value) || 1 } : y)))} />
                <Input placeholder="0.00" value={it.price} inputMode="decimal" onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value.replace(/[^0-9.]/g, '') } : y)))} />
                <button onClick={() => setItems((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} className="flex items-center justify-center text-dim hover:text-red" aria-label="Remove">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button size="sm" className="mt-2" icon={<Plus className="size-3.5" />} onClick={() => setItems((x) => [...x, { name: '', qty: 1, price: '' }])}>
            Add item
          </Button>
          <div className="mt-3 flex items-center justify-between rounded-[8px] border border-line bg-raise px-4 py-3">
            <span className="text-[13.5px] text-muted">Total</span>
            <span className="tabular text-[17px] font-semibold text-fg">{money(total)}</span>
          </div>
          <div className="mt-3">
            <Field label="Note to customer" optional>
              <Textarea value={f.note} onChange={set('note')} className="min-h-[64px]" placeholder="Thanks for your business." />
            </Field>
          </div>

          <div className="my-7 h-px bg-line" />

          <MethodsChoice pay={pay} />
          <div className="mt-6">
            <FeeChoice value={feePayer} onChange={setFeePayer} />
          </div>
          <div className="mt-6">
            <CurrencySelect value={currency} onChange={(c) => setF((p) => ({ ...p, currency: c }))} />
          </div>
          <div className="mt-6">
            <SettleFold pay={pay} />
          </div>

          <BuilderSubmit problem={problem}>
            <Button variant="primary" size="lg" disabled={busy} onClick={submit}>
              {busy ? 'Sending…' : 'Send invoice'}
            </Button>
          </BuilderSubmit>
        </>
      )}
    </BuilderPage>
  )
}

/* ─── Outlets (in-store QR) ────────────────────────────────────────── */

// A store QR is always an address we hold, never the business wallet: we can
// only convert what we hold. Each outlet settles to its own destination.

export function Outlets() {
  const { business, mode } = useSession()
  const [open, setOpen] = useState(false)
  const [poster, setPoster] = useState<PosterOutlet | null>(null)
  // Live, the API's outlets for this mode; in preview, the samples, changed in this tab only.
  const live = useApiOutlets()
  const [sample, setSample] = useState<StoreOutlet[]>(OUTLETS as StoreOutlet[])
  const outlets = LIVE ? (live.outlets ?? []).map(toOutlet) : sample
  const [problem, setProblem] = useState('')
  const outPath = business ? `/businesses/${business.id}/outlets` : ''
  /** Live: change one outlet (or, with no body, delete it), then read the list again. */
  const change = async (id: string, body: Record<string, unknown> | null) => {
    setProblem('')
    try {
      await api(body ? 'PATCH' : 'DELETE', `${outPath}/${id}`, body ?? undefined)
      await reload(outPath)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    }
  }
  const [editing, setEditing] = useState<StoreOutlet | null>(null)
  const [deleting, setDeleting] = useState<StoreOutlet | null>(null)
  const [viewing, setViewing] = useState<ActivitySubject | null>(null)
  const view = (o: StoreOutlet) =>
    setViewing({ kind: 'outlet', id: o.id, name: o.name, url: `${PAY_HOST}/o/${o.slug}`, paid: o.payments, collectedUsd: o.collectedUsd, methods: o.methods })
  const update = (o: StoreOutlet) => setSample((all) => all.map((x) => (x.id === o.id ? o : x)))
  const setActive = (o: StoreOutlet, active: boolean) => (LIVE ? void change(o.id, { active }) : update({ ...o, active }))
  const [filter, setFilter] = useState<'active' | 'paused' | 'all'>('active')
  const shown = outlets.filter((o) => filter === 'all' || (filter === 'active' ? o.active : !o.active))
  // Live, what the outlets took in naira; in preview, the samples' dollars at the sample rate.
  const takingsNgn = LIVE ? outlets.reduce((a, o) => a + (o.collectedNgn ?? 0), 0) : outlets.reduce((a, o) => a + o.collectedUsd, 0) * NGN_RATE
  const count = outlets.reduce((a, o) => a + o.payments, 0)
  return (
    <>
      <PageHeader
        title="Outlets"
        sub="A QR code and a link for each till or shop. Customers scan or tap, type the amount, and pay the way you allow. The Money Moves app, crypto or a bank transfer."
        actions={
          <Button variant="primary" icon={<Store className="size-4" />} onClick={() => setOpen(true)}>
            New outlet
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'active', label: `Active ${outlets.filter((o) => o.active).length}` },
            { id: 'paused', label: `Paused ${outlets.filter((o) => !o.active).length}` },
            { id: 'all', label: `All ${outlets.length}` },
          ]}
        />
        <div className="flex items-center gap-5 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Receipt className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{count}</span> payment{count === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownLeft className="size-4 text-dim" /> <span className="tabular font-medium text-fg">{ngn(takingsNgn)}</span> collected
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {shown.map((o) => (
          <OutletCard
            key={o.id}
            o={o}
            onPoster={() => setPoster({ name: o.name, location: o.location, slug: o.slug, methods: o.methods })}
            onView={() => view(o)}
            menu={[
              { label: 'View payments', icon: <Receipt className="size-4 text-dim" />, onClick: () => view(o) },
              { label: 'Edit', icon: <Pencil className="size-4 text-dim" />, onClick: () => setEditing(o) },
              o.active
                ? { label: 'Pause', icon: <Pause className="size-4 text-dim" />, onClick: () => setActive(o, false) }
                : { label: 'Activate', icon: <Play className="size-4 text-dim" />, onClick: () => setActive(o, true) },
              { label: 'Delete', icon: <Trash2 className="size-4" />, onClick: () => setDeleting(o), danger: true },
            ]}
          />
        ))}
      </div>
      {shown.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-[#D6D3CA] px-6 py-10 text-center text-[13.5px] text-muted">
          {LIVE && live.loading
            ? 'Loading your outlets…'
            : LIVE && live.error
              ? live.error.message
              : filter === 'paused'
                ? 'No paused outlets.'
                : outlets.length === 0 && LIVE && mode === 'test'
                  ? 'No test outlets yet, create one, open its link, and pay it with the test buttons. No real money moves.'
                  : filter === 'active'
                    ? 'No active outlets, switch one on, or create one.'
                    : 'No outlets yet, create one for your counter.'}
        </div>
      )}
      <PosterModal outlet={poster} onClose={() => setPoster(null)} />
      <ActivityDrawer subject={viewing} onClose={() => setViewing(null)} />
      <CreateOutlet open={open} onClose={() => setOpen(false)} onPoster={setPoster} />
      {editing && <CreateOutlet key={editing.id} open initial={editing} onClose={() => setEditing(null)} onPoster={setPoster} onSave={update} />}
      <ConfirmDelete
        thing={deleting && { kind: 'outlet', name: deleting.name }}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && (LIVE ? void change(deleting.id, null) : setSample((all) => all.filter((x) => x.id !== deleting.id)))}
      />
      {problem && <p className="mt-4 text-[13px] text-red">{problem}</p>}
    </>
  )
}

/* ─── Who pays the fee ─────────────────────────────────────────────── */

type FeePick = 'BUSINESS' | 'CUSTOMER' | null

/**
 * Who pays the processing fee on this link or outlet: the business's default
 * (set on the Fees page), or one of the two for this one alone. The fees are
 * written out, so nobody picks without knowing what they are.
 */
function FeeChoice({ value, onChange }: { value: FeePick; onChange: (v: FeePick) => void }) {
  const { business } = useSession()
  const PR = useFees()
  const fallback = business?.feePayer === 'CUSTOMER' ? 'charge my customer' : 'charge me'
  const what =
    (value ?? business?.feePayer ?? 'BUSINESS') === 'CUSTOMER'
      ? 'The fee is added on top at checkout. You get your full price.'
      : 'Customers pay your price. The fee comes out of what you get.'
  return (
    <Field label="Who pays the fee" hint={what}>
      <Select value={value ?? 'default'} onChange={(e) => onChange(e.target.value === 'default' ? null : (e.target.value as FeePick))}>
        <option value="default">My default ({fallback})</option>
        <option value="BUSINESS">Charge me</option>
        <option value="CUSTOMER">Charge my customer</option>
      </Select>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
        Bank transfer {pct(PR.naira.rate)}, capped at ₦{PR.naira.capNgn.toLocaleString()}. Crypto {pct(PR.crypto.rate)}, capped at ${PR.crypto.capUsd}.{' '}
        {PR.app.rate === 0 ? <span className="font-medium text-good">Money Moves app payments are free.</span> : <>Money Moves app {pct(PR.app.rate)}.</>}
      </p>
    </Field>
  )
}

/* ─── Create an outlet ─────────────────────────────────────────────── */

function CreateOutlet({
  open,
  onClose,
  onPoster,
  initial,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onPoster: (o: PosterOutlet) => void
  initial?: StoreOutlet
  onSave?: (o: StoreOutlet) => void
}) {
  const { business, mode, setDestination } = useSession()
  const pay = usePayOptions(initial && { methods: initial.methods, accept: initial.accept, dest: initial.destination, bankId: initial.bankId, mmId: initial.mmId })
  const basics = usePreviewBasics()
  const [done, setDone] = useState(false)
  const [f, setF] = useState(() => (initial ? { name: initial.name, location: initial.location, staff: initial.staff ?? '' } : { name: '', location: '', staff: '' }))
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'NGN')
  const [askName, setAskName] = useState(initial?.askName ?? true)
  const [feePayer, setFeePayer] = useState<FeePick>(initial?.feePayer ?? null)
  // Live: the address the API gave it.
  const [madeSlug, setMadeSlug] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // An outlet keeps its address for life - the poster on the counter depends on it.
  const slug = initial?.slug ?? madeSlug ?? (f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'my-store')
  const link = `${PAY_HOST}/o/${slug}`

  /** Live: create the outlet, or save the changes, through the API. */
  const saveLive = async () => {
    if (!business) return
    const path = `/businesses/${business.id}/outlets`
    const fields = {
      name: f.name.trim(),
      location: f.location.trim(),
      currency,
      methods: pay.methods.map((m) => METHOD_TO_API[m]),
      accept: pay.crypto ? pay.accept : null,
      destination: DEST_TO_API[pay.dest],
      bankAccountId: pay.savedBank ?? null,
      staffEmail: f.staff.trim() || null,
      askName,
      feePayer,
    }
    setBusy(true)
    setProblem('')
    try {
      if (initial) {
        await api('PATCH', `${path}/${initial.id}`, fields)
        await reload(path)
        close()
      } else {
        const r = await api<{ outlet: ApiOutlet }>('POST', path, { ...fields, mode: mode === 'live' ? 'LIVE' : 'TEST' })
        await reload(path)
        setMadeSlug(r.outlet.slug)
        setDone(true)
      }
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))

  const close = () => {
    onClose()
    setTimeout(() => {
      setDone(false)
      setMadeSlug(null)
      setProblem('')
      setF({ name: '', location: '', staff: '' })
      pay.reset()
    }, 150)
  }

  const submit = () => {
    const missing = !f.name.trim() ? 'Give the outlet a name.' : !f.location.trim() ? 'Say where it is.' : pay.missing()
    if (missing) return setProblem(missing)
    setProblem('')
    setDestination(pay.dest)
    if (LIVE) return void saveLive()
    if (initial) {
      onSave?.({ ...initial, name: f.name.trim(), location: f.location.trim(), currency, methods: pay.methods, accept: pay.accept, destination: pay.dest, bankId: pay.savedBank, mmId: pay.savedMm })
      close()
    } else setDone(true)
  }

  const preview: PreviewPayload = {
    kind: 'outlet',
    key: currency,
    brand: basics.brand,
    info: {
      ...previewLink(basics, pay, { slug, name: f.name.trim() || 'Your outlet', currency, amount: null, askName, feePayer }),
      outlet: { name: f.name.trim() || 'Your outlet', location: f.location.trim() },
    },
  }

  return (
    <BuilderPage open={open} onClose={close} back="Outlets" preview={done ? null : preview} previewWhat="QR code" previewUrl={link}>
      {done ? (
        <MadeIt title="Your outlet is live" sub="Print the poster for the counter, or share the link. Payments show up in Payments.">
          <div className="flex flex-col items-center gap-5 rounded-[12px] border border-line p-6">
            <Qr value={payUrl(`o/${slug}`)} size={168} logo />
            <div className="w-full">
              <CopyField value={link} />
            </div>
            <div className="text-center text-[12.5px] text-dim">
              {f.name} · {f.location} · settles to {DESTINATIONS[effectiveDest(business, pay.dest)].label.toLowerCase()}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              icon={<Download className="size-4" />}
              onClick={() => {
                onPoster({ name: f.name, location: f.location, slug, methods: pay.methods })
                close()
              }}
            >
              Counter poster
            </Button>
            <Button variant="primary" onClick={close}>
              Done
            </Button>
          </div>
        </MadeIt>
      ) : (
        <>
          <BuilderHead title={initial ? 'Edit outlet' : 'Create an outlet'} sub="A QR code for a counter. Customers scan it, type what they owe, and pay however you take payments." />

          <Eyebrow>The outlet</Eyebrow>
          <div className="space-y-3">
            <Field label="Outlet name" required>
              <Input value={f.name} onChange={set('name')} placeholder="Ikeja store, till 2" autoFocus />
            </Field>
            <Field label="Location" required hint="Printed on the counter poster, so branches never get mixed up.">
              <Input value={f.location} onChange={set('location')} placeholder="Ikeja, Lagos" />
            </Field>
          </div>

          <div className="my-7 h-px bg-line" />

          <MethodsChoice pay={pay} />
          <div className="mt-3 space-y-3">
            <CheckRow checked disabled hint="Every customer gives it, receipts and any refund go there.">
              Ask for email
            </CheckRow>
            <CheckRow checked={askName} onChange={setAskName} hint="For bank and crypto payments. The Money Moves app sends the payer's name itself.">
              Ask for name
            </CheckRow>
          </div>
          <div className="mt-6">
            <FeeChoice value={feePayer} onChange={setFeePayer} />
          </div>
          <div className="mt-6">
            <CurrencySelect value={currency} onChange={setCurrency} label="Customers type the amount in" />
          </div>

          <div className="mt-6 space-y-3">
            <SettleFold pay={pay} />
            <Fold label="Staff feed" value={f.staff.trim() || 'Nobody yet'}>
              <Field label="Staff who see its payments" optional hint="They get a live feed of payments at this till, nothing else.">
                <Input value={f.staff} onChange={set('staff')} placeholder="cashier@business.com" />
              </Field>
            </Fold>
            <Fold label="QR address" value={link}>
              <p className="text-[12.5px] leading-relaxed text-dim">
                {initial ? "An outlet keeps its address for life, so the poster on the counter never stops working." : "It's made from the name, and never changes once the outlet is made. The printed poster depends on it."}
              </p>
            </Fold>
          </div>

          <BuilderSubmit problem={problem}>
            <Button variant="primary" size="lg" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : initial ? 'Save changes' : 'Create outlet'}
            </Button>
          </BuilderSubmit>
        </>
      )}
    </BuilderPage>
  )
}
