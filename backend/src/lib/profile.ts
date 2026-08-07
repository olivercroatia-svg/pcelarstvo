import type { RowDataPacket } from 'mysql2'

/**
 * §5: "Nije potrebno da korisnik odmah popuni sve podatke" — registration stays short and the app
 * nudges instead, showing "Profil 65 % dovršen" plus what is still missing.
 *
 * Each entry is one thing the user can go and fill in. Weighting them all equally keeps the number
 * honest: a field is either there or it is not.
 */
interface ProfileField {
  key: string
  label: string
  filled: boolean
}

export interface ProfileCompleteness {
  percent: number
  missing: { key: string; label: string }[]
}

const has = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim().length > 0

export function computeCompleteness(user: RowDataPacket, farm: RowDataPacket | undefined): ProfileCompleteness {
  const isBusiness = farm?.entity_type !== 'individual'

  const fields: ProfileField[] = [
    { key: 'firstName', label: 'Ime', filled: has(user.first_name) },
    { key: 'lastName', label: 'Prezime', filled: has(user.last_name) },
    { key: 'phone', label: 'Telefon', filled: has(user.phone) },
    { key: 'oib', label: 'OIB', filled: has(farm?.oib) },
    { key: 'address', label: 'Adresa', filled: has(farm?.address) },
    { key: 'city', label: 'Mjesto', filled: has(farm?.city) },
    { key: 'postalCode', label: 'Poštanski broj', filled: has(farm?.postal_code) },
    { key: 'eppNumber', label: 'EPP broj', filled: has(farm?.epp_number) },
    { key: 'apiaryCount', label: 'Broj pčelinjaka', filled: has(farm?.apiary_count) },
    { key: 'colonyCount', label: 'Broj zajednica', filled: has(farm?.colony_count) },
    { key: 'association', label: 'Pčelarska udruga', filled: has(farm?.association) },
    { key: 'pastureCommissioner', label: 'Pašni povjerenik', filled: has(farm?.pasture_commissioner) },
  ]

  if (isBusiness) {
    fields.push(
      { key: 'name', label: 'Naziv gospodarstva', filled: has(farm?.name) },
      { key: 'responsiblePerson', label: 'Odgovorna osoba', filled: has(farm?.responsible_person) },
    )
  }

  const filled = fields.filter((f) => f.filled).length
  return {
    percent: Math.round((filled / fields.length) * 100),
    missing: fields.filter((f) => !f.filled).map(({ key, label }) => ({ key, label })),
  }
}
