/**
 * One business, on its own page.
 *
 * The head says who it is and what state it's in, and holds the levers for
 * that state. Overview answers "is this business all right": what it has
 * taken and where that went, anything stuck, and - beside it - its details,
 * its fee, its verification and the team's notes, each changed where it's
 * shown. Every other tab is the whole of one thing.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { C } from '../ui'
import {
  biz,
  BizError,
  CHAIN,
  DESTINATION,
  KIND,
  METHOD,
  ROLE,
  STRUCTURE,
  useLoad,
  type Activity,
  type Bank,
  type BizKind,
  type BizStatus,
  type BusinessDetail,
  type DetailChangeView,
  type IdStatus,
  type InvoiceRow,
  type LinkRow,
  type Member,
  type MoneySummary,
  type OutletRow,
  type Paged,
  type Pay,
  type Settle,
  type Way,
} from './client'
import {
  ActionPanel,
  AppState,
  Bars,
  BizState,
  bizWord,
  Button,
  clock,
  Confirm,
  Copy,
  dayDate,
  Dim,
  Facts,
  Field,
  Figures,
  IdLine,
  LinkText,
  IdState,
  Input,
  ListLoading,
  naira,
  Notice,
  PageHead,
  PageLoading,
  Pager,
  Panel,
  PasswordInput,
  plural,
  Problem,
  Ref,
  Said,
  SearchBox,
  Segmented,
  Select,
  State,
  Table,
  Tabs,
  Tag,
  Textarea,
  TextButton,
  useAction,
  useTyped,
  When,
  type Column,
  type Tone,
} from './kit'
import { useRecord } from './nav'
import { actionWord, activityDetail, byTeam, paymentColumns, paymentFlag, settlementColumns, settlementFlag } from './tables'
import { ApplicationReview } from './Application'
import { InfoRequests } from './Requests'

type TabId = 'overview' | 'payments' | 'settlements' | 'checkouts' | 'banks' | 'team' | 'verification' | 'activity'
const TAB_IDS: TabId[] = ['overview', 'payments', 'settlements', 'checkouts', 'banks', 'team', 'verification', 'activity']
type Go = (t: TabId, extra?: Record<string, string | null>) => void
type Biz = BusinessDetail['business']

const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()
const countryName = (code: string) => {
  try {
    return regions?.of(code) ?? code
  } catch {
    return code
  }
}

const ID_WORDS: Record<IdStatus, string> = {
  APPROVED: 'Identity verified.',
  IN_REVIEW: 'The identity check is still under review.',
  PENDING: 'Identity check started, not finished.',
  DECLINED: 'The identity check was declined.',
}

export function BusinessPage({ id }: { id: string }) {
  // Payouts on their way: read again now and then, so the figures catch up by themselves.
  const { data, error, loading, reload } = useLoad<BusinessDetail>(`/businesses/${id}`, {
    every: (d) => (d.money.live.moving.count + d.money.test.moving.count > 0 ? 8000 : null),
  })
  const { params, setView, open } = useRecord()
  const [acting, setActing] = useState<BizStatus | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 8000)
    return () => clearTimeout(t)
  }, [flash])

  if (loading && !data) return <PageLoading />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />

  const b = data.business
  // "links" was this tab's name before invoices and outlets joined it.
  const asked = (params.get('tab') === 'links' ? 'checkouts' : params.get('tab')) as TabId | null
  const tab: TabId = asked && TAB_IDS.includes(asked) ? asked : 'overview'
  const go: Go = (t, extra = {}) => setView({ tab: t === 'overview' ? null : t, link: null, invoice: null, outlet: null, sv: null, ...extra })
  const app = data.application
  const appWaiting = !!app && (app.status === 'SUBMITTED' || app.status === 'IN_REVIEW')
  const counts = (m: MoneySummary) => ({ pays: m.paid.count + m.short.count + m.open, settles: m.settled.count + m.moving.count + m.review.count + m.held.count + m.failed.count })
  const live = counts(data.money.live)
  const test = counts(data.money.test)

  return (
    <div>
      <PageHead
        title={b.name}
        meta={[<BizState status={b.status} />, app?.structure ? (STRUCTURE[app.structure] ?? KIND[b.kind]) : KIND[b.kind], countryName(b.country), `Joined ${dayDate(b.createdAt)}`]}
        actions={
          <>
            {appWaiting && (
              <Button tone="primary" onClick={() => go('verification')}>
                Review application
              </Button>
            )}
            {statusChoices(b.status, appWaiting).map((c) => (
              <Button key={c.to} tone={c.tone} onClick={() => setActing(acting === c.to ? null : c.to)}>
                {c.label}
              </Button>
            ))}
          </>
        }
      >
        <IdLine
          items={[
            ['Merchant ID', <Copy text={b.merchantId} />],
            !!b.referral?.referredBy && ['Referred by', <LinkText onClick={() => open('business', b.referral!.referredBy!.id, { from: b.name })}>{b.referral.referredBy.name}</LinkText>],
            !!b.referral?.referred && ['Referred', <span style={{ color: C.text }}>{b.referral.referred} {b.referral.referred === 1 ? 'business' : 'businesses'}</span>],
            b.owner && [
              'Owner',
              <span style={{ color: C.text }}>
                {b.owner.name ? `${b.owner.name} · ` : ''}
                {b.owner.email}
              </span>,
            ],
            ['ID', <Copy text={b.id}>{`${b.id.slice(0, 10)}…`}</Copy>],
          ]}
        />
      </PageHead>

      {flash && (
        <p className="-mt-1 mb-4 text-[13px]" style={{ color: C.lime }}>
          {flash}
        </p>
      )}
      {acting && (
        <StatusChange
          b={b}
          to={acting}
          onClose={() => setActing(null)}
          onDone={(text) => {
            setActing(null)
            setFlash(text)
          }}
        />
      )}
      {data.detailChange && (
        <DetailChangePanel
          name={b.name}
          c={data.detailChange}
          onDone={(text) => {
            setFlash(text)
            void reload()
          }}
        />
      )}
      {b.status === 'SUSPENDED' && !acting && (
        <div className="mb-5">
          <Notice
            tone="bad"
            title={
              <>
                Deactivated <When at={b.statusChangedAt} />
                {b.statusChangedBy ? ` by ${b.statusChangedBy}` : ''}
              </>
            }
          >
            {b.statusReason ?? 'No reason was written down.'}
          </Notice>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={(t) => go(t)}
        items={[
          ['overview', 'Overview'],
          ['payments', 'Payments', live.pays + test.pays],
          ['settlements', 'Settlements', live.settles + test.settles],
          ['checkouts', 'Checkouts', data.links.filter((l) => !l.deleted).length + data.invoices.filter((i) => i.status !== 'VOID').length + data.outlets.filter((o) => !o.deleted).length],
          ['banks', 'Bank accounts', data.bankAccounts.filter((x) => !x.removedAt).length],
          ['team', 'Team', data.members.length],
          ['verification', 'Verification'],
          ['activity', 'Activity'],
        ]}
      />

      <div className="pt-5">
        {tab === 'overview' && <OverviewTab data={data} go={go} />}
        {tab === 'payments' && <PaymentsTab businessId={b.id} name={b.name} links={data.links} invoices={data.invoices} outlets={data.outlets} />}
        {tab === 'settlements' && <SettlementsTab businessId={b.id} name={b.name} />}
        {tab === 'checkouts' && <CheckoutsTab data={data} go={go} />}
        {tab === 'banks' && <BanksTab b={b} banks={data.bankAccounts} />}
        {tab === 'team' && <TeamTab members={data.members} />}
        {tab === 'verification' && (
          <div className="space-y-5">
            <InfoRequests businessId={b.id} name={b.name} />
            <ApplicationReview businessId={b.id} name={b.name} />
          </div>
        )}
        {tab === 'activity' && <ActivityTab items={data.activity} />}
      </div>
    </div>
  )
}

/* ─── Status ───────────────────────────────────────────────────────── */

type Choice = { to: BizStatus; label: string; tone: 'primary' | 'plain' | 'danger' }

