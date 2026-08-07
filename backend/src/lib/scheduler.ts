import type { RowDataPacket } from 'mysql2/promise'
import { pool } from '../db.js'
import {
  continuousState,
  daysBetween,
  formatHr,
  mapRule,
  materialiseObligations,
  ruleApplies,
  loadFarmFacts,
  todayIso,
} from './obligations.js'
import { counted } from './plural.js'
import { asDate } from './schema.js'
import { notify } from './notify.js'
import { dailySummary } from './summary.js'

/**
 * §24 — the reminder engine, and the producer behind the §53 notification centre.
 *
 * What it does NOT do, stated plainly: it does not send email, push or SMS. Those need SMTP
 * credentials and VAPID keys that only exist on the deployed host, and are wired up in the
 * deployment stage. Everything here writes into `notifications`, which the app reads. When a
 * transport is added it consumes rows where delivered_at IS NULL — the schema is already shaped
 * for it.
 *
 * Every insert is guarded by a dedupe key (see lib/notify.ts), so running the sweep more often
 * than needed is harmless.
 */

/** Hourly is fine: everything here is measured in days, and the dedupe keys absorb the rest. */
const INTERVAL_MS = 60 * 60 * 1000
/** Long enough for the pool and migrations to settle before the first sweep touches the database. */
const FIRST_RUN_DELAY_MS = 20 * 1000

const LOCK_NAME = 'moj_pcelinjak_scheduler'

let timer: NodeJS.Timeout | null = null

/**
 * PM2 in cluster mode runs several copies of this process, and all of them would sweep at once.
 * A MySQL advisory lock is the cheapest correct answer — held on one dedicated connection for the
 * duration of the sweep, so exactly one instance does the work and the others skip the tick.
 */
async function withLock(work: () => Promise<void>): Promise<void> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [LOCK_NAME])
    if (Number(rows[0]?.got) !== 1) return
    try {
      await work()
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME])
    }
  } finally {
    conn.release()
  }
}

