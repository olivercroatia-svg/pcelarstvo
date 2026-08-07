import type { NextFunction, Request, RequestHandler, Response } from 'express'

/** An error with an intended HTTP status. Anything else that escapes becomes a 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const badRequest = (message: string, code?: string) => new ApiError(400, message, code)
export const unauthorized = (message = 'Niste prijavljeni') => new ApiError(401, message)
export const forbidden = (message = 'Nemate ovlasti za ovu radnju') => new ApiError(403, message)
export const notFound = (message = 'Nije pronađeno') => new ApiError(404, message)
export const conflict = (message: string, code?: string) => new ApiError(409, message, code)

/**
 * Express 4 does not forward rejected promises to the error handler, so every async route must be
 * wrapped or a thrown error becomes a silent hang.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
