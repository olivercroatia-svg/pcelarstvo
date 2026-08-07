import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db.js'
import { asDate, asNumber } from './schema.js'

/**
 * The shared arithmetic of Etapa 4 — how much honey a sale line represents, which apiary earned
 * the money, and what a hive actually produced.
 *
 * Everything here exists because the same question is asked from more than one screen. §40's
 * €/kg, §41's hive ranking and §49's annual report all need "how many kilograms did this apiary
 * make", and three separate SELECTs would eventually give three different answers — which is the
 * failure this file, and the two rules in 006_commerce.sql, are written to prevent.
 */

// ─────────────────────────────────────────────────── §37 — what a sale line is worth, in kilograms

/**
 * The kilograms of honey behind one sale line, as SQL rather than as a stored column.
 *
 * A jars line is a count of jars; how much honey that is depends on the packaging run's jar size,
 * which lives on another table. Snapshotting it onto the line would mean correcting a run's jar
 * size leaves every past sale quietly wrong, so it is derived — 006's rule 2.
 *
 * Requires SALE_CHAIN_JOIN below to be in the FROM clause, for the `p` alias.
 */
export const SALE_HONEY_KG = `
  CASE si.kind
    WHEN 'jars' THEN si.quantity * COALESCE(p.jar_size_g, 0) / 1000
    WHEN 'bulk' THEN si.quantity
    ELSE 0
  END`

/**
 * §30 × §40 — the join that carries a sale back to the apiary that produced the honey.
 *
 * This is the payoff of the traceability chain built in Etapa 3: revenue is attached to a jar, a
 * jar to a packaging run, a run to a LOT, a LOT to an extraction, and an extraction to an apiary.
 * Without it, §40's "ekonomika pčelinjaka" could only ever be a farm-wide total with the apiary
 * column filled in by hand.
 *
 * Two parallel paths because a line is either jars or bulk honey; `other` (wax, a nucleus colony,
 * a queen) resolves to no apiary at all and lands in the unallocated bucket, which is the honest
 * answer rather than spreading it across apiaries that did not earn it.
 */
export const SALE_CHAIN_JOIN = `
  JOIN sales s              ON s.id  = si.sale_id AND s.deleted_at IS NULL
  LEFT JOIN packaging_batches p ON p.id = si.packaging_id
  LEFT JOIN honey_batches bp    ON bp.id = p.batch_id
  LEFT JOIN harvests hp         ON hp.id = bp.harvest_id
  LEFT JOIN honey_batches bb    ON bb.id = si.batch_id
  LEFT JOIN harvests hb         ON hb.id = bb.harvest_id`

/** The apiary a sale line is attributable to, or NULL. Same alias requirements as above. */
export const SALE_APIARY = 'COALESCE(hp.apiary_id, hb.apiary_id)'

// ─────────────────────────────────────────────────── §32 × §33 — jars as warehouse stock

export interface JarStockRow {
  honeyType: string
  jars: number
  kg: number
  runs: number
}

/**
 * §32's honey warehouse, for the half of it that is already in jars.
 *
 * lib/production.ts's honeyStock() answers "how much bulk honey is left in the barrels"; this
 * answers "how much is on the shelf in jars". They are two different piles and the warehouse
 * screen shows both, because after a packaging run the bulk figure drops and the honey has not
 * left the building.
 */
