import { describe, expect, it } from 'vitest'
import { fare, lodging, presentation, trip } from '@/test/fixtures'
import { buildSlides, closingFacts, dayNumber, exchangeText, farePrice, lodgingHeading } from './deck-model'
import { projectPoints, scaleSeries } from './deck-geometry'

describe('buildSlides', () => {
  it('runs from the title through each section to the summary', () => {
    const slides = buildSlides(presentation())

    expect(slides.map((s) => s.kind)).toEqual(['title', 'destination', 'flights', 'lodging', 'day', 'closing'])
    expect(slides.map((s) => s.label)).toEqual([
      'Japan in autumn',
      'Kyoto',
      'Flights: LAX → HND, NRT',
      'Places we like',
      'Day 2: Temples',
      'Trip at a glance',
    ])
  })

  it('skips sections with nothing in them', () => {
    const empty = presentation({ routes: [], lodging: [], days: [] })
    expect(buildSlides(empty).map((s) => s.kind)).toEqual(['title', 'destination', 'closing'])

    const bare = presentation({ destinations: [], routes: [], lodging: [], days: [] })
    expect(buildSlides(bare).map((s) => s.kind)).toEqual(['title', 'closing'])
  })
})

describe('dayNumber', () => {
  it('counts from the first day, and leaves days outside the trip unnumbered', () => {
    const t = trip()
    expect(dayNumber(t, '2026-11-05')).toBe(1)
    expect(dayNumber(t, '2026-11-15')).toBe(11)
    expect(dayNumber(t, '2026-11-16')).toBeNull()
    expect(dayNumber(trip({ start_date: null, end_date: null }), '2026-11-05')).toBeNull()
  })
})

describe('lodgingHeading', () => {
  it('says how settled the choice is', () => {
    expect(lodgingHeading([lodging({ status: 'booked' }), lodging({ status: 'shortlisted' })])).toBe('Where we’ll stay')
    expect(lodgingHeading([lodging({ favorite: true })])).toBe('Places we like')
    expect(lodgingHeading([lodging()])).toBe('Places we’re considering')
  })
})

describe('exchangeText', () => {
  it('picks an amount that shows the difference', () => {
    expect(exchangeText('USD', 'JPY', 150)).toBe('$1 ≈ ¥150')
    expect(exchangeText('USD', 'CAD', 1.37)).toBe('$10 ≈ CA$14')
    expect(exchangeText('USD', 'EUR', 0.92)).toBe('$100 ≈ €92')
  })
})

describe('farePrice', () => {
  it('uses the converted price, or the quoted one without a conversion', () => {
    expect(farePrice(fare())).toEqual({ amount: 1248, currency: 'USD' })
    expect(farePrice(fare({ price_home: null, price_total: '180000', currency: 'JPY' }))).toEqual({
      amount: 180000,
      currency: 'JPY',
    })
  })
})

describe('closingFacts', () => {
  it('sums up plans, the cheapest fare per person, and where things stand on lodging', () => {
    expect(closingFacts(presentation())).toEqual({
      plans: 1,
      ideas: 2,
      cheapestFare: { perPerson: 624, currency: 'USD', route: 'LAX → HND, NRT' },
      booked: null,
      shortlisted: 1,
      onShortlist: true,
    })
    const booked = lodging({ status: 'booked', title: 'Garden machiya' })
    expect(closingFacts(presentation({ lodging: [booked], routes: [] }))).toMatchObject({
      cheapestFare: null,
      booked: { title: 'Garden machiya' },
    })
  })
})

describe('projectPoints', () => {
  it('centers a single point', () => {
    expect(projectPoints([{ lat: 35, lon: 135 }], 400, 260, 34)).toEqual([{ x: 200, y: 130 }])
  })

  it('fills the box inside the margin, with north up', () => {
    const [west, east] = projectPoints(
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 10 },
      ],
      400,
      260,
      34,
    )
    expect(west.x).toBeCloseTo(34)
    expect(east.x).toBeCloseTo(366)
    const [south, north] = projectPoints(
      [
        { lat: 34.9, lon: 135.77 },
        { lat: 35.1, lon: 135.77 },
      ],
      400,
      260,
      34,
    )
    expect(north.y).toBeLessThan(south.y)
  })
})

describe('scaleSeries', () => {
  const box = { width: 640, height: 280, left: 6, right: 120, top: 34, bottom: 44 }
  const points = [
    { day: '2026-09-24', price: 1400 },
    { day: '2026-09-25', price: 1300 },
    { day: '2026-09-26', price: 1248 },
  ]

  it('runs the days across the plot area, lower prices lower down', () => {
    const { coords } = scaleSeries(points, box)
    expect(coords[0].x).toBe(6)
    expect(coords[2].x).toBe(520)
    expect(coords[2].y).toBeGreaterThan(coords[0].y)
  })

  it('keeps a typical range in view', () => {
    const { y } = scaleSeries(points, box, [1300, 1650])
    expect(y(1650)).toBeGreaterThanOrEqual(box.top)
    expect(y(1248)).toBeLessThanOrEqual(box.height - box.bottom)
  })
})
