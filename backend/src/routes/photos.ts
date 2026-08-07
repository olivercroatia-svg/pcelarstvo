import { createReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { requireFarm } from '../middleware/farm.js'

export const photosRouter = Router()
photosRouter.use(requireFarm)

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

// 3 MB is deliberately tight. The client downscales to 1600px before uploading (see
// frontend/src/lib/image.ts) — partly to save a VPS disk, mostly because the upload happens on a
// hillside with one bar of signal, and a 5 MB original would simply never finish.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
})

const ENTITY_TYPES = ['hive_inspection', 'hive', 'apiary'] as const

const metaSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().trim().min(1),
  caption: z.string().trim().max(255).optional(),
  width: z.coerce.number().int().min(1).max(20000).optional(),
  height: z.coerce.number().int().min(1).max(20000).optional(),
})

/** Files live outside the served tree; every read goes through the authenticated route below. */
function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), '../uploads')
}

/** Confirms the target record is this farm's before a photo can be attached to it. */
async function assertEntityBelongs(farmId: string, entityType: string, entityId: string) {
  const table = { hive_inspection: 'hive_inspections', hive: 'hives', apiary: 'apiaries' }[entityType]
  if (!table) throw badRequest('Nepoznata vrsta zapisa')

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id FROM ${table} WHERE id = ? AND farm_id = ? LIMIT 1`,
    [entityId, farmId],
  )
  if (rows.length === 0) throw notFound('Zapis nije pronađen')
}

photosRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    if (!req.file) throw badRequest('Nije priložena datoteka')

    const ext = ALLOWED.get(req.file.mimetype)
    if (!ext) throw badRequest('Podržane su samo JPEG, PNG i WebP slike')

    const meta = metaSchema.parse(req.body)
    await assertEntityBelongs(farmId, meta.entityType, meta.entityId)

    const id = newId()
    const now = new Date()
    const relative = path.join(
      farmId,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      `${id}.${ext}`,
    )
    const absolute = path.join(uploadRoot(), relative)

    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, req.file.buffer)

    try {
      await pool.query(
        `INSERT INTO photos
           (id, farm_id, entity_type, entity_id, file_path, mime_type, size_bytes, width, height, caption, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          farmId,
          meta.entityType,
          meta.entityId,
          relative,
          req.file.mimetype,
          req.file.size,
          meta.width ?? null,
          meta.height ?? null,
          meta.caption ?? null,
          req.user!.id,
        ],
      )
    } catch (err) {
      // Do not leave an orphan on disk if the row fails to write.
      await unlink(absolute).catch(() => {})
      throw err
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'photo.upload',
      entityType: 'photo',
      entityId: id,
      after: { entityType: meta.entityType, entityId: meta.entityId, size: req.file.size },
    })

    res.status(201).json({ photo: { id, caption: meta.caption ?? null } })
  }),
)

photosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = z
      .object({ entityType: z.enum(ENTITY_TYPES), entityId: z.string().trim().min(1) })
      .parse(req.query)

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, caption, width, height, created_at FROM photos
        WHERE farm_id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL
        ORDER BY created_at`,
      [req.farm!.id, q.entityType, q.entityId],
    )

    res.json({
      photos: rows.map((r) => ({
        id: r.id as string,
        caption: (r.caption as string | null) ?? null,
        width: r.width === null ? null : Number(r.width),
        height: r.height === null ? null : Number(r.height),
        createdAt: (r.created_at as Date).toISOString(),
      })),
    })
  }),
)

/**
 * §56 — photos are never served by Nginx as static files. A hive photo can show an apiary's
 * surroundings, and the whole point of keeping locations private is lost if the image URL works
 * for anyone who has it.
 */
photosRouter.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT file_path, mime_type FROM photos WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.farm!.id],
    )
    const row = rows[0]
    if (!row) throw notFound('Slika nije pronađena')

    res.setHeader('Content-Type', row.mime_type as string)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    createReadStream(path.join(uploadRoot(), row.file_path as string))
      .on('error', () => res.status(404).json({ error: 'Datoteka nije dostupna' }))
      .pipe(res)
  }),
)

photosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id FROM photos WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.farm!.id],
    )
    if (rows.length === 0) throw notFound('Slika nije pronađena')

    // Soft delete only — the file stays on disk. A photo attached to a treatment or an inspection
    // is part of the record an inspector may ask about (§26).
    await pool.query('UPDATE photos SET deleted_at = NOW() WHERE id = ?', [req.params.id])
    res.status(204).end()
  }),
)
