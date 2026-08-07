import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, conflict, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { assertFarmReference } from '../lib/ownership.js'
import { newQrToken } from '../lib/tokens.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

export const hivesRouter = Router()
hivesRouter.use(requireFarm)

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))

const asDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))

function mapHive(row: RowDataPacket) {
  return {
    id: row.id as string,
    code: row.code as string,
    qrToken: row.qr_token as string,
    apiaryId: (row.apiary_id as string | null) ?? null,
    apiaryName: (row.apiary_name as string | undefined) ?? null,
    hiveType: (row.hive_type as string | null) ?? null,
    status: row.status as string,
    notes: (row.notes as string | null) ?? null,
    colony: row.colony_id
      ? {
          id: row.colony_id as string,
          startedOn: asDate(row.colony_started_on),
          queenId: (row.queen_id as string | null) ?? null,
          queenCode: (row.queen_code as string | null) ?? null,
        }
      : null,
    lastInspection: row.last_inspected_at
      ? {
          at: (row.last_inspected_at as Date).toISOString(),
          strength: (row.last_strength as string | null) ?? null,
          queenState: (row.last_queen_state as string | null) ?? null,
          swarming: (row.last_swarming as string | null) ?? null,
        }
      : null,
    // Drives the "needs a look" filter and the §61 closing summary. NULL (never inspected) sorts
    // as the most urgent, so it is reported as a large number rather than nothing.
    daysSinceInspection:
      row.last_inspected_at === null || row.last_inspected_at === undefined
        ? null
        : Math.floor((Date.now() - (row.last_inspected_at as Date).getTime()) / 86_400_000),
  }
}

// One correlated subquery for the latest inspection rather than a window function: MariaDB is a
// realistic target on aaPanel and its window-function support lags MySQL 8.
const HIVE_SELECT = `
  SELECT h.*, a.name AS apiary_name,
         c.id AS colony_id, c.started_on AS colony_started_on,
         q.id AS queen_id, q.code AS queen_code,
         i.inspected_at AS last_inspected_at, i.strength AS last_strength,
         i.queen_state AS last_queen_state, i.swarming AS last_swarming
    FROM hives h
    LEFT JOIN apiaries a ON a.id = h.apiary_id
    LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
    LEFT JOIN queens   q ON q.id = c.queen_id
    LEFT JOIN hive_inspections i
           ON i.id = (SELECT i2.id FROM hive_inspections i2
                       WHERE i2.hive_id = h.id
                       ORDER BY i2.inspected_at DESC, i2.id DESC LIMIT 1)
`

const listQuery = z.object({
  apiaryId: z.string().trim().min(1).optional(),
  status: z.enum(['active', 'empty', 'merged', 'lost', 'sold']).optional(),
  // "not inspected in N days" — the field question that starts most rounds.
  staleDays: z.coerce.number().int().min(1).max(365).optional(),
  search: z.string().trim().max(60).optional(),
})

hivesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query)
    const where = ['h.farm_id = ?', 'h.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]

    if (q.apiaryId) {
      where.push('h.apiary_id = ?')
      params.push(q.apiaryId)
    }
    if (q.status) {
      where.push('h.status = ?')
      params.push(q.status)
    }
    if (q.search) {
      where.push('h.code LIKE ?')
      params.push(`%${q.search}%`)
    }
    if (q.staleDays) {
      // Never-inspected hives count as stale; they are the ones most in need of a visit.
      where.push('(i.inspected_at IS NULL OR i.inspected_at < DATE_SUB(NOW(), INTERVAL ? DAY))')
      params.push(q.staleDays)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${HIVE_SELECT} WHERE ${where.join(' AND ')} ORDER BY h.code`,
      params,
    )
    res.json({ hives: rows.map(mapHive) })
  }),
)

async function loadHive(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${HIVE_SELECT} WHERE h.id = ? AND h.farm_id = ? AND h.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Košnica nije pronađena')
  return row
}

/** §11 — what the camera resolves to. Still session-scoped; the token only identifies the hive. */
hivesRouter.get(
  '/by-qr/:token',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `${HIVE_SELECT} WHERE h.qr_token = ? AND h.farm_id = ? AND h.deleted_at IS NULL LIMIT 1`,
      [req.params.token, req.farm!.id],
    )
    const row = rows[0]
    if (!row) throw notFound('QR oznaka ne pripada nijednoj vašoj košnici')
    res.json({ hive: mapHive(row) })
  }),
)

/** §10 — the hive card, with its inspection history and the colonies that lived in it. */
hivesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const hive = await loadHive(farmId, req.params.id)

    const [inspections] = await pool.query<RowDataPacket[]>(
      `SELECT i.*, u.first_name, u.last_name
         FROM hive_inspections i
         LEFT JOIN users u ON u.id = i.user_id
        WHERE i.hive_id = ?
        ORDER BY i.inspected_at DESC
        LIMIT 50`,
      [hive.id],
    )

    const [colonies] = await pool.query<RowDataPacket[]>(
      `SELECT c.*, q.code AS queen_code
         FROM colonies c
         LEFT JOIN queens q ON q.id = c.queen_id
        WHERE c.hive_id = ?
        ORDER BY c.started_on DESC`,
      [hive.id],
    )

    res.json({
      hive: mapHive(hive),
      inspections: inspections.map((i) => ({
        id: i.id as string,
        inspectedAt: (i.inspected_at as Date).toISOString(),
        strength: i.strength,
        framesBees: i.frames_bees,
        framesBrood: i.frames_brood,
        brood: i.brood,
        queenState: i.queen_state,
        swarming: i.swarming,
        queenCells: i.queen_cells,
        stores: i.stores,
        isBatch: Boolean(i.is_batch),
        notes: i.notes,
        by: [i.first_name, i.last_name].filter(Boolean).join(' ') || null,
      })),
      colonies: colonies.map((c) => ({
        id: c.id as string,
        startedOn: asDate(c.started_on),
        endedOn: asDate(c.ended_on),
        endReason: c.end_reason,
        source: c.source,
        queenCode: c.queen_code,
      })),
    })
  }),
)

const hiveFields = {
  code: z.string().trim().min(1, 'Unesite oznaku košnice').max(40),
  apiaryId: z.string().trim().min(1).nullish(),
  hiveType: nullableText(60),
  status: z.enum(['active', 'empty', 'merged', 'lost', 'sold']),
  notes: nullableText(4000),
}

const createSchema = z.object({
  ...hiveFields,
  status: hiveFields.status.default('active'),
  /** Creating the hive with bees in it also opens its first colony. */
  withColony: z.boolean().default(true),
  colonyStartedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

async function assertApiaryBelongs(farmId: string, apiaryId: string | null | undefined) {
  if (!apiaryId) return
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
    [apiaryId, farmId],
  )
  if (rows.length === 0) throw notFound('Pčelinjak nije pronađen')
}

hivesRouter.post(
  '/',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createSchema.parse(req.body)
    await assertApiaryBelongs(farmId, data.apiaryId)

    const id = newId()
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(
        `INSERT INTO hives (id, farm_id, apiary_id, code, qr_token, hive_type, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, farmId, data.apiaryId ?? null, data.code, newQrToken(), data.hiveType ?? null, data.status, data.notes ?? null],
      )
      if (data.withColony) {
        await conn.query(
          `INSERT INTO colonies (id, farm_id, hive_id, started_on)
           VALUES (?, ?, ?, COALESCE(?, CURDATE()))`,
          [newId(), farmId, id, data.colonyStartedOn ?? null],
        )
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw conflict(`Košnica s oznakom ${data.code} već postoji`, 'code_taken')
      }
      throw err
    } finally {
      conn.release()
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'hive.create',
      entityType: 'hive',
      entityId: id,
      after: { code: data.code, apiaryId: data.apiaryId ?? null },
    })

    res.status(201).json({ hive: mapHive(await loadHive(farmId, id)) })
  }),
)

const bulkSchema = z
  .object({
    apiaryId: z.string().trim().min(1).nullish(),
    prefix: z.string().trim().max(10).default('B'),
    from: z.coerce.number().int().min(0).max(99_999),
    to: z.coerce.number().int().min(0).max(99_999),
    /** B1 vs B001 — the label printer output has to match what is painted on the boxes. */
    padTo: z.coerce.number().int().min(1).max(6).default(3),
    hiveType: nullableText(60),
    withColony: z.boolean().default(true),
  })
  .refine((v) => v.to >= v.from, { message: 'Kraj raspona mora biti veći ili jednak početku', path: ['to'] })
  .refine((v) => v.to - v.from + 1 <= 500, { message: 'Najviše 500 košnica odjednom', path: ['to'] })

/**
 * Setting up an apiary means creating dozens of hives at once; typing them one by one is the kind
 * of chore that stops people using the app at all. Duplicate codes are reported rather than
 * silently skipped, so the beekeeper finds out their numbering already exists.
 */
