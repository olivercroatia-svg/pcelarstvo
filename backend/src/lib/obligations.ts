import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { newId } from './ids.js'
import { asDate } from './schema.js'

/**
 * §23 + §54 — the obligations engine.
 *
 * §54 is the constraint that shapes this whole file: "Zakonski rokovi i zahtjevi ne smiju biti
 * hard-coded". Nothing here knows the name of a single Croatian regulation. It reads rules out of
 * legal_obligations, decides which ones apply to a given farm, resolves them into dated instances
 * in user_obligations, and reports a status. Changing a deadline is an UPDATE, not a deploy.
 *
 * The only judgement calls baked into the code are the two urgency thresholds below, which are UI
 * colour, not law.
 */

/** Days remaining at which the card turns red, then orange. Presentation only (§55). */
const URGENT_DAYS = 14
const SOON_DAYS = 45

export type ObligationKind = 'deadline' | 'continuous'
export type ObligationLevel = 'ok' | 'caution' | 'warning' | 'critical' | 'info'
export type ObligationStatus = 'pending' | 'in_progress' | 'submitted' | 'not_applicable'

export interface ObligationRule {
  id: string
  code: string
  name: string
  legalBasis: string | null
  description: string | null
  warningText: string | null
  kind: ObligationKind
  recurrence: 'annual' | 'once'
  windowStartMonth: number | null
  windowStartDay: number | null
  dueMonth: number | null
  dueDay: number | null
  fixedDueOn: string | null
  reminderDays: number[]
  continuousSource: ContinuousSource | null
  continuousMaxDays: number | null
  appliesTo: 'all' | 'registered_epp' | 'migratory' | 'honey_producer' | 'food_business'
  minColonies: number | null
  formCode: string | null
  requiredAttachments: string[]
  documentCategory: string | null
  active: boolean
  sortOrder: number
}

export type ContinuousSource = 'vmp_treatments' | 'varroa_checks' | 'inspections' | 'health_events'

/**
 * Whitelist, never string interpolation from the request: `continuous_source` is an ENUM in the
 * database, but the table name still ends up inside a query and a whitelist keeps that provably
 * safe if the column is ever widened.
 */
const CONTINUOUS_SOURCES: Record<ContinuousSource, { table: string; column: string; extra: string }> = {
  vmp_treatments: { table: 'veterinary_treatments', column: 'started_on', extra: 'AND deleted_at IS NULL' },
  varroa_checks: { table: 'varroa_checks', column: 'checked_on', extra: 'AND deleted_at IS NULL' },
  inspections: { table: 'hive_inspections', column: 'inspected_at', extra: '' },
  health_events: { table: 'health_events', column: 'observed_on', extra: 'AND deleted_at IS NULL' },
}

const parseJsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function mapRule(row: RowDataPacket): ObligationRule {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    legalBasis: (row.legal_basis as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    warningText: (row.warning_text as string | null) ?? null,
    kind: row.kind as ObligationKind,
    recurrence: row.recurrence as 'annual' | 'once',
    windowStartMonth: num(row.window_start_month),
    windowStartDay: num(row.window_start_day),
    dueMonth: num(row.due_month),
    dueDay: num(row.due_day),
    fixedDueOn: asDate(row.fixed_due_on),
    reminderDays: parseJsonArray(row.reminder_days)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => b - a),
    continuousSource: (row.continuous_source as ContinuousSource | null) ?? null,
    continuousMaxDays: num(row.continuous_max_days),
    appliesTo: row.applies_to as ObligationRule['appliesTo'],
    minColonies: num(row.min_colonies),
    formCode: (row.form_code as string | null) ?? null,
    requiredAttachments: parseJsonArray(row.required_attachments).map(String),
    documentCategory: (row.document_category as string | null) ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
  }
}

// ────────────────────────────────────────────────────────────── applicability

export interface FarmFacts {
  hasEpp: boolean
  colonyCount: number
  hasMigratory: boolean
  hasFoodSafetyDocs: boolean
}

