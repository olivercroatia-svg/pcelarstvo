import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { mapRule } from '../lib/obligations.js'
import { runReminderSweep } from '../lib/scheduler.js'
import { asDate, changedColumns, nullableDate, nullableInt, nullableText } from '../lib/schema.js'
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

// ═══════════════════════════════════════════════ §31 — laboratory criteria
//
// Same reasoning as the obligations above, applied to the Honey Directive: the thresholds a
// laboratory result is judged against are a table, not a constant. §31's own wording — "Parametri
// odgovaraju **unesenim** kriterijima" — is what this router edits.

function mapParameter(row: RowDataPacket) {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    unit: (row.unit as string | null) ?? null,
    minValue: row.min_value === null ? null : Number(row.min_value),
    maxValue: row.max_value === null ? null : Number(row.max_value),
    note: (row.note as string | null) ?? null,
    decimals: Number(row.decimals),
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
  }
}

adminRouter.get(
  '/lab-parameters',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM lab_parameters ORDER BY sort_order, name')
    // How many recorded readings would be re-judged by an edit — the number an administrator
    // wants in front of them before moving a limit.
    const [usage] = await pool.query<RowDataPacket[]>(
      'SELECT parameter_code, COUNT(*) AS readings FROM laboratory_values GROUP BY parameter_code',
    )
    const counts = new Map(usage.map((r) => [r.parameter_code as string, Number(r.readings)]))
    res.json({
      parameters: rows.map((row) => ({
        ...mapParameter(row),
        readingCount: counts.get(row.code as string) ?? 0,
      })),
    })
  }),
)

const LIMIT = z.coerce
  .number()
  .min(-1000)
  .max(1000000)
  .nullish()
  .transform((v) => (v === undefined ? undefined : (v ?? null)))

const parameterFields = {
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'Dozvoljena su mala slova, brojke i podvlaka'),
  name: z.string().trim().min(2, 'Unesite naziv parametra').max(120),
  unit: nullableText(30),
  minValue: LIMIT,
  maxValue: LIMIT,
  note: nullableText(255),
  decimals: z.coerce.number().int().min(0).max(4).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}

const PARAMETER_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  unit: 'unit',
  minValue: 'min_value',
  maxValue: 'max_value',
  note: 'note',
  decimals: 'decimals',
  sortOrder: 'sort_order',
  active: 'active',
}

/** A minimum above a maximum would mark every possible reading as a failure. */
function assertRange(min: number | null | undefined, max: number | null | undefined): void {
  if (min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    throw conflict('Najmanja vrijednost ne može biti veća od najveće', 'range')
  }
}

adminRouter.post(
  '/lab-parameters',
  asyncHandler(async (req, res) => {
    const data = z.object(parameterFields).parse(req.body)
    assertRange(data.minValue, data.maxValue)

    const [clash] = await pool.query<RowDataPacket[]>('SELECT id FROM lab_parameters WHERE code = ? LIMIT 1', [
      data.code,
    ])
    if (clash.length > 0) throw conflict('Parametar s ovom šifrom već postoji', 'duplicate_code')

    const id = newId()
    const { names, values } = changedColumns(data, PARAMETER_COLUMNS)
    await pool.query(
      `INSERT INTO lab_parameters (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`,
      [id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'lab_parameter.create',
      entityType: 'lab_parameter',
      entityId: id,
      after: data,
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM lab_parameters WHERE id = ?', [id])
    res.status(201).json({ parameter: mapParameter(rows[0]!) })
  }),
)

adminRouter.patch(
  '/lab-parameters/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT * FROM lab_parameters WHERE id = ? LIMIT 1', [
      req.params.id,
    ])
    const before = existing[0]
    if (!before) throw notFound('Parametar nije pronađen')

    const data = z
      .object({ ...parameterFields, code: parameterFields.code.optional(), name: parameterFields.name.optional() })
      .parse(req.body)

    // Compared against the stored values, not only against each other: sending just a new minimum
    // must still be checked against the maximum already on the row.
    assertRange(
      data.minValue === undefined ? (before.min_value === null ? null : Number(before.min_value)) : data.minValue,
      data.maxValue === undefined ? (before.max_value === null ? null : Number(before.max_value)) : data.maxValue,
    )

    const { names, values } = changedColumns(data, PARAMETER_COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE lab_parameters SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
        [...values, before.id],
      )
    }

    // Existing laboratory_values are untouched. Verdicts are computed at read time, so every
    // recorded finding is re-judged against the new limit the next time it is opened — which is
    // the intended behaviour here and the opposite of the obligations rule above, because a
    // laboratory card is informational and an issued obligation is a record of what was filed.
    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM lab_parameters WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'lab_parameter.update',
      entityType: 'lab_parameter',
      entityId: before.id as string,
      before: mapParameter(before),
      after: mapParameter(after[0]!),
    })
    res.json({ parameter: mapParameter(after[0]!) })
  }),
)

