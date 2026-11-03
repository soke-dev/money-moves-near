/**
 * The help chat, on every screen.
 *
 * A button in the corner that opens into a conversation with our team: text
 * and photos, answered from the admin console, arriving here the moment
 * they're sent. It says the team is here only when someone actually has the
 * inbox open; otherwise that we'll reply here and by email. Signed out, it
 * points to the support address. In preview it's the sample chat.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, FileText, MessageCircle, Paperclip, Plus, SendHorizontal, X } from '@/components/icons'
import { cx } from './ui'
import { ApiError, LIVE, api } from '@/lib/api'
import { listen } from '@/lib/listen'
import { SUPPORT_EMAIL } from '@/lib/links'
import { useSession } from '@/state/session'

/** Screens without the app's tab bar - the chat button stays in the corner there. */
const OUTSIDE = ['/', '/login', '/signup', '/forgot-password', '/select-business', '/otp', '/onboarding', '/verify', '/business/new']

const QUICK = ['Help me set up my business', "A payment hasn't arrived", 'Settling to my bank', 'Something else']

const MAX_FILE = 10 * 1024 * 1024

type Msg = {
  id: string
  threadId?: string
  from: 'USER' | 'TEAM'
  author: string
  text: string | null
  file: { name: string; mime: string | null; size: number | null } | null
  at: string
  /** Still on its way, or didn't go. */
  pending?: boolean
  failed?: string
  /** A photo being sent: shown from the device until it's sent. */
  local?: string
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
function dayWord(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
const isImage = (m: Msg) => !!m.file?.mime?.startsWith('image/')

export default function ChatBubble() {
  const { pathname } = useLocation()
  const { user, business } = useSession()
  const [open, setOpen] = useState(false)
  const [peek, setPeek] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [attach, setAttach] = useState<File | null>(null)
  const [problem, setProblem] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [teamOnline, setTeamOnline] = useState(false)
  const [teamReadAt, setTeamReadAt] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [thread, setThread] = useState<{ id: string; status: 'OPEN' | 'CLOSED' } | null>(null)
  const threadRef = useRef<string | null>(null)
  threadRef.current = thread?.id ?? null
  const end = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const openRef = useRef(open)
  openRef.current = open
  const businessId = business?.id ?? null
  const live = LIVE && !!user
  // Not over a checkout, and not over the camera on the phone side of an identity check.
  const hidden = pathname.startsWith('/pay/') || pathname === '/checkout-preview' || pathname.startsWith('/verify/id/')
  const q = businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''

  const markRead = useCallback(() => {
    setUnread(0)
    void api('POST', '/support/chat/read', businessId ? { businessId } : {}).catch(() => {})
  }, [businessId])

  // The conversation so far: on opening the dashboard, and again after a dropped connection comes back.
  const load = useCallback(async () => {
    try {
      const r = await api<{ thread: { id: string; status: 'OPEN' | 'CLOSED'; userReadAt: string | null; teamReadAt: string | null } | null; messages: Msg[]; teamOnline: boolean }>('GET', `/support/chat${q}`)
      setThread(r.thread ? { id: r.thread.id, status: r.thread.status } : null)
      setMsgs((now) => [...r.messages, ...now.filter((m) => m.pending || m.failed)])
      setTeamOnline(r.teamOnline)
      setTeamReadAt(r.thread?.teamReadAt ?? null)
      const readAt = r.thread?.userReadAt ? Date.parse(r.thread.userReadAt) : 0
      const fresh = r.messages.filter((m) => m.from === 'TEAM' && Date.parse(m.at) > readAt)
      setUnread(fresh.length)
      // The newest reply they haven't read pops up by the button, as a reply arriving now does.
      const latest = fresh[fresh.length - 1]
      if (latest && !openRef.current) setPeek(latest.text ?? 'Sent you a photo')
    } catch {
      /* the button still works; sending says if something's wrong */
    }
  }, [q])

  useEffect(() => {
    if (!live || hidden) return
    setMsgs([])
    void load()
    return listen(
      '/api/support/stream',
      { credentials: 'same-origin' },
      (e) => {
        if (e.type === 'presence') setTeamOnline(!!e.teamOnline)
        if ((e.businessId ?? null) !== businessId) return
        if (e.type === 'message') {
          const m = e.message as Msg
          if (m.threadId && threadRef.current && m.threadId !== threadRef.current) {
            void load()
            return
          }
          setMsgs((now) => (now.some((x) => x.id === m.id) ? now : [...now, m]))
          if (m.from === 'TEAM') {
            if (openRef.current) markRead()
            else {
              setUnread((n) => n + 1)
              setPeek(m.text ?? 'Sent you a photo')
            }
          }
        }
        if (e.type === 'read' && e.side === 'TEAM') setTeamReadAt(String(e.at))
        if (e.type === 'edited') {
          const m = e.message as Msg
          setMsgs((now) => now.map((x) => (x.id === m.id ? { ...x, text: m.text } : x)))
        }
        if (e.type === 'thread' && e.threadId === threadRef.current) setThread((t) => (t ? { ...t, status: e.status as 'OPEN' | 'CLOSED' } : t))
      },
      (up) => up && void load(),
    )
  }, [live, hidden, businessId, load, markRead])

  useEffect(() => {
    if (open && live && unread > 0) markRead()
  }, [open, live, unread, markRead])

  // A gentle nudge a few seconds in, once - only before they've ever written.
  useEffect(() => {
    if (hidden) return
    const t = setTimeout(() => setPeek((p) => p ?? 'Need a hand getting set up? Write to us.'), 3500)
    return () => clearTimeout(t)
  }, [hidden])

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, open])

  const preview = attach && attach.type.startsWith('image/') ? URL.createObjectURL(attach) : null
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function send(raw: string, file: File | null) {
    const body = raw.trim()
    if (!body && !file) return
    setProblem('')
    // Signed out there's no one to reply to: the address, in their own email app.
    if (LIVE && !user) {
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Help with Money Moves Business')}&body=${encodeURIComponent(body)}`
      return
    }
    const tmp = `tmp-${Date.now()}`
    const local = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    const draft: Msg = { id: tmp, from: 'USER', author: user?.email ?? 'you', text: body || null, file: file ? { name: file.name, mime: file.type, size: file.size } : null, at: new Date().toISOString(), pending: true, local }
    const fresh = thread?.status === 'CLOSED'
    setMsgs((m) => (fresh ? [draft] : [...m, draft]))
    if (fresh) setTeamReadAt(null)
    setText('')
    setAttach(null)
    if (!LIVE) {
      setTimeout(() => {
        setMsgs((m) => [
          ...m.map((x) => (x.id === tmp ? { ...x, pending: false } : x)),
          { id: `s-${Date.now()}`, from: 'TEAM', author: 'Money Moves', text: 'Thanks, got it. Someone from the team will pick this up shortly.', file: null, at: new Date().toISOString() },
        ])
      }, 1200)
      return
    }
    try {
      let sent: Msg
      if (file) {
        const params = new URLSearchParams({ ...(businessId ? { businessId } : {}), page: pathname })
        const r = await fetch(`/api/support/chat/files?${params}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name), ...(body ? { 'x-text': encodeURIComponent(body) } : {}) },
          body: file,
        })
        const data = (await r.json().catch(() => ({}))) as { message?: Msg; error?: string; code?: string }
        if (!r.ok || !data.message) throw new ApiError(r.status, data.error ?? "That didn't send. Try again.", data.code)
        sent = data.message
      } else {
        sent = (await api<{ message: Msg }>('POST', '/support/chat/messages', { text: body, page: pathname, ...(businessId ? { businessId } : {}) })).message
      }
      // The live stream may have brought it already.
      setMsgs((m) => (m.some((x) => x.id === sent.id) ? m.filter((x) => x.id !== tmp) : m.map((x) => (x.id === tmp ? sent : x))))
      if (sent.threadId) setThread({ id: sent.threadId, status: 'OPEN' })
      if (local) URL.revokeObjectURL(local)
    } catch (e) {
      const why = e instanceof ApiError ? e.message : `That didn't send. Write to ${SUPPORT_EMAIL} if it keeps happening.`
      setMsgs((m) => m.map((x) => (x.id === tmp ? { ...x, pending: false, failed: why } : x)))
    }
  }

  const startNew = async () => {
    if (!live) return setMsgs([])
    try {
      const r = await api<{ thread: { id: string; status: 'OPEN' | 'CLOSED' } }>('POST', '/support/chat/new', businessId ? { businessId } : {})
      setThread(r.thread)
      setMsgs([])
      setTeamReadAt(null)
      setText('')
      setAttach(null)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't start a new conversation. Try again.")
    }
  }

  const retry = (m: Msg) => {
    setMsgs((all) => all.filter((x) => x.id !== m.id))
    setText(m.text ?? '')
  }

  if (hidden) return null

  const lastMine = [...msgs].reverse().find((m) => m.from === 'USER' && !m.pending && !m.failed)
  const seen = !!lastMine && !!teamReadAt && Date.parse(teamReadAt) >= Date.parse(lastMine.at)
  const intro = LIVE
    ? 'Tell us what you need, setting up, a payment, a settlement. A person from the team replies right here.'
    : 'Ask us anything, setting up, payments, settlements. A real person reads every message.'

  return (
    <div className={cx('fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-3', !OUTSIDE.includes(pathname) && 'max-lg:bottom-[84px]')}>
      {open && (
        <div className="rise flex h-[min(600px,calc(100vh-110px))] w-[min(380px,calc(100vw-40px))] flex-col overflow-hidden rounded-2xl border border-[#E6E1D4] bg-[#FBFAF6] shadow-[0_30px_80px_-24px_rgba(15,36,25,0.45)]">
          <div className="relative bg-[#143021] px-5 pb-4 pt-4 text-[#F3F0E7]">
            <div className="absolute right-3 top-3 flex items-center gap-1">
              {msgs.length > 0 && (
                <button onClick={() => void startNew()} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-[#F3F0E7]/75 hover:bg-white/10 hover:text-[#F3F0E7]" aria-label="Start a new conversation">
                  <Plus className="size-3.5" /> New chat
                </button>
              )}
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-[#F3F0E7]/60 hover:bg-white/10 hover:text-[#F3F0E7]" aria-label="Close chat">
                <X className="size-4" />
              </button>
            </div>
            <div className="display pr-28 text-[19px] font-bold leading-tight">Chat with the team</div>
            <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[#F3F0E7]/70">
              {teamOnline || !LIVE ? (
                <>
                  <span className="size-1.5 rounded-full bg-[#B4F25A]" /> The team is here now
                </>
              ) : (
                "We'll reply here, and by email if you've gone"
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[#E6E1D4] bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#0F2419]">{intro}</div>
            </div>
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-1.5 pt-3">
                {QUICK.map((t) => (
                  <button
                    key={t}
                    onClick={() => setText(t === 'Something else' ? '' : `${t}: `)}
                    className="rounded-full border border-[#143021]/15 bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#0F2419] transition hover:border-[#143021] hover:bg-[#B4F25A]/30"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => {
              const mine = m.from === 'USER'
              const newDay = i === 0 || dayWord(msgs[i - 1]!.at) !== dayWord(m.at)
              return (
                <div key={m.id}>
                  {newDay && <div className="my-3 text-center text-[11px] font-medium text-[#918F86]">{dayWord(m.at)}</div>}
                  <div className={cx('mt-2 flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cx('max-w-[82%]', m.pending && 'opacity-70')}>
                      {!mine && (i === 0 || msgs[i - 1]!.from !== 'TEAM') && <div className="mb-1 pl-1 text-[11px] font-medium text-[#918F86]">Money Moves</div>}
                      <div
                        className={cx(
                          'overflow-hidden rounded-2xl text-[13.5px] leading-relaxed',
                          mine ? 'rounded-br-md bg-[#143021] text-[#F3F0E7]' : 'rounded-bl-md border border-[#E6E1D4] bg-white text-[#0F2419]',
                          m.failed && 'ring-2 ring-red/60',
                        )}
                      >
                        {m.file &&
                          (isImage(m) ? (
                            <a href={m.local ?? `/api/support/files/${m.id}`} target="_blank" rel="noreferrer" className="block">
                              <img src={m.local ?? `/api/support/files/${m.id}`} alt={m.file.name} className="block max-h-60 w-full object-cover" />
                            </a>
                          ) : (
                            <a href={m.pending ? undefined : `/api/support/files/${m.id}`} target="_blank" rel="noreferrer" className={cx('flex items-center gap-2.5 px-3.5 pt-3', !m.text && 'pb-3')}>
                              <FileText className="size-5 shrink-0" />
                              <span className="min-w-0 truncate underline underline-offset-2">{m.file.name}</span>
                            </a>
                          ))}
                        {m.text && <div className="whitespace-pre-wrap break-words px-3.5 py-2.5">{m.text}</div>}
                      </div>
                      <div className={cx('mt-1 px-1 text-[10.5px] text-[#918F86]', mine && 'text-right')}>
                        {m.pending ? 'Sending…' : m.failed ? '' : hhmm(m.at)}
                        {!m.pending && !m.failed && lastMine?.id === m.id && seen && ' · Seen'}
                      </div>
                      {m.failed && (
                        <div className="mt-0.5 px-1 text-right text-[11.5px] text-red">
                          {m.failed}{' '}
                          <button onClick={() => retry(m)} className="font-semibold underline underline-offset-2">
                            Edit and send again
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {thread?.status === 'CLOSED' && msgs.length > 0 && (
              <div className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-[#918F86]">
                <Check className="size-3.5 text-[#143021]" strokeWidth={3} /> Marked resolved. Write below to start a new conversation
              </div>
            )}
            <div ref={end} />
          </div>

          {attach && (
            <div className="flex items-center gap-3 border-t border-[#E6E1D4] bg-white px-3 pt-3">
              {preview ? <img src={preview} alt="" className="size-12 rounded-lg object-cover" /> : <span className="flex size-12 items-center justify-center rounded-lg bg-[#F1F0EB] text-[#0F2419]"><FileText className="size-5" /></span>}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#0F2419]">{attach.name}</span>
              <button onClick={() => setAttach(null)} className="rounded-md p-1.5 text-[#918F86] hover:text-[#0F2419]" aria-label="Remove attachment">
                <X className="size-4" />
              </button>
            </div>
          )}
          {problem && <div className="border-t border-[#E6E1D4] bg-white px-4 pt-2 text-[12px] text-red">{problem}</div>}
          <form
            className="flex items-end gap-1.5 border-t border-[#E6E1D4] bg-white px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              void send(text, attach)
            }}
          >
            {(live || !LIVE) && (
              <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg p-2 text-[#918F86] hover:bg-[#F1F0EB] hover:text-[#0F2419]" aria-label="Add a photo">
                <Paperclip className="size-[18px]" />
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                e.target.value = ''
                if (f && f.size > MAX_FILE) return setProblem('Keep it under 10 MB.')
                setProblem('')
                setAttach(f)
              }}
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 4000))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(text, attach)
                }
              }}
              onPaste={(e) => {
                // A screenshot pasted straight in becomes the photo.
                const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
                if (f && live) {
                  e.preventDefault()
                  setAttach(f)
                }
              }}
              rows={1}
              placeholder={attach ? 'Add a note (optional)' : thread?.status === 'CLOSED' ? 'Start a new conversation…' : 'Write a message…'}
              aria-label="Message"
              className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] text-[#0F2419] outline-none placeholder:text-[#918F86]"
            />
            <button
              type="submit"
              disabled={!text.trim() && !attach}
              className="flex size-9 items-center justify-center rounded-xl bg-[#B4F25A] text-[#0F2419] transition hover:brightness-95 disabled:bg-[#EAE8E2] disabled:text-[#B9B6AC]"
              aria-label="Send"
            >
              <SendHorizontal className="size-4" />
            </button>
          </form>
        </div>
      )}

      {!open && peek && (
        <button
          onClick={() => {
            setOpen(true)
            setPeek(null)
          }}
          className={cx('rise relative max-w-[260px] rounded-2xl rounded-br-md border border-[#E6E1D4] bg-white px-4 py-3 text-left text-[13.5px] leading-relaxed text-[#0F2419] shadow-[0_16px_40px_-18px_rgba(15,36,25,0.4)]', unread === 0 && 'max-lg:hidden')}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              setPeek(null)
            }}
            className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full border border-[#E6E1D4] bg-white text-[#918F86] hover:text-[#0F2419]"
            aria-label="Dismiss"
          >
            <X className="size-3" />
          </span>
          {unread > 0 && <span className="mb-0.5 block text-[11px] font-semibold text-[#143021]">Money Moves replied</span>}
          <span className="line-clamp-3">{peek}</span>
        </button>
      )}

      <button
        onClick={() => {
          setOpen((o) => !o)
          setPeek(null)
        }}
        className={cx(
          'relative flex items-center justify-center rounded-full bg-[#143021] text-[#F3F0E7] shadow-[0_14px_30px_-12px_rgba(15,36,25,0.7)] transition hover:-translate-y-0.5',
          // Someone from the team has the inbox open: say so, in words.
          !open && live && teamOnline ? 'h-[52px] gap-2.5 pl-4 pr-5 hover:shadow-[0_18px_34px_-12px_rgba(15,36,25,0.75)]' : 'size-14 hover:scale-105',
        )}
        aria-label={open ? 'Close chat' : unread ? `Chat with us, ${unread} new` : teamOnline ? 'Chat with us, the team is here' : 'Chat with us'}
      >
        {open ? (
          <X className="size-5" />
        ) : live && teamOnline ? (
          <>
            <MessageCircle className="size-[21px]" strokeWidth={2.2} />
            <span className="text-[14.5px] font-semibold">Help</span>
            <span className="text-[13px] font-medium text-[#F3F0E7]/60 max-sm:hidden">· team is here</span>
            <span className="size-2 rounded-full bg-[#81FB02] shadow-[0_0_0_2px_#143021]" />
          </>
        ) : (
          <MessageCircle className="size-6" strokeWidth={2.2} />
        )}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[20px] items-center justify-center rounded-full border-2 border-[#F3F0E7] bg-[#B4F25A] px-1 text-[11px] font-bold leading-[16px] text-[#0F2419]">{unread}</span>
        )}
      </button>
    </div>
  )
}
