import { Check, CircleAlert, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ObligationLevel } from './types'

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
