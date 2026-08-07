import { Router } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { SALE_APIARY, SALE_CHAIN_JOIN, SALE_HONEY_KG, sellableRuns } from '../lib/commerce.js'
import { asyncHandler, badRequest, conflict, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { isValidOib } from '../lib/oib.js'
import { asDate, asNumber, changedColumns, nullableText, requiredDate } from '../lib/schema.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

/**
 * §37 prodaja and §38 kupci.
 *
 * Both routers are behind requireOwner, not just requireFarm. §4 is explicit that a worker "ne
 * može pristupati financijskim izvještajima", and every response here carries either a price or a
 * customer's OIB. This is the first module in the application where that line actually falls
 * somewhere, and it is drawn at the router rather than in the screens — a hidden menu item is not
 * an access control.
 *
 * The stock arithmetic has exactly two code paths, create and reverse, and no third. A sale's
 * lines cannot be edited in place: correcting what was sold means deleting the sale, which returns
 * every jar and kilogram it took, and entering it again. That is both how a receipt is legitimately
 * corrected and the only version of this feature where honey cannot go missing in a half-applied
 * update.
 */

export const customersRouter = Router()
customersRouter.use(requireFarm, requireOwner)

export const salesRouter = Router()
salesRouter.use(requireFarm, requireOwner)

// ───────────────────────────────────────────────────────────────── §38 customers

const CUSTOMER_KINDS = ['person', 'company', 'shop', 'restaurant', 'distributor'] as const

function mapCustomer(row: RowDataPacket) {
  return {
    id: row.id as string,
    kind: row.kind as (typeof CUSTOMER_KINDS)[number],
    name: row.name as string,
    oib: (row.oib as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    contactPerson: (row.contact_person as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    active: Boolean(row.active),
    // Present only on the list query, which joins the totals.
    salesCount: row.sales_count === undefined ? undefined : Number(row.sales_count),
    totalSpent: row.total_spent === undefined ? undefined : Number(row.total_spent ?? 0),
    lastSaleOn: row.last_sale_on === undefined ? undefined : asDate(row.last_sale_on),
  }
}

const customerFields = {
  kind: z.enum(CUSTOMER_KINDS).default('person'),
  name: z.string().trim().min(2, 'Unesite naziv kupca').max(200),
  // Validated when present, because a wrong OIB on an invoice is a problem the beekeeper only
  // discovers from the buyer. Blank stays allowed — most market sales have none.
  oib: nullableText(11).refine((v) => !v || isValidOib(v), 'Neispravan OIB'),
  address: nullableText(255),
  city: nullableText(120),
  postalCode: nullableText(20),
  contactPerson: nullableText(200),
  phone: nullableText(60),
  email: nullableText(255),
  notes: nullableText(2000),
}

const CUSTOMER_COLUMNS: Record<string, string> = {
  kind: 'kind',
  name: 'name',
  oib: 'oib',
  address: 'address',
  city: 'city',
  postalCode: 'postal_code',
  contactPerson: 'contact_person',
  phone: 'phone',
  email: 'email',
  notes: 'notes',
}

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({ q: z.string().trim().max(120).optional() }).parse(req.query)

    const filters = ['c.farm_id = ?', 'c.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.q) {
      filters.push('(c.name LIKE ? OR c.city LIKE ? OR c.email LIKE ?)')
      params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT c.*,
              COUNT(DISTINCT s.id) AS sales_count,
              COALESCE(SUM(si.line_total), 0) AS total_spent,
              MAX(s.sold_on) AS last_sale_on
         FROM customers c
         LEFT JOIN sales s      ON s.customer_id = c.id AND s.deleted_at IS NULL
         LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE ${filters.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.name`,
      params,
    )
    res.json({ customers: rows.map(mapCustomer) })
  }),
)

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(customerFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, CUSTOMER_COLUMNS)

    await pool.query(
      `INSERT INTO customers (id, farm_id, created_by, ${names.join(', ')})
       VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, req.user!.id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'customer.create',
      entityType: 'customer',
      entityId: id,
      after: { name: data.name, kind: data.kind },
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM customers WHERE id = ?', [id])
    res.status(201).json({ customer: mapCustomer(rows[0]!) })
  }),
)

async function loadCustomer(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM customers WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Kupac nije pronađen')
  return row
}

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const customer = await loadCustomer(farmId, req.params.id)

    const [sales] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.sold_on, s.channel, s.document_number, s.paid,
              COALESCE(SUM(si.line_total), 0) AS total
         FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE s.customer_id = ? AND s.deleted_at IS NULL
        GROUP BY s.id ORDER BY s.sold_on DESC LIMIT 100`,
      [customer.id],
    )

    res.json({
      customer: mapCustomer(customer),
      sales: sales.map((s) => ({
        id: s.id as string,
        soldOn: asDate(s.sold_on),
        channel: s.channel as string,
        documentNumber: (s.document_number as string | null) ?? null,
        paid: Boolean(s.paid),
        total: Number(s.total),
      })),
    })
  }),
)

customersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadCustomer(farmId, req.params.id)
    const data = z
      .object({
        ...customerFields,
        kind: z.enum(CUSTOMER_KINDS).optional(),
        name: customerFields.name.optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)

    const { active, ...fields } = data
    const { names, values } = changedColumns(fields, CUSTOMER_COLUMNS)
    if (active !== undefined) {
      names.push('active')
      values.push(active)
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE customers SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadCustomer(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'customer.update',
      entityType: 'customer',
      entityId: before.id as string,
      before: mapCustomer(before),
      after: mapCustomer(after),
    })
    res.json({ customer: mapCustomer(after) })
  }),
)

customersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadCustomer(farmId, req.params.id)

    // Soft delete: sales reference the customer, and a past sale has to stay readable with the
    // buyer it was made to.
    await pool.query('UPDATE customers SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'customer.delete',
      entityType: 'customer',
      entityId: before.id as string,
      before: mapCustomer(before),
    })
    res.status(204).end()
  }),
)

// ───────────────────────────────────────────────────────────────── §37 sales

const CHANNELS = ['direct', 'market', 'shop', 'restaurant', 'distributor', 'online', 'other'] as const
const PAYMENTS = ['cash', 'transfer', 'card', 'other'] as const

function mapSale(row: RowDataPacket) {
  return {
    id: row.id as string,
    customerId: (row.customer_id as string | null) ?? null,
    customerName: (row.customer_name as string | null) ?? null,
    soldOn: asDate(row.sold_on),
    channel: row.channel as (typeof CHANNELS)[number],
    documentNumber: (row.document_number as string | null) ?? null,
    payment: row.payment as (typeof PAYMENTS)[number],
    paid: Boolean(row.paid),
    notes: (row.notes as string | null) ?? null,
    total: Number(row.total ?? 0),
    honeyKg: Number(row.honey_kg ?? 0),
    itemCount: Number(row.item_count ?? 0),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

/**
 * The list and the card share this shape so the total is computed the same way in both. The joins
 * come from lib/commerce.ts for the same reason: §40's economics reads the identical expression,
 * and a sale that is worth 144 € on one screen and 138 € on another is a bug nobody reports
 * because both look plausible.
 */
const SALE_SELECT = `
  SELECT s.*, c.name AS customer_name,
         COALESCE(SUM(si.line_total), 0) AS total,
         COALESCE(SUM(CASE si.kind
                        WHEN 'jars' THEN si.quantity * COALESCE(p.jar_size_g, 0) / 1000
                        WHEN 'bulk' THEN si.quantity
                        ELSE 0 END), 0) AS honey_kg,
         COUNT(si.id) AS item_count
    FROM sales s
    LEFT JOIN customers c        ON c.id = s.customer_id
    LEFT JOIN sale_items si      ON si.sale_id = s.id
    LEFT JOIN packaging_batches p ON p.id = si.packaging_id
`

salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        customerId: z.string().trim().min(1).optional(),
        unpaid: z.coerce.boolean().optional(),
      })
      .parse(req.query)

    const filters = ['s.farm_id = ?', 's.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.year) {
      filters.push('YEAR(s.sold_on) = ?')
      params.push(query.year)
    }
    if (query.customerId) {
      filters.push('s.customer_id = ?')
      params.push(query.customerId)
    }
    if (query.unpaid) filters.push('s.paid = FALSE')

    const [rows] = await pool.query<RowDataPacket[]>(
      `${SALE_SELECT} WHERE ${filters.join(' AND ')}
        GROUP BY s.id ORDER BY s.sold_on DESC, s.created_at DESC LIMIT 300`,
      params,
    )

    const sales = rows.map(mapSale)
    res.json({
      sales,
      summary: {
        total: Number(sales.reduce((sum, s) => sum + s.total, 0).toFixed(2)),
        honeyKg: Number(sales.reduce((sum, s) => sum + s.honeyKg, 0).toFixed(2)),
        unpaid: Number(
          sales
            .filter((s) => !s.paid)
            .reduce((sum, s) => sum + s.total, 0)
            .toFixed(2),
        ),
      },
    })
  }),
)

/** Everything the §37 form needs to offer, in one round trip. */
salesRouter.get(
  '/options',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [customers] = await pool.query<RowDataPacket[]>(
      'SELECT id, name, kind FROM customers WHERE farm_id = ? AND deleted_at IS NULL AND active = TRUE ORDER BY name',
      [farmId],
    )
    const [batches] = await pool.query<RowDataPacket[]>(
      `SELECT id, lot_code, honey_type, available_kg
         FROM honey_batches
        WHERE farm_id = ? AND deleted_at IS NULL AND status <> 'closed' AND available_kg > 0
        ORDER BY lot_code`,
      [farmId],
    )

    res.json({
      customers: customers.map((c) => ({ id: c.id as string, name: c.name as string, kind: c.kind as string })),
      runs: await sellableRuns(farmId),
      batches: batches.map((b) => ({
        id: b.id as string,
        lotCode: b.lot_code as string,
        honeyType: b.honey_type as string,
        availableKg: Number(b.available_kg),
      })),
    })
  }),
)

const saleHeaderFields = {
  customerId: z.string().trim().min(1).nullish(),
  soldOn: requiredDate,
  channel: z.enum(CHANNELS).default('direct'),
  documentNumber: nullableText(60),
  payment: z.enum(PAYMENTS).default('cash'),
  paid: z.boolean().default(true),
  notes: nullableText(2000),
}

const SALE_COLUMNS: Record<string, string> = {
  customerId: 'customer_id',
  soldOn: 'sold_on',
  channel: 'channel',
  documentNumber: 'document_number',
  payment: 'payment',
  paid: 'paid',
  notes: 'notes',
}

const saleItemSchema = z
  .object({
    kind: z.enum(['jars', 'bulk', 'other']).default('jars'),
    packagingId: z.string().trim().min(1).nullish(),
    batchId: z.string().trim().min(1).nullish(),
    description: z.string().trim().max(200).optional(),
    quantity: z.coerce.number().positive('Unesite količinu').max(1000000),
    unit: z.string().trim().min(1).max(20).optional(),
    unitPrice: z.coerce.number().min(0).max(1000000),
  })
  .refine((i) => i.kind !== 'jars' || !!i.packagingId, {
    message: 'Odaberite pakiranje',
    path: ['packagingId'],
  })
  .refine((i) => i.kind !== 'bulk' || !!i.batchId, {
    message: 'Odaberite seriju meda',
    path: ['batchId'],
  })
  .refine((i) => i.kind !== 'other' || (i.description ?? '').trim().length >= 2, {
    message: 'Unesite što je prodano',
    path: ['description'],
  })

type SaleItemInput = z.infer<typeof saleItemSchema>

/**
 * Takes one line's stock out of the warehouse and returns the row to insert.
 *
 * FOR UPDATE on the packaging run for the same reason 005's packaging route locks the batch: two
 * phones selling the last twelve jars must not both be told the jars are there. The row that is
 * locked is the row that carries the counter, so the check and the decrement cannot disagree.
 */
async function drawStock(
  conn: PoolConnection,
  farmId: string,
  saleId: string,
  item: SaleItemInput,
  index: number,
): Promise<void> {
  const id = newId()

  if (item.kind === 'jars') {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT p.id, p.jar_size_g, p.remaining_count, b.lot_code, b.honey_type, pr.name AS product_name
         FROM packaging_batches p
         JOIN honey_batches b ON b.id = p.batch_id
         LEFT JOIN products pr ON pr.id = p.product_id
        WHERE p.id = ? AND p.farm_id = ? AND p.deleted_at IS NULL
        FOR UPDATE`,
      [item.packagingId, farmId],
    )
    const run = rows[0]
    if (!run) throw notFound('Pakiranje nije pronađeno')

    const jars = Math.round(item.quantity)
    if (jars !== item.quantity) throw badRequest('Broj staklenki mora biti cijeli broj', 'jars_not_integer')
    const remaining = Number(run.remaining_count)
    if (jars > remaining) {
      throw conflict(
        `Od pakiranja ${run.lot_code} preostalo je ${remaining} ${remaining === 1 ? 'staklenka' : 'staklenki'}, a prodaja traži ${jars}`,
        'insufficient_jars',
      )
    }

    const description =
      item.description?.trim() ||
      `${(run.product_name as string | null) ?? run.honey_type} ${Number(run.jar_size_g)} g`

    await conn.query(
      `INSERT INTO sale_items (id, sale_id, kind, packaging_id, description, quantity, unit, unit_price, sort_order)
       VALUES (?, ?, 'jars', ?, ?, ?, 'kom', ?, ?)`,
      [id, saleId, run.id, description, jars, item.unitPrice, index],
    )
    await conn.query('UPDATE packaging_batches SET sold_count = sold_count + ? WHERE id = ?', [jars, run.id])
    return
  }

  if (item.kind === 'bulk') {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id, lot_code, honey_type, available_kg FROM honey_batches
        WHERE id = ? AND farm_id = ? AND deleted_at IS NULL FOR UPDATE`,
      [item.batchId, farmId],
    )
    const batch = rows[0]
    if (!batch) throw notFound('Serija meda nije pronađena')

    const kg = Number(item.quantity.toFixed(2))
    const available = Number(batch.available_kg)
    if (kg > available) {
      throw conflict(
        `U seriji ${batch.lot_code} preostalo je ${available} kg, a prodaja traži ${kg} kg`,
        'insufficient_honey',
      )
    }

    const description = item.description?.trim() || `${batch.honey_type} — rinfuza (${batch.lot_code})`
    await conn.query(
      `INSERT INTO sale_items (id, sale_id, kind, batch_id, description, quantity, unit, unit_price, sort_order)
       VALUES (?, ?, 'bulk', ?, ?, ?, 'kg', ?, ?)`,
      [id, saleId, batch.id, description, kg, item.unitPrice, index],
    )
    await conn.query('UPDATE honey_batches SET sold_bulk_kg = sold_bulk_kg + ? WHERE id = ?', [kg, batch.id])
    return
  }

  // 'other' — wax, propolis, a nucleus colony, a queen. Nothing in the warehouse moves.
  await conn.query(
    `INSERT INTO sale_items (id, sale_id, kind, description, quantity, unit, unit_price, sort_order)
     VALUES (?, ?, 'other', ?, ?, ?, ?, ?)`,
    [id, saleId, item.description!.trim(), item.quantity, item.unit?.trim() || 'kom', item.unitPrice, index],
  )
}

salesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z
      .object({
        ...saleHeaderFields,
        items: z.array(saleItemSchema).min(1, 'Dodajte barem jednu stavku').max(50),
      })
      .parse(req.body)

    const { items, ...header } = data
    const id = newId()
    const { names, values } = changedColumns(header, SALE_COLUMNS)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(
        `INSERT INTO sales (id, farm_id, created_by, ${names.join(', ')})
         VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
        [id, farmId, req.user!.id, ...values],
      )
      // Sequential rather than concurrent: the rows are locked in list order, so two sales that
      // touch the same two runs cannot deadlock by grabbing them in opposite orders.
      for (const [index, item] of items.entries()) {
        await drawStock(conn, farmId, id, item, index)
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const sale = await loadSale(farmId, id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'sale.create',
      entityType: 'sale',
      entityId: id,
      after: { soldOn: sale.sale.soldOn, total: sale.sale.total, items: sale.items.length },
    })
    res.status(201).json(sale)
  }),
)

