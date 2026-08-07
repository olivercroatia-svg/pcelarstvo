import { ArrowLeft, Check, ExternalLink, Paperclip, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatEur } from '@/lib/format'
import type { SubsidyProgram } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { SUBSIDY_STATUS_LABELS } from '@/lib/labels'
import { useState } from 'react'

interface Response {
  program: SubsidyProgram
  documents: { id: string; title: string; category: string; issuedOn: string | null }[]
}

/**
 * §50 — one call for applications: what it asks for, and how much of that is already filed.
 *
 * The percentage is attached-required over required. Every row is a document from the §22 archive,
 * so nothing is uploaded twice and a receipt attached here is the same file the inspector sees.
 */
export function SubsidyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<Response>(`/subsidies/${id}`)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { program, documents } = data
  const app = program.application

  async function startTracking() {
    try {
      await api(`/subsidies/${id}/apply`, { method: 'POST', body: {} })
      showSuccess('Natječaj je dodan u praćenje')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Nije uspjelo')
    }
  }

  async function attach(requirementId: string, documentId: string) {
    if (!app) return
    try {
      if (documentId) {
        await api(`/subsidies/applications/${app.id}/documents/${requirementId}`, {
          method: 'PUT',
          body: { documentId },
        })
      } else {
        await api(`/subsidies/applications/${app.id}/documents/${requirementId}`, { method: 'DELETE' })
      }
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/potpore" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">{program.name}</h1>
      </div>

      <Card>
        <CardContent className="space-y-2 py-3">
          <dl className="space-y-1.5 text-sm">
            <Row label="Nositelj" value={program.authority} />
            <Row label="Godina" value={program.year === null ? null : `${program.year}.`} />
            <Row label="Otvoren" value={program.opensOn ? formatDate(program.opensOn) : null} />
            <Row label="Rok" value={program.closesOn ? formatDate(program.closesOn) : null} />
          </dl>
          {program.description && <p className="text-sm text-muted-foreground">{program.description}</p>}
          {program.url && (
            <a
              href={program.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="size-4" />
              Tekst natječaja
            </a>
          )}
          {program.closed && (
            <p className="rounded-lg bg-caution/10 p-2.5 text-sm text-caution">
              Rok za prijavu je prošao.
            </p>
          )}
        </CardContent>
      </Card>

      {!app ? (
        <>
          <p className="text-sm text-muted-foreground">
            {program.eligible
              ? 'Prema podacima gospodarstva ovaj natječaj vam potencijalno odgovara.'
              : 'Prema podacima gospodarstva ovaj natječaj vjerojatno nije za vas — provjerite uvjete u tekstu natječaja.'}
          </p>
          <Button size="lg" className="w-full" onClick={startTracking}>
            Prati ovaj natječaj
          </Button>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Dokumentacija
                {program.documentPercent !== null && (
                  <span className="tabular ml-2 font-normal text-muted-foreground">
                    {program.documentPercent} %
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {program.requirements.length === 0 && (
                <p className="text-sm text-muted-foreground">Za ovaj natječaj nije popisana dokumentacija.</p>
              )}
              {program.requirements.map((req) => (
                <div key={req.id} className="space-y-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    {req.documentId ? (
                      <Check className="size-4 shrink-0 text-ok" aria-hidden />
                    ) : (
                      <X className="size-4 shrink-0 text-caution" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 text-sm font-medium">{req.label}</span>
                    {!req.required && <span className="text-xs text-muted-foreground">nije obavezno</span>}
                  </div>
                  <Select
                    value={req.documentId ?? ''}
                    onChange={(e) => attach(req.id, e.target.value)}
                    aria-label={`Dokument za: ${req.label}`}
                  >
                    <option value="">Nije priloženo</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
              <Link
                to="/dokumenti"
                className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                <Paperclip className="size-4" />
                Učitaj novi dokument u arhivu
              </Link>
            </CardContent>
          </Card>

          <ApplicationForm program={program} onSaved={reload} />
        </>
      )}

      <p className="rounded-lg bg-info/10 p-3 text-xs text-info">
        Postotak pokazuje koliko je popisanih dokumenata priloženo, ne vjerojatnost odobrenja.
        Aplikacija ne jamči pravo na potporu.
      </p>
    </div>
  )
}

function ApplicationForm({ program, onSaved }: { program: SubsidyProgram; onSaved: () => Promise<void> }) {
  const app = program.application!
  const { showSuccess, showError } = useToast()
  const [status, setStatus] = useState(app.status)
  const [amountRequested, setAmountRequested] = useState(
    app.amountRequested === null ? '' : String(app.amountRequested),
  )
  const [amountApproved, setAmountApproved] = useState(
    app.amountApproved === null ? '' : String(app.amountApproved),
  )
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api(`/subsidies/applications/${app.id}`, {
        method: 'PATCH',
        body: {
          status,
          amountRequested: amountRequested === '' ? null : Number(amountRequested),
          amountApproved: amountApproved === '' ? null : Number(amountApproved),
        },
      })
      showSuccess('Spremljeno')
      await onSaved()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prijava</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Status">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              {Object.entries(SUBSIDY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Traženo (€)" optional>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amountRequested}
                onChange={(e) => setAmountRequested(e.target.value)}
              />
            )}
          </Field>
          <Field label="Odobreno (€)" optional>
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amountApproved}
                onChange={(e) => setAmountApproved(e.target.value)}
              />
            )}
          </Field>
        </div>
        {app.submittedOn && (
          <p className="text-xs text-muted-foreground">Predano {formatDate(app.submittedOn)}.</p>
        )}
        {app.amountApproved !== null && (
          <p className="text-sm font-medium text-ok">Odobreno {formatEur(app.amountApproved)}.</p>
        )}
        <Button className="w-full" onClick={save} disabled={saving}>
          {saving ? 'Spremam…' : 'Spremi prijavu'}
        </Button>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value ?? '—'}</dd>
    </div>
  )
}
