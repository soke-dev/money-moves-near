/**
 * The phone side of a manual identity check, opened from the QR code on the
 * computer (or straight from "Use this computer"). No sign-in: the code in the
 * link is the key, and it can only add photos to this one check.
 *
 * The camera runs in the page: the back camera for the ID, the front one for
 * the selfie and a three second smile video. The selfie and the video only
 * ever come from the live camera, never a file: without camera access they
 * can't be done, and the page says how to allow it. Only the ID can be
 * uploaded from the gallery.
 *
 * Wording rule: say that we check it, never how.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, api, type ApiHandoff } from '@/lib/api'
import { ArrowLeft, Check, Lock, Play, X } from '@/components/icons'
import { cx } from '@/components/ui'

type IdType = 'nin' | 'passport' | 'licence'
type Part = 'front' | 'back' | 'selfie' | 'video'
type Step = 'type' | Part | 'review' | 'sent'

const ID_CHOICES: { id: IdType; title: string; sides: string; tall?: boolean }[] = [
  { id: 'nin', title: 'NIN slip or card', sides: 'Front and back' },
  { id: 'passport', title: 'International passport', sides: 'The photo page', tall: true },
  { id: 'licence', title: "Driver's licence", sides: 'Front and back' },
]
const ID_NAME: Record<IdType, string> = { nin: 'NIN slip', passport: 'passport', licence: "driver's licence" }
const PART_LABEL: Record<Part, string> = { front: 'ID, front', back: 'ID, back', selfie: 'Selfie', video: 'Smile video' }

async function put(code: string, part: Part, blob: Blob) {
  let r: Response
  try {
    r = await fetch(`/api/identity-handoff/${code}/files/${part}`, { method: 'PUT', headers: { 'content-type': blob.type || 'application/octet-stream' }, body: blob })
  } catch {
    throw new ApiError(0, "Can't reach Money Moves right now. Check your connection and try again.", 'offline')
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string; have?: string[] }
  if (!r.ok) throw new ApiError(r.status, data.error ?? "That didn't upload. Try again.", data.code)
  return data
}

/** A photo as a JPEG no larger than it needs to be: the longest side at most 2000px. */
async function toJpeg(source: CanvasImageSource & { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number }, mirror = false): Promise<Blob> {
  const w = source.videoWidth || source.naturalWidth || 1280
  const h = source.videoHeight || source.naturalHeight || 720
  const scale = Math.min(1, 2000 / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  if (mirror) {
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no photo'))), 'image/jpeg', 0.9))
}

/** A picked file as a JPEG (so HEIC and huge photos from the gallery still go through). */
async function fileToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return await toJpeg(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The camera, as a stream, or null where the page can't open one. */
function useCamera(facing: 'user' | 'environment', on: boolean, withVideo = false) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!on) return
    let live: MediaStream | null = null
    let gone = false
    setFailed(false)
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true)
      return
    }
    const constraints = { video: { facingMode: { ideal: facing }, width: { ideal: withVideo ? 720 : 1920 }, height: { ideal: withVideo ? 1280 : 1080 } }, audio: false }
    // Straight after the last step let the camera go it can still be busy for a moment: try again
    // a few times before saying it didn't open. A refusal of permission isn't retried.
    const open = (tries: number): void => {
      navigator.mediaDevices
        .getUserMedia(constraints)
        .then((s) => {
          if (gone) return s.getTracks().forEach((t) => t.stop())
          live = s
          setStream(s)
        })
        .catch((e: unknown) => {
          if (gone) return
          const name = (e as { name?: string })?.name
          if (tries > 0 && name !== 'NotAllowedError' && name !== 'SecurityError') setTimeout(() => !gone && open(tries - 1), 500)
          else setFailed(true)
        })
    }
    open(4)
    return () => {
      gone = true
      live?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [facing, on, withVideo, attempt])
  return { stream, failed, retry: () => setAttempt((n) => n + 1) }
}

