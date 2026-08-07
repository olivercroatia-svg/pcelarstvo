import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { api, ApiError } from '@/lib/api'
import type { PublicJar } from '@/lib/types'

/**
 * §35 — what a customer sees after scanning the QR code on a jar.
 *
 * Rendered outside the app shell and outside the session guard: there is no navigation, no
 * notification bell and no way from here into the beekeeper's application, because whoever is
 * looking at this page is not the beekeeper.
 *
 * It shows exactly the seven lines §35 lists and nothing else. That restriction is enforced by the
 * server — /api/public/jar returns only these fields — so this component could not leak an address
 * or a GPS coordinate even if someone later added a line to it.
 */
export function PublicJarPage() {
  const { token } = useParams<{ token: string }>()
  const [jar, setJar] = useState<PublicJar | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api<{ jar: PublicJar }>(`/public/jar/${token}`)
      .then((result) => {
        if (!cancelled) setJar(result.jar)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Stranica nije dostupna')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="flex min-h-dvh flex-col items-center bg-honeycomb px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-2">
          <BrandMark className="size-10" />
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Podrijetlo meda</p>
        </div>

        {error && (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <p className="font-medium">Stranica nije pronađena</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Provjerite QR kod na staklenci. Moguće je i da je pčelar povukao objavu.
            </p>
          </div>
        )}

        {jar && (
          <>
            <div className="rounded-xl border border-border bg-card p-6 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{jar.productName}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {jar.netWeightG} g
                {jar.isNational ? ' · nacionalna staklenka' : ''}
              </p>
            </div>

            <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              <Row label="Pčelar" value={jar.producer} />
              {jar.place && <Row label="Mjesto" value={jar.place} />}
              {jar.harvestYear !== null && <Row label="Berba" value={`${jar.harvestYear}.`} />}
              <Row label="Paša" value={jar.pasture} />
              <Row label="LOT" value={jar.lotCode} mono />
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-muted-foreground">Laboratorijski pregled</dt>
                <dd className="text-sm font-medium">
                  {jar.laboratoryChecked ? (
                    <span className="flex items-center gap-1 text-ok">
                      <Check className="size-4" aria-hidden />
                      obavljen
                    </span>
                  ) : (
                    <span className="text-muted-foreground">nije evidentiran</span>
                  )}
                </dd>
              </div>
            </dl>

            <p className="px-2 text-center text-xs text-muted-foreground">
              Podaci potječu iz evidencije pčelara vođene u aplikaciji „Moj Pčelinjak". Osobni podaci
              i lokacija pčelinjaka nisu javno dostupni.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? 'tabular text-sm font-semibold' : 'text-sm font-medium'}>{value}</dd>
    </div>
  )
}
