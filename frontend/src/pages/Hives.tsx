import { Boxes, ChevronRight, Plus, QrCode, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import type { Apiary, Hive } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'stale' | 'problem'

const STRENGTH_LABEL: Record<string, string> = {
  weak: 'Slaba',
  medium: 'Srednja',
  strong: 'Jaka',
  very_strong: 'Vrlo jaka',
}

/** A hive is "problematic" if the last look found no queen or swarm preparations. */
function isProblem(hive: Hive): boolean {
  return (
    hive.lastInspection?.queenState === 'not_found' ||
    hive.lastInspection?.swarming === 'cells' ||
    hive.lastInspection?.swarming === 'high_risk'
  )
}

export function HivesPage() {
  const [params, setParams] = useSearchParams()
  const apiaryId = params.get('pcelinjak') ?? ''
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const query = new URLSearchParams()
  if (apiaryId) query.set('apiaryId', apiaryId)
  if (filter === 'stale') query.set('staleDays', '14')

  const { data, error, loading, reload } = useResource<{ hives: Hive[] }>(
    `/hives${query.toString() ? `?${query}` : ''}`,
  )
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  const hives = useMemo(() => {
    let list = data?.hives ?? []
    if (filter === 'problem') list = list.filter(isProblem)
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter((h) => h.code.toLowerCase().includes(needle))
    }
    return list
  }, [data, filter, search])

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Košnice</h1>
        <div className="flex gap-2">
          <Link
            to="/skeniraj"
            aria-label="Skeniraj QR"
            className="inline-flex min-h-11 items-center rounded-lg border border-input px-3 hover:bg-accent"
          >
            <QrCode className="size-5" />
          </Link>
          <Link
            to="/kosnice/nove"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" />
            Nove
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Traži po oznaci…"
            className="pl-9"
            inputMode="search"
          />
        </div>

        {apiaryData && apiaryData.apiaries.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <FilterChip active={!apiaryId} onClick={() => setParams({})}>
              Svi pčelinjaci
            </FilterChip>
            {apiaryData.apiaries.map((a) => (
              <FilterChip
                key={a.id}
                active={apiaryId === a.id}
                onClick={() => setParams({ pcelinjak: a.id })}
              >
                {a.name}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            Sve
          </FilterChip>
          <FilterChip active={filter === 'stale'} onClick={() => setFilter('stale')}>
            Za pregled
          </FilterChip>
          <FilterChip active={filter === 'problem'} onClick={() => setFilter('problem')}>
            Problematične
          </FilterChip>
        </div>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && hives.length === 0 && (
        <EmptyState
          icon={Boxes}
          title={data.hives.length === 0 ? 'Još nemate košnica' : 'Nema košnica za ovaj filter'}
          description={
            data.hives.length === 0
              ? 'Dodajte ih odjednom — unesite raspon oznaka i aplikacija stvara sve košnice s QR kodovima.'
              : undefined
          }
          action={data.hives.length === 0 ? { to: '/kosnice/nove', label: 'Dodaj košnice' } : undefined}
        />
      )}

      <ul className="space-y-2">
        {hives.map((hive) => (
          <li key={hive.id}>
            <Link to={`/kosnice/${hive.id}`} className="block">
              <Card className={cn('transition-colors hover:border-primary', isProblem(hive) && 'border-caution/60')}>
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">{hive.code}</span>
                      {hive.colony === null && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          prazna
                        </span>
                      )}
                      {hive.lastInspection?.queenState === 'not_found' && (
                        <span className="rounded bg-critical/15 px-1.5 py-0.5 text-[11px] font-medium text-critical">
                          bez matice
                        </span>
                      )}
                      {(hive.lastInspection?.swarming === 'cells' ||
                        hive.lastInspection?.swarming === 'high_risk') && (
                        <span className="rounded bg-caution/20 px-1.5 py-0.5 text-[11px] font-medium text-caution">
                          matičnjaci
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {hive.lastInspection
                        ? `${STRENGTH_LABEL[hive.lastInspection.strength ?? ''] ?? 'Pregledana'} · prije ${hive.daysSinceInspection} ${
                            hive.daysSinceInspection === 1 ? 'dan' : 'dana'
                          }`
                        : 'Bez pregleda'}
                      {hive.colony?.queenCode ? ` · matica ${hive.colony.queenCode}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'min-h-11 shrink-0 whitespace-nowrap rounded-lg border px-3 text-sm font-medium',
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}
