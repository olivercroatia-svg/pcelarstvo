import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { asDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §25 — "Podaci koje je korisnik već unio automatski se koriste za popunjavanje obrazaca."
 *
 * The server assembles the sheet; the client prints it. No PDF library: the browser's own print
 * pipeline renders č/ć/š/ž/đ with the system font and shows the beekeeper exactly what will come
 * out, which a server-rendered PDF with an embedded font cannot promise.
 *
 * §55 — this is a data sheet compiled from the beekeeper's own records, not an official form.
 * Every response carries that sentence and every screen shows it.
 */
export const formsRouter = Router()
formsRouter.use(requireFarm)

const DISCLAIMER =
  'Ovaj ispis je pregled podataka iz vaše evidencije i služi kao pomoć pri ispunjavanju službenog ' +
  'obrasca. Ne predstavlja službeni obrazac niti pravno mišljenje. Provjerite aktualni obrazac i ' +
  'rok kod nadležnog tijela.'

interface FieldRow {
  label: string
  value: string | null
  /** 'app' — filled from the register; 'manual' — the beekeeper still has to write it in. */
  source: 'app' | 'manual'
}

type FormSection =
  | { kind: 'fields'; title: string; rows: FieldRow[] }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][]; note?: string }

interface FormPayload {
  code: string
  title: string
  periodYear: number
  generatedOn: string
  disclaimer: string
  sections: FormSection[]
}

const value = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

async function loadFarm(farmId: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.*, u.first_name, u.last_name, u.email, u.phone
       FROM farms f JOIN users u ON u.id = f.owner_user_id
      WHERE f.id = ? LIMIT 1`,
    [farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Gospodarstvo nije pronađeno')
  return row
}

/** The identity block both forms open with (§25: "Aplikacija već zna: pčelara, OIB, …"). */
function applicantSection(farm: RowDataPacket): FormSection {
  const person = `${farm.first_name ?? ''} ${farm.last_name ?? ''}`.trim()
  return {
    kind: 'fields',
    title: 'Podnositelj',
    rows: [
      { label: 'Nositelj gospodarstva', value: value(person), source: 'app' },
      { label: 'Naziv gospodarstva', value: value(farm.name), source: 'app' },
      { label: 'OIB', value: value(farm.oib), source: 'app' },
      { label: 'MIBPG', value: value(farm.mibpg), source: 'app' },
      { label: 'Adresa', value: value(farm.address), source: 'app' },
      {
        label: 'Mjesto',
        value: value([farm.postal_code, farm.city].filter(Boolean).join(' ')),
        source: 'app',
      },
      { label: 'EPP broj', value: value(farm.epp_number), source: 'app' },
      { label: 'Telefon', value: value(farm.phone), source: 'app' },
      { label: 'E-mail', value: value(farm.email), source: 'app' },
      { label: 'Pčelarska udruga', value: value(farm.association), source: 'app' },
    ],
  }
}

async function apiaryTable(farmId: string): Promise<FormSection> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT a.name, a.location_name, a.address, a.city, a.hive_type, a.kind, a.permit_number,
            (SELECT COUNT(*) FROM hives h WHERE h.apiary_id = a.id AND h.deleted_at IS NULL) AS hives,
            (SELECT COUNT(*) FROM colonies c JOIN hives h2 ON h2.id = c.hive_id
              WHERE h2.apiary_id = a.id AND c.ended_on IS NULL) AS colonies
       FROM apiaries a
      WHERE a.farm_id = ? AND a.deleted_at IS NULL
      ORDER BY a.name`,
    [farmId],
  )

  return {
    kind: 'table',
    title: 'Pčelinjaci',
    columns: ['Pčelinjak', 'Lokacija', 'Tip', 'Košnice', 'Zajednice', 'Suglasnost'],
    rows: rows.map((r) => [
      String(r.name),
      value([r.location_name, r.address, r.city].filter(Boolean).join(', ')) ?? '—',
      r.kind === 'migratory' ? 'seleći' : 'stacionarni',
      String(r.hives),
      String(r.colonies),
      value(r.permit_number) ?? '—',
    ]),
  }
}

