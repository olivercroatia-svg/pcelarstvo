import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { asyncHandler } from '../lib/http.js'
import { counted } from '../lib/plural.js'
import { asDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §52 globalna tražilica and §48 digitalni dnevnik.
 *
 * Together because they are the same problem twice: both read across every module in the
 * application, and both must obey §4 in the same way. A worker searching for "kadulja" gets the
 * LOT and the harvest; they do not get the sale, and they do not get the customer who bought it.
 * The filter is applied by not running those queries at all, rather than by removing rows
 * afterwards.
 *
 * Neither uses MySQL FULLTEXT. A farm has hundreds of rows, not millions; LIKE across a dozen
 * indexed-by-farm tables answers in milliseconds, and a FULLTEXT index per table would need
 * maintaining for a search that would not get measurably faster.
 */

export const searchRouter = Router()
searchRouter.use(requireFarm)

export const timelineRouter = Router()
timelineRouter.use(requireFarm)

// ─────────────────────────────────────────────────────────────── §52 search

export interface SearchHit {
  type: string
  typeLabel: string
  id: string
  title: string
  subtitle: string | null
  date: string | null
  link: string
}

/** `%` and `_` are wildcards; a beekeeper typing "50 %" should not match everything. */
const likeTerm = (raw: string) => `%${raw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** "2026", "2026-05" and "2026-05-24" all mean "show me what happened then". */
function dateRange(term: string): { from: string; to: string; label: string } | null {
  if (/^\d{4}$/.test(term)) return { from: `${term}-01-01`, to: `${term}-12-31`, label: term }
  if (/^\d{4}-\d{2}$/.test(term)) {
    const [y, m] = term.split('-').map(Number)
    const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
    return { from: `${term}-01`, to: `${term}-${String(last).padStart(2, '0')}`, label: term }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(term)) return { from: term, to: term, label: term }
  return null
}

interface Source {
  type: string
  label: string
  /** Financial sources are skipped entirely for a worker (§4). */
  owner?: boolean
  sql: string
  /** How many `?` the WHERE clause needs the search term for. */
  terms: number
  map: (row: RowDataPacket) => SearchHit
}

const SOURCES: Source[] = [
  {
    type: 'hive',
    label: 'Košnica',
    terms: 1,
    sql: `SELECT h.id, h.code, a.name AS apiary_name, h.status
            FROM hives h LEFT JOIN apiaries a ON a.id = h.apiary_id
           WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.code LIKE ? ESCAPE '\\\\'
           ORDER BY h.code LIMIT 8`,
    map: (r) => ({
      type: 'hive',
      typeLabel: 'Košnica',
      id: r.id as string,
      title: r.code as string,
      subtitle: (r.apiary_name as string | null) ?? null,
      date: null,
      link: `/kosnice/${r.id}`,
    }),
  },
  {
    type: 'apiary',
    label: 'Pčelinjak',
    terms: 3,
    sql: `SELECT id, name, city, location_name FROM apiaries
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\\\' OR city LIKE ? ESCAPE '\\\\' OR location_name LIKE ? ESCAPE '\\\\')
           ORDER BY name LIMIT 8`,
    map: (r) => ({
      type: 'apiary',
      typeLabel: 'Pčelinjak',
      id: r.id as string,
      title: r.name as string,
      subtitle: (r.location_name as string | null) ?? (r.city as string | null) ?? null,
      date: null,
      link: `/pcelinjaci/${r.id}`,
    }),
  },
  {
    type: 'batch',
    label: 'Serija meda',
    terms: 2,
    sql: `SELECT b.id, b.lot_code, b.honey_type, b.total_kg, b.available_kg, h.harvested_on
            FROM honey_batches b JOIN harvests h ON h.id = b.harvest_id
           WHERE b.farm_id = ? AND b.deleted_at IS NULL
             AND (b.lot_code LIKE ? ESCAPE '\\\\' OR b.honey_type LIKE ? ESCAPE '\\\\')
           ORDER BY h.harvested_on DESC LIMIT 8`,
    map: (r) => ({
      type: 'batch',
      typeLabel: 'Serija meda',
      id: r.id as string,
      title: r.lot_code as string,
      subtitle: `${r.honey_type} · ${Number(r.available_kg)} od ${Number(r.total_kg)} kg`,
      date: asDate(r.harvested_on),
      link: `/serije/${r.id}`,
    }),
  },
  {
    type: 'harvest',
    label: 'Vrcanje',
    terms: 2,
    sql: `SELECT h.id, h.harvested_on, h.pasture, a.name AS apiary_name, b.total_kg
            FROM harvests h
            JOIN apiaries a ON a.id = h.apiary_id
            LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
           WHERE h.farm_id = ? AND h.deleted_at IS NULL
             AND (h.pasture LIKE ? ESCAPE '\\\\' OR h.hive_range LIKE ? ESCAPE '\\\\')
           ORDER BY h.harvested_on DESC LIMIT 8`,
    map: (r) => ({
      type: 'harvest',
      typeLabel: 'Vrcanje',
      id: r.id as string,
      title: r.pasture as string,
      subtitle: `${r.apiary_name}${r.total_kg ? ` · ${Number(r.total_kg)} kg` : ''}`,
      date: asDate(r.harvested_on),
      link: `/vrcanja/${r.id}`,
    }),
  },
  {
    type: 'treatment',
    label: 'Tretman',
    terms: 3,
    sql: `SELECT t.id, t.product_name, t.active_substance, t.lot_number, t.started_on, a.name AS apiary_name
            FROM veterinary_treatments t JOIN apiaries a ON a.id = t.apiary_id
           WHERE t.farm_id = ? AND t.deleted_at IS NULL
             AND (t.product_name LIKE ? ESCAPE '\\\\' OR t.active_substance LIKE ? ESCAPE '\\\\'
                  OR t.lot_number LIKE ? ESCAPE '\\\\')
           ORDER BY t.started_on DESC LIMIT 8`,
    map: (r) => ({
      type: 'treatment',
      typeLabel: 'Tretman',
      id: r.id as string,
      title: r.product_name as string,
      subtitle: [r.active_substance, r.apiary_name].filter(Boolean).join(' · ') || null,
      date: asDate(r.started_on),
      link: `/tretmani/${r.id}`,
    }),
  },
  {
    type: 'queen',
    label: 'Matica',
    terms: 3,
    sql: `SELECT id, code, line, origin, year FROM queens
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (code LIKE ? ESCAPE '\\\\' OR line LIKE ? ESCAPE '\\\\' OR origin LIKE ? ESCAPE '\\\\')
           ORDER BY year DESC LIMIT 6`,
    map: (r) => ({
      type: 'queen',
      typeLabel: 'Matica',
      id: r.id as string,
      title: r.code as string,
      subtitle: [r.line, r.year].filter(Boolean).join(' · ') || null,
      date: null,
      link: '/matice',
    }),
  },
  {
    type: 'document',
    label: 'Dokument',
    terms: 2,
    sql: `SELECT id, title, category, reference_number, issued_on FROM documents
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (title LIKE ? ESCAPE '\\\\' OR reference_number LIKE ? ESCAPE '\\\\')
           ORDER BY COALESCE(issued_on, created_at) DESC LIMIT 6`,
    map: (r) => ({
      type: 'document',
      typeLabel: 'Dokument',
      id: r.id as string,
      title: r.title as string,
      subtitle: (r.reference_number as string | null) ?? null,
      date: asDate(r.issued_on),
      link: '/dokumenti',
    }),
  },
  {
    type: 'inventory',
    label: 'Skladište',
    terms: 2,
    sql: `SELECT id, name, unit, quantity, lot_number FROM inventory_items
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\\\' OR lot_number LIKE ? ESCAPE '\\\\')
           ORDER BY name LIMIT 6`,
    map: (r) => ({
      type: 'inventory',
      typeLabel: 'Skladište',
      id: r.id as string,
      title: r.name as string,
      subtitle: `${Number(r.quantity)} ${r.unit}`,
      date: null,
      link: `/skladiste/${r.id}`,
    }),
  },
  {
    type: 'pasture',
    label: 'Paša',
    terms: 2,
    sql: `SELECT p.id, p.name, p.season_year, p.location, a.name AS apiary_name
            FROM pastures p LEFT JOIN apiaries a ON a.id = p.apiary_id
           WHERE p.farm_id = ? AND p.deleted_at IS NULL
             AND (p.name LIKE ? ESCAPE '\\\\' OR p.location LIKE ? ESCAPE '\\\\')
           ORDER BY p.season_year DESC LIMIT 6`,
    map: (r) => ({
      type: 'pasture',
      typeLabel: 'Paša',
      id: r.id as string,
      title: `${r.name} ${r.season_year}.`,
      subtitle: (r.apiary_name as string | null) ?? (r.location as string | null) ?? null,
      date: null,
      link: '/pase',
    }),
  },
  {
    type: 'relocation',
    label: 'Selidba',
    terms: 2,
    sql: `SELECT m.id, m.to_location, m.planned_on, m.status, a.name AS apiary_name
            FROM apiary_migrations m JOIN apiaries a ON a.id = m.apiary_id
           WHERE m.farm_id = ? AND m.deleted_at IS NULL
             AND (m.to_location LIKE ? ESCAPE '\\\\' OR m.pasture LIKE ? ESCAPE '\\\\')
           ORDER BY m.planned_on DESC LIMIT 6`,
    map: (r) => ({
      type: 'relocation',
      typeLabel: 'Selidba',
      id: r.id as string,
      title: r.to_location as string,
      subtitle: r.apiary_name as string,
      date: asDate(r.planned_on),
      link: `/selidbe/${r.id}`,
    }),
  },
  {
    type: 'customer',
    label: 'Kupac',
    owner: true,
    terms: 2,
    sql: `SELECT id, name, city, kind FROM customers
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (name LIKE ? ESCAPE '\\\\' OR city LIKE ? ESCAPE '\\\\')
           ORDER BY name LIMIT 6`,
    map: (r) => ({
      type: 'customer',
      typeLabel: 'Kupac',
      id: r.id as string,
      title: r.name as string,
      subtitle: (r.city as string | null) ?? null,
      date: null,
      link: `/kupci/${r.id}`,
    }),
  },
  {
    type: 'sale',
    label: 'Prodaja',
    owner: true,
    terms: 2,
    sql: `SELECT s.id, s.sold_on, s.document_number, c.name AS customer_name,
                 COALESCE(SUM(si.line_total), 0) AS total
            FROM sales s
            LEFT JOIN customers c ON c.id = s.customer_id
            LEFT JOIN sale_items si ON si.sale_id = s.id
           WHERE s.farm_id = ? AND s.deleted_at IS NULL
             AND (s.document_number LIKE ? ESCAPE '\\\\'
                  OR EXISTS (SELECT 1 FROM sale_items x WHERE x.sale_id = s.id
                              AND x.description LIKE ? ESCAPE '\\\\'))
           GROUP BY s.id ORDER BY s.sold_on DESC LIMIT 6`,
    map: (r) => ({
      type: 'sale',
      typeLabel: 'Prodaja',
      id: r.id as string,
      title: (r.customer_name as string | null) ?? 'Prodaja',
      subtitle: `${Number(r.total).toFixed(2).replace('.', ',')} €`,
      date: asDate(r.sold_on),
      link: `/prodaja/${r.id}`,
    }),
  },
  {
    type: 'expense',
    label: 'Trošak',
    owner: true,
    terms: 2,
    sql: `SELECT id, spent_on, supplier, description, amount FROM expenses
           WHERE farm_id = ? AND deleted_at IS NULL
             AND (supplier LIKE ? ESCAPE '\\\\' OR description LIKE ? ESCAPE '\\\\')
           ORDER BY spent_on DESC LIMIT 6`,
    map: (r) => ({
      type: 'expense',
      typeLabel: 'Trošak',
      id: r.id as string,
      title: (r.description as string | null) ?? (r.supplier as string | null) ?? 'Trošak',
      subtitle: `${Number(r.amount).toFixed(2).replace('.', ',')} €`,
      date: asDate(r.spent_on),
      link: `/troskovi`,
    }),
  },
]

searchRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const isOwner = req.farm!.role === 'owner'
    const { q } = z.object({ q: z.string().trim().min(1).max(120) }).parse(req.query)

    // "LOT KAD-260524" — the word people type in front of a code, dropped so the code still
    // matches. §52 gives this exact example.
    const term = q.replace(/^(lot|serija|košnica|kosnica|matica)\s+/i, '').trim() || q
    const like = likeTerm(term)
    const range = dateRange(term)

    const sources = SOURCES.filter((s) => !s.owner || isOwner)
    const results = await Promise.all(
      sources.map(async (source) => {
        const [rows] = await pool.query<RowDataPacket[]>(source.sql, [
          farmId,
          ...Array.from({ length: source.terms }, () => like),
        ])
        return rows.map(source.map)
      }),
    )

    const hits = results.flat()

    // §52's own example is "LOT KAD-260524", and the answer it expects is the whole chain, not
    // just the batch. The LOT code is stored in exactly one column — honey_batches.lot_code — so
    // the harvest, the analysis and the sale would never match it on text alone. When the term
    // resolves to a batch, its neighbours are added deliberately.
    const batchHits = hits.filter((h) => h.type === 'batch')
    const chain = batchHits.length === 1 ? await expandLot(farmId, isOwner, batchHits[0]!.id) : []

    // A date-shaped term means something different from a name: nothing is called "2026-05", so
    // matching it against text columns would return nothing at all. Answered separately, and only
    // when the text search came up short, so "2026" as part of a LOT still wins.
    const dated: SearchHit[] = []
    if (range && hits.length < 20) {
      dated.push(...(await searchByDate(farmId, isOwner, range)))
    }

    res.json({
      query: q,
      term,
      dateRange: range?.label ?? null,
      hits: [...hits, ...chain, ...dated],
      groups: [...sources.map((s) => s.type), ...(dated.length > 0 ? ['dated'] : [])],
    })
  }),
)

/**
 * Everything downstream and upstream of one LOT — the §30 chain, flattened into search hits.
 *
 * Only for an unambiguous match. Typing "KAD" hits a dozen batches and expanding all of them would
 * bury the list; typing the full code means the beekeeper is holding the jar and wants the chain.
 */
async function expandLot(farmId: string, isOwner: boolean, batchId: string): Promise<SearchHit[]> {
  const [harvests] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.harvested_on, h.pasture, a.name AS apiary_name
       FROM honey_batches b JOIN harvests h ON h.id = b.harvest_id
       JOIN apiaries a ON a.id = h.apiary_id
      WHERE b.id = ? AND b.farm_id = ? AND h.deleted_at IS NULL`,
    [batchId, farmId],
  )
  const [labs] = await pool.query<RowDataPacket[]>(
    `SELECT id, laboratory, report_number, tested_on FROM laboratory_tests
      WHERE batch_id = ? AND farm_id = ? AND deleted_at IS NULL`,
    [batchId, farmId],
  )
  const [packaging] = await pool.query<RowDataPacket[]>(
    `SELECT id, packaged_on, jar_count, jar_size_g, remaining_count FROM packaging_batches
      WHERE batch_id = ? AND farm_id = ? AND deleted_at IS NULL`,
    [batchId, farmId],
  )

  const hits: SearchHit[] = [
    ...harvests.map((r) => ({
      type: 'harvest',
      typeLabel: 'Vrcanje',
      id: r.id as string,
      title: r.pasture as string,
      subtitle: r.apiary_name as string,
      date: asDate(r.harvested_on),
      link: `/vrcanja/${r.id}`,
    })),
    ...labs.map((r) => ({
      type: 'lab',
      typeLabel: 'Laboratorijski nalaz',
      id: r.id as string,
      title: (r.laboratory as string | null) ?? 'Nalaz',
      subtitle: (r.report_number as string | null) ?? null,
      date: asDate(r.tested_on),
      link: `/nalazi/${r.id}`,
    })),
    ...packaging.map((r) => ({
      type: 'packaging',
      typeLabel: 'Pakiranje',
      id: r.id as string,
      title: `${Number(r.jar_count)} × ${Number(r.jar_size_g)} g`,
      subtitle: `${Number(r.remaining_count)} na skladištu`,
      date: asDate(r.packaged_on),
      link: `/pakiranja/${r.id}`,
    })),
  ]

  if (isOwner) {
    const [sales] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.sold_on, si.description, si.quantity, si.unit, si.line_total, c.name AS customer_name
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id AND s.deleted_at IS NULL
         LEFT JOIN packaging_batches p ON p.id = si.packaging_id
         LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.farm_id = ? AND COALESCE(p.batch_id, si.batch_id) = ?
        ORDER BY s.sold_on DESC LIMIT 10`,
      [farmId, batchId],
    )
    hits.push(
      ...sales.map((r) => ({
        type: 'sale',
        typeLabel: 'Prodaja',
        id: r.id as string,
        title: (r.customer_name as string | null) ?? 'Prodaja bez kupca',
        subtitle: `${Number(r.quantity)} ${r.unit} · ${Number(r.line_total).toFixed(2).replace('.', ',')} €`,
        date: asDate(r.sold_on),
        link: `/prodaja/${r.id}`,
      })),
    )
  }

  return hits
}

/** What happened in a month or a year — the "2026-05" case from §52. */
async function searchByDate(
  farmId: string,
  isOwner: boolean,
  range: { from: string; to: string },
): Promise<SearchHit[]> {
  const [harvests] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.harvested_on, h.pasture, b.total_kg
       FROM harvests h LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
      WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.harvested_on BETWEEN ? AND ?
      ORDER BY h.harvested_on DESC LIMIT 10`,
    [farmId, range.from, range.to],
  )
  const [treatments] = await pool.query<RowDataPacket[]>(
    `SELECT id, product_name, started_on FROM veterinary_treatments
      WHERE farm_id = ? AND deleted_at IS NULL AND started_on BETWEEN ? AND ?
      ORDER BY started_on DESC LIMIT 10`,
    [farmId, range.from, range.to],
  )
  const [inspections] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(inspected_at) AS d, COUNT(*) AS total FROM hive_inspections
      WHERE farm_id = ? AND DATE(inspected_at) BETWEEN ? AND ?
      GROUP BY DATE(inspected_at) ORDER BY d DESC LIMIT 10`,
    [farmId, range.from, range.to],
  )

  const hits: SearchHit[] = [
    ...harvests.map((r) => ({
      type: 'harvest',
      typeLabel: 'Vrcanje',
      id: r.id as string,
      title: r.pasture as string,
      subtitle: r.total_kg ? `${Number(r.total_kg)} kg` : null,
      date: asDate(r.harvested_on),
      link: `/vrcanja/${r.id}`,
    })),
    ...treatments.map((r) => ({
      type: 'treatment',
      typeLabel: 'Tretman',
      id: r.id as string,
      title: r.product_name as string,
      subtitle: null,
      date: asDate(r.started_on),
      link: `/tretmani/${r.id}`,
    })),
    ...inspections.map((r) => ({
      type: 'inspection',
      typeLabel: 'Pregledi',
      id: asDate(r.d)!,
      title: counted(Number(r.total), 'pregled', 'pregleda', 'pregleda'),
      subtitle: null,
      date: asDate(r.d),
      link: '/kosnice',
    })),
  ]

  if (isOwner) {
    const [sales] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.sold_on, c.name AS customer_name, COALESCE(SUM(si.line_total), 0) AS total
         FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE s.farm_id = ? AND s.deleted_at IS NULL AND s.sold_on BETWEEN ? AND ?
        GROUP BY s.id ORDER BY s.sold_on DESC LIMIT 10`,
      [farmId, range.from, range.to],
    )
    hits.push(
      ...sales.map((r) => ({
        type: 'sale',
        typeLabel: 'Prodaja',
        id: r.id as string,
        title: (r.customer_name as string | null) ?? 'Prodaja',
        subtitle: `${Number(r.total).toFixed(2).replace('.', ',')} €`,
        date: asDate(r.sold_on),
        link: `/prodaja/${r.id}`,
      })),
    )
  }

  return hits.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

