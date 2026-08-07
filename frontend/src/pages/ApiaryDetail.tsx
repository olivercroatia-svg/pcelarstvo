import { ArrowLeft, Boxes, Check, Pencil, Play, Ruler, TriangleAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LocationPicker } from '@/components/lazy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import type { Apiary, NearbyApiary, VisitSummary } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const KIND_LABEL: Record<string, string> = { stationary: 'Stacionarni', migratory: 'Seleći' }

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2).replace('.', ',')} km` : `${metres} m`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return `${Number(d)}. ${Number(m)}. ${y}.`
}

/** §8 — the documentation block, showing what is on file and what is missing or expiring. */
function DocumentationRow({ label, value, warning }: { label: string; value: string | null; warning?: string }) {
  const present = Boolean(value)
  return (
    <li className="flex items-start gap-2 text-sm">
      {present && !warning ? (
        <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className={present ? '' : 'text-muted-foreground'}>{label}</span>
        {value && <span className="block text-xs text-muted-foreground">{value}</span>}
        {warning && <span className="block text-xs font-medium text-caution">{warning}</span>}
      </span>
    </li>
  )
}

export function ApiaryDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { isOwner } = useAuth()

  const { data, error, loading } = useResource<{ apiary: Apiary; nearbyApiaries: NearbyApiary[] }>(
    `/apiaries/${id}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { apiary, nearbyApiaries } = data

  const permitExpiry = (() => {
    if (!apiary.permitExpiresOn) return undefined
    const days = Math.ceil((new Date(apiary.permitExpiresOn).getTime() - Date.now()) / 86_400_000)
    if (days < 0) return 'Suglasnost je istekla'
    if (days <= 60) return `Ističe za ${days} ${days === 1 ? 'dan' : 'dana'}`
    return undefined
  })()

  async function startVisit() {
    try {
      const result = await api<{ visit: VisitSummary }>('/visits', {
        method: 'POST',
        body: { apiaryId: apiary.id },
      })
      navigate(`/obilazak/${result.visit.id}`)
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Obilazak nije moguće započeti')
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Obrisati pčelinjak ${apiary.name}?`,
      description:
        'Povijest pregleda i košnice ostaju sačuvane radi evidencije, ali pčelinjak se više neće prikazivati u popisu.',
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api<void>(`/apiaries/${apiary.id}`, { method: 'DELETE' })
      showSuccess('Pčelinjak je obrisan')
      navigate('/pcelinjaci', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/pcelinjaci" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{apiary.name}</h1>
        {isOwner && (
          <Link
            to={`/pcelinjaci/${apiary.id}/uredi`}
            aria-label="Uredi"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="size-5" />
          </Link>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {KIND_LABEL[apiary.kind]}
        {apiary.locationName ? ` · ${apiary.locationName}` : ''}
        {apiary.city ? ` · ${apiary.city}` : ''}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="py-4">
            <p className="tabular text-2xl font-bold">{apiary.colonyCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">aktivnih zajednica</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="tabular text-2xl font-bold">{apiary.hiveCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">košnica</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={startVisit} size="lg" className="flex-1">
          <Play />
          Započni obilazak
        </Button>
        <Link
          to={`/kosnice?pcelinjak=${apiary.id}`}
          className="inline-flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm font-medium hover:bg-accent"
        >
          <Boxes className="size-4" />
          Košnice
        </Link>
      </div>

      {apiary.latitude !== null && apiary.longitude !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Lokacija</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <LocationPicker latitude={apiary.latitude} longitude={apiary.longitude} onChange={() => {}} readOnly />

            {nearbyApiaries.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Ruler className="size-3.5" aria-hidden />
                  Udaljenost do vaših pčelinjaka
                </p>
                <ul className="mt-1.5 space-y-1">
                  {nearbyApiaries.map((n) => (
                    <li key={n.id} className="flex justify-between text-sm">
                      <span className="truncate">{n.name}</span>
                      <span className="tabular shrink-0 text-muted-foreground">
                        {formatDistance(n.distanceMetres)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* §9 and §55 — the app must not imply it has checked anything official. */}
            <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              Udaljenosti su informativne i služe kao pomoć pri planiranju. Ne predstavljaju
              službenu provjeru propisanih udaljenosti — nju potvrđuje nadležno tijelo.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Dokumentacija pčelinjaka</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            <DocumentationRow label="Pčelarska udruga" value={apiary.association} />
            <DocumentationRow label="Pašni povjerenik" value={apiary.pastureCommissioner} />
            <DocumentationRow
              label="Suglasnost za smještaj"
              value={
                apiary.permitNumber
                  ? `br. ${apiary.permitNumber}${
                      apiary.permitExpiresOn ? ` · do ${formatDate(apiary.permitExpiresOn)}` : ''
                    }`
                  : null
              }
              warning={permitExpiry}
            />
            <DocumentationRow label="Datum postavljanja" value={formatDate(apiary.establishedOn)} />
          </ul>
        </CardContent>
      </Card>

      {apiary.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Napomena</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{apiary.notes}</p>
          </CardContent>
        </Card>
      )}

      {isOwner && (
        <Button variant="outline" className="w-full text-destructive" onClick={remove}>
          Obriši pčelinjak
        </Button>
      )}
    </div>
  )
}
