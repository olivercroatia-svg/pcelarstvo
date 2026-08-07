/**
 * Croatian has three plural forms, and getting them wrong is the fastest way to make an
 * application look machine-translated: 1 pčelinjak, 2–4 pčelinjaka, 5+ pčelinjaka — but also
 * 21 pčelinjak and 22 pčelinjaka, because the rule reads the last digit, not the number.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10
  const mod100 = Math.abs(count) % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export const counted = (count: number, one: string, few: string, many: string): string =>
  `${count} ${plural(count, one, few, many)}`

export const days = (count: number): string => counted(count, 'dan', 'dana', 'dana')
