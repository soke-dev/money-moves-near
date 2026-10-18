/**
 * KYC: applications to go live, and the review of one.
 *
 * The review is everything the business sent - its answers, its filings (read
 * here, decrypted by the API, every opening logged), the representative's
 * identity check as Didit decided it - and the decision. Approving switches
 * live mode on; asking for changes and turning down both say why, in a note
 * the business sees. Nothing here is ever simulated.
 *
 * The same review sits in a business's Verification tab and on its own page
 * from the KYC queue.
 */
import { useEffect, useState } from 'react'
import { C } from '../ui'
import { biz, BizError, bizFile, STRUCTURE, useLoad, type ApplicationDetail, type ApplicationRow, type Bank, type DocRow, type IdentityRow, type Paged } from './client'
import {
  ActionPanel,
  AppState,
  bytes,
  Button,
  Confirm,
  Copy,
  Dim,
  Facts,
  Field,
  IdLine,
  IdState,
  Input,
  ListLoading,
  Notice,
  PageHead,
  PageLoading,
  Pager,
  Panel,
  PasswordInput,
  plural,
  Problem,
  Said,
  Segmented,
  State,
  Table,
  Tag,
  Textarea,
  TextButton,
  Timeline,
  useAction,
  When,
  type Column,
  type Tone,
} from './kit'
import { useRecord } from './nav'

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' })
  } catch {
    return null
  }
})()
/** "NG" as "Nigeria". */
const countryOf = (code: string) => {
  try {
    return regionNames?.of(code) ?? code
  } catch {
    return code
  }
}
import { actionWord, activityDetail, byTeam } from './tables'

/* ═══ The queue ════════════════════════════════════════════════════ */

const VIEWS = [
  ['queue', 'Waiting'],
  ['changes', 'Changes asked'],
  ['approved', 'Approved'],
  ['rejected', 'Turned down'],
  ['drafts', 'Not submitted'],
  ['all', 'All'],
] as const
type View = (typeof VIEWS)[number][0]

const ID_SHORT: Record<string, [Tone, string]> = { APPROVED: ['good', 'Verified'], IN_REVIEW: ['warn', 'Under review'], PENDING: ['idle', 'Unfinished'], DECLINED: ['bad', 'Declined'] }

export function Applications({ initial }: { initial?: string }) {
  const { open } = useRecord()
  const [view, setView] = useState<View>(VIEWS.some(([v]) => v === initial) ? (initial as View) : 'queue')
  const [paging, setPaging] = useState({ view, page: 1 })
  const page = paging.view === view ? paging.page : 1
  const { data, error, loading, reload } = useLoad<Paged & { applications: ApplicationRow[] }>(`/applications?view=${view}&page=${page}`)
  const columns: Column<ApplicationRow>[] = [
    {
      key: 'business',
      head: 'Business',
      width: 'minmax(0,1.5fr)',
      cell: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.businessName}</div>
          {a.legalName && a.legalName.toLowerCase() !== a.businessName.toLowerCase() && (
            <div className="truncate text-[12px]" style={{ color: C.dim }}>
              {a.legalName}
            </div>
          )}
        </div>
      ),
      phone: 'title',
    },
    { key: 'type', head: 'Type', width: 'minmax(0,1fr)', cell: (a) => (a.kind === 'REGISTERED' ? (a.structure ? STRUCTURE[a.structure] : 'Registered') : 'Just me'), phone: 'sub' },
    { key: 'owner', head: 'Owner', width: 'minmax(0,1.2fr)', cell: (a) => <span className="block truncate">{a.owner ?? '—'}</span>, phone: 'meta' },
    {
      key: 'identity',
      head: 'Identity',
      width: '104px',
      cell: (a) => (a.identity ? <State tone={ID_SHORT[a.identity]![0]}>{ID_SHORT[a.identity]![1]}</State> : <Dim>Not started</Dim>),
      phone: 'meta',
    },
    {
      key: 'docs',
      head: 'Documents',
      width: '112px',
      cell: (a) =>
        a.kind !== 'REGISTERED' ? (
          <Dim>None needed</Dim>
        ) : a.rejectedDocuments ? (
          <span style={{ color: C.red }}>{a.rejectedDocuments} rejected</span>
        ) : (
          plural(a.documents, 'file')
        ),
      phone: 'meta',
    },
    { key: 'state', head: 'State', width: '148px', cell: (a) => <AppState status={a.status} />, phone: 'meta' },
    {
      key: 'when',
      head: view === 'queue' ? 'Waiting since' : 'Updated',
      width: '104px',
      cell: (a) => (
        <span style={{ color: C.muted }}>
          <When at={view === 'queue' ? a.submittedAt : a.updatedAt} />
        </span>
      ),
      phone: 'meta',
    },
  ]
  return (
    <div className="space-y-4">
      <Vault />
      <Segmented value={view} onChange={setView} items={VIEWS} />
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.applications ?? []}
            columns={columns}
            rowKey={(a) => a.businessId}
            flag={(a) => (a.status === 'SUBMITTED' ? 'warn' : undefined)}
            onRow={(a) => open('application', a.businessId, { from: 'KYC' })}
            empty={view === 'queue' ? 'Nothing waiting. Every submitted application has a decision.' : 'None of those.'}
          />
        )}
        {data && <Pager page={data.pagination.page} pages={data.pagination.pages} total={data.pagination.total} unit="application" onPage={(p) => setPaging({ view, page: p })} />}
      </Panel>
      {view === 'queue' && (
        <p className="text-[12px]" style={{ color: C.dim }}>
          Oldest first - first come, first served.
        </p>
      )}
    </div>
  )
}

