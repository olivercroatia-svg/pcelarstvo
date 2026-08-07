import { randomBytes } from 'node:crypto'

/**
 * 128 bits of randomness as 22 base64url characters — the handle printed on a hive's QR label.
 *
 * Unguessable on purpose: the label is a physical object anyone standing at the apiary can
 * photograph, so it must not be derivable from the hive code and must not be the record's id.
 * Scanning it still requires a signed-in session; the token only says *which* hive.
 */
export function newQrToken(): string {
  return randomBytes(16).toString('base64url')
}
