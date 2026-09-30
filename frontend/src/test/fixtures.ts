import type { Lodging } from '@/lib/api/lodging'
import type { Presentation } from '@/lib/api/presentation'
import type { Suggestion } from '@/lib/api/suggestions'
import type { SystemStatus } from '@/lib/api/system'
import type { Trip } from '@/lib/api/trips'

export function systemStatus(overrides: Partial<SystemStatus> = {}): SystemStatus {
  return {
    version: '0.1.0',
    database: 'ok',
    worker: { status: 'ok', last_seen: new Date().toISOString() },
    claude: { found: true, path: 'claude', version: '2.1.283', signed_in: true, auth_method: 'claude.ai' },
    integrations: { geoapify: true, serpapi: false, travelpayouts: false, wikimedia: false, agent_api: true },
    access: { other_devices: false, passcode_configured: true, port: 8000, urls: [], tailscale_urls: [] },
    backups: { directory: 'C:\\trip-planner\\data\\backups', count: 0, last_at: null, last_size: null, error: null },
    ...overrides,
  }
}

export function trip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 7,
    name: 'Japan in autumn',
    start_date: '2026-11-05',
    end_date: '2026-11-15',
    status: 'planning',
    home_currency: 'USD',
    notes: '',
    interests: [],
    destinations: [
      {
        id: 1,
        position: 0,
        name: 'Kyoto',
        region: 'Kyoto Prefecture',
        country: 'Japan',
        country_code: 'JP',
        kind: 'city',
        lat: 35.01,
        lon: 135.77,
        timezone: 'Asia/Tokyo',
        bbox: null,
        summary: null,
        wiki_url: null,
        image_url: null,
        image_file: null,
        info_status: 'ready',
      },
    ],
    travelers: [{ id: 1, name: 'Alex Rivera', color: '#c24472', home_airports: ['LAX'] }],
    cover: null,
    created_at: '2026-09-26T12:00:00Z',
    updated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}

export function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 5,
    trip_id: 7,
    run_id: '7f3c0a52-2f1e-4b1e-9d0e-1f2a3b4c5d6e',
    mode: 'brainstorm',
    title: 'Fushimi Inari at dawn',
    category: 'sights',
    description: 'Walk the torii gates before the tour groups arrive.',
    why: 'You like temples and quiet mornings.',
    timing_note: 'Dry until noon on the 6th.',
    day: '2026-11-06',
    start_time: '07:00:00',
    end_time: '10:00:00',
    duration_min: 180,
    location_name: 'Fushimi Ward',
    url: 'https://inari.jp/en/',
    sources: ['https://www.japan-guide.com/e/e3915.html'],
    status: 'new',
    activity_id: null,
    created_at: '2026-09-29T12:05:00Z',
    ...overrides,
  }
}

export function lodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: 3,
    trip_id: 7,
    title: 'Machiya with a garden',
    url: 'https://www.airbnb.com/rooms/53122',
    site: 'Airbnb',
    check_in: '2026-11-09',
    check_out: '2026-11-12',
    nights: 3,
    guests: 2,
    price_total: '96000.00',
    price_per_night: '32000.00',
    currency: 'JPY',
    price_home_total: '640.00',
    home_currency: 'USD',
    photos: [],
    location_name: null,
    lat: null,
    lon: null,
    bedrooms: 2,
    beds: 3,
    baths: '1.0',
    rating: '4.92',
    review_count: 188,
    notes: '',
    pros: '',
    cons: '',
    status: 'candidate',
    favorite: false,
    added_via: 'paste',
    hearts: [],
    created_at: '2026-09-26T12:00:00Z',
    updated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}

type DeckRoute = Presentation['routes'][number]
type Fare = DeckRoute['options'][number]

export function fare(overrides: Partial<Fare> = {}): Fare {
  return {
    id: 51,
    route_id: 12,
    source: 'serpapi',
    confidence: 'live',
    origin: 'LAX',
    destination: 'HND',
    depart_date: '2026-11-05',
    return_date: '2026-11-12',
    price_total: '1248.00',
    currency: 'USD',
    price_home: '1248.00',
    home_currency: 'USD',
    passengers: 2,
    airlines: ['ANA'],
    stops_out: 0,
    stops_back: 0,
    duration_out_min: null,
    duration_back_min: null,
    depart_at_local: null,
    flight_numbers: null,
    segments: null,
    layovers: [],
    booking_url: null,
    source_url: null,
    observed_at: '2026-09-26T12:00:00Z',
    suspect: false,
    hidden: false,
    ...overrides,
  }
}

export function deckRoute(overrides: Partial<DeckRoute> = {}): DeckRoute {
  return {
    route: {
      id: 12,
      trip_id: 7,
      label: null,
      origin_codes: ['LAX'],
      destination_codes: ['HND', 'NRT'],
      trip_type: 'round_trip',
      depart_from: '2026-11-04',
      depart_to: '2026-11-06',
      return_from: null,
      return_to: null,
      min_nights: 7,
      max_nights: 8,
      adults: 2,
      children: 0,
      cabin: 'economy',
      max_stops: null,
      sources: ['serpapi'],
      alert_price: null,
      active: true,
      chosen_quote_id: null,
      created_at: '2026-09-26T12:00:00Z',
      updated_at: '2026-09-26T12:00:00Z',
    },
    options: [fare(), fare({ id: 52, price_total: '1302.00', price_home: '1302.00', airlines: ['Japan Airlines'] })],
    trend: [
      { day: '2026-09-24', price: '1400.00' },
      { day: '2026-09-25', price: '1300.00' },
      { day: '2026-09-26', price: '1248.00' },
    ],
    typical_low: '1300.00',
    typical_high: '1650.00',
    price_level: 'low',
    ...overrides,
  }
}

/** A deck with one of everything: a destination, a route, a place to stay, and a planned day. */
export function presentation(overrides: Partial<Presentation> = {}): Presentation {
  const base = trip({ travelers: [{ id: 1, name: 'Alex', color: '#c24472', home_airports: ['LAX'] }] })
  return {
    trip: base,
    destinations: base.destinations.map((d) => ({ ...d, currency: 'JPY', rate: '150.00' })),
    routes: [deckRoute()],
    lodging: [lodging({ status: 'shortlisted' })],
    days: [
      {
        day: '2026-11-06',
        title: 'Temples',
        notes: '',
        destination_name: 'Kyoto',
        timezone: 'Asia/Tokyo',
        in_trip: true,
        activities: [
          {
            id: 1,
            start_time: '07:00:00',
            end_time: '09:00:00',
            title: 'Fushimi Inari',
            category: 'sights',
            status: 'planned',
            location_name: null,
            lat: null,
            lon: null,
            notes: '',
          },
        ],
      },
    ],
    idea_count: 2,
    generated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}
