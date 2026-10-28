/**
 * What more than one page shows the same way: the payments and settlements
 * tables, and the words for what's happened - to a business, to a payout.
 */
import { C } from '../ui'
import { placeOf, sourceOf, type Pay, type Settle } from './client'
import { Dim, naira, PayState, Ref, SettleState, Tag, When, type Column, type Tone } from './kit'

/**
 * The payments table. Across every business it leads with whose payment it is.
 * Compact is for a narrow column: the settlement folds under the status.
 */
export function paymentColumns({ business, compact }: { business?: boolean; compact?: boolean }): Column<Pay>[] {
  const who = (p: Pay) => p.payer?.name ?? p.customer.name ?? p.customer.email
  // Under the name: the email they typed (when the name came from the bank) and the checkout they paid through.
  const under = (p: Pay) => [p.customer.email !== who(p) ? p.customer.email : null, sourceOf(p)].filter(Boolean).join(' · ')
  return [
    ...(business
      ? [
          {
            key: 'business',
            head: 'Business',
            width: 'minmax(0,1.2fr)',
            cell: (p: Pay) => <span className="font-medium">{p.business?.name ?? '—'}</span>,
            phone: 'title' as const,
          },
        ]
      : []),
    {
      key: 'ref',
      head: 'Reference',
      width: compact ? '132px' : '168px',
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          <Ref>{p.ref}</Ref>
          {p.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
        </span>
      ),
      phone: business ? 'meta' : 'title',
    },
    {
      key: 'customer',
      head: 'Customer',
      width: 'minmax(0,1.3fr)',
      cell: (p) => (
        <div className="min-w-0">
          <div className="truncate">{who(p) ?? <Dim>No details</Dim>}</div>
          {under(p) && (
            <div className="truncate text-[12px]" style={{ color: C.dim }}>
              {under(p)}
            </div>
          )}
        </div>
      ),
      phone: 'sub',
    },
    {
      key: 'amount',
      head: 'Amount',
      width: '120px',
      align: 'right',
      cell: (p) => {
        const short = p.receivedNgn != null && p.receivedNgn < p.amountNgn
        return (
          <div>
            <div className="font-medium tabular-nums">{naira(p.receivedNgn ?? p.amountNgn)}</div>
            {short && (
              <div className="text-[11.5px]" style={{ color: C.amber }}>
                {naira(p.amountNgn - (p.receivedNgn ?? 0))} short
              </div>
            )}
          </div>
        )
      },
    },
    {
      key: 'status',
      head: 'Status',
      width: '120px',
      cell: (p) => (
        <div>
          <PayState status={p.status} />
          {compact && p.settlement && p.settlement.status !== 'SETTLED' && (
            <div className="text-[11.5px]" style={{ color: p.settlement.status === 'FAILED' || p.settlement.stuck ? C.red : C.dim }}>
              payout {p.settlement.stuck ? 'stuck' : p.settlement.status.toLowerCase()}
            </div>
          )}
        </div>
      ),
      phone: 'meta',
    },
    ...(compact
      ? []
      : [
          {
            key: 'settlement',
            head: 'Settlement',
            width: '104px',
            cell: (p: Pay) => (p.settlement ? <SettleState s={p.settlement} /> : <Dim>—</Dim>),
            phone: 'meta' as const,
          },
        ]),
    { key: 'when', head: 'Date', width: '80px', cell: (p) => <span style={{ color: C.muted }}><When at={p.paidAt ?? p.createdAt} /></span>, phone: 'meta' },
  ]
}

/** Payments that want a person: short, or paid with a payout that didn't land. */
export const paymentFlag = (p: Pay): Tone | undefined =>
  p.status === 'UNDERPAID' ? 'warn' : p.settlement && (p.settlement.status === 'FAILED' || p.settlement.stuck) ? 'bad' : p.settlement?.status === 'HELD' ? 'warn' : undefined

