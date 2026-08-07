import { ArrowLeft, Camera, CloudOff, LoaderCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChoiceGroup, Stepper } from '@/components/ui/choice'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { uploadPhoto } from '@/lib/image'
import { useOutbox } from '@/lib/outbox'
import type { Brood, Hive, Observation, QueenState, Stores, Strength, Swarming } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const STRENGTH_OPTIONS = [
  { value: 'weak' as Strength, label: 'Slaba', tone: 'warning' as const },
  { value: 'medium' as Strength, label: 'Srednja' },
  { value: 'strong' as Strength, label: 'Jaka' },
  { value: 'very_strong' as Strength, label: 'Vrlo jaka' },
]
const BROOD_OPTIONS = [
  { value: 'none' as Brood, label: 'Nema', tone: 'warning' as const },
  { value: 'little' as Brood, label: 'Malo' },
  { value: 'normal' as Brood, label: 'Normalno' },
  { value: 'plenty' as Brood, label: 'Puno' },
]
const QUEEN_OPTIONS = [
  { value: 'seen' as QueenState, label: 'Viđena', tone: 'ok' as const },
  { value: 'eggs' as QueenState, label: 'Jaja prisutna', tone: 'ok' as const },
  { value: 'not_found' as QueenState, label: 'Nije pronađena', tone: 'critical' as const },
]
const SWARM_OPTIONS = [
  { value: 'none' as Swarming, label: 'Nema znakova', tone: 'ok' as const },
  { value: 'cells' as Swarming, label: 'Matičnjaci', tone: 'warning' as const },
  { value: 'high_risk' as Swarming, label: 'Visok rizik', tone: 'critical' as const },
]
const STORES_OPTIONS = [
  { value: 'poor' as Stores, label: 'Slabe', tone: 'warning' as const },
  { value: 'good' as Stores, label: 'Dobre' },
  { value: 'excellent' as Stores, label: 'Odlične' },
]

/**
 * §12 + §59 — the screen the whole app is judged by.
 *
 * Everything is optional and nothing blocks saving: an inspection with three taps recorded is
 * worth more than a complete one abandoned because a required field was in the way. Date, time
 * and hive come from context, so the beekeeper never types.
 */
export function InspectionPage() {
  const { hiveId } = useParams()
  const [params] = useSearchParams()
  const visitId = params.get('obilazak')
  const navigate = useNavigate()
  const { showSuccess, showError, showInfo } = useToast()
  const { enqueue, online } = useOutbox()
  const fileInput = useRef<HTMLInputElement>(null)

  const { data, error, loading } = useResource<{ hive: Hive }>(hiveId ? `/hives/${hiveId}` : null)

  const [obs, setObs] = useState<Observation>({ framesBees: null, framesBrood: null, queenCells: null })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [photoCount, setPhotoCount] = useState(0)
  const [uploading, setUploading] = useState(false)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const hive = data.hive
  const set = <K extends keyof Observation>(key: K, value: Observation[K]) =>
    setObs((prev) => ({ ...prev, [key]: value }))

  async function save() {
    setSaving(true)
    // Minted here, on the device, so the record has a stable identity whether it goes out now or
    // sits in the outbox until the signal comes back.
    const id = crypto.randomUUID()
    try {
      await enqueue({
        id,
        kind: 'inspection',
        path: '/inspections',
        label: `Pregled ${hive.code}`,
        payload: {
          id,
          hiveId: hive.id,
          visitId,
          inspectedAt: new Date().toISOString(),
          ...obs,
          notes: notes.trim() || null,
        },
      })

      if (online) showSuccess(`Pregled košnice ${hive.code} je spremljen`)
      else showInfo(`Pregled ${hive.code} je spremljen na uređaj i poslat će se kad bude signala`)

      navigate(visitId ? `/obilazak/${visitId}` : `/kosnice/${hive.id}`, { replace: true })
    } catch {
      showError('Pregled nije moguće spremiti')
    } finally {
      setSaving(false)
    }
  }

  async function addPhoto(file: File) {
    setUploading(true)
    try {
      // Photos need a connection — they attach to the hive rather than the queued inspection,
      // which keeps the offline path to a single small JSON write.
      await uploadPhoto(file, 'hive', hive.id)
      setPhotoCount((n) => n + 1)
      showSuccess('Fotografija je dodana')
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Fotografiju nije moguće poslati')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">Košnica {hive.code}</h1>
          <p className="text-xs text-muted-foreground">
            {new Date().toLocaleDateString('hr-HR')} ·{' '}
            {new Date().toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' })} · datum i
            vrijeme automatski
          </p>
        </div>
      </div>

      {!online && (
        <Card className="border-caution/50">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <CloudOff className="size-4 shrink-0 text-caution" aria-hidden />
            Bez veze — pregled se sprema na uređaj i šalje automatski.
          </CardContent>
        </Card>
      )}

      <ChoiceGroup
        label="Snaga zajednice"
        options={STRENGTH_OPTIONS}
        value={obs.strength}
        onChange={(v) => set('strength', v)}
      />

      <Stepper
        label="Broj okvira s pčelama"
        value={obs.framesBees ?? null}
        onChange={(v) => set('framesBees', v)}
      />

      <ChoiceGroup label="Leglo" options={BROOD_OPTIONS} value={obs.brood} onChange={(v) => set('brood', v)} />

      <ChoiceGroup
        label="Matica"
        options={QUEEN_OPTIONS}
        value={obs.queenState}
        onChange={(v) => set('queenState', v)}
      />

      <ChoiceGroup
        label="Rojenje"
        options={SWARM_OPTIONS}
        value={obs.swarming}
        onChange={(v) => set('swarming', v)}
      />

      {(obs.swarming === 'cells' || obs.swarming === 'high_risk') && (
        <Stepper
          label="Broj matičnjaka"
          value={obs.queenCells ?? null}
          onChange={(v) => set('queenCells', v)}
          max={200}
        />
      )}

      <ChoiceGroup
        label="Zalihe hrane"
        options={STORES_OPTIONS}
        value={obs.stores}
        onChange={(v) => set('stores', v)}
      />

      <div className="space-y-1.5">
        <label htmlFor="notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Napomena
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-base"
          placeholder="Dodao okvir satne osnove…"
        />
      </div>

      <div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone instead of the file picker.
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void addPhoto(file)
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => fileInput.current?.click()}
          disabled={uploading || !online}
        >
          {uploading ? <LoaderCircle className="animate-spin" /> : <Camera />}
          {photoCount > 0 ? `Fotografije (${photoCount})` : 'Dodaj fotografiju'}
        </Button>
        {!online && <p className="mt-1 text-xs text-muted-foreground">Fotografije zahtijevaju vezu.</p>}
      </div>

      <Button size="lg" className="w-full" onClick={save} disabled={saving}>
        {saving ? 'Spremam…' : 'Spremi pregled'}
      </Button>

      <Link
        to={`/kosnice/${hive.id}`}
        className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Otvori karton košnice
      </Link>
    </div>
  )
}
