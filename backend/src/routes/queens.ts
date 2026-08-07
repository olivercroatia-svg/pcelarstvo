import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { requireFarm } from '../middleware/farm.js'

export const queensRouter = Router()
queensRouter.use(requireFarm)

export type MarkingColor = 'white' | 'yellow' | 'red' | 'green' | 'blue'

/**
 * The international queen-marking cycle: years ending 1/6 white, 2/7 yellow, 3/8 red, 4/9 green,
 * 5/0 blue (§14). Only a suggestion — the stored colour is whatever is actually on the bee, since
 * a queen may have been marked off-cycle or bought already marked.
 */
export function suggestedMarkingColor(year: number): MarkingColor {
  return (['blue', 'white', 'yellow', 'red', 'green'] as const)[year % 5]
}

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))

const nullableDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan datum')
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => (v === undefined ? undefined : v || null))

const rating = z.coerce
  .number()
  .int()
  .min(1)
  .max(5)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v ?? null))

const asDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null))

function mapQueen(row: RowDataPacket) {
  const year = row.year === null || row.year === undefined ? null : Number(row.year)
  return {
    id: row.id as string,
    code: row.code as string,
    year,
    markingColor: (row.marking_color as MarkingColor | null) ?? null,
    origin: (row.origin as string | null) ?? null,
    breeder: (row.breeder as string | null) ?? null,
    line: (row.line as string | null) ?? null,
    introducedOn: asDate(row.introduced_on),
    matedOn: asDate(row.mated_on),
    ratingProductivity: row.rating_productivity === null ? null : Number(row.rating_productivity),
    ratingCalmness: row.rating_calmness === null ? null : Number(row.rating_calmness),
    ratingSwarming: row.rating_swarming === null ? null : Number(row.rating_swarming),
    status: row.status as string,
    notes: (row.notes as string | null) ?? null,
    hive: row.hive_id ? { id: row.hive_id as string, code: row.hive_code as string } : null,
    // §14 flags queens due for replacement; two seasons is the usual threshold.
    ageYears: year === null ? null : new Date().getFullYear() - year,
  }
}

const QUEEN_SELECT = `
  SELECT q.*, h.id AS hive_id, h.code AS hive_code
    FROM queens q
    LEFT JOIN colonies c ON c.queen_id = q.id AND c.ended_on IS NULL
    LEFT JOIN hives h ON h.id = c.hive_id AND h.deleted_at IS NULL
`

queensRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `${QUEEN_SELECT} WHERE q.farm_id = ? AND q.deleted_at IS NULL ORDER BY q.year DESC, q.code`,
      [req.farm!.id],
    )
    res.json({
      queens: rows.map(mapQueen),
      suggestedColor: suggestedMarkingColor(new Date().getFullYear()),
    })
  }),
)

async function loadQueen(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${QUEEN_SELECT} WHERE q.id = ? AND q.farm_id = ? AND q.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Matica nije pronađena')
  return row
}

queensRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ queen: mapQueen(await loadQueen(req.farm!.id, req.params.id)) })
  }),
)

const queenFields = {
  code: z.string().trim().min(1, 'Unesite oznaku matice').max(60),
  year: z.coerce.number().int().min(1990).max(2100).nullish().transform((v) => (v === undefined ? undefined : v ?? null)),
  markingColor: z.enum(['white', 'yellow', 'red', 'green', 'blue']).nullish(),
  origin: nullableText(200),
  breeder: nullableText(200),
  line: nullableText(120),
  introducedOn: nullableDate,
  matedOn: nullableDate,
  ratingProductivity: rating,
  ratingCalmness: rating,
  ratingSwarming: rating,
  status: z.enum(['good', 'watch', 'replace']),
  notes: nullableText(4000),
}

const COLUMNS: Record<string, string> = {
  code: 'code',
  year: 'year',
  markingColor: 'marking_color',
  origin: 'origin',
  breeder: 'breeder',
  line: 'line',
  introducedOn: 'introduced_on',
  matedOn: 'mated_on',
  ratingProductivity: 'rating_productivity',
  ratingCalmness: 'rating_calmness',
  ratingSwarming: 'rating_swarming',
  status: 'status',
  notes: 'notes',
}

const createSchema = z.object({ ...queenFields, status: queenFields.status.default('good') })
const updateSchema = z.object({
  ...queenFields,
  code: queenFields.code.optional(),
  status: queenFields.status.optional(),
})

queensRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = createSchema.parse(req.body)
    const id = newId()

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    try {
      await pool.query(
        `INSERT INTO queens (id, farm_id, ${entries.map(([k]) => COLUMNS[k]).join(', ')})
         VALUES (?, ?, ${entries.map(() => '?').join(', ')})`,
        [id, farmId, ...entries.map(([, v]) => v)],
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw conflict(`Matica s oznakom ${data.code} već postoji`, 'code_taken')
      }
      throw err
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'queen.create',
      entityType: 'queen',
      entityId: id,
      after: data,
    })

    res.status(201).json({ queen: mapQueen(await loadQueen(farmId, id)) })
  }),
)

queensRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadQueen(farmId, req.params.id)
    const data = updateSchema.parse(req.body)

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    if (entries.length > 0) {
      await pool.query(
        `UPDATE queens SET ${entries.map(([k]) => `${COLUMNS[k]} = ?`).join(', ')}
          WHERE id = ? AND farm_id = ?`,
        [...entries.map(([, v]) => v), before.id, farmId],
      )
    }

    const after = await loadQueen(farmId, before.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'queen.update',
      entityType: 'queen',
      entityId: before.id,
      before: mapQueen(before),
      after: mapQueen(after),
    })

    res.json({ queen: mapQueen(after) })
  }),
)
