import { ArrowLeft, CheckCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input, Select } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, todayIso } from '@/lib/format'
import type { Apiary, Hive, VmpProduct } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/** §17 — every field the register has to carry, in the order a beekeeper reads them off the box. */
export function TreatmentNewPage() {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const [params] = useSearchParams()

  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const { data: productData } = useResource<{ products: VmpProduct[] }>('/vmp')

  const [apiaryId, setApiaryId] = useState(params.get('pcelinjak') ?? '')
  const { data: hiveData } = useResource<{ hives: Hive[] }>(apiaryId ? `/hives?apiaryId=${apiaryId}` : null)

  const [productId, setProductId] = useState('')
  const [productName, setProductName] = useState('')
  const [activeSubstance, setActiveSubstance] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [lotNumber, setLotNumber] = useState('')
  const [startedOn, setStartedOn] = useState(todayIso())
  const [endedOn, setEndedOn] = useState('')
  const [dose, setDose] = useState('')
  const [applicationMethod, setApplicationMethod] = useState('')
  const [reason, setReason] = useState('')
  const [withdrawalDays, setWithdrawalDays] = useState('')
  const [notes, setNotes] = useState('')
  const [hiveIds, setHiveIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const apiaries = apiaryData?.apiaries ?? []
  const products = productData?.products ?? []
  const effectiveApiary = apiaryId || (apiaries.length === 1 ? apiaries[0]!.id : '')

  // Picking from the shelf copies the product's details into the form. They stay editable: the
  // register must record what was on the box in hand, not what the catalogue says.
  useEffect(() => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setProductName(product.name)
    setActiveSubstance(product.activeSubstance ?? '')
    setManufacturer(product.manufacturer ?? '')
    setDose(product.defaultDose ?? '')
    setApplicationMethod(product.defaultMethod ?? '')
    setWithdrawalDays(product.withdrawalDays === null ? '' : String(product.withdrawalDays))
  }, [productId, products])

  const hives = hiveData?.hives ?? []
  const allSelected = hives.length > 0 && hiveIds.length === hives.length

  const withdrawalUntil = (() => {
    const n = Number(withdrawalDays)
    if (!endedOn || !withdrawalDays || Number.isNaN(n)) return null
    const d = new Date(`${endedOn}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  })()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (!effectiveApiary) return setFieldErrors({ apiaryId: 'Odaberite pčelinjak' })
    if (productName.trim().length < 2) return setFieldErrors({ productName: 'Unesite naziv proizvoda' })

    setSaving(true)
    try {
      const result = await api<{ treatment: { id: string } }>('/treatments', {
        method: 'POST',
        body: {
          apiaryId: effectiveApiary,
          vmpProductId: productId || null,
          productName: productName.trim(),
          activeSubstance: activeSubstance.trim() || null,
          manufacturer: manufacturer.trim() || null,
          lotNumber: lotNumber.trim() || null,
          startedOn,
          endedOn: endedOn || null,
          dose: dose.trim() || null,
          applicationMethod: applicationMethod.trim() || null,
          reason: reason.trim() || null,
          withdrawalDays: withdrawalDays === '' ? null : Number(withdrawalDays),
          notes: notes.trim() || null,
          hiveIds,
        },
      })
      showSuccess('Tretman je evidentiran')
      navigate(`/tretmani/${result.treatment.id}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/tretmani" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Novi tretman</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proizvod</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {products.length > 0 && (
            <Field label="S police" optional hint="Popunjava polja ispod; ostaju izmjenjiva">
              {(p) => (
                <Select {...p} value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Unos ručno</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Naziv proizvoda" error={fieldErrors.productName}>
            {(p) => <Input {...p} value={productName} onChange={(e) => setProductName(e.target.value)} />}
          </Field>
          <Field label="Aktivna tvar" optional>
            {(p) => <Input {...p} value={activeSubstance} onChange={(e) => setActiveSubstance(e.target.value)} />}
          </Field>
          <Field label="Proizvođač" optional>
            {(p) => <Input {...p} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />}
          </Field>
          <Field label="LOT broj" hint="Upisuje se s pakiranja; inspekcija ga traži">
            {(p) => <Input {...p} value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Primjena</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {apiaries.length > 1 && (
            <Field label="Pčelinjak" error={fieldErrors.apiaryId}>
              {(p) => (
                <Select
                  {...p}
                  value={effectiveApiary}
                  onChange={(e) => {
                    setApiaryId(e.target.value)
                    setHiveIds([])
                  }}
                >
                  <option value="">Odaberite…</option>
                  {apiaries.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Početak">
              {(p) => <Input {...p} type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} />}
            </Field>
            <Field label="Završetak" optional error={fieldErrors.endedOn}>
              {(p) => <Input {...p} type="date" value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />}
            </Field>
          </div>

          <Field label="Doza" optional>
            {(p) => <Input {...p} value={dose} onChange={(e) => setDose(e.target.value)} placeholder="2 trakice" />}
          </Field>
          <Field label="Način primjene" optional>
            {(p) => (
              <Input
                {...p}
                value={applicationMethod}
                onChange={(e) => setApplicationMethod(e.target.value)}
                placeholder="trakice u plodištu"
              />
            )}
          </Field>
          <Field label="Razlog primjene" optional>
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="varooza" />}
          </Field>
          <Field label="Karenca (dana)" optional hint="Ostavite prazno ako se ne primjenjuje">
            {(p) => (
              <Input
                {...p}
                type="number"
                inputMode="numeric"
                min={0}
                value={withdrawalDays}
                onChange={(e) => setWithdrawalDays(e.target.value)}
              />
            )}
          </Field>

          {withdrawalUntil && (
            <p className="rounded-lg bg-caution/10 p-2.5 text-sm text-caution">
              Med se ne smije vrcati do <strong>{formatDate(withdrawalUntil)}</strong>.
            </p>
          )}
          {withdrawalDays !== '' && !endedOn && (
            <p className="text-xs text-muted-foreground">
              Karenca se računa od datuma završetka tretmana — upišite ga kad tretman završi.
            </p>
          )}
        </CardContent>
      </Card>

      {hives.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Košnice ({hiveIds.length}/{hives.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setHiveIds(allSelected ? [] : hives.map((h) => h.id))}
            >
              <CheckCheck />
              {allSelected ? 'Poništi odabir' : 'Odaberi sve'}
            </Button>
            <div className="grid grid-cols-4 gap-2 min-[420px]:grid-cols-5">
              {hives.map((hive) => {
                const selected = hiveIds.includes(hive.id)
                return (
                  <button
                    key={hive.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setHiveIds((prev) =>
                        prev.includes(hive.id) ? prev.filter((id) => id !== hive.id) : [...prev, hive.id],
                      )
                    }
                    className={cn(
                      'min-h-12 rounded-lg border text-sm font-medium transition-colors',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:bg-accent',
                    )}
                  >
                    {hive.code}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Tretman se upisuje u karton svake odabrane košnice pojedinačno.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4">
          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Disclaimer />

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : 'Evidentiraj tretman'}
      </Button>
    </form>
  )
}
