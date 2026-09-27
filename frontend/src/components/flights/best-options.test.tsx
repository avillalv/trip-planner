import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fare } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { BestOptions } from './best-options'

describe('BestOptions sorting and filtering', () => {
  it('sorts by nights on header click, and flips direction on a second click', async () => {
    const short = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-04' }) // 3 nights
    const long = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-11' }) // 10 nights
    const user = userEvent.setup()
    renderWithProviders(<BestOptions quotes={[short, long]} currency="USD" onHide={() => {}} />)

    const table = screen.getByRole('table')
    await user.click(within(table).getByRole('button', { name: 'Nights' }))

    const [, firstRow, secondRow] = within(table).getAllByRole('row')
    expect(within(firstRow).getByText('10')).toBeInTheDocument()
    expect(within(secondRow).getByText('3')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Nights' })).toHaveAttribute('aria-sort', 'descending')

    await user.click(within(table).getByRole('button', { name: 'Nights' }))
    const [, firstAfter, secondAfter] = within(table).getAllByRole('row')
    expect(within(firstAfter).getByText('3')).toBeInTheDocument()
    expect(within(secondAfter).getByText('10')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Nights' })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('filters by nights, updates the count, and Clear filters restores the rest', async () => {
    const n2 = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-03' })
    const n5 = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-06' })
    const n8 = fare({ id: 3, depart_date: '2026-11-01', return_date: '2026-11-09' })
    const user = userEvent.setup()
    renderWithProviders(<BestOptions quotes={[n2, n5, n8]} currency="USD" onHide={() => {}} />)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Fewest nights' }), '5')

    expect(screen.getByText('2 of 3 flights')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3) // header + 2 matches

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByText('3 flights')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4)
  })

  it('toggles a trip-length chip to show just that length, and again to clear it', async () => {
    const n2 = fare({ id: 1, depart_date: '2026-11-01', return_date: '2026-11-03' })
    const n5 = fare({ id: 2, depart_date: '2026-11-01', return_date: '2026-11-06' })
    const n8 = fare({ id: 3, depart_date: '2026-11-01', return_date: '2026-11-09' })
    const user = userEvent.setup()
    renderWithProviders(<BestOptions quotes={[n2, n5, n8]} currency="USD" onHide={() => {}} />)

    const chip = screen.getByRole('button', { name: /5 nights/ })
    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 of 3 flights')).toBeInTheDocument()

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('3 flights')).toBeInTheDocument()
  })

  it('shows 25 rows, then the rest after Show more', async () => {
    const quotes = Array.from({ length: 30 }, (_, i) => fare({ id: i + 1 }))
    const user = userEvent.setup()
    renderWithProviders(<BestOptions quotes={quotes} currency="USD" onHide={() => {}} />)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(26) // header + 25

    await user.click(screen.getByRole('button', { name: 'Show 5 more' }))

    expect(within(table).getAllByRole('row')).toHaveLength(31)
  })
})
