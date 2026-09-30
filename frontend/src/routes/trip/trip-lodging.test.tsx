import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Outlet, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { lodging, lodgingRun, trip } from '@/test/fixtures'
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
    mockApi({ '/api/v1/trips/7/lodging': [machiya, koto, dorm], '/api/v1/trips/7/activities': [], '/api/v1/runs': [] })
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
      '/api/v1/runs': [],
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
    mockApi({ '/api/v1/trips/7/lodging': [machiya, koto], '/api/v1/trips/7/activities': [], '/api/v1/runs': [] })
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

  describe('AI picks', () => {
    const pick = (id: number, rank: number | null, title: string, overrides: Parameters<typeof lodging>[0] = {}) =>
      lodging({
        id,
        title,
        added_via: 'agent',
        url: `https://example.com/${id}`,
        notes: rank ? `AI pick #${rank}: Why ${title} suits you.` : `Why ${title} suits you.`,
        created_at: `2026-09-29T12:00:0${id}Z`,
        ...overrides,
      })
    const picks = [
      pick(10, 2, 'Second pick'),
      pick(11, 1, 'Best pick', { pros: 'Steps from the market', cons: 'Small kitchen' }),
      pick(12, 3, 'Rejected pick', { status: 'rejected' }),
      pick(13, null, 'Unranked pick'),
    ]

    it('shows only what the AI saved, best first, with a badge, why, and pros and cons', async () => {
      mockApi({ '/api/v1/trips/7/lodging': [machiya, koto, ...picks], '/api/v1/trips/7/activities': [], '/api/v1/runs': [] })
      const user = userEvent.setup()

      renderLodging()
      await screen.findByText('Machiya with a garden')
      await user.click(screen.getByRole('tab', { name: 'AI picks' }))

      const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
      expect(titles).toEqual(['Best pick', 'Second pick', 'Unranked pick'])
      expect(screen.getByLabelText('Sort by')).toHaveValue('rank')

      const best = screen.getByText('Best pick').closest('li')!
      expect(within(best).getByText('AI pick #1')).toBeInTheDocument()
      expect(within(best).getByText('Why Best pick suits you.')).toBeInTheDocument()
      expect(within(best).getByText('Steps from the market')).toBeInTheDocument()
      expect(within(best).getByText('Small kitchen')).toBeInTheDocument()
      const unranked = screen.getByText('Unranked pick').closest('li')!
      expect(within(unranked).getByText('AI pick')).toBeInTheDocument()

      await user.click(screen.getByRole('tab', { name: 'All' }))
      expect(screen.getByLabelText('Sort by')).toHaveValue('added')
      expect(screen.getByText('Machiya with a garden')).toBeInTheDocument()
      expect(screen.queryByText('Rejected pick')).not.toBeInTheDocument()
      const manual = screen.getByText('Machiya with a garden').closest('li')!
      expect(within(manual).queryByText(/^AI pick/)).not.toBeInTheDocument()
    })

    it('lets a long reason be read in full', async () => {
      const long = pick(10, 1, 'Wordy pick', { notes: `AI pick #1: ${'Great location. '.repeat(20)}` })
      mockApi({ '/api/v1/trips/7/lodging': [long], '/api/v1/trips/7/activities': [], '/api/v1/runs': [] })
      const user = userEvent.setup()

      renderLodging()
      const more = await screen.findByRole('button', { name: 'Show more' })
      const reason = more.previousElementSibling!
      expect(reason).toHaveClass('line-clamp-4')
      await user.click(more)
      expect(reason).not.toHaveClass('line-clamp-4')
      expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens the AI dialog, and “Show AI picks” lands on the picks', async () => {
      mockApi({
        '/api/v1/trips/7/lodging': [machiya, ...picks],
        '/api/v1/trips/7/activities': [],
        '/api/v1/runs': [lodgingRun()],
      })
      const user = userEvent.setup()

      renderLodging()
      await screen.findByText('Machiya with a garden')
      await user.click(screen.getByRole('button', { name: 'AI picks' }))
      await screen.findByRole('dialog', { name: 'Find the best places to stay' })
      await user.click(await screen.findByRole('button', { name: 'Show AI picks' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'AI picks' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByText('Machiya with a garden')).not.toBeInTheDocument()
      expect(screen.getByText('Best pick')).toBeInTheDocument()
    })
  })
})
