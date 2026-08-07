import { ArrowLeft, FlaskConical, GitBranch, Package, Printer } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { WithdrawalWarning } from '@/components/WithdrawalWarning'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import { BATCH_STATUS } from '@/pages/Batches'
import type { BatchStatus, HoneyBatch, WithdrawalConflict } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface BatchCard {
  batch: HoneyBatch
  labTests: { id: string; laboratory: string | null; reportNumber: string | null; testedOn: string | null }[]
  packaging: {
    id: string
    packagedOn: string
    productName: string | null
    jarSizeG: number
    jarCount: number
    totalKg: number
    isNational: boolean
    published: boolean
  }[]
  withdrawalConflicts: WithdrawalConflict[]
}

/** §29 — "Svaka serija ima vlastiti digitalni karton." */
export function BatchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<BatchCard>(`/batches/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { batch, labTests, packaging } = data

  async function changeStatus(status: BatchStatus) {
    try {
      await api(`/batches/${id}`, { method: 'PATCH', body: { status } })
      showSuccess('Status je promijenjen')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/serije" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="tabular min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{batch.lotCode}</h1>
        <StatusPill level={BATCH_STATUS[batch.status].level}>{BATCH_STATUS[batch.status].label}</StatusPill>
      </div>

      <WithdrawalWarning conflicts={data.withdrawalConflicts} />

      <Card>
        <CardContent className="py-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Figure label="Izvrcano" value={batch.totalKg} />
            <Figure label="Pakirano" value={batch.packedKg} />
            <Figure label="Na skladištu" value={batch.availableKg} strong />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Link
          to={`/serije/${batch.id}/pakiranje`}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-3 font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Package className="size-5" />
          Pakiraj
        </Link>
        <Link
          to={`/serije/${batch.id}/nalaz`}
          className="flex min-h-14 items-center justify-center gap-2 rounded-lg border border-border px-3 font-medium hover:bg-accent"
        >
          <FlaskConical className="size-5" />
          Unesi nalaz
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Karton serije</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Vrsta" value={batch.honeyType} />
            <Row label="Datum vrcanja" value={formatDate(batch.harvestedOn)} />
            <Row label="Paša" value={batch.pasture} />
            <Row label="Pčelinjak" value={batch.apiaryName} />
            <Row label="Količina" value={`${formatNumber(batch.totalKg)} kg`} />
            <Row
              label="Vlaga"
              value={batch.moisturePercent === null ? '—' : `${formatNumber(batch.moisturePercent, 1)} %`}
            />
            <Row label="Laboratorij" value={labTests.length > 0 ? '✓ analiza' : 'nije unesena'} />
            <Row label="Pakirano" value={`${formatNumber(batch.packedKg)} kg`} />
            <Row label="Na skladištu" value={`${formatNumber(batch.availableKg)} kg`} />
            {batch.bestBefore && <Row label="Najbolje upotrijebiti do" value={formatDate(batch.bestBefore)} />}
          </dl>

          <div className="mt-4">
            <label htmlFor="batch-status" className="mb-1.5 block text-sm font-medium">
              Status serije
            </label>
            <Select
              id="batch-status"
              value={batch.status}
              onChange={(e) => changeStatus(e.target.value as BatchStatus)}
            >
              {(Object.keys(BATCH_STATUS) as BatchStatus[]).map((key) => (
                <option key={key} value={key}>
                  {BATCH_STATUS[key].label}
                </option>
              ))}
            </Select>
            {/* Nothing in the application flips this on its own — "spremno" is a judgement about
                honey, not about whether the data is complete. */}
            <p className="mt-1.5 text-xs text-muted-foreground">
              Status postavlja pčelar. Aplikacija ga ne mijenja sama.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Laboratorijski nalazi ({labTests.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {labTests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Za ovu seriju još nije unesen nalaz.</p>
          ) : (
            <ul className="space-y-2">
              {labTests.map((t) => (
                <li key={t.id}>
                  <Link to={`/nalazi/${t.id}`} className="block rounded-lg p-2 text-sm hover:bg-accent">
                    <span className="font-medium">{t.laboratory ?? 'Laboratorij'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.reportNumber ? `${t.reportNumber} · ` : ''}
                      {formatDate(t.testedOn)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pakiranja ({packaging.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {packaging.length === 0 ? (
            <p className="text-sm text-muted-foreground">Iz ove serije još nije pakirano.</p>
          ) : (
            <ul className="space-y-2">
              {packaging.map((p) => (
                <li key={p.id}>
                  <Link to={`/pakiranja/${p.id}`} className="block rounded-lg p-2 text-sm hover:bg-accent">
                    <span className="flex items-center justify-between gap-2">
                      <span className="tabular font-medium">
                        {p.jarCount} × {p.jarSizeG} g
                      </span>
                      <span className="tabular text-muted-foreground">{formatNumber(p.totalKg)} kg</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(p.packagedOn)}
                      {p.productName ? ` · ${p.productName}` : ''}
                      {p.isNational ? ' · nacionalna staklenka' : ''}
                      {p.published ? ' · javni QR' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Link
          to={`/sljedivost/${batch.lotCode}`}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <GitBranch className="size-4" />
          Sljedivost
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          <Printer className="size-4" />
          Ispiši karton
        </button>
      </div>

      <Disclaimer className="print:hidden" />
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/60 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? 'tabular text-lg font-semibold' : 'tabular'}>{formatNumber(value)} kg</p>
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
