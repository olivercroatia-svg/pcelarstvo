import { ArrowLeft, FlaskConical, Lock, Plus, Printer, Syringe } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useAuth } from '@/auth/AuthContext'
import { formatDate } from '@/lib/format'
import type { Treatment } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)

/**
 * §17 — the VMP register.
 *
 * The "Evidencija korištenja VMP-a u PDF-u" the scenario asks for is produced by the browser's
 * own print dialog against the sheet below, not by a PDF library on the server. The register has
 * to carry č/ć/š/ž/đ correctly and the beekeeper has to see exactly what an inspector will get;
 * a system font through the print pipeline gives both for free.
 */
export function TreatmentsPage() {
  const { current } = useAuth()
  const [params] = useSearchParams()
  const [year, setYear] = useState<number | ''>('')

  // Reached both as a standalone register and as "treatments for this hive / this apiary".
  const filters = [
    params.get('pcelinjak') && `apiaryId=${params.get('pcelinjak')}`,
    params.get('kosnica') && `hiveId=${params.get('kosnica')}`,
    year && `year=${year}`,
  ].filter(Boolean)
  const { data, error, loading } = useResource<{ treatments: Treatment[] }>(
    `/treatments${filters.length ? `?${filters.join('&')}` : ''}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const treatments = data?.treatments ?? []
  const farm = current?.farm

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">VMP i tretmani</h1>
        <Link
          to="/vmp"
          aria-label="Proizvodi"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FlaskConical className="size-5" />
        </Link>
      </div>

      <div className="flex flex-col gap-2 print:hidden sm:flex-row">
        <Link
          to="/tretmani/novi"
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-5" />
          Novi tretman
        </Link>
        <Button variant="outline" size="lg" onClick={() => window.print()} disabled={treatments.length === 0}>
          <Printer />
          Ispiši evidenciju
        </Button>
      </div>

      <div className="print:hidden">
        <Select value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} aria-label="Godina">
          <option value="">Sve godine</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y}.
            </option>
          ))}
        </Select>
      </div>

      {/* Only rendered on paper: the register needs a header identifying the holding, which the
          app itself already shows in the top bar. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">Evidencija primjene veterinarsko-medicinskih proizvoda</h1>
        <p className="text-sm">
          {farm?.name ?? `${current?.user.firstName} ${current?.user.lastName}`}
          {farm?.oib ? ` · OIB ${farm.oib}` : ''}
          {farm?.eppNumber ? ` · EPP ${farm.eppNumber}` : ''}
        </p>
        <p className="text-sm">
          {year ? `Razdoblje: ${year}. godina` : 'Razdoblje: sve godine'} · Ispisano{' '}
          {formatDate(new Date().toISOString().slice(0, 10))}
        </p>
      </div>

      {treatments.length === 0 ? (
        <EmptyState
          icon={Syringe}
          title="Još nema evidentiranih tretmana"
          description="Svaki primijenjeni VMP upisuje se s LOT brojem, dozom i karencom."
          action={{ to: '/tretmani/novi', label: 'Unesi tretman' }}
        />
      ) : (
        <>
          {/* Cards on the phone, a table on paper — the same data, laid out for two very
              different readers. */}
          <div className="space-y-3 print:hidden">
            {treatments.map((t) => (
              <Link key={t.id} to={`/tretmani/${t.id}`} className="block">
                <Card className="transition-colors hover:border-primary">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(t.startedOn)}
                          {t.endedOn ? ` – ${formatDate(t.endedOn)}` : ' – u tijeku'} · {t.apiaryName}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {t.withdrawalActive && <StatusPill level="warning">Karenca</StatusPill>}
                        {t.lockedAt && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="size-3" aria-hidden />
                            zaključano
                          </span>
                        )}
                      </div>
                    </div>
                    <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {t.activeSubstance && <span>{t.activeSubstance}</span>}
                      {t.lotNumber ? <span>LOT {t.lotNumber}</span> : <span className="text-caution">bez LOT-a</span>}
                      {t.hives.length > 0 && <span>{t.hives.length} košnica</span>}
                      {t.withdrawalUntil && <span>karenca do {formatDate(t.withdrawalUntil)}</span>}
                    </dl>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="hidden overflow-x-auto print:block">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-black text-left">
                  <th className="py-1 pr-2">Datum</th>
                  <th className="py-1 pr-2">Pčelinjak</th>
                  <th className="py-1 pr-2">Proizvod</th>
                  <th className="py-1 pr-2">Aktivna tvar</th>
                  <th className="py-1 pr-2">LOT</th>
                  <th className="py-1 pr-2">Doza</th>
                  <th className="py-1 pr-2">Razlog</th>
                  <th className="py-1 pr-2">Zajednica</th>
                  <th className="py-1">Karenca do</th>
                </tr>
              </thead>
              <tbody>
                {treatments.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-300 align-top">
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {formatDate(t.startedOn)}
                      {t.endedOn ? ` – ${formatDate(t.endedOn)}` : ''}
                    </td>
                    <td className="py-1 pr-2">{t.apiaryName}</td>
                    <td className="py-1 pr-2">{t.productName}</td>
                    <td className="py-1 pr-2">{t.activeSubstance ?? '—'}</td>
                    <td className="py-1 pr-2">{t.lotNumber ?? '—'}</td>
                    <td className="py-1 pr-2">{t.dose ?? '—'}</td>
                    <td className="py-1 pr-2">{t.reason ?? '—'}</td>
                    <td className="tabular py-1 pr-2">{t.coloniesTreated ?? (t.hives.length || '—')}</td>
                    <td className="py-1 whitespace-nowrap">
                      {t.withdrawalUntil ? formatDate(t.withdrawalUntil) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[10px] leading-snug">
              Evidencija je izrađena iz zapisa u aplikaciji „Moj Pčelinjak". Ispravci se vode kroz
              zapisnik izmjena; zaključani zapisi se ne mijenjaju.
            </p>
          </div>
        </>
      )}

      <Disclaimer className="print:hidden" />
    </div>
  )
}