function statusChoices(status: BizStatus, appWaiting: boolean): Choice[] {
  if (status === 'SUSPENDED')
    return [
      { to: 'VERIFIED', label: 'Reactivate as verified', tone: 'plain' },
      { to: 'UNVERIFIED', label: 'Reactivate unverified', tone: 'plain' },
    ]
  const out: Choice[] = []
  if (status !== 'VERIFIED') out.push({ to: 'VERIFIED', label: 'Verify', tone: appWaiting ? 'plain' : 'primary' })
  if (status === 'UNVERIFIED') out.push({ to: 'IN_REVIEW', label: 'Mark in review', tone: 'plain' })
  if (status !== 'UNVERIFIED') out.push({ to: 'UNVERIFIED', label: status === 'VERIFIED' ? 'Unverify' : 'Back to unverified', tone: 'plain' })
  out.push({ to: 'SUSPENDED', label: 'Deactivate', tone: 'danger' })
  return out
}

function StatusChange({ b, to, onClose, onDone }: { b: Biz; to: BizStatus; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const reopening = b.status === 'SUSPENDED'
  const needsPassword = to === 'VERIFIED' || to === 'SUSPENDED' || reopening
  const needsReason = to === 'SUSPENDED'
  const copy: Record<BizStatus, { title: string; sub: string; button: string }> = {
    VERIFIED: reopening
      ? {
          title: `Reactivate ${b.name} as verified`,
          sub: 'Its checkouts open again straight away, live ones included, and it can make changes. Payouts held while it was deactivated stay in To review until someone releases them.',
          button: 'Reactivate as verified',
        }
      : {
          title: `Verify ${b.name}`,
          sub: 'It can take live payments straight away. The usual way in is approving its application - verifying here skips that, so say why.',
          button: 'Verify',
        },
    IN_REVIEW: { title: `Mark ${b.name} in review`, sub: "Tells the team someone's on it. Nothing changes for the business.", button: 'Mark in review' },
    UNVERIFIED: reopening
      ? {
          title: `Reactivate ${b.name} unverified`,
          sub: 'Test mode works again and it can make changes; live payments wait until it is verified. Held payouts stay in To review.',
          button: 'Reactivate unverified',
        }
      : { title: `Move ${b.name} back to unverified`, sub: 'Live payments stop at once. Test mode carries on, and money already paid still settles.', button: 'Move to unverified' },
    SUSPENDED: {
      title: `Deactivate ${b.name}`,
      sub: "Every checkout stops at once, live and test, and the business can't change anything or move money - it can still sign in and see its history. Live payouts it's owed wait in To review for your team to release. Nothing is deleted. The business sees that it's deactivated - never the reason.",
      button: 'Deactivate business',
    },
  }
  const c = copy[to]
  return (
    <div className="mb-5">
      <ActionPanel title={c.title} sub={c.sub} danger={to === 'SUSPENDED'}>
        <Field label={needsReason ? 'Why - for the team, the business never sees it' : 'Note for the team (optional)'}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        <Confirm>
          {needsPassword && <PasswordInput value={password} onChange={setPassword} />}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone={to === 'SUSPENDED' ? 'danger' : 'primary'}
            disabled={busy || (needsPassword && !password) || (needsReason && reason.trim().length < 3)}
            onClick={async () => {
              const ok = await run(
                () => biz(`/businesses/${b.id}/status`, { method: 'POST', body: { status: to, reason: reason.trim() || undefined, password: password || undefined } }),
                '',
              )
              if (ok) onDone(`Done - ${b.name} is now ${bizWord(to).toLowerCase()}.`)
            }}
          >
            {busy ? 'Saving…' : c.button}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

/* ─── Overview ─────────────────────────────────────────────────────── */

function notSettled(m: MoneySummary) {
  const bits = [m.moving.count && `${m.moving.count} on the way`, m.review.count && `${m.review.count} to review`, m.stuck && `${m.stuck} stuck`, m.held.count && `${m.held.count} held`, m.failed.count && `${m.failed.count} failed`].filter(Boolean)
  return bits.length ? bits.join(' · ') : 'Nothing waiting'
}

function OverviewTab({ data, go }: { data: BusinessDetail; go: Go }) {
  const { open } = useRecord()
  const b = data.business
  const [mode, setMode] = useState<'LIVE' | 'TEST'>(data.money.live.paid.count > 0 || data.money.test.paid.count === 0 ? 'LIVE' : 'TEST')
  const m = mode === 'LIVE' ? data.money.live : data.money.test
  const live = data.money.live
  const app = data.application
  const waitingBanks = data.bankAccounts.filter((x) => !x.removedAt && !x.nameMatches && !x.reviewedAt)
  const checkedBanks = data.bankAccounts.filter((x) => !x.removedAt && x.nameMatches)
  const trouble = live.failed.count + live.held.count + live.stuck
  const from = b.name

  const notices: ReactNode[] = []
  if (app && (app.status === 'SUBMITTED' || app.status === 'IN_REVIEW'))
    notices.push(
      <Notice
        key="app"
        tone="warn"
        title={app.status === 'SUBMITTED' ? 'Application waiting for review' : 'Application in review'}
        action={
          <Button small onClick={() => go('verification')}>
            Review
          </Button>
        }
      >
        Submitted <When at={app.submittedAt} />. {app.documents.required ? `${app.documents.uploaded} of ${app.documents.required} documents. ` : ''}
        {app.identity ? ID_WORDS[app.identity.status] : 'No identity check yet.'}
      </Notice>,
    )
  if (waitingBanks.length) {
    const w = waitingBanks[0]!
    notices.push(
      <Notice
        key="banks"
        tone="warn"
        title={waitingBanks.length === 1 ? 'A bank account needs a check' : `${waitingBanks.length} bank accounts need a check`}
        action={
          <Button small onClick={() => go('banks')}>
            Check
          </Button>
        }
      >
        The bank calls {w.bankName} ••{w.accountNumber.slice(-4)} “{w.accountName}”. Payouts here must be in the name of {b.nameOnRecord ? `“${b.nameOnRecord}”` : 'the business'}.
      </Notice>,
    )
  }
  if (trouble)
    notices.push(
      <Notice
        key="settle"
        tone="bad"
        title={`${plural(trouble, 'live settlement')} didn't land`}
        action={
          <Button small onClick={() => go('settlements', { sv: 'attention' })}>
            Open
          </Button>
        }
      >
        {[live.failed.count && `${live.failed.count} failed`, live.held.count && `${live.held.count} held - nowhere to send`, live.stuck && `${live.stuck} stuck sending`].filter(Boolean).join(' · ')}
      </Notice>,
    )
  if (live.review.count)
    notices.push(
      <Notice
        key="review"
        tone="warn"
        title={`${plural(live.review.count, 'payout')} waiting for review`}
        action={
          <Button small onClick={() => go('settlements', { sv: 'review' })}>
            Review
          </Button>
        }
      >
        {naira(live.review.amountNgn)} in all, each bigger than the review limit. The business sees them as on their way.
      </Notice>,
    )
  if (b.status === 'VERIFIED' && checkedBanks.length === 0)
    notices.push(
      <Notice key="nobank" tone="warn" title="No checked bank account">
        Live payments are held until it adds one in its own name.
      </Notice>,
    )
  if (app?.status === 'CHANGES_REQUESTED')
    notices.push(
      <Notice
        key="changes"
        tone="info"
        title={
          <>
            Waiting on the business - changes asked <When at={app.reviewedAt} />
          </>
        }
      >
        {app.decisionNote}
      </Notice>,
    )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
      <div className="space-y-5 min-w-0">
        {notices.length > 0 && <div className="space-y-3">{notices}</div>}
        <Panel title="Money" action={<Segmented value={mode} onChange={setMode} items={[['LIVE', 'Live'], ['TEST', 'Test']]} />} flush>
          <Figures
            items={[
              { label: 'Paid to it', value: naira(m.paid.volumeNgn), sub: plural(m.paid.count, 'payment') },
              { label: 'Our fees', value: naira(m.paid.feesNgn), sub: m.paid.volumeNgn ? `${((m.paid.feesNgn / m.paid.volumeNgn) * 100).toFixed(2)}% of takings` : 'Nothing yet' },
              { label: 'Settled', value: naira(m.settled.amountNgn), sub: plural(m.settled.count, 'payout') },
              {
                label: 'Not settled yet',
                value: naira(m.moving.amountNgn + m.review.amountNgn + m.held.amountNgn + m.failed.amountNgn),
                sub: notSettled(m),
                tone: m.failed.count || m.stuck ? 'bad' : m.held.count || m.review.count ? 'warn' : undefined,
              },
            ]}
          />
          <div className="px-4 py-4" style={{ borderTop: `1px solid ${C.line}` }}>
            <Bars days={m.daily} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-[12.5px]" style={{ color: C.dim, borderTop: `1px solid ${C.lineSoft}` }}>
            <span>Last paid {m.paid.lastPaidAt ? <When at={m.paid.lastPaidAt} /> : 'never'}</span>
            {m.short.count > 0 && <span style={{ color: C.amber }}>{plural(m.short.count, 'payment')} arrived short</span>}
            <span>{m.open.toLocaleString()} waiting to be paid</span>
            <span>{m.expired.toLocaleString()} expired</span>
          </div>
        </Panel>
        <Panel title="Latest payments" action={<TextButton onClick={() => go('payments')}>View all</TextButton>} flush>
          <Table rows={data.payments} columns={paymentColumns({ compact: true })} rowKey={(p) => p.id} flag={paymentFlag} onRow={(p) => open('payment', p.id, { from })} empty="No payments yet." />
        </Panel>
        <Panel title="Latest settlements" action={<TextButton onClick={() => go('settlements')}>View all</TextButton>} flush>
          <Table rows={data.settlements} columns={settlementColumns({ compact: true })} rowKey={(s) => s.id} flag={settlementFlag} onRow={(s) => open('settlement', s.id, { from })} empty="No settlements yet." />
        </Panel>
      </div>
      <aside className="space-y-5 min-w-0">
        <DetailsPanel data={data} />
        <FeePanel b={b} />
        <LimitPanel b={b} />
        <OwnLimitsPanel b={b} />
        <DirectPanel b={b} />
        <TwoStepResetPanel email={b.owner?.email ?? ''} />
        <VerificationPanel app={app} onOpen={() => go('verification')} />
        <NotesPanel b={b} />
      </aside>
    </div>
  )
}

function DetailsPanel({ data }: { data: BusinessDetail }) {
  const b = data.business
  const app = data.application
  const [editing, setEditing] = useState(false)
  return (
    <Panel title="Details" action={!editing && <TextButton onClick={() => setEditing(true)}>Edit</TextButton>}>
      {editing ? (
        <EditDetails b={b} onClose={() => setEditing(false)} />
      ) : (
        <Facts
          rows={[
            ['Name', b.name],
            !!app?.legalName && app.legalName.trim().toLowerCase() !== b.name.trim().toLowerCase() && ['Registered as', app.legalName],
            ['Kind', KIND[b.kind]],
            !!app?.structure && ['Structure', STRUCTURE[app.structure] ?? app.structure],
            ['Country', countryName(b.country)],
            ['Payout name', b.nameOnRecord ?? <span style={{ color: C.amber }}>None on record yet</span>],
            !!b.settlement && ['Settles to', <SettlesTo b={b} />],
            ['Settle chain', `${CHAIN[b.settleChain] ?? b.settleChain}, as USDC`],
            ['Last changed', <When at={b.updatedAt} />],
          ]}
        />
      )}
    </Panel>
  )
}

/** Where the business's money goes now, and the live checkouts that send it somewhere else. */
function SettlesTo({ b }: { b: Biz }) {
  const s = b.settlement!
  const chain = CHAIN[b.settleChain] ?? b.settleChain
  const main =
    s.now === 'BANK'
      ? s.bank
        ? `${s.bank.bankName} ••${s.bank.last4}`
        : 'Bank account (none checked yet)'
      : s.now === 'MONEY_MOVES'
        ? s.moneyMoves
          ? `Money Moves @${s.moneyMoves.username}`
          : 'Money Moves account'
        : s.walletMade
          ? `Business wallet, USDC on ${chain}`
          : 'Business wallet (not made yet)'
  const elsewhere = (Object.entries(s.checkouts) as [keyof typeof DESTINATION, number][]).filter(([d, n]) => d !== s.now && n > 0)
  return (
    <span>
      {main}
      <span className="block text-[12px]" style={{ color: C.dim }}>
        {s.justMe
          ? 'Just me: always the business wallet'
          : elsewhere.length
            ? `Default. Some live checkouts pick their own: ${elsewhere.map(([d, n]) => `${n} to ${DESTINATION[d].toLowerCase()}`).join(', ')}`
            : s.apiChoice
              ? 'Chosen by the business'
              : 'Default: first of a checked bank, Money Moves, the wallet'}
      </span>
    </span>
  )
}

function EditDetails({ b, onClose }: { b: Biz; onClose: () => void }) {
  const [name, setName] = useState(b.name)
  const [kind, setKind] = useState<BizKind>(b.kind)
  const [country, setCountry] = useState(b.country)
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const body: Record<string, unknown> = {}
  if (name.trim() !== b.name) body.name = name.trim()
  if (kind !== b.kind) body.kind = kind
  if (country.trim().toUpperCase() !== b.country) body.country = country.trim().toUpperCase()
  const needsPassword = 'name' in body || 'kind' in body
  const any = Object.keys(body).length > 0
  return (
    <div className="space-y-3">
      <Field label="Business name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_76px] gap-3">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as BizKind)}>
            <option value="REGISTERED">Registered business</option>
            <option value="INDIVIDUAL">Just me</option>
          </Select>
        </Field>
        <Field label="Country">
          <Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} />
        </Field>
      </div>
      {needsPassword && (
        <>
          <p className="text-[12px] leading-relaxed" style={{ color: C.dim }}>
            A new name or kind changes whose bank accounts match - every account is checked again.
          </p>
          <PasswordInput full value={password} onChange={setPassword} />
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button small onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          small
          tone="primary"
          disabled={busy || !any || (needsPassword && !password)}
          onClick={async () => {
            if (await run(() => biz(`/businesses/${b.id}`, { method: 'PATCH', body: { ...body, password: password || undefined } }), 'Saved.')) onClose()
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {said && !said.ok && <Said {...said} />}
    </div>
  )
}

/** One way to pay: the rate that applies, whether it is this business's own, and who pays it. */
function FeeLine({ label, rate, cap, own, payer }: { label: string; rate: number; cap: string; own: boolean; payer?: 'BUSINESS' | 'CUSTOMER' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px]" style={{ color: C.muted }}>
          {label}
        </div>
        {payer && (
          <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
            {payer === 'CUSTOMER' ? 'Added on top, the customer pays it' : 'Taken from the settlement'}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[17px] font-semibold tabular-nums" style={{ color: C.text }}>
          {rate / 100}% <span className="text-[13px] font-normal" style={{ color: C.muted }}>up to {cap}</span>
        </div>
        {own && (
          <div className="mt-0.5 text-[12px]" style={{ color: C.lime }}>
            Set for this business
          </div>
        )}
      </div>
    </div>
  )
}

function FeePanel({ b }: { b: Biz }) {
  const f = b.fee
  const [editing, setEditing] = useState(false)
  const ownNaira = f.rateBps != null || f.capNgn != null
  const ownCrypto = f.cryptoRateBps != null || f.cryptoCapUsd != null
  return (
    <Panel title="Fees" action={!editing && <TextButton onClick={() => setEditing(true)}>Change</TextButton>}>
      {editing ? (
        <EditFee b={b} onClose={() => setEditing(false)} />
      ) : (
        <div className="divide-y" style={{ borderColor: C.line }}>
          <FeeLine label="Naira transfer" rate={f.rateBps ?? f.defaultRateBps} cap={naira(f.capNgn ?? f.defaultCapNgn)} own={ownNaira} payer={f.payer?.naira} />
          <FeeLine label="Stablecoins" rate={f.cryptoRateBps ?? f.defaultCryptoRateBps} cap={`$${(f.cryptoCapUsd ?? f.defaultCryptoCapUsd).toLocaleString()}`} own={ownCrypto} payer={f.payer?.crypto} />
          <FeeLine label="Money Moves app" rate={0} cap="free" own={false} />
          <div className="pt-2.5 text-[12px]" style={{ color: C.dim }}>
            Default {f.defaultRateBps / 100}% up to {naira(f.defaultCapNgn)} on naira, {f.defaultCryptoRateBps / 100}% up to ${f.defaultCryptoCapUsd} on stablecoins. The business chooses who pays.
          </div>
        </div>
      )}
    </Panel>
  )
}

function EditFee({ b, onClose }: { b: Biz; onClose: () => void }) {
  const f = b.fee
  const start = (n: number | null) => (n != null ? String(n) : '')
  const [rate, setRate] = useState(start(f.rateBps != null ? f.rateBps / 100 : null))
  const [cap, setCap] = useState(start(f.capNgn))
  const [cRate, setCRate] = useState(start(f.cryptoRateBps != null ? f.cryptoRateBps / 100 : null))
  const [cCap, setCCap] = useState(start(f.cryptoCapUsd))
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const custom = f.rateBps != null || f.capNgn != null || f.cryptoRateBps != null || f.cryptoCapUsd != null
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const save = async (useDefaults: boolean) => {
    const body = useDefaults
      ? { feeRateBps: null, feeCapNgn: null, cryptoRateBps: null, cryptoCapUsd: null, password }
      : {
          feeRateBps: rate.trim() === '' ? null : Math.round(Number(rate) * 100),
          feeCapNgn: num(cap),
          cryptoRateBps: cRate.trim() === '' ? null : Math.round(Number(cRate) * 100),
          cryptoCapUsd: num(cCap),
          password,
        }
    if (await run(() => biz(`/businesses/${b.id}`, { method: 'PATCH', body }), 'Saved.')) onClose()
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
        For payments from now on. Leave a box empty for the platform default. Money Moves app payments are free whatever you set here.
      </p>
      <div>
        <p className="mb-1.5 text-[12px] font-medium" style={{ color: C.muted }}>
          Naira transfer
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate, %">
            <Input value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(f.defaultRateBps / 100)} inputMode="decimal" />
          </Field>
          <Field label="Cap, ₦">
            <Input value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9]/g, ''))} placeholder={String(f.defaultCapNgn)} inputMode="numeric" />
          </Field>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[12px] font-medium" style={{ color: C.muted }}>
          Stablecoins
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate, %">
            <Input value={cRate} onChange={(e) => setCRate(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(f.defaultCryptoRateBps / 100)} inputMode="decimal" />
          </Field>
          <Field label="Cap, $">
            <Input value={cCap} onChange={(e) => setCCap(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(f.defaultCryptoCapUsd)} inputMode="decimal" />
          </Field>
        </div>
      </div>
      <PasswordInput full value={password} onChange={setPassword} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button small onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {custom && (
          <Button small disabled={busy || !password} onClick={() => void save(true)}>
            Use defaults
          </Button>
        )}
        <Button small tone="primary" disabled={busy || !password} onClick={() => void save(false)}>
          {busy ? 'Saving…' : 'Save fees'}
        </Button>
      </div>
      {said && !said.ok && <Said {...said} />}
    </div>
  )
}

/** Past this in a day, its live settlements wait for a person: its own limit, or the platform's for its age. */
function LimitPanel({ b }: { b: Biz }) {
  const r = b.risk
  const [editing, setEditing] = useState(false)
  const [limit, setLimit] = useState(r?.ownLimitNgn != null ? String(r.ownLimitNgn) : '')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  if (!r) return null
  const save = async (useDefault: boolean) => {
    const dailyLimitNgn = useDefault || limit.trim() === '' ? null : Number(limit)
    if (await run(() => biz(`/businesses/${b.id}`, { method: 'PATCH', body: { dailyLimitNgn, password } }), 'Saved.')) setEditing(false)
  }
  const pct = r.limitNgn > 0 ? Math.min(100, Math.round((r.takenTodayNgn / r.limitNgn) * 100)) : 0
  return (
    <Panel title="Daily limit" action={!editing && <TextButton onClick={() => setEditing(true)}>Change</TextButton>}>
      {editing ? (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
            Past this in a day, live settlements wait in To review. Leave it empty for the platform's default for a business its age.
          </p>
          <Field label="A day, ₦">
            <Input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ''))} placeholder={String(r.limitNgn)} inputMode="numeric" />
          </Field>
          <PasswordInput full value={password} onChange={setPassword} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button small onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            {r.ownLimitNgn != null && (
              <Button small disabled={busy || !password} onClick={() => void save(true)}>
                Use default
              </Button>
            )}
            <Button small tone="primary" disabled={busy || !password} onClick={() => void save(false)}>
              {busy ? 'Saving…' : 'Save limit'}
            </Button>
          </div>
          {said && !said.ok && <Said {...said} />}
        </div>
      ) : (
        <div>
          <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums" style={{ color: C.text }}>
            {naira(r.limitNgn)}
          </div>
          <div className="mt-0.5 text-[13px]" style={{ color: C.muted }}>
            a day. {naira(r.takenTodayNgn)} taken today.
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: C.raise }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? C.red : pct >= 75 ? C.amber : C.lime }} />
          </div>
          <div className="mt-3">
            <Tag tone={r.ownLimitNgn != null ? 'info' : undefined}>{r.ownLimitNgn != null ? 'Set for this business' : 'Platform default'}</Tag>
          </div>
        </div>
      )}
    </Panel>
  )
}

