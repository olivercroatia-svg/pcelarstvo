import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ChoiceOption<T extends string> {
  value: T
  label: string
  /** Optional tint for states that carry meaning on their own (queenless, high swarm risk). */
  tone?: 'default' | 'critical' | 'warning' | 'ok'
}

interface ChoiceGroupProps<T extends string> {
  label: string
  options: ChoiceOption<T>[]
  value: T | null | undefined
  onChange: (value: T | null) => void
  /** Tapping the selected option clears it — nothing observed is different from "weak". */
  clearable?: boolean
}

const TONE_SELECTED: Record<NonNullable<ChoiceOption<string>['tone']>, string> = {
  default: 'bg-primary text-primary-foreground border-primary',
  critical: 'bg-critical text-white border-critical',
  warning: 'bg-warning text-white border-warning',
  ok: 'bg-ok text-white border-ok',
}

/**
 * The big tap-target selector the field screens are built from (§12, §59).
 *
 * Buttons rather than a native <select>: one thumb, gloves on, standing over an open hive. A
 * dropdown costs two taps and a scroll; this costs one tap and never opens a system sheet that
 * covers the rest of the form.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  clearable = true,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
        {options.map((option) => {
          const selected = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected && clearable ? null : option.value)}
              className={cn(
                'min-h-14 rounded-xl border px-2 text-sm font-medium transition-colors',
                selected
                  ? TONE_SELECTED[option.tone ?? 'default']
                  : 'border-border bg-card hover:bg-accent active:bg-accent/70',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

interface StepperProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
}

/** −/+ counter for frame counts. Typing a number one-handed over an open hive is not realistic. */
export function Stepper({ label, value, onChange, min = 0, max = 40 }: StepperProps) {
  const current = value ?? 0
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${label} — smanji`}
          onClick={() => onChange(clamp(current - 1))}
          disabled={value !== null && current <= min}
          className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border bg-card disabled:opacity-40"
        >
          <Minus className="size-6" />
        </button>
        <div className="flex-1 text-center">
          <span className="tabular text-3xl font-semibold">{value === null ? '–' : value}</span>
        </div>
        <button
          type="button"
          aria-label={`${label} — povećaj`}
          onClick={() => onChange(clamp(current + 1))}
          disabled={current >= max}
          className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border bg-card disabled:opacity-40"
        >
          <Plus className="size-6" />
        </button>
      </div>
    </div>
  )
}
