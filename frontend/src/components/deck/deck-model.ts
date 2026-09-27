import type { Lodging } from '@/lib/api/lodging'
import type { DeckDay, DeckDestination, DeckRoute, Presentation } from '@/lib/api/presentation'
import { daysBetween, parseDate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'

export type Slide =
  | { kind: 'title'; key: string; label: string }
  | { kind: 'destination'; key: string; label: string; destination: DeckDestination; position: number }
  | { kind: 'flights'; key: string; label: string; route: DeckRoute }
  | { kind: 'lodging'; key: string; label: string }
  | { kind: 'day'; key: string; label: string; day: DeckDay; number: number | null }
  | { kind: 'closing'; key: string; label: string }

const longDay = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const stampDay = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short' })

/** "Monday, November 9" */
export function formatDayLong(iso: string): string {
  return longDay.format(parseDate(iso))
}

/** "09 Nov", as an entry stamp prints it. */
export function formatStampDay(iso: string): string {
  return stampDay.format(parseDate(iso))
}

/** The route's own name, or "LAX → NRT, HND". */
export function routeTitle(route: DeckRoute['route']): string {
  return route.label || `${route.origin_codes.join(', ')} → ${route.destination_codes.join(', ')}`
}

export function lodgingHeading(options: Lodging[]): string {
  if (options.some((o) => o.status === 'booked')) return 'Where we’ll stay'
  if (options.some((o) => o.status === 'shortlisted' || o.favorite)) return 'Places we like'
  return 'Places we’re considering'
}

/** Day 1 is the trip's first day; days outside the trip's dates have no number. */
export function dayNumber(trip: Presentation['trip'], iso: string): number | null {
  if (!trip.start_date || !trip.end_date || iso < trip.start_date || iso > trip.end_date) return null
  return daysBetween(parseDate(trip.start_date), parseDate(iso)) + 1
}

/** Title, destinations, flights, lodging, each day, and a closing summary; empty sections are skipped. */
export function buildSlides(deck: Presentation): Slide[] {
  const slides: Slide[] = [{ kind: 'title', key: 'title', label: deck.trip.name }]
  deck.destinations.forEach((destination, i) =>
    slides.push({
      kind: 'destination',
      key: `destination-${destination.id}`,
      label: destination.name,
      destination,
      position: i + 1,
    }),
  )
  for (const route of deck.routes) {
    slides.push({ kind: 'flights', key: `route-${route.route.id}`, label: `Flights: ${routeTitle(route.route)}`, route })
  }
  if (deck.lodging.length > 0) slides.push({ kind: 'lodging', key: 'lodging', label: lodgingHeading(deck.lodging) })
  for (const day of deck.days) {
    const number = dayNumber(deck.trip, day.day)
    slides.push({
      kind: 'day',
      key: `day-${day.day}`,
      label: `${number ? `Day ${number}: ` : ''}${day.title || formatDayLong(day.day)}`,
      day,
      number,
    })
  }
  slides.push({ kind: 'closing', key: 'closing', label: 'Trip at a glance' })
  return slides
}

/** A fare's price in the trip's currency when converted, else as quoted. */
export function farePrice(quote: DeckRoute['options'][number]): { amount: number; currency: string } {
  return quote.price_home !== null
    ? { amount: Number(quote.price_home), currency: quote.home_currency }
    : { amount: Number(quote.price_total), currency: quote.currency }
}

/** "$1 ≈ ¥150", or "$100 ≈ €92" when a single unit would round away the difference. */
export function exchangeText(home: string, local: string, rate: number): string {
  const base = rate >= 10 ? 1 : rate >= 1 ? 10 : 100
  return `${formatMoney(base, home)} ≈ ${formatMoney(base * rate, local)}`
}

export type ClosingFacts = {
  plans: number
  ideas: number
  /** The chosen flight when there is one, else the cheapest fare. */
  fare: { perPerson: number; currency: string; route: string; chosen: boolean } | null
  booked: Lodging | null
  shortlisted: number
  /** Whether those are a shortlist, not just every option still considered. */
  onShortlist: boolean
}

export function closingFacts(deck: Presentation): ClosingFacts {
  let fare: ClosingFacts['fare'] = null
  for (const { route, options, chosen } of deck.routes) {
    const best = chosen ?? options[0]
    if (!best) continue
    const { amount, currency } = farePrice(best)
    const next = { perPerson: amount / Math.max(1, best.passengers), currency, route: routeTitle(route), chosen: Boolean(chosen) }
    const cheaper = next.chosen === fare?.chosen && currency === fare.currency && next.perPerson < fare.perPerson
    if (fare === null || (next.chosen && !fare.chosen) || cheaper) fare = next
  }
  return {
    plans: deck.days.reduce((sum, day) => sum + day.activities.length, 0),
    ideas: deck.idea_count,
    fare,
    booked: deck.lodging.find((o) => o.status === 'booked') ?? null,
    shortlisted: deck.lodging.length,
    onShortlist: deck.lodging.some((o) => o.status === 'shortlisted' || o.favorite),
  }
}
