import type { BookedFlightInput, FlightRoute } from '@/lib/api/flights'
import type { Trip } from '@/lib/api/trips'

export type LegDraft = {
  direction: 'out' | 'back'
  flightNumber: string
  from: string
  to: string
  /** datetime-local values: "2026-11-25T15:17", local at the airport. */
  departs: string
  arrives: string
}

/** Form state: numbers stay strings until saved, so fields can be empty or half-typed. */
export type BookedDraft = {
  airline: string
  price: string
  travelers: string
  currency: string
  legs: LegDraft[]
}

export const emptyLeg = (direction: LegDraft['direction'], from = ''): LegDraft => ({
  direction,
  flightNumber: '',
  from,
  to: '',
  departs: '',
  arrives: '',
})

/** One outbound and one return flight to start with; more can be added. */
export function newBookedDraft(route: FlightRoute, trip: Trip): BookedDraft {
  return {
    airline: '',
    price: '',
    travelers: String(route.adults + route.children),
    currency: trip.home_currency,
    legs: [emptyLeg('out', route.origin_codes[0]), emptyLeg('back', route.destination_codes[0])],
  }
}

const AIRPORT = /^[A-Za-z]{3}$/

export function validateBooked(draft: BookedDraft): string | null {
  if (!draft.airline.trim()) return 'Enter the airline.'
  const price = Number(draft.price)
  if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) return 'Enter the price per person as a number, like 374.89.'
  const travelers = Number(draft.travelers)
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 17) return 'Enter how many travelers, from 1 to 17.'
  if (!draft.legs.some((l) => l.direction === 'out')) return 'Add at least one outbound leg.'
  for (const [i, leg] of draft.legs.entries()) {
    const name = `Leg ${i + 1}`
    if (leg.flightNumber.trim().length < 2) return `${name}: enter the flight number, like CM 467.`
    if (!AIRPORT.test(leg.from.trim()) || !AIRPORT.test(leg.to.trim())) return `${name}: enter 3-letter airport codes, like RDU.`
    if (!leg.departs || !leg.arrives) return `${name}: enter when it departs and arrives.`
  }
  return null
}

/** The request for a valid draft. Outbound legs come first, each direction in the order entered. */
export function toBookedRequest(draft: BookedDraft): BookedFlightInput {
  const segment = (leg: LegDraft) => ({
    direction: leg.direction,
    flight_number: leg.flightNumber.trim(),
    origin: leg.from.trim().toUpperCase(),
    destination: leg.to.trim().toUpperCase(),
    depart_at: leg.departs,
    arrive_at: leg.arrives,
  })
  return {
    airline: draft.airline.trim(),
    price_per_person: draft.price.trim(),
    currency: draft.currency,
    passengers: Number(draft.travelers),
    segments: [...draft.legs.filter((l) => l.direction === 'out'), ...draft.legs.filter((l) => l.direction === 'back')].map(segment),
  }
}
