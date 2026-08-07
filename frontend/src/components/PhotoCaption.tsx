import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AI_DISCLAIMER, postForm, useAiStatus } from '@/lib/ai'
import { prepareImage } from '@/lib/image'

/**
 * §44 — a caption for a photo in the hive diary, proposed and then confirmed.
 *
 * The constraint is the feature. §44 asks for a description and the scenario is explicit that
 * there is to be no automatic disease diagnosis, so the model is instructed to describe and
 * forbidden to conclude — and the sentence below the suggestion repeats that to the beekeeper in
 * the same words. A confident "izgleda zdravo" over a frame of chalkbrood is the failure that
 * matters here, and it is worse than saying nothing, because it stops someone calling a vet.
 *
 * Describing costs a model call, so it is a button rather than something that fires on every
 * photo. Failure is silent by design: the caption is optional, and a photo without one is a photo,
 * while a blocked upload is a lost observation.
 */
interface PhotoCaptionProps {
  file: File
  onConfirm: (caption: string | null) => void
  onCancel: () => void
  saving?: boolean
}

export function PhotoCaption({ file, onConfirm, onCancel, saving = false }: PhotoCaptionProps) {
  const { status } = useAiStatus()
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setPreview(url)
    // Revoked on unmount: a blob URL held after the screen closes keeps the whole image in memory,
    // and a day on the apiary is forty of them.
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function describe() {
    setBusy(true)
    setError(null)
    try {
      const { blob } = await prepareImage(file)
      const form = new FormData()
      form.append('image', blob, 'fotografija.jpg')
      const { description } = await postForm<{ description: string }>('/ai/describe', form)
      setCaption(description)
    } catch {
      setError('Opis nije moguće pripremiti. Upišite ga sami ili spremite bez opisa.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3">
      {preview && (
        <img src={preview} alt="Odabrana fotografija" className="max-h-56 w-full rounded-lg object-cover" />
      )}

      <div className="space-y-1.5">
        <label htmlFor="photo-caption" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Opis <span className="font-normal normal-case">(neobavezno)</span>
        </label>
        <textarea
          id="photo-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={2}
          maxLength={255}
          placeholder="npr. Okvir s poklopljenim leglom, pelud u kutovima"
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
        />
      </div>

      {status.available && !status.capReached && (
        <>
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void describe()}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {busy ? 'Gledam sliku…' : 'Predloži opis'}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {AI_DISCLAIMER} Opis govori samo što se na slici vidi — ne postavlja dijagnozu i ne
            procjenjuje zdravlje zajednice. Za to se obratite veterinaru.
          </p>
        </>
      )}
      {error && <p className="text-xs text-critical">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>
          <X />
          Odustani
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={saving}
          onClick={() => onConfirm(caption.trim() || null)}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          Spremi sliku
        </Button>
      </div>
    </div>
  )
}
