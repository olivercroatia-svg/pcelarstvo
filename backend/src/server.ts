import cookieParser from 'cookie-parser'
import express, { type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { pool, testConnection } from './db.js'
import { env } from './env.js'
import { startScheduler } from './lib/scheduler.js'
import { errorHandler } from './middleware/error.js'
import { attachUser, requireAuth } from './middleware/auth.js'
import { adminRouter } from './routes/admin.js'
import { aiRouter } from './routes/ai.js'
import { apiariesRouter } from './routes/apiaries.js'
import { assistantRouter } from './routes/assistant.js'
import { authRouter } from './routes/auth.js'
import { documentsRouter } from './routes/documents.js'
import { analyticsRouter, economicsRouter } from './routes/economics.js'
import { expensesRouter } from './routes/expenses.js'
import { formsRouter } from './routes/forms.js'
import { feedingsRouter, healthEventsRouter } from './routes/health.js'
import { hivesRouter } from './routes/hives.js'
import { inspectionRouter } from './routes/inspection.js'
import { inspectionsRouter } from './routes/inspections.js'
import { inventoryRouter } from './routes/inventory.js'
import { labRouter } from './routes/lab.js'
import { meRouter } from './routes/me.js'
import { notificationsRouter } from './routes/notifications.js'
import { obligationsRouter } from './routes/obligations.js'
import { packagingRouter, productsRouter } from './routes/packaging.js'
import { photosRouter } from './routes/photos.js'
import { batchesRouter, harvestsRouter } from './routes/production.js'
import { queensRouter } from './routes/queens.js'
import { reportRouter } from './routes/report.js'
import { customersRouter, salesRouter } from './routes/sales.js'
import { searchRouter, timelineRouter } from './routes/search.js'
import { pasturesRouter, relocationsRouter, seasonRouter } from './routes/season.js'
import { subsidiesRouter } from './routes/subsidies.js'
import { publicRouter, traceabilityRouter } from './routes/traceability.js'
import { treatmentsRouter, vmpRouter } from './routes/treatments.js'
import { varroaRouter } from './routes/varroa.js'
import { visitsRouter } from './routes/visits.js'
import { weatherRouter } from './routes/weather.js'

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

// Health, law and paperwork. Note /api/health above is the liveness probe and stays public —
// the health record lives at /api/health-events.
app.use('/api/health-events', requireAuth, healthEventsRouter)
app.use('/api/feedings', requireAuth, feedingsRouter)
app.use('/api/varroa', requireAuth, varroaRouter)
app.use('/api/vmp', requireAuth, vmpRouter)
app.use('/api/treatments', requireAuth, treatmentsRouter)
app.use('/api/obligations', requireAuth, obligationsRouter)
app.use('/api/notifications', requireAuth, notificationsRouter)
app.use('/api/documents', requireAuth, documentsRouter)
app.use('/api/forms', requireAuth, formsRouter)
app.use('/api/inspection-mode', requireAuth, inspectionRouter)

// Proizvodnja i sljedivost (§28–§36).
app.use('/api/harvests', requireAuth, harvestsRouter)
app.use('/api/batches', requireAuth, batchesRouter)
app.use('/api/lab', requireAuth, labRouter)
app.use('/api/products', requireAuth, productsRouter)
app.use('/api/packaging', requireAuth, packagingRouter)
app.use('/api/inventory', requireAuth, inventoryRouter)
app.use('/api/traceability', requireAuth, traceabilityRouter)

// Sezona i teren (§19–§21, §47). Not financial, so a worker reaches these — whoever drives the
// hives to the sunflower needs the relocation checklist more than the owner does.
app.use('/api/season', requireAuth, seasonRouter)
app.use('/api/pastures', requireAuth, pasturesRouter)
app.use('/api/relocations', requireAuth, relocationsRouter)
app.use('/api/weather', requireAuth, weatherRouter)

// Reading across every module (§48, §49, §52). Each applies the §4 filter internally: the
// financial slices are omitted from the response for a worker rather than hidden on the screen.
app.use('/api/search', requireAuth, searchRouter)
app.use('/api/timeline', requireAuth, timelineRouter)
app.use('/api/report', requireAuth, reportRouter)
app.use('/api/analytics', requireAuth, analyticsRouter)

// Komercijala (§37–§40, §50–§51). Every one of these routers adds requireOwner of its own: §4 —
// "ne može pristupati financijskim izvještajima" — and these are the only routes that carry a
// price, a cost or a customer. Deliberately grouped together and kept out of routes/inspection.ts,
// which is the screen handed to an inspector (§26).
app.use('/api/customers', requireAuth, customersRouter)
app.use('/api/sales', requireAuth, salesRouter)
app.use('/api/expenses', requireAuth, expensesRouter)
app.use('/api/economics', requireAuth, economicsRouter)
app.use('/api/subsidies', requireAuth, subsidiesRouter)

// AI sloj (§13, §18, §31, §39, §44–§46). Every route behind these two mounts returns a draft or an
// answer and writes to no register: what the beekeeper confirms is saved by the module route above
// that owns the table, with their user id on it. Not financial in themselves, so requireOwner sits
// per route rather than on the mount — reading a receipt (§39) and the cost breakdown are owner's,
// dictating an inspection and photographing a medicine box are not.
//
// routes/inspection.ts reads neither of them, and there is nothing here for it to read: the AI
// layer stores usage figures and conversations, never a fact about the bees.
app.use('/api/ai', requireAuth, aiRouter)
app.use('/api/assistant', requireAuth, assistantRouter)

// §35 — the only unauthenticated data route in the application. Deliberately mounted apart from
// everything else and without requireAuth, so it can never pick up a farm scope by accident: what
// it may reveal is fixed by its own SELECT list, in routes/traceability.ts.
app.use('/api/public', publicRouter)

// §54 — regulatory parameters, system administrators only.
app.use('/api/admin', requireAuth, adminRouter)

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
  // §24 — materialises obligations and raises reminders. Guarded by a MySQL advisory lock, so
  // running several PM2 instances does not multiply the notifications.
  startScheduler()
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
