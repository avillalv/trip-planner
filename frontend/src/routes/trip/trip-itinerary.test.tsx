import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Activity, Day } from '@/lib/api/itinerary'
import type { DayWeather } from '@/lib/api/weather'
import { trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import type { TripOutletContext } from './trip-context'
import { TripItinerary } from './trip-itinerary'

function day(overrides: Partial<Day> = {}): Day {
  return {
    day: '2026-11-05',
    title: '',
    notes: '',
    destination_id: 1,
    destination_name: 'Kyoto',
    timezone: 'Asia/Tokyo',
    in_trip: true,
    activity_count: 0,
    first: null,
    last: null,
    ...overrides,
  }
}

function idea(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 9,
    trip_id: 7,
    day: null,
    start_time: null,
    end_time: null,
    title: 'Ghibli Museum',
    category: 'museum',
    status: 'idea',
    location_name: null,
    address: null,
    lat: null,
    lon: null,
    url: null,
    notes: '',
    place_provider: null,
    place_id: null,
    place_data: null,
    version: 1,
    created_at: '2026-09-26T12:00:00Z',
    updated_at: '2026-09-26T12:00:00Z',
    ...overrides,
  }
}

function weather(overrides: Partial<DayWeather> = {}): DayWeather {
  return {
    day: '2026-11-05',
    destination_id: 1,
    destination_name: 'Kyoto',
    kind: 'forecast',
    high_f: 84,
    low_f: 72,
    precip_in: 0.12,
    rain_chance: 40,
    wet_days_pct: null,
    whole_country: false,
    ...overrides,
  }
}

function renderItinerary() {
  const context: TripOutletContext = { trip: trip(), editTrip: () => {} }
  return renderWithProviders(
    <Routes>
      <Route element={<Outlet context={context} />}>
        <Route path="/trips/7/itinerary" element={<TripItinerary />} />
      </Route>
    </Routes>,
    { route: '/trips/7/itinerary' },
  )
}

describe('TripItinerary', () => {
  it('lists each day with its first and last plans, and the ideas', async () => {
    mockApi({
      '/api/v1/trips/7/days': [
        day({
          title: 'Temples',
          activity_count: 4,
          first: { title: 'Fushimi Inari', start_time: '07:00:00' },
          last: { title: 'Pontocho dinner', start_time: '19:30:00' },
        }),
        day({ day: '2026-11-06' }),
      ],
      '/api/v1/trips/7/activities': [idea()],
      '/api/v1/trips/7/weather': [],
    })

    renderItinerary()

    const first = (await screen.findByText('Temples')).closest('a')!
    expect(first).toHaveAttribute('href', '/trips/7/itinerary/2026-11-05')
    expect(within(first).getByText('Fushimi Inari')).toBeInTheDocument()
    expect(within(first).getByText('Pontocho dinner')).toBeInTheDocument()
    expect(within(first).getByText('and 2 more')).toBeInTheDocument()
    expect(screen.getByText('Day 2')).toBeInTheDocument()
    expect(screen.getByText('Nothing planned yet')).toBeInTheDocument()
    expect(screen.getByText('Ghibli Museum')).toBeInTheDocument()
    expect(screen.queryByText(/Open-Meteo/)).not.toBeInTheDocument()
  })

  it('opens the AI planner from the heading, without asking Claude anything yet', async () => {
    mockApi({
      '/api/v1/trips/7/days': [day()],
      '/api/v1/trips/7/activities': [],
      '/api/v1/trips/7/weather': [],
      '/api/v1/runs': [],
      '/api/v1/trips/7/suggestions': [],
    })
    const user = userEvent.setup()

    renderItinerary()
    await user.click(await screen.findByRole('button', { name: 'Plan with AI' }))

    expect(await screen.findByRole('button', { name: 'Brainstorm' })).toBeEnabled()
    expect(screen.getByLabelText('Day')).toHaveValue('')
  })

  it('shows each day its forecast or typical weather, with the attribution once', async () => {
    mockApi({
      '/api/v1/trips/7/days': [day(), day({ day: '2026-11-06' }), day({ day: '2026-11-07' })],
      '/api/v1/trips/7/activities': [],
      '/api/v1/trips/7/weather': [
        weather(),
        weather({ day: '2026-11-06', kind: 'typical', rain_chance: null, wet_days_pct: 25 }),
      ],
    })

    renderItinerary()

    const [first, second, third] = (await screen.findAllByRole('link', { name: /Day \d/ })).slice(0, 3)
    expect(within(first).getByText('84° / 72° · 40% rain')).toBeInTheDocument()
    expect(within(second).getByText('84° / 72° · 25% wet days')).toBeInTheDocument()
    expect(within(second).getByText('typical')).toBeInTheDocument()
    expect(within(third).queryByText(/°/)).not.toBeInTheDocument()
    const credit = screen.getAllByRole('link', { name: 'Weather data by Open-Meteo.com' })
    expect(credit).toHaveLength(1)
    expect(credit[0]).toHaveAttribute('href', 'https://open-meteo.com/')
  })

  it("still shows the days when the weather can't be loaded", async () => {
    mockApi({
      '/api/v1/trips/7/days': [day({ title: 'Temples' })],
      '/api/v1/trips/7/activities': [],
      '/api/v1/trips/7/weather': () => jsonResponse({ detail: 'nope' }, 502),
    })

    renderItinerary()

    expect(await screen.findByText('Temples')).toBeInTheDocument()
    expect(screen.queryByText(/Open-Meteo/)).not.toBeInTheDocument()
  })

  it('saves your own idea', async () => {
    let sent: unknown
    mockApi({
      '/api/v1/trips/7/days': [day()],
      '/api/v1/trips/7/activities': [],
      '/api/v1/trips/7/weather': [],
      'POST /api/v1/trips/7/activities': async (request: Request) => {
        sent = await request.json()
        return jsonResponse(idea({ title: 'Sumo practice', category: 'sights' }), 201)
      },
    })
    const user = userEvent.setup()

    renderItinerary()
    await user.click(await screen.findByRole('button', { name: 'Add an idea' }))
    await user.click(screen.getByRole('tab', { name: 'Add your own' }))
    await user.type(screen.getByLabelText('Name'), 'Sumo practice')
    await user.click(screen.getByRole('radio', { name: 'Sights' }))
    await user.click(screen.getByRole('button', { name: 'Save as an idea' }))

    expect(await screen.findByText('Saved as an idea')).toBeInTheDocument()
    expect(sent).toMatchObject({ title: 'Sumo practice', category: 'sights', day: null, status: 'idea' })
  })
})
