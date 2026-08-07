export type ApiaryKind = 'stationary' | 'migratory'
export type ApiaryStatus = 'active' | 'planned_move' | 'inactive'

export interface Apiary {
  id: string
  name: string
  kind: ApiaryKind
  status: ApiaryStatus
  locationName: string | null
  address: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  hiveType: string | null
  establishedOn: string | null
  association: string | null
  pastureCommissioner: string | null
  permitNumber: string | null
  permitExpiresOn: string | null
  notes: string | null
  hiveCount?: number
  colonyCount?: number
}

export interface NearbyApiary {
  id: string
  name: string
  distanceMetres: number
}

export type HiveStatus = 'active' | 'empty' | 'merged' | 'lost' | 'sold'
export type Strength = 'weak' | 'medium' | 'strong' | 'very_strong'
export type Brood = 'none' | 'little' | 'normal' | 'plenty'
export type QueenState = 'seen' | 'eggs' | 'not_found'
export type Swarming = 'none' | 'cells' | 'high_risk'
export type Stores = 'poor' | 'good' | 'excellent'

export interface Hive {
  id: string
  code: string
  qrToken: string
  apiaryId: string | null
  apiaryName: string | null
  hiveType: string | null
  status: HiveStatus
  notes: string | null
  colony: { id: string; startedOn: string | null; queenId: string | null; queenCode: string | null } | null
  lastInspection: {
    at: string
    strength: Strength | null
    queenState: QueenState | null
    swarming: Swarming | null
  } | null
  daysSinceInspection: number | null
}

export interface Inspection {
  id: string
  inspectedAt: string
  strength: Strength | null
  framesBees: number | null
  framesBrood: number | null
  brood: Brood | null
  queenState: QueenState | null
  swarming: Swarming | null
  queenCells: number | null
  stores: Stores | null
  isBatch: boolean
  notes: string | null
  by: string | null
}

export interface ColonyPeriod {
  id: string
  startedOn: string | null
  endedOn: string | null
  endReason: string | null
  source: string | null
  queenCode: string | null
}

export type MarkingColor = 'white' | 'yellow' | 'red' | 'green' | 'blue'

export interface Queen {
  id: string
  code: string
  year: number | null
  markingColor: MarkingColor | null
  origin: string | null
  breeder: string | null
  line: string | null
  introducedOn: string | null
  matedOn: string | null
  ratingProductivity: number | null
  ratingCalmness: number | null
  ratingSwarming: number | null
  status: 'good' | 'watch' | 'replace'
  notes: string | null
  hive: { id: string; code: string } | null
  ageYears: number | null
}

export interface VisitSummary {
  id: string
  apiaryId: string
  apiaryName: string
  startedAt: string
  endedAt: string | null
  totalHives: number
  inspectedCount: number
  remaining: string[]
  queenless: string[]
  swarmRisk: string[]
  weak: string[]
}

export interface Photo {
  id: string
  caption: string | null
  width: number | null
  height: number | null
  createdAt: string
}

/** The observation payload shared by the single-hive form and the §60 batch flow. */
export interface Observation {
  strength?: Strength | null
  framesBees?: number | null
  framesBrood?: number | null
  brood?: Brood | null
  queenState?: QueenState | null
  swarming?: Swarming | null
  queenCells?: number | null
  stores?: Stores | null
  notes?: string | null
}

// ─────────────────────────────────────────── Etapa 2: zdravlje i zakon

export type VarroaMethod = 'natural_fall' | 'powdered_sugar' | 'alcohol_wash' | 'co2' | 'other'
export type VarroaPhase = 'before_treatment' | 'after_treatment' | 'routine'
export type VarroaLevel = 'low' | 'moderate' | 'high' | 'unknown'

export interface VarroaCheck {
  id: string
  apiaryId: string
  apiaryName: string | null
  hiveId: string | null
  hiveCode: string | null
  checkedOn: string
  method: VarroaMethod
  phase: VarroaPhase
  beesExamined: number | null
  daysObserved: number | null
  mitesFound: number
  infestationPercent: number | null
  mitesPerDay: number | null
  level: VarroaLevel
  notes: string | null
  by: string | null
}

export interface VarroaPoint {
  date: string
  value: number
  phase: VarroaPhase
  level: VarroaLevel
}

export interface VarroaResponse {
  checks: VarroaCheck[]
  year: number
  series: { sample: VarroaPoint[]; fall: VarroaPoint[] }
  thresholds: { sample: { moderate: number; high: number }; fall: { moderate: number; high: number } }
}

export interface VmpProduct {
  id: string
  name: string
  activeSubstance: string | null
  manufacturer: string | null
  form: string | null
  withdrawalDays: number | null
  defaultDose: string | null
  defaultMethod: string | null
  notes: string | null
}

export interface Treatment {
  id: string
  apiaryId: string
  apiaryName: string | null
  productName: string
  activeSubstance: string | null
  manufacturer: string | null
  lotNumber: string | null
  productExpiresOn: string | null
  startedOn: string
  endedOn: string | null
  dose: string | null
  applicationMethod: string | null
  reason: string | null
  withdrawalDays: number | null
  withdrawalUntil: string | null
  withdrawalActive: boolean
  coloniesTreated: number | null
  notes: string | null
  lockedAt: string | null
  hives: string[]
  by: string | null
}

export type HealthEventKind =
  | 'suspicion'
  | 'diagnosis'
  | 'symptom'
  | 'vet_visit'
  | 'lab_result'
  | 'mortality'
  | 'other'

