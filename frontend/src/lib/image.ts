const MAX_EDGE = 1600
const QUALITY = 0.82

/**
 * Documents get more pixels than diary photos (§18, §31, §39).
 *
 * 1600 px is plenty to see a brood pattern, and nowhere near enough to read the units column of a
 * laboratory finding or the VAT line of a crumpled receipt. 2400 sits just under the 2576 px long
 * edge the model accepts, so nothing is thrown away server-side; the higher JPEG quality is there
 * because compression artefacts on small print are exactly what turns a 7 into a 1.
 */
const DOCUMENT_MAX_EDGE = 2400
const DOCUMENT_QUALITY = 0.9

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Downscales a camera photo before upload (§44).
 *
 * Done on the phone rather than the server on purpose: a modern camera JPEG is 4-6 MB and the
 * upload happens standing at an apiary with one bar of signal. 1600px on the long edge is enough
 * to see brood pattern or a queen cell, and lands around 200-400 kB.
 */
export async function prepareImage(file: File, kind: 'photo' | 'document' = 'photo'): Promise<PreparedImage> {
  const maxEdge = kind === 'document' ? DOCUMENT_MAX_EDGE : MAX_EDGE
  const quality = kind === 'document' ? DOCUMENT_QUALITY : QUALITY

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas nije dostupan')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', quality),
  )
  if (!blob) throw new Error('Sliku nije moguće obraditi')

  return { blob, width, height }
}

export async function uploadPhoto(
  file: File,
  entityType: 'hive_inspection' | 'hive' | 'apiary',
  entityId: string,
  /** §44 — the caption, once the beekeeper has confirmed it. Never sent unconfirmed. */
  caption?: string | null,
): Promise<void> {
  const { blob, width, height } = await prepareImage(file)

  const form = new FormData()
  form.append('file', blob, 'photo.jpg')
  form.append('entityType', entityType)
  form.append('entityId', entityId)
  form.append('width', String(width))
  form.append('height', String(height))
  if (caption?.trim()) form.append('caption', caption.trim())

  // Not routed through lib/api: that helper sets a JSON content type, and multipart needs the
  // browser to generate its own boundary.
  const response = await fetch(`${import.meta.env.BASE_URL}api/photos`, {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error((payload?.error as string | undefined) ?? 'Slanje slike nije uspjelo')
  }
}
