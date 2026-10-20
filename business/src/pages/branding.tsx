/**
 * Branding: the business's own look on the checkout its customers see.
 *
 * A logo, a surface colour for the order summary, an accent for the pay
 * button, and a line to say after a payment - previewed live as the real
 * checkout, on a phone or a desktop. Text on the accent is picked for
 * contrast, so no choice of colour can make the pay button unreadable.
 *
 * Live, saving keeps it with the business on our side, and every checkout,
 * payment link and invoice wears it from then on.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, Clock, Download, ImagePlus, Lock, Monitor, ShieldCheck, Smartphone, Trash2 } from '@/components/icons'
import { Button, Card, Field, PageHeader, Segmented, Textarea, cx } from '@/components/ui'
import { AppIcon, Avatar, BankMark, CryptoMark, Flag, Logo, TokenIcon } from '@/components/brand'
import { useSession } from '@/state/session'
import { DEFAULT_BRANDING, PALETTES, isHex, onColor, useBranding, type Branding as Brand } from '@/state/branding'
import { NGN_RATE } from '@/data/mock'
import { ngn, usd } from '@/lib/format'
import { LIVE, api, uploadFile, type ApiBrand } from '@/lib/api'
import { asDataUrl, fromDataUrl, shrinkImage } from '@/lib/image'
import { pictureProblem, useApplyBrand } from '@/components/Pictures'

export function Branding() {
  const { business } = useSession()
  const [saved = DEFAULT_BRANDING, save] = useBranding(business?.id)
  const apply = useApplyBrand()
  const [b, setB] = useState<Brand>(saved)
  const [touched, setTouched] = useState(false)
  const [view, setView] = useState<'phone' | 'desktop'>('phone')
  const [screen, setScreen] = useState<'pay' | 'done'>('pay')
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  // What's saved arrives from our side a moment after the page opens - shown, unless they've started changing it.
  useEffect(() => {
    if (!touched) setB(saved)
  }, [saved, touched])
  if (!business) return null

  const canEdit = !LIVE || business.role === 'OWNER' || business.role === 'ADMIN'
  const dirty = JSON.stringify(b) !== JSON.stringify(saved)
  const valid = isHex(b.surface) && isHex(b.accent)
  const upd = (p: Partial<Brand>) => {
    setTouched(true)
    setSaveError('')
    setB((x) => ({ ...x, ...p }))
  }

  const onLogo = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      upd({ logo: await asDataUrl(await shrinkImage(f)) })
    } catch (e) {
      setError(pictureProblem(e))
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  const persist = async () => {
    setSaveError('')
    if (!LIVE) {
      save(b)
    } else {
      setBusy(true)
      try {
        const path = `/businesses/${business.id}/branding`
        if (b.logo !== saved.logo) {
          if (b.logo) await uploadFile(`${path}/logo`, await fromDataUrl(b.logo, 'logo'))
          else await api('DELETE', `${path}/logo`)
        }
        const r = await api<{ brand: ApiBrand }>('PATCH', path, { surface: b.surface, accent: b.accent, success: b.success.trim() })
        apply(business.id, r.brand)
        setB(r.brand)
      } catch (e) {
        setSaveError(pictureProblem(e))
        return
      } finally {
        setBusy(false)
      }
    }
    setTouched(false)
    setFlash(true)
    setTimeout(() => setFlash(false), 2200)
  }

  return (
    <>
      <PageHeader
        title="Branding"
        sub="How your checkout, payment links and invoices look to your customers."
        actions={
          canEdit && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {saveError ? (
                <span className="text-[13px] text-red">{saveError}</span>
              ) : flash ? (
                <span className="flex items-center gap-1.5 text-[13px] text-good">
                  <Check className="size-4" strokeWidth={3} /> Saved, live on your checkout
                </span>
              ) : (
                dirty && <span className="text-[12.5px] text-dim">Unsaved changes</span>
              )}
              <Button variant="ghost" onClick={() => upd(DEFAULT_BRANDING)} disabled={busy || JSON.stringify(b) === JSON.stringify(DEFAULT_BRANDING)}>
                Reset
              </Button>
              <Button variant="primary" disabled={!dirty || !valid || busy} onClick={() => void persist()}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )
        }
      />
      {!canEdit && <p className="-mt-2 mb-6 text-[13px] text-muted">The owner or an admin can change the branding. This is how your checkout looks now.</p>}

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_350px]">
        {/* The controls */}
        <Card className="divide-y divide-line self-start">
          <section className="p-5">
            <div className="text-[14px] font-semibold text-fg">Logo</div>
            <div className="mt-3 flex items-center gap-3.5">
              <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line bg-raise">
                {b.logo ? <img src={b.logo} alt="" className="size-full object-contain" /> : <Avatar name={business.name} size={56} square />}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" icon={<ImagePlus className="size-3.5" />} onClick={() => file.current?.click()}>
                    {b.logo ? 'Replace' : 'Upload'}
                  </Button>
                  {b.logo && (
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => upd({ logo: null })}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className={cx('mt-1.5 text-[12px]', error ? 'text-red' : 'text-dim')}>{error || 'Square works best, at least 128 px. Otherwise we use your initials.'}</p>
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void onLogo(e.target.files?.[0])} />
            </div>
          </section>

          <section className="p-5">
            <div className="text-[14px] font-semibold text-fg">Colours</div>
            <p className="mt-0.5 text-[12.5px] text-muted">Start from a palette, or set your own.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PALETTES.map((p) => {
                const on = b.surface.toLowerCase() === p.surface.toLowerCase() && b.accent.toLowerCase() === p.accent.toLowerCase()
                return (
                  <button
                    key={p.name}
                    onClick={() => upd({ surface: p.surface, accent: p.accent })}
                    className={cx('flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[12px] transition', on ? 'border-fg bg-card font-medium text-fg shadow-[0_0_0_1px_#121210]' : 'border-line text-muted hover:border-[#D3D0C7] hover:text-fg')}
                  >
                    <span className="size-5 rounded-full border border-black/10" style={{ background: `linear-gradient(135deg, ${p.surface} 50%, ${p.accent} 50%)` }} />
                    {p.name}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ColourField label="Surface" hint="Order summary" value={b.surface} onChange={(v) => upd({ surface: v })} />
              <ColourField label="Accent" hint="Pay button" value={b.accent} onChange={(v) => upd({ accent: v })} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-dim">
              <span className="inline-flex h-6 items-center rounded-[6px] px-2 text-[11.5px] font-semibold" style={{ background: isHex(b.accent) ? b.accent : '#121210', color: onColor(b.accent) }}>
                Pay
              </span>
              Button text turns {onColor(b.accent) === '#FFFFFF' ? 'white' : 'black'} on its own, so it always reads.
            </div>
          </section>

          <section className="p-5">
            <Field label="After-payment message" optional aside={<span className="tabular text-[12px] text-dim">{b.success.length} / 280</span>} hint="Shown on the receipt, under the amount.">
              <Textarea
                value={b.success}
                onChange={(e) => upd({ success: e.target.value.slice(0, 280) })}
                placeholder="Thank you! Your order is on its way. We'll send tracking to your email."
                className="min-h-[84px]"
              />
            </Field>
          </section>
        </Card>

        {/* The preview */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={screen}
              onChange={setScreen}
              options={[
                { id: 'pay', label: 'Checkout' },
                { id: 'done', label: 'Receipt' },
              ]}
            />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: 'phone', label: 'Phone' },
                { id: 'desktop', label: 'Desktop' },
              ]}
            />
          </div>
          <div
            className="flex items-center justify-center overflow-hidden rounded-[16px] border border-line px-4 py-8"
            style={{ background: 'radial-gradient(circle at 1px 1px, #DCD9D0 1px, transparent 0) 0 0 / 18px 18px, #F7F6F2' }}
          >
            {view === 'phone' ? (
              <Phone>
                <CheckoutPreview b={b} name={business.name} screen={screen} />
              </Phone>
            ) : (
              <Fit width={760}>
                <Browser>
                  <CheckoutPreview b={b} name={business.name} screen={screen} wide />
                </Browser>
              </Fit>
            )}
          </div>
          <p className="mt-2.5 text-center text-[12px] text-dim">
            <span className="inline-flex items-center gap-1">
              {view === 'phone' ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
            </span>{' '}
            A live preview with a sample order. The "Secured by Money Moves" mark always stays.
          </p>
        </div>
      </div>
    </>
  )
}