const WAYS: { id: Way; label: string }[] = [
  { id: 'naira', label: 'Bank transfer' },
  { id: 'crypto', label: 'Stablecoins' },
  { id: 'app', label: 'Money Moves app' },
]
const digits = (s: string) => s.replace(/[^0-9]/g, '')
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

/**
 * One live checkout's least and most for each way to pay, and the payout sizes
 * past which a person checks: this business's own, over the platform's on
 * Services. An empty box keeps the platform's. The business is never told.
 */
function OwnLimitsPanel({ b }: { b: Biz }) {
  const l = b.limits
  const [editing, setEditing] = useState(false)
  if (!l) return null
  const ownCheckout = WAYS.some((w) => l.own.checkout[w.id]?.minNgn != null || l.own.checkout[w.id]?.maxNgn != null)
  const ownReview = l.own.reviewNairaAboveNgn != null || l.own.reviewCryptoAboveUsd != null
  return (
    <Panel title="Checkout and payout limits" action={!editing && <TextButton onClick={() => setEditing(true)}>Change</TextButton>}>
      {editing ? (
        <EditOwnLimits b={b} onClose={() => setEditing(false)} />
      ) : (
        <div className="space-y-3 text-[13px]">
          <div className="space-y-1.5">
            {WAYS.map((w) => {
              const own = l.own.checkout[w.id]
              const set = own?.minNgn != null || own?.maxNgn != null
              return (
                <div key={w.id} className="flex items-baseline justify-between gap-3">
                  <span style={{ color: C.muted }}>{w.label}</span>
                  <span className="tabular-nums" style={{ color: set ? C.text : C.muted }}>
                    {naira(l.checkout[w.id].minNgn)} to {naira(l.checkout[w.id].maxNgn)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="space-y-1.5 border-t pt-3" style={{ borderColor: C.line }}>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ color: C.muted }}>Bank payouts checked above</span>
              <span className="tabular-nums" style={{ color: l.own.reviewNairaAboveNgn != null ? C.text : C.muted }}>{naira(l.review.nairaAboveNgn)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ color: C.muted }}>Crypto payouts checked above</span>
              <span className="tabular-nums" style={{ color: l.own.reviewCryptoAboveUsd != null ? C.text : C.muted }}>${l.review.cryptoAboveUsd.toLocaleString()}</span>
            </div>
          </div>
          <div>
            <Tag tone={ownCheckout || ownReview ? 'info' : undefined}>{ownCheckout || ownReview ? 'Some set for this business' : 'Platform defaults'}</Tag>
          </div>
        </div>
      )}
    </Panel>
  )
}

function EditOwnLimits({ b, onClose }: { b: Biz; onClose: () => void }) {
  const l = b.limits!
  const start = (n: number | null | undefined) => (n != null ? String(n) : '')
  const [box, setBox] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(WAYS.flatMap((w) => [[`${w.id}Min`, start(l.own.checkout[w.id]?.minNgn)], [`${w.id}Max`, start(l.own.checkout[w.id]?.maxNgn)]])),
    naira: start(l.own.reviewNairaAboveNgn),
    crypto: start(l.own.reviewCryptoAboveUsd),
  }))
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const put = (k: string, v: string) => setBox((x) => ({ ...x, [k]: v }))
  const save = async (useDefaults: boolean) => {
    const body = useDefaults
      ? { ownCheckout: null, reviewNairaAboveNgn: null, reviewCryptoAboveUsd: null, password }
      : {
          ownCheckout: Object.fromEntries(WAYS.map((w) => [w.id, { minNgn: numOrNull(box[`${w.id}Min`]), maxNgn: numOrNull(box[`${w.id}Max`]) }])),
          reviewNairaAboveNgn: numOrNull(box.naira),
          reviewCryptoAboveUsd: numOrNull(box.crypto),
          password,
        }
    if (await run(() => biz(`/businesses/${b.id}`, { method: 'PATCH', body }), 'Saved.')) onClose()
  }
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
        For this business only, higher or lower than Services. Leave a box empty to keep the platform's, shown greyed. Live checkouts only; the business is never told.
      </p>
      {WAYS.map((w) => (
        <div key={w.id} className="grid grid-cols-2 gap-3">
          <Field label={`${w.label}: least, ₦`}>
            <Input value={box[`${w.id}Min`]} onChange={(e) => put(`${w.id}Min`, digits(e.target.value))} placeholder={String(l.defaults.checkout[w.id].minNgn)} inputMode="numeric" />
          </Field>
          <Field label="Most, ₦">
            <Input value={box[`${w.id}Max`]} onChange={(e) => put(`${w.id}Max`, digits(e.target.value))} placeholder={String(l.defaults.checkout[w.id].maxNgn)} inputMode="numeric" />
          </Field>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Check bank payouts above, ₦">
          <Input value={box.naira} onChange={(e) => put('naira', digits(e.target.value))} placeholder={String(l.defaults.review.nairaAboveNgn)} inputMode="numeric" />
        </Field>
        <Field label="Check crypto payouts above, $">
          <Input value={box.crypto} onChange={(e) => put('crypto', e.target.value.replace(/[^0-9.]/g, ''))} placeholder={String(l.defaults.review.cryptoAboveUsd)} inputMode="decimal" />
        </Field>
      </div>
      <PasswordInput full value={password} onChange={setPassword} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button small onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button small disabled={busy || !password} onClick={() => void save(true)}>
          Use defaults
        </Button>
        <Button small tone="primary" disabled={busy || !password} onClick={() => void save(false)}>
          {busy ? 'Saving…' : 'Save limits'}
        </Button>
      </div>
      {said && !said.ok && <Said {...said} />}
    </div>
  )
}

/** Someone who lost their phone and their recovery codes: back to codes by email, once it's checked it's really them. */
/**
 * Direct account checkouts for this business: an account of its own, paid
 * by the exact amount, settled by our team by hand. Off keeps the account,
 * payments and keys, so on again brings them back.
 */
function DirectPanel({ b }: { b: Biz }) {
  const d = b.direct
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  if (!d || (!d.allowed && !d.account && b.status !== 'VERIFIED')) return null
  const turn = async () => {
    const ok = await run(() => biz(`/businesses/${b.id}/direct`, { method: 'POST', body: { allowed: !d.allowed, password } }), d.allowed ? 'Switched off.' : 'Switched on.')
    if (ok) {
      setAsking(false)
      setPassword('')
    }
  }
  return (
    <Panel title="Direct account" action={!asking && (d.allowed || d.ready) && <TextButton onClick={() => setAsking(true)}>{d.allowed ? 'Switch off' : 'Switch on'}</TextButton>}>
      {asking ? (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
            {d.allowed
              ? 'Its direct keys stop working and its customers can no longer pay this way. Its account, payments and keys are kept for when it comes back on.'
              : d.account
                ? 'Its direct account, payments and keys come back as they were.'
                : 'Opens an account in its name. Customers pay into it by bank transfer, and our team settles the business by hand. There is no fee.'}
          </p>
          <PasswordInput full value={password} onChange={setPassword} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button small onClick={() => setAsking(false)} disabled={busy}>
              Cancel
            </Button>
            <Button small tone={d.allowed ? undefined : 'primary'} disabled={busy || !password} onClick={() => void turn()}>
              {busy ? 'Saving…' : d.allowed ? 'Switch off' : 'Switch on'}
            </Button>
          </div>
          {said && !said.ok && <Said {...said} />}
        </div>
      ) : (
        <div className="space-y-2">
          <Facts rows={[['State', <Tag tone={d.allowed ? 'good' : undefined}>{d.allowed ? 'On' : 'Off'}</Tag>], !!d.account && ['Account', <Copy text={d.account} />]]} />
          {!d.ready && !d.allowed && (
            <p className="text-[12.5px]" style={{ color: C.dim }}>
              Can't be switched on until FLW_V3_SECRET_KEY is set on the Business API.
            </p>
          )}
          {said?.ok && <Said {...said} />}
        </div>
      )}
    </Panel>
  )
}

function TwoStepResetPanel({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState(email)
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  return (
    <Panel title="Locked out of their authenticator app" action={!open && <TextButton onClick={() => setOpen(true)}>Reset</TextButton>}>
      {open ? (
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
            Only once you've checked it's really them. They go back to codes by email, every device is signed out, and they're emailed.
          </p>
          <Field label="Their email">
            <Input value={who} onChange={(e) => setWho(e.target.value)} />
          </Field>
          <PasswordInput full value={password} onChange={setPassword} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button small onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              small
              tone="primary"
              disabled={busy || !password || !who.includes('@')}
              onClick={async () => {
                if (await run(() => biz('/users/reset-two-step', { method: 'POST', body: { email: who.trim(), password } }), 'Reset. They sign in with an email code now.')) setOpen(false)
              }}
            >
              {busy ? 'Resetting…' : 'Reset their app'}
            </Button>
          </div>
          {said && !said.ok && <Said {...said} />}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
          {said?.ok ? said.text : 'For someone who lost their phone and their recovery codes.'}
        </p>
      )}
    </Panel>
  )
}

function VerificationPanel({ app, onOpen }: { app: BusinessDetail['application']; onOpen: () => void }) {
  const waiting = !!app && (app.status === 'SUBMITTED' || app.status === 'IN_REVIEW')
  const docs = app?.documents
  return (
    <Panel title="Verification" action={<TextButton onClick={onOpen}>{waiting ? 'Review' : 'Open'}</TextButton>}>
      {!app ? (
        <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
          Hasn't started its application.
        </p>
      ) : (
        <Facts
          rows={[
            ['Application', <AppState status={app.status} />],
            !!app.submittedAt && ['Submitted', <When at={app.submittedAt} />],
            ['Identity', app.identity ? <IdState status={app.identity.status} /> : <Dim>Not started</Dim>],
            !!app.identity?.name && ['Name on ID', app.identity.name],
            !!docs?.required && ['Documents', [`${docs.uploaded} of ${docs.required}`, docs.accepted && `${docs.accepted} accepted`, docs.rejected && `${docs.rejected} rejected`].filter(Boolean).join(' · ')],
            !!app.reviewedBy && [
              'Decided by',
              <>
                {app.reviewedBy}
                {app.reviewedAt && (
                  <Dim>
                    {' '}
                    · <When at={app.reviewedAt} />
                  </Dim>
                )}
              </>,
            ],
          ]}
        />
      )}
    </Panel>
  )
}

function NotesPanel({ b }: { b: Biz }) {
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(b.adminNote ?? '')
  const { busy, said, run } = useAction()
  useEffect(() => {
    if (!editing) setNote(b.adminNote ?? '')
  }, [b.adminNote, editing])
  return (
    <Panel title="Team notes" action={!editing && <TextButton onClick={() => setEditing(true)}>{b.adminNote ? 'Edit' : 'Add'}</TextButton>}>
      {editing ? (
        <div className="space-y-3">
          <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the next person should know" maxLength={2000} autoFocus />
          <div className="flex justify-end gap-2">
            <Button small onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              small
              tone="primary"
              disabled={busy || note === (b.adminNote ?? '')}
              onClick={async () => {
                if (await run(() => biz(`/businesses/${b.id}`, { method: 'PATCH', body: { adminNote: note } }), 'Saved.')) setEditing(false)
              }}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {said && !said.ok && <Said {...said} />}
        </div>
      ) : b.adminNote ? (
        <p className="text-[13px] leading-relaxed whitespace-pre-line break-words" style={{ color: C.text }}>
          {b.adminNote}
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed" style={{ color: C.dim }}>
          Nothing yet. Notes stay with the team - the business never sees them.
        </p>
      )}
    </Panel>
  )
}

/* ─── Payments and settlements ─────────────────────────────────────── */

/** A page number that goes back to 1 whenever the filters change. */
function usePage(filters: string) {
  const [state, setState] = useState({ filters, page: 1 })
  const page = state.filters === filters ? state.page : 1
  return [page, (p: number) => setState({ filters, page: p })] as const
}

function PaymentsTab({ businessId, name, links, invoices, outlets }: { businessId: string; name: string; links: LinkRow[]; invoices: InvoiceRow[]; outlets: OutletRow[] }) {
  const { params, setView, open } = useRecord()
  const linkId = params.get('link')
  const invoiceId = params.get('invoice')
  const outletId = params.get('outlet')
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [status, setStatus] = useState('')
  const [typed, setTyped, q] = useTyped()
  const [page, setPage] = usePage(`${mode}|${status}|${q}|${linkId ?? ''}|${invoiceId ?? ''}|${outletId ?? ''}`)
  const qs = new URLSearchParams({ businessId, mode, page: String(page) })
  if (status) qs.set('status', status)
  if (q) qs.set('q', q)
  if (linkId) qs.set('linkId', linkId)
  if (invoiceId) qs.set('invoiceId', invoiceId)
  if (outletId) qs.set('outletId', outletId)
  const { data, error, loading, reload } = useLoad<Paged & { payments: Pay[] }>(`/payments?${qs}`)
  const link = links.find((l) => l.id === linkId)
  const invoice = invoices.find((i) => i.id === invoiceId)
  const outlet = outlets.find((o) => o.id === outletId)
  // Paid through one checkout: which, and the way back to all of them.
  const through = link ? (
    <>
      Paid through <span style={{ color: C.text }}>{link.name}</span> <Ref dim>/{link.slug}</Ref>
    </>
  ) : invoice ? (
    <>
      Paid on invoice <Ref>{invoice.number}</Ref> to <span style={{ color: C.text }}>{invoice.customerName}</span>
    </>
  ) : outlet ? (
    <>
      Paid at <span style={{ color: C.text }}>{outlet.name}</span> <Ref dim>/o/{outlet.slug}</Ref>
    </>
  ) : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={typed} onChange={setTyped} placeholder="Reference, customer or payer" />
        <Segmented value={mode} onChange={setMode} items={[['live', 'Live'], ['test', 'Test']]} />
        <Select fit value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status but expired</option>
          <option value="PAID">Paid</option>
          <option value="UNDERPAID">Arrived short</option>
          <option value="OPEN">Waiting</option>
          <option value="EXPIRED">Expired</option>
        </Select>
      </div>
      {through && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: C.muted }}>
          {through}
          <span className="ml-1">
            <TextButton onClick={() => setView({ link: null, invoice: null, outlet: null })}>Show every payment</TextButton>
          </span>
        </div>
      )}
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table busy={loading} rows={data?.payments ?? []} columns={paymentColumns({})} rowKey={(p) => p.id} flag={paymentFlag} onRow={(p) => open('payment', p.id, { from: name })} empty="No payments match that." />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="payment" onPage={setPage} />}
      </Panel>
    </div>
  )
}

