import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useTrip } from '@/lib/api/trips'
import { trip } from '@/test/fixtures'
import { jsonResponse, mockApi, renderWithProviders } from '@/test/render'
import { InterestsEditor } from './interests-editor'

function Harness() {
  const { data } = useTrip(7)
  return data ? <InterestsEditor tripId={7} interests={data.interests} /> : null
}

function renderEditor(initial: string[] = []) {
  let current = initial
  const saved: unknown[] = []
  mockApi({
    '/api/v1/trips/7': () => jsonResponse(trip({ interests: current })),
    'PUT /api/v1/trips/7/interests': async (request: Request) => {
      const body = (await request.json()) as { interests: string[] }
      saved.push(body)
      current = body.interests
      return jsonResponse(trip({ interests: current }))
    },
  })
  renderWithProviders(<Harness />)
  return saved
}

describe('InterestsEditor', () => {
  it('adds an interest on Enter and shows it at once', async () => {
    const saved = renderEditor(['Beaches'])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Add an interest'), 'ATV   tours{Enter}')

    expect(await screen.findByRole('button', { name: 'Remove ATV tours' })).toBeInTheDocument()
    expect(saved).toEqual([{ interests: ['Beaches', 'ATV tours'] }])
    expect(screen.getByLabelText('Add an interest')).toHaveValue('')
  })

  it('adds each entry as a comma is typed, and ignores repeats', async () => {
    const saved = renderEditor(['Beaches'])
    const user = userEvent.setup()

    await user.type(await screen.findByLabelText('Add an interest'), 'volcanoes,beaches,')

    expect(await screen.findByRole('button', { name: 'Remove volcanoes' })).toBeInTheDocument()
    expect(saved.at(-1)).toEqual({ interests: ['Beaches', 'volcanoes'] })
  })

  it('removes an interest', async () => {
    const saved = renderEditor(['Beaches', 'Volcanoes'])
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Remove Beaches' }))

    expect(screen.queryByRole('button', { name: 'Remove Beaches' })).not.toBeInTheDocument()
    expect(saved).toEqual([{ interests: ['Volcanoes'] }])
  })

  it('offers suggestions that are not already added, and adds one on click', async () => {
    const saved = renderEditor(['beaches'])
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Add Nature' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Beaches' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add Nature' }))

    expect(await screen.findByRole('button', { name: 'Remove Nature' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Nature' })).not.toBeInTheDocument()
    expect(saved).toEqual([{ interests: ['beaches', 'Nature'] }])
  })
})
