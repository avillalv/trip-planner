import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Run, RunEvent } from '@/lib/api/flights'
import { lodgingRun, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { AiLodgingDialog } from './ai-lodging-dialog'

const RUN_ID = lodgingRun().id

const event: RunEvent = {
  seq: 1,
  ts: '2026-09-29T12:00:30Z',
  type: 'tool_use',
  tool_name: 'WebSearch',
  summary: 'Searched the web for “Nishiki Market hotels reviews”',
  payload: null,
}

type Setup = { runs?: Run[]; failWith?: { status: number; detail: string } }

function setup({ runs = [], failWith }: Setup = {}) {
  const state = { runs }
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const onOpenChange = vi.fn()
  const onShowPicks = vi.fn()
  mockApi({
    '/api/v1/runs': () => jsonResponse(state.runs),
    [`/api/v1/runs/${RUN_ID}/events`]: [event],
    'POST /api/v1/trips/7/ai/lodging': async (request: Request) => {
      requests.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() })
      if (failWith) return jsonResponse({ detail: failWith.detail }, failWith.status)
      state.runs = [lodgingRun({ status: 'running', summary: null, finished_at: null })]
      return jsonResponse(state.runs[0], 202)
    },
  })
  renderWithProviders(
    <AiLodgingDialog open onOpenChange={onOpenChange} trip={trip()} onShowPicks={onShowPicks} />,
  )
  return { requests, onOpenChange, onShowPicks }
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Find the best places' }))

describe('AiLodgingDialog', () => {
  it('starts with the trip’s place, dates and party, and sends them for vacation rentals', async () => {
    const { requests } = setup()
    const user = userEvent.setup()

    expect(await screen.findByRole('dialog', { name: 'Find the best places to stay' })).toBeInTheDocument()
    expect(screen.getByLabelText('Place')).toHaveValue('Kyoto, Japan')
    expect(screen.getByLabelText('Check-in')).toHaveValue('2026-11-05')
    expect(screen.getByLabelText('Check-in')).toHaveAttribute('min', '2026-11-05')
    expect(screen.getByLabelText('Check-out')).toHaveAttribute('max', '2026-11-15')
    expect(screen.getByLabelText('Guests')).toHaveValue(1)
    expect(screen.getByRole('radio', { name: 'Vacation rentals' })).toBeChecked()
    expect(screen.getByLabelText('Anything to keep in mind?')).toHaveAttribute('placeholder', expect.stringContaining('Walkable to a beach'))
    expect(screen.getByText(/Uses one of this month’s Google searches/)).toBeInTheDocument()

    await submit(user)

    expect(await screen.findByText('Claude is working on it…')).toBeInTheDocument()
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/v1/trips/7/ai/lodging',
        body: {
          place: 'Kyoto, Japan',
          check_in: '2026-11-05',
          check_out: '2026-11-15',
          guests: 1,
          kind: 'rentals',
          message: null,
        },
      },
    ])
  })

  it('sends hotels, your dates and guests, and what to keep in mind', async () => {
    const { requests } = setup()
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('radio', { name: 'Hotels' }))
    expect(screen.getByRole('radio', { name: 'Hotels' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Vacation rentals' })).not.toBeChecked()
    fireEvent.change(screen.getByLabelText('Check-in'), { target: { value: '2026-11-07' } })
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-10' } })
    fireEvent.change(screen.getByLabelText('Guests'), { target: { value: '4' } })
    await user.clear(screen.getByLabelText('Place'))
    await user.type(screen.getByLabelText('Place'), 'Arashiyama')
    await user.type(screen.getByLabelText('Anything to keep in mind?'), '  Under $200 a night  ')
    await submit(user)

    await screen.findByText('Claude is working on it…')
    expect(requests[0].body).toEqual({
      place: 'Arashiyama',
      check_in: '2026-11-07',
      check_out: '2026-11-10',
      guests: 4,
      kind: 'hotels',
      message: 'Under $200 a night',
    })
  })

  it('checks the dates before spending a search', async () => {
    const { requests } = setup()
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    // The date fields' min and max keep dates inside the trip: the browser's own check stops the form.
    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-20' } })
    await submit(user)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Check-out'), { target: { value: '2026-11-05' } })
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick check-in and check-out dates.')
    expect(requests).toEqual([])
  })

  it.each([
    [429, 'You have used all of this month’s searches. They reset on the 1st.'],
    [422, 'Nothing came back for Kyoto, Japan on those dates. Try a nearby town or other dates.'],
  ])('shows why a %i request could not start', async (status, detail) => {
    setup({ failWith: { status, detail } })
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(detail)
    expect(screen.getByRole('button', { name: 'Find the best places' })).toBeEnabled()
  })

  it('shows progress while Claude works, and holds the form back', async () => {
    setup({ runs: [lodgingRun({ status: 'running', summary: null, finished_at: null })] })
    await screen.findByRole('dialog')

    expect(await screen.findByText('Claude is working on it…')).toBeInTheDocument()
    expect(await screen.findByText('Searched the web for “Nishiki Market hotels reviews”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the full log' })).toHaveAttribute('href', `/agents/runs/${RUN_ID}`)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Find the best places' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Show AI picks' })).not.toBeInTheDocument()
  })

  it('shows Claude’s reply, and “Show AI picks” closes the dialog and opens the picks', async () => {
    const { onOpenChange, onShowPicks } = setup({ runs: [lodgingRun()] })
    const user = userEvent.setup()

    expect(await screen.findByText('I picked three places near Nishiki Market, best first.')).toBeInTheDocument()
    expect(screen.getByText('You asked: “Near a market”')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find the best places' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Show AI picks' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onShowPicks).toHaveBeenCalledOnce()
  })

  it('explains a run that failed, without offering the picks', async () => {
    setup({ runs: [lodgingRun({ status: 'timed_out', summary: null, error: 'Claude took too long, so the run was stopped. Try again.' })] })

    expect(await screen.findByRole('alert')).toHaveTextContent('Claude took too long')
    expect(screen.queryByRole('button', { name: 'Show AI picks' })).not.toBeInTheDocument()
  })

  it('links to an Airbnb search for the same place, dates and guests', async () => {
    setup()
    const user = userEvent.setup()
    await screen.findByRole('dialog')

    const link = screen.getByRole('link', { name: /Search Airbnb for these dates/ })
    expect(link).toHaveAttribute(
      'href',
      'https://www.airbnb.com/s/Kyoto%2C%20Japan/homes?checkin=2026-11-05&checkout=2026-11-15&adults=1',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByText(/The app can’t check Airbnb for you/)).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Place'))
    await user.type(screen.getByLabelText('Place'), 'Nara')
    fireEvent.change(screen.getByLabelText('Guests'), { target: { value: '3' } })

    expect(link).toHaveAttribute('href', 'https://www.airbnb.com/s/Nara/homes?checkin=2026-11-05&checkout=2026-11-15&adults=3')
  })
})
