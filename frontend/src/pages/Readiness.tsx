import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { CheckRow } from '@/components/ui/status'
import type { ReadinessReport } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/** §27 — „Provjeri spremnost za inspekciju". */
export function ReadinessPage() {
  const { data, error, loading } = useResource<ReadinessReport>('/inspection-mode/readiness')

  if (loading) return <LoadingState label="Analiziram podatke…" />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const failing = data.checks.filter((c) => !c.ok)
  const tone = data.percent >= 90 ? 'text-ok' : data.percent >= 70 ? 'text-caution' : 'text-critical'
  const bar = data.percent >= 90 ? 'bg-ok' : data.percent >= 70 ? 'bg-caution' : 'bg-critical'

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/inspekcija" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Spremnost</h1>
      </div>

      <Card className="bg-honeycomb">
        <CardContent className="py-5 text-center">
          <p className={cn('tabular text-5xl font-bold leading-none', tone)}>{data.percent} %</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.passed} od {data.total} provjerenih stavki
          </p>
          <div
            className="mx-auto mt-3 h-2 max-w-xs overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={data.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Spremnost za inspekciju"
          >
            <div className={cn('h-full rounded-full', bar)} style={{ width: `${data.percent}%` }} />
          </div>
        </CardContent>
      </Card>

      {failing.length > 0 && (
        <Card className="border-caution/50">
          <CardHeader>
            <CardTitle className="text-base">Treba srediti ({failing.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {failing.map((check) =>
                check.link ? (
                  <Link key={check.label} to={check.link} className="block rounded-lg hover:bg-accent">
                    <CheckRow label={check.label} ok={false} detail={check.detail} />
                  </Link>
                ) : (
                  <CheckRow key={check.label} label={check.label} ok={false} detail={check.detail} />
                ),
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sve provjere</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {data.checks.map((check) => (
              <CheckRow key={check.label} label={check.label} ok={check.ok} detail={check.detail} />
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Kept out of the percentage on purpose — a readiness score inflated by features that do
          not exist yet would be worse than no score at all. */}
      {data.pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Još se ne prati</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {data.pending.map((check) => (
                <CheckRow key={check.label} label={check.label} ok={false} detail={check.detail} pending />
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Ove stavke ne ulaze u postotak jer ih aplikacija zasad ne evidentira.
            </p>
          </CardContent>
        </Card>
      )}

      <Disclaimer text="Provjera pokriva podatke koje aplikacija vodi i ne zamjenjuje stvarni nadzor. Popis obveza i dokumenata potvrdite kod nadležnog tijela." />
    </div>
  )
}
