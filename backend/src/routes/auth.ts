import bcrypt from 'bcryptjs'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { env } from '../env.js'
import { clientIp, writeAudit } from '../lib/audit.js'
import { asyncHandler, conflict, unauthorized } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { isValidOib } from '../lib/oib.js'
import {
  clearSessionCookie,
  issueSessionCookie,
  requireAuth,
  SESSION_COOKIE,
} from '../middleware/auth.js'
import { loadCurrentUser } from './me.js'

export const authRouter = Router()

// §56 — rate limiting. Generous enough that a beekeeper fumbling a password on a phone in the
// field never hits it, tight enough to make credential stuffing pointless.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Previše pokušaja. Pokušajte ponovno za 15 minuta.' },
})

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))

const oibSchema = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || isValidOib(v), { message: 'OIB nije ispravan' })

const registerSchema = z.object({
  // §5 step 1
  entityType: z.enum(['individual', 'opg', 'craft', 'company', 'other']),

  // §5 step 2 — account + identity
  email: z.email({ message: 'Unesite ispravnu email adresu' }),
  password: z.string().min(8, 'Lozinka mora imati najmanje 8 znakova').max(200),
  firstName: z.string().trim().min(2, 'Unesite ime').max(100),
  lastName: z.string().trim().min(2, 'Unesite prezime').max(100),
  phone: optionalText(50),
  oib: oibSchema,
  address: optionalText(255),
  city: optionalText(120),
  postalCode: optionalText(20),
  farmName: optionalText(255),
  mibpg: optionalText(50),
  responsiblePerson: optionalText(200),

  // §5 step 3 — beekeeping, all optional
  eppNumber: optionalText(50),
  apiaryCount: z.coerce.number().int().min(0).max(10000).nullish(),
  colonyCount: z.coerce.number().int().min(0).max(1000000).nullish(),
  association: optionalText(200),
  pastureCommissioner: optionalText(200),
})

async function startSession(
  userId: string,
  userAgent: string | undefined,
  ip: string | null,
): Promise<string> {
  const sessionId = newId()
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent, ip_address)
     VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?, ?)`,
    [sessionId, userId, env.sessionDays, userAgent?.slice(0, 255) ?? null, ip],
  )
  return sessionId
}

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body)
    const email = data.email.toLowerCase()

    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      [email],
    )
    if (existing.length > 0) {
      throw conflict('Korisnik s tom email adresom već postoji', 'email_taken')
    }

    const userId = newId()
    const farmId = newId()
    const passwordHash = await bcrypt.hash(data.password, 12)

    // User, farm and the owner membership are one unit — a half-created account with no farm
    // would leave the user staring at a dashboard that cannot load.
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      await conn.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, phone)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, email, passwordHash, data.firstName, data.lastName, data.phone],
      )

      await conn.query(
        `INSERT INTO farms
           (id, owner_user_id, entity_type, name, oib, mibpg, responsible_person,
            address, city, postal_code,
            epp_number, apiary_count, colony_count, association, pasture_commissioner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          farmId,
          userId,
          data.entityType,
          data.farmName,
          data.oib,
          data.mibpg,
          data.responsiblePerson,
          data.address,
          data.city,
          data.postalCode,
          data.eppNumber,
          data.apiaryCount ?? null,
          data.colonyCount ?? null,
          data.association,
          data.pastureCommissioner,
        ],
      )

      await conn.query(
        `INSERT INTO farm_members (id, farm_id, user_id, role, accepted_at)
         VALUES (?, ?, ?, 'owner', NOW())`,
        [newId(), farmId, userId],
      )

      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const sessionId = await startSession(userId, req.headers['user-agent'], clientIp(req))
    issueSessionCookie(res, userId, sessionId)

    await writeAudit(req, {
      userId,
      farmId,
      action: 'user.register',
      entityType: 'user',
      entityId: userId,
      after: { email, entityType: data.entityType },
    })

    res.status(201).json(await loadCurrentUser(userId))
  }),
)

const loginSchema = z.object({
  email: z.email({ message: 'Unesite ispravnu email adresu' }),
  password: z.string().min(1, 'Unesite lozinku'),
})

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body)
    const email = data.email.toLowerCase()

    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id, password_hash FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
      [email],
    )
    const row = rows[0]

    // Hash even when the address is unknown, so response time does not reveal which addresses are
    // registered.
    const hash = (row?.password_hash as string | undefined) ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'
    const ok = await bcrypt.compare(data.password, hash)

    if (!row || !ok) {
      throw unauthorized('Neispravna email adresa ili lozinka')
    }

    const userId = row.id as string
    const sessionId = await startSession(userId, req.headers['user-agent'], clientIp(req))
    issueSessionCookie(res, userId, sessionId)
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [userId])

    res.json(await loadCurrentUser(userId))
  }),
)

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.user) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = ?', [req.user.sessionId])
    }
    clearSessionCookie(res)
    res.status(204).end()
  }),
)

/** Revokes every other session — "log out on all my other devices". */
authRouter.post(
  '/logout-others',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!
    const [result] = await pool.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [user.id, user.sessionId],
    )
    await writeAudit(req, {
      userId: user.id,
      action: 'session.revoke_others',
      entityType: 'session',
      entityId: user.sessionId,
    })
    res.json({ revoked: (result as { affectedRows: number }).affectedRows })
  }),
)

/** Returns the signed-in user, or 401 when the cookie is missing, expired or revoked. */
authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) {
      // A stale cookie should not keep producing 401s on every app load.
      if (req.cookies?.[SESSION_COOKIE]) clearSessionCookie(res)
      throw unauthorized()
    }
    res.json(await loadCurrentUser(req.user.id))
  }),
)
