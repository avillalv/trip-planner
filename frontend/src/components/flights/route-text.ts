import type { FlightRoute, Quote } from '@/lib/api/flights'
import { daysBetween, parseDate } from '@/lib/dates'

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const CABINS: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
}

export function formatShortDate(iso: string): string {
  return shortDate.format(parseDate(iso))
}

/** "Nov 5 – 10", or "Nov 28 – Dec 4" across months. */
function range(from: string, to: string): string {
  return from === to ? formatShortDate(from) : shortDate.formatRange(parseDate(from), parseDate(to))
}

export function stopsText(stops: number | null | undefined): string {
  if (stops === null || stops === undefined) return '—'
  return stops === 0 ? 'Nonstop' : `${stops} stop${stops > 1 ? 's' : ''}`
}

/** "Round trip · leave Nov 5–10 · 7–10 nights · 2 adults · Economy · any stops" */
export function routeDescription(route: FlightRoute): string {
  const parts = [route.trip_type === 'one_way' ? 'One way' : 'Round trip', `leave ${range(route.depart_from, route.depart_to)}`]
  if (route.min_nights && route.max_nights) {
    parts.push(route.min_nights === route.max_nights ? `${route.min_nights} nights` : `${route.min_nights}–${route.max_nights} nights`)
  } else if (route.return_from && route.return_to) {
    parts.push(`return ${range(route.return_from, route.return_to)}`)
  }
  const people = [`${route.adults} adult${route.adults > 1 ? 's' : ''}`]
  if (route.children) people.push(`${route.children} child${route.children > 1 ? 'ren' : ''}`)
  parts.push(people.join(', '), CABINS[route.cabin] ?? route.cabin)
  parts.push(route.max_stops === null ? 'any stops' : route.max_stops === 0 ? 'nonstop' : `up to ${route.max_stops} stop${route.max_stops > 1 ? 's' : ''}`)
  return parts.join(' · ')
}

/** "Nov 5 → Nov 15 · 10 nights" */
export function quoteDates(quote: Pick<Quote, 'depart_date' | 'return_date'>): string {
  if (!quote.return_date) return `${formatShortDate(quote.depart_date)} · one way`
  const nights = daysBetween(parseDate(quote.depart_date), parseDate(quote.return_date))
  return `${formatShortDate(quote.depart_date)} → ${formatShortDate(quote.return_date)} · ${nights} night${nights === 1 ? '' : 's'}`
}
