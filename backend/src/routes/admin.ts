import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { mapRule } from '../lib/obligations.js'
import { runReminderSweep } from '../lib/scheduler.js'
import { nullableDate, nullableInt, nullableText } from '../lib/schema.js'
import { requireAdmin } from '../middleware/auth.js'

/**
 * §54 — "Administracija propisa".
 *
 * This router is the whole point of the obligations architecture: a deadline moving from 1
 * December to 15 December is an edit here, not a release. Nothing else in the application is
 * allowed to know a date, an interval or a legal basis.
 */
export const adminRouter = Router()
adminRouter.use(requireAdmin)

adminRouter.get(
  '/obligations',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM legal_obligations ORDER BY sort_order, name',
    )
    // How many farms are currently carrying each rule — the number an administrator wants before
    // changing anything.
    const [usage] = await pool.query<RowDataPacket[]>(
      'SELECT obligation_id, COUNT(*) AS instances FROM user_obligations GROUP BY obligation_id',
    )
    const counts = new Map(usage.map((r) => [r.obligation_id as string, Number(r.instances)]))

    res.json({
      obligations: rows.map((row) => ({ ...mapRule(row), instanceCount: counts.get(row.id as string) ?? 0 })),
    })
  }),
)

const MONTH = z.coerce.number().int().min(1).max(12)
const DAY = z.coerce.number().int().min(1).max(31)

// Both list fields are stored as JSON text. Kept as a plain array schema plus an encoder so the
// create route can supply a default *before* the transform — .default() after .transform() would
// have to be a JSON string, which is not what a caller would ever pass.
const REMINDER_ARRAY = z.array(z.coerce.number().int().min(0).max(365)).max(12)
const ATTACHMENT_ARRAY = z.array(z.string().trim().min(1).max(200)).max(20)

const encodeReminders = (v: number[] | undefined) =>
  v === undefined ? undefined : JSON.stringify([...new Set(v)].sort((a, b) => b - a))
const encodeAttachments = (v: string[] | undefined) => (v === undefined ? undefined : JSON.stringify(v))

const ruleFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Dozvoljena su mala slova, brojke i podvlaka'),
  name: z.string().trim().min(3, 'Unesite naziv obveze').max(200),
  legalBasis: nullableText(300),
  description: nullableText(4000),
  warningText: nullableText(2000),
  kind: z.enum(['deadline', 'continuous']),
  recurrence: z.enum(['annual', 'once']),
  windowStartMonth: MONTH.nullish().transform((v) => (v === undefined ? undefined : (v ?? null))),
  windowStartDay: DAY.nullish().transform((v) => (v === undefined ? undefined : (v ?? null))),
  dueMonth: MONTH.nullish().transform((v) => (v === undefined ? undefined : (v ?? null))),
  dueDay: DAY.nullish().transform((v) => (v === undefined ? undefined : (v ?? null))),
  fixedDueOn: nullableDate,
  reminderDays: REMINDER_ARRAY.optional().transform(encodeReminders),
  continuousSource: z.enum(['vmp_treatments', 'varroa_checks', 'inspections', 'health_events']).nullish(),
  continuousMaxDays: nullableInt(1, 3650),
  appliesTo: z.enum(['all', 'registered_epp', 'migratory', 'honey_producer', 'food_business']),
  minColonies: nullableInt(0, 100000),
  formCode: nullableText(60),
  requiredAttachments: ATTACHMENT_ARRAY.optional().transform(encodeAttachments),
  documentCategory: nullableText(60),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
}

const COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  legalBasis: 'legal_basis',
  description: 'description',
  warningText: 'warning_text',
  kind: 'kind',
  recurrence: 'recurrence',
  windowStartMonth: 'window_start_month',
  windowStartDay: 'window_start_day',
  dueMonth: 'due_month',
  dueDay: 'due_day',
  fixedDueOn: 'fixed_due_on',
  reminderDays: 'reminder_days',
  continuousSource: 'continuous_source',
  continuousMaxDays: 'continuous_max_days',
  appliesTo: 'applies_to',
  minColonies: 'min_colonies',
  formCode: 'form_code',
  requiredAttachments: 'required_attachments',
  documentCategory: 'document_category',
  active: 'active',
  sortOrder: 'sort_order',
}

/**
 * A deadline rule without a date produces obligations that can never be resolved, and a
 * continuous rule without a source can never report a status. Checked here rather than left to
 * the engine, which would silently skip such a rule and leave the administrator wondering why
 * nothing appeared.
 */
