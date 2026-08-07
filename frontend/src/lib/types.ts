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
  | 'receipt'
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

// ──────────────────────────────────────────────── Etapa 3 — proizvodnja (§28–§36)

export interface Harvest {
  id: string
  apiaryId: string
  apiaryName: string | null
  harvestedOn: string
  pasture: string
  hiveRange: string | null
  framesCount: number | null
  notes: string | null
  hiveCount: number
  by: string | null
  createdAt: string
  /** Joined from the batch the extraction produced — the LOT is what a beekeeper searches by. */
  lotCode: string | null
  honeyType: string | null
  totalKg: number | null
  availableKg: number | null
}

export type BatchStatus = 'open' | 'ready' | 'blocked' | 'closed'

export interface HoneyBatch {
  id: string
  harvestId: string
  lotCode: string
  honeyType: string
  totalKg: number
  packedKg: number
  availableKg: number
  moisturePercent: number | null
  status: BatchStatus
  bestBefore: string | null
  notes: string | null
  harvestedOn: string | null
  pasture: string | null
  apiaryId: string | null
  apiaryName: string | null
  labTests: number
  packagingRuns: number
  jarsPacked: number
  createdAt: string
}

/** §67 — a treatment whose withdrawal period covered the day the honey was taken. */
export interface WithdrawalConflict {
  treatmentId: string
  productName: string
  startedOn: string | null
  endedOn: string | null
  withdrawalUntil: string | null
  kind: 'active' | 'open'
}

export interface HarvestContainer {
  id: string
  name: string
  amountKg: number
}

export interface HarvestDetail {
  harvest: Harvest
  batch: HoneyBatch | null
  hives: { id: string; code: string }[]
  containers: HarvestContainer[]
  containerTotalKg: number
  containerMismatchKg: number
  withdrawalConflicts: WithdrawalConflict[]
}

export type LabVerdict = 'pass' | 'fail' | 'unrated'

export interface LabParameter {
  code: string
  name: string
  unit: string | null
  minValue: number | null
  maxValue: number | null
  note: string | null
  decimals: number
  sortOrder: number
  active: boolean
}

export interface LabReading extends LabParameter {
  value: number | null
  verdict: LabVerdict
}

export interface LabTest {
  id: string
  batchId: string
  lotCode: string | null
  laboratory: string | null
  reportNumber: string | null
  sampledOn: string | null
  testedOn: string | null
  documentId: string | null
  notes: string | null
  readings: LabReading[]
  verdict: LabVerdict
  createdAt: string
}

export interface Product {
  id: string
  name: string
  honeyType: string | null
  netWeightG: number
  storageConditions: string | null
  countryOfOrigin: string | null
  shelfLifeMonths: number | null
  active: boolean
  notes: string | null
}

export interface PackagingRun {
  id: string
  batchId: string
  lotCode: string | null
  honeyType: string | null
  productId: string | null
  productName: string | null
  packagedOn: string
  jarSizeG: number
  jarCount: number
  /** §37 — maintained by the sales routes; remainingCount is generated in the database. */
  soldCount: number
  remainingCount: number
  totalKg: number
  remainingKg: number
  bestBefore: string | null
  isNational: boolean
  serialFrom: string | null
  serialTo: string | null
  publicToken: string | null
  notes: string | null
  createdAt: string
}

export interface Declaration {
  productName: string
  producer: string
  responsiblePerson: string | null
  oib: string | null
  address: string
  netWeightG: number
  countryOfOrigin: string
  lotCode: string
  honeyType: string
  harvestedOn: string | null
  packagedOn: string | null
  bestBefore: string | null
  storageConditions: string | null
  mandatoryNotice: string | null
  nationalNotice: string | null
  isNational: boolean
  serialFrom: string | null
  serialTo: string | null
  jarCount: number
}

export interface NationalReadiness {
  isNational: boolean
  ready: boolean
  checks: { key: string; label: string; ok: boolean; detail: string | null }[]
}

