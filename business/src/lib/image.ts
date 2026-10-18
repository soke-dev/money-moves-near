/**
 * Pictures are shrunk here before they're sent: a logo to fit 512 px with its
 * transparency kept, a photo cropped square. Drawing through a canvas also
 * turns an SVG or a huge camera photo into a plain small PNG or JPEG.
 */
export class PictureError extends Error {}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new PictureError("That picture couldn't be opened. Try a PNG or JPEG."))
    img.src = URL.createObjectURL(file)
  })
}

export async function shrinkImage(file: File, { max = 512, square = false }: { max?: number; square?: boolean } = {}): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PictureError('Pick a picture, a PNG, JPEG, WebP or SVG.')
  if (file.size > 15_000_000) throw new PictureError('That picture is too big. Use one under 15 MB.')
  const img = await load(file)
  const w = img.naturalWidth || 512
  const h = img.naturalHeight || 512
  const canvas = document.createElement('canvas')
  const x = canvas.getContext('2d')!
  if (square) {
    const side = Math.min(w, h)
    const out = Math.min(max, side)
    canvas.width = canvas.height = out
    x.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out)
  } else {
    const scale = Math.min(1, max / Math.max(w, h))
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    x.drawImage(img, 0, 0, canvas.width, canvas.height)
  }
  URL.revokeObjectURL(img.src)
  const type = square ? 'image/jpeg' : 'image/png'
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PictureError("That picture couldn't be read."))), type, 0.9))
}

export const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(blob)
  })

/** A shrunk picture as a file to send. */
export const asFile = (blob: Blob, name: string) => new File([blob], `${name}.${blob.type === 'image/jpeg' ? 'jpg' : 'png'}`, { type: blob.type })

/** A picture picked on the page (a data URL) back into a file to send. */
export const fromDataUrl = async (url: string, name: string) => asFile(await (await fetch(url)).blob(), name)