function SettlementsTab({ businessId, name }: { businessId: string; name: string }) {
  const { params, open } = useRecord()
  const asked = params.get('sv')
  const [view, setViewing] = useState(asked === 'attention' || asked === 'review' ? asked : 'all')
  const [mode, setMode] = useState<'live' | 'test'>('live')
  const [page, setPage] = usePage(`${view}|${mode}`)
  const { data, error, loading, reload } = useLoad<Paged & { settlements: Settle[] }>(`/settlements?businessId=${businessId}&view=${view}&mode=${mode}&page=${page}`)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setViewing}
          items={[
            ['all', 'All'],
            ['attention', 'Needs a person'],
            ['review', 'To review'],
            ['moving', 'On the way'],
            ['settled', 'Settled'],
          ]}
        />
        <Segmented value={mode} onChange={setMode} items={[['live', 'Live'], ['test', 'Test']]} />
      </div>
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.settlements ?? []}
            columns={settlementColumns({})}
            rowKey={(s) => s.id}
            flag={settlementFlag}
            onRow={(s) => open('settlement', s.id, { from: name })}
            empty={view === 'attention' ? 'Nothing needs a person.' : view === 'review' ? 'Nothing to review.' : 'No settlements match that.'}
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="settlement" onPage={setPage} />}
      </Panel>
    </div>
  )
}

