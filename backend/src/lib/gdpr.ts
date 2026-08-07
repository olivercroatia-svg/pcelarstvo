import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { pool } from '../db.js'
import { resolveUploadRoot } from './storage.js'

/**
 * §56 — the two rights that need code rather than a policy page: take everything with you, and be
 * gone.
 *
 * The whole file is one table map and two functions over it. That shape is deliberate: a GDPR
 * export is only worth anything if it is *complete*, and completeness is a property of the list,
 * not of the code that walks it. A table added in a later module and forgotten here is a silent
 * compliance hole — nothing fails, the export is simply missing a chapter — which is why
 * SHARED_REFERENCE is exported alongside the map. Every table in the schema belongs to exactly
 * one of the two, and the verification script asserts it.
 */

/** What a worker may take out of a given table (§4). */
type WorkerScope =
  /** Rows they wrote, found through this column. */
  | 'created_by'
  | 'user_id'
  /** Nothing. Either the table has no author (it is the farm's register, not their record), or
   *  it carries money — the same omission the commerce routers make with requireOwner. */
  | 'none'

interface FarmTable {
  table: string
  worker: WorkerScope
}

/**
 * Every table carrying a `farm_id`, exported wholesale for the owner.
 *
 * `SELECT *` rather than a column list on purpose: a column added by a later migration then
 * appears in the export without anyone remembering to come back here. The rows go to the person
 * they are about, so there is nothing a wildcard can over-disclose — the one exception is
 * `users.password_hash`, and users is not in this list.
 */
const FARM_TABLES: readonly FarmTable[] = [
  // Pčelinjaci i košnice (§7–§14)
  { table: 'apiaries', worker: 'none' },
  { table: 'apiary_permissions', worker: 'created_by' },
  { table: 'apiary_visits', worker: 'user_id' },
  { table: 'hives', worker: 'none' },
  { table: 'colonies', worker: 'none' },
  { table: 'queens', worker: 'none' },
  { table: 'hive_inspections', worker: 'user_id' },
  { table: 'photos', worker: 'created_by' },

  // Zdravlje (§15–§18)
  { table: 'health_events', worker: 'created_by' },
  { table: 'varroa_checks', worker: 'created_by' },
  { table: 'vmp_products', worker: 'none' },
  { table: 'veterinary_treatments', worker: 'created_by' },
  { table: 'feedings', worker: 'created_by' },

  // Zakon i papiri (§22–§27, §53)
  { table: 'user_obligations', worker: 'none' },
  { table: 'notifications', worker: 'user_id' },
  { table: 'documents', worker: 'created_by' },

  // Proizvodnja i sljedivost (§28–§36)
  { table: 'harvests', worker: 'created_by' },
  { table: 'honey_batches', worker: 'created_by' },
  { table: 'laboratory_tests', worker: 'created_by' },
  { table: 'packaging_batches', worker: 'created_by' },
  { table: 'products', worker: 'none' },
  { table: 'inventory_items', worker: 'none' },
  { table: 'inventory_movements', worker: 'created_by' },

  // Sezona i teren (§19–§21)
  { table: 'pastures', worker: 'created_by' },
  { table: 'apiary_migrations', worker: 'created_by' },

  // Komercijala (§37–§40, §50). 'none' here is §4, not an omission: these five are the tables a
  // worker's session cannot reach through any route either.
  { table: 'customers', worker: 'none' },
  { table: 'sales', worker: 'none' },
  { table: 'expenses', worker: 'none' },
  { table: 'subsidy_applications', worker: 'none' },

  // AI sloj (§45, §46). The conversation is free text the user typed, so it is theirs to take.
  { table: 'ai_conversations', worker: 'user_id' },
  { table: 'ai_usage', worker: 'user_id' },

  // §56 — the trail of what was done to this farm's records.
  { table: 'audit_logs', worker: 'user_id' },
]

/**
 * Tables with no `farm_id` of their own, reached through the parent that has one. Owner export
 * only — each is a detail line of a farm-level record.
 */
