import { ArrowLeft, Plus, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, todayIso } from '@/lib/format'
import { RELOCATION_STATUS } from '@/lib/labels'
import type { Apiary, Relocation } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/** §21 — "Seleće pčelarenje". The list; the checklist lives on the card. */
export function RelocationsPage() {
  const [adding, setAdding] = useState(false)
  const { data, error, loading, reload } = useResource<{ relocations: Relocation[] }>('/relocations')
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const relocations = data?.relocations ?? []
  const planned = relocations.filter((r) => r.status === 'planned')

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Selidbe</h1>
      </div>

      {adding ? (
        <RelocationForm
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
          Nova selidba
        </Button>
      )}

      {planned.some((r) => !r.ready) && (
        <p className="rounded-lg bg-caution/10 p-3 text-sm text-caution">
          Neka planirana selidba nema sve stavke. Otvorite je i dovršite checklistu prije polaska.
        </p>
      )}

      {relocations.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Nema evidentiranih selidbi"
          description="Svaka selidba nosi checklistu: lokacija, zajednice, suglasnost, povjerenik, prijevoz."
        />
      ) : (
        <div className="space-y-3">
          {relocations.map((r) => (
            <Link key={r.id} to={`/selidbe/${r.id}`} className="block">
              <Card className="transition-colors hover:border-primary">
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {r.fromLocation ? `${r.fromLocation} → ` : ''}
                        {r.toLocation}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.completedOn ?? r.plannedOn)} · {r.apiaryName}
                        {r.coloniesCount ? ` · ${r.coloniesCount} zajednica` : ''}
                      </p>
                    </div>
                    <StatusPill
                      level={r.status === 'done' ? 'ok' : r.status === 'cancelled' ? 'info' : r.ready ? 'ok' : 'caution'}
                    >
                      {r.status === 'planned' && !r.ready ? 'Nedostaje' : RELOCATION_STATUS[r.status]}
                    </StatusPill>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function RelocationForm({
  apiaries,
  onDone,
  onCancel,
}: {
  apiaries: Apiary[]
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [apiaryId, setApiaryId] = useState(apiaries.length === 1 ? apiaries[0]!.id : '')
  const [toLocation, setToLocation] = useState('')
  const [pasture, setPasture] = useState('')
  const [plannedOn, setPlannedOn] = useState(todayIso())
  const [coloniesCount, setColoniesCount] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (!apiaryId) return setFieldErrors({ apiaryId: 'Odaberite pčelinjak' })
    if (toLocation.trim().length < 2) return setFieldErrors({ toLocation: 'Unesite odredište' })

    setSaving(true)
    try {
      await api('/relocations', {
        method: 'POST',
        body: {
          apiaryId,
          toLocation: toLocation.trim(),
          pasture: pasture.trim() || null,
          plannedOn,
          coloniesCount: coloniesCount === '' ? null : Number(coloniesCount),
        },
      })
      showSuccess('Selidba je planirana')
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
        <CardTitle className="text-base">Nova selidba</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label="Pčelinjak" error={fieldErrors.apiaryId} hint="Polazište se popuni iz podataka pčelinjaka">
            {(p) => (
              <Select {...p} value={apiaryId} onChange={(e) => setApiaryId(e.target.value)}>
                <option value="">Odaberite…</option>
                {apiaries.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Odredište" error={fieldErrors.toLocation}>
            {(p) => (
              <Input
                {...p}
                value={toLocation}
                onChange={(e) => setToLocation(e.target.value)}
                placeholder="Slavonija – Suncokret"
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum">
              {(p) => <Input {...p} type="date" value={plannedOn} onChange={(e) => setPlannedOn(e.target.value)} />}
            </Field>
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
          </div>
          <Field label="Paša" optional>
            {(p) => <Input {...p} value={pasture} onChange={(e) => setPasture(e.target.value)} placeholder="Suncokret" />}
          </Field>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Spremam…' : 'Planiraj selidbu'}
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
