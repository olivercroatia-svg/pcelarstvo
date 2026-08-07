import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { ApiError } from '../lib/http.js'

/** Must be registered last. Turns anything thrown in a route into a JSON response. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    // Field-level messages so the form can highlight the offending input rather than showing a
    // single generic "invalid data" toast.
    const fields: Record<string, string> = {}
    for (const issue of err.issues) {
      const key = issue.path.join('.') || '_'
      if (!fields[key]) fields[key] = issue.message
    }
    res.status(400).json({ error: 'Podaci nisu ispravni', fields })
    return
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, code: err.code })
    return
  }

  console.error('[unhandled]', err)
  res.status(500).json({ error: 'Došlo je do pogreške na poslužitelju' })
}