export function settlementColumns({ business, compact }: { business?: boolean; compact?: boolean }): Column<Settle>[] {
  return [
    ...(business
      ? [
          {
            key: 'business',
            head: 'Business',
            width: 'minmax(0,1.2fr)',
            cell: (s: Settle) => <span className="font-medium">{s.business?.name ?? '—'}</span>,
            phone: 'title' as const,
          },
        ]
      : []),
    {
      key: 'ref',
      head: 'Reference',
      width: compact ? '150px' : '176px',
      cell: (s) => (
        <span className="inline-flex items-center gap-2">
          <Ref>{s.ref}</Ref>
          {s.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
        </span>
      ),
      phone: business ? 'meta' : 'title',
    },
    {
      key: 'to',
      head: 'To',
      width: 'minmax(0,1.3fr)',
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate">{placeOf(s)}</div>
          {(s.failureReason || s.toName || s.accountName) && (
            <div className="truncate text-[12px]" style={{ color: s.failureReason ? C.red : C.dim }}>
              {s.failureReason ?? s.toName ?? s.accountName}
            </div>
          )}
        </div>
      ),
      phone: 'sub',
    },
    {
      key: 'amount',
      head: 'Amount',
      width: '116px',
      align: 'right',
      cell: (s) => (
        <div>
          <div className="font-medium tabular-nums">{naira(s.amountNgn)}</div>
          <div className="text-[11.5px]" style={{ color: C.dim }}>
            fee {naira(s.feeNgn)}
          </div>
        </div>
      ),
    },
    { key: 'status', head: 'Status', width: '104px', cell: (s) => <SettleState s={s} />, phone: 'meta' },
    { key: 'when', head: 'Date', width: '80px', cell: (s) => <span style={{ color: C.muted }}><When at={s.settledAt ?? s.createdAt} /></span>, phone: 'meta' },
  ]
}

export const settlementFlag = (s: Settle): Tone | undefined => (s.status === 'FAILED' || s.stuck ? 'bad' : s.status === 'HELD' || s.status === 'REVIEW' ? 'warn' : undefined)

/* ─── What happened to a payout ────────────────────────────────────── */

export const EVENT_WORDS: Record<string, string> = {
  created: 'Created',
  review: 'Waiting for review',
  approved: 'Approved and sent to the rail',
  sent: 'Handed to the rail',
  send_unclear: "Sent - the rail's answer didn't come back",
  settled: 'Delivered',
  failed: 'Failed',
  checked: 'Checked with the rail',
  resent: 'Sent again',
  marked_settled: 'Marked delivered by hand',
  note: 'Note',
}

export function eventDetail(kind: string, d: Record<string, unknown> | null): string {
  if (!d) return ''
  if (kind === 'failed') return String(d.reason ?? '')
  if (kind === 'checked') return `The rail says: ${String(d.answer ?? '').toLowerCase()}${d.reason ? ` - ${d.reason}` : ''}`
  if (kind === 'sent') return [d.ref, d.to].filter(Boolean).join(' → ')
  if (kind === 'resent') return `New reference ${d.ref}${d.to ? ` → ${d.to}` : ''}`
  if (kind === 'marked_settled') return [d.reference, d.note].filter(Boolean).join(' · ')
  if (kind === 'note') return String(d.note ?? '')
  if (kind === 'created') return [d.status, d.destination].filter(Boolean).map((x) => String(x).toLowerCase().replace(/_/g, ' ')).join(' · ')
  if (kind === 'settled') return String(d.note ?? '')
  if (kind === 'review' && d.reason === 'daily_limit') return `Past the business's daily limit of ₦${Number(d.dailyLimitNgn ?? 0).toLocaleString()} (₦${Number(d.takenTodayNgn ?? 0).toLocaleString()} taken today). A person checks it before it goes. The business sees it as on its way.`
  if (kind === 'review' && d.reason === 'deactivated') return 'The business is deactivated - a person decides whether this goes out. The business sees it as on its way.'
  if (kind === 'review' && d.reason === 'overpaid') return `The customer sent ₦${Number(d.receivedNgn ?? 0).toLocaleString()} for a ₦${Number(d.askedNgn ?? 0).toLocaleString()} payment. A person checks it before it goes: pay it out, or refund the extra. The business sees it as on its way.`
  if (kind === 'review' && d.limitUsd != null) return `Over $${Number(d.limitUsd).toLocaleString()}. A person checks payouts this big before they go. The business sees it as on its way.`
  if (kind === 'review') return `Over ₦${Number(d.limitNgn ?? 0).toLocaleString()}. A person checks payouts this big before they go. The business sees it as on its way.`
  if (kind === 'approved') return String(d.to ?? '')
  return ''
}

export const eventTone = (kind: string): Tone | undefined =>
  kind === 'failed' ? 'bad' : kind === 'settled' || kind === 'marked_settled' ? 'good' : kind === 'send_unclear' || kind === 'review' ? 'warn' : kind === 'note' || kind === 'approved' ? 'info' : undefined

/* ─── What happened to a business ──────────────────────────────────── */

