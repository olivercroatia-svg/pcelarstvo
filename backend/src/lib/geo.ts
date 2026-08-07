/** Great-circle distance in metres. */
export function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

export interface ProximityHit {
  id: string
  name: string
  distanceMetres: number
}

/**
 * §9 — how far the nearest of the beekeeper's other apiaries is.
 *
 * Explicitly NOT a regulatory check. The scenario is emphatic that this is an aid, and the app
 * says so on screen: the legal minimum distances depend on the apiary's category and on local
 * rules we do not model, so the number is shown and the judgement is left to the beekeeper.
 *
 * Distances to railways and roads (also named in §9) would need an external geodata source; that
 * is not wired up, and the UI must not imply it was checked.
 */
export function nearestApiaries(
  lat: number,
  lon: number,
  others: { id: string; name: string; latitude: number | null; longitude: number | null }[],
  limit = 3,
): ProximityHit[] {
  return others
    .filter((a): a is typeof a & { latitude: number; longitude: number } =>
      a.latitude !== null && a.longitude !== null)
    .map((a) => ({
      id: a.id,
      name: a.name,
      distanceMetres: haversineMetres(lat, lon, a.latitude, a.longitude),
    }))
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, limit)
}
