import { ArrowLeft, ClipboardPlus, Crown, QrCode as QrIcon, RotateCcw, Skull } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { hiveScanUrl } from '@/components/QrCode'
import { QrCode } from '@/components/lazy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import type { ColonyPeriod, Hive, Inspection } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const STRENGTH: Record<string, string> = {
  weak: 'Slaba',
  medium: 'Srednja',
  strong: 'Jaka',
  very_strong: 'Vrlo jaka',
}
const BROOD: Record<string, string> = { none: 'Nema', little: 'Malo', normal: 'Normalno', plenty: 'Puno' }
const QUEEN: Record<string, string> = { seen: 'Viđena', eggs: 'Jaja prisutna', not_found: 'Nije pronađena' }
const SWARM: Record<string, string> = { none: 'Nema znakova', cells: 'Matičnjaci', high_risk: 'Visok rizik' }
const STORES: Record<string, string> = { poor: 'Slabe', good: 'Dobre', excellent: 'Odlične' }
const END_REASON: Record<string, string> = {
  winter_loss: 'Zimski gubitak',
  swarmed: 'Rojenje',
  disease: 'Bolest',
  poisoning: 'Trovanje',
  weakened: 'Slabljenje',
  queenless: 'Gubitak matice',
  merged: 'Spojena',
  sold: 'Prodana',
  unknown: 'Nepoznat uzrok',
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}. · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function HiveDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const [showQr, setShowQr] = useState(false)
  const [endReason, setEndReason] = useState('winter_loss')

  const { data, error, loading, reload } = useResource<{
    hive: Hive
    inspections: Inspection[]
    colonies: ColonyPeriod[]
  }>(`/hives/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { hive, inspections, colonies } = data

  async function endColony() {
    const ok = await confirm({
      title: `Zatvoriti zajednicu u košnici ${hive.code}?`,
      description: 'Zapis ulazi u statistiku gubitaka. Povijest pregleda ostaje sačuvana.',
      confirmLabel: 'Zatvori zajednicu',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/hives/${hive.id}/colony/end`, { method: 'POST', body: { endReason } })
      showSuccess('Zajednica je zatvorena')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  async function startColony() {
    try {
      await api(`/hives/${hive.id}/colony/start`, { method: 'POST', body: {} })
      showSuccess('Nova zajednica je otvorena')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">Košnica {hive.code}</h1>
        <button
          type="button"
          onClick={() => setShowQr((v) => !v)}
          aria-label="Prikaži QR kod"
          aria-expanded={showQr}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <QrIcon className="size-5" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        {hive.apiaryName ?? 'Bez pčelinjaka'}
        {hive.hiveType ? ` · ${hive.hiveType}` : ''}
        {hive.colony?.queenCode ? ` · matica ${hive.colony.queenCode}` : ''}
      </p>

      {showQr && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-5">
            <QrCode value={hiveScanUrl(hive.qrToken)} size={180} />
            <p className="text-center text-xs text-muted-foreground">
              Skenirajte kamerom za trenutni pregled ove košnice.
            </p>
            <Link
              to={`/kosnice/naljepnice${hive.apiaryId ? `?pcelinjak=${hive.apiaryId}` : ''}`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Ispiši naljepnice za cijeli pčelinjak
            </Link>
          </CardContent>
        </Card>
      )}

      {hive.colony ? (
        <Link
          to={`/unos/${hive.id}`}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ClipboardPlus className="size-5" />
          Novi pregled
        </Link>
      ) : (
        <Card className="border-caution/50">
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-sm">Ova košnica trenutno nema aktivnu zajednicu.</p>
            <Button variant="outline" onClick={startColony}>
              <RotateCcw />
              Otvori novu zajednicu
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Povijest pregleda</CardTitle>
        </CardHeader>
        <CardContent>
          {inspections.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Još nema pregleda.</p>
          ) : (
            <ul className="space-y-3">
              {inspections.map((i) => (
                <li key={i.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{formatDateTime(i.inspectedAt)}</span>
                    {i.isBatch && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        skupni unos
                      </span>
                    )}
                  </div>
                  <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {i.strength && <span>{STRENGTH[i.strength]}</span>}
                    {i.framesBees !== null && <span>{i.framesBees} okvira pčela</span>}
                    {i.brood && <span>leglo: {BROOD[i.brood]}</span>}
                    {i.queenState && <span>matica: {QUEEN[i.queenState]}</span>}
                    {i.swarming && i.swarming !== 'none' && (
                      <span className="font-medium text-caution">
                        {SWARM[i.swarming]}
                        {i.queenCells ? ` (${i.queenCells})` : ''}
                      </span>
                    )}
                    {i.stores && <span>zalihe: {STORES[i.stores]}</span>}
                  </dl>
                  {i.notes && <p className="mt-1 text-sm">{i.notes}</p>}
                  {i.by && <p className="mt-0.5 text-xs text-muted-foreground">{i.by}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zajednice</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {colonies.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                <Crown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  {c.startedOn} {c.endedOn ? `– ${c.endedOn}` : '– danas'}
                  {c.queenCode ? ` · matica ${c.queenCode}` : ''}
                  {c.endReason && (
                    <span className="block text-xs text-muted-foreground">{END_REASON[c.endReason]}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {hive.colony && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">Zatvori zajednicu</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="Uzrok" hint="Ulazi u godišnju statistiku gubitaka">
              {(p) => (
                <Select {...p} value={endReason} onChange={(e) => setEndReason(e.target.value)}>
                  {Object.entries(END_REASON).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="outline" className="w-full text-destructive" onClick={endColony}>
              <Skull />
              Zatvori zajednicu
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
