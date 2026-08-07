import { Router } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { validateBatchTotal } from '../lib/invariants.js'
import { nextLotCode } from '../lib/lot.js'
import { assertFarmReference } from '../lib/ownership.js'
import { withdrawalConflicts } from '../lib/production.js'
import {
  asDate,
  asNumber,
  changedColumns,
  nullableDate,
  nullableDecimal,
  nullableInt,
  nullableText,
  requiredDate,
} from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §28 vrcanje and §29 serije meda.
 *
 * One router because they are one action: recording an extraction creates the LOT, in a single
 * transaction. A harvest without its batch would be an extraction whose honey does not exist, and
 * a batch without its harvest would be honey that came from nowhere.
 */

export const harvestsRouter = Router()
harvestsRouter.use(requireFarm)

export const batchesRouter = Router()
batchesRouter.use(requireFarm)

// ─────────────────────────────────────────────────────────────── mapping

function mapHarvest(row: RowDataPacket) {
  return {
    id: row.id as string,
    apiaryId: row.apiary_id as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    harvestedOn: asDate(row.harvested_on),
    pasture: row.pasture as string,
    hiveRange: (row.hive_range as string | null) ?? null,
    framesCount: asNumber(row.frames_count),
    notes: (row.notes as string | null) ?? null,
    hiveCount: Number(row.hive_count ?? 0),
    by: row.by_name ? String(row.by_name).trim() : null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

function mapBatch(row: RowDataPacket) {
  return {
    id: row.id as string,
    harvestId: row.harvest_id as string,
    lotCode: row.lot_code as string,
    honeyType: row.honey_type as string,
    totalKg: Number(row.total_kg),
    packedKg: Number(row.packed_kg),
    availableKg: Number(row.available_kg),
    moisturePercent: asNumber(row.moisture_percent),
    status: row.status as 'open' | 'ready' | 'blocked' | 'closed',
    bestBefore: asDate(row.best_before),
    notes: (row.notes as string | null) ?? null,
    // Joined in by BATCH_SELECT so a list can show §29's card without a second round trip.
    harvestedOn: asDate(row.harvested_on),
    pasture: (row.pasture as string | null) ?? null,
    apiaryId: (row.apiary_id as string | null) ?? null,
    apiaryName: (row.apiary_name as string | null) ?? null,
    labTests: Number(row.lab_tests ?? 0),
    packagingRuns: Number(row.packaging_runs ?? 0),
    jarsPacked: Number(row.jars_packed ?? 0),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

const HARVEST_SELECT = `
  SELECT h.*, a.name AS apiary_name,
         CONCAT(u.first_name, ' ', u.last_name) AS by_name,
         (SELECT COUNT(*) FROM harvest_hives hh WHERE hh.harvest_id = h.id) AS hive_count
    FROM harvests h
    JOIN apiaries a ON a.id = h.apiary_id
    LEFT JOIN users u ON u.id = h.created_by
`

const BATCH_SELECT = `
  SELECT b.*, h.harvested_on, h.pasture, h.apiary_id, a.name AS apiary_name,
         (SELECT COUNT(*) FROM laboratory_tests lt
           WHERE lt.batch_id = b.id AND lt.deleted_at IS NULL) AS lab_tests,
         (SELECT COUNT(*) FROM packaging_batches p
           WHERE p.batch_id = b.id AND p.deleted_at IS NULL) AS packaging_runs,
         (SELECT COALESCE(SUM(p.jar_count), 0) FROM packaging_batches p
           WHERE p.batch_id = b.id AND p.deleted_at IS NULL) AS jars_packed
    FROM honey_batches b
    JOIN harvests h ON h.id = b.harvest_id
    JOIN apiaries a ON a.id = h.apiary_id
`

export async function loadBatch(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${BATCH_SELECT} WHERE b.id = ? AND b.farm_id = ? AND b.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Serija meda nije pronađena')
  return row
}

// ─────────────────────────────────────────────────────────────── §28 harvests

harvestsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        apiaryId: z.string().trim().min(1).optional(),
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query)

    const filters = ['h.farm_id = ?', 'h.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.apiaryId) {
      filters.push('h.apiary_id = ?')
      params.push(query.apiaryId)
    }
    if (query.year) {
      filters.push('YEAR(h.harvested_on) = ?')
      params.push(query.year)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${HARVEST_SELECT} WHERE ${filters.join(' AND ')}
        ORDER BY h.harvested_on DESC, h.created_at DESC LIMIT ?`,
      [...params, query.limit],
    )

    // The LOT is what the beekeeper actually looks for, so it rides along with the extraction.
    const [batches] = await pool.query<RowDataPacket[]>(
      `SELECT harvest_id, lot_code, honey_type, total_kg, available_kg
         FROM honey_batches WHERE farm_id = ? AND deleted_at IS NULL`,
      [req.farm!.id],
    )
    const byHarvest = new Map(batches.map((b) => [b.harvest_id as string, b]))

    res.json({
      harvests: rows.map((row) => {
        const batch = byHarvest.get(row.id as string)
        return {
          ...mapHarvest(row),
          lotCode: (batch?.lot_code as string | undefined) ?? null,
          honeyType: (batch?.honey_type as string | undefined) ?? null,
          totalKg: batch ? Number(batch.total_kg) : null,
          availableKg: batch ? Number(batch.available_kg) : null,
        }
      }),
    })
  }),
)

const containerSchema = z.object({
  name: z.string().trim().min(1, 'Unesite oznaku posude').max(80),
  amountKg: z.coerce.number().min(0).max(100000),
})

const harvestFields = {
  apiaryId: z.string().trim().min(1, 'Odaberite pčelinjak'),
  harvestedOn: requiredDate,
  pasture: z.string().trim().min(2, 'Unesite pašu').max(120),
  hiveRange: nullableText(120),
  framesCount: nullableInt(0, 10000),
  notes: nullableText(2000),
}

const HARVEST_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  harvestedOn: 'harvested_on',
  pasture: 'pasture',
  hiveRange: 'hive_range',
  framesCount: 'frames_count',
  notes: 'notes',
}

const createHarvestSchema = z.object({
  ...harvestFields,
  hiveIds: z.array(z.string().trim().min(1)).max(2000).default([]),
  containers: z.array(containerSchema).max(50).default([]),

  // The batch side of the same form (§28 "Količina", "Vlaga"; §29 "Vrsta").
  honeyType: z.string().trim().max(120).nullish(),
  totalKg: z.coerce.number().min(0.01, 'Unesite izvrcanu količinu').max(1000000),
  moisturePercent: nullableDecimal(0, 100),
})

/** Links the harvested hives and returns their codes, sorted, for the display range. */
async function linkHarvestHives(
  conn: PoolConnection,
  farmId: string,
  harvestId: string,
  hiveIds: string[],
): Promise<string[]> {
  if (hiveIds.length === 0) return []
  const [owned] = await conn.query<RowDataPacket[]>(
    `SELECT h.id, h.code, c.id AS colony_id
       FROM hives h
       LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
      WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.id IN (?)
      ORDER BY h.code`,
    [farmId, hiveIds],
  )
  if (owned.length === 0) return []

  await conn.query('INSERT IGNORE INTO harvest_hives (harvest_id, hive_id, colony_id) VALUES ?', [
    owned.map((r) => [harvestId, r.id, r.colony_id ?? null]),
  ])
  return owned.map((r) => r.code as string)
}

/** §28 "Košnice: 12–47" — the shorthand, derived from the linked hives when not typed by hand. */
function describeRange(codes: string[]): string | null {
  if (codes.length === 0) return null
  if (codes.length === 1) return codes[0]!
  return `${codes[0]}–${codes[codes.length - 1]}`
}

harvestsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createHarvestSchema.parse(req.body)

    const [apiaries] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [data.apiaryId, farmId],
    )
    if (apiaries.length === 0) throw notFound('Pčelinjak nije pronađen')

    const { hiveIds, containers, honeyType, totalKg, moisturePercent, ...harvestData } = data
    const harvestId = newId()
    const batchId = newId()

    // The LOT sequence is read and written in the same transaction, but two extractions recorded
    // at the same moment can still both read the same last code. The UNIQUE index catches that,
    // and this loop re-reads and retries rather than handing back a 500 for a race the user has
    // no way to understand.
    let lotCode = ''
    for (let attempt = 0; ; attempt++) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        lotCode = await nextLotCode(conn, farmId, data.pasture, data.harvestedOn)

        const { names, values } = changedColumns(harvestData, HARVEST_COLUMNS)
        await conn.query(
          `INSERT INTO harvests (id, farm_id, created_by, ${names.join(', ')})
           VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
          [harvestId, farmId, req.user!.id, ...values],
        )

        const codes = await linkHarvestHives(conn, farmId, harvestId, hiveIds)
        if (!harvestData.hiveRange && codes.length > 0) {
          await conn.query('UPDATE harvests SET hive_range = ? WHERE id = ?', [describeRange(codes), harvestId])
        }

        if (containers.length > 0) {
          await conn.query('INSERT INTO harvest_containers (id, harvest_id, name, amount_kg) VALUES ?', [
            containers.map((c) => [newId(), harvestId, c.name, c.amountKg]),
          ])
        }

        await conn.query(
          `INSERT INTO honey_batches
             (id, farm_id, harvest_id, created_by, lot_code, honey_type, total_kg, moisture_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            batchId,
            farmId,
            harvestId,
            req.user!.id,
            lotCode,
            honeyType?.trim() || data.pasture,
            totalKg,
            moisturePercent ?? null,
          ],
        )

        await conn.commit()
        break
      } catch (err) {
        await conn.rollback()
        const duplicate = (err as { code?: string }).code === 'ER_DUP_ENTRY'
        if (!duplicate || attempt >= 4) throw err
      } finally {
        conn.release()
      }
    }

    const [harvestRows] = await pool.query<RowDataPacket[]>(`${HARVEST_SELECT} WHERE h.id = ?`, [harvestId])
    const batch = mapBatch(await loadBatch(farmId, batchId))

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'harvest.create',
      entityType: 'harvest',
      entityId: harvestId,
      after: { lotCode, totalKg, pasture: data.pasture, hives: hiveIds.length },
    })

    // §67 — the reason the two modules know about each other at all.
    const conflicts = await withdrawalConflicts(farmId, data.apiaryId, data.harvestedOn)

    res.status(201).json({
      harvest: mapHarvest(harvestRows[0]!),
      batch,
      withdrawalConflicts: conflicts,
    })
  }),
)

harvestsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      `${HARVEST_SELECT} WHERE h.id = ? AND h.farm_id = ? AND h.deleted_at IS NULL LIMIT 1`,
      [req.params.id, farmId],
    )
    const row = rows[0]
    if (!row) throw notFound('Vrcanje nije pronađeno')

    const [hives] = await pool.query<RowDataPacket[]>(
      `SELECT h.id, h.code FROM harvest_hives hh JOIN hives h ON h.id = hh.hive_id
        WHERE hh.harvest_id = ? ORDER BY h.code`,
      [row.id],
    )
    const [containers] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, amount_kg FROM harvest_containers WHERE harvest_id = ? ORDER BY name',
      [row.id],
    )
    const [batchRows] = await pool.query<RowDataPacket[]>(
      `${BATCH_SELECT} WHERE b.harvest_id = ? AND b.deleted_at IS NULL LIMIT 1`,
      [row.id],
    )
    const batch = batchRows[0] ? mapBatch(batchRows[0]) : null

    const containerTotal = containers.reduce((sum, c) => sum + Number(c.amount_kg), 0)

    res.json({
      harvest: mapHarvest(row),
      batch,
      hives: hives.map((h) => ({ id: h.id as string, code: h.code as string })),
      containers: containers.map((c) => ({
        id: c.id as string,
        name: c.name as string,
        amountKg: Number(c.amount_kg),
      })),
      // Reported, not enforced — see the note on harvest_containers in 005_production.sql.
      containerTotalKg: containerTotal,
      containerMismatchKg:
        containers.length > 0 && batch ? Number((batch.totalKg - containerTotal).toFixed(2)) : 0,
      withdrawalConflicts: await withdrawalConflicts(
        farmId,
        row.apiary_id as string,
        asDate(row.harvested_on)!,
      ),
    })
  }),
)

harvestsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM harvests WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Vrcanje nije pronađeno')

    const data = z
      .object({
        ...harvestFields,
        apiaryId: harvestFields.apiaryId.optional(),
        harvestedOn: harvestFields.harvestedOn.optional(),
        pasture: harvestFields.pasture.optional(),
        hiveIds: z.array(z.string().trim().min(1)).max(2000).optional(),
        containers: z.array(containerSchema).max(50).optional(),
      })
      .parse(req.body)
    await assertFarmReference(pool, 'apiary', data.apiaryId, farmId)

    const { hiveIds, containers, ...fields } = data
    const { names, values } = changedColumns(fields, HARVEST_COLUMNS)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      if (names.length > 0) {
        await conn.query(
          `UPDATE harvests SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
          [...values, before.id, farmId],
        )
      }
      if (hiveIds) {
        await conn.query('DELETE FROM harvest_hives WHERE harvest_id = ?', [before.id])
        await linkHarvestHives(conn, farmId, before.id as string, hiveIds)
      }
      if (containers) {
        await conn.query('DELETE FROM harvest_containers WHERE harvest_id = ?', [before.id])
        if (containers.length > 0) {
          await conn.query('INSERT INTO harvest_containers (id, harvest_id, name, amount_kg) VALUES ?', [
            containers.map((c) => [newId(), before.id, c.name, c.amountKg]),
          ])
        }
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    // The LOT code is deliberately not recomputed when the pasture or date changes. It is printed
    // on jars and quoted on invoices; a code that silently renames itself is worse than one that
    // no longer matches the corrected pasture.
    const [after] = await pool.query<RowDataPacket[]>(`${HARVEST_SELECT} WHERE h.id = ?`, [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'harvest.update',
      entityType: 'harvest',
      entityId: before.id as string,
      before: mapHarvest(before),
      after: mapHarvest(after[0]!),
    })
    res.json({ harvest: mapHarvest(after[0]!) })
  }),
)

harvestsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Vrcanje može obrisati samo vlasnik')
    const farmId = req.farm!.id
    const conn = await pool.getConnection()
    let row: RowDataPacket
    try {
      await conn.beginTransaction()
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT h.id, b.id AS batch_id, b.lot_code, b.packed_kg, b.sold_bulk_kg
           FROM harvests h
           LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
          WHERE h.id = ? AND h.farm_id = ? AND h.deleted_at IS NULL
          FOR UPDATE`,
        [req.params.id, farmId],
      )
      row = rows[0]!
      if (!row) throw notFound('Vrcanje nije pronađeno')

      const packedKg = Number(row.packed_kg ?? 0)
      const soldBulkKg = Number(row.sold_bulk_kg ?? 0)
      if (packedKg > 0 || soldBulkKg > 0) {
        throw conflict(
          `Iz serije ${row.lot_code} već je evidentiran izlaz meda (${packedKg + soldBulkKg} kg), pa se vrcanje ne može obrisati`,
          'honey_committed',
        )
      }

      await conn.query('UPDATE harvests SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [row.id, farmId])
      if (row.batch_id) {
        await conn.query('UPDATE honey_batches SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [
          row.batch_id,
          farmId,
        ])
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'harvest.delete',
      entityType: 'harvest',
      entityId: row.id as string,
      before: { lotCode: row.lot_code },
    })
    res.status(204).end()
  }),
)

// ─────────────────────────────────────────────────────────────── §29 honey batches

batchesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        status: z.enum(['open', 'ready', 'blocked', 'closed']).optional(),
        honeyType: z.string().trim().max(120).optional(),
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        available: z.coerce.boolean().optional(),
      })
      .parse(req.query)

    const filters = ['b.farm_id = ?', 'b.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.status) {
      filters.push('b.status = ?')
      params.push(query.status)
    }
    if (query.honeyType) {
      filters.push('b.honey_type = ?')
      params.push(query.honeyType)
    }
    if (query.year) {
      filters.push('YEAR(h.harvested_on) = ?')
      params.push(query.year)
    }
    if (query.available) filters.push('b.available_kg > 0')

    const [rows] = await pool.query<RowDataPacket[]>(
      `${BATCH_SELECT} WHERE ${filters.join(' AND ')} ORDER BY h.harvested_on DESC, b.lot_code DESC`,
      params,
    )
    res.json({ batches: rows.map(mapBatch) })
  }),
)

/**
 * §29's card: the batch, plus the three things the card actually shows alongside it — whether a
 * laboratory result exists, what has been packed out of it, and whether the extraction sat inside
 * a withdrawal period.
 *
 * Separate from /traceability/:key, which answers the different question of where a jar came from
 * and returns the hives, queens and treatments to prove it.
 */
batchesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const row = await loadBatch(farmId, req.params.id)

    const [tests] = await pool.query<RowDataPacket[]>(
      `SELECT id, laboratory, report_number, tested_on FROM laboratory_tests
        WHERE batch_id = ? AND deleted_at IS NULL ORDER BY COALESCE(tested_on, created_at) DESC`,
      [row.id],
    )
    const [packaging] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.packaged_on, p.jar_size_g, p.jar_count, p.total_kg, p.is_national,
              p.public_token, pr.name AS product_name
         FROM packaging_batches p
         LEFT JOIN products pr ON pr.id = p.product_id
        WHERE p.batch_id = ? AND p.deleted_at IS NULL ORDER BY p.packaged_on DESC`,
      [row.id],
    )

    res.json({
      batch: mapBatch(row),
      labTests: tests.map((t) => ({
        id: t.id as string,
        laboratory: (t.laboratory as string | null) ?? null,
        reportNumber: (t.report_number as string | null) ?? null,
        testedOn: asDate(t.tested_on),
      })),
      packaging: packaging.map((p) => ({
        id: p.id as string,
        packagedOn: asDate(p.packaged_on),
        productName: (p.product_name as string | null) ?? null,
        jarSizeG: Number(p.jar_size_g),
        jarCount: Number(p.jar_count),
        totalKg: Number(p.total_kg),
        isNational: Boolean(p.is_national),
        published: Boolean(p.public_token),
      })),
      withdrawalConflicts: await withdrawalConflicts(
        farmId,
        row.apiary_id as string,
        asDate(row.harvested_on)!,
      ),
    })
  }),
)

