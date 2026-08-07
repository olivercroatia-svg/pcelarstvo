import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { PASTURE_SUGGESTIONS, pastureYields } from '../lib/commerce.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { counted } from '../lib/plural.js'
import {
  asDate,
  asNumber,
  changedColumns,
  nullableDate,
  nullableDecimal,
  nullableInt,
  nullableText,
  requiredDate,
} from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §19 sezonski kalendar, §20 paše, §21 seleće pčelarenje.
 *
 * Not a financial module, so no requireOwner: a worker who drives the hives to the sunflower needs
 * the relocation checklist more than the owner does.
 */

export const seasonRouter = Router()
seasonRouter.use(requireFarm)

export const pasturesRouter = Router()
pasturesRouter.use(requireFarm)

export const relocationsRouter = Router()
relocationsRouter.use(requireFarm)

// ───────────────────────────────────────────────────────────── §19 seasonal calendar

const REGIONS = ['all', 'continental', 'coastal', 'mountain'] as const

/**
 * §19's calendar, filtered by region and by whether the farm actually migrates.
 *
 * The migratory filter is derived from the farm's own apiaries rather than asked for: if no apiary
 * is marked seleći, the four "priprema selidbe" rows are noise on a screen that is meant to be a
 * to-do list. The region has no equivalent in the data — nothing records where the farm is — so it
 * is a chip on the screen, defaulting to all.
 */
seasonRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const query = z
      .object({
        region: z.enum(REGIONS).default('all'),
        month: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(req.query)

    const [migratoryRows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM apiaries WHERE farm_id = ? AND deleted_at IS NULL AND kind = 'migratory'",
      [farmId],
    )
    const migratory = Number(migratoryRows[0]?.total ?? 0) > 0

    const filters = ['active = TRUE']
    const params: unknown[] = []
    if (query.region !== 'all') {
      filters.push("(region = 'all' OR region = ?)")
      params.push(query.region)
    }
    if (!migratory) filters.push("apiary_kind <> 'migratory'")
    if (query.month) {
      filters.push('month = ?')
      params.push(query.month)
    }

    const [tasks] = await pool.query<RowDataPacket[]>(
      `SELECT id, month, title, detail, region, apiary_kind
         FROM season_tasks WHERE ${filters.join(' AND ')} ORDER BY month, sort_order, title`,
      params,
    )

    res.json({
      month: new Date().getMonth() + 1,
      region: query.region,
      migratory,
      months: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        tasks: tasks
          .filter((t) => Number(t.month) === i + 1)
          .map((t) => ({
            id: t.id as string,
            title: t.title as string,
            detail: (t.detail as string | null) ?? null,
            region: t.region as string,
            apiaryKind: t.apiary_kind as string,
          })),
      })),
    })
  }),
)

// ───────────────────────────────────────────────────────────── §20 pastures

function mapPasture(row: RowDataPacket, derived?: { kg: number; harvests: number }) {
  const expected = asNumber(row.expected_yield_kg)
  const actual = derived?.kg ?? 0
  return {
    id: row.id as string,
    apiaryId: (row.apiary_id as string | null) ?? null,
    apiaryName: (row.apiary_name as string | null) ?? null,
    name: row.name as string,
    seasonYear: Number(row.season_year),
    startsOn: asDate(row.starts_on),
    endsOn: asDate(row.ends_on),
    location: (row.location as string | null) ?? null,
    coloniesCount: asNumber(row.colonies_count),
    expectedYieldKg: expected,
    // §20 "stvarni prinos" — summed from the harvests, never typed. See the pastures table comment
    // in 006_commerce.sql.
    actualYieldKg: Number(actual.toFixed(2)),
    harvests: derived?.harvests ?? 0,
    achievedPercent: expected && expected > 0 ? Math.round((actual / expected) * 100) : null,
    notes: (row.notes as string | null) ?? null,
  }
}

const PASTURE_SELECT = `
  SELECT p.*, a.name AS apiary_name
    FROM pastures p LEFT JOIN apiaries a ON a.id = p.apiary_id
`

pasturesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const query = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query)

    const filters = ['p.farm_id = ?', 'p.deleted_at IS NULL']
    const params: unknown[] = [farmId]
    if (query.year) {
      filters.push('p.season_year = ?')
      params.push(query.year)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${PASTURE_SELECT} WHERE ${filters.join(' AND ')} ORDER BY p.season_year DESC, p.starts_on, p.name`,
      params,
    )
    const derived = await pastureYields(farmId)

    res.json({
      pastures: rows.map((r) => mapPasture(r, derived.get(r.id as string))),
      suggestions: PASTURE_SUGGESTIONS,
    })
  }),
)

const pastureFields = {
  apiaryId: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(2, 'Unesite naziv paše').max(120),
  seasonYear: z.coerce.number().int().min(2000).max(2100),
  startsOn: nullableDate,
  endsOn: nullableDate,
  location: nullableText(200),
  coloniesCount: nullableInt(0, 10000),
  expectedYieldKg: nullableDecimal(0, 1000000),
  notes: nullableText(2000),
}

const PASTURE_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  name: 'name',
  seasonYear: 'season_year',
  startsOn: 'starts_on',
  endsOn: 'ends_on',
  location: 'location',
  coloniesCount: 'colonies_count',
  expectedYieldKg: 'expected_yield_kg',
  notes: 'notes',
}

pasturesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(pastureFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, PASTURE_COLUMNS)

    await pool.query(
      `INSERT INTO pastures (id, farm_id, created_by, ${names.join(', ')})
       VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, req.user!.id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'pasture.create',
      entityType: 'pasture',
      entityId: id,
      after: { name: data.name, seasonYear: data.seasonYear },
    })

    const [rows] = await pool.query<RowDataPacket[]>(`${PASTURE_SELECT} WHERE p.id = ?`, [id])
    res.status(201).json({ pasture: mapPasture(rows[0]!) })
  }),
)

pasturesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [existing] = await pool.query<RowDataPacket[]>(
      `${PASTURE_SELECT} WHERE p.id = ? AND p.farm_id = ? AND p.deleted_at IS NULL LIMIT 1`,
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Paša nije pronađena')

    const data = z
      .object({
        ...pastureFields,
        name: pastureFields.name.optional(),
        seasonYear: pastureFields.seasonYear.optional(),
      })
      .parse(req.body)

    const { names, values } = changedColumns(data, PASTURE_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE pastures SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>(`${PASTURE_SELECT} WHERE p.id = ?`, [before.id])
    const derived = await pastureYields(farmId)
    res.json({ pasture: mapPasture(after[0]!, derived.get(before.id as string)) })
  }),
)

pasturesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name FROM pastures WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    if (rows.length === 0) throw notFound('Paša nije pronađena')

    await pool.query('UPDATE pastures SET deleted_at = NOW() WHERE id = ?', [req.params.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'pasture.delete',
      entityType: 'pasture',
      entityId: req.params.id,
      before: { name: rows[0]!.name },
    })
    res.status(204).end()
  }),
)

// ───────────────────────────────────────────────────────────── §21 relocations

interface Permission {
  id: string
  grantedBy: string
  referenceNumber: string | null
  validFrom: string | null
  validUntil: string | null
  documentId: string | null
  documentTitle: string | null
  expired: boolean
  notes: string | null
}

function mapPermission(row: RowDataPacket): Permission {
  const validUntil = asDate(row.valid_until)
  return {
    id: row.id as string,
    grantedBy: row.granted_by as string,
    referenceNumber: (row.reference_number as string | null) ?? null,
    validFrom: asDate(row.valid_from),
    validUntil,
    documentId: (row.document_id as string | null) ?? null,
    documentTitle: (row.document_title as string | null) ?? null,
    expired: validUntil !== null && validUntil < new Date().toISOString().slice(0, 10),
    notes: (row.notes as string | null) ?? null,
  }
}

function mapRelocation(row: RowDataPacket, permissions: Permission[]) {
  const coloniesCount = asNumber(row.colonies_count)
  const commissioner = (row.commissioner as string | null) ?? null
  const transport = Boolean(row.transport_arranged)
  const valid = permissions.filter((p) => !p.expired)

  // §21's checklist, derived every time it is read. A stored tick outlives the fact behind it —
  // a consent that expires would leave a green mark on a move that is no longer permitted.
  const checks = [
    {
      key: 'location',
      label: 'Lokacija odabrana',
      ok: String(row.to_location ?? '').trim().length > 0,
      detail: (row.to_location as string | null) ?? null,
    },
    {
      key: 'colonies',
      label: 'Zajednice odabrane',
      ok: coloniesCount !== null && coloniesCount > 0,
      detail: coloniesCount ? counted(coloniesCount, 'zajednica', 'zajednice', 'zajednica') : 'broj nije upisan',
    },
    {
      key: 'permission',
      label: 'Suglasnost za smještaj',
      ok: valid.length > 0,
      detail:
        valid.length > 0
          ? valid.map((p) => p.grantedBy).join(', ')
          : permissions.length > 0
            ? 'suglasnost je istekla'
            : 'nije unesena',
    },
    {
      key: 'commissioner',
      label: 'Kontakt povjerenika evidentiran',
      ok: commissioner !== null && commissioner.length > 0,
      detail: commissioner,
    },
    { key: 'transport', label: 'Prijevoz organiziran', ok: transport, detail: transport ? null : 'nije potvrđen' },
  ]

  return {
    id: row.id as string,
    apiaryId: row.apiary_id as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    fromLocation: (row.from_location as string | null) ?? null,
    toLocation: row.to_location as string,
    toLatitude: asNumber(row.to_latitude),
    toLongitude: asNumber(row.to_longitude),
    pasture: (row.pasture as string | null) ?? null,
    plannedOn: asDate(row.planned_on),
    completedOn: asDate(row.completed_on),
    coloniesCount,
    transportArranged: transport,
    commissioner,
    commissionerPhone: (row.commissioner_phone as string | null) ?? null,
    status: row.status as 'planned' | 'done' | 'cancelled',
    notes: (row.notes as string | null) ?? null,
    permissions,
    checks,
    ready: checks.every((c) => c.ok),
  }
}

