/**
 * Compliance: what we have checked, what is with our team, and anything we
 * still need from the business - each as a task it can finish on its own.
 *
 * "Not needed yet" is deliberate: a director's BVN we will want one day sits
 * there, visible and doable, without ever blocking the account.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, FileText, Fingerprint, Hash, ListChecks, MessageCircle, Rocket, Upload, X } from '@/components/icons'
import { Badge, Button, Card, Drawer, Field, Input, PageHeader, Tabs, Textarea, cx } from '@/components/ui'
import { useSession } from '@/state/session'
import { BVN_ASK, useTasks, type Task, type TaskKind, type TaskState } from '@/state/compliance'
import { ago, date } from '@/lib/format'
import { ApiError, LIVE, api, applicationPath, requestsPath, uploadFile, type ApiApplication, type ApiInfoRequest } from '@/lib/api'
import { reload, useApi } from '@/lib/useApi'
import { SUPPORT_EMAIL } from '@/lib/links'
import { ManualIdentity } from '@/components/ManualIdentity'

/**
 * Live: what the application itself says - nothing to do but activate, a
 * change our team asked for, what's with the team, or what's been checked.
 */
function tasksFrom(a: ApiApplication | null | undefined, verified: boolean, registered: boolean): Task[] {
  const status = a?.application.status ?? 'DRAFT'
  const at = a?.application.reviewedAt ?? a?.application.submittedAt ?? new Date().toISOString()
  const task = (id: string, kind: TaskKind, title: string, ask: string, state: TaskState): Task => ({ id, kind, title, ask, state, updatedAt: at })
  const checked = (state: TaskState, identity: TaskState) => [
    task('details', 'detail', registered ? 'Business details' : 'About you and what you sell', 'Everything you told us when you activated.', state),
    ...(registered ? [task('docs', 'document', 'Registration documents', 'Your CAC filings and proof of business address.', state)] : []),
    task('identity', 'detail', 'Identity check', 'Your ID and a selfie.', identity),
    task('bank', 'detail', 'Settlement bank account', 'An account in the name on your record.', state),
  ]
  if (status === 'APPROVED') return checked('done', 'done')
  // Verified by our team without an application: nothing to do, and no checks to claim.
  if (verified) return []
  // A manual check asked to be redone, or declined, is theirs to do again.
  const idAgain = a?.identity?.method === 'manual' && (a.identity.status === 'DECLINED' || (a.identity.status === 'PENDING' && !!a.identity.submittedAt))
  if (status === 'SUBMITTED' || status === 'IN_REVIEW') return checked('review', a?.identity?.status === 'APPROVED' ? 'done' : idAgain ? 'action' : 'review')
  const note = a?.application.decisionNote
  if (status === 'CHANGES_REQUESTED') return [task('activate', 'activate', 'Our review team asked for a change', note || 'Open activation to see what to change, then send it again.', 'action')]
  if (status === 'REJECTED')
    return [task('activate', 'activate', "Activation wasn't approved", `${note ? `${note} ` : ''}Write to ${SUPPORT_EMAIL} to talk it through.`, 'action')]
  return [task('activate', 'activate', 'Verify your business', 'Tell us who you are and what your business does. Takes a few minutes.', 'action')]
}

const REQUEST_KIND: Record<ApiInfoRequest['kind'], TaskKind> = { TEXT: 'text', FILE: 'document', BVN: 'bvn' }
/** Turned down goes back to the business, with the reason. */
const REQUEST_STATE: Record<ApiInfoRequest['status'], TaskState> = { OPEN: 'action', REJECTED: 'action', ANSWERED: 'review', ACCEPTED: 'done' }

