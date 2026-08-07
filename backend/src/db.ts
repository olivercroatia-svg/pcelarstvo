// Must come first: this module builds the pool at import time, so the .env files have to be
// loaded before buildConfig() reads process.env — otherwise it silently falls back to the dev
// defaults below and fails with "Access denied".
import './env.js'
import mysql from 'mysql2/promise'

// Config precedence (mirrors assets/db.js): discrete DB_* vars → DATABASE_URL → dev default.
// Discrete vars are preferred — no URL-encoding pain with #, @, ! in aaPanel passwords.
function parseDbUrl(url: string) {
  if (!url || !url.startsWith('mysql://')) return null
  const rest = url.slice('mysql://'.length)
  const at = rest.lastIndexOf('@')
  if (at === -1) return null
  const creds = rest.slice(0, at)
  const hostPart = rest.slice(at + 1)
  const colon = creds.indexOf(':')
  const user = colon === -1 ? creds : creds.slice(0, colon)
  const password = colon === -1 ? '' : creds.slice(colon + 1)
  const slash = hostPart.indexOf('/')
  if (slash === -1) return null
  const hostPort = hostPart.slice(0, slash)
  const database = hostPart.slice(slash + 1)
  const pc = hostPort.indexOf(':')
  const host = pc === -1 ? hostPort : hostPort.slice(0, pc)
  const port = pc === -1 ? 3306 : parseInt(hostPort.slice(pc + 1), 10)
  return { host, port, user: decodeURIComponent(user), password: decodeURIComponent(password), database }
}

function buildConfig() {
  if (process.env.DB_HOST || process.env.DB_NAME || process.env.DB_USER) {
    return {
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    }
  }
  if (process.env.DATABASE_URL) {
    const parsed = parseDbUrl(process.env.DATABASE_URL)
    if (parsed) return parsed
  }
  return { host: '127.0.0.1', port: 3306, database: 'app', user: 'root', password: 'root' }
}

export const pool = mysql.createPool({
  ...buildConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4', // č ć š ž đ + emoji
  timezone: 'Z',
  dateStrings: false
})

export async function testConnection(): Promise<boolean> {
  try {
    const conn = await pool.getConnection()
    await conn.ping()
    conn.release()
    return true
  } catch (err) {
    console.error('[db] connection test failed:', err instanceof Error ? err.message : err)
    return false
  }
}
