import { ArrowLeft, Plus, RefreshCw, Scale } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { plural } from '@/lib/format'
import type { ObligationRule } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const APPLIES_LABEL: Record<ObligationRule['appliesTo'], string> = {
  all: 'Svi korisnici',
  registered_epp: 'Upisani u EPP',
  migratory: 'Seleći pčelari',
  honey_producer: 'Proizvođači meda',
  food_business: 'Registrirani objekt za hranu',
}

const SOURCE_LABEL: Record<string, string> = {
  vmp_treatments: 'Tretmani (VMP)',
  varroa_checks: 'Kontrole varoe',
  inspections: 'Pregledi košnica',
  health_events: 'Zdravstveni zapisi',
}

const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac']

interface FormState {
  code: string
  name: string
  legalBasis: string
  description: string
  warningText: string
  kind: 'deadline' | 'continuous'
  windowStartMonth: string
  windowStartDay: string
  dueMonth: string
  dueDay: string
  reminderDays: string
  continuousSource: string
  continuousMaxDays: string
  appliesTo: ObligationRule['appliesTo']
  minColonies: string
  formCode: string
  documentCategory: string
}

const EMPTY: FormState = {
  code: '',
  name: '',
  legalBasis: '',
  description: '',
  warningText: '',
  kind: 'deadline',
  windowStartMonth: '',
  windowStartDay: '',
  dueMonth: '12',
  dueDay: '31',
  reminderDays: '60, 30, 14, 7, 3, 0',
  continuousSource: 'vmp_treatments',
  continuousMaxDays: '365',
  appliesTo: 'all',
  minColonies: '',
  formCode: '',
  documentCategory: '',
}

function toState(rule: ObligationRule): FormState {
  const str = (v: number | null) => (v === null ? '' : String(v))
  return {
    code: rule.code,
    name: rule.name,
    legalBasis: rule.legalBasis ?? '',
    description: rule.description ?? '',
    warningText: rule.warningText ?? '',
    kind: rule.kind,
    windowStartMonth: str(rule.windowStartMonth),
    windowStartDay: str(rule.windowStartDay),
    dueMonth: str(rule.dueMonth),
    dueDay: str(rule.dueDay),
    reminderDays: rule.reminderDays.join(', '),
    continuousSource: rule.continuousSource ?? '',
    continuousMaxDays: str(rule.continuousMaxDays),
    appliesTo: rule.appliesTo,
    minColonies: str(rule.minColonies),
    formCode: rule.formCode ?? '',
    documentCategory: rule.documentCategory ?? '',
  }
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))
const text = (v: string) => (v.trim() === '' ? null : v.trim())

/**
 * §54 — „Administracija propisa".
 *
 * The screen that makes the rest of the obligations module honest: every deadline, reminder step,
 * legal basis and warning line is edited here, as data. A change in Croatian or EU rules is an
 * afternoon in this form, not a release.
 */