/** Live: whatever our review team has asked for since - a BVN, a written answer, a photo or document. */
function tasksFromRequests(list: ApiInfoRequest[] | undefined): Task[] {
  return (list ?? []).map((r) => ({
    id: `request_${r.id}`,
    requestId: r.id,
    kind: REQUEST_KIND[r.kind],
    title: r.title,
    ask: r.detail || (r.kind === 'BVN' ? BVN_ASK : r.kind === 'FILE' ? 'Upload it here, a PDF, JPEG or PNG.' : 'Write your answer here.'),
    state: REQUEST_STATE[r.status],
    updatedAt: r.reviewedAt ?? r.answeredAt ?? r.askedAt,
    note: r.status === 'REJECTED' ? (r.reviewNote ?? undefined) : undefined,
    sent: r.answer ? (r.answer.hint ?? r.answer.file?.filename ?? r.answer.text ?? undefined) : undefined,
  }))
}

/** Where the application stands, live - for the card at the top. */
function useApplicationStatus() {
  const { business } = useSession()
  const app = useApi<ApiApplication>(LIVE && business ? applicationPath(business.id) : null)
  return app.data?.application.status ?? null
}

/** This business's tasks: live, from what our team asked for and the application; in preview, this browser's samples. */
function useBusinessTasks(): [Task[], (fn: (all: Task[]) => Task[]) => void] {
  const { business } = useSession()
  const [stored = [], setStored] = useTasks(business?.id)
  const app = useApi<ApiApplication>(LIVE && business ? applicationPath(business.id) : null)
  const requests = useApi<{ requests: ApiInfoRequest[] }>(LIVE && business ? requestsPath(business.id) : null)
  if (!LIVE) return [stored, (fn) => setStored((all) => fn(all))]
  if (!business) return [[], () => {}]
  return [[...tasksFromRequests(requests.data?.requests), ...tasksFrom(app.data, business.verify === 'verified', business.type !== 'Individual')], () => {}]
}

/** What the business sends in answer to a task. */
type Answer = { text: string } | { bvn: string } | { file: File }

const ICON: Record<TaskKind, typeof Hash> = { activate: Rocket, bvn: Hash, document: FileText, detail: ListChecks, text: MessageCircle }

const BADGE: Record<TaskState, { tone: 'warn' | 'neutral' | 'info' | 'good'; text: string }> = {
  action: { tone: 'warn', text: 'Needs action' },
  later: { tone: 'neutral', text: 'Not needed yet' },
  review: { tone: 'info', text: 'In review' },
  done: { tone: 'good', text: 'Done' },
}

type Tab = 'action' | 'review' | 'done'

