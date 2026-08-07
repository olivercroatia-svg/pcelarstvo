import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChoiceGroup } from '@/components/ui/choice'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input, Select } from '@/components/ui/field'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber, todayIso } from '@/lib/format'
import type { Apiary, Hive, VarroaLevel, VarroaMethod, VarroaPhase } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { levelTone } from './Varroa'

const METHODS: { value: VarroaMethod; label: string }[] = [
  { value: 'powdered_sugar', label: 'Šećer u prahu' },
  { value: 'alcohol_wash', label: 'Alkohol' },
  { value: 'natural_fall', label: 'Prirodni pad' },
  { value: 'co2', label: 'CO₂' },
]

const PHASES: { value: VarroaPhase; label: string }[] = [
  { value: 'routine', label: 'Redovna' },
  { value: 'before_treatment', label: 'Prije tretmana' },
  { value: 'after_treatment', label: 'Nakon tretmana' },
]

/** Mirrors backend/src/lib/varroa.ts so the beekeeper sees the verdict before saving. */
function previewLevel(method: VarroaMethod, mites: number, bees: number, days: number): VarroaLevel {
  if (method === 'natural_fall') {
    if (!days) return 'unknown'
    const perDay = mites / days
    return perDay >= 10 ? 'high' : perDay >= 3 ? 'moderate' : 'low'
  }
  if (!bees) return 'unknown'
  const percent = (mites * 100) / bees
  return percent >= 3 ? 'high' : percent >= 1 ? 'moderate' : 'low'
}

const LEVEL_LABEL: Record<VarroaLevel, string> = {
  low: 'Nisko',
  moderate: 'Povišeno',
  high: 'Visoko',
  unknown: '—',
}

/** §16 — the entry screen. Big targets, and the computed result shown live above the button. */
export function VarroaNewPage() {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const [params] = useSearchParams()

  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const [apiaryId, setApiaryId] = useState(params.get('pcelinjak') ?? '')
  const { data: hiveData } = useResource<{ hives: Hive[] }>(apiaryId ? `/hives?apiaryId=${apiaryId}` : null)

  const [hiveId, setHiveId] = useState('')
  const [checkedOn, setCheckedOn] = useState(todayIso())
  const [method, setMethod] = useState<VarroaMethod>('powdered_sugar')
  const [phase, setPhase] = useState<VarroaPhase>('routine')
  const [beesExamined, setBeesExamined] = useState('300')
  const [daysObserved, setDaysObserved] = useState('3')
  const [mitesFound, setMitesFound] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const apiaries = apiaryData?.apiaries ?? []
  // A single apiary needs no picker; preselect it and keep the form to one screen.
  const effectiveApiary = apiaryId || (apiaries.length === 1 ? apiaries[0]!.id : '')
  const isFall = method === 'natural_fall'

  const result = useMemo(() => {
    const mites = Number(mitesFound)
    if (!mitesFound || Number.isNaN(mites)) return null
    const bees = Number(beesExamined) || 0
    const days = Number(daysObserved) || 0
    const level = previewLevel(method, mites, bees, days)
    if (level === 'unknown') return null
    return {
      level,
      value: isFall ? mites / days : (mites * 100) / bees,
      unit: isFall ? 'varoa/dan' : '%',
    }
  }, [method, mitesFound, beesExamined, daysObserved, isFall])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (!effectiveApiary) {
      setFieldErrors({ apiaryId: 'Odaberite pčelinjak' })
      return
    }
    if (mitesFound === '') {
      setFieldErrors({ mitesFound: 'Unesite broj varoa' })
      return
    }

    setSaving(true)
    try {
      await api('/varroa', {
        method: 'POST',
        body: {
          // Client-generated, so a retry after a dropped connection lands on the primary key
          // instead of writing the reading twice.
          id: crypto.randomUUID(),
          apiaryId: effectiveApiary,
          hiveId: hiveId || null,
          checkedOn,
          method,
          phase,
          beesExamined: isFall ? null : Number(beesExamined),
          daysObserved: isFall ? Number(daysObserved) : null,
          mitesFound: Number(mitesFound),
          notes: notes.trim() || null,
        },
      })
      showSuccess('Kontrola varoe je spremljena')
      navigate('/varroa', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/varroa" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Nova kontrola</h1>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-4">
          {apiaries.length > 1 && (
            <Field label="Pčelinjak" error={fieldErrors.apiaryId}>
              {(p) => (
                <Select {...p} value={effectiveApiary} onChange={(e) => { setApiaryId(e.target.value); setHiveId('') }}>
                  <option value="">Odaberite…</option>
                  {apiaries.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <Field label="Košnica" optional hint="Ostavite prazno za uzorak s cijelog pčelinjaka">
            {(p) => (
              <Select {...p} value={hiveId} onChange={(e) => setHiveId(e.target.value)} disabled={!effectiveApiary}>
                <option value="">Cijeli pčelinjak</option>
                {(hiveData?.hives ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.code}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Datum">
            {(p) => <Input {...p} type="date" value={checkedOn} onChange={(e) => setCheckedOn(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <ChoiceGroup
            label="Metoda"
            options={METHODS}
            value={method}
            clearable={false}
            onChange={(v) => v && setMethod(v)}
          />
          <ChoiceGroup
            label="Faza"
            options={PHASES}
            value={phase}
            clearable={false}
            onChange={(v) => v && setPhase(v)}
          />

          {isFall ? (
            <Field label="Broj dana promatranja" error={fieldErrors.daysObserved}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  value={daysObserved}
                  onChange={(e) => setDaysObserved(e.target.value)}
                />
              )}
            </Field>
          ) : (
            <Field label="Broj pregledanih pčela" error={fieldErrors.beesExamined} hint="Uobičajeno 300">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  value={beesExamined}
                  onChange={(e) => setBeesExamined(e.target.value)}
                />
              )}
            </Field>
          )}

          <Field label="Broj varoa" error={fieldErrors.mitesFound}>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={0}
                autoFocus
                value={mitesFound}
                onChange={(e) => setMitesFound(e.target.value)}
                className="text-2xl font-semibold"
              />
            )}
          </Field>

          {result && (
            <div className="flex items-center justify-between rounded-lg bg-muted p-3">
              <span className="text-sm text-muted-foreground">
                {isFall ? 'Prirodni pad' : 'Infestacija'}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular text-2xl font-bold">
                  {formatNumber(result.value)} {result.unit}
                </span>
                <StatusPill level={levelTone(result.level)}>{LEVEL_LABEL[result.level]}</StatusPill>
              </span>
            </div>
          )}

          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Disclaimer text="Izračun i ocjena su informativni. Odluku o tretmanu donesite prema stanju zajednica i uputi veterinara." />

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : 'Spremi kontrolu'}
      </Button>
    </form>
  )
}
