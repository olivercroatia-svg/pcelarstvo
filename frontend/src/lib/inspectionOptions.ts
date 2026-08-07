import type { Brood, QueenState, Stores, Strength, Swarming } from './types'

/**
 * The §12 observation vocabulary, in one place.
 *
 * Extracted from pages/Inspection.tsx when §13 gave it a second reader: the voice draft renders
 * the same fields as the manual form, and two copies of these labels would eventually disagree —
 * a beekeeper reading "Jaka" on one screen and "Jako" on the other has been given two vocabularies
 * for one observation. The enum values are the API contract; the labels are what a thumb reads.
 */

export const STRENGTH_OPTIONS = [
  { value: 'weak' as Strength, label: 'Slaba', tone: 'warning' as const },
  { value: 'medium' as Strength, label: 'Srednja' },
  { value: 'strong' as Strength, label: 'Jaka' },
  { value: 'very_strong' as Strength, label: 'Vrlo jaka' },
]

export const BROOD_OPTIONS = [
  { value: 'none' as Brood, label: 'Nema', tone: 'warning' as const },
  { value: 'little' as Brood, label: 'Malo' },
  { value: 'normal' as Brood, label: 'Normalno' },
  { value: 'plenty' as Brood, label: 'Puno' },
]

export const QUEEN_OPTIONS = [
  { value: 'seen' as QueenState, label: 'Viđena', tone: 'ok' as const },
  { value: 'eggs' as QueenState, label: 'Jaja prisutna', tone: 'ok' as const },
  { value: 'not_found' as QueenState, label: 'Nije pronađena', tone: 'critical' as const },
]

export const SWARM_OPTIONS = [
  { value: 'none' as Swarming, label: 'Nema znakova', tone: 'ok' as const },
  { value: 'cells' as Swarming, label: 'Matičnjaci', tone: 'warning' as const },
  { value: 'high_risk' as Swarming, label: 'Visok rizik', tone: 'critical' as const },
]

export const STORES_OPTIONS = [
  { value: 'poor' as Stores, label: 'Slabe', tone: 'warning' as const },
  { value: 'good' as Stores, label: 'Dobre' },
  { value: 'excellent' as Stores, label: 'Odlične' },
]