function ColourField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-fg">
        {label} <span className="font-normal text-dim">· {hint}</span>
      </span>
      <span className={cx('mt-1.5 flex h-10 items-center gap-2 rounded-[8px] border bg-card pl-1.5 pr-2', isHex(value) ? 'border-line' : 'border-red')}>
        <span className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-[6px] border border-black/10" style={{ background: isHex(value) ? value : '#fff' }}>
          <input type="color" value={isHex(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label} colour`} />
        </span>
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} maxLength={7} className="min-w-0 flex-1 bg-transparent font-mono text-[13px] uppercase text-fg outline-none" />
      </span>
    </label>
  )
}

/** A phone: status bar, dynamic island, and a tall screen. */
function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-[330px] rounded-[52px] bg-fg p-[10px] shadow-[0_40px_80px_-30px_rgba(18,18,16,0.45)]">
      <div className="relative h-[724px] overflow-hidden rounded-[42px] bg-card">
        <div className="absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between px-7 text-[12px] font-semibold text-fg">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-px">
              {[4, 6, 8, 10].map((h) => (
                <span key={h} className="w-[3px] rounded-sm bg-fg" style={{ height: h }} />
              ))}
            </span>
            <span className="ml-1 h-[10px] w-[20px] rounded-[3px] border border-fg p-px">
              <span className="block h-full w-3/4 rounded-[1px] bg-fg" />
            </span>
          </span>
        </div>
        <div className="absolute left-1/2 top-2.5 z-20 h-[26px] w-[96px] -translate-x-1/2 rounded-full bg-fg" />
        <div className="h-full overflow-hidden pt-11">{children}</div>
        <div className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-fg/80" />
      </div>
    </div>
  )
}

/** Draws its child at a fixed width and scales it down to the space there is - a desktop page shrunk, not squeezed. */
function Fit({ width, children }: { width: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState<number>()
  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !inner.current) return
      const k = Math.min(1, box.current.clientWidth / width)
      setScale(k)
      setHeight(inner.current.offsetHeight * k)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (box.current) ro.observe(box.current)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} className="w-full" style={{ height }}>
      <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  )
}

/** A desktop browser window. */
function Browser({ children }: { children: ReactNode }) {
  return (
    <div className="w-full overflow-hidden rounded-[12px] border border-line bg-card shadow-[0_30px_60px_-24px_rgba(18,18,16,0.35)]">
      <div className="flex items-center gap-1.5 border-b border-line bg-raise px-3 py-2">
        {['#E5584F', '#E8B23A', '#5CB85C'].map((c) => (
          <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
        ))}
        <span className="ml-3 flex flex-1 items-center gap-1.5 truncate rounded-[6px] bg-card px-2 py-1 font-mono text-[10.5px] text-dim">
          <Lock className="size-3" /> pay.usemoneymoves.xyz/c/chk_9s2k4m
        </span>
      </div>
      {children}
    </div>
  )
}

/** The real checkout, small: the same parts in the same places, in the business's colours. */
function CheckoutPreview({ b, name, screen, wide }: { b: Brand; name: string; screen: 'pay' | 'done'; wide?: boolean }) {
  const accent = isHex(b.accent) ? b.accent : '#121210'
  const surface = isHex(b.surface) ? b.surface : '#F5F4F0'
  const solid = { background: accent, color: onColor(accent) }
  const amount = 120
  const first = name.split(' ')[0]
  const paid = screen === 'done'

  const brandRow = (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card">
        {b.logo ? <img src={b.logo} alt="" className="size-full object-contain" /> : <Avatar name={name} size={36} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-fg">{name}</span>
        <span className="flex items-center gap-1 whitespace-nowrap text-[10.5px] text-muted">
          <ShieldCheck className="size-3 shrink-0" weight="fill" /> Verified by Money Moves
        </span>
      </span>
    </div>
  )

  const expires = (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#F2D3A6] bg-[#FDF3E3] px-2 py-0.5 text-[10.5px] font-medium text-[#A4600B]">
      <Clock className="size-3" /> {wide && 'Expires in'} <span className="tabular font-semibold">29:55</span>
    </span>
  )

  const amountBlock = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] text-muted">Order #1042</span>
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-fg/10 bg-card py-0.5 pl-0.5 pr-2 text-[10.5px] font-semibold text-fg shadow-[0_1px_2px_rgba(18,18,16,0.06)]">
          <Flag c="USD" size={16} /> Pay in USD <ChevronDown className="size-2.5 text-muted" />
        </span>
      </div>
      <div className={cx('display tabular mt-1.5 font-semibold leading-none tracking-[-0.035em] text-fg', wide ? 'text-[34px]' : 'text-[28px]')}>{usd(amount)}</div>
      <div className="tabular mt-1.5 text-[10.5px] text-dim">
        ≈ {ngn(amount * NGN_RATE)} · ₦{NGN_RATE.toLocaleString()} to $1
      </div>
    </>
  )

  const rows = (
    <div className="divide-y divide-fg/10 text-[11.5px]">
      <div className="space-y-1.5 pb-3">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Subtotal</span>
          <span className="tabular text-fg">{usd(amount)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Processing fee</span>
          <span className="text-fg">None for you</span>
        </div>
      </div>
      <div className="flex justify-between gap-3 pt-3 font-semibold text-fg">
        <span>{paid ? 'Paid' : 'Total'}</span>
        <span className="tabular">{usd(amount)}</span>
      </div>
    </div>
  )

  const radio = (on: boolean) => (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? accent : '#C9C6BC' }}>
      {on && <span className="size-2 rounded-full" style={{ background: accent }} />}
    </span>
  )

  const methods = (
    <div className="overflow-hidden rounded-[12px] border border-line bg-card">
      <div className="m-[3px] rounded-[10px] border-2" style={{ borderColor: accent }}>
        <div className="flex items-center gap-2 px-2.5 py-2.5">
          {radio(true)}
          <AppIcon size={20} />
          <span className="min-w-0 flex-1 text-[12px] font-medium text-fg">Money Moves app</span>
          <span className="rounded-full bg-[#E4F2E8] px-1.5 py-px text-[9.5px] font-semibold text-good">No fees</span>
        </div>
        <div className="space-y-2 border-t border-line p-2.5">
          <div className="rounded-[9px] border border-line bg-[#FAFAF8] px-2.5 py-2 text-[10.5px] leading-relaxed text-muted">Approve it in the Money Moves app, one tap on this phone, or scan a code from another.</div>
          <div className="rounded-[9px] border border-line px-2.5 py-1.5">
            <div className="text-[9.5px] text-dim">Email for your receipt · optional</div>
            <div className="text-[11px] text-[#C9C6BC]">you@example.com</div>
          </div>
          <span className="flex h-9 items-center justify-center gap-1 rounded-full text-[12px] font-semibold" style={solid}>
            Pay {usd(amount)} <ArrowRight className="size-3" />
          </span>
          <div className="flex items-center justify-center gap-1 text-[9.5px] text-dim">
            Secured by <Logo compact />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        {radio(false)}
        <CryptoMark size={20} />
        <span className="flex-1 text-[12px] font-medium text-fg">Crypto</span>
        <span className="flex -space-x-1 [&>*]:rounded-full [&>*]:ring-2 [&>*]:ring-white">
          <TokenIcon asset="USDC" size={16} />
          <TokenIcon asset="USDT" size={16} />
        </span>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        {radio(false)}
        <BankMark size={20} />
        <span className="flex-1 text-[12px] font-medium text-fg">Bank transfer</span>
      </div>
    </div>
  )

  const done = (
    <div className="rounded-[14px] border border-line bg-card p-3.5">
      <div className="flex flex-col items-center pt-1 text-center">
        <img src="/brand/checked.png" alt="" className="pop size-11" />
        <div className="display mt-2.5 text-[20px] font-semibold leading-tight tracking-[-0.02em] text-fg">{usd(amount)} paid</div>
        <div className="mt-0.5 text-[11.5px] text-muted">{name} has your payment.</div>
      </div>
      {b.success && (
        <p className="mt-3 rounded-[10px] px-3 py-2.5 text-[11px] leading-relaxed text-fg" style={{ background: surface }}>
          {b.success}
        </p>
      )}
      <div className="mt-3 divide-y divide-soft border-y border-line text-[11px]">
        {[
          ['Paid with', 'Money Moves app'],
          ['Reference', 'MMB-48211'],
          ['Receipt', 'ada@example.com'],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between gap-3 py-2">
            <span className="text-dim">{l}</span>
            <span className={cx('truncate text-fg', l === 'Reference' && 'font-mono')}>{v}</span>
          </div>
        ))}
      </div>
      <span className="mt-3.5 flex h-9 items-center justify-center rounded-full text-[12px] font-semibold" style={solid}>
        Return to {first}
      </span>
      <span className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-full border border-line text-[11.5px] font-semibold text-fg">
        <Download className="size-3.5" /> Download receipt
      </span>
    </div>
  )

  const footer = (
    <div className="mt-5 space-y-1 text-center text-[10px] text-dim">
      <div className="flex items-center justify-center gap-1 text-muted">
        <ShieldCheck className="size-3 text-good" weight="fill" /> Secure payment
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <Lock className="size-2.5" /> Secured by <Logo compact /> <span className="text-line">|</span> Terms · Privacy
      </div>
    </div>
  )

  if (wide)
    return (
      <div className="grid min-h-[460px] grid-cols-[1fr_1.05fr]">
        <div className="flex flex-col px-6 py-6" style={{ background: surface }}>
          {brandRow}
          <div className="mt-8">{amountBlock}</div>
          <div className="mt-6 border-t border-fg/10 pt-4">{rows}</div>
          <div className="mt-4 font-mono text-[10px] text-dim">Ref MMB-48211</div>
        </div>
        <div className="px-6 py-6">
          {!paid && <div className="mb-3 flex justify-end">{expires}</div>}
          {paid ? done : methods}
          {footer}
        </div>
      </div>
    )

  return (
    <div className="px-3 pb-6 pt-2">
      <div className="flex items-center justify-between gap-2">
        {brandRow}
        {!paid && expires}
      </div>
      <div className="mt-3 rounded-[14px] px-3 pb-2.5 pt-3" style={{ background: surface }}>
        {amountBlock}
        <div className="mt-2.5 text-center text-[10.5px] font-medium text-fg underline underline-offset-2">Show details</div>
      </div>
      <div className="mt-3">{paid ? done : methods}</div>
      {footer}
    </div>
  )
}
