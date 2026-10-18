/**
 * One settlement: a payout to a business, on its own page.
 *
 * The timeline is the record - every handover to the rail, every answer, every
 * person who touched it. The levers are the ones ops needs when a payout
 * didn't land: ask the rail, send it again (the rail is asked first, so
 * nothing goes twice), or mark it delivered when it got there another way.
 */
import { useState } from 'react'
import { C } from '../ui'
import { biz, BizError, DESTINATION, placeOf, useLoad, type Bank, type Pay, type Settle } from './client'
import {
  ActionPanel,
  Button,
  Confirm,
  Copy,
  Facts,
  Field,
  IdLine,
  Input,
  LinkText,
  naira,
  Notice,
  PageHead,
  PageLoading,
  Panel,
  PasswordInput,
  PayState,
  Problem,
  Ref,
  Said,
  Select,
  SettleState,
  Tag,
  Textarea,
  TextButton,
  Timeline,
  useAction,
  When,
} from './kit'
import { useRecord } from './nav'
import { eventDetail, eventTone, EVENT_WORDS } from './tables'

type Data = { settlement: Settle; payment: Pay; bankAccounts: Bank[] }
const MOVING = new Set(['QUEUED', 'SENDING', 'SENT'])

export function SettlementPage({ id }: { id: string }) {
  // While it's on its way, it reads itself again - so the page shows it land.
  const { data, error, loading, reload } = useLoad<Data>(`/settlements/${id}`, { every: (d) => (MOVING.has(d.settlement.status) ? 3000 : null) })
  const { open } = useRecord()
  const [doing, setDoing] = useState<'resend' | 'mark' | 'approve' | null>(null)
  const check = useAction()
  if (loading && !data) return <PageLoading />
  if (error || !data) return <Problem error={error ?? new BizError('Nothing came back.')} onRetry={() => void reload()} />

  const s = data.settlement
  const p = data.payment
  const here = `Settlement ${s.ref}`
  // Only a payout that went to the rail can be asked about.
  const canCheck = s.destination === 'BANK' && !['QUEUED', 'HELD', 'REVIEW'].includes(s.status)
  const canResend = s.status === 'FAILED' || s.status === 'HELD'
  const inReview = s.status === 'REVIEW'
  // Why it waits: the last time it was held - over the limit, or its business deactivated.
  const heldBecause = [...(s.events ?? [])].reverse().find((e) => e.kind === 'review')?.detail?.reason
  const canMark = canResend || s.stuck || inReview || !!s.paused

  return (
    <div>
      <PageHead
        title={
          <>
            {naira(s.amountNgn)} <span style={{ color: C.muted }}>to {placeOf(s)}</span>
          </>
        }
        meta={[
          <SettleState s={s} />,
          s.mode === 'TEST' && <Tag tone="warn">Test - nothing real moves</Tag>,
          <>
            Created <When at={s.createdAt} />
          </>,
          s.settledAt && (
            <>
              Delivered <When at={s.settledAt} />
            </>
          ),
        ]}
        actions={
          <>
            {canCheck && (
              <Button disabled={check.busy} onClick={() => void check.run(() => biz(`/settlements/${s.id}/check`, { method: 'POST' }), 'Checked - the timeline has what the rail said.')}>
                {check.busy ? 'Asking…' : 'Check with the rail'}
              </Button>
            )}
            {canMark && <Button onClick={() => setDoing(doing === 'mark' ? null : 'mark')}>{inReview ? 'Paid by hand' : 'Mark delivered'}</Button>}
            {inReview && s.destination === 'BANK' && (
              <Button tone="primary" onClick={() => setDoing(doing === 'approve' ? null : 'approve')}>
                Approve and send
              </Button>
            )}
            {canResend && (
              <Button tone="primary" onClick={() => setDoing(doing === 'resend' ? null : 'resend')}>
                Send again
              </Button>
            )}
          </>
        }
      >
        <IdLine
          items={[
            ['Reference', <Copy text={s.ref} />],
            !!s.business && ['Business', <LinkText onClick={() => open('business', s.business!.id, { from: here })}>{s.business.name}</LinkText>],
            ['Payment', <LinkText onClick={() => open('payment', p.id, { from: here })}>{p.ref}</LinkText>],
          ]}
        />
      </PageHead>

      {check.said && (
        <div className="-mt-1 mb-4">
          <Said {...check.said} />
        </div>
      )}
      {doing === 'resend' && <Resend s={s} banks={data.bankAccounts} onClose={() => setDoing(null)} />}
      {doing === 'mark' && <MarkDelivered s={s} onClose={() => setDoing(null)} />}
      {doing === 'approve' && <Approve s={s} onClose={() => setDoing(null)} />}
      {inReview && !doing && (
        <div className="mb-5">
          <Notice tone="warn" title="Waiting for review">
            {heldBecause === 'deactivated'
              ? 'Its business is deactivated, so its payouts wait for a person. Decide whether it should go out: approve it to send it through the rail, or pay it by hand and record it.'
              : "It's bigger than the review limit set in Services, so it waits for a person. Check the payment, then approve it to send it through the rail - or pay it by hand and record it."}{' '}
            The business only sees that it's on its way.
          </Notice>
        </div>
      )}
      {s.failureReason && (
        <div className="mb-5">
          <Notice tone="bad" title="Why it didn't land">
            {s.failureReason}
          </Notice>
        </div>
      )}
      {s.status === 'HELD' && !s.failureReason && (
        <div className="mb-5">
          <Notice tone="warn" title="Held: nowhere to send it">
            The business had no checked bank account (or that way of settling was switched off) when it was paid. Send it again once there's somewhere to send it.
          </Notice>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <Panel title="Timeline" sub="Everything that has happened to this payout, oldest first.">
          <Timeline
            items={(s.events ?? []).map((e) => ({
              id: e.id,
              title: EVENT_WORDS[e.kind] ?? e.kind,
              detail: eventDetail(e.kind, e.detail) || undefined,
              by: e.by === 'system' ? undefined : e.by,
              at: e.at,
              tone: eventTone(e.kind),
            }))}
          />
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.lineSoft}` }}>
            <NoteBox id={s.id} />
          </div>
        </Panel>
        <aside className="space-y-5 min-w-0">
          <Panel title="Details">
            <Facts
              rows={[
                ['Amount', naira(s.amountNgn)],
                ['Our fee', naira(s.feeNgn)],
                ['Goes to', DESTINATION[s.destination]],
                s.destination === 'BANK' && ['Bank', s.bankName],
                s.destination === 'BANK' && ['Account', s.accountNumber ? <Copy text={s.accountNumber} /> : null],
                !!s.accountName && ['Account name', s.accountName],
                ['Mode', s.mode === 'TEST' ? 'Test' : 'Live'],
                ['Created', <When at={s.createdAt} full />],
                !!s.sentAt && ['Sent', <When at={s.sentAt} full />],
                !!s.settledAt && ['Delivered', <When at={s.settledAt} full />],
              ]}
            />
          </Panel>
          <Panel title="The payment" action={<TextButton onClick={() => open('payment', p.id, { from: here })}>Open</TextButton>}>
            <Facts
              rows={[
                ['Reference', <Ref>{p.ref}</Ref>],
                ['State', <PayState status={p.status} />],
                ['Arrived', naira(p.receivedNgn ?? p.amountNgn)],
                ['Paid by', p.payer?.name ?? p.customer.name ?? p.customer.email],
                !!p.payer?.bank && ['From', `${p.payer.bank}${p.payer.account ? ` ••${p.payer.account.slice(-4)}` : ''}`],
                !!p.paidAt && ['Paid', <When at={p.paidAt} />],
              ]}
            />
          </Panel>
        </aside>
      </div>
    </div>
  )
}

function Resend({ s, banks, onClose }: { s: Settle; banks: Bank[]; onClose: () => void }) {
  const [to, setTo] = useState('')
  const [password, setPassword] = useState('')
  // A USDC payout that failed may still have gone out: the server asks for this tick when it can't tell.
  const onChain = s.status === 'FAILED' && !!s.chain
  const [checked, setChecked] = useState(false)
  const { busy, said, run } = useAction()
  return (
    <div className="mb-5">
      <ActionPanel
        title="Send it again"
        sub="The rail is asked first - if the last attempt actually arrived, nothing is sent twice. It goes out under a new reference, and the timeline keeps both."
      >
        <Field label="Send to">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{s.destination === 'BANK' && s.accountNumber ? `The same account (${placeOf(s)})` : "The business's default checked account"}</option>
            {banks.map((bk) => (
              <option key={bk.id} value={bk.id}>
                {bk.bankName} ••{bk.accountNumber.slice(-4)} · {bk.accountName}
                {bk.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {banks.length === 0 && (
          <p className="text-[12.5px]" style={{ color: C.amber }}>
            This business has no checked bank account. Approve one on the business first.
          </p>
        )}
        {onChain && (
          <label className="flex items-start gap-2 text-[12.5px]">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
            <span>I checked the float on {s.chain?.toLowerCase()} and this payout didn't go out. If it did, mark it delivered instead.</span>
          </label>
        )}
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password}
            onClick={async () => {
              if (await run(() => biz(`/settlements/${s.id}/resend`, { method: 'POST', body: { password, bankAccountId: to || undefined, ...(onChain && checked ? { checkedFloat: true } : {}) } }), 'Sent again - watch the timeline.')) onClose()
            }}
          >
            {busy ? 'Sending…' : 'Send'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

function Approve({ s, onClose }: { s: Settle; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  return (
    <div className="mb-5">
      <ActionPanel title={`Approve and send ${naira(s.amountNgn)}`} sub={`It goes to ${placeOf(s)}${s.accountName ? ` (${s.accountName})` : ''} through the rail, now - or as soon as payouts are switched back on.`}>
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password}
            onClick={async () => {
              if (await run(() => biz(`/settlements/${s.id}/approve`, { method: 'POST', body: { password } }), 'Approved - it\'s on its way to the rail.')) onClose()
            }}
          >
            {busy ? 'Sending…' : 'Approve and send'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

function MarkDelivered({ s, onClose }: { s: Settle; onClose: () => void }) {
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [password, setPassword] = useState('')
  const { busy, said, run } = useAction()
  return (
    <div className="mb-5">
      <ActionPanel
        title={s.status === 'REVIEW' ? 'Paid by hand' : 'Mark it delivered'}
        sub={
          s.status === 'REVIEW'
            ? "For a payout you've checked and sent yourself, from the rail's dashboard or the bank. Say how, so the next person can trace it."
            : "For money that reached the business another way - sent by hand from the rail's dashboard, say. Say how, so the next person can trace it."
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Session ID or transfer ID" />
          </Field>
          <Field label="How it was delivered">
            <Textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <Confirm>
          <PasswordInput value={password} onChange={setPassword} />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            tone="primary"
            disabled={busy || !password}
            onClick={async () => {
              const body = { password, reference: reference.trim() || undefined, note: note.trim() || undefined }
              if (await run(() => biz(`/settlements/${s.id}/mark-settled`, { method: 'POST', body }), 'Marked delivered.')) onClose()
            }}
          >
            {busy ? 'Saving…' : 'Mark delivered'}
          </Button>
        </Confirm>
        {said && !said.ok && <Said {...said} />}
      </ActionPanel>
    </div>
  )
}

function NoteBox({ id }: { id: string }) {
  const [text, setText] = useState('')
  const { busy, said, run } = useAction()
  return (
    <div>
      <div className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note to the timeline" maxLength={500} />
        <Button
          disabled={busy || !text.trim()}
          onClick={async () => {
            if (await run(() => biz(`/settlements/${id}/note`, { method: 'POST', body: { note: text.trim() } }), 'Note added.')) setText('')
          }}
        >
          Add note
        </Button>
      </div>
      {said && !said.ok && (
        <div className="mt-2">
          <Said {...said} />
        </div>
      )}
    </div>
  )
}