/* ─── Checkouts ────────────────────────────────────────────────────── */

type CheckoutKind = 'links' | 'invoices' | 'outlets'

/** Everything a business takes payments through. Open one to see its payments. */
function CheckoutsTab({ data, go }: { data: BusinessDetail; go: Go }) {
  const { params, setView } = useRecord()
  const asked = params.get('ck')
  const kind: CheckoutKind = asked === 'invoices' || asked === 'outlets' ? asked : 'links'
  return (
    <div className="space-y-4">
      <Segmented
        value={kind}
        onChange={(k) => setView({ ck: k === 'links' ? null : k })}
        items={[
          ['links', 'Payment links', data.links.filter((l) => !l.deleted).length],
          ['invoices', 'Invoices', data.invoices.filter((i) => i.status !== 'VOID').length],
          ['outlets', 'Outlets', data.outlets.filter((o) => !o.deleted).length],
        ]}
      />
      {kind === 'links' && <LinksTab links={data.links} onPick={(l) => go('payments', { link: l.id })} />}
      {kind === 'invoices' && <InvoicesTab invoices={data.invoices} onPick={(i) => go('payments', { invoice: i.id })} />}
      {kind === 'outlets' && <OutletsTab outlets={data.outlets} onPick={(o) => go('payments', { outlet: o.id })} />}
    </div>
  )
}