export async function loadFarmFacts(farmId: string): Promise<FarmFacts> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT epp_number FROM farms WHERE id = ?) AS epp,
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND ended_on IS NULL) AS colonies,
       (SELECT COUNT(*) FROM apiaries WHERE farm_id = ? AND kind = 'migratory' AND deleted_at IS NULL) AS migratory,
       (SELECT COUNT(*) FROM documents WHERE farm_id = ? AND category = 'food_safety' AND deleted_at IS NULL) AS food_docs`,
    [farmId, farmId, farmId, farmId],
  )
  const row = rows[0]!
  return {
    hasEpp: Boolean(row.epp && String(row.epp).trim().length > 0),
    colonyCount: Number(row.colonies),
    hasMigratory: Number(row.migratory) > 0,
    hasFoodSafetyDocs: Number(row.food_docs) > 0,
  }
}

export function ruleApplies(rule: ObligationRule, facts: FarmFacts): boolean {
  if (!rule.active) return false
  if (rule.minColonies !== null && facts.colonyCount < rule.minColonies) return false

  switch (rule.appliesTo) {
    case 'all':
      return true
    case 'registered_epp':
      return facts.hasEpp
    case 'migratory':
      return facts.hasMigratory
    // Stands in for "sells honey" until harvests exist (Etapa 3); anyone keeping colonies is
    // treated as a producer for now, which errs towards showing an obligation rather than hiding
    // one.
    case 'honey_producer':
      return facts.colonyCount > 0
    // A beekeeper who registered a food facility has that paperwork in the archive. A proxy, but a
    // self-correcting one: filing the document turns the obligation on.
    case 'food_business':
      return facts.hasFoodSafetyDocs
    default:
      return false
  }
}

// ────────────────────────────────────────────────────────────────── dates

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** Clamps 29–31 to the month's real length so a 31st-of-the-month rule survives February. */
function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, new Date(year, month, 0).getDate())
}

export function todayIso(): string {
  const now = new Date()
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function daysBetween(fromIso: string, toIso: string): number {
  // Parsed as UTC midnight on both sides, so the difference is whole days regardless of DST.
  const a = Date.parse(`${fromIso}T00:00:00Z`)
  const b = Date.parse(`${toIso}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export interface ResolvedDates {
  windowStart: string | null
  dueOn: string
}

export function resolveDates(rule: ObligationRule, year: number): ResolvedDates | null {
  if (rule.kind !== 'deadline') return null

  if (rule.recurrence === 'once') {
    if (!rule.fixedDueOn) return null
    return { windowStart: null, dueOn: rule.fixedDueOn }
  }

  if (rule.dueMonth === null || rule.dueDay === null) return null
  const dueOn = iso(year, rule.dueMonth, clampDay(year, rule.dueMonth, rule.dueDay))

  let windowStart: string | null = null
  if (rule.windowStartMonth !== null && rule.windowStartDay !== null) {
    windowStart = iso(year, rule.windowStartMonth, clampDay(year, rule.windowStartMonth, rule.windowStartDay))
    // A window that opens after its own deadline belongs to the previous year — e.g. filing opens
    // 1 November and closes 28 February.
    if (windowStart > dueOn) {
      windowStart = iso(year - 1, rule.windowStartMonth, clampDay(year - 1, rule.windowStartMonth, rule.windowStartDay))
    }
  }

  return { windowStart, dueOn }
}

// ───────────────────────────────────────────────────────────── materialise

/**
 * Ensures this farm has a row for every applicable deadline rule, for the current period and —
 * once the current one has passed — the next.
 *
 * Safe to call as often as you like: the (farm_id, obligation_id, period_year) unique key turns a
 * second run into a no-op instead of a duplicate.
 */
export async function materialiseObligations(farmId: string): Promise<void> {
  const [ruleRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM legal_obligations WHERE active = TRUE AND kind = 'deadline'",
  )
  if (ruleRows.length === 0) return

  const facts = await loadFarmFacts(farmId)
  const today = todayIso()
  const currentYear = new Date().getFullYear()
  const pending: unknown[][] = []

  for (const row of ruleRows) {
    const rule = mapRule(row)
    if (!ruleApplies(rule, facts)) continue

    const years = [currentYear]
    if (rule.recurrence === 'annual') {
      const thisYear = resolveDates(rule, currentYear)
      if (thisYear && thisYear.dueOn < today) years.push(currentYear + 1)
    }

    for (const year of years) {
      const dates = resolveDates(rule, year)
      if (!dates) continue
      // A one-off obligation whose date has already gone is history, not a task.
      if (rule.recurrence === 'once' && dates.dueOn < today) continue
      pending.push([newId(), farmId, rule.id, year, dates.windowStart, dates.dueOn])
    }
  }

  if (pending.length === 0) return
  await pool.query(
    `INSERT INTO user_obligations (id, farm_id, obligation_id, period_year, window_start, due_on)
     VALUES ?
     ON DUPLICATE KEY UPDATE id = id`,
    [pending],
  )
}

// ──────────────────────────────────────────────────────────────── status

export interface DeadlineState {
  level: ObligationLevel
  label: string
  daysLeft: number
  windowOpen: boolean
}

export function deadlineState(
  dueOn: string,
  windowStart: string | null,
  status: ObligationStatus,
  submittedOn: string | null,
  today = todayIso(),
): DeadlineState {
  const daysLeft = daysBetween(today, dueOn)
  const windowOpen = windowStart === null || windowStart <= today

  if (status === 'submitted') {
    return {
      level: 'ok',
      label: submittedOn ? `Predano ${formatHr(submittedOn)}` : 'Predano',
      daysLeft,
      windowOpen,
    }
  }
  if (status === 'not_applicable') {
    return { level: 'info', label: 'Ne odnosi se na vas', daysLeft, windowOpen }
  }
  if (daysLeft < 0) {
    return { level: 'critical', label: `Rok je istekao prije ${-daysLeft} dana`, daysLeft, windowOpen }
  }
  if (daysLeft === 0) {
    return { level: 'critical', label: 'Rok je danas', daysLeft, windowOpen }
  }
  if (!windowOpen) {
    return { level: 'info', label: `Predaja počinje ${formatHr(windowStart!)}`, daysLeft, windowOpen }
  }
  const label = `Još ${daysLeft} ${daysLeft === 1 ? 'dan' : 'dana'}`
  if (daysLeft <= URGENT_DAYS) return { level: 'critical', label, daysLeft, windowOpen }
  if (daysLeft <= SOON_DAYS) return { level: 'warning', label, daysLeft, windowOpen }
  return { level: 'caution', label, daysLeft, windowOpen }
}