// ═══════════════════════════════════════════════ §34 — declaration text blocks
//
// Edit only. The set of blocks is fixed by what the declaration renders, so an administrator who
// could add a ninth block would be adding text nothing prints.

adminRouter.get(
  '/declaration-texts',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM declaration_texts ORDER BY sort_order')
    res.json({
      texts: rows.map((row) => ({
        id: row.id as string,
        code: row.code as string,
        label: row.label as string,
        body: (row.body as string | null) ?? '',
        hint: (row.hint as string | null) ?? null,
      })),
    })
  }),
)

adminRouter.patch(
  '/declaration-texts/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT * FROM declaration_texts WHERE id = ? LIMIT 1', [
      req.params.id,
    ])
    const before = existing[0]
    if (!before) throw notFound('Tekst nije pronađen')

    const data = z.object({ body: z.string().trim().max(4000) }).parse(req.body)
    await pool.query('UPDATE declaration_texts SET body = ? WHERE id = ?', [data.body || null, before.id])

    await writeAudit(req, {
      userId: req.user!.id,
      action: 'declaration_text.update',
      entityType: 'declaration_text',
      entityId: before.id as string,
      before: { body: before.body },
      after: { body: data.body },
    })

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM declaration_texts WHERE id = ?', [before.id])
    res.json({
      text: {
        id: after[0]!.id as string,
        code: after[0]!.code as string,
        label: after[0]!.label as string,
        body: (after[0]!.body as string | null) ?? '',
        hint: (after[0]!.hint as string | null) ?? null,
      },
    })
  }),
)

// ═══════════════════════════════════════════════ §19 — the seasonal calendar
//
// Full CRUD, unlike the declaration blocks above. §19 says the activities "mogu se razlikovati
// prema regiji, tipu pčelarenja, nadmorskoj visini" — the set is open by definition, so an
// administrator who could only edit the seeded rows would be stuck the first time a region needs
// its own task.

const SEASON_REGIONS = ['all', 'continental', 'coastal', 'mountain'] as const
const SEASON_KINDS = ['all', 'stationary', 'migratory'] as const

function mapSeasonTask(row: RowDataPacket) {
  return {
    id: row.id as string,
    month: Number(row.month),
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    region: row.region as (typeof SEASON_REGIONS)[number],
    apiaryKind: row.apiary_kind as (typeof SEASON_KINDS)[number],
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
  }
}

const seasonFields = {
  month: z.coerce.number().int().min(1).max(12),
  title: z.string().trim().min(2, 'Unesite naziv posla').max(200),
  detail: nullableText(500),
  region: z.enum(SEASON_REGIONS).default('all'),
  apiaryKind: z.enum(SEASON_KINDS).default('all'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
}

const SEASON_COLUMNS: Record<string, string> = {
  month: 'month',
  title: 'title',
  detail: 'detail',
  region: 'region',
  apiaryKind: 'apiary_kind',
  sortOrder: 'sort_order',
}

adminRouter.get(
  '/season-tasks',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM season_tasks ORDER BY month, sort_order, title')
    res.json({ tasks: rows.map(mapSeasonTask) })
  }),
)

adminRouter.post(
  '/season-tasks',
  asyncHandler(async (req, res) => {
    const data = z.object(seasonFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, SEASON_COLUMNS)

    await pool.query(
      `INSERT INTO season_tasks (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`,
      [id, ...values],
    )
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'season_task.create',
      entityType: 'season_task',
      entityId: id,
      after: data,
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM season_tasks WHERE id = ?', [id])
    res.status(201).json({ task: mapSeasonTask(rows[0]!) })
  }),
)

