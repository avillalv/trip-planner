import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SystemStatus } from '@/lib/api/system'
import { jsonResponse, renderWithProviders } from '@/test/render'
import { TripsHome } from './trips-home'

const status: SystemStatus = {
  version: '0.1.0',
  database: 'ok',
  worker: { status: 'ok', last_seen: new Date().toISOString() },
  claude: { found: true, path: 'claude', version: '2.1.211' },
  integrations: { geoapify: true, serpapi: false, travelpayouts: false },
  home_currency: 'USD',
}

describe('TripsHome setup checklist', () => {
  it('shows what is ready and what still needs a key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(status))

    renderWithProviders(<TripsHome />)

    expect(await screen.findByText('4 of 6 ready')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Found · version 2.1.211')).toBeInTheDocument()
    expect(screen.getByText('Add SERPAPI_API_KEY to .env for live Google Flights prices.')).toBeInTheDocument()
  })

  it('explains how to start the server when it is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    renderWithProviders(<TripsHome />)

    expect(await screen.findByText(/Can't reach the Trip Planner server/)).toBeInTheDocument()
  })
})
