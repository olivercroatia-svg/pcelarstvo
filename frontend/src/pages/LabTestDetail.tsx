import { ArrowLeft, Check, Minus, Printer, TriangleAlert } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatNumber } from '@/lib/format'
import type { LabReading, LabTest, LabVerdict } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/** §31 — "Rezultat se prikazuje kao kartica." */
export function LabTestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, error, loading } = useResource<{ test: LabTest }>(`/lab/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { test } = data
  const measured = test.readings.filter((r) => r.value !== null)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Link
          to={`/serije/${test.batchId}`}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Nalaz</h1>
        <button
          type="button"
          onClick={() => window.print()}
          aria-label="Ispiši nalaz"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Printer className="size-5" />
        </button>
      </div>

      <Card>
        <CardContent className="py-3">
          <dl className="space-y-1.5 text-sm">
            <Row label="Serija" value={test.lotCode} />
            <Row label="Laboratorij" value={test.laboratory} />
            <Row label="Broj nalaza" value={test.reportNumber} />
            <Row label="Uzorkovano" value={test.sampledOn ? formatDate(test.sampledOn) : null} />
            <Row label="Analizirano" value={test.testedOn ? formatDate(test.testedOn) : null} />
          </dl>
        </CardContent>
      </Card>

      <Card className={cn(test.verdict === 'fail' && 'border-critical/40')}>
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">Status serije</p>
          <p
            className={cn(
              'text-lg font-semibold',
              test.verdict === 'pass' && 'text-ok',
              test.verdict === 'fail' && 'text-critical',
            )}
          >
            {test.verdict === 'pass' && 'Parametri odgovaraju unesenim kriterijima'}
            {test.verdict === 'fail' && 'Jedan ili više parametara odstupa od unesenih kriterija'}
            {test.verdict === 'unrated' && 'Nema parametara s unesenim kriterijem'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parametri ({measured.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {measured.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nijedna vrijednost nije unesena.</p>
          ) : (
            measured.map((r) => <ReadingRow key={r.code} reading={r} />)
          )}
        </CardContent>
      </Card>

      {test.notes && (
        <Card>
          <CardContent className="py-3 text-sm">{test.notes}</CardContent>
        </Card>
      )}

      <Disclaimer text="Usporedba s unesenim kriterijima je informativna i ne zamjenjuje službeni laboratorijski nalaz. Mjerodavan je dokument koji je izdao laboratorij." />
    </div>
  )
}

const VERDICT: Record<LabVerdict, { icon: typeof Check; tone: string; label: string }> = {
  pass: { icon: Check, tone: 'text-ok', label: 'unutar kriterija' },
  fail: { icon: TriangleAlert, tone: 'text-critical', label: 'izvan kriterija' },
  unrated: { icon: Minus, tone: 'text-muted-foreground', label: 'bez kriterija' },
}

function ReadingRow({ reading }: { reading: LabReading }) {
  const { icon: Icon, tone, label } = VERDICT[reading.verdict]
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{reading.name}</p>
        {/* §31's own caveat, per parameter — a blanket limit is sometimes simply wrong for a
            particular honey, and saying nothing would make the red cross look authoritative. */}
        {reading.note && <p className="text-xs text-muted-foreground">{reading.note}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="tabular font-semibold">
          {formatNumber(reading.value, reading.decimals)}
          {reading.unit ? ` ${reading.unit}` : ''}
        </p>
        <p className={cn('flex items-center justify-end gap-1 text-xs', tone)}>
          <Icon className="size-3" aria-hidden />
          {label}
        </p>
      </div>
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
