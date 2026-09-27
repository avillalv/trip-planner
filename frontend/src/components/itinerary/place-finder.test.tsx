import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { PlaceFinder, type SearchCenter } from './place-finder'

// jsdom has no WebGL; the map isn't what these tests are about.
vi.mock('./place-map', () => ({ default: () => null }))

function searchesTo(sent: URLSearchParams[]) {
  mockApi({
    '/api/v1/places/search': (request: Request) => {
      sent.push(new URL(request.url).searchParams)
      return jsonResponse({ places: [], cached: false })
    },
  })
}

function renderFinder(center: SearchCenter) {
  return renderWithProviders(<PlaceFinder center={center} days={[]} initial={{}} saving={false} onAdd={() => {}} />)
}

describe('PlaceFinder', () => {
  it('searches all of a country by default', async () => {
    const sent: URLSearchParams[] = []
    searchesTo(sent)
    const user = userEvent.setup()

    renderFinder({ lat: 10.27, lon: -84.07, name: 'Costa Rica', destination: { id: 5, large: true } })
    expect(screen.getByRole('combobox', { name: 'How far to look' })).toHaveDisplayValue('All of Costa Rica')
    await user.click(screen.getByRole('radio', { name: 'Beaches' }))

    expect(await screen.findByText('Nothing found in Costa Rica. Try another word or category.')).toBeInTheDocument()
    expect(sent[0].get('within')).toBe('5')
    expect(sent[0].get('kind')).toBe('beaches')
  })

  it('looks within a distance in miles around a city', async () => {
    const sent: URLSearchParams[] = []
    searchesTo(sent)
    const user = userEvent.setup()

    renderFinder({ lat: 35.01, lon: 135.77, name: 'Kyoto', destination: { id: 9, large: false } })
    expect(screen.getByRole('combobox', { name: 'How far to look' })).toHaveDisplayValue('Within 5 mi')
    await user.click(screen.getByRole('radio', { name: 'Nightlife' }))

    expect(
      await screen.findByText(
        'Nothing found within 5 mi of Kyoto. Try a wider distance, all of Kyoto, or move the map and search that area.',
      ),
    ).toBeInTheDocument()
    expect(sent[0].get('within')).toBeNull()
    expect(sent[0].get('radius_m')).toBe('8047')

    await user.selectOptions(screen.getByRole('combobox', { name: 'How far to look' }), 'Within 50 mi')
    expect(await screen.findByText(/Nothing found within 50 mi of Kyoto/)).toBeInTheDocument()
    expect(sent.at(-1)?.get('radius_m')).toBe('80467')
  })
})
