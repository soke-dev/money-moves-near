/**
 * The pictures of who's who: a business's logo (initials until it has one)
 * and a person's photo - and the controls that change them.
 *
 * Live, a logo is kept with the business on our side and shows on its
 * checkouts; in preview it stays in this browser, with the branding.
 */
import { useRef, useState } from 'react'
import { Camera, ImagePlus, Trash2 } from '@/components/icons'
import { Avatar } from '@/components/brand'
import { Button, cx } from '@/components/ui'
import { useSession } from '@/state/session'
import { DEFAULT_BRANDING, brandingStore, useBranding } from '@/state/branding'
import { ApiError, LIVE, api, uploadFile, type ApiBrand, type Me } from '@/lib/api'
import { PictureError, asDataUrl, asFile, shrinkImage } from '@/lib/image'
import { initials } from '@/lib/format'
import type { Business } from '@/data/mock'

export const pictureProblem = (e: unknown) => (e instanceof ApiError || e instanceof PictureError ? e.message : 'Something went wrong. Try again in a moment.')

/** The business's logo, or its initials. */
export function BusinessMark({ business, size = 32, square = true }: { business: Pick<Business, 'id' | 'name' | 'logo'>; size?: number; square?: boolean }) {
  const [brand] = useBranding(business.id)
  const src = LIVE ? business.logo : brand?.logo
  if (!src) return <Avatar name={business.name} size={size} square={square} />
  return (
    <span className={cx('flex shrink-0 items-center justify-center overflow-hidden border border-line bg-card', square ? 'rounded-[7px]' : 'rounded-full')} style={{ width: size, height: size }}>
      <img src={src} alt="" className="size-full object-contain" />
    </span>
  )
}

/** Your photo, or your initials on ink. */
export function UserPhoto({ name, src, size = 36, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  return src ? (
    <img src={src} alt="" className={cx('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span className={cx('flex shrink-0 items-center justify-center rounded-full bg-fg font-semibold text-white', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.33) }}>
      {initials(name)}
    </span>
  )
}

/** Puts a saved look everywhere it's read: the branding, the business, the sidebar. */
export function useApplyBrand() {
  const { updateBusiness } = useSession()
  return (businessId: string, brand: ApiBrand) => {
    brandingStore.write(businessId, brand)
    updateBusiness(businessId, { logo: brand.logo })
  }
}

/** Upload, replace or remove the business's logo - saved straight away. */
export function LogoControl({ size = 56 }: { size?: number }) {
  const { business } = useSession()
  const [brand = DEFAULT_BRANDING, setBrand] = useBranding(business?.id)
  const apply = useApplyBrand()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!business) return null
  const canEdit = !LIVE || business.role === 'OWNER' || business.role === 'ADMIN'
  const has = LIVE ? !!business.logo : !!brand.logo

  const run = async (work: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (e) {
      setError(pictureProblem(e))
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  const pick = (f: File | undefined) =>
    f &&
    run(async () => {
      const blob = await shrinkImage(f)
      if (!LIVE) setBrand({ ...brand, logo: await asDataUrl(blob) })
      else apply(business.id, (await uploadFile<{ brand: ApiBrand }>(`/businesses/${business.id}/branding/logo`, asFile(blob, 'logo'))).brand)
    })
  const remove = () =>
    run(async () => {
      if (!LIVE) setBrand({ ...brand, logo: null })
      else apply(business.id, (await api<{ brand: ApiBrand }>('DELETE', `/businesses/${business.id}/branding/logo`)).brand)
    })

  return (
    <div className="flex items-center gap-3.5">
      <BusinessMark business={business} size={size} />
      <div className="min-w-0">
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" icon={<ImagePlus className="size-3.5" />} disabled={busy} onClick={() => file.current?.click()}>
              {busy ? 'Saving…' : has ? 'Replace' : 'Upload'}
            </Button>
            {has && (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">The owner or an admin can change the logo.</p>
        )}
        <p className={cx('mt-1.5 text-[12px]', error ? 'text-red' : 'text-dim')}>{error || 'Square works best, at least 128 px. Without one we show your initials.'}</p>
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  )
}

/** Your photo and name, at the top of your profile - tap the photo to change it. */
export function PhotoControl({ name }: { name: string }) {
  const { user, applyMe } = useSession()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [local, setLocal] = useState<string | null>(null)
  if (!user) return null
  const src = LIVE ? user.avatar : local

  const run = async (work: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await work()
    } catch (e) {
      setError(pictureProblem(e))
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  const pick = (f: File | undefined) =>
    f &&
    run(async () => {
      const blob = await shrinkImage(f, { max: 320, square: true })
      if (!LIVE) setLocal(await asDataUrl(blob))
      else applyMe(await uploadFile<Me>('/auth/me/avatar', asFile(blob, 'photo')))
    })
  const remove = () =>
    run(async () => {
      if (!LIVE) setLocal(null)
      else applyMe(await api<Me>('DELETE', '/auth/me/avatar'))
    })

  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => file.current?.click()} disabled={busy} className="group relative shrink-0 rounded-full" aria-label={src ? 'Change your photo' : 'Add a photo'}>
        <UserPhoto name={name} src={src} size={56} />
        <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-card text-fg shadow-[0_1px_3px_rgba(18,18,16,0.25)] transition group-hover:scale-105">
          <Camera className="size-3.5" />
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold text-fg">{name}</div>
        <div className="truncate text-[13px] text-muted">{user.email}</div>
        <div className="mt-1 flex items-center gap-3 text-[12.5px]">
          <button type="button" onClick={() => file.current?.click()} disabled={busy} className="font-medium text-fg underline underline-offset-2 disabled:text-dim">
            {busy ? 'Saving…' : src ? 'Change photo' : 'Add a photo'}
          </button>
          {src && !busy && (
            <button type="button" onClick={() => void remove()} className="text-muted underline underline-offset-2 hover:text-fg">
              Remove
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-[12px] text-red">{error}</p>}
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  )
}