hivesRouter.post(
  '/bulk',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = bulkSchema.parse(req.body)
    await assertApiaryBelongs(farmId, data.apiaryId)

    const codes: string[] = []
    for (let n = data.from; n <= data.to; n++) {
      codes.push(`${data.prefix}${String(n).padStart(data.padTo, '0')}`)
    }

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT code FROM hives WHERE farm_id = ? AND code IN (?)',
      [farmId, codes],
    )
    if (existing.length > 0) {
      throw conflict(
        `Ove oznake već postoje: ${existing.map((r) => r.code).join(', ').slice(0, 200)}`,
        'code_taken',
      )
    }

    const conn = await pool.getConnection()
    const created: string[] = []
    try {
      await conn.beginTransaction()
      for (const code of codes) {
        const id = newId()
        created.push(id)
        await conn.query(
          `INSERT INTO hives (id, farm_id, apiary_id, code, qr_token, hive_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [id, farmId, data.apiaryId ?? null, code, newQrToken(), data.hiveType ?? null],
        )
        if (data.withColony) {
          await conn.query(
            'INSERT INTO colonies (id, farm_id, hive_id, started_on) VALUES (?, ?, ?, CURDATE())',
            [newId(), farmId, id],
          )
        }
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
      action: 'hive.bulk_create',
      entityType: 'hive',
      after: { count: created.length, first: codes[0], last: codes.at(-1) },
    })

    res.status(201).json({ created: created.length, codes })
  }),
)

const updateSchema = z.object({
  code: hiveFields.code.optional(),
  apiaryId: hiveFields.apiaryId,
  hiveType: hiveFields.hiveType,
  status: hiveFields.status.optional(),
  notes: hiveFields.notes,
})

const UPDATE_COLUMNS: Record<string, string> = {
  code: 'code',
  apiaryId: 'apiary_id',
  hiveType: 'hive_type',
  status: 'status',
  notes: 'notes',
}

hivesRouter.patch(
  '/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadHive(farmId, req.params.id)
    const data = updateSchema.parse(req.body)
    if (data.apiaryId !== undefined) await assertApiaryBelongs(farmId, data.apiaryId)

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    if (entries.length > 0) {
      try {
        await pool.query(
          `UPDATE hives SET ${entries.map(([k]) => `${UPDATE_COLUMNS[k]} = ?`).join(', ')}
            WHERE id = ? AND farm_id = ?`,
          [...entries.map(([, v]) => v), before.id, farmId],
        )
      } catch (err) {
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw conflict('Košnica s tom oznakom već postoji', 'code_taken')
        }
        throw err
      }
    }

    const after = await loadHive(farmId, before.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'hive.update',
      entityType: 'hive',
      entityId: before.id,
      before: mapHive(before),
      after: mapHive(after),
    })

    res.json({ hive: mapHive(after) })
  }),
)

hivesRouter.delete(
  '/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const hive = await loadHive(farmId, req.params.id)
    await pool.query('UPDATE hives SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [hive.id, farmId])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'hive.delete',
      entityType: 'hive',
      entityId: hive.id,
      before: mapHive(hive),
    })
    res.status(204).end()
  }),
)

/** §43 — closing a colony is how a loss enters the statistics, so the reason is mandatory. */
const endColonySchema = z.object({
  endReason: z.enum([
    'winter_loss',
    'swarmed',
    'disease',
    'poisoning',
    'weakened',
    'queenless',
    'merged',
    'sold',
    'unknown',
  ]),
  endedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: nullableText(2000),
})

hivesRouter.post(
  '/:id/colony/end',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const hive = await loadHive(farmId, req.params.id)
    if (!hive.colony_id) throw badRequest('Ova košnica trenutno nema aktivnu zajednicu')

    const data = endColonySchema.parse(req.body)
    await pool.query(
      `UPDATE colonies SET ended_on = COALESCE(?, CURDATE()), end_reason = ?,
              notes = COALESCE(?, notes)
        WHERE id = ? AND farm_id = ?`,
      [data.endedOn ?? null, data.endReason, data.notes ?? null, hive.colony_id, farmId],
    )
    await pool.query('UPDATE hives SET status = ? WHERE id = ? AND farm_id = ?', [
      data.endReason === 'sold' ? 'sold' : data.endReason === 'merged' ? 'merged' : 'empty',
      hive.id,
      farmId,
    ])

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'colony.end',
      entityType: 'colony',
      entityId: hive.colony_id as string,
      after: data,
    })

    res.json({ hive: mapHive(await loadHive(farmId, hive.id)) })
  }),
)

/** Starting a new colony in an empty box — a caught swarm, a split, or a purchased package. */
const startColonySchema = z.object({
  startedOn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  queenId: z.string().trim().min(1).nullish(),
  source: nullableText(120),
})

hivesRouter.post(
  '/:id/colony/start',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const hive = await loadHive(farmId, req.params.id)
    if (hive.colony_id) throw badRequest('Košnica već ima aktivnu zajednicu')

    const data = startColonySchema.parse(req.body)
    await assertFarmReference(pool, 'queen', data.queenId, farmId)
    const id = newId()
    await pool.query(
      `INSERT INTO colonies (id, farm_id, hive_id, queen_id, started_on, source)
       VALUES (?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
      [id, farmId, hive.id, data.queenId ?? null, data.startedOn ?? null, data.source ?? null],
    )
    await pool.query('UPDATE hives SET status = ? WHERE id = ?', ['active', hive.id])

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'colony.start',
      entityType: 'colony',
      entityId: id,
      after: data,
    })

    res.status(201).json({ hive: mapHive(await loadHive(farmId, hive.id)) })
  }),
)
