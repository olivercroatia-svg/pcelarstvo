import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatEur, formatNumber, todayIso } from '@/lib/format'
import type { SaleItemKind, SaleOptions } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { CHANNEL_LABELS, PAYMENT_LABELS } from '@/lib/labels'

/**
 * §37 — "Jednostavna evidencija prodaje."
 *
 * Starts as one line, because §37's own example is one product and a market sale usually is. Lines
 * are added when a delivery to a shop needs them; splitting that into two sales would make the
 * receipt total unreproducible.
 *
 * The running total is computed here for the beekeeper's eye only. The figure that is stored is
 * the server's, summed from the lines it wrote — this one never leaves the browser.
 */

interface Line {
  key: number
  kind: SaleItemKind
  packagingId: string
  batchId: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
}

const emptyLine = (key: number): Line => ({
  key,
  kind: 'jars',
  packagingId: '',
  batchId: '',
  description: '',
  quantity: '',
  unit: 'kom',
  unitPrice: '',
})

export function SaleNewPage() {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const { data, loading } = useResource<SaleOptions>('/sales/options')

  const [customerId, setCustomerId] = useState('')
  const [soldOn, setSoldOn] = useState(todayIso())
  const [channel, setChannel] = useState('direct')
  const [payment, setPayment] = useState('cash')
  const [paid, setPaid] = useState(true)
  const [documentNumber, setDocumentNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine(0)])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (loading) return <LoadingState />

  const runs = data?.runs ?? []
  const batches = data?.batches ?? []
  const customers = data?.customers ?? []

  function update(key: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const lineTotal = (l: Line) => (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const honeyKg = lines.reduce((sum, l) => {
    if (l.kind === 'jars') {
      const run = runs.find((r) => r.id === l.packagingId)
      return sum + ((Number(l.quantity) || 0) * (run?.jarSizeG ?? 0)) / 1000
    }
    if (l.kind === 'bulk') return sum + (Number(l.quantity) || 0)
    return sum
  }, 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    const items = lines.map((l) => ({
      kind: l.kind,
      packagingId: l.kind === 'jars' ? l.packagingId : null,
      batchId: l.kind === 'bulk' ? l.batchId : null,
      description: l.description.trim() || undefined,
      quantity: Number(l.quantity),
      unit: l.unit,
      unitPrice: Number(l.unitPrice),
    }))

    if (items.some((i) => !i.quantity || i.quantity <= 0)) {
      setFormError('Svaka stavka treba količinu veću od nule.')
      return
    }
    if (items.some((i) => i.kind === 'jars' && !i.packagingId)) {
      setFormError('Odaberite pakiranje za svaku stavku sa staklenkama.')
      return
    }
    if (items.some((i) => i.kind === 'bulk' && !i.batchId)) {
      setFormError('Odaberite seriju meda za svaku stavku u rinfuzi.')
      return
    }
    if (items.some((i) => i.kind === 'other' && (i.description ?? '').length < 2)) {
      setFormError('Upišite što je prodano za stavke izvan skladišta.')
      return
    }

    setSaving(true)
    try {
      const result = await api<{ sale: { id: string } }>('/sales', {
        method: 'POST',
        body: {
          customerId: customerId || null,
          soldOn,
          channel,
          payment,
          paid,
          documentNumber: documentNumber.trim() || null,
          notes: notes.trim() || null,
          items,
        },
      })
      showSuccess('Prodaja je evidentirana, skladište je smanjeno')
      navigate(`/prodaja/${result.sale.id}`, { replace: true })
    } catch (err) {
      // 409 means the warehouse said no — the message names the LOT and the shortfall, so it is
      // shown in place rather than replaced with something generic.
      const message = err instanceof ApiError ? err.message : 'Spremanje nije uspjelo'
      setFormError(message)
      showError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/prodaja" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Nova prodaja</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kupac i datum</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Kupac" optional hint="Prodaja na sajmu obično nema upisanog kupca">
            {(p) => (
              <Select {...p} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Bez kupca</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Datum">
              {(p) => <Input {...p} type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} />}
            </Field>
            <Field label="Kanal">
              {(p) => (
                <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Što je prodano</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, index) => (
            <div key={line.key} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{index + 1}. stavka</p>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={`Ukloni ${index + 1}. stavku`}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>

              <Field label="Vrsta">
                {(p) => (
                  <Select
                    {...p}
                    value={line.kind}
                    onChange={(e) =>
                      update(line.key, {
                        kind: e.target.value as SaleItemKind,
                        unit: e.target.value === 'bulk' ? 'kg' : 'kom',
                        packagingId: '',
                        batchId: '',
                      })
                    }
                  >
                    <option value="jars">Staklenke iz pakiranja</option>
                    <option value="bulk">Med u rinfuzi</option>
                    <option value="other">Ostalo (vosak, matice, rojevi…)</option>
                  </Select>
                )}
              </Field>

              {line.kind === 'jars' && (
                <Field
                  label="Pakiranje"
                  hint={runs.length === 0 ? 'Nema napunjenih staklenki na skladištu' : undefined}
                >
                  {(p) => (
                    <Select {...p} value={line.packagingId} onChange={(e) => update(line.key, { packagingId: e.target.value })}>
                      <option value="">Odaberite…</option>
                      {runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.productName ?? r.honeyType} {r.jarSizeG} g · {r.lotCode} · {r.remainingCount} kom
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {line.kind === 'bulk' && (
                <Field label="Serija meda">
                  {(p) => (
                    <Select {...p} value={line.batchId} onChange={(e) => update(line.key, { batchId: e.target.value })}>
                      <option value="">Odaberite…</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.lotCode} · {b.honeyType} · {formatNumber(b.availableKg)} kg
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              {line.kind === 'other' && (
                <Field label="Što je prodano">
                  {(p) => (
                    <Input
                      {...p}
                      value={line.description}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                      placeholder="Vosak"
                    />
                  )}
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label={line.kind === 'jars' ? 'Broj staklenki' : line.kind === 'bulk' ? 'Kilograma' : 'Količina'}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={line.kind === 'jars' ? 1 : 'any'}
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={`Cijena po ${line.unit}`}>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                    />
                  )}
                </Field>
              </div>

              <p className="tabular text-right text-sm font-medium">{formatEur(lineTotal(line))}</p>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setLines((prev) => [...prev, emptyLine(Math.max(...prev.map((l) => l.key)) + 1)])}
          >
            <Plus />
            Dodaj stavku
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 py-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Ukupno</span>
            <span className="tabular text-xl font-bold">{formatEur(total)}</span>
          </div>
          {honeyKg > 0 && (
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Skinut će se sa skladišta</span>
              <span className="tabular font-medium">{formatNumber(honeyKg, 3)} kg</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Naplata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Način plaćanja">
            {(p) => (
              <Select {...p} value={payment} onChange={(e) => setPayment(e.target.value)}>
                {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
              className="size-5 rounded border-input accent-primary"
            />
            Naplaćeno
          </label>
          <Field label="Broj računa" optional>
            {(p) => <Input {...p} value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />}
          </Field>
          <Field label="Napomena" optional>
            {(p) => <Input {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      {formError && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={saving}>
        {saving ? 'Spremam…' : 'Evidentiraj prodaju'}
      </Button>
    </form>
  )
}
