/** Error carrying the server's per-field validation messages so forms can highlight inputs. */
export class ApiError extends Error {
  // Written out rather than declared as constructor parameter properties: the Vite tsconfig sets
  // `erasableSyntaxOnly`, which rejects that shorthand.
  readonly status: number
  readonly fields?: Record<string, string>
  readonly code?: string

  constructor(status: number, message: string, fields?: Record<string, string>, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fields = fields
    this.code = code
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

// In production the SPA lives under a subpath and Nginx proxies /api from that same prefix; in dev
// Vite proxies it. BASE_URL always carries the trailing slash.
const API_BASE = `${import.meta.env.BASE_URL}api`

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      // Session lives in an httpOnly cookie, so it has to ride along explicitly.
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Nema veze s poslužiteljem. Provjerite internetsku vezu.')
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload?.error as string | undefined) ?? 'Došlo je do pogreške',
      payload?.fields as Record<string, string> | undefined,
      payload?.code as string | undefined,
    )
  }

  return payload as T
}
