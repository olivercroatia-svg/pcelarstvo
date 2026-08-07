import { ArrowLeft, Lock } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Disclaimer } from '@/components/ui/disclaimer'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatDateTime } from '@/lib/format'
import type { Treatment } from '@/lib/types'
import { useResource } from '@/lib/useResource'

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{value ?? '—'}</dd>
    </div>
  )
}

export function TreatmentDetailPage() {
  const { id } = useParams()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { isOwner } = useAuth()
  const { data, error, loading, reload } = useResource<{ treatment: Treatment }>(`/treatments/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const t = data.treatment

  async function lock() {
    const ok = await confirm({
      title: 'Zaključati evidenciju?',
      description:
        'Zaključani zapis se više ne može mijenjati. Ispravak se od tada vodi kao nova stavka u zapisniku izmjena. Ovo je namjerno nepovratno.',
      confirmLabel: 'Zaključaj',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/treatments/${t.id}/lock`, { method: 'POST', body: {} })
      showSuccess('Evidencija je zaključana')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/tretmani" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{t.productName}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {t.withdrawalActive && <StatusPill level="warning">Karenca do {formatDate(t.withdrawalUntil)}</StatusPill>}
        {t.lockedAt && <StatusPill level="info">Zaključano {formatDateTime(t.lockedAt)}</StatusPill>}
        {!t.lotNumber && <StatusPill level="caution">Nedostaje LOT broj</StatusPill>}
      </div>

      {t.withdrawalActive && (
        <Card className="border-caution/50">
          <CardContent className="py-3 text-sm">
            Med iz ovog pčelinjaka <strong>ne smije se vrcati</strong> do{' '}
            {formatDate(t.withdrawalUntil)}.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proizvod</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Naziv" value={t.productName} />
            <Row label="Aktivna tvar" value={t.activeSubstance} />
            <Row label="Proizvođač" value={t.manufacturer} />
            <Row label="LOT" value={t.lotNumber} />
            <Row label="Rok trajanja" value={t.productExpiresOn ? formatDate(t.productExpiresOn) : null} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Primjena</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label="Pčelinjak" value={t.apiaryName} />
            <Row label="Početak" value={formatDate(t.startedOn)} />
            <Row label="Završetak" value={t.endedOn ? formatDate(t.endedOn) : 'u tijeku'} />
            <Row label="Doza" value={t.dose} />
            <Row label="Način primjene" value={t.applicationMethod} />
            <Row label="Razlog" value={t.reason} />
            <Row label="Karenca" value={t.withdrawalDays === null ? 'ne primjenjuje se' : `${t.withdrawalDays} dana`} />
            <Row label="Karenca do" value={t.withdrawalUntil ? formatDate(t.withdrawalUntil) : null} />
            <Row label="Broj zajednica" value={t.coloniesTreated === null ? null : String(t.coloniesTreated)} />
            <Row label="Evidentirao" value={t.by} />
          </dl>
        </CardContent>
      </Card>

      {t.hives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Košnice ({t.hives.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {t.hives.map((code) => (
                <span key={code} className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                  {code}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {t.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Napomena</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{t.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* §17 — locking is the owner's call, and deliberately one-way. */}
      {isOwner && !t.lockedAt && (
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="text-sm text-muted-foreground">
              Zaključavanjem zapis postaje nepromjenjiv i spreman za predočavanje nadležnoj osobi.
            </p>
            <Button variant="outline" className="w-full" onClick={lock}>
              <Lock />
              Zaključaj evidenciju
            </Button>
          </CardContent>
        </Card>
      )}

      <Disclaimer />
    </div>
  )
}
