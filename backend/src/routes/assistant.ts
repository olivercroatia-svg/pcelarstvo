import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { converse, settings, type AiContext, type AiTool } from '../lib/ai.js'
import { apiaryEconomics } from '../lib/commerce.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { asDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §45 — "AI asistent koji odgovara na pitanja o vlastitim podacima".
 *
 * The assistant is given tools, never a database connection. Every tool below closes over the
 * farm id resolved by requireFarm, so the model chooses *which* question to ask and never *whose*
 * data to ask it of — tool input is untrusted model output, handled exactly like a request body.
 *
 * §4 is enforced by omission rather than refusal. A worker's roster simply does not contain the
 * economics tool, so there is no euro figure anywhere in their conversation for the model to
 * mention, decline to mention, or be argued into mentioning. A tool that exists and says "no" is
 * one prompt away from a leak; a tool that was never registered is not.
 *
 * Every tool is read-only. There is deliberately no tool that writes, deletes or corrects
 * anything: §17's register and §56's audit trail rest on knowing which human wrote each row, and
 * an assistant that could edit them would put a model's name on a legal record.
 */
export const assistantRouter = Router()
assistantRouter.use(requireFarm)

/** Enough context for a real conversation, few enough turns to bound what one question costs. */
const HISTORY_LIMIT = 20

const SYSTEM = `Ti si pomoćnik hrvatskom pčelaru unutar aplikacije "Moj Pčelinjak".

Odgovaraš ISKLJUČIVO na temelju podataka koje dobiješ preko alata. Nemaš druge izvore.

Pravila:
- Prije odgovora pozovi alate koji ti trebaju. Ako pitanje traži podatke iz više izvora, pozovi
  više alata odjednom.
- Ako alati ne vrate podatak, reci da ga u evidenciji nema. NIKADA ne popunjavaj rupu procjenom ni
  općim pčelarskim znanjem — pčelar te pita što PIŠE u njegovoj evidenciji.
- Kad navodiš broj, reci odakle je: iz kojeg pregleda, vrcanja ili tretmana i kojeg datuma.
- Odgovaraj kratko i konkretno, na hrvatskom. Bez uvoda tipa "Naravno" i bez ponavljanja pitanja.
- Brojeve piši hrvatski: decimalni zarez, točka za tisućice ("1.234,50").

Granice o kojima ne pregovaraš:
- Ne postavljaš dijagnozu bolesti pčela i ne preporučuješ liječenje. Ako pitanje ide u tom smjeru,
  reci što evidencija pokazuje i uputi na veterinara.
- Ne daješ pravno ni upravno tumačenje propisa. Rokove i obveze čitaš iz alata kao podatak; ako te
  pitaju vrijedi li nešto za njihov slučaj, uputi ih na nadležno tijelo.
- Ne izmišljaj šifre košnica, LOT brojeve ni datume.`

// ── the tool surface ────────────────────────────────────────────────────────

const noArgs = { type: 'object', additionalProperties: false, properties: {}, required: [] }

const yearArg = {
  type: 'object',
  additionalProperties: false,
  properties: { year: { type: 'integer', description: 'Godina; izostavi za tekuću.' } },
  required: [],
}

function currentYear(input: Record<string, unknown>): number {
  const year = Number(input.year)
  return Number.isInteger(year) && year > 2000 && year < 2100 ? year : new Date().getFullYear()
}

