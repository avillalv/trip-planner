import type { Trip } from '@/lib/api/trips'

/** Seed for a trip's guilloche pattern: stable for the life of the trip. */
export const tripSeed = (trip: Pick<Trip, 'id'>) => `trip-${trip.id}`

/** "Kyoto Prefecture, Japan" — skips parts that repeat the place's own name. */
export function placeLine(d: { name: string; region?: string | null; country?: string | null }): string {
  return [d.region, d.country].filter((part) => part && part !== d.name).join(', ')
}
