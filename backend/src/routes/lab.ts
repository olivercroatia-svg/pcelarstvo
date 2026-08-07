import { Router } from 'express'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { assertFarmReference } from '../lib/ownership.js'
import {
  buildReadings,
  loadLabParameters,
  overallVerdict,
  type LabReading,
} from '../lib/production.js'
import { asDate, changedColumns, nullableDate, nullableText } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §31 — laboratory analyses.
 *
 * What this module does NOT do, stated plainly: it does not read the PDF. §31 describes AI
 * extracting the values from the uploaded finding, and that is Etapa 5 together with the other OCR
 * flows (§18, §39). Until then the beekeeper types the seven numbers and attaches the document,
 * which is the same record — just entered by hand.
 *
 * And the line the scenario itself insists on: "Napomena u aplikaciji mora jasno navoditi da
 * automatska analiza ne zamjenjuje službeni laboratorijski nalaz." Every response carries the
 * criteria it judged against, so the screen can say what it compared and against what.
 */
export const labRouter = Router()
labRouter.use(requireFarm)

interface TestPayload {
  id: string
  batchId: string
  lotCode: string | null
  laboratory: string | null
  reportNumber: string | null
  sampledOn: string | null
  testedOn: string | null
  documentId: string | null
  notes: string | null
  readings: LabReading[]
  verdict: ReturnType<typeof overallVerdict>
  createdAt: string
}

function mapTest(row: RowDataPacket, readings: LabReading[]): TestPayload {
  return {
    id: row.id as string,
    batchId: row.batch_id as string,
    lotCode: (row.lot_code as string | null) ?? null,
    laboratory: (row.laboratory as string | null) ?? null,
    reportNumber: (row.report_number as string | null) ?? null,
    sampledOn: asDate(row.sampled_on),
    testedOn: asDate(row.tested_on),
    documentId: (row.document_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    readings,
    verdict: overallVerdict(readings),
    createdAt: (row.created_at as Date).toISOString(),
  }
}

const TEST_SELECT = `
  SELECT t.*, b.lot_code
    FROM laboratory_tests t
    JOIN honey_batches b ON b.id = t.batch_id
`

/** Loads the measured values for a set of tests in one query rather than one per test. */
async function readingsFor(testIds: string[]): Promise<Map<string, LabReading[]>> {
  const result = new Map<string, LabReading[]>()
  if (testIds.length === 0) return result

  const parameters = await loadLabParameters(true)
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT test_id, parameter_code, value FROM laboratory_values WHERE test_id IN (?)',
    [testIds],
  )

  const byTest = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const testId = row.test_id as string
    if (!byTest.has(testId)) byTest.set(testId, new Map())
    byTest.get(testId)!.set(row.parameter_code as string, Number(row.value))
  }

  for (const id of testIds) {
    result.set(id, buildReadings(parameters, byTest.get(id) ?? new Map()))
  }
  return result
}

/**
 * The criteria themselves, so a screen can show what a number will be judged against before the
 * beekeeper has typed it. Read-only here — editing lives in /api/admin (§54).
 */
labRouter.get(
  '/parameters',
  asyncHandler(async (_req, res) => {
    res.json({ parameters: await loadLabParameters() })
  }),
)

labRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z.object({ batchId: z.string().trim().min(1).optional() }).parse(req.query)

    const filters = ['t.farm_id = ?', 't.deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.batchId) {
      filters.push('t.batch_id = ?')
      params.push(query.batchId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `${TEST_SELECT} WHERE ${filters.join(' AND ')} ORDER BY COALESCE(t.tested_on, t.created_at) DESC`,
      params,
    )
    const readings = await readingsFor(rows.map((r) => r.id as string))

    res.json({ tests: rows.map((row) => mapTest(row, readings.get(row.id as string) ?? [])) })
  }),
)

async function loadTest(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${TEST_SELECT} WHERE t.id = ? AND t.farm_id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Laboratorijski nalaz nije pronađen')
  return row
}

labRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await loadTest(req.farm!.id, req.params.id)
    const readings = await readingsFor([row.id as string])
    res.json({ test: mapTest(row, readings.get(row.id as string) ?? []) })
  }),
)

const testFields = {
  batchId: z.string().trim().min(1, 'Odaberite seriju meda'),
  laboratory: nullableText(200),
  reportNumber: nullableText(120),
  sampledOn: nullableDate,
  testedOn: nullableDate,
  documentId: nullableText(36),
  notes: nullableText(2000),
}

const COLUMNS: Record<string, string> = {
  batchId: 'batch_id',
  laboratory: 'laboratory',
  reportNumber: 'report_number',
  sampledOn: 'sampled_on',
  testedOn: 'tested_on',
  documentId: 'document_id',
  notes: 'notes',
}

/**
 * Values arrive keyed by parameter code. Codes the administrator has not defined are dropped
 * rather than rejected — a client sending a stale code should not lose the six readings that were
 * fine, and a silently ignored key is visible in the response, which echoes back what it stored.
 */
