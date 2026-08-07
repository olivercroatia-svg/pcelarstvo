import { ArrowLeft, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatEur, formatNumber } from '@/lib/format'
import type { AnnualReport } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §49 — "Generiraj izvještaj 2026." All fourteen sections the scenario lists, in its order.
 *
 * Printed by the browser, the third time this application makes that choice (§25 forms, §34
 * declarations, and now this). A system font carries č/ć/š/ž/đ without embedding anything, the
 * beekeeper sees exactly what the printer will produce, and no PDF library has to be kept alive on
 * the VPS.
 *
 * Sections 11 and 12 — prodaja and troškovi — are simply absent from the API response for a
 * worker (§4). The page renders what it was given rather than deciding what to hide.
 */

const YEARS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)

const PAGE_CSS = '@page { size: A4 portrait; margin: 16mm; }'

export function AnnualReportPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const { data, error, loading } = useResource<{ report: AnnualReport }>(`/report?year=${year}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const r = data.report

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{PAGE_CSS}</style>

      <div className="flex items-center gap-2 print:hidden">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Godišnji izvještaj</h1>
      </div>

      <Card className="print:hidden">
        <CardContent className="space-y-4 pt-4">
          <Field label="Godina">
            {(p) => (
              <Select {...p} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}.
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {!r.includesFinancials && (
            <p className="text-xs text-muted-foreground">
              Prodaja i troškovi nisu uključeni jer vaš račun nema pristup financijskim podacima.
            </p>
          )}
          <Button size="lg" className="w-full" onClick={() => window.print()}>
            <Printer />
            Ispiši
          </Button>
        </CardContent>
      </Card>

      <article className="space-y-5 rounded-lg border border-border bg-card p-5 text-sm print:rounded-none print:border-0 print:bg-white print:p-0 print:text-black">
        <header className="border-b border-border pb-3 print:border-black">
          <h2 className="text-xl font-bold">Godišnji izvještaj {r.year}.</h2>
          <p className="text-xs text-muted-foreground print:text-black">
            {r.farm.name} · sastavljeno {formatDate(r.generatedOn)}
          </p>
        </header>

        <Section title="1. Podaci gospodarstva">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <Item label="Nositelj" value={r.farm.holder} />
            <Item label="OIB" value={r.farm.oib} />
            <Item label="MIBPG" value={r.farm.mibpg} />
            <Item label="EPP broj" value={r.farm.eppNumber} />
            <Item label="Adresa" value={r.farm.address} />
            <Item label="Mjesto" value={r.farm.city} />
            <Item label="Udruga" value={r.farm.association} />
            <Item label="Odgovorna osoba" value={r.farm.responsiblePerson} />
          </dl>
        </Section>

        <Section title="2. Pčelinjaci">
          <Table
            head={['Pčelinjak', 'Mjesto', 'Vrsta', 'Košnica', 'Zajednica']}
            rows={r.apiaries.map((a) => [
              a.name,
              a.place ?? '—',
              a.kind === 'migratory' ? 'Seleći' : 'Stacionarni',
              String(a.hives),
              String(a.colonies),
            ])}
          />
        </Section>

        <Section title="3. Broj zajednica">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <Item label="Pčelinjaka" value={String(r.summary.apiaries)} />
            <Item label="Zajednica" value={String(r.summary.colonies)} />
            <Item label="Vrcanja" value={String(r.summary.harvests)} />
            <Item label="Tretmana" value={String(r.summary.treatments)} />
          </dl>
        </Section>

        <Section title="4. Proizvodnja">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Item label="Ukupno meda" value={`${formatNumber(r.summary.producedKg)} kg`} />
            <Item
              label="Prosjek po zajednici"
              value={r.summary.kgPerColony === null ? '—' : `${formatNumber(r.summary.kgPerColony, 1)} kg`}
            />
            <Item label="Laboratorijskih analiza" value={String(r.summary.labTests)} />
          </dl>
        </Section>

        <Section title="5. Vrste meda">
          <Table
            head={['Vrsta', 'Količina', 'Udio', 'Serija']}
            rows={r.honeyTypes.map((t) => [
              t.honeyType,
              `${formatNumber(t.kg)} kg`,
              `${t.share} %`,
              String(t.batches),
            ])}
          />
        </Section>

        <Section title="6. Matice">
          <Table
            head={['Oznaka', 'Godina', 'Linija', 'Zajednica']}
            rows={r.queens.map((q) => [
              q.code,
              q.year === null ? '—' : `${q.year}.`,
              q.line ?? '—',
              String(q.colonies),
            ])}
          />
        </Section>

        <Section title="7. Veterinarski tretmani">
          <Table
            head={['Datum', 'Proizvod', 'LOT', 'Pčelinjak', 'Karenca do']}
            rows={r.treatments.map((t) => [
              formatDate(t.startedOn),
              t.productName,
              t.lotNumber ?? '—',
              t.apiaryName,
              t.withdrawalUntil ? formatDate(t.withdrawalUntil) : '—',
            ])}
          />
        </Section>

        <Section title="8. Varroa monitoring">
          <Table
            head={['Datum', 'Pčelinjak', 'Grinja', 'Zaraženost']}
            rows={r.varroa.map((v) => [
              formatDate(v.checkedOn),
              v.apiaryName,
              String(v.mitesFound),
              v.infestationPercent === null ? '—' : `${formatNumber(v.infestationPercent, 1)} %`,
            ])}
          />
        </Section>

        <Section title="9. Vrcanja">
          <Table
            head={['Datum', 'Paša', 'Pčelinjak', 'LOT', 'Količina']}
            rows={r.harvests.map((h) => [
              formatDate(h.harvestedOn),
              h.pasture,
              h.apiaryName,
              h.lotCode ?? '—',
              h.totalKg === null ? '—' : `${formatNumber(h.totalKg)} kg`,
            ])}
          />
        </Section>

        <Section title="10. Laboratorijske analize">
          <Table
            head={['Datum', 'LOT', 'Vrsta', 'Laboratorij', 'Broj nalaza']}
            rows={r.labTests.map((l) => [
              formatDate(l.testedOn ?? l.sampledOn),
              l.lotCode,
              l.honeyType,
              l.laboratory ?? '—',
              l.reportNumber ?? '—',
            ])}
          />
        </Section>

        {r.sales ? (
          <Section title="11. Prodaja">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <Item label="Prodaja" value={String(r.sales.count)} />
              <Item label="Prihod" value={formatEur(r.sales.revenue)} />
              <Item label="Prodano meda" value={`${formatNumber(r.sales.honeyKg)} kg`} />
            </dl>
          </Section>
        ) : (
          <Section title="11. Prodaja">
            <p className="text-muted-foreground print:text-black">
              Nije uključeno — vaš račun nema pristup financijskim podacima.
            </p>
          </Section>
        )}

        {r.expenses && (
          <Section title="12. Troškovi">
            <Table
              head={['Kategorija', 'Iznos', 'Zapisa']}
              rows={r.expenses.breakdown.map((e) => [e.label, formatEur(e.total), String(e.entries)])}
              foot={['Ukupno', formatEur(r.expenses.total), '']}
            />
            {r.economics && (
              <p className="mt-2 font-medium">
                Dobit: {formatEur(r.economics.profit)}
              </p>
            )}
          </Section>
        )}

        <Section title="13. Gubici zajednica">
          {r.losses.prepared === 0 ? (
            <p className="text-muted-foreground print:text-black">Nema evidentiranih zajednica za zimu {r.losses.season}</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-x-4 gap-y-1">
                <Item label={`Zima ${r.losses.season} pripremljeno`} value={String(r.losses.prepared)} />
                <Item label="Proljeće" value={String(r.losses.survived)} />
                <Item
                  label="Gubitak"
                  value={r.losses.lossPercent === null ? '—' : `${formatNumber(r.losses.lossPercent, 1)} %`}
                />
              </dl>
              {r.losses.reasons.length > 0 && (
                <Table
                  head={['Uzrok', 'Zajednica']}
                  rows={r.losses.reasons.map((x) => [
                    r.losses.reasonLabels[x.reason] ?? x.reason,
                    String(x.count),
                  ])}
                />
              )}
            </>
          )}
        </Section>

        <Section title="14. Prinosi po košnicama">
          {r.hiveYields.top.length === 0 ? (
            <p className="text-muted-foreground print:text-black">Nema podataka o prinosu.</p>
          ) : (
            <>
              <Table
                head={['Košnica', 'Prinos', 'Vrcanja', 'Matica']}
                rows={r.hiveYields.top.map((h) => [
                  h.code,
                  `${formatNumber(h.kg, 1)} kg`,
                  String(h.harvests),
                  h.queenLine ?? h.queenCode ?? '—',
                ])}
              />
              <p className="mt-1 text-xs text-muted-foreground print:text-black">
                Prinos po košnici je procjena: količina svakog vrcanja podijeljena je ravnomjerno na
                košnice koje su u njemu sudjelovale.
              </p>
            </>
          )}
        </Section>

        <footer className="border-t border-border pt-3 text-xs text-muted-foreground print:border-black print:text-black">
          Izvještaj je sastavljen iz podataka unesenih u aplikaciju. Ne zamjenjuje službene evidencije
          niti propisane obrasce; prije predaje provjerite usklađenost s važećim propisima.
        </footer>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-1.5">
      <h3 className="text-sm font-bold uppercase tracking-wide">{title}</h3>
      {children}
    </section>
  )
}

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground print:text-black">{label}</dt>
      <dd className="font-medium">{value ?? '—'}</dd>
    </div>
  )
}

function Table({ head, rows, foot }: { head: string[]; rows: string[][]; foot?: string[] }) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground print:text-black">Nema zapisa.</p>
  }
  return (
    // Wide tables scroll inside their own box on a phone; on paper they fit the 16 mm margin.
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-border print:border-black">
            {head.map((h) => (
              <th key={h} className="py-1 pr-2 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50 print:border-black/30">
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? 'py-1 pr-2' : 'tabular py-1 pr-2'}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {foot && (
            <tr className="border-t border-border font-semibold print:border-black">
              {foot.map((cell, j) => (
                <td key={j} className={j === 0 ? 'py-1 pr-2' : 'tabular py-1 pr-2'}>
                  {cell}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
