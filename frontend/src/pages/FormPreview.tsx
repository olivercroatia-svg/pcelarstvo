import { ArrowLeft, Printer } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate } from '@/lib/format'
import type { GeneratedForm } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §25 — the prefilled data sheet.
 *
 * Printed through the browser rather than generated as a PDF on the server. Two reasons, in this
 * order: the system font renders č/ć/š/ž/đ correctly without shipping an embedded font, and the
 * beekeeper sees on screen exactly what will come out of the printer. The § 55 disclaimer is part
 * of the printed page, not just the app chrome.
 */
export function FormPreviewPage() {
  const { code } = useParams()
  const [params] = useSearchParams()
  const year = params.get('godina')

  const { data, error, loading } = useResource<{ form: GeneratedForm }>(
    `/forms/${code}${year ? `?year=${year}` : ''}`,
  )

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const form = data.form
  const missing = form.sections.flatMap((section) =>
    section.kind === 'fields' ? section.rows.filter((row) => row.value === null) : [],
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Link to="/obveze" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">{form.title}</h1>
      </div>

      <Button size="lg" className="w-full print:hidden" onClick={() => window.print()}>
        <Printer />
        Ispiši ili spremi kao PDF
      </Button>

      {missing.length > 0 && (
        <Card className="border-caution/50 print:hidden">
          <CardContent className="py-3 text-sm">
            <p className="font-medium">Nedostaje {missing.length} podatak(a)</p>
            <p className="mt-0.5 text-muted-foreground">{missing.map((row) => row.label).join(', ')}</p>
            <Link to="/profil" className="mt-1 inline-block font-medium text-primary underline-offset-4 hover:underline">
              Dopuni profil
            </Link>
          </CardContent>
        </Card>
      )}

      {/* The sheet itself. bg-white and near-black text on purpose: printed output must not
          inherit the night theme, and this block is what goes on paper. */}
      <div className="rounded-xl border border-border bg-white p-5 text-[#201e1d] print:rounded-none print:border-0 print:p-0">
        <header className="border-b-2 border-[#201e1d] pb-2">
          <h2 className="text-lg font-bold">{form.title}</h2>
          <p className="text-xs">
            Razdoblje: {form.periodYear}. godina · Ispisano {formatDate(form.generatedOn)}
          </p>
        </header>

        {form.sections.map((section) => (
          <section key={section.title} className="mt-4 break-inside-avoid">
            <h3 className="mb-1.5 text-sm font-bold uppercase tracking-wide">{section.title}</h3>

            {section.kind === 'fields' ? (
              <dl className="text-sm">
                {section.rows.map((row) => (
                  <div key={row.label} className="flex gap-3 border-b border-[#e0dbd0] py-1.5 last:border-0">
                    <dt className="w-2/5 shrink-0 text-[#6b5c47]">{row.label}</dt>
                    <dd className="min-w-0 flex-1">
                      {row.value ?? (
                        // A blank ruled line rather than an empty cell: this sheet is meant to be
                        // completed by hand where the app genuinely does not know the answer.
                        <span className="inline-block w-full border-b border-dotted border-[#a89b86] align-bottom">
                          &nbsp;
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#201e1d] text-left">
                        {section.columns.map((column) => (
                          <th key={column} className="py-1 pr-2 font-semibold">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, index) => (
                        <tr key={index} className="border-b border-[#e0dbd0]">
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="py-1.5 pr-2">
                              {cell || <span className="inline-block w-16 border-b border-dotted border-[#a89b86]">&nbsp;</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {section.note && <p className="mt-1 text-[11px] text-[#6b5c47]">{section.note}</p>}
              </>
            )}
          </section>
        ))}

        <div className="mt-8 flex justify-between gap-8 break-inside-avoid text-xs">
          <div className="flex-1">
            <div className="border-b border-[#201e1d]" />
            <p className="mt-1 text-[#6b5c47]">Mjesto i datum</p>
          </div>
          <div className="flex-1">
            <div className="border-b border-[#201e1d]" />
            <p className="mt-1 text-[#6b5c47]">Potpis</p>
          </div>
        </div>

        <p className="mt-5 border-t border-[#e0dbd0] pt-2 text-[10px] leading-snug text-[#6b5c47]">
          {form.disclaimer}
        </p>
      </div>
    </div>
  )
}
