import { ArrowLeft, BarChart3, Crown, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { Disclaimer } from '@/components/ui/disclaimer'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatNumber } from '@/lib/format'
import type { Analytics, HiveYield, WinterLosses } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/**
 * §41 analitika košnica, §42 analitika matica, §43 gubici zajednica.
 *
 * Kilograms, not euros — which is why a worker can open this and not /ekonomika (§4).
 *
 * The honest caveat is stated on the screen, not only in the code: nothing weighs a single hive.
 * A harvest is recorded once for the whole extraction, so each hive's figure is that total split
 * evenly across the hives that fed it. Across a season a hive that is never in a good harvest does
 * stand out — but "B024 — 58 kg" is an estimate, and a beekeeper deciding whether to requeen
 * deserves to know which.
 */
export function AnalyticsPage() {
  const [year, setYear] = useState<number | null>(null)
  const { data, error, loading } = useResource<Analytics>(`/analytics${year ? `?year=${year}` : ''}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { hives, queenLines, losses } = data

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Analitika</h1>
      </div>

      <Select value={data.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Godina">
        {data.years.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {hives.all.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={`Za ${data.year}. nema izvrcanog meda`}
          description="Rangiranje košnica računa se iz vrcanja i košnica koje su u njemu sudjelovale."
        />
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-3 gap-2 py-3 text-center">
              <Stat label="Ukupno" value={`${formatNumber(hives.totalKg, 1)} kg`} />
              <Stat label="Prosjek" value={hives.averageKg === null ? '—' : `${formatNumber(hives.averageKg, 1)} kg`} />
              <Stat label="Košnica" value={String(hives.all.length)} />
            </CardContent>
          </Card>

          <p className="rounded-lg bg-info/10 p-3 text-xs text-info">
            Prinos po košnici je <strong>procjena</strong>. Vrcanje se mjeri jednom za cijelu turu, pa
            se količina dijeli ravnomjerno na košnice koje su u njoj sudjelovale. Za pojedinačno
            mjerenje trebala bi vaga po košnici.
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-ok" />
                Najproduktivnije
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {hives.top.map((h) => (
                <HiveRow key={h.hiveId} hive={h} max={hives.top[0]?.kg ?? 1} tone="ok" />
              ))}
            </CardContent>
          </Card>

          {hives.bottom.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingDown className="size-4 text-caution" />
                  Najslabije
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {hives.bottom.map((h) => (
                  <HiveRow key={h.hiveId} hive={h} max={hives.top[0]?.kg ?? 1} tone="caution" />
                ))}
                <p className="pt-2 text-xs text-muted-foreground">
                  Slaba košnica je razlog za pregled, ne za odluku sama po sebi: zamjena matice,
                  spajanje zajednice ili dodatno praćenje.
                </p>
              </CardContent>
            </Card>
          )}

          {queenLines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Crown className="size-4" />
                  Po liniji matice
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {queenLines.map((line) => (
                  <div key={line.line} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      {line.line}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({line.hives} {line.hives === 1 ? 'košnica' : 'košnice'})
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular font-medium">{formatNumber(line.averageKg, 1)} kg</span>
                      {line.differencePercent !== null && line.differencePercent !== 0 && (
                        <span
                          className={cn(
                            'tabular ml-2 text-xs font-medium',
                            line.differencePercent > 0 ? 'text-ok' : 'text-caution',
                          )}
                        >
                          {line.differencePercent > 0 ? '+' : ''}
                          {line.differencePercent} %
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Prikazuju se samo linije s barem dvije košnice. Jedna košnica je anegdota.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <LossCard losses={losses.current} labels={losses.reasonLabels} />
      {losses.previous.prepared > 0 && (
        <LossCard losses={losses.previous} labels={losses.reasonLabels} muted />
      )}

      <Disclaimer />
    </div>
  )
}

function HiveRow({ hive, max, tone }: { hive: HiveYield; max: number; tone: 'ok' | 'caution' }) {
  return (
    <Link
      to={`/kosnice/${hive.hiveId}`}
      className="flex min-h-11 items-center gap-2 rounded-lg px-1 hover:bg-accent"
    >
      <span className="tabular w-14 shrink-0 font-medium">{hive.code}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
        <span
          className={cn('block h-full rounded-full', tone === 'ok' ? 'bg-ok' : 'bg-caution')}
          style={{ width: `${Math.max(4, Math.round((hive.kg / max) * 100))}%` }}
        />
      </span>
      <span className="tabular w-16 shrink-0 text-right text-sm font-semibold">
        {formatNumber(hive.kg, 1)} kg
      </span>
    </Link>
  )
}

/** §43 — "Zima 2025./2026. — pripremljeno 128, proljeće 119, gubitak 7,0 %". */
function LossCard({
  losses,
  labels,
  muted,
}: {
  losses: WinterLosses
  labels: Record<string, string>
  muted?: boolean
}) {
  const level = losses.lossPercent === null ? 'info' : losses.lossPercent >= 20 ? 'critical' : losses.lossPercent >= 10 ? 'caution' : 'ok'

  return (
    <Card className={muted ? 'opacity-70' : undefined}>
      <CardHeader>
        <CardTitle className="text-base">Zima {losses.season}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {losses.prepared === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nema evidentiranih zajednica za tu zimu.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Pripremljeno" value={String(losses.prepared)} />
              <Stat label="Proljeće" value={String(losses.survived)} />
              <Stat
                label="Gubitak"
                value={losses.lossPercent === null ? '—' : `${formatNumber(losses.lossPercent, 1)} %`}
                tone={level}
              />
            </div>
            {losses.reasons.length > 0 && (
              <ul className="space-y-0.5 text-sm">
                {losses.reasons.map((r) => (
                  <li key={r.reason} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{labels[r.reason] ?? r.reason}</span>
                    <span className="tabular font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular font-semibold',
          tone === 'ok' && 'text-ok',
          tone === 'caution' && 'text-caution',
          tone === 'critical' && 'text-critical',
        )}
      >
        {value}
      </p>
    </div>
  )
}