export async function jarStock(farmId: string): Promise<JarStockRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.honey_type,
            SUM(p.remaining_count)                    AS jars,
            SUM(p.remaining_count * p.jar_size_g)/1000 AS kg,
            COUNT(*)                                  AS runs
       FROM packaging_batches p
       JOIN honey_batches b ON b.id = p.batch_id
      WHERE p.farm_id = ? AND p.deleted_at IS NULL AND p.remaining_count > 0
      GROUP BY b.honey_type
      ORDER BY kg DESC`,
    [farmId],
  )
  return rows.map((row) => ({
    honeyType: row.honey_type as string,
    jars: Number(row.jars ?? 0),
    kg: Number(row.kg ?? 0),
    runs: Number(row.runs),
  }))
}

export interface SellableRun {
  id: string
  lotCode: string
  honeyType: string
  productId: string | null
  productName: string | null
  jarSizeG: number
  jarCount: number
  soldCount: number
  remainingCount: number
  packagedOn: string | null
  bestBefore: string | null
}

/** The packaging runs a sale can still draw jars from — what the §37 form offers. */
export async function sellableRuns(farmId: string): Promise<SellableRun[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, p.jar_size_g, p.jar_count, p.sold_count, p.remaining_count, p.packaged_on,
            p.best_before, p.product_id, pr.name AS product_name, b.lot_code, b.honey_type
       FROM packaging_batches p
       JOIN honey_batches b ON b.id = p.batch_id
       LEFT JOIN products pr ON pr.id = p.product_id
      WHERE p.farm_id = ? AND p.deleted_at IS NULL AND p.remaining_count > 0
      ORDER BY p.packaged_on DESC`,
    [farmId],
  )
  return rows.map((row) => ({
    id: row.id as string,
    lotCode: row.lot_code as string,
    honeyType: row.honey_type as string,
    productId: (row.product_id as string | null) ?? null,
    productName: (row.product_name as string | null) ?? null,
    jarSizeG: Number(row.jar_size_g),
    jarCount: Number(row.jar_count),
    soldCount: Number(row.sold_count),
    remainingCount: Number(row.remaining_count),
    packagedOn: asDate(row.packaged_on),
    bestBefore: asDate(row.best_before),
  }))
}

// ─────────────────────────────────────────────────── §20 — the pasture list the form suggests

/**
 * §20's eleven species, offered as suggestions rather than stored as rows.
 *
 * They are botany, not regulation: they do not change, an administrator has no reason to edit
 * them, and a beekeeper on a pasture this list forgot must still be able to type it. harvests
 * .pasture has been free text since Etapa 3 for the same reason, and the two have to agree for
 * §20's derived yield to find anything.
 */
export const PASTURE_SUGGESTIONS = [
  'Bagrem',
  'Kadulja',
  'Kesten',
  'Lipa',
  'Suncokret',
  'Lavanda',
  'Amorfa',
  'Vrijesak',
  'Vrisak',
  'Medun',
  'Cvjetna paša',
] as const

// ─────────────────────────────────────────────────── §39 — expense categories

