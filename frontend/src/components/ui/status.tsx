import { Check, CircleAlert, CircleDashed, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ObligationLevel } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * The 🔴🟠🟡🟢 vocabulary the scenario speaks in (§6, §23, §53), rendered once.
 *
 * Colour alone is never the signal: each level also carries its own icon, so the status is
 * readable in bright sun on a phone screen and to anyone who does not distinguish red from green.
 */
const LEVEL: Record<ObligationLevel, { icon: LucideIcon; dot: string; text: string; ring: string }> = {
  critical: { icon: CircleAlert, dot: 'bg-critical', text: 'text-critical', ring: 'border-critical/40' },
  warning: { icon: TriangleAlert, dot: 'bg-warning', text: 'text-warning', ring: 'border-warning/40' },
  caution: { icon: TriangleAlert, dot: 'bg-caution', text: 'text-caution', ring: 'border-caution/40' },
  ok: { icon: Check, dot: 'bg-ok', text: 'text-ok', ring: 'border-ok/40' },
  info: { icon: Info, dot: 'bg-info', text: 'text-info', ring: 'border-info/40' },
}

export function levelStyles(level: ObligationLevel) {
  return LEVEL[level] ?? LEVEL.info
}

export function StatusDot({ level, className }: { level: ObligationLevel; className?: string }) {
  return <span className={cn('inline-block size-2.5 shrink-0 rounded-full', levelStyles(level).dot, className)} />
}

export function StatusPill({
  level,
  children,
  className,
}: {
  level: ObligationLevel
  children: React.ReactNode
  className?: string
}) {
  const { icon: Icon, text, ring } = levelStyles(level)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium',
        text,
        ring,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {children}
    </span>
  )
}

/** A single row of the §26/§27 checklists: ✓, ⚠, or "not evaluated yet". */
export function CheckRow({
  label,
  ok,
  detail,
  pending,
}: {
  label: string
  ok: boolean
  detail?: string | null
  pending?: boolean
}) {
  const Icon = pending ? CircleDashed : ok ? Check : TriangleAlert
  const tone = pending ? 'text-muted-foreground' : ok ? 'text-ok' : 'text-caution'
  return (
    <li className="flex items-start gap-2 py-1 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={pending ? 'text-muted-foreground' : ''}>{label}</span>
        {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
      </span>
    </li>
  )
}
