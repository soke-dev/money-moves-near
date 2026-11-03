/**
 * ID checks: manual identity checks, decided by the team. Each one is an
 * account representative's ID photos (front, and back unless it's a passport),
 * a selfie and a three second smile video, sent from their phone or computer.
 *
 * The files are decrypted only when opened here, and every opening is in the
 * audit log. Approving and declining take the action password; asking for a
 * redo names the parts to take again and keeps the rest. The person is
 * emailed either way, and never told how it was checked.
 */
import { useEffect, useState } from 'react'
import { C } from '../ui'
import { biz, bizFile, useLoad, type Paged } from './client'
import { ActionPanel, Button, Facts, Field, Input, ListLoading, Notice, Panel, PasswordInput, Problem, Said, Segmented, Table, Tag, Textarea, useAction, When, type Column } from './kit'
import { useRecord } from './nav'

type Status = 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'DECLINED'
type Row = {
  id: string
  status: Status
  idType: string | null
  person: string | null
  email: string | null
  business: { id: string; name: string; kind: string }
  submittedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  tries: number
}
type Detail = {
  check: { id: string; status: Status; idType: string | null; firstName: string | null; lastName: string | null; documentLast4: string | null; submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; reviewNote: string | null; redo: string[]; need: string[]; asked: string[]; createdAt: string }
  person: { name: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }
  business: { id: string; name: string; kind: string; merchantId: string; status: string; legalName: string | null; application: string | null }
  files: { id: string; part: string; mime: string; size: number; createdAt: string }[]
  earlier: { id: string; method: string; status: Status; note: string | null; createdAt: string }[]
}

const ID_WORDS: Record<string, string> = { nin: 'NIN slip or card', passport: 'International passport', licence: "Driver's licence" }
const PART_WORDS: Record<string, string> = { front: 'ID front', back: 'ID back', selfie: 'Selfie', video: 'Smile video' }
const STATUS: Record<Status, [string, 'good' | 'warn' | 'bad' | 'info' | undefined]> = {
  IN_REVIEW: ['Waiting', 'warn'],
  PENDING: ['Redo asked', 'info'],
  APPROVED: ['Approved', 'good'],
  DECLINED: ['Declined', 'bad'],
}
/** What to look at, in order, before deciding. */
const CHECKS = ['Name on the ID matches the account', 'The selfie is the person on the ID', 'The ID is readable and not expired', 'The video is live: they move and smile']

const columns: Column<Row>[] = [
  { key: 'who', head: 'Person', width: 'minmax(0,1.2fr)', cell: (r) => <span className="font-medium">{r.person ?? r.email ?? 'Unknown'}</span>, phone: 'title' },
  { key: 'biz', head: 'Business', cell: (r) => <span style={{ color: C.muted }}>{r.business.name}</span>, phone: 'sub' },
  { key: 'id', head: 'ID', width: '170px', cell: (r) => <span style={{ color: C.muted }}>{r.idType ? ID_WORDS[r.idType] : 'Not chosen'}{r.tries > 1 ? ` · try ${r.tries}` : ''}</span>, phone: 'hide' },
  { key: 'state', head: 'State', width: '120px', cell: (r) => <Tag tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Tag> },
  { key: 'when', head: 'Sent', width: '110px', align: 'right', cell: (r) => <When at={r.submittedAt ?? r.reviewedAt} />, phone: 'meta' },
]

const VIEWS = [
  ['waiting', 'Waiting'],
  ['redo', 'Redo asked'],
  ['approved', 'Approved'],
  ['declined', 'Declined'],
] as const

export function IdentityChecks() {
  const [view, setView] = useState<string>('waiting')
  const [picked, setPicked] = useState<string | null>(null)
  const [done, setDone] = useState('')
  // New checks arrive while the queue is open: look again every 20 seconds.
  const { data, error, loading, reload } = useLoad<{ checks: Row[]; counts: { waiting: number; redo: number } } & Paged>(`/identity-checks?view=${view}`, { every: () => 20_000 })
  const items = VIEWS.map(([k, label]) => [k, label, k === 'waiting' ? data?.counts.waiting : k === 'redo' ? data?.counts.redo : undefined] as const)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={(v) => { setView(v); setPicked(null); setDone('') }} items={items as unknown as readonly (readonly [string, string, number?])[]} />
      </div>
      {done && <Notice tone="good" title={done} />}
      {picked && <Review key={picked} id={picked} onClose={() => setPicked(null)} onDone={(words) => { setPicked(null); setDone(words); void reload() }} />}
      <Panel flush>
        {loading && !data ? (
          <ListLoading />
        ) : error ? (
          <Problem error={error} onRetry={() => void reload()} />
        ) : (
          <Table
            busy={loading}
            rows={data?.checks ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            flag={(r) => (r.status === 'IN_REVIEW' ? 'warn' : undefined)}
            onRow={(r) => setPicked(r.id === picked ? null : r.id)}
            empty={view === 'waiting' ? 'Nothing waiting. Every check that was sent has been decided.' : 'None of those.'}
          />
        )}
      </Panel>
    </div>
  )
}