export const EXPENSE_CATEGORIES = [
  'sugar',
  'medicine',
  'fuel',
  'packaging',
  'foundation',
  'queens',
  'hives',
  'equipment',
  'transport',
  'laboratory',
  'membership',
  'labour',
  'other',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Server-side too, because §49's printed report and §53's notifications need the same words. */
export const EXPENSE_LABELS: Record<ExpenseCategory, string> = {
  sugar: 'Šećer',
  medicine: 'Lijekovi',
  fuel: 'Gorivo',
  packaging: 'Ambalaža',
  foundation: 'Satne osnove',
  queens: 'Matice',
  hives: 'Košnice',
  equipment: 'Oprema',
  transport: 'Prijevoz',
  laboratory: 'Laboratorij',
  membership: 'Članarine',
  labour: 'Radnici',
  other: 'Ostalo',
}

// ─────────────────────────────────────────────────── §40 — apiary economics

export interface ApiaryEconomics {
  apiaryId: string | null
  apiaryName: string
  revenue: number
  /**
   * Revenue from honey alone. Separate from `revenue` because a wax or nucleus sale is real income
   * with no kilograms behind it, and dividing the whole turnover by the honey sold produces an
   * average price the beekeeper never charged — 189 € over 5,4 kg reads as 35 €/kg for honey that
   * went out at 26,67.
   */
  honeyRevenue: number
  expenses: number
  profit: number
  producedKg: number
  soldKg: number
  colonies: number
  /** §40 "Prosjek 21,8 kg/košnici" — null when the apiary has no colonies to divide by. */
  kgPerColony: number | null
  /** §40 "Trošak 4,05 €/kg" — cost of what was produced, not of what was sold. */
  costPerKg: number | null
  /** §40 "Prosječna prodajna cijena 9,90 €/kg" — honey revenue over kilograms of honey sold. */
  pricePerKg: number | null
}

const ratio = (a: number, b: number): number | null => (b > 0 ? Number((a / b).toFixed(2)) : null)

/**
 * §40's dashboard, per apiary and as a farm total.
 *
 * Three sums that each pick their own date column, because they describe different events: a sale
 * is dated when the money changed hands, an expense when it was paid, production when the honey
 * was extracted. Forcing them onto one date would make a jar extracted in June and sold in
 * December disappear from both years.
 *
 * Anything that cannot be attributed to an apiary — a wax sale, a farm-wide insurance premium — is
 * returned under apiaryId: null rather than divided across the apiaries. An invented allocation
 * reads exactly like a measurement, and this screen is where a beekeeper decides whether an apiary
 * is worth keeping.
 */
export async function apiaryEconomics(farmId: string, year: number): Promise<ApiaryEconomics[]> {
  const [apiaries] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.name,
            (SELECT COUNT(*) FROM colonies c JOIN hives h ON h.id = c.hive_id
              WHERE h.apiary_id = a.id AND c.ended_on IS NULL) AS colonies
       FROM apiaries a WHERE a.farm_id = ? AND a.deleted_at IS NULL ORDER BY a.name`,
    [farmId],
  )

  const [revenue] = await pool.query<RowDataPacket[]>(
    `SELECT ${SALE_APIARY} AS apiary_id,
            SUM(si.line_total)                                            AS revenue,
            SUM(CASE WHEN si.kind IN ('jars','bulk') THEN si.line_total ELSE 0 END) AS honey_revenue,
            SUM(${SALE_HONEY_KG})                                         AS sold_kg
       FROM sale_items si
       ${SALE_CHAIN_JOIN}
      WHERE s.farm_id = ? AND YEAR(s.sold_on) = ?
      GROUP BY ${SALE_APIARY}`,
    [farmId, year],
  )

  const [costs] = await pool.query<RowDataPacket[]>(
    `SELECT apiary_id, SUM(amount) AS total
       FROM expenses
      WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(spent_on) = ?
      GROUP BY apiary_id`,
    [farmId, year],
  )

  const [produced] = await pool.query<RowDataPacket[]>(
    `SELECT h.apiary_id, SUM(b.total_kg) AS kg
       FROM honey_batches b
       JOIN harvests h ON h.id = b.harvest_id AND h.deleted_at IS NULL
      WHERE b.farm_id = ? AND b.deleted_at IS NULL AND YEAR(h.harvested_on) = ?
      GROUP BY h.apiary_id`,
    [farmId, year],
  )

  const num = (rows: RowDataPacket[], key: string, id: string | null, column: string) =>
    Number(rows.find((r) => (r[key] ?? null) === id)?.[column] ?? 0)

  const build = (id: string | null, name: string, colonies: number): ApiaryEconomics => {
    const rev = num(revenue, 'apiary_id', id, 'revenue')
    const honeyRev = num(revenue, 'apiary_id', id, 'honey_revenue')
    const exp = num(costs, 'apiary_id', id, 'total')
    const producedKg = num(produced, 'apiary_id', id, 'kg')
    const soldKg = num(revenue, 'apiary_id', id, 'sold_kg')
    return {
      apiaryId: id,
      apiaryName: name,
      revenue: Number(rev.toFixed(2)),
      honeyRevenue: Number(honeyRev.toFixed(2)),
      expenses: Number(exp.toFixed(2)),
      profit: Number((rev - exp).toFixed(2)),
      producedKg: Number(producedKg.toFixed(2)),
      soldKg: Number(soldKg.toFixed(2)),
      colonies,
      kgPerColony: ratio(producedKg, colonies),
      costPerKg: ratio(exp, producedKg),
      pricePerKg: ratio(honeyRev, soldKg),
    }
  }

  const rows = apiaries.map((a) => build(a.id as string, a.name as string, Number(a.colonies)))

  const unallocated = build(null, 'Neraspoređeno', 0)
  if (unallocated.revenue !== 0 || unallocated.expenses !== 0 || unallocated.producedKg !== 0) {
    rows.push(unallocated)
  }
  return rows
}

// ─────────────────────────────────────────────────── §41 — hive productivity

export interface HiveYield {
  hiveId: string
  code: string
  apiaryName: string | null
  kg: number
  harvests: number
  queenCode: string | null
  queenLine: string | null
  queenYear: number | null
}

/**
 * §41's ranking — and the most important caveat in this file.
 *
 * A harvest records kilograms once, for the whole extraction, and links to the hives it came from.
 * Nothing weighs a single hive. So a hive's figure here is the harvest total divided evenly across
 * the hives that fed it: an ESTIMATE, and the screens that show it say so in those words.
 *
 * The alternative — presenting it as measured — would let a beekeeper requeen B007 on the strength
 * of a number that only says "B007 was in a harvest with eleven other hives". The division is
 * still worth doing, because across a season a hive that is never in a good harvest does stand
 * out; it is the precision that would be false, not the signal.
 */
export async function hiveYields(farmId: string, year: number): Promise<HiveYield[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT hv.id            AS hive_id,
            hv.code,
            a.name           AS apiary_name,
            SUM(b.total_kg / hc.cnt) AS kg,
            COUNT(DISTINCT h.id)     AS harvests,
            q.code AS queen_code, q.line AS queen_line, q.year AS queen_year
       FROM harvest_hives hh
       JOIN harvests h      ON h.id = hh.harvest_id AND h.deleted_at IS NULL
       JOIN honey_batches b ON b.harvest_id = h.id  AND b.deleted_at IS NULL
       JOIN (SELECT harvest_id, COUNT(*) AS cnt FROM harvest_hives GROUP BY harvest_id) hc
              ON hc.harvest_id = h.id
       JOIN hives hv        ON hv.id = hh.hive_id AND hv.deleted_at IS NULL
       LEFT JOIN apiaries a ON a.id = hv.apiary_id
       LEFT JOIN colonies c ON c.hive_id = hv.id AND c.ended_on IS NULL
       LEFT JOIN queens q   ON q.id = c.queen_id
      WHERE h.farm_id = ? AND YEAR(h.harvested_on) = ?
      GROUP BY hv.id, hv.code, a.name, q.code, q.line, q.year
      ORDER BY kg DESC`,
    [farmId, year],
  )

  return rows.map((row) => ({
    hiveId: row.hive_id as string,
    code: row.code as string,
    apiaryName: (row.apiary_name as string | null) ?? null,
    kg: Number(Number(row.kg).toFixed(1)),
    harvests: Number(row.harvests),
    queenCode: (row.queen_code as string | null) ?? null,
    queenLine: (row.queen_line as string | null) ?? null,
    queenYear: asNumber(row.queen_year),
  }))
}

