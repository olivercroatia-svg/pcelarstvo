import type {
  BatchStatus,
  CustomerKind,
  DocumentCategory,
  ObligationLevel,
  VarroaLevel,
} from './types'

export const BATCH_STATUS: Record<BatchStatus, { label: string; level: ObligationLevel }> = {
  open: { label: 'U obradi', level: 'info' },
  ready: { label: 'Spremno', level: 'ok' },
  blocked: { label: 'Zadržano', level: 'critical' },
  closed: { label: 'Zatvoreno', level: 'info' },
}

export const CUSTOMER_KIND_LABELS: Record<CustomerKind, string> = {
  person: 'Fizička osoba',
  company: 'Tvrtka',
  shop: 'Trgovina',
  restaurant: 'Restoran',
  distributor: 'Distributer',
}

export const CHANNEL_LABELS: Record<string, string> = {
  direct: 'Izravno',
  market: 'Sajam',
  shop: 'Trgovina',
  restaurant: 'Restoran',
  distributor: 'Distributer',
  online: 'Online',
  other: 'Ostalo',
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Gotovina',
  transfer: 'Transakcijski račun',
  card: 'Kartica',
  other: 'Ostalo',
}

export const RELOCATION_STATUS: Record<string, string> = {
  planned: 'Planirano',
  done: 'Obavljeno',
  cancelled: 'Otkazano',
}

export const SUBSIDY_STATUS_LABELS: Record<string, string> = {
  considering: 'Razmatram',
  preparing: 'Priprema',
  submitted: 'Predano',
  approved: 'Odobreno',
  rejected: 'Odbijeno',
  withdrawn: 'Povučeno',
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  registration: 'Registracija',
  annual_report: 'Godišnje dojave',
  pasture: 'Paše',
  veterinary: 'Veterina',
  food_safety: 'Hrana',
  laboratory: 'Laboratorij',
  subsidy: 'Potpore',
  receipt: 'Računi',
  other: 'Ostalo',
}

export const VARROA_METHOD_LABELS: Record<string, string> = {
  natural_fall: 'Prirodni pad',
  powdered_sugar: 'Šećer u prahu',
  alcohol_wash: 'Alkoholno ispiranje',
  co2: 'CO₂ metoda',
  other: 'Druga metoda',
}

export const VARROA_PHASE_LABELS: Record<string, string> = {
  before_treatment: 'prije tretmana',
  after_treatment: 'nakon tretmana',
  routine: 'redovna kontrola',
}

export function varroaLevelTone(level: VarroaLevel): ObligationLevel {
  return level === 'high' ? 'critical' : level === 'moderate' ? 'caution' : level === 'low' ? 'ok' : 'info'
}
