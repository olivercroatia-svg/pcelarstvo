export type VarroaMethod = 'natural_fall' | 'powdered_sugar' | 'alcohol_wash' | 'co2' | 'other'
export type VarroaLevel = 'low' | 'moderate' | 'high' | 'unknown'

/**
 * §16 — "prikazuje rezultat prema unaprijed definiranim stručnim pravilima".
 *
 * Two separate scales, because the methods measure two different things:
 *
 *   washes and rolls  →  mites per 100 bees, i.e. a percentage of the sampled bees
 *   natural fall      →  mites per day on the board, which says nothing about colony size
 *
 * The figures below are the orientation values in common use, not a regulation. They live here,
 * in one place, precisely so they can be adjusted without hunting through screens — and every
 * screen that shows a level also shows the §55 disclaimer.
 *
 * Natural fall in particular is season-dependent: the same 8 mites a day mean something very
 * different in May than in September. That caveat is carried in the UI rather than hidden by
 * pretending the number has one meaning.
 */
const SAMPLE_THRESHOLDS = { moderate: 1, high: 3 } // % of sampled bees
const FALL_THRESHOLDS = { moderate: 3, high: 10 } // mites per day

export function levelForSample(infestationPercent: number | null): VarroaLevel {
  if (infestationPercent === null) return 'unknown'
  if (infestationPercent >= SAMPLE_THRESHOLDS.high) return 'high'
  if (infestationPercent >= SAMPLE_THRESHOLDS.moderate) return 'moderate'
  return 'low'
}

export function levelForFall(mitesPerDay: number | null): VarroaLevel {
  if (mitesPerDay === null) return 'unknown'
  if (mitesPerDay >= FALL_THRESHOLDS.high) return 'high'
  if (mitesPerDay >= FALL_THRESHOLDS.moderate) return 'moderate'
  return 'low'
}

export function levelFor(
  method: VarroaMethod,
  infestationPercent: number | null,
  mitesPerDay: number | null,
): VarroaLevel {
  return method === 'natural_fall' ? levelForFall(mitesPerDay) : levelForSample(infestationPercent)
}

/** True when the method counts mites against a sample of bees and so yields a percentage. */
export function isSampleMethod(method: VarroaMethod): boolean {
  return method !== 'natural_fall'
}

export const varroaThresholds = { sample: SAMPLE_THRESHOLDS, fall: FALL_THRESHOLDS }
