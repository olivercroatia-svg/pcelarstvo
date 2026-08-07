export function formatDecimalInput(value: number): string {
  return String(value)
}

export function parseDecimalInput(value: string): number {
  return Number(value.trim().replace(',', '.'))
}
