import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatNumber, todayIso } from '@/lib/format'
import type { HoneyBatch, InventoryItem, Product } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const JAR_SIZES = [250, 370, 450, 720, 950, 1000]
const EMPTY_PRODUCTS: Product[] = []

/**
 * §33 — "Korisnik odabira LOT, pakiranje 450 g, broj staklenki 120. Aplikacija izračunava 54 kg.
 * Nova količina LOT-a: 232 kg."
 *
 * Both figures are shown before saving, because the point of the screen is that the beekeeper sees
 * what the warehouse will look like afterwards rather than discovering it later.
 */
export function PackagingNewPage() {
  const { id: batchId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()

  const { data, error, loading } = useResource<{ batch: HoneyBatch }>(`/batches/${batchId}`)
  const { data: productData } = useResource<{ products: Product[] }>('/products')
  const { data: inventoryData } = useResource<{ items: InventoryItem[] }>('/inventory')

  const [productId, setProductId] = useState('')
  const [packagedOn, setPackagedOn] = useState(todayIso())
  const [jarSizeG, setJarSizeG] = useState('450')
  const [jarCount, setJarCount] = useState('')
  const [bestBefore, setBestBefore] = useState('')
  const [isNational, setIsNational] = useState(false)
  const [serialFrom, setSerialFrom] = useState('')
  const [serialTo, setSerialTo] = useState('')
  const [materialItemIds, setMaterialItemIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const products = productData?.products ?? EMPTY_PRODUCTS
  // Only packaging materials, and only ones with stock — offering to draw down an empty shelf
  // would just produce a negative count.
  const materials = (inventoryData?.items ?? []).filter((i) => i.category === 'packaging' && i.quantity > 0)

  // Choosing a product fixes the net weight: a "Kaduljin med 450 g" packed into 720 g jars would
  // make the declaration say something the jar does not.
  useEffect(() => {
    const product = products.find((p) => p.id === productId)
    if (product) setJarSizeG(String(product.netWeightG))
  }, [productId, products])

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const batch = data.batch
  const size = Number(jarSizeG) || 0
  const count = Number(jarCount) || 0
  const kg = Number(((size * count) / 1000).toFixed(3))
  const remaining = Number((batch.availableKg - kg).toFixed(2))
  const tooMuch = kg > batch.availableKg

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!(count > 0) || !(size > 0)) return showError('Unesite veličinu pakiranja i broj staklenki')
    if (tooMuch) return showError('Pakiranje traži više meda nego što je na skladištu')

    setSaving(true)
    try {
      const result = await api<{ packaging: { id: string } }>('/packaging', {
        method: 'POST',
        body: {
          batchId,
          productId: productId || null,
          packagedOn,
          jarSizeG: size,
          jarCount: count,
          bestBefore: bestBefore || null,
          isNational,
          serialFrom: serialFrom.trim() || null,
          serialTo: serialTo.trim() || null,
          materialItemIds,
        },
      })
      showSuccess(`Pakirano ${formatNumber(kg)} kg`)
      navigate(`/pakiranja/${result.packaging.id}`, { replace: true })
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
        <h1 className="text-2xl font-bold tracking-tight">Pakiranje</h1>
      </div>

      <Card>
        <CardContent className="py-3">
          <p className="tabular text-lg font-semibold">{batch.lotCode}</p>
          <p className="text-sm text-muted-foreground">
            {batch.honeyType} · na skladištu {formatNumber(batch.availableKg)} kg
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pakiranje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Datum">
            {(p) => <Input {...p} type="date" value={packagedOn} onChange={(e) => setPackagedOn(e.target.value)} />}
          </Field>

          <Field label="Proizvod" optional hint="Bez proizvoda se deklaracija ne može ispisati">
            {(p) => (
              <Select {...p} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Bez proizvoda</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Veličina (g)">
              {(p) => (
                <>
                  <Input
                    {...p}
                    list="jar-sizes"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={jarSizeG}
                    onChange={(e) => setJarSizeG(e.target.value)}
                  />
                  <datalist id="jar-sizes">
                    {JAR_SIZES.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Broj staklenki">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={jarCount}
                  onChange={(e) => setJarCount(e.target.value)}
                  placeholder="120"
                />
              )}
            </Field>
          </div>

          {count > 0 && size > 0 && (
            <div
              className={cn(
                'rounded-lg p-3 text-sm',
                tooMuch ? 'bg-critical/10 text-critical' : 'bg-secondary/60',
              )}
            >
              <p>
                Iz serije se skida <strong className="tabular">{formatNumber(kg)} kg</strong>.
              </p>
              <p className={tooMuch ? 'font-medium' : 'text-muted-foreground'}>
                {tooMuch
                  ? `Na skladištu je samo ${formatNumber(batch.availableKg)} kg.`
                  : `Nova količina LOT-a: ${formatNumber(remaining)} kg.`}
              </p>
            </div>
          )}

          <Field label="Najbolje upotrijebiti do" optional>
            {(p) => <Input {...p} type="date" value={bestBefore} onChange={(e) => setBestBefore(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nacionalna staklenka</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={isNational}
              onChange={(e) => setIsNational(e.target.checked)}
              className="size-5 rounded border-input accent-primary"
            />
            Pakiranje ide u nacionalnu staklenku
          </label>
          {isNational && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Serijski od" optional>
                {(p) => <Input {...p} value={serialFrom} onChange={(e) => setSerialFrom(e.target.value)} />}
              </Field>
              <Field label="Serijski do" optional>
                {(p) => <Input {...p} value={serialTo} onChange={(e) => setSerialTo(e.target.value)} />}
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {materials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skini ambalažu sa skladišta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Opt-in and explicit. Guessing which shelf item is "the 450 g jar" would eventually
                subtract from the wrong one, and a warehouse that quietly loses count is worse than
                one that only changes when told to. */}
            {materials.map((item) => {
              const checked = materialItemIds.includes(item.id)
              const short = count > item.quantity
              return (
                <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setMaterialItemIds((prev) =>
                        prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id],
                      )
                    }
                    className="size-5 rounded border-input accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    {item.name}
                    <span className={cn('block text-xs', short ? 'text-caution' : 'text-muted-foreground')}>
                      stanje {formatNumber(item.quantity)} {item.unit}
                      {short && count > 0 ? ` — manje od ${count}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
            <p className="text-xs text-muted-foreground">
              Za svaku označenu stavku skida se {count || 'n'} komada.
            </p>
          </CardContent>
        </Card>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={saving || tooMuch}>
        {saving ? 'Spremam…' : 'Evidentiraj pakiranje'}
      </Button>
    </form>
  )
}
