import type { DestinationInput, TripInput } from '@/lib/api/trips'

export function emptyTripInput(homeCurrency: string): TripInput {
  return {
    name: '',
    start_date: null,
    end_date: null,
    status: 'planning',
    home_currency: homeCurrency,
    notes: '',
    destinations: [],
    traveler_ids: [],
  }
}

/** Client-side checks that mirror the server's, so mistakes show before saving. */
export function validateTrip(draft: TripInput): string | null {
  if (!draft.name.trim()) return 'Give the trip a name.'
  const hasStart = Boolean(draft.start_date)
  const hasEnd = Boolean(draft.end_date)
  if (hasStart !== hasEnd) return 'Set both a start and an end date, or leave both empty.'
  if (draft.start_date && draft.end_date && draft.end_date < draft.start_date) {
    return 'The end date must be on or after the start date.'
  }
  return null
}

/** Adding the first destination to an unnamed trip names it after that place. */
export function withDestinations(draft: TripInput, destinations: DestinationInput[]): TripInput {
  const name = !draft.name.trim() && destinations.length > 0 ? destinations[0].name : draft.name
  return { ...draft, name, destinations }
}
