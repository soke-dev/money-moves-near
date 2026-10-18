/**
 * Asking a business for more, after (or alongside) its application: a BVN, a
 * written answer, or a photo or document. The business is emailed and sees it
 * as a task in Compliance - it never pauses the account by itself. Answers
 * come back here to accept, or to turn down with a note the business sees.
 *
 * A BVN is sealed like a document: only its last four digits show until
 * someone opens it, and every opening is written to the business's activity.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, useLoad, type InfoRequestRow } from './client'
import { ActionPanel, Button, Confirm, Copy, Field, Input, ListLoading, Panel, Problem, Said, Segmented, State, Tag, Textarea, When, bytes, useAction, type Tone } from './kit'
import { Viewer } from './Application'

type Kind = InfoRequestRow['kind']

const KINDS = [
  ['BVN', 'BVN'],
  ['TEXT', 'Written answer'],
  ['FILE', 'Photo or document'],
] as const

const KIND_WORD: Record<Kind, string> = { BVN: 'BVN', TEXT: 'Written answer', FILE: 'Photo or document' }

const STATUS: Record<InfoRequestRow['status'], [Tone, string]> = {
  OPEN: ['warn', 'Waiting for them'],
  ANSWERED: ['info', 'Answered - needs you'],
  ACCEPTED: ['good', 'Accepted'],
  REJECTED: ['warn', 'Sent back'],
  CANCELLED: ['idle', 'Withdrawn'],
}

/** What each kind asks, before the team writes its own words. */
const PLACEHOLDER: Record<Kind, { title: string; detail: string }> = {
  BVN: { title: 'Your BVN', detail: 'Anything they should know - whose BVN, and why.' },
  TEXT: { title: 'e.g. Where do your customers come from?', detail: 'Say exactly what you need to know.' },
  FILE: { title: 'e.g. A photo of your shop front', detail: 'Say what the photo or document should show, and how recent it should be.' },
}

export function InfoRequests({ businessId, name }: { businessId: string; name: string }) {
  const { data, error, loading, reload } = useLoad<{ requests: InfoRequestRow[] }>(`/businesses/${businessId}/requests`)
  const [asking, setAsking] = useState(false)
  const list = data?.requests ?? []
  const shown = list.filter((r) => r.status !== 'CANCELLED')
  const withdrawn = list.length - shown.length
  const [showWithdrawn, setShowWithdrawn] = useState(false)

  return (
    <Panel
      title="Asked for since"
      sub={`Anything more you need from ${name}. They're emailed and see it in Compliance - it doesn't pause the account.`}
      action={
        !asking && (
          <Button small tone="primary" onClick={() => setAsking(true)}>
            Ask for something
          </Button>
        )
      }
    >
      {asking && <AskForm businessId={businessId} onDone={() => setAsking(false)} />}
      {loading && !data ? (
        <ListLoading />
      ) : error && !data ? (
        <Problem error={error} onRetry={() => void reload()} />
      ) : shown.length === 0 && !asking ? (
        <p className="py-2 text-[13px]" style={{ color: C.dim }}>
          Nothing asked for yet.
        </p>
      ) : (
        <div className={asking ? 'mt-4' : ''}>
          <div className="overflow-hidden rounded-xl" style={{ border: `1px solid ${C.line}` }}>
            {(showWithdrawn ? list : shown).map((r, i) => (
              <div key={r.id} style={{ borderTop: i ? `1px solid ${C.line}` : undefined }}>
                <RequestRow r={r} />
              </div>
            ))}
          </div>
          {withdrawn > 0 && (
            <button type="button" onClick={() => setShowWithdrawn(!showWithdrawn)} className="mt-2.5 text-[12.5px] text-[#8B9580] hover:text-[#ECEFE7]">
              {showWithdrawn ? 'Hide withdrawn' : `Show ${withdrawn} withdrawn`}
            </button>
          )}
        </div>
      )}
    </Panel>
  )
}

