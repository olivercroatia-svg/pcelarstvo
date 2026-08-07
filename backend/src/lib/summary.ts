import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { ask, isConfigured, settings, spend } from './ai.js'
import { notify } from './notify.js'

/**
 * §46 — "Dnevni sažetak": one message in the morning instead of seven.
 *
 * It is built on top of §53 rather than beside it. The sweep in lib/scheduler.ts has just finished
 * writing today's notifications, so this reads those same rows and condenses them — which means
 * the summary can never disagree with the notification list it summarises, and no fact is queried
 * twice. Adding a new reminder to the sweep makes it appear in the summary with no change here.
 *
 * When the AI layer is unavailable — no key, switch off, cap reached — nothing is sent. That is
 * the correct degradation: the individual notifications already fired, so the beekeeper loses the
 * convenience of one line and keeps every fact. A summary is the one feature here that has a
 * perfectly good non-AI fallback already installed.
 */

/**
 * Not before six in the morning. The sweep ticks hourly, so without this a farm would get its
 * "good morning" at whatever hour the server last restarted.
 */
const EARLIEST_HOUR = 6

interface Fact {
  severity: string
  title: string
  body: string | null
}

export async function dailySummary(farmId: string, today: string): Promise<void> {
  const { enabled, dailySummaryEnabled } = await settings()
  if (!enabled || !dailySummaryEnabled || !isConfigured()) return
  if (new Date().getHours() < EARLIEST_HOUR) return

  // Checked here as well as inside ask(): a farm at its cap would otherwise generate one 429 per
  // sweep per day, and the throw would land in the scheduler's error log rather than anywhere a
  // person looks.
  const { allowed } = await spend(farmId)
  if (!allowed) return

  // Cheap guard before anything expensive: if today's summary already exists, stop. notify()
  // would refuse the duplicate anyway, but only after the model had been paid.
  const dedupeKey = `daily_summary:${today}`
  const [existing] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM notifications WHERE farm_id = ? AND dedupe_key = ? LIMIT 1',
    [farmId, dedupeKey],
  )
  if (existing.length > 0) return

  const facts = await gather(farmId, today)
  // Nothing to say is a perfectly good outcome, and a daily "nema ničega" is how a notification
  // centre teaches people to ignore it.
  if (facts.length === 0) return

  const lines = facts
    .map((f) => `- [${f.severity}] ${f.title}${f.body ? ` — ${f.body}` : ''}`)
    .join('\n')

  let text: string
  try {
    text = await ask(
      { farmId, userId: null, feature: 'summary' },
      {
        system: `Pišeš jutarnji sažetak za hrvatskog pčelara, na hrvatskom jeziku.

Dobivaš popis onoga što aplikacija danas ima za njega. Napiši 2–3 rečenice koje mu kažu što je
danas važno i čime da počne.

Pravila:
- Koristi ISKLJUČIVO činjenice iz popisa. Ne dodaji pčelarske savjete, ne procjenjuj i ne
  predviđaj.
- Počni od onoga što je najhitnije. Ako nešto istječe ili je propušteno, to ide u prvu rečenicu.
- Bez pozdrava, bez uvoda, bez nabrajanja crticama. Same rečenice.
- Najviše 400 znakova.
- Ne postavljaj dijagnoze i ne preporučuj liječenje.`,
        prompt: `Danas je ${today}. Za ovo gospodarstvo evidentirano je:\n${lines}`,
        maxTokens: 2000,
      },
    )
  } catch (err) {
    // A failed summary must never fail the sweep for the farms after this one.
    console.error('[summary] generation failed', farmId, err)
    return
  }
  if (!text) return

  await notify({
    farmId,
    kind: 'daily_summary',
    // Informational by design. The underlying items carry their own severity and their own
    // notifications; escalating the summary would double-count the same warning.
    severity: 'info',
    title: 'Sažetak dana',
    body: text,
    link: '/obavijesti',
    dedupeKey,
  })
}

/**
 * What today looks like. Almost all of it comes from notifications the sweep has already written;
 * the two extra queries cover things that are true rather than newly-happened, and so never
 * produced a notification of their own.
 */
async function gather(farmId: string, today: string): Promise<Fact[]> {
  const facts: Fact[] = []

  const [recent] = await pool.query<RowDataPacket[]>(
    `SELECT severity, title, body FROM notifications
      WHERE farm_id = ? AND kind <> 'daily_summary' AND created_at >= DATE_SUB(NOW(), INTERVAL 36 HOUR)
      ORDER BY FIELD(severity, 'critical', 'warning', 'caution', 'info', 'ok'), created_at DESC
      LIMIT 12`,
    [farmId],
  )
  for (const r of recent) {
    facts.push({ severity: r.severity as string, title: r.title as string, body: r.body as string | null })
  }

  // A running withdrawal period is a state, not an event — it fires no notification, and it is the
  // single fact most likely to matter on a morning when the beekeeper is thinking about extracting.
  const [withdrawal] = await pool.query<RowDataPacket[]>(
    `SELECT product_name, withdrawal_until,
            (SELECT COUNT(*) FROM treatment_hives th WHERE th.treatment_id = t.id) AS hives
       FROM veterinary_treatments t
      WHERE t.farm_id = ? AND t.deleted_at IS NULL
        AND t.withdrawal_until IS NOT NULL AND t.withdrawal_until >= ?
      ORDER BY t.withdrawal_until LIMIT 5`,
    [farmId, today],
  )
  for (const r of withdrawal) {
    facts.push({
      severity: 'warning',
      title: `Karenca u tijeku — ${r.product_name}`,
      body: `do ${String(r.withdrawal_until).slice(0, 10)}, ${Number(r.hives)} košnica — med se ne smije vrcati`,
    })
  }

  // Colonies nobody has looked at in a month. Also a state rather than an event.
  const [stale] = await pool.query<RowDataPacket[]>(
    `SELECT a.name AS apiary, COUNT(*) AS hives
       FROM hives h JOIN apiaries a ON a.id = h.apiary_id
      WHERE h.farm_id = ? AND h.deleted_at IS NULL AND a.deleted_at IS NULL AND h.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM hive_inspections i
           WHERE i.hive_id = h.id AND i.inspected_at >= DATE_SUB(NOW(), INTERVAL 30 DAY))
      GROUP BY a.name
      ORDER BY hives DESC LIMIT 3`,
    [farmId],
  )
  for (const r of stale) {
    facts.push({
      severity: 'caution',
      title: `${Number(r.hives)} košnica bez pregleda 30+ dana`,
      body: `pčelinjak ${r.apiary}`,
    })
  }

  return facts
}
