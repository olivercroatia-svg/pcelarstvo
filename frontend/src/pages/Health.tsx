import { ArrowLeft, HeartPulse, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, todayIso } from '@/lib/format'
import type { Apiary, Disease, HealthEvent, HealthEventKind, Hive } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const KIND_LABEL: Record<HealthEventKind, string> = {
  suspicion: 'Sumnja',
  diagnosis: 'Dijagnoza',
  symptom: 'Simptom',
  vet_visit: 'Veterinarski pregled',
  lab_result: 'Laboratorijski nalaz',
  mortality: 'Mortalitet',
  other: 'Ostalo',
}

const DISEASE_LABEL: Record<Disease, string> = {
  varroa: 'Varooza',
  american_foulbrood: 'Američka gnjiloća',
  european_foulbrood: 'Europska gnjiloća',
  nosema: 'Nozemoza',
  chalkbrood: 'Vapnenasto leglo',
  sacbrood: 'Vrećasto leglo',
  small_hive_beetle: 'Mali kornjaš košnice',
  tropilaelaps: 'Tropilaelaps',
  poisoning: 'Trovanje',
  other: 'Drugo',
}

const SEVERITY_LABEL: Record<string, string> = { low: 'blago', medium: 'srednje', high: 'ozbiljno' }

/** American foulbrood is notifiable in Croatia — the form says so at the moment it is chosen. */
const NOTIFIABLE: Disease[] = ['american_foulbrood', 'tropilaelaps', 'small_hive_beetle']

const EMPTY = {
  apiaryId: '',
  hiveId: '',
  kind: 'suspicion' as HealthEventKind,
  disease: '' as Disease | '',
  severity: 'medium',
  observedOn: todayIso(),
  title: '',
  description: '',
  vetName: '',
  reportNumber: '',
  coloniesAffected: '',
  coloniesLost: '',
}