/** One decrypted file: a photo, or the video with its controls. */
function Media({ file, label }: { file: Detail['files'][number] | undefined; label: string }) {
  const [src, setSrc] = useState<{ url: string; type: string } | null>(null)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    if (!file) return
    let url: string | null = null
    let gone = false
    bizFile(`/identity-files/${file.id}`)
      .then((f) => {
        url = f.url
        if (gone) URL.revokeObjectURL(f.url)
        else setSrc(f)
      })
      .catch((e: Error) => !gone && setFailed(e.message))
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [file])
  const video = file?.part === 'video'
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="flex items-center justify-center overflow-hidden rounded-[10px]" style={{ background: C.raise, height: 170 }}>
        {!file ? (
          <span className="text-[12.5px]" style={{ color: C.dim }}>Not sent</span>
        ) : failed ? (
          <span className="px-3 text-center text-[12.5px]" style={{ color: C.red }}>{failed}</span>
        ) : !src ? (
          <span className="text-[12.5px]" style={{ color: C.dim }}>Opening…</span>
        ) : video ? (
          <video src={src.url} controls playsInline className="h-full w-full object-contain" />
        ) : (
          <a href={src.url} target="_blank" rel="noreferrer" className="h-full w-full">
            <img src={src.url} alt={label} className="h-full w-full object-contain" />
          </a>
        )}
      </div>
      <figcaption className="flex justify-between text-[12.5px]" style={{ color: C.muted }}>
        <span>{label}</span>
        {file && <When at={file.createdAt} />}
      </figcaption>
    </figure>
  )
}

