import { ArrowLeft, CheckCheck, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber, todayIso } from '@/lib/format'
import type { Apiary, Hive } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/**
 * §28 — "Novo vrcanje", field for field: datum, pčelinjak, paša, košnice, količina, vlaga, posude.
 *
 * The LOT is not on this form. It is assigned by the server on save and shown afterwards, because
 * a code the beekeeper could edit here would stop being a code that means anything.
 */

/** The pastures a Croatian beekeeper actually extracts, as a starting list — the field stays free. */
const PASTURES = [
  'Bagrem',
  'Kadulja',
  'Kesten',
  'Lipa',
  'Livadna paša',
  'Medljika',
  'Vrijesak',
  'Amorfa',
  'Suncokret',
  'Metvica',
]

interface ContainerRow {
  name: string
  amountKg: string
}

export function HarvestNewPage() {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const [apiaryId, setApiaryId] = useState('')
  const { data: hiveData } = useResource<{ hives: Hive[] }>(apiaryId ? `/hives?apiaryId=${apiaryId}` : null)

  const [harvestedOn, setHarvestedOn] = useState(todayIso())
  const [pasture, setPasture] = useState('')
  const [honeyType, setHoneyType] = useState('')
  const [totalKg, setTotalKg] = useState('')
  const [moisture, setMoisture] = useState('')
  const [frames, setFrames] = useState('')
  const [notes, setNotes] = useState('')
  const [hiveIds, setHiveIds] = useState<string[]>([])
  const [containers, setContainers] = useState<ContainerRow[]>([])
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const apiaries = apiaryData?.apiaries ?? []
  const effectiveApiary = apiaryId || (apiaries.length === 1 ? apiaries[0]!.id : '')
  const hives = hiveData?.hives ?? []
  const allSelected = hives.length > 0 && hiveIds.length === hives.length

  const containerTotal = containers.reduce((sum, c) => sum + (Number(c.amountKg) || 0), 0)
  const declaredTotal = Number(totalKg) || 0
  // Shown, never enforced — a beekeeper who itemised two of three vessels has still recorded
  // something useful, and the server takes the entry either way.
  const mismatch = containers.length > 0 && declaredTotal > 0 ? declaredTotal - containerTotal : 0

  function setContainer(index: number, patch: Partial<ContainerRow>) {
    setContainers((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (!effectiveApiary) return setFieldErrors({ apiaryId: 'Odaberite pčelinjak' })
    if (pasture.trim().length < 2) return setFieldErrors({ pasture: 'Unesite pašu' })
    if (!(declaredTotal > 0)) return setFieldErrors({ totalKg: 'Unesite izvrcanu količinu' })

    setSaving(true)
    try {
      const result = await api<{ harvest: { id: string }; batch: { lotCode: string } }>('/harvests', {
        method: 'POST',
        body: {
          apiaryId: effectiveApiary,
          harvestedOn,
          pasture: pasture.trim(),
          honeyType: honeyType.trim() || null,
          totalKg: declaredTotal,
          moisturePercent: moisture === '' ? null : Number(moisture),
          framesCount: frames === '' ? null : Number(frames),
          notes: notes.trim() || null,
          hiveIds,
          containers: containers
            .filter((c) => c.name.trim() && Number(c.amountKg) > 0)
            .map((c) => ({ name: c.name.trim(), amountKg: Number(c.amountKg) })),
        },
      })
      showSuccess(`Vrcanje je evidentirano — LOT ${result.batch.lotCode}`)
      navigate(`/vrcanja/${result.harvest.id}`, { replace: true })
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
        <Link to="/vrcanja" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Novo vrcanje</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vrcanje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Datum">
            {(p) => <Input {...p} type="date" value={harvestedOn} onChange={(e) => setHarvestedOn(e.target.value)} />}
          </Field>

          {apiaries.length > 1 && (
            <Field label="Pčelinjak" error={fieldErrors.apiaryId}>
              {(p) => (
                <Select
                  {...p}
                  value={effectiveApiary}
                  onChange={(e) => {
                    setApiaryId(e.target.value)
                    setHiveIds([])
                  }}
                >
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

          <Field label="Paša" error={fieldErrors.pasture} hint="Iz paše se gradi prefiks LOT broja">
            {(p) => (
              <>
                <Input
                  {...p}
                  list="pasture-options"
                  value={pasture}
                  onChange={(e) => setPasture(e.target.value)}
                  placeholder="Kadulja"
                />
                <datalist id="pasture-options">
                  {PASTURES.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field label="Vrsta meda" optional hint="Ostavite prazno ako je isto kao paša">
            {(p) => <Input {...p} value={honeyType} onChange={(e) => setHoneyType(e.target.value)} />}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Količina (kg)" error={fieldErrors.totalKg}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={totalKg}
                  onChange={(e) => setTotalKg(e.target.value)}
                  placeholder="286"
                />
              )}
            </Field>
            <Field label="Vlaga (%)" optional>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0}
                  max={100}
                  value={moisture}
                  onChange={(e) => setMoisture(e.target.value)}
                  placeholder="17,2"
                />
              )}
            </Field>
          </div>

          <Field label="Broj okvira" optional>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={0}
                value={frames}
                onChange={(e) => setFrames(e.target.value)}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      {hives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Košnice ({hiveIds.length}/{hives.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setHiveIds(allSelected ? [] : hives.map((h) => h.id))}
            >
              <CheckCheck />
              {allSelected ? 'Poništi odabir' : 'Odaberi sve'}
            </Button>
            <div className="grid grid-cols-4 gap-2 min-[420px]:grid-cols-5">
              {hives.map((hive) => {
                const selected = hiveIds.includes(hive.id)
                return (
                  <button
                    key={hive.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setHiveIds((prev) =>
                        prev.includes(hive.id) ? prev.filter((id) => id !== hive.id) : [...prev, hive.id],
                      )
                    }
                    className={cn(
                      'min-h-12 rounded-lg border text-sm font-medium transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-accent',
                    )}
                  >
                    {hive.code}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Bez odabranih košnica sljedivost staje na pčelinjaku — kupčeva staklenka se neće moći
              vratiti do zajednice.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posude</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {containers.map((container, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Field label={`Oznaka ${index + 1}`}>
                  {(p) => (
                    <Input
                      {...p}
                      value={container.name}
                      onChange={(e) => setContainer(index, { name: e.target.value })}
                      placeholder="INOX 1"
                    />
                  )}
                </Field>
              </div>
              <div className="w-28">
                <Field label="kg">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      value={container.amountKg}
                      onChange={(e) => setContainer(index, { amountKg: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <button
                type="button"
                aria-label={`Ukloni posudu ${container.name || index + 1}`}
                onClick={() => setContainers((prev) => prev.filter((_, i) => i !== index))}
                className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setContainers((prev) => [...prev, { name: '', amountKg: '' }])}
          >
            <Plus />
            Dodaj posudu
          </Button>

          {containers.length > 0 && (
            <p className={cn('text-sm', Math.abs(mismatch) > 0.01 ? 'text-caution' : 'text-muted-foreground')}>
              Zbroj posuda: <strong className="tabular">{formatNumber(containerTotal)} kg</strong>
              {Math.abs(mismatch) > 0.01 && (
                <>
                  {' '}
                  — razlika prema unesenoj količini {formatNumber(Math.abs(mismatch))} kg.
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : 'Evidentiraj vrcanje'}
      </Button>
    </form>
  )
}
