import { Hammer } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Standing in for the bottom-nav destinations that arrive in Etapa 1 (§7, §10, §12, §23).
 * Routed now so the navigation is genuinely testable rather than four dead links.
 */
export function PlaceholderPage({ title, stage }: { title: string; stage: string }) {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Hammer className="size-6" />
          </span>
          <p className="text-sm text-muted-foreground">Ovaj modul stiže u {stage}.</p>
        </CardContent>
      </Card>
    </div>
  )
}
