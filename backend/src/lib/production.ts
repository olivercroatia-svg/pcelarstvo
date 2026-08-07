import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db.js'
import { asDate, asNumber } from './schema.js'

/**
 * The cross-checks that make §67 more than a list of screens.
 *
 * Everything here reads across module boundaries on purpose — a harvest asks the treatment
 * register whether it was legal, a laboratory result asks an administrator's thresholds whether it
 * passed. Kept in one place so the same question always gets the same answer whether it is asked
 * by the batch card, the traceability chain or the inspection screen.
 */

// ─────────────────────────────────────────────── §17 × §28 — harvesting during a withdrawal period

export interface WithdrawalConflict {
  treatmentId: string
  productName: string
  startedOn: string | null
  endedOn: string | null
  withdrawalUntil: string | null
  /** open = the treatment was never closed, so the withdrawal period cannot even be calculated. */
  kind: 'active' | 'open'
}

/**
 * Treatments on this apiary whose withdrawal period covered the day the honey was extracted.
 *
 * This is the single most valuable thing the application does that a notebook cannot: the
 * beekeeper records a treatment in May and an extraction in June, and nothing in a paper register
 * ever puts those two pages side by side. Here it is one query, and the answer is shown on the
 * batch, on the jar's traceability chain and in the inspection readiness list.
 *
 * It warns, it does not block. The beekeeper may have moved the supers before treating, or be
 * recording history after the fact, and an application that refuses the entry just gets the entry
 * recorded somewhere else.
 */
export async function withdrawalConflicts(
  farmId: string,
  apiaryId: string,
  harvestedOn: string,
): Promise<WithdrawalConflict[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, product_name, started_on, ended_on, withdrawal_until
       FROM veterinary_treatments
      WHERE farm_id = ? AND apiary_id = ? AND deleted_at IS NULL
        AND started_on <= ?
        AND (
              withdrawal_until >= ?
              -- A treatment with no end date has no calculable withdrawal period. Only flagged
              -- within a season of the harvest: an unclosed treatment from three years ago is a
              -- gap in the register, not a warning about this jar.
              OR (ended_on IS NULL AND withdrawal_days IS NOT NULL AND started_on >= DATE_SUB(?, INTERVAL 180 DAY))
            )
      ORDER BY started_on DESC`,
    [farmId, apiaryId, harvestedOn, harvestedOn, harvestedOn],
  )

  return rows.map((row) => ({
    treatmentId: row.id as string,
    productName: row.product_name as string,
    startedOn: asDate(row.started_on),
    endedOn: asDate(row.ended_on),
    withdrawalUntil: asDate(row.withdrawal_until),
    kind: row.ended_on === null ? 'open' : 'active',
  }))
}

// ─────────────────────────────────────────────── §31 — laboratory parameters and their verdict

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

export function mapLabParameter(row: RowDataPacket): LabParameter {
  return {
    code: row.code as string,
    name: row.name as string,
    unit: (row.unit as string | null) ?? null,
    minValue: asNumber(row.min_value),
    maxValue: asNumber(row.max_value),
    note: (row.note as string | null) ?? null,
    decimals: Number(row.decimals),
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
  }
}

export async function loadLabParameters(includeInactive = false): Promise<LabParameter[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM lab_parameters ${includeInactive ? '' : 'WHERE active = TRUE'} ORDER BY sort_order, name`,
  )
  return rows.map(mapLabParameter)
}

export type LabVerdict = 'pass' | 'fail' | 'unrated'

export interface LabReading extends LabParameter {
  value: number | null
  verdict: LabVerdict
}

/**
 * `unrated` rather than `pass` when a parameter has no threshold. Fructose and glucose are
 * reported by every laboratory but judged as a sum against the honey type, which is a decision
 * this application is not in a position to make — so it shows the number and stays quiet.
 */
export function evaluate(value: number | null, param: LabParameter): LabVerdict {
  if (value === null) return 'unrated'
  if (param.minValue === null && param.maxValue === null) return 'unrated'
  if (param.minValue !== null && value < param.minValue) return 'fail'
  if (param.maxValue !== null && value > param.maxValue) return 'fail'
  return 'pass'
}

/** Joins measured values onto the parameter definitions, in the administrator's display order. */
export function buildReadings(
  parameters: LabParameter[],
  values: Map<string, number>,
): LabReading[] {
  return parameters
    .filter((p) => p.active || values.has(p.code))
    .map((p) => {
      const value = values.get(p.code) ?? null
      return { ...p, value, verdict: evaluate(value, p) }
    })
}

export function overallVerdict(readings: LabReading[]): LabVerdict {
  const rated = readings.filter((r) => r.verdict !== 'unrated')
  if (rated.length === 0) return 'unrated'
  return rated.some((r) => r.verdict === 'fail') ? 'fail' : 'pass'
}

// ─────────────────────────────────────────────── §32 — honey stock, summed rather than stored

export interface HoneyStockRow {
  honeyType: string
  availableKg: number
  totalKg: number
  packedKg: number
  batches: number
}

/**
 * §32's "Med — Kadulja 286 kg, Bagrem 430 kg, Kesten 118 kg".
 *
 * Summed from the batches every time it is asked for. See the note in 005_production.sql: an
 * editable honey figure and a set of LOTs that add up to something else is the kind of
 * disagreement nobody notices until an inspector does.
 */
export async function honeyStock(farmId: string): Promise<HoneyStockRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT honey_type,
            SUM(available_kg) AS available_kg,
            SUM(total_kg)     AS total_kg,
            SUM(packed_kg)    AS packed_kg,
            COUNT(*)          AS batches
       FROM honey_batches
      WHERE farm_id = ? AND deleted_at IS NULL AND status <> 'closed'
      GROUP BY honey_type
      ORDER BY available_kg DESC`,
    [farmId],
  )

  return rows.map((row) => ({
    honeyType: row.honey_type as string,
    availableKg: Number(row.available_kg ?? 0),
    totalKg: Number(row.total_kg ?? 0),
    packedKg: Number(row.packed_kg ?? 0),
    batches: Number(row.batches),
  }))
}