function Viewfinder({ stream, mirror, shape, videoRef }: { stream: MediaStream | null; mirror?: boolean; shape: 'card' | 'face'; videoRef?: { current: HTMLVideoElement | null } }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef) videoRef.current = ref.current
    if (ref.current && stream) {
      ref.current.srcObject = stream
      void ref.current.play().catch(() => {})
    }
  }, [stream])
  return (
    <div className={cx('relative mx-auto overflow-hidden bg-[#1A1D16]', shape === 'card' ? 'aspect-[1.58] w-full rounded-2xl' : 'aspect-[0.78] w-[250px] rounded-full')}>
      <video ref={ref} playsInline muted autoPlay className={cx('size-full object-cover', mirror && '-scale-x-100')} />
      <div className={cx('pointer-events-none absolute inset-0 border-2 border-lime', shape === 'card' ? 'rounded-2xl' : 'rounded-full')} />
      {!stream && <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#A6A99E]">Opening the camera…</div>}
    </div>
  )
}

function Shutter({ onClick, disabled, label, red }: { onClick: () => void; disabled?: boolean; label: string; red?: boolean }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="size-[76px] rounded-full border-[3px] border-[#EDEEE8] p-[5px] disabled:opacity-40">
      <span className={cx('block size-full rounded-full', red ? 'bg-[#F08A82]' : 'bg-[#EDEEE8]')} />
    </button>
  )
}

/** Dark camera screen frame: back arrow, where they are, a title. */
function CameraScreen({ step, of, onBack, title, sub, children }: { step: number; of: number; onBack?: () => void; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#0F100D] text-[#EDEEE8]">
      <header className="flex items-center justify-between px-2.5 pt-3.5">
        {onBack ? (
          <button type="button" aria-label="Back" onClick={onBack} className="flex size-11 items-center justify-center">
            <ArrowLeft className="size-5" />
          </button>
        ) : (
          <span className="size-11" />
        )}
        <div className="text-[13px] font-medium text-[#A6A99E]">
          Your identity · {step} of {of}
        </div>
        <span className="size-11" />
      </header>
      <div className="flex flex-col items-center gap-2 px-6 pt-4 text-center">
        <h1 className="text-[24px] font-bold tracking-[-0.5px]">{title}</h1>
        <p className="max-w-[300px] text-[14px] leading-relaxed text-[#A6A99E]">{sub}</p>
      </div>
      {children}
    </div>
  )
}

/** A file input standing in for the in-page camera. */
function PickFile({ accept, capture, onFile, children, className }: { accept: string; capture?: 'user' | 'environment'; onFile: (f: File) => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={accept} capture={capture} className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button type="button" onClick={() => ref.current?.click()} className={className}>
        {children}
      </button>
    </>
  )
}

/** One photo: the camera, then a look at what was taken before it's used. */
function PhotoStep({
  part,
  facing,
  title,
  sub,
  stepNo,
  of,
  onBack,
  onDone,
  code,
}: {
  part: Part
  facing: 'user' | 'environment'
  title: string
  sub: string
  stepNo: number
  of: number
  onBack?: () => void
  onDone: (blob: Blob) => void
  code: string
}) {
  const [shot, setShot] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { stream, failed, retry } = useCamera(facing, !shot)
  const video = useRef<HTMLVideoElement | null>(null)
  const preview = useObjectUrl(shot)
  const take = async () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    setShot(await toJpeg(v, facing === 'user'))
  }
  const card = facing === 'environment'
  const use = async () => {
    if (!shot) return
    setBusy(true)
    setError('')
    try {
      await put(code, part, shot)
      onDone(shot)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't upload. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const picked = async (f: File) => {
    if (!card) return
    try {
      setShot(await fileToJpeg(f))
    } catch {
      setError("That photo couldn't be read. Try another, or use the camera.")
    }
  }
  return (
    <CameraScreen step={stepNo} of={of} onBack={onBack} title={title} sub={sub}>
      <div className={cx('mt-6 px-5', !card && 'flex justify-center')}>
        {shot && preview ? (
          <img src={preview} alt={PART_LABEL[part]} className={cx('mx-auto object-cover', card ? 'aspect-[1.58] w-full rounded-2xl' : 'aspect-[0.78] w-[250px] rounded-full')} />
        ) : failed && !card ? (
          <NeedCamera round onRetry={retry} />
        ) : failed ? (
          <div className="mx-auto flex aspect-[1.58] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-[#2B2E26] p-6 text-center">
            <p className="text-[13.5px] text-[#A6A99E]">The camera didn't open here. Take the photo with your camera app, or allow camera access and try again.</p>
            <button type="button" onClick={retry} className="rounded-full border border-[#EDEEE8] px-4 py-2 text-[13.5px] font-semibold">
              Try again
            </button>
          </div>
        ) : (
          <Viewfinder stream={stream} mirror={facing === 'user'} shape={card ? 'card' : 'face'} videoRef={video} />
        )}
      </div>
      {error && <p className="mt-4 px-6 text-center text-[13.5px] text-[#F08A82]">{error}</p>}
      <div className="flex-1" />
      <div className="px-5 pb-8">
        {shot ? (
          <div className="flex flex-col gap-3">
            <button type="button" onClick={() => void use()} disabled={busy} className="h-[52px] rounded-full bg-lime text-[16px] font-semibold text-[#0F100D] disabled:opacity-60">
              {busy ? 'Sending…' : 'Use this photo'}
            </button>
            <button type="button" onClick={() => setShot(null)} disabled={busy} className="h-12 rounded-full text-[15px] font-medium text-[#EDEEE8]">
              Take it again
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-2">
            {card && !failed ? (
              <PickFile accept="image/*" onFile={(f) => void picked(f)} className="w-24 whitespace-nowrap text-left text-[13px] text-[#A6A99E]">
                Upload instead
              </PickFile>
            ) : (
              <span className="w-24" />
            )}
            {failed && card ? (
              <PickFile accept="image/*" capture={facing} onFile={(f) => void picked(f)} className="size-[76px] rounded-full border-[3px] border-[#EDEEE8] p-[5px]">
                <span className="block size-full rounded-full bg-[#EDEEE8]" />
              </PickFile>
            ) : (
              <Shutter label="Take photo" onClick={() => void take()} disabled={!stream} />
            )}
            <span className="w-24" />
          </div>
        )}
      </div>
    </CameraScreen>
  )
}

