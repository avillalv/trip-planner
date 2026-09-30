import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Routine, RunDetail, RunOutputs } from '@/lib/api/agents'
import type { Run, RunEvent } from '@/lib/api/flights'
import { suggestion, systemStatus, trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { AgentsPage } from './agents-page'
import { RunPage } from './run-page'

const RUN_ID = '7f3c0a52-2f1e-4b1e-9d0e-1f2a3b4c5d6e'

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: RUN_ID,
    routine_id: 3,
    trip_id: 7,
    kind: 'flight_agent',
    trigger: 'schedule',
    status: 'succeeded',
    params: {},
    queued_at: '2026-09-26T12:00:00Z',
    started_at: '2026-09-26T12:00:05Z',
    finished_at: '2026-09-26T12:06:05Z',
    summary: 'Found two fares on ZIPAIR.',
    error: null,
    accepted_count: 2,
    rejected_count: 1,
    input_tokens: 36000,
    output_tokens: 2400,
    cost_usd_est: '0.4100',
    cancel_requested: false,
    ...overrides,
  }
}

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: 3,
    trip_id: 7,
    name: 'Fare scout',
    kind: 'flight_agent',
    enabled: true,
    schedule_cron: '0 8,20 * * *',
    timezone: 'America/New_York',
    catch_up: true,
    config: { route_ids: [], topic: null, instructions: null, max_turns: null, timeout_min: null },
    next_run_at: '2026-09-26T20:00:00Z',
    last_run: run(),
    ...overrides,
  }
}

const priceCheck = routine({ id: 1, name: 'Flight prices', kind: 'flight_api', last_run: null })

describe('AgentsPage', () => {
  it('lists routines by trip with their last run', async () => {
    mockApi({
      '/api/v1/routines': [priceCheck, routine()],
      '/api/v1/trips': [trip()],
      '/api/v1/runs': [run()],
      '/api/v1/system/status': systemStatus(),
    })

    renderWithProviders(<AgentsPage />, { route: '/agents' })

    const card = (await screen.findByRole('heading', { name: 'Fare scout' })).closest('li')!
    expect(within(card).getByText(/Flight search · Twice a day/)).toBeInTheDocument()
    expect(within(card).getByText('Found two fares on ZIPAIR.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Run Fare scout on schedule' })).toBeChecked()
    expect(screen.getByText('Japan in autumn')).toBeInTheDocument()
    expect(screen.queryByText('No agent routines yet')).not.toBeInTheDocument()
    expect(await screen.findByText(/2 saved · 1 rejected/)).toBeInTheDocument()
  })

  it('lists runs that came from a traveler’s request rather than a routine', async () => {
    mockApi({
      '/api/v1/routines': [priceCheck],
      '/api/v1/trips': [trip()],
      '/api/v1/runs': [
        run({ routine_id: null, kind: 'itinerary_agent', trigger: 'manual', summary: 'Three calm spots.', accepted_count: 3, rejected_count: 0 }),
      ],
      '/api/v1/system/status': systemStatus(),
    })

    renderWithProviders(<AgentsPage />, { route: '/agents' })

    const row = (await screen.findByText('Itinerary ideas')).closest('li')!
    expect(within(row).getByText('Three calm spots.')).toBeInTheDocument()
    expect(within(row).getByText(/Started by hand · .*3 saved/)).toBeInTheDocument()
  })

  it('offers to create a routine and explains how to sign Claude in', async () => {
    mockApi({
      '/api/v1/routines': [priceCheck],
      '/api/v1/trips': [trip()],
      '/api/v1/runs': [],
      '/api/v1/system/status': systemStatus({
        claude: { found: true, path: 'claude', version: '2.1.283', signed_in: false, auth_method: 'none' },
      }),
    })

    renderWithProviders(<AgentsPage />, { route: '/agents' })

    expect(await screen.findByText('No agent routines yet')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Sign Claude Code in to run agents' })).toBeInTheDocument()
    expect(screen.getByText('Claude Code 2.1.283 is signed out')).toBeInTheDocument()
  })

  it('creates a flight search routine for the chosen trip', async () => {
    let created: unknown
    mockApi({
      '/api/v1/routines': [priceCheck],
      '/api/v1/trips': [trip()],
      '/api/v1/runs': [],
      '/api/v1/system/status': systemStatus(),
      '/api/v1/trips/7/routes': [
        {
          id: 4,
          trip_id: 7,
          label: null,
          origin_codes: ['LAX'],
          destination_codes: ['NRT'],
          active: true,
        },
      ],
      'POST /api/v1/routines': async (request: Request) => {
        created = await request.json()
        return jsonResponse(routine({ last_run: null }), 201)
      },
    })
    const user = userEvent.setup()

    renderWithProviders(<AgentsPage />, { route: '/agents?trip=7' })
    await user.click(await screen.findByRole('button', { name: 'Search for fares' }))
    expect(await screen.findByLabelText('LAX → NRT')).toBeChecked()
    await user.type(screen.getByLabelText('Anything else it should know (optional)'), 'Nonstop only')
    await user.click(screen.getByRole('button', { name: 'Create routine' }))

    await screen.findByText(/Fare scout created/)
    expect(created).toMatchObject({
      trip_id: 7,
      kind: 'flight_agent',
      schedule_cron: '0 8,20 * * *',
      config: { route_ids: [], instructions: 'Nonstop only' },
    })
  })
})

