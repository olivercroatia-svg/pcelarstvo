/** Croatian display formatting shared by the Etapa 2 screens. */

/** "2026-08-07" → "7. 8. 2026." */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)}. ${Number(m)}. ${y}.`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}. · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Decimal comma, and no trailing ",00" on whole numbers. */
export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—'
  const fixed = Number.isInteger(value) ? String(value) : value.toFixed(decimals)
  return fixed.replace('.', ',')
}

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysUntil(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / 86_400_000)
}

/** "prije 3 dana" / "danas" / "jučer" — the register is read in relative time far more than absolute. */
export function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'danas'
  if (days === 1) return 'jučer'
  return `prije ${days} dana`
}

/**
 * Croatian has three plural forms and getting them wrong is the fastest way to make an app look
 * machine-translated: 1 dan, 2–4 dana, 5+ dana, but also 21 dan and 22 dana.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const days = (n: number) => `${n} ${plural(n, 'dan', 'dana', 'dana')}`