function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** The smile video: three seconds from the front camera. */
function SmileStep({ stepNo, of, onBack, onDone, code }: { stepNo: number; of: number; onBack?: () => void; onDone: (blob: Blob) => void; code: string }) {
  const [clip, setClip] = useState<Blob | null>(null)
  const [sec, setSec] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { stream, failed, retry } = useCamera('user', !clip, true)
  const url = useObjectUrl(clip)
  const canRecord = typeof window !== 'undefined' && 'MediaRecorder' in window
  const record = () => {
    if (!stream || !canRecord) return
    const type = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
    let rec: MediaRecorder
    try {
      rec = type ? new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_500_000 }) : new MediaRecorder(stream)
    } catch {
      setError("This browser can't record here. Open the link in Chrome or Safari to finish.")
      return
    }
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => setClip(new Blob(chunks, { type: (rec.mimeType || type || 'video/webm').split(';')[0] }))
    rec.start(250)
    setSec(0)
    let t = 0
    const tick = setInterval(() => {
      t += 1
      setSec(t)
      if (t >= 3) {
        clearInterval(tick)
        rec.stop()
        setSec(null)
      }
    }, 1000)
  }
  const use = async () => {
    if (!clip) return
    setBusy(true)
    setError('')
    try {
      await put(code, 'video', clip)
      onDone(clip)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't upload. Try again.")
    } finally {
      setBusy(false)
    }
  }
  const prompt = sec === null ? 'Ready when you are' : sec < 1 ? 'Straight face' : sec < 3 ? 'Now smile' : 'Got it'
  const manualOnly = failed || !canRecord
  return (
    <CameraScreen step={stepNo} of={of} onBack={onBack} title="Last one: a quick smile" sub="Start with a straight face, then smile. Three seconds, and it shows us it's really you, right now.">
      <div className="mt-6 flex justify-center px-5">
        {clip && url ? (
          <video src={url} controls playsInline className="aspect-[0.78] w-[250px] rounded-[40%] bg-black object-cover" />
        ) : !canRecord ? (
          <div className="flex aspect-[0.78] w-[250px] items-center justify-center rounded-full border border-[#2B2E26] p-8 text-center text-[13.5px] leading-relaxed text-[#A6A99E]">
            This browser can't record video. Open the link in Chrome or Safari to finish.
          </div>
        ) : failed ? (
          <NeedCamera round onRetry={retry} />
        ) : (
          <div className="relative">
            <Viewfinder stream={stream} mirror shape="face" />
            {sec !== null && (
              <div className="absolute left-1/2 top-3.5 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#0F100D]/75 px-2.5 py-1 text-[12.5px] font-semibold">
                <span className="size-[7px] rounded-full bg-[#F08A82]" />
                0:0{sec}
              </div>
            )}
          </div>
        )}
      </div>
      {!clip && !manualOnly && <div className="pt-6 text-center text-[15px] font-semibold">{prompt}</div>}
      {error && <p className="mt-4 px-6 text-center text-[13.5px] text-[#F08A82]">{error}</p>}
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-3 px-5 pb-8">
        {clip ? (
          <>
            <button type="button" onClick={() => void use()} disabled={busy} className="h-[52px] w-full rounded-full bg-lime text-[16px] font-semibold text-[#0F100D] disabled:opacity-60">
              {busy ? 'Sending…' : 'Use this video'}
            </button>
            <button type="button" onClick={() => setClip(null)} disabled={busy} className="h-12 w-full rounded-full text-[15px] font-medium">
              Record again
            </button>
          </>
        ) : manualOnly ? null : (
          <Shutter label="Record" red onClick={record} disabled={!stream || sec !== null} />
        )}
      </div>
    </CameraScreen>
  )
}

