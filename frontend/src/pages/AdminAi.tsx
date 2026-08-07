import { AlertTriangle, ArrowLeft, KeyRound, Save } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/toast'
import { api, ApiError } from '@/lib/api'
import { formatEur, formatNumber } from '@/lib/format'
import { useResource } from '@/lib/useResource'

interface AiSetting {
  key: string
  value: string
  label: string
  hint: string | null
  updatedAt: string
}

interface AdminAiData {
  settings: AiSetting[]
  month: { farms: number; calls: number; failures: number; eur: number }
  configured: boolean
  voiceConfigured: boolean
}

const BOOLEAN_KEYS = new Set(['enabled', 'assistant_enabled', 'daily_summary_enabled'])

/**
 * §54's principle applied to a budget: the numbers that decide how much this costs are data, not
 * code, so they change here rather than in a deploy.
 *
 * Secrets are conspicuously absent and that is the design — API keys live in .env on the host, and
 * this screen only ever reports whether one is present. A settings page that can display a key is
 * a settings page that can leak one.
 */
export function AdminAiPage() {
  const { data, error, loading, reload } = useResource<AdminAiData>('/admin/ai-settings')
  const { showSuccess, showError } = useToast()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return null

  async function update(key: string, value: string) {
    setSaving(key)
    try {
      await api(`/admin/ai-settings/${key}`, { method: 'PATCH', body: { value } })
      setDraft((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      showSuccess('Postavka je spremljena')
      void reload()
    } catch (err) {
      showError(err instanceof ApiError ? err.message : 'Spremanje nije uspjelo')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/profil" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">AI sloj</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" aria-hidden />
            Konfiguracija poslužitelja
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          <p className={data.configured ? 'text-ok' : 'text-caution'}>
            {data.configured ? '✓ ANTHROPIC_API_KEY je postavljen' : '○ ANTHROPIC_API_KEY nije postavljen'}
          </p>
          <p className={data.voiceConfigured ? 'text-ok' : 'text-caution'}>
            {data.voiceConfigured ? '✓ GROQ_API_KEY je postavljen' : '○ GROQ_API_KEY nije postavljen — glasovni unos je skriven'}
          </p>
          <p className="pt-1 text-xs text-muted-foreground">
            Ključevi se postavljaju u <span className="tabular">.env</span> na poslužitelju i ovdje
            se namjerno ne prikazuju. Bez njih aplikacija radi normalno, samo bez AI funkcija.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ovaj mjesec, sva gospodarstva</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="tabular text-xl font-bold">{formatEur(data.month.eur)}</p>
            <p className="text-xs text-muted-foreground">ukupno</p>
          </div>
          <div>
            <p className="tabular text-xl font-bold">{formatNumber(data.month.calls, 0)}</p>
            <p className="text-xs text-muted-foreground">poziva</p>
          </div>
          <div>
            <p className="tabular text-xl font-bold">{formatNumber(data.month.farms, 0)}</p>
            <p className="text-xs text-muted-foreground">gospodarstava</p>
          </div>
        </CardContent>
      </Card>

      {data.month.failures > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-caution/10 p-3 text-sm text-caution">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {formatNumber(data.month.failures, 0)} poziva ovaj mjesec nije uspjelo. Ulazni tokeni se
          naplaćuju i tada — provjerite log poslužitelja.
        </p>
      )}

      {data.settings.map((s) => {
        const value = draft[s.key] ?? s.value
        const dirty = draft[s.key] !== undefined && draft[s.key] !== s.value
        return (
          <Card key={s.key}>
            <CardContent className="space-y-2 pt-4">
              <p className="text-sm font-medium">{s.label}</p>
              {s.hint && <p className="text-xs leading-relaxed text-muted-foreground">{s.hint}</p>}

              {BOOLEAN_KEYS.has(s.key) ? (
                <div className="flex gap-2">
                  {(['true', 'false'] as const).map((v) => (
                    <Button
                      key={v}
                      type="button"
                      variant={s.value === v ? 'default' : 'outline'}
                      className="flex-1"
                      disabled={saving === s.key}
                      onClick={() => void update(s.key, v)}
                    >
                      {v === 'true' ? 'Uključeno' : 'Isključeno'}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={value}
                    inputMode="decimal"
                    aria-label={s.label}
                    className="tabular"
                    onChange={(e) => setDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    disabled={!dirty || saving === s.key}
                    onClick={() => void update(s.key, value)}
                  >
                    <Save />
                    Spremi
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