export function Compliance() {
  const { business } = useSession()
  const [tasks, setTasks] = useBusinessTasks()
  const status = useApplicationStatus()
  const appPath = LIVE && business ? applicationPath(business.id) : null
  const app = useApi<ApiApplication>(appPath)
  const idv = app.data?.identity
  // Asked to redo, or declined, after the application went in: the identity panel, right here.
  const idAgain = !!appPath && idv?.method === 'manual' && (idv.status === 'DECLINED' || (idv.status === 'PENDING' && !!idv.submittedAt)) && (status === 'SUBMITTED' || status === 'IN_REVIEW')
  const [tab, setTab] = useState<Tab>('action')
  const [openId, setOpenId] = useState<string | null>(null)
  if (!business) return null

  const by = (s: TaskState) => tasks.filter((t) => t.state === s)
  const open = tasks.find((t) => t.id === openId) ?? null
  const finish = async (task: Task, answer: Answer) => {
    if (LIVE && task.requestId) {
      const path = `${requestsPath(business.id)}/${task.requestId}`
      if ('file' in answer) await uploadFile(`${path}/file`, answer.file)
      else await api('POST', `${path}/answer`, answer)
      await reload(requestsPath(business.id))
      return
    }
    setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, state: 'review' as const, updatedAt: new Date().toISOString() } : t)))
  }

  const state =
    business.verify === 'verified'
      ? { dot: 'bg-good', title: 'Live', sub: 'You can take real payments.' }
      : status === 'CHANGES_REQUESTED'
        ? { dot: 'bg-[#D98E1F]', title: 'Changes requested', sub: 'Our review team asked for a change. Make it in activation and submit again.' }
        : status === 'REJECTED'
          ? { dot: 'bg-red', title: 'Not approved', sub: 'Our review team could not approve this application.' }
          : business.verify === 'review'
            ? { dot: 'bg-[#D98E1F]', title: 'In review', sub: 'Our review team is checking your details, usually within 24 hours.' }
            : { dot: 'bg-dim', title: 'Not activated', sub: 'Test mode only until you activate.' }

  return (
    <>
      <PageHeader title="Compliance" sub="What we've checked, what's with our team, and anything we still need from you." />

      <Card className="mb-7 flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className={cx('size-2.5 rounded-full', state.dot)} />
          <div>
            <div className="text-[15px] font-semibold text-fg">{state.title}</div>
            <div className="text-[13px] text-muted">{state.sub}</div>
          </div>
        </div>
        <div className="ml-auto flex gap-6 text-[13px]">
          {(
            [
              ['Needs action', by('action').length],
              ['In review', by('review').length],
              ['Done', by('done').length],
            ] as const
          ).map(([l, n]) => (
            <div key={l}>
              <div className="display tabular text-[22px] font-semibold text-fg">{n}</div>
              <div className="text-dim">{l}</div>
            </div>
          ))}
        </div>
      </Card>

      {idAgain && appPath && (
        <section className="mb-9">
          <h2 className="mb-1 text-[17px] font-semibold tracking-[-0.01em] text-fg">Your identity check</h2>
          <p className="mb-4 text-[13.5px] text-muted">{idv?.status === 'DECLINED' ? "It couldn't be verified. Start it again below." : 'Redo just what is listed, from your phone or this computer.'}</p>
          <ManualIdentity path={appPath} identity={idv ?? null} reload={() => app.reload()} canManage={business.role === 'OWNER' || business.role === 'ADMIN'} />
        </section>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'action', label: 'Needs your action', badge: by('action').length ? <Badge tone="warn">{by('action').length}</Badge> : undefined },
          { id: 'review', label: 'In review' },
          { id: 'done', label: 'Done' },
        ]}
      />

      {tab === 'action' && (
        <>
          <TaskList tasks={by('action')} onOpen={setOpenId} empty="Nothing needs you right now." />
          {by('later').length > 0 && (
            <>
              <div className="mb-3 mt-9 flex items-center gap-3">
                <span className="text-[13px] font-semibold text-fg">Not needed yet</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <p className="mb-4 text-[13px] text-muted">Nothing here is holding your account back. Do them whenever you like. We'll ask if we need them.</p>
              <TaskList tasks={by('later')} onOpen={setOpenId} />
            </>
          )}
        </>
      )}
      {tab === 'review' && <TaskList tasks={by('review')} onOpen={setOpenId} empty="Nothing is waiting on our team." />}
      {tab === 'done' && <TaskList tasks={by('done')} onOpen={setOpenId} empty="Nothing finished yet." />}

      <TaskDrawer task={open} onClose={() => setOpenId(null)} onSubmit={finish} />
    </>
  )
}

