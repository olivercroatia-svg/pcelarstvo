import { ArrowLeft, Save } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { plural } from '@/lib/format'
import type { LabParameter } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface AdminParameter extends LabParameter {
  id: string
  readingCount: number
}

interface DeclarationText {
  id: string
  code: string
  label: string
  body: string
  hint: string | null
}

/**
 * §54 applied to §31 and §34 — the laboratory limits and the declaration's regulatory text, as
 * data an administrator edits rather than constants in a release.
 *
 * The two behave differently on purpose and the screen says so: changing a laboratory limit
 * re-judges findings that are already recorded, because the verdict is computed when the card is
 * opened. Changing a declaration text only affects labels printed afterwards.
 */
export function AdminProductionPage() {
  const { showSuccess, showError } = useToast()
  const params = useResource<{ parameters: AdminParameter[] }>('/admin/lab-parameters')
  const texts = useResource<{ texts: DeclarationText[] }>('/admin/declaration-texts')

  if (params.loading || texts.loading) return <LoadingState />
  if (params.error) return <ErrorState message={params.error} />
  if (texts.error) return <ErrorState message={texts.error} />

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Proizvodnja — propisi</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Laboratorijski kriteriji (§31)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Granice se primjenjuju pri svakom otvaranju nalaza, pa izmjena ovdje mijenja ocjenu i
            već unesenih rezultata.
          </p>
          {(params.data?.parameters ?? []).map((p) => (
            <ParameterRow
              key={p.id}
              parameter={p}
              onSaved={async () => {
                showSuccess('Kriterij je spremljen')
                await params.reload()
              }}
              onError={(message) => showError(message)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tekst deklaracije (§34)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ispisuje se na etiketama izrađenim nakon spremanja. Već otisnute etikete se ne mijenjaju.
          </p>
          {(texts.data?.texts ?? []).map((t) => (
            <TextRow
              key={t.id}
              text={t}
              onSaved={async () => {
                showSuccess('Tekst je spremljen')
                await texts.reload()
              }}
              onError={(message) => showError(message)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function ParameterRow({
  parameter,
  onSaved,
  onError,
}: {
  parameter: AdminParameter
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [min, setMin] = useState(parameter.minValue === null ? '' : String(parameter.minValue))
  const [max, setMax] = useState(parameter.maxValue === null ? '' : String(parameter.maxValue))
  const [note, setNote] = useState(parameter.note ?? '')
  const [saving, setSaving] = useState(false)

  const dirty =
    min !== (parameter.minValue === null ? '' : String(parameter.minValue)) ||
    max !== (parameter.maxValue === null ? '' : String(parameter.maxValue)) ||
    note !== (parameter.note ?? '')

  async function save() {
    setSaving(true)
    try {
      await api(`/admin/lab-parameters/${parameter.id}`, {
        method: 'PATCH',
        body: {
          minValue: min === '' ? null : Number(min),
          maxValue: max === '' ? null : Number(max),
          note: note.trim() || null,
        },
      })
      await onSaved()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">
          {parameter.name}
          {parameter.unit && <span className="ml-1 text-sm text-muted-foreground">({parameter.unit})</span>}
        </p>
        <span className="text-xs text-muted-foreground">
          {parameter.readingCount} {plural(parameter.readingCount, 'nalaz', 'nalaza', 'nalaza')}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Najmanje" optional>
          {(p) => <Input {...p} type="number" step="any" value={min} onChange={(e) => setMin(e.target.value)} />}
        </Field>
        <Field label="Najviše" optional>
          {(p) => <Input {...p} type="number" step="any" value={max} onChange={(e) => setMax(e.target.value)} />}
        </Field>
      </div>
      <Field label="Napomena uz parametar" optional hint="Prikazuje se pčelaru uz ocjenu">
        {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      {dirty && (
        <Button size="sm" onClick={save} disabled={saving}>
          <Save />
          {saving ? 'Spremam…' : 'Spremi'}
        </Button>
      )}
    </div>
  )
}

function TextRow({
  text,
  onSaved,
  onError,
}: {
  text: DeclarationText
  onSaved: () => Promise<void>
  onError: (message: string) => void
}) {
  const [body, setBody] = useState(text.body)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api(`/admin/declaration-texts/${text.id}`, { method: 'PATCH', body: { body } })
      await onSaved()
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <label htmlFor={`text-${text.id}`} className="block text-sm font-medium">
        {text.label}
      </label>
      <textarea
        id={`text-${text.id}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-input bg-card px-3 py-2 text-base"
      />
      {text.hint && <p className="text-xs text-muted-foreground">{text.hint}</p>}
      {body !== text.body && (
        <Button size="sm" onClick={save} disabled={saving}>
          <Save />
          {saving ? 'Spremam…' : 'Spremi'}
        </Button>
      )}
    </div>
  )
}
