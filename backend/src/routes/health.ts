import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { assertFarmReference } from '../lib/ownership.js'
import { asDate, asNumber, changedColumns, nullableDate, nullableInt, nullableText, requiredDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §15 — the health record, and §12's prihrana alongside it.
 *
 * Mounted at /api/health-events rather than /api/health: /api/health is the deploy pipeline's
 * liveness probe and must keep answering without a session.
 */
export const healthEventsRouter = Router()
healthEventsRouter.use(requireFarm)

function mapEvent(row: RowDataPacket) {
  return {
    id: row.id as string,
    apiaryId: (row.apiary_id as string | null) ?? null,
    apiaryName: (row.apiary_name as string | null) ?? null,
    hiveId: (row.hive_id as string | null) ?? null,
    hiveCode: (row.hive_code as string | null) ?? null,
    kind: row.kind as string,
    disease: (row.disease as string | null) ?? null,
    severity: (row.severity as string | null) ?? null,
    observedOn: asDate(row.observed_on),
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    vetName: (row.vet_name as string | null) ?? null,
    reportNumber: (row.report_number as string | null) ?? null,
    reportedOn: asDate(row.reported_on),
    coloniesAffected: asNumber(row.colonies_affected),
    coloniesLost: asNumber(row.colonies_lost),
    resolvedOn: asDate(row.resolved_on),
    by: row.by_name ? String(row.by_name).trim() : null,
  }
}

const EVENT_SELECT = `
  SELECT e.*, a.name AS apiary_name, h.code AS hive_code,
         CONCAT(u.first_name, ' ', u.last_name) AS by_name
    FROM health_events e
    LEFT JOIN apiaries a ON a.id = e.apiary_id AND a.farm_id = e.farm_id
    LEFT JOIN hives h ON h.id = e.hive_id
    LEFT JOIN users u ON u.id = e.created_by
`

healthEventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        apiaryId: z.string().trim().min(1).optional(),
        hiveId: z.string().trim().min(1).optional(),
        open: z.enum(['1', '0']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query)

    const filters = ['e.farm_id = ?', 'e.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]

    // A hive's health card must also show what happened to the whole apiary it stands in — a
    // poisoning recorded at yard level concerns every colony there.
    if (query.hiveId) {
      filters.push('(e.hive_id = ? OR (e.hive_id IS NULL AND e.apiary_id = (SELECT apiary_id FROM hives WHERE id = ?)))')
      params.push(query.hiveId, query.hiveId)
    } else if (query.apiaryId) {
      filters.push('e.apiary_id = ?')
      params.push(query.apiaryId)
    }
    if (query.open === '1') filters.push('e.resolved_on IS NULL')

    const [rows] = await pool.query<RowDataPacket[]>(
      `${EVENT_SELECT} WHERE ${filters.join(' AND ')} ORDER BY e.observed_on DESC, e.created_at DESC LIMIT ?`,
      [...params, query.limit],
    )
    res.json({ events: rows.map(mapEvent) })
  }),
)

const eventFields = {
  apiaryId: z.string().trim().min(1).nullish(),
  hiveId: z.string().trim().min(1).nullish(),
  kind: z.enum(['suspicion', 'diagnosis', 'symptom', 'vet_visit', 'lab_result', 'mortality', 'other']),
  disease: z
    .enum([
      'varroa',
      'american_foulbrood',
      'european_foulbrood',
      'nosema',
      'chalkbrood',
      'sacbrood',
      'small_hive_beetle',
      'tropilaelaps',
      'poisoning',
      'other',
    ])
    .nullish(),
  severity: z.enum(['low', 'medium', 'high']).nullish(),
  observedOn: requiredDate,
  title: z.string().trim().min(2, 'Unesite kratak opis').max(200),
  description: nullableText(4000),
  vetName: nullableText(200),
  reportNumber: nullableText(120),
  reportedOn: nullableDate,
  coloniesAffected: nullableInt(0, 10000),
  coloniesLost: nullableInt(0, 10000),
  resolvedOn: nullableDate,
}

const COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  hiveId: 'hive_id',
  kind: 'kind',
  disease: 'disease',
  severity: 'severity',
  observedOn: 'observed_on',
  title: 'title',
  description: 'description',
  vetName: 'vet_name',
  reportNumber: 'report_number',
  reportedOn: 'reported_on',
  coloniesAffected: 'colonies_affected',
  coloniesLost: 'colonies_lost',
  resolvedOn: 'resolved_on',
}

/** Fills in the apiary from the hive, so the caller never has to send a consistent pair. */
async function resolveScope(farmId: string, apiaryId?: string | null, hiveId?: string | null) {
  if (hiveId) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, apiary_id FROM hives WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [hiveId, farmId],
    )
    const row = rows[0]
    if (!row) throw notFound('Košnica nije pronađena')
    const own = row.apiary_id as string | null
    if (own) return { hiveId: row.id as string, apiaryId: own }
    // A hive in transit between apiaries has apiary_id NULL by design (002_apiaries.sql), so in
    // that window the caller's is the only apiary there is — and it is checked like every other
    // reference rather than taken on trust. The foreign key proves the apiary exists, not whose
    // it is, so an unchecked id here wrote another farm's apiary into this farm's records.
    await assertFarmReference(pool, 'apiary', apiaryId, farmId)
    return { hiveId: row.id as string, apiaryId: apiaryId ?? null }
  }
  await assertFarmReference(pool, 'apiary', apiaryId, farmId)
  return { hiveId: null, apiaryId: apiaryId ?? null }
}

async function loadEvent(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${EVENT_SELECT} WHERE e.id = ? AND e.farm_id = ? AND e.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Zapis nije pronađen')
  return row
}

healthEventsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(eventFields).parse(req.body)
    const scope = await resolveScope(farmId, data.apiaryId, data.hiveId)
    const id = newId()

    await pool.query(
      `INSERT INTO health_events
         (id, farm_id, apiary_id, hive_id, kind, disease, severity, observed_on, title,
          description, vet_name, report_number, reported_on, colonies_affected, colonies_lost,
          resolved_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        farmId,
        scope.apiaryId,
        scope.hiveId,
        data.kind,
        data.disease ?? null,
        data.severity ?? null,
        data.observedOn,
        data.title,
        data.description ?? null,
        data.vetName ?? null,
        data.reportNumber ?? null,
        data.reportedOn ?? null,
        data.coloniesAffected ?? null,
        data.coloniesLost ?? null,
        data.resolvedOn ?? null,
        req.user!.id,
      ],
    )

    const created = mapEvent(await loadEvent(farmId, id))
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'health_event.create',
      entityType: 'health_event',
      entityId: id,
      after: created,
    })

    res.status(201).json({ event: created })
  }),
)

healthEventsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadEvent(farmId, req.params.id)
    const data = z
      .object({ ...eventFields, kind: eventFields.kind.optional(), observedOn: eventFields.observedOn.optional(), title: eventFields.title.optional() })
      .parse(req.body)

    let fields = data
    if (data.apiaryId !== undefined || data.hiveId !== undefined) {
      const scope = await resolveScope(
        farmId,
        data.apiaryId === undefined ? (before.apiary_id as string | null) : data.apiaryId,
        data.hiveId === undefined ? (before.hive_id as string | null) : data.hiveId,
      )
      fields = { ...data, apiaryId: scope.apiaryId, hiveId: scope.hiveId }
    }

    const { names, values } = changedColumns(fields, COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE health_events SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadEvent(farmId, before.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'health_event.update',
      entityType: 'health_event',
      entityId: before.id as string,
      before: mapEvent(before),
      after: mapEvent(after),
    })

    res.json({ event: mapEvent(after) })
  }),
)

healthEventsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Zdravstveni zapis može ukloniti samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadEvent(farmId, req.params.id)

    await pool.query('UPDATE health_events SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [
      before.id,
      farmId,
    ])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'health_event.delete',
      entityType: 'health_event',
      entityId: before.id as string,
      before: mapEvent(before),
    })
    res.status(204).end()
  }),
)

// ─────────────────────────────────────────────────────────────────── feedings

/** §12 — prihrana, one of the things a worker records in the field. */
export const feedingsRouter = Router()
feedingsRouter.use(requireFarm)

function mapFeeding(row: RowDataPacket) {
  return {
    id: row.id as string,
    apiaryId: row.apiary_id as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    hiveId: (row.hive_id as string | null) ?? null,
    hiveCode: (row.hive_code as string | null) ?? null,
    fedOn: asDate(row.fed_on),
    feedType: row.feed_type as string,
    amountKg: asNumber(row.amount_kg),
    concentration: (row.concentration as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    by: row.by_name ? String(row.by_name).trim() : null,
  }
}

const FEEDING_SELECT = `
  SELECT f.*, a.name AS apiary_name, h.code AS hive_code,
         CONCAT(u.first_name, ' ', u.last_name) AS by_name
    FROM feedings f
    LEFT JOIN apiaries a ON a.id = f.apiary_id AND a.farm_id = f.farm_id
    LEFT JOIN hives h ON h.id = f.hive_id
    LEFT JOIN users u ON u.id = f.created_by
`

feedingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        apiaryId: z.string().trim().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query)

    const filters = ['f.farm_id = ?']
    const params: unknown[] = [req.farm!.id]
    if (query.apiaryId) {
      filters.push('f.apiary_id = ?')
      params.push(query.apiaryId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${FEEDING_SELECT} WHERE ${filters.join(' AND ')} ORDER BY f.fed_on DESC, f.created_at DESC LIMIT ?`,
      [...params, query.limit],
    )
    res.json({ feedings: rows.map(mapFeeding) })
  }),
)

const feedingSchema = z.object({
  id: z.uuid({ message: 'Neispravan identifikator zapisa' }),
  apiaryId: z.string().trim().min(1, 'Odaberite pčelinjak'),
  hiveId: z.string().trim().min(1).nullish(),
  fedOn: requiredDate,
  feedType: z.enum(['syrup', 'sugar', 'patty', 'honey', 'pollen_substitute', 'other']),
  amountKg: z.coerce.number().min(0).max(10000).nullish(),
  concentration: nullableText(60),
  reason: nullableText(200),
  notes: nullableText(2000),
})

feedingsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = feedingSchema.parse(req.body)
    const scope = await resolveScope(farmId, data.apiaryId, data.hiveId)

    let duplicate = false
    try {
      await pool.query(
        `INSERT INTO feedings
           (id, farm_id, apiary_id, hive_id, fed_on, feed_type, amount_kg, concentration, reason, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.id,
          farmId,
          scope.apiaryId,
          scope.hiveId,
          data.fedOn,
          data.feedType,
          data.amountKg ?? null,
          data.concentration ?? null,
          data.reason ?? null,
          data.notes ?? null,
          req.user!.id,
        ],
      )
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err
      duplicate = true
    }

    if (!duplicate) {
      await writeAudit(req, {
        userId: req.user!.id,
        farmId,
        action: 'feeding.create',
        entityType: 'feeding',
        entityId: data.id,
        after: { apiaryId: scope.apiaryId, fedOn: data.fedOn, feedType: data.feedType, amountKg: data.amountKg },
      })
    }

    res.status(duplicate ? 200 : 201).json({ id: data.id, duplicate })
  }),
)