async function sweepFarm(farmId: string, today: string): Promise<void> {
  await materialiseObligations(farmId)

  // ── §24 the reminder ladder ────────────────────────────────────────────
  const [obligations] = await pool.query<RowDataPacket[]>(
    `SELECT uo.id, uo.due_on, uo.window_start, uo.status,
            o.name, o.reminder_days, o.warning_text
       FROM user_obligations uo
       JOIN legal_obligations o ON o.id = uo.obligation_id
      WHERE uo.farm_id = ? AND o.active = TRUE
        AND uo.status IN ('pending', 'in_progress')`,
    [farmId],
  )

  for (const row of obligations) {
    const dueOn = asDate(row.due_on)!
    const daysLeft = daysBetween(today, dueOn)
    const name = row.name as string
    const rule = mapRule(row)

    if (daysLeft < 0) {
      await notify({
        farmId,
        kind: 'obligation_overdue',
        severity: 'critical',
        title: `Rok je istekao — ${name}`,
        body: `Rok je bio ${formatHr(dueOn)} ${row.warning_text ?? ''}`.trim(),
        link: `/obveze/${row.id}`,
        entityType: 'user_obligation',
        entityId: row.id as string,
        // Deliberately not per-day: one "you have missed this" is a reminder, thirty is noise.
        dedupeKey: `obligation:${row.id}:overdue`,
      })
      continue
    }

    if (!rule.reminderDays.includes(daysLeft)) continue

    await notify({
      farmId,
      kind: 'obligation_due',
      severity: daysLeft <= 7 ? 'critical' : daysLeft <= 30 ? 'warning' : 'caution',
      title: daysLeft === 0 ? `Danas je rok — ${name}` : `Rok za ${daysLeft} dana — ${name}`,
      body: `Rok je ${formatHr(dueOn)} ${row.warning_text ?? ''}`.trim(),
      link: `/obveze/${row.id}`,
      entityType: 'user_obligation',
      entityId: row.id as string,
      dedupeKey: `obligation:${row.id}:${daysLeft}`,
    })
  }

  // ── §53 registers that have gone quiet ─────────────────────────────────
  const [continuousRules] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM legal_obligations WHERE active = TRUE AND kind = 'continuous'",
  )
  if (continuousRules.length > 0) {
    const facts = await loadFarmFacts(farmId)
    for (const row of continuousRules) {
      const rule = mapRule(row)
      if (!ruleApplies(rule, facts)) continue

      const state = await continuousState(farmId, rule, today)
      if (state.level === 'ok') continue

      await notify({
        farmId,
        kind: 'register_stale',
        severity: 'caution',
        title: `Provjerite evidenciju — ${rule.name}`,
        body: state.lastEntryOn
          ? `Posljednji unos: ${formatHr(state.lastEntryOn)}`
          : 'U ovoj evidenciji još nema nijednog unosa.',
        link: '/obveze',
        entityType: 'legal_obligation',
        entityId: rule.id,
        // Re-raised monthly rather than once: a register that stays empty stays a problem, but a
        // daily nag would train the beekeeper to ignore the whole centre.
        dedupeKey: `register_stale:${rule.id}:${today.slice(0, 7)}`,
      })
    }
  }

  // ── §17 withdrawal periods coming to an end ────────────────────────────
  const [withdrawals] = await pool.query<RowDataPacket[]>(
    `SELECT id, product_name, withdrawal_until
       FROM veterinary_treatments
      WHERE farm_id = ? AND deleted_at IS NULL
        AND withdrawal_until IS NOT NULL
        AND withdrawal_until BETWEEN ? AND DATE_ADD(?, INTERVAL 7 DAY)`,
    [farmId, today, today],
  )
  for (const row of withdrawals) {
    const until = asDate(row.withdrawal_until)!
    await notify({
      farmId,
      kind: 'withdrawal_end',
      severity: 'info',
      title: `Karenca završava — ${row.product_name}`,
      body: `Med se ponovno smije vrcati nakon ${formatHr(until)}`,
      link: `/tretmani/${row.id}`,
      entityType: 'veterinary_treatment',
      entityId: row.id as string,
      dedupeKey: `withdrawal_end:${row.id}`,
    })
  }

  // ── §53 queens past their second season ────────────────────────────────
  const currentYear = Number(today.slice(0, 4))
  const [queens] = await pool.query<RowDataPacket[]>(
    `SELECT q.id, q.code, q.year, h.code AS hive_code
       FROM queens q
       JOIN colonies c ON c.queen_id = q.id AND c.ended_on IS NULL
       JOIN hives h ON h.id = c.hive_id AND h.deleted_at IS NULL
      WHERE q.farm_id = ? AND q.deleted_at IS NULL
        AND q.year IS NOT NULL AND q.year <= ?
        AND q.status <> 'replace'`,
    [farmId, currentYear - 2],
  )
  for (const row of queens) {
    const age = currentYear - Number(row.year)
    await notify({
      farmId,
      kind: 'queen_age',
      severity: 'warning',
      title: `Matica ${row.code} ima ${counted(age, 'godinu', 'godine', 'godina')}`,
      body: `Košnica ${row.hive_code}. Razmislite o zamjeni matice.`,
      link: '/matice',
      entityType: 'queen',
      entityId: row.id as string,
      dedupeKey: `queen_age:${row.id}:${currentYear}`,
    })
  }

  // ── §22 documents and §8 permits running out ───────────────────────────
  const EXPIRY_STEPS = [60, 30, 7, 0]

  const [documents] = await pool.query<RowDataPacket[]>(
    `SELECT id, title, expires_on FROM documents
      WHERE farm_id = ? AND deleted_at IS NULL AND expires_on IS NOT NULL
        AND expires_on BETWEEN ? AND DATE_ADD(?, INTERVAL 60 DAY)`,
    [farmId, today, today],
  )
  for (const row of documents) {
    const expiresOn = asDate(row.expires_on)!
    const daysLeft = daysBetween(today, expiresOn)
    if (!EXPIRY_STEPS.includes(daysLeft)) continue
    await notify({
      farmId,
      kind: 'document_expiry',
      severity: daysLeft <= 7 ? 'warning' : 'caution',
      title: `Dokument ističe — ${row.title}`,
      body: `Vrijedi do ${formatHr(expiresOn)}`,
      link: '/dokumenti',
      entityType: 'document',
      entityId: row.id as string,
      // The expiry date is part of the key, so renewing the document starts a fresh ladder
      // instead of being silenced by last year's notification.
      dedupeKey: `document_expiry:${row.id}:${expiresOn}:${daysLeft}`,
    })
  }

  const [permits] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, permit_expires_on FROM apiaries
      WHERE farm_id = ? AND deleted_at IS NULL AND permit_expires_on IS NOT NULL
        AND permit_expires_on BETWEEN ? AND DATE_ADD(?, INTERVAL 60 DAY)`,
    [farmId, today, today],
  )
  for (const row of permits) {
    const expiresOn = asDate(row.permit_expires_on)!
    const daysLeft = daysBetween(today, expiresOn)
    if (!EXPIRY_STEPS.includes(daysLeft)) continue
    await notify({
      farmId,
      kind: 'permit_expiry',
      severity: daysLeft <= 7 ? 'warning' : 'caution',
      title: `Suglasnost ističe — ${row.name}`,
      body: `Suglasnost za smještaj vrijedi do ${formatHr(expiresOn)}`,
      link: `/pcelinjaci/${row.id}`,
      entityType: 'apiary',
      entityId: row.id as string,
      dedupeKey: `permit_expiry:${row.id}:${expiresOn}:${daysLeft}`,
    })
  }

  // ── §53 "🔵 Planirana selidba za 5 dana" ───────────────────────────────
  //
  // The ladder is short on purpose. A move is arranged days ahead, not months, and the useful
  // reminder is the one that arrives while there is still time to chase a consent.
  const MOVE_STEPS = [14, 5, 1, 0]
  const [moves] = await pool.query<RowDataPacket[]>(
    `SELECT m.id, m.to_location, m.planned_on, a.name AS apiary_name,
            (SELECT COUNT(*) FROM apiary_permissions p
              WHERE p.migration_id = m.id AND p.deleted_at IS NULL
                AND (p.valid_until IS NULL OR p.valid_until >= ?)) AS consents
       FROM apiary_migrations m JOIN apiaries a ON a.id = m.apiary_id
      WHERE m.farm_id = ? AND m.deleted_at IS NULL AND m.status = 'planned'
        AND m.planned_on BETWEEN ? AND DATE_ADD(?, INTERVAL 14 DAY)`,
    [today, farmId, today, today],
  )
  for (const row of moves) {
    const plannedOn = asDate(row.planned_on)!
    const daysLeft = daysBetween(today, plannedOn)
    if (!MOVE_STEPS.includes(daysLeft)) continue

    const missingConsent = Number(row.consents) === 0
    await notify({
      farmId,
      kind: 'relocation_due',
      // A move without a consent is the one worth interrupting someone for; §21 puts that warning
      // on the checklist and this is the same fact reaching them before they load the truck.
      severity: missingConsent ? 'warning' : 'info',
      title:
        daysLeft === 0
          ? `Danas je selidba — ${row.to_location}`
          : `Selidba za ${counted(daysLeft, 'dan', 'dana', 'dana')} — ${row.to_location}`,
      body: missingConsent
        ? `${row.apiary_name} · suglasnost za smještaj nije unesena`
        : `${row.apiary_name} · ${formatHr(plannedOn)}`,
      link: `/selidbe/${row.id}`,
      entityType: 'apiary_migration',
      entityId: row.id as string,
      dedupeKey: `relocation:${row.id}:${plannedOn}:${daysLeft}`,
    })
  }

  // ── §53 "🟣 Zaliha staklenki ispod minimuma" ───────────────────────────
  //
  // Only for items the beekeeper set a minimum on. min_quantity IS NULL means "do not watch this
  // one", and honouring that is what keeps the notification centre worth reading.
  const [lowStock] = await pool.query<RowDataPacket[]>(
    `SELECT id, name, quantity, unit, min_quantity FROM inventory_items
      WHERE farm_id = ? AND deleted_at IS NULL
        AND min_quantity IS NOT NULL AND quantity <= min_quantity`,
    [farmId],
  )
  for (const row of lowStock) {
    await notify({
      farmId,
      kind: 'stock_low',
      severity: 'caution',
      title: `Zaliha ispod minimuma — ${row.name}`,
      body: `Na skladištu ${Number(row.quantity)} ${row.unit}, minimum je ${Number(row.min_quantity)}.`,
      link: `/skladiste/${row.id}`,
      entityType: 'inventory_item',
      entityId: row.id as string,
      // Weekly, not daily: the shelf does not refill itself overnight, and a daily repeat of the
      // same line is what makes people stop opening the centre at all.
      dedupeKey: `stock_low:${row.id}:${weekKey(today)}`,
    })
  }

  // §46 — last, and deliberately so: it summarises the notifications written above, so it has to
  // run after them. It is also the only step here that can cost money, and it declines to run
  // itself when the AI layer is off or the farm is at its cap.
  await dailySummary(farmId, today)
}

/** ISO-ish week bucket for dedupe keys — "2026-W32". Good enough to fire a reminder once a week. */
function weekKey(today: string): string {
  const date = new Date(`${today}T00:00:00Z`)
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.floor((date.getTime() - start) / (7 * 86_400_000)) + 1
  return `${date.getUTCFullYear()}-W${week}`
}

export async function runReminderSweep(): Promise<{ farms: number }> {
  const today = todayIso()
  const [farms] = await pool.query<RowDataPacket[]>('SELECT id FROM farms WHERE deleted_at IS NULL')

  for (const farm of farms) {
    try {
      await sweepFarm(farm.id as string, today)
    } catch (err) {
      // One farm's bad data must not stop the sweep for everyone else.
      console.error('[scheduler] farm sweep failed', farm.id, err)
    }
  }
  return { farms: farms.length }
}

export function startScheduler(): void {
  if (timer) return

  const tick = () => {
    withLock(async () => {
      const result = await runReminderSweep()
      console.log(`[scheduler] sweep done (${result.farms} farms)`)
    }).catch((err) => console.error('[scheduler] sweep failed', err))
  }

  setTimeout(tick, FIRST_RUN_DELAY_MS).unref()
  timer = setInterval(tick, INTERVAL_MS)
  timer.unref()
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
