import { z } from 'zod'

/**
 * Zod pieces shared by the modules added from Etapa 2 onward.
 *
 * The `undefined` handling is the reason this exists as a helper rather than being inlined per
 * route. A PATCH body carries only the fields the user actually touched, so the schema has to keep
 * three states apart: absent (leave the column alone), null (the user cleared it) and a value.
 * Collapsing absent into null silently wipes every field the form did not send — a bug that
 * already cost us a round of debugging in routes/me.ts.
 */

export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v && v.length > 0 ? v : null))

export const nullableDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan datum')
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => (v === undefined ? undefined : v || null))

export const requiredDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan datum')

export const nullableInt = (min: number, max: number) =>
  z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : (v ?? null)))

export const nullableDecimal = (min: number, max: number) =>
  z.coerce
    .number()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : (v ?? null)))

/** mysql2 hands DATE columns back as Date objects; the API always speaks plain YYYY-MM-DD. */
export const asDate = (v: unknown): string | null => {
  if (v instanceof Date) {
    // Local getters, not toISOString(): a DATE read as midnight local time shifts to the previous
    // day in UTC for anyone east of Greenwich, which is all of Croatia.
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  return (v as string | null) ?? null
}

export const asNumber = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

/**
 * Builds the SET / INSERT fragments for a partial update from a camelCase → snake_case map,
 * dropping the fields the request did not send.
 */
export function changedColumns(
  data: Record<string, unknown>,
  columns: Record<string, string>,
): { names: string[]; values: unknown[] } {
  const entries = Object.entries(data).filter(([key, value]) => value !== undefined && columns[key])
  return {
    names: entries.map(([key]) => columns[key]!),
    values: entries.map(([, value]) => value),
  }
}