/* ═══ The documents, kept safe ════════════════════════════════════════ */

type VaultData = { state: 'ok' | 'locked' | 'unchecked'; reason: string | null; checkedAt: string | null; keyId: string; oldKeys: number; documents: number }
type CheckResult = { total: number; readable: number; unreadable: { id: string; businessId: string; kind: string; why: string }[]; altered: { id: string }[]; byKey: Record<string, number>; checkedAt: string }

/**
 * Whether every stored document still opens. They're encrypted with DOCS_KEY,
 * can't be deleted or altered (the database refuses), and each records which
 * key locked it - this is the check that all of that is holding.
 */
function Vault() {
  const { data, reload } = useLoad<VaultData>('/documents/vault')
  const [result, setResult] = useState<CheckResult | null>(null)
  const { busy, said, run } = useAction(() => void reload())
  if (!data) return null
  const locked = data.state === 'locked'
  const bad = result ? result.unreadable.length + result.altered.length : 0
  return (
    <Notice
      tone={locked || bad ? 'bad' : 'good'}
      title={
        locked
          ? "Some stored documents won't open"
          : result
            ? bad
              ? `${plural(bad, 'document')} failed the check`
              : `All ${plural(result.total, 'document')} open and match what was uploaded`
            : `${plural(data.documents, 'document')} stored, encrypted and locked against deletion`
      }
      action={
        <Button
          small
          disabled={busy}
          onClick={() =>
            void run(async () => setResult(await biz<CheckResult>('/documents/check', { method: 'POST' })), 'Checked.')
          }
        >
          {busy ? 'Checking…' : 'Check every document'}
        </Button>
      }
    >
      {locked
        ? `${data.reason ?? ''} Uploads are paused until it's put right: put the old key back as DOCS_KEY, or add it to DOCS_KEYS_OLD.`
        : result && bad
          ? [...result.unreadable.map((u) => `${u.kind} (${u.id.slice(0, 8)}…): ${u.why}`), ...result.altered.map((x) => `${x.id.slice(0, 8)}… doesn't match its fingerprint`)].join(' · ')
          : `Key ${data.keyId}${data.oldKeys ? `, plus ${plural(data.oldKeys, 'old key')}` : ''}. ${result ? `Checked ${new Date(result.checkedAt).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })}.` : 'Open and compare every one to be sure.'}`}
      {said && !said.ok && <span style={{ color: C.red }}> {said.text}</span>}
    </Notice>
  )
}

