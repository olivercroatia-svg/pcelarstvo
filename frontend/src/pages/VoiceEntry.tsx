import { ArrowLeft, CheckCircle2, CloudOff, Quote, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChoiceGroup, Stepper } from '@/components/ui/choice'
import { Disclaimer } from '@/components/ui/disclaimer'
import { useToast } from '@/components/ui/toast'
import { ApiError } from '@/lib/api'
import { AI_DISCLAIMER, postForm, useAiStatus, type VoiceResult } from '@/lib/ai'
import {
  BROOD_OPTIONS,
  QUEEN_OPTIONS,
  STORES_OPTIONS,
  STRENGTH_OPTIONS,
  SWARM_OPTIONS,
} from '@/lib/inspectionOptions'
import { useOutbox } from '@/lib/outbox'
import type { Brood, QueenState, Stores, Strength, Swarming } from '@/lib/types'

/**
 * §13 — "Pčelar govori, aplikacija zapisuje".
 *
 * Three states on one screen: record, review, save. The middle one is the feature. §13 asks for a
 * confirmation step before saving, and this is it — the transcript is shown verbatim above a
 * perfectly ordinary §12 form that the model has filled in. Every field stays editable, nothing is
 * pre-committed, and the save button goes through the same outbox as the manual screen, so a
 * dictated inspection survives a dead spot exactly like a tapped one.
 *
 * The transcript is shown, not hidden behind a "details" toggle, on purpose. When a field comes out
 * wrong the beekeeper needs to see whether they were misheard or misunderstood — those have
 * different fixes, and only one of them is "say it again".
 */
