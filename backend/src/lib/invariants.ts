import { badRequest, conflict } from './http.js'

/** A LOT total must cover every quantity that has already left bulk stock. */
export function validateBatchTotal(totalKg: number, packedKg: number, soldBulkKg: number): void {
  const committedKg = Number((packedKg + soldBulkKg).toFixed(2))
  if (totalKg < committedKg) {
    throw badRequest(
      `Ukupna količina ne može biti manja od već evidentiranih ${committedKg} kg`,
      'below_committed',
    )
  }
}

export function validateInventoryDraw(name: string, available: number, requested: number): void {
  if (requested > available) {
    throw conflict(
      `Na skladištu je ${available} ${name}, a pakiranje traži ${requested}`,
      'insufficient_material',
    )
  }
}

/** Shared by treatment create and update so partial edits cannot bypass date ordering. */
export function validateTreatmentDates(startedOn: string, endedOn: string | null | undefined): void {
  if (endedOn && endedOn < startedOn) {
    throw badRequest('Završetak ne može biti prije početka', 'invalid_dates')
  }
}
