import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import type { Apiary } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/**
 * §11 — hives are created in ranges by default.
 *
 * Setting up an apiary means 30-60 boxes. Adding them one at a time is the kind of chore that
 * makes people give up on the app before they ever get to the useful part, so the range form is
 * the primary path and the single-hive form is the exception.
 */
export function HiveNewPage() {
  const navigate = useNavigate()
  const { showSuccess, showError } = useToast()
  const { data: apiaryData } = useResource<{ apiaries: Apiary[] }>('/apiaries')

  const [mode, setMode] = useState<'range' | 'single'>('range')
  const [apiaryId, setApiaryId] = useState('')
  const [prefix, setPrefix] = useState('B')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('12')
  const [padTo, setPadTo] = useState('3')
  const [code, setCode] = useState('')
  const [hiveType, setHiveType] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const fromNum = Number(from) || 0
  const toNum = Number(to) || 0
  const count = mode === 'range' ? Math.max(0, toNum - fromNum + 1) : 1
  const preview =
    mode === 'range' && count > 0
      ? [fromNum, toNum].map((n) => `${prefix}${String(n).padStart(Number(padTo) || 1, '0')}`)
      : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFieldErrors({})

    try {
      if (mode === 'range') {
        const result = await api<{ created: number }>('/hives/bulk', {
          method: 'POST',
          body: {
            apiaryId: apiaryId || null,
            prefix,
            from: fromNum,
            to: toNum,
            padTo: Number(padTo) || 3,
            hiveType: hiveType.trim() || null,
          },
        })
        showSuccess(`Dodano ${result.created} košnica`)
      } else {
        await api('/hives', {
          method: 'POST',
          body: { apiaryId: apiaryId || null, code: code.trim(), hiveType: hiveType.trim() || null },
        })
        showSuccess(`Košnica ${code.trim()} je dodana`)
      }
      navigate(apiaryId ? `/kosnice?pcelinjak=${apiaryId}` : '/kosnice', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields)
      showError(err instanceof ApiError ? err.message : 'Dodavanje nije uspjelo')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/kosnice" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Nove košnice</h1>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['range', 'single'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              'min-h-12 rounded-xl border text-sm font-medium',
              mode === m ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
            )}
          >
            {m === 'range' ? 'Raspon' : 'Pojedinačno'}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{mode === 'range' ? 'Raspon oznaka' : 'Oznaka'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Pčelinjak" optional>
            {(p) => (
              <Select {...p} value={apiaryId} onChange={(e) => setApiaryId(e.target.value)}>
                <option value="">— bez pčelinjaka —</option>
                {apiaryData?.apiaries.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {mode === 'range' ? (
            <>
              <div className="grid grid-cols-[5rem_1fr_1fr] gap-3">
                <Field label="Prefiks">
                  {(p) => <Input {...p} value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={10} />}
                </Field>
                <Field label="Od">
                  {(p) => <Input {...p} value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" />}
                </Field>
                <Field label="Do" error={fieldErrors.to}>
                  {(p) => <Input {...p} value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" />}
                </Field>
              </div>
              <Field label="Broj znamenki" hint="3 → B001, 1 → B1">
                {(p) => (
                  <Select {...p} value={padTo} onChange={(e) => setPadTo(e.target.value)}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {preview && count > 0 && (
                <p className="rounded-lg bg-secondary p-2.5 text-sm text-secondary-foreground">
                  Stvorit će se <strong className="tabular">{count}</strong>{' '}
                  {count === 1 ? 'košnica' : 'košnica'}: {preview[0]} … {preview[1]}
                </p>
              )}
            </>
          ) : (
            <Field label="Oznaka košnice" error={fieldErrors.code}>
              {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} placeholder="B024" />}
            </Field>
          )}

          <Field label="Tip košnice" optional hint="npr. LR, AŽ, DB">
            {(p) => <Input {...p} value={hiveType} onChange={(e) => setHiveType(e.target.value)} />}
          </Field>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Svaka košnica automatski dobiva vlastiti QR kod i aktivnu zajednicu. Naljepnice možete
        ispisati sa stranice košnica.
      </p>

      <Button type="submit" size="lg" className="w-full" disabled={saving || (mode === 'range' && count < 1)}>
        {saving ? 'Dodajem…' : mode === 'range' ? `Dodaj ${count} košnica` : 'Dodaj košnicu'}
      </Button>
    </form>
  )
}
