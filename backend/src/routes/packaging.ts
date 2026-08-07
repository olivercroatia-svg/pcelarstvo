import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { formatHr } from '../lib/obligations.js'
import { buildReadings, loadLabParameters, overallVerdict } from '../lib/production.js'
import {
  asDate,
  asNumber,
  changedColumns,
  nullableDate,
  nullableInt,
  nullableText,
  requiredDate,
} from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §33 pakiranje, §34 deklaracije, §35 the public jar page's token, §36 the national jar.
 *
 * The arithmetic §33 asks for — 120 × 450 g = 54 kg, LOT drops from 286 to 232 — is the reason
 * this module is transactional throughout. Two people packing from the same LOT on two phones must
 * not both be told there was enough honey.
 */

export const productsRouter = Router()
productsRouter.use(requireFarm)

export const packagingRouter = Router()
packagingRouter.use(requireFarm)

// ─────────────────────────────────────────────────────────────── §34 products

function mapProduct(row: RowDataPacket) {
  return {
    id: row.id as string,
    name: row.name as string,
    honeyType: (row.honey_type as string | null) ?? null,
    netWeightG: Number(row.net_weight_g),
    storageConditions: (row.storage_conditions as string | null) ?? null,
    countryOfOrigin: (row.country_of_origin as string | null) ?? null,
    shelfLifeMonths: asNumber(row.shelf_life_months),
    active: Boolean(row.active),
    notes: (row.notes as string | null) ?? null,
  }
}

const productFields = {
  name: z.string().trim().min(2, 'Unesite naziv proizvoda').max(200),
  honeyType: nullableText(120),
  netWeightG: z.coerce.number().int().min(1, 'Unesite neto količinu').max(60000),
  storageConditions: nullableText(255),
  countryOfOrigin: nullableText(100),
  shelfLifeMonths: nullableInt(1, 120),
  notes: nullableText(2000),
}

const PRODUCT_COLUMNS: Record<string, string> = {
  name: 'name',
  honeyType: 'honey_type',
  netWeightG: 'net_weight_g',
  storageConditions: 'storage_conditions',
  countryOfOrigin: 'country_of_origin',
  shelfLifeMonths: 'shelf_life_months',
  notes: 'notes',
}

productsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE farm_id = ? AND deleted_at IS NULL ORDER BY name',
      [req.farm!.id],
    )
    // Defaults an empty product form starts from, so §34's regulatory text is one round trip away
    // instead of hard-coded in the browser.
    const [texts] = await pool.query<RowDataPacket[]>(
      "SELECT code, body FROM declaration_texts WHERE code IN ('storage_conditions','country_of_origin')",
    )
    res.json({
      products: rows.map(mapProduct),
      defaults: Object.fromEntries(texts.map((t) => [t.code as string, (t.body as string | null) ?? ''])),
    })
  }),
)

productsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(productFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, PRODUCT_COLUMNS)

    await pool.query(
      `INSERT INTO products (id, farm_id, ${names.join(', ')})
       VALUES (?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'product.create',
      entityType: 'product',
      entityId: id,
      after: data,
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [id])
    res.status(201).json({ product: mapProduct(rows[0]!) })
  }),
)

productsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Proizvod nije pronađen')

    const data = z
      .object({
        ...productFields,
        name: productFields.name.optional(),
        netWeightG: productFields.netWeightG.optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)

    const { active, ...fields } = data
    const { names, values } = changedColumns(fields, PRODUCT_COLUMNS)
    if (active !== undefined) {
      names.push('active')
      values.push(active)
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE products SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM products WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'product.update',
      entityType: 'product',
      entityId: before.id as string,
      before: mapProduct(before),
      after: mapProduct(after[0]!),
    })
    res.json({ product: mapProduct(after[0]!) })
  }),
)

productsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Proizvod može ukloniti samo vlasnik')
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, name FROM products WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    if (rows.length === 0) throw notFound('Proizvod nije pronađen')

    // Soft delete: packaging runs reference the product, and a jar already on a shelf still has a
    // declaration that has to be reproducible.
    await pool.query('UPDATE products SET deleted_at = NOW() WHERE id = ?', [req.params.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'product.delete',
      entityType: 'product',
      entityId: req.params.id,
      before: { name: rows[0]!.name },
    })
    res.status(204).end()
  }),
)

// ─────────────────────────────────────────────────────────────── §33 packaging runs

function mapPackaging(row: RowDataPacket) {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    lotCode: (row.lot_code as string | null) ?? null,
    honeyType: (row.honey_type as string | null) ?? null,
    productId: (row.product_id as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    packagedOn: asDate(row.packaged_on),
    jarSizeG: Number(row.jar_size_g),
    jarCount: Number(row.jar_count),
    // Added with §37: a run is a stock of jars, not only a record that they were filled. Maintained
    // by routes/sales.ts; remainingCount is generated, so it is the one definition of "how many
    // are left" that every screen reads.
    soldCount: Number(row.sold_count ?? 0),
    remainingCount: Number(row.remaining_count ?? row.jar_count),
    totalKg: Number(row.total_kg),
    remainingKg: Number(((Number(row.remaining_count ?? row.jar_count) * Number(row.jar_size_g)) / 1000).toFixed(3)),
    bestBefore: asDate(row.best_before),
    isNational: Boolean(row.is_national),
    serialFrom: (row.serial_from as string | null) ?? null,
    serialTo: (row.serial_to as string | null) ?? null,
    // The token itself is returned to the owner — they need it to print the QR code — but never
    // by any route that is not behind requireFarm.
    publicToken: (row.public_token as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

const PACKAGING_SELECT = `
  SELECT p.*, b.lot_code, b.honey_type, pr.name AS product_name
    FROM packaging_batches p
    JOIN honey_batches b ON b.id = p.batch_id
    LEFT JOIN products pr ON pr.id = p.product_id
`

async function loadPackaging(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${PACKAGING_SELECT} WHERE p.id = ? AND p.farm_id = ? AND p.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Pakiranje nije pronađeno')
  return row
}

packagingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        batchId: z.string().trim().min(1).optional(),
        national: z.coerce.boolean().optional(),
      })
      .parse(req.query)

    const filters = ['p.farm_id = ?', 'p.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.batchId) {
      filters.push('p.batch_id = ?')
      params.push(query.batchId)
    }
    if (query.national) filters.push('p.is_national = TRUE')

    const [rows] = await pool.query<RowDataPacket[]>(
      `${PACKAGING_SELECT} WHERE ${filters.join(' AND ')} ORDER BY p.packaged_on DESC, p.created_at DESC`,
      params,
    )
    res.json({ packaging: rows.map(mapPackaging) })
  }),
)

const packagingFields = {
  batchId: z.string().trim().min(1, 'Odaberite seriju meda'),
  productId: z.string().trim().min(1).nullish(),
  packagedOn: requiredDate,
  jarSizeG: z.coerce.number().int().min(1, 'Unesite veličinu pakiranja').max(60000),
  jarCount: z.coerce.number().int().min(1, 'Unesite broj staklenki').max(1000000),
  bestBefore: nullableDate,
  isNational: z.boolean().optional(),
  serialFrom: nullableText(40),
  serialTo: nullableText(40),
  notes: nullableText(2000),
}

const PACKAGING_COLUMNS: Record<string, string> = {
  batchId: 'batch_id',
  productId: 'product_id',
  packagedOn: 'packaged_on',
  jarSizeG: 'jar_size_g',
  jarCount: 'jar_count',
  bestBefore: 'best_before',
  serialFrom: 'serial_from',
  serialTo: 'serial_to',
  notes: 'notes',
}

/** §33's arithmetic, in one place so the check and the stored value can never use different maths. */
const packagedKg = (jarSizeG: number, jarCount: number) => Number(((jarSizeG * jarCount) / 1000).toFixed(3))

/**
 * §32 × §33 — optional, and only for the items the beekeeper names.
 *
 * Nothing is inferred: the client sends the inventory item ids to draw one unit per jar from
 * (jars, lids, labels). Guessing which shelf item corresponds to a 450 g jar would eventually
 * subtract from the wrong one, and a warehouse that quietly loses count is worse than one that
 * only changes when told to.
 */
async function drawMaterials(
  conn: PoolConnection,
  farmId: string,
  userId: string,
  itemIds: string[],
  jarCount: number,
  packagingId: string,
  packagedOn: string,
): Promise<number> {
  if (itemIds.length === 0) return 0
  const [items] = await conn.query<RowDataPacket[]>(
    'SELECT id FROM inventory_items WHERE farm_id = ? AND deleted_at IS NULL AND id IN (?) FOR UPDATE',
    [farmId, itemIds],
  )
  if (items.length === 0) return 0

  for (const item of items) {
    await conn.query('UPDATE inventory_items SET quantity = quantity - ? WHERE id = ?', [jarCount, item.id])
    await conn.query(
      `INSERT INTO inventory_movements
         (id, farm_id, item_id, moved_on, delta, reason, reference_type, reference_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, 'packaging', 'packaging_batch', ?, ?, ?)`,
      [newId(), farmId, item.id, packagedOn, -jarCount, packagingId, 'Utrošeno pri pakiranju', userId],
    )
  }
  return items.length
}

packagingRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z
      .object({
        ...packagingFields,
        materialItemIds: z.array(z.string().trim().min(1)).max(20).default([]),
      })
      .parse(req.body)

    const kg = packagedKg(data.jarSizeG, data.jarCount)
    const id = newId()
    const { materialItemIds, isNational, ...fields } = data

    const conn = await pool.getConnection()
    let materialsDrawn = 0
    try {
      await conn.beginTransaction()

      // FOR UPDATE, not a plain read: without the row lock two concurrent packaging runs both see
      // 286 kg available and both succeed, and the LOT ends up with more honey packed than it ever
      // held. The generated available_kg would then be negative, which is the symptom, not the bug.
      const [batches] = await conn.query<RowDataPacket[]>(
        `SELECT id, lot_code, total_kg, packed_kg, available_kg, status
           FROM honey_batches
          WHERE id = ? AND farm_id = ? AND deleted_at IS NULL
          FOR UPDATE`,
        [data.batchId, farmId],
      )
      const batch = batches[0]
      if (!batch) throw notFound('Serija meda nije pronađena')

      const available = Number(batch.available_kg)
      if (kg > available) {
        throw conflict(
          `U seriji ${batch.lot_code} preostalo je ${available} kg, a pakiranje traži ${kg} kg`,
          'insufficient_honey',
        )
      }

      const { names, values } = changedColumns(fields, PACKAGING_COLUMNS)
      await conn.query(
        `INSERT INTO packaging_batches (id, farm_id, created_by, is_national, ${names.join(', ')})
         VALUES (?, ?, ?, ?, ${names.map(() => '?').join(', ')})`,
        [id, farmId, req.user!.id, isNational ?? false, ...values],
      )

      // §33 "Nova količina LOT-a: 232 kg". available_kg follows automatically — it is generated.
      await conn.query('UPDATE honey_batches SET packed_kg = packed_kg + ? WHERE id = ?', [kg, batch.id])

      materialsDrawn = await drawMaterials(
        conn,
        farmId,
        req.user!.id,
        materialItemIds,
        data.jarCount,
        id,
        data.packagedOn,
      )

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const created = mapPackaging(await loadPackaging(farmId, id))
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'packaging.create',
      entityType: 'packaging_batch',
      entityId: id,
      after: { lotCode: created.lotCode, jars: created.jarCount, kg: created.totalKg },
    })

    const [after] = await pool.query<RowDataPacket[]>(
      'SELECT lot_code, total_kg, packed_kg, available_kg FROM honey_batches WHERE id = ?',
      [data.batchId],
    )

    res.status(201).json({
      packaging: created,
      batch: {
        lotCode: after[0]!.lot_code as string,
        totalKg: Number(after[0]!.total_kg),
        packedKg: Number(after[0]!.packed_kg),
        availableKg: Number(after[0]!.available_kg),
      },
      materialsDrawn,
    })
  }),
)

packagingRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ packaging: mapPackaging(await loadPackaging(req.farm!.id, req.params.id)) })
  }),
)

packagingRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadPackaging(farmId, req.params.id)

    // Quantities are excluded on purpose. Changing jar_size_g or jar_count would have to unwind
    // and reapply the batch drawdown, and the honest correction for a mis-recorded run is to
    // delete it — which returns the honey — and record it again.
    const data = z
      .object({
        productId: packagingFields.productId,
        bestBefore: nullableDate,
        isNational: z.boolean().optional(),
        serialFrom: nullableText(40),
        serialTo: nullableText(40),
        notes: nullableText(2000),
      })
      .parse(req.body)

    const { isNational, ...fields } = data
    const { names, values } = changedColumns(fields, PACKAGING_COLUMNS)
    if (isNational !== undefined) {
      names.push('is_national')
      values.push(isNational)
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE packaging_batches SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadPackaging(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'packaging.update',
      entityType: 'packaging_batch',
      entityId: before.id as string,
      before: mapPackaging(before),
      after: mapPackaging(after),
    })
    res.json({ packaging: mapPackaging(after) })
  }),
)

packagingRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Pakiranje može obrisati samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadPackaging(farmId, req.params.id)

    // §37 — refused once any jar from the run has been sold. Deleting it returns its honey to the
    // LOT, and honey that is already in a customer's hands must not reappear there. Same guard, and
    // the same reason, as refusing to delete a batch that has been packed.
    const sold = Number(before.sold_count ?? 0)
    if (sold > 0) {
      throw conflict(
        `Iz ovog pakiranja prodano je ${sold} ${sold === 1 ? 'staklenka' : 'staklenki'}. Prvo obrišite te prodaje.`,
        'jars_sold',
      )
    }

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('UPDATE packaging_batches SET deleted_at = NOW(), public_token = NULL WHERE id = ?', [
        before.id,
      ])
      // The honey goes back to the LOT. GREATEST guards the arithmetic against ever driving
      // packed_kg negative if the same run were somehow removed twice.
      await conn.query('UPDATE honey_batches SET packed_kg = GREATEST(0, packed_kg - ?) WHERE id = ?', [
        Number(before.total_kg),
        before.batch_id,
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
      action: 'packaging.delete',
      entityType: 'packaging_batch',
      entityId: before.id as string,
      before: mapPackaging(before),
    })
    res.status(204).end()
  }),
)

// ─────────────────────────────────────────────────────────────── §35 publishing the jar page

/**
 * §35 is "opcijski", and §56 governs what opting in may reveal. Publishing is therefore an
 * explicit owner action that mints a token, and unpublishing destroys it — a re-published run gets
 * a new one, so a QR code that has already been printed and revoked stays dead.
 */
packagingRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Javnu stranicu može objaviti samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadPackaging(farmId, req.params.id)
    if (before.public_token) {
      res.json({ packaging: mapPackaging(before) })
      return
    }

    const token = randomBytes(12).toString('base64url')
    await pool.query('UPDATE packaging_batches SET public_token = ? WHERE id = ? AND farm_id = ?', [
      token,
      before.id,
      farmId,
    ])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'packaging.publish',
      entityType: 'packaging_batch',
      entityId: before.id as string,
    })
    res.json({ packaging: mapPackaging(await loadPackaging(farmId, before.id as string)) })
  }),
)

packagingRouter.delete(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Javnu stranicu može ukloniti samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadPackaging(farmId, req.params.id)

    await pool.query('UPDATE packaging_batches SET public_token = NULL WHERE id = ? AND farm_id = ?', [
      before.id,
      farmId,
    ])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'packaging.unpublish',
      entityType: 'packaging_batch',
      entityId: before.id as string,
    })
    res.json({ packaging: mapPackaging(await loadPackaging(farmId, before.id as string)) })
  }),
)

// ─────────────────────────────────────────────────────────────── §34 the declaration

/** Adds whole months without rolling 31 January into 3 March. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(y!, m! - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d!, lastDay))
  return target.toISOString().slice(0, 10)
}

/**
 * Everything §34 lists, assembled server-side.
 *
 * Built here rather than in the browser because the producer's identity comes from the farm record
 * and the regulatory blocks come from declaration_texts — the screen's job is to lay it out and
 * print it, not to decide what a label must say.
 */
packagingRouter.get(
  '/:id/declaration',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const row = await loadPackaging(farmId, req.params.id)

    const [farms] = await pool.query<RowDataPacket[]>(
      `SELECT f.name, f.entity_type, f.oib, f.address, f.city, f.postal_code, f.responsible_person,
              CONCAT(u.first_name, ' ', u.last_name) AS owner_name
         FROM farms f JOIN users u ON u.id = f.owner_user_id
        WHERE f.id = ? LIMIT 1`,
      [farmId],
    )
    const farm = farms[0]!

    const [texts] = await pool.query<RowDataPacket[]>('SELECT code, body FROM declaration_texts')
    const text = Object.fromEntries(texts.map((t) => [t.code as string, (t.body as string | null) ?? '']))

    const [products] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM products WHERE id = ? AND farm_id = ? LIMIT 1',
      [row.product_id ?? '', farmId],
    )
    const product = products[0] ?? null

    const [batches] = await pool.query<RowDataPacket[]>(
      `SELECT b.lot_code, b.honey_type, b.best_before, h.harvested_on
         FROM honey_batches b JOIN harvests h ON h.id = b.harvest_id
        WHERE b.id = ? LIMIT 1`,
      [row.batch_id],
    )
    const batch = batches[0]!

    // Most specific date wins: the packaging run's own, then the batch's, then one derived from the
    // product's shelf life. Nothing invents a date when none of the three is known.
    const shelfLife = product ? asNumber(product.shelf_life_months) : null
    const bestBefore =
      asDate(row.best_before) ??
      asDate(batch.best_before) ??
      (shelfLife ? addMonths(asDate(row.packaged_on)!, shelfLife) : null)

    res.json({
      declaration: {
        productName: (product?.name as string | undefined) ?? `${batch.honey_type} ${row.jar_size_g} g`,
        producer: (farm.name as string | null) || (farm.owner_name as string),
        responsiblePerson: (farm.responsible_person as string | null) ?? null,
        oib: (farm.oib as string | null) ?? null,
        address: [farm.address, [farm.postal_code, farm.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', '),
        netWeightG: product ? Number(product.net_weight_g) : Number(row.jar_size_g),
        countryOfOrigin:
          (product?.country_of_origin as string | null) || text.country_of_origin || 'Hrvatska',
        lotCode: batch.lot_code as string,
        honeyType: batch.honey_type as string,
        harvestedOn: asDate(batch.harvested_on),
        packagedOn: asDate(row.packaged_on),
        bestBefore,
        storageConditions:
          (product?.storage_conditions as string | null) || text.storage_conditions || null,
        mandatoryNotice: text.mandatory_notice || null,
        // §36 — only when the run actually carries the mark.
        nationalNotice: row.is_national ? text.national_jar_notice || null : null,
        isNational: Boolean(row.is_national),
        serialFrom: (row.serial_from as string | null) ?? null,
        serialTo: (row.serial_to as string | null) ?? null,
        jarCount: Number(row.jar_count),
      },
    })
  }),
)

// ─────────────────────────────────────────────────────────────── §36 national jar readiness

/**
 * §36 lists what the application has to keep for a national jar: jar count, serial number, LOT,
 * laboratory, required markings, product status. The first three are stored; the rest is a
 * derived checklist, in the same shape as §27's readiness list, so a tick cannot be set by hand.
 */
packagingRouter.get(
  '/:id/national',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const row = await loadPackaging(farmId, req.params.id)

    const [tests] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM laboratory_tests WHERE batch_id = ? AND deleted_at IS NULL`,
      [row.batch_id],
    )
    let labVerdict: 'pass' | 'fail' | 'unrated' = 'unrated'
    if (tests.length > 0) {
      const parameters = await loadLabParameters(true)
      const [values] = await pool.query<RowDataPacket[]>(
        'SELECT parameter_code, value FROM laboratory_values WHERE test_id IN (?)',
        [tests.map((t) => t.id)],
      )
      labVerdict = overallVerdict(
        buildReadings(parameters, new Map(values.map((v) => [v.parameter_code as string, Number(v.value)]))),
      )
    }

    const checks = [
      {
        key: 'lot',
        label: 'Serija ima dodijeljen LOT',
        ok: Boolean(row.lot_code),
        detail: (row.lot_code as string) ?? null,
      },
      {
        key: 'jars',
        label: 'Upisan broj staklenki',
        ok: Number(row.jar_count) > 0,
        detail: `${Number(row.jar_count)} kom`,
      },
      {
        key: 'serials',
        label: 'Upisan raspon serijskih brojeva',
        ok: Boolean(row.serial_from),
        detail: row.serial_from ? `${row.serial_from}${row.serial_to ? ` – ${row.serial_to}` : ''}` : null,
      },
      {
        key: 'lab',
        label: 'Laboratorijski nalaz za seriju',
        ok: tests.length > 0 && labVerdict !== 'fail',
        detail:
          tests.length === 0
            ? 'Nalaz još nije unesen'
            : labVerdict === 'fail'
              ? 'Nalaz odstupa od unesenih kriterija'
              : 'Nalaz unesen',
      },
      {
        key: 'product',
        label: 'Pakiranje je povezano s proizvodom',
        ok: Boolean(row.product_id),
        detail: (row.product_name as string | null) ?? 'Deklaracija se ne može ispisati bez proizvoda',
      },
      {
        key: 'best_before',
        label: 'Određen rok „najbolje upotrijebiti do"',
        ok: Boolean(row.best_before),
        // formatHr, not asDate: this string is shown to the beekeeper as-is, and a raw
        // 2028-08-07 in a Croatian sentence reads like a leaked database value.
        detail: row.best_before ? formatHr(asDate(row.best_before)!) : 'Rok još nije određen',
      },
    ]

    res.json({
      isNational: Boolean(row.is_national),
      checks,
      ready: checks.every((c) => c.ok),
    })
  }),
)
