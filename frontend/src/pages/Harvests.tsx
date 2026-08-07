import { ArrowLeft, Droplets, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatNumber } from '@/lib/format'
import type { Harvest } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)

/** §28 — the extraction log. Each row leads to the LOT it produced. */
export function HarvestsPage() {
  const [year, setYear] = useState<number | ''>('')
  const { data, error, loading } = useResource<{ harvests: Harvest[] }>(
    `/harvests${year ? `?year=${year}` : ''}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const harvests = data?.harvests ?? []
  const seasonKg = harvests.reduce((sum, h) => sum + (h.totalKg ?? 0), 0)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Vrcanje</h1>
      </div>

      <Link
        to="/vrcanja/novo"
        className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-5" />
        Novo vrcanje
      </Link>

      <Select value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} aria-label="Godina">
        <option value="">Sve godine</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {harvests.length === 0 ? (
        <EmptyState
          icon={Droplets}
          title="Još nema evidentiranog vrcanja"
          description="Svako vrcanje dobiva svoj LOT broj kojim se med prati sve do staklenke."
          action={{ to: '/vrcanja/novo', label: 'Unesi vrcanje' }}
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex items-baseline justify-between py-3">
              <span className="text-sm text-muted-foreground">
                {year ? `${year}. godina` : 'Ukupno izvrcano'}
              </span>
              <span className="tabular text-xl font-semibold">{formatNumber(seasonKg)} kg</span>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {harvests.map((h) => (
              <Link key={h.id} to={`/vrcanja/${h.id}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{h.pasture}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(h.harvestedOn)} · {h.apiaryName}
                          {h.hiveRange ? ` · košnice ${h.hiveRange}` : ''}
                        </p>
                      </div>
                      <span className="tabular shrink-0 font-semibold">{formatNumber(h.totalKg)} kg</span>
                    </div>
                    {h.lotCode && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="tabular rounded-md bg-secondary px-1.5 py-0.5 font-medium text-secondary-foreground">
                          {h.lotCode}
                        </span>
                        <span>na skladištu {formatNumber(h.availableKg)} kg</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
