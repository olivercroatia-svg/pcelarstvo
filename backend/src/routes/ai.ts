import { Router } from 'express'
import multer from 'multer'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import {
  isConfigured,
  settings,
  spend,
  toEur,
  type AiContext,
  type ImageMediaType,
} from '../lib/ai.js'
import { asyncHandler, badRequest } from '../lib/http.js'
import { describePhoto, readLabReport, readReceipt, readVmpLabel } from '../lib/vision.js'
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  recordTranscription,
  structureInspection,
  transcribe,
  vocabulary,
} from '../lib/voice.js'
import { requireFarm, requireOwner } from '../middleware/farm.js'

/**
 * The one-shot AI helpers (§13, §18, §31, §39, §44) plus the meter that watches them.
 *
 * Every route here returns a DRAFT and writes nothing to a register. The photograph and the audio
 * are held in memory, sent to the provider, and dropped — none of it reaches uploads/, which is
 * the same §56 reasoning that keeps hive photos behind an authenticated route: a picture of a
 * receipt carries a supplier, an address and a price, and the copy that never exists is the copy
 * that never leaks. What the beekeeper confirms is saved by the ordinary module route, with their
 * user id on it.
 */
export const aiRouter = Router()
aiRouter.use(requireFarm)

const IMAGE_TYPES = new Map<string, ImageMediaType>([
  ['image/jpeg', 'image/jpeg'],
  ['image/png', 'image/png'],
  ['image/webp', 'image/webp'],
])

// 5 MB rather than the 3 MB of the photo route: the client downscales diary photos to 1600 px, but
// a laboratory finding is dense text and is worth sending at the higher resolution Claude Sonnet 5
// accepts (2576 px on the long edge).
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
})

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1 },
})

const AUDIO_TYPES = new Set([
  'audio/webm', // Chrome, Android
  'audio/mp4', // Safari, iOS — the reason MediaRecorder output cannot be assumed to be webm
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
])

function context(req: Parameters<typeof requireFarm>[0], feature: AiContext['feature']): AiContext {
  return { farmId: req.farm!.id, userId: req.user?.id ?? null, feature }
}

function image(req: { file?: Express.Multer.File }): { base64: string; mediaType: ImageMediaType } {
  if (!req.file) throw badRequest('Slika nije priložena', 'no_file')
  // multer's mimetype comes from the client, so it is a hint rather than a fact — but the model is
  // the only consumer and it tolerates a mislabelled JPEG, so a magic-byte check would buy nothing
  // here that it buys in routes/photos.ts, where the file is written to disk.
  const mediaType = IMAGE_TYPES.get(req.file.mimetype)
  if (!mediaType) throw badRequest('Podržani formati su JPEG, PNG i WebP', 'bad_type')
  return { base64: req.file.buffer.toString('base64'), mediaType }
}

// ── §18 / §31 / §39 / §44 — reading a photograph ────────────────────────────

aiRouter.post(
  '/read/vmp',
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    res.json({ draft: await readVmpLabel(context(req, 'ocr_vmp'), image(req)) })
  }),
)

aiRouter.post(
  '/read/lab',
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    res.json({ draft: await readLabReport(context(req, 'ocr_lab'), image(req)) })
  }),
)

// §4 — a receipt becomes an expense, and expenses are owner-only. The guard belongs on the route
// that reads the receipt, not only on the one that saves it: a worker who can photograph a receipt
// and see the supplier and the amount has been shown a financial figure either way.
aiRouter.post(
  '/read/receipt',
  requireOwner,
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    res.json({ draft: await readReceipt(context(req, 'ocr_receipt'), image(req)) })
  }),
)

aiRouter.post(
  '/describe',
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    res.json({ description: await describePhoto(context(req, 'photo'), image(req)) })
  }),
)

// ── §13 — voice entry ───────────────────────────────────────────────────────

const voiceSchema = z.object({
  /** Set when the beekeeper scanned a hive QR before speaking, which resolves most ambiguity. */
  hiveCode: z.string().trim().max(40).nullish(),
})

