import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Run, RunEvent } from '@/lib/api/flights'
import type { Day } from '@/lib/api/itinerary'
import type { Suggestion } from '@/lib/api/suggestions'
import { suggestion, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { AiPlannerSheet } from './ai-planner-sheet'

const RUN_ID = '7f3c0a52-2f1e-4b1e-9d0e-1f2a3b4c5d6e'

function day(date: string, overrides: Partial<Day> = {}): Day {
  return {
    day: date,
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

const days = [day('2026-11-05'), day('2026-11-06', { title: 'Temples' })]

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    routine_id: null,
    trip_id: 7,
    kind: 'itinerary_agent',
    trigger: 'manual',
    status: 'succeeded',
    params: { mode: 'brainstorm', message: 'Quiet mornings', day: null },
    queued_at: '2026-09-29T12:00:00Z',
    started_at: '2026-09-29T12:00:05Z',
    finished_at: '2026-09-29T12:05:05Z',
    summary: 'I picked three calm spots, with the temple first thing.',
    error: null,
    accepted_count: 2,
    rejected_count: 0,
    input_tokens: 30000,
    output_tokens: 2000,
    cost_usd_est: '0.30',
    cancel_requested: false,
    ...overrides,
  }
}

const event: RunEvent = {
  seq: 1,
  ts: '2026-09-29T12:00:30Z',
  type: 'tool_use',
  tool_name: 'WebSearch',
  summary: 'Searched the web for “Kyoto in November”',
  payload: null,
}

type Setup = { runs?: Run[]; suggestions?: Suggestion[]; activities?: Array<{ id: number; day: string | null }>; day?: string }

function setup({ runs = [], suggestions = [], activities = [], day: focus }: Setup = {}) {
  const state = { runs, suggestions }
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const record = async (request: Request) => {
    const text = await request.text()
    requests.push({ method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null })
  }
  mockApi({
    '/api/v1/runs': () => jsonResponse(state.runs),
    [`/api/v1/runs/${RUN_ID}/events`]: [event],
    '/api/v1/trips/7/suggestions': () => jsonResponse(state.suggestions),
    '/api/v1/trips/7/activities': activities,
    'POST /api/v1/trips/7/ai/ideas': async (request: Request) => {
      await record(request)
      state.runs = [run({ status: 'running', summary: null, finished_at: null })]
      return jsonResponse(state.runs[0], 202)
    },
    'POST /api/v1/suggestions/5/add': async (request: Request) => {
      await record(request)
      state.suggestions = state.suggestions.map((s) =>
        s.id === 5 ? { ...s, status: 'added' as const, activity_id: 40 } : s,
      )
      return jsonResponse({ id: 40, day: '2026-11-06' }, 201)
    },
    'PATCH /api/v1/suggestions/5': async (request: Request) => {
      await record(request)
      state.suggestions = []
      return jsonResponse({ ...suggestion(), status: 'dismissed' })
    },
  })
  renderWithProviders(<AiPlannerSheet trip={trip()} days={days} day={focus} />)
  return { requests }
}

async function open() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Plan with AI' }))
  await screen.findByRole('heading', { name: 'Your interests' })
  return user
}