const CHILD_TABLES: readonly { table: string; sql: string }[] = [
  {
    table: 'harvest_containers',
    sql: `SELECT c.* FROM harvest_containers c
            JOIN harvests h ON h.id = c.harvest_id WHERE h.farm_id = ?`,
  },
  {
    table: 'harvest_hives',
    sql: `SELECT x.* FROM harvest_hives x
            JOIN harvests h ON h.id = x.harvest_id WHERE h.farm_id = ?`,
  },
  {
    table: 'treatment_hives',
    sql: `SELECT x.* FROM treatment_hives x
            JOIN veterinary_treatments t ON t.id = x.treatment_id WHERE t.farm_id = ?`,
  },
  {
    table: 'laboratory_values',
    sql: `SELECT v.* FROM laboratory_values v
            JOIN laboratory_tests t ON t.id = v.test_id WHERE t.farm_id = ?`,
  },
  {
    table: 'sale_items',
    sql: `SELECT i.* FROM sale_items i
            JOIN sales s ON s.id = i.sale_id WHERE s.farm_id = ?`,
  },
  {
    table: 'subsidy_application_documents',
    sql: `SELECT d.* FROM subsidy_application_documents d
            JOIN subsidy_applications a ON a.id = d.application_id WHERE a.farm_id = ?`,
  },
  {
    table: 'ai_messages',
    sql: `SELECT m.* FROM ai_messages m
            JOIN ai_conversations c ON c.id = m.conversation_id WHERE c.farm_id = ?`,
  },
]

/**
 * The other half of the schema: regulation and configuration, byte-identical for every
 * installation and about nobody (§54). Exported so the verification script can assert that every
 * table in the database is in exactly one of the two lists.
 */
export const SHARED_REFERENCE: ReadonlySet<string> = new Set([
  'schema_migrations',
  'legal_obligations',
  'season_tasks',
  'subsidy_programs',
  'subsidy_requirements',
  'lab_parameters',
  'declaration_texts',
  'ai_settings',
  // Handled by name rather than by the map: users and sessions are keyed on the person, farms and
  // farm_members on the membership.
  'users',
  'sessions',
  'farms',
  'farm_members',
])

export interface DataExport {
  meta: {
    generatedAt: string
    application: string
    scope: 'owner' | 'worker'
    note: string
  }
  user: Record<string, unknown>
  sessions: unknown[]
  memberships: unknown[]
  farm: Record<string, unknown> | null
  data: Record<string, unknown[]>
}

const OWNER_NOTE =
  'Izvoz sadrži sve zapise gospodarstva u strojno čitljivom obliku (GDPR čl. 15 i 20). ' +
  'Fotografije i skenirani dokumenti nisu u ovoj datoteci — u zapisima su njihovi nazivi, ' +
  'a same datoteke preuzmite iz aplikacije prije brisanja računa.'

const WORKER_NOTE =
  'Izvoz sadrži vaše korisničke podatke i zapise koje ste sami unijeli. ' +
  'Evidencija gospodarstva pripada vlasniku gospodarstva i nije dio ovog izvoza.'

/**
 * Everything the application holds about one person, as JSON (GDPR čl. 15 and 20).
 *
 * Role-shaped, and that is the point: handing a worker the farm's sales ledger would be a §4
 * bypass wearing a compliance badge. What is theirs is their account and the rows they wrote.
 */
