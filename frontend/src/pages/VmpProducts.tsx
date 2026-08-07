import { ArrowLeft, FlaskConical, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { AiScan, Unreadable } from '@/components/AiScan'
import type { VmpDraft } from '@/lib/ai'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Disclaimer } from '@/components/ui/disclaimer'
import { Field, Input } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import type { VmpProduct } from '@/lib/types'
import { useResource } from '@/lib/useResource'

const EMPTY = {
  name: '',
  activeSubstance: '',
  manufacturer: '',
  form: '',
  withdrawalDays: '',
  defaultDose: '',
  defaultMethod: '',
}

/**
 * §17/§18 — the beekeeper's own shelf of products, so the details are typed once instead of at
 * every treatment. Per farm, not a built-in national catalogue: authorised products and their
 * withdrawal periods change, and shipping a stale list as fact would be worse than an empty one.
 */
export function VmpProductsPage() {
  const { showSuccess, showError } = useToast()
  const confirm = useConfirm()
  const { isOwner } = useAuth()
  const { data, error, loading, reload } = useResource<{ products: VmpProduct[] }>('/vmp')

  const [form, setForm] = useState(EMPTY)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [unreadable, setUnreadable] = useState<string[]>([])

  const set = (key: keyof typeof EMPTY, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (form.name.trim().length < 2) {
      setFieldErrors({ name: 'Unesite naziv proizvoda' })
      return
    }
    setSaving(true)
    try {
      await api('/vmp', {
        method: 'POST',
        body: {
          name: form.name.trim(),
          activeSubstance: form.activeSubstance.trim() || null,
          manufacturer: form.manufacturer.trim() || null,
          form: form.form.trim() || null,
          withdrawalDays: form.withdrawalDays === '' ? null : Number(form.withdrawalDays),
          defaultDose: form.defaultDose.trim() || null,
          defaultMethod: form.defaultMethod.trim() || null,
        },
      })
      showSuccess('Proizvod je dodan')
      setForm(EMPTY)
      setAdding(false)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function remove(product: VmpProduct) {
    const ok = await confirm({
      title: `Ukloniti ${product.name}?`,
      description: 'Već evidentirani tretmani ostaju nepromijenjeni — oni čuvaju vlastitu kopiju podataka o proizvodu.',
      confirmLabel: 'Ukloni',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/vmp/${product.id}`, { method: 'DELETE' })
      showSuccess('Proizvod je uklonjen s police')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Brisanje nije uspjelo')
    }
  }

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const products = data?.products ?? []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/tretmani" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">VMP proizvodi</h1>
      </div>

      {!adding && (
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Dodaj proizvod
        </Button>
      )}

      {adding && (
        <form onSubmit={submit} noValidate>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Novi proizvod</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* §18 — "skeniranje kutije lijeka". Fills the fields below; withdrawalDays stays
                  empty unless the box states a number, because §17's register is what an
                  inspector reads and a guessed karenca there is worse than a blank one. */}
              <AiScan<VmpDraft>
                endpoint="/ai/read/vmp"
                label="Fotografiraj kutiju lijeka"
                hint="Slikajte kutiju ili uputu — polja ispod se popune, a vi ih provjerite."
                onDraft={(d) => {
                  setForm((prev) => ({
                    name: d.name ?? prev.name,
                    activeSubstance: d.activeSubstance ?? prev.activeSubstance,
                    manufacturer: d.manufacturer ?? prev.manufacturer,
                    form: d.form ?? prev.form,
                    withdrawalDays: d.withdrawalDays === null ? prev.withdrawalDays : String(d.withdrawalDays),
                    defaultDose: d.defaultDose ?? prev.defaultDose,
                    defaultMethod: d.defaultMethod ?? prev.defaultMethod,
                  }))
                  setUnreadable(d.unreadable)
                }}
              >
                <Unreadable fields={unreadable} />
              </AiScan>
              <Field label="Naziv" error={fieldErrors.name}>
                {(p) => <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />}
              </Field>
              <Field label="Aktivna tvar" optional>
                {(p) => (
                  <Input {...p} value={form.activeSubstance} onChange={(e) => set('activeSubstance', e.target.value)} />
                )}
              </Field>
              <Field label="Proizvođač" optional>
                {(p) => <Input {...p} value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />}
              </Field>
              <Field label="Oblik" optional hint="trakice, otopina, gel…">
                {(p) => <Input {...p} value={form.form} onChange={(e) => set('form', e.target.value)} />}
              </Field>
              <Field label="Karenca (dana)" optional hint="Prazno = ne primjenjuje se">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.withdrawalDays}
                    onChange={(e) => set('withdrawalDays', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Uobičajena doza" optional>
                {(p) => <Input {...p} value={form.defaultDose} onChange={(e) => set('defaultDose', e.target.value)} />}
              </Field>
              <Field label="Uobičajen način primjene" optional>
                {(p) => <Input {...p} value={form.defaultMethod} onChange={(e) => set('defaultMethod', e.target.value)} />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi'}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setAdding(false); setForm(EMPTY) }}>
                  Odustani
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {products.length === 0 && !adding ? (
        <EmptyState
          icon={FlaskConical}
          title="Polica je prazna"
          description="Dodajte proizvode koje koristite pa ih pri tretmanu birate s popisa."
        />
      ) : (
        products.map((product) => (
          <Card key={product.id}>
            <CardContent className="flex items-start gap-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  {[product.activeSubstance, product.manufacturer, product.form].filter(Boolean).join(' · ') || '—'}
                </p>
                <p className="mt-0.5 text-xs">
                  {product.withdrawalDays === null ? (
                    <span className="text-muted-foreground">karenca se ne primjenjuje</span>
                  ) : (
                    <span className="font-medium text-caution">karenca {product.withdrawalDays} dana</span>
                  )}
                  {product.defaultDose ? <span className="text-muted-foreground"> · {product.defaultDose}</span> : null}
                </p>
              </div>
              {isOwner && (
                <button
                  type="button"
                  aria-label={`Ukloni ${product.name}`}
                  onClick={() => remove(product)}
                  className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Disclaimer text="Popis proizvoda vodite sami prema pakiranjima koja koristite. Aplikacija ne provjerava je li proizvod odobren niti je li navedena karenca aktualna — to potvrđuje uputa proizvođača i veterinar." />
    </div>
  )
}
