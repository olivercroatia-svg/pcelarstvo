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
