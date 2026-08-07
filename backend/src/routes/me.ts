import bcrypt from 'bcryptjs'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { buildExport, eraseAccount } from '../lib/gdpr.js'
import { asyncHandler, badRequest, notFound, unauthorized } from '../lib/http.js'
import { isValidOib } from '../lib/oib.js'
import { computeCompleteness } from '../lib/profile.js'
import { clearSessionCookie, requireAuth } from '../middleware/auth.js'

export const meRouter = Router()

/**
 * §56 — tighter than the global ceiling for the two routes that are expensive or irreversible.
 * An export walks forty tables and a deletion cannot be undone; neither is something anyone does
 * twice in a minute, and both are worth making unattractive to a script.
 *
 * Ten rather than a handful, because the limiter is keyed on the address and shared by both
 * routes: someone who downloads their data, opens it, downloads it again and then mistypes their
 * password twice must not find themselves locked out of deleting their own account for an hour.
 * A right that a rate limiter can withhold is not much of a right.
 */
const privacyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Previše zahtjeva. Pokušajte ponovno za sat vremena.' },
})

export interface CurrentUserPayload {
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    phone: string | null
    isAdmin: boolean
  }
  farm: {
    id: string
    entityType: string
    name: string | null
    oib: string | null
    mibpg: string | null
    responsiblePerson: string | null
    address: string | null
    city: string | null
    postalCode: string | null
    eppNumber: string | null
    apiaryCount: number | null
    colonyCount: number | null
    association: string | null
    pastureCommissioner: string | null
  } | null
  role: 'owner' | 'worker' | null
  completeness: { percent: number; missing: { key: string; label: string }[] }
}

/**
 * The single payload the SPA boots from: who you are, which farm you are acting on, what you may
 * do, and how much of the profile is still missing (§5).
 */
export async function loadCurrentUser(userId: string): Promise<CurrentUserPayload> {
  const [userRows] = await pool.query<RowDataPacket[]>(
    `SELECT id, email, first_name, last_name, phone, is_admin
       FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId],
  )
  const user = userRows[0]
  if (!user) throw notFound('Korisnik nije pronađen')

  // Owned farm first; a worker sees the farm they were invited to.
  const [farmRows] = await pool.query<RowDataPacket[]>(
    `SELECT f.*, m.role
       FROM farm_members m
       JOIN farms f ON f.id = m.farm_id
      WHERE m.user_id = ?
        AND m.deleted_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND f.deleted_at IS NULL
      ORDER BY (m.role = 'owner') DESC, f.created_at ASC
      LIMIT 1`,
    [userId],
  )
  const farm = farmRows[0]

  return {
    user: {
      id: user.id as string,
      email: user.email as string,
      firstName: user.first_name as string,
      lastName: user.last_name as string,
      phone: (user.phone as string | null) ?? null,
      isAdmin: Boolean(user.is_admin),
    },
    farm: farm
      ? {
          id: farm.id as string,
          entityType: farm.entity_type as string,
          name: (farm.name as string | null) ?? null,
          oib: (farm.oib as string | null) ?? null,
          mibpg: (farm.mibpg as string | null) ?? null,
          responsiblePerson: (farm.responsible_person as string | null) ?? null,
          address: (farm.address as string | null) ?? null,
          city: (farm.city as string | null) ?? null,
          postalCode: (farm.postal_code as string | null) ?? null,
          eppNumber: (farm.epp_number as string | null) ?? null,
          apiaryCount: (farm.apiary_count as number | null) ?? null,
          colonyCount: (farm.colony_count as number | null) ?? null,
          association: (farm.association as string | null) ?? null,
          pastureCommissioner: (farm.pasture_commissioner as string | null) ?? null,
        }
      : null,
    role: (farm?.role as 'owner' | 'worker' | undefined) ?? null,
    completeness: computeCompleteness(user, farm),
  }
}

/**
 * A field the client may omit, clear, or set.
 *
 * The distinction between `undefined` (not sent — leave it alone) and `null` (sent empty — clear
 * it) is load-bearing: this endpoint takes partial updates, so collapsing both to `null` would
 * make saving one field wipe every other one.
 */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))

const profileSchema = z.object({
  firstName: z.string().trim().min(2, 'Unesite ime').max(100).optional(),
  lastName: z.string().trim().min(2, 'Unesite prezime').max(100).optional(),
  phone: nullableText(50),

  farmName: nullableText(255),
  // undefined = field not sent, null = user cleared it; only an actual value gets checked.
  oib: nullableText(11).refine((v) => v == null || isValidOib(v), { message: 'OIB nije ispravan' }),
  mibpg: nullableText(50),
  responsiblePerson: nullableText(200),
  address: nullableText(255),
  city: nullableText(120),
  postalCode: nullableText(20),

  eppNumber: nullableText(50),
  apiaryCount: z.coerce.number().int().min(0).max(10000).nullish(),
  colonyCount: z.coerce.number().int().min(0).max(1000000).nullish(),
  association: nullableText(200),
  pastureCommissioner: nullableText(200),
})

meRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadCurrentUser(req.user!.id))
  }),
)

/**
 * Fills in whatever the user skipped during registration. Partial by design — the profile bar
 * exists precisely so this can be completed a field at a time.
 */
meRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!
    const data = profileSchema.parse(req.body)
    const before = await loadCurrentUser(user.id)

    const userFields: [string, unknown][] = []
    if (data.firstName !== undefined) userFields.push(['first_name', data.firstName])
    if (data.lastName !== undefined) userFields.push(['last_name', data.lastName])
    if (data.phone !== undefined) userFields.push(['phone', data.phone])

    if (userFields.length > 0) {
      await pool.query(
        `UPDATE users SET ${userFields.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...userFields.map(([, v]) => v), user.id],
      )
    }

    // Only the owner may edit farm identity — a worker can record work, not change the business
    // the records belong to (§4).
    if (before.farm && before.role === 'owner') {
      const map: Record<string, unknown> = {
        name: data.farmName,
        oib: data.oib,
        mibpg: data.mibpg,
        responsible_person: data.responsiblePerson,
        address: data.address,
        city: data.city,
        postal_code: data.postalCode,
        epp_number: data.eppNumber,
        apiary_count: data.apiaryCount,
        colony_count: data.colonyCount,
        association: data.association,
        pasture_commissioner: data.pastureCommissioner,
      }
      const farmFields = Object.entries(map).filter(([, v]) => v !== undefined)

      if (farmFields.length > 0) {
        await pool.query(
          `UPDATE farms SET ${farmFields.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`,
          [...farmFields.map(([, v]) => v), before.farm.id],
        )
      }
    }

    const after = await loadCurrentUser(user.id)
    await writeAudit(req, {
      userId: user.id,
      farmId: after.farm?.id ?? null,
      action: 'profile.update',
      entityType: 'user',
      entityId: user.id,
      before: { user: before.user, farm: before.farm },
      after: { user: after.user, farm: after.farm },
    })

    res.json(after)
  }),
)

