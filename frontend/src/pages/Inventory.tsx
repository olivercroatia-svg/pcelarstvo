import { ArrowLeft, Minus, Package, Plus, Warehouse } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber, plural } from '@/lib/format'
import type { HoneyStock, InventoryCategory, InventoryItem } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const CATEGORIES: { key: InventoryCategory; label: string }[] = [
  { key: 'packaging', label: 'Ambalaža' },
  { key: 'vmp', label: 'VMP' },
  { key: 'feed', label: 'Prihrana' },
  { key: 'equipment', label: 'Oprema' },
  { key: 'other', label: 'Ostalo' },
]

interface InventoryResponse {
  honey: HoneyStock[]
  items: InventoryItem[]
  lowCount: number
  expiredCount: number
}

/** §32 — the warehouse. Honey on top, read-only; everything the beekeeper counts by hand below. */
export function InventoryPage() {
  const { showSuccess, showError } = useToast()
  const { data, error, loading, reload } = useResource<InventoryResponse>('/inventory')

  const [adding, setAdding] = useState(false)
  const [category, setCategory] = useState<InventoryCategory>('packaging')
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('kom')
  const [quantity, setQuantity] = useState('')
  const [minQuantity, setMinQuantity] = useState('')
  const [lotNumber, setLotNumber] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const honey = data?.honey ?? []
  const items = data?.items ?? []
  const honeyTotal = honey.reduce((sum, h) => sum + h.availableKg, 0)

  async function addItem(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) return showError('Unesite naziv stavke')
    setSaving(true)
    try {
      await api('/inventory/items', {
        method: 'POST',
        body: {
          category,
          name: name.trim(),
          unit: unit.trim() || 'kom',
          quantity: quantity === '' ? 0 : Number(quantity),
          minQuantity: minQuantity === '' ? null : Number(minQuantity),
          lotNumber: lotNumber.trim() || null,
          expiresOn: expiresOn || null,
        },
      })
      showSuccess('Stavka je dodana')
      setName('')
      setQuantity('')
      setLotNumber('')
      setExpiresOn('')
      setAdding(false)
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function move(item: InventoryItem, delta: number) {
    try {
      await api(`/inventory/items/${item.id}/movements`, {
        method: 'POST',
        body: { delta, reason: delta > 0 ? 'purchase' : 'usage' },
      })
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Promjena nije uspjela')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Skladište</h1>
      </div>

      <Card>
        <CardHeader className="flex-row items-baseline justify-between">
          <CardTitle className="text-base">Med</CardTitle>
          <span className="tabular text-lg font-semibold">{formatNumber(honeyTotal)} kg</span>
        </CardHeader>
        <CardContent>
          {honey.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nema meda na skladištu.</p>
          ) : (
            <ul>
              {honey.map((h) => (
                <li key={h.honeyType}>
                  <Link
                    to={`/serije?vrsta=${encodeURIComponent(h.honeyType)}`}
                    className="-mx-2 flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm hover:bg-accent"
                  >
                    <span className="min-w-0 truncate">
                      {h.honeyType}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {h.batches} {plural(h.batches, 'serija', 'serije', 'serija')}
                      </span>
                    </span>
                    <span className="tabular shrink-0 font-medium">{formatNumber(h.availableKg)} kg</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {/* Not a limitation to apologise for — it is why the number can be trusted. */}
          <p className="mt-3 text-xs text-muted-foreground">
            Količine meda zbrajaju se iz serija i ne mogu se ovdje mijenjati. Ispravak se radi na
            samoj seriji ili novim pakiranjem.
          </p>
        </CardContent>
      </Card>

      {adding ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nova stavka</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addItem} noValidate className="space-y-4">
              <Field label="Skupina">
                {(p) => (
                  <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as InventoryCategory)}>
                    {CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Naziv">
                {(p) => (
                  <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Staklenke 450 g" />
                )}
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Stanje">
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Jedinica">
                  {(p) => <Input {...p} value={unit} onChange={(e) => setUnit(e.target.value)} />}
                </Field>
                <Field label="Minimum" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      value={minQuantity}
                      onChange={(e) => setMinQuantity(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              {(category === 'vmp' || category === 'feed') && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="LOT" optional>
                    {(p) => <Input {...p} value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />}
                  </Field>
                  <Field label="Rok trajanja" optional>
                    {(p) => (
                      <Input {...p} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
                    )}
                  </Field>
                </div>
              )}
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
        <Button size="lg" className="w-full" onClick={() => setAdding(true)}>
          <Plus />
          Nova stavka
        </Button>
      )}

      {CATEGORIES.map(({ key, label }) => {
        const group = items.filter((i) => i.category === key)
        if (group.length === 0) return null
        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="text-base">{label}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {group.map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-1">
                  {/* The whole name block is the link, not just the line of text: tapping an item
                      to see its movement log is the second most common action on this screen. */}
                  <Link
                    to={`/skladiste/${item.id}`}
                    className="-ml-2 flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2 hover:bg-accent"
                  >
                    <span className="truncate text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.lotNumber ? `LOT ${item.lotNumber}` : ''}
                      {item.lotNumber && item.expiresOn ? ' · ' : ''}
                      {item.expiresOn ? `rok ${formatDate(item.expiresOn)}` : ''}
                      {item.expired && <span className="ml-1 text-critical">istekao</span>}
                      {item.low && !item.expired && <span className="text-caution">niska zaliha</span>}
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label={`Smanji ${item.name}`}
                    onClick={() => move(item, -1)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
                  >
                    <Minus className="size-4" />
                  </button>
                  <span
                    className={cn(
                      'tabular w-20 shrink-0 text-right text-sm font-semibold',
                      item.low && 'text-caution',
                    )}
                  >
                    {formatNumber(item.quantity)} {item.unit}
                  </span>
                  <button
                    type="button"
                    aria-label={`Povećaj ${item.name}`}
                    onClick={() => move(item, 1)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}

      {items.length === 0 && !adding && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <Warehouse className="size-6" aria-hidden />
            </span>
            <div>
              <p className="font-medium">Ambalaža, VMP i prihrana još nisu upisani</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Med se vodi automatski kroz serije. Ovdje se broji ono što stoji na polici.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Link
        to="/proizvodi"
        className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-accent"
      >
        <Package className="size-4" />
        Proizvodi i deklaracije
      </Link>
    </div>
  )
}