aiRouter.post(
  '/voice',
  uploadAudio.single('audio'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Snimka nije priložena', 'no_file')
    // Safari appends codec parameters — "audio/mp4;codecs=mp4a.40.2" — so compare the type alone.
    const mime = req.file.mimetype.split(';')[0]!.trim()
    if (!AUDIO_TYPES.has(mime)) {
      throw badRequest('Format snimke nije podržan', 'bad_type')
    }
    const { hiveCode } = voiceSchema.parse(req.body)
    const ctx = context(req, 'voice')

    const transcript = await transcribe(req.file.buffer, mime, req.file.originalname || 'snimka')
    await recordTranscription(ctx, transcript.seconds)
    if (transcript.seconds > MAX_AUDIO_SECONDS) {
      throw badRequest(`Snimka je duža od ${MAX_AUDIO_SECONDS} sekundi`, 'too_long')
    }

    const vocab = await vocabulary(req.farm!.id)
    const draft = await structureInspection(
      ctx,
      transcript.text,
      vocab,
      hiveCode ? { code: hiveCode } : null,
    )

    // The model names a hive; the server resolves it. A code that does not belong to this farm
    // simply does not resolve, so there is no path from model output to another farm's row.
    const match = draft.hiveCode
      ? vocab.hives.find((h) => h.code.toUpperCase() === draft.hiveCode!.toUpperCase())
      : undefined

    res.json({
      transcript: transcript.text,
      seconds: transcript.seconds,
      draft,
      hive: match ? { id: match.id, code: match.code, apiary: match.apiary } : null,
    })
  }),
)

// ── the meter ───────────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  assistant: 'AI asistent',
  summary: 'Dnevni sažetak',
  voice: 'Glasovni unos',
  transcribe: 'Prepoznavanje govora',
  ocr_vmp: 'Čitanje kutije VMP-a',
  ocr_lab: 'Čitanje lab. nalaza',
  ocr_receipt: 'Čitanje računa',
  photo: 'Opis fotografije',
}

/**
 * What the UI asks before it draws a single AI button. An application that offers a microphone and
 * then answers 503 has wasted the beekeeper's time twice — once tapping it, once reading why.
 */
aiRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const s = await settings()
    const used = await spend(req.farm!.id)

    // §4 — the euro figures are the owner's. A worker gets the booleans and `capReached`, which is
    // everything the UI needs to decide whether to draw a microphone, and no amount of money. "AI
    // funkcije su iskorištene za ovaj mjesec" tells them what they need; "0,80 € od 5,00 €" is a
    // financial figure, and this route is reached by both roles on every screen load.
    const owner = req.farm!.role === 'owner'
    res.json({
      available: isConfigured() && s.enabled,
      assistant: isConfigured() && s.enabled && s.assistantEnabled,
      voice: Boolean(process.env.GROQ_API_KEY) && isConfigured() && s.enabled,
      capReached: !used.allowed,
      ...(owner ? { usedEur: toEur(used.usedMicros), capEur: toEur(used.capMicros) } : {}),
    })
  }),
)

/**
 * §4 — the breakdown is a cost report, so it is the owner's. A worker still gets /status, because
 * knowing the microphone is unavailable this month is not a financial disclosure.
 */
aiRouter.get(
  '/usage',
  requireOwner,
  asyncHandler(async (req, res) => {
    const used = await spend(req.farm!.id)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT feature,
              COUNT(*)                AS calls,
              SUM(cost_micros)        AS micros,
              SUM(NOT ok)             AS failures
         FROM ai_usage
        WHERE farm_id = ? AND created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
        GROUP BY feature
        ORDER BY micros DESC`,
      [req.farm!.id],
    )
    res.json({
      usedEur: toEur(used.usedMicros),
      capEur: toEur(used.capMicros),
      capReached: !used.allowed,
      breakdown: rows.map((r) => ({
        feature: r.feature as string,
        label: FEATURE_LABELS[r.feature as string] ?? (r.feature as string),
        calls: Number(r.calls),
        failures: Number(r.failures),
        eur: toEur(Number(r.micros ?? 0)),
      })),
    })
  }),
)