adminRouter.patch(
  '/season-tasks/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT * FROM season_tasks WHERE id = ? LIMIT 1', [
      req.params.id,
    ])
    const before = existing[0]
    if (!before) throw notFound('Posao nije pronađen')

    const data = z
      .object({
        ...seasonFields,
        month: seasonFields.month.optional(),
        title: seasonFields.title.optional(),
        region: z.enum(SEASON_REGIONS).optional(),
        apiaryKind: z.enum(SEASON_KINDS).optional(),
        sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)

    const { active, ...fields } = data
    const { names, values } = changedColumns(fields, SEASON_COLUMNS)
    if (active !== undefined) {
      names.push('active')
      values.push(active)
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE season_tasks SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
        [...values, before.id],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM season_tasks WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'season_task.update',
      entityType: 'season_task',
      entityId: before.id as string,
      before: mapSeasonTask(before),
      after: mapSeasonTask(after[0]!),
    })
    res.json({ task: mapSeasonTask(after[0]!) })
  }),
)

adminRouter.delete(
  '/season-tasks/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT id, title FROM season_tasks WHERE id = ?', [
      req.params.id,
    ])
    if (rows.length === 0) throw notFound('Posao nije pronađen')

    // Hard delete, unlike an obligation. A calendar entry is advice, not a record of anything that
    // was filed, so nothing downstream references it.
    await pool.query('DELETE FROM season_tasks WHERE id = ?', [req.params.id])
    await writeAudit(req, {
      userId: req.user!.id,
      action: 'season_task.delete',
      entityType: 'season_task',
      entityId: req.params.id,
      before: { title: rows[0]!.title },
    })
    res.status(204).end()
  }),
)

// ═══════════════════════════════════════════════ §50 — subsidy programmes
//
// "Aplikacija prati natječaje i intervencije koje administrator unese u sustav." Nothing is
// seeded: an invented call for applications would be exactly the automatic guarantee of
// entitlement §50 forbids. Everything a farm sees under Potpore was typed here first.

const PROGRAM_APPLIES = ['all', 'registered_epp', 'migratory', 'honey_producer', 'food_business'] as const

function mapProgram(row: RowDataPacket, requirements: RowDataPacket[]) {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    authority: (row.authority as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    year: row.year === null ? null : Number(row.year),
    opensOn: asDate(row.opens_on),
    closesOn: asDate(row.closes_on),
    url: (row.url as string | null) ?? null,
    appliesTo: row.applies_to as (typeof PROGRAM_APPLIES)[number],
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    requirements: requirements
      .filter((r) => r.program_id === row.id)
      .map((r) => ({
        id: r.id as string,
        label: r.label as string,
        documentCategory: (r.document_category as string | null) ?? null,
        required: Boolean(r.required),
        sortOrder: Number(r.sort_order),
      })),
  }
}

const programFields = {
  code: z.string().trim().min(2).max(60),
  name: z.string().trim().min(2, 'Unesite naziv natječaja').max(200),
  authority: nullableText(200),
  description: nullableText(4000),
  year: nullableInt(2000, 2100),
  opensOn: nullableDate,
  closesOn: nullableDate,
  url: nullableText(255),
  appliesTo: z.enum(PROGRAM_APPLIES).default('all'),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
}

const PROGRAM_COLUMNS: Record<string, string> = {
  code: 'code',
  name: 'name',
  authority: 'authority',
  description: 'description',
  year: 'year',
  opensOn: 'opens_on',
  closesOn: 'closes_on',
  url: 'url',
  appliesTo: 'applies_to',
  sortOrder: 'sort_order',
}

