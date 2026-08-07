import { Bug, CloudOff, Droplet, HeartPulse, Layers, Play, QrCode, RefreshCw, Syringe, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm'
import { useOutbox } from '@/lib/outbox'
import type { Apiary } from '@/lib/types'
import { useResource } from '@/lib/useResource'

/**
 * The "+ Unos" tab from §3 — the hub the thumb reaches for. It answers "what am I about to do"
 * with three big targets rather than making the beekeeper navigate to the right list first.
 */
export function EntryPage() {
  const { data } = useResource<{ apiaries: Apiary[] }>('/apiaries')
  const { pending, online, syncing, flush, discard } = useOutbox()
  const confirm = useConfirm()

  async function drop(id: string, label: string) {
    const ok = await confirm({
      title: 'Odbaciti zapis?',
      description: `"${label}" nikada neće biti spremljen na poslužitelj.`,
      confirmLabel: 'Odbaci',
      destructive: true,
    })
    if (ok) await discard(id)
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Unos</h1>

      <Link
        to="/skeniraj"
        className="flex min-h-20 items-center gap-4 rounded-xl bg-primary px-5 text-primary-foreground"
      >
        <QrCode className="size-8 shrink-0" />
        <span>
          <span className="block font-semibold">Skeniraj košnicu</span>
          <span className="block text-sm opacity-90">Najbrži put do pregleda</span>
        </span>
      </Link>

      <Link
        to="/skupni-unos"
        className="flex min-h-20 items-center gap-4 rounded-xl border border-border bg-card px-5"
      >
        <Layers className="size-8 shrink-0 text-primary" />
        <span>
          <span className="block font-semibold">Skupni unos</span>
          <span className="block text-sm text-muted-foreground">Isti zapis na više košnica</span>
        </span>
      </Link>

      {/* §12 — the other things recorded in the field, including everything a worker may enter. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ostali unosi</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          {[
            { to: '/varroa/nova', label: 'Kontrola varoe', icon: Bug },
            { to: '/tretmani/novi', label: 'Tretman VMP', icon: Syringe },
            { to: '/prihrana', label: 'Prihrana', icon: Droplet },
            { to: '/zdravlje', label: 'Zdravstveni zapis', icon: HeartPulse },
          ].map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-border px-2 text-center text-xs font-medium hover:bg-accent"
            >
              <Icon className="size-5 text-primary" />
              {label}
            </Link>
          ))}
        </CardContent>
      </Card>

      {data && data.apiaries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dan na pčelinjaku</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.apiaries.map((apiary) => (
              <Link
                key={apiary.id}
                to={`/pcelinjaci/${apiary.id}`}
                className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 hover:bg-accent"
              >
                <Play className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{apiary.name}</span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {apiary.hiveCount ?? 0} košnica
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* §3 — the queue is visible on purpose. A beekeeper who recorded 40 inspections in a dead
          spot needs to see that they are still on the phone, and that they left. */}
      {pending.length > 0 && (
        <Card className="border-caution/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CloudOff className="size-4 text-caution" aria-hidden />
              Čeka slanje ({pending.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pending.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString('hr-HR')}
                    {item.lastError ? ` · ${item.lastError}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Odbaci ${item.label}`}
                  onClick={() => drop(item.id, item.label)}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={() => flush()} disabled={!online || syncing}>
              <RefreshCw className={syncing ? 'animate-spin' : undefined} />
              {online ? (syncing ? 'Sinkroniziram…' : 'Pošalji sada') : 'Nema veze'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
