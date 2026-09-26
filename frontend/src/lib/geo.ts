export type LatLon = { lat: number; lon: number }

const EARTH_RADIUS_KM = 6371

/** Straight-line distance in km (good enough to compare how central places are). */
export function distanceKm(a: LatLon, b: LatLon): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

/** Average and nearest distance from a place to a set of points, or null with nothing to measure. */
export function distanceSummary(from: LatLon, points: LatLon[]): { average: number; nearest: number } | null {
  if (points.length === 0) return null
  const distances = points.map((p) => distanceKm(from, p))
  return { average: distances.reduce((sum, d) => sum + d, 0) / distances.length, nearest: Math.min(...distances) }
}
