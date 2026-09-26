import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { systemStatus } from '@/test/fixtures'
import { mockApi, renderWithProviders } from '@/test/render'
import { SetupChecklist } from './setup-checklist'

describe('SetupChecklist', () => {
  it('shows what is ready and what still needs a key', async () => {
    mockApi({ '/api/v1/system/status': systemStatus() })

    renderWithProviders(<SetupChecklist />)

    expect(await screen.findByText('4 of 7 ready')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Found · version 2.1.283 · signed in')).toBeInTheDocument()
    expect(screen.getByText('Add SERPAPI_API_KEY to .env for live Google Flights prices.')).toBeInTheDocument()
    expect(screen.getByText(/for destination summaries and photos/)).toBeInTheDocument()
  })

  it('explains how to start the server when it is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    renderWithProviders(<SetupChecklist />)

    expect(await screen.findByText(/Can't reach the Trip Planner server/)).toBeInTheDocument()
  })
})

describe('SetupChecklist sign-in', () => {
  it('asks to sign Claude in when it is signed out', async () => {
    mockApi({
      '/api/v1/system/status': systemStatus({
        claude: { found: true, path: 'claude', version: '2.1.283', signed_in: false, auth_method: 'none' },
      }),
    })

    renderWithProviders(<SetupChecklist />)

    expect(await screen.findByText(/Signed out, so agents can't run/)).toBeInTheDocument()
  })
})
