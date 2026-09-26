import type { SystemStatus } from '@/lib/api/system'
import type { Trip } from '@/lib/api/trips'

export function systemStatus(overrides: Partial<SystemStatus> = {}): SystemStatus {
  return {
    version: '0.1.0',
    database: 'ok',
    worker: { status: 'ok', last_seen: new Date().toISOString() },
    claude: { found: true, path: 'claude', version: '2.1.283' },
    integrations: { geoapify: true, serpapi: false, travelpayouts: false, wikimedia: false },
    access: { other_devices: false, passcode_configured: true, port: 8000, urls: [] },
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
