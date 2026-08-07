import { Crown, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import type { MarkingColor, Queen } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const COLOR_LABEL: Record<MarkingColor, string> = {
  white: 'bijela',
  yellow: 'žuta',
  red: 'crvena',
  green: 'zelena',
  blue: 'plava',
}

// The physical marking paint, so the swatch matches what is on the queen's thorax.
const COLOR_SWATCH: Record<MarkingColor, string> = {
  white: '#f8f8f6',
  yellow: '#f2c200',
  red: '#cc2222',
  green: '#2f9e44',
  blue: '#1c6fd0',
}

const STATUS: Record<string, { label: string; className: string }> = {
  good: { label: 'Dobra', className: 'bg-ok/15 text-ok' },
  watch: { label: 'Pratiti', className: 'bg-caution/20 text-caution' },
  replace: { label: 'Zamijeniti', className: 'bg-critical/15 text-critical' },
}

function Dots({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="flex gap-1" role="img" aria-label={`${label}: ${value} od 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            className={cn('size-2.5 rounded-full', n <= value ? 'bg-foreground' : 'bg-muted')}
          />
        ))}
      </span>
    </div>
  )
}

export function QueensPage() {
  const { data, error, loading, reload } = useResource<{ queens: Queen[]; suggestedColor: MarkingColor }>(
    '/queens',
  )
  const { showSuccess, showError } = useToast()
  const [adding, setAdding] = useState(false)

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Matice</h1>
        <Button onClick={() => setAdding((v) => !v)} variant={adding ? 'outline' : 'default'}>
          {adding ? <X /> : <Plus />}
          {adding ? 'Odustani' : 'Nova'}
        </Button>
      </div>

      {adding && data && (
        <QueenForm
          suggestedColor={data.suggestedColor}
          onSaved={async () => {
            setAdding(false)
            showSuccess('Matica je dodana')
            await reload()
          }}
          onError={(m) => showError(m)}
        />
      )}

      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && data.queens.length === 0 && !adding && (
        <EmptyState
          icon={Crown}
          title="Još nemate evidentiranih matica"
          description="Vodite podrijetlo, godinu i ocjene — kasnije se iz toga vidi koja linija daje najbolji prinos."
        />
      )}

      <ul className="space-y-2">
        {data?.queens.map((queen) => {
          const status = STATUS[queen.status] ?? STATUS.good
          return (
            <li key={queen.id}>
              <Card>
                <CardContent className="space-y-2 py-4">
                  <div className="flex items-center gap-2">
                    {queen.markingColor && (
                      <span
                        className="size-4 shrink-0 rounded-full border border-border"
                        style={{ background: COLOR_SWATCH[queen.markingColor] }}
                        title={COLOR_LABEL[queen.markingColor]}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-semibold">{queen.code}</span>
                    <span className={cn('shrink-0 rounded px-2 py-0.5 text-xs font-medium', status.className)}>
                      {status.label}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {queen.year ? `${queen.year}.` : 'godina nepoznata'}
                    {queen.ageYears !== null && ` · ${queen.ageYears} god.`}
                    {queen.line ? ` · ${queen.line}` : ''}
                    {queen.hive ? ` · košnica ${queen.hive.code}` : ' · nije u košnici'}
                  </p>

                  {queen.ageYears !== null && queen.ageYears >= 2 && queen.status !== 'replace' && (
                    <p className="text-xs text-caution">
                      Starija od dvije sezone — razmislite o zamjeni.
                    </p>
                  )}

                  <div className="space-y-1 pt-1">
                    <Dots label="Produktivnost" value={queen.ratingProductivity} />
                    <Dots label="Mirnoća" value={queen.ratingCalmness} />
                    <Dots label="Rojivost" value={queen.ratingSwarming} />
                  </div>
                </CardContent>
              </Card>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function QueenForm({
  suggestedColor,
  onSaved,
  onError,
}: {
  suggestedColor: MarkingColor
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const currentYear = new Date().getFullYear()
  const [code, setCode] = useState('')
  const [year, setYear] = useState(String(currentYear))
  const [color, setColor] = useState<MarkingColor>(suggestedColor)
  const [line, setLine] = useState('')
  const [breeder, setBreeder] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFieldErrors({})
    try {
      await api('/queens', {
        method: 'POST',
        body: {
          code: code.trim(),
          year: year ? Number(year) : null,
          markingColor: color,
          line: line.trim() || null,
          breeder: breeder.trim() || null,
        },
      })
      await onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      onError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label="Oznaka" error={fieldErrors.code}>
            {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} placeholder="M-26-014" />}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Godina">
              {(p) => <Input {...p} value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />}
            </Field>
            <Field
              label="Boja oznake"
              hint={
                Number(year) === currentYear
                  ? `${currentYear}. → ${COLOR_LABEL[suggestedColor]}`
                  : 'međunarodni ciklus'
              }
            >
              {(p) => (
                <Select {...p} value={color} onChange={(e) => setColor(e.target.value as MarkingColor)}>
                  {(Object.keys(COLOR_LABEL) as MarkingColor[]).map((c) => (
                    <option key={c} value={c}>
                      {COLOR_LABEL[c]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label="Linija / podrijetlo" optional>
            {(p) => <Input {...p} value={line} onChange={(e) => setLine(e.target.value)} placeholder="Carnica" />}
          </Field>
          <Field label="Uzgajivač" optional>
            {(p) => <Input {...p} value={breeder} onChange={(e) => setBreeder(e.target.value)} />}
          </Field>

          <Button type="submit" className="w-full" disabled={saving || code.trim().length === 0}>
            {saving ? 'Spremam…' : 'Dodaj maticu'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
