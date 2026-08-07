import { ArrowLeft, Bug, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Chart, type ChartPoint } from '@/components/Chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { formatDate, formatNumber } from '@/lib/format'
import type { ObligationLevel, VarroaCheck, VarroaLevel, VarroaResponse } from '@/lib/types'
import { useResource } from '@/lib/useResource'

export const METHOD_LABEL: Record<string, string> = {
  natural_fall: 'Prirodni pad',
  powdered_sugar: 'Šećer u prahu',
  alcohol_wash: 'Alkoholno ispiranje',
  co2: 'CO₂ metoda',
  other: 'Druga metoda',
}

export const PHASE_LABEL: Record<string, string> = {
  before_treatment: 'prije tretmana',
  after_treatment: 'nakon tretmana',
  routine: 'redovna kontrola',
}

const LEVEL_LABEL: Record<VarroaLevel, string> = {
  low: 'Nisko',
  moderate: 'Povišeno',
  high: 'Visoko',
  unknown: 'Bez ocjene',
}

/** Maps the varroa scale onto the app's shared status vocabulary. */
export function levelTone(level: VarroaLevel): ObligationLevel {
  return level === 'high' ? 'critical' : level === 'moderate' ? 'caution' : level === 'low' ? 'ok' : 'info'
}

const chartTone = (level: VarroaLevel) =>
  level === 'high' ? ('critical' as const) : level === 'moderate' ? ('caution' as const) : ('ok' as const)

function CheckRow({ check }: { check: VarroaCheck }) {
  const isFall = check.method === 'natural_fall'
  const value = isFall ? check.mitesPerDay : check.infestationPercent
  const unit = isFall ? 'varoa/dan' : '%'

  return (
    <li className="border-b border-border py-3 last:border-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{formatDate(check.checkedOn)}</span>
        <StatusPill level={levelTone(check.level)}>{LEVEL_LABEL[check.level]}</StatusPill>
      </div>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="tabular text-lg font-semibold">
          {formatNumber(value)} {unit}
        </span>
        <span className="text-xs text-muted-foreground">
          {METHOD_LABEL[check.method]} · {PHASE_LABEL[check.phase]}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">
        {check.apiaryName}
        {check.hiveCode ? ` · košnica ${check.hiveCode}` : ''}
        {isFall
          ? ` · ${check.mitesFound} varoa / ${check.daysObserved} dana`
          : ` · ${check.mitesFound} varoa / ${check.beesExamined} pčela`}
      </p>
      {check.notes && <p className="mt-1 text-sm">{check.notes}</p>}
    </li>
  )
}

/** §16 — the varroa monitoring screen: the year's curve, then the readings behind it. */
export function VarroaPage() {
  const [params] = useSearchParams()
  const [apiaryId, setApiaryId] = useState(params.get('pcelinjak') ?? '')
  const { data: apiaryData } = useResource<{ apiaries: { id: string; name: string }[] }>('/apiaries')
  const query = apiaryId ? `?apiaryId=${apiaryId}` : ''
  const { data, error, loading } = useResource<VarroaResponse>(`/varroa${query}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const toPoints = (points: VarroaResponse['series']['sample']): ChartPoint[] =>
    points.map((p) => ({
      date: p.date,
      value: p.value,
      tone: chartTone(p.level),
      label: `${formatDate(p.date)} (${PHASE_LABEL[p.phase]})`,
    }))

  const sample = toPoints(data.series.sample)
  const fall = toPoints(data.series.fall)

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Kontrola varoe</h1>
      </div>

      <Link
        to="/varroa/nova"
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-5" />
        Nova kontrola
      </Link>

      {apiaryData && apiaryData.apiaries.length > 1 && (
        <Select value={apiaryId} onChange={(e) => setApiaryId(e.target.value)} aria-label="Pčelinjak">
          <option value="">Svi pčelinjaci</option>
          {apiaryData.apiaries.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      )}

      {/* §16 "Graf prikazuje razvoj kroz godinu" — two charts, not one. A sugar roll measures a
          percentage of sampled bees, a board count measures mites per day; one shared axis would
          be a chart that looks authoritative and means nothing. */}
      {sample.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Infestacija kroz {data.year}. ({'%'})</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart
              points={sample}
              year={data.year}
              unit=" %"
              ariaLabel={`Infestacija varoom kroz ${data.year}. godinu`}
              bands={[
                { from: 0, to: data.thresholds.sample.moderate, tone: 'ok' },
                { from: data.thresholds.sample.moderate, to: data.thresholds.sample.high, tone: 'caution' },
                { from: data.thresholds.sample.high, to: 100, tone: 'critical' },
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Uzorak pčela (šećer u prahu, alkoholno ispiranje, CO₂). Pragovi:{' '}
              {data.thresholds.sample.moderate} % povišeno, {data.thresholds.sample.high} % visoko.
            </p>
          </CardContent>
        </Card>
      )}

      {fall.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prirodni pad kroz {data.year}. (varoa/dan)</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart
              points={fall}
              year={data.year}
              unit=" varoa/dan"
              ariaLabel={`Prirodni pad varoe kroz ${data.year}. godinu`}
              bands={[
                { from: 0, to: data.thresholds.fall.moderate, tone: 'ok' },
                { from: data.thresholds.fall.moderate, to: data.thresholds.fall.high, tone: 'caution' },
                { from: data.thresholds.fall.high, to: 1000, tone: 'critical' },
              ]}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Prirodni pad se tumači ovisno o sezoni — isti broj u svibnju i u rujnu ne znači isto.
            </p>
          </CardContent>
        </Card>
      )}

      {data.checks.length === 0 ? (
        <EmptyState
          icon={Bug}
          title="Još nema kontrola varoe"
          description="Prva kontrola daje polazišnu točku za cijelu sezonu."
          action={{ to: '/varroa/nova', label: 'Unesi kontrolu' }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sve kontrole</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {data.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Disclaimer text="Pragovi su orijentacijske vrijednosti u širokoj upotrebi, a ne propisana granica. Odluku o tretmanu donosite prema stanju zajednica, sezoni i uputi veterinara." />
    </div>
  )
}
