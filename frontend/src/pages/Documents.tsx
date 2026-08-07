import { ArrowLeft, FileText, FolderOpen, Paperclip, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { daysUntil, formatDate } from '@/lib/format'
import { DOCUMENT_CATEGORY_LABELS } from '@/lib/labels'
import type { ArchivedDocument, DocumentCategory } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/** §22 — the categories the scenario lists, in its order. */
const CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABELS) as DocumentCategory[]

const EMPTY = {
  category: 'registration' as DocumentCategory,
  title: '',
  referenceNumber: '',
  issuer: '',
  issuedOn: '',
  expiresOn: '',
  description: '',
}

export function DocumentsPage() {
  const [params, setParams] = useSearchParams()
  const category = (params.get('kategorija') as DocumentCategory | null) ?? null
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const { isOwner } = useAuth()

  const { data, error, loading, reload } = useResource<{
    documents: ArchivedDocument[]
    countsByCategory: Record<string, number>
  }>(`/documents${category ? `?category=${category}` : ''}`)

  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const set = (key: keyof typeof EMPTY, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (form.title.trim().length < 2) {
      setFieldErrors({ title: 'Unesite naziv dokumenta' })
      return
    }

    setSaving(true)
    try {
      // multipart, not JSON: the file rides along with the metadata in one request, and the
      // shared api() helper only speaks JSON.
      const body = new FormData()
      body.append('category', form.category)
      body.append('title', form.title.trim())
      for (const key of ['referenceNumber', 'issuer', 'issuedOn', 'expiresOn', 'description'] as const) {
        if (form[key].trim()) body.append(key, form[key].trim())
      }
      if (file) body.append('file', file)

      const response = await fetch(`${import.meta.env.BASE_URL}api/documents`, {
        method: 'POST',
        credentials: 'same-origin',
        body,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new ApiError(response.status, payload?.error ?? 'Spremanje nije uspjelo', payload?.fields)
      }

      showSuccess('Dokument je spremljen')
      setForm(EMPTY)
      setFile(null)
      setAdding(false)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function remove(doc: ArchivedDocument) {
    const ok = await confirm({
      title: `Obrisati ${doc.title}?`,
      description: 'Dokument se uklanja iz arhive. Zapis ostaje u zapisniku izmjena.',
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' })
      showSuccess('Dokument je obrisan')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const documents = data?.documents ?? []
  const counts = data?.countsByCategory ?? {}

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Dokumenti</h1>
      </div>

      {!adding && (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Dodaj dokument
        </Button>
      )}

      {adding && (
        <form onSubmit={submit} noValidate>
          <Card>
            <CardContent className="space-y-4 pt-4">
              <Field label="Kategorija">
                {(p) => (
                  <Select {...p} value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORIES.map((key) => (
                      <option key={key} value={key}>
                        {DOCUMENT_CATEGORY_LABELS[key]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Naziv" error={fieldErrors.title}>
                {(p) => (
                  <Input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} autoFocus placeholder="Rješenje o upisu u EPP" />
                )}
              </Field>
              <Field label="Klasa / broj" optional>
                {(p) => <Input {...p} value={form.referenceNumber} onChange={(e) => set('referenceNumber', e.target.value)} />}
              </Field>
              <Field label="Izdavatelj" optional>
                {(p) => <Input {...p} value={form.issuer} onChange={(e) => set('issuer', e.target.value)} />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Izdano" optional>
                  {(p) => <Input {...p} type="date" value={form.issuedOn} onChange={(e) => set('issuedOn', e.target.value)} />}
                </Field>
                <Field label="Vrijedi do" optional>
                  {(p) => <Input {...p} type="date" value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />}
                </Field>
              </div>
              <Field label="Datoteka" optional hint="PDF ili fotografija, do 10 MB">
                {(p) => (
                  <input
                    {...p}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-input file:bg-card file:px-4 file:text-sm"
                  />
                )}
              </Field>
              <Field label="Napomena" optional>
                {(p) => <Input {...p} value={form.description} onChange={(e) => set('description', e.target.value)} />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setAdding(false); setForm(EMPTY); setFile(null) }}>
                  Odustani
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setParams({})}
          className={cn(
            'min-h-11 shrink-0 rounded-full border px-4 text-xs font-medium',
            !category ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
          )}
        >
          Sve
        </button>
        {CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setParams({ kategorija: key })}
            // Spelled out, because the count sits right against the label and a screen reader
            // would otherwise announce the chip as "Registracija2".
            aria-label={
              counts[key]
                ? `${DOCUMENT_CATEGORY_LABELS[key]}, ${counts[key]}`
                : DOCUMENT_CATEGORY_LABELS[key]
            }
            className={cn(
              'min-h-11 shrink-0 rounded-full border px-4 text-xs font-medium',
              category === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
            )}
          >
            {DOCUMENT_CATEGORY_LABELS[key]}
            {counts[key] ? <span className="tabular ml-1 opacity-70">{counts[key]}</span> : null}
          </button>
        ))}
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={
            category
              ? `Nema dokumenata u kategoriji ${DOCUMENT_CATEGORY_LABELS[category]}`
              : 'Arhiva je prazna'
          }
          description="Zapis bez priložene datoteke je i dalje koristan — broj i datum rješenja često su sve što treba."
        />
      ) : (
        documents.map((doc) => {
          const expiringSoon = doc.expiresOn && !doc.expired && daysUntil(doc.expiresOn) <= 60
          return (
            <Card key={doc.id}>
              <CardContent className="flex items-start gap-2 py-3">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {DOCUMENT_CATEGORY_LABELS[doc.category]}
                    {doc.referenceNumber ? ` · ${doc.referenceNumber}` : ''}
                    {doc.issuedOn ? ` · ${formatDate(doc.issuedOn)}` : ''}
                  </p>
                  {doc.expiresOn && (
                    <div className="mt-1">
                      <StatusPill level={doc.expired ? 'critical' : expiringSoon ? 'caution' : 'ok'}>
                        {doc.expired ? 'isteklo' : `vrijedi do ${formatDate(doc.expiresOn)}`}
                      </StatusPill>
                    </div>
                  )}
                  {doc.hasFile && (
                    <a
                      href={`${import.meta.env.BASE_URL}api/documents/${doc.id}/file`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <Paperclip className="size-3.5" aria-hidden />
                      Otvori datoteku
                    </a>
                  )}
                </div>
                {isOwner && (
                  <button
                    type="button"
                    aria-label={`Obriši ${doc.title}`}
                    onClick={() => remove(doc)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      {/* §56 — worth stating on the screen that holds scans of documents carrying an OIB. */}
      <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
        Dokumenti se poslužuju samo prijavljenim korisnicima vašeg gospodarstva i nikada nisu javno
        dostupni preko poveznice.
      </p>
    </div>
  )
}