export type InventoryCategory = 'packaging' | 'vmp' | 'feed' | 'equipment' | 'other'

export interface InventoryItem {
  id: string
  category: InventoryCategory
  name: string
  unit: string
  quantity: number
  minQuantity: number | null
  low: boolean
  lotNumber: string | null
  expiresOn: string | null
  expired: boolean
  notes: string | null
}

export interface HoneyStock {
  honeyType: string
  availableKg: number
  totalKg: number
  packedKg: number
  batches: number
}

export interface InventoryMovement {
  id: string
  movedOn: string
  delta: number
  reason: string
  referenceType: string | null
  referenceId: string | null
  note: string | null
  by: string | null
  createdAt: string
}

/** §30 — the whole chain behind one jar. */
export interface TraceabilityChain {
  batch: {
    id: string
    lotCode: string
    honeyType: string
    totalKg: number
    packedKg: number
    availableKg: number
    moisturePercent: number | null
    status: BatchStatus
    bestBefore: string | null
  }
  harvest: {
    id: string
    harvestedOn: string
    pasture: string
    hiveRange: string | null
    framesCount: number | null
    containers: { name: string; amountKg: number }[]
  }
  apiary: { id: string; name: string }
  hives: { id: string; code: string; queenCode: string | null; queenYear: number | null; queenLine: string | null }[]
  treatments: {
    id: string
    productName: string
    activeSubstance: string | null
    lotNumber: string | null
    startedOn: string | null
    endedOn: string | null
    withdrawalUntil: string | null
  }[]
  withdrawalConflicts: WithdrawalConflict[]
  labTests: {
    id: string
    laboratory: string | null
    reportNumber: string | null
    testedOn: string | null
    documentId: string | null
    verdict: LabVerdict
    readings: LabReading[]
  }[]
  packaging: {
    id: string
    packagedOn: string
    productName: string | null
    jarSizeG: number
    jarCount: number
    totalKg: number
    isNational: boolean
    serialFrom: string | null
    serialTo: string | null
    published: boolean
    publicToken: string | null
  }[]
  /** §37 — empty for a worker, whose response never carries prices or customers (§4). */
  sales: {
    id: string
    saleId: string
    soldOn: string
    channel: string
    customerName: string | null
    kind: string
    description: string
    quantity: number
    unit: string
    lineTotal: number | null
    honeyKg: number
  }[]
}

/** §35 — everything the public jar page is allowed to know. Mirrors the server's SELECT list. */
export interface PublicJar {
  productName: string
  honeyType: string
  producer: string
  place: string | null
  harvestYear: number | null
  pasture: string
  lotCode: string
  laboratoryChecked: boolean
  netWeightG: number
  isNational: boolean
}

// ───────────────────────────────────────────────── Etapa 4 — komercijala, ekonomika, sezona

export type CustomerKind = 'person' | 'company' | 'shop' | 'restaurant' | 'distributor'

export interface Customer {
  id: string
  kind: CustomerKind
  name: string
  oib: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  contactPerson: string | null
  phone: string | null
  email: string | null
  notes: string | null
  active: boolean
  /** Only on the list response, which joins the totals. */
  salesCount?: number
  totalSpent?: number
  lastSaleOn?: string | null
}

export type SaleChannel = 'direct' | 'market' | 'shop' | 'restaurant' | 'distributor' | 'online' | 'other'
export type SalePayment = 'cash' | 'transfer' | 'card' | 'other'
export type SaleItemKind = 'jars' | 'bulk' | 'other'

export interface Sale {
  id: string
  customerId: string | null
  customerName: string | null
  soldOn: string
  channel: SaleChannel
  documentNumber: string | null
  payment: SalePayment
  paid: boolean
  notes: string | null
  total: number
  honeyKg: number
  itemCount: number
  createdAt: string
}

export interface SaleItem {
  id: string
  kind: SaleItemKind
  packagingId: string | null
  batchId: string | null
  lotCode: string | null
  honeyType: string | null
  description: string
  quantity: number
  unit: string
  unitPrice: number
  lineTotal: number
  honeyKg: number
}