export async function buildExport(
  userId: string,
  farmId: string | null,
  role: 'owner' | 'worker' | null,
): Promise<DataExport> {
  const isOwner = role === 'owner'

  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, last_name, phone, is_admin,
            email_verified_at, last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
    [userId],
  )

  const [sessions] = await pool.query<RowDataPacket[]>(
    `SELECT id, expires_at, revoked_at, user_agent, ip_address, created_at
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  )

  const [memberships] = await pool.query<RowDataPacket[]>(
    `SELECT id, farm_id, role, invited_at, accepted_at, created_at, deleted_at
       FROM farm_members WHERE user_id = ?`,
    [userId],
  )

  let farm: Record<string, unknown> | null = null
  const data: Record<string, unknown[]> = {}

  if (farmId) {
    if (isOwner) {
      const [farmRows] = await pool.query<RowDataPacket[]>('SELECT * FROM farms WHERE id = ?', [farmId])
      farm = (farmRows[0] as Record<string, unknown> | undefined) ?? null
    }

    for (const entry of FARM_TABLES) {
      if (isOwner) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM ${entry.table} WHERE farm_id = ?`,
          [farmId],
        )
        data[entry.table] = rows
      } else if (entry.worker !== 'none') {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM ${entry.table} WHERE farm_id = ? AND ${entry.worker} = ?`,
          [farmId, userId],
        )
        if (rows.length > 0) data[entry.table] = rows
      }
    }

    if (isOwner) {
      for (const child of CHILD_TABLES) {
        const [rows] = await pool.query<RowDataPacket[]>(child.sql, [farmId])
        data[child.table] = rows
      }
    }
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      application: 'Moj Pčelinjak',
      scope: isOwner ? 'owner' : 'worker',
      note: isOwner ? OWNER_NOTE : WORKER_NOTE,
    },
    user: (userRows[0] as Record<string, unknown> | undefined) ?? {},
    sessions,
    memberships,
    farm,
    data,
  }
}

export interface EraseSummary {
  farmsClosed: number
  filesRemoved: number
  filesFailed: number
}

/**
 * Farms this user owns alone. A farm with a second owner keeps running — one person leaving a
 * shared business does not erase the business's register.
 */
async function soleOwnedFarms(conn: PoolConnection, userId: string): Promise<string[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT f.id
       FROM farms f
       JOIN farm_members m
         ON m.farm_id = f.id AND m.user_id = ? AND m.role = 'owner' AND m.deleted_at IS NULL
      WHERE f.deleted_at IS NULL
        AND NOT EXISTS (
              SELECT 1 FROM farm_members o
               WHERE o.farm_id = f.id AND o.role = 'owner'
                 AND o.user_id <> ? AND o.deleted_at IS NULL
            )`,
    [userId, userId],
  )
  return rows.map((r) => r.id as string)
}

/**
 * GDPR čl. 17, as far as an application that also keeps a statutory register can honestly go.
 *
 * Erasure here means the data stops being *personal*, not that forty tables are truncated. Every
 * field that identifies a natural person is overwritten — the account, the farm's identity, the
 * customers' names and OIBs, the apiary coordinates §56 exists to protect — the uploaded scans
 * are unlinked from disk, and the farm is soft-deleted, which removes it from every query in the
 * application at once because every route already filters `deleted_at IS NULL`. What remains is a
 * detached record that a frame of brood was counted on a Tuesday, which is nobody's personal
 * data.
 *
 * `audit_logs` survives on purpose (čl. 17(3)(b)): it is the register's evidence that a treatment
 * was entered by *someone*, and after this runs that someone no longer resolves to a name.
 *
 * The export button sits directly above the delete button on the screen for a reason — this is
 * not reversible, and the statutory records a beekeeper is required to keep for years are going
 * with it.
 */
