import { Router } from 'express'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, notFound } from '../lib/http.js'
import { isValidOib } from '../lib/oib.js'
import { computeCompleteness } from '../lib/profile.js'
import { requireAuth } from '../middleware/auth.js'

export const meRouter = Router()

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
