import cookieParser from 'cookie-parser'
import express, { type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { pool, testConnection } from './db.js'
import { env } from './env.js'
import { errorHandler } from './middleware/error.js'
import { attachUser, requireAuth } from './middleware/auth.js'
import { apiariesRouter } from './routes/apiaries.js'
import { authRouter } from './routes/auth.js'
import { hivesRouter } from './routes/hives.js'
import { inspectionsRouter } from './routes/inspections.js'
import { meRouter } from './routes/me.js'
import { photosRouter } from './routes/photos.js'
import { queensRouter } from './routes/queens.js'
import { visitsRouter } from './routes/visits.js'

const app = express()
const HOST = '127.0.0.1' // CRITICAL: never 0.0.0.0 in production — Nginx is the only entry

// Behind Nginx, so req.ip and the rate limiter must read the forwarded address. `1` = trust
// exactly one proxy hop; trusting all of them would let a client spoof its own IP.
app.set('trust proxy', 1)

app.use(helmet())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// Blanket ceiling on top of the tighter per-route limits (§56).
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  }),
)

app.use(attachUser)

// --- Routes ---

// Health check — used by the GitHub Actions deploy verify step (HEALTH_URL)
app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'connected', timestamp: new Date().toISOString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    res.status(503).json({ ok: false, db: 'disconnected', error: message })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)

// Farm-scoped modules. requireAuth first so an expired session gets a plain 401 rather than
// "you have no farm"; each router then adds requireFarm itself.
app.use('/api/apiaries', requireAuth, apiariesRouter)
app.use('/api/hives', requireAuth, hivesRouter)
app.use('/api/queens', requireAuth, queensRouter)
app.use('/api/inspections', requireAuth, inspectionsRouter)
app.use('/api/visits', requireAuth, visitsRouter)
app.use('/api/photos', requireAuth, photosRouter)

app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Ruta ne postoji' })
})

// --- Error handler (must be last) ---
app.use(errorHandler)

// --- Start ---
async function start() {
  const dbOk = await testConnection()
  if (!dbOk) {
    console.error('Database not reachable. Exiting.')
    process.exit(1)
  }
  app.listen(env.port, HOST, () => {
    console.log(`[moj-pcelinjak-api] listening on ${HOST}:${env.port} (${env.nodeEnv})`)
  })
}

// Graceful shutdown — PM2 reload sends SIGINT/SIGTERM
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log(`${sig} received, closing pool...`)
    await pool.end()
    process.exit(0)
  })
}

start().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
