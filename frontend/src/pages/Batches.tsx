import { ArrowLeft, Boxes } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { formatDate, formatNumber } from '@/lib/format'
import { BATCH_STATUS } from '@/lib/labels'
import type { BatchStatus, HoneyBatch } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/** §29 — the LOT list. */
export function BatchesPage() {
  const [status, setStatus] = useState<BatchStatus | ''>('')
  const { data, error, loading } = useResource<{ batches: HoneyBatch[] }>(
    `/batches${status ? `?status=${status}` : ''}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const batches = data?.batches ?? []
  const availableKg = batches.reduce((sum, b) => sum + b.availableKg, 0)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Serije meda</h1>
      </div>

      <Select
        value={status}
        onChange={(e) => setStatus(e.target.value as BatchStatus | '')}
        aria-label="Status serije"
      >
        <option value="">Svi statusi</option>
        {(Object.keys(BATCH_STATUS) as BatchStatus[]).map((key) => (
          <option key={key} value={key}>
            {BATCH_STATUS[key].label}
          </option>
        ))}
      </Select>

      {batches.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Još nema serija meda"
          description="Serija nastaje automatski čim evidentirate vrcanje."
          action={{ to: '/vrcanja/novo', label: 'Unesi vrcanje' }}
        />
      ) : (
        <>
          <Card>
            <CardContent className="flex items-baseline justify-between py-3">
              <span className="text-sm text-muted-foreground">Na skladištu</span>
              <span className="tabular text-xl font-semibold">{formatNumber(availableKg)} kg</span>
            </CardContent>
          </Card>

          <div className="space-y-3">
            {batches.map((b) => (
              <Link key={b.id} to={`/serije/${b.id}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="tabular truncate font-semibold">{b.lotCode}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.honeyType} · {formatDate(b.harvestedOn)} · {b.apiaryName}
                        </p>
                      </div>
                      <StatusPill level={BATCH_STATUS[b.status].level} className="shrink-0">
                        {BATCH_STATUS[b.status].label}
                      </StatusPill>
                    </div>

                    {/* The three numbers §29's card leads with. */}
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <Figure label="Izvrcano" value={b.totalKg} />
                      <Figure label="Pakirano" value={b.packedKg} />
                      <Figure label="Skladište" value={b.availableKg} strong />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {b.labTests > 0 ? <span className="text-ok">✓ laboratorij</span> : <span>bez nalaza</span>}
                      {b.jarsPacked > 0 && <span>{b.jarsPacked} staklenki</span>}
                      {b.moisturePercent !== null && <span>vlaga {formatNumber(b.moisturePercent, 1)} %</span>}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Figure({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-secondary/60 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? 'tabular font-semibold' : 'tabular text-sm'}>{formatNumber(value)} kg</p>
    </div>
  )
}
