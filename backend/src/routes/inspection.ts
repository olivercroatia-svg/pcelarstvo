import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { formatHr, buildObligationCards } from '../lib/obligations.js'
import { counted } from '../lib/plural.js'
import { asDate } from '../lib/schema.js'
import { requireFarm } from '../middleware/farm.js'

/**
 * §26 „Inspekcija" mod and §27 the readiness checklist.
 *
 * §26: "Dokumenti se mogu otvoriti bez prikaza osobnih financijskih podataka."
 *
 * That is enforced by what this file selects, not by hiding things in the UI. No route here reads
 * a price, a cost or a customer, and none may — when the commerce module lands, its tables stay
 * out of these queries. A screen the beekeeper hands to an inspector must not be one CSS rule away
 * from showing last year's turnover.
 */
export const inspectionRouter = Router()
inspectionRouter.use(requireFarm)

interface CheckItem {
  label: string
  ok: boolean
  detail: string | null
  /** Set when the underlying module does not exist yet — neither a pass nor a failure. */
  pending?: boolean
  link?: string
}

interface CheckGroup {
  key: string
  title: string
  items: CheckItem[]
}

const today = () => new Date().toISOString().slice(0, 10)

async function gatherFacts(farmId: string) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM apiaries WHERE farm_id = ? AND deleted_at IS NULL) AS apiaries,
       (SELECT COUNT(*) FROM hives WHERE farm_id = ? AND deleted_at IS NULL) AS hives,
       (SELECT COUNT(*) FROM hives WHERE farm_id = ? AND deleted_at IS NULL AND apiary_id IS NULL) AS unplaced_hives,
       (SELECT COUNT(*) FROM colonies WHERE farm_id = ? AND ended_on IS NULL) AS colonies,
       (SELECT COUNT(*) FROM veterinary_treatments WHERE farm_id = ? AND deleted_at IS NULL) AS treatments,
       (SELECT MAX(started_on) FROM veterinary_treatments WHERE farm_id = ? AND deleted_at IS NULL) AS last_treatment,
       (SELECT COUNT(*) FROM veterinary_treatments WHERE farm_id = ? AND deleted_at IS NULL AND lot_number IS NULL) AS treatments_without_lot,
       (SELECT COUNT(*) FROM varroa_checks WHERE farm_id = ? AND deleted_at IS NULL AND YEAR(checked_on) = YEAR(CURDATE())) AS varroa_this_year,
       (SELECT COUNT(*) FROM health_events WHERE farm_id = ? AND deleted_at IS NULL AND resolved_on IS NULL) AS open_health,
       (SELECT COUNT(*) FROM documents WHERE farm_id = ? AND deleted_at IS NULL) AS documents,
       (SELECT COUNT(*) FROM documents WHERE farm_id = ? AND deleted_at IS NULL AND category = 'registration') AS registration_docs,
       (SELECT COUNT(*) FROM documents WHERE farm_id = ? AND deleted_at IS NULL AND expires_on IS NOT NULL AND expires_on < CURDATE()) AS expired_docs,
       (SELECT COUNT(*) FROM apiaries WHERE farm_id = ? AND deleted_at IS NULL AND permit_expires_on IS NOT NULL AND permit_expires_on < CURDATE()) AS expired_permits,

       -- §28-§31. Quantities in kilograms and LOT codes, never a price: this whole file is the
       -- screen handed to an inspector, and §26 keeps financial data off it.
       (SELECT COUNT(*) FROM honey_batches WHERE farm_id = ? AND deleted_at IS NULL) AS batches,
       (SELECT COUNT(*) FROM honey_batches b
         WHERE b.farm_id = ? AND b.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM harvest_hives hh WHERE hh.harvest_id = b.harvest_id)) AS batches_without_hives,
       (SELECT COUNT(*) FROM honey_batches b
         WHERE b.farm_id = ? AND b.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM packaging_batches p WHERE p.batch_id = b.id AND p.deleted_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM laboratory_tests t WHERE t.batch_id = b.id AND t.deleted_at IS NULL)) AS packed_without_lab,
       (SELECT COUNT(*) FROM laboratory_tests WHERE farm_id = ? AND deleted_at IS NULL) AS lab_tests,
       (SELECT COUNT(*) FROM packaging_batches WHERE farm_id = ? AND deleted_at IS NULL) AS packaging_runs,
       (SELECT COUNT(*) FROM inventory_items
         WHERE farm_id = ? AND deleted_at IS NULL AND expires_on IS NOT NULL AND expires_on < CURDATE()) AS expired_stock,

       -- §21. Consents and relocations, which an inspector does ask about. Note what is NOT here:
       -- sales, customers, expenses and subsidy amounts all exist as of Etapa 4 and none of them
       -- appear in this file. §26 keeps financial data off the screen handed to an official, and
       -- that is enforced by these SELECT lists rather than by the interface.
       (SELECT COUNT(*) FROM apiary_permissions
         WHERE farm_id = ? AND deleted_at IS NULL
           AND valid_until IS NOT NULL AND valid_until < CURDATE()) AS expired_consents,
       (SELECT COUNT(*) FROM apiary_migrations m
         WHERE m.farm_id = ? AND m.deleted_at IS NULL AND m.status = 'planned'
           AND NOT EXISTS (SELECT 1 FROM apiary_permissions p
                            WHERE p.migration_id = m.id AND p.deleted_at IS NULL
                              AND (p.valid_until IS NULL OR p.valid_until >= CURDATE()))) AS moves_without_consent,
       (SELECT COUNT(*) FROM apiary_migrations WHERE farm_id = ? AND deleted_at IS NULL) AS relocations`,
    Array.from({ length: 22 }, () => farmId),
  )
  return rows[0]!
}

/**
 * §28 × §17 — batches whose extraction fell inside a treatment's withdrawal period.
 *
 * One query across every batch rather than lib/production.ts's per-harvest version, because the
 * readiness list needs a count and the inspection screen a yes/no, not a per-batch breakdown.
 */
async function batchesInWithdrawal(farmId: string): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT b.id) AS total
       FROM honey_batches b
       JOIN harvests h ON h.id = b.harvest_id
       JOIN veterinary_treatments t
         ON t.farm_id = b.farm_id AND t.apiary_id = h.apiary_id AND t.deleted_at IS NULL
        AND t.started_on <= h.harvested_on
        AND t.withdrawal_until >= h.harvested_on
      WHERE b.farm_id = ? AND b.deleted_at IS NULL AND h.deleted_at IS NULL`,
    [farmId],
  )
  return Number(rows[0]?.total ?? 0)
}

