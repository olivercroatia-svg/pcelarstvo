import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface ChartPoint {
  /** ISO date; the x axis is the calendar year the chart is drawn for. */
  date: string
  value: number
  label?: string
  /** Tints the marker — used for the varroa level at that reading. */
  tone?: 'ok' | 'caution' | 'critical'
}

export interface ChartBand {
  from: number
  to: number
  tone: 'ok' | 'caution' | 'critical'
}

interface ChartProps {
  points: ChartPoint[]
  year: number
  /** Horizontal reference lines, e.g. the varroa treatment threshold. */
  bands?: ChartBand[]
  unit?: string
  className?: string
  ariaLabel: string
}

/**
 * A small line chart drawn as plain SVG.
 *
 * Written by hand rather than pulled from a chart library on purpose: this is the only chart in
 * the field app, it needs exactly one line plus threshold bands, and Recharts with its d3
 * dependencies is roughly 100 kB gzipped — a meaningful share of an application whose first load
 * we deliberately trimmed to fit a weak signal.
 *
 * The SVG uses a viewBox and no fixed width, so it scales with its container down to 390 px
 * without any measurement code.
 */
const W = 320
const H = 150
const PAD = { top: 12, right: 8, bottom: 22, left: 30 }

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

const TONE_COLOR: Record<NonNullable<ChartPoint['tone']>, string> = {
  ok: 'var(--status-ok)',
  caution: 'var(--status-caution)',
  critical: 'var(--status-critical)',
}

/** Croatian decimal comma, and no "0.0" where "0" is meant. */
function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return (value >= 10 ? value.toFixed(0) : value.toFixed(1)).replace('.', ',')
}

/** Day of year, 0–365, so points sit at their real calendar distance rather than evenly spaced. */
function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(y!, 0, 1)) / 86_400_000)
}

export function Chart({ points, year, bands = [], unit = '', className, ariaLabel }: ChartProps) {
  const gradientId = useId()

  if (points.length === 0) {
    return (
      <p className={cn('py-8 text-center text-sm text-muted-foreground', className)}>
        Nema podataka za {year}. godinu.
      </p>
    )
  }

  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
  const values = points.map((p) => p.value)
  // Band *starts*, never their ends. The topmost band is deliberately open-ended (it paints
  // "anything above the threshold"), and letting its `to` drive the scale would squash a 3 %
  // reading into a flat line at the bottom of a chart running to 100.
  const bandFloor = bands.length > 0 ? Math.max(...bands.map((b) => b.from)) : 0
  // The 1.15 headroom keeps the highest point and the top threshold off the frame.
  const max = Math.max(...values, bandFloor, 1) * 1.15
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const x = (iso: string) => PAD.left + (dayOfYear(iso) / daysInYear) * plotW
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const path = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const area = `${path} L${x(sorted.at(-1)!.date).toFixed(1)},${PAD.top + plotH} L${x(sorted[0]!.date).toFixed(1)},${PAD.top + plotH} Z`

  const ticks = [0, max / 2, max]

  return (
    <figure className={cn('m-0', className)}>
      {/* Default preserveAspectRatio: the viewBox keeps its 320×150 ratio while the element fills
          its container, so the axis labels scale evenly instead of being stretched sideways. */}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {bands.map((band, i) => (
          <rect
            key={i}
            x={PAD.left}
            y={y(Math.min(band.to, max))}
            width={plotW}
            height={Math.max(0, y(band.from) - y(Math.min(band.to, max)))}
            fill={TONE_COLOR[band.tone]}
            opacity="0.08"
          />
        ))}

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={y(t)}
              x2={W - PAD.right}
              y2={y(t)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 4}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="8"
              fill="var(--muted-foreground)"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}

        {MONTHS.map((label, i) => {
          const px = PAD.left + (dayOfYear(`${year}-${String(i + 1).padStart(2, '0')}-01`) / daysInYear) * plotW
          return (
            <text key={label} x={px} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--muted-foreground)">
              {label}
            </text>
          )
        })}

        <path d={area} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />

        {/* Index, not date+value: two readings on the same day with the same result are perfectly
            normal (before and after a treatment, or two apiaries at once) and would collide. */}
        {sorted.map((p, index) => (
          <circle
            key={index}
            cx={x(p.date)}
            cy={y(p.value)}
            r="3.5"
            fill={p.tone ? TONE_COLOR[p.tone] : 'var(--primary)'}
            stroke="var(--card)"
            strokeWidth="1.5"
          >
            <title>{`${p.label ?? p.date}: ${String(p.value).replace('.', ',')}${unit}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  )
}
