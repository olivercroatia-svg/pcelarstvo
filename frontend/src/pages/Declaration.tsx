import { ArrowLeft, Printer } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { formatDate, formatNumber } from '@/lib/format'
import type { Declaration } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/**
 * §34 — "Moguć izvoz: PDF, A4 etikete, termalni printer."
 *
 * All three come out of the browser's own print dialog, the same decision as the §17 register in
 * Etapa 2: a system font carries č/ć/š/ž/đ without a font file to embed, the beekeeper sees
 * exactly what will come out of the printer, and there is no PDF library on the VPS to keep alive.
 * The three formats differ only in the @page rule and how many copies are laid out.
 *
 * The regulatory text is not written here. It comes from declaration_texts, which an administrator
 * edits (§34: "mora biti administrativno podesiv").
 */

type Format = 'a4' | 'labels' | 'thermal'

const FORMATS: Record<Format, { label: string; page: string; hint: string }> = {
  a4: {
    label: 'A4 — jedna deklaracija',
    page: '@page { size: A4 portrait; margin: 18mm; }',
    hint: 'Za arhivu i za inspekciju.',
  },
  labels: {
    label: 'A4 — arak etiketa',
    page: '@page { size: A4 portrait; margin: 8mm; }',
    hint: 'Tri stupca po arku. Broj etiketa odaberite ispod.',
  },
  thermal: {
    label: 'Termalni printer 58 mm',
    page: '@page { size: 58mm 90mm; margin: 3mm; }',
    hint: 'Jedna etiketa po odsječku role.',
  },
}

export function DeclarationPage() {
  const { id } = useParams<{ id: string }>()
  const [format, setFormat] = useState<Format>('a4')
  const [copies, setCopies] = useState('24')
  const { data, error, loading } = useResource<{ declaration: Declaration }>(`/packaging/${id}/declaration`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const d = data.declaration
  const copyCount = format === 'labels' ? Math.min(Math.max(Number(copies) || 1, 1), 120) : 1

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Injected rather than sitting in the stylesheet: @page cannot be switched with a class,
          and the paper size genuinely has to change between the three formats. */}
      <style>{FORMATS[format].page}</style>

      <div className="flex items-center gap-2 print:hidden">
        <Link
          to={`/pakiranja/${id}`}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Deklaracija</h1>
      </div>

      <Card className="print:hidden">
        <CardContent className="space-y-4 pt-4">
          <Field label="Format ispisa" hint={FORMATS[format].hint}>
            {(p) => (
              <Select {...p} value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                {(Object.keys(FORMATS) as Format[]).map((key) => (
                  <option key={key} value={key}>
                    {FORMATS[key].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {format === 'labels' && (
            <Field label="Broj etiketa" hint={`U pakiranju je ${d.jarCount} staklenki`}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  value={copies}
                  onChange={(e) => setCopies(e.target.value)}
                />
              )}
            </Field>
          )}

          <Button size="lg" className="w-full" onClick={() => window.print()}>
            <Printer />
            Ispiši
          </Button>
        </CardContent>
      </Card>

      <div
        className={cn(
          format === 'labels' && 'grid grid-cols-2 gap-2 print:grid-cols-3 print:gap-1',
          format !== 'labels' && 'space-y-3',
        )}
      >
        {Array.from({ length: copyCount }, (_, index) => (
          <DeclarationLabel key={index} d={d} format={format} />
        ))}
      </div>
    </div>
  )
}

function DeclarationLabel({ d, format }: { d: Declaration; format: Format }) {
  const compact = format !== 'a4'
  return (
    <article
      className={cn(
        'break-inside-avoid rounded-lg border border-border bg-card p-3 text-foreground',
        // On paper the honey palette becomes ink on white; a card background would be a grey box.
        'print:rounded-none print:border-black print:bg-white print:text-black',
        compact ? 'text-[10px] leading-snug' : 'text-sm',
        format === 'thermal' && 'print:border-0 print:p-0',
      )}
    >
      <h2 className={cn('font-bold', compact ? 'text-xs' : 'text-lg')}>{d.productName}</h2>
      <p className={compact ? 'text-[9px]' : 'text-xs'}>
        {d.honeyType}
        {d.isNational ? ' · nacionalna staklenka' : ''}
      </p>

      <dl className={cn('mt-2 space-y-0.5', compact && 'mt-1')}>
        <LabelRow label="Neto količina" value={`${formatNumber(d.netWeightG, 0)} g`} compact={compact} />
        <LabelRow label="LOT" value={d.lotCode} compact={compact} />
        {d.bestBefore && (
          <LabelRow label="Najbolje upotrijebiti do" value={formatDate(d.bestBefore)} compact={compact} />
        )}
        <LabelRow label="Zemlja podrijetla" value={d.countryOfOrigin} compact={compact} />
        {d.serialFrom && (
          <LabelRow
            label="Serijski broj"
            value={`${d.serialFrom}${d.serialTo ? ` – ${d.serialTo}` : ''}`}
            compact={compact}
          />
        )}
      </dl>

      <div className={cn('mt-2 border-t border-border pt-1.5 print:border-black', compact && 'mt-1 pt-1')}>
        <p className="font-medium">{d.producer}</p>
        <p className={compact ? 'text-[9px]' : 'text-xs'}>{d.address}</p>
        {/* The OIB is a mandatory label element for a registered producer, and this page is the
            beekeeper's own printout. It is not on the public §35 page, which a stranger reaches. */}
        {d.oib && <p className={compact ? 'text-[9px]' : 'text-xs'}>OIB {d.oib}</p>}
      </div>

      {d.storageConditions && (
        <p className={cn('mt-1.5', compact ? 'text-[9px]' : 'text-xs')}>{d.storageConditions}</p>
      )}
      {d.mandatoryNotice && (
        <p className={cn('mt-1 font-medium', compact ? 'text-[9px]' : 'text-xs')}>{d.mandatoryNotice}</p>
      )}
      {d.nationalNotice && (
        <p className={cn('mt-1', compact ? 'text-[9px]' : 'text-xs')}>{d.nationalNotice}</p>
      )}

      {format === 'a4' && (
        <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground print:border-black print:text-black">
          Predložak je izrađen iz podataka unesenih u aplikaciju. Prije tiska provjerite usklađenost
          s važećim propisima o označavanju hrane.
        </p>
      )}
    </article>
  )
}

function LabelRow({ label, value, compact }: { label: string; value: string; compact: boolean }) {
  // Stacked on a label, side by side on A4. At the ~64 mm a three-per-row sheet gives each label,
  // "Najbolje upotrijebiti do" and its date fight for one line and both end up wrapping raggedly;
  // stacking costs one line and reads cleanly.
  if (compact) {
    return (
      <div className="leading-tight">
        <dt className="text-[8px] uppercase tracking-wide text-muted-foreground print:text-black">{label}</dt>
        <dd className="tabular font-medium">{value}</dd>
      </div>
    )
  }
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular text-right font-medium">{value}</dd>
    </div>
  )
}
