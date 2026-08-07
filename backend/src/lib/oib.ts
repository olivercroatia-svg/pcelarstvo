/**
 * Croatian OIB check digit (ISO 7064, MOD 11,10).
 *
 * Worth validating rather than storing whatever was typed: the OIB is copied straight onto the
 * generated legal forms (§25), where a transposed digit is discovered by the recipient, not by us.
 */
export function isValidOib(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false

  let remainder = 10
  for (let i = 0; i < 10; i++) {
    remainder = (remainder + Number(value[i])) % 10
    if (remainder === 0) remainder = 10
    remainder = (remainder * 2) % 11
  }

  const checkDigit = (11 - remainder) % 10
  return checkDigit === Number(value[10])
}
