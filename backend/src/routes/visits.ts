import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { requireFarm } from '../middleware/farm.js'

export const visitsRouter = Router()
visitsRouter.use(requireFarm)

/**
 * §61 "Dan na pčelinjaku" — a round of the apiary.
 *
 * The value is entirely in the closing summary: how many hives were covered, which were missed,
 * and which need a second look. Without a visit to hang them on, the same inspections are just a
 * flat list and the beekeeper has to count in their head, at the end of a long day.
 */
async function buildSummary(farmId: string, visitId: string) {
  const [[visit]] = await pool.query<RowDataPacket[]>(
    `SELECT v.*, a.name AS apiary_name,
            (SELECT COUNT(*) FROM hives h
              WHERE h.apiary_id = v.apiary_id AND h.deleted_at IS NULL) AS total_hives
       FROM apiary_visits v
       JOIN apiaries a ON a.id = v.apiary_id
      WHERE v.id = ? AND v.farm_id = ?
      LIMIT 1`,
    [visitId, farmId],
  )
  if (!visit) throw notFound('Obilazak nije pronađen')

  const [inspected] = await pool.query<RowDataPacket[]>(
    `SELECT i.hive_id, h.code, i.queen_state, i.swarming, i.strength, i.queen_cells
       FROM hive_inspections i
       JOIN hives h ON h.id = i.hive_id
      WHERE i.visit_id = ?
      ORDER BY h.code`,
    [visitId],
  )

  const seen = new Map(inspected.map((r) => [r.hive_id as string, r]))
  const [pending] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.code FROM hives h
      WHERE h.apiary_id = ? AND h.deleted_at IS NULL
      ORDER BY h.code`,
    [visit.apiary_id],
  )

  const rows = [...seen.values()]
  return {
    id: visit.id as string,
    apiaryId: visit.apiary_id as string,
    apiaryName: visit.apiary_name as string,
    startedAt: (visit.started_at as Date).toISOString(),
    endedAt: visit.ended_at ? (visit.ended_at as Date).toISOString() : null,
    totalHives: Number(visit.total_hives),
    inspectedCount: seen.size,
    remaining: pending.filter((h) => !seen.has(h.id as string)).map((h) => h.code as string),
    queenless: rows.filter((r) => r.queen_state === 'not_found').map((r) => r.code as string),
    swarmRisk: rows
      .filter((r) => r.swarming === 'cells' || r.swarming === 'high_risk')
      .map((r) => r.code as string),
    weak: rows.filter((r) => r.strength === 'weak').map((r) => r.code as string),
  }
}

/** The visit currently in progress, if any — the app resumes it after a reload or a lost signal. */
visitsRouter.get(
  '/open',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM apiary_visits
        WHERE farm_id = ? AND user_id = ? AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`,
      [req.farm!.id, req.user!.id],
    )
    const row = rows[0]
    res.json({ visit: row ? await buildSummary(req.farm!.id, row.id as string) : null })
  }),
)

visitsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ visit: await buildSummary(req.farm!.id, req.params.id) })
  }),
)

const startSchema = z.object({ apiaryId: z.string().trim().min(1) })

visitsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const { apiaryId } = startSchema.parse(req.body)

    const [apiary] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [apiaryId, farmId],
    )
    if (apiary.length === 0) throw notFound('Pčelinjak nije pronađen')

    // Starting a round elsewhere closes the previous one. Beekeepers forget to press "završi
    // obilazak" and drive to the next apiary; a stale open visit would keep collecting entries
    // under the wrong location.
    await pool.query(
      'UPDATE apiary_visits SET ended_at = NOW() WHERE farm_id = ? AND user_id = ? AND ended_at IS NULL',
      [farmId, req.user!.id],
    )

    const id = newId()
    await pool.query(
      'INSERT INTO apiary_visits (id, farm_id, apiary_id, user_id) VALUES (?, ?, ?, ?)',
      [id, farmId, apiaryId, req.user!.id],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'visit.start',
      entityType: 'apiary_visit',
      entityId: id,
      after: { apiaryId },
    })

    res.status(201).json({ visit: await buildSummary(farmId, id) })
  }),
)

visitsRouter.post(
  '/:id/end',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const summary = await buildSummary(farmId, req.params.id)
    if (!summary.endedAt) {
      await pool.query('UPDATE apiary_visits SET ended_at = NOW() WHERE id = ? AND farm_id = ?', [
        summary.id,
        farmId,
      ])
    }
    res.json({ visit: await buildSummary(farmId, summary.id) })
  }),
)
