import Dexie, { type EntityTable } from 'dexie'

export type OutboxKind = 'inspection' | 'inspection_batch'

export interface OutboxItem {
  /** The client-generated UUID that also becomes the record's primary key on the server. */
  id: string
  kind: OutboxKind
  path: string
  payload: unknown
  /** What the pending-queue list shows, e.g. "Pregled B024" — the payload alone is unreadable. */
  label: string
  createdAt: number
  attempts: number
  lastError: string | null
}

/**
 * Offline queue for §3.
 *
 * Only append-only writes go through here — inspections and batch rounds. Edits and deletes
 * deliberately require a connection: replaying an edit against a record someone else has since
 * changed needs conflict resolution we have no honest answer for, and a beekeeper in the field is
 * almost always adding observations rather than revising them.
 */
export const db = new Dexie('moj-pcelinjak') as Dexie & {
  outbox: EntityTable<OutboxItem, 'id'>
}

db.version(1).stores({
  outbox: 'id, createdAt, kind',
})
