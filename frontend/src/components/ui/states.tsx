import { LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from './button'
import { Card, CardContent } from './card'

export function LoadingState({ label = 'Učitavanje…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
        <TriangleAlert className="size-8 text-destructive" aria-hidden />
        <p role="alert" className="text-sm">
          {message}
        </p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Pokušaj ponovno
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: { to: string; label: string }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
        <div>
          <p className="font-medium">{title}</p>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action && (
          <Link
            to={action.to}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {action.label}
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