async function loadFarm(farmId: string): Promise<RowDataPacket> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT f.id, f.name, f.entity_type, f.oib, f.mibpg, f.address, f.city, f.postal_code,
            f.epp_number, f.association, f.pasture_commissioner, f.responsible_person,
            u.first_name, u.last_name
       FROM farms f JOIN users u ON u.id = f.owner_user_id
      WHERE f.id = ? LIMIT 1`,
    [farmId],
  )
  const row = rows[0]
  if (!row) throw notFound('Gospodarstvo nije pronađeno')
  return row
}

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim().length > 0

/** §26 — the clean screen shown to the visiting official. */
inspectionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const farm = await loadFarm(farmId)
    const facts = await gatherFacts(farmId)
    const cards = await buildObligationCards(farmId)
    const inWithdrawal = await batchesInWithdrawal(farmId)

    const [apiaries] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.name, a.city, a.kind, a.permit_number, a.permit_expires_on,
              (SELECT COUNT(*) FROM colonies c JOIN hives h ON h.id = c.hive_id
                WHERE h.apiary_id = a.id AND c.ended_on IS NULL) AS colonies
         FROM apiaries a WHERE a.farm_id = ? AND a.deleted_at IS NULL ORDER BY a.name`,
      [farmId],
    )

    const [documents] = await pool.query<RowDataPacket[]>(
      `SELECT id, category, title, reference_number, issued_on, expires_on, file_path IS NOT NULL AS has_file
         FROM documents WHERE farm_id = ? AND deleted_at IS NULL
        ORDER BY category, COALESCE(issued_on, created_at) DESC`,
      [farmId],
    )

    const [treatments] = await pool.query<RowDataPacket[]>(
      `SELECT t.id, t.product_name, t.active_substance, t.lot_number, t.started_on, t.ended_on,
              t.withdrawal_until, t.locked_at, a.name AS apiary_name
         FROM veterinary_treatments t JOIN apiaries a ON a.id = t.apiary_id
        WHERE t.farm_id = ? AND t.deleted_at IS NULL
        ORDER BY t.started_on DESC LIMIT 50`,
      [farmId],
    )

    const groups: CheckGroup[] = [
      {
        key: 'registration',
        title: 'Registracija',
        items: [
          {
            label: 'EPP broj',
            ok: has(farm.epp_number),
            detail: has(farm.epp_number) ? String(farm.epp_number) : 'nije upisan',
            link: '/profil',
          },
          {
            label: 'Podaci gospodarstva',
            ok: has(farm.oib) && has(farm.address),
            detail: has(farm.oib) ? `OIB ${farm.oib}` : 'OIB nije upisan',
            link: '/profil',
          },
          {
            label: 'Pčelinjaci',
            ok: Number(facts.apiaries) > 0,
            detail: `${counted(Number(facts.apiaries), 'pčelinjak', 'pčelinjaka', 'pčelinjaka')} · ${counted(Number(facts.colonies), 'zajednica', 'zajednice', 'zajednica')}`,
            link: '/pcelinjaci',
          },
          {
            label: 'Dokumenti registracije',
            ok: Number(facts.registration_docs) > 0,
            detail: `${counted(Number(facts.registration_docs), 'dokument', 'dokumenta', 'dokumenata')} u arhivi`,
            link: '/dokumenti?kategorija=registration',
          },
        ],
      },
      {
        key: 'veterinary',
        title: 'Veterinarska dokumentacija',
        items: [
          {
            label: 'Evidencija VMP',
            ok: Number(facts.treatments) > 0,
            detail: facts.last_treatment
              ? `${counted(Number(facts.treatments), 'zapis', 'zapisa', 'zapisa')} · zadnji ${formatHr(asDate(facts.last_treatment)!)}`
              : 'nema zapisa',
            link: '/tretmani',
          },
          {
            label: 'LOT brojevi upisani',
            ok: Number(facts.treatments) > 0 && Number(facts.treatments_without_lot) === 0,
            detail:
              Number(facts.treatments_without_lot) > 0
                ? `${counted(Number(facts.treatments_without_lot), 'tretman', 'tretmana', 'tretmana')} bez LOT broja`
                : 'svi tretmani imaju LOT',
            link: '/tretmani',
          },
          {
            label: 'Kontrola varoe ove godine',
            ok: Number(facts.varroa_this_year) > 0,
            detail: counted(Number(facts.varroa_this_year), 'kontrola', 'kontrole', 'kontrola'),
            link: '/varroa',
          },
          {
            label: 'Otvoreni zdravstveni slučajevi',
            ok: Number(facts.open_health) === 0,
            detail:
              Number(facts.open_health) === 0
                ? 'nema otvorenih'
                : counted(Number(facts.open_health), 'otvoren slučaj', 'otvorena slučaja', 'otvorenih slučajeva'),
            link: '/zdravlje',
          },
        ],
      },
      {
        key: 'obligations',
        title: 'Zakonske obveze',
        items: cards.map((card) => ({
          label: card.name,
          ok: card.level === 'ok' || card.level === 'info',
          detail: card.statusLabel,
          link: `/obveze/${card.id}`,
        })),
      },
      {
        key: 'production',
        title: 'Proizvodnja i sljedivost',
        items: [
          {
            label: 'Serije meda s LOT oznakom',
            ok: Number(facts.batches) > 0,
            detail:
              Number(facts.batches) === 0
                ? 'nema evidentiranih serija'
                : counted(Number(facts.batches), 'serija', 'serije', 'serija'),
            link: '/serije',
          },
          {
            label: 'Sljedivost serija do košnica',
            ok: Number(facts.batches) > 0 && Number(facts.batches_without_hives) === 0,
            detail:
              Number(facts.batches) === 0
                ? 'nema evidentiranih serija'
                : Number(facts.batches_without_hives) === 0
                  ? 'sve serije povezane s košnicama'
                  : `${counted(Number(facts.batches_without_hives), 'serija', 'serije', 'serija')} bez povezanih košnica`,
            link: '/serije',
          },
          {
            label: 'Laboratorijske analize',
            ok: Number(facts.packed_without_lab) === 0,
            detail:
              Number(facts.lab_tests) === 0
                ? 'nema unesenih nalaza'
                : Number(facts.packed_without_lab) === 0
                  ? counted(Number(facts.lab_tests), 'nalaz', 'nalaza', 'nalaza')
                  : `${counted(Number(facts.packed_without_lab), 'pakirana serija', 'pakirane serije', 'pakiranih serija')} bez nalaza`,
            link: '/serije',
          },
          {
            label: 'Vrcanje izvan karence',
            ok: inWithdrawal === 0,
            detail:
              inWithdrawal === 0
                ? 'uredno'
                : `${counted(inWithdrawal, 'serija je vrcana', 'serije su vrcane', 'serija je vrcano')} unutar karence`,
            link: '/serije',
          },
        ],
      },
    ]

    // §21 — only for a farm that actually moves hives. A stationary beekeeper handed an empty
    // "Selidbe" heading looks like they forgot to fill something in.
    if (Number(facts.expired_consents) > 0 || Number(facts.relocations) > 0) {
      groups.push({
        key: 'relocations',
        title: 'Paše i selidbe',
        items: [
          {
            label: 'Suglasnosti za smještaj važeće',
            ok: Number(facts.expired_consents) === 0,
            detail:
              Number(facts.expired_consents) === 0
                ? 'uredno'
                : `${counted(Number(facts.expired_consents), 'istekla suglasnost', 'istekle suglasnosti', 'isteklih suglasnosti')}`,
            link: '/selidbe',
          },
          {
            label: 'Planirane selidbe imaju suglasnost',
            ok: Number(facts.moves_without_consent) === 0,
            detail:
              Number(facts.moves_without_consent) === 0
                ? 'uredno'
                : `${counted(Number(facts.moves_without_consent), 'selidba', 'selidbe', 'selidbi')} bez suglasnosti`,
            link: '/selidbe',
          },
        ],
      })
    }

    res.json({
      farm: {
        name: (farm.name as string | null) ?? `${farm.first_name} ${farm.last_name}`.trim(),
        holder: `${farm.first_name} ${farm.last_name}`.trim(),
        entityType: farm.entity_type as string,
        oib: (farm.oib as string | null) ?? null,
        mibpg: (farm.mibpg as string | null) ?? null,
        address: (farm.address as string | null) ?? null,
        city: [farm.postal_code, farm.city].filter(Boolean).join(' ') || null,
        eppNumber: (farm.epp_number as string | null) ?? null,
        association: (farm.association as string | null) ?? null,
        responsiblePerson: (farm.responsible_person as string | null) ?? null,
      },
      groups,
      apiaries: apiaries.map((a) => ({
        id: a.id as string,
        name: a.name as string,
        city: (a.city as string | null) ?? null,
        kind: a.kind as string,
        colonies: Number(a.colonies),
        permitNumber: (a.permit_number as string | null) ?? null,
        permitExpiresOn: asDate(a.permit_expires_on),
      })),
      documents: documents.map((d) => ({
        id: d.id as string,
        category: d.category as string,
        title: d.title as string,
        referenceNumber: (d.reference_number as string | null) ?? null,
        issuedOn: asDate(d.issued_on),
        expiresOn: asDate(d.expires_on),
        hasFile: Boolean(Number(d.has_file)),
      })),
      treatments: treatments.map((t) => ({
        id: t.id as string,
        productName: t.product_name as string,
        activeSubstance: (t.active_substance as string | null) ?? null,
        lotNumber: (t.lot_number as string | null) ?? null,
        startedOn: asDate(t.started_on),
        endedOn: asDate(t.ended_on),
        withdrawalUntil: asDate(t.withdrawal_until),
        locked: Boolean(t.locked_at),
        apiaryName: t.apiary_name as string,
      })),
      generatedOn: today(),
    })
  }),
)

