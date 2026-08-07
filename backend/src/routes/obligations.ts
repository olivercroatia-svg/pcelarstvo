import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, forbidden, notFound } from '../lib/http.js'
import {
  buildObligationCards,
  continuousState,
  deadlineState,
  mapRule,
  type ObligationCard,
} from '../lib/obligations.js'
import { asDate, nullableDate, nullableText } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

export const obligationsRouter = Router()
obligationsRouter.use(requireFarm)

/** §23 — "Moje obveze". */
obligationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const cards = await buildObligationCards(req.farm!.id)
    res.json({
      obligations: cards,
      summary: {
        overdue: cards.filter((c) => c.level === 'critical').length,
        dueSoon: cards.filter((c) => c.level === 'warning').length,
        ok: cards.filter((c) => c.level === 'ok').length,
      },
    })
  }),
)

/**
 * One card in full. Accepts either a user_obligations id (a dated instance) or a
 * legal_obligations id (a continuous register), because those are the two things the list shows
 * and the caller should not have to know which kind it tapped.
 */
async function loadCard(farmId: string, id: string): Promise<ObligationCard> {
  const [instances] = await pool.query<RowDataPacket[]>(
    `SELECT o.*,
            uo.id AS instance_id, uo.status AS instance_status, uo.period_year,
            uo.window_start, uo.due_on, uo.submitted_on, uo.reference_number,
            uo.document_id, uo.notes AS instance_notes
       FROM user_obligations uo
       JOIN legal_obligations o ON o.id = uo.obligation_id
      WHERE uo.id = ? AND uo.farm_id = ? LIMIT 1`,
    [id, farmId],
  )

  const row = instances[0]
  if (row) {
    const rule = mapRule(row)
    const dueOn = asDate(row.due_on)!
    const windowStart = asDate(row.window_start)
    const submittedOn = asDate(row.submitted_on)
    const state = deadlineState(dueOn, windowStart, row.instance_status as never, submittedOn)
    return {
      id: row.instance_id as string,
      ruleId: rule.id,
      code: rule.code,
      name: rule.name,
      kind: 'deadline',
      legalBasis: rule.legalBasis,
      description: rule.description,
      warningText: rule.warningText,
      formCode: rule.formCode,
      documentCategory: rule.documentCategory,
      requiredAttachments: rule.requiredAttachments,
      reminderDays: rule.reminderDays,
      level: state.level,
      statusLabel: state.label,
      status: row.instance_status as never,
      periodYear: Number(row.period_year),
      windowStart,
      dueOn,
      daysLeft: state.daysLeft,
      submittedOn,
      referenceNumber: (row.reference_number as string | null) ?? null,
      documentId: (row.document_id as string | null) ?? null,
      lastEntryOn: null,
    }
  }

  const [rules] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM legal_obligations WHERE id = ? AND kind = 'continuous' LIMIT 1",
    [id],
  )
  const ruleRow = rules[0]
  if (!ruleRow) throw notFound('Obveza nije pronađena')

  const rule = mapRule(ruleRow)
  const state = await continuousState(farmId, rule)
  return {
    id: rule.id,
    ruleId: rule.id,
    code: rule.code,
    name: rule.name,
    kind: 'continuous',
    legalBasis: rule.legalBasis,
    description: rule.description,
    warningText: rule.warningText,
    formCode: rule.formCode,
    documentCategory: rule.documentCategory,
    requiredAttachments: rule.requiredAttachments,
    reminderDays: [],
    level: state.level,
    statusLabel: state.label,
    status: null,
    periodYear: null,
    windowStart: null,
    dueOn: null,
    daysLeft: null,
    submittedOn: null,
    referenceNumber: null,
    documentId: null,
    lastEntryOn: state.lastEntryOn,
  }
}

obligationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ obligation: await loadCard(req.farm!.id, req.params.id) })
  }),
)

const updateSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'submitted', 'not_applicable']).optional(),
  submittedOn: nullableDate,
  referenceNumber: nullableText(150),
  documentId: z.string().trim().min(1).nullish(),
  notes: nullableText(2000),
})

/**
 * Marking an obligation as submitted is a statement about what was filed with an authority, so it
 * is the owner's to make — a worker records field work, not declarations (§4).
 */
obligationsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Status obveze može mijenjati samo vlasnik')
    const farmId = req.farm!.id
    const data = updateSchema.parse(req.body)

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM user_obligations WHERE id = ? AND farm_id = ? LIMIT 1',
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Obveza nije pronađena')

    if (data.documentId) {
      const [docs] = await pool.query<RowDataPacket[]>(
        'SELECT id FROM documents WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
        [data.documentId, farmId],
      )
      if (docs.length === 0) throw notFound('Dokument nije pronađen')
    }

    const columns: Record<string, string> = {
      status: 'status',
      submittedOn: 'submitted_on',
      referenceNumber: 'reference_number',
      documentId: 'document_id',
      notes: 'notes',
    }
    const entries = Object.entries(data).filter(([, v]) => v !== undefined)

    // Marking it submitted without saying when is the common case — default to today rather than
    // leaving the register unable to answer "when did you file it".
    if (data.status === 'submitted' && data.submittedOn === undefined && !before.submitted_on) {
      entries.push(['submittedOn', new Date().toISOString().slice(0, 10)])
    }

    if (entries.length > 0) {
      await pool.query(
        `UPDATE user_obligations SET ${entries.map(([k]) => `${columns[k]} = ?`).join(', ')}
          WHERE id = ? AND farm_id = ?`,
        [...entries.map(([, v]) => v), before.id, farmId],
      )
    }

    const card = await loadCard(farmId, before.id as string)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'obligation.update',
      entityType: 'user_obligation',
      entityId: before.id as string,
      before: { status: before.status, submittedOn: asDate(before.submitted_on) },
      after: { status: card.status, submittedOn: card.submittedOn },
    })

    res.json({ obligation: card })
  }),
)
