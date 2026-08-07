import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { AiScan, Unreadable } from '@/components/AiScan'
import type { LabDraft } from '@/lib/ai'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input } from '@/components/ui/field'
import { LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { todayIso } from '@/lib/format'
import type { LabParameter } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * §31 — entering a laboratory finding.
 *
 * The parameter list and its limits come from the server, not from this file. An administrator
 * adding proline to lab_parameters gets a proline field here without a release, which is the same
 * arrangement §54 makes for legal deadlines.
 *
 * The PDF is not read automatically. §31 describes AI extracting these numbers and that arrives in
 * Etapa 5 with the other OCR flows; the note below says so rather than leaving the beekeeper to
 * wonder why nothing happened when they attached the finding.
 */
export function LabTestNewPage() {
  const { id: batchId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const { data, loading } = useResource<{ parameters: LabParameter[] }>('/lab/parameters')
  const [laboratory, setLaboratory] = useState('')
  const [reportNumber, setReportNumber] = useState('')
  const [sampledOn, setSampledOn] = useState('')
  const [testedOn, setTestedOn] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [unreadable, setUnreadable] = useState<string[]>([])

  if (loading) return <LoadingState />
  const parameters = data?.parameters ?? []

  function limitHint(p: LabParameter): string | undefined {
    const unit = p.unit ? ` ${p.unit}` : ''
    if (p.minValue !== null && p.maxValue !== null) return `Kriterij: ${p.minValue}–${p.maxValue}${unit}`
    if (p.maxValue !== null) return `Kriterij: najviše ${p.maxValue}${unit}`
    if (p.minValue !== null) return `Kriterij: najmanje ${p.minValue}${unit}`
    return 'Bez unesenog kriterija — vrijednost se samo bilježi'
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const numeric = Object.fromEntries(
        Object.entries(values)
          .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
          .map(([k, v]) => [k, Number(v)]),
      )
      const result = await api<{ test: { id: string } }>('/lab', {
        method: 'POST',
        body: {
          batchId,
          laboratory: laboratory.trim() || null,
          reportNumber: reportNumber.trim() || null,
          sampledOn: sampledOn || null,
          testedOn: testedOn || null,
          notes: notes.trim() || null,
          values: numeric,
        },
      })
      showSuccess('Nalaz je spremljen')
      navigate(`/nalazi/${result.test.id}`, { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link
          to={`/serije/${batchId}`}
          aria-label="Natrag"
          className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Laboratorijski nalaz</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nalaz</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* §31 — reads the header and the measured values off a photographed finding. It reads
              values ONLY: the pass/fail verdict stays with lib/production.ts and the
              administrator's thresholds, because a model agreeing with a regulatory limit is not
              something this application should ever ship. */}
          <AiScan<LabDraft>
            endpoint="/ai/read/lab"
            label="Fotografiraj nalaz"
            hint="Slikajte nalaz ravno i po punoj širini — vrijednosti se upisuju u polja ispod."
            onDraft={(d) => {
              if (d.laboratory) setLaboratory(d.laboratory)
              if (d.reportNumber) setReportNumber(d.reportNumber)
              if (d.sampledOn) setSampledOn(d.sampledOn)
              if (d.testedOn) setTestedOn(d.testedOn)
              setValues((prev) => {
                const next = { ...prev }
                for (const [code, value] of Object.entries(d.values)) {
                  // Croatian decimal comma: the inputs are text and the rest of the form already
                  // speaks commas, so a dot here would read as a thousands separator.
                  if (value !== null) next[code] = String(value).replace('.', ',')
                }
                return next
              })
              setUnreadable(d.unreadable)
            }}
          >
            <Unreadable fields={unreadable} />
          </AiScan>
          <Field label="Laboratorij" optional>
            {(p) => <Input {...p} value={laboratory} onChange={(e) => setLaboratory(e.target.value)} />}
          </Field>
          <Field label="Broj nalaza" optional>
            {(p) => <Input {...p} value={reportNumber} onChange={(e) => setReportNumber(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Uzorkovano" optional>
              {(p) => <Input {...p} type="date" value={sampledOn} onChange={(e) => setSampledOn(e.target.value)} />}
            </Field>
            <Field label="Analizirano" optional>
              {(p) => <Input {...p} type="date" value={testedOn} onChange={(e) => setTestedOn(e.target.value)} />}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Parametri</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {parameters.map((p) => (
            <Field key={p.code} label={`${p.name}${p.unit ? ` (${p.unit})` : ''}`} optional hint={limitHint(p)}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={values[p.code] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [p.code]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <p className="text-xs text-muted-foreground">
            Automatsko očitavanje PDF nalaza dolazi u kasnijoj fazi. Do tada se vrijednosti upisuju
            ručno, a sam nalaz možete priložiti u Dokumentima.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Disclaimer text="Usporedba s unesenim kriterijima je informativna i ne zamjenjuje službeni laboratorijski nalaz." />

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : 'Spremi nalaz'}
      </Button>
    </form>
  )
}
