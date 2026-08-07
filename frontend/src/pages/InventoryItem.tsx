import { ArrowLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { Field, Input, Select } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/auth/AuthContext'
import { api, ApiError } from '@/lib/api'
import { formatDate, formatNumber, todayIso } from '@/lib/format'
import type { InventoryItem, InventoryMovement } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

const REASONS: Record<string, string> = {
  purchase: 'nabava',
  usage: 'utrošeno',
  packaging: 'pakiranje',
  correction: 'ispravak',
  loss: 'gubitak',
  sale: 'prodaja',
  other: 'ostalo',
}

/**
 * §32 — one shelf item and every change it has been through.
 *
 * The log is the point: "why do I have forty fewer lids than last month" is a question a single
 * editable number can never answer.
 */
export function InventoryItemPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { showSuccess, showError } = useToast()
  const { current } = useAuth()
  const { data, error, loading, reload } = useResource<{ item: InventoryItem; movements: InventoryMovement[] }>(
    `/inventory/items/${id}/movements`,
  )

  const [mode, setMode] = useState<'delta' | 'count'>('delta')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('purchase')
  const [movedOn, setMovedOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />
  if (!data) return null

  const { item, movements } = data

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (amount === '') return showError('Unesite iznos')
    setSaving(true)
    try {
      await api(`/inventory/items/${id}/movements`, {
        method: 'POST',
        body: {
          ...(mode === 'delta' ? { delta: Number(amount) } : { quantity: Number(amount) }),
          reason: mode === 'count' ? 'correction' : reason,
          movedOn,
          note: note.trim() || null,
        },
      })
      showSuccess('Promjena je zabilježena')
      setAmount('')
      setNote('')
      await reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    const ok = await confirm({
      title: 'Uklanjanje stavke',
      description: `„${item.name}" se uklanja sa skladišta.`,
      confirmLabel: 'Ukloni',
      destructive: true,
    })
    if (!ok) return
    try {
      await api(`/inventory/items/${id}`, { method: 'DELETE' })
      showSuccess('Stavka je uklonjena')
      navigate('/skladiste', { replace: true })
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Uklanjanje nije uspjelo')
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/skladiste" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{item.name}</h1>
      </div>

      <Card>
        <CardContent className="flex items-baseline justify-between py-3">
          <span className="text-sm text-muted-foreground">
            Stanje
            {item.expiresOn && <span className="block text-xs">rok {formatDate(item.expiresOn)}</span>}
          </span>
          <span className={cn('tabular text-2xl font-bold', item.low && 'text-caution')}>
            {formatNumber(item.quantity)} {item.unit}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova promjena</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['delta', 'count'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={mode === option}
                  onClick={() => setMode(option)}
                  className={cn(
                    'min-h-11 rounded-lg border text-sm font-medium',
                    mode === option
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-accent',
                  )}
                >
                  {option === 'delta' ? 'Promjena' : 'Prebrojano'}
                </button>
              ))}
            </div>

            <Field
              label={mode === 'delta' ? 'Iznos (+ ili −)' : 'Novo stanje'}
              hint={mode === 'delta' ? 'Npr. 200 za nabavu, −120 za utrošak' : 'Razlika se upisuje kao ispravak'}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>

            {mode === 'delta' && (
              <Field label="Razlog">
                {(p) => (
                  <Select {...p} value={reason} onChange={(e) => setReason(e.target.value)}>
                    {Object.entries(REASONS)
                      .filter(([key]) => key !== 'packaging' && key !== 'sale')
                      .map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Datum">
                {(p) => <Input {...p} type="date" value={movedOn} onChange={(e) => setMovedOn(e.target.value)} />}
              </Field>
              <Field label="Napomena" optional>
                {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </div>

            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Spremam…' : 'Zabilježi'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Promet ({movements.length})</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {movements.map((m) => (
            <div key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{REASONS[m.reason] ?? m.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(m.movedOn)}
                  {m.note ? ` · ${m.note}` : ''}
                  {m.by ? ` · ${m.by}` : ''}
                </p>
              </div>
              <span className={cn('tabular shrink-0 font-semibold', m.delta < 0 ? 'text-critical' : 'text-ok')}>
                {m.delta > 0 ? '+' : ''}
                {formatNumber(m.delta)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {current?.role === 'owner' && (
        <Button variant="outline" className="w-full text-destructive" onClick={remove}>
          <Trash2 />
          Ukloni stavku
        </Button>
      )}
    </div>
  )
}
