/** Builds the authenticated deep link encoded on a hive's QR label. */
export function hiveScanUrl(qrToken: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}skeniraj/${qrToken}`
}

/** Builds the public deep link printed on a packaged jar. */
export function jarUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}staklenka/${token}`
}
