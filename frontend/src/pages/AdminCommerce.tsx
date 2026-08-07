import { ArrowLeft, Plus, Settings2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, MONTHS } from '@/lib/format'
import { useResource } from '@/lib/useResource'

/**
 * §54 applied to Etapa 4: the seasonal calendar (§19) and the subsidy programmes (§50).
 *
 * Both are data, not code, for the same reason the legal deadlines are. A ministry announcing a
 * new call, or a regional beekeeping association correcting when the sage flowers, must not need a
 * release. The server enforces the administrator check; this screen only hides the link.
 */

const REGIONS = [
  { value: 'all', label: 'Sve regije' },
  { value: 'continental', label: 'Kontinentalna' },
  { value: 'coastal', label: 'Priobalje' },
  { value: 'mountain', label: 'Gorska' },
]

const KINDS = [
  { value: 'all', label: 'Svi' },
  { value: 'stationary', label: 'Stacionarni' },
  { value: 'migratory', label: 'Seleći' },
]

const APPLIES = [
  { value: 'all', label: 'Svi korisnici' },
  { value: 'registered_epp', label: 'Upisani u EPP' },
  { value: 'migratory', label: 'Seleći pčelari' },
  { value: 'honey_producer', label: 'Proizvođači meda' },
  { value: 'food_business', label: 'Registrirani objekt za hranu' },
]

interface SeasonTask {
  id: string
  month: number
  title: string
  detail: string | null
  region: string
  apiaryKind: string
  sortOrder: number
  active: boolean
}

interface AdminProgram {
  id: string
  code: string
  name: string
  authority: string | null
  year: number | null
  closesOn: string | null
  appliesTo: string
  active: boolean
  applicationCount: number
  requirements: { id: string; label: string; documentCategory: string | null; required: boolean }[]
}