const inCurrency = (currency: 'NGN' | 'USD', n: number) => (currency === 'NGN' ? naira(n) : `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)

function InvoicesTab({ invoices, onPick }: { invoices: InvoiceRow[]; onPick: (i: InvoiceRow) => void }) {
  const [show, setShow] = useState<'current' | 'cancelled'>('current')
  const cancelled = invoices.filter((i) => i.status === 'VOID').length
  const rows = invoices.filter((i) => (show === 'current' ? i.status !== 'VOID' : i.status === 'VOID'))
  const overdue = (i: InvoiceRow) => i.status === 'OPEN' && Date.parse(i.dueAt) < Date.now()
  const columns: Column<InvoiceRow>[] = [
    {
      key: 'who',
      head: 'Invoice',
      width: 'minmax(0,1.6fr)',
      cell: (i) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{i.customerName}</div>
          <div className="truncate text-[12px]" style={{ color: C.dim }}>
            <Ref dim>{i.number}</Ref> · {i.customerEmail}
          </div>
        </div>
      ),
      phone: 'title',
    },
    { key: 'amount', head: 'Amount', width: '124px', align: 'right', cell: (i) => <span className="tabular-nums">{inCurrency(i.currency, i.amount)}</span>, phone: 'sub' },
    {
      key: 'due',
      head: 'Due',
      width: '112px',
      cell: (i) => <span style={{ color: overdue(i) ? C.red : C.muted }}>{dayDate(i.dueAt)}</span>,
      phone: 'meta',
    },
    {
      key: 'sent',
      head: 'Sent',
      width: 'minmax(0,1fr)',
      cell: (i) =>
        i.sentAt ? (
          <span style={{ color: C.muted }}>
            <When at={i.sentAt} />
            {i.viewedAt ? ' · opened' : ''}
            {i.remindedAt ? ' · reminded' : ''}
          </span>
        ) : (
          <Dim>Not sent</Dim>
        ),
      phone: 'meta',
    },
    { key: 'paid', head: 'Paid by', width: '156px', cell: (i) => (i.payment ? <Ref>{i.payment.ref}</Ref> : <Dim>—</Dim>) },
    {
      key: 'state',
      head: 'State',
      width: '124px',
      cell: (i) => (
        <span className="inline-flex items-center gap-2">
          {i.status === 'PAID' ? (
            <State tone="good">Paid</State>
          ) : i.status === 'VOID' ? (
            <State tone="idle">Cancelled</State>
          ) : i.status === 'DRAFT' ? (
            <State tone="idle">Draft</State>
          ) : overdue(i) ? (
            <State tone="warn">Overdue</State>
          ) : (
            <State tone="info">Waiting</State>
          )}
          {i.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
        </span>
      ),
      phone: 'meta',
    },
  ]
  return (
    <div className="space-y-4">
      {cancelled > 0 && (
        <Segmented
          value={show}
          onChange={setShow}
          items={[
            ['current', 'Current', invoices.length - cancelled],
            ['cancelled', 'Cancelled', cancelled],
          ]}
        />
      )}
      <Panel flush>
        <Table rows={rows} columns={columns} rowKey={(i) => i.id} onRow={onPick} empty={show === 'current' ? 'No invoices yet.' : 'None cancelled.'} />
      </Panel>
      <p className="text-[12px]" style={{ color: C.dim }}>
        Open an invoice to see the payments made on it. A cancelled invoice is the business's "deleted" one - kept here, gone from its own list.
      </p>
    </div>
  )
}

function OutletsTab({ outlets, onPick }: { outlets: OutletRow[]; onPick: (o: OutletRow) => void }) {
  const [show, setShow] = useState<'current' | 'deleted'>('current')
  const deleted = outlets.filter((o) => o.deleted).length
  const rows = outlets.filter((o) => (show === 'current' ? !o.deleted : o.deleted))
  const columns: Column<OutletRow>[] = [
    {
      key: 'name',
      head: 'Outlet',
      width: 'minmax(0,1.6fr)',
      cell: (o) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{o.name}</div>
          <div className="truncate text-[12px]" style={{ color: C.dim }}>
            <Ref dim>/o/{o.slug}</Ref> · {o.location}
          </div>
        </div>
      ),
      phone: 'title',
    },
    { key: 'takes', head: 'Takes', width: 'minmax(0,1fr)', cell: (o) => o.methods.map((x) => METHOD[x] ?? x).join(', ') || '—', phone: 'sub' },
    { key: 'to', head: 'Pays out to', width: 'minmax(0,1fr)', cell: (o) => DESTINATION[o.destination], phone: 'meta' },
    { key: 'staff', head: 'Staff feed', width: 'minmax(0,1fr)', cell: (o) => o.staffEmail ?? <Dim>Nobody</Dim> },
    { key: 'paid', head: 'Paid', width: '104px', align: 'right', cell: (o) => plural(o.payments, 'payment'), phone: 'meta' },
    { key: 'volume', head: 'Taken', width: '112px', align: 'right', cell: (o) => naira(o.collectedNgn) },
    {
      key: 'state',
      head: 'State',
      width: '120px',
      cell: (o) => (
        <span className="inline-flex items-center gap-2">
          {o.deleted ? <State tone="idle">Deleted</State> : o.active ? <State tone="good">Active</State> : <State tone="warn">Paused</State>}
          {o.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
        </span>
      ),
      phone: 'meta',
    },
  ]
  return (
    <div className="space-y-4">
      {deleted > 0 && (
        <Segmented
          value={show}
          onChange={setShow}
          items={[
            ['current', 'Current', outlets.length - deleted],
            ['deleted', 'Deleted', deleted],
          ]}
        />
      )}
      <Panel flush>
        <Table rows={rows} columns={columns} rowKey={(o) => o.id} onRow={onPick} empty={show === 'current' ? 'No outlets yet.' : 'None deleted.'} />
      </Panel>
      <p className="text-[12px]" style={{ color: C.dim }}>
        Open an outlet to see the payments made at it. A deleted outlet keeps its address, so a poster still on a counter can never open someone else's checkout.
      </p>
    </div>
  )
}

/* ─── Links ────────────────────────────────────────────────────────── */

const linkPrice = (l: LinkRow) => {
  const money = (n: number) => (l.currency === 'NGN' ? naira(n) : `$${n.toLocaleString()}`)
  return l.amount != null ? money(l.amount) : `Customer chooses${l.min != null ? `, from ${money(l.min)}` : ''}`
}

function LinksTab({ links, onPick }: { links: LinkRow[]; onPick: (l: LinkRow) => void }) {
  const [show, setShow] = useState<'current' | 'deleted'>('current')
  const deleted = links.filter((l) => l.deleted).length
  const rows = links.filter((l) => (show === 'current' ? !l.deleted : l.deleted))
  const columns: Column<LinkRow>[] = [
    {
      key: 'name',
      head: 'Link',
      width: 'minmax(0,1.6fr)',
      cell: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{l.name}</div>
          <div className="truncate">
            <Ref dim>/{l.slug}</Ref>
          </div>
        </div>
      ),
      phone: 'title',
    },
    { key: 'price', head: 'Price', width: 'minmax(0,1fr)', cell: (l) => linkPrice(l), phone: 'sub' },
    { key: 'takes', head: 'Takes', width: 'minmax(0,1fr)', cell: (l) => l.methods.map((x) => METHOD[x] ?? x).join(', ') || '—', phone: 'meta' },
    { key: 'to', head: 'Pays out to', width: 'minmax(0,1fr)', cell: (l) => DESTINATION[l.destination], phone: 'meta' },
    { key: 'paid', head: 'Paid', width: '104px', align: 'right', cell: (l) => plural(l.paid.count, 'payment'), phone: 'meta' },
    { key: 'volume', head: 'Taken', width: '112px', align: 'right', cell: (l) => naira(l.paid.volumeNgn) },
    {
      key: 'state',
      head: 'State',
      width: '120px',
      cell: (l) => (
        <span className="inline-flex items-center gap-2">
          {l.deleted ? <State tone="idle">Deleted</State> : l.active ? <State tone="good">Active</State> : <State tone="warn">Paused</State>}
          {l.mode === 'TEST' && <Tag tone="warn">Test</Tag>}
        </span>
      ),
      phone: 'meta',
    },
  ]
  return (
    <div className="space-y-4">
      {deleted > 0 && (
        <Segmented
          value={show}
          onChange={setShow}
          items={[
            ['current', 'Current', links.length - deleted],
            ['deleted', 'Deleted', deleted],
          ]}
        />
      )}
      <Panel flush>
        <Table rows={rows} columns={columns} rowKey={(l) => l.id} onRow={onPick} empty={show === 'current' ? 'No payment links yet.' : 'None deleted.'} />
      </Panel>
      <p className="text-[12px]" style={{ color: C.dim }}>
        Open a link to see the payments made through it.
      </p>
    </div>
  )
}

/* ─── Bank accounts ────────────────────────────────────────────────── */

function BanksTab({ b, banks }: { b: Biz; banks: Bank[] }) {
  const active = banks.filter((x) => !x.removedAt)
  const removed = banks.filter((x) => x.removedAt)
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed max-w-[78ch]" style={{ color: C.muted }}>
        Payouts only go to accounts in the name of <span style={{ color: C.text }}>{b.nameOnRecord ?? 'the business'}</span>. The bank's own name for each account is checked as it's
        added; one that doesn't match waits here for a person.
      </p>
      <Panel flush>
        {active.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13.5px]" style={{ color: C.dim }}>
            No bank account yet.
          </div>
        ) : (
          <div className="divide-y divide-[#171B12]">
            {active.map((bk) => (
              <BankRow key={bk.id} bank={bk} expected={b.nameOnRecord} />
            ))}
          </div>
        )}
      </Panel>
      {removed.length > 0 && (
        <Panel title="Removed" flush>
          <div className="divide-y divide-[#171B12]">
            {removed.map((bk) => (
              <BankRow key={bk.id} bank={bk} expected={b.nameOnRecord} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function BankRow({ bank, expected }: { bank: Bank; expected: string | null }) {
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const waiting = !bank.removedAt && !bank.nameMatches && !bank.reviewedAt
  const [tone, word]: [Tone, string] = bank.removedAt
    ? ['idle', 'Removed']
    : bank.nameMatches
      ? ['good', bank.reviewedAt ? 'Approved by hand' : 'Name matches']
      : bank.reviewedAt
        ? ['bad', 'Turned down']
        : ['warn', 'Needs a check']
  return (
    <div className="px-4 py-4" style={{ opacity: bank.removedAt ? 0.6 : 1, boxShadow: waiting ? `inset 2px 0 0 ${C.amber}` : undefined }}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_190px] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium" style={{ color: C.text }}>
              {bank.bankName}
            </span>
            {bank.isDefault && !bank.removedAt && <Tag>Default</Tag>}
          </div>
          <div className="mt-1">
            <Copy text={bank.accountNumber} />
          </div>
        </div>
        <div className="min-w-0 text-[13px] space-y-0.5">
          <div>
            <Dim>Bank's name </Dim>
            <span style={{ color: C.text }}>{bank.accountName}</span>
          </div>
          {waiting && expected && (
            <div>
              <Dim>Needs to be </Dim>
              <span style={{ color: C.text }}>{expected}</span>
            </div>
          )}
          <div className="text-[12px]" style={{ color: C.dim }}>
            Added <When at={bank.createdAt} />
            {bank.removedAt && (
              <>
                {' '}
                · removed <When at={bank.removedAt} />
              </>
            )}
          </div>
        </div>
        <div className="md:text-right">
          <State tone={tone}>{word}</State>
          {bank.reviewedBy && (
            <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
              {bank.reviewedBy} · <When at={bank.reviewedAt} />
            </div>
          )}
        </div>
      </div>
      {waiting && (
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button
            tone="danger"
            disabled={busy}
            onClick={() => void run(() => biz(`/bank-accounts/${bank.id}/review`, { method: 'POST', body: { approve: false } }), 'Turned down. The business sees it as not approved.')}
          >
            Turn down
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password}
            onClick={async () => {
              if (await run(() => biz(`/bank-accounts/${bank.id}/review`, { method: 'POST', body: { approve: true, password } }), 'Approved - money can settle to it now.')) setPassword('')
            }}
          >
            Approve
          </Button>
        </Confirm>
      )}
      {said && (
        <div className="mt-2 md:text-right">
          <Said {...said} />
        </div>
      )}
    </div>
  )
}

/* ─── Team ─────────────────────────────────────────────────────────── */

function TeamTab({ members }: { members: Member[] }) {
  const columns: Column<Member>[] = [
    {
      key: 'who',
      head: 'Person',
      width: 'minmax(0,1.6fr)',
      cell: (m) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{m.name ?? m.email}</div>
          <div className="truncate text-[12px]" style={{ color: m.emailVerified ? C.dim : C.amber }}>
            {m.name ? m.email : ''}
            {m.emailVerified ? '' : `${m.name ? ' · ' : ''}email not confirmed`}
          </div>
        </div>
      ),
      phone: 'title',
    },
    { key: 'role', head: 'Role', width: '96px', cell: (m) => ROLE[m.role] ?? m.role, phone: 'sub' },
    { key: 'signin', head: 'Signs in with', width: 'minmax(0,1fr)', cell: (m) => m.signsInWith.join(' or ') || '—', phone: 'meta' },
    { key: 'second', head: 'Second step', width: '128px', cell: (m) => (m.twoStep === 'APP' ? 'Authenticator app' : 'Email code'), phone: 'meta' },
    { key: 'active', head: 'Last active', width: '96px', cell: (m) => <When at={m.lastActiveAt} />, phone: 'meta' },
    { key: 'added', head: 'Added', width: '104px', cell: (m) => dayDate(m.addedAt), phone: 'meta' },
  ]
  return (
    <Panel flush>
      <Table rows={members} columns={columns} rowKey={(m) => m.id} empty="Nobody yet." />
    </Panel>
  )
}

/* ─── Activity ─────────────────────────────────────────────────────── */

function ActivityTab({ items }: { items: Activity[] }) {
  const [who, setWho] = useState<'all' | 'team' | 'business'>('all')
  const shown = items.filter((a) => who === 'all' || (who === 'team') === byTeam(a.by))
  const days = new Map<string, Activity[]>()
  for (const a of shown) {
    const d = dayDate(a.at)
    days.set(d, [...(days.get(d) ?? []), a])
  }
  return (
    <div className="space-y-4">
      <Segmented
        value={who}
        onChange={setWho}
        items={[
          ['all', 'Everything'],
          ['team', 'Our team'],
          ['business', 'The business'],
        ]}
      />
      <Panel flush>
        {shown.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13.5px]" style={{ color: C.dim }}>
            Nothing yet.
          </div>
        ) : (
          [...days].map(([day, list]) => (
            <div key={day}>
              <div className="px-4 pt-4 pb-1.5 text-[12px] font-medium" style={{ color: C.dim }}>
                {day}
              </div>
              {list.map((a) => {
                const detail = activityDetail(a.action, a.detail)
                return (
                  <div key={a.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                    <span className="pt-px text-[12.5px] tabular-nums" style={{ color: C.dim }}>
                      {clock(a.at)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium" style={{ color: C.text }}>
                        {actionWord(a.action)}
                      </div>
                      {detail && (
                        <div className="mt-0.5 text-[12.5px] break-words" style={{ color: C.muted }}>
                          {detail}
                        </div>
                      )}
                      <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
                        {a.by}
                        {a.ip ? ` · ${a.ip}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
      </Panel>
      {items.length >= 100 && (
        <p className="text-[12px]" style={{ color: C.dim }}>
          The latest 100 entries.
        </p>
      )}
    </div>
  )
}