function assertCoherent(data: Record<string, unknown>, existing?: RowDataPacket): void {
  const value = <T>(key: string, column: string): T | null | undefined =>
    (data[key] !== undefined ? data[key] : existing?.[column]) as T | null | undefined

  const kind = value<string>('kind', 'kind')
  if (kind === 'deadline') {
    const recurrence = value<string>('recurrence', 'recurrence') ?? 'annual'
    if (recurrence === 'annual' && (value('dueMonth', 'due_month') == null || value('dueDay', 'due_day') == null)) {
      throw conflict('Za godišnju obvezu unesite mjesec i dan roka', 'missing_due_date')
    }
    if (recurrence === 'once' && value('fixedDueOn', 'fixed_due_on') == null) {
      throw conflict('Za jednokratnu obvezu unesite točan datum roka', 'missing_due_date')
    }
  }
  if (kind === 'continuous' && value('continuousSource', 'continuous_source') == null) {
    throw conflict('Za trajnu evidenciju odaberite izvor podataka', 'missing_source')
  }
}

const createSchema = z.object({
  ...ruleFields,
  reminderDays: REMINDER_ARRAY.default([60, 30, 14, 7, 3, 0]).transform(encodeReminders),
  recurrence: ruleFields.recurrence.default('annual'),
  appliesTo: ruleFields.appliesTo.default('all'),
})

adminRouter.post(
  '/obligations',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body)
    assertCoherent(data)

    const id = newId()
    const entries = Object.entries(data).filter(([key, v]) => v !== undefined && COLUMNS[key])
    try {
      await pool.query(
        `INSERT INTO legal_obligations (id, ${entries.map(([k]) => COLUMNS[k]).join(', ')})
         VALUES (?, ${entries.map(() => '?').join(', ')})`,
        [id, ...entries.map(([, v]) => v)],
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw conflict(`Obveza s oznakom ${data.code} već postoji`, 'code_taken')
      }
      throw err
    }

    await writeAudit(req, {
      userId: req.user!.id,
      action: 'legal_obligation.create',
      entityType: 'legal_obligation',
      entityId: id,
      after: data,
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM legal_obligations WHERE id = ?', [id])
    res.status(201).json({ obligation: mapRule(rows[0]!) })
  }),
)

const updateSchema = z.object({
  ...ruleFields,
  code: ruleFields.code.optional(),
  name: ruleFields.name.optional(),
  kind: ruleFields.kind.optional(),
  recurrence: ruleFields.recurrence.optional(),
  appliesTo: ruleFields.appliesTo.optional(),
})

adminRouter.patch(
  '/obligations/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM legal_obligations WHERE id = ? LIMIT 1',
      [req.params.id],
    )
    const before = existing[0]
    if (!before) throw notFound('Obveza nije pronađena')

    const data = updateSchema.parse(req.body)
    assertCoherent(data, before)

    const entries = Object.entries(data).filter(([key, v]) => v !== undefined && COLUMNS[key])
    if (entries.length > 0) {
      await pool.query(
        `UPDATE legal_obligations SET ${entries.map(([k]) => `${COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
        [...entries.map(([, v]) => v), before.id],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM legal_obligations WHERE id = ?', [
      before.id,
    ])

    // Deliberately does NOT rewrite existing user_obligations rows. Those carry the date this farm
    // was told about, and a farm that already filed under the old deadline must keep its record
    // intact. New periods pick the change up on the next materialisation.
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'legal_obligation.update',
      entityType: 'legal_obligation',
      entityId: before.id as string,
      before: mapRule(before),
      after: mapRule(after[0]!),
    })

    res.json({ obligation: mapRule(after[0]!) })
  }),
)

/** Retires a rule instead of deleting it — existing instances stay readable in every farm's history. */
adminRouter.delete(
  '/obligations/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM legal_obligations WHERE id = ? LIMIT 1',
      [req.params.id],
    )
    const before = existing[0]
    if (!before) throw notFound('Obveza nije pronađena')

    await pool.query('UPDATE legal_obligations SET active = FALSE WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'legal_obligation.deactivate',
      entityType: 'legal_obligation',
      entityId: before.id as string,
      before: mapRule(before),
    })
    res.status(204).end()
  }),
)

/** Runs the §24 sweep now instead of waiting for the hourly tick — used when testing a new rule. */
adminRouter.post(
  '/reminders/run',
  asyncHandler(async (_req, res) => {
    res.json(await runReminderSweep())
  }),
)