/** What the §37 form may draw from. */
export interface SaleOptions {
  customers: { id: string; name: string; kind: CustomerKind }[]
  runs: {
    id: string
    lotCode: string
    honeyType: string
    productId: string | null
    productName: string | null
    jarSizeG: number
    jarCount: number
    soldCount: number
    remainingCount: number
    packagedOn: string | null
    bestBefore: string | null
  }[]
  batches: { id: string; lotCode: string; honeyType: string; availableKg: number }[]
}

export type ExpenseCategory =
  | 'sugar' | 'medicine' | 'fuel' | 'packaging' | 'foundation' | 'queens' | 'hives'
  | 'equipment' | 'transport' | 'laboratory' | 'membership' | 'labour' | 'other'

export interface Expense {
  id: string
  apiaryId: string | null
  apiaryName: string | null
  spentOn: string
  category: ExpenseCategory
  categoryLabel: string
  supplier: string | null
  description: string | null
  amount: number
  vatAmount: number | null
  documentId: string | null
  documentTitle: string | null
  notes: string | null
  createdAt: string
}

export interface ApiaryEconomics {
  apiaryId: string | null
  apiaryName: string
  revenue: number
  honeyRevenue: number
  expenses: number
  profit: number
  producedKg: number
  soldKg: number
  colonies: number
  kgPerColony: number | null
  costPerKg: number | null
  pricePerKg: number | null
}

export interface Economics {
  year: number
  years: number[]
  totals: Omit<ApiaryEconomics, 'apiaryId' | 'apiaryName'>
  apiaries: ApiaryEconomics[]
  expenseBreakdown: { category: string; label: string; total: number }[]
  monthlyRevenue: { month: number; total: number }[]
}

export interface HiveYield {
  hiveId: string
  code: string
  apiaryName: string | null
  kg: number
  harvests: number
  queenCode: string | null
  queenLine: string | null
  queenYear: number | null
}

export interface WinterLosses {
  season: string
  preparedOn: string
  checkedOn: string
  prepared: number
  survived: number
  lost: number
  lossPercent: number | null
  reasons: { reason: string; count: number }[]
}

export interface Analytics {
  year: number
  years: number[]
  hives: {
    top: HiveYield[]
    bottom: HiveYield[]
    all: HiveYield[]
    averageKg: number | null
    totalKg: number
    /** Always true — §41's figures are a harvest split evenly, never a per-hive weighing. */
    estimated: boolean
  }
  queenLines: { line: string; hives: number; averageKg: number; differencePercent: number | null }[]
  losses: { current: WinterLosses; previous: WinterLosses; reasonLabels: Record<string, string> }
}

export interface Pasture {
  id: string
  apiaryId: string | null
  apiaryName: string | null
  name: string
  seasonYear: number
  startsOn: string | null
  endsOn: string | null
  location: string | null
  coloniesCount: number | null
  expectedYieldKg: number | null
  /** Derived from the harvests, never typed in. */
  actualYieldKg: number
  harvests: number
  achievedPercent: number | null
  notes: string | null
}

export interface Permission {
  id: string
  grantedBy: string
  referenceNumber: string | null
  validFrom: string | null
  validUntil: string | null
  documentId: string | null
  documentTitle: string | null
  expired: boolean
  notes: string | null
}

export interface Relocation {
  id: string
  apiaryId: string
  apiaryName: string | null
  fromLocation: string | null
  toLocation: string
  toLatitude: number | null
  toLongitude: number | null
  pasture: string | null
  plannedOn: string
  completedOn: string | null
  coloniesCount: number | null
  transportArranged: boolean
  commissioner: string | null
  commissionerPhone: string | null
  status: 'planned' | 'done' | 'cancelled'
  notes: string | null
  permissions: Permission[]
  checks: { key: string; label: string; ok: boolean; detail: string | null }[]
  ready: boolean
}