describe('AiPlannerSheet', () => {
  it('asks Claude to brainstorm with the message and the chosen day', async () => {
    const { requests } = setup()
    const user = await open()

    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('What are you in the mood for?'), '  A rainy-day plan  ')
    await user.selectOptions(screen.getByLabelText('Day'), '2026-11-06')
    await user.click(screen.getByRole('button', { name: 'Brainstorm' }))

    expect(await screen.findByText('Claude is working on it…')).toBeInTheDocument()
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/v1/trips/7/ai/ideas',
        body: { mode: 'brainstorm', message: 'A rainy-day plan', day: '2026-11-06' },
      },
    ])
    expect(await screen.findByText('Searched the web for “Kyoto in November”')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See the full log' })).toHaveAttribute('href', `/agents/runs/${RUN_ID}`)
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Brainstorm' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Surprise me' })).toBeDisabled()
  })

  it('asks Claude to surprise you without a message or day', async () => {
    const { requests } = setup()
    const user = await open()

    await user.click(screen.getByRole('button', { name: 'Surprise me' }))

    await screen.findByText('Claude is working on it…')
    expect(requests[0].body).toEqual({ mode: 'surprise', message: null, day: null })
  })

  it('shows why a request could not start', async () => {
    mockApi({
      '/api/v1/runs': [],
      '/api/v1/trips/7/suggestions': [],
      'POST /api/v1/trips/7/ai/ideas': () =>
        jsonResponse({ detail: 'Claude is still working on your last request. Wait for it or stop it first.' }, 409),
    })
    renderWithProviders(<AiPlannerSheet trip={trip()} days={days} />)
    const user = await open()

    await user.click(screen.getByRole('button', { name: 'Brainstorm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Claude is still working on your last request.')
  })

  it("shows Claude's reply with the suggestions, and adds one to its day", async () => {
    const { requests } = setup({
      runs: [run()],
      suggestions: [
        suggestion(),
        suggestion({ id: 6, title: 'Street food crawl', mode: 'surprise', day: null, start_time: null, end_time: null, duration_min: 120 }),
      ],
    })
    const user = await open()

    expect(await screen.findByText('I picked three calm spots, with the temple first thing.')).toBeInTheDocument()
    expect(screen.getByText(/Claude · Brainstorm/)).toBeInTheDocument()
    expect(screen.getByText('You asked: “Quiet mornings”')).toBeInTheDocument()

    const card = screen.getByRole('heading', { name: 'Fushimi Inari at dawn' }).closest('li')!
    expect(within(card).getByText(/Nov 6 · 7:00\s?AM – 10:00\s?AM · 3 h/)).toBeInTheDocument()
    expect(within(card).getByText('Dry until noon on the 6th.')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /inari\.jp/ })).toHaveAttribute('href', 'https://inari.jp/en/')
    expect(within(card).getByRole('link', { name: 'Source 1, japan-guide.com' })).toHaveAttribute('target', '_blank')

    const surprise = screen.getByRole('heading', { name: 'Street food crawl' }).closest('li')!
    expect(within(surprise).getByText('Surprise')).toBeInTheDocument()
    expect(within(surprise).getByText('Any day · about 2 h')).toBeInTheDocument()
    expect(within(surprise).getByRole('button', { name: 'Add as an idea' })).toBeInTheDocument()
    expect(within(surprise).queryByRole('button', { name: 'Save as idea' })).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Add to Nov 6' }))

    expect(await screen.findByText(/Added \(1\)/)).toBeInTheDocument()
    expect(requests).toEqual([{ method: 'POST', path: '/api/v1/suggestions/5/add', body: { as_idea: false } }])
    expect(screen.queryByRole('heading', { name: 'Fushimi Inari at dawn' })).not.toBeInTheDocument()
  })

  it('dismisses a suggestion at once', async () => {
    const { requests } = setup({ runs: [run()], suggestions: [suggestion()] })
    const user = await open()

    await user.click(await screen.findByRole('button', { name: 'Dismiss Fushimi Inari at dawn' }))

    expect(screen.queryByRole('heading', { name: 'Fushimi Inari at dawn' })).not.toBeInTheDocument()
    expect(requests).toEqual([{ method: 'PATCH', path: '/api/v1/suggestions/5', body: { status: 'dismissed' } }])
  })

  it('saves a suggestion as an idea instead of scheduling it', async () => {
    const { requests } = setup({ runs: [run()], suggestions: [suggestion()] })
    const user = await open()

    await user.click(await screen.findByRole('button', { name: 'Save as idea' }))

    await screen.findByText(/Added \(1\)/)
    expect(requests[0].body).toEqual({ as_idea: true })
  })

  it('lists what was added, with a link to its day', async () => {
    setup({
      runs: [run()],
      suggestions: [suggestion({ status: 'added', activity_id: 40 }), suggestion({ id: 6, title: 'Nishiki Market lunch', status: 'added', activity_id: 41 })],
      activities: [
        { id: 40, day: '2026-11-06' },
        { id: 41, day: null },
      ],
    })
    const user = await open()

    await user.click(await screen.findByText('Added (2)'))

    expect(screen.getByRole('link', { name: 'Fri, Nov 6' })).toHaveAttribute('href', '/trips/7/itinerary/2026-11-06')
    expect(screen.getByText('In your ideas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add to/ })).not.toBeInTheDocument()
  })

  it('explains a failed run in a warning', async () => {
    setup({ runs: [run({ status: 'timed_out', summary: null, error: 'Claude took too long, so the run was stopped. Try a narrower request.' })] })
    await open()

    expect(await screen.findByRole('alert')).toHaveTextContent('Claude took too long')
    expect(screen.getByRole('button', { name: 'Brainstorm' })).toBeEnabled()
  })

  it("presets the day page's day and lists its ideas first", async () => {
    setup({
      runs: [run()],
      suggestions: [
        suggestion({ id: 6, title: 'Nishiki Market lunch', day: '2026-11-05', category: 'food' }),
        suggestion(),
      ],
      day: '2026-11-06',
    })
    await open()

    await screen.findByRole('heading', { name: 'Fushimi Inari at dawn' })
    expect(screen.getByLabelText('Day')).toHaveValue('2026-11-06')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings.slice(-2)).toEqual(['For this day', 'Other ideas'])
    const cards = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(cards).toEqual(['Fushimi Inari at dawn', 'Nishiki Market lunch'])
  })
})