function TaskList({ tasks, onOpen, empty }: { tasks: Task[]; onOpen: (id: string) => void; empty?: string }) {
  const navigate = useNavigate()
  if (tasks.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-5 py-8 text-[13.5px] text-muted">
        <Check className="size-4 text-accent" strokeWidth={3} /> {empty}
      </div>
    )
  }
  return (
    <Card className="divide-y divide-line overflow-hidden">
      {tasks.map((t) => {
        const Icon = ICON[t.kind]
        const todo = t.state === 'action' || t.state === 'later'
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4 transition hover:bg-[#FCFBF8]">
            <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-[9px] border border-line bg-card shadow-[0_1px_2px_rgba(18,18,16,0.05)]', t.state === 'done' ? 'text-accent' : 'text-fg')}>
              <Icon className="size-[18px]" />
            </span>
            <button onClick={() => onOpen(t.id)} className="min-w-0 flex-1 text-left">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-semibold text-fg">{t.title}</span>
                {t.who && <span className="text-[12.5px] text-dim">({t.who.roles})</span>}
                <Badge tone={BADGE[t.state].tone}>{BADGE[t.state].text}</Badge>
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{t.ask}</span>
            </button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => onOpen(t.id)}>
                Details
              </Button>
              {todo && (
                <Button size="sm" variant="primary" onClick={() => (t.kind === 'activate' ? navigate('/verify') : onOpen(t.id))}>
                  {t.kind === 'activate' ? 'Continue' : t.note ? 'Send again' : 'Start'}
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </Card>
  )
}

function TaskDrawer({ task, onClose, onSubmit }: { task: Task | null; onClose: () => void; onSubmit: (task: Task, answer: Answer) => Promise<void> }) {
  const navigate = useNavigate()
  const [bvn, setBvn] = useState('')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  if (!task) return null
  const todo = task.state === 'action' || task.state === 'later'
  const stage = task.state === 'done' ? 3 : task.state === 'review' ? 2 : 0
  const submit = async (answer: Answer) => {
    setBusy(true)
    setError('')
    try {
      await onSubmit(task, answer)
      setBvn('')
      setText('')
      setFile(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't send. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setError('')
    onClose()
  }

  return (
    <Drawer open onClose={close} title="Task">
      <div className="flex items-start gap-3">
        <h2 className="display min-w-0 flex-1 text-[22px] font-semibold leading-tight text-fg">{task.title}</h2>
      </div>
      <div className="mt-2">
        <Badge tone={BADGE[task.state].tone}>{BADGE[task.state].text}</Badge>
      </div>

      {/* Where it is */}
      <ol className="mt-6 grid grid-cols-3 gap-2">
        {['Submitted', 'In review', 'Completed'].map((s, n) => {
          const done = n + 1 < stage || stage === 3
          const now = n + 1 === stage && stage !== 3
          return (
            <li key={s}>
              <div className={cx('h-1 rounded-full', done ? 'bg-lime' : now ? 'bg-fg' : 'bg-raise')} />
              <div className={cx('mt-2 text-[12px]', done || now ? 'font-medium text-fg' : 'text-dim')}>{s}</div>
            </li>
          )
        })}
      </ol>

      <div className="mt-7 space-y-5 text-[13.5px] leading-relaxed">
        {todo && task.note && (
          <div className="rounded-[10px] border border-[#EBD3A6] bg-[#FDF6E7] px-4 py-3">
            <div className="text-[13px] font-semibold text-[#6E440A]">Our review team couldn't accept the last one</div>
            <p className="mt-1 whitespace-pre-line text-[13px] text-[#6E440A]">{task.note}</p>
          </div>
        )}
        <div>
          <div className="font-semibold text-fg">What do I need to do?</div>
          <p className="mt-1 whitespace-pre-line text-muted">{task.ask}</p>
        </div>
        {task.kind === 'bvn' && (
          <div>
            <div className="font-semibold text-fg">Why do you need it?</div>
            <p className="mt-1 text-muted">
              A BVN ties a person to their bank record, which is how we know who's behind every business that takes payments. We only see whether it matches -
              never your accounts or balances.
            </p>
          </div>
        )}
        <div>
          <div className="font-semibold text-fg">How long does review take?</div>
          <p className="mt-1 text-muted">Usually within 24 hours. We email you when it's done.</p>
        </div>
      </div>

      <div className="mt-7 border-t border-line pt-6">
        {task.sent && !todo && (
          <div className="mb-4 rounded-[10px] border border-line bg-raise px-4 py-3 text-[13px]">
            <div className="text-dim">What you sent</div>
            <div className={cx('mt-0.5 whitespace-pre-line break-words text-fg', task.kind === 'bvn' && 'font-mono tracking-wider')}>{task.sent}</div>
          </div>
        )}
        {task.state === 'review' && <p className="text-[13.5px] text-muted">Sent {ago(task.updatedAt)}. Nothing to do. It's with our team.</p>}
        {task.state === 'done' && (
          <p className="flex items-center gap-2 text-[13.5px] text-muted">
            <Check className="size-4 text-accent" strokeWidth={3} /> Completed {date(task.updatedAt)}.
          </p>
        )}

        {todo && task.kind === 'activate' && (
          <Button variant="primary" full size="lg" onClick={() => navigate('/verify')}>
            Continue activation
          </Button>
        )}

        {todo && task.kind === 'bvn' && (
          <>
            {task.who && (
              <div className="mb-5 rounded-[10px] border border-line bg-raise px-4 py-1">
                {[
                  ['Name', task.who.name],
                  ['Role', task.who.roles],
                  ...(task.who.email ? [['Email', task.who.email]] : []),
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between gap-4 border-b border-soft py-2.5 text-[13px] last:border-0">
                    <span className="text-dim">{l}</span>
                    <span className="text-right text-fg first-letter:uppercase">{v}</span>
                  </div>
                ))}
              </div>
            )}
            <Field label="BVN" hint="11 digits. Dial *565*0# on the phone number linked to the bank account.">
              <Input value={bvn} onChange={(e) => setBvn(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="22123456789" inputMode="numeric" className="font-mono tracking-wider" />
            </Field>
            <Button variant="primary" full size="lg" className="mt-5" disabled={bvn.length !== 11 || busy} onClick={() => submit({ bvn })} icon={<Fingerprint className="size-4" />}>
              {busy ? 'Sending…' : 'Submit BVN'}
            </Button>
          </>
        )}

        {todo && task.kind === 'text' && (
          <>
            <Field label="Your answer">
              <Textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 4000))} rows={6} placeholder="Write it here" />
            </Field>
            <Button variant="primary" full size="lg" className="mt-5" disabled={!text.trim() || busy} onClick={() => submit({ text: text.trim() })}>
              {busy ? 'Sending…' : 'Send answer'}
            </Button>
          </>
        )}

        {todo && (task.kind === 'document' || task.kind === 'detail') && (
          <>
            {file ? (
              <div className="flex items-center gap-3 rounded-[10px] border border-fg bg-[#F3FBE6] p-4">
                <FileText className="size-5 text-accent" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{file.name}</span>
                <button onClick={() => setFile(null)} className="p-1 text-dim hover:text-red" aria-label="Remove file">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button onClick={() => ref.current?.click()} className="flex w-full items-center gap-4 rounded-[10px] border border-dashed border-[#CFCCC3] px-5 py-5 text-left hover:bg-raise">
                <span className="flex size-10 items-center justify-center rounded-lg bg-raise text-muted">
                  <Upload className="size-[18px]" />
                </span>
                <span>
                  <span className="block text-[13.5px] font-medium text-fg">Choose a file</span>
                  <span className="block text-[12px] text-dim">JPEG, PNG or PDF, up to 10 MB</span>
                </span>
              </button>
            )}
            <input
              ref={ref}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                if (f && f.size > 10 * 1024 * 1024) return setError('That file is over 10 MB.')
                setError('')
                setFile(f)
              }}
            />
            <Button variant="primary" full size="lg" className="mt-5" disabled={!file || busy} onClick={() => file && submit({ file })}>
              {busy ? 'Uploading…' : 'Submit for review'}
            </Button>
          </>
        )}

        {error && <p className="mt-3 text-[13px] text-red">{error}</p>}
      </div>
    </Drawer>
  )
}

/** How many tasks are waiting on the business - for the banner and the sidebar. */
export function useTasksDue() {
  const [tasks] = useBusinessTasks()
  return tasks.filter((t) => t.state === 'action').length
}