export function VoiceEntryPage() {
  const [params] = useSearchParams()
  const hiveCode = params.get('kosnica')
  const navigate = useNavigate()
  const { showSuccess, showError, showInfo } = useToast()
  const { enqueue, online } = useOutbox()
  const { status } = useAiStatus()

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<VoiceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The editable copy. Seeded from the draft, then owned entirely by the beekeeper.
  const [obs, setObs] = useState<{
    strength: Strength | null
    framesBees: number | null
    framesBrood: number | null
    brood: Brood | null
    queenState: QueenState | null
    swarming: Swarming | null
    queenCells: number | null
    stores: Stores | null
  }>({
    strength: null,
    framesBees: null,
    framesBrood: null,
    brood: null,
    queenState: null,
    swarming: null,
    queenCells: null,
    stores: null,
  })
  const [notes, setNotes] = useState('')

  async function send(blob: Blob, mimeType: string) {
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      // The extension has to match the container or the provider rejects the upload.
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('mpeg') ? 'mp3' : 'webm'
      form.append('audio', blob, `pregled.${ext}`)
      if (hiveCode) form.append('hiveCode', hiveCode)

      const value = await postForm<VoiceResult>('/ai/voice', form)
      setResult(value)
      setObs({
        strength: value.draft.strength,
        framesBees: value.draft.framesBees,
        framesBrood: value.draft.framesBrood,
        brood: value.draft.brood,
        queenState: value.draft.queenState,
        swarming: value.draft.swarming,
        queenCells: value.draft.queenCells,
        stores: value.draft.stores,
      })
      setNotes(value.draft.notes ?? '')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.code === 'ai_cap_reached'
            ? 'Mjesečni limit AI funkcija je dosegnut. Pregled unesite obrascem.'
            : err.message
          : 'Snimku nije moguće obraditi.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!result?.hive) return
    setSaving(true)
    const id = crypto.randomUUID()
    try {
      await enqueue({
        id,
        kind: 'inspection',
        path: '/inspections',
        label: `Pregled ${result.hive.code}`,
        payload: {
          id,
          hiveId: result.hive.id,
          visitId: null,
          inspectedAt: new Date().toISOString(),
          ...obs,
          notes: notes.trim() || null,
        },
      })
      if (online) showSuccess(`Pregled košnice ${result.hive.code} je spremljen`)
      else showInfo(`Pregled ${result.hive.code} čeka signal na uređaju`)
      navigate(`/kosnice/${result.hive.id}`, { replace: true })
    } catch {
      showError('Pregled nije moguće spremiti')
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof typeof obs>(key: K, value: (typeof obs)[K]) =>
    setObs((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-4">
      <div className="flex items-center gap-2">
        <Link to="/unos" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Glasovni unos</h1>
      </div>

      {!status.voice ? (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              Glasovni unos nije dostupan na ovoj instalaciji. Pregled unesite obrascem — otvorite
              košnicu i pritisnite „Novi pregled".
            </p>
          </CardContent>
        </Card>
      ) : !result ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">
              Recite što ste vidjeli, svojim riječima. Na primjer:{' '}
              <span className="italic">
                „AN-04, jaka zajednica, osam ulica, leglo uredno, maticu nisam vidio ali ima jaja,
                hrane dovoljno."
              </span>
            </p>
            {hiveCode && (
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
                Skenirana košnica: <span className="font-semibold">{hiveCode}</span>
              </p>
            )}
            <VoiceRecorder onRecorded={(b, t) => void send(b, t)} busy={busy} disabled={status.capReached} />
            {status.capReached && (
              <p className="text-sm text-caution">
                Mjesečni limit AI funkcija je dosegnut. Obnavlja se prvog u mjesecu.
              </p>
            )}
            {error && <p className="text-sm text-critical">{error}</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-2 pt-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Quote className="size-3.5" aria-hidden />
                Prepoznato
              </p>
              <p className="text-sm italic leading-relaxed">„{result.transcript}"</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-3"
                onClick={() => {
                  setResult(null)
                  setError(null)
                }}
              >
                <RotateCcw />
                Snimi ponovno
              </Button>
            </CardContent>
          </Card>

          {result.draft.unmatched.length > 0 && (
            <p className="rounded-lg bg-caution/10 p-3 text-sm text-caution">
              Nisam razumio: {result.draft.unmatched.join('; ')}. Provjerite je li sve zapisano.
            </p>
          )}

          {!result.hive && (
            <p className="rounded-lg bg-critical/10 p-3 text-sm text-critical">
              Nisam prepoznao o kojoj se košnici radi
              {result.draft.hiveCode ? ` (čuo sam „${result.draft.hiveCode}")` : ''}. Skenirajte QR
              kod košnice ili je otvorite s popisa i unesite pregled obrascem.
            </p>
          )}

          <Card>
            <CardContent className="space-y-4 pt-4">
              {result.hive && (
                <p className="text-sm">
                  <span className="font-semibold">{result.hive.code}</span>
                  <span className="text-muted-foreground"> · {result.hive.apiary}</span>
                </p>
              )}
              <ChoiceGroup label="Snaga" options={STRENGTH_OPTIONS} value={obs.strength} onChange={(v) => set('strength', v)} />
              <Stepper label="Ulica pčela" value={obs.framesBees} onChange={(v) => set('framesBees', v)} />
              <Stepper label="Okvira legla" value={obs.framesBrood} onChange={(v) => set('framesBrood', v)} />
              <ChoiceGroup label="Leglo" options={BROOD_OPTIONS} value={obs.brood} onChange={(v) => set('brood', v)} />
              <ChoiceGroup label="Matica" options={QUEEN_OPTIONS} value={obs.queenState} onChange={(v) => set('queenState', v)} />
              <ChoiceGroup label="Rojenje" options={SWARM_OPTIONS} value={obs.swarming} onChange={(v) => set('swarming', v)} />
              <Stepper label="Matičnjaka" value={obs.queenCells} onChange={(v) => set('queenCells', v)} max={200} />
              <ChoiceGroup label="Zalihe hrane" options={STORES_OPTIONS} value={obs.stores} onChange={(v) => set('stores', v)} />

              <div className="space-y-1.5">
                <label htmlFor="voice-notes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bilješka
                </label>
                <textarea
                  id="voice-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">{AI_DISCLAIMER}</p>
          <Disclaimer />

          <Button size="lg" className="w-full" onClick={() => void save()} disabled={saving || !result.hive}>
            {online ? <CheckCircle2 /> : <CloudOff />}
            {saving ? 'Spremam…' : 'Potvrdi i spremi pregled'}
          </Button>
        </>
      )}
    </div>
  )
}
