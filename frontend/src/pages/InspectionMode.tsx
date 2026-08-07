import { ArrowLeft, ClipboardCheck, FileText, Printer, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { CheckRow } from '@/components/ui/status'
import { formatDate } from '@/lib/format'
import type { InspectionModeData } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/labels'

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  )
}

/**
 * §26 — the clean screen the beekeeper hands to a visiting official.
 *
 * "Dokumenti se mogu otvoriti bez prikaza osobnih financijskih podataka." That is enforced on the
 * server: /api/inspection-mode never reads a price, a cost or a customer, so there is no financial
 * value on this page to hide in the first place. Hiding it in CSS would be one inspect-element
 * away from being visible.
 */
export function InspectionModePage() {
  const { data, error, loading } = useResource<InspectionModeData>('/inspection-mode')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { farm } = data

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Inspekcija</h1>
        <Button variant="ghost" size="icon" aria-label="Ispiši" onClick={() => window.print()}>
          <Printer />
        </Button>
      </div>

      <Link
        to="/inspekcija/spremnost"
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border border-input px-4 text-sm font-medium hover:bg-accent print:hidden"
      >
        <ClipboardCheck className="size-5" />
        Provjeri spremnost za inspekciju
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Gospodarstvo
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Field label="Naziv" value={farm.name} />
            <Field label="Nositelj" value={farm.holder} />
            <Field label="Odgovorna osoba" value={farm.responsiblePerson} />
            <Field label="OIB" value={farm.oib} />
            <Field label="MIBPG" value={farm.mibpg} />
            <Field label="EPP broj" value={farm.eppNumber} />
            <Field label="Adresa" value={[farm.address, farm.city].filter(Boolean).join(', ') || null} />
            <Field label="Udruga" value={farm.association} />
          </dl>
        </CardContent>
      </Card>

      {data.groups.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle className="text-base">{group.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul>
              {group.items.map((item) => (
                <CheckRow
                  key={item.label}
                  label={item.label}
                  ok={item.ok}
                  detail={item.detail}
                  pending={item.pending}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pčelinjaci ({data.apiaries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Pčelinjak</th>
                  <th className="py-1 pr-2 font-medium">Mjesto</th>
                  <th className="tabular py-1 pr-2 font-medium">Zajednice</th>
                  <th className="py-1 font-medium">Suglasnost</th>
                </tr>
              </thead>
              <tbody>
                {data.apiaries.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-2">{a.name}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{a.city ?? '—'}</td>
                    <td className="tabular py-1.5 pr-2">{a.colonies}</td>
                    <td className="py-1.5 text-muted-foreground">
                      {a.permitNumber ?? '—'}
                      {a.permitExpiresOn ? ` (do ${formatDate(a.permitExpiresOn)})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidencija VMP ({data.treatments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.treatments.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nema evidentiranih tretmana.</p>
          ) : (
            <ul className="space-y-2">
              {data.treatments.map((t) => (
                <li key={t.id} className="border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                  <p className="font-medium">{t.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.startedOn)}
                    {t.endedOn ? ` – ${formatDate(t.endedOn)}` : ''} · {t.apiaryName}
                    {t.lotNumber ? ` · LOT ${t.lotNumber}` : ' · bez LOT-a'}
                    {t.withdrawalUntil ? ` · karenca do ${formatDate(t.withdrawalUntil)}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link to="/tretmani" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline print:hidden">
            Otvori punu evidenciju za ispis
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dokumentacija ({data.documents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Arhiva je prazna.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.documents.map((doc) => (
                <li key={doc.id} className="flex items-start gap-2 text-sm">
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {doc.hasFile ? (
                      <a
                        href={`${import.meta.env.BASE_URL}api/documents/${doc.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {doc.title}
                      </a>
                    ) : (
                      <span className="font-medium">{doc.title}</span>
                    )}
                    <span className="block text-xs text-muted-foreground">
                      {DOCUMENT_CATEGORY_LABELS[doc.category]}
                      {doc.referenceNumber ? ` · ${doc.referenceNumber}` : ''}
                      {doc.issuedOn ? ` · ${formatDate(doc.issuedOn)}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Disclaimer className="print:hidden" />
    </div>
  )
}