async function buildColonyReport(farmId: string, farm: RowDataPacket, year: number): Promise<FormSection[]> {
  const apiaries = await apiaryTable(farmId)
  const totals = apiaries.kind === 'table' ? apiaries.rows : []
  const sum = (index: number) => totals.reduce((acc, row) => acc + Number(row[index] ?? 0), 0)

  return [
    applicantSection(farm),
    apiaries,
    {
      kind: 'fields',
      title: `Ukupno za ${year}. godinu`,
      rows: [
        { label: 'Broj pčelinjaka', value: String(totals.length), source: 'app' },
        { label: 'Ukupno košnica', value: String(sum(3)), source: 'app' },
        { label: 'Ukupno pčelinjih zajednica', value: String(sum(4)), source: 'app' },
      ],
    },
  ]
}

async function buildProductionReport(
  farmId: string,
  farm: RowDataPacket,
  year: number,
): Promise<FormSection[]> {
  const [stats] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND ended_on IS NULL) AS active_colonies,
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND started_on < ?) AS started_before,
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND YEAR(ended_on) = ?) AS ended_this_year,
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND YEAR(ended_on) = ? AND end_reason = 'winter_loss') AS winter_losses,
       (SELECT COUNT(*) FROM veterinary_treatments WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(started_on) = ?) AS treatments,
       (SELECT COUNT(*) FROM varroa_checks WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(checked_on) = ?) AS varroa_checks`,
    [farmId, farmId, `${year}-01-01`, farmId, year, farmId, year, farmId, year, farmId, year],
  )
  const s = stats[0]!

  return [
    applicantSection(farm),
    {
      kind: 'fields',
      title: `Pokazatelji za ${year}. godinu`,
      rows: [
        { label: 'Zajednice na početku godine', value: String(Number(s.started_before)), source: 'app' },
        { label: 'Zajednice danas', value: String(Number(s.active_colonies)), source: 'app' },
        { label: 'Ugašene zajednice u godini', value: String(Number(s.ended_this_year)), source: 'app' },
        { label: 'od toga zimski gubici', value: String(Number(s.winter_losses)), source: 'app' },
        { label: 'Broj provedenih tretmana', value: String(Number(s.treatments)), source: 'app' },
        { label: 'Broj kontrola varoe', value: String(Number(s.varroa_checks)), source: 'app' },
      ],
    },
    {
      kind: 'table',
      title: 'Proizvodnja meda',
      columns: ['Vrsta meda', 'Količina (kg)'],
      rows: [
        ['', ''],
        ['', ''],
        ['', ''],
      ],
      // Said out loud rather than left as an empty table the beekeeper has to interpret.
      note: 'Podaci o vrcanju i serijama meda vode se u modulu proizvodnje, koji stiže u sljedećoj etapi. Do tada upišite količine ručno.',
    },
  ]
}

const BUILDERS: Record<string, { title: string; build: typeof buildColonyReport }> = {
  annual_colony_report: { title: 'Godišnja dojava broja pčelinjih zajednica', build: buildColonyReport },
  annual_production_report: { title: 'Godišnja dojava proizvodnih pokazatelja', build: buildProductionReport },
}

formsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Only the forms an obligation actually points at, so the list cannot drift from §54's rules.
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT DISTINCT form_code FROM legal_obligations WHERE active = TRUE AND form_code IS NOT NULL',
    )
    res.json({
      forms: rows
        .map((r) => r.form_code as string)
        .filter((code) => BUILDERS[code])
        .map((code) => ({ code, title: BUILDERS[code]!.title })),
    })
  }),
)

formsRouter.get(
  '/:code',
  asyncHandler(async (req, res) => {
    const builder = BUILDERS[req.params.code]
    if (!builder) throw notFound('Obrazac nije pronađen')

    const { year } = z
      .object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) })
      .parse(req.query)

    const farm = await loadFarm(req.farm!.id)
    const payload: FormPayload = {
      code: req.params.code,
      title: builder.title,
      periodYear: year,
      generatedOn: asDate(new Date())!,
      disclaimer: DISCLAIMER,
      sections: await builder.build(req.farm!.id, farm, year),
    }
    res.json({ form: payload })
  }),
)
