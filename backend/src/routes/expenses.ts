import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { EXPENSE_CATEGORIES, EXPENSE_LABELS } from '../lib/commerce.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { assertFarmReference } from '../lib/ownership.js'
import { asDate, asNumber, changedColumns, nullableDecimal, nullableText, requiredDate } from '../lib/schema.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

/**
 * §39 troškovi and §51 the receipt archive.
 *
 * Owner-only for the same reason as sales: §4 keeps a worker out of the financial side, and every
 * row here is an amount in euros.
 *
 * The receipt itself is not stored by this module. §51 says receipts link to expenses, subsidies
 * and an apiary — so the file goes into the §22 document archive under category 'receipt', where
 * it is already covered by the authenticated file route (§56) and already appears in Inspekcija
 * mod, and the expense just points at it. A second upload path would mean a second place to look
 * for a piece of paper.
 *
 * §39's OCR ("AI prepoznaje dobavljača, datum, iznos, PDV, kategoriju") is Etapa 5. Every column
 * it will fill exists here now and is typed by hand in the meantime.
 */
export const expensesRouter = Router()
expensesRouter.use(requireFarm, requireOwner)

function mapExpense(row: RowDataPacket) {
  return {
    id: row.id as string,
    apiaryId: (row.apiary_id as string | null) ?? null,
    apiaryName: (row.apiary_name as string | null) ?? null,
    spentOn: asDate(row.spent_on),
    category: row.category as (typeof EXPENSE_CATEGORIES)[number],
    categoryLabel: EXPENSE_LABELS[row.category as keyof typeof EXPENSE_LABELS],
    supplier: (row.supplier as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    amount: Number(row.amount),
    vatAmount: asNumber(row.vat_amount),
    documentId: (row.document_id as string | null) ?? null,
    documentTitle: (row.document_title as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

const EXPENSE_SELECT = `
  SELECT e.*, a.name AS apiary_name, d.title AS document_title
    FROM expenses e
    LEFT JOIN apiaries a ON a.id = e.apiary_id
    LEFT JOIN documents d ON d.id = e.document_id
`

expensesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const query = z
      .object({
        year: z.coerce.number().int().min(2000).max(2100).optional(),
        category: z.enum(EXPENSE_CATEGORIES).optional(),
        apiaryId: z.string().trim().min(1).optional(),
      })
      .parse(req.query)

    const filters = ['e.farm_id = ?', 'e.deleted_at IS NULL']
    const params: unknown[] = [farmId]
    if (query.year) {
      filters.push('YEAR(e.spent_on) = ?')
      params.push(query.year)
    }
    if (query.category) {
      filters.push('e.category = ?')
      params.push(query.category)
    }
    if (query.apiaryId) {
      filters.push('e.apiary_id = ?')
      params.push(query.apiaryId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${EXPENSE_SELECT} WHERE ${filters.join(' AND ')} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 300`,
      params,
    )

    // The breakdown ignores the category filter on purpose: it is what the filter chips are
    // rendered from, so filtering it would make every chip but the active one disappear.
    const breakdownFilters = filters.filter((f) => !f.startsWith('e.category'))
    const breakdownParams = params.filter((_, i) => filters[i] !== 'e.category = ?')
    const [breakdown] = await pool.query<RowDataPacket[]>(
      `SELECT e.category, SUM(e.amount) AS total, COUNT(*) AS entries
         FROM expenses e WHERE ${breakdownFilters.join(' AND ')}
        GROUP BY e.category ORDER BY total DESC`,
      breakdownParams,
    )

    res.json({
      expenses: rows.map(mapExpense),
      breakdown: breakdown.map((b) => ({
        category: b.category as string,
        label: EXPENSE_LABELS[b.category as keyof typeof EXPENSE_LABELS],
        total: Number(b.total),
        entries: Number(b.entries),
      })),
      total: breakdown.reduce((sum, b) => sum + Number(b.total), 0),
      categories: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_LABELS[c] })),
    })
  }),
)

const expenseFields = {
  apiaryId: z.string().trim().min(1).nullish(),
  spentOn: requiredDate,
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  supplier: nullableText(200),
  description: nullableText(255),
  amount: z.coerce.number().min(0, 'Unesite iznos').max(10000000),
  vatAmount: nullableDecimal(0, 10000000),
  documentId: z.string().trim().min(1).nullish(),
  notes: nullableText(2000),
}

const EXPENSE_COLUMNS: Record<string, string> = {
  apiaryId: 'apiary_id',
  spentOn: 'spent_on',
  category: 'category',
  supplier: 'supplier',
  description: 'description',
  amount: 'amount',
  vatAmount: 'vat_amount',
  documentId: 'document_id',
  notes: 'notes',
}

expensesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object(expenseFields).parse(req.body)
    await assertFarmReference(pool, 'apiary', data.apiaryId, farmId)
    await assertFarmReference(pool, 'document', data.documentId, farmId)
    const id = newId()
    const { names, values } = changedColumns(data, EXPENSE_COLUMNS)

    await pool.query(
      `INSERT INTO expenses (id, farm_id, created_by, ${names.join(', ')})
       VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
      [id, farmId, req.user!.id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'expense.create',
      entityType: 'expense',
      entityId: id,
      after: { category: data.category, amount: data.amount, spentOn: data.spentOn },
    })

    const [rows] = await pool.query<RowDataPacket[]>(`${EXPENSE_SELECT} WHERE e.id = ?`, [id])
    res.status(201).json({ expense: mapExpense(rows[0]!) })
  }),
)

async function loadExpense(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${EXPENSE_SELECT} WHERE e.id = ? AND e.farm_id = ? AND e.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Trošak nije pronađen')
  return row
}

expensesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ expense: mapExpense(await loadExpense(req.farm!.id, req.params.id)) })
  }),
)

expensesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadExpense(farmId, req.params.id)
    const data = z
      .object({
        ...expenseFields,
        spentOn: requiredDate.optional(),
        category: z.enum(EXPENSE_CATEGORIES).optional(),
        amount: expenseFields.amount.optional(),
      })
      .parse(req.body)
    await assertFarmReference(pool, 'apiary', data.apiaryId, farmId)
    await assertFarmReference(pool, 'document', data.documentId, farmId)

    const { names, values } = changedColumns(data, EXPENSE_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE expenses SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const after = await loadExpense(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'expense.update',
      entityType: 'expense',
      entityId: before.id as string,
      before: mapExpense(before),
      after: mapExpense(after),
    })
    res.json({ expense: mapExpense(after) })
  }),
)

expensesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadExpense(farmId, req.params.id)

    await pool.query('UPDATE expenses SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'expense.delete',
      entityType: 'expense',
      entityId: before.id as string,
      before: mapExpense(before),
    })
    res.status(204).end()
  }),
)
