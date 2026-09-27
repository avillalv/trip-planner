import type { Quote } from '@/lib/api/flights'
import { daysBetween, parseDate } from '@/lib/dates'
import { seriesFor } from '@/lib/price-sources'

/** Total price for both travelers, in whichever currency it's known (home if converted, else quoted). */
export function priceOf(q: Quote): number {
  return Number(q.price_home ?? q.price_total)
}

/** Currency the price is shown in — the same rule the price cell uses. */
export function currencyOf(q: Quote, fallback: string): string {
  return (q.price_home ? q.home_currency : q.currency) || fallback
}

/** Nights of the stay, or null for a one-way quote. */
export function nightsOf(q: Quote): number | null {
  if (!q.return_date) return null
  return daysBetween(parseDate(q.depart_date), parseDate(q.return_date))
}

/** Price divided by nights; null for a one-way quote or a same-day trip. */
export function perNight(q: Quote): number | null {
  const nights = nightsOf(q)
  if (!nights) return null
  return priceOf(q) / nights
}

export type SortKey = 'price' | 'perNight' | 'flight' | 'dates' | 'nights' | 'airline' | 'stops' | 'duration' | 'source' | 'seen'
export type SortDir = 'asc' | 'desc'
export type Sort = { key: SortKey; dir: SortDir }

export const DEFAULT_SORT: Sort = { key: 'price', dir: 'asc' }

/** The direction a column sorts in on its first click. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  price: 'asc',
  perNight: 'asc',
  flight: 'asc',
  dates: 'asc',
  nights: 'desc',
  airline: 'asc',
  stops: 'asc',
  duration: 'asc',
  source: 'asc',
  seen: 'desc',
}

const numeric = (a: number, b: number) => a - b
const text = (a: string, b: string) => a.localeCompare(b)

/**
 * One field's comparison: null always sorts last, in both directions. Only the comparison of two
 * present values flips with `dir` — so a desc sort never pulls missing values to the front.
 */
function directional<T>(get: (q: Quote) => T | null, cmp: (a: T, b: T) => number) {
  return (a: Quote, b: Quote, dir: SortDir): number => {
    const av = get(a)
    const bv = get(b)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const base = cmp(av, bv)
    return dir === 'desc' ? -base : base
  }
}

/** Suspect quotes sort after non-suspect ones, in both directions, ahead of the column's own order. */
function suspectFirst(cmp: (a: Quote, b: Quote, dir: SortDir) => number) {
  return (a: Quote, b: Quote, dir: SortDir): number => {
    if (a.suspect !== b.suspect) return a.suspect ? 1 : -1
    return cmp(a, b, dir)
  }
}

const COMPARATORS: Record<SortKey, (a: Quote, b: Quote, dir: SortDir) => number> = {
  price: suspectFirst(directional(priceOf, numeric)),
  perNight: suspectFirst(directional(perNight, numeric)),
  flight: (a, b, dir) =>
    directional((q: Quote) => q.origin, text)(a, b, dir) ||
    directional((q: Quote) => q.destination, text)(a, b, dir) ||
    directional((q: Quote) => q.depart_at_local?.slice(11, 16) ?? null, text)(a, b, dir),
  dates: (a, b, dir) =>
    directional((q: Quote) => q.depart_date, text)(a, b, dir) || directional((q: Quote) => q.return_date, text)(a, b, dir),
  nights: directional(nightsOf, numeric),
  airline: directional((q: Quote) => q.airlines.join(', ') || null, text),
  stops: directional((q: Quote) => q.stops_out, numeric),
  duration: directional((q: Quote) => q.duration_out_min, numeric),
  source: directional((q: Quote) => seriesFor(q.source).short, text),
  // Parsed, not string-compared: observations carry local offsets, which change with daylight saving.
  seen: directional((q: Quote) => Date.parse(q.observed_at), numeric),
}

/**
 * Sorted copy of `quotes`. Stable in both directions (ties keep the server's cheapest-first order),
 * missing values sort last both ways, and suspect prices stay last in the price sorts.
 */
export function sortOptions(quotes: Quote[], sort: Sort): Quote[] {
  const cmp = COMPARATORS[sort.key]
  return quotes.toSorted((a, b) => cmp(a, b, sort.dir))
}

export type Filters = {
  minNights: number | null
  maxNights: number | null
  leaveFrom: string | null
  backBy: string | null
  maxStops: number | null
  airline: string | null
}

export const NO_FILTERS: Filters = {
  minNights: null,
  maxNights: null,
  leaveFrom: null,
  backBy: null,
  maxStops: null,
  airline: null,
}

export function hasFilters(f: Filters): boolean {
  return Object.values(f).some((v) => v !== null)
}

/** Quotes matching every set filter. Unset (null) fields never exclude anything. */
export function filterOptions(quotes: Quote[], f: Filters): Quote[] {
  return quotes.filter((q) => {
    if (f.minNights !== null || f.maxNights !== null) {
      const nights = nightsOf(q)
      if (nights === null) return false
      if (f.minNights !== null && nights < f.minNights) return false
      if (f.maxNights !== null && nights > f.maxNights) return false
    }
    if (f.leaveFrom !== null && q.depart_date < f.leaveFrom) return false
    if (f.backBy !== null && !(q.return_date !== null && q.return_date <= f.backBy)) return false
    if (f.maxStops !== null && !(q.stops_out !== null && q.stops_out <= f.maxStops)) return false
    if (f.airline !== null && !q.airlines.includes(f.airline)) return false
    return true
  })
}

/** The values each filter could offer, present in `quotes`, ascending. */
export function filterChoices(quotes: Quote[]): {
  nights: number[]
  departs: string[]
  returns: string[]
  airlines: string[]
  stops: number[]
} {
  const nights = new Set<number>()
  const departs = new Set<string>()
  const returns = new Set<string>()
  const airlines = new Set<string>()
  const stops = new Set<number>()
  for (const q of quotes) {
    const n = nightsOf(q)
    if (n !== null) nights.add(n)
    departs.add(q.depart_date)
    if (q.return_date !== null) returns.add(q.return_date)
    for (const airline of q.airlines) airlines.add(airline)
    if (q.stops_out !== null) stops.add(q.stops_out)
  }
  return {
    nights: [...nights].sort(numeric),
    departs: [...departs].sort(text),
    returns: [...returns].sort(text),
    airlines: [...airlines].sort(text),
    stops: [...stops].sort(numeric),
  }
}

/** The cheapest non-suspect quote for each number of nights, ascending. One-way quotes are skipped. */
export function cheapestByNights(quotes: Quote[]): Array<{ nights: number; quote: Quote }> {
  const best = new Map<number, Quote>()
  for (const q of quotes) {
    if (q.suspect) continue
    const nights = nightsOf(q)
    if (nights === null) continue
    const current = best.get(nights)
    if (!current || priceOf(q) < priceOf(current)) best.set(nights, q)
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([nights, quote]) => ({ nights, quote }))
}
