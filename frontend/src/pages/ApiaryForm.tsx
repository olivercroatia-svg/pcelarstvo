import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LocationPicker } from '@/components/lazy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import type { Apiary } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface FormState {
  name: string
  kind: 'stationary' | 'migratory'
  status: 'active' | 'planned_move' | 'inactive'
  locationName: string
  address: string
  city: string
  latitude: number | null
  longitude: number | null
  hiveType: string
  establishedOn: string
  association: string
  pastureCommissioner: string
  permitNumber: string
  permitExpiresOn: string
  notes: string
}

const EMPTY: FormState = {
  name: '',
  kind: 'stationary',
  status: 'active',
  locationName: '',
  address: '',
  city: '',
  latitude: null,
  longitude: null,
  hiveType: '',
  establishedOn: '',
  association: '',
  pastureCommissioner: '',
  permitNumber: '',
  permitExpiresOn: '',
  notes: '',
}

const text = (v: string) => (v.trim().length > 0 ? v.trim() : null)

export function ApiaryFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const { data, error, loading } = useResource<{ apiary: Apiary }>(isEdit ? `/apiaries/${id}` : null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    const a = data.apiary
    setForm({
      name: a.name,
      kind: a.kind,
      status: a.status,
      locationName: a.locationName ?? '',
      address: a.address ?? '',
      city: a.city ?? '',
      latitude: a.latitude,
      longitude: a.longitude,
      hiveType: a.hiveType ?? '',
      establishedOn: a.establishedOn ?? '',
      association: a.association ?? '',
      pastureCommissioner: a.pastureCommissioner ?? '',
      permitNumber: a.permitNumber ?? '',
      permitExpiresOn: a.permitExpiresOn ?? '',
      notes: a.notes ?? '',
    })
  }, [data])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (form.name.trim().length < 2) {
      setFieldErrors({ name: 'Unesite naziv pčelinjaka' })
      return
    }

    setSaving(true)
    setFieldErrors({})
    const body = {
      name: form.name.trim(),
      kind: form.kind,
      status: form.status,
      locationName: text(form.locationName),
      address: text(form.address),
      city: text(form.city),
      latitude: form.latitude,
      longitude: form.longitude,
      hiveType: text(form.hiveType),
      establishedOn: text(form.establishedOn),
      association: text(form.association),
      pastureCommissioner: text(form.pastureCommissioner),
      permitNumber: text(form.permitNumber),
      permitExpiresOn: text(form.permitExpiresOn),
      notes: text(form.notes),
    }

    try {
      const result = await api<{ apiary: Apiary }>(isEdit ? `/apiaries/${id}` : '/apiaries', {
        method: isEdit ? 'PATCH' : 'POST',
        body,
      })
      showSuccess(isEdit ? 'Pčelinjak je spremljen' : 'Pčelinjak je dodan')
      navigate(`/pcelinjaci/${result.apiary.id}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  if (isEdit && loading) return <LoadingState />
  if (isEdit && error) return <ErrorState message={error} />

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to={isEdit ? `/pcelinjaci/${id}` : '/pcelinjaci'} aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{isEdit ? 'Uredi pčelinjak' : 'Novi pčelinjak'}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Osnovno</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Naziv" error={fieldErrors.name}>
            {(p) => (
              <Input
                {...p}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Baćina"
              />
            )}
          </Field>
          <Field label="Vrsta">
            {(p) => (
              <Select {...p} value={form.kind} onChange={(e) => set('kind', e.target.value as FormState['kind'])}>
                <option value="stationary">Stacionarni</option>
                <option value="migratory">Seleći</option>
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(p) => (
              <Select {...p} value={form.status} onChange={(e) => set('status', e.target.value as FormState['status'])}>
                <option value="active">Aktivno</option>
                <option value="planned_move">Planirano preseljenje</option>
                <option value="inactive">Neaktivno</option>
              </Select>
            )}
          </Field>
          <Field label="Tip košnica" optional hint="npr. LR, AŽ, DB">
            {(p) => <Input {...p} value={form.hiveType} onChange={(e) => set('hiveType', e.target.value)} />}
          </Field>
          <Field label="Datum postavljanja" optional>
            {(p) => (
              <Input {...p} type="date" value={form.establishedOn} onChange={(e) => set('establishedOn', e.target.value)} />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lokacija</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LocationPicker
            latitude={form.latitude}
            longitude={form.longitude}
            onChange={(lat, lon) => setForm((prev) => ({ ...prev, latitude: lat, longitude: lon }))}
          />
          <Field label="Naziv lokacije" optional>
            {(p) => (
              <Input
                {...p}
                value={form.locationName}
                onChange={(e) => set('locationName', e.target.value)}
                placeholder="Baćinska jezera"
              />
            )}
          </Field>
          <Field label="Adresa" optional>
            {(p) => <Input {...p} value={form.address} onChange={(e) => set('address', e.target.value)} />}
          </Field>
          <Field label="Mjesto" optional>
            {(p) => <Input {...p} value={form.city} onChange={(e) => set('city', e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dokumentacija</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Pčelarska udruga" optional>
            {(p) => <Input {...p} value={form.association} onChange={(e) => set('association', e.target.value)} />}
          </Field>
          <Field label="Pašni povjerenik" optional>
            {(p) => (
              <Input
                {...p}
                value={form.pastureCommissioner}
                onChange={(e) => set('pastureCommissioner', e.target.value)}
              />
            )}
          </Field>
          <Field label="Broj suglasnosti za smještaj" optional>
            {(p) => <Input {...p} value={form.permitNumber} onChange={(e) => set('permitNumber', e.target.value)} />}
          </Field>
          <Field label="Suglasnost vrijedi do" optional>
            {(p) => (
              <Input
                {...p}
                type="date"
                value={form.permitExpiresOn}
                onChange={(e) => set('permitExpiresOn', e.target.value)}
              />
            )}
          </Field>
          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : isEdit ? 'Spremi promjene' : 'Dodaj pčelinjak'}
      </Button>
    </form>
  )
}
