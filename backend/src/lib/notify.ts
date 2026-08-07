import { pool } from '../db.js'
import { newId } from './ids.js'

export type NotificationSeverity = 'critical' | 'warning' | 'caution' | 'ok' | 'info'

export interface NotificationInput {
  farmId: string
  /** Leave unset for anything the whole farm should see. */
  userId?: string | null
  kind: string
  severity: NotificationSeverity
  title: string
  body?: string | null
  link?: string | null
  entityType?: string | null
  entityId?: string | null
  /**
   * Identifies the *occasion*, not just the subject: "obligation:<id>:14" is the 14-day warning
   * for one obligation and nothing else. The scheduler re-evaluates every farm on every tick, so
   * this key plus the unique index is the only thing standing between the beekeeper and the same
   * reminder every hour until the deadline.
   */
  dedupeKey: string
}

/** Returns true when the notification was newly created, false when it already existed. */
export async function notify(input: NotificationInput): Promise<boolean> {
  const [result] = await pool.query(
    `INSERT IGNORE INTO notifications
       (id, farm_id, user_id, kind, severity, title, body, link, entity_type, entity_id, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      input.farmId,
      input.userId ?? null,
      input.kind,
      input.severity,
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.entityType ?? null,
      input.entityId ?? null,
      input.dedupeKey,
    ],
  )
  return (result as { affectedRows: number }).affectedRows > 0
}
