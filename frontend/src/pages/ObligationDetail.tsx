import { ArrowLeft, BellRing, FileText, Paperclip, Scale } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { days, formatDate, todayIso } from '@/lib/format'
import type { ArchivedDocument, ObligationCard, ObligationStatus } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const STATUS_LABEL: Record<ObligationStatus, string> = {
  pending: 'Nije predano',
  in_progress: 'U pripremi',
  submitted: 'Predano',
  not_applicable: 'Ne odnosi se na mene',
}

export function ObligationDetailPage() {
  const { id } = useParams()
  const { showSuccess, showError } = useToast()
  const { isOwner } = useAuth()
  const { data, error, loading, reload } = useResource<{ obligation: ObligationCard }>(`/obligations/${id}`)
  const { data: docData } = useResource<{ documents: ArchivedDocument[] }>('/documents')

  const [status, setStatus] = useState<ObligationStatus | ''>('')
  const [submittedOn, setSubmittedOn] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const card = data.obligation
  const currentStatus = status || card.status || 'pending'

  // Arrow const rather than a function declaration: declarations hoist above the `if (!data)`
  // guard, so `card` would still read as possibly undefined inside them.
  const save = async () => {
    setSaving(true)
    try {
      await api(`/obligations/${card.id}`, {
        method: 'PATCH',
        body: {
          status: currentStatus,
          submittedOn: currentStatus === 'submitted' ? submittedOn || todayIso() : null,
          referenceNumber: referenceNumber.trim() || undefined,
          documentId: documentId || undefined,
        },
      })
      showSuccess('Status je spremljen')
      setStatus('')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/obveze" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">{card.name}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill level={card.level}>{card.statusLabel}</StatusPill>
        {card.dueOn && <span className="text-sm text-muted-foreground">Rok: {formatDate(card.dueOn)}</span>}
      </div>

      {card.warningText && (
        <Card className="border-caution/40">
          <CardContent className="py-3 text-sm">{card.warningText}</CardContent>
        </Card>
      )}

      {card.description && <p className="text-sm">{card.description}</p>}

      {/* §25 — the whole point: the beekeeper does not retype what the app already knows. */}
      {card.formCode && (
        <Link
          to={`/obrasci/${card.formCode}${card.periodYear ? `?godina=${card.periodYear}` : ''}`}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground hover:bg-primary/90"
        >
          <FileText className="size-5" />
          Pripremi
        </Link>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalji</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {card.legalBasis && (
            <p className="flex gap-2">
              <Scale className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="block text-xs text-muted-foreground">Pravni temelj</span>
                {card.legalBasis}
              </span>
            </p>
          )}
          {card.windowStart && card.dueOn && (
            <p className="text-muted-foreground">
              Razdoblje predaje: {formatDate(card.windowStart)} – {formatDate(card.dueOn)}
            </p>
          )}
          {card.daysLeft !== null && card.status !== 'submitted' && (
            <p className="text-muted-foreground">
              {card.daysLeft >= 0 ? `Preostalo ${days(card.daysLeft)}` : `Rok je istekao prije ${days(-card.daysLeft)}`}
            </p>
          )}
          {card.kind === 'continuous' && (
            <p className="text-muted-foreground">
              {card.lastEntryOn
                ? `Posljednji unos u evidenciju: ${formatDate(card.lastEntryOn)}`
                : 'U ovoj evidenciji još nema unosa.'}
            </p>
          )}
          {card.submittedOn && <p className="text-muted-foreground">Predano: {formatDate(card.submittedOn)}</p>}
          {card.referenceNumber && <p className="text-muted-foreground">Oznaka: {card.referenceNumber}</p>}
        </CardContent>
      </Card>

      {card.reminderDays.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4" aria-hidden />
              Podsjetnici
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Obavijest stiže {card.reminderDays.filter((d) => d > 0).join(', ')} dana prije roka
              {card.reminderDays.includes(0) ? ' i na dan roka' : ''}.
            </p>
          </CardContent>
        </Card>
      )}

      {card.requiredAttachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="size-4" aria-hidden />
              Obvezni prilozi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {card.requiredAttachments.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* §4 — declaring something filed with an authority is the owner's statement, not a worker's. */}
      {card.kind === 'deadline' && isOwner && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status predaje</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Status">
              {(p) => (
                <Select {...p} value={currentStatus} onChange={(e) => setStatus(e.target.value as ObligationStatus)}>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {currentStatus === 'submitted' && (
              <>
                <Field label="Datum predaje" optional hint="Prazno = danas">
                  {(p) => <Input {...p} type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} />}
                </Field>
                <Field label="Klasa / urudžbeni broj" optional>
                  {(p) => (
                    <Input {...p} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                  )}
                </Field>
                <Field label="Dokaz iz arhive" optional>
                  {(p) => (
                    <Select {...p} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
                      <option value="">Nije priloženo</option>
                      {(docData?.documents ?? []).map((doc) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </>
            )}

            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? 'Spremam…' : 'Spremi status'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Disclaimer />
    </div>
  )
}
