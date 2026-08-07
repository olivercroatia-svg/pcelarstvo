import { ArrowRight, Grid2x2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/auth/AuthContext'

function greeting(hour: number): string {
  if (hour < 11) return 'Dobro jutro'
  if (hour < 18) return 'Dobar dan'
  return 'Dobra večer'
}

export function DashboardPage() {
  const { current } = useAuth()
  if (!current) return null

  const { user, completeness } = current

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting(new Date().getHours())}, {user.firstName}
        </h1>
        <p className="text-sm text-muted-foreground">Vaš pčelinjak danas</p>
      </div>

      {/* §5 — the profile nudge. Hidden once there is nothing left to ask for. */}
      {completeness.percent < 100 && (
        <Card className="bg-honeycomb">
          <CardContent className="pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Profil {completeness.percent} % dovršen</p>
              <Link
                to="/profil"
                className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Dopuni
              </Link>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={completeness.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Dovršenost profila"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${completeness.percent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Nedostaje: {completeness.missing.map((m) => m.label).join(', ')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Etapa 1 replaces this with the real counters, alerts and journal from §6. Until apiaries
          exist there is nothing honest to count, so the empty state points at the first step. */}
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Grid2x2 className="size-6" />
          </span>
          <div>
            <p className="font-medium">Još nemate pčelinjaka</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Dodajte prvi pčelinjak i počnite voditi evidenciju košnica.
            </p>
          </div>
          <Link
            to="/pcelinjaci"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Dodaj pčelinjak
            <ArrowRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
