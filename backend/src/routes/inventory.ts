import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/http.js'
import { jarStock } from '../lib/commerce.js'
import { newId } from '../lib/ids.js'
import { honeyStock } from '../lib/production.js'
import { asDate, asNumber, changedColumns, nullableDate, nullableDecimal, nullableText } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §32 — the warehouse.
 *
 * The scenario lists four groups: med, ambalaža, VMP, prihrana. Only three of them are stored
 * here. Honey is summed from honey_batches on every read, because it is already recorded — once,
 * as LOTs — and a second hand-maintained figure would be a second answer to the same question.
 * The screen shows both groups side by side; only one of them is editable, and that is the point.
 */
export const inventoryRouter = Router()
inventoryRouter.use(requireFarm)

const CATEGORIES = ['packaging', 'vmp', 'feed', 'equipment', 'other'] as const

function mapItem(row: RowDataPacket) {
  const quantity = Number(row.quantity)
  const minQuantity = asNumber(row.min_quantity)
  const expiresOn = asDate(row.expires_on)
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: row.id as string,
    category: row.category as (typeof CATEGORIES)[number],
    name: row.name as string,
    unit: row.unit as string,
    quantity,
    minQuantity,
    low: minQuantity !== null && quantity <= minQuantity,
    lotNumber: (row.lot_number as string | null) ?? null,
    expiresOn,
    expired: expiresOn !== null && expiresOn < today,
    notes: (row.notes as string | null) ?? null,
  }
}

inventoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM inventory_items WHERE farm_id = ? AND deleted_at IS NULL ORDER BY category, name',
      [farmId],
    )
    const items = rows.map(mapItem)

    // Two piles of the same honey, both derived, neither editable. `honey` is what is still in the
    // barrels; `jars` is what has been filled and not yet sold. Etapa 3 showed only the first, so
    // packing 54 kg made it look like 54 kg had left the building — which is the moment a
    // beekeeper stops trusting the warehouse figure.
    const honey = await honeyStock(farmId)
    const jars = await jarStock(farmId)

    res.json({
      honey,
      jars,
      honeyTotalKg: Number(
        (honey.reduce((s, h) => s + h.availableKg, 0) + jars.reduce((s, j) => s + j.kg, 0)).toFixed(2),
      ),
      items,
      lowCount: items.filter((i) => i.low).length,
      expiredCount: items.filter((i) => i.expired).length,
    })
  }),
)

const itemFields = {
  category: z.enum(CATEGORIES),
  name: z.string().trim().min(2, 'Unesite naziv').max(200),
  unit: z.string().trim().min(1).max(20).default('kom'),
  minQuantity: nullableDecimal(0, 1000000),
  lotNumber: nullableText(120),
  expiresOn: nullableDate,
  notes: nullableText(2000),
}

const ITEM_COLUMNS: Record<string, string> = {
  category: 'category',
  name: 'name',
  unit: 'unit',
  minQuantity: 'min_quantity',
  lotNumber: 'lot_number',
  expiresOn: 'expires_on',
  notes: 'notes',
}

inventoryRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z
      .object({ ...itemFields, quantity: z.coerce.number().min(0).max(10000000).default(0) })
      .parse(req.body)

    const { quantity, ...fields } = data
    const id = newId()
    const { names, values } = changedColumns(fields, ITEM_COLUMNS)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(
        `INSERT INTO inventory_items (id, farm_id, quantity, ${names.join(', ')})
         VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
        [id, farmId, quantity, ...values],
      )
      // The opening count is a movement like any other, so the running total always adds up from
      // the log rather than starting from a number with no explanation behind it.
      if (quantity !== 0) {
        await conn.query(
          `INSERT INTO inventory_movements
             (id, farm_id, item_id, moved_on, delta, reason, note, created_by)
           VALUES (?, ?, ?, CURDATE(), ?, 'correction', ?, ?)`,
          [newId(), farmId, id, quantity, 'Početno stanje', req.user!.id],
        )
      }
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
      action: 'inventory_item.create',
      entityType: 'inventory_item',
      entityId: id,
      after: { name: data.name, category: data.category, quantity },
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM inventory_items WHERE id = ?', [id])
    res.status(201).json({ item: mapItem(rows[0]!) })
  }),
)

async function loadItem(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM inventory_items WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Stavka skladišta nije pronađena')
  return row
}

/** Metadata only — the quantity moves through /movements so every change keeps its reason. */
inventoryRouter.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadItem(farmId, req.params.id)

    const data = z
      .object({
        ...itemFields,
        category: itemFields.category.optional(),
        name: itemFields.name.optional(),
        unit: z.string().trim().min(1).max(20).optional(),
      })
      .parse(req.body)

    const { names, values } = changedColumns(data, ITEM_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE inventory_items SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadItem(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'inventory_item.update',
      entityType: 'inventory_item',
      entityId: before.id as string,
      before: mapItem(before),
      after: mapItem(after),
    })
    res.json({ item: mapItem(after) })
  }),
)

inventoryRouter.get(
  '/items/:id/movements',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const item = await loadItem(farmId, req.params.id)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.*, CONCAT(u.first_name, ' ', u.last_name) AS by_name
         FROM inventory_movements m
         LEFT JOIN users u ON u.id = m.created_by
        WHERE m.item_id = ? ORDER BY m.moved_on DESC, m.created_at DESC LIMIT 200`,
      [item.id],
    )

    res.json({
      item: mapItem(item),
      movements: rows.map((row) => ({
        id: row.id as string,
        movedOn: asDate(row.moved_on),
        delta: Number(row.delta),
        reason: row.reason as string,
        referenceType: (row.reference_type as string | null) ?? null,
        referenceId: (row.reference_id as string | null) ?? null,
        note: (row.note as string | null) ?? null,
        by: row.by_name ? String(row.by_name).trim() : null,
        createdAt: (row.created_at as Date).toISOString(),
      })),
    })
  }),
)

/**
 * Accepts either a signed `delta` ("200 lids arrived") or an absolute `quantity` ("I counted the
 * shelf and there are 640"). Both shapes exist because both are things a beekeeper actually does,
 * and the second one is where a stock figure usually gets corrected.
 */
inventoryRouter.post(
  '/items/:id/movements',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const item = await loadItem(farmId, req.params.id)

    const data = z
      .object({
        delta: z.coerce.number().min(-10000000).max(10000000).optional(),
        quantity: z.coerce.number().min(0).max(10000000).optional(),
        reason: z.enum(['purchase', 'usage', 'packaging', 'correction', 'loss', 'sale', 'other']).default('correction'),
        movedOn: nullableDate,
        note: nullableText(255),
      })
      .parse(req.body)

    if (data.delta === undefined && data.quantity === undefined) {
      throw badRequest('Unesite promjenu ili novo stanje')
    }

    const delta = data.delta ?? Number((data.quantity! - Number(item.quantity)).toFixed(2))
    if (delta === 0) {
      res.json({ item: mapItem(item), movement: null })
      return
    }

    const movedOn = data.movedOn ?? new Date().toISOString().slice(0, 10)
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('UPDATE inventory_items SET quantity = quantity + ? WHERE id = ? AND farm_id = ?', [
        delta,
        item.id,
        farmId,
      ])
      await conn.query(
        `INSERT INTO inventory_movements
           (id, farm_id, item_id, moved_on, delta, reason, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), farmId, item.id, movedOn, delta, data.reason, data.note ?? null, req.user!.id],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    res.status(201).json({ item: mapItem(await loadItem(farmId, item.id as string)), delta })
  }),
)

inventoryRouter.delete(
  '/items/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Stavku može ukloniti samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadItem(farmId, req.params.id)

    await pool.query('UPDATE inventory_items SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'inventory_item.delete',
      entityType: 'inventory_item',
      entityId: before.id as string,
      before: mapItem(before),
    })
    res.status(204).end()
  }),
)
