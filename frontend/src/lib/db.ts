import Dexie, { type EntityTable } from 'dexie'

export type OutboxKind = 'inspection' | 'inspection_batch' | 'feeding'

export interface OutboxItem {
  /** The client-generated UUID that also becomes the record's primary key on the server. */
  id: string
  userId: string
  farmId: string
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

/**
 * v2 scopes the queue to an account. IndexedDB leaves a row out of a compound index when any part
 * of the key is undefined, so a v1 row — written before the queue knew whose it was — would be
 * invisible to the scoped read that is now the only way rows are fetched: not listed, not sent,
 * and not even discardable, while the pending badge reads zero and the screen says everything is
 * synced. Deleting them is the honest end of that: they cannot be attributed to a user or a farm
 * after the fact, so they cannot be sent anywhere, and the alternative is dead weight no code path
 * can reach. Doing it now costs a dev browser's test rows; after stage 7 it would cost someone's
 * field notes.
 */
db.version(2)
  .stores({
    outbox: 'id, createdAt, kind, [userId+farmId]',
  })
  .upgrade((tx) =>
    tx
      .table<OutboxItem>('outbox')
      .toCollection()
      .filter((item) => !item.userId || !item.farmId)
      .delete(),
  )
