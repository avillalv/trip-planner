import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { presentation } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { PresentPage } from './present-page'

// jsdom has no WebGL; the live map isn't what these tests are about.
vi.mock('@/components/itinerary/place-map', () => ({ default: () => null }))

function renderDeck() {
  return renderWithProviders(
    <Routes>
      <Route path="/trips/:tripId/present" element={<PresentPage />} />
    </Routes>,
    { route: '/trips/7/present' },
  )
}

const current = () => screen.getByText(/^Slide \d+ of \d+/)

describe('PresentPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('moves through the slides with the keyboard', async () => {
    mockApi({ '/api/v1/trips/7/presentation': presentation() })
    const user = userEvent.setup()

    renderDeck()
    expect(await screen.findByRole('heading', { name: 'Japan in autumn' })).toBeInTheDocument()
    expect(current()).toHaveTextContent('Slide 1 of 6: Japan in autumn')

    await user.keyboard('{ArrowRight}')
    expect(current()).toHaveTextContent('Slide 2 of 6: Kyoto')
    await user.keyboard(' ')
    expect(current()).toHaveTextContent('Slide 3 of 6: Flights: LAX → HND, NRT')
    await user.keyboard('{End}')
    expect(current()).toHaveTextContent('Slide 6 of 6: Trip at a glance')
    await user.keyboard('{ArrowRight}')
    expect(current()).toHaveTextContent('Slide 6 of 6')
    await user.keyboard('{Home}')
    expect(current()).toHaveTextContent('Slide 1 of 6')
    expect(window.location.hash).toBe('#1')
  })

  it('opens where the address says', async () => {
    window.history.replaceState(null, '', '/#5')
    mockApi({ '/api/v1/trips/7/presentation': presentation() })

    renderDeck()

    expect(await screen.findByText('Slide 5 of 6: Day 2: Temples')).toBeInTheDocument()
    const day = screen.getByRole('group', { name: /^5 of 6/ })
    expect(within(day).getByText('Fushimi Inari')).toBeInTheDocument()
  })

  it('jumps to a slide from the overview', async () => {
    mockApi({ '/api/v1/trips/7/presentation': presentation() })
    const user = userEvent.setup()

    renderDeck()
    await screen.findByRole('heading', { name: 'Japan in autumn' })
    await user.keyboard('g')
    const overview = screen.getByRole('dialog', { name: 'All slides' })
    await user.click(within(overview).getByRole('button', { name: /Places we like/ }))

    expect(screen.queryByRole('dialog', { name: 'All slides' })).not.toBeInTheDocument()
    expect(current()).toHaveTextContent('Slide 4 of 6: Places we like')
  })

  it('leaves out empty sections', async () => {
    mockApi({ '/api/v1/trips/7/presentation': presentation({ routes: [], lodging: [], days: [], idea_count: 0 }) })

    renderDeck()

    expect(await screen.findByText('Slide 1 of 3: Japan in autumn')).toBeInTheDocument()
    // Slides not on screen stay in the page for printing, hidden from assistive tech.
    expect(screen.getAllByRole('group', { hidden: true }).map((g) => g.getAttribute('aria-label'))).toEqual([
      '1 of 3: Japan in autumn',
      '2 of 3: Kyoto',
      '3 of 3: Trip at a glance',
    ])
  })

  it('explains a trip that no longer exists', async () => {
    mockApi({ '/api/v1/trips/7/presentation': () => jsonResponse({ detail: 'Trip not found.' }, 404) })

    renderDeck()

    expect(await screen.findByRole('heading', { name: 'This trip isn’t available' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to trips' })).toHaveAttribute('href', '/')
  })
})
