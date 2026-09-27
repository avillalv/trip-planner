import type { Destination } from '@/lib/api/trips'
import type { SearchCenter } from './place-finder'

// Places this big are searched as a whole by default; the middle of a country is rarely the point.
const LARGE_KINDS = new Set(['country', 'state', 'region', 'county', 'district'])

/** Where "Find a place" looks for a destination: all of it when it's large, else around its middle. */
export function searchCenter(destination: Destination): SearchCenter {
  return {
    lat: destination.lat,
    lon: destination.lon,
    name: destination.name,
    destination: { id: destination.id, large: LARGE_KINDS.has(destination.kind ?? '') },
  }
}