/** Shown when the live camera won't open, for the parts that can only be taken live. */
function NeedCamera({ round, onRetry }: { round?: boolean; onRetry: () => void }) {
  return (
    <div className={cx('mx-auto flex flex-col items-center justify-center gap-3 border border-[#2B2E26] p-7 text-center', round ? 'aspect-[0.78] w-[250px] rounded-full' : 'aspect-[1.58] w-full rounded-2xl')}>
      <p className="text-[13.5px] leading-relaxed text-[#A6A99E]">This has to be taken live, so we need your camera. Allow camera access for this page in your browser settings, then try again.</p>
      <button type="button" onClick={onRetry} className="rounded-full border border-[#EDEEE8] px-4 py-2 text-[13.5px] font-semibold">
        Try again
      </button>
    </div>
  )
}

function Light({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[100dvh] flex-col bg-white px-5 text-fg">{children}</div>
}

function Wordmark() {
  return (
    <div className="pt-[18px] text-[16px] font-bold tracking-[-0.3px]">
      money <span className="text-[#2B6A00]">moves</span>
    </div>
  )
}

export function VerifyId() {
  const { code = '' } = useParams()
  const [info, setInfo] = useState<ApiHandoff | null>(null)
  const [dead, setDead] = useState('')
  const [step, setStep] = useState<Step>('type')
  const [idType, setIdType] = useState<IdType>('nin')
  const [shots, setShots] = useState<Partial<Record<Part, Blob>>>({})
  // Consent to the check is theirs to give: the box starts empty.
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api<ApiHandoff>('GET', `/identity-handoff/${code}`)
      setInfo(d)
      // Their choice if they made one, else the first ID that's accepted.
      const first = d.idType ?? d.idTypes?.[0]
      if (first) setIdType(first)
      return d
    } catch (e) {
      setDead(e instanceof ApiError ? e.message : "This link didn't open. Scan the code on your computer again.")
      return null
    }
  }, [code])
  useEffect(() => {
    void load().then((d) => {
      if (!d) return
      // Asked to redo: straight to the first part to take again. Otherwise, choose the ID first.
      if (d.redo) setStep((d.need.find((p) => !d.have.includes(p)) as Part) ?? 'review')
    })
  }, [load])

  if (dead && step !== 'sent')
    return (
      <Light>
        <Wordmark />
        <div className="flex flex-1 flex-col justify-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-[#FBEAE8] text-red">
            <X className="size-5" />
          </span>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.8px]">This link can't be used</h1>
          <p className="text-[15px] leading-relaxed text-muted">{dead}</p>
        </div>
      </Light>
    )
  if (!info)
    return (
      <Light>
        <Wordmark />
        <div className="flex flex-1 items-center justify-center text-[14px] text-dim">Opening…</div>
      </Light>
    )

  const need = (info.need as Part[]) ?? []
  const order: Step[] = [...(info.redo ? [] : (['type'] as Step[])), ...need, 'review']
  const at = Math.max(0, order.indexOf(step))
  const go = (s: Step) => {
    setError('')
    setStep(s)
    window.scrollTo({ top: 0 })
  }
  const next = () => go(order[Math.min(at + 1, order.length - 1)]!)
  const back = at > 0 ? () => go(order[at - 1]!) : undefined
  const done = (part: Part) => (blob: Blob) => {
    setShots((s) => ({ ...s, [part]: blob }))
    next()
  }
  const camSteps = need.length
  const camNo = (p: Part) => need.indexOf(p) + 1

  if (step === 'type') {
    const choose = async () => {
      setBusy(true)
      setError('')
      try {
        const r = await api<{ need: string[]; have: string[] }>('PUT', `/identity-handoff/${code}/id-type`, { idType })
        setInfo({ ...info, idType, need: r.need, have: r.have })
        go((r.need[0] as Part) ?? 'review')
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "That didn't save. Try again.")
      } finally {
        setBusy(false)
      }
    }
    return (
      <Light>
        <Wordmark />
        <div className="pt-4">
          <div className="flex justify-between text-[12.5px] font-medium text-muted">
            <span>Your identity</span>
            <span>1 of {need.length + 1}</span>
          </div>
          <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-soft">
            <div className="h-full bg-fg" style={{ width: `${100 / (need.length + 1)}%` }} />
          </div>
        </div>
        <h1 className="mt-8 text-[32px] font-bold leading-[1.05] tracking-[-1px]">Which ID will you use?</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted">Valid and not expired, with your full name, photo and date of birth.</p>
        <div role="radiogroup" aria-label="ID type" className="mt-7 border-t border-line">
          {ID_CHOICES.filter((c) => !info.idTypes || info.idTypes.includes(c.id)).map((c) => {
            const on = idType === c.id
            return (
              <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => setIdType(c.id)} className="flex w-full items-center gap-4 border-b border-line py-[18px] text-left">
                <span aria-hidden className={cx('flex shrink-0 gap-1 rounded-[5px] border-[1.5px] border-fg p-[5px]', c.tall ? 'mx-1.5 h-11 w-[34px]' : 'h-8 w-[46px]')}>
                  <span className="block h-[13px] w-2.5 rounded-[2px] bg-fg" />
                  <span className="flex flex-1 flex-col gap-[3px] pt-px">
                    <span className="block h-0.5 bg-fg" />
                    <span className="block h-0.5 w-[70%] bg-dim" />
                    <span className="block h-0.5 w-[85%] bg-dim" />
                  </span>
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[16px] font-semibold">{c.title}</span>
                  <span className="text-[13.5px] text-muted">{c.sides}</span>
                </span>
                <span aria-hidden className={cx('flex size-[22px] items-center justify-center rounded-full', on ? 'border-2 border-fg' : 'border-[1.5px] border-[#C9C7BF]')}>
                  {on && <span className="size-2.5 rounded-full bg-fg" />}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex-1" />
        <div className="flex flex-col gap-4 pb-8 pt-8">
          {info.name && (
            <p className="text-[13.5px] leading-relaxed text-muted">
              The name on it has to match the name on your account, <span className="font-semibold text-fg">{info.name}</span>.
            </p>
          )}
          {error && <p className="text-[13.5px] text-red">{error}</p>}
          <button type="button" onClick={() => void choose()} disabled={busy} className="flex h-[54px] items-center justify-center gap-2 rounded-full bg-fg text-[16px] font-semibold text-white disabled:opacity-60">
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </Light>
    )
  }

  if (step === 'front' || step === 'back') {
    const name = ID_NAME[(info.idType ?? idType) as IdType]
    return (
      <PhotoStep
        key={step}
        code={code}
        part={step}
        facing="environment"
        stepNo={camNo(step)}
        of={camSteps}
        onBack={back}
        onDone={done(step)}
        title={step === 'front' ? (info.idType === 'passport' ? 'Your passport photo page' : `Front of your ${name}`) : 'Now the back'}
        sub="Lay it flat in good light. Fit all four corners inside the frame."
      />
    )
  }
  if (step === 'selfie')
    return <PhotoStep key="selfie" code={code} part="selfie" facing="user" stepNo={camNo('selfie')} of={camSteps} onBack={back} onDone={done('selfie')} title="Now a selfie" sub="Face the light. No cap, glasses or mask, and nobody else in the shot." />
  if (step === 'video') return <SmileStep code={code} stepNo={camNo('video')} of={camSteps} onBack={back} onDone={done('video')} />

  if (step === 'review') {
    const send = async () => {
      setBusy(true)
      setError('')
      try {
        await api('POST', `/identity-handoff/${code}/submit`)
        go('sent')
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "That didn't send. Try again.")
        void load()
      } finally {
        setBusy(false)
      }
    }
    return (
      <Light>
        <header className="-mx-2.5 flex items-center justify-between pt-3.5">
          {back ? (
            <button type="button" aria-label="Back" onClick={back} className="flex size-11 items-center justify-center">
              <ArrowLeft className="size-5" />
            </button>
          ) : (
            <span className="size-11" />
          )}
          <div className="text-[13px] font-medium text-muted">Your identity</div>
          <span className="size-11" />
        </header>
        <h1 className="mt-5 text-[30px] font-bold leading-[1.08] tracking-[-0.9px]">Check it all reads clearly</h1>
        <p className="mt-2 text-[14.5px] leading-relaxed text-muted">Blurry or cut off photos are the most common reason we ask for them again.</p>
        <div className="mt-6 grid grid-cols-2 gap-2.5">
          {need.map((p) => (
            <Thumb key={p} part={p} blob={shots[p] ?? null} onRetake={() => go(p)} />
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex flex-col gap-3 pb-8 pt-8">
          <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-fg" />
            <span>These are mine, and I agree Money Moves can check them to verify {info.business ?? 'this business'}.</span>
          </label>
          {error && <p className="text-[13.5px] text-red">{error}</p>}
          <button type="button" onClick={() => void send()} disabled={busy || !agree} className="h-[54px] rounded-full bg-fg text-[16px] font-semibold text-white disabled:opacity-50">
            {busy ? 'Sending…' : 'Send for checking'}
          </button>
        </div>
      </Light>
    )
  }

  return (
    <Light>
      <Wordmark />
      <div className="flex flex-1 flex-col justify-center gap-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-lime">
          <Check className="size-7 text-[#0F2419]" strokeWidth={3} />
        </span>
        <h1 className="text-[34px] font-bold leading-[1.05] tracking-[-1px]">Sent. You're done here.</h1>
        <p className="text-[15.5px] leading-relaxed text-muted">If you started on a computer, it has already moved on. Finish there.</p>
        <ol className="mt-3 border-t border-line">
          {['We check your ID against your selfie and video.', "We email you either way. If a photo is unclear we'll say which one to redo.", 'Once your business is approved, live payments open.'].map((s, i) => (
            <li key={s} className="flex gap-3.5 border-b border-line py-3.5 text-[14.5px]">
              <span className="w-[18px] font-semibold text-dim">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col items-center gap-2 pb-8">
        <a href="/verify" className="text-[14px] font-medium text-fg underline underline-offset-2">
          Back to your dashboard
        </a>
        <span className="flex items-center gap-1.5 text-[12px] text-dim">
          <Lock className="size-3" /> Encrypted, and used only to verify you
        </span>
      </div>
    </Light>
  )
}

function Thumb({ part, blob, onRetake }: { part: Part; blob: Blob | null; onRetake: () => void }) {
  const url = useObjectUrl(blob)
  const tall = part === 'selfie' || part === 'video'
  return (
    <div className="flex flex-col gap-2">
      <div className={cx('relative flex items-center justify-center overflow-hidden rounded-xl bg-raise', tall ? 'h-[132px]' : 'h-[104px]')}>
        {url && part !== 'video' && <img src={url} alt={PART_LABEL[part]} className="size-full object-cover" />}
        {url && part === 'video' && <video src={url} muted playsInline className="size-full object-cover" />}
        {part === 'video' && (
          <span className="absolute flex size-11 items-center justify-center rounded-full bg-fg">
            <Play className="size-4 text-lime" />
          </span>
        )}
        {!url && part !== 'video' && <span className="text-[12.5px] text-dim">Sent</span>}
      </div>
      <div className="flex justify-between text-[13px]">
        <span className="font-semibold">{PART_LABEL[part]}</span>
        <button type="button" onClick={onRetake} className="text-muted underline-offset-2 hover:underline">
          Retake
        </button>
      </div>
    </div>
  )
}
