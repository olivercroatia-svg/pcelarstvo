import type { PoolConnection, RowDataPacket } from 'mysql2/promise'

/**
 * §28 — "Aplikacija stvara LOT: KAD-260524-01".
 *
 * Three parts: three letters from the pasture, the extraction date as YYMMDD, and a sequence
 * within that farm, prefix and day. Short enough to read off a jar over the phone, and it says
 * what it is without a lookup — which is the whole point of a beekeeper's LOT code as opposed to
 * a database id.
 *
 * The code is assigned by the server and never accepted from the client. A LOT that a client
 * could choose is a LOT two clients can choose identically.
 */

/**
 * Croatian diacritics have no place in a code that gets typed into a search box, read over the
 * phone, and printed by a thermal printer whose character set is anyone's guess.
 */
const FOLD: Record<string, string> = {
  Č: 'C', Ć: 'C', Š: 'S', Ž: 'Z', Đ: 'D',
  č: 'C', ć: 'C', š: 'S', ž: 'Z', đ: 'D',
}

/** "Kadulja" → "KAD", "Šumska medljika" → "SUM", "Lipa" → "LIP", "Ž" → "ZXX". */
export function lotPrefix(pasture: string): string {
  const folded = [...pasture.trim()]
    .map((ch) => FOLD[ch] ?? ch)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')

  // Padded rather than shortened: a prefix of variable length would make the code impossible to
  // parse by eye, and "MED" is a better fallback than an empty segment.
  return (folded || 'MED').slice(0, 3).padEnd(3, 'X')
}

/** "2026-05-24" → "260524". */
export function lotDatePart(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${y!.slice(2)}${m}${d}`
}

/**
 * Next free code for this farm, prefix and day.
 *
 * Read inside the caller's transaction, and the UNIQUE (farm_id, lot_code) index is what actually
 * guarantees uniqueness — two harvests recorded in the same second would otherwise both read
 * sequence 0 and both try -01. The caller retries on the duplicate-key error.
 */
export async function nextLotCode(
  conn: PoolConnection,
  farmId: string,
  pasture: string,
  harvestedOn: string,
): Promise<string> {
  const stem = `${lotPrefix(pasture)}-${lotDatePart(harvestedOn)}`

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT lot_code FROM honey_batches
      WHERE farm_id = ? AND lot_code LIKE ?
      ORDER BY lot_code DESC LIMIT 1`,
    [farmId, `${stem}-%`],
  )

  const last = rows[0]?.lot_code as string | undefined
  const used = last ? Number.parseInt(last.slice(stem.length + 1), 10) : 0
  const next = (Number.isFinite(used) ? used : 0) + 1

  // Two digits covers 99 extractions of one pasture on one day at one holding; beyond that the
  // code simply grows a digit rather than wrapping back onto an existing LOT.
  return `${stem}-${String(next).padStart(2, '0')}`
}
