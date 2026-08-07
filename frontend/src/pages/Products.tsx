import { ArrowLeft, Plus, Tag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input } from '@/components/ui/field'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import type { Product } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface ProductsResponse {
  products: Product[]
  defaults: Record<string, string>
}

/**
 * §34 — the articles a filled jar is sold as, and the per-article half of the declaration.
 *
 * The storage-conditions and country fields start from the administrator's defaults rather than
 * being blank, so the common case is one tap; a beekeeper with a honey that needs different wording
 * overrides it here.
 */
export function ProductsPage() {
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { current } = useAuth()
  const { data, error, loading, reload } = useResource<ProductsResponse>('/products')

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [honeyType, setHoneyType] = useState('')
  const [netWeightG, setNetWeightG] = useState('450')
  const [shelfLife, setShelfLife] = useState('24')
  const [storage, setStorage] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const products = data?.products ?? []
  const defaults = data?.defaults ?? {}

  function openForm() {
    setStorage(defaults.storage_conditions ?? '')
    setAdding(true)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldErrors({})
    if (name.trim().length < 2) return setFieldErrors({ name: 'Unesite naziv proizvoda' })

    setSaving(true)
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name: name.trim(),
          honeyType: honeyType.trim() || null,
          netWeightG: Number(netWeightG),
          shelfLifeMonths: shelfLife === '' ? null : Number(shelfLife),
          storageConditions: storage.trim() || null,
          countryOfOrigin: defaults.country_of_origin || null,
        },
      })
      showSuccess('Proizvod je dodan')
      setName('')
      setHoneyType('')
      setAdding(false)
      await reload()
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function remove(product: Product) {
    const ok = await confirm({
      title: 'Uklanjanje proizvoda',
      description: `„${product.name}" se uklanja s popisa. Već pakirane serije zadržavaju svoju deklaraciju.`,
      confirmLabel: 'Ukloni',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' })
      showSuccess('Proizvod je uklonjen')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Uklanjanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/serije" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Proizvodi</h1>
      </div>

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Novi proizvod</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate className="space-y-4">
              <Field label="Naziv" error={fieldErrors.name}>
                {(p) => (
                  <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Kaduljin med 450 g" />
                )}
              </Field>
              <Field label="Vrsta meda" optional>
                {(p) => <Input {...p} value={honeyType} onChange={(e) => setHoneyType(e.target.value)} />}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Neto (g)">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={netWeightG}
                      onChange={(e) => setNetWeightG(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Rok trajanja (mj.)" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={shelfLife}
                      onChange={(e) => setShelfLife(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field label="Uvjeti čuvanja" optional hint="Zadano preuzeto iz administracije propisa">
                {(p) => <Input {...p} value={storage} onChange={(e) => setStorage(e.target.value)} />}
              </Field>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setAdding(false)}>
                  Odustani
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving ? 'Spremam…' : 'Spremi'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button size="lg" className="w-full" onClick={openForm}>
          <Plus />
          Novi proizvod
        </Button>
      )}

      {products.length === 0 && !adding ? (
        <EmptyState
          icon={Tag}
          title="Još nema proizvoda"
          description="Proizvod nosi neto količinu i tekst deklaracije koji se ispisuje na etiketi."
        />
      ) : (
        <div className="space-y-2">
          {products.map((product) => (
            <Card key={product.id}>
              <CardContent className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.netWeightG} g
                    {product.honeyType ? ` · ${product.honeyType}` : ''}
                    {product.shelfLifeMonths ? ` · rok ${product.shelfLifeMonths} mj.` : ''}
                  </p>
                </div>
                {current?.role === 'owner' && (
                  <button
                    type="button"
                    aria-label={`Ukloni ${product.name}`}
                    onClick={() => remove(product)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
