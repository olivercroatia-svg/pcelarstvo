import { ChevronRight, MapPin, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useResource } from '@/lib/useResource'
import type { Apiary } from '@/lib/types'
import { cn } from '@/lib/utils'

const KIND_LABEL: Record<string, string> = { stationary: 'Stacionarni', migratory: 'Seleći' }

const STATUS: Record<string, { label: string; dot: string }> = {
  active: { label: 'Aktivno', dot: 'bg-ok' },
  planned_move: { label: 'Planirano preseljenje', dot: 'bg-caution' },
  inactive: { label: 'Neaktivno', dot: 'bg-muted-foreground' },
}

export function ApiariesPage() {
  const { data, error, loading, reload } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Pčelinjaci</h1>
        <Link
          to="/pcelinjaci/novi"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          Novi
        </Link>
      </div>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && data.apiaries.length === 0 && (
        <EmptyState
          icon={MapPin}
          title="Još nemate pčelinjaka"
          description="Dodajte prvi pčelinjak — lokaciju možete označiti GPS-om ili na karti."
          action={{ to: '/pcelinjaci/novi', label: 'Dodaj pčelinjak' }}
        />
      )}

      {data?.apiaries.map((apiary) => {
        const status = STATUS[apiary.status] ?? STATUS.active
        return (
          <Link key={apiary.id} to={`/pcelinjaci/${apiary.id}`} className="block">
            <Card className="transition-colors hover:border-primary">
              <CardContent className="flex items-center gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold">{apiary.name}</h2>
                    <span className={cn('size-2 shrink-0 rounded-full', status.dot)} aria-hidden />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {KIND_LABEL[apiary.kind]}
                    {apiary.locationName ? ` · ${apiary.locationName}` : apiary.city ? ` · ${apiary.city}` : ''}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="tabular font-semibold">{apiary.colonyCount ?? 0}</span>{' '}
                    <span className="text-muted-foreground">
                      {apiary.colonyCount === 1 ? 'zajednica' : 'zajednica'} ·{' '}
                    </span>
                    <span className="tabular font-semibold">{apiary.hiveCount ?? 0}</span>{' '}
                    <span className="text-muted-foreground">košnica</span>
                    {apiary.hiveType ? <span className="text-muted-foreground"> · {apiary.hiveType}</span> : null}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
