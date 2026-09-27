import { describe, expect, it } from 'vitest'
import type { FlightRoute, RouteHistory } from '@/lib/api/flights'
import { parseDate } from '@/lib/dates'
import { fare, trip } from '@/test/fixtures'
import { historyRows, seriesPresent } from './history-data'
import {
  cheapestByNights,
  filterChoices,
  filterOptions,
  NO_FILTERS,
  perNight,
  sortOptions,
  type Filters,
} from './options-view'
import { priceStep } from './price-step'
import { defaultRoute, returnMode, withReturnMode } from './route-form'
import { quoteDates, routeDescription } from './route-text'

describe('price grid steps', () => {
  const prices = [800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700]

  it('gives the cheapest the most prominent step and the priciest the least', () => {
    expect(priceStep(800, prices)).toBe(5)
    expect(priceStep(1700, prices)).toBe(1)
    expect(priceStep(1200, prices)).toBe(3)
  })

  it('treats a single price as the cheapest', () => {
    expect(priceStep(950, [950])).toBe(5)
  })
})

describe('history rows', () => {
  it('merges sources by day and folds Google history to daily lows', () => {
    const history: RouteHistory = {
      currency: 'USD',
      points: [
        { day: '2026-09-25', source: 'serpapi', price: '1900.00' },
        { day: '2026-09-26', source: 'serpapi', price: '1859.00' },
        { day: '2026-09-26', source: 'travelpayouts', price: '1400.00' },
      ],
      google: [
        { at: '2026-09-24T08:00:00Z', price: '2000' },
        { at: '2026-09-24T20:00:00Z', price: '1950' },
      ],
      typical_low: '1050',
      typical_high: '1850',
      price_level: 'high',
    }

    const rows = historyRows(history)

    expect(rows.map((r) => r.day)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26'])
    expect(rows[0].google).toBe(1950)
    expect(rows[2]).toEqual({ day: '2026-09-26', serpapi: 1859, travelpayouts: 1400 })
    expect([...seriesPresent(rows)].sort()).toEqual(['google', 'serpapi', 'travelpayouts'])
  })
})

describe('route defaults', () => {
  it('starts from home airports, the trip dates, and the trip length', () => {
    const route = defaultRoute(trip(), parseDate('2026-09-26'))

    expect(route.origin_codes).toEqual(['LAX'])
    expect([route.depart_from, route.depart_to]).toEqual(['2026-11-03', '2026-11-07'])
    expect([route.min_nights, route.max_nights]).toEqual([9, 11])
    expect(route.adults).toBe(1)
  })

  it('never starts the window in the past', () => {
    const route = defaultRoute(trip({ start_date: '2026-09-27', end_date: '2026-10-02' }), parseDate('2026-09-26'))

    expect(route.depart_from).toBe('2026-09-26')
  })

  it('switches between trip length and return dates', () => {
    const nights = defaultRoute(trip(), parseDate('2026-09-26'))
    const window = withReturnMode(nights, 'window')

    expect(returnMode(window)).toBe('window')
    expect(window.min_nights).toBeNull()
    expect([window.return_from, window.return_to]).toEqual(['2026-11-12', '2026-11-18'])
    expect(returnMode(withReturnMode(window, 'nights'))).toBe('nights')
  })
})

describe('route text', () => {
  const route = {
    trip_type: 'round_trip',
    depart_from: '2026-11-05',
    depart_to: '2026-11-10',
    min_nights: 7,
    max_nights: 10,
    return_from: null,
    return_to: null,
    adults: 2,
    children: 1,
    cabin: 'economy',
    max_stops: 0,
  } as FlightRoute

  it('describes a route in one line', () => {
    expect(routeDescription(route)).toMatch(
      /^Round trip · leave Nov 5\s*–\s*10 · 7–10 nights · 2 adults, 1 child · Economy · nonstop$/,
    )
  })

  it('describes dates with the number of nights', () => {
    expect(quoteDates({ depart_date: '2026-11-05', return_date: '2026-11-15' })).toMatch(/Nov 5 → Nov 15 · 10 nights/)
    expect(quoteDates({ depart_date: '2026-11-05', return_date: null })).toMatch(/Nov 5 · one way/)
  })
})

describe('options table', () => {
  describe('sortOptions', () => {
    it('sorts nights most first, keeping input order for ties in both directions', () => {
      const a = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-06' }) // 5 nights
      const b = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-06' }) // 5 nights, ties with a
      const c = fare({ id: 3, depart_date: '2026-11-01', return_date: '2026-11-03' }) // 2 nights

      expect(sortOptions([a, b, c], { key: 'nights', dir: 'desc' }).map((q) => q.id)).toEqual([1, 2, 3])
      expect(sortOptions([c, a, b], { key: 'nights', dir: 'asc' }).map((q) => q.id)).toEqual([3, 1, 2])
    })

    it('puts a one-way quote last in both directions', () => {
      const oneWay = fare({ id: 1, return_date: null })
      const roundTrip = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-05' })

      expect(sortOptions([oneWay, roundTrip], { key: 'nights', dir: 'asc' }).map((q) => q.id)).toEqual([2, 1])
      expect(sortOptions([oneWay, roundTrip], { key: 'nights', dir: 'desc' }).map((q) => q.id)).toEqual([2, 1])
    })

    it('keeps suspect prices last when sorting by price, in both directions', () => {
      const cheap = fare({ id: 1, price_total: '900', price_home: '900' })
      const suspect = fare({ id: 2, price_total: '100', price_home: '100', suspect: true })
      const pricey = fare({ id: 3, price_total: '2000', price_home: '2000' })
      const quotes = [cheap, suspect, pricey]

      expect(sortOptions(quotes, { key: 'price', dir: 'asc' }).map((q) => q.id)).toEqual([1, 3, 2])
      expect(sortOptions(quotes, { key: 'price', dir: 'desc' }).map((q) => q.id)).toEqual([3, 1, 2])
    })

    it('sorts seen by the actual time across a daylight-saving change', () => {
      const before = fare({ id: 1, observed_at: '2026-11-01T01:30:00-04:00' }) // 05:30 UTC
      const after = fare({ id: 2, observed_at: '2026-11-01T01:10:00-05:00' }) // 06:10 UTC

      expect(sortOptions([before, after], { key: 'seen', dir: 'desc' }).map((q) => q.id)).toEqual([2, 1])
    })

    it('puts an unknown duration last in both directions', () => {
      const known = fare({ id: 1, duration_out_min: 300 })
      const unknown = fare({ id: 2, duration_out_min: null })

      expect(sortOptions([known, unknown], { key: 'duration', dir: 'asc' }).map((q) => q.id)).toEqual([1, 2])
      expect(sortOptions([known, unknown], { key: 'duration', dir: 'desc' }).map((q) => q.id)).toEqual([1, 2])
    })
  })

  describe('filterOptions', () => {
    it('excludes one-way quotes when a nights range is set', () => {
      const inRange = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-04' }) // 3 nights
      const outOfRange = fare({ id: 2, depart_date: '2026-11-05', return_date: '2026-11-20' }) // 15 nights
      const oneWay = fare({ id: 3, return_date: null })
      const filters: Filters = { ...NO_FILTERS, minNights: 1, maxNights: 5 }

      expect(filterOptions([inRange, outOfRange, oneWay], filters).map((q) => q.id)).toEqual([1])
    })

    it('keeps only quotes departing on or after leaveFrom', () => {
      const early = fare({ id: 1, depart_date: '2026-11-01' })
      const late = fare({ id: 2, depart_date: '2026-11-10' })
      const filters: Filters = { ...NO_FILTERS, leaveFrom: '2026-11-05' }

      expect(filterOptions([early, late], filters).map((q) => q.id)).toEqual([2])
    })

    it('keeps only round trips returning on or before backBy', () => {
      const early = fare({ id: 1, return_date: '2026-11-08' })
      const late = fare({ id: 2, return_date: '2026-11-20' })
      const oneWay = fare({ id: 3, return_date: null })
      const filters: Filters = { ...NO_FILTERS, backBy: '2026-11-10' }

      expect(filterOptions([early, late, oneWay], filters).map((q) => q.id)).toEqual([1])
    })

    it('nonstop-only excludes both a 1-stop and an unknown-stops quote', () => {
      const nonstop = fare({ id: 1, stops_out: 0 })
      const oneStop = fare({ id: 2, stops_out: 1 })
      const unknown = fare({ id: 3, stops_out: null })
      const filters: Filters = { ...NO_FILTERS, maxStops: 0 }

      expect(filterOptions([nonstop, oneStop, unknown], filters).map((q) => q.id)).toEqual([1])
    })

    it('matches an airline present anywhere in a multi-airline itinerary', () => {
      const multi = fare({ id: 1, airlines: ['United', 'COPA'] })
      const other = fare({ id: 2, airlines: ['American'] })
      const filters: Filters = { ...NO_FILTERS, airline: 'United' }

      expect(filterOptions([multi, other], filters).map((q) => q.id)).toEqual([1])
    })
  })

  describe('perNight', () => {
    it('divides the price by the nights', () => {
      const q = fare({ price_total: '1446', price_home: '1446', depart_date: '2026-11-01', return_date: '2026-11-13' })
      expect(perNight(q)).toBe(120.5)
    })

    it('is null for a one-way quote', () => {
      expect(perNight(fare({ return_date: null }))).toBeNull()
    })
  })

  describe('cheapestByNights', () => {
    it('picks the lowest non-suspect price for each length, ascending by nights, skipping one-way quotes', () => {
      const cheap5 = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-06', price_total: '900', price_home: '900' })
      const pricey5 = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-06', price_total: '1200', price_home: '1200' })
      const suspect2 = fare({
        id: 3,
        depart_date: '2026-11-01',
        return_date: '2026-11-03',
        price_total: '10',
        price_home: '10',
        suspect: true,
      })
      const real2 = fare({ id: 4, depart_date: '2026-11-01', return_date: '2026-11-03', price_total: '700', price_home: '700' })
      const oneWay = fare({ id: 5, return_date: null })

      expect(cheapestByNights([cheap5, pricey5, suspect2, real2, oneWay])).toEqual([
        { nights: 2, quote: real2 },
        { nights: 5, quote: cheap5 },
      ])
    })
  })

  describe('filterChoices', () => {
    it('gives unique, sorted values, with airlines flattened', () => {
      const a = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-06', airlines: ['United', 'COPA'], stops_out: 1 })
      const b = fare({ id: 2, depart_date: '2026-11-03', return_date: '2026-11-10', airlines: ['American'], stops_out: 0 })
      const c = fare({ id: 3, depart_date: '2026-11-01', return_date: '2026-11-06', airlines: ['COPA'], stops_out: 1 })

      const choices = filterChoices([a, b, c])

      expect(choices.nights).toEqual([5, 7])
      expect(choices.departs).toEqual(['2026-11-01', '2026-11-03'])
      expect(choices.returns).toEqual(['2026-11-06', '2026-11-10'])
      expect(choices.airlines).toEqual(['American', 'COPA', 'United'])
      expect(choices.stops).toEqual([0, 1])
    })
  })
})
