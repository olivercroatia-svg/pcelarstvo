import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { apiaryEconomics, EXPENSE_LABELS, hiveYields, LOSS_REASON_LABELS, winterLosses } from '../lib/commerce.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { asDate, asNumber } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §49 — "Generiraj izvještaj 2026." All fourteen sections the scenario lists, in its order.
 *
 * Rendered by the browser's print dialog, like the §25 forms and the §34 declarations before it.
 * That decision has now been made three times for the same three reasons: a system font carries
 * č/ć/š/ž/đ without embedding a font file, what the beekeeper sees is what comes out of the
 * printer, and there is no PDF library on the VPS to keep alive.
 *
 * Available to workers, minus the money. §49's sections 11 and 12 are prodaja and troškovi; §4
 * keeps those from a worker, so they are absent from the response rather than hidden on the page.
 * A report that omits two of fourteen sections is still worth printing; one that leaks turnover to
 * a seasonal helper is not.
 */
export const reportRouter = Router()
reportRouter.use(requireFarm)

reportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const isOwner = req.farm!.role === 'owner'
    const { year = new Date().getFullYear() } = z
      .object({ year: z.coerce.number().int().min(2000).max(2100).optional() })
      .parse(req.query)

    const from = `${year}-01-01`
    const to = `${year}-12-31`

    // 1 — podaci gospodarstva
    const [farmRows] = await pool.query<RowDataPacket[]>(
      `SELECT f.name, f.entity_type, f.oib, f.mibpg, f.address, f.city, f.postal_code, f.epp_number,
              f.association, f.responsible_person, u.first_name, u.last_name
         FROM farms f JOIN users u ON u.id = f.owner_user_id WHERE f.id = ? LIMIT 1`,
      [farmId],
    )
    const farm = farmRows[0]
    if (!farm) throw notFound('Gospodarstvo nije pronađeno')

    // 2, 3 — pčelinjaci i broj zajednica
    const [apiaries] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.name, a.kind, a.city, a.location_name, a.permit_number, a.permit_expires_on,
              (SELECT COUNT(*) FROM hives h WHERE h.apiary_id = a.id AND h.deleted_at IS NULL) AS hives,
              (SELECT COUNT(*) FROM colonies c JOIN hives h ON h.id = c.hive_id
                WHERE h.apiary_id = a.id AND c.ended_on IS NULL) AS colonies
         FROM apiaries a WHERE a.farm_id = ? AND a.deleted_at IS NULL ORDER BY a.name`,
      [farmId],
    )

    // 4, 5, 9, 14 — proizvodnja, vrste meda, vrcanja i prinosi
    const [harvests] = await pool.query<RowDataPacket[]>(
      `SELECT h.id, h.harvested_on, h.pasture, h.hive_range, a.name AS apiary_name,
              b.lot_code, b.honey_type, b.total_kg, b.moisture_percent,
              (SELECT COUNT(*) FROM harvest_hives hh WHERE hh.harvest_id = h.id) AS hive_count
         FROM harvests h
         JOIN apiaries a ON a.id = h.apiary_id
         LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
        WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.harvested_on BETWEEN ? AND ?
        ORDER BY h.harvested_on`,
      [farmId, from, to],
    )

    const [honeyTypes] = await pool.query<RowDataPacket[]>(
      `SELECT b.honey_type, SUM(b.total_kg) AS kg, COUNT(*) AS batches
         FROM honey_batches b JOIN harvests h ON h.id = b.harvest_id AND h.deleted_at IS NULL
        WHERE b.farm_id = ? AND b.deleted_at IS NULL AND h.harvested_on BETWEEN ? AND ?
        GROUP BY b.honey_type ORDER BY kg DESC`,
      [farmId, from, to],
    )

    // 6 — matice
    const [queens] = await pool.query<RowDataPacket[]>(
      `SELECT q.id, q.code, q.year, q.line, q.origin, q.status, q.marking_color,
              (SELECT COUNT(*) FROM colonies c WHERE c.queen_id = q.id AND c.ended_on IS NULL) AS colonies
         FROM queens q WHERE q.farm_id = ? AND q.deleted_at IS NULL
        ORDER BY q.year DESC, q.code`,
      [farmId],
    )

    // 7 — veterinarski tretmani
    const [treatments] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.product_name, t.active_substance, t.lot_number, t.started_on, t.ended_on,
              t.withdrawal_until, t.dose, a.name AS apiary_name,
              (SELECT COUNT(*) FROM treatment_hives th WHERE th.treatment_id = t.id) AS hive_count
         FROM veterinary_treatments t JOIN apiaries a ON a.id = t.apiary_id
        WHERE t.farm_id = ? AND t.deleted_at IS NULL AND t.started_on BETWEEN ? AND ?
        ORDER BY t.started_on`,
      [farmId, from, to],
    )

    // 8 — varroa monitoring
    const [varroa] = await pool.query<RowDataPacket[]>(
      `SELECT v.checked_on, v.method, v.phase, v.mites_found, v.infestation_percent, v.mites_per_day,
              a.name AS apiary_name
         FROM varroa_checks v JOIN apiaries a ON a.id = v.apiary_id
        WHERE v.farm_id = ? AND v.deleted_at IS NULL AND v.checked_on BETWEEN ? AND ?
        ORDER BY v.checked_on`,
      [farmId, from, to],
    )

    // 10 — laboratorijske analize
    const [labs] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.laboratory, t.report_number, t.sampled_on, t.tested_on, b.lot_code, b.honey_type
         FROM laboratory_tests t JOIN honey_batches b ON b.id = t.batch_id
        WHERE t.farm_id = ? AND t.deleted_at IS NULL
          AND COALESCE(t.tested_on, t.sampled_on, DATE(t.created_at)) BETWEEN ? AND ?
        ORDER BY COALESCE(t.tested_on, t.sampled_on)`,
      [farmId, from, to],
    )

    // 13 — gubici zajednica
    const losses = await winterLosses(farmId, year - 1)

    // 14 — prinosi po košnici (the §41 estimate; the printed page repeats the caveat)
    const yields = await hiveYields(farmId, year)
    const totalKg = honeyTypes.reduce((sum, t) => sum + Number(t.kg), 0)
    const totalColonies = apiaries.reduce((sum, a) => sum + Number(a.colonies), 0)

    const report: Record<string, unknown> = {
      year,
      generatedOn: new Date().toISOString().slice(0, 10),
      includesFinancials: isOwner,
      farm: {
        name: (farm.name as string | null) ?? `${farm.first_name} ${farm.last_name}`.trim(),
        holder: `${farm.first_name} ${farm.last_name}`.trim(),
        entityType: farm.entity_type as string,
        oib: (farm.oib as string | null) ?? null,
        mibpg: (farm.mibpg as string | null) ?? null,
        address: (farm.address as string | null) ?? null,
        city: [farm.postal_code, farm.city].filter(Boolean).join(' ') || null,
        eppNumber: (farm.epp_number as string | null) ?? null,
        association: (farm.association as string | null) ?? null,
        responsiblePerson: (farm.responsible_person as string | null) ?? null,
      },
      apiaries: apiaries.map((a) => ({
        id: a.id as string,
        name: a.name as string,
        kind: a.kind as string,
        place: (a.location_name as string | null) ?? (a.city as string | null) ?? null,
        hives: Number(a.hives),
        colonies: Number(a.colonies),
        permitNumber: (a.permit_number as string | null) ?? null,
        permitExpiresOn: asDate(a.permit_expires_on),
      })),
      summary: {
        apiaries: apiaries.length,
        colonies: totalColonies,
        producedKg: Number(totalKg.toFixed(2)),
        kgPerColony: totalColonies > 0 ? Number((totalKg / totalColonies).toFixed(1)) : null,
        harvests: harvests.length,
        treatments: treatments.length,
        varroaChecks: varroa.length,
        labTests: labs.length,
      },
      honeyTypes: honeyTypes.map((t) => ({
        honeyType: t.honey_type as string,
        kg: Number(t.kg),
        batches: Number(t.batches),
        share: totalKg > 0 ? Math.round((Number(t.kg) / totalKg) * 100) : 0,
      })),
      harvests: harvests.map((h) => ({
        id: h.id as string,
        harvestedOn: asDate(h.harvested_on),
        pasture: h.pasture as string,
        apiaryName: h.apiary_name as string,
        lotCode: (h.lot_code as string | null) ?? null,
        honeyType: (h.honey_type as string | null) ?? null,
        totalKg: asNumber(h.total_kg),
        moisturePercent: asNumber(h.moisture_percent),
        hiveCount: Number(h.hive_count),
        hiveRange: (h.hive_range as string | null) ?? null,
      })),
      queens: queens.map((q) => ({
        id: q.id as string,
        code: q.code as string,
        year: asNumber(q.year),
        line: (q.line as string | null) ?? null,
        origin: (q.origin as string | null) ?? null,
        status: q.status as string,
        colonies: Number(q.colonies),
      })),
      treatments: treatments.map((t) => ({
        id: t.id as string,
        productName: t.product_name as string,
        activeSubstance: (t.active_substance as string | null) ?? null,
        lotNumber: (t.lot_number as string | null) ?? null,
        startedOn: asDate(t.started_on),
        endedOn: asDate(t.ended_on),
        withdrawalUntil: asDate(t.withdrawal_until),
        dose: (t.dose as string | null) ?? null,
        apiaryName: t.apiary_name as string,
        hiveCount: Number(t.hive_count),
      })),
      varroa: varroa.map((v) => ({
        checkedOn: asDate(v.checked_on),
        apiaryName: v.apiary_name as string,
        method: v.method as string,
        phase: v.phase as string,
        mitesFound: Number(v.mites_found),
        infestationPercent: asNumber(v.infestation_percent),
        mitesPerDay: asNumber(v.mites_per_day),
      })),
      labTests: labs.map((l) => ({
        id: l.id as string,
        laboratory: (l.laboratory as string | null) ?? null,
        reportNumber: (l.report_number as string | null) ?? null,
        sampledOn: asDate(l.sampled_on),
        testedOn: asDate(l.tested_on),
        lotCode: l.lot_code as string,
        honeyType: l.honey_type as string,
      })),
      losses: { ...losses, reasonLabels: LOSS_REASON_LABELS },
      hiveYields: {
        estimated: true,
        averageKg: yields.length > 0 ? Number((yields.reduce((s, y) => s + y.kg, 0) / yields.length).toFixed(1)) : null,
        top: yields.slice(0, 10),
      },
    }

    if (isOwner) {
      const [sales] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT s.id) AS sales,
                COALESCE(SUM(si.line_total), 0) AS revenue,
                COALESCE(SUM(CASE si.kind
                               WHEN 'jars' THEN si.quantity * COALESCE(p.jar_size_g, 0) / 1000
                               WHEN 'bulk' THEN si.quantity
                               ELSE 0 END), 0) AS honey_kg
           FROM sales s
           LEFT JOIN sale_items si ON si.sale_id = s.id
           LEFT JOIN packaging_batches p ON p.id = si.packaging_id
          WHERE s.farm_id = ? AND s.deleted_at IS NULL AND s.sold_on BETWEEN ? AND ?`,
        [farmId, from, to],
      )
      const [expenses] = await pool.query<RowDataPacket[]>(
        `SELECT category, SUM(amount) AS total, COUNT(*) AS entries FROM expenses
          WHERE farm_id = ? AND deleted_at IS NULL AND spent_on BETWEEN ? AND ?
          GROUP BY category ORDER BY total DESC`,
        [farmId, from, to],
      )

      const revenue = Number(sales[0]?.revenue ?? 0)
      const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.total), 0)

      report.sales = {
        count: Number(sales[0]?.sales ?? 0),
        revenue: Number(revenue.toFixed(2)),
        honeyKg: Number(Number(sales[0]?.honey_kg ?? 0).toFixed(2)),
      }
      report.expenses = {
        total: Number(expenseTotal.toFixed(2)),
        breakdown: expenses.map((e) => ({
          category: e.category as string,
          label: EXPENSE_LABELS[e.category as keyof typeof EXPENSE_LABELS],
          total: Number(e.total),
          entries: Number(e.entries),
        })),
      }
      report.economics = {
        profit: Number((revenue - expenseTotal).toFixed(2)),
        apiaries: await apiaryEconomics(farmId, year),
      }
    }

    res.json({ report })
  }),
)