export interface QueenLineStat {
  line: string
  hives: number
  averageKg: number
  /** §42 "17 % veći prosječni prinos od prosjeka pčelinjaka". Null when there is no farm average. */
  differencePercent: number | null
}

/**
 * §42 — the same estimate as §41, grouped by the queen's line.
 *
 * Only lines with at least two hives are returned. A single hive is an anecdote, and labelling one
 * "23 % above average" is the kind of number that gets acted on and should not be.
 */
export function queenLineStats(yields: HiveYield[]): QueenLineStat[] {
  const rated = yields.filter((y) => y.queenLine)
  if (rated.length === 0) return []

  const farmAverage = yields.reduce((sum, y) => sum + y.kg, 0) / yields.length
  const byLine = new Map<string, number[]>()
  for (const y of rated) {
    const list = byLine.get(y.queenLine!) ?? []
    list.push(y.kg)
    byLine.set(y.queenLine!, list)
  }

  return [...byLine.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([line, list]) => {
      const average = list.reduce((a, b) => a + b, 0) / list.length
      return {
        line,
        hives: list.length,
        averageKg: Number(average.toFixed(1)),
        differencePercent:
          farmAverage > 0 ? Number((((average - farmAverage) / farmAverage) * 100).toFixed(0)) : null,
      }
    })
    .sort((a, b) => b.averageKg - a.averageKg)
}

// ─────────────────────────────────────────────────── §43 — colony losses

export interface WinterLosses {
  season: string
  preparedOn: string
  checkedOn: string
  prepared: number
  survived: number
  lost: number
  lossPercent: number | null
  reasons: { reason: string; count: number }[]
}

