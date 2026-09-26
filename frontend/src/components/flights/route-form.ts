import type { RouteInput } from '@/lib/api/flights'
import type { Trip } from '@/lib/api/trips'
import { daysBetween, parseDate, toISODate } from '@/lib/dates'

const addDays = (iso: string, days: number) => {
  const d = parseDate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/** Sensible starting values from the trip: home airports, dates around the trip, its length. */
export function defaultRoute(trip: Trip, today: Date = new Date()): RouteInput {
  const todayIso = toISODate(today)
  const origins = [...new Set(trip.travelers.flatMap((t) => t.home_airports))].slice(0, 4)
  let departFrom: string
  let departTo: string
  let nights: number
  if (trip.start_date && trip.end_date) {
    departFrom = addDays(trip.start_date, -2)
    departTo = addDays(trip.start_date, 2)
    nights = Math.max(1, daysBetween(parseDate(trip.start_date), parseDate(trip.end_date)))
  } else {
    departFrom = addDays(todayIso, 30)
    departTo = addDays(todayIso, 44)
    nights = 7
  }
  if (departFrom < todayIso) departFrom = todayIso
  if (departTo < departFrom) departTo = departFrom
  return {
    label: null,
    origin_codes: origins,
    destination_codes: [],
    trip_type: 'round_trip',
    depart_from: departFrom,
    depart_to: departTo,
    return_from: null,
    return_to: null,
    min_nights: Math.max(1, nights - 1),
    max_nights: nights + 1,
    adults: Math.max(1, trip.travelers.length),
    children: 0,
    cabin: 'economy',
    max_stops: null,
    sources: ['serpapi', 'travelpayouts'],
    alert_price: null,
    active: true,
  }
}

export type ReturnMode = 'nights' | 'window'

/** Switch between "trip length" and "return dates" without losing the other mode's defaults. */
export function withReturnMode(route: RouteInput, mode: ReturnMode): RouteInput {
  if (mode === 'nights') {
    return { ...route, return_from: null, return_to: null, min_nights: route.min_nights ?? 5, max_nights: route.max_nights ?? 9 }
  }
  const min = route.min_nights ?? 5
  const max = route.max_nights ?? 9
  return {
    ...route,
    min_nights: null,
    max_nights: null,
    return_from: route.return_from ?? addDays(route.depart_from, min),
    return_to: route.return_to ?? addDays(route.depart_to, max),
  }
}

export function returnMode(route: RouteInput): ReturnMode {
  return route.return_from ? 'window' : 'nights'
}

export function validateRoute(route: RouteInput): string | null {
  if (route.origin_codes.length === 0) return 'Add at least one airport to fly from.'
  if (route.destination_codes.length === 0) return 'Add at least one airport to fly to.'
  if (route.depart_to < route.depart_from) return 'The departure window must end on or after it starts.'
  if (!route.sources?.length) return 'Choose at least one place to look for prices.'
  return null
}
