import { ArrowLeft, CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { MONTHS } from '@/lib/format'
import type { SeasonCalendar } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const REGIONS = [
  { value: 'all', label: 'Sve regije' },
  { value: 'continental', label: 'Kontinentalna' },
  { value: 'coastal', label: 'Priobalje' },
  { value: 'mountain', label: 'Gorska' },
] as const

/**
 * §19 — "inteligentni godišnji kalendar".
 *
 * The tasks are rows in season_tasks, editable by an administrator, exactly like the §54 legal
 * deadlines. The migratory ones are filtered out automatically for a farm with no seleći apiary:
 * that is knowable from the data and nobody should have to switch it off by hand.
 *
 * Altitude is one of §19's four axes and is deliberately absent — the application has no idea how
 * high an apiary sits, and a filter that silently matches nothing is worse than one not offered.
 */
export function SeasonPage() {
  const currentMonth = new Date().getMonth() + 1
  const [region, setRegion] = useState<string>('all')
  const [open, setOpen] = useState<number>(currentMonth)
  const { data, error, loading } = useResource<SeasonCalendar>(`/season?region=${region}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Sezonski kalendar</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {REGIONS.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={region === r.value}
            onClick={() => setRegion(r.value)}
            className={cn(
              'min-h-11 rounded-full border px-3 text-sm font-medium',
              region === r.value
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-accent',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {data.migratory && (
        <p className="text-xs text-muted-foreground">
          Prikazani su i poslovi za seleće pčelarenje jer imate pčelinjak označen kao seleći.
        </p>
      )}

      <div className="space-y-2">
        {data.months.map(({ month, tasks }) => {
          const isCurrent = month === currentMonth
          const isOpen = open === month
          return (
            <Card key={month} className={cn(isCurrent && 'border-primary')}>
              <CardHeader className="p-0">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? 0 : month)}
                  aria-expanded={isOpen}
                  className="flex min-h-14 w-full items-center justify-between gap-2 px-4 text-left"
                >
                  <CardTitle className="flex items-center gap-2 text-base">
                    {isCurrent && <CalendarDays className="size-4 text-primary" />}
                    {MONTHS[month - 1]}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {tasks.length > 0 ? `${tasks.length}` : '—'}
                  </span>
                </button>
              </CardHeader>
              {isOpen && tasks.length > 0 && (
                <CardContent className="pt-0">
                  <ul className="space-y-2">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex gap-2 text-sm">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                        <span className="min-w-0">
                          {t.title}
                          {t.detail && <span className="block text-xs text-muted-foreground">{t.detail}</span>}
                          {t.apiaryKind === 'migratory' && (
                            <span className="ml-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                              seleći
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
              {isOpen && tasks.length === 0 && (
                <CardContent className="pt-0 text-sm text-muted-foreground">
                  Za ovaj mjesec nema unesenih poslova.
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      <Disclaimer />
    </div>
  )
}