/** §15 — the health record for a hive, an apiary, or the whole holding. */
export function HealthPage() {
  const [params] = useSearchParams()
  const hiveFilter = params.get('kosnica')
  const { showSuccess, showError } = useToast()

  const path = hiveFilter ? `/health-events?hiveId=${hiveFilter}` : '/health-events'
  const { data, error, loading, reload } = useResource<{ events: HealthEvent[] }>(path)
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  const [form, setForm] = useState({ ...EMPTY, hiveId: hiveFilter ?? '' })
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const { data: hiveData } = useResource<{ hives: Hive[] }>(
    form.apiaryId ? `/hives?apiaryId=${form.apiaryId}` : null,
  )

  const set = (key: keyof typeof EMPTY, value: string) => setForm((prev) => ({ ...prev, [key]: value }))
  const apiaries = apiaryData?.apiaries ?? []

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (form.title.trim().length < 2) {
      setFieldErrors({ title: 'Unesite kratak opis' })
      return
    }
    setSaving(true)
    try {
      await api('/health-events', {
        method: 'POST',
        body: {
          apiaryId: form.apiaryId || null,
          hiveId: form.hiveId || null,
          kind: form.kind,
          disease: form.disease || null,
          severity: form.severity || null,
          observedOn: form.observedOn,
          title: form.title.trim(),
          description: form.description.trim() || null,
          vetName: form.vetName.trim() || null,
          reportNumber: form.reportNumber.trim() || null,
          coloniesAffected: form.coloniesAffected === '' ? null : Number(form.coloniesAffected),
          coloniesLost: form.coloniesLost === '' ? null : Number(form.coloniesLost),
        },
      })
      showSuccess('Zapis je spremljen')
      setForm({ ...EMPTY, hiveId: hiveFilter ?? '' })
      setAdding(false)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function resolve(id: string) {
    try {
      await api(`/health-events/${id}`, { method: 'PATCH', body: { resolvedOn: todayIso() } })
      showSuccess('Slučaj je zatvoren')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const events = data?.events ?? []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to={hiveFilter ? `/kosnice/${hiveFilter}` : '/'} aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Zdravstveni karton</h1>
      </div>

      {!adding && (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Novi zapis
        </Button>
      )}

      {adding && (
        <form onSubmit={submit} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Novi zdravstveni zapis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Vrsta zapisa">
                {(p) => (
                  <Select {...p} value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                    {Object.entries(KIND_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Bolest / uzrok" optional>
                {(p) => (
                  <Select {...p} value={form.disease} onChange={(e) => set('disease', e.target.value)}>
                    <option value="">Nije određeno</option>
                    {Object.entries(DISEASE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {NOTIFIABLE.includes(form.disease as Disease) && (
                <p className="rounded-lg bg-critical/10 p-2.5 text-sm text-critical">
                  Ovo je bolest koja podliježe obvezi prijave. Odmah obavijestite nadležnog
                  veterinara i upišite broj prijave niže.
                </p>
              )}

              <Field label="Kratak opis" error={fieldErrors.title}>
                {(p) => (
                  <Input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Proljev na letu" />
                )}
              </Field>

              <Field label="Datum opažanja">
                {(p) => <Input {...p} type="date" value={form.observedOn} onChange={(e) => set('observedOn', e.target.value)} />}
              </Field>

              <Field label="Pčelinjak" optional>
                {(p) => (
                  <Select
                    {...p}
                    value={form.apiaryId}
                    onChange={(e) => {
                      set('apiaryId', e.target.value)
                      set('hiveId', '')
                    }}
                  >
                    <option value="">Cijelo gospodarstvo</option>
                    {apiaries.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {form.apiaryId && (
                <Field label="Košnica" optional>
                  {(p) => (
                    <Select {...p} value={form.hiveId} onChange={(e) => set('hiveId', e.target.value)}>
                      <option value="">Cijeli pčelinjak</option>
                      {(hiveData?.hives ?? []).map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.code}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              <Field label="Težina" optional>
                {(p) => (
                  <Select {...p} value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    <option value="">—</option>
                    <option value="low">Blago</option>
                    <option value="medium">Srednje</option>
                    <option value="high">Ozbiljno</option>
                  </Select>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Zahvaćeno zajednica" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.coloniesAffected}
                      onChange={(e) => set('coloniesAffected', e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Uginulo zajednica" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={form.coloniesLost}
                      onChange={(e) => set('coloniesLost', e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <Field label="Veterinar" optional>
                {(p) => <Input {...p} value={form.vetName} onChange={(e) => set('vetName', e.target.value)} />}
              </Field>
              <Field label="Broj nalaza / prijave" optional>
                {(p) => <Input {...p} value={form.reportNumber} onChange={(e) => set('reportNumber', e.target.value)} />}
              </Field>
              <Field label="Opis" optional>
                {(p) => <Input {...p} value={form.description} onChange={(e) => set('description', e.target.value)} />}
              </Field>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi zapis'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                  Odustani
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {events.length === 0 && !adding ? (
        <EmptyState
          icon={HeartPulse}
          title="Zdravstveni karton je prazan"
          description="Ovdje se vode sumnje, dijagnoze, veterinarski pregledi, nalazi i mortalitet."
        />
      ) : (
        events.map((event) => (
          <Card key={event.id} className={event.resolvedOn ? undefined : 'border-caution/40'}>
            <CardContent className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(event.observedOn)} · {KIND_LABEL[event.kind]}
                    {event.disease ? ` · ${DISEASE_LABEL[event.disease]}` : ''}
                    {event.severity ? ` · ${SEVERITY_LABEL[event.severity]}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.hiveCode ? `Košnica ${event.hiveCode}` : (event.apiaryName ?? 'Cijelo gospodarstvo')}
                    {event.coloniesLost ? ` · uginulo ${event.coloniesLost}` : ''}
                  </p>
                </div>
                <StatusPill level={event.resolvedOn ? 'ok' : 'caution'}>
                  {event.resolvedOn ? 'zatvoreno' : 'otvoreno'}
                </StatusPill>
              </div>
              {event.description && <p className="mt-1.5 text-sm">{event.description}</p>}
              {(event.vetName || event.reportNumber) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {[event.vetName, event.reportNumber && `br. ${event.reportNumber}`].filter(Boolean).join(' · ')}
                </p>
              )}
              {!event.resolvedOn && (
                <Button variant="outline" size="sm" className="mt-2" onClick={() => resolve(event.id)}>
                  Zatvori slučaj
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Disclaimer text="Aplikacija ne postavlja dijagnozu. Zdravstveni karton je evidencija vaših opažanja i nalaza — dijagnostiku i liječenje provodi ovlašteni veterinar." />
    </div>
  )
}