/* ═══ One application ══════════════════════════════════════════════ */

/** From the KYC queue: the review as a page of its own. */
export function ApplicationPage({ businessId }: { businessId: string }) {
  const { data, error, loading, reload } = useLoad<ApplicationDetail>(`/applications/${businessId}`)
  const { open } = useRecord()
  if (loading && !data) return <PageLoading />
  if (error?.code === 'not_found') return <NotStarted />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />
  const a = data.application
  const biz_ = data.business
  return (
    <div>
      <PageHead
        title={biz_.name}
        meta={[
          <AppState status={a.status} />,
          biz_.kind === 'REGISTERED' ? (a.answers.structure ? STRUCTURE[a.answers.structure] : 'Registered business') : 'Just me',
          a.submittedAt ? (
            <>
              Submitted <When at={a.submittedAt} />
            </>
          ) : (
            'Not submitted yet'
          ),
        ]}
        actions={<Button onClick={() => open('business', biz_.id, { from: `${biz_.name}'s application` })}>Open the business</Button>}
      >
        <IdLine items={[['Merchant ID', <Copy text={biz_.merchantId} />], !!biz_.owner && ['Owner', <span style={{ color: C.text }}>{biz_.owner}</span>]]} />
      </PageHead>
      <Review data={data} />
    </div>
  )
}

/** Inside a business's Verification tab. */
export function ApplicationReview({ businessId, name }: { businessId: string; name: string }) {
  const { data, error, loading, reload } = useLoad<ApplicationDetail>(`/applications/${businessId}`)
  if (loading && !data) return <ListLoading />
  if (error?.code === 'not_found') return <NotStarted name={name} />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />
  return <Review data={data} />
}

function NotStarted({ name }: { name?: string }) {
  return (
    <Panel>
      <div className="py-8 text-center">
        <div className="text-[14px] font-medium" style={{ color: C.text }}>
          {name ?? 'This business'} hasn't started its application.
        </div>
        <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
          It appears here as soon as someone opens Activate in the dashboard.
        </p>
      </div>
    </Panel>
  )
}

type Decision = 'approve' | 'changes' | 'reject'

