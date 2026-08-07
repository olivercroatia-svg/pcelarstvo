import { v7 as uuidv7 } from 'uuid'

/**
 * All primary keys are UUIDv7 stored as CHAR(36).
 *
 * v7 over v4 deliberately: the first 48 bits are a millisecond timestamp, so generated ids sort
 * chronologically. InnoDB clusters rows on the primary key, and random v4 ids scatter inserts
 * across the whole B-tree — v7 keeps them appending at the end, which matters once a farm has
 * years of inspections.
 */
export function newId(): string {
  return uuidv7()
}
