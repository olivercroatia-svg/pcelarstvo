import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { requireFarm } from '../middleware/farm.js'

/** §53 — the notification centre. Produced by lib/scheduler.ts, read here. */
export const notificationsRouter = Router()
notificationsRouter.use(requireFarm)

function mapNotification(row: RowDataPacket) {
  return {
    id: row.id as string,
    kind: row.kind as string,
    severity: row.severity as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    link: (row.link as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    readAt: row.read_at ? (row.read_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        unread: z.enum(['1', '0']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query)

    const filters = ['farm_id = ?', '(user_id IS NULL OR user_id = ?)']
    const params: unknown[] = [req.farm!.id, req.user!.id]
    if (query.unread === '1') filters.push('read_at IS NULL')

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM notifications WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      [...params, query.limit],
    )
    const [counts] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS unread FROM notifications
        WHERE farm_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL`,
      [req.farm!.id, req.user!.id],
    )

    res.json({
      notifications: rows.map(mapNotification),
      unreadCount: Number(counts[0]?.unread ?? 0),
    })
  }),
)

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM notifications WHERE id = ? AND farm_id = ? LIMIT 1',
      [req.params.id, req.farm!.id],
    )
    if (rows.length === 0) throw notFound('Obavijest nije pronađena')

    // COALESCE so re-reading does not move the timestamp — the first time it was seen is the
    // useful one.
    await pool.query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ?', [
      req.params.id,
    ])
    res.status(204).end()
  }),
)

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET read_at = NOW()
        WHERE farm_id = ? AND (user_id IS NULL OR user_id = ?) AND read_at IS NULL`,
      [req.farm!.id, req.user!.id],
    )
    res.status(204).end()
  }),
)
