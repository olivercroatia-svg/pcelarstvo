import { Loader2, Mic, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * §13 — capturing the sentence.
 *
 * Tap to start, tap to stop. NOT press-and-hold: this is used one-handed, in gloves, often with a
 * phone wedged against a hive body, and a gesture that fails when your thumb slips loses the whole
 * recording. The same reasoning as the 44 px tap targets everywhere else.
 *
 * The container format is whatever the browser will give us. Chrome and Android produce WebM/Opus;
 * Safari and iOS produce MP4/AAC and nothing else — assuming WebM is the single most common way a
 * voice feature ends up working everywhere except on iPhones, which is most of the field.
 */

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4', // Safari, iOS
  'audio/mpeg',
]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const type of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  // An empty string is legal and means "browser default" — better than refusing to record.
  return ''
}

const voiceSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

const MAX_SECONDS = 180

interface VoiceRecorderProps {
  onRecorded: (blob: Blob, mimeType: string, durationSeconds: number) => void
  busy?: boolean
  disabled?: boolean
}

export function VoiceRecorder({ onRecorded, busy = false, disabled = false }: VoiceRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const elapsed = useRef(0)
  const cancelled = useRef(false)

  /**
   * Releases the microphone. Without stopping the tracks the browser keeps the recording indicator
   * lit after the beekeeper is done, which reads as an app that is still listening.
   */
  function release() {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
  }

  // Covers navigating away mid-recording — the microphone must not survive the screen.
  useEffect(() => release, [])

  async function start() {
    setError(null)
    cancelled.current = false
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      stream.current = media

      const mimeType = pickMimeType()
      if (mimeType === null) throw new Error('unsupported')
      const rec = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media)
      recorder.current = rec
      chunks.current = []
      elapsed.current = 0

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.onstop = () => {
        release()
        setRecording(false)
        setSeconds(0)
        if (cancelled.current) return
        const type = rec.mimeType || 'audio/webm'
        const blob = new Blob(chunks.current, { type })
        if (blob.size > 0) onRecorded(blob, type, elapsed.current)
      }

      rec.start()
      setRecording(true)
      setSeconds(0)
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          // Hard stop rather than letting a pocket-dial upload three minutes of wind noise.
          const next = s + 1
          elapsed.current = next
          if (next >= MAX_SECONDS) rec.stop()
          return next
        })
      }, 1000)
    } catch (err) {
      release()
      setRecording(false)
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Pristup mikrofonu je odbijen. Dopustite ga u postavkama preglednika.'
          : 'Snimanje nije moguće na ovom uređaju.',
      )
    }
  }

  function stop(cancel = false) {
    cancelled.current = cancel
    recorder.current?.stop()
  }

  if (!voiceSupported()) {
    return (
      <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        Ovaj preglednik ne podržava snimanje zvuka. Pregled unesite obrascem.
      </p>
    )
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="space-y-2">
      {recording ? (
        <div className="flex items-center gap-2">
          <Button type="button" size="lg" className="flex-1" onClick={() => stop(false)}>
            <Square />
            Zaustavi · <span className="tabular">{mmss}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-label="Odbaci snimku"
            onClick={() => stop(true)}
          >
            <X />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={busy || disabled}
          onClick={() => void start()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Mic />}
          {busy ? 'Obrađujem…' : 'Snimi pregled'}
        </Button>
      )}

      {recording && (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          {/* aria-hidden: the pulse is decoration, and the timer above already says the same thing. */}
          <span className="size-2 animate-pulse rounded-full bg-critical" aria-hidden />
          Snima se — recite što ste vidjeli, pa zaustavite.
        </p>
      )}
      {error && <p className="text-sm text-critical">{error}</p>}
    </div>
  )
}
