import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// The real .env lives at the project root (PM2 runs with cwd = project root), but `npm run dev`
// runs from backend/. Load both; dotenv never overrides an already-set var, so layering is safe.
const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config()
dotenv.config({ path: path.resolve(here, '../../.env') })
dotenv.config({ path: path.resolve(here, '../.env') })

export const isProduction = process.env.NODE_ENV === 'production'

function required(name: string, devFallback?: string): string {
  const value = process.env[name]
  if (value) return value
  if (!isProduction && devFallback !== undefined) return devFallback
  throw new Error(`Missing required environment variable: ${name}`)
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction,

  // Signing key for session JWTs. Rotating it logs everyone out — that is intended.
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  // How long a session stays valid without re-login.
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),

  // Public base path the SPA is served under; used for the cookie path so a second app on the
  // same domain cannot read our cookie.
  basePath: process.env.BASE_PATH ?? '/',
}