/**
 * GDPR čl. 15 and 20 — everything the application holds about you, as a JSON file (§56).
 *
 * Delivered as a download rather than a body the SPA renders: the point of the right is that the
 * file leaves with the person, and a beekeeper who wants to check what is in it can open it in any
 * text editor. What it contains is decided by lib/gdpr.ts, which is also where §4 applies — a
 * worker's export is their account and their entries, not the farm's books.
 */
meRouter.get(
  '/export',
  requireAuth,
  privacyLimiter,
  asyncHandler(async (req, res) => {
    const current = await loadCurrentUser(req.user!.id)
    const payload = await buildExport(req.user!.id, current.farm?.id ?? null, current.role)

    await writeAudit(req, {
      userId: req.user!.id,
      farmId: current.farm?.id ?? null,
      action: 'gdpr.export',
      entityType: 'user',
      entityId: req.user!.id,
      after: { scope: payload.meta.scope, tables: Object.keys(payload.data).length },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="moj-pcelinjak-podaci-${stamp}.json"`)
    res.send(JSON.stringify(payload, null, 2))
  }),
)

const eraseSchema = z.object({
  password: z.string().min(1, 'Unesite lozinku'),
  // Typed, not ticked. A checkbox is one mis-tap; a word has to be meant.
  confirm: z.string(),
})

const ERASE_WORD = 'OBRIŠI'

/**
 * GDPR čl. 17 (§56). Two gates before anything happens: the account's own password, and the word
 * typed out. Neither is theatre — this removes the farm's register along with the account, and the
 * export above is the only copy the beekeeper will ever get of records they may be legally
 * required to keep.
 *
 * The audit row is written *before* the erasure, while the user still resolves to a name. Writing
 * it afterwards would file the most consequential action in the application under "Obrisani
 * korisnik".
 */
meRouter.delete(
  '/',
  requireAuth,
  privacyLimiter,
  asyncHandler(async (req, res) => {
    const data = eraseSchema.parse(req.body)
    if (data.confirm.trim().toUpperCase() !== ERASE_WORD) {
      throw badRequest(`Za potvrdu upišite ${ERASE_WORD}`, 'confirm')
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [req.user!.id],
    )
    const row = rows[0]
    if (!row) throw notFound('Korisnik nije pronađen')
    if (!(await bcrypt.compare(data.password, row.password_hash as string))) {
      throw unauthorized('Lozinka nije ispravna')
    }

    const current = await loadCurrentUser(req.user!.id)
    await writeAudit(req, {
      userId: req.user!.id,
      farmId: current.farm?.id ?? null,
      action: 'gdpr.erase',
      entityType: 'user',
      entityId: req.user!.id,
      before: { email: current.user.email, role: current.role, farmId: current.farm?.id ?? null },
    })

    const summary = await eraseAccount(req.user!.id)
    clearSessionCookie(res)
    res.json({ ok: true, ...summary })
  }),
)