export interface ContinuousState {
  level: ObligationLevel
  label: string
  lastEntryOn: string | null
  daysSince: number | null
}

/** §23 — "Evidencija VMP / Status: 🟢 uredno / Posljednji unos: 12.08.2026." */
export async function continuousState(
  farmId: string,
  rule: ObligationRule,
  today = todayIso(),
): Promise<ContinuousState> {
  if (!rule.continuousSource) {
    return { level: 'info', label: 'Nije podešeno', lastEntryOn: null, daysSince: null }
  }
  const source = CONTINUOUS_SOURCES[rule.continuousSource]
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT MAX(${source.column}) AS last_entry FROM ${source.table} WHERE farm_id = ? ${source.extra}`,
    [farmId],
  )
  const lastEntryOn = asDate(rows[0]?.last_entry)

  if (!lastEntryOn) {
    return { level: 'caution', label: 'Još nema unosa', lastEntryOn: null, daysSince: null }
  }
  const daysSince = daysBetween(lastEntryOn, today)
  const max = rule.continuousMaxDays
  if (max !== null && daysSince > max) {
    return {
      level: 'warning',
      label: `Bez unosa ${daysSince} dana`,
      lastEntryOn,
      daysSince,
    }
  }
  return { level: 'ok', label: 'Uredno', lastEntryOn, daysSince }
}

export function formatHr(isoDate: string): string {
  const [y, m, d] = isoDate.split('-')
  return `${Number(d)}. ${Number(m)}. ${y}.`
}

// ──────────────────────────────────────────────────────────────── cards

export interface ObligationCard {
  /** user_obligations.id for deadlines; the rule id for continuous obligations. */
  id: string
  ruleId: string
  code: string
  name: string
  kind: ObligationKind
  legalBasis: string | null
  description: string | null
  warningText: string | null
  formCode: string | null
  documentCategory: string | null
  requiredAttachments: string[]
  reminderDays: number[]
  level: ObligationLevel
  statusLabel: string
  status: ObligationStatus | null
  periodYear: number | null
  windowStart: string | null
  dueOn: string | null
  daysLeft: number | null
  submittedOn: string | null
  referenceNumber: string | null
  documentId: string | null
  lastEntryOn: string | null
}

const LEVEL_ORDER: Record<ObligationLevel, number> = { critical: 0, warning: 1, caution: 2, ok: 3, info: 4 }

/**
 * The §23 screen in one call: every obligation that applies to this farm, deadline instances and
 * continuous registers alike, sorted by how much attention each needs.
 */
export async function buildObligationCards(farmId: string): Promise<ObligationCard[]> {
  await materialiseObligations(farmId)

  const today = todayIso()
  const facts = await loadFarmFacts(farmId)
  const cards: ObligationCard[] = []

  // The rule columns come first and unaliased so mapRule() reads `id`, `code`, `name` etc. from
  // legal_obligations; everything taken from the instance is listed explicitly. Selecting
  // `uo.*, o.*` would work only by accident of which duplicate column mysql2 keeps last.
  const [deadlineRows] = await pool.query<RowDataPacket[]>(
    `SELECT o.*,
            uo.id AS instance_id, uo.status AS instance_status, uo.period_year,
            uo.window_start, uo.due_on, uo.submitted_on, uo.reference_number, uo.document_id
       FROM user_obligations uo
       JOIN legal_obligations o ON o.id = uo.obligation_id
      WHERE uo.farm_id = ? AND o.active = TRUE
      ORDER BY uo.due_on`,
    [farmId],
  )

  for (const row of deadlineRows) {
    const rule = mapRule(row)
    const dueOn = asDate(row.due_on)!
    const windowStart = asDate(row.window_start)
    const status = row.instance_status as ObligationStatus
    const submittedOn = asDate(row.submitted_on)
    const state = deadlineState(dueOn, windowStart, status, submittedOn, today)

    cards.push({
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
      status,
      periodYear: Number(row.period_year),
      windowStart,
      dueOn,
      daysLeft: state.daysLeft,
      submittedOn,
      referenceNumber: (row.reference_number as string | null) ?? null,
      documentId: (row.document_id as string | null) ?? null,
      lastEntryOn: null,
    })
  }

  const [continuousRows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM legal_obligations WHERE active = TRUE AND kind = 'continuous' ORDER BY sort_order",
  )
  for (const row of continuousRows) {
    const rule = mapRule(row)
    if (!ruleApplies(rule, facts)) continue
    const state = await continuousState(farmId, rule, today)

    cards.push({
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
    })
  }

  return cards.sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') ||
      a.name.localeCompare(b.name, 'hr'),
  )
}
