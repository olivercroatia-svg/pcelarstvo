import { ArrowLeft, Flower2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { Apiary, Pasture } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

interface Response {
  pastures: Pasture[]
  suggestions: string[]
}

/**
 * §20 — the pasture plan for a season, and what actually came of it.
 *
 * "Očekivani prinos" is a plan and is typed in. "Stvarni prinos" is not: it is summed from the
 * harvests recorded on this apiary, under this pasture name, inside these dates. A second
 * hand-typed number next to a list of harvests that add up to something else is two answers to one
 * question.
 */
export function PasturesPage() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [adding, setAdding] = useState(false)
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()

  const { data, error, loading, reload } = useResource<Response>(`/pastures?year=${year}`)
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const pastures = data?.pastures ?? []
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i)

  async function remove(pasture: Pasture) {
    const ok = await confirm({
      title: 'Brisanje paše',
      description: `${pasture.name} ${pasture.seasonYear}. Vrcanja se ne brišu.`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/pastures/${pasture.id}`, { method: 'DELETE' })
      showSuccess('Paša je obrisana')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Paše</h1>
      </div>

      {adding ? (
        <PastureForm
          year={year}
          suggestions={data?.suggestions ?? []}
          apiaries={apiaryData?.apiaries ?? []}
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Nova paša
        </Button>
      )}

      <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Sezona">
        {years.map((y) => (
          <option key={y} value={y}>
            {y}.
          </option>
        ))}
      </Select>

      {pastures.length === 0 ? (
        <EmptyState
          icon={Flower2}
          title={`Za ${year}. nema planiranih paša`}
          description="Paša povezuje pčelinjak, razdoblje i očekivani prinos. Stvarni prinos se sam popuni iz vrcanja."
        />
      ) : (
        <div className="space-y-3">
          {pastures.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.apiaryName,
                        p.startsOn && p.endsOn ? `${formatDate(p.startsOn)} – ${formatDate(p.endsOn)}` : null,
                        p.coloniesCount ? `${p.coloniesCount} zajednica` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    aria-label={`Obriši pašu ${p.name}`}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    Prinos {p.harvests > 0 ? `(${p.harvests} ${p.harvests === 1 ? 'vrcanje' : 'vrcanja'})` : ''}
                  </span>
                  <span className="tabular font-semibold">
                    {formatNumber(p.actualYieldKg)} kg
                    {p.expectedYieldKg !== null && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        / {formatNumber(p.expectedYieldKg)} kg
                      </span>
                    )}
                  </span>
                </div>
                {p.achievedPercent !== null && (
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn('h-full rounded-full', p.achievedPercent >= 100 ? 'bg-ok' : 'bg-primary')}
                      style={{ width: `${Math.min(100, p.achievedPercent)}%` }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function PastureForm({
  year,
  suggestions,
  apiaries,
  onDone,
  onCancel,
}: {
  year: number
  suggestions: string[]
  apiaries: Apiary[]
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [name, setName] = useState('')
  const [apiaryId, setApiaryId] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [coloniesCount, setColoniesCount] = useState('')
  const [expectedYieldKg, setExpectedYieldKg] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (name.trim().length < 2) return setFieldErrors({ name: 'Unesite naziv paše' })

    setSaving(true)
    try {
      await api('/pastures', {
        method: 'POST',
        body: {
          name: name.trim(),
          seasonYear: year,
          apiaryId: apiaryId || null,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
          coloniesCount: coloniesCount === '' ? null : Number(coloniesCount),
          expectedYieldKg: expectedYieldKg === '' ? null : Number(expectedYieldKg),
        },
      })
      showSuccess('Paša je dodana')
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nova paša — sezona {year}.</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            label="Paša"
            error={fieldErrors.name}
            hint="Naziv mora odgovarati onome što upisujete kod vrcanja da bi se prinos povezao"
          >
            {(p) => (
              <>
                <Input {...p} list="pasture-suggestions" value={name} onChange={(e) => setName(e.target.value)} />
                <datalist id="pasture-suggestions">
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          {apiaries.length > 0 && (
            <Field label="Pčelinjak" optional>
              {(p) => (
                <Select {...p} value={apiaryId} onChange={(e) => setApiaryId(e.target.value)}>
                  <option value="">Svi pčelinjaci</option>
                  {apiaries.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Početak" optional>
              {(p) => <Input {...p} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />}
            </Field>
            <Field label="Završetak" optional>
              {(p) => <Input {...p} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Broj zajednica" optional>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={coloniesCount}
                  onChange={(e) => setColoniesCount(e.target.value)}
                />
              )}
            </Field>
            <Field label="Očekivani prinos (kg)" optional>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={expectedYieldKg}
                  onChange={(e) => setExpectedYieldKg(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Spremam…' : 'Spremi pašu'}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Odustani
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
