import { Router } from 'express'
import type { RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { loadFarmFacts, type FarmFacts } from '../lib/obligations.js'
import { asDate, asNumber, changedColumns, nullableDate, nullableDecimal, nullableText } from '../lib/schema.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

/**
 * §50 — potpore.
 *
 * Owner-only: an application carries the amount requested and the amount granted, which is
 * financial data under §4.
 *
 * The whole module is built around one sentence from the scenario — "Aplikacija ne smije
 * automatski jamčiti pravo na potporu". So:
 *
 *   - Programmes are entered by an administrator, never inferred. Nothing is seeded; a fabricated
 *     call for applications would be exactly the false promise §50 forbids.
 *   - A programme is labelled "potencijalno prihvatljivo", and only ever that. The eligibility
 *     test is the same coarse applies_to filter §54 uses for legal obligations, and it decides
 *     what to show, not what the beekeeper is entitled to.
 *   - The documentation percentage counts attached required documents. It says the folder is
 *     complete; it does not say the application will succeed.
 */
export const subsidiesRouter = Router()
subsidiesRouter.use(requireFarm, requireOwner)

const APPLIES = ['all', 'registered_epp', 'migratory', 'honey_producer', 'food_business'] as const
const STATUSES = ['considering', 'preparing', 'submitted', 'approved', 'rejected', 'withdrawn'] as const

/**
 * Mirrors ruleApplies() in lib/obligations.ts. Kept as its own function rather than imported
 * because it takes a programme, not an obligation rule; the two would have to be forced into one
 * shape to share code, and the vocabulary is the part worth sharing.
 */
function programApplies(appliesTo: string, facts: FarmFacts): boolean {
  switch (appliesTo) {
    case 'all':
      return true
    case 'registered_epp':
      return facts.hasEpp
    case 'migratory':
      return facts.hasMigratory
    case 'honey_producer':
      return facts.colonyCount > 0
    case 'food_business':
      return facts.hasFoodSafetyDocs
    default:
      return false
  }
}

interface Requirement {
  id: string
  label: string
  documentCategory: string | null
  required: boolean
  documentId: string | null
  documentTitle: string | null
}

function mapProgram(
  row: RowDataPacket,
  requirements: Requirement[],
  application: RowDataPacket | undefined,
  eligible: boolean,
) {
  const required = requirements.filter((r) => r.required)
  const attached = required.filter((r) => r.documentId !== null)
  const today = new Date().toISOString().slice(0, 10)
  const closesOn = asDate(row.closes_on)

  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    authority: (row.authority as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    year: asNumber(row.year),
    opensOn: asDate(row.opens_on),
    closesOn,
    url: (row.url as string | null) ?? null,
    appliesTo: row.applies_to as string,
    /** §50 "Potencijalno prihvatljivo" — a filter for the list, never a promise. */
    eligible,
    closed: closesOn !== null && closesOn < today,
    requirements,
    /** §50 "Status dokumentacije: 85 %" */
    documentPercent: required.length > 0 ? Math.round((attached.length / required.length) * 100) : null,
    missing: required.filter((r) => r.documentId === null).map((r) => r.label),
    application: application
      ? {
          id: application.id as string,
          status: application.status as (typeof STATUSES)[number],
          submittedOn: asDate(application.submitted_on),
          decisionOn: asDate(application.decision_on),
          amountRequested: asNumber(application.amount_requested),
          amountApproved: asNumber(application.amount_approved),
          notes: (application.notes as string | null) ?? null,
        }
      : null,
  }
}

async function loadPrograms(farmId: string, programId?: string) {
  const [programs] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM subsidy_programs WHERE active = TRUE ${programId ? 'AND id = ?' : ''}
      ORDER BY sort_order, closes_on IS NULL, closes_on, name`,
    programId ? [programId] : [],
  )
  if (programs.length === 0) return []

  const ids = programs.map((p) => p.id as string)
  const [requirements] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM subsidy_requirements WHERE program_id IN (?) ORDER BY sort_order, label',
    [ids],
  )
  const [applications] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM subsidy_applications WHERE farm_id = ? AND deleted_at IS NULL AND program_id IN (?)',
    [farmId, ids],
  )
  const [attachments] = await pool.query<RowDataPacket[]>(
    `SELECT ad.application_id, ad.requirement_id, ad.document_id, d.title
       FROM subsidy_application_documents ad
       JOIN subsidy_applications a ON a.id = ad.application_id
       LEFT JOIN documents d ON d.id = ad.document_id
      WHERE a.farm_id = ? AND a.deleted_at IS NULL`,
    [farmId],
  )

  const facts = await loadFarmFacts(farmId)

  return programs.map((program) => {
    const application = applications.find((a) => a.program_id === program.id)
    const rows = requirements
      .filter((r) => r.program_id === program.id)
      .map((r): Requirement => {
        const attachment = attachments.find(
          (a) => a.requirement_id === r.id && a.application_id === application?.id,
        )
        return {
          id: r.id as string,
          label: r.label as string,
          documentCategory: (r.document_category as string | null) ?? null,
          required: Boolean(r.required),
          documentId: (attachment?.document_id as string | null) ?? null,
          documentTitle: (attachment?.title as string | null) ?? null,
        }
      })
    return mapProgram(program, rows, application, programApplies(program.applies_to as string, facts))
  })
}

subsidiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const programs = await loadPrograms(req.farm!.id)
    res.json({
      programs,
      eligibleCount: programs.filter((p) => p.eligible && !p.closed).length,
      activeCount: programs.filter((p) => p.application !== null).length,
    })
  }),
)

subsidiesRouter.get(
  '/:programId',
  asyncHandler(async (req, res) => {
    const [program] = await loadPrograms(req.farm!.id, req.params.programId)
    if (!program) throw notFound('Natječaj nije pronađen')

    // Offered for attaching: everything in the archive, newest first. Not narrowed to the
    // requirement's category — a receipt filed under 'other' should still be attachable, and a
    // filter that hides the document the beekeeper is looking at is worse than a longer list.
    const [documents] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, category, issued_on FROM documents
        WHERE farm_id = ? AND deleted_at IS NULL ORDER BY COALESCE(issued_on, created_at) DESC LIMIT 200`,
      [req.farm!.id],
    )

    res.json({
      program,
      documents: documents.map((d) => ({
        id: d.id as string,
        title: d.title as string,
        category: d.category as string,
        issuedOn: asDate(d.issued_on),
      })),
    })
  }),
)

