import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RunOutputs } from '@/lib/api/agents'
import { lodging } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { savedCount } from './run-meta'
import { SavedOutputs } from './run-outputs'

const empty: RunOutputs = { quotes: [], suggestions: [], lodging: [], notes: [], rejections: [] }

describe('SavedOutputs', () => {
  it('lists a lodging run’s picks with their price and link', () => {
    const outputs: RunOutputs = {
      ...empty,
      lodging: [
        lodging({ title: 'Machiya with a garden', added_via: 'agent', notes: 'AI pick #1: Quiet, near the market.' }),
        lodging({ id: 4, title: 'Stay Inn KOTO', site: 'Voyabay', url: 'https://voyabay.com/rentals/lpcf1e4', price_total: '275.00', currency: 'USD' }),
      ],
    }
    expect(savedCount(outputs)).toBe(2)

    renderWithProviders(<SavedOutputs outputs={outputs} />)

    const section = screen.getByRole('heading', { name: 'Places to stay' }).closest('section')!
    const first = within(section).getByText('Machiya with a garden').closest('li')!
    expect(within(first).getByText('¥96,000')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /airbnb\.com/ })).toHaveAttribute('href', 'https://www.airbnb.com/rooms/53122')
    const second = within(section).getByText('Stay Inn KOTO').closest('li')!
    expect(within(second).getByText('$275')).toBeInTheDocument()
    expect(within(second).getByRole('link', { name: /voyabay\.com/ })).toHaveAttribute('href', 'https://voyabay.com/rentals/lpcf1e4')
  })

  it('says so when a run saved nothing', () => {
    renderWithProviders(<SavedOutputs outputs={empty} />)

    expect(screen.getByText(/This run didn't save any/)).toBeInTheDocument()
  })
})