function Review({ data }: { data: ApplicationDetail }) {
  const a = data.application
  const answers = a.answers
  const registered = answers.kind === 'registered'
  const businessId = data.business.id
  const decidable = a.status === 'SUBMITTED' || a.status === 'IN_REVIEW'
  // Documents are judged while the application is open; once it's decided, they're there to read.
  const judging = decidable || a.status === 'CHANGES_REQUESTED'
  const rejected = data.documents.filter((d) => !d.replacedAt && d.verdict === 'REJECTED').length
  const [deciding, setDeciding] = useState<Decision | null>(null)
  const start = useAction()
  const identity = data.identity[0] ?? null
  const person = [identity?.firstName, identity?.lastName].filter(Boolean).join(' ')
  const address = (...parts: (string | undefined)[]) => parts.filter((x) => x && x.trim()).join(', ') || null
  const people = answers.people ?? []

  return (
    <div className="space-y-5">
      {decidable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <div className="min-w-0 text-[13.5px]" style={{ color: C.text }}>
            {a.status === 'SUBMITTED' ? 'Waiting for someone to pick it up.' : 'In review.'}{' '}
            <span style={{ color: C.muted }}>{data.gaps.length ? `The server still sees ${plural(data.gaps.length, 'gap')}.` : 'Nothing missing.'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {a.status === 'SUBMITTED' && (
              <Button disabled={start.busy} onClick={() => void start.run(() => biz(`/applications/${businessId}/decision`, { method: 'POST', body: { decision: 'review' } }), 'Marked in review.')}>
                Start review
              </Button>
            )}
            <Button onClick={() => setDeciding(deciding === 'changes' ? null : 'changes')}>Ask for changes</Button>
            <Button tone="danger" onClick={() => setDeciding(deciding === 'reject' ? null : 'reject')}>
              Turn down
            </Button>
            <Button tone="primary" onClick={() => setDeciding(deciding === 'approve' ? null : 'approve')}>
              Approve
            </Button>
          </div>
        </div>
      )}
      {start.said && !start.said.ok && <Said {...start.said} />}
      {deciding && <DecisionPanel kind={deciding} businessId={businessId} name={data.business.name} gaps={data.gaps.length} rejected={rejected} onClose={() => setDeciding(null)} />}

      {a.status === 'APPROVED' && (
        <Notice
          tone="good"
          title={
            <>
              Approved <When at={a.reviewedAt} />
              {a.reviewedBy ? ` by ${a.reviewedBy}` : ''}
            </>
          }
        >
          {a.decisionNote || 'Live mode is on for this business.'}
        </Notice>
      )}
      {a.status === 'REJECTED' && (
        <Notice
          tone="bad"
          title={
            <>
              Turned down <When at={a.reviewedAt} />
              {a.reviewedBy ? ` by ${a.reviewedBy}` : ''}
            </>
          }
        >
          {a.decisionNote}
        </Notice>
      )}
      {a.status === 'CHANGES_REQUESTED' && (
        <Notice
          tone="warn"
          title={
            <>
              Waiting on the business - changes asked <When at={a.reviewedAt} />
              {a.reviewedBy ? ` by ${a.reviewedBy}` : ''}
            </>
          }
        >
          “{a.decisionNote}”
        </Notice>
      )}
      {a.status === 'DRAFT' && (
        <Notice tone="idle" title="Not submitted yet">
          The business is still filling it in. Below is what it has saved so far.
        </Notice>
      )}
      {data.gaps.length > 0 && a.status !== 'APPROVED' && (
        <Notice tone="warn" title={`Still missing ${plural(data.gaps.length, 'thing')}`}>
          {data.gaps.map((g) => g.label).join(' · ')}
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-5 min-w-0">
          {registered && (
            <Panel title="The business, as registered">
              <Facts
                wide
                rows={[
                  ['Registered name', answers.legalName],
                  ['Structure', answers.structure ? STRUCTURE[answers.structure] : null],
                  ['Registration number', answers.regNumber ? <Copy text={answers.regNumber} /> : null],
                  ['Registered on', answers.regDate],
                  ['Tax ID (TIN)', answers.tin ? <Copy text={answers.tin} /> : null],
                  ['Business address', address(answers.bizStreet, answers.bizCity, answers.bizState)],
                  ['Industry', answers.category],
                ]}
              />
            </Panel>
          )}

          {registered && (
            <Panel title="Documents" sub="Opened here, decrypted by the API. Every opening is written to the business's activity." flush>
              <Documents required={data.required} docs={data.documents} judging={judging} />
            </Panel>
          )}

          <Panel title={registered ? 'The representative' : 'The owner'} sub={registered ? 'The person who filled this in, for the business.' : undefined}>
            <Facts
              wide
              rows={[
                ['Name on their ID', person || <Dim>From the identity check, once it's done</Dim>],
                ['Phone', answers.phone],
                ['Home address', address(answers.street, answers.city, answers.state)],
                registered && ['On the filing as', [answers.repDirector && 'Director', answers.repOwner && `Owner${answers.repShare ? `, ${answers.repShare}%` : ''}`].filter(Boolean).join(' and ') || 'Neither'],
              ]}
            />
            {!registered && data.documents.some((d) => d.kind === 'proofOfAddress' && !d.replacedAt) && (
              <div className="-mx-4 mt-3" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
                <Documents required={[]} docs={data.documents} judging={judging} />
              </div>
            )}
          </Panel>

          {registered && (
            <Panel title="People on the filing" flush>
              <Table
                rows={people}
                rowKey={(p) => p.id ?? `${p.first}-${p.last}-${p.email}`}
                empty="Nobody listed besides the representative."
                columns={[
                  {
                    key: 'name',
                    head: 'Name',
                    width: 'minmax(0,1.3fr)',
                    cell: (p) => (
                      <div className="min-w-0">
                        <div className="truncate font-medium">{[p.first, p.last].filter(Boolean).join(' ') || '—'}</div>
                        <div className="truncate text-[12px]" style={{ color: C.dim }}>
                          {[p.email, p.phone].filter(Boolean).join(' · ') || '—'}
                        </div>
                      </div>
                    ),
                    phone: 'title',
                  },
                  { key: 'dob', head: 'Born', width: '96px', cell: (p) => p.dob || '—', phone: 'meta' },
                  {
                    key: 'id',
                    head: 'ID',
                    width: 'minmax(0,1fr)',
                    cell: (p) => (
                      <div className="min-w-0">
                        <div className="truncate">{p.idType || '—'}</div>
                        {p.idCountry && (
                          <div className="truncate text-[12px]" style={{ color: C.dim }}>
                            Issued in {countryOf(p.idCountry)}
                          </div>
                        )}
                      </div>
                    ),
                    phone: 'meta',
                  },
                  {
                    key: 'address',
                    head: 'Address',
                    width: 'minmax(0,1.4fr)',
                    cell: (p) => (
                      <div className="min-w-0">
                        <div className="truncate">{p.street || '—'}</div>
                        <div className="truncate text-[12px]" style={{ color: C.dim }}>
                          {[p.city, p.state, p.postal, p.country && countryOf(p.country)].filter(Boolean).join(', ')}
                        </div>
                      </div>
                    ),
                    phone: 'sub',
                  },
                  {
                    key: 'role',
                    head: 'Role',
                    width: 'minmax(0,1fr)',
                    cell: (p) => [p.director && 'Director', p.owner && `Owner${p.share ? `, ${p.share}%` : ''}`].filter(Boolean).join(' and ') || '—',
                    phone: 'meta',
                  },
                ]}
              />
            </Panel>
          )}

          <Panel title="What it sells">
            <Facts
              wide
              rows={[
                ['Website', answers.website ? <Outbound url={answers.website} /> : null],
                ...(['instagram', 'x', 'tiktok', 'facebook'] as const)
                  .filter((k) => !!answers.socials?.[k])
                  .map((k) => [{ instagram: 'Instagram', x: 'X', tiktok: 'TikTok', facebook: 'Facebook' }[k], answers.socials![k]] as [string, string]),
                !!answers.social && ["Representative's social", answers.social],
                !registered && ['What it sells', answers.category],
                ['Support email', answers.supportEmail],
                ['Support phone', answers.supportPhone ? `+234 ${answers.supportPhone}` : null],
                ['Expected each month', answers.volume],
                ['Description', answers.description ? <span className="whitespace-pre-line">{answers.description}</span> : null],
              ]}
            />
          </Panel>
        </div>

        <aside className="space-y-5 min-w-0">
          <IdentityPanel checks={data.identity} ready={data.identityReady} />
          <Panel title="Payout accounts">
            <Banks banks={data.bankAccounts} />
            <p className="mt-3 text-[12.5px]" style={{ color: C.dim }}>
              Money Moves account: <span style={{ color: answers.wallet?.username ? C.text : C.dim }}>{answers.wallet?.username || 'none given (optional)'}</span>
            </p>
          </Panel>
          <Panel title="History">
            {data.history.length === 0 ? (
              <p className="text-[13px]" style={{ color: C.dim }}>
                Nothing yet.
              </p>
            ) : (
              <Timeline
                items={data.history.slice(0, 30).map((h) => ({
                  id: h.id,
                  title: actionWord(h.action),
                  detail: activityDetail(h.action, h.detail) || undefined,
                  by: h.by,
                  at: h.at,
                  tone: h.action === 'admin_application_approve' ? 'good' : h.action === 'admin_application_reject' || h.action === 'admin_document_rejected' ? 'bad' : byTeam(h.by) ? 'info' : undefined,
                }))}
              />
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}

/** A website the business gave: shown as text, opened in a new tab, never followed with our context. */
function Outbound({ url }: { url: string }) {
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
  let safe = false
  try {
    safe = ['http:', 'https:'].includes(new URL(href).protocol)
  } catch {
    safe = false
  }
  if (!safe) return <span>{url}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-[#5C6650] underline-offset-[3px] hover:decoration-[#ECEFE7]" style={{ color: C.text }}>
      {url}
    </a>
  )
}

function DecisionPanel({ kind, businessId, name, gaps, rejected, onClose }: { kind: Decision; businessId: string; name: string; gaps: number; rejected: number; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  const caveats = [gaps && `the server still sees ${plural(gaps, 'gap')}`, rejected && `${plural(rejected, 'document is', 'documents are')} marked rejected`].filter(Boolean)
  const copy = {
    approve: {
      title: `Approve ${name}`,
      sub: `It goes live: verified, with live payments switched on. The owners get an email.${caveats.length ? ` Careful - ${caveats.join(' and ')}; approving anyway is on the record.` : ''}`,
      label: 'Note for the record (optional)',
      button: 'Approve',
      tone: 'primary' as const,
      password: true,
      noteNeeded: false,
      done: 'Approved. Live mode is on.',
    },
    changes: {
      title: 'Ask for changes',
      sub: 'It goes back to the business with your note - on its Activate page and by email. Everything else it sent is kept.',
      label: 'What needs changing - the business sees this',
      button: 'Send to the business',
      tone: 'primary' as const,
      password: false,
      noteNeeded: true,
      done: 'Sent back with your note.',
    },
    reject: {
      title: `Turn ${name} down`,
      sub: 'It stays unverified, test mode only. The owners get an email with your note.',
      label: 'Why - the business sees this',
      button: 'Turn down',
      tone: 'danger' as const,
      password: true,
      noteNeeded: true,
      done: 'Turned down.',
    },
  }[kind]
  return (
    <ActionPanel title={copy.title} sub={copy.sub} danger={kind === 'reject'}>
      <Field label={copy.label}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} autoFocus={copy.noteNeeded} />
      </Field>
      <Confirm>
        {copy.password && <PasswordInput value={password} onChange={setPassword} />}
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          tone={copy.tone}
          disabled={busy || (copy.password && !password) || (copy.noteNeeded && note.trim().length < 3)}
          onClick={async () => {
            const ok = await run(
              () => biz(`/applications/${businessId}/decision`, { method: 'POST', body: { decision: kind, note: note.trim() || undefined, password: password || undefined } }),
              copy.done,
            )
            if (ok) onClose()
          }}
        >
          {busy ? 'Saving…' : copy.button}
        </Button>
      </Confirm>
      {said && !said.ok && <Said {...said} />}
    </ActionPanel>
  )
}

/* ─── Documents ────────────────────────────────────────────────────── */

const MIME_WORD: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'JPEG', 'image/png': 'PNG' }

function Documents({ required, docs, judging }: { required: { kind: string; label: string }[]; docs: DocRow[]; judging: boolean }) {
  const active = docs.filter((d) => !d.replacedAt)
  const asked = new Set(required.map((r) => r.kind))
  const rows = [
    ...required.map((r) => ({ kind: r.kind, label: r.label, optional: false })),
    // A file for something no longer asked for (the structure changed), or the representative's optional one.
    ...active.filter((d) => !asked.has(d.kind)).map((d) => ({ kind: d.kind, label: d.kind === 'proofOfAddress' ? "Representative's proof of address" : `${d.kind} (not asked for)`, optional: true })),
  ]
  if (rows.length === 0)
    return (
      <p className="px-4 py-6 text-[13px]" style={{ color: C.dim }}>
        No documents - the structure isn't chosen yet.
      </p>
    )
  return (
    <div className="divide-y divide-[#171B12]">
      {rows.map((r) => (
        <DocumentRow
          key={r.kind}
          label={r.label}
          optional={r.optional}
          judging={judging}
          doc={active.find((d) => d.kind === r.kind) ?? null}
          older={docs.filter((d) => d.kind === r.kind && d.replacedAt)}
        />
      ))}
    </div>
  )
}

function DocumentRow({ label, optional, judging, doc, older }: { label: string; optional: boolean; judging: boolean; doc: DocRow | null; older: DocRow[] }) {
  const [viewing, setViewing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const { busy, said, run } = useAction()
  const verdict = (v: 'ACCEPTED' | 'REJECTED', why?: string) =>
    run(() => biz(`/documents/${doc!.id}/verdict`, { method: 'POST', body: { verdict: v, note: why || undefined } }), v === 'ACCEPTED' ? 'Accepted.' : 'Rejected - the business sees your note.')
  return (
    <div className="px-4 py-3.5" style={{ boxShadow: doc?.verdict === 'REJECTED' ? `inset 2px 0 0 ${C.red}` : !doc && !optional ? `inset 2px 0 0 ${C.amber}` : undefined }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium" style={{ color: C.text }}>
              {label}
            </span>
            {optional && <Tag>Optional</Tag>}
            {doc?.verdict === 'ACCEPTED' && <State tone="good">Accepted</State>}
            {doc?.verdict === 'REJECTED' && <State tone="bad">Rejected</State>}
          </div>
          {doc ? (
            <div className="mt-0.5 text-[12.5px] break-words" style={{ color: C.muted }}>
              {doc.filename} · {MIME_WORD[doc.mime] ?? doc.mime} · {bytes(doc.size)} · uploaded <When at={doc.createdAt} />
              {doc.uploadedBy ? ` by ${doc.uploadedBy}` : ''}
            </div>
          ) : (
            <div className="mt-0.5 text-[12.5px]" style={{ color: optional ? C.dim : C.amber }}>
              Not uploaded
            </div>
          )}
          {doc?.verdict && (
            <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
              {doc.verdictNote ? `“${doc.verdictNote}” · ` : ''}
              {doc.reviewedBy} · <When at={doc.reviewedAt} />
            </div>
          )}
        </div>
        {doc && (
          <div className="flex flex-wrap items-center gap-2">
            <Button small onClick={() => setViewing(!viewing)}>
              {viewing ? 'Hide' : 'View'}
            </Button>
            {judging && doc.verdict !== 'ACCEPTED' && (
              <Button small disabled={busy} onClick={() => void verdict('ACCEPTED')}>
                Accept
              </Button>
            )}
            {judging && doc.verdict !== 'REJECTED' && (
              <Button small tone="danger" disabled={busy} onClick={() => setRejecting(!rejecting)}>
                Reject
              </Button>
            )}
          </div>
        )}
      </div>
      {rejecting && doc && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong with it - the business sees this" maxLength={500} className="flex-1 min-w-[220px]" />
          <Button small onClick={() => setRejecting(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            small
            tone="danger"
            disabled={busy || note.trim().length < 3}
            onClick={async () => {
              if (await verdict('REJECTED', note.trim())) {
                setRejecting(false)
                setNote('')
              }
            }}
          >
            Reject
          </Button>
        </div>
      )}
      {said && !said.ok && (
        <div className="mt-2">
          <Said {...said} />
        </div>
      )}
      {viewing && doc && <Viewer doc={doc} />}
      {older.length > 0 && (
        <div className="mt-2 text-[12px]" style={{ color: C.dim }}>
          Replaces {plural(older.length, 'earlier file')}, the last uploaded <When at={older[0]!.createdAt} />.
        </div>
      )}
    </div>
  )
}

/** The file itself, shown in place. Fetched with the admin's token, held only as a local address, let go on close. */
/** A sealed file, opened by the API for this look - used for anything a business sent. */
export function Viewer({ doc }: { doc: Pick<DocRow, 'id' | 'filename' | 'mime'> }) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let url: string | null = null
    let gone = false
    bizFile(`/documents/${doc.id}`)
      .then((f) => {
        if (gone) URL.revokeObjectURL(f.url)
        else {
          url = f.url
          setFile(f)
        }
      })
      .catch((e) => !gone && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc.id])
  return (
    <div className="mt-3 overflow-hidden rounded-lg" style={{ border: `1px solid ${C.line}`, background: '#0D100A' }}>
      {error ? (
        <p className="p-4 text-[13px]" style={{ color: C.red }}>
          {error}
        </p>
      ) : !file ? (
        <div className="flex h-[220px] items-center justify-center text-[13px]" style={{ color: C.dim }}>
          Opening…
        </div>
      ) : doc.mime === 'application/pdf' ? (
        <iframe title={doc.filename} src={file.url} className="block h-[72vh] w-full" />
      ) : (
        <img src={file.url} alt={doc.filename} className="mx-auto block max-h-[78vh] max-w-full" />
      )}
      {file && (
        <div className="flex justify-end gap-4 px-3 py-2 text-[12.5px]" style={{ borderTop: `1px solid ${C.line}` }}>
          <a href={file.url} target="_blank" rel="noreferrer" className="text-[#8B9580] hover:text-[#ECEFE7]">
            Open in a new tab
          </a>
          <a href={file.url} download={doc.filename} className="text-[#8B9580] hover:text-[#ECEFE7]">
            Download
          </a>
        </div>
      )}
    </div>
  )
}

/* ─── Identity and accounts ────────────────────────────────────────── */

function IdentityPanel({ checks, ready }: { checks: IdentityRow[]; ready: boolean }) {
  const c = checks[0] ?? null
  const { busy, said, run } = useAction()
  const warnings = Array.isArray(c?.warnings) ? (c!.warnings as unknown[]).map(String) : []
  return (
    <Panel
      title="Identity"
      sub="The ID document and a liveness check."
      action={
        c &&
        ready && (
          <TextButton disabled={busy} onClick={() => void run(() => biz(`/identity/${c.id}/refresh`, { method: 'POST' }), "The latest answer is in.")}>
            {busy ? 'Asking…' : 'Check again'}
          </TextButton>
        )
      }
    >
      {!c ? (
        <p className="text-[13px] leading-relaxed" style={{ color: C.muted }}>
          Not started.{!ready && " Identity checks aren't connected on this server yet."}
        </p>
      ) : (
        <>
          <Facts
            rows={[
              ['Result', <IdState status={c.status} />],
              ['Provider status', c.providerStatus],
              ['Name', [c.firstName, c.lastName].filter(Boolean).join(' ') || null],
              ['Born', c.dateOfBirth],
              ['ID number', c.documentLast4 ? `•••• ${c.documentLast4}` : null],
              ['Checked', <When at={c.checkedAt} />],
              ['Started by', c.startedBy],
              ['Session', <Copy text={c.sessionId}>{`${c.sessionId.slice(0, 8)}…`}</Copy>],
            ]}
          />
          {warnings.length > 0 && (
            <div className="mt-3 rounded-lg px-3 py-2.5" style={{ background: 'rgba(224,160,99,0.06)', border: '1px solid rgba(224,160,99,0.25)' }}>
              <div className="text-[12.5px] font-medium" style={{ color: C.amber }}>
                The check flagged {plural(warnings.length, 'thing')}
              </div>
              <ul className="mt-1 space-y-0.5 text-[12.5px]" style={{ color: C.muted }}>
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {checks.length > 1 && (
            <p className="mt-3 text-[12px]" style={{ color: C.dim }}>
              {plural(checks.length - 1, 'earlier attempt')}, the first <When at={checks[checks.length - 1]!.createdAt} />.
            </p>
          )}
        </>
      )}
      {said && (
        <div className="mt-2">
          <Said {...said} />
        </div>
      )}
    </Panel>
  )
}

function Banks({ banks }: { banks: Bank[] }) {
  if (banks.length === 0)
    return (
      <p className="text-[13px]" style={{ color: C.amber }}>
        None added yet.
      </p>
    )
  return (
    <div className="space-y-3">
      {banks.map((bk) => (
        <div key={bk.id} className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium" style={{ color: C.text }}>
              {bk.bankName} ••{bk.accountNumber.slice(-4)}
            </span>
            {bk.nameMatches ? <State tone="good">{bk.reviewedAt ? 'Approved' : 'Matches'}</State> : bk.reviewedAt ? <State tone="bad">Turned down</State> : <State tone="warn">Needs a check</State>}
          </div>
          <div className="truncate text-[12.5px]" style={{ color: C.muted }}>
            {bk.accountName}
          </div>
        </div>
      ))}
    </div>
  )
}
