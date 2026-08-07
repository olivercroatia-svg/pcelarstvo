import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { formatDate, plural } from '@/lib/format'
import type { WithdrawalConflict } from '@/lib/types'

/**
 * §17 × §28 — honey extracted while a withdrawal period was still running.
 *
 * This is the one screen element in the application that exists purely because two modules know
 * about each other. A paper register never puts the May treatment page next to the June extraction
 * page, so the beekeeper finds out at the laboratory or, worse, at an inspection.
 *
 * Deliberately loud but not blocking: the supers may have been off the hive during treatment, or
 * the entries may be historical, and an application that refuses the record just means the record
 * is kept somewhere else.
 */
/** Beyond this the panel stops being a warning and becomes a wall of text. */
const SHOWN = 5

export function WithdrawalWarning({ conflicts }: { conflicts: WithdrawalConflict[] }) {
  if (conflicts.length === 0) return null

  const shown = conflicts.slice(0, SHOWN)
  const hidden = conflicts.length - shown.length

  return (
    <div role="alert" className="rounded-lg border border-critical/40 bg-critical/10 p-3">
      <p className="flex items-start gap-2 text-sm font-semibold text-critical">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {conflicts.length === 1
            ? 'Vrcanje je unutar karence jednog tretmana'
            : `Vrcanje je unutar karence ${conflicts.length} tretmana`}
        </span>
      </p>
      <ul className="mt-2 space-y-1.5">
        {shown.map((c) => (
          <li key={c.treatmentId} className="text-sm">
            <Link
              to={`/tretmani/${c.treatmentId}`}
              className="flex min-h-11 flex-col justify-center underline-offset-2"
            >
              <span className="font-medium underline">{c.productName}</span>
              <span className="text-xs text-muted-foreground">
                {c.kind === 'open'
                  ? 'Tretman nema upisan završetak, pa se karenca ne može izračunati.'
                  : // formatDate already ends in a full stop ("4. 9. 2026."); adding another
                    // produces "2026..", which is how this same line read before it was fixed.
                    `Karenca traje do ${formatDate(c.withdrawalUntil)}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          … i još {hidden} {plural(hidden, 'tretman', 'tretmana', 'tretmana')}.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Provjerite jesu li medišta bila skinuta tijekom tretmana. Ako jesu, dopunite napomenu uz
        tretman — zapis ostaje, upozorenje je informativno.
      </p>
    </div>
  )
}
