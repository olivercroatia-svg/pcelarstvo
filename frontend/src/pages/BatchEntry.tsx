import { ArrowLeft, CheckCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChoiceGroup } from '@/components/ui/choice'
import { Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useOutbox } from '@/lib/outbox'
import type { Apiary, Brood, Hive, Observation, Stores, Strength } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const STRENGTH_OPTIONS = [
  { value: 'weak' as Strength, label: 'Slaba', tone: 'warning' as const },
  { value: 'medium' as Strength, label: 'Srednja' },
  { value: 'strong' as Strength, label: 'Jaka' },
  { value: 'very_strong' as Strength, label: 'Vrlo jaka' },
]
const BROOD_OPTIONS = [
  { value: 'none' as Brood, label: 'Nema' },
  { value: 'little' as Brood, label: 'Malo' },
  { value: 'normal' as Brood, label: 'Normalno' },
  { value: 'plenty' as Brood, label: 'Puno' },
]
const STORES_OPTIONS = [
  { value: 'poor' as Stores, label: 'Slabe', tone: 'warning' as const },
  { value: 'good' as Stores, label: 'Dobre' },
  { value: 'excellent' as Stores, label: 'Odlične' },
]

/**
 * §60 — one observation applied to many hives.
 *
 * The scenario's example is a treatment across 50 colonies: recording it 50 times is not something
 * anyone will do, so the app must offer this or the register simply goes unfilled. Each hive still
 * gets its own row, so the individual cards stay truthful.
 */
export function BatchEntryPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { showSuccess, showInfo, showError } = useToast()
  const { enqueue, online } = useOutbox()

  const [apiaryId, setApiaryId] = useState(params.get('pcelinjak') ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [obs, setObs] = useState<Observation>({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const { data, error, loading } = useResource<{ hives: Hive[] }>(
    `/hives${apiaryId ? `?apiaryId=${apiaryId}` : ''}`,
  )

  // A batch entry describes bees; an empty box has none to describe.
  const hives = useMemo(() => (data?.hives ?? []).filter((h) => h.colony !== null), [data])

  const allSelected = hives.length > 0 && selected.size === hives.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    if (selected.size === 0) return
    setSaving(true)

    const hiveIds = hives.filter((h) => selected.has(h.id)).map((h) => h.id)
    const ids = hiveIds.map(() => crypto.randomUUID())
    // The batch itself is queued under one id so an offline round replays as a single unit.
    const batchId = crypto.randomUUID()

    try {
      await enqueue({
        id: batchId,
        kind: 'inspection_batch',
        path: '/inspections/batch',
        label: `Skupni unos · ${hiveIds.length} košnica`,
        payload: {
          hiveIds,
          ids,
          inspectedAt: new Date().toISOString(),
          ...obs,
          notes: notes.trim() || null,
        },
      })

      if (online) showSuccess(`Zapis je dodan za ${hiveIds.length} košnica`)
      else showInfo(`${hiveIds.length} zapisa spremljeno na uređaj — poslat će se kad bude signala`)

      navigate('/kosnice', { replace: true })
    } catch {
      showError('Skupni unos nije moguće spremiti')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-4">
      <div className="flex items-center gap-2">
        <Link to="/unos" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Skupni unos</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Isti zapis primjenjuje se na sve odabrane košnice, ali svaka dobiva vlastiti unos u svojoj
        povijesti.
      </p>

      <Select value={apiaryId} onChange={(e) => { setApiaryId(e.target.value); setSelected(new Set()) }}>
        <option value="">Sve košnice</option>
        {apiaryData?.apiaries.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>

      {loading && <LoadingState />}
      {error && <ErrorState message={error} />}

      {hives.length > 0 && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Odabrano <span className="tabular">{selected.size}</span> / {hives.length}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(allSelected ? new Set() : new Set(hives.map((h) => h.id)))}
              >
                <CheckCheck />
                {allSelected ? 'Poništi sve' : 'Odaberi sve'}
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-2 min-[420px]:grid-cols-5">
              {hives.map((hive) => {
                const on = selected.has(hive.id)
                return (
                  <button
                    key={hive.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(hive.id)}
                    className={cn(
                      'min-h-12 rounded-lg border text-sm font-medium tabular',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-accent',
                    )}
                  >
                    {hive.code}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <ChoiceGroup
        label="Snaga zajednice"
        options={STRENGTH_OPTIONS}
        value={obs.strength}
        onChange={(v) => setObs((p) => ({ ...p, strength: v }))}
      />
      <ChoiceGroup
        label="Leglo"
        options={BROOD_OPTIONS}
        value={obs.brood}
        onChange={(v) => setObs((p) => ({ ...p, brood: v }))}
      />
      <ChoiceGroup
        label="Zalihe hrane"
        options={STORES_OPTIONS}
        value={obs.stores}
        onChange={(v) => setObs((p) => ({ ...p, stores: v }))}
      />

      <div className="space-y-1.5">
        <label htmlFor="batch-notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Napomena
        </label>
        <textarea
          id="batch-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-base"
          placeholder="Tretman oksalnom kiselinom, prihrana…"
        />
      </div>

      <Button size="lg" className="w-full" onClick={save} disabled={saving || selected.size === 0}>
        {saving ? 'Spremam…' : `Primijeni na ${selected.size} košnica`}
      </Button>
    </div>
  )
}