export function AdminCommercePage() {
  const [tab, setTab] = useState<'season' | 'subsidies'>('season')

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Sezona i potpore</h1>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-info/10 p-3 text-xs text-info">
        <Settings2 className="mt-0.5 size-4 shrink-0" />
        Kalendar i natječaji su podaci, ne kod. Izmjena ovdje odmah vrijedi za sve korisnike i ne
        traži novu verziju aplikacije.
      </p>

      <div className="flex gap-2">
        <TabButton active={tab === 'season'} onClick={() => setTab('season')}>
          Sezonski kalendar
        </TabButton>
        <TabButton active={tab === 'subsidies'} onClick={() => setTab('subsidies')}>
          Natječaji
        </TabButton>
      </div>

      {tab === 'season' ? <SeasonTasks /> : <SubsidyPrograms />}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium ${
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────── §19

function SeasonTasks() {
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [adding, setAdding] = useState(false)
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<{ tasks: SeasonTask[] }>('/admin/season-tasks')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const tasks = (data?.tasks ?? []).filter((t) => t.month === month)

  async function remove(task: SeasonTask) {
    const ok = await confirm({
      title: 'Brisanje posla',
      description: `„${task.title}" nestaje iz kalendara za sve korisnike.`,
      confirmLabel: 'Obriši',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/admin/season-tasks/${task.id}`, { method: 'DELETE' })
      showSuccess('Posao je obrisan')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  async function toggle(task: SeasonTask) {
    try {
      await api(`/admin/season-tasks/${task.id}`, { method: 'PATCH', body: { active: !task.active } })
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  return (
    <div className="space-y-4">
      <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Mjesec">
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </Select>

      {adding ? (
        <SeasonTaskForm
          month={month}
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Novi posao u {MONTHS[month - 1]!.toLowerCase()}
        </Button>
      )}

      <div className="space-y-2">
        {tasks.map((t) => (
          <Card key={t.id} className={t.active ? undefined : 'opacity-60'}>
            <CardContent className="flex items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium">{t.title}</p>
                {t.detail && <p className="text-xs text-muted-foreground">{t.detail}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {REGIONS.find((r) => r.value === t.region)?.label} ·{' '}
                  {KINDS.find((k) => k.value === t.apiaryKind)?.label}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggle(t)}
                  className="min-h-11 rounded-lg px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {t.active ? 'Sakrij' : 'Prikaži'}
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Obriši ${t.title}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
        {tasks.length === 0 && (
          <p className="text-sm text-muted-foreground">Za ovaj mjesec nema unesenih poslova.</p>
        )}
      </div>
    </div>
  )
}

function SeasonTaskForm({
  month,
  onDone,
  onCancel,
}: {
  month: number
  onDone: () => void | Promise<void>
  onCancel: () => void
}) {
  const { showSuccess, showError } = useToast()
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [region, setRegion] = useState('all')
  const [apiaryKind, setApiaryKind] = useState('all')
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/admin/season-tasks', {
        method: 'POST',
        body: { month, title: title.trim(), detail: detail.trim() || null, region, apiaryKind },
      })
      showSuccess('Posao je dodan')
      await onDone()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Posao">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Objašnjenje" optional>
            {(p) => <Input {...p} value={detail} onChange={(e) => setDetail(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Regija">
              {(p) => (
                <Select {...p} value={region} onChange={(e) => setRegion(e.target.value)}>
                  {REGIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Pčelarenje">
              {(p) => (
                <Select {...p} value={apiaryKind} onChange={(e) => setApiaryKind(e.target.value)}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving || title.trim().length < 2}>
              {saving ? 'Spremam…' : 'Spremi'}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Odustani
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────── §50

function SubsidyPrograms() {
  const [adding, setAdding] = useState(false)
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<{ programs: AdminProgram[] }>('/admin/subsidy-programs')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const programs = data?.programs ?? []

  async function addRequirement(programId: string, label: string) {
    try {
      await api(`/admin/subsidy-programs/${programId}/requirements`, { method: 'POST', body: { label } })
      showSuccess('Stavka je dodana')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    }
  }

  async function removeRequirement(id: string) {
    try {
      await api(`/admin/subsidy-requirements/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  return (
    <div className="space-y-4">
      {adding ? (
        <ProgramForm
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Novi natječaj
        </Button>
      )}

      {programs.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nema unesenih natječaja. Dok ih nema, korisnici na ekranu Potpore vide praznu listu — što
          je točnije od izmišljenog popisa.
        </p>
      )}

      {programs.map((p) => (
        <Card key={p.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{p.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {[
                p.authority,
                p.year ? `${p.year}.` : null,
                p.closesOn ? `rok ${formatDate(p.closesOn)}` : null,
                APPLIES.find((a) => a.value === p.appliesTo)?.label,
                `${p.applicationCount} prijava`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>

            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Potrebna dokumentacija
              </p>
              {p.requirements.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{r.label}</span>
                  <button
                    type="button"
                    onClick={() => removeRequirement(r.id)}
                    aria-label={`Ukloni ${r.label}`}
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <RequirementInput onAdd={(label) => addRequirement(p.id, label)} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function RequirementInput({ onAdd }: { onAdd: (label: string) => Promise<void> }) {
  const [label, setLabel] = useState('')
  return (
    <div className="flex gap-2 pt-1">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Račun za vrcaljku"
        aria-label="Nova stavka dokumentacije"
      />
      <Button
        type="button"
        variant="outline"
        disabled={label.trim().length < 2}
        onClick={async () => {
          await onAdd(label.trim())
          setLabel('')
        }}
      >
        <Plus />
      </Button>
    </div>
  )
}

function ProgramForm({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const { showSuccess, showError } = useToast()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [authority, setAuthority] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [closesOn, setClosesOn] = useState('')
  const [appliesTo, setAppliesTo] = useState('all')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    setSaving(true)
    try {
      await api('/admin/subsidy-programs', {
        method: 'POST',
        body: {
          name: name.trim(),
          // Derived from the name when left blank; it only has to be unique and stable.
          code: (code.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 60),
          authority: authority.trim() || null,
          year: year === '' ? null : Number(year),
          closesOn: closesOn || null,
          appliesTo,
          url: url.trim() || null,
        },
      })
      showSuccess('Natječaj je dodan')
      await onDone()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'duplicate_code') {
        setFieldErrors({ code: 'Natječaj s tom oznakom već postoji' })
      }
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Naziv natječaja">
            {(p) => (
              <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Oprema za pčelarstvo" />
            )}
          </Field>
          <Field label="Oznaka" optional error={fieldErrors.code} hint="Ako je ostavite praznu, izvodi se iz naziva">
            {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} />}
          </Field>
          <Field label="Nositelj" optional>
            {(p) => <Input {...p} value={authority} onChange={(e) => setAuthority(e.target.value)} placeholder="APPRRR" />}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Godina" optional>
              {(p) => <Input {...p} type="number" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />}
            </Field>
            <Field label="Rok prijave" optional>
              {(p) => <Input {...p} type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />}
            </Field>
          </div>
          <Field label="Odnosi se na">
            {(p) => (
              <Select {...p} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
                {APPLIES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Poveznica na tekst natječaja" optional>
            {(p) => <Input {...p} type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" className="flex-1" disabled={saving || name.trim().length < 2}>
              {saving ? 'Spremam…' : 'Spremi natječaj'}
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
              Odustani
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