/**
 * §43's "Zima 2025./2026. — pripremljeno 128, proljeće 119, gubitak 7,0 %".
 *
 * Derived from colonies.started_on / ended_on / end_reason, all of which Etapa 1 already records,
 * so §43 needed no table of its own. The two dates are the convention a beekeeper actually uses:
 * what went into winter on 1 October, what was still alive on 1 April.
 *
 * A colony that was merged or sold over winter is counted as lost from the wintering set, because
 * it is not there in spring — but it appears under its own reason, so a 7 % "loss" that is really
 * two sales is readable as such rather than looking like dead bees.
 */
export async function winterLosses(farmId: string, startYear: number): Promise<WinterLosses> {
  const preparedOn = `${startYear}-10-01`
  const checkedOn = `${startYear + 1}-04-01`

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS prepared,
            SUM(ended_on IS NULL OR ended_on > ?) AS survived
       FROM colonies
      WHERE farm_id = ? AND started_on <= ? AND (ended_on IS NULL OR ended_on > ?)`,
    [checkedOn, farmId, preparedOn, preparedOn],
  )

  const [reasonRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(end_reason, 'unknown') AS reason, COUNT(*) AS total
       FROM colonies
      WHERE farm_id = ? AND ended_on > ? AND ended_on <= ?
      GROUP BY COALESCE(end_reason, 'unknown')
      ORDER BY total DESC`,
    [farmId, preparedOn, checkedOn],
  )

  const prepared = Number(rows[0]?.prepared ?? 0)
  const survived = Number(rows[0]?.survived ?? 0)
  const lost = prepared - survived

  return {
    season: `${startYear}./${startYear + 1}.`,
    preparedOn,
    checkedOn,
    prepared,
    survived,
    lost,
    lossPercent: prepared > 0 ? Number(((lost / prepared) * 100).toFixed(1)) : null,
    reasons: reasonRows.map((r) => ({ reason: r.reason as string, count: Number(r.total) })),
  }
}

export const LOSS_REASON_LABELS: Record<string, string> = {
  winter_loss: 'Zimski gubitak',
  swarmed: 'Rojenje',
  disease: 'Bolest',
  poisoning: 'Trovanje',
  weakened: 'Slabljenje',
  queenless: 'Gubitak matice',
  merged: 'Spojeno s drugom zajednicom',
  sold: 'Prodano',
  unknown: 'Nepoznat uzrok',
}

// ─────────────────────────────────────────────────── §20 — actual yield, derived

/**
 * A pasture's realised yield: the harvests that happened on its apiary, under its name, inside its
 * dates. Not stored — see the note on the `pastures` table in 006_commerce.sql.
 *
 * Matching on the pasture name is deliberately forgiving (case-insensitive, trimmed) because
 * harvests.pasture is free text typed in the field. An unmatched harvest shows up as zero here and
 * still appears in full under Vrcanja, which is the safe direction for the mistake to fall.
 */
export async function pastureYields(farmId: string): Promise<Map<string, { kg: number; harvests: number }>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ps.id,
            COALESCE(SUM(b.total_kg), 0) AS kg,
            COUNT(DISTINCT h.id)         AS harvests
       FROM pastures ps
       LEFT JOIN harvests h
              ON h.farm_id = ps.farm_id
             AND h.deleted_at IS NULL
             AND (ps.apiary_id IS NULL OR h.apiary_id = ps.apiary_id)
             AND LOWER(TRIM(h.pasture)) = LOWER(TRIM(ps.name))
             AND (ps.starts_on IS NULL OR h.harvested_on >= ps.starts_on)
             AND (ps.ends_on   IS NULL OR h.harvested_on <= ps.ends_on)
             AND YEAR(h.harvested_on) = ps.season_year
       LEFT JOIN honey_batches b ON b.harvest_id = h.id AND b.deleted_at IS NULL
      WHERE ps.farm_id = ? AND ps.deleted_at IS NULL
      GROUP BY ps.id`,
    [farmId],
  )
  return new Map(
    rows.map((r) => [r.id as string, { kg: Number(r.kg ?? 0), harvests: Number(r.harvests) }]),
  )
}
