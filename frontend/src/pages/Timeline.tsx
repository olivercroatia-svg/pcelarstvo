import {
  ArrowLeft,
  Boxes,
  Bug,
  Droplet,
  Droplets,
  FlaskConical,
  HeartPulse,
  Layers,
  ShoppingCart,
  Syringe,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate } from '@/lib/format'
import type { Timeline } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const ICONS: Record<string, LucideIcon> = {
  harvest: Droplets,
  inspection: Boxes,
  treatment: Syringe,
  varroa: Bug,
  feeding: Droplet,
  health: HeartPulse,
  packaging: Layers,
  lab: FlaskConical,
  relocation: Truck,
  sale: ShoppingCart,
}

const RANGES = [
  { days: 30, label: '30 dana' },
  { days: 90, label: '3 mjeseca' },
  { days: 180, label: '6 mjeseci' },
  { days: 365, label: 'Godina' },
] as const

/**
 * §48 — "Svaka aktivnost ulazi u centralni timeline."
 *
 * Assembled by the server from the modules on every read; there is no timeline table. A stored
 * copy of every event is a copy that goes stale the moment a treatment is corrected.
 */
export function TimelinePage() {
  const [days, setDays] = useState(90)
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data, error, loading } = useResource<Timeline>(`/timeline?from=${from}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const timelineDays = data?.days ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Dnevnik</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={days === r.days}
            onClick={() => setDays(r.days)}
            className={`min-h-11 rounded-full border px-3 text-sm font-medium ${
              days === r.days
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card hover:bg-accent'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {timelineDays.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Nema zapisa u odabranom razdoblju"
          description="Dnevnik se puni sam iz pregleda, tretmana, vrcanja, pakiranja i prodaje."
        />
      ) : (
        <div className="space-y-4">
          {timelineDays.map((day) => (
            <div key={day.date}>
              <p className="tabular sticky top-16 z-10 bg-background/95 py-1 text-sm font-semibold backdrop-blur">
                {formatDate(day.date)}
              </p>
              <Card>
                <CardContent className="space-y-0 py-1">
                  {day.entries.map((entry, index) => {
                    const Icon = ICONS[entry.type] ?? Boxes
                    const body = (
                      <>
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{entry.title}</span>
                          {entry.detail && (
                            <span className="block truncate text-xs text-muted-foreground">{entry.detail}</span>
                          )}
                        </span>
                      </>
                    )
                    return entry.link ? (
                      <Link
                        key={`${entry.type}-${index}`}
                        to={entry.link}
                        className="flex min-h-14 items-center gap-3 rounded-lg px-1 hover:bg-accent"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div key={`${entry.type}-${index}`} className="flex min-h-14 items-center gap-3 px-1">
                        {body}
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
