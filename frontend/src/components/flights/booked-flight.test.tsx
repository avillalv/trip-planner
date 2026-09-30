import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RouteSummary } from '@/lib/api/flights'
import { deckRoute, fare, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { BookedFlightDialog } from './booked-flight-dialog'
import { RouteCard } from './route-card'

const route = { ...deckRoute().route, origin_codes: ['RDU'], destination_codes: ['SJO'] }
const costaRica = trip({ name: 'Costa Rica', start_date: '2026-11-20', end_date: '2026-11-29', destinations: [] })

// The Copa flights: overnight in Panama City on the way out, all times local at each airport.
const COPA = [
  { direction: 'out', flight_number: 'CM 467', origin: 'RDU', destination: 'PTY', depart_at: '2026-11-25T15:17', arrive_at: '2026-11-25T19:46' },
  { direction: 'out', flight_number: 'CM 342', origin: 'PTY', destination: 'SJO', depart_at: '2026-11-26T13:28', arrive_at: '2026-11-26T13:51' },
  { direction: 'back', flight_number: 'CM 465', origin: 'SJO', destination: 'PTY', depart_at: '2026-12-06T05:35', arrive_at: '2026-12-06T08:03' },
  { direction: 'back', flight_number: 'CM 466', origin: 'PTY', destination: 'RDU', depart_at: '2026-12-06T08:57', arrive_at: '2026-12-06T13:21' },
] as const

type LegFields = { flight_number: string; origin: string; destination: string; depart_at: string; arrive_at: string }

async function fillLeg(user: ReturnType<typeof userEvent.setup>, group: HTMLElement, leg: LegFields) {
  const scope = within(group)
  await user.clear(scope.getByLabelText('Flight number'))
  await user.type(scope.getByLabelText('Flight number'), leg.flight_number)
  await user.clear(scope.getByLabelText('From'))
  await user.type(scope.getByLabelText('From'), leg.origin.toLowerCase())
  await user.clear(scope.getByLabelText('To'))
  await user.type(scope.getByLabelText('To'), leg.destination)
  fireEvent.change(scope.getByLabelText('Departs'), { target: { value: leg.depart_at } })
  fireEvent.change(scope.getByLabelText('Arrives'), { target: { value: leg.arrive_at } })
}

describe('BookedFlightDialog', () => {
  it('sends the four Copa legs, outbound first, with the price per person', async () => {
    let sent: unknown
    mockApi({
      'POST /api/v1/routes/12/booked-flight': async (request: Request) => {
        sent = await request.json()
        return jsonResponse({ ...costaRica, start_date: '2026-11-25', end_date: '2026-12-06' })
      },
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<BookedFlightDialog routeId={12} routes={[route]} trip={costaRica} onClose={onClose} />)

    const dialog = await screen.findByRole('dialog', { name: 'Add booked flight' })
    expect(dialog).toHaveTextContent('Enter each leg as printed on your ticket; times are local at each airport.')
    await user.type(within(dialog).getByLabelText('Airline'), 'Copa Airlines')
    await user.type(within(dialog).getByLabelText('Price per person'), '374.89')
    expect(within(dialog).getByLabelText('Travelers')).toHaveValue(2) // the route's two adults

    // Start with one outbound and one return leg; each new leg starts where the one before it landed.
    await fillLeg(user, within(dialog).getByRole('group', { name: 'Leg 1' }), COPA[0])
    await user.click(within(dialog).getByRole('button', { name: 'Add an outbound leg' }))
    const second = within(dialog).getByRole('group', { name: 'Leg 2' })
    expect(within(second).getByLabelText('From')).toHaveValue('PTY')
    expect(within(second).getByLabelText('Direction')).toHaveValue('out')
    await fillLeg(user, second, COPA[1])
    await fillLeg(user, within(dialog).getByRole('group', { name: 'Leg 3' }), COPA[2])
    await user.click(within(dialog).getByRole('button', { name: 'Add a return leg' }))
    const fourth = within(dialog).getByRole('group', { name: 'Leg 4' })
    expect(within(fourth).getByLabelText('From')).toHaveValue('PTY')
    await fillLeg(user, fourth, COPA[3])

    await user.click(within(dialog).getByRole('button', { name: 'Save booked flight' }))

    expect(sent).toEqual({
      airline: 'Copa Airlines',
      price_per_person: '374.89',
      currency: 'USD',
      passengers: 2,
      segments: COPA,
    })
    expect(await screen.findByText('Booked flight saved. The trip is now Nov 25 – Dec 6, 2026.')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalled()
  })

  it('says what is missing before sending, and shows what the server refused', async () => {
    mockApi({
      'POST /api/v1/routes/12/booked-flight': () => jsonResponse({ detail: 'Unknown airport code(s): ZZZ' }, 422),
    })
    const user = userEvent.setup()
    renderWithProviders(<BookedFlightDialog routeId={12} routes={[route]} trip={costaRica} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog', { name: 'Add booked flight' })

    await user.click(within(dialog).getByRole('button', { name: 'Save booked flight' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the airline.')

    await user.type(within(dialog).getByLabelText('Airline'), 'Copa Airlines')
    await user.type(within(dialog).getByLabelText('Price per person'), '374.89')
    await fillLeg(user, within(dialog).getByRole('group', { name: 'Leg 1' }), { ...COPA[0], destination: 'ZZZ' })
    await fillLeg(user, within(dialog).getByRole('group', { name: 'Leg 2' }), COPA[2])
    await user.click(within(dialog).getByRole('button', { name: 'Save booked flight' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unknown airport code(s): ZZZ')
  })
})

describe('RouteCard with a booked flight', () => {
  const booked = fare({
    id: 90,
    source: 'manual',
    confidence: 'indicative',
    origin: 'RDU',
    destination: 'SJO',
    depart_date: '2026-11-25',
    return_date: '2026-12-06',
    price_total: '749.78',
    price_home: '749.78',
    airlines: ['Copa Airlines'],
    stops_out: 1,
    flight_numbers: COPA.map((leg) => leg.flight_number),
    segments: COPA.map((leg) => ({ ...leg, depart_at: `${leg.depart_at}:00`, arrive_at: `${leg.arrive_at}:00` })),
    hidden: true,
  })
  const summary = (chosen: RouteSummary['chosen'], latest: RouteSummary['chosen_latest']): RouteSummary => ({
    route_id: 12,
    cheapest: null,
    last_checked_at: null,
    quote_count: 1,
    chosen,
    chosen_latest: latest,
  })
  const card = (chosen: RouteSummary['chosen'], latest: RouteSummary['chosen_latest'], active = false) =>
    renderWithProviders(
      <RouteCard
        route={{ ...route, active }}
        summary={summary(chosen, latest)}
        currency="USD"
        onEdit={() => {}}
        onCheck={() => {}}
        onToggleActive={() => {}}
        onDelete={() => {}}
        onClearChoice={() => {}}
        onAddBooked={() => {}}
      />,
    )

  it('lists the legs by direction in local times, without price-watching noise', () => {
    // Even if a cheaper "latest" existed, a booked flight isn't a price to watch.
    card(booked, { ...booked, price_total: '700.00', price_home: '700.00' })

    const article = screen.getByRole('article')
    expect(article).toHaveTextContent('Copa Airlines')
    expect(within(article).getByText('Booked')).toBeInTheDocument()
    const [outbound, back] = within(article).getAllByRole('list')
    const flat = (el: HTMLElement) => el.textContent?.replace(/\s/g, ' ')
    expect(within(article).getByText('Outbound')).toBeInTheDocument()
    expect(within(article).getByText('Return')).toBeInTheDocument()
    expect(flat(within(outbound).getAllByRole('listitem')[0])).toBe('CM 467RDU → PTYNov 25, 3:17 PM → 7:46 PM')
    expect(flat(within(outbound).getAllByRole('listitem')[1])).toBe('CM 342PTY → SJONov 26, 1:28 PM → 1:51 PM')
    expect(flat(within(back).getAllByRole('listitem')[0])).toBe('CM 465SJO → PTYDec 6, 5:35 AM → 8:03 AM')
    expect(flat(within(back).getAllByRole('listitem')[1])).toBe('CM 466PTY → RDUDec 6, 8:57 AM → 1:21 PM')
    expect(article).not.toHaveTextContent(/since you chose it|ago/)
    expect(article).toHaveTextContent('Booked: price checks for this route are off.')
  })

  it('still reports how a watched fare moved since it was chosen', () => {
    const watched = fare({ id: 91, price_total: '1500.00', price_home: '1500.00' })
    card(watched, { ...watched, price_total: '1400.00', price_home: '1400.00' }, true)

    expect(screen.getByRole('article')).toHaveTextContent('Down $100 since you chose it')
  })
})
