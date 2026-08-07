import { ArrowLeft, HandCoins } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { formatDate } from '@/lib/format'
import type { SubsidyProgram } from '@/lib/types'
import { useResource } from '@/lib/useResource'

export const SUBSIDY_STATUS_LABELS: Record<string, string> = {
  considering: 'Razmatram',
  preparing: 'Priprema',
  submitted: 'Predano',
  approved: 'Odobreno',
  rejected: 'Odbijeno',
  withdrawn: 'Povučeno',
}

interface Response {
  programs: SubsidyProgram[]
  eligibleCount: number
  activeCount: number
}

/**
 * §50 — potpore.
 *
 * "Potencijalno prihvatljivo" is the strongest word this screen is allowed to use. §50 says the
 * application must not automatically guarantee entitlement, so the eligibility badge reflects a
 * coarse filter on the farm's own data and the disclaimer says as much in plain Croatian.
 */
export function SubsidiesPage() {
  const { data, error, loading } = useResource<Response>('/subsidies')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const programs = data?.programs ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Potpore</h1>
      </div>

      {programs.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="Nema unesenih natječaja"
          description="Natječaje i intervencije unosi administrator sustava. Kad se pojave, ovdje ćete vidjeti što vam potencijalno odgovara i koja dokumentacija nedostaje."
        />
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-2 gap-2 py-3 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Potencijalno prihvatljivo</p>
                <p className="tabular text-xl font-semibold">{data?.eligibleCount ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pratite</p>
                <p className="tabular text-xl font-semibold">{data?.activeCount ?? 0}</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {programs.map((p) => (
              <Link key={p.id} to={`/potpore/${p.id}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="min-w-0 text-base">{p.name}</CardTitle>
                      {p.closed ? (
                        <StatusPill level="info">Zatvoren</StatusPill>
                      ) : p.application ? (
                        <StatusPill level={p.application.status === 'approved' ? 'ok' : 'info'}>
                          {SUBSIDY_STATUS_LABELS[p.application.status]}
                        </StatusPill>
                      ) : p.eligible ? (
                        <StatusPill level="ok">Prihvatljivo</StatusPill>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <p className="text-xs text-muted-foreground">
                      {[p.authority, p.closesOn ? `rok ${formatDate(p.closesOn)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    {p.application && p.documentPercent !== null && (
                      <div>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="text-muted-foreground">Dokumentacija</span>
                          <span className="tabular font-medium">{p.documentPercent} %</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={p.documentPercent === 100 ? 'h-full rounded-full bg-ok' : 'h-full rounded-full bg-primary'}
                            style={{ width: `${p.documentPercent}%` }}
                          />
                        </div>
                        {p.missing.length > 0 && (
                          <p className="mt-1 text-xs text-caution">Nedostaje: {p.missing.join(', ')}</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <p className="rounded-lg bg-info/10 p-3 text-xs text-info">
        Prikaz je informativan. Aplikacija ne jamči pravo na potporu — uvjete i prihvatljivost
        utvrđuje nadležno tijelo prema tekstu natječaja.
      </p>
      <Disclaimer />
    </div>
  )
}
