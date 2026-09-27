import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TripEditor } from '@/components/trips/trip-editor'
import { flightKey } from '@/lib/api/flights'
import { fare, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { BestOptions } from './best-options'
import { ChooseFlightDialog, type FlightPick } from './choose-flight-dialog'

const costaRica = trip({ name: 'Costa Rica', start_date: '2026-11-20', end_date: '2026-11-29', destinations: [] })

const pick: FlightPick = {
  routeId: 12,
  quoteId: 51,
  route: 'CLT → SJO',
  depart_date: '2026-11-22',
  return_date: '2026-12-04',
  airlines: ['Air Canada'],
  price: 1446,
  currency: 'USD',
}

function day(date: string, plans: number) {
  return {
    day: date,
    title: '',
    notes: '',
    destination_id: null,
    destination_name: null,
    timezone: null,
    in_trip: true,
    activity_count: plans,
    first: null,
    last: null,
  }
}

describe('BestOptions', () => {
  it('offers Choose on each fare and marks the one chosen', async () => {
    const onChoose = vi.fn()
    const chosen = fare({ id: 7, depart_date: '2026-11-22', return_date: '2026-12-04' })
    const other = fare({ id: 8, depart_date: '2026-11-18', return_date: '2026-11-26', airlines: ['American'] })
    const user = userEvent.setup()

    renderWithProviders(
      <BestOptions quotes={[chosen, other]} currency="USD" onHide={() => {}} chosen={new Set([flightKey(chosen)])} onChoose={onChoose} />,
    )

    const table = screen.getByRole('table')
    const [, chosenRow, otherRow] = within(table).getAllByRole('row')
    expect(within(chosenRow).getByText('Your flight')).toBeInTheDocument()
    expect(within(chosenRow).queryByRole('button', { name: /^Choose/ })).not.toBeInTheDocument()
    await user.click(within(otherRow).getByRole('button', { name: /^Choose the Nov 18/ }))
    expect(onChoose).toHaveBeenCalledWith(other)
  })
})

describe('ChooseFlightDialog', () => {
  it('shows the new dates, warns about planned days left outside, and saves the choice', async () => {
    let sent: unknown
    mockApi({
      '/api/v1/trips/7/days': [day('2026-11-20', 2), day('2026-11-25', 1), day('2026-11-29', 0)],
      'PUT /api/v1/routes/12/choice': async (request: Request) => {
        sent = await request.json()
        return jsonResponse({ ...costaRica, start_date: '2026-11-22', end_date: '2026-12-04' })
      },
    })
    const onClose = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<ChooseFlightDialog trip={costaRica} pick={pick} onClose={onClose} />)

    const dialog = await screen.findByRole('alertdialog', { name: 'Use this flight for the trip?' })
    expect(dialog).toHaveTextContent('The trip becomes Nov 22 – Dec 4, 2026')
    expect(dialog).toHaveTextContent('(it’s Nov 20 – 29, 2026 now)')
    expect(await within(dialog).findByText(/1 day with plans falls outside those dates/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Use this flight' }))

    expect(sent).toEqual({ quote_id: 51 })
    expect(await screen.findByText('The trip is now Nov 22 – Dec 4, 2026')).toBeInTheDocument()
  })
})

describe('TripEditor', () => {
  it('keeps the dates a chosen flight set, and says how to change them', async () => {
    mockApi({ '/api/v1/settings': { home_currency: 'USD' }, '/api/v1/people': [] })
    const chosen = {
      ...costaRica,
      start_date: '2026-11-22',
      end_date: '2026-12-04',
      flight_dates: {
        start: '2026-11-22',
        end: '2026-12-04',
        flights: [
          {
            route_id: 12,
            origin: 'CLT',
            destination: 'SJO',
            depart_date: '2026-11-22',
            return_date: '2026-12-04',
            airlines: ['Air Canada'],
          },
        ],
      },
    }

    renderWithProviders(<TripEditor open onOpenChange={() => {}} trip={chosen} />)

    expect(await screen.findByLabelText('Start')).toBeDisabled()
    expect(screen.getByLabelText('End')).toBeDisabled()
    expect(screen.getByText(/Set by your flight \(CLT → SJO, Air Canada\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Flights page' })).toHaveAttribute('href', '/trips/7/flights')
  })
})
