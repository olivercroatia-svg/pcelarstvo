import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise'
import { notFound } from './http.js'

type Executor = Pick<Pool | PoolConnection, 'query'>

const REFERENCES = {
  apiary: { table: 'apiaries', label: 'Pčelinjak', active: true },
  batch: { table: 'honey_batches', label: 'Serija meda', active: true },
  customer: { table: 'customers', label: 'Kupac', active: true },
  document: { table: 'documents', label: 'Dokument', active: true },
  migration: { table: 'apiary_migrations', label: 'Selidba', active: true },
  product: { table: 'products', label: 'Proizvod', active: true },
  queen: { table: 'queens', label: 'Matica', active: true },
  visit: { table: 'apiary_visits', label: 'Obilazak', active: false },
  vmpProduct: { table: 'vmp_products', label: 'VMP proizvod', active: true },
} as const

export type FarmReference = keyof typeof REFERENCES

/** Foreign keys prove existence; this proves the referenced row belongs to the active farm. */
export async function assertFarmReference(
  executor: Executor,
  kind: FarmReference,
  id: string | null | undefined,
  farmId: string,
): Promise<void> {
  if (!id) return
  const reference = REFERENCES[kind]
  const [rows] = await executor.query<RowDataPacket[]>(
    `SELECT id FROM ${reference.table}
      WHERE id = ? AND farm_id = ?${reference.active ? ' AND deleted_at IS NULL' : ''} LIMIT 1`,
    [id, farmId],
  )
  if (rows.length === 0) throw notFound(`${reference.label} nije pronađen`)
}
