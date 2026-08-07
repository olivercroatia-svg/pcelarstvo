import { CalendarCheck, ChevronRight, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Disclaimer } from '@/components/ui/disclaimer'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status'
import { useAuth } from '@/auth/AuthContext'
import { formatDate } from '@/lib/format'
import type { ObligationCard } from '@/lib/types'
import { useResource } from '@/lib/useResource'

interface ObligationsResponse {
  obligations: ObligationCard[]
  summary: { overdue: number; dueSoon: number; ok: number }
}

function Period(card: ObligationCard): string {
  if (card.kind === 'continuous') {
    return card.lastEntryOn ? `Posljednji unos: ${formatDate(card.lastEntryOn)}` : 'Trajna evidencija'
  }
  if (card.windowStart && card.dueOn) {
    return `Razdoblje: ${formatDate(card.windowStart)} – ${formatDate(card.dueOn)}`
  }
  return card.dueOn ? `Rok: ${formatDate(card.dueOn)}` : ''
}

/** §23 — „Moje obveze". */
export function ObligationsPage() {
  const { current } = useAuth()
  const { data, error, loading } = useResource<ObligationsResponse>('/obligations')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const obligations = data?.obligations ?? []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Moje obveze</h1>
        {current?.user.isAdmin && (
          <Link
            to="/admin/obveze"
            aria-label="Administracija propisa"
            className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="size-5" />
          </Link>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Aplikacija određuje koje obveze imate prema podacima vašeg gospodarstva.
      </p>

      {obligations.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="Nema evidentiranih obveza"
          description="Dopunite podatke gospodarstva pa će se obveze pojaviti automatski."
          action={{ to: '/profil', label: 'Dopuni profil' }}
        />
      ) : (
        <div className="space-y-3">
          {obligations.map((card) => (
            <Link key={card.id} to={`/obveze/${card.id}`} className="block">
              <Card className="transition-colors hover:border-primary">
                <CardContent className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{card.name}</p>
                    <p className="text-xs text-muted-foreground">{Period(card)}</p>
                    <div className="mt-1.5">
                      <StatusPill level={card.level}>{card.statusLabel}</StatusPill>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Disclaimer />
    </div>
  )
}
