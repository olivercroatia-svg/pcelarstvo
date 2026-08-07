import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { nearestApiaries } from '../lib/geo.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

export const apiariesRouter = Router()
apiariesRouter.use(requireFarm)

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))

// Empty string is what an untouched <input type="date"> submits; treat it as "not set" rather
// than letting MySQL reject '' as an invalid date.
const nullableDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan datum')
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => (v === undefined ? undefined : v || null))

const coordinate = (min: number, max: number) =>
  z.coerce.number().min(min).max(max).nullish().transform((v) => (v === undefined ? undefined : v ?? null))

const apiaryFields = {
  name: z.string().trim().min(2, 'Unesite naziv pčelinjaka').max(150),
  kind: z.enum(['stationary', 'migratory']),
  status: z.enum(['active', 'planned_move', 'inactive']),
  locationName: nullableText(200),
  address: nullableText(255),
  city: nullableText(120),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
  hiveType: nullableText(60),
  establishedOn: nullableDate,
  association: nullableText(200),
  pastureCommissioner: nullableText(200),
  permitNumber: nullableText(100),
  permitExpiresOn: nullableDate,
  notes: nullableText(4000),
}

const createSchema = z.object({
  ...apiaryFields,
  kind: apiaryFields.kind.default('stationary'),
  status: apiaryFields.status.default('active'),
})

const updateSchema = z.object({
  ...apiaryFields,
  name: apiaryFields.name.optional(),
  kind: apiaryFields.kind.optional(),
  status: apiaryFields.status.optional(),
})

const COLUMNS: Record<string, string> = {
  name: 'name',
  kind: 'kind',
  status: 'status',
  locationName: 'location_name',
  address: 'address',
  city: 'city',
  latitude: 'latitude',
  longitude: 'longitude',
  hiveType: 'hive_type',
  establishedOn: 'established_on',
  association: 'association',
  pastureCommissioner: 'pasture_commissioner',
  permitNumber: 'permit_number',
  permitExpiresOn: 'permit_expires_on',
  notes: 'notes',
}

const asDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))
const asNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function mapApiary(row: RowDataPacket) {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as string,
    status: row.status as string,
    locationName: (row.location_name as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    // mysql2 hands DECIMAL back as a string to avoid precision loss; the API speaks numbers.
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
    hiveType: (row.hive_type as string | null) ?? null,
    establishedOn: asDate(row.established_on),
    association: (row.association as string | null) ?? null,
    pastureCommissioner: (row.pasture_commissioner as string | null) ?? null,
    permitNumber: (row.permit_number as string | null) ?? null,
    permitExpiresOn: asDate(row.permit_expires_on),
    notes: (row.notes as string | null) ?? null,
    hiveCount: row.hive_count === undefined ? undefined : Number(row.hive_count),
    colonyCount: row.colony_count === undefined ? undefined : Number(row.colony_count),
  }
}

/** §7 — the apiary list, each row carrying its live hive and colony counts. */
apiariesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.*,
              (SELECT COUNT(*) FROM hives h
                WHERE h.apiary_id = a.id AND h.deleted_at IS NULL) AS hive_count,
              (SELECT COUNT(*) FROM hives h
                 JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
                WHERE h.apiary_id = a.id AND h.deleted_at IS NULL) AS colony_count
         FROM apiaries a
        WHERE a.farm_id = ? AND a.deleted_at IS NULL
        ORDER BY a.name`,
      [req.farm!.id],
    )
    res.json({ apiaries: rows.map(mapApiary) })
  }),
)

async function loadApiary(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Pčelinjak nije pronađen')
  return row
}

/** §8 — the apiary card, plus the informational proximity readout from §9. */
apiariesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const apiary = await loadApiary(farmId, req.params.id)

    const [others] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, latitude, longitude FROM apiaries
        WHERE farm_id = ? AND id <> ? AND deleted_at IS NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      [farmId, apiary.id],
    )

    const [[counts]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS hive_count,
              SUM(c.id IS NOT NULL) AS colony_count
         FROM hives h
         LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
        WHERE h.apiary_id = ? AND h.deleted_at IS NULL`,
      [apiary.id],
    )

    const lat = asNumber(apiary.latitude)
    const lon = asNumber(apiary.longitude)

    res.json({
      apiary: mapApiary({ ...apiary, ...counts } as RowDataPacket),
      nearbyApiaries:
        lat !== null && lon !== null
          ? nearestApiaries(
              lat,
              lon,
              others.map((o) => ({
                id: o.id as string,
                name: o.name as string,
                latitude: asNumber(o.latitude),
                longitude: asNumber(o.longitude),
              })),
            )
          : [],
    })
  }),
)

apiariesRouter.post(
  '/',
  requireOwner,
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body)
    const id = newId()

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    await pool.query(
      `INSERT INTO apiaries (id, farm_id, ${entries.map(([k]) => COLUMNS[k]).join(', ')})
       VALUES (?, ?, ${entries.map(() => '?').join(', ')})`,
      [id, req.farm!.id, ...entries.map(([, v]) => v)],
    )

    await writeAudit(req, {
      userId: req.user!.id,
      farmId: req.farm!.id,
      action: 'apiary.create',
      entityType: 'apiary',
      entityId: id,
      after: data,
    })

    res.status(201).json({ apiary: mapApiary(await loadApiary(req.farm!.id, id)) })
  }),
)

apiariesRouter.patch(
  '/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadApiary(farmId, req.params.id)
    const data = updateSchema.parse(req.body)

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    if (entries.length > 0) {
      await pool.query(
        `UPDATE apiaries SET ${entries.map(([k]) => `${COLUMNS[k]} = ?`).join(', ')}
          WHERE id = ? AND farm_id = ?`,
        [...entries.map(([, v]) => v), before.id, farmId],
      )
    }

    const after = await loadApiary(farmId, before.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'apiary.update',
      entityType: 'apiary',
      entityId: before.id,
      before: mapApiary(before),
      after: mapApiary(after),
    })

    res.json({ apiary: mapApiary(after) })
  }),
)

/**
 * Soft delete. The apiary's hives keep pointing at it so historical inspections still name where
 * they happened — an inspector asking "where was this hive in 2026" must get an answer.
 */
apiariesRouter.delete(
  '/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const apiary = await loadApiary(farmId, req.params.id)

    await pool.query('UPDATE apiaries SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [
      apiary.id,
      farmId,
    ])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'apiary.delete',
      entityType: 'apiary',
      entityId: apiary.id,
      before: mapApiary(apiary),
    })

    res.status(204).end()
  }),
)