const valuesSchema = z.record(z.string().trim().max(40), z.coerce.number().min(-1000).max(1000000))

/**
 * The codes are read by the caller, before it opens its transaction, and never from in here.
 * `loadLabParameters` goes to the pool, and a pool query issued while a transaction holds one of
 * the ten connections queues behind all ten: ten concurrent lab writes would each wait for an
 * eleventh connection that cannot exist, and nothing in the process — not this route, not any
 * other — would ever answer again.
 */
async function knownParameterCodes(): Promise<Set<string>> {
  const parameters = await loadLabParameters(true)
  return new Set(parameters.map((p) => p.code))
}

async function writeValues(
  conn: PoolConnection,
  testId: string,
  values: Record<string, number>,
  known: Set<string>,
): Promise<void> {
  const rows = Object.entries(values)
    .filter(([code]) => known.has(code))
    .map(([code, value]) => [testId, code, value])
  if (rows.length === 0) return
  await conn.query('INSERT INTO laboratory_values (test_id, parameter_code, value) VALUES ?', [rows])
}

/**
 * Only for an edit, and deliberately not reused on create.
 *
 * The primary key is (test_id, parameter_code), so deleting by a test_id that has no rows still
 * takes a gap lock on the clustered index — and gap locks do not exclude one another while the
 * insert intent that follows does. Several reports filed at once would each hold a gap the others
 * needed, and InnoDB would break the tie by killing all but one with a deadlock the beekeeper
 * reads as "greška na poslužitelju". A freshly generated test id cannot have values yet, so on
 * create there is nothing to delete and no gap to lock.
 */
async function replaceValues(
  conn: PoolConnection,
  testId: string,
  values: Record<string, number>,
  known: Set<string>,
): Promise<void> {
  await conn.query('DELETE FROM laboratory_values WHERE test_id = ?', [testId])
  await writeValues(conn, testId, values, known)
}

labRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const data = z.object({ ...testFields, values: valuesSchema.default({}) }).parse(req.body)

    const [batches] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM honey_batches WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [data.batchId, farmId],
    )
    if (batches.length === 0) throw notFound('Serija meda nije pronađena')
    await assertFarmReference(pool, 'document', data.documentId, farmId)

    const { values, ...fields } = data
    const id = newId()
    const { names, values: columnValues } = changedColumns(fields, COLUMNS)

    const known = await knownParameterCodes()

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(
        `INSERT INTO laboratory_tests (id, farm_id, created_by, ${names.join(', ')})
         VALUES (?, ?, ?, ${names.map(() => '?').join(', ')})`,
        [id, farmId, req.user!.id, ...columnValues],
      )
      await writeValues(conn, id, values, known)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const row = await loadTest(farmId, id)
    const readings = await readingsFor([id])
    const test = mapTest(row, readings.get(id) ?? [])

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'lab_test.create',
      entityType: 'laboratory_test',
      entityId: id,
      after: { batchId: data.batchId, laboratory: data.laboratory, verdict: test.verdict },
    })

    res.status(201).json({ test })
  }),
)

labRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadTest(farmId, req.params.id)

    const data = z
      .object({ ...testFields, batchId: testFields.batchId.optional(), values: valuesSchema.optional() })
      .parse(req.body)
    await assertFarmReference(pool, 'batch', data.batchId, farmId)
    await assertFarmReference(pool, 'document', data.documentId, farmId)

    const { values, ...fields } = data
    const { names, values: columnValues } = changedColumns(fields, COLUMNS)
    const known = values ? await knownParameterCodes() : new Set<string>()

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [lockedRows] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM laboratory_tests WHERE id = ? AND farm_id = ? AND deleted_at IS NULL FOR UPDATE',
        [before.id, farmId],
      )
      if (lockedRows.length === 0) throw notFound('Laboratorijski nalaz nije pronađen')
      if (names.length > 0) {
        await conn.query(
          `UPDATE laboratory_tests SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
          [...columnValues, before.id, farmId],
        )
      }
      if (values) await replaceValues(conn, before.id as string, values, known)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const after = await loadTest(farmId, before.id as string)
    const readings = await readingsFor([after.id as string])
    const test = mapTest(after, readings.get(after.id as string) ?? [])

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'lab_test.update',
      entityType: 'laboratory_test',
      entityId: before.id as string,
      after: { verdict: test.verdict },
    })
    res.json({ test })
  }),
)

labRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Nalaz može obrisati samo vlasnik')
    const farmId = req.farm!.id
    const before = await loadTest(farmId, req.params.id)

    await pool.query('UPDATE laboratory_tests SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'lab_test.delete',
      entityType: 'laboratory_test',
      entityId: before.id as string,
      before: { laboratory: before.laboratory, reportNumber: before.report_number },
    })
    res.status(204).end()
  }),
)
