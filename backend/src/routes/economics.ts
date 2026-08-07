import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import {
  apiaryEconomics,
  EXPENSE_LABELS,
  hiveYields,
  LOSS_REASON_LABELS,
  queenLineStats,
  winterLosses,
} from '../lib/commerce.js'
import { asyncHandler } from '../lib/http.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

/**
 * §40 ekonomika, and §41–§43 analitika.
 *
 * Two routers, and the split between them is the point. §4 says a worker may not reach financial
 * reports — but "B024 je dala 58 kg" is not a financial report, it is the reason the worker is
 * asked to requeen B007. So:
 *
 *   /api/economics  — euros. Owner only.
 *   /api/analytics  — kilograms, queen lines, colony losses. Anyone on the farm.
 *
 * Splitting by router rather than by field keeps the rule checkable: if a euro sign ever appears
 * in an analytics response, it is in the wrong file.
 */

export const economicsRouter = Router()
economicsRouter.use(requireFarm, requireOwner)

export const analyticsRouter = Router()
analyticsRouter.use(requireFarm)

const currentYear = () => new Date().getFullYear()

const yearQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

/** The years the farm actually has data for, so the selector never offers an empty one. */
async function availableYears(farmId: string, includeMoney: boolean): Promise<number[]> {
  const parts = [
    'SELECT DISTINCT YEAR(harvested_on) AS y FROM harvests WHERE farm_id = ? AND deleted_at IS NULL',
  ]
  const params: unknown[] = [farmId]
  if (includeMoney) {
    parts.push('SELECT DISTINCT YEAR(sold_on) FROM sales WHERE farm_id = ? AND deleted_at IS NULL')
    parts.push('SELECT DISTINCT YEAR(spent_on) FROM expenses WHERE farm_id = ? AND deleted_at IS NULL')
    params.push(farmId, farmId)
  }

  const [rows] = await pool.query<RowDataPacket[]>(parts.join(' UNION '), params)
  const years = new Set(rows.map((r) => Number(r.y)).filter((y) => y > 0))
  years.add(currentYear())
  return [...years].sort((a, b) => b - a)
}

// ─────────────────────────────────────────────────────────────── §40

economicsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const { year = currentYear() } = yearQuery.parse(req.query)

    const rows = await apiaryEconomics(farmId, year)

    // The farm total is summed from the per-apiary rows rather than queried separately, so the
    // header figure and the table underneath it can never disagree.
    const sum = (key: 'revenue' | 'honeyRevenue' | 'expenses' | 'producedKg' | 'soldKg' | 'colonies') =>
      Number(rows.reduce((acc, r) => acc + r[key], 0).toFixed(2))

    const revenue = sum('revenue')
    const honeyRevenue = sum('honeyRevenue')
    const expenses = sum('expenses')
    const producedKg = sum('producedKg')
    const soldKg = sum('soldKg')
    const colonies = sum('colonies')
    const ratio = (a: number, b: number) => (b > 0 ? Number((a / b).toFixed(2)) : null)

    const [breakdown] = await pool.query<RowDataPacket[]>(
      `SELECT category, SUM(amount) AS total FROM expenses
        WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(spent_on) = ?
        GROUP BY category ORDER BY total DESC`,
      [farmId, year],
    )

    const [monthly] = await pool.query<RowDataPacket[]>(
      `SELECT MONTH(s.sold_on) AS m, SUM(si.line_total) AS total
         FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE s.farm_id = ? AND s.deleted_at IS NULL AND YEAR(s.sold_on) = ?
        GROUP BY MONTH(s.sold_on) ORDER BY m`,
      [farmId, year],
    )

    res.json({
      year,
      years: await availableYears(farmId, true),
      totals: {
        revenue,
        honeyRevenue,
        expenses,
        profit: Number((revenue - expenses).toFixed(2)),
        producedKg,
        soldKg,
        colonies,
        kgPerColony: ratio(producedKg, colonies),
        costPerKg: ratio(expenses, producedKg),
        // Honey revenue, not total revenue — see the note on ApiaryEconomics.honeyRevenue.
        pricePerKg: ratio(honeyRevenue, soldKg),
      },
      apiaries: rows,
      expenseBreakdown: breakdown.map((b) => ({
        category: b.category as string,
        label: EXPENSE_LABELS[b.category as keyof typeof EXPENSE_LABELS],
        total: Number(b.total),
      })),
      monthlyRevenue: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        total: Number(monthly.find((m) => Number(m.m) === i + 1)?.total ?? 0),
      })),
    })
  }),
)

// ─────────────────────────────────────────────────────────────── §41 §42 §43

analyticsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const { year = currentYear() } = yearQuery.parse(req.query)

    const yields = await hiveYields(farmId, year)
    const total = yields.reduce((sum, y) => sum + y.kg, 0)

    // §43 shows the winter that has already been through its spring check. In August 2026 that is
    // 2025./2026., not the winter that has not started yet.
    const now = new Date()
    const lastCompleteWinter = now.getMonth() + 1 >= 4 ? now.getFullYear() - 1 : now.getFullYear() - 2

    res.json({
      year,
      years: await availableYears(farmId, false),
      hives: {
        // §41 "Najproduktivnije / Najslabije". Five each, and only when there are enough hives for
        // the two lists not to be the same hives twice.
        top: yields.slice(0, 5),
        bottom: yields.length >= 6 ? yields.slice(-5).reverse() : [],
        all: yields,
        averageKg: yields.length > 0 ? Number((total / yields.length).toFixed(1)) : null,
        totalKg: Number(total.toFixed(1)),
        // Surfaced in the response, not only in the UI copy: the number is an even split of each
        // harvest across the hives that fed it, never a per-hive weighing.
        estimated: true,
      },
      queenLines: queenLineStats(yields),
      losses: {
        current: await winterLosses(farmId, lastCompleteWinter),
        previous: await winterLosses(farmId, lastCompleteWinter - 1),
        reasonLabels: LOSS_REASON_LABELS,
      },
    })
  }),
)
