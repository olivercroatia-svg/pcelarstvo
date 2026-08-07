import { ArrowLeft, CheckCircle2, Flag, QrCode, TriangleAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { useOutbox } from '@/lib/outbox'
import type { Hive, VisitSummary } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

function CodeList({ label, codes, tone }: { label: string; codes: string[]; tone: string }) {
  if (codes.length === 0) return null
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-medium tabular', tone)}>{codes.join(', ')}</p>
    </div>
  )
}

/**
 * §61 "Dan na pčelinjaku" — the round in progress and its closing summary.
 *
 * The hive grid is the point: inspected boxes go green as you work, so at any moment you can see
 * what is left without counting. That is what makes a 54-hive apiary finishable.
 */
export function VisitPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showError } = useToast()
  const { pending } = useOutbox()

  const { data, error, loading, reload } = useResource<{ visit: VisitSummary }>(`/visits/${id}`)
  const visit = data?.visit
  const { data: hiveData } = useResource<{ hives: Hive[] }>(
    visit ? `/hives?apiaryId=${visit.apiaryId}` : null,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!visit) return null

  const remaining = new Set(visit.remaining)
  const done = visit.inspectedCount
  const percent = visit.totalHives > 0 ? Math.round((done / visit.totalHives) * 100) : 0

  // Arrow const, not a function declaration: declarations are hoisted above the `if (!visit)`
  // guard, so TypeScript would still see `visit` as possibly undefined inside them.
  const finish = async () => {
    const ok = await confirm({
      title: 'Završiti obilazak?',
      description:
        remaining.size > 0
          ? `Još ${remaining.size} ${remaining.size === 1 ? 'košnica nije pregledana' : 'košnica nije pregledano'}. Obilazak možete završiti i nastaviti kasnije novim obilaskom.`
          : 'Sve košnice su pregledane.',
      confirmLabel: 'Završi obilazak',
    })
    if (!ok) return
    try {
      await api(`/visits/${visit.id}/end`, { method: 'POST', body: {} })
      navigate(`/pcelinjaci/${visit.apiaryId}`, { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Obilazak nije moguće završiti')
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to={`/pcelinjaci/${visit.apiaryId}`}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{visit.apiaryName}</h1>
          <p className="text-xs text-muted-foreground">
            Obilazak započet u{' '}
            {new Date(visit.startedAt).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <Link
          to="/skeniraj"
          aria-label="Skeniraj"
          className="rounded-lg border border-input p-2.5 hover:bg-accent"
        >
          <QrCode className="size-5" />
        </Link>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-muted-foreground">Pregledano</p>
            <p className="tabular text-2xl font-bold">
              {done}
              <span className="text-base font-normal text-muted-foreground">/{visit.totalHives}</span>
            </p>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Napredak obilaska"
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          {pending.length > 0 && (
            <p className="mt-2 text-xs text-caution">
              {pending.length} {pending.length === 1 ? 'zapis čeka' : 'zapisa čeka'} slanje — brojka se
              osvježava nakon sinkronizacije.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Košnice</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-2 min-[420px]:grid-cols-5">
            {hiveData?.hives.map((hive) => {
              const inspected = !remaining.has(hive.code)
              return (
                <Link
                  key={hive.id}
                  to={`/unos/${hive.id}?obilazak=${visit.id}`}
                  className={cn(
                    'flex min-h-12 items-center justify-center rounded-lg border text-sm font-medium tabular',
                    inspected
                      ? 'border-ok bg-ok/15 text-ok'
                      : 'border-border bg-card hover:bg-accent',
                  )}
                >
                  {hive.code}
                </Link>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Dodirnite košnicu za pregled, ili skenirajte QR kod na njoj.
          </p>
        </CardContent>
      </Card>

      {(visit.queenless.length > 0 || visit.swarmRisk.length > 0 || visit.weak.length > 0) && (
        <Card className="border-caution/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-caution" aria-hidden />
              Za pratiti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeList label="Bez matice" codes={visit.queenless} tone="text-critical" />
            <CodeList label="Matičnjaci / rizik od rojenja" codes={visit.swarmRisk} tone="text-caution" />
            <CodeList label="Slabe zajednice" codes={visit.weak} tone="text-warning" />
          </CardContent>
        </Card>
      )}

      {visit.endedAt ? (
        <Card className="border-ok/50">
          <CardContent className="flex items-center gap-2 py-4 text-sm">
            <CheckCircle2 className="size-5 text-ok" aria-hidden />
            Obilazak je završen.
          </CardContent>
        </Card>
      ) : (
        <Button size="lg" className="w-full" onClick={finish}>
          <Flag />
          Završi obilazak
        </Button>
      )}
    </div>
  )
}