const BATCH_COLUMNS: Record<string, string> = {
  honeyType: 'honey_type',
  totalKg: 'total_kg',
  moisturePercent: 'moisture_percent',
  status: 'status',
  bestBefore: 'best_before',
  notes: 'notes',
}

batchesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadBatch(farmId, req.params.id)

    const data = z
      .object({
        honeyType: z.string().trim().min(2).max(120).optional(),
        totalKg: z.coerce.number().min(0).max(1000000).optional(),
        moisturePercent: nullableDecimal(0, 100),
        status: z.enum(['open', 'ready', 'blocked', 'closed']).optional(),
        bestBefore: nullableDate,
        notes: nullableText(2000),
      })
      .parse(req.body)

    const { names, values } = changedColumns(data, BATCH_COLUMNS)
    if (names.length > 0) {
      const conn = await pool.getConnection()
      try {
        await conn.beginTransaction()
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT packed_kg, sold_bulk_kg FROM honey_batches
            WHERE id = ? AND farm_id = ? AND deleted_at IS NULL FOR UPDATE`,
          [before.id, farmId],
        )
        const locked = rows[0]
        if (!locked) throw notFound('Serija meda nije pronađena')
        if (data.totalKg !== undefined) {
          validateBatchTotal(data.totalKg, Number(locked.packed_kg), Number(locked.sold_bulk_kg))
        }
        await conn.query(
          `UPDATE honey_batches SET ${names.map((n) => `${n} = ?`).join(', ')}
            WHERE id = ? AND farm_id = ? AND deleted_at IS NULL`,
          [...values, before.id, farmId],
        )
        await conn.commit()
      } catch (err) {
        await conn.rollback()
        throw err
      } finally {
        conn.release()
      }
    }

    const after = await loadBatch(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'batch.update',
      entityType: 'honey_batch',
      entityId: before.id as string,
      before: mapBatch(before),
      after: mapBatch(after),
    })
    res.json({ batch: mapBatch(after) })
  }),
)

export { mapBatch, mapHarvest, BATCH_SELECT, HARVEST_SELECT }
