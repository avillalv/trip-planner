import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { lodging, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import type { TripOutletContext } from './trip-context'
import { TripLodging } from './trip-lodging'

const travelers = [
  { id: 1, name: 'Alex', color: '#c24472', home_airports: ['LAX'] },
  { id: 2, name: 'Sam', color: '#1f7f86', home_airports: ['LAX'] },
]

const machiya = lodging({ hearts: [2] })
const koto = lodging({
  id: 4,
  title: 'Stay Inn KOTO',
  site: 'Voyabay',
  url: 'https://voyabay.com/rentals/lpcf1e4',
  price_total: '275.00',
  price_per_night: '91.67',
  currency: 'USD',
  price_home_total: '275.00',
  rating: '4.40',
  created_at: '2026-09-26T13:00:00Z',
})
const dorm = lodging({
  id: 5,
  title: 'Capsule dorm',
  url: null,
  price_total: null,
  price_per_night: null,
  currency: null,
  price_home_total: null,
  status: 'rejected',
})

function renderLodging() {
  const context: TripOutletContext = { trip: trip({ travelers }), editTrip: () => {} }
  return renderWithProviders(
    <Routes>
      <Route element={<Outlet context={context} />}>
        <Route path="/trips/7/lodging" element={<TripLodging />} />
      </Route>
    </Routes>,
    { route: '/trips/7/lodging' },
  )
}

describe('TripLodging', () => {
  it('shows each place’s converted price, and hides the ones you ruled out', async () => {
    mockApi({ '/api/v1/trips/7/lodging': [machiya, koto, dorm], '/api/v1/trips/7/activities': [] })
    const user = userEvent.setup()

    renderLodging()

    const card = (await screen.findByText('Machiya with a garden')).closest('li')!
    expect(within(card).getByText('$640')).toBeInTheDocument()
    expect(within(card).getByText('(¥96,000)')).toBeInTheDocument()
    expect(within(card).getByText(/\$320 per person/)).toBeInTheDocument()
    expect(screen.getByText('Stay Inn KOTO')).toBeInTheDocument()
    expect(screen.queryByText('Capsule dorm')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Not for us' }))
    expect(screen.getByText('Capsule dorm')).toBeInTheDocument()
    expect(screen.getByText('No price yet')).toBeInTheDocument()
    expect(screen.queryByText('Stay Inn KOTO')).not.toBeInTheDocument()
  })

  it('saves a heart for one of you', async () => {
    let sent: unknown
    mockApi({
      '/api/v1/trips/7/lodging': [machiya],
      '/api/v1/trips/7/activities': [],
      'PUT /api/v1/lodging/3/hearts/1': async (request: Request) => {
        sent = await request.json()
        return jsonResponse({ ...machiya, hearts: [1, 2] })
      },
    })
    const user = userEvent.setup()

    renderLodging()
    await user.click(await screen.findByRole('button', { name: 'Add Alex’s heart' }))

    expect(sent).toEqual({ hearted: true })
    expect(screen.getByRole('button', { name: 'Remove Alex’s heart' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Remove Sam’s heart' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('compares the places you pick, marking the lowest price', async () => {
    mockApi({ '/api/v1/trips/7/lodging': [machiya, koto], '/api/v1/trips/7/activities': [] })
    const user = userEvent.setup()

    renderLodging()
    const boxes = await screen.findAllByRole('checkbox', { name: 'Compare' })
    await user.click(boxes[0])
    expect(screen.getByText('Pick at least one more to compare.')).toBeInTheDocument()
    await user.click(boxes[1])
    await user.click(screen.getByRole('button', { name: 'Compare 2' }))

    const dialog = await screen.findByRole('dialog', { name: 'Compare places to stay' })
    const total = within(dialog).getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('Lowest').closest('td')).toHaveTextContent('$275')
  })
})
