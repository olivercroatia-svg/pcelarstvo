import { ArrowLeft, FileCheck2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { CheckRow } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { Relocation } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { RELOCATION_STATUS } from '@/lib/labels'

interface DocumentOption {
  id: string
  title: string
  category: string
}

/**
 * §21 — one relocation and its checklist.
 *
 * The checklist comes from the server and is recomputed on every read, so a consent that expires
 * turns its own tick back into a warning. Nothing here stores a "done" flag for those five rows.
 */
export function RelocationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const [addingConsent, setAddingConsent] = useState(false)

  const { data, error, loading, reload } = useResource<{ relocation: Relocation }>(`/relocations/${id}`)
  const { data: documentData } = useResource<{ documents: DocumentOption[] }>('/documents')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const r = data.relocation

  async function patch(body: Record<string, unknown>, message?: string) {
    try {
      await api(`/relocations/${id}`, { method: 'PATCH', body })
      if (message) showSuccess(message)
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  async function removeConsent(consentId: string, grantedBy: string) {
    const ok = await confirm({
      title: 'Uklanjanje suglasnosti',
      description: `Suglasnost koju je dao ${grantedBy} briše se s ove selidbe.`,
      confirmLabel: 'Ukloni',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/relocations/permissions/${consentId}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Uklanjanje nije uspjelo')
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Brisanje selidbe',
      description: `${r.toLocation} · ${formatDate(r.plannedOn)}`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/relocations/${id}`, { method: 'DELETE' })
      showSuccess('Selidba je obrisana')
      navigate('/selidbe', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/selidbe" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{r.toLocation}</h1>
      </div>

      <Card>
        <CardContent className="py-3">
          <dl className="space-y-1.5 text-sm">
            <Row label="Pčelinjak" value={r.apiaryName} />
            <Row label="Od" value={r.fromLocation} />
            <Row label="Datum" value={formatDate(r.plannedOn)} />
            {r.completedOn && <Row label="Obavljeno" value={formatDate(r.completedOn)} />}
            <Row label="Zajednica" value={r.coloniesCount === null ? null : String(r.coloniesCount)} />
            <Row label="Paša" value={r.pasture} />
            <Row label="Status" value={RELOCATION_STATUS[r.status] ?? r.status} />
          </dl>
        </CardContent>
      </Card>

      <Card className={r.ready ? 'border-ok/40' : 'border-caution/40'}>
        <CardHeader>
          <CardTitle className="text-base">Checklista</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {r.checks.map((c) => (
              <CheckRow key={c.key} label={c.label} ok={c.ok} detail={c.detail} />
            ))}
          </ul>
          <p className={r.ready ? 'mt-2 text-sm font-medium text-ok' : 'mt-2 text-sm text-caution'}>
            {r.ready ? 'Sve je spremno za selidbu.' : 'Nedostaju stavke označene upozorenjem.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Suglasnosti za smještaj</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {r.permissions.length === 0 && !addingConsent && (
            <p className="text-sm text-muted-foreground">
              Nema unesene suglasnosti. Dokument se prvo učita u Dokumente, pa se ovdje poveže.
            </p>
          )}

          {r.permissions.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.grantedBy}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.referenceNumber,
                    p.validUntil ? `vrijedi do ${formatDate(p.validUntil)}` : null,
                    p.documentTitle,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {p.expired && <p className="text-xs font-medium text-caution">Suglasnost je istekla</p>}
              </div>
              <button
                type="button"
                onClick={() => removeConsent(p.id, p.grantedBy)}
                aria-label={`Ukloni suglasnost ${p.grantedBy}`}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}

          {addingConsent ? (
            <ConsentForm
              migrationId={r.id}
              documents={documentData?.documents ?? []}
              onDone={async () => {
                setAddingConsent(false)
                await reload()
              }}
              onCancel={() => setAddingConsent(false)}
            />
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setAddingConsent(true)}>
              <Plus />
              Dodaj suglasnost
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Povjerenik i prijevoz</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ContactForm relocation={r} onSave={patch} />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={r.transportArranged}
              onChange={(e) => patch({ transportArranged: e.target.checked })}
              className="size-5 rounded border-input accent-primary"
            />
            Prijevoz je organiziran
          </label>
        </CardContent>
      </Card>

      {r.status === 'planned' && (
        <Button size="lg" className="w-full" onClick={() => patch({ status: 'done' }, 'Selidba je označena obavljenom')}>
          <FileCheck2 />
          Označi kao obavljeno
        </Button>
      )}

      <Button variant="outline" className="w-full text-destructive" onClick={remove}>
        <Trash2 />
        Obriši selidbu
      </Button>
    </div>
  )
}

function ContactForm({
  relocation,
  onSave,
}: {
  relocation: Relocation
  onSave: (body: Record<string, unknown>, message?: string) => Promise<void>
}) {
  const [commissioner, setCommissioner] = useState(relocation.commissioner ?? '')
  const [phone, setPhone] = useState(relocation.commissionerPhone ?? '')
  const dirty = commissioner !== (relocation.commissioner ?? '') || phone !== (relocation.commissionerPhone ?? '')

  return (
    <div className="space-y-3">
      <Field label="Povjerenik za pčelarstvo" optional>
        {(p) => <Input {...p} value={commissioner} onChange={(e) => setCommissioner(e.target.value)} />}
      </Field>
      <Field label="Telefon povjerenika" optional>
        {(p) => <Input {...p} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      </Field>
      {dirty && (
        <Button
          variant="outline"
          className="w-full"
          onClick={() =>
            onSave(
              { commissioner: commissioner.trim() || null, commissionerPhone: phone.trim() || null },
              'Kontakt je spremljen',
            )
          }
        >
          Spremi kontakt
        </Button>
      )}
    </div>
  )
}

function ConsentForm({
  migrationId,
  documents,
  onDone,
  onCancel,
}: {
  migrationId: string
  documents: DocumentOption[]
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [grantedBy, setGrantedBy] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (grantedBy.trim().length < 2) return setFieldErrors({ grantedBy: 'Unesite tko je dao suglasnost' })

    setSaving(true)
    try {
      await api('/relocations/permissions', {
        method: 'POST',
        body: {
          migrationId,
          grantedBy: grantedBy.trim(),
          referenceNumber: referenceNumber.trim() || null,
          validUntil: validUntil || null,
          documentId: documentId || null,
        },
      })
      showSuccess('Suglasnost je dodana')
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-lg border border-border p-3">
      <Field label="Tko je dao suglasnost" error={fieldErrors.grantedBy}>
        {(p) => (
          <Input
            {...p}
            value={grantedBy}
            onChange={(e) => setGrantedBy(e.target.value)}
            placeholder="Vlasnik zemljišta, općina, šumarija…"
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Klasa / broj" optional>
          {(p) => <Input {...p} value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />}
        </Field>
        <Field label="Vrijedi do" optional>
          {(p) => <Input {...p} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
        </Field>
      </div>
      {documents.length > 0 && (
        <Field label="Dokument iz arhive" optional hint="Fotografiju ili PDF prvo učitajte u Dokumente">
          {(p) => (
            <Select {...p} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">Bez priloženog dokumenta</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? 'Spremam…' : 'Spremi suglasnost'}
        </Button>
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </form>
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
