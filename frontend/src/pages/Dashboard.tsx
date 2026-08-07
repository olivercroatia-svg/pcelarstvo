import { ArrowRight, ChevronRight, ClipboardCheck, CloudOff, Grid2x2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusPill } from '@/components/ui/status'
import { useAuth } from '@/auth/AuthContext'
import { formatNumber, plural } from '@/lib/format'
import { useOutbox } from '@/lib/outbox'
import type { Apiary, Hive, HoneyBatch, ObligationCard } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface RecentInspection {
  id: string
  inspectedAt: string
  hiveCode: string
  apiaryName: string | null
  isBatch: boolean
}

function greeting(hour: number): string {
  if (hour < 11) return 'Dobro jutro'
  if (hour < 18) return 'Dobar dan'
  return 'Dobra večer'
}

function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'danas'
  if (days === 1) return 'jučer'
  return `prije ${days} dana`
}

function Stat({ value, label, to }: { value: number; label: string; to?: string }) {
  const body = (
    <CardContent className="py-4">
      <p className="tabular text-3xl font-bold leading-none">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </CardContent>
  )
  return to ? (
    <Link to={to}>
      <Card className="h-full transition-colors hover:border-primary">{body}</Card>
    </Link>
  ) : (
    <Card className="h-full">{body}</Card>
  )
}

export function DashboardPage() {
  const { current } = useAuth()
  const { pending } = useOutbox()

  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const { data: staleData } = useResource<{ hives: Hive[] }>('/hives?staleDays=14')
  const { data: recentData } = useResource<{ inspections: RecentInspection[] }>('/inspections?limit=8')
  const { data: obligationData } = useResource<{ obligations: ObligationCard[] }>('/obligations')
  const { data: batchData } = useResource<{ batches: HoneyBatch[] }>(
    `/batches?year=${new Date().getFullYear()}`,
  )

  if (!current) return null
  const { user, completeness } = current

  const apiaries = apiaryData?.apiaries ?? []
  const colonies = apiaries.reduce((sum, a) => sum + (a.colonyCount ?? 0), 0)
  const needsLook = staleData?.hives.length ?? 0
  const batches = batchData?.batches ?? []
  const seasonKg = batches.reduce((sum, b) => sum + b.totalKg, 0)
  const availableKg = batches.reduce((sum, b) => sum + b.availableKg, 0)
  // Only what actually needs attention reaches the dashboard; the full list lives under /obveze.
  const urgentObligations = (obligationData?.obligations ?? [])
    .filter((o) => o.level === 'critical' || o.level === 'warning')
    .slice(0, 3)

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting(new Date().getHours())}, {user.firstName}
        </h1>
        <p className="text-sm text-muted-foreground">Vaš pčelinjak danas</p>
      </div>

      {pending.length > 0 && (
        <Link to="/unos">
          <Card className="border-caution/50">
            <CardContent className="flex items-center gap-2 py-3 text-sm">
              <CloudOff className="size-4 shrink-0 text-caution" aria-hidden />
              <span className="flex-1">
                {pending.length} {pending.length === 1 ? 'zapis čeka' : 'zapisa čeka'} slanje
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      )}

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

      {apiaries.length === 0 ? (
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
              to="/pcelinjaci/novi"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Dodaj pčelinjak
              <ArrowRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat value={colonies} label="aktivnih zajednica" to="/kosnice" />
            <Stat value={apiaries.length} label="pčelinjaka" to="/pcelinjaci" />
            <Stat value={needsLook} label="za pregled" to="/kosnice" />
          </div>

          {/* §23 — the obligations that cannot wait, surfaced where the beekeeper starts. */}
          {urgentObligations.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Obveze koje traže pažnju</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {urgentObligations.map((item) => (
                  <Link
                    key={item.id}
                    to={`/obveze/${item.id}`}
                    className="flex items-center gap-2 rounded-lg border border-border p-2.5 hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <StatusPill level={item.level} className="mt-1">
                        {item.statusLabel}
                      </StatusPill>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* §68 — "Koliko sam meda proizveo? Koja serija je u kojoj staklenci?" Only shown once
              there is honey to report; an empty card teaching the beekeeper about a module they
              have not used yet is just noise on the screen they open most often. */}
          {seasonKg > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Med u {new Date().getFullYear()}.</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <Link to="/vrcanja" className="rounded-lg bg-secondary/60 p-3">
                    <p className="tabular text-xl font-semibold">{formatNumber(seasonKg)} kg</p>
                    <p className="text-xs text-muted-foreground">izvrcano</p>
                  </Link>
                  <Link to="/skladiste" className="rounded-lg bg-secondary/60 p-3">
                    <p className="tabular text-xl font-semibold">{formatNumber(availableKg)} kg</p>
                    <p className="text-xs text-muted-foreground">na skladištu</p>
                  </Link>
                </div>
                <Link
                  to="/serije"
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    {batches.length} {plural(batches.length, 'serija', 'serije', 'serija')} meda
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          )}

          {/* §26 — "Na dashboardu postoji: INSPEKCIJA". One tap from the home screen, because the
              moment it is needed is the moment someone is standing in the yard asking. */}
          <Link
            to="/inspekcija"
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-input px-4 text-sm font-semibold uppercase tracking-wide hover:bg-accent"
          >
            <ClipboardCheck className="size-5" />
            Inspekcija
          </Link>

          {recentData && recentData.inspections.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dnevnik</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recentData.inspections.map((entry) => (
                    <li key={entry.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{entry.hiveCode}</span>
                        {entry.apiaryName ? (
                          <span className="text-muted-foreground"> · {entry.apiaryName}</span>
                        ) : null}
                        {entry.isBatch ? <span className="text-muted-foreground"> · skupno</span> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeDay(entry.inspectedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