export const ACTION_WORDS: Record<string, string> = {
  business_created: 'Business created',
  signed_up: 'Signed up',
  bank_account_added: 'Bank account added',
  bank_account_removed: 'Bank account removed',
  bank_account_default: 'Default bank account changed',
  link_created: 'Payment link created',
  link_updated: 'Payment link changed',
  link_deleted: 'Payment link deleted',
  invoice_created: 'Invoice saved as a draft',
  invoice_sent: 'Invoice sent',
  invoice_reminded: 'Invoice reminder sent',
  invoice_voided: 'Invoice cancelled',
  outlet_created: 'Outlet created',
  outlet_updated: 'Outlet changed',
  outlet_deleted: 'Outlet deleted',
  settlement_chain_changed: 'Crypto settlement chain changed',
  document_uploaded: 'Document uploaded',
  document_removed: 'Document removed',
  identity_started: 'Identity check started',
  application_submitted: 'Application submitted',
  admin_status_changed: 'Status changed',
  admin_business_edited: 'Details edited',
  admin_bank_approved: 'Bank account approved',
  admin_bank_declined: 'Bank account turned down',
  admin_settlement_resent: 'Settlement sent again',
  admin_settlement_approved: 'Payout approved after review',
  admin_settlement_marked_settled: 'Settlement marked delivered',
  admin_document_viewed: 'Document opened',
  admin_document_accepted: 'Document accepted',
  admin_document_rejected: 'Document rejected',
  admin_application_review: 'Review started',
  admin_application_approve: 'Application approved',
  admin_application_reject: 'Application turned down',
  admin_application_changes: 'Changes asked for',
}

export const DOC_LABEL: Record<string, string> = {
  cert: 'Certificate',
  memart: 'Memorandum and articles',
  status: 'Status report',
  constitution: 'Constitution',
  address: 'Proof of business address',
  proofOfAddress: "Representative's proof of address",
}

const STATUS_WORD: Record<string, string> = { UNVERIFIED: 'Unverified', IN_REVIEW: 'In review', VERIFIED: 'Verified', SUSPENDED: 'Deactivated' }
const FIELD_WORD: Record<string, string> = { name: 'name', kind: 'kind', country: 'country', adminNote: 'notes', feeRateBps: 'fee rate', feeCapKobo: 'fee cap' }
const OUTLET_FIELD: Record<string, string> = { staffEmail: 'staff', bankAccountId: 'bank account', active: 'on or off', methods: 'ways to pay', destination: 'where it settles' }

export const actionWord = (action: string) => ACTION_WORDS[action] ?? action.replace(/^admin_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export function activityDetail(action: string, d: Record<string, unknown> | null): string {
  if (!d) return ''
  const s = (v: unknown) => (v == null ? '' : String(v))
  if (action === 'admin_status_changed') return `${STATUS_WORD[s(d.from)] ?? s(d.from)} → ${STATUS_WORD[s(d.to)] ?? s(d.to)}${d.reason ? ` · ${s(d.reason)}` : ''}`
  if (action === 'admin_business_edited') {
    const fields = ((d.fields as string[] | undefined) ?? []).map((f) => FIELD_WORD[f] ?? f).join(', ')
    return `${fields}${d.to ? ` · now "${s(d.to)}"` : ''}`
  }
  if (action.includes('bank')) return [d.bank, d.last4 ? `••${s(d.last4)}` : null, d.name, d.nameMatches === false ? "name didn't match" : null].filter(Boolean).map(s).join(' · ')
  if (action.startsWith('invoice_')) return [d.number, d.mode ? s(d.mode).toLowerCase() : null, d.emailed === true ? 'emailed' : d.emailed === false && action !== 'invoice_created' ? 'not emailed - a test invoice' : null].filter(Boolean).map(s).join(' · ')
  if (action.startsWith('outlet_'))
    return [d.slug ? `/o/${s(d.slug)}` : null, d.mode ? s(d.mode).toLowerCase() : null, Array.isArray(d.fields) ? `changed ${(d.fields as string[]).map((f) => OUTLET_FIELD[f] ?? f).join(', ')}` : null].filter(Boolean).join(' · ')
  if (action.startsWith('link_')) return [d.slug ? `/${s(d.slug)}` : null, d.mode ? s(d.mode).toLowerCase() : null, Array.isArray(d.fields) ? `changed ${(d.fields as string[]).join(', ')}` : null].filter(Boolean).join(' · ')
  if (action.startsWith('admin_settlement')) return [d.previousRef ? `${s(d.previousRef)} → ${s(d.ref)}` : d.ref, d.reference].filter(Boolean).map(s).join(' · ')
  if (action.includes('document')) return [DOC_LABEL[s(d.kind)] ?? d.kind, d.note].filter(Boolean).map(s).join(' · ')
  if (action.startsWith('admin_application')) return s(d.note)
  if (action === 'settlement_chain_changed') return s(d.settleChain).charAt(0) + s(d.settleChain).slice(1).toLowerCase()
  if (action === 'business_created') return [d.name, d.kind === 'INDIVIDUAL' ? 'just me' : d.kind ? 'registered' : null].filter(Boolean).map(s).join(' · ')
  return ''
}

/** Who did it: the team (marked "(admin)" by the API) or the business. */
export const byTeam = (by: string) => by.endsWith('(admin)')
