import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { formatEur, formatNumber, MONTHS } from '@/lib/format'
import type { Economics } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/**
 * §40 — "Ekonomika pčelinjaka".
 *
 * Every figure here is derived: revenue follows the traceability chain from a jar back to the
 * apiary that produced the honey, costs are the expenses tagged with that apiary, and production
 * is the sum of its LOTs. Nothing on this screen is typed in anywhere.
 *
 * The bars are plain divs rather than a chart library. Twelve monthly totals on a 390 px screen
 * read better as a list than as a line, and the application already declined Recharts once for
 * the varroa graph.
 */
export function EconomicsPage() {
  const [year, setYear] = useState<number | null>(null)
  const { data, error, loading } = useResource<Economics>(`/economics${year ? `?year=${year}` : ''}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { totals, apiaries, expenseBreakdown, monthlyRevenue } = data
  const maxMonth = Math.max(...monthlyRevenue.map((m) => m.total), 1)
  const maxExpense = Math.max(...expenseBreakdown.map((e) => e.total), 1)
  const empty = totals.revenue === 0 && totals.expenses === 0 && totals.producedKg === 0

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Ekonomika</h1>
      </div>

      <Select value={data.year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Godina">
        {data.years.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {empty ? (
        <EmptyState
          icon={TrendingUp}
          title={`Za ${data.year}. nema podataka`}
          description="Ekonomika se sastavlja iz vrcanja, prodaje i troškova. Unesite ih pa se brojke pojave same."
        />
      ) : (
        <>
          <Card>
            <CardContent className="grid grid-cols-3 gap-3 py-4 text-center">
              <Big label="Prihod" value={formatEur(totals.revenue)} />
              <Big label="Troškovi" value={formatEur(totals.expenses)} />
              <Big
                label="Dobit"
                value={formatEur(totals.profit)}
                tone={totals.profit >= 0 ? 'ok' : 'critical'}
                icon={totals.profit >= 0 ? TrendingUp : TrendingDown}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 py-4">
              <Metric label="Proizvedeno" value={`${formatNumber(totals.producedKg)} kg`} />
              <Metric
                label="Prosjek po zajednici"
                value={totals.kgPerColony === null ? '—' : `${formatNumber(totals.kgPerColony, 1)} kg`}
              />
              <Metric
                label="Trošak"
                value={totals.costPerKg === null ? '—' : `${formatEur(totals.costPerKg)}/kg`}
              />
              <Metric
                label="Prosječna prodajna cijena"
                value={totals.pricePerKg === null ? '—' : `${formatEur(totals.pricePerKg)}/kg`}
              />
            </CardContent>
          </Card>

          {totals.honeyRevenue !== totals.revenue && (
            <p className="text-xs text-muted-foreground">
              Prosječna cijena računa se samo iz prodaje meda ({formatEur(totals.honeyRevenue)}). Ostali
              prihod — vosak, matice, rojevi — ulazi u prihod, ali nema kilograme iza sebe.
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Po pčelinjaku</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {apiaries.map((a) => (
                <div key={a.apiaryId ?? 'none'} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="min-w-0 truncate font-medium">{a.apiaryName}</p>
                    <span
                      className={cn(
                        'tabular shrink-0 font-semibold',
                        a.profit >= 0 ? 'text-ok' : 'text-critical',
                      )}
                    >
                      {formatEur(a.profit)}
                    </span>
                  </div>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 text-xs text-muted-foreground sm:grid-cols-4">
                    <SmallStat label="Prihod" value={formatEur(a.revenue)} />
                    <SmallStat label="Trošak" value={formatEur(a.expenses)} />
                    <SmallStat label="Proizvedeno" value={`${formatNumber(a.producedKg)} kg`} />
                    <SmallStat
                      label="kg/zajednici"
                      value={a.kgPerColony === null ? '—' : formatNumber(a.kgPerColony, 1)}
                    />
                  </dl>
                  {a.apiaryId === null && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Prihod i trošak koji nisu vezani ni uz jedan pčelinjak. Ne raspoređuju se —
                      izmišljena raspodjela izgleda kao mjerenje.
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {expenseBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Struktura troškova</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {expenseBreakdown.map((e) => (
                  <div key={e.category}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{e.label}</span>
                      <span className="tabular shrink-0 font-medium">{formatEur(e.total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round((e.total / maxExpense) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prihod po mjesecima</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {monthlyRevenue.map((m) => (
                <div key={m.month} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">
                    {MONTHS[m.month - 1]!.slice(0, 3)}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-secondary">
                    <div
                      className="h-full rounded bg-primary/70"
                      style={{ width: `${Math.round((m.total / maxMonth) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular w-20 shrink-0 text-right text-xs">
                    {m.total > 0 ? formatEur(m.total, 0) : ''}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Big({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string
  value: string
  tone?: 'ok' | 'critical'
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular flex items-center justify-center gap-1 text-lg font-bold',
          tone === 'ok' && 'text-ok',
          tone === 'critical' && 'text-critical',
        )}
      >
        {Icon && <Icon className="size-4" />}
        {value}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular font-semibold">{value}</p>
    </div>
  )
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tabular font-medium text-foreground">{value}</dd>
    </div>
  )
}
