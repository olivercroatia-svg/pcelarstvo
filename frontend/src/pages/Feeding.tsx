import { ArrowLeft, CloudOff, Droplet, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChoiceGroup } from '@/components/ui/choice'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { formatDate, formatNumber, todayIso } from '@/lib/format'
import { useOutbox } from '@/lib/outbox'
import type { Apiary, FeedType, Feeding, Hive } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const FEED_TYPES: { value: FeedType; label: string }[] = [
  { value: 'syrup', label: 'Sirup' },
  { value: 'sugar', label: 'Šećer' },
  { value: 'patty', label: 'Pogača' },
  { value: 'honey', label: 'Med' },
]

const FEED_LABEL: Record<string, string> = {
  syrup: 'Sirup',
  sugar: 'Šećer',
  patty: 'Pogača',
  honey: 'Med',
  pollen_substitute: 'Zamjena za pelud',
  other: 'Ostalo',
}

/**
 * §12 — prihrana, one of the entries a worker makes in the field.
 *
 * Goes through the offline outbox like inspections do: feeding happens at the apiary, often in the
 * same dead spot, and it is an append-only record with a client-generated id.
 */
export function FeedingPage() {
  const { showSuccess, showError } = useToast()
  const { enqueue, pending, online } = useOutbox()
  const { data, error, loading, reload } = useResource<{ feedings: Feeding[] }>('/feedings')
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  const [adding, setAdding] = useState(false)
  const [apiaryId, setApiaryId] = useState('')
  const [hiveId, setHiveId] = useState('')
  const [fedOn, setFedOn] = useState(todayIso())
  const [feedType, setFeedType] = useState<FeedType>('syrup')
  const [amountKg, setAmountKg] = useState('')
  const [concentration, setConcentration] = useState('1:1')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: hiveData } = useResource<{ hives: Hive[] }>(apiaryId ? `/hives?apiaryId=${apiaryId}` : null)

  const apiaries = apiaryData?.apiaries ?? []
  const effectiveApiary = apiaryId || (apiaries.length === 1 ? apiaries[0]!.id : '')
  const queued = pending.filter((item) => item.kind === 'feeding')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!effectiveApiary) {
      showError('Odaberite pčelinjak')
      return
    }
    setSaving(true)
    const apiaryName = apiaries.find((a) => a.id === effectiveApiary)?.name ?? 'pčelinjak'
    try {
      await enqueue({
        id: crypto.randomUUID(),
        kind: 'feeding',
        path: '/feedings',
        label: `Prihrana ${apiaryName}`,
        payload: {
          id: crypto.randomUUID(),
          apiaryId: effectiveApiary,
          hiveId: hiveId || null,
          fedOn,
          feedType,
          amountKg: amountKg === '' ? null : Number(amountKg),
          concentration: feedType === 'syrup' ? concentration.trim() || null : null,
          notes: notes.trim() || null,
        },
      })
      showSuccess(online ? 'Prihrana je zabilježena' : 'Spremljeno na uređaj — poslat će se kad se vrati signal')
      setAdding(false)
      setAmountKg('')
      setNotes('')
      await reload()
    } catch {
      showError('Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const feedings = data?.feedings ?? []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/unos" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Prihrana</h1>
      </div>

      {!adding && (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Nova prihrana
        </Button>
      )}

      {queued.length > 0 && (
        <Card className="border-caution/50">
          <CardContent className="flex items-center gap-2 py-3 text-sm">
            <CloudOff className="size-4 shrink-0 text-caution" aria-hidden />
            {queued.length} {queued.length === 1 ? 'zapis čeka' : 'zapisa čeka'} slanje
          </CardContent>
        </Card>
      )}

      {adding && (
        <form onSubmit={submit} noValidate>
          <Card>
            <CardContent className="space-y-4 pt-4">
              {apiaries.length > 1 && (
                <Field label="Pčelinjak">
                  {(p) => (
                    <Select
                      {...p}
                      value={effectiveApiary}
                      onChange={(e) => {
                        setApiaryId(e.target.value)
                        setHiveId('')
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

              <Field label="Košnica" optional hint="Prazno = cijeli pčelinjak">
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

              <ChoiceGroup
                label="Vrsta hrane"
                options={FEED_TYPES}
                value={feedType}
                clearable={false}
                onChange={(v) => v && setFeedType(v)}
              />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Količina (kg)" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min={0}
                      value={amountKg}
                      onChange={(e) => setAmountKg(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Datum">
                  {(p) => <Input {...p} type="date" value={fedOn} onChange={(e) => setFedOn(e.target.value)} />}
                </Field>
              </div>

              {feedType === 'syrup' && (
                <Field label="Omjer" optional hint="1:1 ljeti, 3:2 za zimu">
                  {(p) => <Input {...p} value={concentration} onChange={(e) => setConcentration(e.target.value)} />}
                </Field>
              )}

              <Field label="Napomena" optional>
                {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                  Odustani
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {feedings.length === 0 && !adding ? (
        <EmptyState icon={Droplet} title="Još nema zapisa o prihrani" />
      ) : (
        feedings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Povijest</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {feedings.map((f) => (
                  <li key={f.id} className="flex items-baseline justify-between gap-2 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="font-medium">{FEED_LABEL[f.feedType]}</span>
                      {f.amountKg !== null && <span className="tabular"> · {formatNumber(f.amountKg)} kg</span>}
                      {f.concentration && <span className="text-muted-foreground"> · {f.concentration}</span>}
                      <span className="block text-xs text-muted-foreground">
                        {f.apiaryName}
                        {f.hiveCode ? ` · ${f.hiveCode}` : ''}
                        {f.by ? ` · ${f.by}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(f.fedOn)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      )}
    </div>
  )
}
