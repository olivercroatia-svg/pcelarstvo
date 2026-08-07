import { ArrowLeft, Gauge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/ui/states'
import type { AiUsage } from '@/lib/ai'
import { formatEur, formatNumber } from '@/lib/format'
import { useResource } from '@/lib/useResource'

/**
 * What the AI layer cost this month, per feature (§4 — owner only).
 *
 * Exists because the layer is the one part of this application that spends money while nobody is
 * watching, and a cap the beekeeper cannot see coming is a feature that stops working one morning
 * for no visible reason. The bar is the whole point of the screen.
 */
export function AiUsagePage() {
  const { data, error, loading } = useResource<AiUsage>('/ai/usage')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const unlimited = data.capEur === 0
  const percent = unlimited ? 0 : Math.min(100, Math.round((data.usedEur / data.capEur) * 100))
  const tone = data.capReached ? 'bg-critical' : percent >= 80 ? 'bg-caution' : 'bg-primary'

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/profil" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Potrošnja AI funkcija</h1>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="tabular text-3xl font-bold tracking-tight">{formatEur(data.usedEur)}</span>
            <span className="text-sm text-muted-foreground">
              {unlimited ? 'bez ograničenja' : `od ${formatEur(data.capEur)} ovaj mjesec`}
            </span>
          </div>
          {!unlimited && (
            // A plain div, like every other bar in this application (§40). A chart library for one
            // rectangle would be the largest dependency on the page.
            <div className="h-2 overflow-hidden rounded-full bg-secondary" role="presentation">
              <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
            </div>
          )}
          {data.capReached ? (
            <p className="text-sm text-critical">
              Limit je dosegnut — AI funkcije su pauzirane do prvog u mjesecu. Sve ostalo u
              aplikaciji radi normalno.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Limit postavlja administrator. Kad se dosegne, AI funkcije se pauziraju, a evidencija,
              obrasci i izvještaji rade dalje.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" aria-hidden />
            Po funkciji
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {data.breakdown.length === 0 ? (
            <p className="p-1.5 text-sm text-muted-foreground">Ovaj mjesec još nije bilo poziva.</p>
          ) : (
            data.breakdown.map((row) => (
              <div key={row.feature} className="flex items-center gap-2 rounded-lg p-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {formatNumber(row.calls, 0)}×
                  {row.failures > 0 && (
                    <span className="text-caution"> · {formatNumber(row.failures, 0)} neuspjelo</span>
                  )}
                </span>
                <span className="tabular shrink-0 text-sm font-medium">{formatEur(row.eur)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Iznosi su preračunati iz cjenika davatelja usluge i služe za praćenje, ne kao račun.
        Neuspjeli pozivi se prikazuju jer se ulazni tokeni naplaćuju i kad odgovor ne stigne.
      </p>
    </div>
  )
}