async function loadProgramsAdmin(programId?: string) {
  const [programs] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM subsidy_programs ${programId ? 'WHERE id = ?' : ''} ORDER BY sort_order, name`,
    programId ? [programId] : [],
  )
  if (programs.length === 0) return []
  const [requirements] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM subsidy_requirements WHERE program_id IN (?) ORDER BY sort_order, label',
    [programs.map((p) => p.id as string)],
  )
  return programs.map((p) => mapProgram(p, requirements))
}

adminRouter.get(
  '/subsidy-programs',
  asyncHandler(async (_req, res) => {
    const [usage] = await pool.query<RowDataPacket[]>(
      'SELECT program_id, COUNT(*) AS applications FROM subsidy_applications WHERE deleted_at IS NULL GROUP BY program_id',
    )
    const counts = new Map(usage.map((r) => [r.program_id as string, Number(r.applications)]))
    const programs = await loadProgramsAdmin()
    res.json({
      programs: programs.map((p) => ({ ...p, applicationCount: counts.get(p.id) ?? 0 })),
    })
  }),
)

adminRouter.post(
  '/subsidy-programs',
  asyncHandler(async (req, res) => {
    const data = z.object(programFields).parse(req.body)
    const id = newId()
    const { names, values } = changedColumns(data, PROGRAM_COLUMNS)

    try {
      await pool.query(
        `INSERT INTO subsidy_programs (id, ${names.join(', ')}) VALUES (?, ${names.map(() => '?').join(', ')})`,
        [id, ...values],
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw conflict('Natječaj s tom oznakom već postoji', 'duplicate_code')
      }
      throw err
    }

    await writeAudit(req, {
      userId: req.user!.id,
      action: 'subsidy_program.create',
      entityType: 'subsidy_program',
      entityId: id,
      after: { code: data.code, name: data.name },
    })
    res.status(201).json({ program: (await loadProgramsAdmin(id))[0] })
  }),
)

adminRouter.patch(
  '/subsidy-programs/:id',
  asyncHandler(async (req, res) => {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT * FROM subsidy_programs WHERE id = ? LIMIT 1', [
      req.params.id,
    ])
    const before = existing[0]
    if (!before) throw notFound('Natječaj nije pronađen')

    const data = z
      .object({
        ...programFields,
        code: programFields.code.optional(),
        name: programFields.name.optional(),
        appliesTo: z.enum(PROGRAM_APPLIES).optional(),
        sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
        active: z.boolean().optional(),
      })
      .parse(req.body)

    const { active, ...fields } = data
    const { names, values } = changedColumns(fields, PROGRAM_COLUMNS)
    if (active !== undefined) {
      names.push('active')
      values.push(active)
    }
    if (names.length > 0) {
      await pool.query(
        `UPDATE subsidy_programs SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ?`,
        [...values, before.id],
      )
    }

    await writeAudit(req, {
      userId: req.user!.id,
      action: 'subsidy_program.update',
      entityType: 'subsidy_program',
      entityId: before.id as string,
      before: { name: before.name, active: Boolean(before.active) },
      after: { name: data.name ?? before.name, active: active ?? Boolean(before.active) },
    })
    res.json({ program: (await loadProgramsAdmin(before.id as string))[0] })
  }),
)

adminRouter.post(
  '/subsidy-programs/:id/requirements',
  asyncHandler(async (req, res) => {
    const [program] = await pool.query<RowDataPacket[]>('SELECT id FROM subsidy_programs WHERE id = ?', [
      req.params.id,
    ])
    if (program.length === 0) throw notFound('Natječaj nije pronađen')

    const data = z
      .object({
        label: z.string().trim().min(2, 'Unesite naziv stavke').max(200),
        documentCategory: nullableText(60),
        required: z.boolean().default(true),
        sortOrder: z.coerce.number().int().min(0).max(9999).default(100),
      })
      .parse(req.body)

    const id = newId()
    await pool.query(
      `INSERT INTO subsidy_requirements (id, program_id, label, document_category, required, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, data.label, data.documentCategory ?? null, data.required, data.sortOrder],
    )
    res.status(201).json({ program: (await loadProgramsAdmin(req.params.id))[0] })
  }),
)

adminRouter.delete(
  '/subsidy-requirements/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, program_id FROM subsidy_requirements WHERE id = ?',
      [req.params.id],
    )
    if (rows.length === 0) throw notFound('Stavka nije pronađena')

    // The attachments go with it — a document filed against a requirement that no longer exists
    // would keep counting toward a percentage with nothing behind it.
    await pool.query('DELETE FROM subsidy_application_documents WHERE requirement_id = ?', [req.params.id])
    await pool.query('DELETE FROM subsidy_requirements WHERE id = ?', [req.params.id])
    res.status(204).end()
  }),
)