export type Disease =
  | 'varroa'
  | 'american_foulbrood'
  | 'european_foulbrood'
  | 'nosema'
  | 'chalkbrood'
  | 'sacbrood'
  | 'small_hive_beetle'
  | 'tropilaelaps'
  | 'poisoning'
  | 'other'

export interface HealthEvent {
  id: string
  apiaryId: string | null
  apiaryName: string | null
  hiveId: string | null
  hiveCode: string | null
  kind: HealthEventKind
  disease: Disease | null
  severity: 'low' | 'medium' | 'high' | null
  observedOn: string
  title: string
  description: string | null
  vetName: string | null
  reportNumber: string | null
  reportedOn: string | null
  coloniesAffected: number | null
  coloniesLost: number | null
  resolvedOn: string | null
  by: string | null
}

export type FeedType = 'syrup' | 'sugar' | 'patty' | 'honey' | 'pollen_substitute' | 'other'

export interface Feeding {
  id: string
  apiaryId: string
  apiaryName: string | null
  hiveId: string | null
  hiveCode: string | null
  fedOn: string
  feedType: FeedType
  amountKg: number | null
  concentration: string | null
  reason: string | null
  notes: string | null
  by: string | null
}

export type ObligationLevel = 'ok' | 'caution' | 'warning' | 'critical' | 'info'
export type ObligationStatus = 'pending' | 'in_progress' | 'submitted' | 'not_applicable'

export interface ObligationCard {
  id: string
  ruleId: string
  code: string
  name: string
  kind: 'deadline' | 'continuous'
  legalBasis: string | null
  description: string | null
  warningText: string | null
  formCode: string | null
  documentCategory: string | null
  requiredAttachments: string[]
  reminderDays: number[]
  level: ObligationLevel
  statusLabel: string
  status: ObligationStatus | null
  periodYear: number | null
  windowStart: string | null
  dueOn: string | null
  daysLeft: number | null
  submittedOn: string | null
  referenceNumber: string | null
  documentId: string | null
  lastEntryOn: string | null
}

/** The admin-editable rule behind an obligation (§54). */
export interface ObligationRule {
  id: string
  code: string
  name: string
  legalBasis: string | null
  description: string | null
  warningText: string | null
  kind: 'deadline' | 'continuous'
  recurrence: 'annual' | 'once'
  windowStartMonth: number | null
  windowStartDay: number | null
  dueMonth: number | null
  dueDay: number | null
  fixedDueOn: string | null
  reminderDays: number[]
  continuousSource: 'vmp_treatments' | 'varroa_checks' | 'inspections' | 'health_events' | null
  continuousMaxDays: number | null
  appliesTo: 'all' | 'registered_epp' | 'migratory' | 'honey_producer' | 'food_business'
  minColonies: number | null
  formCode: string | null
  requiredAttachments: string[]
  documentCategory: string | null
  active: boolean
  sortOrder: number
  instanceCount?: number
}

export type DocumentCategory =
  | 'registration'
  | 'annual_report'
  | 'pasture'
  | 'veterinary'
  | 'food_safety'
  | 'laboratory'
  | 'subsidy'
  | 'other'

export interface ArchivedDocument {
  id: string
  category: DocumentCategory
  title: string
  description: string | null
  fileName: string | null
  mimeType: string | null
  sizeBytes: number | null
  hasFile: boolean
  issuedOn: string | null
  expiresOn: string | null
  expired: boolean
  referenceNumber: string | null
  issuer: string | null
  entityType: string | null
  entityId: string | null
  createdAt: string
}

export interface AppNotification {
  id: string
  kind: string
  severity: ObligationLevel
  title: string
  body: string | null
  link: string | null
  entityType: string | null
  entityId: string | null
  readAt: string | null
  createdAt: string
}

export interface FormFieldRow {
  label: string
  value: string | null
  source: 'app' | 'manual'
}

export type FormSection =
  | { kind: 'fields'; title: string; rows: FormFieldRow[] }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][]; note?: string }

export interface GeneratedForm {
  code: string
  title: string
  periodYear: number
  generatedOn: string
  disclaimer: string
  sections: FormSection[]
}

export interface CheckItem {
  label: string
  ok: boolean
  detail: string | null
  pending?: boolean
  link?: string
}

export interface ReadinessReport {
  percent: number
  passed: number
  total: number
  checks: CheckItem[]
  pending: CheckItem[]
}

export interface InspectionModeData {
  farm: {
    name: string
    holder: string
    entityType: string
    oib: string | null
    mibpg: string | null
    address: string | null
    city: string | null
    eppNumber: string | null
    association: string | null
    responsiblePerson: string | null
  }
  groups: { key: string; title: string; items: CheckItem[] }[]
  apiaries: {
    id: string
    name: string
    city: string | null
    kind: string
    colonies: number
    permitNumber: string | null
    permitExpiresOn: string | null
  }[]
  documents: {
    id: string
    category: DocumentCategory
    title: string
    referenceNumber: string | null
    issuedOn: string | null
    expiresOn: string | null
    hasFile: boolean
  }[]
  treatments: {
    id: string
    productName: string
    activeSubstance: string | null
    lotNumber: string | null
    startedOn: string
    endedOn: string | null
    withdrawalUntil: string | null
    locked: boolean
    apiaryName: string
  }[]
  generatedOn: string
}
