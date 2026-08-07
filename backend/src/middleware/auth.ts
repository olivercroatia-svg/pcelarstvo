import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { RowDataPacket } from 'mysql2'
import { pool } from '../db.js'
import { env } from '../env.js'
import { forbidden, unauthorized } from '../lib/http.js'

export const SESSION_COOKIE = 'mp_session'

export interface SessionUser {
  id: string
  email: string
  firstName: string
  lastName: string
  isAdmin: boolean
  sessionId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

interface TokenPayload {
  sub: string
  sid: string
}

export function issueSessionCookie(res: Response, userId: string, sessionId: string): void {
  const token = jwt.sign({ sub: userId, sid: sessionId } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: `${env.sessionDays}d`,
  })
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Strict is the CSRF defence: the SPA is same-origin with the API, so no legitimate request
    // ever arrives cross-site and we need no separate CSRF token.
    sameSite: 'strict',
    secure: env.isProduction,
    path: env.basePath,
    maxAge: env.sessionDays * 24 * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.isProduction,
    path: env.basePath,
  })
}

/**
 * A valid signature is not enough — the session row is checked on every request so that logging
 * out, or an owner revoking a worker's access, takes effect immediately rather than whenever the
 * token happens to expire.
 */
async function resolveUser(token: string): Promise<SessionUser | null> {
  let payload: TokenPayload
  try {
    payload = jwt.verify(token, env.jwtSecret) as TokenPayload
  } catch {
    return null
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_admin
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
        AND s.user_id = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND u.deleted_at IS NULL
      LIMIT 1`,
    [payload.sid, payload.sub],
  )

  const row = rows[0]
  if (!row) return null

  return {
    id: row.id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    isAdmin: Boolean(row.is_admin),
    sessionId: payload.sid,
  }
}

/** Populates req.user when a valid session exists; never rejects. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE]
  if (typeof token === 'string' && token.length > 0) {
    try {
      req.user = (await resolveUser(token)) ?? undefined
    } catch (err) {
      next(err)
      return
    }
  }
  next()
}

/** Rejects with 401 unless a valid session exists. Run after attachUser. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized())
    return
  }
  next()
}

/** System administrators only (§54 — regulatory parameters). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(unauthorized())
    return
  }
  if (!req.user.isAdmin) {
    next(forbidden())
    return
  }
  next()
}
