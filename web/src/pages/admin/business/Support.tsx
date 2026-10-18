/**
 * Support: the help chat from the dashboard, answered here, live.
 *
 * Conversations down the left, newest first, with what's unread; the open one
 * on the right. New messages, "seen" and closes arrive the moment they happen,
 * and while this page is open every business's chat says the team is here.
 * Text, photos and PDFs both ways. Whoever isn't there is emailed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { C } from '../ui'
import { biz, bizBeacon, bizFile, bizListen, bizUpload, BizError, type ChatMessage, type ChatThread } from './client'
import { Button, LinkText, ListLoading, Problem, SearchBox, Segmented, Tag, When, bytes } from './kit'
import { useRecord } from './nav'

type View = 'open' | 'closed' | 'all'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' })
const who = (t: ChatThread) => t.business?.name ?? t.person.name ?? t.person.email
const snippet = (m: ChatMessage | null) => (!m ? 'No messages yet' : `${m.from === 'TEAM' ? 'You: ' : ''}${m.text ?? (m.file?.mime?.startsWith('image/') ? 'Sent a photo' : 'Sent a file')}`)

export function Support() {
  const [view, setView] = useState<View>('open')
  const [q, setQ] = useState('')
  const [threads, setThreads] = useState<ChatThread[] | null>(null)
  const [counts, setCounts] = useState({ open: 0, closed: 0, waiting: 0 })
  const [error, setError] = useState<BizError | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  // The conversation on screen gets new messages from the stream too.
  const [incoming, setIncoming] = useState<{ type: string; [k: string]: unknown } | null>(null)

  const loadList = useCallback(async () => {
    try {
      const r = await biz<{ threads: ChatThread[]; counts: typeof counts }>(`/support/threads?view=${view}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
      setThreads(r.threads)
      setCounts(r.counts)
      setError(null)
    } catch (e) {
      setError(e instanceof BizError ? e : new BizError(String(e)))
    }
  }, [view, q])

  useEffect(() => {
    const t = setTimeout(() => void loadList(), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadList, q])

  useEffect(
    () =>
      bizListen(
        '/support/stream',
        (e) => {
          setIncoming(e)
          if (e.type === 'message' || e.type === 'thread') {
            const t = e.thread as ChatThread
            setThreads((all) => {
              if (!all) return all
              const rest = all.filter((x) => x.id !== t.id)
              const fits = view === 'all' || (view === 'open' ? t.status === 'OPEN' : t.status === 'CLOSED')
              return fits ? [t, ...rest].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)) : rest
            })
          }
          if (e.type === 'read' && e.side === 'USER') setThreads((all) => all?.map((x) => (x.id === e.threadId ? { ...x, userReadAt: String(e.at) } : x)) ?? all)
        },
        (up) => {
          setConnected(up)
          if (up) void loadList()
        },
      ),
    [view, loadList],
  )

  // While this page is open and on screen, businesses see the team is here. A hidden tab stops saying so.
  useEffect(() => {
    const page = Math.random().toString(36).slice(2, 12)
    const ping = () => document.visibilityState === 'visible' && void biz('/support/here', { method: 'POST', body: { page } }).catch(() => {})
    ping()
    const t = setInterval(ping, 25_000)
    const away = () => bizBeacon('/support/away', { page })
    document.addEventListener('visibilitychange', ping)
    window.addEventListener('pagehide', away)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', ping)
      window.removeEventListener('pagehide', away)
      away()
    }
  }, [])

  const selected = threads?.find((t) => t.id === openId) ?? null

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ color: C.muted }}>
        {connected ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ background: C.lime }} /> Live - while this is open, businesses see the team is here
          </span>
        ) : (
          <span>Connecting…</span>
        )}
        {counts.waiting > 0 && <span>· {counts.waiting} waiting for a reply</span>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v)
            setOpenId(null)
          }}
          items={[
            ['open', 'Open', counts.open],
            ['closed', 'Resolved', counts.closed],
            ['all', 'All'],
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Search by business or email" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={openId ? 'max-lg:hidden' : ''}>
          <div className="overflow-hidden rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            {error && !threads ? (
              <Problem error={error} onRetry={() => void loadList()} />
            ) : !threads ? (
              <ListLoading />
            ) : threads.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px]" style={{ color: C.dim }}>
                {view === 'open' ? 'No open conversations. New ones show up here the moment someone writes.' : view === 'closed' ? 'Nothing resolved yet.' : 'Nothing here.'}
              </p>
            ) : (
              threads.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => setOpenId(t.id)}
                  className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                  style={{ borderTop: i ? `1px solid ${C.line}` : undefined, background: t.id === openId ? C.raise : undefined, boxShadow: t.unread ? `inset 2px 0 0 ${C.lime}` : undefined }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13.5px]" style={{ color: C.text, fontWeight: t.unread ? 600 : 500 }}>
                      {who(t)}
                    </span>
                    <span className="shrink-0 text-[11.5px]" style={{ color: C.dim }}>
                      <When at={t.lastAt} />
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: t.unread ? C.text : C.muted }}>
                      {snippet(t.last)}
                    </span>
                    {t.unread > 0 && (
                      <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-[18px]" style={{ background: C.lime, color: '#0A0C08' }}>
                        {t.unread}
                      </span>
                    )}
                  </div>
                  {t.business && (
                    <div className="mt-0.5 truncate text-[11.5px]" style={{ color: C.dim }}>
                      {t.person.email}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className={!openId ? 'max-lg:hidden' : ''}>
          {selected ? (
            <Conversation key={selected.id} summary={selected} incoming={incoming} onBack={() => setOpenId(null)} onChanged={(t) => setThreads((all) => all?.map((x) => (x.id === t.id ? t : x)) ?? all)} />
          ) : (
            <div className="flex h-[min(640px,calc(100vh-220px))] items-center justify-center rounded-xl text-[13px]" style={{ background: C.card, border: `1px solid ${C.line}`, color: C.dim }}>
              Pick a conversation to read it and reply.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Conversation({
  summary,
  incoming,
  onBack,
  onChanged,
}: {
  summary: ChatThread
  incoming: { type: string; [k: string]: unknown } | null
  onBack: () => void
  onChanged: (t: ChatThread) => void
}) {
  const { open } = useRecord()
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [error, setError] = useState<BizError | null>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await biz<{ thread: ChatThread; messages: ChatMessage[] }>(`/support/threads/${summary.id}`)
      setMessages(r.messages)
      onChanged(r.thread)
    } catch (e) {
      setError(e instanceof BizError ? e : new BizError(String(e)))
    }
  }, [summary.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load()
  }, [load])

  // A correction made in another tab shows here too.
  useEffect(() => {
    if (!incoming || incoming.type !== 'edited') return
    const m = incoming.message as ChatMessage
    setMessages((all) => all?.map((x) => (x.id === m.id ? m : x)) ?? all)
  }, [incoming])

  // New messages here arrive while it's open - and are read, since it's on screen.
  useEffect(() => {
    if (!incoming || incoming.type !== 'message') return
    const m = incoming.message as ChatMessage
    if (m.threadId !== summary.id) return
    setMessages((all) => (all && !all.some((x) => x.id === m.id) ? [...all, m] : all))
    if (m.from === 'USER' && document.visibilityState === 'visible') {
      void biz(`/support/threads/${summary.id}/read`, { method: 'POST' }).then(() => onChanged({ ...(incoming.thread as ChatThread), unread: 0 })).catch(() => {})
    }
  }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  const preview = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function send() {
    const body = text.trim()
    if ((!body && !file) || busy) return
    setBusy(true)
    setSaid('')
    try {
      const r = file
        ? await bizUpload<{ message: ChatMessage }>(`/support/threads/${summary.id}/files`, file, body || undefined)
        : await biz<{ message: ChatMessage }>(`/support/threads/${summary.id}/messages`, { method: 'POST', body: { text: body } })
      setMessages((all) => (all && !all.some((x) => x.id === r.message.id) ? [...all, r.message] : all))
      setText('')
      setFile(null)
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editing || !editing.text.trim()) return
    setBusy(true)
    setSaid('')
    try {
      const r = await biz<{ message: ChatMessage }>(`/support/messages/${editing.id}`, { method: 'PATCH', body: { text: editing.text.trim() } })
      setMessages((all) => all?.map((x) => (x.id === r.message.id ? r.message : x)) ?? all)
      setEditing(null)
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(to: 'close' | 'reopen') {
    setBusy(true)
    try {
      const r = await biz<{ thread: ChatThread }>(`/support/threads/${summary.id}/${to}`, { method: 'POST' })
      onChanged(r.thread)
    } catch (e) {
      setSaid(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const lastTeam = [...(messages ?? [])].reverse().find((m) => m.from === 'TEAM')
  const seen = !!lastTeam && !!summary.userReadAt && Date.parse(summary.userReadAt) >= Date.parse(lastTeam.at)

  return (
    <div className="flex h-[min(680px,calc(100vh-200px))] min-h-[420px] flex-col overflow-hidden rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        <button onClick={onBack} className="text-[13px] lg:hidden" style={{ color: C.muted }}>
          ← All
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {summary.business ? (
              <LinkText onClick={() => open('business', summary.business!.id)}>{summary.business.name}</LinkText>
            ) : (
              <span className="text-[14px] font-medium" style={{ color: C.text }}>
                No business yet
              </span>
            )}
            {summary.status === 'CLOSED' && <Tag tone="good">Resolved</Tag>}
          </div>
          <div className="mt-0.5 truncate text-[12.5px]" style={{ color: C.muted }}>
            {summary.person.name ? `${summary.person.name} · ` : ''}
            {summary.person.email}
            {summary.business ? ` · ${summary.business.merchantId}` : ''}
          </div>
        </div>
        {summary.status === 'OPEN' ? (
          <Button small disabled={busy} onClick={() => void setStatus('close')}>
            Mark resolved
          </Button>
        ) : (
          <Button small disabled={busy} onClick={() => void setStatus('reopen')}>
            Reopen
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error && !messages ? (
          <Problem error={error} onRetry={() => void load()} />
        ) : !messages ? (
          <ListLoading />
        ) : (
          messages.map((m, i) => {
            const team = m.from === 'TEAM'
            const newDay = i === 0 || day(messages[i - 1]!.at) !== day(m.at)
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="my-3 text-center text-[11px]" style={{ color: C.dim }}>
                    {day(m.at)}
                  </div>
                )}
                <div className={`mt-2 flex ${team ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[78%]">
                    <div
                      className={`overflow-hidden rounded-2xl text-[13.5px] leading-relaxed ${team ? 'rounded-br-md' : 'rounded-bl-md'}`}
                      style={team ? { background: '#1F3A12', color: C.text, border: '1px solid #2D5218' } : { background: C.raise, color: C.text, border: `1px solid ${C.line}` }}
                    >
                      {m.file && <Attachment message={m} />}
                      {editing?.id === m.id ? (
                        <div className="p-2">
                          <textarea
                            value={editing.text}
                            onChange={(e) => setEditing({ id: m.id, text: e.target.value.slice(0, 4000) })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void saveEdit()
                              }
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            rows={3}
                            autoFocus
                            aria-label="Edit message"
                            className="w-full resize-y rounded-lg px-2.5 py-2 text-[13.5px] outline-none"
                            style={{ background: C.bg, color: C.text, border: `1px solid ${C.line}` }}
                          />
                          <div className="mt-1.5 flex justify-end gap-2">
                            <Button small onClick={() => setEditing(null)} disabled={busy}>
                              Cancel
                            </Button>
                            <Button small tone="primary" onClick={() => void saveEdit()} disabled={busy || !editing.text.trim()}>
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        m.text && <div className="whitespace-pre-wrap break-words px-3.5 py-2.5">{m.text}</div>
                      )}
                    </div>
                    <div className={`mt-1 px-1 text-[11px] ${team ? 'text-right' : ''}`} style={{ color: C.dim }}>
                      {team ? `${m.author.split('@')[0]} · ` : ''}
                      {hhmm(m.at)}
                      {team && m.editedAt ? ' · edited' : ''}
                      {team && lastTeam?.id === m.id && seen ? ' · Seen' : ''}
                      {team && m.text && editing?.id !== m.id && (
                        <>
                          {' · '}
                          <button type="button" onClick={() => setEditing({ id: m.id, text: m.text ?? '' })} className="underline-offset-2 hover:underline" style={{ color: C.muted }}>
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={end} />
      </div>

      {file && (
        <div className="flex items-center gap-3 px-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          {preview ? (
            <img src={preview} alt="" className="size-12 rounded-lg object-cover" />
          ) : (
            <span className="flex size-12 items-center justify-center rounded-lg text-[11px]" style={{ background: C.raise, color: C.muted }}>
              PDF
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: C.text }}>
            {file.name} <span style={{ color: C.dim }}>· {bytes(file.size)}</span>
          </span>
          <button onClick={() => setFile(null)} className="text-[12.5px]" style={{ color: C.muted }}>
            Remove
          </button>
        </div>
      )}
      {said && (
        <p className="px-4 pt-2 text-[12.5px]" style={{ color: C.red }}>
          {said}
        </p>
      )}
      <form
        className="flex items-end gap-2 px-3 py-3"
        style={{ borderTop: file ? undefined : `1px solid ${C.line}` }}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <button type="button" onClick={() => fileInput.current?.click()} className="h-9 shrink-0 rounded-lg px-2.5 text-[12.5px]" style={{ color: C.muted, border: `1px solid ${C.line}` }} aria-label="Add a photo">
          Photo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            e.target.value = ''
            if (f && f.size > 10 * 1024 * 1024) return setSaid('Keep it under 10 MB.')
            setFile(f)
          }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
            if (f) {
              e.preventDefault()
              setFile(f)
            }
          }}
          rows={2}
          placeholder={summary.status === 'CLOSED' ? 'Resolved - replying opens it again…' : 'Write a reply - Enter sends, Shift+Enter for a new line'}
          aria-label="Reply"
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg px-3 py-2 text-[13.5px] outline-none"
          style={{ background: C.raise, color: C.text, border: `1px solid ${C.line}` }}
        />
        <Button type="submit" tone="primary" disabled={busy || (!text.trim() && !file)}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  )
}

/** A photo shows in place; a PDF opens in a new tab. Opened through the API, which needs the admin's token. */
function Attachment({ message }: { message: ChatMessage }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const image = !!message.file?.mime?.startsWith('image/')
  useEffect(() => {
    let made: string | null = null
    let gone = false
    bizFile(`/support/files/${message.id}`)
      .then((f) => {
        if (gone) URL.revokeObjectURL(f.url)
        else {
          made = f.url
          setUrl(f.url)
        }
      })
      .catch((e) => !gone && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [message.id])
  if (error)
    return (
      <div className="px-3.5 pt-2.5 text-[12px]" style={{ color: C.red }}>
        {error}
      </div>
    )
  if (image)
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img src={url} alt={message.file!.name} className="block max-h-72 w-full object-cover" />
      </a>
    ) : (
      <div className="h-40 animate-pulse" style={{ background: C.raise }} />
    )
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block px-3.5 pt-2.5 text-[13px] underline underline-offset-2" style={{ color: C.text }}>
      {message.file!.name}
    </a>
  )
}
