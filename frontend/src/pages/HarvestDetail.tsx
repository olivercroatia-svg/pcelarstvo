import { ArrowLeft, Boxes, GitBranch, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { WithdrawalWarning } from '@/components/WithdrawalWarning'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { HarvestDetail as HarvestDetailData } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/** §28 — one extraction, and the LOT that came out of it. */
export function HarvestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { current } = useAuth()
  const { data, error, loading } = useResource<HarvestDetailData>(`/harvests/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { harvest, batch, hives, containers, containerTotalKg, containerMismatchKg } = data

  async function remove() {
    const ok = await confirm({
      title: 'Brisanje vrcanja',
      description: 'Vrcanje i pripadajuća serija meda bit će uklonjeni. Ovu radnju nije moguće poništiti.',
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/harvests/${id}`, { method: 'DELETE' })
      showSuccess('Vrcanje je obrisano')
      navigate('/vrcanja', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/vrcanja" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{harvest.pasture}</h1>
      </div>

      <WithdrawalWarning conflicts={data.withdrawalConflicts} />

      {batch && (
        <Card className="border-primary/40">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">LOT serije</p>
            <p className="tabular text-2xl font-bold tracking-tight">{batch.lotCode}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                Izvrcano <strong className="tabular">{formatNumber(batch.totalKg)} kg</strong>
              </span>
              <span>
                Pakirano <strong className="tabular">{formatNumber(batch.packedKg)} kg</strong>
              </span>
              <span>
                Na skladištu <strong className="tabular">{formatNumber(batch.availableKg)} kg</strong>
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Link
                to={`/serije/${batch.id}`}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Boxes className="size-4" />
                Karton serije
              </Link>
              <Link
                to={`/sljedivost/${batch.lotCode}`}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
              >
                <GitBranch className="size-4" />
                Sljedivost
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Podaci o vrcanju</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Datum" value={formatDate(harvest.harvestedOn)} />
            <Row label="Pčelinjak" value={harvest.apiaryName} />
            <Row label="Paša" value={harvest.pasture} />
            {batch && <Row label="Vrsta meda" value={batch.honeyType} />}
            <Row label="Košnice" value={harvest.hiveRange ?? '—'} />
            {batch?.moisturePercent !== null && batch !== null && (
              <Row label="Vlaga" value={`${formatNumber(batch.moisturePercent, 1)} %`} />
            )}
            {harvest.framesCount !== null && <Row label="Okvira" value={String(harvest.framesCount)} />}
            {harvest.by && <Row label="Unio" value={harvest.by} />}
            {harvest.notes && <Row label="Napomena" value={harvest.notes} />}
          </dl>
        </CardContent>
      </Card>

      {containers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posude</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {containers.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="tabular font-medium">{formatNumber(c.amountKg)} kg</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-border pt-1.5 font-medium">
                <span>Ukupno</span>
                <span className="tabular">{formatNumber(containerTotalKg)} kg</span>
              </li>
            </ul>
            {Math.abs(containerMismatchKg) > 0.01 && (
              <p className="mt-2 text-xs text-caution">
                Zbroj posuda se razlikuje od količine na LOT-u za{' '}
                {formatNumber(Math.abs(containerMismatchKg))} kg.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {hives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Košnice ({hives.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 min-[420px]:grid-cols-5">
              {hives.map((h) => (
                <Link
                  key={h.id}
                  to={`/kosnice/${h.id}`}
                  className="flex min-h-11 items-center justify-center rounded-lg bg-secondary text-sm font-medium text-secondary-foreground hover:bg-accent"
                >
                  {h.code}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {current?.role === 'owner' && (
        <Button variant="outline" className="w-full text-destructive" onClick={remove}>
          <Trash2 />
          Obriši vrcanje
        </Button>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value ?? '—'}</dd>
    </div>
  )
}