const DETAIL_LABEL: Record<keyof DetailChangeView['current'], string> = {
  name: 'Business name',
  phone: 'Business phone',
  supportEmail: 'Support email',
  supportPhone: 'Support phone',
}

/**
 * The business asked to change what its customers see. Nothing changes until this
 * is approved - check it the way the application was checked: a new name should
 * match the registration, a new phone or email should be theirs.
 */
function DetailChangePanel({ name, c, onDone }: { name: string; c: DetailChangeView; onDone: (text: string) => void }) {
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [declining, setDeclining] = useState(false)
  const { busy, said, run } = useAction()
  const fields = (Object.keys(DETAIL_LABEL) as (keyof DetailChangeView['current'])[]).filter((k) => c.changes[k] !== undefined)
  return (
    <div className="mb-5">
      <ActionPanel
        title={`${name} asked to change its details`}
        sub="Nothing changes for its customers until you approve. For a new name, check it matches the registration; for a phone or email, that it's theirs."
      >
        <div className="divide-y divide-[#171B12] rounded-[10px] border" style={{ borderColor: C.line }}>
          {fields.map((k) => (
            <div key={k} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-2.5 text-[13px]">
              <span style={{ color: C.dim }}>{DETAIL_LABEL[k]}</span>
              <span className="break-words line-through decoration-1" style={{ color: C.muted }}>
                {c.current[k] || 'Not given'}
              </span>
              <span className="break-words font-medium" style={{ color: C.text }}>
                {c.changes[k]}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px]" style={{ color: C.dim }}>
          Asked <When at={c.createdAt} />.
        </p>
        {declining && (
          <Field label="Why not - the business sees this">
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
        )}
        <Confirm>
          {!declining && <PasswordInput value={password} onChange={setPassword} />}
          {declining ? (
            <>
              <Button onClick={() => setDeclining(false)} disabled={busy}>
                Back
              </Button>
              <Button
                tone="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={async () => {
                  const ok = await run(() => biz(`/detail-changes/${c.id}/decline`, { method: 'POST', body: { reason: reason.trim() } }), '')
                  if (ok) onDone('Turned down - the business has been told why.')
                }}
              >
                {busy ? 'Saving…' : 'Turn down'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setDeclining(true)} disabled={busy}>
                Turn down
              </Button>
              <Button
                tone="primary"
                disabled={busy || !password}
                onClick={async () => {
                  const ok = await run(() => biz(`/detail-changes/${c.id}/approve`, { method: 'POST', body: { password } }), '')
                  if (ok) onDone('Approved - the new details are live and the business has been told.')
                }}
              >
                {busy ? 'Saving…' : 'Approve'}
              </Button>
            </>
          )}
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}
