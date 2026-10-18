/**
 * Making a payment link, an outlet or an invoice: one page, the form down the
 * left and, beside it, the checkout exactly as customers will see it - on a
 * phone or on a computer - changing as the form does.
 *
 * The preview is the real checkout page in a frame, so a phone's width really
 * is a phone's width. It's sent what to draw; paying in it does nothing.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, Info, Lock, Monitor, Plus, Smartphone } from '@/components/icons'
import { cx } from '@/components/ui'
import type { PublicLink } from '@/lib/api'
import type { Branding } from '@/state/branding'

/** What the preview draws: the checkout as the API would send it, and the business's look. */
export type PreviewPayload = {
  kind: 'link' | 'outlet' | 'invoice'
  info: PublicLink
  brand?: Branding
  /** Changes when the checkout should start over - a different currency, a fixed price instead of a typed one. */
  key: string
}

export const PREVIEW_PATH = '/checkout-preview'

export function BuilderPage({
  open,
  back,
  onClose,
  preview,
  previewWhat,
  previewUrl,
  children,
}: {
  open: boolean
  /** Where the back link goes, in words: "Payment links". */
  back: string
  onClose: () => void
  preview: PreviewPayload | null
  /** What customers open, for the preview's line: "link", "invoice". */
  previewWhat: string
  /** The address shown in the computer's address bar. */
  previewUrl: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const was = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = was
    }
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="sheet-up fixed inset-0 z-[60] flex bg-card">
      <div className="min-h-0 w-full overflow-y-auto lg:w-[44%] lg:min-w-[440px] lg:max-w-[560px] lg:shrink-0">
        <div className="mx-auto w-full max-w-[400px] px-5 pb-14 pt-6 sm:pt-8">
          <button onClick={onClose} className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13.5px] text-muted transition hover:text-fg">
            <ChevronLeft className="size-4" /> {back}
          </button>
          {children}
        </div>
      </div>
      {preview && <PreviewPane payload={preview} what={previewWhat} url={previewUrl} />}
    </div>,
    document.body,
  )
}

/** The page's own heading, under the back link. */
export function BuilderHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8 mt-9">
      <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{sub}</p>
    </div>
  )
}

/* ─── The preview ──────────────────────────────────────────────────── */

function PreviewPane({ payload, what, url }: { payload: PreviewPayload; what: string; url: string }) {
  const [device, setDevice] = useState<'phone' | 'computer'>('phone')
  return (
    <div className="hidden min-w-0 flex-1 flex-col overflow-y-auto border-l border-line bg-[#EEF0EA] lg:flex">
      <div className="flex items-start justify-between gap-6 px-10 pb-7 pt-8">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-fg">Preview</h2>
          <p className="mt-1 text-[13.5px] text-muted">A quick look at what customers see when they open the {what}.</p>
          <Link to="/settings/branding" target="_blank" className="mt-0.5 inline-block text-[13.5px] font-medium text-fg underline underline-offset-4">
            Change your branding
          </Link>
        </div>
        <div className="flex shrink-0 rounded-full border border-line bg-card p-1 shadow-[0_1px_2px_rgba(18,18,16,0.05)]">
          {(
            [
              ['phone', Smartphone, 'Phone'],
              ['computer', Monitor, 'Computer'],
            ] as const
          ).map(([d, Icon, label]) => (
            <button
              key={d}
              type="button"
              onClick={() => setDevice(d)}
              aria-label={label}
              aria-pressed={device === d}
              className={cx('flex h-8 w-10 items-center justify-center rounded-full transition', device === d ? 'bg-raise text-fg' : 'text-dim hover:text-fg')}
            >
              <Icon className="size-[18px]" />
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-start justify-center px-10 pb-12">
        {device === 'phone' ? <PhoneFrame payload={payload} /> : <ComputerFrame payload={payload} url={url} />}
      </div>
    </div>
  )
}

/** The frame hears "ready" when it loads, and gets whatever's latest - then every change after. */
function useFrame(payload: PreviewPayload) {
  const ref = useRef<HTMLIFrameElement>(null)
  const json = JSON.stringify(payload)
  const latest = useRef(json)
  latest.current = json
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== ref.current?.contentWindow || e.data?.type !== 'mmb-preview-ready') return
      ref.current?.contentWindow?.postMessage({ type: 'mmb-preview', payload: JSON.parse(latest.current) }, window.location.origin)
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  }, [])
  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ type: 'mmb-preview', payload: JSON.parse(json) }, window.location.origin)
  }, [json])
  return ref
}

const PHONE = { w: 375, h: 780, scale: 0.8, bar: 26 }

function PhoneFrame({ payload }: { payload: PreviewPayload }) {
  const ref = useFrame(payload)
  const inner = { w: PHONE.w * PHONE.scale, h: PHONE.h * PHONE.scale }
  return (
    <div className="relative shrink-0 rounded-[46px] border-[10px] border-[#121210] bg-card shadow-[0_34px_70px_-30px_rgba(18,18,16,0.45)]" style={{ width: inner.w + 20, height: inner.h + 20 }}>
      <div className="flex size-full flex-col overflow-hidden rounded-[36px] bg-card">
        <div className="relative shrink-0" style={{ height: PHONE.bar }}>
          <span className="absolute left-1/2 top-[7px] h-[20px] w-[84px] -translate-x-1/2 rounded-full bg-[#121210]" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <iframe
            ref={ref}
            src={PREVIEW_PATH}
            title="The checkout on a phone"
            className="block border-0"
            style={{ width: PHONE.w, height: (inner.h - PHONE.bar) / PHONE.scale, transform: `scale(${PHONE.scale})`, transformOrigin: '0 0' }}
          />
        </div>
      </div>
    </div>
  )
}

