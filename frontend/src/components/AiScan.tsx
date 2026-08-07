import { Camera, Loader2, Sparkles } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { AI_DISCLAIMER, postForm, useAiStatus } from '@/lib/ai'
import { prepareImage } from '@/lib/image'

/**
 * The camera button behind §18, §31 and §39 — photograph a document, get the form filled in.
 *
 * One component for all three because the interaction is identical and only the endpoint differs.
 * It renders NOTHING when the AI layer is unavailable, so a form on an installation without a key
 * looks exactly like it did before this stage rather than sprouting a button that answers 503.
 */
interface AiScanProps<T> {
  endpoint: '/ai/read/vmp' | '/ai/read/lab' | '/ai/read/receipt'
  label: string
  hint: string
  onDraft: (draft: T) => void
  /** Rendered under the button once a draft has been applied — usually the unreadable-field list. */
  children?: ReactNode
}

export function AiScan<T>({ endpoint, label, hint, onDraft, children }: AiScanProps<T>) {
  const { status } = useAiStatus()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!status.available) return null

  async function handle(file: File) {
    setBusy(true)
    setError(null)
    try {
      // 'document' rather than 'photo': small print needs the pixels. See lib/image.ts.
      const { blob } = await prepareImage(file, 'document')
      const form = new FormData()
      form.append('image', blob, 'dokument.jpg')
      onDraft(await postForm<{ draft: T }>(endpoint, form).then((r) => r.draft))
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'ai_cap_reached'
            ? 'Mjesečni limit AI funkcija je dosegnut. Polja unesite ručno.'
            : err.message
          : 'Sliku nije moguće obraditi.',
      )
    } finally {
      setBusy(false)
      // Cleared so photographing the same file twice still fires a change event.
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone instead of the photo library — the receipt is in
        // the beekeeper's hand, not in their gallery.
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handle(file)
        }}
      />
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy || status.capReached}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Camera />}
        {busy ? 'Čitam sliku…' : label}
      </Button>
      {status.capReached && (
        <p className="text-xs text-caution">
          Mjesečni limit AI funkcija je dosegnut — polja unesite ručno.
        </p>
      )}
      {error && <p className="text-xs text-critical">{error}</p>}
      {children}
      <p className="text-[11px] leading-relaxed text-muted-foreground">{AI_DISCLAIMER}</p>
    </div>
  )
}

/**
 * The "I saw this but could not read it" list every extraction returns. Shown as a caution rather
 * than an error: the form is still usable, the beekeeper just has to look at these fields
 * themselves.
 */
export function Unreadable({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null
  return (
    <p className="text-xs text-caution">
      Nije pouzdano pročitano — provjerite ručno: {fields.join(', ')}.
    </p>
  )
}