async function loadSale(farmId: string, id: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SALE_SELECT} WHERE s.id = ? AND s.farm_id = ? AND s.deleted_at IS NULL GROUP BY s.id LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Prodaja nije pronađena')

  const [items] = await pool.query<RowDataPacket[]>(
    `SELECT si.*, ${SALE_HONEY_KG} AS honey_kg, b.lot_code, b.honey_type, ${SALE_APIARY} AS apiary_id
       FROM sale_items si
       ${SALE_CHAIN_JOIN}
       LEFT JOIN honey_batches b ON b.id = COALESCE(p.batch_id, si.batch_id)
      WHERE si.sale_id = ? ORDER BY si.sort_order`,
    [id],
  )

  return {
    sale: mapSale(row),
    items: items.map((i) => ({
      id: i.id as string,
      kind: i.kind as 'jars' | 'bulk' | 'other',
      packagingId: (i.packaging_id as string | null) ?? null,
      batchId: (i.batch_id as string | null) ?? null,
      lotCode: (i.lot_code as string | null) ?? null,
      honeyType: (i.honey_type as string | null) ?? null,
      description: i.description as string,
      quantity: Number(i.quantity),
      unit: i.unit as string,
      unitPrice: Number(i.unit_price),
      lineTotal: Number(i.line_total),
      honeyKg: Number(i.honey_kg ?? 0),
    })),
  }
}

salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await loadSale(req.farm!.id, req.params.id))
  }),
)

/**
 * Header only — the customer, the date, whether it is paid. What was sold is not editable here;
 * see the note at the top of the file.
 */
salesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadSale(farmId, req.params.id)
    const data = z
      .object({
        ...saleHeaderFields,
        soldOn: requiredDate.optional(),
        channel: z.enum(CHANNELS).optional(),
        payment: z.enum(PAYMENTS).optional(),
        paid: z.boolean().optional(),
      })
      .parse(req.body)

    const { names, values } = changedColumns(data, SALE_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE sales SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.sale.id, farmId],
      )
    }

    const after = await loadSale(farmId, before.sale.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'sale.update',
      entityType: 'sale',
      entityId: before.sale.id,
      before: before.sale,
      after: after.sale,
    })
    res.json(after)
  }),
)

/**
 * Deleting a sale puts the stock back — every jar onto its packaging run, every bulk kilogram onto
 * its LOT. Soft delete on the header, hard restore of the quantities: the record of the sale is
 * kept for the audit trail, but the honey it removed was never actually sold and must be
 * countable again.
 */
salesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadSale(farmId, req.params.id)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      for (const item of before.items) {
        if (item.kind === 'jars' && item.packagingId) {
          await conn.query(
            'UPDATE packaging_batches SET sold_count = GREATEST(sold_count - ?, 0) WHERE id = ? AND farm_id = ?',
            [item.quantity, item.packagingId, farmId],
          )
        } else if (item.kind === 'bulk' && item.batchId) {
          await conn.query(
            'UPDATE honey_batches SET sold_bulk_kg = GREATEST(sold_bulk_kg - ?, 0) WHERE id = ? AND farm_id = ?',
            [item.quantity, item.batchId, farmId],
          )
        }
      }
      await conn.query('UPDATE sales SET deleted_at = NOW() WHERE id = ? AND farm_id = ?', [
        before.sale.id,
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
      action: 'sale.delete',
      entityType: 'sale',
      entityId: before.sale.id,
      before: { total: before.sale.total, items: before.items.length },
    })
    res.status(204).end()
  }),
)

/** §30 — the sales half of a LOT's traceability chain, read by routes/traceability.ts. */
export async function salesForBatch(batchId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT si.id, si.kind, si.description, si.quantity, si.unit, si.line_total,
            ${SALE_HONEY_KG} AS honey_kg,
            s.id AS sale_id, s.sold_on, s.channel, c.name AS customer_name
       FROM sale_items si
       ${SALE_CHAIN_JOIN}
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE COALESCE(p.batch_id, si.batch_id) = ?
      ORDER BY s.sold_on DESC`,
    [batchId],
  )
  return rows.map((r) => ({
    id: r.id as string,
    saleId: r.sale_id as string,
    soldOn: asDate(r.sold_on),
    channel: r.channel as string,
    customerName: (r.customer_name as string | null) ?? null,
    kind: r.kind as string,
    description: r.description as string,
    quantity: Number(r.quantity),
    unit: r.unit as string,
    lineTotal: asNumber(r.line_total),
    honeyKg: Number(r.honey_kg ?? 0),
  }))
}