// ─────────────────────────────────────────────────────────────── §48 timeline

interface TimelineEntry {
  date: string
  type: string
  title: string
  detail: string | null
  link: string | null
}

/** Mirrors the map in pages/Feeding.tsx — the timeline is rendered from the server's text. */
const FEED_LABELS: Record<string, string> = {
  syrup: 'sirup',
  sugar: 'šećer',
  patty: 'pogača',
  honey: 'med',
  pollen_substitute: 'zamjena za pelud',
  other: 'ostalo',
}

/**
 * §48 — "Svaka aktivnost ulazi u centralni timeline."
 *
 * Assembled from the modules on every read rather than written to a table of its own. A stored
 * timeline is a second copy of every event in the application, and the copy is what goes stale
 * when a treatment is corrected or a harvest deleted.
 *
 * Inspections are grouped by day, because §48's own example reads "19.05. Pregledano 42 košnice",
 * not forty-two separate lines.
 */
timelineRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const isOwner = req.farm!.role === 'owner'
    const { from, to } = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.query)

    const today = new Date()
    const defaultFrom = new Date(today.getTime() - 180 * 86_400_000).toISOString().slice(0, 10)
    const rangeFrom = from ?? defaultFrom
    const rangeTo = to ?? today.toISOString().slice(0, 10)
    const bounds = [farmId, rangeFrom, rangeTo]

    const [harvests, inspections, treatments, varroa, feedings, health, packaging, labs, relocations] =
      await Promise.all([
        pool.query<RowDataPacket[]>(
          `SELECT h.id, h.harvested_on AS d, h.pasture, b.total_kg, b.lot_code
             FROM harvests h LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
            WHERE h.farm_id = ? AND h.deleted_at IS NULL AND h.harvested_on BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT DATE(inspected_at) AS d, COUNT(*) AS total, SUM(is_batch) AS batched
             FROM hive_inspections WHERE farm_id = ? AND DATE(inspected_at) BETWEEN ? AND ?
            GROUP BY DATE(inspected_at)`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT t.id, t.started_on AS d, t.product_name, a.name AS apiary_name
             FROM veterinary_treatments t JOIN apiaries a ON a.id = t.apiary_id
            WHERE t.farm_id = ? AND t.deleted_at IS NULL AND t.started_on BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT id, checked_on AS d, method, infestation_percent
             FROM varroa_checks WHERE farm_id = ? AND deleted_at IS NULL AND checked_on BETWEEN ? AND ?`,
          bounds,
        ),
        // feedings is append-only and has no deleted_at — a correction is a new row, not an edit.
        pool.query<RowDataPacket[]>(
          `SELECT f.id, f.fed_on AS d, f.feed_type, f.amount_kg, a.name AS apiary_name
             FROM feedings f LEFT JOIN apiaries a ON a.id = f.apiary_id
            WHERE f.farm_id = ? AND f.fed_on BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT id, observed_on AS d, title, kind, severity
             FROM health_events WHERE farm_id = ? AND deleted_at IS NULL AND observed_on BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT p.id, p.packaged_on AS d, p.jar_count, p.jar_size_g, b.lot_code
             FROM packaging_batches p JOIN honey_batches b ON b.id = p.batch_id
            WHERE p.farm_id = ? AND p.deleted_at IS NULL AND p.packaged_on BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT t.id, COALESCE(t.tested_on, t.sampled_on) AS d, t.laboratory, b.lot_code
             FROM laboratory_tests t JOIN honey_batches b ON b.id = t.batch_id
            WHERE t.farm_id = ? AND t.deleted_at IS NULL
              AND COALESCE(t.tested_on, t.sampled_on) BETWEEN ? AND ?`,
          bounds,
        ),
        pool.query<RowDataPacket[]>(
          `SELECT m.id, COALESCE(m.completed_on, m.planned_on) AS d, m.to_location, m.status,
                  a.name AS apiary_name
             FROM apiary_migrations m JOIN apiaries a ON a.id = m.apiary_id
            WHERE m.farm_id = ? AND m.deleted_at IS NULL
              AND COALESCE(m.completed_on, m.planned_on) BETWEEN ? AND ?`,
          bounds,
        ),
      ])

    const entries: TimelineEntry[] = [
      ...harvests[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'harvest',
        title: `Vrcanje — ${r.pasture}`,
        detail: [r.total_kg ? `${Number(r.total_kg)} kg` : null, r.lot_code].filter(Boolean).join(' · ') || null,
        link: `/vrcanja/${r.id}`,
      })),
      ...inspections[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'inspection',
        title: `Pregledano ${counted(Number(r.total), 'košnica', 'košnice', 'košnica')}`,
        detail: Number(r.batched) > 0 ? 'skupni unos' : null,
        link: '/kosnice',
      })),
      ...treatments[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'treatment',
        title: `Tretman — ${r.product_name}`,
        detail: (r.apiary_name as string | null) ?? null,
        link: `/tretmani/${r.id}`,
      })),
      ...varroa[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'varroa',
        title: 'Kontrola varoe',
        detail: r.infestation_percent === null ? null : `${Number(r.infestation_percent)} %`,
        link: '/varroa',
      })),
      ...feedings[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'feeding',
        title: `Prihrana — ${FEED_LABELS[r.feed_type as string] ?? r.feed_type}`,
        detail:
          [r.amount_kg ? `${Number(r.amount_kg)} kg` : null, r.apiary_name].filter(Boolean).join(' · ') || null,
        link: '/prihrana',
      })),
      ...health[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'health',
        title: r.title as string,
        detail: (r.severity as string | null) === 'high' ? 'visok stupanj' : null,
        link: '/zdravlje',
      })),
      ...packaging[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'packaging',
        title: `Pakiranje ${Number(r.jar_count)} × ${Number(r.jar_size_g)} g`,
        detail: r.lot_code as string,
        link: `/pakiranja/${r.id}`,
      })),
      ...labs[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'lab',
        title: 'Laboratorijski nalaz',
        detail: [r.laboratory, r.lot_code].filter(Boolean).join(' · ') || null,
        link: `/nalazi/${r.id}`,
      })),
      ...relocations[0].map((r) => ({
        date: asDate(r.d)!,
        type: 'relocation',
        title: `${r.status === 'done' ? 'Selidba' : 'Planirana selidba'} — ${r.to_location}`,
        detail: (r.apiary_name as string | null) ?? null,
        link: `/selidbe/${r.id}`,
      })),
    ]

    if (isOwner) {
      const [sales] = await pool.query<RowDataPacket[]>(
        `SELECT s.id, s.sold_on AS d, c.name AS customer_name,
                COALESCE(SUM(si.line_total), 0) AS total, COUNT(si.id) AS items
           FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
           LEFT JOIN sale_items si ON si.sale_id = s.id
          WHERE s.farm_id = ? AND s.deleted_at IS NULL AND s.sold_on BETWEEN ? AND ?
          GROUP BY s.id`,
        bounds,
      )
      entries.push(
        ...sales.map((r) => ({
          date: asDate(r.d)!,
          type: 'sale',
          title: `Prodaja${r.customer_name ? ` — ${r.customer_name}` : ''}`,
          detail: `${Number(r.total).toFixed(2).replace('.', ',')} €`,
          link: `/prodaja/${r.id}`,
        })),
      )
    }

    entries.sort((a, b) => b.date.localeCompare(a.date))

    // Grouped by day on the server so the screen renders a list of days rather than re-deriving
    // the same grouping in the browser.
    const days: { date: string; entries: TimelineEntry[] }[] = []
    for (const entry of entries) {
      const last = days[days.length - 1]
      if (last && last.date === entry.date) last.entries.push(entry)
      else days.push({ date: entry.date, entries: [entry] })
    }

    res.json({ from: rangeFrom, to: rangeTo, days, total: entries.length })
  }),
)