export function AdminObligationsPage() {
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const { data, error, loading, reload } = useResource<{ obligations: ObligationRule[] }>('/admin/obligations')

  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const startNew = () => {
    setForm(EMPTY)
    setEditing('new')
    setFieldErrors({})
  }

  const startEdit = (rule: ObligationRule) => {
    setForm(toState(rule))
    setEditing(rule.id)
    setFieldErrors({})
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setSaving(true)

    const isDeadline = form.kind === 'deadline'
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      legalBasis: text(form.legalBasis),
      description: text(form.description),
      warningText: text(form.warningText),
      kind: form.kind,
      appliesTo: form.appliesTo,
      minColonies: num(form.minColonies),
      formCode: text(form.formCode),
      documentCategory: text(form.documentCategory),
      windowStartMonth: isDeadline ? num(form.windowStartMonth) : null,
      windowStartDay: isDeadline ? num(form.windowStartDay) : null,
      dueMonth: isDeadline ? num(form.dueMonth) : null,
      dueDay: isDeadline ? num(form.dueDay) : null,
      reminderDays: isDeadline
        ? form.reminderDays
            .split(',')
            .map((part) => Number(part.trim()))
            .filter((n) => Number.isFinite(n))
        : [],
      continuousSource: isDeadline ? null : form.continuousSource || null,
      continuousMaxDays: isDeadline ? null : num(form.continuousMaxDays),
    }
    // The code identifies the rule for the forms module, so it is set once and never renamed.
    if (editing === 'new') body.code = form.code.trim()

    try {
      await api(editing === 'new' ? '/admin/obligations' : `/admin/obligations/${editing}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body,
      })
      showSuccess(editing === 'new' ? 'Obveza je dodana' : 'Obveza je spremljena')
      setEditing(null)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function deactivate(rule: ObligationRule) {
    const ok = await confirm({
      title: `Povući ${rule.name}?`,
      description: `Obveza nestaje iz popisa korisnika, ali već evidentirane instance (${rule.instanceCount ?? 0}) ostaju u njihovoj povijesti.`,
      confirmLabel: 'Povuci',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/admin/obligations/${rule.id}`, { method: 'DELETE' })
      showSuccess('Obveza je povučena')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  async function runSweep() {
    try {
      const result = await api<{ farms: number }>('/admin/reminders/run', { method: 'POST', body: {} })
      showSuccess(`Podsjetnici obrađeni za ${result.farms} gospodarstava`)
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Radnja nije uspjela')
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const rules = data?.obligations ?? []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/obveze" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Propisi</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Rokovi, podsjetnici i pravni temelji vode se kao podaci. Izmjena ovdje odmah vrijedi za sve
        korisnike, bez izmjene aplikacije.
      </p>

      {!editing && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" className="flex-1" onClick={startNew}>
            <Plus />
            Nova obveza
          </Button>
          <Button variant="outline" size="lg" onClick={runSweep}>
            <RefreshCw />
            Pokreni podsjetnike
          </Button>
        </div>
      )}

      {editing && (
        <form onSubmit={submit} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{editing === 'new' ? 'Nova obveza' : 'Uredi obvezu'}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {editing === 'new' && (
                <Field label="Oznaka (code)" error={fieldErrors.code} hint="mala slova i podvlake, npr. annual_colony_report">
                  {(p) => <Input {...p} value={form.code} onChange={(e) => set('code', e.target.value)} />}
                </Field>
              )}
              <Field label="Naziv" error={fieldErrors.name}>
                {(p) => <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} />}
              </Field>
              <Field label="Pravni temelj" optional>
                {(p) => <Input {...p} value={form.legalBasis} onChange={(e) => set('legalBasis', e.target.value)} />}
              </Field>
              <Field label="Opis" optional>
                {(p) => <Input {...p} value={form.description} onChange={(e) => set('description', e.target.value)} />}
              </Field>
              <Field label="Tekst upozorenja" optional hint="Prikazuje se korisniku i u podsjetniku">
                {(p) => <Input {...p} value={form.warningText} onChange={(e) => set('warningText', e.target.value)} />}
              </Field>

              <Field label="Vrsta">
                {(p) => (
                  <Select {...p} value={form.kind} onChange={(e) => set('kind', e.target.value as FormState['kind'])}>
                    <option value="deadline">Rok (godišnji datum)</option>
                    <option value="continuous">Trajna evidencija</option>
                  </Select>
                )}
              </Field>

              {form.kind === 'deadline' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Rok — mjesec" error={fieldErrors.dueMonth}>
                      {(p) => (
                        <Select {...p} value={form.dueMonth} onChange={(e) => set('dueMonth', e.target.value)}>
                          {MONTHS.map((label, i) => (
                            <option key={label} value={i + 1}>
                              {i + 1}. {label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Rok — dan">
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={31}
                          value={form.dueDay}
                          onChange={(e) => set('dueDay', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Predaja od — mjesec" optional>
                      {(p) => (
                        <Select {...p} value={form.windowStartMonth} onChange={(e) => set('windowStartMonth', e.target.value)}>
                          <option value="">—</option>
                          {MONTHS.map((label, i) => (
                            <option key={label} value={i + 1}>
                              {i + 1}. {label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Predaja od — dan" optional>
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={31}
                          value={form.windowStartDay}
                          onChange={(e) => set('windowStartDay', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="Podsjetnici (dana prije roka)" hint="Odvojeno zarezom; 0 znači na dan roka">
                    {(p) => <Input {...p} value={form.reminderDays} onChange={(e) => set('reminderDays', e.target.value)} />}
                  </Field>
                  <Field label="Oznaka obrasca" optional hint="Povezuje gumb Pripremi s obrascem">
                    {(p) => <Input {...p} value={form.formCode} onChange={(e) => set('formCode', e.target.value)} />}
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Izvor podataka" error={fieldErrors.continuousSource}>
                    {(p) => (
                      <Select {...p} value={form.continuousSource} onChange={(e) => set('continuousSource', e.target.value)}>
                        {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Dopušteni razmak bez unosa (dana)" hint="Nakon toga status pada na upozorenje">
                    {(p) => (
                      <Input
                        {...p}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        value={form.continuousMaxDays}
                        onChange={(e) => set('continuousMaxDays', e.target.value)}
                      />
                    )}
                  </Field>
                </>
              )}

              <Field label="Odnosi se na">
                {(p) => (
                  <Select {...p} value={form.appliesTo} onChange={(e) => set('appliesTo', e.target.value as ObligationRule['appliesTo'])}>
                    {Object.entries(APPLIES_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Najmanji broj zajednica" optional hint="Obveza se prikazuje samo iznad tog broja">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.minColonies}
                    onChange={(e) => set('minColonies', e.target.value)}
                  />
                )}
              </Field>

              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                  Odustani
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {!editing &&
        rules.map((rule) => (
          <Card key={rule.id} className={rule.active ? undefined : 'opacity-60'}>
            <CardContent className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{rule.name}</p>
                  <p className="text-xs text-muted-foreground">{rule.code}</p>
                </div>
                <StatusPill level={rule.active ? 'ok' : 'info'}>{rule.active ? 'aktivno' : 'povučeno'}</StatusPill>
              </div>

              <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {rule.kind === 'deadline' ? (
                  <>
                    <span>
                      rok {rule.dueDay}. {rule.dueMonth}.
                    </span>
                    <span>podsjetnici: {rule.reminderDays.join(', ')}</span>
                  </>
                ) : (
                  <span>
                    {SOURCE_LABEL[rule.continuousSource ?? ''] ?? '—'} · {rule.continuousMaxDays} dana
                  </span>
                )}
                <span>{APPLIES_LABEL[rule.appliesTo]}</span>
                <span>
                  {rule.instanceCount ?? 0}{' '}
                  {plural(rule.instanceCount ?? 0, 'instanca', 'instance', 'instanci')}
                </span>
              </dl>

              {rule.legalBasis && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Scale className="mt-0.5 size-3 shrink-0" aria-hidden />
                  {rule.legalBasis}
                </p>
              )}

              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => startEdit(rule)}>
                  Uredi
                </Button>
                {rule.active && (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deactivate(rule)}>
                    Povuci
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
    </div>
  )
}
