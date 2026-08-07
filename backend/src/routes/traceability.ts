import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { buildReadings, loadLabParameters, overallVerdict, withdrawalConflicts } from '../lib/production.js'
import { asDate, asNumber } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §30 the traceability chain, and §35 the public page a customer reaches by scanning a jar.
 *
 * The two live in one file on purpose. They answer the same question about the same jar and differ
 * only in who is asking, and keeping them side by side makes the difference between the two
 * queries impossible to miss when either is edited.
 */

// ════════════════════════════════════════════════════════ §30 — the owner's chain

export const traceabilityRouter = Router()
traceabilityRouter.use(requireFarm)

/**
 * Accepts either the LOT code printed on the jar or the batch id.
 *
 * The LOT code is what a customer reads out over the phone, and that is the whole use case §30
 * describes — "Kupac ima staklenku: LOT KAD-260524-01. Pčelar može odmah vidjeti…".
 */
traceabilityRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const key = req.params.key

    const [batches] = await pool.query<RowDataPacket[]>(
      `SELECT b.*, h.id AS harvest_id, h.harvested_on, h.pasture, h.hive_range, h.frames_count,
              h.apiary_id, a.name AS apiary_name
         FROM honey_batches b
         JOIN harvests h ON h.id = b.harvest_id
         JOIN apiaries a ON a.id = h.apiary_id
        WHERE b.farm_id = ? AND b.deleted_at IS NULL AND (b.lot_code = ? OR b.id = ?)
        LIMIT 1`,
      [farmId, key, key],
    )
    const batch = batches[0]
    if (!batch) throw notFound('Serija meda nije pronađena')

    const harvestId = batch.harvest_id as string
    const apiaryId = batch.apiary_id as string
    const harvestedOn = asDate(batch.harvested_on)!

    // ── hives, and the queen heading each one (§67: KOŠNICA → MATICA) ──
    const [hives] = await pool.query<RowDataPacket[]>(
      `SELECT hv.id, hv.code, q.code AS queen_code, q.year AS queen_year, q.line AS queen_line
         FROM harvest_hives hh
         JOIN hives hv ON hv.id = hh.hive_id
         LEFT JOIN colonies c ON c.hive_id = hv.id AND c.ended_on IS NULL
         LEFT JOIN queens q ON q.id = c.queen_id AND q.deleted_at IS NULL
        WHERE hh.harvest_id = ?
        ORDER BY hv.code`,
      [harvestId],
    )
    const hiveIds = hives.map((h) => h.id as string)

    // ── treatments those hives received in the year before extraction ──
    // Scoped to the hives rather than the apiary: a treatment applied to twelve colonies at the
    // other end of the yard did not touch this honey, and saying it did would make the chain
    // useless for exactly the case it exists for.
    const [treatments] = hiveIds.length
      ? await pool.query<RowDataPacket[]>(
          `SELECT DISTINCT t.id, t.product_name, t.active_substance, t.lot_number,
                  t.started_on, t.ended_on, t.withdrawal_until
             FROM veterinary_treatments t
             JOIN treatment_hives th ON th.treatment_id = t.id
            WHERE t.farm_id = ? AND t.deleted_at IS NULL
              AND th.hive_id IN (?)
              AND t.started_on BETWEEN DATE_SUB(?, INTERVAL 365 DAY) AND ?
            ORDER BY t.started_on DESC`,
          [farmId, hiveIds, harvestedOn, harvestedOn],
        )
      : [[] as RowDataPacket[]]

    // ── laboratory ──
    const [tests] = await pool.query<RowDataPacket[]>(
      `SELECT id, laboratory, report_number, tested_on, document_id
         FROM laboratory_tests WHERE batch_id = ? AND deleted_at IS NULL
        ORDER BY COALESCE(tested_on, created_at) DESC`,
      [batch.id],
    )
    const parameters = await loadLabParameters(true)
    const testIds = tests.map((t) => t.id as string)
    const [labValues] = testIds.length
      ? await pool.query<RowDataPacket[]>(
          'SELECT test_id, parameter_code, value FROM laboratory_values WHERE test_id IN (?)',
          [testIds],
        )
      : [[] as RowDataPacket[]]

    // ── packaging, and the jars that came out of it ──
    const [packaging] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.packaged_on, p.jar_size_g, p.jar_count, p.total_kg, p.is_national,
              p.serial_from, p.serial_to, p.public_token, pr.name AS product_name
         FROM packaging_batches p
         LEFT JOIN products pr ON pr.id = p.product_id
        WHERE p.batch_id = ? AND p.deleted_at IS NULL
        ORDER BY p.packaged_on DESC`,
      [batch.id],
    )

    const [containers] = await pool.query<RowDataPacket[]>(
      'SELECT name, amount_kg FROM harvest_containers WHERE harvest_id = ? ORDER BY name',
      [harvestId],
    )

    res.json({
      batch: {
        id: batch.id as string,
        lotCode: batch.lot_code as string,
        honeyType: batch.honey_type as string,
        totalKg: Number(batch.total_kg),
        packedKg: Number(batch.packed_kg),
        availableKg: Number(batch.available_kg),
        moisturePercent: asNumber(batch.moisture_percent),
        status: batch.status as string,
        bestBefore: asDate(batch.best_before),
      },
      harvest: {
        id: harvestId,
        harvestedOn,
        pasture: batch.pasture as string,
        hiveRange: (batch.hive_range as string | null) ?? null,
        framesCount: asNumber(batch.frames_count),
        containers: containers.map((c) => ({ name: c.name as string, amountKg: Number(c.amount_kg) })),
      },
      apiary: { id: apiaryId, name: batch.apiary_name as string },
      hives: hives.map((h) => ({
        id: h.id as string,
        code: h.code as string,
        queenCode: (h.queen_code as string | null) ?? null,
        queenYear: asNumber(h.queen_year),
        queenLine: (h.queen_line as string | null) ?? null,
      })),
      treatments: treatments.map((t) => ({
        id: t.id as string,
        productName: t.product_name as string,
        activeSubstance: (t.active_substance as string | null) ?? null,
        lotNumber: (t.lot_number as string | null) ?? null,
        startedOn: asDate(t.started_on),
        endedOn: asDate(t.ended_on),
        withdrawalUntil: asDate(t.withdrawal_until),
      })),
      // §67 again — the chain is where a withdrawal breach is most visible, because the treatment
      // and the extraction are finally on the same screen.
      withdrawalConflicts: await withdrawalConflicts(farmId, apiaryId, harvestedOn),
      labTests: tests.map((t) => {
        const values = new Map(
          labValues
            .filter((v) => v.test_id === t.id)
            .map((v) => [v.parameter_code as string, Number(v.value)]),
        )
        const readings = buildReadings(parameters, values)
        return {
          id: t.id as string,
          laboratory: (t.laboratory as string | null) ?? null,
          reportNumber: (t.report_number as string | null) ?? null,
          testedOn: asDate(t.tested_on),
          documentId: (t.document_id as string | null) ?? null,
          verdict: overallVerdict(readings),
          readings,
        }
      }),
      packaging: packaging.map((p) => ({
        id: p.id as string,
        packagedOn: asDate(p.packaged_on),
        productName: (p.product_name as string | null) ?? null,
        jarSizeG: Number(p.jar_size_g),
        jarCount: Number(p.jar_count),
        totalKg: Number(p.total_kg),
        isNational: Boolean(p.is_national),
        serialFrom: (p.serial_from as string | null) ?? null,
        serialTo: (p.serial_to as string | null) ?? null,
        published: Boolean(p.public_token),
        publicToken: (p.public_token as string | null) ?? null,
      })),
      // §30's last link. Sales arrive with §37 in Etapa 4; the field is present and empty rather
      // than absent so the screen does not have to guess whether it is missing or unbuilt.
      sales: [],
    })
  }),
)

// ════════════════════════════════════════════════════════ §35 — the public jar page

export const publicRouter = Router()

/**
 * Tighter than the global ceiling. This is the only route in the application reachable without a
 * session, so it is also the only one where a stranger sets the request rate.
 */
publicRouter.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
)

/**
 * §35 — everything a customer holding the jar may see, and nothing else.
 *
 * The guarantee is the SELECT list below, not the page that renders it. Read it as the security
 * boundary it is:
 *
 *   included — honey type, LOT, harvest year, pasture, the holding's trading name, the town,
 *              whether a laboratory analysis exists
 *   excluded — GPS coordinates, street address, OIB, EPP number, hive codes, quantities in
 *              kilograms, prices, customers, laboratory values, every other apiary
 *
 * §56 is the reason the exclusions are enforced here rather than by omitting them from the JSX: a
 * field that never leaves the database cannot be leaked by a later change to a component. The name
 * and town are the two identifiers §35 shows, and they are already printed on the jar's
 * declaration by law — the page reveals nothing the customer is not physically holding.
 */
publicRouter.get(
  '/jar/:token',
  asyncHandler(async (req, res) => {
    const token = String(req.params.token)
    // A malformed token is answered exactly like an unknown one: no hint about which part failed.
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(token)) throw notFound('Stranica nije pronađena')

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT b.lot_code, b.honey_type,
              h.harvested_on, h.pasture,
              f.name AS farm_name, f.city,
              CONCAT(u.first_name, ' ', u.last_name) AS owner_name,
              pr.name AS product_name, p.jar_size_g, p.is_national,
              EXISTS (SELECT 1 FROM laboratory_tests lt
                       WHERE lt.batch_id = b.id AND lt.deleted_at IS NULL) AS has_lab
         FROM packaging_batches p
         JOIN honey_batches b ON b.id = p.batch_id
         JOIN harvests h      ON h.id = b.harvest_id
         JOIN farms f         ON f.id = p.farm_id
         JOIN users u         ON u.id = f.owner_user_id
         LEFT JOIN products pr ON pr.id = p.product_id
        WHERE p.public_token = ?
          AND p.deleted_at IS NULL
          AND b.deleted_at IS NULL
          AND f.deleted_at IS NULL
        LIMIT 1`,
      [token],
    )
    const row = rows[0]
    if (!row) throw notFound('Stranica nije pronađena')

    const harvestedOn = asDate(row.harvested_on)

    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json({
      jar: {
        productName: (row.product_name as string | null) ?? (row.honey_type as string),
        honeyType: row.honey_type as string,
        // Trading name where there is one, the beekeeper's own name otherwise.
        //
        // The fallback is a deliberate call, not an oversight: §35 requires a "Pčelar" line, a
        // beekeeper registered as an individual has no trading name to put there, and the producer
        // is named on the jar's declaration by law anyway (§34). Publishing is opt-in per packaging
        // run, so nothing reaches this route the owner did not choose to publish. What stays behind
        // regardless is the address, the OIB and the EPP number.
        producer: (row.farm_name as string | null) || (row.owner_name as string),
        place: (row.city as string | null) ?? null,
        harvestYear: harvestedOn ? Number(harvestedOn.slice(0, 4)) : null,
        pasture: row.pasture as string,
        lotCode: row.lot_code as string,
        // §35 says only whether it was done. The values themselves stay with the beekeeper.
        laboratoryChecked: Boolean(Number(row.has_lab)),
        netWeightG: Number(row.jar_size_g),
        isNational: Boolean(row.is_national),
      },
    })
  }),
)
