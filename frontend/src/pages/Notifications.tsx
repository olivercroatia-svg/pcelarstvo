import { ArrowLeft, BellOff, CheckCheck } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states'
import { levelStyles } from '@/components/ui/status'
import { api } from '@/lib/api'
import { relativeDay } from '@/lib/format'
import type { AppNotification } from '@/lib/types'
import { useResource } from '@/lib/useResource'
import { cn } from '@/lib/utils'

/** §53 — the notification centre. */
export function NotificationsPage() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useResource<{
    notifications: AppNotification[]
    unreadCount: number
  }>('/notifications')

  if (loading) return <LoadingState />
  if (error) return <ErrorState message={error} />

  const notifications = data?.notifications ?? []
  const unread = data?.unreadCount ?? 0

  const open = async (item: AppNotification) => {
    if (!item.readAt) await api(`/notifications/${item.id}/read`, { method: 'POST', body: {} }).catch(() => {})
    if (item.link) navigate(item.link)
    else await reload()
  }

  const markAll = async () => {
    await api('/notifications/read-all', { method: 'POST', body: {} }).catch(() => {})
    await reload()
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label="Natrag" className="-ml-2 rounded-lg p-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight">Obavijesti</h1>
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={markAll}>
            <CheckCheck />
            Sve pročitano
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Nema obavijesti"
          description="Ovdje stižu podsjetnici na rokove, kraj karence i sve što traži vašu pozornost."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((item) => {
            const { icon: Icon, text } = levelStyles(item.severity)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => open(item)}
                className="block w-full text-left"
              >
                <Card
                  className={cn(
                    'transition-colors hover:border-primary',
                    // Unread items keep the card background; read ones recede.
                    item.readAt && 'bg-transparent opacity-70',
                  )}
                >
                  <CardContent className="flex gap-3 py-3">
                    <Icon className={cn('mt-0.5 size-4 shrink-0', text)} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm', !item.readAt && 'font-medium')}>{item.title}</p>
                      {item.body && <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>}
                      <p className="mt-0.5 text-xs text-muted-foreground">{relativeDay(item.createdAt)}</p>
                    </div>
                    {!item.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      )}

      {/* Said plainly rather than implied: the app shows these, it does not yet email them. */}
      <p className="rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
        Obavijesti se trenutno prikazuju u aplikaciji. Slanje na e-mail i push notifikacije
        uključuju se pri postavljanju na poslužitelj.
      </p>
    </div>
  )
}
