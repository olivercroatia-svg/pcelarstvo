import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * §55 — the regulatory disclaimer, in the exact wording the scenario prescribes.
 *
 * A component rather than a copied paragraph so the sentence can never drift between screens, and
 * so there is one place to change it if the wording ever has to.
 */
export const REGULATORY_DISCLAIMER =
  'Informacije u aplikaciji služe kao pomoć u vođenju pčelarskog gospodarstva i ne predstavljaju ' +
  'pravno, veterinarsko niti službeno upravno mišljenje. Korisnik je odgovoran provjeriti aktualne ' +
  'obveze kod nadležnih tijela.'

interface DisclaimerProps {
  /** Replaces the standard text where a narrower caveat is the honest one (e.g. varroa thresholds). */
  text?: string
  className?: string
}

export function Disclaimer({ text, className }: DisclaimerProps) {
  return (
    <p
      className={cn(
        'flex gap-2 rounded-lg bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground',
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{text ?? REGULATORY_DISCLAIMER}</span>
    </p>
  )
}