function Review({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (words: string) => void }) {
  const { data, error, loading, reload } = useLoad<Detail>(`/identity-checks/${id}`)
  const { open } = useRecord()
  const [ticks, setTicks] = useState<boolean[]>(CHECKS.map(() => false))
  const [parts, setParts] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const [doing, setDoing] = useState<'approve' | 'redo' | 'decline' | null>(null)
  const [first, setFirst] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const [docNo, setDocNo] = useState('')
  const { busy, said, run } = useAction()
  if (loading && !data) return <ListLoading />
  if (error) return <Problem error={error} onRetry={() => void reload()} />
  if (!data) return null
  const c = data.check
  // The name as it reads on the ID: starts as the name on the account, corrected here to match.
  const firstName = first ?? data.person.firstName ?? ''
  const lastName = last ?? data.person.lastName ?? ''
  const docOk = /^[A-Za-z0-9]{6,20}$/.test(docNo.replace(/[\s-]/g, ''))
  const named = firstName.trim().length > 0 && lastName.trim().length > 0 && docOk
  const docLabel = c.idType === 'passport' ? 'Passport number' : c.idType === 'licence' ? "Licence number" : 'NIN'
  const waiting = c.status === 'IN_REVIEW'
  const fileOf = (part: string) => data.files.find((f) => f.part === part)
  const decide = async (decision: 'approve' | 'redo' | 'decline') => {
    const body = { decision, ...(decision === 'redo' ? { parts } : {}), ...(decision === 'approve' ? { firstName: firstName.trim(), lastName: lastName.trim(), documentNumber: docNo.trim() } : {}), note: note.trim() || undefined, ...(decision !== 'redo' ? { password } : {}) }
    const words = decision === 'approve' ? 'Approved. They have been emailed.' : decision === 'redo' ? 'Sent back. They have been emailed what to redo.' : 'Declined. They have been emailed.'
    const who = data.person.name ?? data.person.email ?? 'They'
    if (await run(() => biz(`/identity-checks/${c.id}/decision`, { method: 'POST', body }), words)) onDone(`${who}: ${words}`)
  }
  const allTicked = ticks.every(Boolean)
  return (
    <ActionPanel
      title={data.person.name ?? data.person.email ?? 'Identity check'}
      sub={
        <>
          Account representative for{' '}
          <button className="underline underline-offset-2" onClick={() => open('business', data.business.id, { from: 'ID checks' })}>
            {data.business.name}
          </button>{' '}
          · {data.person.email}
          {data.person.phone ? ` · ${data.person.phone}` : ''}
        </>
      }
    >
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {c.need.map((p) => (
              <Media key={p} file={fileOf(p)} label={PART_WORDS[p] ?? p} />
            ))}
          </div>
          {waiting && (
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="m-0 space-y-2.5 rounded-xl p-4" style={{ border: `1px solid ${C.line}` }}>
                <legend className="px-1.5 text-[12.5px]" style={{ color: C.muted }}>Checked</legend>
                {CHECKS.map((t, i) => (
                  <label key={t} className="flex items-center gap-2.5 text-[13.5px]">
                    <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks(ticks.map((x, j) => (j === i ? e.target.checked : x)))} style={{ accentColor: C.lime, width: 16, height: 16 }} />
                    {t}
                  </label>
                ))}
              </fieldset>
              <fieldset className="m-0 space-y-2.5 rounded-xl p-4" style={{ border: `1px solid ${C.line}` }}>
                <legend className="px-1.5 text-[12.5px]" style={{ color: C.muted }}>To take again, if asking for a redo</legend>
                <div className="flex flex-wrap gap-1.5">
                  {c.need.map((p) => {
                    const on = parts.includes(p)
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setParts(on ? parts.filter((x) => x !== p) : [...parts, p])}
                        className="rounded-full px-3 py-1.5 text-[12.5px] font-medium"
                        style={on ? { background: C.text, color: C.bg } : { border: `1px solid ${C.line}`, color: C.muted }}
                        aria-pressed={on}
                      >
                        {PART_WORDS[p] ?? p}
                      </button>
                    )
                  })}
                </div>
                <Field label="Note they'll see (optional for a redo, needed to decline)">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="We can't read your date of birth on the ID." />
                </Field>
              </fieldset>
            </div>
          )}
        </div>
        <aside className="min-w-0 space-y-4">
          <Facts
            rows={[
              ['State', <Tag tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Tag>],
              ['ID', c.idType ? ID_WORDS[c.idType] : 'Not chosen'],
              ['Name on account', data.person.name ?? <span style={{ color: C.dim }}>None given</span>],
              !!c.documentLast4 && ['ID number', `•••• ${c.documentLast4}`],
              c.status === 'APPROVED' && !!c.firstName && ['Name on ID', `${c.firstName} ${c.lastName ?? ''}`.trim()],
              !!data.business.legalName && ['Registered name', data.business.legalName],
              ['Merchant ID', data.business.merchantId],
              ['Sent', <When at={c.submittedAt} />],
              !!c.reviewedBy && ['Decided by', c.reviewedBy],
              !!c.reviewNote && ['Note sent', c.reviewNote],
              c.redo.length > 0 && ['Asked to redo', c.redo.map((p) => PART_WORDS[p] ?? p).join(', ')],
            ]}
          />
          {data.earlier.length > 0 && (
            <div className="text-[12.5px]" style={{ color: C.muted }}>
              Earlier checks: {data.earlier.map((e) => `${STATUS[e.status][0].toLowerCase()} (${e.method})`).join(', ')}
            </div>
          )}
        </aside>
      </div>

      {waiting ? (
        <div className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: C.line }}>
          <div className="flex flex-wrap gap-2">
            <Button tone="primary" disabled={busy} onClick={() => setDoing(doing === 'approve' ? null : 'approve')}>
              Approve
            </Button>
            <Button disabled={busy || parts.length === 0} onClick={() => void decide('redo')}>
              {busy && doing === null ? 'Sending…' : `Ask to redo${parts.length ? ` ${parts.length}` : ''}`}
            </Button>
            <Button disabled={busy} onClick={() => setDoing(doing === 'decline' ? null : 'decline')}>
              Decline
            </Button>
            <div className="flex-1" />
            <Button onClick={onClose}>Close</Button>
          </div>
          {doing === 'approve' && !allTicked && <Notice tone="warn" title="Not everything is ticked">Approve only once every check above holds.</Notice>}
          {doing === 'approve' && (
            <div className="grid max-w-xl gap-3 sm:grid-cols-2">
              <Field label="First name, as on the ID">
                <Input name="firstName" autoComplete="off" value={firstName} onChange={(e) => setFirst(e.target.value)} maxLength={80} />
              </Field>
              <Field label="Last name, as on the ID">
                <Input name="lastName" autoComplete="off" value={lastName} onChange={(e) => setLast(e.target.value)} maxLength={80} />
              </Field>
              <Field label={`${docLabel}, as on the ID`}>
                <Input name="documentNumber" autoComplete="off" value={docNo} onChange={(e) => setDocNo(e.target.value.toUpperCase())} maxLength={40} className="font-mono" />
              </Field>
              <div />
              <p className="text-[12.5px] sm:col-span-2" style={{ color: C.dim }}>Only the last four characters of the number are kept. The name becomes the name on their profile{data.person.name && `${firstName.trim()} ${lastName.trim()}` !== data.person.name ? `, replacing "${data.person.name}"` : ''}.</p>
            </div>
          )}
          {(doing === 'approve' || doing === 'decline') && (
            <div className="flex flex-wrap items-center gap-2">
              <PasswordInput value={password} onChange={setPassword} />
              <Button tone="primary" disabled={busy || !password || (doing === 'decline' && note.trim().length < 3) || (doing === 'approve' && !named)} onClick={() => void decide(doing)}>
                {busy ? 'Saving…' : doing === 'approve' ? 'Approve identity' : 'Decline identity'}
              </Button>
              {doing === 'decline' && note.trim().length < 3 && <span className="text-[12.5px]" style={{ color: C.dim }}>Write the note they'll see first.</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5 flex gap-2 border-t pt-4" style={{ borderColor: C.line }}>
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
      {said && <div className="mt-3"><Said {...said} /></div>}
    </ActionPanel>
  )
}
