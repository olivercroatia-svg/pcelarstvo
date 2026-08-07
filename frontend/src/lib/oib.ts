/**
 * Croatian OIB check digit (ISO 7064, MOD 11,10).
 *
 * Intentionally duplicated from backend/src/lib/oib.ts: the client copy gives instant feedback
 * while typing, the server copy is the one that decides. Client validation is a courtesy, never a
 * guarantee — the server must re-check regardless, so a shared package would buy little here.
 */
export function isValidOib(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false

  let remainder = 10
  for (let i = 0; i < 10; i++) {
    remainder = (remainder + Number(value[i])) % 10
    if (remainder === 0) remainder = 10
    remainder = (remainder * 2) % 11
  }

  return (11 - remainder) % 10 === Number(value[10])
}