export async function eraseAccount(userId: string): Promise<EraseSummary> {
  const conn = await pool.getConnection()
  const files: string[] = []
  let farmsClosed = 0

  try {
    await conn.beginTransaction()

    const farmIds = await soleOwnedFarms(conn, userId)

    for (const farmId of farmIds) {
      // Collected before the rows are blanked; unlinked after the transaction commits.
      const [photoRows] = await conn.query<RowDataPacket[]>(
        'SELECT file_path FROM photos WHERE farm_id = ? AND file_path IS NOT NULL',
        [farmId],
      )
      const [docRows] = await conn.query<RowDataPacket[]>(
        "SELECT file_path FROM documents WHERE farm_id = ? AND file_path IS NOT NULL AND file_path <> ''",
        [farmId],
      )
      for (const row of [...photoRows, ...docRows]) files.push(row.file_path as string)

      await conn.query(
        `UPDATE farms
            SET name = NULL, oib = NULL, mibpg = NULL, responsible_person = NULL,
                address = NULL, city = NULL, postal_code = NULL, epp_number = NULL,
                association = NULL, pasture_commissioner = NULL,
                deleted_at = NOW()
          WHERE id = ?`,
        [farmId],
      )

      // Third-party personal data — a buyer never agreed to outlive the account they were typed
      // into. §38 keeps an OIB and a home address for private buyers, so this is not optional.
      await conn.query(
        `UPDATE customers
            SET name = 'Obrisani kupac', oib = NULL, address = NULL, city = NULL,
                postal_code = NULL, contact_person = NULL, phone = NULL, email = NULL,
                notes = NULL, deleted_at = COALESCE(deleted_at, NOW())
          WHERE farm_id = ?`,
        [farmId],
      )

      // §56 — an apiary's coordinates point at a place someone lives or keeps property.
      await conn.query(
        `UPDATE apiaries
            SET location_name = NULL, address = NULL, city = NULL,
                latitude = NULL, longitude = NULL, permit_number = NULL, notes = NULL
          WHERE farm_id = ?`,
        [farmId],
      )

      await conn.query(
        `UPDATE photos SET file_path = '', caption = NULL, deleted_at = COALESCE(deleted_at, NOW())
          WHERE farm_id = ?`,
        [farmId],
      )
      await conn.query(
        `UPDATE documents
            SET file_path = '', file_name = '', title = 'Obrisano', description = NULL,
                reference_number = NULL, issuer = NULL,
                deleted_at = COALESCE(deleted_at, NOW())
          WHERE farm_id = ?`,
        [farmId],
      )

      // Free text the user typed at an assistant, and the model's reply. No register depends on
      // it, so it is deleted outright rather than detached.
      await conn.query(
        `DELETE m FROM ai_messages m
           JOIN ai_conversations c ON c.id = m.conversation_id
          WHERE c.farm_id = ?`,
        [farmId],
      )
      await conn.query('DELETE FROM ai_conversations WHERE farm_id = ?', [farmId])

      farmsClosed += 1
    }

    await conn.query(
      'UPDATE farm_members SET deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    )
    await conn.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [userId],
    )

    // The address is overwritten rather than released: `users.email` is uniquely indexed and MySQL
    // cannot express "unique among non-deleted", so a tombstone row would reserve the address
    // forever (see 001_init.sql). Overwriting frees it and removes the identifier in one step.
    //
    // The *whole* id, not a prefix of it. UUIDv7 begins with a timestamp, so two accounts opened
    // within the same few seconds share their first eight characters — and the second deletion
    // then collides on the unique index, rolls the transaction back, and fails an operation the
    // user has already been told is irreversible. `.invalid` is reserved by RFC 2606, so the
    // address can never reach a real mailbox.
    const hash = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
    await conn.query(
      `UPDATE users
          SET email = CONCAT('obrisan-', id, '@obrisano.invalid'),
              first_name = 'Obrisani', last_name = 'korisnik',
              phone = NULL, password_hash = ?, is_admin = FALSE,
              email_verified_at = NULL, deleted_at = NOW()
        WHERE id = ?`,
      [hash, userId],
    )

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // After the commit, never inside it. A file system error must not roll back an erasure the user
  // has already been told is irreversible; the paths are logged instead so an operator can finish
  // the job by hand.
  const root = resolveUploadRoot()
  let filesRemoved = 0
  let filesFailed = 0
  for (const relative of files) {
    try {
      await fs.unlink(path.join(root, relative))
      filesRemoved += 1
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue // already gone; nothing to report
      filesFailed += 1
      console.error('[gdpr] could not remove uploaded file', relative, err)
    }
  }

  return { farmsClosed, filesRemoved, filesFailed }
}
