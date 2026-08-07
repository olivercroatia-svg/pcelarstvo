import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { asDate, asNumber, nullableText, requiredDate } from '../lib/schema.js'
import { isSampleMethod, levelFor, varroaThresholds, type VarroaMethod } from '../lib/varroa.js'
import { requireFarm } from '../middleware/farm.js'

export const varroaRouter = Router()
varroaRouter.use(requireFarm)

function mapCheck(row: RowDataPacket) {
  const method = row.method as VarroaMethod
  const infestationPercent = asNumber(row.infestation_percent)
  const mitesPerDay = asNumber(row.mites_per_day)
  return {
    id: row.id as string,
    apiaryId: row.apiary_id as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    hiveId: (row.hive_id as string | null) ?? null,
    hiveCode: (row.hive_code as string | null) ?? null,
    checkedOn: asDate(row.checked_on),
    method,
    phase: row.phase as string,
    beesExamined: asNumber(row.bees_examined),
    daysObserved: asNumber(row.days_observed),
    mitesFound: Number(row.mites_found),
    infestationPercent,
    mitesPerDay,
    level: levelFor(method, infestationPercent, mitesPerDay),
    notes: (row.notes as string | null) ?? null,
    by: row.by_name ? String(row.by_name).trim() : null,
  }
}

const CHECK_SELECT = `
  SELECT v.*, a.name AS apiary_name, h.code AS hive_code,
         CONCAT(u.first_name, ' ', u.last_name) AS by_name
    FROM varroa_checks v
    JOIN apiaries a ON a.id = v.apiary_id
    LEFT JOIN hives h ON h.id = v.hive_id
    LEFT JOIN users u ON u.id = v.created_by
`

/**
 * §16 — the list plus the year's series for the graph.
 *
 * The two series are returned separately because they are not comparable: `sample` carries the
 * percentage from washes and rolls, `fall` carries mites per day from board counts. Merging them
 * into one line would produce a chart that looks authoritative and says nothing.
 */
varroaRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        apiaryId: z.string().trim().min(1).optional(),
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query)

    const year = query.year ?? new Date().getFullYear()
    const filters: string[] = ['v.farm_id = ?', 'v.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.apiaryId) {
      filters.push('v.apiary_id = ?')
      params.push(query.apiaryId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${CHECK_SELECT} WHERE ${filters.join(' AND ')} ORDER BY v.checked_on DESC, v.created_at DESC LIMIT ?`,
      [...params, query.limit],
    )

    const [seriesRows] = await pool.query<RowDataPacket[]>(
      `${CHECK_SELECT} WHERE ${filters.join(' AND ')} AND YEAR(v.checked_on) = ?
        ORDER BY v.checked_on`,
      [...params, year],
    )
    const series = seriesRows.map(mapCheck)

    res.json({
      checks: rows.map(mapCheck),
      year,
      series: {
        sample: series
          .filter((c) => isSampleMethod(c.method) && c.infestationPercent !== null)
          .map((c) => ({ date: c.checkedOn, value: c.infestationPercent, phase: c.phase, level: c.level })),
        fall: series
          .filter((c) => c.method === 'natural_fall' && c.mitesPerDay !== null)
          .map((c) => ({ date: c.checkedOn, value: c.mitesPerDay, phase: c.phase, level: c.level })),
      },
      thresholds: varroaThresholds,
    })
  }),
)

const createSchema = z
  .object({
    // Client-generated, same offline contract as inspections (§3).
    id: z.uuid({ message: 'Neispravan identifikator zapisa' }),
    apiaryId: z.string().trim().min(1, 'Odaberite pčelinjak'),
    hiveId: z.string().trim().min(1).nullish(),
    checkedOn: requiredDate,
    method: z.enum(['natural_fall', 'powdered_sugar', 'alcohol_wash', 'co2', 'other']),
    phase: z.enum(['before_treatment', 'after_treatment', 'routine']).default('routine'),
    beesExamined: z.coerce.number().int().min(1).max(5000).nullish(),
    daysObserved: z.coerce.number().int().min(1).max(60).nullish(),
    mitesFound: z.coerce.number().int().min(0).max(10000),
    notes: nullableText(2000),
  })
  // The result is only meaningful with its denominator: 9 mites is 3 % of 300 bees and 9 % of 100.
  // Enforced here rather than left to the generated column, which would happily store NULL.
  .refine((d) => d.method !== 'natural_fall' || d.daysObserved != null, {
    message: 'Za prirodni pad unesite broj dana promatranja',
    path: ['daysObserved'],
  })
  .refine((d) => d.method === 'natural_fall' || d.beesExamined != null, {
    message: 'Unesite broj pregledanih pčela',
    path: ['beesExamined'],
  })

varroaRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createSchema.parse(req.body)

    const [apiaries] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [data.apiaryId, farmId],
    )
    if (apiaries.length === 0) throw notFound('Pčelinjak nije pronađen')

    if (data.hiveId) {
      const [hives] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM hives WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
        [data.hiveId, farmId],
      )
      if (hives.length === 0) throw notFound('Košnica nije pronađena')
    }

    let duplicate = false
    try {
      await pool.query(
        `INSERT INTO varroa_checks
           (id, farm_id, apiary_id, hive_id, checked_on, method, phase,
            bees_examined, days_observed, mites_found, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.id,
          farmId,
          data.apiaryId,
          data.hiveId ?? null,
          data.checkedOn,
          data.method,
          data.phase,
          data.beesExamined ?? null,
          data.daysObserved ?? null,
          data.mitesFound,
          data.notes ?? null,
          req.user!.id,
        ],
      )
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err
      duplicate = true
    }

    const [rows] = await pool.query<RowDataPacket[]>(`${CHECK_SELECT} WHERE v.id = ? AND v.farm_id = ?`, [
      data.id,
      farmId,
    ])
    if (rows.length === 0) throw badRequest('Zapis nije spremljen')

    if (!duplicate) {
      await writeAudit(req, {
        userId: req.user!.id,
        farmId,
        action: 'varroa.create',
        entityType: 'varroa_check',
        entityId: data.id,
        after: mapCheck(rows[0]!),
      })
    }

    res.status(duplicate ? 200 : 201).json({ check: mapCheck(rows[0]!), duplicate })
  }),
)