describe('RunPage', () => {
  const detail: RunDetail = {
    ...run(),
    prompt: '# Task: flight prices for Japan in autumn',
    argv_redacted: ['claude', '-p', '--model', 'sonnet'],
    exit_code: 0,
    report: { status: 'ok', summary: 'Checked ZIPAIR and United.', sources_checked: ['zipair.net'], issues: [] },
    log_path: null,
  }
  const events: RunEvent[] = [
    { seq: 1, ts: '2026-09-26T12:00:06Z', type: 'info', tool_name: null, summary: 'Starting Claude (sonnet)', payload: null },
    {
      seq: 2,
      ts: '2026-09-26T12:00:30Z',
      type: 'tool_use',
      tool_name: 'WebSearch',
      summary: 'Searched the web for “LAX Tokyo fares”',
      payload: { input: { query: 'LAX Tokyo fares' } },
    },
  ]
  const outputs: RunOutputs = {
    quotes: [],
    suggestions: [],
    lodging: [],
    notes: [
      {
        id: 1,
        trip_id: 7,
        run_id: RUN_ID,
        title: 'ZIPAIR sale ends Oct 3',
        body: 'One-way fares from $299.',
        urls: ['https://www.zipair.net/en/sale'],
        created_at: '2026-09-26T12:03:00Z',
      },
    ],
    rejections: [
      {
        id: 9,
        entity: 'flight_quote',
        item: { origin: 'SFO', destination: 'NRT', depart_date: '2026-11-05', price_total: '612', currency: 'USD' },
        errors: [{ field: 'origin', msg: 'must be one of LAX' }],
        created_at: '2026-09-26T12:02:00Z',
      },
    ],
  }

  function renderRun() {
    mockApi({
      [`/api/v1/runs/${RUN_ID}`]: detail,
      [`/api/v1/runs/${RUN_ID}/events`]: events,
      [`/api/v1/runs/${RUN_ID}/outputs`]: outputs,
      '/api/v1/routines': [routine()],
      '/api/v1/trips': [trip()],
    })
    return renderWithProviders(
      <Routes>
        <Route path="/agents/runs/:runId" element={<RunPage />} />
      </Routes>,
      { route: `/agents/runs/${RUN_ID}` },
    )
  }

  it('shows the outcome, the agent’s report, and what was saved', async () => {
    renderRun()

    expect(await screen.findByRole('heading', { name: 'Fare scout' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Done,/ })).toBeInTheDocument()
    expect(screen.getByText('Checked ZIPAIR and United.')).toBeInTheDocument()
    expect(await screen.findByText('ZIPAIR sale ends Oct 3')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /zipair\.net/ })).toHaveAttribute('href', 'https://www.zipair.net/en/sale')
  })

  it('counts an itinerary run’s ideas as saved and lists them', async () => {
    mockApi({
      [`/api/v1/runs/${RUN_ID}`]: { ...detail, routine_id: null, kind: 'itinerary_agent', trigger: 'manual', report: null, summary: 'Three calm spots.' },
      [`/api/v1/runs/${RUN_ID}/events`]: events,
      [`/api/v1/runs/${RUN_ID}/outputs`]: { ...outputs, notes: [], rejections: [], suggestions: [suggestion()] },
      '/api/v1/routines': [],
      '/api/v1/trips': [trip()],
    })
    renderWithProviders(
      <Routes>
        <Route path="/agents/runs/:runId" element={<RunPage />} />
      </Routes>,
      { route: `/agents/runs/${RUN_ID}` },
    )

    expect(await screen.findByRole('heading', { name: 'Itinerary ideas' })).toBeInTheDocument()
    expect(await screen.findByRole('tab', { name: 'Saved (1)' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Fushimi Inari at dawn')).toBeInTheDocument()
    expect(screen.getByText(/Fri, Nov 6/)).toBeInTheDocument()
  })

  it('explains rejections and shows the log and the exact task', async () => {
    const user = userEvent.setup()
    renderRun()

    await user.click(await screen.findByRole('tab', { name: 'Rejected (1)' }))
    expect(screen.getByText('SFO → NRT · 2026-11-05 · USD 612')).toBeInTheDocument()
    expect(screen.getByText('From')).toBeInTheDocument()
    expect(screen.getByText(/must be one of LAX/)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Log (2)' }))
    expect(screen.getByText('Searched the web for “LAX Tokyo fares”')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Task' }))
    expect(screen.getByText('# Task: flight prices for Japan in autumn')).toBeInTheDocument()
    expect(screen.getByText('claude -p --model sonnet')).toBeInTheDocument()
  })
})
