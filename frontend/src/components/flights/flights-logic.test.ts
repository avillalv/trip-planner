import { describe, expect, it } from 'vitest'
import type { FlightRoute, RouteHistory } from '@/lib/api/flights'
import { parseDate } from '@/lib/dates'
import { trip } from '@/test/fixtures'
import { historyRows, seriesPresent } from './history-data'
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