const RELOCATION_SELECT = `
  SELECT m.*, a.name AS apiary_name
    FROM apiary_migrations m JOIN apiaries a ON a.id = m.apiary_id
`

async function permissionsFor(
  farmId: string,
  column: 'migration_id' | 'apiary_id',
  ids: string[],
): Promise<Map<string, Permission[]>> {
  const map = new Map<string, Permission[]>()
  if (ids.length === 0) return map

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.*, d.title AS document_title
       FROM apiary_permissions p LEFT JOIN documents d ON d.id = p.document_id
      WHERE p.farm_id = ? AND p.deleted_at IS NULL AND p.${column} IN (?)
      ORDER BY p.valid_until DESC`,
    [farmId, ids],
  )
  for (const row of rows) {
    const key = row[column] as string
    map.set(key, [...(map.get(key) ?? []), mapPermission(row)])
  }
  return map
}

relocationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const query = z.object({ status: z.enum(['planned', 'done', 'cancelled']).optional() }).parse(req.query)

    const filters = ['m.farm_id = ?', 'm.deleted_at IS NULL']
    const params: unknown[] = [farmId]
    if (query.status) {
      filters.push('m.status = ?')
      params.push(query.status)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${RELOCATION_SELECT} WHERE ${filters.join(' AND ')} ORDER BY m.planned_on DESC LIMIT 200`,
      params,
    )
    const permissions = await permissionsFor(
      farmId,
      'migration_id',
      rows.map((r) => r.id as string),
    )

    res.json({
      relocations: rows.map((r) => mapRelocation(r, permissions.get(r.id as string) ?? [])),
    })
  }),
)

const relocationFields = {
  apiaryId: z.string().trim().min(1, 'Odaberite pčelinjak'),
  fromLocation: nullableText(200),
  toLocation: z.string().trim().min(2, 'Unesite odredište').max(200),
  toLatitude: nullableDecimal(-90, 90),
  toLongitude: nullableDecimal(-180, 180),
  pasture: nullableText(120),
  plannedOn: requiredDate,
  completedOn: nullableDate,
  coloniesCount: nullableInt(0, 10000),
  transportArranged: z.boolean().optional(),
  commissioner: nullableText(200),
  commissionerPhone: nullableText(60),
  notes: nullableText(2000),
}

const RELOCATION_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  fromLocation: 'from_location',
  toLocation: 'to_location',
  toLatitude: 'to_latitude',
  toLongitude: 'to_longitude',
  pasture: 'pasture',
  plannedOn: 'planned_on',
  completedOn: 'completed_on',
  coloniesCount: 'colonies_count',
  commissioner: 'commissioner',
  commissionerPhone: 'commissioner_phone',
  notes: 'notes',
}

async function loadRelocation(farmId: string, id: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${RELOCATION_SELECT} WHERE m.id = ? AND m.farm_id = ? AND m.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Selidba nije pronađena')
  const permissions = await permissionsFor(farmId, 'migration_id', [id])
  return mapRelocation(row, permissions.get(id) ?? [])
}

relocationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(relocationFields).parse(req.body)

    const [apiary] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, location_name, city FROM apiaries WHERE id = ? AND farm_id = ? AND deleted_at IS NULL',
      [data.apiaryId, farmId],
    )
    if (apiary.length === 0) throw notFound('Pčelinjak nije pronađen')

    const { transportArranged, ...fields } = data
    const id = newId()
    const { names, values } = changedColumns(fields, RELOCATION_COLUMNS)

    // Where the hives stand today, filled in when the form left it blank — it is knowable and
    // retyping it is exactly the kind of friction that stops a record being made at all.
    if (!fields.fromLocation) {
      const current = (apiary[0]!.location_name as string | null) ?? (apiary[0]!.city as string | null)
      if (current) {
        names.push('from_location')
        values.push(current)
      }
    }

    await pool.query(
      `INSERT INTO apiary_migrations (id, farm_id, created_by, transport_arranged, ${names.join(', ')})
       VALUES (?, ?, ?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, req.user!.id, transportArranged ?? false, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'relocation.create',
      entityType: 'apiary_migration',
      entityId: id,
      after: { toLocation: data.toLocation, plannedOn: data.plannedOn },
    })

    res.status(201).json({ relocation: await loadRelocation(farmId, id) })
  }),
)

relocationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ relocation: await loadRelocation(req.farm!.id, req.params.id) })
  }),
)

relocationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadRelocation(farmId, req.params.id)
    const data = z
      .object({
        ...relocationFields,
        apiaryId: relocationFields.apiaryId.optional(),
        toLocation: relocationFields.toLocation.optional(),
        plannedOn: requiredDate.optional(),
        status: z.enum(['planned', 'done', 'cancelled']).optional(),
      })
      .parse(req.body)

    const { transportArranged, status, ...fields } = data
    const { names, values } = changedColumns(fields, RELOCATION_COLUMNS)
    if (transportArranged !== undefined) {
      names.push('transport_arranged')
      values.push(transportArranged)
    }
    if (status !== undefined) {
      names.push('status')
      values.push(status)
      // Marking a move done without saying when is the common case; the date is what the timeline
      // and the annual report read, so it is filled rather than left for a second edit.
      if (status === 'done' && !fields.completedOn && !before.completedOn) {
        names.push('completed_on')
        values.push(new Date().toISOString().slice(0, 10))
      }
    }

    if (names.length > 0) {
      await pool.query(
        `UPDATE apiary_migrations SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadRelocation(farmId, before.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'relocation.update',
      entityType: 'apiary_migration',
      entityId: before.id,
      before: { status: before.status, toLocation: before.toLocation },
      after: { status: after.status, toLocation: after.toLocation },
    })
    res.json({ relocation: after })
  }),
)

relocationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadRelocation(farmId, req.params.id)

    await pool.query('UPDATE apiary_migrations SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'relocation.delete',
      entityType: 'apiary_migration',
      entityId: before.id,
      before: { toLocation: before.toLocation, plannedOn: before.plannedOn },
    })
    res.status(204).end()
  }),
)

// ───────────────────────────────────────────────────── §21 consents ("Dodaj suglasnost")

const permissionFields = {
  apiaryId: z.string().trim().min(1).nullish(),
  migrationId: z.string().trim().min(1).nullish(),
  grantedBy: z.string().trim().min(2, 'Unesite tko je dao suglasnost').max(200),
  referenceNumber: nullableText(120),
  validFrom: nullableDate,
  validUntil: nullableDate,
  documentId: z.string().trim().min(1).nullish(),
  notes: nullableText(2000),
}

const PERMISSION_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  migrationId: 'migration_id',
  grantedBy: 'granted_by',
  referenceNumber: 'reference_number',
  validFrom: 'valid_from',
  validUntil: 'valid_until',
  documentId: 'document_id',
  notes: 'notes',
}

/**
 * Mounted on the relocations router but usable for a standing apiary too — a consent for where the
 * hives already are is the same piece of paper as a consent for where they are going.
 */
relocationsRouter.post(
  '/permissions',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(permissionFields).parse(req.body)
    if (!data.apiaryId && !data.migrationId) throw badRequest('Odaberite pčelinjak ili selidbu')

    const id = newId()
    const { names, values } = changedColumns(data, PERMISSION_COLUMNS)
    await pool.query(
      `INSERT INTO apiary_permissions (id, farm_id, created_by, ${names.join(', ')})
       VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, req.user!.id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'permission.create',
      entityType: 'apiary_permission',
      entityId: id,
      after: { grantedBy: data.grantedBy, validUntil: data.validUntil },
    })

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, d.title AS document_title FROM apiary_permissions p
        LEFT JOIN documents d ON d.id = p.document_id WHERE p.id = ?`,
      [id],
    )
    res.status(201).json({ permission: mapPermission(rows[0]!) })
  }),
)

relocationsRouter.delete(
  '/permissions/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, granted_by FROM apiary_permissions WHERE id = ? AND farm_id = ? AND deleted_at IS NULL',
      [req.params.id, farmId],
    )
    if (rows.length === 0) throw notFound('Suglasnost nije pronađena')

    await pool.query('UPDATE apiary_permissions SET deleted_at = NOW() WHERE id = ?', [req.params.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'permission.delete',
      entityType: 'apiary_permission',
      entityId: req.params.id,
      before: { grantedBy: rows[0]!.granted_by },
    })
    res.status(204).end()
  }),
)

/** Consents on a standing apiary — read by the apiary card and by §27's readiness list. */
export async function apiaryPermissions(farmId: string, apiaryId: string): Promise<Permission[]> {
  const map = await permissionsFor(farmId, 'apiary_id', [apiaryId])
  return map.get(apiaryId) ?? []
}
