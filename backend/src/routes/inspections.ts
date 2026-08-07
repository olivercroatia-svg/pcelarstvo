import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { assertFarmReference } from '../lib/ownership.js'
import { requireFarm } from '../middleware/farm.js'

export const inspectionsRouter = Router()
inspectionsRouter.use(requireFarm)

const observationFields = {
  strength: z.enum(['weak', 'medium', 'strong', 'very_strong']).nullish(),
  framesBees: z.coerce.number().int().min(0).max(60).nullish(),
  framesBrood: z.coerce.number().int().min(0).max(60).nullish(),
  brood: z.enum(['none', 'little', 'normal', 'plenty']).nullish(),
  queenState: z.enum(['seen', 'eggs', 'not_found']).nullish(),
  swarming: z.enum(['none', 'cells', 'high_risk']).nullish(),
  queenCells: z.coerce.number().int().min(0).max(200).nullish(),
  stores: z.enum(['poor', 'good', 'excellent']).nullish(),
  notes: z
    .string()
    .trim()
    .max(4000)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null)),
}

const createSchema = z.object({
  // Supplied by the client, not the server. This is the whole basis of offline safety: the phone
  // mints the UUIDv7 while still on the hillside, so replaying a queued entry collides on the
  // primary key instead of writing the same inspection twice.
  id: z.uuid({ message: 'Neispravan identifikator zapisa' }),
  hiveId: z.string().trim().min(1),
  visitId: z.string().trim().min(1).nullish(),
  // ISO timestamp from the device — an entry made at 09:41 in a dead spot must not be stamped
  // with the time the signal came back.
  inspectedAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
  ...observationFields,
})

interface InsertableInspection {
  id: string
  hiveId: string
  colonyId: string | null
  visitId: string | null
  inspectedAt: string
  isBatch: boolean
}

async function insertInspection(
  farmId: string,
  userId: string,
  row: InsertableInspection,
  obs: Record<string, unknown>,
): Promise<'created' | 'duplicate'> {
  try {
    await pool.query(
      `INSERT INTO hive_inspections
         (id, farm_id, hive_id, colony_id, visit_id, user_id, inspected_at,
          strength, frames_bees, frames_brood, brood, queen_state, swarming, queen_cells,
          stores, is_batch, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        farmId,
        row.hiveId,
        row.colonyId,
        row.visitId,
        userId,
        new Date(row.inspectedAt),
        obs.strength ?? null,
        obs.framesBees ?? null,
        obs.framesBrood ?? null,
        obs.brood ?? null,
        obs.queenState ?? null,
        obs.swarming ?? null,
        obs.queenCells ?? null,
        obs.stores ?? null,
        row.isBatch,
        obs.notes ?? null,
      ],
    )
    return 'created'
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return 'duplicate'
    throw err
  }
}

async function loadHiveForWrite(farmId: string, hiveId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.code, c.id AS colony_id
       FROM hives h
       LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
      WHERE h.id = ? AND h.farm_id = ? AND h.deleted_at IS NULL
      LIMIT 1`,
    [hiveId, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Košnica nije pronađena')
  return { id: row.id as string, code: row.code as string, colonyId: (row.colony_id as string | null) ?? null }
}

/**
 * §12 — one hive, one entry.
 *
 * Replays return 200 with `duplicate: true` rather than an error: the outbox has no way to know
 * whether a request that timed out actually landed, and treating "already recorded" as success is
 * what stops it retrying forever.
 */
inspectionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createSchema.parse(req.body)
    const hive = await loadHiveForWrite(farmId, data.hiveId)
    await assertFarmReference(pool, 'visit', data.visitId, farmId)

    const outcome = await insertInspection(
      farmId,
      req.user!.id,
      {
        id: data.id,
        hiveId: hive.id,
        colonyId: hive.colonyId,
        visitId: data.visitId ?? null,
        inspectedAt: data.inspectedAt,
        isBatch: false,
      },
      data,
    )

    if (outcome === 'created') {
      await writeAudit(req, {
        userId: req.user!.id,
        farmId,
        action: 'inspection.create',
        entityType: 'hive_inspection',
        entityId: data.id,
        after: { hive: hive.code, inspectedAt: data.inspectedAt },
      })
    }

    res.status(outcome === 'created' ? 201 : 200).json({ id: data.id, duplicate: outcome === 'duplicate' })
  }),
)

const batchSchema = z.object({
  hiveIds: z.array(z.string().trim().min(1)).min(1, 'Odaberite barem jednu košnicu').max(500),
  /** One client-generated id per hive, in the same order — keeps the batch replay-safe too. */
  ids: z.array(z.uuid()).min(1).max(500),
  visitId: z.string().trim().min(1).nullish(),
  inspectedAt: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
  ...observationFields,
})

/**
 * §60 — the same observation applied to a range of hives, but written as one row per colony so
 * each hive's own history stays complete. A treatment round over 50 hives must not become a
 * single record that no individual hive card can show.
 */
inspectionsRouter.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = batchSchema.parse(req.body)
    await assertFarmReference(pool, 'visit', data.visitId, farmId)
    if (data.ids.length !== data.hiveIds.length) {
      throw badRequest('Broj identifikatora ne odgovara broju košnica')
    }

    const [owned] = await pool.query<RowDataPacket[]>(
      `SELECT h.id, c.id AS colony_id
         FROM hives h
         LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
        WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.id IN (?)`,
      [farmId, data.hiveIds],
    )
    const colonyByHive = new Map(owned.map((r) => [r.id as string, (r.colony_id as string | null) ?? null]))

    let created = 0
    let duplicates = 0
    const skipped: string[] = []

    for (const [index, hiveId] of data.hiveIds.entries()) {
      if (!colonyByHive.has(hiveId)) {
        skipped.push(hiveId)
        continue
      }
      const outcome = await insertInspection(
        farmId,
        req.user!.id,
        {
          id: data.ids[index]!,
          hiveId,
          colonyId: colonyByHive.get(hiveId)!,
          visitId: data.visitId ?? null,
          inspectedAt: data.inspectedAt,
          isBatch: true,
        },
        data,
      )
      outcome === 'created' ? created++ : duplicates++
    }

    if (created > 0) {
      await writeAudit(req, {
        userId: req.user!.id,
        farmId,
        action: 'inspection.batch_create',
        entityType: 'hive_inspection',
        after: { created, duplicates, skipped: skipped.length, inspectedAt: data.inspectedAt },
      })
    }

    res.status(created > 0 ? 201 : 200).json({ created, duplicates, skipped })
  }),
)

/** Recent activity across the farm — feeds the dashboard journal. */
inspectionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.inspected_at, i.strength, i.queen_state, i.swarming, i.is_batch,
              h.code AS hive_code, a.name AS apiary_name
         FROM hive_inspections i
         JOIN hives h ON h.id = i.hive_id
         LEFT JOIN apiaries a ON a.id = h.apiary_id
        WHERE i.farm_id = ?
        ORDER BY i.inspected_at DESC
        LIMIT ?`,
      [req.farm!.id, limit],
    )
    res.json({
      inspections: rows.map((r) => ({
        id: r.id as string,
        inspectedAt: (r.inspected_at as Date).toISOString(),
        hiveCode: r.hive_code as string,
        apiaryName: (r.apiary_name as string | null) ?? null,
        strength: r.strength,
        queenState: r.queen_state,
        swarming: r.swarming,
        isBatch: Boolean(r.is_batch),
      })),
    })
  }),
)
