import type { NextFunction, Request, Response } from 'express'
import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { forbidden, notFound, unauthorized } from '../lib/http.js'

export interface FarmContext {
  id: string
  role: 'owner' | 'worker'
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      farm?: FarmContext
    }
  }
}

/**
 * Resolves the farm the request acts on and attaches it as req.farm.
 *
 * Every query in every module then filters on req.farm.id. That single rule is what keeps one
 * beekeeper's apiaries — and their GPS coordinates (§56) — from ever appearing in another's
 * response, and it is why no route is allowed to take a farmId from the client.
 */
export async function requireFarm(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    next(unauthorized())
    return
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.farm_id, m.role
         FROM farm_members m
         JOIN farms f ON f.id = m.farm_id
        WHERE m.user_id = ?
          AND m.deleted_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND f.deleted_at IS NULL
        ORDER BY (m.role = 'owner') DESC, f.created_at ASC
        LIMIT 1`,
      [req.user.id],
    )

    const row = rows[0]
    if (!row) {
      next(notFound('Nemate pristup nijednom gospodarstvu'))
      return
    }

    req.farm = { id: row.farm_id as string, role: row.role as 'owner' | 'worker' }
    next()
  } catch (err) {
    next(err)
  }
}

/**
 * §4 — a worker records work but does not restructure the farm. Guards destructive and
 * configuration routes (deleting an apiary, renaming hives); recording inspections stays open.
 */
export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.farm) {
    next(unauthorized())
    return
  }
  if (req.farm.role !== 'owner') {
    next(forbidden('Ovu radnju može izvršiti samo vlasnik gospodarstva'))
    return
  }
  next()
}
