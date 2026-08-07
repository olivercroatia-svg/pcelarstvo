import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { ArrowLeft, CameraOff, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/states'
import { api, ApiError } from '@/lib/api'
import type { Hive } from '@/lib/types'

/** Accepts both a full label URL and a bare token pasted or typed in. */
function extractToken(text: string): string | null {
  const trimmed = text.trim()
  const match = /\/skeniraj\/([A-Za-z0-9_-]{22})/.exec(trimmed)
  if (match) return match[1]!
  if (/^[A-Za-z0-9_-]{22}$/.test(trimmed)) return trimmed
  return null
}

/**
 * §11 — point the camera at a hive label, land on its card.
 *
 * Also serves as the landing route for `/skeniraj/:token`, which is what the phone's own camera
 * app opens when it reads the QR. In that case there is nothing to scan: resolve and redirect.
 */
export function ScanPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'idle' | 'scanning' | 'resolving' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  // Deep link from an external camera app — resolve the token straight to the hive card.
  useEffect(() => {
    if (!token) return
    setStatus('resolving')
    api<{ hive: Hive }>(`/hives/by-qr/${token}`)
      .then((result) => navigate(`/kosnice/${result.hive.id}`, { replace: true }))
      .catch((err) => {
        setStatus('error')
        setMessage(err instanceof ApiError ? err.message : 'QR oznaku nije moguće prepoznati')
      })
  }, [token, navigate])

  // Live camera scanning.
  useEffect(() => {
    if (token) return
    let controls: IScannerControls | null = null
    let cancelled = false

    const reader = new BrowserMultiFormatReader()
    setStatus('scanning')

    reader
      .decodeFromConstraints(
        // facingMode 'environment' picks the rear camera; without it phones open the selfie cam.
        { video: { facingMode: 'environment' } },
        videoRef.current!,
        (result) => {
          if (!result || cancelled) return
          const scanned = extractToken(result.getText())
          if (!scanned) return

          cancelled = true
          controls?.stop()
          setStatus('resolving')
          api<{ hive: Hive }>(`/hives/by-qr/${scanned}`)
            .then((res) => navigate(`/kosnice/${res.hive.id}`, { replace: true }))
            .catch((err) => {
              setStatus('error')
              setMessage(err instanceof ApiError ? err.message : 'Košnica nije pronađena')
            })
        },
      )
      .then((c) => {
        controls = c
        if (cancelled) c.stop()
      })
      .catch(() => {
        setStatus('error')
        setMessage(
          'Kamera nije dostupna. Provjerite dopuštenje za kameru u postavkama preglednika — na iPhoneu radi samo preko HTTPS-a.',
        )
      })

    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [token, navigate])

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/kosnice" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Skeniraj košnicu</h1>
      </div>

      {status === 'error' ? (
        <ErrorState message={message ?? 'Skeniranje nije uspjelo'} />
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="relative aspect-square bg-black">
              <video ref={videoRef} className="size-full object-cover" playsInline muted />
              {/* Aiming frame — a full-screen camera with no target makes people hold the phone too far away. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="size-48 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              {status === 'resolving' && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-white">
                  <LoaderCircle className="size-5 animate-spin" />
                  Otvaram košnicu…
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CameraOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        Ako kamera ne radi, otvorite košnicu iz popisa — QR je samo prečac.
      </p>
    </div>
  )
}