/**
 * §27 — "Provjeri spremnost za inspekciju".
 *
 * The percentage counts only checks this build can actually evaluate. Items whose module arrives
 * later are returned separately and excluded from the maths — a readiness score inflated by
 * features that do not exist yet would be worse than no score at all.
 */
inspectionRouter.get(
  '/readiness',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const farm = await loadFarm(farmId)
    const facts = await gatherFacts(farmId)
    const cards = await buildObligationCards(farmId)
    const overdue = cards.filter((c) => c.kind === 'deadline' && c.level === 'critical')
    const inWithdrawal = await batchesInWithdrawal(farmId)

    const checks: CheckItem[] = [
      {
        label: 'EPP broj upisan',
        ok: has(farm.epp_number),
        detail: has(farm.epp_number) ? String(farm.epp_number) : 'Dopunite podatke gospodarstva',
        link: '/profil',
      },
      {
        label: 'OIB i adresa gospodarstva',
        ok: has(farm.oib) && has(farm.address),
        detail: has(farm.oib) && has(farm.address) ? 'uredno' : 'Nedostaju osnovni podaci',
        link: '/profil',
      },
      {
        label: 'Pčelinjaci evidentirani',
        ok: Number(facts.apiaries) > 0,
        detail: counted(Number(facts.apiaries), 'pčelinjak', 'pčelinjaka', 'pčelinjaka'),
        link: '/pcelinjaci',
      },
      {
        label: 'Broj zajednica evidentiran',
        ok: Number(facts.colonies) > 0,
        detail: counted(Number(facts.colonies), 'aktivna zajednica', 'aktivne zajednice', 'aktivnih zajednica'),
        link: '/kosnice',
      },
      {
        label: 'Sve košnice smještene na pčelinjak',
        ok: Number(facts.unplaced_hives) === 0,
        detail:
          Number(facts.unplaced_hives) === 0
            ? 'uredno'
            : `${counted(Number(facts.unplaced_hives), 'košnica', 'košnice', 'košnica')} bez pčelinjaka`,
        link: '/kosnice',
      },
      {
        label: 'Evidencija VMP vođena',
        ok: Number(facts.treatments) > 0,
        detail: facts.last_treatment
          ? `zadnji unos ${formatHr(asDate(facts.last_treatment)!)}`
          : 'nema nijednog zapisa',
        link: '/tretmani',
      },
      {
        label: 'LOT broj upisan uz svaki tretman',
        ok: Number(facts.treatments) === 0 || Number(facts.treatments_without_lot) === 0,
        detail:
          Number(facts.treatments_without_lot) > 0
            ? `${counted(Number(facts.treatments_without_lot), 'tretman', 'tretmana', 'tretmana')} bez LOT broja`
            : 'uredno',
        link: '/tretmani',
      },
      {
        label: 'Kontrola varoe u tekućoj godini',
        ok: Number(facts.varroa_this_year) > 0,
        detail: `${counted(Number(facts.varroa_this_year), 'kontrola', 'kontrole', 'kontrola')} ove godine`,
        link: '/varroa',
      },
      {
        label: 'Suglasnosti za smještaj važeće',
        ok: Number(facts.expired_permits) === 0,
        detail:
          Number(facts.expired_permits) === 0
            ? 'uredno'
            : `${counted(Number(facts.expired_permits), 'istekla suglasnost', 'istekle suglasnosti', 'isteklih suglasnosti')}`,
        link: '/pcelinjaci',
      },
      {
        label: 'Dokumenti registracije u arhivi',
        ok: Number(facts.registration_docs) > 0,
        detail: counted(Number(facts.registration_docs), 'dokument', 'dokumenta', 'dokumenata'),
        link: '/dokumenti?kategorija=registration',
      },
      {
        label: 'Nema isteklih dokumenata',
        ok: Number(facts.expired_docs) === 0,
        detail:
          Number(facts.expired_docs) === 0
            ? 'uredno'
            : `${counted(Number(facts.expired_docs), 'dokument je istekao', 'dokumenta su istekla', 'dokumenata je isteklo')}`,
        link: '/dokumenti',
      },
      {
        label: 'Zakonske obveze bez zaostatka',
        ok: overdue.length === 0,
        detail: overdue.length === 0 ? 'uredno' : overdue.map((c) => c.name).join(', '),
        link: '/obveze',
      },
      {
        label: 'Serije meda nose LOT oznaku',
        ok: Number(facts.batches) > 0,
        detail:
          Number(facts.batches) === 0
            ? 'nema evidentiranih serija'
            : counted(Number(facts.batches), 'serija', 'serije', 'serija'),
        link: '/serije',
      },
      {
        label: 'Svaka serija vodi do košnica',
        ok: Number(facts.batches_without_hives) === 0,
        detail:
          Number(facts.batches_without_hives) === 0
            ? 'uredno'
            : `${counted(Number(facts.batches_without_hives), 'serija', 'serije', 'serija')} bez povezanih košnica`,
        link: '/serije',
      },
      {
        label: 'Pakirane serije imaju laboratorijski nalaz',
        ok: Number(facts.packed_without_lab) === 0,
        detail:
          Number(facts.packed_without_lab) === 0
            ? 'uredno'
            : `${counted(Number(facts.packed_without_lab), 'serija', 'serije', 'serija')} bez nalaza`,
        link: '/serije',
      },
      {
        label: 'Nijedno vrcanje nije unutar karence',
        ok: inWithdrawal === 0,
        detail:
          inWithdrawal === 0
            ? 'uredno'
            : `${counted(inWithdrawal, 'serija', 'serije', 'serija')} vrcana unutar karence`,
        link: '/serije',
      },
      {
        label: 'Nema isteklih zaliha VMP-a i prihrane',
        ok: Number(facts.expired_stock) === 0,
        detail:
          Number(facts.expired_stock) === 0
            ? 'uredno'
            : `${counted(Number(facts.expired_stock), 'stavka je istekla', 'stavke su istekle', 'stavki je isteklo')}`,
        link: '/skladiste',
      },
      {
        label: 'Suglasnosti za smještaj važeće',
        ok: Number(facts.expired_consents) === 0,
        detail:
          Number(facts.expired_consents) === 0
            ? 'uredno'
            : `${counted(Number(facts.expired_consents), 'suglasnost je istekla', 'suglasnosti su istekle', 'suglasnosti je isteklo')}`,
        link: '/selidbe',
      },
      {
        label: 'Planirane selidbe imaju suglasnost',
        ok: Number(facts.moves_without_consent) === 0,
        detail:
          Number(facts.moves_without_consent) === 0
            ? 'uredno'
            : `${counted(Number(facts.moves_without_consent), 'selidba', 'selidbe', 'selidbi')} bez suglasnosti`,
        link: '/selidbe',
      },
    ]

    // What genuinely does not exist yet, rather than what has not been built into this list.
    // Counted neither as a pass nor as a failure, so the percentage stays honest.
    //
    // "Evidencija prodaje i kupaca" used to sit here and has been removed rather than ticked. The
    // module exists as of Etapa 4 — but this file does not read it and is not going to, because
    // §26 keeps financial data off the inspection screen. Leaving it listed as pending would have
    // promised a check that is deliberately never coming.
    const pending: CheckItem[] = [
      { label: 'Evidencija higijene objekta', ok: false, pending: true, detail: 'modul stiže u sljedećoj etapi' },
    ]

    const passed = checks.filter((c) => c.ok).length
    res.json({
      percent: Math.round((passed / checks.length) * 100),
      passed,
      total: checks.length,
      checks,
      pending,
    })
  }),
)
