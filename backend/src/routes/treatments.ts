import { Router } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { validateTreatmentDates } from '../lib/invariants.js'
import { assertFarmReference } from '../lib/ownership.js'
import { asDate, asNumber, changedColumns, nullableDate, nullableInt, nullableText, requiredDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

// ─────────────────────────────────────────────────────────── vmp_products (§17, §18)

export const vmpRouter = Router()
vmpRouter.use(requireFarm)

function mapProduct(row: RowDataPacket) {
  return {
    id: row.id as string,
    name: row.name as string,
    activeSubstance: (row.active_substance as string | null) ?? null,
    manufacturer: (row.manufacturer as string | null) ?? null,
    form: (row.form as string | null) ?? null,
    withdrawalDays: asNumber(row.withdrawal_days),
    defaultDose: (row.default_dose as string | null) ?? null,
    defaultMethod: (row.default_method as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  }
}

const productFields = {
  name: z.string().trim().min(2, 'Unesite naziv proizvoda').max(200),
  activeSubstance: nullableText(200),
  manufacturer: nullableText(200),
  form: nullableText(100),
  withdrawalDays: nullableInt(0, 3650),
  defaultDose: nullableText(150),
  defaultMethod: nullableText(150),
  notes: nullableText(2000),
}

const PRODUCT_COLUMNS: Record<string, string> = {
  name: 'name',
  activeSubstance: 'active_substance',
  manufacturer: 'manufacturer',
  form: 'form',
  withdrawalDays: 'withdrawal_days',
  defaultDose: 'default_dose',
  defaultMethod: 'default_method',
  notes: 'notes',
}

vmpRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM vmp_products WHERE farm_id = ? AND deleted_at IS NULL ORDER BY name',
      [req.farm!.id],
    )
    res.json({ products: rows.map(mapProduct) })
  }),
)

vmpRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(productFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, PRODUCT_COLUMNS)

    await pool.query(
      `INSERT INTO vmp_products (id, farm_id, ${names.join(', ')})
       VALUES (?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'vmp_product.create',
      entityType: 'vmp_product',
      entityId: id,
      after: data,
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM vmp_products WHERE id = ?', [id])
    res.status(201).json({ product: mapProduct(rows[0]!) })
  }),
)

vmpRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM vmp_products WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Proizvod nije pronađen')

    const data = z.object({ ...productFields, name: productFields.name.optional() }).parse(req.body)
    const { names, values } = changedColumns(data, PRODUCT_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE vmp_products SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM vmp_products WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'vmp_product.update',
      entityType: 'vmp_product',
      entityId: before.id as string,
      before: mapProduct(before),
      after: mapProduct(after[0]!),
    })
    res.json({ product: mapProduct(after[0]!) })
  }),
)

vmpRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Proizvod može ukloniti samo vlasnik')
    // Soft delete only, and treatments keep their own copy of the product data — removing a
    // product from the shelf must never blank out what a past treatment says was applied.
    const [result] = await pool.query<RowDataPacket[]>(
      'SELECT id, name FROM vmp_products WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.farm!.id],
    )
    if (result.length === 0) throw notFound('Proizvod nije pronađen')

    await pool.query('UPDATE vmp_products SET deleted_at = NOW() WHERE id = ?', [req.params.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId: req.farm!.id,
      action: 'vmp_product.delete',
      entityType: 'vmp_product',
      entityId: req.params.id,
      before: { name: result[0]!.name },
    })
    res.status(204).end()
  }),
)

// ─────────────────────────────────────────────── veterinary_treatments (§17)

export const treatmentsRouter = Router()
treatmentsRouter.use(requireFarm)

function mapTreatment(row: RowDataPacket) {
  const withdrawalUntil = asDate(row.withdrawal_until)
  return {
    id: row.id as string,
    apiaryId: row.apiary_id as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    productName: row.product_name as string,
    activeSubstance: (row.active_substance as string | null) ?? null,
    manufacturer: (row.manufacturer as string | null) ?? null,
    lotNumber: (row.lot_number as string | null) ?? null,
    productExpiresOn: asDate(row.product_expires_on),
    startedOn: asDate(row.started_on),
    endedOn: asDate(row.ended_on),
    dose: (row.dose as string | null) ?? null,
    applicationMethod: (row.application_method as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    withdrawalDays: asNumber(row.withdrawal_days),
    withdrawalUntil,
    // Whether honey may be taken today. Computed here rather than in each screen so the answer is
    // the same everywhere it is shown.
    withdrawalActive: withdrawalUntil !== null && withdrawalUntil >= new Date().toISOString().slice(0, 10),
    coloniesTreated: asNumber(row.colonies_treated),
    notes: (row.notes as string | null) ?? null,
    lockedAt: row.locked_at ? (row.locked_at as Date).toISOString() : null,
    hives: row.hive_codes ? String(row.hive_codes).split(',').filter(Boolean) : [],
    by: row.by_name ? String(row.by_name).trim() : null,
  }
}

const TREATMENT_SELECT = `
  SELECT t.*, a.name AS apiary_name,
         CONCAT(u.first_name, ' ', u.last_name) AS by_name,
         (SELECT GROUP_CONCAT(h.code ORDER BY h.code SEPARATOR ',')
            FROM treatment_hives th JOIN hives h ON h.id = th.hive_id
           WHERE th.treatment_id = t.id) AS hive_codes
    FROM veterinary_treatments t
    JOIN apiaries a ON a.id = t.apiary_id
    LEFT JOIN users u ON u.id = t.created_by
`

async function loadTreatment(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${TREATMENT_SELECT} WHERE t.id = ? AND t.farm_id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Tretman nije pronađen')
  return row
}

treatmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        apiaryId: z.string().trim().min(1).optional(),
        hiveId: z.string().trim().min(1).optional(),
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query)

    const filters = ['t.farm_id = ?', 't.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.apiaryId) {
      filters.push('t.apiary_id = ?')
      params.push(query.apiaryId)
    }
    if (query.hiveId) {
      filters.push('EXISTS (SELECT 1 FROM treatment_hives th WHERE th.treatment_id = t.id AND th.hive_id = ?)')
      params.push(query.hiveId)
    }
    if (query.year) {
      filters.push('YEAR(t.started_on) = ?')
      params.push(query.year)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${TREATMENT_SELECT} WHERE ${filters.join(' AND ')} ORDER BY t.started_on DESC, t.created_at DESC LIMIT ?`,
      [...params, query.limit],
    )
    res.json({ treatments: rows.map(mapTreatment) })
  }),
)

treatmentsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ treatment: mapTreatment(await loadTreatment(req.farm!.id, req.params.id)) })
  }),
)

const treatmentFields = {
  apiaryId: z.string().trim().min(1, 'Odaberite pčelinjak'),
  vmpProductId: z.string().trim().min(1).nullish(),
  productName: z.string().trim().min(2, 'Unesite naziv proizvoda').max(200),
  activeSubstance: nullableText(200),
  manufacturer: nullableText(200),
  lotNumber: nullableText(120),
  productExpiresOn: nullableDate,
  startedOn: requiredDate,
  endedOn: nullableDate,
  dose: nullableText(150),
  applicationMethod: nullableText(150),
  reason: nullableText(255),
  withdrawalDays: nullableInt(0, 3650),
  notes: nullableText(2000),
}

const TREATMENT_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  vmpProductId: 'vmp_product_id',
  productName: 'product_name',
  activeSubstance: 'active_substance',
  manufacturer: 'manufacturer',
  lotNumber: 'lot_number',
  productExpiresOn: 'product_expires_on',
  startedOn: 'started_on',
  endedOn: 'ended_on',
  dose: 'dose',
  applicationMethod: 'application_method',
  reason: 'reason',
  withdrawalDays: 'withdrawal_days',
  notes: 'notes',
}

const createSchema = z
  .object({ ...treatmentFields, hiveIds: z.array(z.string().trim().min(1)).max(1000).default([]) })
  .refine((d) => !d.endedOn || d.endedOn >= d.startedOn, {
    message: 'Završetak ne može biti prije početka',
    path: ['endedOn'],
  })

/** Links the treated hives and returns how many were actually this farm's. */
async function linkHives(
  conn: PoolConnection,
  farmId: string,
  treatmentId: string,
  hiveIds: string[],
): Promise<number> {
  if (hiveIds.length === 0) return 0
  const [owned] = await conn.query<RowDataPacket[]>(
    `SELECT h.id, c.id AS colony_id
       FROM hives h
       LEFT JOIN colonies c ON c.hive_id = h.id AND c.ended_on IS NULL
      WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.id IN (?)`,
    [farmId, hiveIds],
  )
  if (owned.length === 0) return 0

  await conn.query('INSERT IGNORE INTO treatment_hives (treatment_id, hive_id, colony_id) VALUES ?', [
    owned.map((r) => [treatmentId, r.id, r.colony_id ?? null]),
  ])
  return owned.length
}

treatmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createSchema.parse(req.body)

    await assertFarmReference(pool, 'apiary', data.apiaryId, farmId)
    await assertFarmReference(pool, 'vmpProduct', data.vmpProductId, farmId)

    const id = newId()
    const { hiveIds, ...fields } = data
    const { names, values } = changedColumns(fields, TREATMENT_COLUMNS)

    // A treatment and the hives it covers are one record. Written in a transaction so a failure
    // halfway cannot leave a register entry claiming a scope it never got.
    const conn = await pool.getConnection()
    let linked = 0
    try {
      await conn.beginTransaction()
      await conn.query(
        `INSERT INTO veterinary_treatments (id, farm_id, created_by, ${names.join(', ')})
         VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
        [id, farmId, req.user!.id, ...values],
      )
      linked = await linkHives(conn, farmId, id, hiveIds)
      if (linked > 0) {
        await conn.query('UPDATE veterinary_treatments SET colonies_treated = ? WHERE id = ?', [linked, id])
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const created = mapTreatment(await loadTreatment(farmId, id))
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'treatment.create',
      entityType: 'veterinary_treatment',
      entityId: id,
      after: created,
    })

    res.status(201).json({ treatment: created, hivesLinked: linked })
  }),
)

/**
 * §17 — "Podaci se ne brišu fizički nakon zaključavanja evidencije. Za ispravke se vodi audit
 * trail." A locked row is refused here, and every accepted change writes the previous values to
 * audit_logs, so the register can always be reconstructed as it stood on any date.
 */
treatmentsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadTreatment(farmId, req.params.id)
    if (before.locked_at) throw conflict('Evidencija je zaključana i više se ne može mijenjati', 'locked')

    const data = z
      .object({
        ...treatmentFields,
        apiaryId: treatmentFields.apiaryId.optional(),
        productName: treatmentFields.productName.optional(),
        startedOn: treatmentFields.startedOn.optional(),
        hiveIds: z.array(z.string().trim().min(1)).max(1000).optional(),
      })
      .parse(req.body)
    await assertFarmReference(pool, 'apiary', data.apiaryId, farmId)
    await assertFarmReference(pool, 'vmpProduct', data.vmpProductId, farmId)
    validateTreatmentDates(
      data.startedOn ?? asDate(before.started_on)!,
      data.endedOn === undefined ? asDate(before.ended_on) : data.endedOn,
    )

    const { hiveIds, ...fields } = data
    const { names, values } = changedColumns(fields, TREATMENT_COLUMNS)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [lockedRows] = await conn.query<RowDataPacket[]>(
        `SELECT locked_at FROM veterinary_treatments
          WHERE id = ? AND farm_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [before.id, farmId],
      )
      if (lockedRows.length === 0) throw notFound('Tretman nije pronađen')
      if (lockedRows[0]!.locked_at) {
        throw conflict('Evidencija je zaključana i više se ne može mijenjati', 'locked')
      }
      if (names.length > 0) {
        await conn.query(
          `UPDATE veterinary_treatments SET ${names.map((n) => `${n} = ?`).join(', ')}
            WHERE id = ? AND farm_id = ?`,
          [...values, before.id, farmId],
        )
      }
      if (hiveIds) {
        await conn.query('DELETE FROM treatment_hives WHERE treatment_id = ?', [before.id])
        const linked = await linkHives(conn, farmId, before.id as string, hiveIds)
        await conn.query('UPDATE veterinary_treatments SET colonies_treated = ? WHERE id = ?', [
          linked || null,
          before.id,
        ])
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const after = await loadTreatment(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'treatment.update',
      entityType: 'veterinary_treatment',
      entityId: before.id as string,
      before: mapTreatment(before),
      after: mapTreatment(after),
    })

    res.json({ treatment: mapTreatment(after) })
  }),
)

treatmentsRouter.post(
  '/:id/lock',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Evidenciju može zaključati samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadTreatment(farmId, req.params.id)
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT locked_at FROM veterinary_treatments
          WHERE id = ? AND farm_id = ? AND deleted_at IS NULL FOR UPDATE`,
        [before.id, farmId],
      )
      if (rows.length === 0) throw notFound('Tretman nije pronađen')
      if (rows[0]!.locked_at) throw conflict('Evidencija je već zaključana', 'locked')
      await conn.query('UPDATE veterinary_treatments SET locked_at = NOW() WHERE id = ? AND farm_id = ?', [
        before.id,
        farmId,
      ])
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'treatment.lock',
      entityType: 'veterinary_treatment',
      entityId: before.id as string,
      before: mapTreatment(before),
    })

    res.json({ treatment: mapTreatment(await loadTreatment(farmId, before.id as string)) })
  }),
)