function AskForm({ businessId, onDone }: { businessId: string; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>('BVN')
  const [title, setTitle] = useState('Your BVN')
  const [detail, setDetail] = useState('')
  const { busy, said, run } = useAction()
  const pick = (k: Kind) => {
    setKind(k)
    // The BVN's title writes itself; the others are the team's own words.
    if (k === 'BVN' && !title.trim()) setTitle('Your BVN')
    if (k !== 'BVN' && title === 'Your BVN') setTitle('')
  }
  const send = async () => {
    const ok = await run(
      () => biz(`/businesses/${businessId}/requests`, { method: 'POST', body: { kind, title: title.trim(), detail: detail.trim() || undefined } }),
      'Sent - they have an email and a task in Compliance.',
    )
    if (ok) onDone()
  }
  return (
    <ActionPanel title="Ask for something" sub="Whatever you write is what they see, in the email and in Compliance.">
      <Field label="What you need">
        <Segmented value={kind} onChange={pick} items={KINDS} />
      </Field>
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder={PLACEHOLDER[kind].title} />
      </Field>
      <Field label="Details" hint="Optional.">
        <Textarea value={detail} onChange={(e) => setDetail(e.target.value.slice(0, 2000))} rows={3} placeholder={PLACEHOLDER[kind].detail} />
      </Field>
      <Confirm>
        <Button onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button tone="primary" onClick={() => void send()} disabled={busy || title.trim().length < 3}>
          {busy ? 'Sending…' : 'Send request'}
        </Button>
      </Confirm>
      {said && !said.ok && <Said {...said} />}
    </ActionPanel>
  )
}

function RequestRow({ r }: { r: InfoRequestRow }) {
  const [viewing, setViewing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [note, setNote] = useState('')
  const [bvn, setBvn] = useState<string | null>(null)
  const { busy, said, run } = useAction()
  const [tone, word] = STATUS[r.status]
  const file = r.answer?.file ?? null
  const decide = (decision: 'accept' | 'reject') =>
    run(() => biz(`/requests/${r.id}/decision`, { method: 'POST', body: { decision, note: decision === 'reject' ? note.trim() : undefined } }), decision === 'accept' ? 'Accepted.' : 'Sent back - they see your note.')
  const showBvn = () =>
    run(async () => setBvn((await biz<{ bvn: string }>(`/requests/${r.id}/bvn`)).bvn), 'Opened - this look is in the activity.')

  return (
    <div className="px-4 py-3.5" style={{ boxShadow: r.status === 'ANSWERED' ? `inset 2px 0 0 ${C.blue}` : undefined }}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[260px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium" style={{ color: C.text }}>
              {r.title}
            </span>
            <Tag>{KIND_WORD[r.kind]}</Tag>
            <State tone={tone}>{word}</State>
          </div>
          {r.detail && (
            <p className="mt-0.5 whitespace-pre-line break-words text-[12.5px] leading-relaxed" style={{ color: C.muted }}>
              {r.detail}
            </p>
          )}
          <div className="mt-0.5 text-[12px]" style={{ color: C.dim }}>
            Asked by {r.askedBy} · <When at={r.askedAt} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {r.status === 'ANSWERED' && !rejecting && (
            <>
              <Button small disabled={busy} onClick={() => void decide('accept')}>
                Accept
              </Button>
              <Button small tone="danger" disabled={busy} onClick={() => setRejecting(true)}>
                Send back
              </Button>
            </>
          )}
          {r.status !== 'ACCEPTED' && r.status !== 'CANCELLED' && !withdrawing && !rejecting && (
            <Button small disabled={busy} onClick={() => setWithdrawing(true)}>
              Withdraw
            </Button>
          )}
        </div>
      </div>

      {r.answer && (
        <div className="mt-3 rounded-lg px-3.5 py-3" style={{ background: '#0F120C', border: `1px solid ${C.line}` }}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]" style={{ color: C.dim }}>
            <span>Their answer</span>
            {r.answeredAt && <When at={r.answeredAt} />}
          </div>
          {r.answer.text && (
            <p className="mt-1 whitespace-pre-line break-words text-[13.5px] leading-relaxed" style={{ color: C.text }}>
              {r.answer.text}
            </p>
          )}
          {r.kind === 'BVN' && r.answer.hint && (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="font-mono text-[14px] tracking-wider" style={{ color: C.text }}>
                {bvn ?? r.answer.hint}
              </span>
              {bvn ? (
                <Copy text={bvn} />
              ) : (
                <Button small disabled={busy} onClick={() => void showBvn()}>
                  Show
                </Button>
              )}
            </div>
          )}
          {file && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 break-words text-[13px]" style={{ color: C.text }}>
                {file.filename} <span style={{ color: C.dim }}>· {bytes(file.size)}</span>
              </span>
              <Button small onClick={() => setViewing(!viewing)}>
                {viewing ? 'Hide' : 'View'}
              </Button>
            </div>
          )}
          {viewing && file && <Viewer doc={file} />}
        </div>
      )}

      {r.reviewNote && r.status === 'REJECTED' && (
        <div className="mt-2 text-[12px]" style={{ color: C.dim }}>
          Sent back: “{r.reviewNote}”{r.reviewedBy ? ` · ${r.reviewedBy}` : ''} {r.reviewedAt && <When at={r.reviewedAt} />}
        </div>
      )}
      {r.status === 'ACCEPTED' && r.reviewedBy && (
        <div className="mt-2 text-[12px]" style={{ color: C.dim }}>
          Accepted by {r.reviewedBy} · <When at={r.reviewedAt} />
        </div>
      )}

      {rejecting && (
        <div className="mt-3 space-y-2.5">
          <Field label="What's wrong" hint="They see this and send it again.">
            <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="e.g. The photo is blurred - send a clearer one." />
          </Field>
          <Confirm>
            <Button small onClick={() => setRejecting(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              small
              tone="danger"
              disabled={busy || !note.trim()}
              onClick={async () => {
                if (await decide('reject')) setRejecting(false)
              }}
            >
              Send back
            </Button>
          </Confirm>
        </div>
      )}

      {withdrawing && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3.5 py-2.5" style={{ border: `1px solid ${C.line}` }}>
          <span className="text-[12.5px]" style={{ color: C.muted }}>
            Withdraw it? It leaves their Compliance.
          </span>
          <Confirm>
            <Button small onClick={() => setWithdrawing(false)} disabled={busy}>
              Keep it
            </Button>
            <Button
              small
              tone="danger"
              disabled={busy}
              onClick={async () => {
                if (await run(() => biz(`/requests/${r.id}/cancel`, { method: 'POST' }), 'Withdrawn.')) setWithdrawing(false)
              }}
            >
              Withdraw
            </Button>
          </Confirm>
        </div>
      )}

      {said && (said.ok ? said.text.startsWith('Opened') : true) && (
        <div className="mt-2">
          <Said {...said} />
        </div>
      )}
    </div>
  )
}