function buildTools(farmId: string, isOwner: boolean): AiTool[] {
  const tools: AiTool[] = [
    {
      name: 'farm_overview',
      description:
        'Osnovni pregled gospodarstva: pčelinjaci, broj košnica i aktivnih zajednica po pčelinjaku. Počni ovdje kad ne znaš o kojem pčelinjaku ili košnici je riječ.',
      inputSchema: noArgs,
      run: async () => {
        const [rows] = await pool.query<RowDataPacket[]>(
          // A colony is active while ended_on is NULL — colonies has no soft-delete column and no
          // status, because a colony that ended is a fact worth keeping, not a row to hide.
          `SELECT a.name, a.location_name, a.city,
                  (SELECT COUNT(*) FROM hives h WHERE h.apiary_id = a.id AND h.deleted_at IS NULL) AS hives,
                  (SELECT COUNT(*) FROM colonies c JOIN hives h2 ON h2.id = c.hive_id
                    WHERE h2.apiary_id = a.id AND c.ended_on IS NULL) AS colonies
             FROM apiaries a
            WHERE a.farm_id = ? AND a.deleted_at IS NULL
            ORDER BY a.name`,
          [farmId],
        )
        return rows.map((r) => ({
          pcelinjak: r.name,
          mjesto: r.location_name ?? r.city ?? null,
          kosnica: Number(r.hives),
          aktivnihZajednica: Number(r.colonies),
        }))
      },
    },
    {
      name: 'list_hives',
      description:
        'Popis košnica sa šifrom, pčelinjakom i datumom zadnjeg pregleda. Koristi kad pčelar pita koje košnice postoje ili koja je dugo nepregledana.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { apiary: { type: 'string', description: 'Naziv pčelinjaka; izostavi za sve.' } },
        required: [],
      },
      run: async (input) => {
        const apiary = typeof input.apiary === 'string' ? input.apiary : null
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT h.code, a.name AS apiary, h.hive_type, h.status,
                  (SELECT MAX(i.inspected_at) FROM hive_inspections i WHERE i.hive_id = h.id) AS last_seen
             FROM hives h JOIN apiaries a ON a.id = h.apiary_id
            WHERE h.farm_id = ? AND h.deleted_at IS NULL AND a.deleted_at IS NULL
              AND (? IS NULL OR a.name = ?)
            ORDER BY a.name, h.code
            LIMIT 300`,
          [farmId, apiary, apiary],
        )
        return rows.map((r) => ({
          sifra: r.code,
          pcelinjak: r.apiary,
          tip: r.hive_type,
          status: r.status,
          zadnjiPregled: r.last_seen ? new Date(r.last_seen as Date).toISOString().slice(0, 10) : null,
        }))
      },
    },
    {
      name: 'hive_history',
      description:
        'Povijest jedne košnice: zadnji pregledi, tretmani, kontrole varoe i podaci o matici. Traži točnu šifru košnice (npr. "AN-04").',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { code: { type: 'string', description: 'Šifra košnice.' } },
        required: ['code'],
      },
      run: async (input) => {
        const code = String(input.code ?? '').trim()
        const [hives] = await pool.query<RowDataPacket[]>(
          `SELECT h.id, h.code, a.name AS apiary FROM hives h JOIN apiaries a ON a.id = h.apiary_id
            WHERE h.farm_id = ? AND h.deleted_at IS NULL AND UPPER(h.code) = UPPER(?) LIMIT 1`,
          [farmId, code],
        )
        const hive = hives[0]
        // Thrown, not returned empty: the loop turns this into a tool_result the model can recover
        // from by calling list_hives, which is better than it inventing a plausible history.
        if (!hive) throw new Error(`Košnica "${code}" ne postoji u evidenciji.`)

        const [inspections] = await pool.query<RowDataPacket[]>(
          `SELECT inspected_at, strength, frames_bees, frames_brood, brood, queen_state,
                  swarming, queen_cells, stores, notes
             FROM hive_inspections WHERE hive_id = ? ORDER BY inspected_at DESC LIMIT 10`,
          [hive.id],
        )
        // product_name and active_substance are read off the treatment row, not joined from
        // vmp_products. §17 denormalises them on purpose: the register has to still say what was
        // administered after the product entry is edited or removed, and a JOIN would quietly
        // rewrite history.
        const [treatments] = await pool.query<RowDataPacket[]>(
          `SELECT t.started_on, t.ended_on, t.withdrawal_until, t.product_name, t.active_substance
             FROM veterinary_treatments t
             JOIN treatment_hives th ON th.treatment_id = t.id
            WHERE th.hive_id = ? AND t.deleted_at IS NULL
            ORDER BY t.started_on DESC LIMIT 10`,
          [hive.id],
        )
        const [varroa] = await pool.query<RowDataPacket[]>(
          `SELECT checked_on, method, phase, bees_examined, mites_found, mites_per_day, infestation_percent
             FROM varroa_checks
            WHERE hive_id = ? AND deleted_at IS NULL
            ORDER BY checked_on DESC LIMIT 10`,
          [hive.id],
        )
        // Queens hang off the colony, not the hive: a colony moves house and its queen goes with
        // it, so the current queen is the one on the colony that is still running in this hive.
        const [queens] = await pool.query<RowDataPacket[]>(
          `SELECT q.code, q.line, q.introduced_on, q.year, q.marking_color, q.status, c.ended_on
             FROM queens q JOIN colonies c ON c.queen_id = q.id
            WHERE c.hive_id = ? AND q.deleted_at IS NULL
            ORDER BY c.ended_on IS NULL DESC, q.introduced_on DESC LIMIT 3`,
          [hive.id],
        )
        return {
          sifra: hive.code,
          pcelinjak: hive.apiary,
          pregledi: inspections.map((r) => ({
            datum: new Date(r.inspected_at as Date).toISOString().slice(0, 16).replace('T', ' '),
            snaga: r.strength,
            ulica: r.frames_bees,
            okviraLegla: r.frames_brood,
            leglo: r.brood,
            matica: r.queen_state,
            rojenje: r.swarming,
            maticnjaka: r.queen_cells,
            hrana: r.stores,
            biljeska: r.notes,
          })),
          tretmani: treatments.map((r) => ({
            proizvod: r.product_name,
            djelatnaTvar: r.active_substance,
            od: asDate(r.started_on),
            do: asDate(r.ended_on),
            karencaDo: asDate(r.withdrawal_until),
          })),
          varoa: varroa.map((r) => ({
            datum: asDate(r.checked_on),
            metoda: r.method,
            faza: r.phase,
            pregledanoPcela: r.bees_examined,
            nadenoGrinja: r.mites_found,
            grinjaDnevno: r.mites_per_day === null ? null : Number(r.mites_per_day),
            zarazaPostotak: r.infestation_percent === null ? null : Number(r.infestation_percent),
          })),
          matice: queens.map((r) => ({
            sifra: r.code,
            linija: r.line,
            uvedena: asDate(r.introduced_on),
            godiste: r.year,
            boja: r.marking_color,
            status: r.status,
            trenutna: r.ended_on === null,
          })),
        }
      },
    },
    {
      name: 'production',
      description:
        'Vrcanja i serije meda za godinu: količine po pčelinjaku i paši, LOT kodovi i stanje skladišta.',
      inputSchema: yearArg,
      run: async (input) => {
        const year = currentYear(input)
        // harvests carries no total_kg column — the weight lives in harvest_containers, one row
        // per vessel the honey went into (§28). Summing here rather than storing a total is the
        // same "a quantity is stored once" rule the 005/006 migrations are built on.
        const [harvests] = await pool.query<RowDataPacket[]>(
          `SELECT h.harvested_on, h.pasture, h.hive_range, h.frames_count, a.name AS apiary,
                  COALESCE((SELECT SUM(hc.amount_kg) FROM harvest_containers hc
                             WHERE hc.harvest_id = h.id), 0) AS total_kg
             FROM harvests h JOIN apiaries a ON a.id = h.apiary_id
            WHERE h.farm_id = ? AND h.deleted_at IS NULL AND YEAR(h.harvested_on) = ?
            ORDER BY h.harvested_on`,
          [farmId, year],
        )
        const [batches] = await pool.query<RowDataPacket[]>(
          `SELECT lot_code, honey_type, total_kg, packed_kg, available_kg
             FROM honey_batches WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(created_at) = ?
             ORDER BY lot_code LIMIT 100`,
          [farmId, year],
        )
        return {
          godina: year,
          vrcanja: harvests.map((r) => ({
            datum: asDate(r.harvested_on),
            pcelinjak: r.apiary,
            pasa: r.pasture,
            kg: Number(r.total_kg),
          })),
          ukupnoKg: harvests.reduce((sum, r) => sum + Number(r.total_kg), 0),
          serije: batches.map((r) => ({
            lot: r.lot_code,
            vrsta: r.honey_type,
            ukupnoKg: Number(r.total_kg),
            pakiranoKg: Number(r.packed_kg),
            naSkladistuKg: Number(r.available_kg),
          })),
        }
      },
    },
    {
      name: 'obligations',
      description:
        'Otvorene zakonske obveze i rokovi (§23) sa statusom i danima do isteka. Koristi za pitanja "što moram predati" ili "što mi uskoro istječe".',
      inputSchema: noArgs,
      run: async () => {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT o.name, o.legal_basis, u.due_on, u.status
             FROM user_obligations u JOIN legal_obligations o ON o.id = u.obligation_id
            WHERE u.farm_id = ? AND u.status IN ('pending','in_progress')
            ORDER BY u.due_on IS NULL, u.due_on
            LIMIT 50`,
          [farmId],
        )
        return rows.map((r) => ({
          obveza: r.name,
          pravniTemelj: r.legal_basis,
          rok: asDate(r.due_on),
          status: r.status,
        }))
      },
    },
    {
      name: 'treatments',
      description:
        'Svi VMP tretmani za godinu s karencama (§17). Koristi za pitanja o liječenju, karenci i tome smije li se vrcati.',
      inputSchema: yearArg,
      run: async (input) => {
        const year = currentYear(input)
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT t.started_on, t.ended_on, t.withdrawal_until, t.withdrawal_days, t.dose,
                  t.application_method, t.lot_number, t.reason, t.colonies_treated,
                  t.product_name, t.active_substance, a.name AS apiary,
                  (SELECT COUNT(*) FROM treatment_hives th WHERE th.treatment_id = t.id) AS hives
             FROM veterinary_treatments t
             LEFT JOIN apiaries a ON a.id = t.apiary_id
            WHERE t.farm_id = ? AND t.deleted_at IS NULL AND YEAR(t.started_on) = ?
            ORDER BY t.started_on DESC LIMIT 100`,
          [farmId, year],
        )
        return rows.map((r) => ({
          proizvod: r.product_name,
          djelatnaTvar: r.active_substance,
          pcelinjak: r.apiary,
          od: asDate(r.started_on),
          do: asDate(r.ended_on),
          karencaDana: r.withdrawal_days,
          karencaDo: asDate(r.withdrawal_until),
          doza: r.dose,
          nacin: r.application_method,
          razlog: r.reason,
          lot: r.lot_number,
          zajednicaTretirano: r.colonies_treated,
          brojKosnica: Number(r.hives),
        }))
      },
    },
  ]

  // §4 — the roster stops here for a worker. See the note at the top of the file.
  if (isOwner) {
    tools.push({
      name: 'economics',
      description:
        'Ekonomika po pčelinjaku za godinu (§40): prihod, trošak, rezultat i cijena po kilogramu meda.',
      inputSchema: yearArg,
      run: async (input) => {
        const year = currentYear(input)
        const rows = await apiaryEconomics(farmId, year)
        return rows.map((r) => ({
          pcelinjak: r.apiaryName,
          prihodEur: r.revenue,
          // Honey revenue is carried separately because §40's €/kg divides by it, not by turnover.
          prihodOdMedaEur: r.honeyRevenue,
          trosakEur: r.expenses,
          rezultatEur: r.profit,
          proizvedenoKg: r.producedKg,
          prodanoKg: r.soldKg,
          zajednica: r.colonies,
          kgPoZajednici: r.kgPerColony,
          trosakPoKgEur: r.costPerKg,
          prosjecnaCijenaPoKgEur: r.pricePerKg,
        }))
      },
    })
  }
  return tools
}

// ── conversations ───────────────────────────────────────────────────────────

const askSchema = z.object({
  conversationId: z.string().trim().min(1).nullish(),
  question: z.string().trim().min(2).max(2000),
})

assistantRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, updated_at FROM ai_conversations
        WHERE farm_id = ? AND user_id = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 50`,
      [req.farm!.id, req.user!.id],
    )
    res.json({
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: new Date(r.updated_at as Date).toISOString(),
      })),
    })
  }),
)

assistantRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const conversation = await load(req.params.id!, req.farm!.id, req.user!.id)
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT role, content, tool_trace, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at',
      [conversation.id],
    )
    res.json({
      id: conversation.id,
      title: conversation.title,
      messages: rows.map((r) => ({
        role: r.role,
        content: r.content,
        tools: (r.tool_trace as { name: string }[] | null)?.map((t) => t.name) ?? [],
        createdAt: new Date(r.created_at as Date).toISOString(),
      })),
    })
  }),
)

assistantRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { conversationId, question } = askSchema.parse(req.body)
    const { assistantEnabled } = await settings()
    if (!assistantEnabled) {
      res.status(503).json({ error: 'AI asistent je privremeno isključen.', code: 'ai_disabled' })
      return
    }

    const farmId = req.farm!.id
    const userId = req.user!.id

    // An existing thread is resolved (and ownership-checked) up front; a new one is NOT created
    // yet. Creating it here is what an earlier version did, and it meant every refused request —
    // over the cap, no API key, provider down — left an empty thread behind. A farm at its cap
    // would grow a list of ghost conversations for as long as it kept trying.
    const existing = conversationId ? await load(conversationId, farmId, userId) : null

    const history = existing ? await messages(existing.id) : []
    history.push({ role: 'user', content: question })

    const ctx: AiContext = { farmId, userId, feature: 'assistant' }
    // Throws before anything is written. Everything below this line only runs on a real answer.
    const answer = await converse(ctx, {
      system: SYSTEM,
      messages: history,
      tools: buildTools(farmId, req.farm!.role === 'owner'),
    })

    const conversation = existing ?? (await create(farmId, userId, question))
    await pool.query(
      `INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)`,
      [newId(), conversation.id, question],
    )
    await pool.query(
      `INSERT INTO ai_messages (id, conversation_id, role, content, tool_trace) VALUES (?, ?, 'assistant', ?, ?)`,
      [newId(), conversation.id, answer.text, JSON.stringify(answer.trace)],
    )
    await pool.query('UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?', [conversation.id])

    res.status(201).json({
      conversationId: conversation.id,
      title: conversation.title,
      answer: answer.text,
      tools: answer.trace.map((t) => t.name),
    })
  }),
)

assistantRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const conversation = await load(req.params.id!, req.farm!.id, req.user!.id)
    await pool.query('UPDATE ai_conversations SET deleted_at = NOW() WHERE id = ?', [conversation.id])
    res.status(204).end()
  }),
)

async function load(id: string, farmId: string, userId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, title FROM ai_conversations
      WHERE id = ? AND farm_id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, farmId, userId],
  )
  const row = rows[0]
  if (!row) throw notFound('Razgovor nije pronađen')
  return { id: row.id as string, title: row.title as string }
}

async function create(farmId: string, userId: string, question: string) {
  const id = newId()
  // The first question is the title. A second model call to name a thread would double the cost of
  // saying hello.
  const title = question.length > 80 ? `${question.slice(0, 77)}…` : question
  await pool.query('INSERT INTO ai_conversations (id, farm_id, user_id, title) VALUES (?, ?, ?, ?)', [
    id,
    farmId,
    userId,
    title,
  ])
  return { id, title }
}

async function messages(conversationId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT role, content FROM ai_messages WHERE conversation_id = ?
      ORDER BY created_at DESC LIMIT ${HISTORY_LIMIT}`,
    [conversationId],
  )
  // Only the text is replayed, not the tool calls. Re-sending a long conversation's tool results
  // would make every later turn pay for every earlier lookup, and the model has the answers it
  // needs in its own prose.
  return rows
    .reverse()
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as string }))
}
