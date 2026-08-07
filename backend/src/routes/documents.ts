import { createReadStream } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import type { RowDataPacket } from 'mysql2'
import { z } from 'zod'
import { pool } from '../db.js'
import { writeAudit } from '../lib/audit.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/http.js'
import { newId } from '../lib/ids.js'
import { asDate, asNumber, changedColumns, nullableDate, nullableText } from '../lib/schema.js'
import { resolveUploadRoot } from '../lib/storage.js'
import { requireFarm } from '../middleware/farm.js'

/** §22 — the document archive. */
export const documentsRouter = Router()
documentsRouter.use(requireFarm)

export const DOCUMENT_CATEGORIES = [
  'registration',
  'annual_report',
  'pasture',
  'veterinary',
  'food_safety',
  'laboratory',
  'subsidy',
  'receipt',
  'other',
] as const

const ALLOWED = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

// 10 MB, five times the photo limit: a scanned rješenje is a multi-page PDF from a flatbed and
// cannot be downscaled in the browser the way a hive photo can.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})

function mapDocument(row: RowDataPacket) {
  const expiresOn = asDate(row.expires_on)
  const today = new Date().toISOString().slice(0, 10)
  return {
    id: row.id as string,
    category: row.category as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    fileName: (row.file_name as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: asNumber(row.size_bytes),
    hasFile: Boolean(row.file_path),
    issuedOn: asDate(row.issued_on),
    expiresOn,
    expired: expiresOn !== null && expiresOn < today,
    referenceNumber: (row.reference_number as string | null) ?? null,
    issuer: (row.issuer as string | null) ?? null,
    entityType: (row.entity_type as string | null) ?? null,
    entityId: (row.entity_id as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }
}

documentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = z
      .object({
        category: z.enum(DOCUMENT_CATEGORIES).optional(),
        entityType: z.string().trim().max(40).optional(),
        entityId: z.string().trim().max(36).optional(),
      })
      .parse(req.query)

    const filters = ['farm_id = ?', 'deleted_at IS NULL']
    const params: unknown[] = [req.farm!.id]
    if (query.category) {
      filters.push('category = ?')
      params.push(query.category)
    }
    if (query.entityType && query.entityId) {
      filters.push('entity_type = ? AND entity_id = ?')
      params.push(query.entityType, query.entityId)
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM documents WHERE ${filters.join(' AND ')} ORDER BY COALESCE(issued_on, created_at) DESC`,
      params,
    )
    const [counts] = await pool.query<RowDataPacket[]>(
      'SELECT category, COUNT(*) AS total FROM documents WHERE farm_id = ? AND deleted_at IS NULL GROUP BY category',
      [req.farm!.id],
    )

    res.json({
      documents: rows.map(mapDocument),
      countsByCategory: Object.fromEntries(counts.map((r) => [r.category as string, Number(r.total)])),
    })
  }),
)

const metaFields = {
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(2, 'Unesite naziv dokumenta').max(255),
  description: nullableText(2000),
  issuedOn: nullableDate,
  expiresOn: nullableDate,
  referenceNumber: nullableText(150),
  issuer: nullableText(200),
  entityType: nullableText(40),
  entityId: nullableText(36),
}

const COLUMNS: Record<string, string> = {
  category: 'category',
  title: 'title',
  description: 'description',
  issuedOn: 'issued_on',
  expiresOn: 'expires_on',
  referenceNumber: 'reference_number',
  issuer: 'issuer',
  entityType: 'entity_type',
  entityId: 'entity_id',
}

/**
 * The file is optional. §22 is an archive of what the beekeeper holds, and recording that a
 * rješenje exists with its number and date is already useful — forcing a scan first would just
 * mean the archive stays empty.
 */
documentsRouter.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const meta = z.object(metaFields).parse(req.body)
    const id = newId()

    let relative: string | null = null
    let absolute: string | null = null

    if (req.file) {
      const ext = ALLOWED.get(req.file.mimetype)
      if (!ext) throw badRequest('Podržani su PDF, JPEG, PNG i WebP')

      const now = new Date()
      relative = path.join(farmId, 'documents', String(now.getFullYear()), `${id}.${ext}`)
      absolute = path.join(resolveUploadRoot(), relative)
      await mkdir(path.dirname(absolute), { recursive: true })
      await writeFile(absolute, req.file.buffer)
    }

    try {
      const { names, values } = changedColumns(meta, COLUMNS)
      await pool.query(
        `INSERT INTO documents
           (id, farm_id, created_by, file_path, file_name, mime_type, size_bytes${names.length ? ', ' + names.join(', ') : ''})
         VALUES (?, ?, ?, ?, ?, ?, ?${names.length ? ', ' + names.map(() => '?').join(', ') : ''})`,
        [
          id,
          farmId,
          req.user!.id,
          relative,
          req.file?.originalname?.slice(0, 255) ?? null,
          req.file?.mimetype ?? null,
          req.file?.size ?? null,
          ...values,
        ],
      )
    } catch (err) {
      if (absolute) await unlink(absolute).catch(() => {})
      throw err
    }

    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'document.create',
      entityType: 'document',
      entityId: id,
      after: { category: meta.category, title: meta.title, hasFile: Boolean(req.file) },
    })

    const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM documents WHERE id = ?', [id])
    res.status(201).json({ document: mapDocument(rows[0]!) })
  }),
)

documentsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const farmId = req.farm!.id
    const [existing] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM documents WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    const before = existing[0]
    if (!before) throw notFound('Dokument nije pronađen')

    const data = z
      .object({ ...metaFields, category: metaFields.category.optional(), title: metaFields.title.optional() })
      .parse(req.body)
    const { names, values } = changedColumns(data, COLUMNS)
    if (names.length > 0) {
      await pool.query(
        `UPDATE documents SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE id = ? AND farm_id = ?`,
        [...values, before.id, farmId],
      )
    }

    const [after] = await pool.query<RowDataPacket[]>('SELECT * FROM documents WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'document.update',
      entityType: 'document',
      entityId: before.id as string,
      before: mapDocument(before),
      after: mapDocument(after[0]!),
    })
    res.json({ document: mapDocument(after[0]!) })
  }),
)

/**
 * §56 — never served as a static file. A scanned rješenje carries an OIB and a home address, so
 * the only way to it is through this route, behind the session and scoped to the farm.
 */
documentsRouter.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT file_path, mime_type, file_name FROM documents WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, req.farm!.id],
    )
    const row = rows[0]
    if (!row || !row.file_path) throw notFound('Datoteka nije pronađena')

    res.setHeader('Content-Type', (row.mime_type as string) ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    // inline, not attachment: the beekeeper showing an inspector a document wants it on screen,
    // not in the downloads folder.
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent((row.file_name as string) ?? 'dokument')}`,
    )
    createReadStream(path.join(resolveUploadRoot(), row.file_path as string))
      .on('error', () => res.status(404).json({ error: 'Datoteka nije dostupna' }))
      .pipe(res)
  }),
)

documentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.farm!.role !== 'owner') throw forbidden('Dokument može obrisati samo vlasnik')
    const farmId = req.farm!.id
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT * FROM documents WHERE id = ? AND farm_id = ? AND deleted_at IS NULL LIMIT 1',
      [req.params.id, farmId],
    )
    const before = rows[0]
    if (!before) throw notFound('Dokument nije pronađen')

    // Soft delete, file left on disk: a document referenced by a filed obligation is part of the
    // record an inspector may ask about.
    await pool.query('UPDATE documents SET deleted_at = NOW() WHERE id = ?', [before.id])
    await writeAudit(req, {
      userId: req.user!.id,
      farmId,
      action: 'document.delete',
      entityType: 'document',
      entityId: before.id as string,
      before: mapDocument(before),
    })
    res.status(204).end()
  }),
)
