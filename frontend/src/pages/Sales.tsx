import { ArrowLeft, Plus, ShoppingCart } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatEur, formatNumber } from '@/lib/format'
import { CHANNEL_LABELS } from '@/lib/labels'
import type { Sale } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)

interface Response {
  sales: Sale[]
  summary: { total: number; honeyKg: number; unpaid: number }
}

/** §37 — the sales log. Owner-only; the API answers 403 for a worker before this screen loads. */
export function SalesPage() {
  const [year, setYear] = useState<number | ''>(new Date().getFullYear())
  const { data, error, loading } = useResource<Response>(`/sales${year ? `?year=${year}` : ''}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const sales = data?.sales ?? []
  const summary = data?.summary

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Prodaja</h1>
      </div>

      <Link
        to="/prodaja/nova"
        className="flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="size-5" />
        Nova prodaja
      </Link>

      <Select value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} aria-label="Godina">
        <option value="">Sve godine</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {sales.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Još nema evidentirane prodaje"
          description="Prodaja staklenki automatski smanjuje skladište i povezuje kupca s LOT brojem."
          action={{ to: '/prodaja/nova', label: 'Unesi prodaju' }}
        />
      ) : (
        <>
          {summary && (
            <Card>
              <CardContent className="grid grid-cols-3 gap-2 py-3 text-center">
                <Stat label="Prihod" value={formatEur(summary.total)} />
                <Stat label="Prodano meda" value={`${formatNumber(summary.honeyKg)} kg`} />
                <Stat label="Nenaplaćeno" value={formatEur(summary.unpaid)} tone={summary.unpaid > 0 ? 'caution' : undefined} />
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {sales.map((s) => (
              <Link key={s.id} to={`/prodaja/${s.id}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.customerName ?? 'Bez kupca'}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(s.soldOn)} · {CHANNEL_LABELS[s.channel]}
                          {s.documentNumber ? ` · ${s.documentNumber}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular font-semibold">{formatEur(s.total)}</p>
                        {s.honeyKg > 0 && (
                          <p className="tabular text-xs text-muted-foreground">{formatNumber(s.honeyKg)} kg</p>
                        )}
                      </div>
                    </div>
                    {!s.paid && (
                      <p className="mt-1.5 inline-block rounded-md bg-caution/15 px-1.5 py-0.5 text-xs font-medium text-caution">
                        Nije naplaćeno
                      </p>
                    )}
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'caution' }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular font-semibold ${tone === 'caution' ? 'text-caution' : ''}`}>{value}</p>
    </div>
  )
}
