import type { Request } from 'express'
import { pool } from '../db.js'
import { newId } from './ids.js'

export interface AuditEntry {
  userId: string | null
  farmId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown
  after?: unknown
}

/**
 * Append-only trail behind every state change (§56). Critical records — VMP treatments above all
 * — are never hard-deleted; a correction writes a new row here with the previous value, so an
 * inspector can reconstruct what the register said at any point in time.
 *
 * Deliberately swallows its own errors: an audit write must never be the reason a user's
 * inspection entry fails on a hillside with one bar of signal.
 */
export async function writeAudit(req: Request | null, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (id, user_id, farm_id, action, entity_type, entity_id, before_json, after_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        entry.userId,
        entry.farmId ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        req ? clientIp(req) : null,
      ],
    )
  } catch (err) {
    console.error('[audit] failed to write entry', entry.action, err)
  }
}

export function clientIp(req: Request): string | null {
  // Nginx fronts the app and sets X-Forwarded-For; take the first hop (the real client).
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim().slice(0, 45)
  }
  return req.ip?.slice(0, 45) ?? null
}