const COMPUTER = { w: 1280, h: 800 }

function ComputerFrame({ payload, url }: { payload: PreviewPayload; url: string }) {
  const ref = useFrame(payload)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = width / COMPUTER.w
  return (
    <div ref={box} className="w-full max-w-[900px] overflow-hidden rounded-[12px] border border-line bg-card shadow-[0_30px_60px_-30px_rgba(18,18,16,0.4)]">
      <div className="flex h-10 items-center gap-3 border-b border-line bg-[#F7F7F5] px-3.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#FF5F57]" />
          <span className="size-2.5 rounded-full bg-[#FEBC2E]" />
          <span className="size-2.5 rounded-full bg-[#28C840]" />
        </span>
        <span className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 font-mono text-[11.5px] text-muted">
          <Lock className="size-3 shrink-0" />
          <span className="truncate">{url}</span>
        </span>
      </div>
      <div className="overflow-hidden" style={{ height: COMPUTER.h * scale }}>
        <iframe
          ref={ref}
          src={PREVIEW_PATH}
          title="The checkout on a computer"
          className="block border-0"
          style={{ width: COMPUTER.w, height: COMPUTER.h, transform: `scale(${scale})`, transformOrigin: '0 0' }}
        />
      </div>
    </div>
  )
}

/* ─── The form's pieces ────────────────────────────────────────────── */

/** A small capitalised label over a group: "What are you charging for". */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-dim">{children}</div>
}

/** A group's own label, above its rows. */
export function GroupLabel({ children, info }: { children: ReactNode; info?: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[14px] font-semibold text-fg">
      {children}
      {info && (
        <span title={info} className="text-dim">
          <Info className="size-3.5" />
        </span>
      )}
    </div>
  )
}

/** A field that opens a sheet: what it is on the left, what it costs on the right. */
export function SheetField({ value, aside, placeholder, onOpen }: { value: string; aside?: string; placeholder: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex h-11 w-full items-center gap-3 rounded-[8px] border border-line bg-card px-3.5 text-left transition hover:border-[#CFCCC3]">
      {value ? (
        <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{value}</span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] text-muted">
          <Plus className="size-4" /> {placeholder}
        </span>
      )}
      {aside && <span className="shrink-0 text-[13px] text-dim">{aside}</span>}
      <ChevronDown className="size-4 shrink-0 text-muted" />
    </button>
  )
}

/** One line that opens in place: "All    Change". */
export function Choice({ value, open, onToggle, children, action = 'Change' }: { value: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; action?: string }) {
  return (
    <div className={cx('rounded-[8px] border bg-card transition', open ? 'border-[#CFCCC3]' : 'border-line')}>
      <button type="button" onClick={onToggle} className="flex h-11 w-full items-center gap-3 px-3.5 text-left">
        <span className="min-w-0 flex-1 truncate text-[14px] text-fg">{value}</span>
        <span className="flex shrink-0 items-center gap-1 text-[13.5px] font-medium text-fg">
          {action} <ChevronDown className={cx('size-3.5 transition', open && 'rotate-180')} />
        </span>
      </button>
      {open && <div className="rise border-t border-line p-3.5">{children}</div>}
    </div>
  )
}

/** A row that folds away: "Redirects  none". */
export function Fold({ label, value, children, start = false }: { label: string; value?: ReactNode; children: ReactNode; start?: boolean }) {
  const [open, setOpen] = useState(start)
  return (
    <div className={cx('rounded-[8px] border bg-card transition', open ? 'border-[#CFCCC3]' : 'border-line')}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex h-11 w-full items-center gap-2 px-3.5 text-left">
        <span className="shrink-0 text-[14px] font-medium text-fg">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] text-dim">{value}</span>
        <ChevronDown className={cx('size-4 shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && <div className="rise border-t border-line p-3.5">{children}</div>}
    </div>
  )
}

/** A checkbox in its own box, like the form's other rows. */
export function CheckRow({ checked, onChange, disabled, children, hint }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-3 rounded-[8px] border border-line bg-card px-3.5 py-3 transition', disabled ? 'cursor-default' : 'cursor-pointer hover:border-[#CFCCC3]')}>
      <span className={cx('mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition', checked ? 'border-fg bg-fg' : 'border-[#C9C6BC] bg-card', disabled && 'opacity-40')}>
        {checked && <Check className="size-3 text-white" strokeWidth={3} />}
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="min-w-0">
        <span className={cx('block text-[14px] leading-snug', disabled ? 'text-muted' : 'text-fg')}>{children}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-dim">{hint}</span>}
      </span>
    </label>
  )
}

/** The bottom of the form: what's wrong, if anything, and the one button. */
export function BuilderSubmit({ problem, children }: { problem?: string; children: ReactNode }) {
  return (
    <div className="mt-8">
      {problem && <div className="mb-4 rounded-lg border border-[#EFC4C0] bg-[#FBEAE8] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#7D1F19]">{problem}</div>}
      <div className="flex justify-end gap-2">{children}</div>
    </div>
  )
}
