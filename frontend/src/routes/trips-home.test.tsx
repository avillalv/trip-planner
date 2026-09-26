import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { systemStatus, trip } from '@/test/fixtures'
import { mockApi, renderWithProviders } from '@/test/render'
import { TripsHome } from './trips-home'

describe('TripsHome', () => {
  it('lists trips with destinations, dates, and length', async () => {
    mockApi({ '/api/v1/trips': [trip()], '/api/v1/system/status': systemStatus() })

    renderWithProviders(<TripsHome />)

    expect(await screen.findByRole('heading', { name: 'Japan in autumn' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Japan in autumn/ })).toHaveAttribute('href', '/trips/7')
    expect(screen.getByText('Kyoto')).toBeInTheDocument()
    expect(screen.getByText(/Nov 5\s*–\s*15, 2026 · 11 days/)).toBeInTheDocument()
    expect(screen.getByText('Travelers: Alex Rivera')).toBeInTheDocument()
  })

  it('invites you to plan the first trip when there are none', async () => {
    mockApi({ '/api/v1/trips': [], '/api/v1/system/status': systemStatus() })

    renderWithProviders(<TripsHome />)

    expect(await screen.findByRole('heading', { name: 'No trips yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan a trip' })).toBeInTheDocument()
  })

  it('points to Settings for unfinished setup', async () => {
    mockApi({ '/api/v1/trips': [trip()], '/api/v1/system/status': systemStatus() })

    renderWithProviders(<TripsHome />)

    expect(await screen.findByText(/Not set up yet: SerpApi, Travelpayouts, Wikipedia contact\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review in Settings' })).toHaveAttribute('href', '/settings')
  })

  it('keeps archived trips out of the main list', async () => {
    mockApi({
      '/api/v1/trips': [trip(), trip({ id: 8, name: 'Old trip', status: 'archived' })],
      '/api/v1/system/status': systemStatus(),
    })

    renderWithProviders(<TripsHome />)

    await screen.findByRole('heading', { name: 'Japan in autumn' })
    expect(screen.queryByRole('heading', { name: 'Old trip' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show archived trips (1)' })).toBeInTheDocument()
  })
})