/** Starting to track a programme. One application per farm per programme — the UNIQUE says so. */
subsidiesRouter.post(
  '/:programId/apply',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [programs] = await pool.query<RowDataPacket[]>(
      'SELECT id, name FROM subsidy_programs WHERE id = ? AND active = TRUE',
      [req.params.programId],
    )
    if (programs.length === 0) throw notFound('Natječaj nije pronađen')

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM subsidy_applications WHERE farm_id = ? AND program_id = ? AND deleted_at IS NULL',
      [farmId, req.params.programId],
    )
    if (existing.length > 0) {
      res.json({ applicationId: existing[0]!.id as string, created: false })
      return
    }

    const id = newId()
    await pool.query(
      `INSERT INTO subsidy_applications (id, farm_id, program_id, status, created_by)
       VALUES (?, ?, ?, 'preparing', ?)
       ON DUPLICATE KEY UPDATE deleted_at = NULL, status = 'preparing'`,
      [id, farmId, req.params.programId, req.user!.id],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'subsidy.apply',
      entityType: 'subsidy_application',
      entityId: id,
      after: { program: programs[0]!.name },
    })
    res.status(201).json({ applicationId: id, created: true })
  }),
)

async function loadApplication(farmId: string, id: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM subsidy_applications WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
    [id, farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Prijava nije pronađena')
  return row
}

const APPLICATION_COLUMNS: Record<string, string> = {
  status: 'status',
  submittedOn: 'submitted_on',
  decisionOn: 'decision_on',
  amountRequested: 'amount_requested',
  amountApproved: 'amount_approved',
  notes: 'notes',
}

subsidiesRouter.patch(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadApplication(farmId, req.params.id)
    const data = z
      .object({
        status: z.enum(STATUSES).optional(),
        submittedOn: nullableDate,
        decisionOn: nullableDate,
        amountRequested: nullableDecimal(0, 100000000),
        amountApproved: nullableDecimal(0, 100000000),
        notes: nullableText(2000),
      })
      .parse(req.body)

    const { names, values } = changedColumns(data, APPLICATION_COLUMNS)
    if (data.status === 'submitted' && data.submittedOn === undefined && !before.submitted_on) {
      names.push('submitted_on')
      values.push(new Date().toISOString().slice(0, 10))
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE subsidy_applications SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'subsidy.update',
      entityType: 'subsidy_application',
      entityId: before.id as string,
      before: { status: before.status },
      after: { status: data.status ?? before.status },
    })
    res.json({ ok: true })
  }),
)

/** Attaching a document to a requirement, or replacing the one already there. */
subsidiesRouter.put(
  '/applications/:id/documents/:requirementId',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const application = await loadApplication(farmId, req.params.id)
    const { documentId } = z.object({ documentId: z.string().trim().min(1) }).parse(req.body)

    const [document] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM documents WHERE id = ? AND farm_id = ? AND deleted_at IS NULL',
      [documentId, farmId],
    )
    if (document.length === 0) throw notFound('Dokument nije pronađen')

    const [requirement] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM subsidy_requirements WHERE id = ? AND program_id = ?',
      [req.params.requirementId, application.program_id],
    )
    if (requirement.length === 0) throw badRequest('Stavka ne pripada ovom natječaju')

    await pool.query(
      `INSERT INTO subsidy_application_documents (application_id, requirement_id, document_id)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE document_id = VALUES(document_id)`,
      [application.id, req.params.requirementId, documentId],
    )
    res.status(204).end()
  }),
)

subsidiesRouter.delete(
  '/applications/:id/documents/:requirementId',
  asyncHandler(async (req, res) => {
    const application = await loadApplication(req.farm!.id, req.params.id)
    await pool.query(
      'DELETE FROM subsidy_application_documents WHERE application_id = ? AND requirement_id = ?',
      [application.id, req.params.requirementId],
    )
    res.status(204).end()
  }),
)

subsidiesRouter.delete(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const before = await loadApplication(farmId, req.params.id)

    await pool.query('UPDATE subsidy_applications SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'subsidy.delete',
      entityType: 'subsidy_application',
      entityId: before.id as string,
    })
    res.status(204).end()
  }),
)

export { APPLIES as SUBSIDY_APPLIES, STATUSES as SUBSIDY_STATUSES }