export interface SeasonTask {
  id: string
  title: string
  detail: string | null
  region: string
  apiaryKind: string
}

export interface SeasonCalendar {
  month: number
  region: string
  migratory: boolean
  months: { month: number; tasks: SeasonTask[] }[]
}

export interface TimelineEntry {
  date: string
  type: string
  title: string
  detail: string | null
  link: string | null
}

export interface Timeline {
  from: string
  to: string
  days: { date: string; entries: TimelineEntry[] }[]
  total: number
}

export interface SearchHit {
  type: string
  typeLabel: string
  id: string
  title: string
  subtitle: string | null
  date: string | null
  link: string
}

export interface SearchResult {
  query: string
  term: string
  dateRange: string | null
  hits: SearchHit[]
}

export interface SubsidyProgram {
  id: string
  code: string
  name: string
  authority: string | null
  description: string | null
  year: number | null
  opensOn: string | null
  closesOn: string | null
  url: string | null
  appliesTo: string
  eligible: boolean
  closed: boolean
  requirements: {
    id: string
    label: string
    documentCategory: string | null
    required: boolean
    documentId: string | null
    documentTitle: string | null
  }[]
  documentPercent: number | null
  missing: string[]
  application: {
    id: string
    status: 'considering' | 'preparing' | 'submitted' | 'approved' | 'rejected' | 'withdrawn'
    submittedOn: string | null
    decisionOn: string | null
    amountRequested: number | null
    amountApproved: number | null
    notes: string | null
  } | null
}

export interface WeatherApiary {
  apiaryId: string
  apiaryName: string
  available: boolean
  current: {
    temperature: number
    humidity: number
    precipitation: number
    windSpeed: number
    code: number
    description: string
  } | null
  daily: {
    date: string
    min: number
    max: number
    precipitation: number
    windSpeed: number
    code: number
    description: string
  }[]
  advice: { level: 'ok' | 'caution' | 'warning'; text: string } | null
}

/** §49 — the annual report. The financial keys are absent for a worker, never null. */
export interface AnnualReport {
  year: number
  generatedOn: string
  includesFinancials: boolean
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
  apiaries: {
    id: string
    name: string
    kind: string
    place: string | null
    hives: number
    colonies: number
    permitNumber: string | null
    permitExpiresOn: string | null
  }[]
  summary: {
    apiaries: number
    colonies: number
    producedKg: number
    kgPerColony: number | null
    harvests: number
    treatments: number
    varroaChecks: number
    labTests: number
  }
  honeyTypes: { honeyType: string; kg: number; batches: number; share: number }[]
  harvests: {
    id: string
    harvestedOn: string
    pasture: string
    apiaryName: string
    lotCode: string | null
    honeyType: string | null
    totalKg: number | null
    moisturePercent: number | null
    hiveCount: number
    hiveRange: string | null
  }[]
  queens: {
    id: string
    code: string
    year: number | null
    line: string | null
    origin: string | null
    status: string
    colonies: number
  }[]
  treatments: {
    id: string
    productName: string
    activeSubstance: string | null
    lotNumber: string | null
    startedOn: string | null
    endedOn: string | null
    withdrawalUntil: string | null
    dose: string | null
    apiaryName: string
    hiveCount: number
  }[]
  varroa: {
    checkedOn: string | null
    apiaryName: string
    method: string
    phase: string
    mitesFound: number
    infestationPercent: number | null
    mitesPerDay: number | null
  }[]
  labTests: {
    id: string
    laboratory: string | null
    reportNumber: string | null
    sampledOn: string | null
    testedOn: string | null
    lotCode: string
    honeyType: string
  }[]
  losses: WinterLosses & { reasonLabels: Record<string, string> }
  hiveYields: { estimated: boolean; averageKg: number | null; top: HiveYield[] }
  sales?: { count: number; revenue: number; honeyKg: number }
  expenses?: { total: number; breakdown: { category: string; label: string; total: number; entries: number }[] }
  economics?: { profit: number; apiaries: ApiaryEconomics[] }
}
